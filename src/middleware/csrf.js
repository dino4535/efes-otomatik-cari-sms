'use strict';

const crypto = require('node:crypto');

function ensureToken(req) {
  if (!req.session) return '';
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function csrfProtection(req, res, next) {
  const token = ensureToken(req);
  res.locals.csrfToken = token;

  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  const supplied = req.get('x-csrf-token') || req.body?._csrf || req.query?._csrf;
  if (!supplied || !safeEqual(supplied, req.session?.csrfToken)) {
    const error = new Error('Oturum güvenlik doğrulaması başarısız. Sayfayı yenileyip tekrar deneyin.');
    error.status = 403;
    return next(error);
  }
  return next();
}

module.exports = { csrfProtection };
