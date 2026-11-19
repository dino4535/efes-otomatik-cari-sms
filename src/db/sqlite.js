'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('../config');
const { hashPassword } = require('../services/passwords');

function nowIso() {
  return new Date().toISOString();
}

const dataDir = path.dirname(config.dbPath);
fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(config.dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
`);

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
      is_active INTEGER NOT NULL DEFAULT 1,
      must_change_password INTEGER NOT NULL DEFAULT 0,
      erp_database TEXT,
      branch INTEGER,
      last_login_at TEXT,
      created_at TEXT NOT NULL,
      created_by INTEGER,
      updated_at TEXT NOT NULL,
      updated_by INTEGER
    );

    CREATE TABLE IF NOT EXISTS user_permissions (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      permission_key TEXT NOT NULL,
      allowed INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (user_id, permission_key)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      user_id INTEGER,
      data TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      username TEXT,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      detail TEXT,
      ip TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      description TEXT,
      updated_at TEXT NOT NULL,
      updated_by INTEGER
    );

    CREATE TABLE IF NOT EXISTS stock_litre_overrides (
      stok_kodu TEXT PRIMARY KEY COLLATE NOCASE,
      stok_adi TEXT,
      primary_unit TEXT,
      litre REAL NOT NULL CHECK (litre > 0),
      input_text TEXT,
      note TEXT,
      updated_at TEXT NOT NULL,
      updated_by INTEGER
    );

    CREATE TABLE IF NOT EXISTS sms_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      body TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by INTEGER
    );

    CREATE TABLE IF NOT EXISTS customer_sms_settings (
      cari_kod TEXT PRIMARY KEY,
      phone_override TEXT,
      sms_enabled INTEGER NOT NULL DEFAULT 1,
      interval_days INTEGER,
      last_sms_at TEXT,
      next_sms_at TEXT,
      opt_out INTEGER NOT NULL DEFAULT 0,
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_customer_sms_next ON customer_sms_settings(next_sms_at);

    CREATE TABLE IF NOT EXISTS sms_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cari_kod TEXT,
      cari_isim TEXT,
      phone TEXT,
      template_id INTEGER,
      message TEXT,
      status TEXT NOT NULL,
      provider TEXT,
      provider_message_id TEXT,
      error_code TEXT,
      error_message TEXT,
      trigger_type TEXT NOT NULL,
      sent_by INTEGER,
      total_debt REAL,
      overdue_debt REAL,
      oldest_days INTEGER,
      attempt_count INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      sent_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sms_created ON sms_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sms_cari ON sms_logs(cari_kod);

    CREATE TABLE IF NOT EXISTS job_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_name TEXT NOT NULL,
      status TEXT NOT NULL,
      detail TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_job_started ON job_runs(started_at DESC);

    CREATE TABLE IF NOT EXISTS login_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT,
      ip TEXT,
      success INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_login_created ON login_attempts(created_at DESC);
  `);

  ensureColumn('users', 'erp_database', 'TEXT');
  ensureColumn('users', 'branch', 'INTEGER');
}

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (columns.some((item) => item.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

const DEFAULT_SETTINGS = [
  ['app.company_name', 'Efes', 'Firma adı'],
  ['app.company_phone', '', 'SMS şablonlarında kullanılacak firma telefonu'],
  ['app.branch', String(config.branch), 'Varsayılan şube kodu (kullanıcı bazlı değer yoksa / arka plan görevleri)'],
  ['app.timezone', config.timezone, 'Saat dilimi'],
  ['erp.server', config.erp.server, 'SQL Server sunucu adresi'],
  ['erp.port', String(config.erp.port), 'SQL Server TCP portu'],
  ['erp.database', config.erp.database, 'Varsayılan ERP veritabanı (kullanıcı bazlı değer yoksa / arka plan görevleri)'],
  ['erp.user', config.erp.user, 'ERP veritabanı kullanıcısı'],
  ['erp.encrypt', config.erp.encrypt ? '1' : '0', 'ERP bağlantısında TLS kullan'],
  ['erp.trust_cert', config.erp.trustServerCertificate ? '1' : '0', 'ERP sunucu sertifikasına güven'],
  ['aging.customer_type', 'A', 'Yaşlandırmaya dahil edilecek cari tipi'],
  ['aging.tolerance', '0', 'Peşin faturalar hariç tutulurken aynı gün fatura/tahsilat eşleşme toleransı (TL). 0 = tolerans yok'],
  ['aging.overdue_days', '30', 'Gecikmiş sayılma eşiği (gün)'],
  ['sms.enabled', '0', 'Otomatik SMS gönderimi aktif mi?'],
  ['sms.provider', 'test', 'SMS sağlayıcısı (test = gerçek gönderim yok)'],
  ['sms.interval_days', '7', 'Aynı cariye SMS gönderme aralığı (gün)'],
  ['sms.max_per_day', '100', 'Günlük maksimum SMS sayısı'],
  ['sms.quiet_start', '20:00', 'Sessiz saat başlangıcı'],
  ['sms.quiet_end', '09:00', 'Sessiz saat bitişi'],
  ['sms.min_debt', '0', 'SMS için minimum 30+ borç (TL)'],
  ['sms.template_id', '1', 'Varsayılan SMS şablonu'],
  ['sms.send_time', '10:00', 'Günlük gönderim saati'],
  ['sms.test_mode', '1', 'Test modu: gerçek SMS gönderilmez'],
];

function seed() {
  const insertSetting = db.prepare(`
    INSERT OR IGNORE INTO settings (key, value, description, updated_at)
    VALUES (?, ?, ?, ?)
  `);
  const ts = nowIso();
  for (const [key, value, description] of DEFAULT_SETTINGS) {
    insertSetting.run(key, value, description, ts);
  }

  const templateCount = db.prepare('SELECT COUNT(*) AS c FROM sms_templates').get().c;
  if (!templateCount) {
    db.prepare(`
      INSERT INTO sms_templates (name, body, is_active, created_at, updated_at)
      VALUES (?, ?, 1, ?, ?)
    `).run(
      'Varsayılan 30+ Gün Hatırlatma',
      'Sayın {cari_isim}, {sube} şubemizdeki cari hesabınızda {overdue30} TL tutarında 30 günü geçen borcunuz bulunmaktadır. Bilgi: {firma_tel}',
      ts,
      ts,
    );
  }

  const adminCount = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'").get().c;
  if (!adminCount) {
    db.prepare(`
      INSERT INTO users (username, password_hash, full_name, role, is_active, must_change_password, created_at, updated_at)
      VALUES (?, ?, ?, 'admin', 1, 1, ?, ?)
    `).run(
      config.admin.username,
      hashPassword(config.admin.password),
      config.admin.fullName,
      ts,
      ts,
    );
  }

  // Kullanıcı bazlı ERP veritabanı ve şube tanımlanmamışsa mevcut
  // sistem varsayılanlarıyla bir kez doldurulur.
  const defaultDatabase = getSetting('erp.database', config.erp.database);
  const defaultBranch = getSettingNumber('app.branch', config.branch);
  db.prepare(`
    UPDATE users SET erp_database = ?
    WHERE erp_database IS NULL OR TRIM(erp_database) = ''
  `).run(defaultDatabase);
  db.prepare(`
    UPDATE users SET branch = ?
    WHERE branch IS NULL
  `).run(defaultBranch);
}

function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function getSettingNumber(key, fallback = 0) {
  const value = getSetting(key);
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getSettingBool(key, fallback = false) {
  const value = getSetting(key);
  if (value === null || value === undefined) return fallback;
  return value === '1' || String(value).toLowerCase() === 'true';
}

function setSetting(key, value, userId = null) {
  const ts = nowIso();
  db.prepare(`
    INSERT INTO settings (key, value, description, updated_at, updated_by)
    VALUES (?, ?, '', ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by
  `).run(key, String(value), ts, userId);
}

function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    throw error;
  }
}

function cleanupSessions() {
  const now = Date.now();
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
}

function cleanupLoginAttempts(days = 30) {
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  db.prepare('DELETE FROM login_attempts WHERE created_at < ?').run(cutoff);
}

migrate();
seed();

module.exports = {
  db,
  nowIso,
  getSetting,
  getSettingNumber,
  getSettingBool,
  setSetting,
  transaction,
  cleanupSessions,
  cleanupLoginAttempts,
};
