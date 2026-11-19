'use strict';

const { getStockAggregates, getStockMovements } = require('../db/erp');
const { todayInIstanbul } = require('../utils/dates');

const CACHE_TTL_MS = 60_000;
const DEFAULT_WINDOW = 30;
const WINDOWS = [30, 60, 90, 180, 365];
const STATES = ['in', 'zero', 'negative', 'all'];
const EPSILON = 1e-6;
const CASE_UNITS = new Set(['KL', 'KS', 'TV', 'PK', 'KT', 'KA', 'KU', 'PA']);
const PACKAGING_CODE_RE = /^(003|004|6\d{2})/;
const PACKAGING_NAME_RE = /^(SISE|KASA|PALET|FICI|TUP|SEPET|BARDAK|KADEH|TEPSI|TISORT|MONT|GOMLEK|YAGMURLUK|ACACAK|BARMAT|SEMSIYE|KARTON|PANTOLON)\b/;
const VOLUME_UNIT_TO_LITRE = { CL: 0.01, CK: 0.01, CC: 0.01, ML: 0.001, LT: 1, L: 1 };

const SORT_KEYS = {
  stock: (item) => item.stock,
  code: (item) => item.code,
  name: (item) => item.name,
  lastPurchase: (item) => item.lastPurchaseDate,
  lastSale: (item) => item.lastSaleDate,
  avgSales: (item) => item.avgDailySales,
  stockDays: (item) => item.stockDays,
  age: (item) => item.avgAgeDays,
  oldestAge: (item) => item.oldestAgeDays,
  salePrice: (item) => item.lastSalePrice,
  purchasePrice: (item) => item.lastPurchasePrice,
  value: (item) => item.value,
  litre: (item) => item.stockLt,
  adet: (item) => item.stockAd,
};

const MOVEMENT_LABELS = {
  'L/G': 'Alış',
  'L/C': 'Alış İadesi',
  'J/C': 'Satış',
  'J/G': 'Satış İadesi',
  'D/G': 'Devir Girişi',
  'D/C': 'Devir Çıkışı',
  'A/G': 'Açılış Girişi',
  'A/C': 'Açılış Çıkışı',
  'B/G': 'Giriş',
  'B/C': 'Çıkış',
  'E/G': 'Düzeltme Girişi',
  'E/C': 'Düzeltme Çıkışı',
};

const cache = new Map();
const pending = new Map();

function num(value) {
  const valueAsNumber = Number(value);
  return Number.isFinite(valueAsNumber) ? valueAsNumber : 0;
}

function nullableNum(value) {
  if (value === null || value === undefined || value === '') return null;
  const valueAsNumber = Number(value);
  return Number.isFinite(valueAsNumber) ? valueAsNumber : null;
}

function round(value, digits = 2) {
  const valueAsNumber = nullableNum(value);
  if (valueAsNumber === null) return null;
  const factor = 10 ** digits;
  return Math.round((valueAsNumber + Number.EPSILON) * factor) / factor;
}

function normalizeUnit(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().toUpperCase();
  if (!text || text === '0') return null;
  return text;
}

function isCaseUnit(value) {
  const unit = normalizeUnit(value);
  return Boolean(unit && CASE_UNITS.has(unit));
}

function normalizeRatio(pay, payda) {
  const numerator = nullableNum(pay);
  const denominator = nullableNum(payda);
  if (numerator === null || denominator === null) return null;
  if (numerator <= 0 || denominator <= 0) return null;
  return numerator / denominator;
}

function unitFactor(primaryUnit, unitCode, pay, payda) {
  if (!unitCode) return null;
  if (unitCode === primaryUnit) return 1;
  const ratio = normalizeRatio(pay, payda);
  if (!ratio) return null;
  if (CASE_UNITS.has(primaryUnit) && ratio < 1) return 1 / ratio;
  return ratio;
}

/**
 * OLCU_BR1 birincil birimdir; STHAR_GCMIK bu birimde tutulur.
 * PAY_1/PAYDA_1 BR1 -> BR2, PAY2/PAYDA2 BR1 -> BR3 katsayısıdır.
 * Koli/kasa benzeri kaynak birimlerde 1'den küçük kayıtlı oran ters çevrilir
 * (DINO 24/1 ile BERMER 1/24 aynı koli -> adet ilişkisini ifade eder).
 */
function buildUnitInfo(row) {
  const primaryUnit = normalizeUnit(row.OLCU_BR1);
  const byIndex = [null, null, null];

  if (!primaryUnit) {
    return {
      primaryUnit: null,
      units: [],
      ltFactor: null,
      adFactor: null,
      priceFactor: () => 1,
    };
  }

  byIndex[0] = { code: primaryUnit, factor: 1 };

  const br2 = normalizeUnit(row.OLCU_BR2);
  if (br2) {
    const factor = unitFactor(primaryUnit, br2, row.PAY_1, row.PAYDA_1);
    if (factor) byIndex[1] = { code: br2, factor };
  }

  const br3 = normalizeUnit(row.OLCU_BR3);
  if (br3) {
    const known = byIndex.find((unit) => unit && unit.code === br3);
    const factor = known ? known.factor : unitFactor(primaryUnit, br3, row.PAY2, row.PAYDA2);
    if (factor) byIndex[2] = { code: br3, factor };
  }

  const units = [];
  for (const unit of byIndex) {
    if (!unit) continue;
    if (units.some((existing) => existing.code === unit.code)) continue;
    units.push(unit);
  }

  const litre = units.find((unit) => unit.code === 'LT');
  const piece = units.find((unit) => unit.code === 'AD');

  return {
    primaryUnit,
    units,
    ltFactor: litre ? litre.factor : null,
    adFactor: piece ? piece.factor : null,
    priceFactor(fiatBirimi) {
      const index = Number.parseInt(String(fiatBirimi ?? '1'), 10);
      const position = Number.isInteger(index) && index >= 1 && index <= 3 ? index - 1 : 0;
      return byIndex[position]?.factor || 1;
    },
  };
}

/**
 * Ürün adı karşılaştırması için Türkçe ve bozuk (windows-1254) karakterleri
 * ASCII'ye indirger. Ondalık virgül noktaya çevrilir; paket çarpanlarındaki
 * "*" işareti " X " olarak korunur.
 */
function normalizeStockText(value) {
  return String(value ?? '')
    .toLocaleUpperCase('tr-TR')
    .replace(/İ/g, 'I')
    .replace(/Ş/g, 'S')
    .replace(/Ğ/g, 'G')
    .replace(/Ü/g, 'U')
    .replace(/Ö/g, 'O')
    .replace(/Ç/g, 'C')
    .replace(/Ý/g, 'I')
    .replace(/Þ/g, 'S')
    .replace(/Ð/g, 'G')
    .replace(/,/g, '.')
    .replace(/\*/g, ' X ')
    .replace(/[^A-Z0-9.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function volumeToLitre(amount, unit) {
  const factor = VOLUME_UNIT_TO_LITRE[unit];
  const value = Number(amount);
  if (!factor || !Number.isFinite(value) || value <= 0) return null;
  return value * factor;
}

/** "6X70CL", "20*50 CL", "12X1L" gibi koli içi toplam hacmi çözer. */
function parsePackVolume(text) {
  const match = /(\d+)\s*[X*]\s*(\d+(?:\.\d+)?)\s*(CL|CK|CC|ML|LT|L)(?![A-Z0-9])/.exec(text);
  if (!match) return null;
  const count = Number(match[1]);
  const litres = volumeToLitre(match[2], match[3]);
  if (!Number.isFinite(count) || count < 2 || count > 200 || litres === null) return null;
  return count * litres;
}

/** "50 CL", "70CL", "1 L", "23,7 CL" gibi birim hacmini çözer. */
function parseUnitVolume(text) {
  const match = /(\d+(?:\.\d+)?)\s*(CL|CK|CC|ML|LT|L)(?![A-Z0-9])/.exec(text);
  if (!match) return null;
  return volumeToLitre(match[1], match[2]);
}

/** "4*6", "12'Lİ", "20'Lİ", "TY*10", "6 ADET" gibi paket adedini çözer. */
function parsePackCount(text) {
  if (/\bM PACK\b/.test(text)) return null;

  const pair = /(\d+)\s*[X*]\s*(\d+)(?!\s*(?:CL|ML|LT|L)\b)/.exec(text);
  if (pair) {
    const count = Number(pair[1]) * Number(pair[2]);
    if (count >= 2 && count <= 60) return count;
  }

  const labelled = /(\d+)\s*(?:LI|LU)\b/.exec(text);
  if (labelled) {
    const count = Number(labelled[1]);
    if (count >= 2 && count <= 60) return count;
  }

  const pieces = /(\d+)\s*ADET\b/.exec(text);
  if (pieces) {
    const count = Number(pieces[1]);
    if (count >= 2 && count <= 60) return count;
  }

  const suffix = /[X*]\s*(\d+)\b/.exec(text);
  if (suffix) {
    const count = Number(suffix[1]);
    if (count >= 2 && count <= 60) return count;
  }

  return null;
}

function isPackagingItem(row = {}) {
  const code = String(row.STOK_KODU || '').trim();
  if (PACKAGING_CODE_RE.test(code)) return true;
  return PACKAGING_NAME_RE.test(normalizeStockText(row.STOK_ADI));
}

/**
 * Birim dönüşümünde LT tanımı yoksa ürün adından litre katsayısı üretir.
 *
 * Örnekler:
 * - "TEK ŞİŞE EP 50 CL" (AD) -> 0,5 Lt
 * - "EP TAVA 50 CL" (TV, 24 adet) -> 12 Lt
 * - "MERCAN RAKI 6*70CL" (KL) -> 4,2 Lt
 * - "EP TAVA 50 CL" (TV, kopya birim oranı 12) -> 12 Lt
 *
 * Ambalaj/malzeme kartları (003/004 kodları, ŞİŞE/KASA/PALET/FIÇI gibi
 * başlayan adlar) litre hesabına katılmaz; bunlar içi boş şişe/kasa/keg
 * stoklarıdır. "TEK ŞİŞE"/"TEK KUTU" ifadeleri gerçek ürün sayılır.
 */
function inferLitreFactorFromName(name, row = {}, unitInfo = {}) {
  const text = normalizeStockText(name);
  if (!text) return null;

  if (isPackagingItem({ STOK_KODU: row.STOK_KODU, STOK_ADI: row.STOK_ADI || name })) return null;

  const packVolume = parsePackVolume(text);
  const unitVolume = parseUnitVolume(text);
  if (packVolume === null && unitVolume === null) return null;

  const primaryUnit = unitInfo.primaryUnit || null;
  const pieceUnit = primaryUnit === 'AD';
  const caseUnit = Boolean(primaryUnit && CASE_UNITS.has(primaryUnit));
  const singleItem = /\bTEK\b/.test(text);

  if (!primaryUnit && !singleItem) return null;
  if (primaryUnit && !pieceUnit && !caseUnit) return null;

  if (packVolume !== null) {
    if (caseUnit) return packVolume;
    if (pieceUnit || !primaryUnit) return unitVolume;
    return null;
  }

  if (!primaryUnit) return singleItem ? unitVolume : null;
  if (pieceUnit || singleItem) return unitVolume;

  const packCount = parsePackCount(text);
  if (packCount) return unitVolume * packCount;

  const adFactor = unitInfo.adFactor;
  if (adFactor && adFactor > 1) return unitVolume * adFactor;
  if (adFactor === 1) return unitVolume;

  const ratio = normalizeRatio(row.PAY_1, row.PAYDA_1);
  if (ratio && ratio > 0 && ratio !== 1) {
    const pieces = ratio / unitVolume;
    if (pieces >= 2 && pieces <= 30 && Math.abs(pieces - Math.round(pieces)) < 0.02) {
      return ratio;
    }
    if (Number.isInteger(ratio) && ratio >= 2 && ratio <= 60) return ratio * unitVolume;
    return ratio * unitVolume;
  }

  return unitVolume;
}

function inferPackFactorFromName(name, row = {}, unitInfo = {}) {
  const primaryUnit = unitInfo.primaryUnit || null;
  if (primaryUnit === 'AD') return 1;
  if (!primaryUnit || !CASE_UNITS.has(primaryUnit)) return null;

  const text = normalizeStockText(name);
  if (!text) return null;
  if (isPackagingItem({ STOK_KODU: row.STOK_KODU, STOK_ADI: row.STOK_ADI || name })) return null;
  if (/\bTEK\b/.test(text)) return 1;

  const packVolume = parsePackVolume(text);
  const unitVolume = parseUnitVolume(text);
  if (packVolume !== null && unitVolume) {
    const pieces = packVolume / unitVolume;
    if (pieces >= 2 && pieces <= 200 && Math.abs(pieces - Math.round(pieces)) < 0.02) {
      return Math.round(pieces);
    }
  }

  const packCount = parsePackCount(text);
  if (packCount && packCount >= 2) return packCount;

  const adFactor = unitInfo.adFactor;
  if (adFactor && adFactor > 1) return adFactor;

  const ratio = normalizeRatio(row.PAY_1, row.PAYDA_1);
  if (ratio && ratio > 1) {
    if (unitVolume) {
      const pieces = ratio / unitVolume;
      if (pieces >= 2 && pieces <= 30 && Math.abs(pieces - Math.round(pieces)) < 0.02) {
        return Math.round(pieces);
      }
    }
    if (Number.isInteger(ratio) && ratio >= 2 && ratio <= 60) return ratio;
  }

  return null;
}

function firstPositivePrice(...values) {
  for (const value of values) {
    const price = nullableNum(value);
    if (price !== null && price > 0) return price;
  }
  return null;
}

function masterPrice(value, fiatBirimi, unitInfo) {
  const price = nullableNum(value);
  if (price === null || price <= 0) return null;
  return price * unitInfo.priceFactor(fiatBirimi);
}

function salesForWindow(row, windowDays) {
  const key = `SATIS_${windowDays}`;
  return row[key] !== undefined ? num(row[key]) : num(row.SATIS_30);
}

function dateOnly(value) {
  const text = String(value || '');
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function searchKey(value) {
  return String(value ?? '')
    .replace(/İ/g, 'i')
    .replace(/I/g, 'ı')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function stockState(stock) {
  if (stock > EPSILON) return 'in';
  if (stock < -EPSILON) return 'negative';
  return 'zero';
}

/**
 * EFES grubundaki 900xxx/EFESxx kodları ile HIZMET BEDELLERİ fiziksel stok
 * değildir; fatura üzerinde maliyet/destek satırı olarak kullanılır. Bu
 * kalemler varsayılan stok listesinden çıkarılır, istenirse dahil edilir.
 */
function isServiceItem(row) {
  const group = String(row.GRUP_KODU || '').trim().toUpperCase();
  const code = String(row.STOK_KODU || '').trim().toUpperCase();
  const name = searchKey(row.STOK_ADI || '');
  return group === 'EFES'
    || code.startsWith('900')
    || code === 'HIZ001'
    || name.startsWith('hizmet');
}

/**
 * FIFO kalan stok yaşı. Partiler en yeniden en eskiye sıralı olmalıdır.
 * En yeni partiler stokta kalır; stoktan fazla olan eski partiler tüketilmiş
 * sayılır. SQL tarafındaki ters kümülatif toplamla aynı mantığı izler.
 */
function calculateRemainingAge(lots, stock, asOf) {
  const remainingStock = num(stock);
  if (remainingStock <= 0 || !Array.isArray(lots) || lots.length === 0) {
    return { averageAgeDays: null, oldestAgeDays: null, remainingQuantity: 0 };
  }

  const asOfTime = Date.parse(`${asOf}T00:00:00Z`);
  let cumulative = 0;
  let weightedAge = 0;
  let oldestAge = null;

  for (const lot of lots) {
    const lotQuantity = Math.abs(num(lot.qty));
    if (lotQuantity <= 0) continue;
    const available = remainingStock - cumulative;
    if (available <= 0) break;

    const lotTime = Date.parse(`${lot.date}T00:00:00Z`);
    const age = Number.isFinite(lotTime) && Number.isFinite(asOfTime)
      ? Math.max(0, Math.round((asOfTime - lotTime) / 86400000))
      : 0;
    const take = Math.min(lotQuantity, available);
    weightedAge += take * age;
    if (oldestAge === null || age > oldestAge) oldestAge = age;
    cumulative += lotQuantity;
  }

  const covered = Math.min(cumulative, remainingStock);
  return {
    averageAgeDays: covered > 0 ? round(weightedAge / covered, 1) : null,
    oldestAgeDays: oldestAge,
    remainingQuantity: covered,
  };
}

function buildStockItem(row, windowDays, override = null) {
  const unitInfo = buildUnitInfo(row);
  const packaging = isPackagingItem(row);
  const manualLitre = nullableNum(override?.litre);
  const hasManualLitre = manualLitre !== null && manualLitre > 0;
  const inferredLtFactor = !hasManualLitre && !packaging && unitInfo.ltFactor === null
    ? inferLitreFactorFromName(row.STOK_ADI, row, unitInfo)
    : null;
  const autoLtFactor = packaging ? null : (unitInfo.ltFactor ?? inferredLtFactor);
  const ltFactor = hasManualLitre ? manualLitre : autoLtFactor;
  const ltSource = hasManualLitre
    ? 'manual'
    : (packaging ? null : (unitInfo.ltFactor !== null ? 'unit' : (inferredLtFactor !== null ? 'name' : null)));
  const packFactor = inferPackFactorFromName(row.STOK_ADI, row, unitInfo);
  const stock = round(num(row.STOK), 3);
  const salesQuantity = round(salesForWindow(row, windowDays), 3);
  const avgDailySales = round(salesQuantity / windowDays, 3);
  const stockDays = avgDailySales > 0 ? round(stock / avgDailySales, 1) : null;

  const purchasePriceRaw = firstPositivePrice(row.SON_ALIS_NF, row.SON_ALIS_BF)
    ?? masterPrice(row.ALIS_FIAT1, row.FIAT_BIRIMI, unitInfo);
  const salePriceRaw = firstPositivePrice(row.SON_SATIS_NF, row.SON_SATIS_BF)
    ?? masterPrice(row.SATIS_FIAT1, row.FIAT_BIRIMI, unitInfo);
  const lastPurchasePrice = purchasePriceRaw === null ? null : round(purchasePriceRaw, 2);
  const lastSalePrice = salePriceRaw === null ? null : round(salePriceRaw, 2);
  const lastSalePriceLt = lastSalePrice !== null && ltFactor
    ? round(lastSalePrice / ltFactor, 2)
    : null;

  const stockLt = ltFactor === null ? null : round(stock * ltFactor, 3);
  const stockAd = unitInfo.adFactor === null ? null : round(stock * unitInfo.adFactor, 3);
  const value = lastPurchasePrice === null ? null : round(stock * lastPurchasePrice, 2);

  return {
    code: String(row.STOK_KODU || '').trim(),
    name: String(row.STOK_ADI || row.STOK_KODU || '').trim(),
    group: String(row.GRUP_KODU || '').trim(),
    service: isServiceItem(row),
    packaging,
    primaryUnit: unitInfo.primaryUnit,
    caseUnit: isCaseUnit(unitInfo.primaryUnit),
    stock,
    stockLt,
    stockAd,
    ltFactor: ltFactor === null ? null : round(ltFactor, 6),
    autoLtFactor: autoLtFactor === null ? null : round(autoLtFactor, 6),
    ltSource,
    ltInferred: ltSource === 'name',
    packFactor,
    manualLitre: hasManualLitre ? round(manualLitre, 6) : null,
    manualInput: hasManualLitre ? String(override?.inputText || '') : null,
    salesQuantity,
    avgDailySales,
    stockDays,
    lastPurchaseDate: dateOnly(row.SON_ALIS_TARIH),
    lastSaleDate: dateOnly(row.SON_SATIS_TARIH),
    lastPurchasePrice,
    lastSalePrice,
    lastSalePriceLt,
    value,
    avgAgeDays: round(nullableNum(row.ORT_STOK_YASI), 1),
    oldestAgeDays: round(nullableNum(row.EN_ESKI_STOK_YASI), 1),
    state: stockState(stock),
  };
}

function summarize(items) {
  let inStockCount = 0;
  let zeroCount = 0;
  let negativeCount = 0;
  let totalLt = 0;
  let hasLt = false;
  let totalAd = 0;
  let hasAd = false;
  let totalValue = 0;
  let hasValue = false;
  let ageWeighted = 0;
  let ageStock = 0;

  for (const item of items) {
    if (item.state === 'in') inStockCount += 1;
    else if (item.state === 'zero') zeroCount += 1;
    else negativeCount += 1;

    if (item.stockLt !== null) {
      totalLt += item.stockLt;
      hasLt = true;
    }
    if (item.stockAd !== null) {
      totalAd += item.stockAd;
      hasAd = true;
    }
    if (item.value !== null) {
      totalValue += item.value;
      hasValue = true;
    }
    if (item.avgAgeDays !== null && item.stock > 0) {
      ageWeighted += item.avgAgeDays * item.stock;
      ageStock += item.stock;
    }
  }

  return {
    productCount: items.length,
    inStockCount,
    zeroCount,
    negativeCount,
    totalLt: hasLt ? round(totalLt, 1) : null,
    totalAd: hasAd ? round(totalAd, 1) : null,
    totalValue: hasValue ? round(totalValue, 2) : null,
    averageAgeDays: ageStock > 0 ? round(ageWeighted / ageStock, 1) : null,
  };
}

function compareValues(left, right, direction) {
  const leftNull = left === null || left === undefined || (typeof left === 'number' && !Number.isFinite(left));
  const rightNull = right === null || right === undefined || (typeof right === 'number' && !Number.isFinite(right));
  if (leftNull && rightNull) return 0;
  if (leftNull) return 1;
  if (rightNull) return -1;

  let comparison;
  if (typeof left === 'string' || typeof right === 'string') {
    comparison = String(left).localeCompare(String(right), 'tr');
  } else {
    comparison = Number(left) - Number(right);
  }
  return direction === 'desc' ? -comparison : comparison;
}

function normalizeOptions(options = {}) {
  const database = String(options.database || '').trim();
  const branch = Number(options.branch);
  if (!Number.isInteger(branch)) {
    throw Object.assign(new Error('Şube kodu geçersiz.'), { status: 400 });
  }

  const asOf = dateOnly(options.asOf) || todayInIstanbul();
  const windowDays = WINDOWS.includes(Number(options.windowDays))
    ? Number(options.windowDays)
    : DEFAULT_WINDOW;
  const state = STATES.includes(String(options.state || ''))
    ? String(options.state)
    : 'in';
  const sort = Object.prototype.hasOwnProperty.call(SORT_KEYS, String(options.sort || ''))
    ? String(options.sort)
    : 'stock';
  const direction = ['asc', 'desc'].includes(String(options.direction || ''))
    ? String(options.direction)
    : (sort === 'code' || sort === 'name' ? 'asc' : 'desc');

  return {
    database,
    branch,
    asOf,
    windowDays,
    state,
    sort,
    direction,
    search: String(options.search || options.q || '').trim(),
    page: Math.max(1, Number.parseInt(options.page, 10) || 1),
    pageSize: Math.max(1, Math.min(200, Number.parseInt(options.pageSize, 10) || 50)),
    all: Boolean(options.all),
    refresh: Boolean(options.refresh),
    includeService: options.includeService === true
      || ['1', 'true', 'yes', 'on', 'dahil'].includes(String(options.includeService ?? '').toLowerCase()),
  };
}

async function loadAggregates({ database, branch, asOf, refresh }) {
  const key = `${database}\u0000${branch}\u0000${asOf}`;
  const now = Date.now();
  const cached = cache.get(key);
  if (!refresh && cached && now - cached.time < CACHE_TTL_MS) {
    return cached.rows;
  }

  if (pending.has(key)) return pending.get(key);

  const promise = getStockAggregates({ database, branch, asOf })
    .then((rows) => {
      cache.set(key, { time: Date.now(), rows });
      for (const [cacheKey, entry] of cache) {
        if (Date.now() - entry.time > CACHE_TTL_MS * 5) cache.delete(cacheKey);
      }
      return rows;
    })
    .finally(() => pending.delete(key));

  pending.set(key, promise);
  return promise;
}

async function listStock(options = {}) {
  const settings = normalizeOptions(options);
  const rows = await loadAggregates(settings);
  const overrides = options.litreOverrides instanceof Map ? options.litreOverrides : new Map();
  const allItems = rows.map((row) => {
    const code = String(row.STOK_KODU || '').trim();
    return buildStockItem(row, settings.windowDays, overrides.get(code) || null);
  });
  const visibleItems = settings.includeService
    ? allItems
    : allItems.filter((item) => !item.service);

  const needle = searchKey(settings.search);
  const searched = needle
    ? visibleItems.filter((item) => searchKey(`${item.code} ${item.name} ${item.group}`).includes(needle))
    : visibleItems;
  const summary = summarize(searched);

  const filtered = settings.state === 'all'
    ? searched.slice()
    : searched.filter((item) => item.state === settings.state);
  const sortGetter = SORT_KEYS[settings.sort] || SORT_KEYS.stock;
  filtered.sort((left, right) => compareValues(sortGetter(left), sortGetter(right), settings.direction));

  const pageSize = settings.all ? Math.max(1, filtered.length) : settings.pageSize;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(settings.page, pageCount);
  const offset = (page - 1) * pageSize;
  const items = settings.all ? filtered : filtered.slice(offset, offset + pageSize);

  return {
    database: settings.database,
    branch: settings.branch,
    asOf: settings.asOf,
    windowDays: settings.windowDays,
    state: settings.state,
    sort: settings.sort,
    direction: settings.direction,
    search: settings.search,
    includeService: settings.includeService,
    page,
    pageSize,
    pageCount,
    filteredCount: filtered.length,
    items,
    summary,
  };
}

async function getStockItem(options = {}) {
  const settings = normalizeOptions({ ...options, state: 'all', all: true });
  const rows = await loadAggregates(settings);
  const code = String(options.code || '').trim();
  const row = rows.find((item) => String(item.STOK_KODU || '').trim() === code);
  if (!row) return null;
  const overrides = options.litreOverrides instanceof Map ? options.litreOverrides : new Map();
  return buildStockItem(row, settings.windowDays, overrides.get(code) || null);
}

function movementInfo(row) {
  const recordType = String(row.STHAR_GCKOD || '').toUpperCase();
  const movementCode = String(row.STHAR_HTUR || '').toUpperCase();
  const signedQuantity = recordType === 'G' ? num(row.STHAR_GCMIK) : -num(row.STHAR_GCMIK);
  const type = `${movementCode}/${recordType}`;
  const price = firstPositivePrice(row.STHAR_NF, row.STHAR_BF);

  return {
    date: dateOnly(row.TARIH_GUN),
    dateTime: row.TARIH_STR || null,
    fisNo: String(row.FISNO || '').trim(),
    type,
    typeLabel: MOVEMENT_LABELS[type] || 'Hareket',
    direction: signedQuantity >= 0 ? 'in' : 'out',
    quantity: round(Math.abs(signedQuantity), 3),
    signedQuantity: round(signedQuantity, 3),
    unitPrice: price === null ? null : round(price, 2),
    cariKod: String(row.CARI_KOD || '').trim(),
    description: String(row.ACIKLAMA || '').trim(),
  };
}

async function getStockMovementHistory({ database, branch, stokKodu, asOf, limit } = {}) {
  const normalizedBranch = Number(branch);
  if (!Number.isInteger(normalizedBranch)) {
    throw Object.assign(new Error('Şube kodu geçersiz.'), { status: 400 });
  }
  const code = String(stokKodu || '').trim();
  if (!code) {
    throw Object.assign(new Error('Stok kodu zorunludur.'), { status: 400 });
  }
  const normalizedAsOf = dateOnly(asOf) || todayInIstanbul();
  const rows = await getStockMovements({
    database: String(database || '').trim(),
    branch: normalizedBranch,
    stokKodu: code,
    asOf: normalizedAsOf,
    limit,
  });
  return {
    code,
    asOf: normalizedAsOf,
    items: rows.map(movementInfo),
  };
}

function invalidateStockCache() {
  cache.clear();
  pending.clear();
}

module.exports = {
  WINDOWS,
  STATES,
  DEFAULT_WINDOW,
  buildUnitInfo,
  buildStockItem,
  calculateRemainingAge,
  inferLitreFactorFromName,
  inferPackFactorFromName,
  isCaseUnit,
  isPackagingItem,
  normalizeStockText,
  parsePackVolume,
  parseUnitVolume,
  parsePackCount,
  isServiceItem,
  summarize,
  listStock,
  getStockItem,
  getStockMovementHistory,
  movementInfo,
  normalizeOptions,
  invalidateStockCache,
  CACHE_TTL_MS,
};
