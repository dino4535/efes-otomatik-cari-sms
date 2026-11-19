'use strict';

const express = require('express');
const { requirePermission } = require('../middleware/auth');
const { audit } = require('../services/audit');
const { getAllSettings, getSettingsWithMeta, updateSettings } = require('../services/settings');
const { testConnection } = require('../db/erp');

const router = express.Router();

router.get('/', requirePermission('settings.manage'), (req, res) => {
  return res.json({
    ok: true,
    data: {
      settings: getAllSettings(),
      meta: getSettingsWithMeta(),
    },
  });
});

const ADMIN_ONLY_SETTINGS = new Set(['app.branch', 'erp.database']);

router.put('/', requirePermission('settings.manage'), (req, res) => {
  const updates = req.body?.settings && typeof req.body.settings === 'object'
    ? req.body.settings
    : req.body;
  const attempted = Object.keys(updates || {}).filter((key) => ADMIN_ONLY_SETTINGS.has(key));
  if (attempted.length && req.user.role !== 'admin') {
    return res.status(403).json({
      ok: false,
      error: 'ERP veritabanı ve şube varsayılanlarını yalnızca sistem yöneticisi değiştirebilir.',
    });
  }
  const changed = updateSettings(updates, req.user.id);
  if (changed.length) {
    audit(req, 'settings.update', 'settings', null, {
      changed: changed.map((item) => ({
        key: item.key,
        previous: item.previous,
        value: item.value,
      })),
    });
  }
  return res.json({
    ok: true,
    data: {
      settings: getAllSettings(),
      changed,
    },
  });
});

router.post('/test-erp', requirePermission('settings.manage'), async (req, res) => {
  const input = req.body?.connection && typeof req.body.connection === 'object'
    ? req.body.connection
    : (req.body?.settings && typeof req.body.settings === 'object' ? req.body.settings : (req.body || {}));
  try {
    const result = await testConnection(input);
    audit(req, 'settings.test_erp', 'erp', result.db, {
      server: result.server,
      port: result.port,
      database: result.db,
    });
    return res.json({
      ok: true,
      data: {
        database: result.db,
        serverTime: result.now,
        serverName: result.serverName,
      },
    });
  } catch (error) {
    const message = String(error.message || 'Bağlantı kurulamadı')
      .replace(/password\s*=\s*[^;,\s]+/gi, 'password=***')
      .slice(0, 600);
    audit(req, 'settings.test_erp_failed', 'erp', null, {
      server: typeof input.server === 'string' ? input.server : null,
      database: typeof input.database === 'string' ? input.database : null,
      error: message,
    });
    return res.status(Number(error.status) || 400).json({
      ok: false,
      error: `ERP bağlantısı başarısız: ${message}`,
    });
  }
});

module.exports = router;
