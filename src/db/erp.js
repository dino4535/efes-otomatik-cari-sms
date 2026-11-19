'use strict';

const sql = require('mssql');
const { getErpConfig } = require('../services/erpConfig');
const { decodeErpText } = require('../utils/encoding');

function buildPoolConfig(erp) {
  return {
    server: erp.server,
    port: erp.port,
    database: erp.database,
    user: erp.user,
    password: erp.password,
    options: {
      encrypt: erp.encrypt,
      trustServerCertificate: erp.trustServerCertificate,
      enableArithAbort: true,
    },
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000,
    },
    connectionTimeout: 15000,
    requestTimeout: 60000,
  };
}

function connectionKey(erp) {
  return [
    erp.server,
    erp.port,
    erp.database,
    erp.user,
    erp.password,
    erp.encrypt ? '1' : '0',
    erp.trustServerCertificate ? '1' : '0',
  ].join('\u0000');
}

const MAX_POOLS = 12;
const pools = new Map();

function getPool({ database } = {}) {
  const erp = getErpConfig();
  if (database !== undefined && database !== null && String(database).trim() !== '') {
    erp.database = String(database).trim();
  }
  const key = connectionKey(erp);

  if (pools.has(key)) {
    const existing = pools.get(key);
    // LRU sırasını güncelle.
    pools.delete(key);
    pools.set(key, existing);
    return existing;
  }

  const pool = new sql.ConnectionPool(buildPoolConfig(erp));
  const promise = pool.connect().catch((error) => {
    pools.delete(key);
    throw error;
  });
  pools.set(key, promise);

  if (pools.size > MAX_POOLS) {
    const oldestKey = pools.keys().next().value;
    if (oldestKey !== key) {
      const oldest = pools.get(oldestKey);
      pools.delete(oldestKey);
      oldest.then((item) => item.close()).catch(() => {});
    }
  }

  return promise;
}

async function getAgingMovements({ branch, asOf, customerType, database }) {
  const pool = await getPool({ database });
  const request = pool.request();
  request.input('branch', sql.SmallInt, branch);
  request.input('asOf', sql.Date, asOf);
  request.input('customerType', sql.Char(1), customerType);
  const result = await request.query(`
    SELECT
      CONVERT(varbinary(100), h.CARI_KOD) AS CARI_KOD_BYTES,
      CONVERT(char(10), h.TARIH, 23) AS TARIH_GUN,
      CONVERT(char(19), h.TARIH, 120) AS TARIH_STR,
      CONVERT(char(10), h.VADE_TARIHI, 23) AS VADE_GUN,
      h.BELGE_NO,
      CONVERT(varbinary(100), h.ACIKLAMA) AS ACIKLAMA_BYTES,
      h.HAREKET_TURU,
      ISNULL(h.BORC, 0) AS BORC,
      ISNULL(h.ALACAK, 0) AS ALACAK,
      h.INC_KEY_NUMBER
    FROM TBLCAHAR h WITH (NOLOCK)
    INNER JOIN TBLCASABIT s WITH (NOLOCK)
      ON s.CARI_KOD = h.CARI_KOD
     AND s.SUBE_KODU IN (@branch, -1)
     AND s.CARI_TIP = @customerType
    WHERE h.SUBE_KODU = @branch
      AND h.TARIH < DATEADD(day, 1, @asOf)
      AND h.HAREKET_TURU IN ('A', 'B', 'C', 'D', 'E', 'G', 'K')
    ORDER BY h.CARI_KOD, h.TARIH, h.INC_KEY_NUMBER
  `);
  return result.recordset.map(({ CARI_KOD_BYTES, ACIKLAMA_BYTES, ...row }) => ({
    ...row,
    CARI_KOD: decodeErpText(CARI_KOD_BYTES),
    ACIKLAMA: decodeErpText(ACIKLAMA_BYTES),
  }));
}

async function getCustomers({ branch, customerType, database }) {
  const pool = await getPool({ database });
  const request = pool.request();
  request.input('branch', sql.SmallInt, branch);
  request.input('customerType', sql.Char(1), customerType);
  const result = await request.query(`
    SELECT
      CONVERT(varbinary(100), CARI_KOD) AS CARI_KOD_BYTES,
      CONVERT(varbinary(200), CARI_ISIM) AS CARI_ISIM_BYTES,
      CARI_TEL,
      GSM1,
      GSM2,
      EMAIL,
      CONVERT(varbinary(100), CARI_IL) AS CARI_IL_BYTES,
      CONVERT(varbinary(100), CARI_ILCE) AS CARI_ILCE_BYTES,
      VERGI_NUMARASI
    FROM TBLCASABIT WITH (NOLOCK)
    WHERE SUBE_KODU IN (@branch, -1)
      AND CARI_TIP = @customerType
    ORDER BY CARI_KOD
  `);
  return result.recordset.map(({
    CARI_KOD_BYTES,
    CARI_ISIM_BYTES,
    CARI_IL_BYTES,
    CARI_ILCE_BYTES,
    ...row
  }) => ({
    ...row,
    CARI_KOD: decodeErpText(CARI_KOD_BYTES),
    CARI_ISIM: decodeErpText(CARI_ISIM_BYTES),
    CARI_IL: decodeErpText(CARI_IL_BYTES),
    CARI_ILCE: decodeErpText(CARI_ILCE_BYTES),
  }));
}

const LEDGER_MOVEMENT_TYPES_SQL = "'A', 'B', 'C', 'D', 'E', 'G', 'H', 'K'";
const AGING_MOVEMENT_TYPES_SQL = "'A', 'B', 'C', 'D', 'E', 'G', 'K'";

async function getDealerBalances({ branch, customerType, database }) {
  const pool = await getPool({ database });
  const request = pool.request();
  request.input('branch', sql.SmallInt, branch);
  request.input('customerType', sql.Char(1), customerType);
  const result = await request.query(`
    SELECT
      CONVERT(varbinary(100), s.CARI_KOD) AS CARI_KOD_BYTES,
      CONVERT(varbinary(200), s.CARI_ISIM) AS CARI_ISIM_BYTES,
      CONVERT(varbinary(100), s.CARI_IL) AS CARI_IL_BYTES,
      CONVERT(varbinary(100), s.CARI_ILCE) AS CARI_ILCE_BYTES,
      s.CARI_TEL,
      s.GSM1,
      s.GSM2,
      COUNT(h.INC_KEY_NUMBER) AS HAREKET_SAYISI,
      CONVERT(char(10), MAX(h.TARIH), 23) AS SON_HAREKET_GUN,
      ISNULL(SUM(h.BORC), 0) AS TOPLAM_BORC,
      ISNULL(SUM(h.ALACAK), 0) AS TOPLAM_ALACAK
    FROM TBLCASABIT s WITH (NOLOCK)
    LEFT JOIN TBLCAHAR h WITH (NOLOCK)
      ON h.CARI_KOD = s.CARI_KOD
     AND h.SUBE_KODU = @branch
     AND h.HAREKET_TURU IN (${LEDGER_MOVEMENT_TYPES_SQL})
    WHERE s.SUBE_KODU IN (@branch, -1)
      AND s.CARI_TIP = @customerType
    GROUP BY
      s.CARI_KOD, s.CARI_ISIM, s.CARI_IL, s.CARI_ILCE, s.CARI_TEL, s.GSM1, s.GSM2
    ORDER BY s.CARI_KOD
  `);
  return result.recordset.map(({
    CARI_KOD_BYTES,
    CARI_ISIM_BYTES,
    CARI_IL_BYTES,
    CARI_ILCE_BYTES,
    ...row
  }) => ({
    ...row,
    CARI_KOD: decodeErpText(CARI_KOD_BYTES),
    CARI_ISIM: decodeErpText(CARI_ISIM_BYTES),
    CARI_IL: decodeErpText(CARI_IL_BYTES),
    CARI_ILCE: decodeErpText(CARI_ILCE_BYTES),
  }));
}

async function getDealerRecord({ branch, customerType, database, cariKod }) {
  const pool = await getPool({ database });
  const request = pool.request();
  request.input('branch', sql.SmallInt, branch);
  request.input('customerType', sql.Char(1), customerType);
  request.input('cariKod', sql.VarChar(64), cariKod);
  const result = await request.query(`
    SELECT TOP 1
      CONVERT(varbinary(100), CARI_KOD) AS CARI_KOD_BYTES,
      CONVERT(varbinary(200), CARI_ISIM) AS CARI_ISIM_BYTES,
      CONVERT(varbinary(100), CARI_IL) AS CARI_IL_BYTES,
      CONVERT(varbinary(100), CARI_ILCE) AS CARI_ILCE_BYTES,
      CARI_TEL,
      GSM1,
      GSM2,
      EMAIL,
      VERGI_NUMARASI,
      SUBE_KODU
    FROM TBLCASABIT WITH (NOLOCK)
    WHERE SUBE_KODU IN (@branch, -1)
      AND CARI_TIP = @customerType
      AND CARI_KOD = @cariKod
    ORDER BY CASE WHEN SUBE_KODU = @branch THEN 0 ELSE 1 END
  `);
  const row = result.recordset[0];
  if (!row) return null;
  const {
    CARI_KOD_BYTES,
    CARI_ISIM_BYTES,
    CARI_IL_BYTES,
    CARI_ILCE_BYTES,
    ...rest
  } = row;
  return {
    ...rest,
    CARI_KOD: decodeErpText(CARI_KOD_BYTES),
    CARI_ISIM: decodeErpText(CARI_ISIM_BYTES),
    CARI_IL: decodeErpText(CARI_IL_BYTES),
    CARI_ILCE: decodeErpText(CARI_ILCE_BYTES),
  };
}

async function getStatementMovements({ branch, database, cariKod, startDate, endDate }) {
  const pool = await getPool({ database });
  const request = pool.request();
  request.input('branch', sql.SmallInt, branch);
  request.input('cariKod', sql.VarChar(64), cariKod);
  request.input('startDate', sql.Date, startDate);
  request.input('endDate', sql.Date, endDate);
  const result = await request.query(`
    SELECT
      CONVERT(char(10), h.TARIH, 23) AS TARIH_GUN,
      CONVERT(char(19), h.TARIH, 120) AS TARIH_STR,
      CONVERT(char(10), h.VADE_TARIHI, 23) AS VADE_GUN,
      h.BELGE_NO,
      CONVERT(varbinary(300), h.ACIKLAMA) AS ACIKLAMA_BYTES,
      h.HAREKET_TURU,
      ISNULL(h.BORC, 0) AS BORC,
      ISNULL(h.ALACAK, 0) AS ALACAK,
      h.INC_KEY_NUMBER
    FROM TBLCAHAR h WITH (NOLOCK)
    WHERE h.SUBE_KODU = @branch
      AND h.CARI_KOD = @cariKod
      AND h.TARIH >= @startDate
      AND h.TARIH < DATEADD(day, 1, @endDate)
      AND h.HAREKET_TURU IN (${LEDGER_MOVEMENT_TYPES_SQL})
    ORDER BY h.TARIH, h.INC_KEY_NUMBER
  `);
  return result.recordset.map(({ ACIKLAMA_BYTES, ...row }) => ({
    ...row,
    ACIKLAMA: decodeErpText(ACIKLAMA_BYTES),
  }));
}

/**
 * Ekstrede görünen fatura belgelerinin stok kalemlerini getirir.
 * TBLSTHAR.FISNO, TBLCAHAR.BELGE_NO ile eşleşir; açıklama TBLSTSABIT'ten
 * windows-1254 olarak çözülür. Stok açıklaması önce şube kaydından, yoksa
 * SUBE_KODU = -1 global kaydından alınır. Satırlar STHAR_CARIKOD ile cariye
 * daraltılır; GIB gibi ortak FISNO kullanan belgelerde diğer carilerin
 * kalemleri karışmaz.
 */
async function getInvoiceLines({ branch, database, cariKod, startDate, endDate }) {
  const pool = await getPool({ database });
  const request = pool.request();
  request.input('branch', sql.SmallInt, branch);
  request.input('cariKod', sql.VarChar(64), cariKod);
  request.input('startDate', sql.Date, startDate);
  request.input('endDate', sql.Date, endDate);
  const result = await request.query(`
    SELECT
      s.FISNO,
      s.STOK_KODU,
      CONVERT(varbinary(200), st.STOK_ADI) AS STOK_ADI_BYTES
    FROM TBLSTHAR s WITH (NOLOCK)
    OUTER APPLY (
      SELECT TOP 1 st.STOK_ADI
      FROM TBLSTSABIT st WITH (NOLOCK)
      WHERE st.STOK_KODU = s.STOK_KODU
        AND st.SUBE_KODU IN (s.SUBE_KODU, -1)
      ORDER BY CASE WHEN st.SUBE_KODU = s.SUBE_KODU THEN 0 ELSE 1 END
    ) st
    WHERE s.SUBE_KODU = @branch
      AND s.STHAR_CARIKOD = @cariKod
      AND EXISTS (
        SELECT 1
        FROM TBLCAHAR h WITH (NOLOCK)
        WHERE h.SUBE_KODU = s.SUBE_KODU
          AND h.CARI_KOD = @cariKod
          AND h.BELGE_NO = s.FISNO
          AND h.HAREKET_TURU IN ('B', 'C')
          AND h.TARIH >= @startDate
          AND h.TARIH < DATEADD(day, 1, @endDate)
      )
  `);
  return result.recordset.map(({ STOK_ADI_BYTES, ...row }) => ({
    ...row,
    STOK_ADI: decodeErpText(STOK_ADI_BYTES),
  }));
}

async function getCustomerMovementsUntil({ branch, database, cariKod, endDate }) {
  const pool = await getPool({ database });
  const request = pool.request();
  request.input('branch', sql.SmallInt, branch);
  request.input('cariKod', sql.VarChar(64), cariKod);
  request.input('endDate', sql.Date, endDate);
  const result = await request.query(`
    SELECT
      CONVERT(char(10), h.TARIH, 23) AS TARIH_GUN,
      CONVERT(char(19), h.TARIH, 120) AS TARIH_STR,
      CONVERT(char(10), h.VADE_TARIHI, 23) AS VADE_GUN,
      h.BELGE_NO,
      CONVERT(varbinary(300), h.ACIKLAMA) AS ACIKLAMA_BYTES,
      h.HAREKET_TURU,
      ISNULL(h.BORC, 0) AS BORC,
      ISNULL(h.ALACAK, 0) AS ALACAK,
      h.INC_KEY_NUMBER
    FROM TBLCAHAR h WITH (NOLOCK)
    WHERE h.SUBE_KODU = @branch
      AND h.CARI_KOD = @cariKod
      AND h.TARIH < DATEADD(day, 1, @endDate)
      AND h.HAREKET_TURU IN (${AGING_MOVEMENT_TYPES_SQL})
    ORDER BY h.TARIH, h.INC_KEY_NUMBER
  `);
  return result.recordset.map(({ ACIKLAMA_BYTES, ...row }) => ({
    ...row,
    ACIKLAMA: decodeErpText(ACIKLAMA_BYTES),
  }));
}

async function getStatementOpeningBalance({ branch, database, cariKod, startDate }) {
  const pool = await getPool({ database });
  const request = pool.request();
  request.input('branch', sql.SmallInt, branch);
  request.input('cariKod', sql.VarChar(64), cariKod);
  request.input('startDate', sql.Date, startDate);
  const result = await request.query(`
    SELECT ISNULL(SUM(ISNULL(BORC, 0) - ISNULL(ALACAK, 0)), 0) AS DEVIR
    FROM TBLCAHAR WITH (NOLOCK)
    WHERE SUBE_KODU = @branch
      AND CARI_KOD = @cariKod
      AND TARIH < @startDate
      AND HAREKET_TURU IN (${LEDGER_MOVEMENT_TYPES_SQL})
  `);
  return Number(result.recordset[0]?.DEVIR || 0);
}

async function getCustomerBalance({ branch, database, cariKod }) {
  const pool = await getPool({ database });
  const request = pool.request();
  request.input('branch', sql.SmallInt, branch);
  request.input('cariKod', sql.VarChar(64), cariKod);
  const result = await request.query(`
    SELECT ISNULL(SUM(ISNULL(BORC, 0) - ISNULL(ALACAK, 0)), 0) AS BAKIYE
    FROM TBLCAHAR WITH (NOLOCK)
    WHERE SUBE_KODU = @branch
      AND CARI_KOD = @cariKod
      AND HAREKET_TURU IN (${LEDGER_MOVEMENT_TYPES_SQL})
  `);
  return Number(result.recordset[0]?.BAKIYE || 0);
}

/**
 * Stok durum ekranının ana veri kümesi.
 *
 * Stok miktarı TBLSTSABIT.MIKTAR veya STOKPH üzerinden değil, TBLSTHAR
 * hareketlerinden hesaplanır: G (giriş) pozitif, C (çıkış) negatif.
 * Fiyatlar hareketin birincil birim (STOK_KODU'nun OLCU_BR1) fiyatıdır;
 * STHAR_NF yoksa STHAR_BF kullanılır. Son alış/satış fiyatı ilgili son
 * hareketten, master fiyatı yalnızca hiç hareket fiyatı yoksa yedek olarak
 * alınır.
 *
 * Kalan stok yaşı FIFO mantığıyla, en yeni giriş partileri stokta kalacak
 * şekilde hesaplanır: giriş partileri tarihçe boyunca ters kümülatif toplamla
 * eşleştirilir; stok negatifse yaş üretilmez.
 */
async function getStockAggregates({ branch, database, asOf }) {
  const pool = await getPool({ database });
  const request = pool.request();
  request.input('p_branch', sql.SmallInt, branch);
  request.input('p_asOf', sql.Date, asOf);
  const result = await request.query(`
    DECLARE @branch smallint = @p_branch;
    DECLARE @asOf date = @p_asOf;
    DECLARE @endExclusive date = DATEADD(day, 1, @asOf);

    WITH codes AS (
      SELECT STOK_KODU
      FROM TBLSTSABIT WITH (NOLOCK)
      WHERE SUBE_KODU IN (@branch, -1)
      UNION
      SELECT STOK_KODU
      FROM TBLSTHAR WITH (NOLOCK)
      WHERE SUBE_KODU = @branch
    ),
    master AS (
      SELECT c.STOK_KODU,
             CONVERT(varbinary(200), COALESCE(b.STOK_ADI, g.STOK_ADI)) AS STOK_ADI,
             COALESCE(b.GRUP_KODU, g.GRUP_KODU) AS GRUP_KODU,
             COALESCE(b.OLCU_BR1, g.OLCU_BR1) AS OLCU_BR1,
             COALESCE(b.OLCU_BR2, g.OLCU_BR2) AS OLCU_BR2,
             COALESCE(b.OLCU_BR3, g.OLCU_BR3) AS OLCU_BR3,
             COALESCE(b.PAY_1, g.PAY_1) AS PAY_1,
             COALESCE(b.PAYDA_1, g.PAYDA_1) AS PAYDA_1,
             COALESCE(b.PAY2, g.PAY2) AS PAY2,
             COALESCE(b.PAYDA2, g.PAYDA2) AS PAYDA2,
             COALESCE(b.FIAT_BIRIMI, g.FIAT_BIRIMI) AS FIAT_BIRIMI,
             COALESCE(b.SATIS_FIAT1, g.SATIS_FIAT1) AS SATIS_FIAT1,
             COALESCE(b.ALIS_FIAT1, g.ALIS_FIAT1) AS ALIS_FIAT1
      FROM codes c
      OUTER APPLY (
        SELECT TOP 1 STOK_ADI, GRUP_KODU, OLCU_BR1, OLCU_BR2, OLCU_BR3,
                     PAY_1, PAYDA_1, PAY2, PAYDA2, FIAT_BIRIMI, SATIS_FIAT1, ALIS_FIAT1
        FROM TBLSTSABIT WITH (NOLOCK)
        WHERE SUBE_KODU = @branch AND STOK_KODU = c.STOK_KODU
      ) b
      OUTER APPLY (
        SELECT TOP 1 STOK_ADI, GRUP_KODU, OLCU_BR1, OLCU_BR2, OLCU_BR3,
                     PAY_1, PAYDA_1, PAY2, PAYDA2, FIAT_BIRIMI, SATIS_FIAT1, ALIS_FIAT1
        FROM TBLSTSABIT WITH (NOLOCK)
        WHERE SUBE_KODU = -1 AND STOK_KODU = c.STOK_KODU
      ) g
    ),
    moves AS (
      SELECT STOK_KODU,
             SUM(CASE
                   WHEN STHAR_GCKOD = 'G' THEN STHAR_GCMIK
                   WHEN STHAR_GCKOD = 'C' THEN -STHAR_GCMIK
                   ELSE 0
                 END) AS STOK,
             SUM(CASE
                   WHEN STHAR_HTUR = 'J' AND STHAR_GCKOD = 'C' AND STHAR_TARIH >= DATEADD(day, -29, @asOf) THEN STHAR_GCMIK
                   ELSE 0
                 END) AS SATIS_30,
             SUM(CASE
                   WHEN STHAR_HTUR = 'J' AND STHAR_GCKOD = 'C' AND STHAR_TARIH >= DATEADD(day, -59, @asOf) THEN STHAR_GCMIK
                   ELSE 0
                 END) AS SATIS_60,
             SUM(CASE
                   WHEN STHAR_HTUR = 'J' AND STHAR_GCKOD = 'C' AND STHAR_TARIH >= DATEADD(day, -89, @asOf) THEN STHAR_GCMIK
                   ELSE 0
                 END) AS SATIS_90,
             SUM(CASE
                   WHEN STHAR_HTUR = 'J' AND STHAR_GCKOD = 'C' AND STHAR_TARIH >= DATEADD(day, -179, @asOf) THEN STHAR_GCMIK
                   ELSE 0
                 END) AS SATIS_180,
             SUM(CASE
                   WHEN STHAR_HTUR = 'J' AND STHAR_GCKOD = 'C' AND STHAR_TARIH >= DATEADD(day, -364, @asOf) THEN STHAR_GCMIK
                   ELSE 0
                 END) AS SATIS_365,
             MAX(CASE
                   WHEN STHAR_HTUR = 'L' AND STHAR_GCKOD = 'G' AND STHAR_GCMIK > 0 THEN STHAR_TARIH
                 END) AS SON_ALIS_TARIH,
             MAX(CASE
                   WHEN STHAR_HTUR = 'J' AND STHAR_GCKOD = 'C' AND STHAR_GCMIK > 0 THEN STHAR_TARIH
                 END) AS SON_SATIS_TARIH
      FROM TBLSTHAR WITH (NOLOCK)
      WHERE SUBE_KODU = @branch
        AND STHAR_TARIH < @endExclusive
      GROUP BY STOK_KODU
    ),
    lastmove AS (
      SELECT STOK_KODU,
             MAX(CASE WHEN RN_ALIS = 1 AND IS_ALIS = 1 THEN STHAR_NF END) AS SON_ALIS_NF,
             MAX(CASE WHEN RN_ALIS = 1 AND IS_ALIS = 1 THEN STHAR_BF END) AS SON_ALIS_BF,
             MAX(CASE WHEN RN_SATIS = 1 AND IS_SATIS = 1 THEN STHAR_NF END) AS SON_SATIS_NF,
             MAX(CASE WHEN RN_SATIS = 1 AND IS_SATIS = 1 THEN STHAR_BF END) AS SON_SATIS_BF
      FROM (
        SELECT STOK_KODU, STHAR_NF, STHAR_BF,
               CASE WHEN STHAR_HTUR = 'L' AND STHAR_GCKOD = 'G' AND STHAR_GCMIK > 0 THEN 1 ELSE 0 END AS IS_ALIS,
               CASE WHEN STHAR_HTUR = 'J' AND STHAR_GCKOD = 'C' AND STHAR_GCMIK > 0 THEN 1 ELSE 0 END AS IS_SATIS,
               ROW_NUMBER() OVER (
                 PARTITION BY STOK_KODU
                 ORDER BY CASE WHEN STHAR_HTUR = 'L' AND STHAR_GCKOD = 'G' AND STHAR_GCMIK > 0 THEN 0 ELSE 1 END,
                          STHAR_TARIH DESC, INCKEYNO DESC
               ) AS RN_ALIS,
               ROW_NUMBER() OVER (
                 PARTITION BY STOK_KODU
                 ORDER BY CASE WHEN STHAR_HTUR = 'J' AND STHAR_GCKOD = 'C' AND STHAR_GCMIK > 0 THEN 0 ELSE 1 END,
                          STHAR_TARIH DESC, INCKEYNO DESC
               ) AS RN_SATIS
        FROM TBLSTHAR WITH (NOLOCK)
        WHERE SUBE_KODU = @branch
          AND STHAR_TARIH < @endExclusive
          AND ((STHAR_HTUR = 'L' AND STHAR_GCKOD = 'G' AND STHAR_GCMIK > 0)
            OR (STHAR_HTUR = 'J' AND STHAR_GCKOD = 'C' AND STHAR_GCMIK > 0))
      ) ranked
      GROUP BY STOK_KODU
    ),
    joined AS (
      SELECT m.STOK_KODU,
             m.STOK_ADI,
             m.GRUP_KODU,
             m.OLCU_BR1, m.OLCU_BR2, m.OLCU_BR3,
             m.PAY_1, m.PAYDA_1, m.PAY2, m.PAYDA2,
             m.FIAT_BIRIMI, m.SATIS_FIAT1, m.ALIS_FIAT1,
             CAST(ISNULL(mv.STOK, 0) AS decimal(28,8)) AS STOK,
             CAST(ISNULL(mv.SATIS_30, 0) AS decimal(28,8)) AS SATIS_30,
             CAST(ISNULL(mv.SATIS_60, 0) AS decimal(28,8)) AS SATIS_60,
             CAST(ISNULL(mv.SATIS_90, 0) AS decimal(28,8)) AS SATIS_90,
             CAST(ISNULL(mv.SATIS_180, 0) AS decimal(28,8)) AS SATIS_180,
             CAST(ISNULL(mv.SATIS_365, 0) AS decimal(28,8)) AS SATIS_365,
             CONVERT(char(10), mv.SON_ALIS_TARIH, 23) AS SON_ALIS_TARIH,
             CONVERT(char(10), mv.SON_SATIS_TARIH, 23) AS SON_SATIS_TARIH,
             lm.SON_ALIS_NF, lm.SON_ALIS_BF,
             lm.SON_SATIS_NF, lm.SON_SATIS_BF
      FROM master m
      LEFT JOIN moves mv ON mv.STOK_KODU = m.STOK_KODU
      LEFT JOIN lastmove lm ON lm.STOK_KODU = m.STOK_KODU
    ),
    inbound AS (
      SELECT STOK_KODU,
             CASE WHEN STHAR_GCMIK > 0 THEN STHAR_GCMIK ELSE -STHAR_GCMIK END AS QTY,
             STHAR_TARIH,
             SUM(CASE WHEN STHAR_GCMIK > 0 THEN STHAR_GCMIK ELSE -STHAR_GCMIK END)
               OVER (
                 PARTITION BY STOK_KODU
                 ORDER BY STHAR_TARIH DESC, INCKEYNO DESC
                 ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
               ) AS REV_CUM
      FROM TBLSTHAR WITH (NOLOCK)
      WHERE SUBE_KODU = @branch
        AND STHAR_TARIH < @endExclusive
        AND ((STHAR_GCKOD = 'G' AND STHAR_GCMIK > 0) OR (STHAR_GCKOD = 'C' AND STHAR_GCMIK < 0))
    ),
    age AS (
      SELECT i.STOK_KODU,
             SUM(
               CASE WHEN i.REV_CUM <= s.STOK THEN i.QTY ELSE s.STOK - (i.REV_CUM - i.QTY) END
               * CASE WHEN DATEDIFF(day, i.STHAR_TARIH, @asOf) > 0
                      THEN DATEDIFF(day, i.STHAR_TARIH, @asOf) ELSE 0 END
             ) / NULLIF(s.STOK, 0) AS ORT_STOK_YASI,
             MAX(
               CASE WHEN i.REV_CUM - i.QTY < s.STOK
                    THEN CASE WHEN DATEDIFF(day, i.STHAR_TARIH, @asOf) > 0
                              THEN DATEDIFF(day, i.STHAR_TARIH, @asOf) ELSE 0 END
               END
             ) AS EN_ESKI_STOK_YASI
      FROM inbound i
      INNER JOIN joined s ON s.STOK_KODU = i.STOK_KODU AND s.STOK > 0
      WHERE i.REV_CUM - i.QTY < s.STOK
      GROUP BY i.STOK_KODU, s.STOK
    )
    SELECT j.*, a.ORT_STOK_YASI, a.EN_ESKI_STOK_YASI
    FROM joined j
    LEFT JOIN age a ON a.STOK_KODU = j.STOK_KODU
    ORDER BY j.STOK_KODU
  `);
  return result.recordset.map((row) => ({
    ...row,
    STOK_ADI: decodeErpText(row.STOK_ADI),
  }));
}

async function getStockMovements({ branch, database, stokKodu, asOf, limit = 50 }) {
  const pool = await getPool({ database });
  const request = pool.request();
  request.input('branch', sql.SmallInt, branch);
  request.input('stokKodu', sql.VarChar(64), stokKodu);
  request.input('asOf', sql.Date, asOf);
  request.input('limit', sql.Int, Math.max(1, Math.min(200, Number(limit) || 50)));
  const result = await request.query(`
    SELECT TOP (@limit)
      CONVERT(char(10), STHAR_TARIH, 23) AS TARIH_GUN,
      CONVERT(char(19), STHAR_TARIH, 120) AS TARIH_STR,
      FISNO,
      STHAR_HTUR,
      STHAR_GCKOD,
      STHAR_GCMIK,
      STHAR_BF,
      STHAR_NF,
      CONVERT(varbinary(120), STHAR_CARIKOD) AS CARI_KOD_BYTES,
      CONVERT(varbinary(400), STHAR_ACIKLAMA) AS ACIKLAMA_BYTES
    FROM TBLSTHAR WITH (NOLOCK)
    WHERE SUBE_KODU = @branch
      AND STOK_KODU = @stokKodu
      AND STHAR_TARIH < DATEADD(day, 1, @asOf)
    ORDER BY STHAR_TARIH DESC, INCKEYNO DESC
  `);
  return result.recordset.map(({ CARI_KOD_BYTES, ACIKLAMA_BYTES, ...row }) => ({
    ...row,
    CARI_KOD: decodeErpText(CARI_KOD_BYTES),
    ACIKLAMA: decodeErpText(ACIKLAMA_BYTES),
  }));
}

function asBool(value) {
  return value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true';
}

function normalizeConnection(overrides = {}) {
  const base = getErpConfig();
  const erp = { ...base };

  for (const key of ['server', 'database', 'user', 'password']) {
    if (overrides[key] !== undefined && overrides[key] !== null) {
      const value = String(overrides[key]).trim();
      if (value !== '') erp[key] = value;
    }
  }
  if (overrides.port !== undefined && overrides.port !== null && String(overrides.port).trim() !== '') {
    erp.port = Number(overrides.port);
  }
  if (overrides.encrypt !== undefined) erp.encrypt = asBool(overrides.encrypt);
  if (overrides.trustServerCertificate !== undefined) {
    erp.trustServerCertificate = asBool(overrides.trustServerCertificate);
  }

  if (!erp.server) throw Object.assign(new Error('SQL Server adresi zorunludur.'), { status: 400 });
  if (!Number.isInteger(erp.port) || erp.port < 1 || erp.port > 65535) {
    throw Object.assign(new Error('SQL Server portu 1-65535 arasında olmalıdır.'), { status: 400 });
  }
  if (!erp.database) throw Object.assign(new Error('Veritabanı adı zorunludur.'), { status: 400 });
  if (!erp.user) throw Object.assign(new Error('Veritabanı kullanıcısı zorunludur.'), { status: 400 });
  if (!erp.password) throw Object.assign(new Error('ERP şifresi girilmedi.'), { status: 400 });

  return erp;
}

async function testConnection(overrides = {}) {
  const erp = normalizeConnection(overrides);
  const pool = new sql.ConnectionPool(buildPoolConfig(erp));
  try {
    await pool.connect();
    const result = await pool.request().query(`
      SELECT
        DB_NAME() AS db,
        GETDATE() AS now,
        @@SERVERNAME AS server_name,
        CASE
          WHEN OBJECT_ID('TBLCAHAR') IS NOT NULL AND OBJECT_ID('TBLCASABIT') IS NOT NULL THEN 1
          ELSE 0
        END AS has_tables
    `);
    const row = result.recordset[0];
    if (!row.has_tables) {
      throw Object.assign(
        new Error('Bağlantı kuruldu ancak TBLCAHAR / TBLCASABIT tabloları bulunamadı. Veritabanı adını kontrol edin.'),
        { status: 400 },
      );
    }
    return {
      db: row.db,
      now: row.now,
      serverName: row.server_name,
      hasTables: true,
      server: erp.server,
      port: erp.port,
    };
  } finally {
    await pool.close().catch(() => {});
  }
}

async function closePool() {
  const current = [...pools.values()];
  pools.clear();
  await Promise.allSettled(current.map(async (promise) => {
    try {
      const pool = await promise;
      await pool.close();
    } catch { /* ignore */ }
  }));
}

module.exports = {
  getPool,
  getAgingMovements,
  getCustomers,
  getDealerBalances,
  getDealerRecord,
  getStatementMovements,
  getInvoiceLines,
  getCustomerMovementsUntil,
  getStatementOpeningBalance,
  getCustomerBalance,
  getStockAggregates,
  getStockMovements,
  testConnection,
  closePool,
};
