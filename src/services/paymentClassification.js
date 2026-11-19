'use strict';

const COLLECTION_TYPES = new Set(['D', 'G', 'K']);
const CREDIT_CARD_LABEL = 'Kredi Kartı Tahsilatı';

/**
 * Karşılaştırma için Türkçe ve bozuk (windows-1254 / latin1) karakterleri
 * ASCII'ye indirger; boşluk ve noktalama farklarını yok sayar.
 */
function compactText(value) {
  return String(value ?? '')
    .toLocaleUpperCase('tr-TR')
    .replace(/İ/g, 'I')
    .replace(/Ş/g, 'S')
    .replace(/Ğ/g, 'G')
    .replace(/Ü/g, 'U')
    .replace(/Ö/g, 'O')
    .replace(/Ç/g, 'C')
    .replace(/Ý/g, 'I')
    .replace(/Þ/g, 'S')
    .replace(/Ð/g, 'G')
    .replace(/[^A-Z0-9]/g, '');
}

/**
 * Kredi kartı tahsilatlarını açıklama ve belge numarasından ayırır.
 *
 * DINO:
 * - D türü "KREDI KART TAHSILAT(TRBxx)"
 * - K türü "Kart İşlemleri - İşyeri:..." (eski kodlamada "Kart Ýþlemleri")
 * - K türü "K.KART/...", "POS BLOKE COZUM-..."
 * BERMER ve diğer ERP'lerde "K.KART", "KK..." belge numarası kullanılır.
 * "GELEN FAST", "NAKİT TAHSİLAT" ve "Gayrinakdi Kredi" kart tahsilatı değildir.
 */
function isCreditCardCollection(movement = {}) {
  const type = movement.HAREKET_TURU || '';
  if (!COLLECTION_TYPES.has(type)) return false;
  if (!(Number(movement.ALACAK || 0) > 0)) return false;

  const belgeRaw = String(movement.BELGE_NO || '').toLocaleUpperCase('tr-TR');
  if (/^KK\d/.test(belgeRaw)) return true;

  const raw = `${movement.ACIKLAMA || ''} ${belgeRaw}`.toLocaleUpperCase('tr-TR');
  if (!raw.includes('KART') && !raw.includes('POS') && !raw.includes('KK')) return false;

  const compact = compactText(raw);
  return compact.includes('KREDIKART')
    || compact.includes('KARTTAHSILAT')
    || compact.includes('KARTISLEM')
    || compact.includes('KKART')
    || compact.includes('POSBLOKE')
    || compact.includes('POSTAHSILAT')
    || compact.includes('SANALPOS');
}

module.exports = {
  COLLECTION_TYPES,
  CREDIT_CARD_LABEL,
  compactText,
  isCreditCardCollection,
};
