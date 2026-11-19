'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('../src/config');

const keep = Math.max(1, Number.parseInt(process.env.BACKUP_KEEP || '30', 10) || 30);
const backupDir = path.resolve(
  process.cwd(),
  process.env.BACKUP_DIR || path.join(path.dirname(config.dbPath), 'backups'),
);

function timestamp() {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\..+$/, '')
    .replace('T', '-');
}

function quoteSqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function main() {
  if (!fs.existsSync(config.dbPath)) {
    throw new Error(`Uygulama veritabanı bulunamadı: ${config.dbPath}`);
  }

  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = timestamp();
  let target = path.join(backupDir, `app-${stamp}.db`);
  if (fs.existsSync(target)) {
    target = path.join(backupDir, `app-${stamp}-${Date.now()}.db`);
  }

  const source = new DatabaseSync(config.dbPath);
  try {
    // VACUUM INTO, WAL dosyasındaki değişiklikler dahil tutarlı bir kopya üretir.
    source.exec(`VACUUM INTO ${quoteSqlString(target)}`);
  } finally {
    source.close();
  }

  const copy = new DatabaseSync(target, { readOnly: true });
  let integrity = 'unknown';
  try {
    const row = copy.prepare('PRAGMA integrity_check').get();
    integrity = row?.integrity_check || 'unknown';
  } finally {
    copy.close();
  }

  if (integrity !== 'ok') {
    throw new Error(`Yedek doğrulanamadı (integrity_check: ${integrity}).`);
  }

  const backups = fs.readdirSync(backupDir)
    .filter((name) => /^app-.*\.db$/.test(name))
    .map((name) => ({
      name,
      fullPath: path.join(backupDir, name),
      mtime: fs.statSync(path.join(backupDir, name)).mtimeMs,
    }))
    .sort((left, right) => right.mtime - left.mtime);

  for (const old of backups.slice(keep)) {
    fs.rmSync(old.fullPath, { force: true });
  }

  const size = fs.statSync(target).size;
  console.log(`Yedek oluşturuldu: ${target}`);
  console.log(`Boyut: ${(size / 1024).toFixed(1)} KB · Bütünlük: ${integrity} · Saklanan: ${Math.min(backups.length, keep)}`);
}

try {
  main();
} catch (error) {
  console.error('Yedekleme başarısız:', error.message);
  process.exitCode = 1;
}
