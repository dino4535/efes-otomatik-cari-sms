'use strict';

const { db, nowIso } = require('../db/sqlite');

function mapRow(row) {
  if (!row) return null;
  return {
    code: row.stok_kodu,
    name: row.stok_adi || null,
    primaryUnit: row.primary_unit || null,
    litre: Number(row.litre),
    inputText: row.input_text || null,
    note: row.note || null,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

function getStockLitreOverrides() {
  const rows = db.prepare(`
    SELECT stok_kodu, stok_adi, primary_unit, litre, input_text, note, updated_at, updated_by
    FROM stock_litre_overrides
    ORDER BY stok_kodu
  `).all();
  const result = new Map();
  for (const row of rows) {
    const entry = mapRow(row);
    result.set(entry.code, entry);
  }
  return result;
}

function getStockLitreOverride(code) {
  const normalized = String(code || '').trim();
  if (!normalized) return null;
  const row = db.prepare(`
    SELECT stok_kodu, stok_adi, primary_unit, litre, input_text, note, updated_at, updated_by
    FROM stock_litre_overrides
    WHERE stok_kodu = ?
  `).get(normalized);
  return mapRow(row);
}

function saveStockLitreOverride({
  code,
  name = null,
  primaryUnit = null,
  litre,
  inputText = null,
  note = null,
  userId = null,
}) {
  const normalizedCode = String(code || '').trim();
  const normalizedLitre = Number(litre);
  if (!normalizedCode) throw new Error('Stok kodu zorunludur.');
  if (!Number.isFinite(normalizedLitre) || normalizedLitre <= 0) {
    throw new Error('Litre değeri sıfırdan büyük olmalı.');
  }

  const timestamp = nowIso();
  db.prepare(`
    INSERT INTO stock_litre_overrides (
      stok_kodu, stok_adi, primary_unit, litre, input_text, note, updated_at, updated_by
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(stok_kodu) DO UPDATE SET
      stok_adi = excluded.stok_adi,
      primary_unit = excluded.primary_unit,
      litre = excluded.litre,
      input_text = excluded.input_text,
      note = excluded.note,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by
  `).run(
    normalizedCode,
    name || null,
    primaryUnit || null,
    normalizedLitre,
    inputText || null,
    note || null,
    timestamp,
    userId || null,
  );

  return getStockLitreOverride(normalizedCode);
}

function deleteStockLitreOverride(code) {
  const normalizedCode = String(code || '').trim();
  if (!normalizedCode) return false;
  const result = db.prepare('DELETE FROM stock_litre_overrides WHERE stok_kodu = ?').run(normalizedCode);
  return Number(result.changes || 0) > 0;
}

module.exports = {
  getStockLitreOverrides,
  getStockLitreOverride,
  saveStockLitreOverride,
  deleteStockLitreOverride,
};
