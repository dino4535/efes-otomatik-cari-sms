'use strict';

const ExcelJS = require('exceljs');

const HEADER_ROW = 6;
const DATA_START_ROW = 7;

const COLUMN_DEFINITIONS = [
  { key: 'code', header: 'Stok Kodu', width: 14 },
  { key: 'name', header: 'Stok Adı', width: 46 },
  { key: 'group', header: 'Grup', width: 12 },
  { key: 'unit', header: 'Birim', width: 8 },
  { key: 'stock', header: 'Stok', width: 13 },
  { key: 'litre', header: 'Stok (Lt)', width: 12 },
  { key: 'adet', header: 'Stok (Adet)', width: 12 },
  { key: 'lastPurchaseDate', header: 'Son Alış Tarihi', width: 13 },
  { key: 'lastPurchasePrice', header: 'Son Alış Fiyatı', width: 14 },
  { key: 'value', header: 'Stok Değeri (TL)', width: 15 },
  { key: 'lastSaleDate', header: 'Son Satış Tarihi', width: 13 },
  { key: 'lastSalePrice', header: 'Son Satış Fiyatı', width: 14 },
  { key: 'lastSalePriceLt', header: 'Son Satış Lt Fiyatı', width: 15 },
  { key: 'avgDailySales', header: 'Ort. Günlük Satış', width: 15 },
  { key: 'stockDays', header: 'Stok Günü', width: 11 },
  { key: 'avgAgeDays', header: 'Ort. Stok Yaşı (Gün)', width: 16 },
  { key: 'oldestAgeDays', header: 'En Eski Parti (Gün)', width: 16 },
  { key: 'state', header: 'Durum', width: 11 },
];

const STATE_LABELS = {
  in: 'Stokta',
  zero: 'Sıfır',
  negative: 'Negatif',
};

const STATE_STYLES = {
  in: { fill: 'FFE8F7EE', font: 'FF166534' },
  zero: { fill: 'FFF1F5F9', font: 'FF475569' },
  negative: { fill: 'FFFEE2E2', font: 'FF991B1B' },
};

const thinBorder = {
  top: { style: 'thin', color: { argb: 'FFD9E2EC' } },
  left: { style: 'thin', color: { argb: 'FFD9E2EC' } },
  bottom: { style: 'thin', color: { argb: 'FFD9E2EC' } },
  right: { style: 'thin', color: { argb: 'FFD9E2EC' } },
};

function columnLetter(columnNumber) {
  return String.fromCharCode(64 + columnNumber);
}

function formatDateOnly(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  return match ? `${match[3]}.${match[2]}.${match[1]}` : '';
}

function toExcelDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function formatNumber(value, digits = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return number.toLocaleString('tr-TR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

function formatMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return number.toLocaleString('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function buildStockWorkbook(data) {
  const items = data.items || [];
  const summary = data.summary || {};
  const lastColumn = COLUMN_DEFINITIONS.length;
  const lastColumnLetter = columnLetter(lastColumn);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Efes Cari SMS';
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;

  const worksheet = workbook.addWorksheet('Stok Durumu', {
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

  worksheet.mergeCells(`A1:${lastColumnLetter}1`);
  const titleCell = worksheet.getCell('A1');
  titleCell.value = 'Stok Durumu';
  titleCell.font = { name: 'Calibri', size: 16, bold: true, color: { argb: 'FF1F4E78' } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'left' };
  worksheet.getRow(1).height = 27;

  worksheet.mergeCells(`A2:${lastColumnLetter}2`);
  const metaCell = worksheet.getCell('A2');
  metaCell.value = [
    `Veritabanı: ${data.database || ''}`,
    `Şube: ${data.branch}`,
    `Rapor Tarihi: ${formatDateOnly(data.asOf) || '—'}`,
    `Satış Penceresi: ${Number(data.windowDays || 30)} gün`,
    `Durum: ${data.state === 'all' ? 'Tümü' : STATE_LABELS[data.state] || 'Stokta'}`,
    `Hizmet Kalemleri: ${data.includeService ? 'Dahil' : 'Hariç'}`,
    data.search ? `Arama: ${data.search}` : null,
  ].filter(Boolean).join('   |   ');
  metaCell.font = { size: 10, color: { argb: 'FF475569' } };
  metaCell.alignment = { vertical: 'middle', horizontal: 'left' };
  worksheet.getRow(2).height = 20;

  worksheet.mergeCells(`A3:${lastColumnLetter}3`);
  const summaryCell = worksheet.getCell('A3');
  summaryCell.value = [
    `Ürün: ${Number(summary.productCount || 0)}`,
    `Stokta: ${Number(summary.inStockCount || 0)}`,
    `Sıfır: ${Number(summary.zeroCount || 0)}`,
    `Negatif: ${Number(summary.negativeCount || 0)}`,
    `Toplam Lt: ${formatNumber(summary.totalLt, 1)}`,
    `Toplam Adet: ${formatNumber(summary.totalAd, 1)}`,
    `Stok Değeri: ${formatMoney(summary.totalValue)} TL`,
    `Ort. Stok Yaşı: ${formatNumber(summary.averageAgeDays, 1)} gün`,
  ].join('   |   ');
  summaryCell.font = { size: 10, color: { argb: 'FF475569' } };
  summaryCell.alignment = { vertical: 'middle', horizontal: 'left' };
  worksheet.getRow(3).height = 20;

  worksheet.mergeCells(`A4:${lastColumnLetter}4`);
  const noteCell = worksheet.getCell('A4');
  noteCell.value = [
    'Stok miktarı TBLSTHAR giriş/çıkış hareketlerinden hesaplanır; TBLSTSABIT.MIKTAR ve STOKPH kullanılmaz.',
    'Son alış: en güncel L/G hareketi; son satış: en güncel J/C hareketi. Fiyatlar birincil birim (OLCU_BR1) fiyatıdır; NF yoksa BF kullanılır.',
    'Ortalama satış, seçili penceredeki J/C satış miktarının gün sayısına bölümüdür. Stok günü = stok / ortalama günlük satış; ortalama satış sıfırsa boş bırakılır.',
    'Stok yaşı FIFO ile hesaplanır: en yeni giriş partileri stokta kalır. Ort. stok yaşı stokla ağırlıklıdır; en eski parti, stokta kalan en eski giriş partisidir.',
    'Litre; birim dönüşümü tanımlıysa OLCU_BR1/2/3 üzerinden, tanımlı değilse ürün adındaki CL/ML/LT/L ve koli çarpanlarından hesaplanır. 003/004/6xx kodlu ve ŞİŞE/KASA/PALET/FIÇI gibi ambalaj/malzeme kartları litreye dahil edilmez.',
    'EFES grubundaki 900xxx/EFESxx kodları ile HİZMET BEDELLERİ fiziksel stok olmadığından varsayılan olarak listelenmez; istenirse "Hizmet/EFES kalemlerini göster" ile dahil edilir.',
  ].join(' ');
  noteCell.font = { size: 9, italic: true, color: { argb: 'FF64748B' } };
  noteCell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  worksheet.getRow(4).height = 66;

  const headerRow = worksheet.getRow(HEADER_ROW);
  headerRow.values = COLUMN_DEFINITIONS.map((definition) => definition.header);
  headerRow.height = 30;
  headerRow.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = thinBorder;
  });

  COLUMN_DEFINITIONS.forEach((definition, position) => {
    worksheet.getColumn(position + 1).width = definition.width;
  });

  items.forEach((item, index) => {
    const rowNumber = DATA_START_ROW + index;
    const row = worksheet.getRow(rowNumber);
    row.values = [
      item.code,
      item.name,
      item.group || '',
      item.primaryUnit || '',
      item.stock,
      item.stockLt,
      item.stockAd,
      toExcelDate(item.lastPurchaseDate),
      item.lastPurchasePrice,
      item.value,
      toExcelDate(item.lastSaleDate),
      item.lastSalePrice,
      item.lastSalePriceLt,
      item.avgDailySales,
      item.stockDays,
      item.avgAgeDays,
      item.oldestAgeDays,
      STATE_LABELS[item.state] || '',
    ];
    row.height = 18;
    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      cell.font = { size: 10 };
      cell.border = thinBorder;
      cell.alignment = { vertical: 'middle', horizontal: 'left' };

      if (index % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF6F9FC' } };
      }

      const definition = COLUMN_DEFINITIONS[columnNumber - 1];
      if (!definition) return;

      if (definition.key === 'lastPurchaseDate' || definition.key === 'lastSaleDate') {
        cell.numFmt = 'dd.mm.yyyy';
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      } else if (definition.key === 'stock' || definition.key === 'litre' || definition.key === 'adet') {
        cell.numFmt = '#,##0.###;[Red]-#,##0.###';
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
      } else if (definition.key === 'lastPurchasePrice'
        || definition.key === 'lastSalePrice'
        || definition.key === 'lastSalePriceLt'
        || definition.key === 'value') {
        cell.numFmt = '#,##0.00;[Red]-#,##0.00';
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
      } else if (definition.key === 'avgDailySales') {
        cell.numFmt = '#,##0.###;[Red]-#,##0.###';
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
      } else if (definition.key === 'stockDays'
        || definition.key === 'avgAgeDays'
        || definition.key === 'oldestAgeDays') {
        cell.numFmt = '#,##0.0;[Red]-#,##0.0';
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
      } else if (definition.key === 'state') {
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        const style = STATE_STYLES[item.state];
        if (style) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: style.fill } };
          cell.font = { size: 10, bold: true, color: { argb: style.font } };
        }
      }
    });

    if (item.state === 'negative') {
      row.getCell(5).font = { size: 10, bold: true, color: { argb: 'FFC0392B' } };
    }
  });

  const lastDataRow = DATA_START_ROW + items.length - 1;
  const totalsRowNumber = Math.max(DATA_START_ROW, lastDataRow + 1);
  const totalsRow = worksheet.getRow(totalsRowNumber);
  worksheet.mergeCells(`A${totalsRowNumber}:C${totalsRowNumber}`);
  totalsRow.getCell(1).value = `Toplam · ${items.length} ürün`;
  totalsRow.getCell(6).value = summary.totalLt;
  totalsRow.getCell(7).value = summary.totalAd;
  totalsRow.getCell(10).value = summary.totalValue;
  totalsRow.height = 22;
  totalsRow.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
    cell.font = { size: 10, bold: true, color: { argb: 'FF1F4E78' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F1FA' } };
    cell.border = {
      ...thinBorder,
      top: { style: 'medium', color: { argb: 'FF1F4E78' } },
    };
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
    if (columnNumber === 6 || columnNumber === 7) {
      cell.numFmt = '#,##0.###;[Red]-#,##0.###';
      cell.alignment = { vertical: 'middle', horizontal: 'right' };
    } else if (columnNumber === 10) {
      cell.numFmt = '#,##0.00;[Red]-#,##0.00';
      cell.alignment = { vertical: 'middle', horizontal: 'right' };
    }
  });

  const filterEndRow = items.length ? lastDataRow : HEADER_ROW;
  worksheet.autoFilter = {
    from: { row: HEADER_ROW, column: 1 },
    to: { row: filterEndRow, column: lastColumn },
  };

  return workbook;
}

module.exports = {
  buildStockWorkbook,
  COLUMN_DEFINITIONS,
  HEADER_ROW,
  DATA_START_ROW,
};
