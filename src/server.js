'use strict';

const path = require('node:path');
const os = require('node:os');
const express = require('express');
require('express-async-errors');
const session = require('express-session');
const helmet = require('helmet');
const compression = require('compression');

const config = require('./config');
const { db, getSetting, getSettingNumber } = require('./db/sqlite');
const { closePool } = require('./db/erp');
const { getErpConfig } = require('./services/erpConfig');
const { SqliteSessionStore } = require('./services/sessionStore');
const { loadUser, requirePasswordChanged } = require('./middleware/auth');
const { csrfProtection } = require('./middleware/csrf');
const { notFound, errorHandler } = require('./middleware/errors');
const { consumeFlash } = require('./utils/flash');
const { renderPage } = require('./utils/render');
const { startScheduler, stopScheduler } = require('./services/scheduler');

const authRoutes = require('./routes/auth');
const pageRoutes = require('./routes/pages');
const agingApi = require('./routes/api-aging');
const ledgerApi = require('./routes/api-ledger');
const stockApi = require('./routes/api-stock');
const usersApi = require('./routes/api-users');
const settingsApi = require('./routes/api-settings');
const smsApi = require('./routes/api-sms');
const auditApi = require('./routes/api-audit');

const app = express();

app.disable('x-powered-by');
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      fontSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      baseUri: ["'self'"],
      upgradeInsecureRequests: null,
    },
  },
  hsts: config.env === 'production',
  crossOriginEmbedderPolicy: false,
}));
app.use(compression());
app.use('/public', express.static(path.join(__dirname, '..', 'public'), {
  maxAge: config.env === 'production' ? '7d' : 0,
  etag: true,
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

app.get('/healthz', (req, res) => {
  return res.json({ ok: true, time: new Date().toISOString() });
});

app.use(session({
  name: 'efes.sid',
  secret: config.sessionSecret,
  store: new SqliteSessionStore(db),
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    maxAge: config.sessionHours * 60 * 60 * 1000,
  },
}));

app.use((req, res, next) => {
  res.locals.companyName = getSetting('app.company_name', config.companyName);
  res.locals.branch = getSettingNumber('app.branch', config.branch);
  res.locals.erpDatabase = getErpConfig().database;
  res.locals.appEnv = config.env;
  res.locals.title = '';
  res.locals.flash = null;
  res.locals.csrfToken = '';
  res.locals.renderPage = (view, locals) => renderPage(res, view, locals);
  next();
});

app.use(loadUser);
app.use(consumeFlash);
app.use(csrfProtection);
app.use(requirePasswordChanged);

app.use(authRoutes);
app.use(pageRoutes);
app.use('/api/aging', agingApi);
app.use('/api/ledger', ledgerApi);
app.use('/api/stock', stockApi);
app.use('/api/users', usersApi);
app.use('/api/settings', settingsApi);
app.use('/api/sms', smsApi);
app.use('/api/audit', auditApi);

app.use(notFound);
app.use(errorHandler);

function lanAddresses() {
  const result = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const item of list || []) {
      if (item.family === 'IPv4' && !item.internal) result.push(item.address);
    }
  }
  return result;
}

function validateProductionConfig() {
  if (config.env !== 'production') return;
  if (!process.env.SESSION_SECRET || config.sessionSecret === 'efes-cari-sms-dev-secret') {
    throw new Error('Üretim ortamında SESSION_SECRET ayarlanmalıdır.');
  }
  if (!getErpConfig().password) {
    throw new Error('Üretim ortamında ERP şifresi ayarlanmalıdır (Ayarlar > ERP Veritabanı veya ERP_PASSWORD).');
  }
  if (!process.env.ADMIN_INITIAL_PASSWORD) {
    console.warn('[config] ADMIN_INITIAL_PASSWORD ayarlanmamış; varsayılan ilk admin şifresi kullanılacak.');
  }
}

let server = null;

function start(port = config.port, host = config.host) {
  if (server) return server;
  validateProductionConfig();
  server = app.listen(port, host, () => {
    console.log(`Efes Cari SMS çalışıyor: http://localhost:${port}`);
    if (host === '0.0.0.0') {
      for (const address of lanAddresses()) {
        console.log(`Ağ erişimi: http://${address}:${port}`);
      }
    }
    startScheduler();
  });
  return server;
}

async function shutdown(signal) {
  console.log(`\n[server] ${signal} alındı, kapatılıyor...`);
  stopScheduler();
  if (server) {
    await new Promise((resolve) => server.close(resolve));
    server = null;
  }
  await closePool();
  try { db.close(); } catch { /* ignore */ }
  process.exit(0);
}

if (require.main === module) {
  start();
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

module.exports = { app, start, shutdown };
