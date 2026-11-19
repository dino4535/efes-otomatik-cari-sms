'use strict';

const path = require('node:path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(process.cwd(), '.env') });

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toLowerCase() === 'true' || String(value) === '1';
}

function int(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

const config = {
  port: int(process.env.PORT, 5555),
  host: process.env.HOST || '0.0.0.0',
  env: process.env.NODE_ENV || 'development',
  companyName: process.env.APP_COMPANY_NAME || 'Efes',
  branch: int(process.env.APP_BRANCH, 3),
  timezone: process.env.APP_TIMEZONE || 'Europe/Istanbul',

  erp: {
    server: process.env.ERP_SERVER || '127.0.0.1',
    port: int(process.env.ERP_PORT, 1433),
    database: process.env.ERP_DATABASE || 'DINO2026',
    user: process.env.ERP_USER || 'erp_kullanici',
    password: process.env.ERP_PASSWORD || '',
    encrypt: bool(process.env.ERP_ENCRYPT, false),
    trustServerCertificate: bool(process.env.ERP_TRUST_CERT, true),
  },

  dbPath: path.resolve(process.cwd(), process.env.APP_DB_PATH || './data/app.db'),
  sessionSecret: process.env.SESSION_SECRET || 'efes-cari-sms-dev-secret',
  sessionHours: int(process.env.SESSION_HOURS, 8),

  admin: {
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_INITIAL_PASSWORD || 'degistirin-bu-degeri',
    fullName: process.env.ADMIN_FULL_NAME || 'Sistem Yöneticisi',
  },
};

module.exports = config;
