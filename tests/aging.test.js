'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { computeCustomer, toPublicCustomer } = require('../src/services/aging');

const AS_OF = '2026-11-11';

function dateDaysAgo(days) {
  const date = new Date(`${AS_OF}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function movement({ id, date, type = 'B', borc = 0, alacak = 0, belge = '', aciklama = '' }) {
  return {
    CARI_KOD: 'C1',
    TARIH_GUN: date,
    TARIH_STR: `${date} 00:00:00`,
    VADE_GUN: date,
    BELGE_NO: belge,
    ACIKLAMA: aciklama,
    HAREKET_TURU: type,
    BORC: borc,
    ALACAK: alacak,
    INC_KEY_NUMBER: id,
  };
}

function customer() {
  return {
    CARI_KOD: 'C1',
    CARI_ISIM: 'Test Cari',
    CARI_TEL: '0532 123 45 67',
  };
}

function compute(movements, tolerance = 0, includePrepaid = false) {
  return computeCustomer({
    customer: customer(),
    movements,
    asOf: AS_OF,
    toleranceCents: Math.round(tolerance * 100),
    includePrepaid,
  });
}

test('aynı gün birebir fatura ve tahsilat yaşlandırmadan düşer', () => {
  const result = compute([
    movement({ id: 1, date: '2026-11-10', borc: 1000, belge: 'F1' }),
    movement({ id: 2, date: '2026-11-10', alacak: 1000, type: 'D', belge: 'T1' }),
  ]);

  assert.equal(result.totalDebtCents, 0);
  assert.equal(result.balanceCents, 0);
  assert.equal(result.openCount, 0);
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].kind, 'exact_same_day');
  assert.equal(result.matches[0].debit.belgeNo, 'F1');
  assert.equal(result.matches[0].credit.belgeNo, 'T1');
  assert.equal(result.matches[0].amountCents, 100000);
});

test('aynı gün tutarı birebir eşleşen fatura ve tahsilat FIFO dışında kalır', () => {
  const result = compute([
    movement({ id: 1, date: '2026-10-01', borc: 1000, belge: 'OLD' }),
    movement({ id: 2, date: '2026-11-10', borc: 500, belge: 'NEW' }),
    movement({ id: 3, date: '2026-11-10', alacak: 500, type: 'D', belge: 'T1' }),
  ]);

  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].kind, 'exact_same_day');
  assert.equal(result.matches[0].debit.belgeNo, 'NEW');
  assert.equal(result.matches[0].credit.belgeNo, 'T1');
  assert.equal(result.openCount, 1);
  assert.equal(result.openItems[0].belgeNo, 'OLD');
  assert.equal(result.openItems[0].remainingCents, 100000);
});

test('peşin faturalar dahil edildiğinde aynı gün eşleşen tahsilat eski faturaya FIFO ile uygulanır', () => {
  const result = compute([
    movement({ id: 1, date: '2026-10-01', borc: 1000, belge: 'OLD' }),
    movement({ id: 2, date: '2026-11-10', borc: 500, belge: 'NEW' }),
    movement({ id: 3, date: '2026-11-10', alacak: 500, type: 'D', belge: 'T1' }),
  ], 0, true);

  assert.equal(result.totalDebtCents, 100000);
  assert.equal(result.bucketsCents.d31_45, 50000);
  assert.equal(result.bucketsCents.d0_14, 50000);
  assert.equal(result.openCount, 2);
  assert.equal(result.openItems.find((item) => item.belgeNo === 'OLD').remainingCents, 50000);
  assert.equal(result.openItems.find((item) => item.belgeNo === 'NEW').remainingCents, 50000);
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].kind, 'fifo');
  assert.equal(result.matches[0].debit.belgeNo, 'OLD');
  assert.equal(result.matches[0].credit.belgeNo, 'T1');
  assert.equal(result.matches[0].amountCents, 50000);
});

test('peşin faturalar dahil edildiğinde tek başına aynı gün çifti net sıfır bırakır', () => {
  const result = compute([
    movement({ id: 1, date: '2026-11-10', borc: 1000, belge: 'F1' }),
    movement({ id: 2, date: '2026-11-10', alacak: 1000, type: 'D', belge: 'T1' }),
  ], 0, true);

  assert.equal(result.totalDebtCents, 0);
  assert.equal(result.balanceCents, 0);
  assert.equal(result.openCount, 0);
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].kind, 'fifo');
  assert.equal(result.matches[0].debit.belgeNo, 'F1');
  assert.equal(result.matches[0].credit.belgeNo, 'T1');
});

test('aynı gün tutarı eşit olmayan tahsilat FIFO ile eski faturaya uygulanır', () => {
  const result = compute([
    movement({ id: 1, date: '2026-10-01', borc: 1000, belge: 'OLD' }),
    movement({ id: 2, date: '2026-11-10', borc: 500, belge: 'NEW' }),
    movement({ id: 3, date: '2026-11-10', alacak: 400, type: 'D', belge: 'T1' }),
  ]);

  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].kind, 'fifo');
  assert.equal(result.matches[0].debit.belgeNo, 'OLD');
  assert.equal(result.matches[0].amountCents, 40000);
  assert.equal(result.openItems.find((item) => item.belgeNo === 'OLD').remainingCents, 60000);
  assert.equal(result.openItems.find((item) => item.belgeNo === 'NEW').remainingCents, 50000);
});

test('artan tahsilat en eski faturalara FIFO ile uygulanır', () => {
  const result = compute([
    movement({ id: 1, date: '2026-09-01', borc: 1000, belge: 'F1' }),
    movement({ id: 2, date: '2026-10-20', borc: 500, belge: 'F2' }),
    movement({ id: 3, date: '2026-10-25', alacak: 1200, type: 'D', belge: 'T1' }),
  ]);

  assert.equal(result.totalDebtCents, 30000);
  assert.equal(result.balanceCents, 30000);
  assert.equal(result.openCount, 1);
  assert.equal(result.openItems[0].belgeNo, 'F2');
  assert.equal(result.openItems[0].remainingCents, 30000);
  assert.equal(result.bucketsCents.d22_30, 30000);
  assert.equal(result.oldestDays, 22);
  assert.equal(result.matches.length, 2);
  assert.deepEqual(result.matches.map((match) => match.kind), ['fifo', 'fifo']);
  assert.deepEqual(result.matches.map((match) => match.debit.belgeNo), ['F1', 'F2']);
  assert.deepEqual(result.matches.map((match) => match.amountCents), [100000, 20000]);
});

test('tolerans dahilindeki aynı gün farkı kapatılır', () => {
  const result = compute([
    movement({ id: 1, date: '2026-11-10', borc: 1000 }),
    movement({ id: 2, date: '2026-11-10', alacak: 999.5, type: 'D' }),
  ], 0.5);

  assert.equal(result.totalDebtCents, 0);
  assert.equal(result.balanceCents, 50);
  assert.equal(result.openItems.length, 0);
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].kind, 'exact_same_day');
  assert.equal(result.matches[0].amountCents, 99950);
});

test('tolerans dışındaki aynı gün farkı açık bakiye olarak kalır', () => {
  const result = compute([
    movement({ id: 1, date: '2026-11-10', borc: 1000 }),
    movement({ id: 2, date: '2026-11-10', alacak: 999.5, type: 'D' }),
  ], 0.4);

  assert.equal(result.totalDebtCents, 50);
  assert.equal(result.balanceCents, 50);
  assert.equal(result.bucketsCents.d0_14, 50);
});

test('yaşlandırma kovaları sınır günlerinde doğru hesaplanır', () => {
  const days = [14, 15, 21, 22, 30, 31, 45, 46, 60, 61];
  const movements = days.map((value, index) => movement({
    id: index + 1,
    date: dateDaysAgo(value),
    borc: index + 1,
    belge: `F${index + 1}`,
  }));
  const result = compute(movements);

  assert.equal(result.totalDebtCents, 5500);
  assert.equal(result.bucketsCents.d0_14, 100);
  assert.equal(result.bucketsCents.d15_21, 500);
  assert.equal(result.bucketsCents.d22_30, 900);
  assert.equal(result.bucketsCents.d31_45, 1300);
  assert.equal(result.bucketsCents.d46_60, 1700);
  assert.equal(result.bucketsCents.d61, 1000);
  assert.equal(result.overdue30Cents, 4000);
  assert.equal(result.oldestDays, 61);
  assert.equal(result.oldestDate, dateDaysAgo(61));
});

test('alacak fazlası negatif bakiye üretir, açık borç bırakmaz', () => {
  const result = compute([
    movement({ id: 1, date: '2026-10-01', alacak: 250, type: 'D' }),
  ]);

  assert.equal(result.totalDebtCents, 0);
  assert.equal(result.balanceCents, -25000);
  assert.equal(result.openCount, 0);
});

test('rapor tarihindeki fatura 0 gün olarak sınıflanır', () => {
  const result = compute([
    movement({ id: 1, date: AS_OF, borc: 100 }),
  ]);

  assert.equal(result.openItems[0].days, 0);
  assert.equal(result.bucketsCents.d0_14, 10000);
  assert.equal(result.overdue30Cents, 0);
});

test('vadesi gelmemiş çek yaşlandırmada faturayı kapatmaz', () => {
  const check = {
    ...movement({ id: 3, date: '2026-01-10', alacak: 1000, type: 'G' }),
    VADE_GUN: '2026-12-01',
  };
  const result = compute([
    movement({ id: 1, date: '2026-01-01', borc: 1000 }),
    movement({ id: 2, date: '2026-02-01', borc: 1000 }),
    check,
  ]);

  assert.equal(result.totalDebtCents, 200000);
  assert.equal(result.openItems.length, 2);
  assert.equal(result.matches.length, 0);
  assert.equal(result.credits.find((credit) => credit.id === 3).remainingCents, 100000);
});

test('vadesi gelmiş çek vade tarihinde FIFO ile uygulanır', () => {
  const check = {
    ...movement({ id: 3, date: '2026-01-10', alacak: 1000, type: 'G' }),
    VADE_GUN: '2026-10-01',
  };
  const result = compute([
    movement({ id: 1, date: '2026-01-01', borc: 1000 }),
    movement({ id: 2, date: '2026-02-01', borc: 1000 }),
    check,
  ]);

  assert.equal(result.totalDebtCents, 100000);
  assert.equal(result.openItems.length, 1);
  assert.equal(result.openItems[0].id, 2);
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].credit.effectiveDate, '2026-10-01');
});

test('yaşlandırma detayında DINO kredi kartı tahsilatı ayrı etiketlenir', () => {
  const result = compute([
    movement({ id: 1, date: '2026-01-01', borc: 1000 }),
    movement({
      id: 2,
      date: '2026-01-10',
      alacak: 400,
      type: 'D',
      belge: '1500009056',
      aciklama: 'KREDI KART TAHSILAT(TRB02)',
    }),
    movement({
      id: 3,
      date: '2026-01-11',
      alacak: 100,
      type: 'D',
      belge: 'T1',
      aciklama: 'NAKİT TAHSİLAT(TRB01)',
    }),
  ]);
  const detail = toPublicCustomer(result, true);
  const card = detail.credits.find((credit) => credit.belgeNo === '1500009056');
  const cash = detail.credits.find((credit) => credit.belgeNo === 'T1');

  assert.equal(card.isCreditCard, true);
  assert.equal(cash.isCreditCard, false);
  assert.equal(detail.matches[0].credit.isCreditCard, true);
});
