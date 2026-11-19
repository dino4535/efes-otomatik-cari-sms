'use strict';

const ExcelJS = require('exceljs');

const HEADERS = [
  'Cari Kod',
  'Cari İsim',
  'Telefon',
  'Toplam Açık Borç',
  '0-14 Gün',
  '15-21 Gün',
  '22-30 Gün',
  '31-45 Gün',
  '46-60 Gün',
  '61+ Gün',
  '30+ Gün Toplam',
  'En Yaşlı Gün',
  'En Yaşlı Fatura Tarihi',
  'Cari Bakiye',
];

const AMOUNT_COLUMNS = [4, 5, 6, 7, 8, 9, 10, 11, 14];
const DATA_START_ROW = 6;
const HEADER_ROW = 5;
const LAST_COLUMN = HEADERS.length;

const thinBorder = {
  top: { style: 'thin', color: { argb: 'FFD9E2EC' } },
  left: { style: 'thin', color: { argb: 'FFD9E2EC' } },
  bottom: { style: 'thin', color: { argb: 'FFD9E2EC' } },
  right: { style: 'thin', color: { argb: 'FFD9E2EC' } },
};

function formatMoney(value) {
  return new Intl.NumberFormat('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function formatDateOnly(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  return match ? `${match[3]}.${match[2]}.${match[1]}` : String(value || '');
}

function toExcelDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return value || null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function buildAgingWorkbook(data) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Efes Cari SMS';
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;

  const worksheet = workbook.addWorksheet('Yaşlandırma', {
    views: [{ state: 'frozen', ySplit: HEADER_ROW }],
    pageSetup: {
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      paperSize: 9,
      printTitlesRow: `${HEADER_ROW}:${HEADER_ROW}`,
    },
  });

  const mode = data.includePrepaid ? 'Dahil' : 'Hariç';
  const summary = data.summary || {};
  const customerCount = data.customers.length;

  worksheet.mergeCells(`A1:${String.fromCharCode(64 + LAST_COLUMN)}1`);
  const titleCell = worksheet.getCell('A1');
  titleCell.value = 'Cari Yaşlandırma Raporu';
  titleCell.font = { name: 'Calibri', size: 16, bold: true, color: { argb: 'FF1F4E78' } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'left' };
  worksheet.getRow(1).height = 26;

  worksheet.mergeCells(`A2:${String.fromCharCode(64 + LAST_COLUMN)}2`);
  const metaCell = worksheet.getCell('A2');
  metaCell.value = [
    `Rapor Tarihi: ${formatDateOnly(data.asOf)}`,
    `Veritabanı: ${data.database || ''}`,
    `Şube: ${data.branch}`,
    `Peşin Faturalar: ${mode}`,
    `Tolerans: ${formatMoney(data.tolerance)} TL`,
  ].join('   |   ');
  metaCell.font = { size: 10, color: { argb: 'FF475569' } };
  metaCell.alignment = { vertical: 'middle', horizontal: 'left' };
  worksheet.getRow(2).height = 20;

  worksheet.mergeCells(`A3:${String.fromCharCode(64 + LAST_COLUMN)}3`);
  const summaryCell = worksheet.getCell('A3');
  summaryCell.value = [
    `Toplam Açık Borç: ${formatMoney(summary.totalDebt)} TL`,
    `30+ Gecikmiş: ${formatMoney(summary.overdue30)} TL`,
    `30+ Borçlu Cari: ${Number(summary.overdueCustomerCount || 0)}`,
    `Açık Borçlu Cari: ${Number(summary.debtorCount || customerCount)}`,
  ].join('   |   ');
  summaryCell.font = { size: 10, color: { argb: 'FF475569' } };
  summaryCell.alignment = { vertical: 'middle', horizontal: 'left' };
  worksheet.getRow(3).height = 20;

  worksheet.getRow(4).height = 8;

  const headerRow = worksheet.getRow(HEADER_ROW);
  headerRow.values = HEADERS;
  headerRow.height = 30;
  headerRow.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = thinBorder;
  });

  const columnWidths = [14, 42, 16, 16, 12, 12, 12, 12, 12, 12, 14, 12, 20, 16];
  columnWidths.forEach((width, index) => {
    worksheet.getColumn(index + 1).width = width;
  });

  data.customers.forEach((customer, index) => {
    const rowNumber = DATA_START_ROW + index;
    const row = worksheet.getRow(rowNumber);
    row.values = [
      customer.cariKod,
      customer.cariIsim,
      customer.phone || customer.rawPhone || '',
      Number(customer.totalDebt || 0),
      Number(customer.buckets?.d0_14 || 0),
      Number(customer.buckets?.d15_21 || 0),
      Number(customer.buckets?.d22_30 || 0),
      Number(customer.buckets?.d31_45 || 0),
      Number(customer.buckets?.d46_60 || 0),
      Number(customer.buckets?.d61 || 0),
      Number(customer.overdue30 || 0),
      Number(customer.oldestDays || 0),
      toExcelDate(customer.oldestDate),
      Number(customer.balance || 0),
    ];

    row.height = 18;
    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      cell.font = { size: 10 };
      cell.border = thinBorder;
      cell.alignment = { vertical: 'middle', horizontal: 'left' };

      if (AMOUNT_COLUMNS.includes(columnNumber)) {
        cell.numFmt = '#,##0.00;[Red]-#,##0.00';
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
      } else if (columnNumber === 12) {
        cell.numFmt = '0';
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
      } else if (columnNumber === 13) {
        cell.numFmt = 'dd.mm.yyyy';
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      }
    });

    if (Number(customer.overdue30 || 0) > 0) {
      row.getCell(11).font = { size: 10, bold: true, color: { argb: 'FFC0392B' } };
    }
    if (Number(customer.oldestDays || 0) >= 31) {
      row.getCell(12).font = { size: 10, bold: true, color: { argb: 'FFC0392B' } };
    }
    if (index % 2 === 1) {
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF6F9FC' } };
      });
    }
  });

  const lastDataRow = DATA_START_ROW + customerCount - 1;
  const totalsRowNumber = lastDataRow + 1;
  const totalsRow = worksheet.getRow(totalsRowNumber);
  totalsRow.getCell(1).value = 'TOPLAM';
  totalsRow.getCell(2).value = `${customerCount} cari`;
  totalsRow.height = 22;

  const hasData = customerCount > 0;
  const totalCell = (columnNumber) => {
    if (!hasData) return 0;
    const letter = worksheet.getColumn(columnNumber).letter;
    return { formula: `SUM(${letter}${DATA_START_ROW}:${letter}${lastDataRow})` };
  };

  for (const columnNumber of AMOUNT_COLUMNS) {
    totalsRow.getCell(columnNumber).value = totalCell(columnNumber);
  }
  totalsRow.getCell(11).value = totalCell(11);
  totalsRow.getCell(12).value = hasData
    ? { formula: `MAX(L${DATA_START_ROW}:L${lastDataRow})` }
    : 0;

  totalsRow.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
    cell.font = { size: 10, bold: true, color: { argb: 'FF1F4E78' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F1FA' } };
    cell.border = {
      ...thinBorder,
      top: { style: 'medium', color: { argb: 'FF1F4E78' } },
    };
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
    if (AMOUNT_COLUMNS.includes(columnNumber) || columnNumber === 11) {
      cell.numFmt = '#,##0.00;[Red]-#,##0.00';
      cell.alignment = { vertical: 'middle', horizontal: 'right' };
    } else if (columnNumber === 12) {
      cell.numFmt = '0';
      cell.alignment = { vertical: 'middle', horizontal: 'right' };
    }
  });

  const filterEndRow = hasData ? lastDataRow : HEADER_ROW;
  worksheet.autoFilter = {
    from: { row: HEADER_ROW, column: 1 },
    to: { row: filterEndRow, column: LAST_COLUMN },
  };

  return workbook;
}

module.exports = {
  buildAgingWorkbook,
  HEADERS,
};
