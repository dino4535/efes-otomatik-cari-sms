'use strict';

const express = require('express');
const { requirePermission } = require('../middleware/auth');
const { audit } = require('../services/audit');
const {
  listUsers,
  getUserById,
  getUserPermissions,
  setUserPermissions,
  createUser,
  updateUser,
  setUserPassword,
  setUserActive,
  countActiveAdmins,
  publicUser,
  resolveUserScope,
} = require('../services/users');
const { PERMISSIONS } = require('../services/permissionCatalog');

const router = express.Router();

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function withPermissions(user) {
  const base = Object.prototype.hasOwnProperty.call(user, 'full_name')
    ? publicUser(user)
    : user;
  return { ...base, permissions: getUserPermissions(user.id) };
}

function assertCanManageActor(req, target) {
  if (req.user.role !== 'admin' && target.role === 'admin') {
    throw fail('Yönetici hesapları üzerinde yalnızca yöneticiler işlem yapabilir.', 403);
  }
}

function scopeRequested(body) {
  return body && (
    Object.prototype.hasOwnProperty.call(body, 'erpDatabase') ||
    Object.prototype.hasOwnProperty.call(body, 'branch')
  );
}

function assertCanChangeScope(req) {
  if (req.user.role !== 'admin') {
    throw fail('ERP veritabanı ve şube yalnızca sistem yöneticisi tarafından değiştirilebilir.', 403);
  }
}

function requestedScope(req) {
  return {
    erpDatabase: req.body.erpDatabase,
    branch: req.body.branch,
  };
}

router.get('/', requirePermission('users.view'), (req, res) => {
  const users = listUsers({ search: req.query.search || '' }).map(withPermissions);
  return res.json({
    ok: true,
    data: {
      users,
      permissionCatalog: PERMISSIONS,
    },
  });
});

router.post('/', requirePermission('users.manage'), (req, res) => {
  const role = req.body.role === 'admin' ? 'admin' : 'user';
  if (role === 'admin' && req.user.role !== 'admin') {
    throw fail('Yönetici hesabı oluşturmak için yönetici olmanız gerekir.', 403);
  }
  if (scopeRequested(req.body)) assertCanChangeScope(req);

  // Yönetici olmayan kullanıcılar yeni kullanıcı oluşturabilir; bu durumda
  // yeni kullanıcı, oluşturan kullanıcının veritabanı ve şubesini devralır.
  const actorScope = resolveUserScope(req.user);
  const requested = requestedScope(req);
  const scope = req.user.role === 'admin'
    ? {
        erpDatabase: requested.erpDatabase === undefined || requested.erpDatabase === ''
          ? actorScope.database
          : requested.erpDatabase,
        branch: requested.branch === undefined || requested.branch === ''
          ? actorScope.branch
          : requested.branch,
      }
    : { erpDatabase: actorScope.database, branch: actorScope.branch };

  const user = createUser({
    username: req.body.username,
    password: req.body.password,
    fullName: req.body.fullName,
    role,
    permissions: Array.isArray(req.body.permissions) ? req.body.permissions : [],
    erpDatabase: scope.erpDatabase,
    branch: scope.branch,
  }, req.user.id);
  audit(req, 'users.create', 'user', user.id, {
    username: user.username,
    role: user.role,
    erpDatabase: user.erp_database,
    branch: user.branch,
  });
  return res.status(201).json({ ok: true, data: withPermissions(user) });
});

router.put('/:id', requirePermission('users.manage'), (req, res) => {
  const target = getUserById(req.params.id);
  if (!target) throw fail('Kullanıcı bulunamadı.', 404);
  assertCanManageActor(req, target);
  if (scopeRequested(req.body)) assertCanChangeScope(req);

  const nextRole = req.body.role === 'admin' ? 'admin' : 'user';
  if (nextRole === 'admin' && req.user.role !== 'admin') {
    throw fail('Yönetici yetkisi vermek için yönetici olmanız gerekir.', 403);
  }
  if (Number(target.id) === Number(req.user.id) && nextRole !== 'admin') {
    throw fail('Kendi yönetici rolünüzü kaldıramazsınız.', 400);
  }
  if (target.role === 'admin' && nextRole === 'user' && countActiveAdmins(target.id) === 0) {
    throw fail('Sistemde en az bir aktif yönetici kalmalıdır.', 400);
  }

  const scope = req.user.role === 'admin' ? requestedScope(req) : {};
  const updated = updateUser(target.id, {
    fullName: req.body.fullName,
    role: nextRole,
    ...scope,
  }, req.user.id);
  audit(req, 'users.update', 'user', target.id, {
    username: target.username,
    fullName: updated.full_name,
    role: updated.role,
    erpDatabase: updated.erp_database,
    branch: updated.branch,
  });
  return res.json({ ok: true, data: withPermissions(updated) });
});

router.post('/:id/active', requirePermission('users.manage'), (req, res) => {
  const target = getUserById(req.params.id);
  if (!target) throw fail('Kullanıcı bulunamadı.', 404);
  assertCanManageActor(req, target);

  const isActive = Boolean(req.body.isActive);
  if (Number(target.id) === Number(req.user.id) && !isActive) {
    throw fail('Kendi hesabınızı pasifleştiremezsiniz.', 400);
  }
  if (target.role === 'admin' && target.is_active && !isActive && countActiveAdmins(target.id) === 0) {
    throw fail('Sistemde en az bir aktif yönetici kalmalıdır.', 400);
  }

  const updated = setUserActive(target.id, isActive, req.user.id);
  audit(req, isActive ? 'users.activate' : 'users.deactivate', 'user', target.id, {
    username: target.username,
  });
  return res.json({ ok: true, data: withPermissions(updated) });
});

router.post('/:id/password', requirePermission('users.manage'), (req, res) => {
  const target = getUserById(req.params.id);
  if (!target) throw fail('Kullanıcı bulunamadı.', 404);
  assertCanManageActor(req, target);

  const updated = setUserPassword(target.id, req.body.password, {
    mustChange: true,
    actorId: req.user.id,
  });
  audit(req, 'users.password_reset', 'user', target.id, { username: target.username });
  return res.json({ ok: true, data: withPermissions(updated) });
});

router.put('/:id/permissions', requirePermission('users.manage'), (req, res) => {
  const target = getUserById(req.params.id);
  if (!target) throw fail('Kullanıcı bulunamadı.', 404);
  assertCanManageActor(req, target);
  if (target.role === 'admin') {
    throw fail('Yönetici hesaplarının tüm yetkileri otomatik olarak açıktır.', 400);
  }

  const validKeys = new Set(PERMISSIONS.map((permission) => permission.key));
  const requested = Array.isArray(req.body.permissions) ? req.body.permissions : [];
  const selected = requested.filter((key) => validKeys.has(key));
  setUserPermissions(target.id, selected, req.user.id);
  audit(req, 'users.permissions', 'user', target.id, {
    username: target.username,
    permissions: selected,
  });
  return res.json({ ok: true, data: withPermissions(getUserById(target.id)) });
});

module.exports = router;
