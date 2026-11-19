'use strict';

const { TextDecoder } = require('node:util');

const turkishDecoder = new TextDecoder('windows-1254');

function decodeErpText(value) {
  if (value === null || value === undefined) return '';
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return turkishDecoder.decode(value);
  }
  return String(value);
}

module.exports = { decodeErpText };
