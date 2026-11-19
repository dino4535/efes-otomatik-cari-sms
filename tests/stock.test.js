'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildUnitInfo,
  buildStockItem,
  calculateRemainingAge,
  inferLitreFactorFromName,
  inferPackFactorFromName,
  isCaseUnit,
  isPackagingItem,
  isServiceItem,
  summarize,
  movementInfo,
  normalizeOptions,
  WINDOWS,
} = require('../src/services/stock');
const { parseLitreInput } = require('../src/services/stockLitreParser');
const { buildStockWorkbook } = require('../src/services/stockExcel');

function row(overrides = {}) {
  return {
    STOK_KODU: '150021',
    STOK_ADI: 'EP TAVA 50 CL',
    GRUP_KODU: '01',
    OLCU_BR1: 'KL',
    OLCU_BR2: 'AD',
    OLCU_BR3: 'LT',
    PAY_1: 24,
    PAYDA_1: 1,
    PAY2: 12,
    PAYDA2: 1,
    FIAT_BIRIMI: '1',
    SATIS_FIAT1: 1678.8,
    ALIS_FIAT1: 1574.4,
    STOK: 10,
    SATIS_30: 300,
    SATIS_60: 600,
    SATIS_90: 900,
    SATIS_180: 1800,
    SATIS_365: 3600,
    SON_ALIS_TARIH: '2026-11-01',
    SON_SATIS_TARIH: '2026-11-18',
    SON_ALIS_NF: 2000,
    SON_ALIS_BF: 1900,
    SON_SATIS_NF: 2208,
    SON_SATIS_BF: 2100,
    ORT_STOK_YASI: 2.54,
    EN_ESKI_STOK_YASI: 3,
    ...overrides,
  };
}

test('birim dönüşümü koli/adet ve koli/litre katsayılarını çözer', () => {
  const dino = buildUnitInfo(row());
  assert.equal(dino.primaryUnit, 'KL');
  assert.equal(dino.adFactor, 24);
  assert.equal(dino.ltFactor, 12);

  const bermer = buildUnitInfo(row({ PAY_1: 1, PAYDA_1: 24, PAY2: 1, PAYDA2: 12 }));
  assert.equal(bermer.adFactor, 24);
  assert.equal(bermer.ltFactor, 12);

  const direct = buildUnitInfo(row({
    OLCU_BR1: 'AD',
    OLCU_BR2: 'LT',
    OLCU_BR3: null,
    PAY_1: 0.5,
    PAYDA_1: 1,
  }));
  assert.equal(direct.ltFactor, 0.5);
  assert.equal(direct.adFactor, 1);
});

test('birim LT tanımı yoksa ürün adından litre katsayısı çıkarır', () => {
  const ad = { primaryUnit: 'AD', adFactor: 1 };
  const kl = { primaryUnit: 'KL', adFactor: 1 };
  const tv24 = { primaryUnit: 'TV', adFactor: 24 };
  const tvRatio = { primaryUnit: 'TV', adFactor: null };
  const noUnit = { primaryUnit: null, adFactor: null };

  assert.equal(inferLitreFactorFromName('TEK ŞİŞE EP 50 CL', { STOK_KODU: '225030' }, ad), 0.5);
  assert.equal(inferLitreFactorFromName('TEK KUTU XT 23,7 CL', { STOK_KODU: '225887' }, ad), 0.237);
  assert.equal(inferLitreFactorFromName('EP TAVA 50 CL', { STOK_KODU: '150021' }, tv24), 12);
  assert.equal(inferLitreFactorFromName(
    'EP TAVA 50 CL',
    { STOK_KODU: '150021', PAY_1: 12, PAYDA_1: 1 },
    tvRatio,
  ), 12);
  assert.equal(inferLitreFactorFromName(
    'MGD KOLI 33 CL',
    { STOK_KODU: '150137', PAY_1: 7.92, PAYDA_1: 1 },
    { primaryUnit: 'KL', adFactor: null },
  ), 7.92);
  assert.equal(inferLitreFactorFromName(
    'MERCAN RAKI 6*70CL %45',
    { STOK_KODU: '152751' },
    { primaryUnit: 'KL', adFactor: null },
  ), 4.2);
  assert.equal(inferLitreFactorFromName(
    'EFES PILSEN GREEN KLI 20*50 CL NRB PSL',
    { STOK_KODU: '152422' },
    { primaryUnit: 'KL', adFactor: 20 },
  ), 10);
  assert.equal(inferLitreFactorFromName(
    'EFES PİLSEN KL 50 CK RB 4*4',
    { STOK_KODU: '152631' },
    { primaryUnit: 'KL', adFactor: 16 },
  ), 8);
  assert.equal(inferLitreFactorFromName(
    "GRANT'S TRIPLE WOOD 12X1L %40",
    { STOK_KODU: '152222' },
    { primaryUnit: 'KL', adFactor: null },
  ), 12);
  assert.equal(inferLitreFactorFromName(
    'STELLA ARTOIS 50CL KUTU 4*4 MP KARTON',
    { STOK_KODU: '152735' },
    kl,
  ), 8);
  assert.equal(inferLitreFactorFromName(
    'TEK ŞİŞE EP 50 CL',
    { STOK_KODU: '225826' },
    { primaryUnit: 'KL', adFactor: 30 },
  ), 0.5);
  assert.equal(inferLitreFactorFromName('TEK KUTU STELLA ARTOIS 50 CL', { STOK_KODU: '226931' }, noUnit), 0.5);
  assert.equal(inferLitreFactorFromName('FICI SEYYAR KURULUM', { STOK_KODU: '000201' }, noUnit), null);
});

test('koli/tava paket adedini ürün adı ve birim oranından çıkarır', () => {
  assert.equal(isCaseUnit('KL'), true);
  assert.equal(isCaseUnit('AD'), false);

  assert.equal(inferPackFactorFromName(
    'EP TAVA 50 CL',
    { STOK_KODU: '150021' },
    { primaryUnit: 'TV', adFactor: 24 },
  ), 24);
  assert.equal(inferPackFactorFromName(
    'EP TAVA 50 CL',
    { STOK_KODU: '150021', PAY_1: 12, PAYDA_1: 1 },
    { primaryUnit: 'TV', adFactor: null },
  ), 24);
  assert.equal(inferPackFactorFromName(
    'MERCAN RAKI 6*70CL %45',
    { STOK_KODU: '152751' },
    { primaryUnit: 'KL', adFactor: null },
  ), 6);
  assert.equal(inferPackFactorFromName(
    'TEK ŞİŞE EP 50 CL',
    { STOK_KODU: '225030' },
    { primaryUnit: 'KL', adFactor: 30 },
  ), 1);
});

test('manuel litre girişi düz sayı, şişe hacmi ve koli çarpanını çözer', () => {
  assert.deepEqual(
    parseLitreInput('12', { isCaseUnit: true, packFactor: 24 }),
    { ok: true, litre: 12, inputText: '12', mode: 'unit' },
  );
  assert.deepEqual(
    parseLitreInput('50 CL', { isCaseUnit: true, packFactor: 24 }),
    { ok: true, litre: 12, inputText: '50 CL', mode: 'piece' },
  );
  assert.deepEqual(
    parseLitreInput('50cl', { isCaseUnit: false }),
    { ok: true, litre: 0.5, inputText: '50cl', mode: 'unit' },
  );
  assert.deepEqual(
    parseLitreInput('23,7 CL', { isCaseUnit: false }),
    { ok: true, litre: 0.237, inputText: '23,7 CL', mode: 'unit' },
  );
  assert.deepEqual(
    parseLitreInput('1 LT', { isCaseUnit: true, packFactor: 24 }),
    { ok: true, litre: 1, inputText: '1 LT', mode: 'unit' },
  );
  assert.equal(parseLitreInput('50 CL', { isCaseUnit: true, packFactor: null }).ok, false);
  assert.equal(parseLitreInput('abc').ok, false);
  assert.equal(parseLitreInput('0').ok, false);
});

test('manuel litre tanımı birim ve ürün adı hesabından önce kullanılır', () => {
  const auto = buildStockItem(row(), 30);
  assert.equal(auto.stockLt, 120);
  assert.equal(auto.ltSource, 'unit');
  assert.equal(auto.autoLtFactor, 12);

  const manual = buildStockItem(row(), 30, { litre: 6, inputText: '6' });
  assert.equal(manual.stockLt, 60);
  assert.equal(manual.ltFactor, 6);
  assert.equal(manual.autoLtFactor, 12);
  assert.equal(manual.ltSource, 'manual');
  assert.equal(manual.manualLitre, 6);
  assert.equal(manual.manualInput, '6');
  assert.equal(manual.ltInferred, false);

  const packaging = buildStockItem(row({
    STOK_KODU: '003019',
    STOK_ADI: 'SISE 50 CL STEINIE',
    OLCU_BR1: 'AD',
    OLCU_BR2: null,
    OLCU_BR3: null,
    STOK: 100,
  }), 30, { litre: 0.36, inputText: '0,36' });
  assert.equal(packaging.stockLt, 36);
  assert.equal(packaging.ltSource, 'manual');
});

test('ambalaj ve malzeme kartları ürün adındaki hacimden litre kazanmaz', () => {  assert.equal(isPackagingItem({ STOK_KODU: '003091', STOK_ADI: 'ŞİŞE 50 CL EFES YENİ RB GRAVÜRSÜZ' }), true);
  assert.equal(isPackagingItem({ STOK_KODU: '601759', STOK_ADI: 'BARDAK EP 50 CL KADEH' }), true);
  assert.equal(isPackagingItem({ STOK_KODU: '225030', STOK_ADI: 'TEK ŞİŞE EP 50 CL' }), false);

  assert.equal(inferLitreFactorFromName(
    'ŞİŞE 50 CL EFES YENİ RB GRAVÜRSÜZ',
    { STOK_KODU: '003091' },
    { primaryUnit: 'AD', adFactor: 1 },
  ), null);
  assert.equal(inferLitreFactorFromName(
    'BARDAK EP 50 CL KADEH',
    { STOK_KODU: '601759' },
    { primaryUnit: 'KL', adFactor: 1 },
  ), null);
  assert.equal(inferLitreFactorFromName(
    'FICI EP 50 L (DEPOZITOLU)',
    { STOK_KODU: '003006' },
    { primaryUnit: 'AD', adFactor: 1 },
  ), null);
  assert.equal(inferLitreFactorFromName(
    'KASA EFES MALT 50 CL',
    { STOK_KODU: '003063' },
    { primaryUnit: 'AD', adFactor: 1 },
  ), null);

  // Ambalaj kartında birim dönüşümü tanımlı olsa bile litre üretilmez.
  const bottle = buildStockItem(row({
    STOK_KODU: '003019',
    STOK_ADI: 'SISE 50 CL STEINIE',
    OLCU_BR1: 'AD',
    OLCU_BR2: 'LT',
    OLCU_BR3: null,
    PAY_1: 0.36,
    PAYDA_1: 1,
    STOK: 100,
    SATIS_30: 0,
    ORT_STOK_YASI: null,
    EN_ESKI_STOK_YASI: null,
  }), 30);
  assert.equal(bottle.stockLt, null);
  assert.equal(bottle.stockAd, 100);
  assert.equal(bottle.ltInferred, false);
  assert.equal(bottle.packaging, true);
});

test('adından litre çıkarılan ürün stok ve litre fiyatını hesaplar', () => {
  const item = buildStockItem(row({
    STOK_KODU: '225030',
    STOK_ADI: 'TEK ŞİŞE EP 50 CL',
    OLCU_BR1: 'AD',
    OLCU_BR2: null,
    OLCU_BR3: null,
    PAY_1: 1,
    PAYDA_1: 1,
    STOK: 10,
    SATIS_30: 0,
    SON_SATIS_NF: 120,
    ORT_STOK_YASI: null,
    EN_ESKI_STOK_YASI: null,
  }), 30);

  assert.equal(item.stockLt, 5);
  assert.equal(item.ltInferred, true);
  assert.equal(item.lastSalePriceLt, 240);
  assert.equal(buildStockItem(row(), 30).ltInferred, false);
});

test('stok kalemi litre/adet, satış hızı, stok günü ve fiyatları hesaplar', () => {
  const item = buildStockItem(row(), 30);

  assert.equal(item.code, '150021');
  assert.equal(item.stock, 10);
  assert.equal(item.stockLt, 120);
  assert.equal(item.stockAd, 240);
  assert.equal(item.salesQuantity, 300);
  assert.equal(item.avgDailySales, 10);
  assert.equal(item.stockDays, 1);
  assert.equal(item.lastPurchasePrice, 2000);
  assert.equal(item.lastSalePrice, 2208);
  assert.equal(item.lastSalePriceLt, 184);
  assert.equal(item.value, 20000);
  assert.equal(item.avgAgeDays, 2.5);
  assert.equal(item.oldestAgeDays, 3);
  assert.equal(item.state, 'in');
});

test('fiyat NF yoksa BF, hareket fiyatı yoksa master fiyatı kullanır', () => {
  const fallback = buildStockItem(row({
    SON_ALIS_NF: 0,
    SON_ALIS_BF: 1800,
    SON_SATIS_NF: null,
    SON_SATIS_BF: 2400,
  }), 30);
  assert.equal(fallback.lastPurchasePrice, 1800);
  assert.equal(fallback.lastSalePrice, 2400);
  assert.equal(fallback.lastSalePriceLt, 200);

  const master = buildStockItem(row({
    SON_ALIS_NF: 0,
    SON_ALIS_BF: 0,
    SON_SATIS_NF: 0,
    SON_SATIS_BF: 0,
    FIAT_BIRIMI: '2',
    ALIS_FIAT1: 5,
    SATIS_FIAT1: 6,
  }), 30);
  assert.equal(master.lastPurchasePrice, 120);
  assert.equal(master.lastSalePrice, 144);
});

test('satış penceresi ortalama ve stok gününü değiştirir', () => {
  const monthly = buildStockItem(row(), 30);
  const yearly = buildStockItem(row(), 365);
  assert.equal(monthly.avgDailySales, 10);
  assert.equal(monthly.stockDays, 1);
  assert.equal(yearly.avgDailySales, 9.863);
  assert.equal(yearly.stockDays, 1);

  const noSales = buildStockItem(row({ SATIS_30: 0 }), 30);
  assert.equal(noSales.avgDailySales, 0);
  assert.equal(noSales.stockDays, null);

  const zeroStock = buildStockItem(row({ STOK: 0 }), 30);
  assert.equal(zeroStock.state, 'zero');
  assert.equal(zeroStock.stockLt, 0);

  const negative = buildStockItem(row({ STOK: -3 }), 30);
  assert.equal(negative.state, 'negative');
  assert.equal(negative.stockLt, -36);
});

test('FIFO kalan stok yaşı en yeni partileri stokta bırakır', () => {
  const lots = [
    { date: '2026-11-15', qty: 40 },
    { date: '2026-11-10', qty: 40 },
    { date: '2026-11-01', qty: 40 },
  ];

  const partial = calculateRemainingAge(lots, 60, '2026-11-20');
  assert.equal(partial.remainingQuantity, 60);
  assert.equal(partial.averageAgeDays, 6.7);
  assert.equal(partial.oldestAgeDays, 10);

  const all = calculateRemainingAge(lots, 120, '2026-11-20');
  assert.equal(all.averageAgeDays, 11.3);
  assert.equal(all.oldestAgeDays, 19);

  const empty = calculateRemainingAge(lots, 0, '2026-11-20');
  assert.equal(empty.averageAgeDays, null);
  assert.equal(empty.oldestAgeDays, null);
  assert.equal(empty.remainingQuantity, 0);
});

test('EFES/hizmet kodları fiziksel stok kalemi sayılmaz', () => {
  assert.equal(isServiceItem(row({ GRUP_KODU: 'EFES', STOK_KODU: '900300', STOK_ADI: 'İşletme Katkı Payı' })), true);
  assert.equal(isServiceItem(row({ GRUP_KODU: null, STOK_KODU: 'HIZ001', STOK_ADI: 'HIZMET BEDELLERİ' })), true);
  assert.equal(isServiceItem(row({ GRUP_KODU: null, STOK_KODU: '900325', STOK_ADI: 'Lojistik Payınız' })), true);
  assert.equal(buildStockItem(row({ GRUP_KODU: 'EFES', STOK_KODU: 'EFES28' }), 30).service, true);
  assert.equal(buildStockItem(row(), 30).service, false);
});

test('özet stoklu, sıfır ve negatif ürünleri toplar', () => {
  const items = [
    { state: 'in', stock: 10, stockLt: 100, stockAd: 200, value: 1000, avgAgeDays: 10 },
    { state: 'zero', stock: 0, stockLt: 0, stockAd: 0, value: 0, avgAgeDays: null },
    { state: 'negative', stock: -1, stockLt: -5, stockAd: -10, value: -50, avgAgeDays: null },
  ];

  const summary = summarize(items);
  assert.equal(summary.productCount, 3);
  assert.equal(summary.inStockCount, 1);
  assert.equal(summary.zeroCount, 1);
  assert.equal(summary.negativeCount, 1);
  assert.equal(summary.totalLt, 95);
  assert.equal(summary.totalAd, 190);
  assert.equal(summary.totalValue, 950);
  assert.equal(summary.averageAgeDays, 10);
});

test('sorgu seçenekleri güvenli varsayılanlara ve sınırlara oturur', () => {
  const defaults = normalizeOptions({ database: 'DINO2026', branch: 6 });
  assert.equal(defaults.windowDays, 30);
  assert.equal(defaults.state, 'in');
  assert.equal(defaults.sort, 'stock');
  assert.equal(defaults.direction, 'desc');
  assert.equal(defaults.page, 1);
  assert.equal(defaults.pageSize, 50);
  assert.equal(defaults.includeService, false);

  const invalid = normalizeOptions({
    database: 'DINO2026',
    branch: 6,
    windowDays: 45,
    state: 'wrong',
    sort: 'wrong',
    direction: 'wrong',
    page: 0,
    pageSize: 500,
  });
  assert.equal(invalid.windowDays, 30);
  assert.equal(invalid.state, 'in');
  assert.equal(invalid.sort, 'stock');
  assert.equal(invalid.direction, 'desc');
  assert.equal(invalid.page, 1);
  assert.equal(invalid.pageSize, 200);

  const selected = normalizeOptions({
    database: 'BERMER2026',
    branch: 0,
    windowDays: 365,
    state: 'all',
    sort: 'name',
    direction: 'asc',
    page: 3,
    pageSize: 25,
  });
  assert.equal(selected.windowDays, 365);
  assert.equal(selected.state, 'all');
  assert.equal(selected.sort, 'name');
  assert.equal(selected.direction, 'asc');
  assert.equal(selected.page, 3);
  assert.equal(selected.pageSize, 25);
  const withServices = normalizeOptions({ database: 'DINO2026', branch: 6, includeService: true });
  assert.equal(withServices.includeService, true);
  assert.deepEqual(WINDOWS, [30, 60, 90, 180, 365]);
});

test('stok hareketi tür, yön ve birim fiyatı etiketler', () => {
  const sale = movementInfo({
    TARIH_GUN: '2026-11-18',
    TARIH_STR: '2026-11-18 10:00:00',
    FISNO: 'F1',
    STHAR_HTUR: 'J',
    STHAR_GCKOD: 'C',
    STHAR_GCMIK: 3,
    STHAR_BF: 2200,
    STHAR_NF: 2208,
    CARI_KOD: 'C1',
    ACIKLAMA: 'Satış',
  });
  assert.equal(sale.type, 'J/C');
  assert.equal(sale.typeLabel, 'Satış');
  assert.equal(sale.direction, 'out');
  assert.equal(sale.quantity, 3);
  assert.equal(sale.signedQuantity, -3);
  assert.equal(sale.unitPrice, 2208);

  const purchaseReturn = movementInfo({
    TARIH_GUN: '2026-11-19',
    FISNO: 'F2',
    STHAR_HTUR: 'L',
    STHAR_GCKOD: 'C',
    STHAR_GCMIK: 5,
    STHAR_NF: 0,
    STHAR_BF: 1000,
  });
  assert.equal(purchaseReturn.typeLabel, 'Alış İadesi');
  assert.equal(purchaseReturn.direction, 'out');
  assert.equal(purchaseReturn.unitPrice, 1000);
});

function workbookData(items, summary = {}) {
  return {
    database: 'DINO2026',
    branch: 6,
    asOf: '2026-11-19',
    windowDays: 30,
    state: 'in',
    includeService: false,
    search: '',
    items,
    summary: {
      productCount: items.length,
      inStockCount: items.length,
      zeroCount: 0,
      negativeCount: 0,
      totalLt: 120,
      totalAd: 240,
      totalValue: 20000,
      averageAgeDays: 2.5,
      ...summary,
    },
  };
}

test('stok Excel çalışma kitabı başlık, veri ve toplam satırlarını yazar', () => {
  const item = buildStockItem(row(), 30);
  const second = buildStockItem(row({
    STOK_KODU: '225030',
    STOK_ADI: 'TEK ŞİŞE EP 50 CL',
    OLCU_BR1: 'AD',
    OLCU_BR2: 'LT',
    OLCU_BR3: null,
    PAY_1: 0.5,
    PAYDA_1: 1,
    STOK: 20,
    SATIS_30: 30,
    SON_ALIS_NF: 100,
    SON_SATIS_NF: 120,
    ORT_STOK_YASI: null,
    EN_ESKI_STOK_YASI: null,
  }), 30);

  const workbook = buildStockWorkbook(workbookData([item, second]));
  const worksheet = workbook.getWorksheet('Stok Durumu');

  assert.equal(worksheet.getCell('A1').value, 'Stok Durumu');
  assert.match(String(worksheet.getCell('A2').value), /Hizmet Kalemleri: Hariç/);
  assert.equal(worksheet.getRow(6).getCell(1).value, 'Stok Kodu');
  assert.equal(worksheet.getRow(6).getCell(6).value, 'Stok (Lt)');
  assert.equal(worksheet.getRow(7).getCell(1).value, '150021');
  assert.equal(worksheet.getRow(7).getCell(5).value, 10);
  assert.equal(worksheet.getRow(7).getCell(6).value, 120);
  assert.equal(worksheet.getRow(7).getCell(7).value, 240);
  assert.ok(worksheet.getRow(7).getCell(8).value instanceof Date);
  assert.equal(worksheet.getRow(7).getCell(8).value.toISOString().slice(0, 10), '2026-11-01');
  assert.equal(worksheet.getRow(7).getCell(11).value.toISOString().slice(0, 10), '2026-11-18');
  assert.equal(worksheet.getRow(8).getCell(1).value, '225030');
  assert.equal(worksheet.getRow(8).getCell(18).value, 'Stokta');
  assert.match(String(worksheet.getCell('A9').value), /Toplam/);
  assert.equal(worksheet.getCell('F9').value, 120);
  assert.equal(worksheet.getCell('G9').value, 240);
  assert.equal(worksheet.getCell('J9').value, 20000);
});

test('boş stok listesi için Excel üretimi hata vermez', () => {
  const workbook = buildStockWorkbook(workbookData([], {
    productCount: 0,
    inStockCount: 0,
    totalLt: null,
    totalAd: null,
    totalValue: null,
    averageAgeDays: null,
  }));
  const worksheet = workbook.getWorksheet('Stok Durumu');
  assert.equal(worksheet.getRow(6).getCell(1).value, 'Stok Kodu');
  assert.match(String(worksheet.getCell('A7').value), /Toplam/);
});
