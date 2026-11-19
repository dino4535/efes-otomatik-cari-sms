'use strict';

const { db } = require('../db/sqlite');
const { getUserById, publicUser, resolveUserScope } = require('../services/users');
const { getUserPermissionSet } = require('../services/permissions');

function wantsJson(req) {
  return req.path.startsWith('/api/') || req.accepts(['html', 'json']) === 'json';
}

function deny(req, res, next, message, status = 403) {
  if (wantsJson(req)) {
    return res.status(status).json({ ok: false, error: message });
  }
  const error = new Error(message);
  error.status = status;
  return next(error);
}

function loadUser(req, res, next) {
  res.locals.currentPath = req.path;
  res.locals.currentUser = null;
  res.locals.permissions = [];
  res.locals.can = () => false;

  if (!req.session?.userId) return next();

  const user = getUserById(req.session.userId);
  if (!user || !user.is_active) {
    return req.session.destroy(() => next());
  }

  req.user = user;
  const permissionSet = getUserPermissionSet(db, user);
  const scope = resolveUserScope(user);
  res.locals.currentUser = publicUser(user);
  res.locals.permissions = [...permissionSet];
  res.locals.can = (key) => permissionSet.has(key);
  res.locals.branch = scope.branch;
  res.locals.erpDatabase = scope.database;
  return next();
}

function requireAuth(req, res, next) {
  if (req.user) return next();
  if (wantsJson(req)) {
    return res.status(401).json({ ok: false, error: 'Oturum açmanız gerekiyor.' });
  }
  const nextUrl = encodeURIComponent(req.originalUrl || '/');
  return res.redirect(`/login?next=${nextUrl}`);
}

function requireGuest(req, res, next) {
  if (req.user) return res.redirect('/');
  return next();
}

function requirePasswordChanged(req, res, next) {
  if (!req.user || !req.user.must_change_password) return next();
  const allowed = ['/change-password', '/logout'];
  if (allowed.includes(req.path)) return next();
  if (wantsJson(req)) {
    return res.status(403).json({
      ok: false,
      code: 'PASSWORD_CHANGE_REQUIRED',
      error: 'Devam etmeden önce şifrenizi değiştirmelisiniz.',
    });
  }
  return res.redirect('/change-password');
}

function requirePermission(key) {
  return (req, res, next) => {
    if (!req.user) return requireAuth(req, res, next);
    const set = new Set(res.locals.permissions || []);
    if (set.has(key)) return next();
    return deny(req, res, next, 'Bu işlem için yetkiniz bulunmuyor.');
  };
}

function requireAdmin(req, res, next) {
  if (!req.user) return requireAuth(req, res, next);
  if (req.user.role === 'admin') return next();
  return deny(req, res, next, 'Bu işlem yalnızca yöneticiler içindir.');
}

module.exports = {
  loadUser,
  requireAuth,
  requireGuest,
  requirePasswordChanged,
  requirePermission,
  requireAdmin,
  wantsJson,
};
