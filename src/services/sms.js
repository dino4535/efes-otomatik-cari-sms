'use strict';

const { db, nowIso, getSetting } = require('../db/sqlite');
const { getAllSettings } = require('./settings');
const { getAging, getCachedAgingAge, centsToTl } = require('./aging');
const { getProvider } = require('../providers');
const { normalizePhone } = require('../utils/phone');
const { isQuietHours } = require('../utils/dates');

const GSM7_CHARS = new Set(
  ('@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
    '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà').split(''),
);
const GSM7_EXT = new Set(['^', '{', '}', '\\', '[', ']', '~', '|', '€']);

function formatMoney(value) {
  return new Intl.NumberFormat('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function formatDateTr(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function smsSegments(text) {
  const value = String(text || '');
  const isGsm7 = [...value].every((ch) => GSM7_CHARS.has(ch) || GSM7_EXT.has(ch));
  const encoding = isGsm7 ? 'GSM-7' : 'UCS-2';
  const single = isGsm7 ? 160 : 70;
  const multi = isGsm7 ? 153 : 67;
  const segments = value.length <= single ? 1 : Math.ceil(value.length / multi);
  return { encoding, length: value.length, segments };
}

function renderSmsTemplate(body, vars) {
  return String(body || '').replace(/\{(\w+)\}/g, (match, key) => {
    return Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match;
  });
}

function templateVars(customer, settings = {}) {
  const overdue = customer.overdue30 ?? centsToTl(customer.overdue30Cents || 0);
  const total = customer.totalDebt ?? centsToTl(customer.totalDebtCents || 0);
  return {
    cari_isim: customer.cariIsim || customer.CARI_ISIM || '',
    cari_kod: customer.cariKod || customer.CARI_KOD || '',
    sube: settings['app.branch'] || getSetting('app.branch', '3'),
    toplam_borc: formatMoney(total),
    overdue30: formatMoney(overdue),
    en_yasli_gun: customer.oldestDays ?? 0,
    firma_tel: settings['app.company_phone'] || '',
    tarih: new Intl.DateTimeFormat('tr-TR', {
      timeZone: 'Europe/Istanbul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date()),
    firma_adi: settings['app.company_name'] || 'Efes',
  };
}

function listTemplates() {
  return db.prepare('SELECT * FROM sms_templates ORDER BY is_active DESC, id DESC').all();
}

function getTemplate(id) {
  return db.prepare('SELECT * FROM sms_templates WHERE id = ?').get(Number(id)) || null;
}

function getActiveTemplate() {
  return db.prepare('SELECT * FROM sms_templates WHERE is_active = 1 ORDER BY id LIMIT 1').get() || null;
}

function validateTemplate({ name, body }) {
  if (!String(name || '').trim()) {
    throw Object.assign(new Error('Şablon adı zorunludur.'), { status: 400 });
  }
  if (!String(body || '').trim()) {
    throw Object.assign(new Error('Mesaj içeriği zorunludur.'), { status: 400 });
  }
  if (String(body).length > 500) {
    throw Object.assign(new Error('Mesaj içeriği 500 karakterden uzun olamaz.'), { status: 400 });
  }
}

function createTemplate({ name, body, isActive = true }, userId = null) {
  validateTemplate({ name, body });
  const ts = nowIso();
  const result = db.prepare(`
    INSERT INTO sms_templates (name, body, is_active, created_at, updated_at, updated_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(String(name).trim(), String(body), isActive ? 1 : 0, ts, ts, userId);
  return getTemplate(Number(result.lastInsertRowid));
}

function updateTemplate(id, { name, body, isActive }, userId = null) {
  const existing = getTemplate(id);
  if (!existing) throw Object.assign(new Error('Şablon bulunamadı.'), { status: 404 });
  validateTemplate({ name, body });
  db.prepare(`
    UPDATE sms_templates SET name = ?, body = ?, is_active = ?, updated_at = ?, updated_by = ? WHERE id = ?
  `).run(String(name).trim(), String(body), isActive ? 1 : 0, nowIso(), userId, Number(id));
  return getTemplate(id);
}

function deleteTemplate(id) {
  const existing = getTemplate(id);
  if (!existing) throw Object.assign(new Error('Şablon bulunamadı.'), { status: 404 });
  const defaultId = Number(getSetting('sms.template_id', '0'));
  if (defaultId === Number(id)) {
    throw Object.assign(new Error('Varsayılan şablon silinemez. Önce başka bir şablonu varsayılan yapın.'), { status: 400 });
  }
  db.prepare('DELETE FROM sms_templates WHERE id = ?').run(Number(id));
}

function mapCustomerSettings(row, cariKod) {
  if (!row) {
    return {
      cariKod,
      phoneOverride: null,
      smsEnabled: true,
      intervalDays: null,
      lastSmsAt: null,
      nextSmsAt: null,
      optOut: false,
      note: null,
    };
  }
  return {
    cariKod: row.cari_kod,
    phoneOverride: row.phone_override,
    smsEnabled: Boolean(row.sms_enabled),
    intervalDays: row.interval_days,
    lastSmsAt: row.last_sms_at,
    nextSmsAt: row.next_sms_at,
    optOut: Boolean(row.opt_out),
    note: row.note,
  };
}

function getCustomerSmsSettings(cariKod) {
  const row = db.prepare('SELECT * FROM customer_sms_settings WHERE cari_kod = ?').get(String(cariKod));
  return mapCustomerSettings(row, String(cariKod));
}

function upsertCustomerSmsSettings(cariKod, data, userId = null) {
  const current = getCustomerSmsSettings(cariKod);
  const phoneOverride = data.phoneOverride === undefined ? current.phoneOverride : data.phoneOverride;
  if (phoneOverride) {
    const normalized = normalizePhone(phoneOverride);
    if (!normalized) {
      throw Object.assign(new Error('Geçersiz telefon numarası. Örnek: 0532 123 45 67'), { status: 400 });
    }
  }
  let intervalDays = data.intervalDays === undefined ? current.intervalDays : data.intervalDays;
  if (intervalDays !== null && intervalDays !== undefined && intervalDays !== '') {
    intervalDays = Number.parseInt(intervalDays, 10);
    if (!Number.isFinite(intervalDays) || intervalDays < 0 || intervalDays > 365) {
      throw Object.assign(new Error('SMS aralığı 0-365 gün arasında olmalıdır.'), { status: 400 });
    }
  } else {
    intervalDays = null;
  }
  let nextSmsAt = data.nextSmsAt === undefined ? current.nextSmsAt : data.nextSmsAt;
  if (nextSmsAt === null || nextSmsAt === '') {
    nextSmsAt = null;
  } else if (nextSmsAt !== undefined) {
    const parsed = new Date(nextSmsAt);
    if (Number.isNaN(parsed.getTime())) {
      throw Object.assign(new Error('Geçersiz SMS gönderim tarihi.'), { status: 400 });
    }
    nextSmsAt = parsed.toISOString();
  }
  const smsEnabled = data.smsEnabled === undefined ? current.smsEnabled : Boolean(data.smsEnabled);
  const optOut = data.optOut === undefined ? current.optOut : Boolean(data.optOut);
  const note = data.note === undefined ? current.note : (data.note ? String(data.note).slice(0, 255) : null);
  const ts = nowIso();

  db.prepare(`
    INSERT INTO customer_sms_settings (
      cari_kod, phone_override, sms_enabled, interval_days, last_sms_at, next_sms_at, opt_out, note, created_at, updated_at, updated_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(cari_kod) DO UPDATE SET
      phone_override = excluded.phone_override,
      sms_enabled = excluded.sms_enabled,
      interval_days = excluded.interval_days,
      last_sms_at = excluded.last_sms_at,
      next_sms_at = excluded.next_sms_at,
      opt_out = excluded.opt_out,
      note = excluded.note,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by
  `).run(
    String(cariKod),
    phoneOverride || null,
    smsEnabled ? 1 : 0,
    intervalDays,
    current.lastSmsAt,
    nextSmsAt,
    optOut ? 1 : 0,
    note,
    ts,
    ts,
    userId,
  );
  return getCustomerSmsSettings(cariKod);
}

function touchCustomerSms(cariKod, { lastSmsAt, nextSmsAt }, userId = null) {
  const ts = nowIso();
  db.prepare(`
    INSERT INTO customer_sms_settings (cari_kod, last_sms_at, next_sms_at, created_at, updated_at, updated_by)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(cari_kod) DO UPDATE SET
      last_sms_at = excluded.last_sms_at,
      next_sms_at = excluded.next_sms_at,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by
  `).run(String(cariKod), lastSmsAt, nextSmsAt, ts, ts, userId);
}

function insertSmsLog({
  cariKod,
  cariIsim,
  phone,
  templateId,
  message,
  status,
  provider,
  providerMessageId,
  errorCode,
  errorMessage,
  triggerType,
  sentBy,
  totalDebt,
  overdueDebt,
  oldestDays,
  attemptCount = 1,
  sentAt = null,
}) {
  const result = db.prepare(`
    INSERT INTO sms_logs (
      cari_kod, cari_isim, phone, template_id, message, status, provider, provider_message_id,
      error_code, error_message, trigger_type, sent_by, total_debt, overdue_debt, oldest_days,
      attempt_count, created_at, sent_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    cariKod || null,
    cariIsim || null,
    phone || null,
    templateId || null,
    message || null,
    status,
    provider || null,
    providerMessageId || null,
    errorCode || null,
    errorMessage ? String(errorMessage).slice(0, 255) : null,
    triggerType || 'manual',
    sentBy || null,
    totalDebt ?? null,
    overdueDebt ?? null,
    oldestDays ?? null,
    attemptCount,
    nowIso(),
    sentAt,
  );
  return Number(result.lastInsertRowid);
}

function listSmsLogs({
  page = 1,
  pageSize = 50,
  search = '',
  status = '',
  trigger = '',
  dateFrom = '',
  dateTo = '',
} = {}) {
  const where = [];
  const params = [];
  if (search) {
    where.push('(cari_kod LIKE ? OR cari_isim LIKE ? OR phone LIKE ? OR message LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }
  if (status) {
    where.push('status = ?');
    params.push(status);
  }
  if (trigger) {
    where.push('trigger_type = ?');
    params.push(trigger);
  }
  if (dateFrom) {
    where.push('created_at >= ?');
    params.push(`${dateFrom}T00:00:00.000Z`);
  }
  if (dateTo) {
    where.push('created_at <= ?');
    params.push(`${dateTo}T23:59:59.999Z`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS c FROM sms_logs ${whereSql}`).get(...params).c;
  const offset = (Math.max(1, page) - 1) * pageSize;
  const rows = db.prepare(`
    SELECT * FROM sms_logs
    ${whereSql}
    ORDER BY id DESC
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset);
  return { rows, total, page, pageSize };
}

function getSmsHistoryForCustomer(cariKod, limit = 20) {
  return db.prepare(`
    SELECT * FROM sms_logs WHERE cari_kod = ? ORDER BY id DESC LIMIT ?
  `).all(String(cariKod), Number(limit));
}

function todayStartIso() {
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return new Date(`${date}T00:00:00+03:00`).toISOString();
}

function getSmsStats() {
  const start = todayStartIso();
  const rows = db.prepare(`
    SELECT status, COUNT(*) AS c FROM sms_logs WHERE created_at >= ? GROUP BY status
  `).all(start);
  const byStatus = {};
  for (const row of rows) byStatus[row.status] = row.c;
  const totalToday = rows.reduce((sum, row) => sum + row.c, 0);
  const totalAll = db.prepare('SELECT COUNT(*) AS c FROM sms_logs').get().c;
  const lastSent = db.prepare("SELECT created_at FROM sms_logs WHERE status IN ('sent','simulated','delivered') ORDER BY id DESC LIMIT 1").get();
  return {
    today: { total: totalToday, byStatus },
    total: totalAll,
    lastSentAt: lastSent?.created_at || null,
  };
}

async function listScheduledSms({ page = 1, pageSize = 50, search = '', scope = {} } = {}) {
  const settings = getAllSettings();
  const aging = await getAging(scope);
  const settingsRows = db.prepare('SELECT * FROM customer_sms_settings').all();
  const settingsMap = new Map(settingsRows.map((row) => [row.cari_kod, row]));
  const globalInterval = Number(settings['sms.interval_days'] || 7);

  let rows = aging.detailMap
    .filter((customer) => customer.overdue30Cents > 0)
    .map((customer) => {
      const row = settingsMap.get(customer.cariKod);
      const cs = mapCustomerSettings(row, customer.cariKod);
      const phone = normalizePhone(cs.phoneOverride) || customer.phone;
      const intervalDays = cs.intervalDays === null || cs.intervalDays === undefined
        ? globalInterval
        : Number(cs.intervalDays);
      return {
        cariKod: customer.cariKod,
        cariIsim: customer.cariIsim,
        phone,
        rawPhone: customer.rawPhone,
        overdue30: centsToTl(customer.overdue30Cents),
        totalDebt: centsToTl(customer.totalDebtCents),
        oldestDays: customer.oldestDays,
        smsEnabled: cs.smsEnabled && !cs.optOut,
        optOut: cs.optOut,
        intervalDays,
        lastSmsAt: cs.lastSmsAt,
        nextSmsAt: cs.nextSmsAt,
        note: cs.note,
      };
    });

  if (search) {
    const needle = search.toLocaleLowerCase('tr');
    rows = rows.filter((row) =>
      row.cariKod.toLocaleLowerCase('tr').includes(needle) ||
      row.cariIsim.toLocaleLowerCase('tr').includes(needle));
  }

  rows.sort((a, b) => {
    const aNext = a.nextSmsAt ? Date.parse(a.nextSmsAt) : 0;
    const bNext = b.nextSmsAt ? Date.parse(b.nextSmsAt) : 0;
    if (aNext !== bNext) return aNext - bNext;
    return b.overdue30 - a.overdue30;
  });

  const total = rows.length;
  const offset = (Math.max(1, page) - 1) * pageSize;
  return {
    rows: rows.slice(offset, offset + pageSize),
    total,
    page,
    pageSize,
    globalIntervalDays: globalInterval,
  };
}

async function sendSms({
  cariKod,
  customer,
  message,
  triggerType = 'manual',
  userId = null,
  force = false,
  templateId = null,
}) {
  const settings = getAllSettings();
  const cs = getCustomerSmsSettings(cariKod);
  if (cs.optOut) return { skipped: true, reason: 'Cari için SMS izni kapalı.' };
  if (!cs.smsEnabled) return { skipped: true, reason: 'Cari için SMS gönderimi kapalı.' };

  const phone = normalizePhone(cs.phoneOverride) || customer.phone;
  if (!phone) return { skipped: true, reason: 'Geçerli telefon numarası yok.' };

  const globalInterval = Number(settings['sms.interval_days'] ?? 7);
  const intervalDays = cs.intervalDays === null || cs.intervalDays === undefined
    ? globalInterval
    : Number(cs.intervalDays);

  if (!force) {
    const now = Date.now();
    if (cs.nextSmsAt) {
      const next = Date.parse(cs.nextSmsAt);
      if (Number.isFinite(next) && next > now) {
        return { skipped: true, reason: 'Planlanan SMS tarihi gelmedi.', nextSmsAt: cs.nextSmsAt };
      }
    }
    if (cs.lastSmsAt) {
      const last = Date.parse(cs.lastSmsAt);
      if (Number.isFinite(last) && last + intervalDays * 86400000 > now) {
        const next = new Date(last + intervalDays * 86400000).toISOString();
        return { skipped: true, reason: 'SMS gönderim aralığı dolmadı.', nextSmsAt: next };
      }
    }
  }

  const providerName = settings['sms.provider'] || 'test';
  const provider = getProvider(providerName, { testMode: settings['sms.test_mode'] === '1' });
  let result;
  try {
    result = await provider.send({
      to: phone,
      message,
      header: settings['app.company_name'] || 'Efes',
    });
  } catch (error) {
    insertSmsLog({
      cariKod,
      cariIsim: customer.cariIsim,
      phone,
      templateId,
      message,
      status: 'failed',
      provider: providerName,
      errorCode: 'PROVIDER_ERROR',
      errorMessage: error.message,
      triggerType,
      sentBy: userId,
      totalDebt: customer.totalDebt ?? centsToTl(customer.totalDebtCents || 0),
      overdueDebt: customer.overdue30 ?? centsToTl(customer.overdue30Cents || 0),
      oldestDays: customer.oldestDays,
    });
    return { skipped: false, status: 'failed', error: error.message };
  }

  const status = result.status || 'sent';
  const nextSmsAt = intervalDays > 0
    ? new Date(Date.now() + intervalDays * 86400000).toISOString()
    : null;

  const logId = insertSmsLog({
    cariKod,
    cariIsim: customer.cariIsim,
    phone,
    templateId,
    message,
    status,
    provider: result.provider || providerName,
    providerMessageId: result.providerMessageId,
    triggerType,
    sentBy: userId,
    totalDebt: customer.totalDebt ?? centsToTl(customer.totalDebtCents || 0),
    overdueDebt: customer.overdue30 ?? centsToTl(customer.overdue30Cents || 0),
    oldestDays: customer.oldestDays,
    sentAt: status === 'failed' ? null : nowIso(),
  });

  if (status !== 'failed') {
    touchCustomerSms(cariKod, { lastSmsAt: nowIso(), nextSmsAt }, userId);
  }

  return {
    skipped: false,
    status,
    logId,
    providerMessageId: result.providerMessageId || null,
    nextSmsAt,
  };
}

async function runSmsJob({ triggerType = 'scheduled', userId = null, force = false, scope = {} } = {}) {
  const settings = getAllSettings();
  if (settings['sms.enabled'] !== '1') {
    return { skipped: true, reason: 'Otomatik SMS gönderimi kapalı.', sent: 0, skippedCount: 0, failed: 0 };
  }
  if (isQuietHours(new Date(), settings['sms.quiet_start'], settings['sms.quiet_end'])) {
    return { skipped: true, reason: 'Sessiz saatler arasında.', sent: 0, skippedCount: 0, failed: 0 };
  }

  const cacheAge = getCachedAgingAge(scope);
  const aging = await getAging({
    ...scope,
    force: !Number.isFinite(cacheAge) || cacheAge > 5 * 60 * 1000,
  });
  const maxPerDay = Number(settings['sms.max_per_day'] || 100);
  const start = todayStartIso();
  const sentToday = db.prepare(`
    SELECT COUNT(*) AS c FROM sms_logs
    WHERE created_at >= ? AND status IN ('sent', 'simulated', 'delivered')
  `).get(start).c;
  let remaining = Math.max(0, maxPerDay - sentToday);
  if (remaining === 0) {
    return { skipped: true, reason: 'Günlük SMS limiti doldu.', sent: 0, skippedCount: 0, failed: 0 };
  }

  const minDebt = Number(settings['sms.min_debt'] || 0);
  const template = getTemplate(Number(settings['sms.template_id'] || 0)) || getActiveTemplate();
  if (!template) {
    return { skipped: true, reason: 'Aktif SMS şablonu bulunamadı.', sent: 0, skippedCount: 0, failed: 0 };
  }

  let sent = 0;
  let skippedCount = 0;
  let failed = 0;
  const errors = [];

  for (const customer of aging.detailMap) {
    if (remaining <= 0) break;
    if (customer.overdue30Cents <= 0) continue;
    if (centsToTl(customer.overdue30Cents) < minDebt) continue;

    const message = renderSmsTemplate(template.body, templateVars(customer, settings));
    const result = await sendSms({
      cariKod: customer.cariKod,
      customer,
      message,
      triggerType,
      userId,
      force,
      templateId: template.id,
    });
    if (result.skipped) {
      skippedCount += 1;
    } else if (result.status === 'failed') {
      failed += 1;
      errors.push(`${customer.cariKod}: ${result.error}`);
    } else {
      sent += 1;
      remaining -= 1;
    }
  }

  return {
    skipped: false,
    sent,
    skippedCount,
    failed,
    errors: errors.slice(0, 20),
    candidateCount: aging.detailMap.filter((c) => c.overdue30Cents > 0).length,
  };
}

module.exports = {
  listTemplates,
  getTemplate,
  getActiveTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  renderSmsTemplate,
  templateVars,
  smsSegments,
  getCustomerSmsSettings,
  upsertCustomerSmsSettings,
  listSmsLogs,
  getSmsHistoryForCustomer,
  getSmsStats,
  listScheduledSms,
  sendSms,
  runSmsJob,
  formatMoney,
  formatDateTr,
};
