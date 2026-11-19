'use strict';

const express = require('express');
const config = require('../config');
const { renderPage } = require('../utils/render');
const { requirePermission } = require('../middleware/auth');
const { todayInIstanbul } = require('../utils/dates');
const { getSetting, getSettingNumber } = require('../db/sqlite');
const { getAllSettings } = require('../services/settings');
const { getErpConfig } = require('../services/erpConfig');
const { listUsers, getUserPermissions } = require('../services/users');
const { PERMISSIONS, ROLE_DEFAULTS } = require('../services/permissionCatalog');
const { listTemplates } = require('../services/sms');

const router = express.Router();

router.get('/', (req, res) => {
  if (!req.user) return res.redirect('/login');
  return renderPage(res, 'home', {
    layout: 'layout',
    title: 'Ana Ekran',
    today: todayInIstanbul(),
  });
});

router.get('/cari-hareketleri', requirePermission('aging.view'), async (req, res) => {
  return renderPage(res, 'ledger', {
    layout: 'layout',
    title: 'Bayi Cari Hareketleri',
    today: todayInIstanbul(),
  });
});

router.get('/stok', requirePermission('stock.view'), async (req, res) => {
  return renderPage(res, 'stock', {
    layout: 'layout',
    title: 'Stok Durumu',
    today: todayInIstanbul(),
  });
});

router.get('/stok/litreler', requirePermission('stock.litre'), async (req, res) => {
  return renderPage(res, 'stock-litre', {
    layout: 'layout',
    title: 'Stok Litre Tanımları',
    today: todayInIstanbul(),
  });
});

router.get('/aging', requirePermission('aging.view'), async (req, res) => {
  const settings = getAllSettings();
  return renderPage(res, 'aging', {
    layout: 'layout',
    title: 'Cari Yaşlandırma',
    today: todayInIstanbul(),
    settings,
  });
});

router.get('/users', requirePermission('users.view'), async (req, res) => {
  const users = listUsers().map((user) => ({
    ...user,
    permissions: getUserPermissions(user.id),
  }));
  return renderPage(res, 'users', {
    layout: 'layout',
    title: 'Kullanıcılar',
    users,
    permissionCatalog: PERMISSIONS,
    roleDefaults: ROLE_DEFAULTS,
    defaultErpDatabase: getSetting('erp.database', config.erp.database),
    defaultBranch: getSettingNumber('app.branch', config.branch),
  });
});

router.get('/settings', requirePermission('settings.manage'), async (req, res) => {
  const erpFull = getErpConfig();
  const { password, ...erp } = erpFull;
  return renderPage(res, 'settings', {
    layout: 'layout',
    title: 'Sistem Ayarları',
    settings: getAllSettings(),
    templates: listTemplates(),
    erp,
    erpPasswordSet: Boolean(password),
  });
});

router.get('/sms', requirePermission('sms.view'), async (req, res) => {
  return renderPage(res, 'sms-logs', {
    layout: 'layout',
    title: 'SMS Yönetimi',
    templates: listTemplates(),
    today: todayInIstanbul(),
  });
});

router.get('/audit', requirePermission('audit.view'), async (req, res) => {
  return renderPage(res, 'audit', {
    layout: 'layout',
    title: 'İşlem Kayıtları',
  });
});

module.exports = router;
