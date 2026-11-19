'use strict';

const express = require('express');
const { setFlash } = require('../utils/flash');
const { renderPage } = require('../utils/render');
const { audit, getClientIp } = require('../services/audit');
const { verifyPassword, validatePassword } = require('../services/passwords');
const {
  getUserByUsername,
  recordLoginAttempt,
  failedLoginCount,
  touchLastLogin,
  setUserPassword,
  publicUser,
} = require('../services/users');
const { requireAuth, requireGuest } = require('../middleware/auth');

const router = express.Router();

const MAX_FAILED_ATTEMPTS = 8;
const LOCK_MINUTES = 15;

function safeNext(value) {
  const next = String(value || '');
  return next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

router.get('/login', requireGuest, async (req, res) => {
  return renderPage(res, 'login', {
    layout: 'layout-auth',
    title: 'Sisteme Giriş',
    next: safeNext(req.query.next),
    username: '',
    error: null,
  });
});

router.post('/login', requireGuest, async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const next = safeNext(req.body.next);
  const ip = getClientIp(req);

  const renderError = (message, status = 401) => {
    res.status(status);
    return renderPage(res, 'login', {
      layout: 'layout-auth',
      title: 'Sisteme Giriş',
      next,
      username,
      error: message,
    });
  };

  if (!username || !password) {
    return renderError('Kullanıcı adı ve şifre zorunludur.', 400);
  }

  if (failedLoginCount(username, ip, LOCK_MINUTES) >= MAX_FAILED_ATTEMPTS) {
    return renderError(
      `Çok fazla başarısız deneme yapıldı. Lütfen ${LOCK_MINUTES} dakika sonra tekrar deneyin.`,
      429,
    );
  }

  const user = getUserByUsername(username);
  const valid = user ? verifyPassword(password, user.password_hash) : false;

  if (!valid) {
    recordLoginAttempt(username, ip, false);
    audit(req, 'auth.login_failed', 'user', user?.id || null, { username });
    return renderError('Kullanıcı adı veya şifre hatalı.');
  }

  if (!user.is_active) {
    recordLoginAttempt(username, ip, false);
    audit(req, 'auth.login_inactive', 'user', user.id, { username });
    return renderError('Bu kullanıcı pasif durumda. Yöneticinize başvurun.', 403);
  }

  recordLoginAttempt(username, ip, true);

  return req.session.regenerate((error) => {
    if (error) return renderError('Oturum başlatılamadı. Lütfen tekrar deneyin.', 500);
    req.session.userId = user.id;
    req.session.loggedInAt = new Date().toISOString();
    req.user = user;
    touchLastLogin(user.id);
    audit(req, 'auth.login', 'user', user.id, { username });
    setFlash(req, 'success', `Hoş geldiniz, ${publicUser(user).fullName || user.username}.`);

    if (user.must_change_password) {
      setFlash(req, 'info', 'Güvenlik için ilk girişte şifrenizi değiştirmeniz gerekiyor.');
      return res.redirect('/change-password');
    }
    return res.redirect(next);
  });
});

router.post('/logout', requireAuth, (req, res) => {
  audit(req, 'auth.logout', 'user', req.user.id, null);
  return req.session.destroy(() => {
    res.clearCookie('efes.sid');
    return res.redirect('/login');
  });
});

router.get('/change-password', requireAuth, async (req, res) => {
  return renderPage(res, 'change-password', {
    layout: 'layout',
    title: 'Şifre Değiştir',
    forced: Boolean(req.user.must_change_password),
    error: null,
  });
});

router.post('/change-password', requireAuth, async (req, res) => {
  const currentPassword = String(req.body.current_password || '');
  const newPassword = String(req.body.new_password || '');
  const confirmPassword = String(req.body.confirm_password || '');

  const renderError = (message, status = 400) => {
    res.status(status);
    return renderPage(res, 'change-password', {
      layout: 'layout',
      title: 'Şifre Değiştir',
      forced: Boolean(req.user.must_change_password),
      error: message,
    });
  };

  if (!verifyPassword(currentPassword, req.user.password_hash)) {
    return renderError('Mevcut şifre hatalı.');
  }
  const passwordError = validatePassword(newPassword);
  if (passwordError) return renderError(passwordError);
  if (newPassword !== confirmPassword) return renderError('Yeni şifreler birbiriyle eşleşmiyor.');
  if (currentPassword === newPassword) {
    return renderError('Yeni şifre mevcut şifreden farklı olmalıdır.');
  }

  setUserPassword(req.user.id, newPassword, { mustChange: false, actorId: req.user.id });
  audit(req, 'auth.password_changed', 'user', req.user.id, null);

  return req.session.regenerate((error) => {
    if (error) return renderError('Şifre değiştirildi ancak oturum yenilenemedi. Tekrar giriş yapın.', 500);
    req.session.userId = req.user.id;
    setFlash(req, 'success', 'Şifreniz başarıyla değiştirildi.');
    return res.redirect('/');
  });
});

module.exports = router;
