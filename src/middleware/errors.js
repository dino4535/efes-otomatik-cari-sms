'use strict';

const { renderPage } = require('../utils/render');

function notFound(req, res) {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ ok: false, error: 'İstenen kayıt bulunamadı.' });
  }
  res.status(404);
  return renderPage(res, 'error', {
    layout: res.locals.currentUser ? 'layout' : 'layout-auth',
    title: 'Sayfa Bulunamadı',
    status: 404,
    message: 'Aradığınız sayfa bulunamadı.',
  });
}

function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);

  const status = Number(error.status) || 500;
  if (status >= 500) {
    console.error(`[${req.method} ${req.originalUrl}]`, error);
  }

  const message = status >= 500
    ? 'Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.'
    : (error.message || 'İşlem tamamlanamadı.');

  if (req.path.startsWith('/api/')) {
    return res.status(status).json({
      ok: false,
      error: message,
      ...(error.code ? { code: error.code } : {}),
      ...(error.details ? { details: error.details } : {}),
    });
  }

  res.status(status);
  return renderPage(res, error.view || 'error', {
    layout: req.user ? 'layout' : 'layout-auth',
    title: status === 403 ? 'Yetkisiz İşlem' : 'Hata',
    status,
    message,
  }).catch(next);
}

module.exports = { notFound, errorHandler };
