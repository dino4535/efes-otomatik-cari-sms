'use strict';

const sql = require('mssql');
const { getAging } = require('../src/services/aging');
const { getPool, closePool } = require('../src/db/erp');
const { todayInIstanbul } = require('../src/utils/dates');

function format(value) {
  return new Intl.NumberFormat('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

async function erpControlTotal(asOf, branch) {
  const pool = await getPool();
  const request = pool.request();
  request.input('branch', sql.SmallInt, branch);
  request.input('asOf', sql.Date, asOf);
  const result = await request.query(`
    SELECT
      COUNT(*) AS debtor_count,
      SUM(CASE WHEN bakiye > 0 THEN bakiye ELSE 0 END) AS positive_total,
      SUM(CASE WHEN bakiye < 0 THEN bakiye ELSE 0 END) AS negative_total
    FROM (
      SELECT h.CARI_KOD, SUM(ISNULL(h.BORC, 0) - ISNULL(h.ALACAK, 0)) AS bakiye
      FROM TBLCAHAR h WITH (NOLOCK)
      INNER JOIN TBLCASABIT s WITH (NOLOCK)
        ON s.CARI_KOD = h.CARI_KOD
       AND s.SUBE_KODU IN (@branch, -1)
       AND s.CARI_TIP = 'A'
      WHERE h.SUBE_KODU = @branch
        AND h.TARIH < DATEADD(day, 1, @asOf)
        AND h.HAREKET_TURU IN ('A', 'B', 'C', 'D', 'E', 'G', 'K')
      GROUP BY h.CARI_KOD
    ) t
  `);
  return result.recordset[0];
}

async function main() {
  const asOf = process.argv[2] || todayInIstanbul();
  console.log(`Rapor tarihi: ${asOf}`);
  console.log('ERP verileri okunuyor ve yaşlandırma hesaplanıyor...\n');

  const started = Date.now();
  const data = await getAging({ asOf, force: true });
  const erp = await erpControlTotal(asOf, data.branch);
  const elapsed = Date.now() - started;

  const erpPositive = Number(erp.positive_total || 0);
  const erpNegative = Number(erp.negative_total || 0);
  const difference = data.summary.controlTotal - erpPositive;

  console.log(`Süre                 : ${elapsed} ms`);
  console.log(`Hareket sayısı        : ${data.movementCount.toLocaleString('tr-TR')}`);
  console.log(`Cari sayısı          : ${data.customerCount.toLocaleString('tr-TR')}`);
  console.log(`Açık borçlu cari     : ${data.summary.debtorCount.toLocaleString('tr-TR')}`);
  console.log(`30+ borçlu cari      : ${data.summary.overdueCustomerCount.toLocaleString('tr-TR')}`);
  console.log('');
  console.log(`Toplam açık borç     : ${format(data.summary.totalDebt)} TL`);
  console.log(`30+ gecikmiş         : ${format(data.summary.overdue30)} TL`);
  console.log(`0-14 gün             : ${format(data.summary.buckets.d0_14)} TL`);
  console.log(`15-21 gün            : ${format(data.summary.buckets.d15_21)} TL`);
  console.log(`22-30 gün            : ${format(data.summary.buckets.d22_30)} TL`);
  console.log(`31-45 gün            : ${format(data.summary.buckets.d31_45)} TL`);
  console.log(`46-60 gün            : ${format(data.summary.buckets.d46_60)} TL`);
  console.log(`61+ gün              : ${format(data.summary.buckets.d61)} TL`);
  console.log('');
  console.log(`Kontrol toplamı      : ${format(data.summary.controlTotal)} TL`);
  console.log(`ERP pozitif bakiye   : ${format(erpPositive)} TL`);
  console.log(`ERP negatif bakiye   : ${format(erpNegative)} TL`);
  console.log(`Fark                 : ${format(difference)} TL`);
  console.log('');

  if (Math.abs(difference) > 1) {
    console.error('HATA: Yaşlandırma kontrol toplamı ERP cari bakiyeleriyle uyuşmuyor.');
    process.exitCode = 1;
  } else if (Math.abs(difference) > 0.001) {
    console.log(`OK: Kontrol toplamı ERP ile uyumlu (${format(difference)} TL yuvarlama farkı).`);
  } else {
    console.log('OK: Kontrol toplamı ERP cari bakiyeleriyle birebir uyumlu.');
  }
}

main()
  .catch((error) => {
    console.error('Kontrol başarısız:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
