'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const ExcelJS = require('exceljs');
const {
  buildStatement,
  buildInvoicePayments,
  buildInvoiceKinds,
  toCents,
  typeLabel,
  isCreditCardCollection,
} = require('../src/services/customerLedger');
const { buildStatementWorkbook } = require('../src/services/ledgerExcel');

const customer = {
  CARI_KOD: 'C1',
  CARI_ISIM: 'Test Bayi',
  CARI_IL: 'İzmir',
  CARI_ILCE: 'Bornova',
  VERGI_NUMARASI: '1234567890',
  phone: '+905551112233',
  rawPhone: '05551112233',
};

function movement(overrides) {
  return {
    TARIH_GUN: '2026-01-01',
    TARIH_STR: '2026-01-01 00:00:00',
    VADE_GUN: null,
    BELGE_NO: '',
    ACIKLAMA: '',
    HAREKET_TURU: 'B',
    BORC: 0,
    ALACAK: 0,
    INC_KEY_NUMBER: 1,
    ...overrides,
  };
}

test('cari ekstresi devir, borç, alacak ve kapanış bakiyesini hesaplar', () => {
  const statement = buildStatement({
    customer,
    openingBalance: 250,
    currentBalance: 550,
    startDate: '2026-01-01',
    endDate: '2026-01-31',
    movements: [
      movement({ HAREKET_TURU: 'A', BORC: 1000, BELGE_NO: 'DEVIR', ACIKLAMA: 'Devir bakiyesi' }),
      movement({ TARIH_GUN: '2026-01-05', TARIH_STR: '2026-01-05 00:00:00', BORC: 500, BELGE_NO: 'F1', ACIKLAMA: 'Faturamız', INC_KEY_NUMBER: 2 }),
      movement({ TARIH_GUN: '2026-01-06', TARIH_STR: '2026-01-06 00:00:00', ALACAK: 1200, BELGE_NO: 'T1', ACIKLAMA: 'Nakit tahsilat', HAREKET_TURU: 'D', INC_KEY_NUMBER: 3 }),
    ],
  });

  assert.equal(statement.cariKod, 'C1');
  assert.equal(statement.cariIsim, 'Test Bayi');
  assert.equal(statement.phone, '+905551112233');
  assert.equal(statement.openingBalance, 250);
  assert.equal(statement.totalDebit, 1500);
  assert.equal(statement.totalCredit, 1200);
  assert.equal(statement.closingBalance, 550);
  assert.equal(statement.currentBalance, 550);
  assert.equal(statement.movementCount, 3);

  assert.deepEqual(
    statement.items.map((item) => item.balance),
    [1250, 1750, 550],
  );
  assert.deepEqual(
    statement.items.map((item) => item.typeLabel),
    ['Devir', 'Fatura', 'Tahsilat'],
  );
  assert.deepEqual(
    statement.items.map((item) => item.direction),
    ['debit', 'debit', 'credit'],
  );
});

test('devir hareketi gecikme günü üretmez', () => {
  const statement = buildStatement({
    customer,
    asOf: '2026-02-15',
    startDate: '2026-01-01',
    endDate: '2026-02-15',
    movements: [
      movement({ HAREKET_TURU: 'A', VADE_GUN: '2025-12-01', BORC: 1000, BELGE_NO: 'DEVIR' }),
    ],
  });

  assert.equal(statement.items[0].termDays, null);
  assert.equal(statement.items[0].overdueDays, null);
  assert.equal(statement.items[0].dueInDays, null);
  assert.equal(statement.items[0].isOverdue, false);
});

test('cari ekstresi hareket yokken devir bakiyesini korur', () => {
  const statement = buildStatement({
    customer,
    openingBalance: -75.5,
    startDate: '2026-01-01',
    endDate: '2026-01-31',
    movements: [],
  });

  assert.equal(statement.openingBalance, -75.5);
  assert.equal(statement.closingBalance, -75.5);
  assert.equal(statement.currentBalance, -75.5);
  assert.equal(statement.totalDebit, 0);
  assert.equal(statement.totalCredit, 0);
  assert.equal(statement.movementCount, 0);
  assert.deepEqual(statement.items, []);
});

test('sıfır tutarlı hareketler ekstreye eklenmez', () => {
  const statement = buildStatement({
    customer,
    openingBalance: 0,
    movements: [
      movement({ BORC: 0, ALACAK: 0 }),
      movement({ BORC: 10.25, ALACAK: 0 }),
    ],
  });

  assert.equal(statement.movementCount, 1);
  assert.equal(statement.totalDebit, 10.25);
  assert.equal(statement.items[0].debit, 10.25);
});

test('ekstre vade gecikmesi ve ağırlıklı vade metriklerini hesaplar', () => {
  const statement = buildStatement({
    customer,
    asOf: '2026-02-15',
    startDate: '2026-01-01',
    endDate: '2026-02-15',
    movements: [
      movement({ TARIH_GUN: '2026-01-01', VADE_GUN: '2026-01-31', BORC: 1000, BELGE_NO: 'F1', INC_KEY_NUMBER: 1 }),
      movement({ TARIH_GUN: '2026-01-10', VADE_GUN: '2026-02-09', BORC: 3000, BELGE_NO: 'F2', INC_KEY_NUMBER: 2 }),
      movement({ TARIH_GUN: '2026-01-20', VADE_GUN: '2026-01-20', ALACAK: 1000, HAREKET_TURU: 'D', BELGE_NO: 'T1', INC_KEY_NUMBER: 3 }),
      movement({ TARIH_GUN: '2026-02-01', VADE_GUN: '2026-02-01', ALACAK: 3000, HAREKET_TURU: 'D', BELGE_NO: 'T2', INC_KEY_NUMBER: 4 }),
    ],
  });

  assert.equal(statement.items[0].termDays, 30);
  assert.equal(statement.items[0].overdueDays, 15);
  assert.equal(statement.items[0].isOverdue, true);
  assert.equal(statement.items[1].overdueDays, 6);
  assert.equal(statement.items[2].overdueDays, null);
  assert.equal(statement.maturity.invoiceCount, 2);
  assert.equal(statement.maturity.invoiceTotal, 4000);
  assert.equal(statement.maturity.averageMaturityDays, 30);
  assert.equal(statement.maturity.weightedDueDate, '2026-02-07');
  assert.equal(statement.maturity.weightedCollectionDate, '2026-01-29');
  assert.equal(statement.maturity.averageCollectionDelayDays, -8.7);
});

test('vadesi gelmemiş fatura sıfır gecikme ve kalan vade gösterir', () => {
  const statement = buildStatement({
    customer,
    asOf: '2026-02-15',
    startDate: '2026-01-01',
    endDate: '2026-02-15',
    movements: [
      movement({ TARIH_GUN: '2026-02-10', VADE_GUN: '2026-03-01', BORC: 500 }),
    ],
  });

  assert.equal(statement.items[0].termDays, 19);
  assert.equal(statement.items[0].overdueDays, 0);
  assert.equal(statement.items[0].dueInDays, 14);
  assert.equal(statement.items[0].isOverdue, false);
});

test('fatura tahsilatlarını FIFO ile eşleştirir ve ödeme gecikmesini hesaplar', () => {
  const payments = buildInvoicePayments({
    asOf: '2026-02-28',
    movements: [
      movement({ TARIH_GUN: '2026-01-01', VADE_GUN: '2026-01-31', BORC: 1000, BELGE_NO: 'F1', INC_KEY_NUMBER: 1 }),
      movement({ TARIH_GUN: '2026-01-10', VADE_GUN: '2026-02-09', BORC: 3000, BELGE_NO: 'F2', INC_KEY_NUMBER: 2 }),
      movement({ TARIH_GUN: '2026-02-05', ALACAK: 1000, HAREKET_TURU: 'D', BELGE_NO: 'T1', INC_KEY_NUMBER: 3 }),
      movement({ TARIH_GUN: '2026-02-20', ALACAK: 3000, HAREKET_TURU: 'D', BELGE_NO: 'T2', INC_KEY_NUMBER: 4 }),
    ],
  });

  assert.equal(payments.get(1).status, 'paid');
  assert.equal(payments.get(1).paidDate, '2026-02-05');
  assert.equal(payments.get(1).paymentDelayDays, 5);
  assert.equal(payments.get(1).remainingCents, 0);
  assert.equal(payments.get(2).status, 'paid');
  assert.equal(payments.get(2).paidDate, '2026-02-20');
  assert.equal(payments.get(2).paymentDelayDays, 11);
});

test('aynı gün birebir fatura/tahsilat çifti ödendi sayılır', () => {
  const payments = buildInvoicePayments({
    asOf: '2026-02-28',
    movements: [
      movement({ TARIH_GUN: '2026-01-05', VADE_GUN: '2026-01-31', BORC: 750, BELGE_NO: 'F1', INC_KEY_NUMBER: 1 }),
      movement({ TARIH_GUN: '2026-01-05', ALACAK: 750, HAREKET_TURU: 'D', BELGE_NO: 'T1', INC_KEY_NUMBER: 2 }),
    ],
  });

  assert.equal(payments.get(1).status, 'paid');
  assert.equal(payments.get(1).paidDate, '2026-01-05');
  assert.equal(payments.get(1).paymentDelayDays, 0);
});

test('vadeli çek kayıt tarihi yerine vade tarihinde faturaya uygulanır', () => {
  const movements = [
    movement({ TARIH_GUN: '2026-01-01', VADE_GUN: '2026-01-31', BORC: 1000, BELGE_NO: 'F1', INC_KEY_NUMBER: 1 }),
    movement({ TARIH_GUN: '2026-01-05', VADE_GUN: '2026-03-01', ALACAK: 1000, HAREKET_TURU: 'G', BELGE_NO: 'C1', INC_KEY_NUMBER: 2 }),
  ];
  const payments = buildInvoicePayments({ asOf: '2026-03-15', movements });

  assert.equal(payments.get(1).status, 'paid');
  assert.equal(payments.get(1).paidDate, '2026-03-01');
  assert.equal(payments.get(1).paymentDelayDays, 29);
});

test('kısmi ödeme kalan tutar için rapor tarihi gecikmesi kullanır', () => {
  const movements = [
    movement({ TARIH_GUN: '2026-01-01', VADE_GUN: '2026-01-31', BORC: 1000, BELGE_NO: 'F1', INC_KEY_NUMBER: 1 }),
    movement({ TARIH_GUN: '2026-02-10', ALACAK: 400, HAREKET_TURU: 'D', BELGE_NO: 'T1', INC_KEY_NUMBER: 2 }),
  ];
  const payments = buildInvoicePayments({ asOf: '2026-02-15', movements });
  const payment = payments.get(1);

  assert.equal(payment.status, 'partial');
  assert.equal(payment.paidCents, 40000);
  assert.equal(payment.remainingCents, 60000);
  assert.equal(payment.paidDate, '2026-02-10');
  assert.equal(payment.paymentDelayDays, 10);

  const statement = buildStatement({
    customer,
    asOf: '2026-02-15',
    startDate: '2026-01-01',
    endDate: '2026-02-15',
    movements,
    paymentMap: payments,
  });
  const item = statement.items[0];

  assert.equal(item.paymentStatus, 'partial');
  assert.equal(item.paidDate, '2026-02-10');
  assert.equal(item.paidAmount, 400);
  assert.equal(item.remainingAmount, 600);
  assert.equal(item.overdueDays, 15);
  assert.equal(item.delayBasis, 'report');
});

test('ödenen faturada gecikme son tahsilat tarihine göre hesaplanır', () => {
  const movements = [
    movement({ TARIH_GUN: '2026-01-01', VADE_GUN: '2026-01-31', BORC: 1000, BELGE_NO: 'F1', INC_KEY_NUMBER: 1 }),
    movement({ TARIH_GUN: '2026-02-05', ALACAK: 1000, HAREKET_TURU: 'D', BELGE_NO: 'T1', INC_KEY_NUMBER: 2 }),
  ];
  const payments = buildInvoicePayments({ asOf: '2026-02-15', movements });
  const statement = buildStatement({
    customer,
    asOf: '2026-02-15',
    startDate: '2026-01-01',
    endDate: '2026-02-15',
    movements,
    paymentMap: payments,
  });
  const item = statement.items[0];

  assert.equal(item.paymentStatus, 'paid');
  assert.equal(item.paymentStatusLabel, 'Ödendi');
  assert.equal(item.paidDate, '2026-02-05');
  assert.equal(item.paidAmount, 1000);
  assert.equal(item.remainingAmount, 0);
  assert.equal(item.overdueDays, 5);
  assert.equal(item.dueInDays, null);
  assert.equal(item.delayBasis, 'payment');
});

test('cari ekstre Excel çıktısı vade, durum ve ödenme tarihi sütunlarını içerir', async () => {
  const movements = [
    movement({ TARIH_GUN: '2026-01-01', VADE_GUN: '2026-01-31', BORC: 1000, BELGE_NO: 'F1', INC_KEY_NUMBER: 1 }),
    movement({ TARIH_GUN: '2026-01-10', VADE_GUN: '2026-02-09', BORC: 1000, BELGE_NO: 'F2', INC_KEY_NUMBER: 2 }),
    movement({ TARIH_GUN: '2026-02-05', ALACAK: 1000, HAREKET_TURU: 'D', BELGE_NO: 'T1', INC_KEY_NUMBER: 3 }),
    movement({ TARIH_GUN: '2026-02-10', ALACAK: 400, HAREKET_TURU: 'D', BELGE_NO: 'T2', INC_KEY_NUMBER: 4 }),
  ];
  const statement = buildStatement({
    customer,
    asOf: '2026-02-15',
    startDate: '2026-01-01',
    endDate: '2026-02-15',
    movements,
    paymentMap: buildInvoicePayments({ asOf: '2026-02-15', movements }),
  });

  const workbook = buildStatementWorkbook({
    ...statement,
    database: 'TESTDB',
    branch: 0,
    allTime: false,
    generatedAt: '2026-02-15T10:00:00.000Z',
  });
  const buffer = await workbook.xlsx.writeBuffer();
  const loaded = new ExcelJS.Workbook();
  await loaded.xlsx.load(buffer);
  const worksheet = loaded.getWorksheet('Cari Ekstre');

  assert.equal(worksheet.getCell('A6').value, 'Tarih');
  assert.equal(worksheet.getCell('B6').value, 'Vade Tarihi');
  assert.equal(worksheet.getCell('C6').value, 'Vade Günü');
  assert.equal(worksheet.getCell('D6').value, 'Gecikme (Gün)');
  assert.equal(worksheet.getCell('E6').value, 'Durum');
  assert.equal(worksheet.getCell('F6').value, 'Ödenen (TL)');
  assert.equal(worksheet.getCell('G6').value, 'Kalan (TL)');
  assert.equal(worksheet.getCell('H6').value, 'Ödenme Tarihi');
  assert.equal(worksheet.getCell('I6').value, 'Belge No');
  assert.equal(worksheet.getCell('L6').value, 'Borç');
  assert.equal(worksheet.getCell('N6').value, 'Bakiye');
  assert.equal(worksheet.getCell('J7').value, 'Devir');
  assert.equal(worksheet.getCell('K7').value, 'Devir Bakiyesi');
  assert.match(String(worksheet.getCell('A5').value), /Gecikme:/);
  assert.equal(worksheet.getCell('I8').value, 'F1');
  assert.equal(worksheet.getCell('C8').value, 30);
  assert.equal(worksheet.getCell('D8').value, 5);
  assert.equal(worksheet.getCell('E8').value, 'Ödendi');
  assert.equal(worksheet.getCell('F8').value, 1000);
  assert.equal(worksheet.getCell('G8').value, 0);
  assert.equal(worksheet.getCell('H8').value.getDate(), 5);
  assert.equal(worksheet.getCell('H8').value.getMonth(), 1);
  assert.equal(worksheet.getCell('L8').value, 1000);
  assert.equal(worksheet.getCell('I9').value, 'F2');
  assert.equal(worksheet.getCell('E9').value, 'Kısmi');
  assert.equal(worksheet.getCell('F9').value, 400);
  assert.equal(worksheet.getCell('G9').value, 600);
  assert.equal(worksheet.getCell('H9').value.getDate(), 10);
  assert.equal(worksheet.getCell('L9').value, 1000);
  assert.equal(worksheet.getCell('L12').value, 2000);
  assert.equal(worksheet.getCell('M12').value, 1400);
  assert.equal(worksheet.getCell('N12').value, 600);
});

test('kredi kartı tahsilatları ayrı türde toplanır', () => {
  const statement = buildStatement({
    customer,
    asOf: '2026-02-15',
    startDate: '2026-01-01',
    endDate: '2026-02-15',
    movements: [
      movement({ TARIH_GUN: '2026-01-01', VADE_GUN: '2026-01-31', BORC: 1000, BELGE_NO: 'F1', INC_KEY_NUMBER: 1 }),
      movement({ TARIH_GUN: '2026-02-01', ALACAK: 400, HAREKET_TURU: 'D', BELGE_NO: '1500080891', ACIKLAMA: 'KREDI KART TAHSILAT(ML02)', INC_KEY_NUMBER: 2 }),
      movement({ TARIH_GUN: '2026-02-02', ALACAK: 100, HAREKET_TURU: 'D', BELGE_NO: 'T1', ACIKLAMA: 'Nakit tahsilat', INC_KEY_NUMBER: 3 }),
      movement({ TARIH_GUN: '2026-02-03', ALACAK: 50, HAREKET_TURU: 'K', BELGE_NO: 'KK591', ACIKLAMA: 'K.KART/KARAYOLLARI', INC_KEY_NUMBER: 4 }),
      movement({ TARIH_GUN: '2026-02-04', ALACAK: 25, HAREKET_TURU: 'K', BELGE_NO: 'HA159400', ACIKLAMA: 'GELEN FAST', INC_KEY_NUMBER: 5 }),
    ],
  });

  assert.deepEqual(
    statement.items.map((item) => item.typeLabel),
    ['Fatura', 'Kredi Kartı Tahsilatı', 'Tahsilat', 'Kredi Kartı Tahsilatı', 'Havale / FAST'],
  );

  const creditCard = statement.typeBreakdown.find((item) => item.key === 'CC');
  assert.ok(creditCard);
  assert.equal(creditCard.label, 'Kredi Kartı Tahsilatı');
  assert.equal(creditCard.count, 2);
  assert.equal(creditCard.debit, 0);
  assert.equal(creditCard.credit, 450);
  assert.equal(creditCard.total, 450);
  assert.equal(creditCard.net, -450);

  const transfer = statement.typeBreakdown.find((item) => item.key === 'K');
  assert.equal(transfer.count, 1);
  assert.equal(transfer.credit, 25);

  assert.equal(isCreditCardCollection({ HAREKET_TURU: 'K', ALACAK: 10, BELGE_NO: 'KK591' }), true);
  assert.equal(isCreditCardCollection({ HAREKET_TURU: 'K', ALACAK: 10, BELGE_NO: 'HA1', ACIKLAMA: 'GELEN FAST' }), false);
  assert.equal(isCreditCardCollection({ HAREKET_TURU: 'B', BORC: 10, ACIKLAMA: 'KREDI KART' }), false);

  // DINO kart tahsilatları: D "KREDI KART TAHSILAT", K "Kart İşlemleri" ve POS.
  assert.equal(isCreditCardCollection({
    HAREKET_TURU: 'D',
    ALACAK: 100,
    BELGE_NO: '1500009056',
    ACIKLAMA: 'KREDI KART TAHSILAT(TRB02)',
  }), true);
  assert.equal(isCreditCardCollection({
    HAREKET_TURU: 'K',
    ALACAK: 100,
    BELGE_NO: 'HA71430',
    ACIKLAMA: 'HA71430 Kart İşlemleri - İşyeri:045400000000794',
  }), true);
  assert.equal(isCreditCardCollection({
    HAREKET_TURU: 'K',
    ALACAK: 100,
    BELGE_NO: 'HA71430',
    ACIKLAMA: 'HA71430 Kart Ýþlemleri - Ýþyeri:045400000000794',
  }), true);
  assert.equal(isCreditCardCollection({
    HAREKET_TURU: 'K',
    ALACAK: 100,
    BELGE_NO: 'POS1',
    ACIKLAMA: 'POS BLOKE COZUM-14/02',
  }), true);
  assert.equal(isCreditCardCollection({
    HAREKET_TURU: 'K',
    ALACAK: 100,
    BELGE_NO: 'HA1',
    ACIKLAMA: 'YAPIKREDI-GELEN FAST',
  }), false);
  assert.equal(isCreditCardCollection({
    HAREKET_TURU: 'K',
    ALACAK: 100,
    BELGE_NO: '1251',
    ACIKLAMA: 'Gayrinakdi Kredi teminat çözümü',
  }), false);
});

test('fatura kalem açıklamalarından iskonto ve işletme katkı payı alt türleri çıkarılır', () => {
  const kinds = buildInvoiceKinds([
    { FISNO: 'UMT202600000016', STOK_ADI: 'İSKONTO' },
    { FISNO: 'MAI202600000045', STOK_ADI: 'İŞLETME KATKI PAYINIZ' },
    { FISNO: 'NORMAL1', STOK_ADI: 'EFES PİLSEN 50 CL' },
    { FISNO: 'NORMAL1', STOK_ADI: 'İSKONTO' },
    { FISNO: 'KARMA1', STOK_ADI: 'İSKONTO' },
    { FISNO: 'KARMA1', STOK_ADI: 'İŞLETME KATKI PAYINIZ' },
    { FISNO: 'KUCUK1', STOK_ADI: 'iskonto' },
  ]);

  assert.deepEqual(kinds.get('UMT202600000016'), { key: 'BI', label: 'İskonto Faturası' });
  assert.deepEqual(kinds.get('MAI202600000045'), { key: 'BK', label: 'İşletme Katkı Payı' });
  assert.deepEqual(kinds.get('KUCUK1'), { key: 'BI', label: 'İskonto Faturası' });
  assert.equal(kinds.has('NORMAL1'), false);
  assert.equal(kinds.has('KARMA1'), false);
});

test('ortak FISNO kullanan belgelerde diğer cari kalemleri sınıflamaya karışmaz', () => {
  const lines = [
    { FISNO: 'GIB202600000001', STHAR_CARIKOD: '5000111453', STOK_ADI: 'İSKONTO' },
    { FISNO: 'GIB202600000001', STHAR_CARIKOD: '5000221968', STOK_ADI: 'TEK ŞİŞE EP 50 CL' },
  ];

  assert.equal(buildInvoiceKinds(lines).has('GIB202600000001'), false);
  assert.deepEqual(
    buildInvoiceKinds(lines, '5000111453').get('GIB202600000001'),
    { key: 'BI', label: 'İskonto Faturası' },
  );
});

test('alacak yönlü özel faturalar ekstrede alt tür etiketi ve tür özeti alır', () => {
  const invoiceKinds = buildInvoiceKinds([
    { FISNO: 'UMT202600000016', STOK_ADI: 'İSKONTO' },
    { FISNO: 'MAI202600000045', STOK_ADI: 'İŞLETME KATKI PAYINIZ' },
  ]);
  const statement = buildStatement({
    customer,
    asOf: '2026-11-19',
    startDate: '2026-01-01',
    endDate: '2026-11-19',
    invoiceKinds,
    movements: [
      movement({ TARIH_GUN: '2026-04-08', VADE_GUN: '2026-04-08', BELGE_NO: 'UMT202600000016', ACIKLAMA: 'FATURANIZ', BORC: 0, ALACAK: 117000, INC_KEY_NUMBER: 1 }),
      movement({ TARIH_GUN: '2026-10-30', VADE_GUN: '2026-10-30', BELGE_NO: 'MAI202600000045', ACIKLAMA: 'FATURANIZ', BORC: 0, ALACAK: 590000, INC_KEY_NUMBER: 2 }),
      movement({ TARIH_GUN: '2026-11-01', VADE_GUN: '2026-12-01', BELGE_NO: 'F1', ACIKLAMA: 'FATURANIZ', BORC: 1000, INC_KEY_NUMBER: 3 }),
    ],
  });

  assert.deepEqual(
    statement.items.map((item) => item.typeLabel),
    ['İskonto Faturası', 'İşletme Katkı Payı', 'Fatura'],
  );
  assert.deepEqual(
    statement.items.map((item) => item.typeKey),
    ['BI', 'BK', 'B'],
  );

  const discount = statement.typeBreakdown.find((item) => item.key === 'BI');
  assert.ok(discount);
  assert.equal(discount.label, 'İskonto Faturası');
  assert.equal(discount.count, 1);
  assert.equal(discount.debit, 0);
  assert.equal(discount.credit, 117000);
  assert.equal(discount.net, -117000);

  const contribution = statement.typeBreakdown.find((item) => item.key === 'BK');
  assert.ok(contribution);
  assert.equal(contribution.label, 'İşletme Katkı Payı');
  assert.equal(contribution.count, 1);
  assert.equal(contribution.credit, 590000);
  assert.equal(contribution.net, -590000);
});

test('Excel tür sütununda özel fatura alt türlerini yazar', async () => {
  const invoiceKinds = buildInvoiceKinds([
    { FISNO: 'UMT202600000016', STOK_ADI: 'İSKONTO' },
    { FISNO: 'MAI202600000045', STOK_ADI: 'İŞLETME KATKI PAYINIZ' },
  ]);
  const statement = buildStatement({
    customer,
    asOf: '2026-11-19',
    startDate: '2026-01-01',
    endDate: '2026-11-19',
    invoiceKinds,
    movements: [
      movement({ TARIH_GUN: '2026-04-08', VADE_GUN: '2026-04-08', BELGE_NO: 'UMT202600000016', BORC: 0, ALACAK: 117000, INC_KEY_NUMBER: 1 }),
      movement({ TARIH_GUN: '2026-10-30', VADE_GUN: '2026-10-30', BELGE_NO: 'MAI202600000045', BORC: 0, ALACAK: 590000, INC_KEY_NUMBER: 2 }),
    ],
  });

  const workbook = buildStatementWorkbook({
    ...statement,
    database: 'TESTDB',
    branch: 0,
    allTime: false,
  });
  const buffer = await workbook.xlsx.writeBuffer();
  const loaded = new ExcelJS.Workbook();
  await loaded.xlsx.load(buffer);
  const worksheet = loaded.getWorksheet('Cari Ekstre');

  assert.equal(worksheet.getCell('J8').value, 'İskonto Faturası');
  assert.equal(worksheet.getCell('J9').value, 'İşletme Katkı Payı');
});

test('fonlanan tutar, fonlama günü ve mevduat faizi hesaplanır', () => {
  const movements = [
    movement({ TARIH_GUN: '2026-01-01', VADE_GUN: '2026-01-31', BORC: 1000, BELGE_NO: 'F1', INC_KEY_NUMBER: 1 }),
    movement({ TARIH_GUN: '2026-01-02', VADE_GUN: '2026-02-01', BORC: 2000, BELGE_NO: 'F2', INC_KEY_NUMBER: 2 }),
    movement({ TARIH_GUN: '2026-02-10', ALACAK: 1000, HAREKET_TURU: 'D', BELGE_NO: 'T1', INC_KEY_NUMBER: 3 }),
  ];
  const statement = buildStatement({
    customer,
    asOf: '2026-02-15',
    startDate: '2026-01-01',
    endDate: '2026-02-15',
    movements,
    paymentMap: buildInvoicePayments({ asOf: '2026-02-15', movements }),
    includeFinance: true,
    depositRate: 36.5,
  });

  const paidInvoice = statement.items[0];
  assert.equal(paidInvoice.paymentStatus, 'paid');
  assert.equal(paidInvoice.interestLateDays, 10);
  assert.equal(paidInvoice.interestLateAmount, 10);
  assert.equal(paidInvoice.interestAmount, 10);

  const openInvoice = statement.items[1];
  assert.equal(openInvoice.paymentStatus, 'open');
  assert.equal(openInvoice.interestOpenDays, 14);
  assert.equal(openInvoice.interestOpenAmount, 28);
  assert.equal(openInvoice.interestAmount, 28);

  assert.equal(statement.finance.depositRate, 36.5);
  assert.equal(statement.finance.isFunding, true);
  assert.equal(statement.finance.fundedAmount, 2000);
  assert.equal(statement.finance.fundedDays, 14);
  assert.equal(statement.finance.fundedInvoiceCount, 1);
  assert.equal(statement.finance.fundedInterest, 28);
  assert.equal(statement.finance.latePaidAmount, 1000);
  assert.equal(statement.finance.latePaidDays, 10);
  assert.equal(statement.finance.latePaidInvoiceCount, 1);
  assert.equal(statement.finance.latePaidInterest, 10);
  assert.equal(statement.finance.totalInterest, 38);
});

test('finans yetkisi yokken faiz alanları üretilmez', () => {
  const movements = [
    movement({ TARIH_GUN: '2026-01-01', VADE_GUN: '2026-01-31', BORC: 1000, BELGE_NO: 'F1', INC_KEY_NUMBER: 1 }),
  ];
  const statement = buildStatement({
    customer,
    asOf: '2026-02-15',
    startDate: '2026-01-01',
    endDate: '2026-02-15',
    movements,
    includeFinance: false,
    depositRate: 36.5,
  });

  assert.equal(statement.finance, null);
  assert.equal(statement.items[0].interestAmount, null);
  assert.equal(statement.items[0].interestOpenAmount, null);
});

test('finans görünürken Excel mevduat faizi sütunu ekler', async () => {
  const movements = [
    movement({ TARIH_GUN: '2026-01-01', VADE_GUN: '2026-01-31', BORC: 1000, BELGE_NO: 'F1', INC_KEY_NUMBER: 1 }),
    movement({ TARIH_GUN: '2026-01-02', VADE_GUN: '2026-02-01', BORC: 2000, BELGE_NO: 'F2', INC_KEY_NUMBER: 2 }),
    movement({ TARIH_GUN: '2026-02-10', ALACAK: 1000, HAREKET_TURU: 'D', BELGE_NO: 'T1', INC_KEY_NUMBER: 3 }),
  ];
  const statement = buildStatement({
    customer,
    asOf: '2026-02-15',
    startDate: '2026-01-01',
    endDate: '2026-02-15',
    movements,
    paymentMap: buildInvoicePayments({ asOf: '2026-02-15', movements }),
    includeFinance: true,
    depositRate: 36.5,
  });

  const workbook = buildStatementWorkbook({
    ...statement,
    database: 'TESTDB',
    branch: 0,
    allTime: false,
  });
  const buffer = await workbook.xlsx.writeBuffer();
  const loaded = new ExcelJS.Workbook();
  await loaded.xlsx.load(buffer);
  const worksheet = loaded.getWorksheet('Cari Ekstre');

  assert.equal(worksheet.getCell('E6').value, 'Mevduat Faizi (TL)');
  assert.equal(worksheet.getCell('F6').value, 'Durum');
  assert.equal(worksheet.getCell('K6').value, 'Tür');
  assert.equal(worksheet.getCell('L6').value, 'Açıklama');
  assert.equal(worksheet.getCell('M6').value, 'Borç');
  assert.equal(worksheet.getCell('O6').value, 'Bakiye');
  assert.equal(worksheet.getCell('K7').value, 'Devir');
  assert.equal(worksheet.getCell('L7').value, 'Devir Bakiyesi');
  assert.equal(worksheet.getCell('E8').value, 10);
  assert.equal(worksheet.getCell('E9').value, 28);
  assert.equal(worksheet.getCell('M11').value, 3000);
  assert.equal(worksheet.getCell('N11').value, 1000);
  assert.equal(worksheet.getCell('O11').value, 2000);
  assert.match(String(worksheet.getCell('A4').value), /Fonlanan:/);
  assert.match(String(worksheet.getCell('A5').value), /Mevduat Faizi:/);
});

test('kuruş dönüşümü ve hareket türü etiketi doğru çalışır', () => {
  assert.equal(toCents(12.34), 1234);
  assert.equal(toCents('0.05'), 5);
  assert.equal(toCents(null), 0);
  assert.equal(typeLabel('K'), 'Havale / FAST');
  assert.equal(typeLabel('Z'), 'Z');
  assert.equal(typeLabel(null), 'Hareket');
});
