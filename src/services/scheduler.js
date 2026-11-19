'use strict';

const cron = require('node-cron');
const config = require('../config');
const { db, nowIso, cleanupSessions, cleanupLoginAttempts } = require('../db/sqlite');
const { getAllSettings } = require('./settings');
const { runSmsJob } = require('./sms');
const { isQuietHours, todayInIstanbul, istanbulMinutes } = require('../utils/dates');

let task = null;
let running = false;
let lastCleanupMinute = -1;

function startOfIstanbulDayIso(date = todayInIstanbul()) {
  return new Date(`${date}T00:00:00+03:00`).toISOString();
}

function parseTimeToMinutes(value) {
  const [hour, minute] = String(value || '10:00').split(':').map(Number);
  return (hour || 0) * 60 + (minute || 0);
}

function hasSuccessfulRunToday(jobName) {
  const row = db.prepare(`
    SELECT id FROM job_runs
    WHERE job_name = ? AND status = 'success' AND started_at >= ?
    ORDER BY id DESC LIMIT 1
  `).get(jobName, startOfIstanbulDayIso());
  return Boolean(row);
}

function beginJobRun(jobName) {
  const result = db.prepare(`
    INSERT INTO job_runs (job_name, status, detail, started_at)
    VALUES (?, 'running', NULL, ?)
  `).run(jobName, nowIso());
  return Number(result.lastInsertRowid);
}

function finishJobRun(id, status, detail) {
  db.prepare(`
    UPDATE job_runs SET status = ?, detail = ?, finished_at = ? WHERE id = ?
  `).run(status, detail ? String(detail).slice(0, 4000) : null, nowIso(), Number(id));
}

function listJobRuns(limit = 20) {
  return db.prepare(`
    SELECT * FROM job_runs ORDER BY id DESC LIMIT ?
  `).all(Number(limit));
}

function runCleanup() {
  try {
    cleanupSessions();
    cleanupLoginAttempts(30);
  } catch (error) {
    console.error('[scheduler] temizlik hatası:', error.message);
  }
}

async function runSmsJobNow({ userId = null, triggerType = 'manual', force = false, scope = {} } = {}) {
  if (running) {
    return { skipped: true, reason: 'SMS görevi şu anda çalışıyor.', sent: 0, skippedCount: 0, failed: 0 };
  }
  running = true;
  const jobId = beginJobRun(triggerType === 'scheduled' ? 'sms.auto' : 'sms.manual');
  try {
    const result = await runSmsJob({ triggerType, userId, force, scope });
    const status = result.skipped ? 'skipped' : (result.failed > 0 ? 'partial' : 'success');
    finishJobRun(jobId, status, JSON.stringify(result));
    return result;
  } catch (error) {
    finishJobRun(jobId, 'failed', error.stack || error.message);
    throw error;
  } finally {
    running = false;
  }
}

async function tick() {
  const now = new Date();
  const minuteOfHour = istanbulMinutes(now) % 60;
  if (minuteOfHour < 5 && lastCleanupMinute !== minuteOfHour) {
    lastCleanupMinute = minuteOfHour;
    runCleanup();
  }

  const settings = getAllSettings();
  if (settings['sms.enabled'] !== '1') return;
  if (hasSuccessfulRunToday('sms.auto')) return;

  const nowMinutes = istanbulMinutes(now);
  const sendMinutes = parseTimeToMinutes(settings['sms.send_time'] || '10:00');
  if (nowMinutes < sendMinutes) return;
  if (isQuietHours(now, settings['sms.quiet_start'], settings['sms.quiet_end'])) return;
  if (running) return;

  try {
    const result = await runSmsJobNow({ triggerType: 'scheduled' });
    console.log('[scheduler] SMS görevi:', JSON.stringify(result));
  } catch (error) {
    console.error('[scheduler] SMS görevi hatası:', error.message);
  }
}

function startScheduler() {
  if (task) return task;
  runCleanup();
  task = cron.schedule('*/5 * * * *', () => {
    tick().catch((error) => console.error('[scheduler] tick hatası:', error.message));
  }, { timezone: config.timezone });

  // Uygulama gün ortasında açıldıysa ve görev kaçırıldıysa hemen kontrol et.
  setTimeout(() => {
    tick().catch((error) => console.error('[scheduler] ilk kontrol hatası:', error.message));
  }, 5000).unref();

  console.log(`[scheduler] akti (${config.timezone}), 5 dakikada bir kontrol edilecek.`);
  return task;
}

function stopScheduler() {
  if (task) {
    task.stop();
    task = null;
  }
}

function isRunning() {
  return running;
}

module.exports = {
  startScheduler,
  stopScheduler,
  runSmsJobNow,
  listJobRuns,
  hasSuccessfulRunToday,
  isRunning,
};
