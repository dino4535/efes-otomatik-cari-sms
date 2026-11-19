'use strict';

const ExcelJS = require('exceljs');

const COLUMN_DEFINITIONS = [
  { key: 'date', header: 'Tarih', width: 12 },
  { key: 'vade', header: 'Vade Tarihi', width: 12 },
  { key: 'termDays', header: 'Vade Günü', width: 10 },
  { key: 'delay', header: 'Gecikme (Gün)', width: 12 },
  { key: 'interest', header: 'Mevduat Faizi (TL)', width: 14, finance: true },
  { key: 'status', header: 'Durum', width: 12 },
  { key: 'paid', header: 'Ödenen (TL)', width: 14 },
  { key: 'remaining', header: 'Kalan (TL)', width: 14 },
  { key: 'paidDate', header: 'Ödenme Tarihi', width: 12 },
  { key: 'belge', header: 'Belge No', width: 20 },
  { key: 'type', header: 'Tür', width: 15 },
  { key: 'description', header: 'Açıklama', width: 48 },
  { key: 'debit', header: 'Borç', width: 16 },
  { key: 'credit', header: 'Alacak', width: 16 },
  { key: 'balance', header: 'Bakiye', width: 16 },
];

const HEADERS = COLUMN_DEFINITIONS
  .filter((definition) => !definition.finance)
  .map((definition) => definition.header);

function columnLayout(includeFinance) {
  const definitions = COLUMN_DEFINITIONS.filter((definition) => includeFinance || !definition.finance);
  const index = {};
  definitions.forEach((definition, position) => {
    index[definition.key] = position + 1;
  });
  return {
    definitions,
    index,
    lastColumn: definitions.length,
    lastLetter: String.fromCharCode(64 + definitions.length),
  };
}

function columnLetter(columnNumber) {
  return String.fromCharCode(64 + columnNumber);
}

const HEADER_ROW = 6;
const DATA_START_ROW = 7;

const STATUS_LABELS = {
  paid: 'Ödendi',
  partial: 'Kısmi',
  open: 'Açık',
};

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
  return match ? `${match[3]}.${match[2]}.${match[1]}` : '';
}

function toExcelDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return null;
  // ExcelJS tarihi UTC seri numarasına çevirir. Yerel gece yarısı kullanılırsa
  // UTC+3'te bir önceki günün 21:00'i yazılır ve Excel tarihi bir gün geri gösterir.
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function formatDays(value, { signed = false } = {}) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  const number = Number(value);
  const abs = Math.abs(number);
  const formatted = Number.isInteger(abs) ? String(abs) : abs.toFixed(1).replace('.', ',');
  if (signed && number > 0) return `+${formatted} gün`;
  if (signed && number < 0) return `-${formatted} gün`;
  return `${formatted} gün`;
}

function buildStatementWorkbook(data) {
  const includeFinance = Boolean(data.finance);
  const layout = columnLayout(includeFinance);
  const col = layout.index;
  const headerLabels = layout.definitions.map((definition) => definition.header);
  const LAST_COLUMN_LETTER = layout.lastLetter;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Efes Cari SMS';
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;

  const worksheet = workbook.addWorksheet('Cari Ekstre', {
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

  const maturity = data.maturity || {};
  const rangeText = data.allTime
    ? 'Tüm geçmiş'
    : `${formatDateOnly(data.startDate)} – ${formatDateOnly(data.endDate)}`;

  worksheet.mergeCells(`A1:${LAST_COLUMN_LETTER}1`);
  const titleCell = worksheet.getCell('A1');
  titleCell.value = 'Cari Ekstre';
  titleCell.font = { name: 'Calibri', size: 16, bold: true, color: { argb: 'FF1F4E78' } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'left' };
  worksheet.getRow(1).height = 27;

  worksheet.mergeCells(`A2:${LAST_COLUMN_LETTER}2`);
  const metaCell = worksheet.getCell('A2');
  metaCell.value = [
    `Cari: ${data.cariKod} · ${data.cariIsim}`,
    `Veritabanı: ${data.database || ''}`,
    `Şube: ${data.branch}`,
    `Dönem: ${rangeText}`,
    `Rapor Tarihi: ${formatDateOnly(data.asOf) || '—'}`,
  ].join('   |   ');
  metaCell.font = { size: 10, color: { argb: 'FF475569' } };
  metaCell.alignment = { vertical: 'middle', horizontal: 'left' };
  worksheet.getRow(2).height = 20;

  worksheet.mergeCells(`A3:${LAST_COLUMN_LETTER}3`);
  const totalsCell = worksheet.getCell('A3');
  totalsCell.value = [
    `Devir: ${formatMoney(data.openingBalance)} TL`,
    `Dönem Borcu: ${formatMoney(data.totalDebit)} TL`,
    `Dönem Alacağı: ${formatMoney(data.totalCredit)} TL`,
    `Kapanış: ${formatMoney(data.closingBalance)} TL`,
    `Güncel Bakiye: ${formatMoney(data.currentBalance)} TL`,
  ].join('   |   ');
  totalsCell.font = { size: 10, color: { argb: 'FF475569' } };
  totalsCell.alignment = { vertical: 'middle', horizontal: 'left' };
  worksheet.getRow(3).height = 20;

  worksheet.mergeCells(`A4:${LAST_COLUMN_LETTER}4`);
  const maturityCell = worksheet.getCell('A4');
  const maturityParts = [
    `Ağırlıklı Ort. Vade: ${formatDateOnly(maturity.weightedDueDate) || '—'}`,
    `Ortalama Vade: ${formatDays(maturity.averageMaturityDays)}`,
    `Ağırlıklı Ort. Tahsilat: ${formatDateOnly(maturity.weightedCollectionDate) || '—'}`,
    `Ort. Tahsilat Farkı: ${formatDays(maturity.averageCollectionDelayDays, { signed: true })}`,
    `Fatura: ${Number(maturity.invoiceCount || 0)} / ${formatMoney(maturity.invoiceTotal)} TL`,
    `Tahsilat: ${Number(maturity.collectionCount || 0)} / ${formatMoney(maturity.collectionTotal)} TL`,
  ];
  if (data.finance) {
    maturityParts.push(
      `Fonlanan: ${formatMoney(data.finance.fundedAmount)} TL / ${formatDays(data.finance.fundedDays)}`,
      `Mevduat Faiz Kazancı: ${formatMoney(data.finance.totalInterest)} TL`,
    );
  }
  maturityCell.value = maturityParts.join('   |   ');
  maturityCell.font = { size: 10, color: { argb: 'FF475569' } };
  maturityCell.alignment = { vertical: 'middle', horizontal: 'left' };
  worksheet.getRow(4).height = 20;

  worksheet.mergeCells(`A5:${LAST_COLUMN_LETTER}5`);
  const noteCell = worksheet.getCell('A5');
  const noteParts = [
    'Tahsilatlar kayıt tarihi yerine vade tarihine göre işlenir; çeklerde ödeme tarihi çek vadesidir. Vadesi rapor tarihinden sonra olan çekler açık faturayı kapatmaz; bu nedenle açık fatura kalanı ile kapanış bakiyesi farklı olabilir. Gecikme: ödenen faturalarda son tahsilat tarihi − vade; açık veya kısmi faturalarda rapor tarihi − vade. Ödenen/Kalan, faturaya FIFO ile bağlanan tahsilat tutarını gösterir. Durum ve ödenme tarihi seçili bitiş tarihine göredir.',
  ];
  if (data.finance) {
    noteParts.push(
      `Mevduat Faizi: yıllık %${formatMoney(data.finance.depositRate)} oranla basit faiz (anapara × oran × gün / 365). Ödenen faturalarda tahsilat gecikmesi, açık veya kısmi faturalarda rapor tarihine kadar geçen gün esas alınır.`,
    );
  }
  noteCell.value = noteParts.join(' ');
  noteCell.font = { size: 9, italic: true, color: { argb: 'FF64748B' } };
  noteCell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  worksheet.getRow(5).height = data.finance ? 32 : 24;

  const headerRow = worksheet.getRow(HEADER_ROW);
  headerRow.values = headerLabels;
  headerRow.height = 30;
  headerRow.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = thinBorder;
  });

  layout.definitions.forEach((definition, position) => {
    worksheet.getColumn(position + 1).width = definition.width;
  });

  const openingValues = new Array(layout.lastColumn).fill('');
  openingValues[col.type - 1] = 'Devir';
  openingValues[col.description - 1] = 'Devir Bakiyesi';
  openingValues[col.balance - 1] = Number(data.openingBalance || 0);
  const openingRow = worksheet.getRow(DATA_START_ROW);
  openingRow.values = openingValues;
  openingRow.height = 19;
  openingRow.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
    cell.font = { size: 10, bold: true, color: { argb: 'FF475569' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDF2F7' } };
    cell.border = thinBorder;
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
    if (columnNumber === col.balance) {
      cell.numFmt = '#,##0.00;[Red]-#,##0.00';
      cell.alignment = { vertical: 'middle', horizontal: 'right' };
    } else if (columnNumber === col.description) {
      cell.alignment = { vertical: 'middle', horizontal: 'left' };
    }
  });

  const statusFills = {
    paid: { fill: 'FFE8F7EE', font: 'FF166534' },
    partial: { fill: 'FFFFF7ED', font: 'FF9A3412' },
    open: { fill: 'FFF1F5F9', font: 'FF475569' },
  };

  data.items.forEach((item, index) => {
    const rowNumber = DATA_START_ROW + 1 + index;
    const row = worksheet.getRow(rowNumber);
    const statusText = item.paymentStatusLabel || STATUS_LABELS[item.paymentStatus] || '';
    const rowValues = new Array(layout.lastColumn).fill(null);
    rowValues[col.date - 1] = toExcelDate(item.date);
    rowValues[col.vade - 1] = toExcelDate(item.vade);
    rowValues[col.termDays - 1] = item.termDays === null || item.termDays === undefined
      ? null
      : Number(item.termDays);
    rowValues[col.delay - 1] = item.direction === 'debit' && item.overdueDays !== null
      ? Number(item.overdueDays)
      : null;
    if (col.interest) {
      rowValues[col.interest - 1] = Number(item.interestAmount || 0) > 0
        ? Number(item.interestAmount)
        : null;
    }
    rowValues[col.status - 1] = statusText;
    rowValues[col.paid - 1] = item.paymentStatus ? Number(item.paidAmount || 0) : null;
    rowValues[col.remaining - 1] = item.paymentStatus ? Number(item.remainingAmount || 0) : null;
    rowValues[col.paidDate - 1] = toExcelDate(item.paidDate);
    rowValues[col.belge - 1] = item.belgeNo || '';
    rowValues[col.type - 1] = item.typeLabel || item.type || '';
    rowValues[col.description - 1] = item.description || '';
    rowValues[col.debit - 1] = item.debit ? Number(item.debit) : null;
    rowValues[col.credit - 1] = item.credit ? Number(item.credit) : null;
    rowValues[col.balance - 1] = Number(item.balance || 0);
    row.values = rowValues;
    row.height = 18;
    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      cell.font = { size: 10 };
      cell.border = thinBorder;
      cell.alignment = { vertical: 'middle', horizontal: 'left' };

      if (index % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF6F9FC' } };
      }

      if (columnNumber === col.date || columnNumber === col.vade || columnNumber === col.paidDate) {
        cell.numFmt = 'dd.mm.yyyy';
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      } else if (columnNumber === col.termDays || columnNumber === col.delay) {
        cell.numFmt = '0';
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      } else if (columnNumber === col.status) {
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        const style = statusFills[item.paymentStatus];
        if (style) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: style.fill } };
          cell.font = { size: 10, bold: true, color: { argb: style.font } };
        }
      } else if (columnNumber === col.paid
        || columnNumber === col.remaining
        || columnNumber === col.interest
        || columnNumber >= col.debit) {
        cell.numFmt = '#,##0.00;[Red]-#,##0.00';
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
      }
    });

    if (item.direction === 'debit' && Number(item.overdueDays || 0) >= 30) {
      row.getCell(col.delay).font = { size: 10, bold: true, color: { argb: 'FFC0392B' } };
    }
  });

  const lastDataRow = DATA_START_ROW + data.items.length;
  const totalsRowNumber = lastDataRow + 1;
  const totalsRow = worksheet.getRow(totalsRowNumber);
  worksheet.mergeCells(`A${totalsRowNumber}:${columnLetter(col.description)}${totalsRowNumber}`);
  totalsRow.getCell(1).value = 'Dönem Toplamı';
  totalsRow.getCell(col.debit).value = Number(data.totalDebit || 0);
  totalsRow.getCell(col.credit).value = Number(data.totalCredit || 0);
  totalsRow.getCell(col.balance).value = Number(data.closingBalance || 0);
  totalsRow.height = 22;
  totalsRow.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
    cell.font = { size: 10, bold: true, color: { argb: 'FF1F4E78' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F1FA' } };
    cell.border = {
      ...thinBorder,
      top: { style: 'medium', color: { argb: 'FF1F4E78' } },
    };
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
    if (columnNumber >= col.debit) {
      cell.numFmt = '#,##0.00;[Red]-#,##0.00';
      cell.alignment = { vertical: 'middle', horizontal: 'right' };
    }
  });

  const filterEndRow = data.items.length ? lastDataRow : HEADER_ROW;
  worksheet.autoFilter = {
    from: { row: HEADER_ROW, column: 1 },
    to: { row: filterEndRow, column: layout.lastColumn },
  };

  return workbook;
}

module.exports = {
  buildStatementWorkbook,
  HEADERS,
  COLUMN_DEFINITIONS,
  columnLayout,
  formatDays,
};
