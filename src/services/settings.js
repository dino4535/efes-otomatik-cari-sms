'use strict';

const { db, getSetting, setSetting } = require('../db/sqlite');
const { closePool } = require('../db/erp');
const { invalidateAgingCache } = require('./aging');
const { invalidateLedgerCache } = require('./customerLedger');

const SETTINGS_DEFINITION = {
  'app.company_name': { type: 'string', max: 100 },
  'app.company_phone': { type: 'string', max: 50 },
  'app.branch': { type: 'int', min: 0, max: 999 },
  'app.timezone': { type: 'string', max: 50 },
  'erp.server': { type: 'string', max: 255, required: true },
  'erp.port': { type: 'int', min: 1, max: 65535 },
  'erp.database': { type: 'string', max: 128, required: true },
  'erp.user': { type: 'string', max: 128, required: true },
  'erp.password': { type: 'string', max: 255, secret: true },
  'erp.encrypt': { type: 'bool' },
  'erp.trust_cert': { type: 'bool' },
  'aging.customer_type': { type: 'enum', values: ['A', 'S', 'D'] },
  'aging.tolerance': { type: 'number', min: 0, max: 10000 },
  'aging.overdue_days': { type: 'int', min: 1, max: 3650 },
  'finance.deposit_rate': { type: 'number', min: 0, max: 100 },
  'sms.enabled': { type: 'bool' },
  'sms.provider': { type: 'string', max: 50 },
  'sms.interval_days': { type: 'int', min: 0, max: 365 },
  'sms.max_per_day': { type: 'int', min: 0, max: 10000 },
  'sms.quiet_start': { type: 'time' },
  'sms.quiet_end': { type: 'time' },
  'sms.min_debt': { type: 'number', min: 0, max: 100000000 },
  'sms.template_id': { type: 'int', min: 1, max: 999999 },
  'sms.send_time': { type: 'time' },
  'sms.test_mode': { type: 'bool' },
};

const SECRET_SETTING_KEYS = new Set(['erp.password']);
const ERP_SETTING_PREFIX = 'erp.';

function isSecretSetting(key) {
  return SECRET_SETTING_KEYS.has(key);
}

function getAllSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const result = {};
  for (const row of rows) {
    if (!isSecretSetting(row.key)) result[row.key] = row.value;
  }
  return result;
}

function getSettingsWithMeta() {
  const rows = db.prepare('SELECT key, value, description, updated_at, updated_by FROM settings ORDER BY key').all();
  return rows.filter((row) => !isSecretSetting(row.key));
}

function validateSetting(key, value) {
  const def = SETTINGS_DEFINITION[key];
  if (!def) throw Object.assign(new Error(`Bilinmeyen ayar: ${key}`), { status: 400 });

  if (def.type === 'bool') {
    return value === true || value === '1' || value === 1 || value === 'true' ? '1' : '0';
  }
  if (def.type === 'int') {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n) || n < def.min || n > def.max) {
      throw Object.assign(new Error(`${key} için geçersiz değer.`), { status: 400 });
    }
    return String(n);
  }
  if (def.type === 'number') {
    const n = Number(value);
    if (!Number.isFinite(n) || n < def.min || n > def.max) {
      throw Object.assign(new Error(`${key} için geçersiz değer.`), { status: 400 });
    }
    return String(n);
  }
  if (def.type === 'enum') {
    const v = String(value);
    if (!def.values.includes(v)) {
      throw Object.assign(new Error(`${key} için geçersiz değer.`), { status: 400 });
    }
    return v;
  }
  if (def.type === 'time') {
    const v = String(value);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) {
      throw Object.assign(new Error(`${key} saat formatı HH:MM olmalıdır.`), { status: 400 });
    }
    return v;
  }
  const v = String(value ?? '').trim().slice(0, def.max || 255);
  if (def.required && !v) {
    throw Object.assign(new Error(`${key} zorunludur.`), { status: 400 });
  }
  return v;
}

function updateSettings(updates, userId = null) {
  const changed = [];
  for (const [key, rawValue] of Object.entries(updates || {})) {
    if (!(key in SETTINGS_DEFINITION)) continue;
    const value = validateSetting(key, rawValue);
    const previous = getSetting(key);
    if (previous !== value) {
      setSetting(key, value, userId);
      const secret = isSecretSetting(key);
      changed.push({
        key,
        previous: secret && previous ? '***' : previous,
        value: secret && value ? '***' : value,
      });
    }
  }
  if (changed.some((item) =>
    item.key.startsWith('aging.') ||
    item.key.startsWith(ERP_SETTING_PREFIX) ||
    item.key === 'app.branch'
  )) {
    invalidateAgingCache();
    invalidateLedgerCache();
  }
  if (changed.some((item) => item.key.startsWith(ERP_SETTING_PREFIX))) {
    // Sunucu/şifre değiştiğinde eski bağlantı havuzlarını kapat.
    closePool().catch(() => {});
  }
  return changed;
}

module.exports = {
  SETTINGS_DEFINITION,
  getAllSettings,
  getSettingsWithMeta,
  updateSettings,
  validateSetting,
};
