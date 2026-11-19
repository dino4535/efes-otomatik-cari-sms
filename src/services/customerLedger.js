'use strict';

const config = require('../config');
const { getSetting, getSettingNumber } = require('../db/sqlite');
const {
  getDealerBalances,
  getDealerRecord,
  getStatementMovements,
  getInvoiceLines,
  getCustomerMovementsUntil,
  getStatementOpeningBalance,
  getCustomerBalance,
} = require('../db/erp');
const { computeCustomer } = require('./aging');
const {
  COLLECTION_TYPES,
  CREDIT_CARD_LABEL,
  isCreditCardCollection,
} = require('./paymentClassification');
const { normalizePhone } = require('../utils/phone');
const { todayInIstanbul, isValidDateOnly, dayDiff } = require('../utils/dates');

const TYPE_LABELS = {
  A: 'Devir',
  B: 'Fatura',
  BI: 'İskonto Faturası',
  BK: 'İşletme Katkı Payı',
  C: 'İade Fatura',
  D: 'Tahsilat',
  E: 'Düzeltme',
  G: 'Çek',
  H: 'Çek Ödemesi',
  K: 'Havale / FAST',
  CC: CREDIT_CARD_LABEL,
};

const TYPE_ORDER = ['B', 'BI', 'BK', 'C', 'D', 'CC', 'G', 'H', 'K', 'E', 'A'];

const INVOICE_KIND_DISCOUNT = Object.freeze({ key: 'BI', label: TYPE_LABELS.BI });
const INVOICE_KIND_CONTRIBUTION = Object.freeze({ key: 'BK', label: TYPE_LABELS.BK });

const PAYMENT_STATUS_LABELS = {
  paid: 'Ödendi',
  partial: 'Kısmi',
  open: 'Açık',
};

const BALANCE_CACHE_TTL_MS = 30 * 1000;
const MAX_BALANCE_CACHE = 12;
const balanceCache = new Map();

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function toBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function toCents(value) {
  return Math.round(Number(value || 0) * 100);
}

function centsToTl(cents) {
  return Math.round(Number(cents || 0)) / 100;
}

function typeLabel(type) {
  return TYPE_LABELS[type] || type || 'Hareket';
}

function paymentStatusLabel(status) {
  return PAYMENT_STATUS_LABELS[status] || '';
}

const INVOICE_TYPES = new Set(['B', 'C']);
const MS_PER_DAY = 86400000;

function dateOnlyDay(value) {
  if (!isValidDateOnly(value)) return null;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) ? Math.round(parsed / MS_PER_DAY) : null;
}

function dayToDateOnly(value) {
  if (!Number.isFinite(value)) return null;
  return new Date(Math.round(value) * MS_PER_DAY).toISOString().slice(0, 10);
}

function roundDays(value) {
  return Number.isFinite(value) ? Math.round(value * 10) / 10 : null;
}

function typeOrder(key) {
  const index = TYPE_ORDER.indexOf(key);
  return index === -1 ? TYPE_ORDER.length : index;
}

/**
 * Kredi kartı tahsilatları paymentClassification modülünde sınıflandırılır;
 * burada yalnızca ekstre türüne dönüştürülür.
 */
function movementTypeInfo(movement = {}, invoiceKinds = null) {
  const type = movement.HAREKET_TURU || '';
  if (INVOICE_TYPES.has(type)) {
    const kind = lookupInvoiceKind(invoiceKinds, movement.BELGE_NO);
    if (kind) return { key: kind.key, label: kind.label };
  }
  if (isCreditCardCollection(movement)) {
    return { key: 'CC', label: TYPE_LABELS.CC };
  }
  return { key: type || '?', label: typeLabel(type) };
}

function normalizeInvoiceLineName(value) {
  return String(value || '')
    .toLocaleUpperCase('tr-TR')
    .replace(/İ/g, 'I')
    .replace(/Ş/g, 'S')
    .replace(/Ğ/g, 'G')
    .replace(/Ü/g, 'U')
    .replace(/Ö/g, 'O')
    .replace(/Ç/g, 'C')
    .replace(/\s+/g, ' ')
    .trim();
}

function isDiscountLine(name) {
  return normalizeInvoiceLineName(name).includes('ISKONTO');
}

function isContributionLine(name) {
  const normalized = normalizeInvoiceLineName(name);
  return normalized.includes('ISLETME KATKI') || normalized.includes('KATKI PAYI');
}

/**
 * Faturanın tüm kalemleri aynı özel türdeyse alt türü döndürür.
 * İskonto/katkı kalemi içeren normal faturalar "Fatura" olarak kalır.
 */
function classifyInvoiceLineNames(names = []) {
  if (!Array.isArray(names) || names.length === 0) return null;
  let allDiscount = true;
  let allContribution = true;
  for (const name of names) {
    if (!isDiscountLine(name)) allDiscount = false;
    if (!isContributionLine(name)) allContribution = false;
    if (!allDiscount && !allContribution) return null;
  }
  if (allDiscount) return INVOICE_KIND_DISCOUNT;
  if (allContribution) return INVOICE_KIND_CONTRIBUTION;
  return null;
}

/**
 * TBLSTHAR satırlarını FISNO bazında gruplar; yalnızca özel alt türü olan
 * faturaları Map<BELGE_NO, { key, label }> olarak döndürür. Cari kodu verilirse
 * farklı cariye ait satırlar (ortak GIB FISNO'ları) hesaba katılmaz.
 */
function buildInvoiceKinds(lines = [], cariKod = null) {
  const expectedCari = String(cariKod || '').trim();
  const byInvoice = new Map();
  for (const line of lines) {
    const fisno = String(line?.FISNO || '').trim();
    if (!fisno) continue;
    const lineCari = String(line?.STHAR_CARIKOD || '').trim();
    if (expectedCari && lineCari && lineCari !== expectedCari) continue;
    const names = byInvoice.get(fisno) || [];
    names.push(line.STOK_ADI || '');
    byInvoice.set(fisno, names);
  }

  const kinds = new Map();
  for (const [fisno, names] of byInvoice) {
    const kind = classifyInvoiceLineNames(names);
    if (kind) kinds.set(fisno, kind);
  }
  return kinds;
}

function lookupInvoiceKind(invoiceKinds, belgeNo) {
  if (!invoiceKinds) return null;
  const key = String(belgeNo || '').trim();
  if (!key) return null;
  if (invoiceKinds instanceof Map) return invoiceKinds.get(key) || null;
  return invoiceKinds[key] || null;
}

/**
 * Basit mevduat faizi karşılığı: anapara × yıllık oran × gün / 365.
 * Tüm tutarlar kuruş, oran yüzde (örn. 45) cinsindendir.
 */
function depositInterestCents(baseCents, annualRate, days) {
  const base = Number(baseCents || 0);
  const rate = Number(annualRate || 0);
  const dayCount = Number(days || 0);
  if (!(base > 0) || !(rate > 0) || !(dayCount > 0)) return 0;
  return Math.round(base * (rate / 100) * (dayCount / 365));
}

/**
 * Fatura tahsilatlarını yaşlandırma motoruyla aynı kurallarla eşleştirir:
 * aynı gün birebir çiftler önce kapanır, kalan tahsilatlar en eski borca FIFO uygulanır.
 * Dönen Map anahtarı INC_KEY_NUMBER'dır.
 */
function buildInvoicePayments({ movements = [], asOf = null } = {}) {
  const invoiceMap = new Map();
  for (const movement of movements) {
    const netCents = Math.round(
      (Number(movement.BORC || 0) - Number(movement.ALACAK || 0)) * 100,
    );
    if (netCents <= 0) continue;
    const type = movement.HAREKET_TURU || '';
    if (!INVOICE_TYPES.has(type)) continue;
    const id = Number(movement.INC_KEY_NUMBER || 0);
    invoiceMap.set(id, {
      amountCents: netCents,
      vade: movement.VADE_GUN || null,
    });
  }
  if (!invoiceMap.size) return new Map();

  const reportDate = isValidDateOnly(asOf) ? asOf : todayInIstanbul();
  const computed = computeCustomer({
    customer: { CARI_KOD: '' },
    movements,
    asOf: reportDate,
    toleranceCents: 0,
    includePrepaid: false,
  });

  const paidMap = new Map();
  for (const id of invoiceMap.keys()) {
    paidMap.set(id, { paidCents: 0, lastPaymentDate: null });
  }
  for (const match of computed.matches || []) {
    const id = Number(match.debit?.id || 0);
    const payment = paidMap.get(id);
    if (!payment) continue;
    payment.paidCents += Number(match.amountCents || 0);
    const date = match.credit?.effectiveDate || match.credit?.date;
    if (isValidDateOnly(date) && (!payment.lastPaymentDate || date > payment.lastPaymentDate)) {
      payment.lastPaymentDate = date;
    }
  }

  const result = new Map();
  for (const [id, invoice] of invoiceMap) {
    const payment = paidMap.get(id);
    const remainingCents = Math.max(0, invoice.amountCents - payment.paidCents);
    const status = remainingCents === 0
      ? 'paid'
      : (payment.paidCents > 0 ? 'partial' : 'open');
    const paymentDelayDays = payment.lastPaymentDate && invoice.vade
      ? Math.max(0, dayDiff(payment.lastPaymentDate, invoice.vade))
      : null;

    result.set(id, {
      status,
      paidCents: payment.paidCents,
      remainingCents,
      paidDate: payment.lastPaymentDate,
      paymentDelayDays,
    });
  }
  return result;
}

function resolveScope(options = {}) {
  const database = String(
    options.database ?? getSetting('erp.database', config.erp.database) ?? '',
  ).trim();
  const branchRaw = options.branch ?? getSettingNumber('app.branch', config.branch);
  const branch = Number(branchRaw);
  const customerType = String(
    options.customerType ?? getSetting('aging.customer_type', 'A') ?? 'A',
  ).slice(0, 1);
  return {
    database,
    branch: Number.isFinite(branch) ? branch : 0,
    customerType,
  };
}

function invalidateLedgerCache() {
  balanceCache.clear();
}

async function loadDealerRows({ database, branch, customerType, refresh = false }) {
  const key = `${database}|${branch}|${customerType}`;
  const cached = balanceCache.get(key);
  if (!refresh && cached && Date.now() - cached.createdAt < BALANCE_CACHE_TTL_MS) {
    return cached.rows;
  }
  const rows = await getDealerBalances({ branch, customerType, database });
  balanceCache.set(key, { createdAt: Date.now(), rows });
  if (balanceCache.size > MAX_BALANCE_CACHE) {
    const oldestKey = balanceCache.keys().next().value;
    if (oldestKey !== key) balanceCache.delete(oldestKey);
  }
  return rows;
}

function mapDealer(row, today) {
  const rawPhone = row.CARI_TEL || row.GSM1 || row.GSM2 || null;
  const balanceCents = toCents(row.TOPLAM_BORC) - toCents(row.TOPLAM_ALACAK);
  const lastMovement = row.SON_HAREKET_GUN || null;
  const lastDays = lastMovement ? dayDiff(today, lastMovement) : null;
  return {
    cariKod: row.CARI_KOD,
    cariIsim: row.CARI_ISIM || row.CARI_KOD,
    phone: normalizePhone(rawPhone),
    rawPhone,
    city: row.CARI_IL || null,
    district: row.CARI_ILCE || null,
    balanceCents,
    movementCount: Number(row.HAREKET_SAYISI || 0),
    lastMovement,
    lastMovementDays: lastDays === null ? null : Math.max(0, lastDays),
  };
}

function toPublicDealer(dealer) {
  return {
    cariKod: dealer.cariKod,
    cariIsim: dealer.cariIsim,
    phone: dealer.phone,
    rawPhone: dealer.rawPhone,
    city: dealer.city,
    district: dealer.district,
    balance: centsToTl(dealer.balanceCents),
    movementCount: dealer.movementCount,
    lastMovement: dealer.lastMovement,
    lastMovementDays: dealer.lastMovementDays,
  };
}

function normalizeSearch(value) {
  return String(value || '').trim().toLocaleLowerCase('tr');
}

function searchDigits(value) {
  return String(value || '').replace(/\D+/g, '');
}

function matchesSearch(dealer, needle, digits) {
  if (!needle) return true;
  if (dealer.cariKod.toLocaleLowerCase('tr').includes(needle)) return true;
  if (dealer.cariIsim.toLocaleLowerCase('tr').includes(needle)) return true;
  if (digits && searchDigits(dealer.phone).includes(digits)) return true;
  return false;
}

async function listDealers(options = {}) {
  const scope = resolveScope(options);
  const today = todayInIstanbul();
  const search = normalizeSearch(options.search);
  const digits = searchDigits(search);
  const pageSize = Math.min(200, Math.max(10, Number.parseInt(options.pageSize, 10) || 40));
  const requestedPage = Math.max(1, Number.parseInt(options.page, 10) || 1);
  const onlyWithBalance = toBoolean(options.onlyWithBalance, false);

  const rows = await loadDealerRows({
    ...scope,
    refresh: toBoolean(options.refresh, false),
  });
  const dealers = rows.map((row) => mapDealer(row, today));

  const filtered = dealers.filter((dealer) => {
    if (!matchesSearch(dealer, search, digits)) return false;
    if (onlyWithBalance && dealer.balanceCents === 0) return false;
    return true;
  });

  filtered.sort((a, b) => {
    const diff = Math.abs(b.balanceCents) - Math.abs(a.balanceCents);
    if (diff !== 0) return diff;
    return a.cariIsim.localeCompare(b.cariIsim, 'tr') || a.cariKod.localeCompare(b.cariKod);
  });

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const start = (page - 1) * pageSize;
  const items = filtered.slice(start, start + pageSize).map(toPublicDealer);

  let debtorCount = 0;
  let creditorCount = 0;
  let totalDebitCents = 0;
  let totalCreditCents = 0;
  let totalMovements = 0;
  for (const dealer of filtered) {
    if (dealer.balanceCents > 0) {
      debtorCount += 1;
      totalDebitCents += dealer.balanceCents;
    } else if (dealer.balanceCents < 0) {
      creditorCount += 1;
      totalCreditCents += -dealer.balanceCents;
    }
    totalMovements += dealer.movementCount;
  }

  return {
    ...scope,
    asOf: today,
    items,
    page,
    pageSize,
    total,
    totalPages,
    summary: {
      dealerCount: dealers.length,
      matchedDealers: total,
      debtorCount,
      creditorCount,
      totalDebit: centsToTl(totalDebitCents),
      totalCredit: centsToTl(totalCreditCents),
      netBalance: centsToTl(totalDebitCents - totalCreditCents),
      movementCount: totalMovements,
    },
  };
}

/**
 * Hareket listesinden ekstre satırlarını ve dönem toplamlarını üretir.
 * Tüm hesaplar kuruş (integer) cinsindendir; dışarıya TL olarak döner.
 */
function buildStatement({
  customer,
  movements = [],
  openingBalance = 0,
  currentBalance = null,
  startDate = null,
  endDate = null,
  asOf = null,
  paymentMap = null,
  invoiceKinds = null,
  includeFinance = false,
  depositRate = 0,
}) {
  let balanceCents = toCents(openingBalance);
  const openingBalanceCents = balanceCents;
  let totalDebitCents = 0;
  let totalCreditCents = 0;
  const items = [];
  const typeTotals = new Map();

  const financeEnabled = toBoolean(includeFinance, false);
  const parsedRate = Number(depositRate);
  const annualRate = Number.isFinite(parsedRate) && parsedRate > 0 ? parsedRate : 0;

  let fundedAmountCents = 0;
  let fundedDaysWeight = 0;
  let fundedInvoiceCount = 0;
  let fundedInterestCents = 0;
  let latePaidAmountCents = 0;
  let latePaidDaysWeight = 0;
  let latePaidInvoiceCount = 0;
  let latePaidInterestCents = 0;

  const reportDate = isValidDateOnly(asOf)
    ? asOf
    : (isValidDateOnly(endDate) ? endDate : todayInIstanbul());
  const reportDay = dateOnlyDay(reportDate);

  let invoiceWeightCents = 0;
  let invoiceDateWeight = 0;
  let invoiceDueWeight = 0;
  let invoiceCount = 0;
  let collectionWeightCents = 0;
  let collectionDateWeight = 0;
  let collectionCount = 0;

  for (const movement of movements) {
    const debitCents = toCents(movement.BORC);
    const creditCents = toCents(movement.ALACAK);
    if (debitCents === 0 && creditCents === 0) continue;

    balanceCents += debitCents - creditCents;
    totalDebitCents += debitCents;
    totalCreditCents += creditCents;

    const direction = debitCents > 0 ? 'debit' : 'credit';
    const type = movement.HAREKET_TURU || '';
    const isInvoiceDebit = direction === 'debit' && INVOICE_TYPES.has(type);
    const invoiceId = isInvoiceDebit ? Number(movement.INC_KEY_NUMBER || 0) : null;
    const payment = isInvoiceDebit && paymentMap ? paymentMap.get(invoiceId) : null;
    const paymentStatus = isInvoiceDebit ? (payment?.status || 'open') : null;
    const movementDay = dateOnlyDay(movement.TARIH_GUN);
    const vadeDay = dateOnlyDay(movement.VADE_GUN);
    const termDays = isInvoiceDebit && movementDay !== null && vadeDay !== null
      ? vadeDay - movementDay
      : null;
    const reportOverdueDays = isInvoiceDebit && vadeDay !== null && reportDay !== null
      ? Math.max(0, reportDay - vadeDay)
      : null;
    const paymentDelayDays = payment
      && payment.paymentDelayDays !== null
      && payment.paymentDelayDays !== undefined
      && Number.isFinite(Number(payment.paymentDelayDays))
      ? Number(payment.paymentDelayDays)
      : null;
    const overdueDays = !isInvoiceDebit
      ? null
      : (paymentStatus === 'paid' ? paymentDelayDays : reportOverdueDays);
    const dueInDays = isInvoiceDebit && paymentStatus !== 'paid'
      && vadeDay !== null && reportDay !== null
      ? Math.max(0, vadeDay - reportDay)
      : null;
    const delayBasis = isInvoiceDebit
      ? (paymentStatus === 'paid' ? 'payment' : 'report')
      : null;

    const typeInfo = movementTypeInfo(movement, invoiceKinds);

    let latePaidBaseCents = 0;
    let latePaidDays = null;
    let openFundedBaseCents = 0;
    let openFundedDays = null;
    if (isInvoiceDebit) {
      if (paymentStatus === 'paid' && Number(paymentDelayDays) > 0) {
        latePaidBaseCents = debitCents;
        latePaidDays = Number(paymentDelayDays);
      } else if (paymentStatus === 'partial') {
        const paidBaseCents = Number(payment?.paidCents || 0);
        const paidDays = Number(payment?.paymentDelayDays);
        if (paidBaseCents > 0 && Number.isFinite(paidDays) && paidDays > 0) {
          latePaidBaseCents = paidBaseCents;
          latePaidDays = paidDays;
        }
        const remainingBaseCents = Number(payment?.remainingCents ?? debitCents);
        const remainingDays = Number(reportOverdueDays || 0);
        if (remainingBaseCents > 0 && remainingDays > 0) {
          openFundedBaseCents = remainingBaseCents;
          openFundedDays = remainingDays;
        }
      } else if (paymentStatus === 'open') {
        const remainingBaseCents = Number(payment?.remainingCents ?? debitCents);
        const remainingDays = Number(reportOverdueDays || 0);
        if (remainingBaseCents > 0 && remainingDays > 0) {
          openFundedBaseCents = remainingBaseCents;
          openFundedDays = remainingDays;
        }
      }
    }

    const lateInterestCents = depositInterestCents(latePaidBaseCents, annualRate, latePaidDays);
    const openInterestCents = depositInterestCents(openFundedBaseCents, annualRate, openFundedDays);
    const totalInterestCents = lateInterestCents + openInterestCents;

    if (openFundedBaseCents > 0) {
      fundedAmountCents += openFundedBaseCents;
      fundedDaysWeight += openFundedBaseCents * openFundedDays;
      fundedInvoiceCount += 1;
      fundedInterestCents += openInterestCents;
    }
    if (latePaidBaseCents > 0) {
      latePaidAmountCents += latePaidBaseCents;
      latePaidDaysWeight += latePaidBaseCents * latePaidDays;
      latePaidInvoiceCount += 1;
      latePaidInterestCents += lateInterestCents;
    }

    const typeBucket = typeTotals.get(typeInfo.key) || {
      key: typeInfo.key,
      label: typeInfo.label,
      count: 0,
      debitCents: 0,
      creditCents: 0,
    };
    typeBucket.count += 1;
    typeBucket.debitCents += debitCents;
    typeBucket.creditCents += creditCents;
    typeTotals.set(typeInfo.key, typeBucket);

    items.push({
      date: movement.TARIH_GUN,
      dateStr: movement.TARIH_STR || movement.TARIH_GUN,
      vade: movement.VADE_GUN || null,
      vadeSameAsDate: Boolean(movement.VADE_GUN && movement.VADE_GUN === movement.TARIH_GUN),
      termDays,
      overdueDays,
      dueInDays,
      isOverdue: overdueDays !== null && overdueDays > 0,
      paymentStatus,
      paymentStatusLabel: paymentStatus ? paymentStatusLabel(paymentStatus) : '',
      paidDate: payment?.paidDate || null,
      paidAmount: isInvoiceDebit ? centsToTl(payment?.paidCents || 0) : null,
      remainingAmount: isInvoiceDebit
        ? centsToTl(payment?.remainingCents ?? debitCents)
        : null,
      paymentDelayDays,
      delayBasis,
      belgeNo: movement.BELGE_NO || '',
      description: movement.ACIKLAMA || '',
      type,
      typeKey: typeInfo.key,
      typeLabel: typeInfo.label,
      interestAmount: financeEnabled ? centsToTl(totalInterestCents) : null,
      interestLateAmount: financeEnabled ? centsToTl(lateInterestCents) : null,
      interestOpenAmount: financeEnabled ? centsToTl(openInterestCents) : null,
      interestLateDays: financeEnabled ? latePaidDays : null,
      interestOpenDays: financeEnabled ? openFundedDays : null,
      debit: centsToTl(debitCents),
      credit: centsToTl(creditCents),
      balance: centsToTl(balanceCents),
      direction,
    });

    const amountCents = direction === 'debit' ? debitCents : creditCents;
    if (direction === 'debit' && INVOICE_TYPES.has(type) && movementDay !== null && vadeDay !== null) {
      invoiceCount += 1;
      invoiceWeightCents += amountCents;
      invoiceDateWeight += amountCents * movementDay;
      invoiceDueWeight += amountCents * vadeDay;
    }
    const collectionDay = direction === 'credit' && COLLECTION_TYPES.has(type)
      ? (dateOnlyDay(movement.VADE_GUN) ?? movementDay)
      : movementDay;
    if (direction === 'credit' && COLLECTION_TYPES.has(type) && collectionDay !== null) {
      collectionCount += 1;
      collectionWeightCents += amountCents;
      collectionDateWeight += amountCents * collectionDay;
    }
  }

  const weightedInvoiceDay = invoiceWeightCents > 0
    ? invoiceDateWeight / invoiceWeightCents
    : null;
  const weightedDueDay = invoiceWeightCents > 0
    ? invoiceDueWeight / invoiceWeightCents
    : null;
  const weightedCollectionDay = collectionWeightCents > 0
    ? collectionDateWeight / collectionWeightCents
    : null;
  const averageMaturityDays = weightedInvoiceDay !== null && weightedDueDay !== null
    ? roundDays(weightedDueDay - weightedInvoiceDay)
    : null;
  const averageCollectionDelayDays = weightedDueDay !== null && weightedCollectionDay !== null
    ? roundDays(weightedCollectionDay - weightedDueDay)
    : null;

  const typeBreakdown = [...typeTotals.values()]
    .sort((a, b) => typeOrder(a.key) - typeOrder(b.key) || a.label.localeCompare(b.label, 'tr'))
    .map((bucket) => ({
      key: bucket.key,
      label: bucket.label,
      count: bucket.count,
      debit: centsToTl(bucket.debitCents),
      credit: centsToTl(bucket.creditCents),
      total: centsToTl(bucket.debitCents + bucket.creditCents),
      net: centsToTl(bucket.debitCents - bucket.creditCents),
    }));

  const finance = financeEnabled
    ? {
        depositRate: annualRate,
        isFunding: fundedAmountCents > 0,
        fundedAmount: centsToTl(fundedAmountCents),
        fundedDays: fundedAmountCents > 0
          ? roundDays(fundedDaysWeight / fundedAmountCents)
          : null,
        fundedInvoiceCount,
        fundedInterest: centsToTl(fundedInterestCents),
        latePaidAmount: centsToTl(latePaidAmountCents),
        latePaidDays: latePaidAmountCents > 0
          ? roundDays(latePaidDaysWeight / latePaidAmountCents)
          : null,
        latePaidInvoiceCount,
        latePaidInterest: centsToTl(latePaidInterestCents),
        totalInterest: centsToTl(fundedInterestCents + latePaidInterestCents),
      }
    : null;

  return {
    cariKod: customer.CARI_KOD,
    cariIsim: customer.CARI_ISIM || customer.CARI_KOD,
    phone: customer.phone || null,
    rawPhone: customer.rawPhone || null,
    city: customer.CARI_IL || null,
    district: customer.CARI_ILCE || null,
    taxNumber: customer.VERGI_NUMARASI || null,
    startDate,
    endDate,
    asOf: reportDate,
    openingBalance: centsToTl(openingBalanceCents),
    closingBalance: centsToTl(balanceCents),
    currentBalance: centsToTl(currentBalance === null ? balanceCents : toCents(currentBalance)),
    totalDebit: centsToTl(totalDebitCents),
    totalCredit: centsToTl(totalCreditCents),
    movementCount: items.length,
    maturity: {
      invoiceCount,
      invoiceTotal: centsToTl(invoiceWeightCents),
      collectionCount,
      collectionTotal: centsToTl(collectionWeightCents),
      weightedInvoiceDate: dayToDateOnly(weightedInvoiceDay),
      weightedDueDate: dayToDateOnly(weightedDueDay),
      averageMaturityDays,
      weightedCollectionDate: dayToDateOnly(weightedCollectionDay),
      averageCollectionDelayDays,
    },
    typeBreakdown,
    finance,
    items,
  };
}

async function getStatement(options = {}) {
  const scope = resolveScope(options);
  const cariKod = String(options.cariKod || '').trim();
  if (!cariKod) throw badRequest('Cari kodu zorunludur.');
  if (cariKod.length > 64) throw badRequest('Cari kodu geçersiz.');

  const today = todayInIstanbul();
  const endDate = isValidDateOnly(options.endDate) ? options.endDate : today;
  const allTime = toBoolean(options.allTime, false);
  const startDate = allTime
    ? '1990-01-01'
    : (isValidDateOnly(options.startDate) ? options.startDate : `${endDate.slice(0, 4)}-01-01`);
  if (startDate > endDate) {
    throw badRequest('Başlangıç tarihi bitiş tarihinden sonra olamaz.');
  }
  const includeFinance = toBoolean(options.includeFinance, false);
  const depositRate = includeFinance ? getSettingNumber('finance.deposit_rate', 0) : 0;

  const customer = await getDealerRecord({
    branch: scope.branch,
    customerType: scope.customerType,
    database: scope.database,
    cariKod,
  });
  if (!customer) return null;

  const [movements, paymentMovements, openingBalance, currentBalance, invoiceLines] = await Promise.all([
    getStatementMovements({
      branch: scope.branch,
      database: scope.database,
      cariKod,
      startDate,
      endDate,
    }),
    getCustomerMovementsUntil({
      branch: scope.branch,
      database: scope.database,
      cariKod,
      endDate,
    }),
    getStatementOpeningBalance({
      branch: scope.branch,
      database: scope.database,
      cariKod,
      startDate,
    }),
    getCustomerBalance({
      branch: scope.branch,
      database: scope.database,
      cariKod,
    }),
    getInvoiceLines({
      branch: scope.branch,
      database: scope.database,
      cariKod,
      startDate,
      endDate,
    }),
  ]);

  const rawPhone = customer.CARI_TEL || customer.GSM1 || customer.GSM2 || null;
  const statement = buildStatement({
    customer: {
      ...customer,
      phone: normalizePhone(rawPhone),
      rawPhone,
    },
    movements,
    openingBalance,
    currentBalance,
    startDate,
    endDate,
    asOf: endDate,
    paymentMap: buildInvoicePayments({ movements: paymentMovements, asOf: endDate }),
    invoiceKinds: buildInvoiceKinds(invoiceLines, cariKod),
    includeFinance,
    depositRate,
  });

  return {
    ...scope,
    today,
    generatedAt: new Date().toISOString(),
    allTime,
    ...statement,
  };
}

module.exports = {
  listDealers,
  getStatement,
  buildStatement,
  buildInvoicePayments,
  buildInvoiceKinds,
  classifyInvoiceLineNames,
  invalidateLedgerCache,
  toCents,
  centsToTl,
  typeLabel,
  paymentStatusLabel,
  isCreditCardCollection,
  depositInterestCents,
};
