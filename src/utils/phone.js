'use strict';

function normalizePhone(raw) {
  if (raw === null || raw === undefined) return null;
  let digits = String(raw).replace(/\D+/g, '');
  if (!digits) return null;
  digits = digits.replace(/^0+/, '');
  if (digits.length === 10) return `+90${digits}`;
  if (digits.length === 12 && digits.startsWith('90')) return `+${digits}`;
  return null;
}

function maskPhone(phone) {
  if (!phone) return '';
  const value = String(phone);
  if (value.length < 6) return value;
  return `${value.slice(0, 4)}***${value.slice(-2)}`;
}

module.exports = { normalizePhone, maskPhone };
