'use strict';

function todayInIstanbul() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function isValidDateOnly(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function dayDiff(asOf, dateOnly) {
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${dateOnly}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((a - b) / 86400000);
}

function bucketForDays(days) {
  if (days <= 14) return 'd0_14';
  if (days <= 21) return 'd15_21';
  if (days <= 30) return 'd22_30';
  if (days <= 45) return 'd31_45';
  if (days <= 60) return 'd46_60';
  return 'd61';
}

function bucketLabel(days) {
  if (days <= 14) return '0-14 Gün';
  if (days <= 21) return '15-21 Gün';
  if (days <= 30) return '22-30 Gün';
  if (days <= 45) return '31-45 Gün';
  if (days <= 60) return '46-60 Gün';
  return '61+ Gün';
}

function istanbulMinutes(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Istanbul',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value || 0);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value || 0);
  return hour * 60 + minute;
}

function isQuietHours(now, start, end) {
  const [sh, sm] = String(start || '20:00').split(':').map(Number);
  const [eh, em] = String(end || '09:00').split(':').map(Number);
  const minutes = istanbulMinutes(now);
  const s = (sh || 0) * 60 + (sm || 0);
  const e = (eh || 0) * 60 + (em || 0);
  if (s === e) return false;
  if (s < e) return minutes >= s && minutes < e;
  return minutes >= s || minutes < e;
}

module.exports = {
  todayInIstanbul,
  isValidDateOnly,
  dayDiff,
  bucketForDays,
  bucketLabel,
  isQuietHours,
  istanbulMinutes,
};
