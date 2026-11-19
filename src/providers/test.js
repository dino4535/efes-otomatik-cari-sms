'use strict';

const crypto = require('node:crypto');

async function send({ to, message, header }) {
  return {
    status: 'simulated',
    provider: 'test',
    providerMessageId: `TEST-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
    raw: { to, message, header },
  };
}

module.exports = { send };
