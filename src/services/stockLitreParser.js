'use strict';

const VOLUME_FACTORS = {
  litre: 1,
  lt: 1,
  l: 1,
  cl: 0.01,
  ck: 0.01,
  cc: 0.001,
  ml: 0.001,
};

function roundLitre(value) {
  return Math.round((Number(value) + Number.EPSILON) * 1e6) / 1e6;
}

/**
 * Manüel litre girişini birincil birim litresine çevirir.
 *
 * - Düz sayı (`12`, `0,5`): 1 stok biriminin litresi.
 * - `50 CL`, `70cl`, `330 ML`, `50 CC`: şişe/kutu hacmi. Koli/tava gibi
 *   birimlerde paket adediyle çarpılır.
 * - `12 LT`, `1 LITRE`: 1 stok biriminin litresi (paket çarpanı uygulanmaz).
 */
function parseLitreInput(value, options = {}) {
  const text = String(value ?? '').trim();
  if (!text) {
    return { ok: false, error: 'Litre değeri girin veya tanımı temizleyin.' };
  }

  const normalized = text.replace(/\s+/g, ' ').replace(/,/g, '.');
  const unitMatch = /^(\d+(?:\.\d+)?)\s*(litre|cl|ck|cc|ml|lt|l)$/i.exec(normalized);
  if (unitMatch) {
    const amount = Number(unitMatch[1]);
    const unit = unitMatch[2].toLowerCase();
    if (!Number.isFinite(amount) || amount <= 0) {
      return { ok: false, error: 'Litre değeri sıfırdan büyük olmalı.' };
    }

    let litre = amount * VOLUME_FACTORS[unit];
    const pieceUnit = ['cl', 'ck', 'cc', 'ml'].includes(unit);
    if (pieceUnit && options.isCaseUnit) {
      const packFactor = Number(options.packFactor);
      if (!Number.isFinite(packFactor) || packFactor < 2) {
        return {
          ok: false,
          error: 'Koli/tava için paket adedi bulunamadı. 1 birimin toplam litresini düz sayı olarak girin.',
        };
      }
      litre *= packFactor;
    }

    return {
      ok: true,
      litre: roundLitre(litre),
      inputText: text,
      mode: pieceUnit && options.isCaseUnit ? 'piece' : 'unit',
    };
  }

  if (!/^\d+(?:\.\d+)?$/.test(normalized)) {
    return { ok: false, error: 'Geçerli bir litre değeri girin (ör. 12 veya 50 CL).' };
  }

  const litre = Number(normalized);
  if (!Number.isFinite(litre) || litre <= 0) {
    return { ok: false, error: 'Litre değeri sıfırdan büyük olmalı.' };
  }
  if (litre > 1_000_000) {
    return { ok: false, error: 'Litre değeri çok yüksek.' };
  }

  return {
    ok: true,
    litre: roundLitre(litre),
    inputText: text,
    mode: 'unit',
  };
}

module.exports = { parseLitreInput, roundLitre, VOLUME_FACTORS };
