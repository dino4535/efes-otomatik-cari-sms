'use strict';

const config = require('../config');
const { getSetting, getSettingBool } = require('../db/sqlite');

function textSetting(key, fallback) {
  const value = getSetting(key);
  if (value === undefined || value === null) return fallback;
  const trimmed = String(value).trim();
  return trimmed || fallback;
}

function numberSetting(key, fallback, min, max) {
  const value = Number(getSetting(key));
  if (!Number.isFinite(value) || value < min || value > max) return fallback;
  return Math.trunc(value);
}

function getErpConfig() {
  return {
    server: textSetting('erp.server', config.erp.server),
    port: numberSetting('erp.port', config.erp.port, 1, 65535),
    database: textSetting('erp.database', config.erp.database),
    user: textSetting('erp.user', config.erp.user),
    password: textSetting('erp.password', config.erp.password),
    encrypt: getSettingBool('erp.encrypt', config.erp.encrypt),
    trustServerCertificate: getSettingBool('erp.trust_cert', config.erp.trustServerCertificate),
  };
}

module.exports = {
  getErpConfig,
};
