'use strict';

const testProvider = require('./test');

function getProvider(name, { testMode = false } = {}) {
  const providerName = String(name || 'test').toLowerCase();
  if (testMode || providerName === 'test') {
    return { ...testProvider, name: 'test' };
  }
  const error = new Error(
    `"${providerName}" SMS sağlayıcısı henüz tanımlı değil. Sağlayıcı API bilgileri eklendiğinde canlı gönderim aktifleştirilecek.`,
  );
  error.status = 501;
  throw error;
}

module.exports = { getProvider };
