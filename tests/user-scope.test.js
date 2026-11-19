'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeUserScope, resolveUserScope } = require('../src/services/users');

test('kullanıcı kapsamı veritabanı ve şube değerlerini doğrular', () => {
  assert.deepEqual(
    normalizeUserScope({ erpDatabase: '  BERMER2026  ', branch: '0' }),
    { erpDatabase: 'BERMER2026', branch: 0 },
  );
  assert.throws(
    () => normalizeUserScope({ erpDatabase: '', branch: 0 }),
    /ERP veritabanı zorunludur/,
  );
  assert.throws(
    () => normalizeUserScope({ erpDatabase: 'DB', branch: 1000 }),
    /Şube kodu 0-999/,
  );
  assert.throws(
    () => normalizeUserScope({ erpDatabase: 'DB', branch: 'x' }),
    /Şube kodu 0-999/,
  );
});

test('kullanıcı kapsamı boş alanlarda sistem varsayılanına düşer', () => {
  assert.deepEqual(
    resolveUserScope({ erp_database: null, branch: null }, { database: 'VARSAYILAN', branch: 7 }),
    { database: 'VARSAYILAN', branch: 7 },
  );
  assert.deepEqual(
    resolveUserScope({ erp_database: 'KULLANICI_DB', branch: 3 }, { database: 'VARSAYILAN', branch: 7 }),
    { database: 'KULLANICI_DB', branch: 3 },
  );
});
