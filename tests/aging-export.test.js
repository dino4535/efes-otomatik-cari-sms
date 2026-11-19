'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');

const { buildAgingWorkbook } = require('../src/services/agingExcel');

function sampleData() {
  return {
    asOf: '2026-11-12',
    database: 'TESTDB',
    branch: 3,
    tolerance: 0,
    includePrepaid: false,
    summary: {
      totalDebt: 2500,
      overdue30: 1500,
      overdueCustomerCount: 1,
      debtorCount: 2,
      controlTotal: 2500,
    },
    customers: [
      {
        cariKod: 'C1',
        cariIsim: 'Test Cari 1',
        phone: '+905321234567',
        totalDebt: 1000,
        buckets: { d0_14: 1000, d15_21: 0, d22_30: 0, d31_45: 0, d46_60: 0, d61: 0 },
        overdue30: 0,
        oldestDays: 5,
        oldestDate: '2026-11-07',
        balance: 1000,
      },
      {
        cariKod: '0002',
        cariIsim: 'Test Cari 2',
        phone: '',
        rawPhone: '0533',
        totalDebt: 1500,
        buckets: { d0_14: 0, d15_21: 0, d22_30: 0, d31_45: 1500, d46_60: 0, d61: 0 },
        overdue30: 1500,
        oldestDays: 42,
        oldestDate: '2026-10-01',
        balance: 1500,
      },
    ],
  };
}

test('yaşlandırma Excel çıktısı başlık, veri ve toplam satırı içerir', async () => {
  const workbook = buildAgingWorkbook(sampleData());
  const sheet = workbook.getWorksheet('Yaşlandırma');

  assert.ok(sheet);
  assert.equal(sheet.getCell('A1').value, 'Cari Yaşlandırma Raporu');
  assert.match(sheet.getCell('A2').value, /Veritabanı: TESTDB/);
  assert.equal(sheet.getCell('A5').value, 'Cari Kod');
  assert.equal(sheet.getCell('N5').value, 'Cari Bakiye');
  assert.equal(sheet.getCell('A6').value, 'C1');
  assert.equal(sheet.getCell('B6').value, 'Test Cari 1');
  assert.equal(sheet.getCell('D6').value, 1000);
  assert.equal(sheet.getCell('M6').value instanceof Date, true);
  assert.equal(sheet.getCell('A8').value, 'TOPLAM');
  assert.deepEqual(sheet.getCell('D8').value, { formula: 'SUM(D6:D7)' });
  assert.deepEqual(sheet.getCell('K8').value, { formula: 'SUM(K6:K7)' });
  assert.deepEqual(sheet.getCell('L8').value, { formula: 'MAX(L6:L7)' });
  assert.equal(sheet.views[0].ySplit, 5);
  assert.equal(sheet.autoFilter.to.row, 7);
});

test('yaşlandırma Excel dosyası yeniden okunabilir', async () => {
  const workbook = buildAgingWorkbook(sampleData());
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

  assert.ok(buffer.length > 0);

  const readWorkbook = new ExcelJS.Workbook();
  await readWorkbook.xlsx.load(buffer);
  const sheet = readWorkbook.getWorksheet('Yaşlandırma');

  assert.ok(sheet);
  assert.equal(sheet.getCell('A6').value, 'C1');
  assert.equal(sheet.getCell('B7').value, 'Test Cari 2');
  assert.equal(sheet.getCell('D7').value, 1500);
});
