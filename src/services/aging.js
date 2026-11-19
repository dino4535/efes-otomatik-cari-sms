'use strict';

const config = require('../config');
const { getAgingMovements, getCustomers } = require('../db/erp');
const { getSetting, getSettingNumber } = require('../db/sqlite');
const { normalizePhone } = require('../utils/phone');
const { isCreditCardCollection } = require('./paymentClassification');
const {
  todayInIstanbul,
  isValidDateOnly,
  dayDiff,
  bucketForDays,
  bucketLabel,
} = require('../utils/dates');

const CACHE_TTL_MS = 60 * 1000;
const cache = new Map();
const COLLECTION_TYPES = new Set(['D', 'G', 'K']);

function centsToTl(cents) {
  return Math.round(Number(cents || 0)) / 100;
}

function byDateThenId(a, b) {
  return a.date.localeCompare(b.date) || (a.id - b.id);
}

function byEffectiveDateThenId(a, b) {
  return a.effectiveDate.localeCompare(b.effectiveDate) || (a.id - b.id);
}

/**
 * Tahsilatlar için efektif tarih çek/senet vadesidir. Nakit tahsilatta vade
 * genellikle kayıt tarihiyle aynıdır; vadeli çekte ise tahsilat ancak vade
 * tarihinde kullanılabilir.
 */
function effectiveMovementDate(movement, netCents) {
  if (
    netCents < 0
    && COLLECTION_TYPES.has(movement.HAREKET_TURU)
    && isValidDateOnly(movement.VADE_GUN)
  ) {
    return movement.VADE_GUN;
  }
  return movement.TARIH_GUN;
}

function toBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', 'dahil'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off', 'hariç', 'haric'].includes(normalized)) return false;
  return fallback;
}

function applyCredit(debit, credit, takeCents, matchKind = 'fifo', matches = null) {
  if (takeCents <= 0) return;
  debit.remainingCents -= takeCents;
  credit.remainingCents -= takeCents;
  debit.paidCents += takeCents;
  debit.allocations.push({
    creditId: credit.id,
    date: credit.date,
    effectiveDate: credit.effectiveDate,
    belgeNo: credit.belgeNo,
    description: credit.description,
    type: credit.type,
    isCreditCard: Boolean(credit.isCreditCard),
    amountCents: takeCents,
    matchKind,
  });
  credit.allocations.push({
    debitId: debit.id,
    date: debit.date,
    belgeNo: debit.belgeNo,
    type: debit.type,
    amountCents: takeCents,
    matchKind,
  });
  if (matches) {
    matches.push({
      kind: matchKind,
      amountCents: takeCents,
      debit: {
        id: debit.id,
        date: debit.date,
        belgeNo: debit.belgeNo,
        description: debit.description,
        type: debit.type,
        amountCents: debit.amountCents,
      },
      credit: {
        id: credit.id,
        date: credit.date,
        effectiveDate: credit.effectiveDate,
        belgeNo: credit.belgeNo,
        description: credit.description,
        type: credit.type,
        isCreditCard: Boolean(credit.isCreditCard),
        amountCents: credit.amountCents,
      },
    });
  }
}

function matchExactSameDay(dayDebits, dayCredits, toleranceCents, matches) {
  for (const debit of dayDebits) {
    if (debit.remainingCents <= 0) continue;
    const credit = dayCredits.find((item) =>
      item.remainingCents > 0 &&
      Math.abs(item.remainingCents - debit.remainingCents) <= toleranceCents,
    );
    if (!credit) continue;

    const take = Math.min(debit.remainingCents, credit.remainingCents);
    applyCredit(debit, credit, take, 'exact_same_day', matches);

    // Tolerans dahilindeki kuruş farkları kapatılır.
    if (debit.remainingCents > 0) {
      debit.writeOffCents += debit.remainingCents;
      debit.remainingCents = 0;
    }
    if (credit.remainingCents > 0) {
      credit.writeOffCents += credit.remainingCents;
      credit.remainingCents = 0;
    }
  }
}

/**
 * Bir müşterinin hareketlerini yaşlandırır.
 * Tüm tutarlar kuruş (integer) cinsindendir.
 */
function computeCustomer({ customer, movements, asOf, toleranceCents = 0, includePrepaid = false }) {
  const prepaidIncluded = toBoolean(includePrepaid, false);
  const debits = [];
  const credits = [];
  const matches = [];
  let totalDebitCents = 0;
  let totalCreditCents = 0;

  for (const movement of movements) {
    const netCents = Math.round(
      (Number(movement.BORC || 0) - Number(movement.ALACAK || 0)) * 100,
    );
    if (netCents === 0) continue;

    const item = {
      id: Number(movement.INC_KEY_NUMBER || 0),
      date: movement.TARIH_GUN,
      effectiveDate: effectiveMovementDate(movement, netCents),
      dateStr: movement.TARIH_STR,
      vade: movement.VADE_GUN || null,
      belgeNo: movement.BELGE_NO || '',
      description: movement.ACIKLAMA || '',
      type: movement.HAREKET_TURU || '',
      isCreditCard: isCreditCardCollection({
        HAREKET_TURU: movement.HAREKET_TURU || '',
        ALACAK: netCents < 0 ? Math.abs(netCents) : 0,
        BELGE_NO: movement.BELGE_NO || '',
        ACIKLAMA: movement.ACIKLAMA || '',
      }),
      amountCents: Math.abs(netCents),
      remainingCents: Math.abs(netCents),
      paidCents: 0,
      writeOffCents: 0,
      allocations: [],
    };

    if (netCents > 0) {
      debits.push(item);
      totalDebitCents += netCents;
    } else {
      credits.push(item);
      totalCreditCents += -netCents;
    }
  }

  const debitByDate = new Map();
  const creditByDate = new Map();
  for (const debit of debits) {
    if (!debitByDate.has(debit.date)) debitByDate.set(debit.date, []);
    debitByDate.get(debit.date).push(debit);
  }
  for (const credit of credits) {
    if (!creditByDate.has(credit.effectiveDate)) creditByDate.set(credit.effectiveDate, []);
    creditByDate.get(credit.effectiveDate).push(credit);
  }
  for (const list of debitByDate.values()) list.sort(byDateThenId);
  for (const list of creditByDate.values()) list.sort(byEffectiveDateThenId);

  const availableCredits = credits.filter((credit) => credit.effectiveDate <= asOf);
  const allDates = [...new Set([
    ...debitByDate.keys(),
    ...availableCredits.map((credit) => credit.effectiveDate),
  ])].sort();
  const pool = [];

  for (const date of allDates) {
    const dayDebits = debitByDate.get(date) || [];
    const dayCredits = creditByDate.get(date) || [];
    if (!dayCredits.length) continue;

    // Varsayılan modda sadece tutarı birebir aynı olan aynı gün fatura/tahsilat
    // çiftleri eşleşir ve FIFO havuzuna dahil edilmez. Peşin faturalar dahil
    // edildiğinde bu eşleştirme yapılmaz; tahsilat normal FIFO akışına girer.
    if (!prepaidIncluded && dayDebits.length) {
      matchExactSameDay(dayDebits, dayCredits, toleranceCents, matches);
    }

    for (const credit of dayCredits) {
      if (credit.remainingCents > 0) pool.push(credit);
    }
  }

  pool.sort(byEffectiveDateThenId);
  const openDebits = debits.filter((debit) => debit.remainingCents > 0).sort(byDateThenId);
  let debitIndex = 0;
  for (const credit of pool) {
    while (credit.remainingCents > 0 && debitIndex < openDebits.length) {
      const debit = openDebits[debitIndex];
      if (debit.remainingCents <= 0) {
        debitIndex += 1;
        continue;
      }
      const take = Math.min(debit.remainingCents, credit.remainingCents);
      applyCredit(debit, credit, take, 'fifo', matches);
      if (debit.remainingCents <= 0) debitIndex += 1;
    }
  }

  const bucketsCents = {
    d0_14: 0,
    d15_21: 0,
    d22_30: 0,
    d31_45: 0,
    d46_60: 0,
    d61: 0,
  };

  let oldestDate = null;
  let oldestDays = -1;
  let totalDebtCents = 0;
  let openCount = 0;

  for (const debit of debits) {
    if (debit.remainingCents <= 0) continue;
    const days = dayDiff(asOf, debit.date);
    if (days < 0) continue;
    debit.days = days;
    debit.bucket = bucketLabel(days);
    bucketsCents[bucketForDays(days)] += debit.remainingCents;
    totalDebtCents += debit.remainingCents;
    openCount += 1;
    if (days > oldestDays) {
      oldestDays = days;
      oldestDate = debit.date;
    }
  }

  const current30Cents =
    bucketsCents.d0_14 + bucketsCents.d15_21 + bucketsCents.d22_30;
  const overdue30Cents =
    bucketsCents.d31_45 + bucketsCents.d46_60 + bucketsCents.d61;

  openDebits.sort(byDateThenId);
  const unmaturedCreditCents = credits
    .filter((credit) => credit.effectiveDate > asOf)
    .reduce((sum, credit) => sum + credit.remainingCents, 0);

  return {
    cariKod: customer.CARI_KOD,
    cariIsim: customer.CARI_ISIM || customer.CARI_KOD,
    rawPhone: customer.CARI_TEL || customer.GSM1 || customer.GSM2 || null,
    phone: normalizePhone(customer.CARI_TEL || customer.GSM1 || customer.GSM2),
    email: customer.EMAIL || null,
    city: customer.CARI_IL || null,
    district: customer.CARI_ILCE || null,
    taxNumber: customer.VERGI_NUMARASI || null,
    balanceCents: totalDebitCents - totalCreditCents,
    totalDebtCents,
    unmaturedCreditCents,
    current30Cents,
    overdue30Cents,
    bucketsCents,
    oldestDate,
    oldestDays: oldestDays < 0 ? 0 : oldestDays,
    openCount,
    openItems: openDebits.filter((debit) => debit.remainingCents > 0),
    credits,
    matches,
  };
}

function toPublicItem(item) {
  return {
    date: item.date,
    effectiveDate: item.effectiveDate || item.date,
    dateStr: item.dateStr,
    vade: item.vade,
    belgeNo: item.belgeNo,
    description: item.description,
    type: item.type,
    isCreditCard: Boolean(item.isCreditCard),
    amount: centsToTl(item.amountCents),
    paid: centsToTl(item.paidCents),
    writeOff: centsToTl(item.writeOffCents),
    remaining: centsToTl(item.remainingCents),
    days: item.days ?? dayDiff(item.date, item.date),
    bucket: item.bucket || null,
    allocations: (item.allocations || []).map((allocation) => ({
      ...allocation,
      amount: centsToTl(allocation.amountCents),
    })),
  };
}

function toPublicCustomer(customer, detail = false) {
  const base = {
    cariKod: customer.cariKod,
    cariIsim: customer.cariIsim,
    phone: customer.phone,
    rawPhone: customer.rawPhone,
    email: customer.email,
    city: customer.city,
    district: customer.district,
    taxNumber: customer.taxNumber,
    totalDebt: centsToTl(customer.totalDebtCents),
    current30: centsToTl(customer.current30Cents),
    overdue30: centsToTl(customer.overdue30Cents),
    balance: centsToTl(customer.balanceCents),
    oldestDate: customer.oldestDate,
    oldestDays: customer.oldestDays,
    openCount: customer.openCount,
    buckets: {
      d0_14: centsToTl(customer.bucketsCents.d0_14),
      d15_21: centsToTl(customer.bucketsCents.d15_21),
      d22_30: centsToTl(customer.bucketsCents.d22_30),
      d31_45: centsToTl(customer.bucketsCents.d31_45),
      d46_60: centsToTl(customer.bucketsCents.d46_60),
      d61: centsToTl(customer.bucketsCents.d61),
    },
  };

  if (detail) {
    base.openItems = customer.openItems.map((item) => ({
      ...toPublicItem(item),
      days: item.days ?? 0,
      bucket: item.bucket || bucketLabel(item.days ?? 0),
    }));
    base.credits = customer.credits
      .filter((credit) => credit.allocations.length > 0 || credit.remainingCents > 0)
      .map((credit) => ({
        ...toPublicItem(credit),
        applied: centsToTl(
          credit.amountCents - credit.remainingCents - credit.writeOffCents,
        ),
      }));
    base.matches = (customer.matches || []).map((match) => ({
      kind: match.kind,
      amount: centsToTl(match.amountCents),
      exactSameDay: match.kind === 'exact_same_day',
      debit: {
        date: match.debit.date,
        belgeNo: match.debit.belgeNo,
        description: match.debit.description,
        type: match.debit.type,
        amount: centsToTl(match.debit.amountCents),
      },
      credit: {
        date: match.credit.date,
        effectiveDate: match.credit.effectiveDate || match.credit.date,
        belgeNo: match.credit.belgeNo,
        description: match.credit.description,
        type: match.credit.type,
        isCreditCard: Boolean(match.credit.isCreditCard),
        amount: centsToTl(match.credit.amountCents),
      },
    }));
  }

  return base;
}

function buildCacheKey({ database, branch, customerType, asOf, toleranceCents, includePrepaid = false }) {
  return `${database}|${branch}|${customerType}|${asOf}|${toleranceCents}|${includePrepaid ? 1 : 0}`;
}

function invalidateAgingCache() {
  cache.clear();
}

async function getAging(options = {}) {
  const database = String(options.database ?? getSetting('erp.database', config.erp.database) ?? '').trim();
  const branch = Number(options.branch ?? getSettingNumber('app.branch', config.branch));
  const customerType = String(options.customerType ?? getSetting('aging.customer_type', 'A')).slice(0, 1);
  const asOfRaw = options.asOf || todayInIstanbul();
  const asOf = isValidDateOnly(asOfRaw) ? asOfRaw : todayInIstanbul();
  const toleranceRaw = Number(options.tolerance ?? getSettingNumber('aging.tolerance', 0));
  const tolerance = Number.isFinite(toleranceRaw) ? Math.max(0, toleranceRaw) : 0;
  const toleranceCents = Math.round(tolerance * 100);
  const includePrepaid = toBoolean(options.includePrepaid, false);
  const force = Boolean(options.force);

  const cacheKey = buildCacheKey({ database, branch, customerType, asOf, toleranceCents, includePrepaid });
  const cached = cache.get(cacheKey);
  if (!force && cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
    return cached.data;
  }

  const [movements, customers] = await Promise.all([
    getAgingMovements({ branch, asOf, customerType, database }),
    getCustomers({ branch, customerType, database }),
  ]);

  const movementsByCustomer = new Map();
  for (const movement of movements) {
    if (!movementsByCustomer.has(movement.CARI_KOD)) {
      movementsByCustomer.set(movement.CARI_KOD, []);
    }
    movementsByCustomer.get(movement.CARI_KOD).push(movement);
  }

  const computedCustomers = [];
  for (const customer of customers) {
    const rows = movementsByCustomer.get(customer.CARI_KOD);
    if (!rows || !rows.length) continue;
    const computed = computeCustomer({
      customer,
      movements: rows,
      asOf,
      toleranceCents,
      includePrepaid,
    });
    if (computed.totalDebtCents > 0) {
      computedCustomers.push(computed);
    }
  }

  computedCustomers.sort((a, b) => {
    if (b.overdue30Cents !== a.overdue30Cents) return b.overdue30Cents - a.overdue30Cents;
    if (b.totalDebtCents !== a.totalDebtCents) return b.totalDebtCents - a.totalDebtCents;
    return a.cariIsim.localeCompare(b.cariIsim, 'tr');
  });

  const summaryCents = {
    d0_14: 0,
    d15_21: 0,
    d22_30: 0,
    d31_45: 0,
    d46_60: 0,
    d61: 0,
    totalDebt: 0,
    overdue30: 0,
    current30: 0,
    controlTotal: 0,
    unmatured: 0,
  };
  let overdueCustomerCount = 0;

  for (const customer of computedCustomers) {
    summaryCents.d0_14 += customer.bucketsCents.d0_14;
    summaryCents.d15_21 += customer.bucketsCents.d15_21;
    summaryCents.d22_30 += customer.bucketsCents.d22_30;
    summaryCents.d31_45 += customer.bucketsCents.d31_45;
    summaryCents.d46_60 += customer.bucketsCents.d46_60;
    summaryCents.d61 += customer.bucketsCents.d61;
    summaryCents.totalDebt += customer.totalDebtCents;
    summaryCents.overdue30 += customer.overdue30Cents;
    summaryCents.current30 += customer.current30Cents;
    summaryCents.unmatured += customer.unmaturedCreditCents;
    if (customer.overdue30Cents > 0) overdueCustomerCount += 1;
    if (customer.balanceCents > 0) summaryCents.controlTotal += customer.balanceCents;
  }

  const summary = {
    debtorCount: computedCustomers.length,
    overdueCustomerCount,
    totalDebt: centsToTl(summaryCents.totalDebt),
    overdue30: centsToTl(summaryCents.overdue30),
    current30: centsToTl(summaryCents.current30),
    buckets: {
      d0_14: centsToTl(summaryCents.d0_14),
      d15_21: centsToTl(summaryCents.d15_21),
      d22_30: centsToTl(summaryCents.d22_30),
      d31_45: centsToTl(summaryCents.d31_45),
      d46_60: centsToTl(summaryCents.d46_60),
      d61: centsToTl(summaryCents.d61),
    },
    controlTotal: centsToTl(summaryCents.controlTotal),
    unmatured: centsToTl(summaryCents.unmatured),
    difference: centsToTl(summaryCents.totalDebt - summaryCents.controlTotal),
  };

  const data = {
    asOf,
    generatedAt: new Date().toISOString(),
    database,
    branch,
    customerType,
    tolerance,
    includePrepaid,
    movementCount: movements.length,
    customerCount: movementsByCustomer.size,
    summary,
    customers: computedCustomers.map((customer) => toPublicCustomer(customer, false)),
    detailMap: computedCustomers,
  };

  cache.set(cacheKey, { createdAt: Date.now(), data });
  if (cache.size > 20) {
    const oldestKey = [...cache.keys()][0];
    cache.delete(oldestKey);
  }
  return data;
}

async function getCustomerDetail(options = {}) {
  const data = await getAging(options);
  const code = String(options.cariKod || '');
  const customer = data.detailMap.find((item) => item.cariKod === code);
  if (!customer) return null;
  return {
    asOf: data.asOf,
    database: data.database,
    branch: data.branch,
    tolerance: data.tolerance,
    includePrepaid: data.includePrepaid,
    customer: toPublicCustomer(customer, true),
  };
}

function getCachedAgingAge(options = {}) {
  const asOf = options.asOf || todayInIstanbul();
  const toleranceRaw = Number(options.tolerance ?? getSettingNumber('aging.tolerance', 0));
  const toleranceCents = Math.round((Number.isFinite(toleranceRaw) ? Math.max(0, toleranceRaw) : 0) * 100);
  const includePrepaid = toBoolean(options.includePrepaid, false);
  const key = buildCacheKey({
    database: String(options.database ?? getSetting('erp.database', config.erp.database) ?? '').trim(),
    branch: Number(options.branch ?? getSettingNumber('app.branch', config.branch)),
    customerType: String(options.customerType ?? getSetting('aging.customer_type', 'A')).slice(0, 1),
    asOf,
    toleranceCents,
    includePrepaid,
  });
  const cached = cache.get(key);
  return cached ? Date.now() - cached.createdAt : Infinity;
}

module.exports = {
  getAging,
  getCustomerDetail,
  invalidateAgingCache,
  getCachedAgingAge,
  computeCustomer,
  toPublicCustomer,
  centsToTl,
};
