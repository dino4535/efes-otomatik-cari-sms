'use strict';

const config = require('../config');
const { db, nowIso, transaction, getSetting, getSettingNumber } = require('../db/sqlite');
const { hashPassword, validatePassword } = require('./passwords');
const { PERMISSIONS, ROLE_DEFAULTS } = require('./permissionCatalog');

const USERNAME_RE = /^[a-zA-Z0-9._-]{3,32}$/;

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    fullName: row.full_name,
    role: row.role,
    isActive: Boolean(row.is_active),
    mustChangePassword: Boolean(row.must_change_password),
    erpDatabase: row.erp_database || null,
    branch: row.branch === null || row.branch === undefined ? null : Number(row.branch),
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeUserScope({ erpDatabase, branch } = {}) {
  const cleanDatabase = String(erpDatabase ?? '').trim();
  if (!cleanDatabase) {
    const error = new Error('ERP veritabanı zorunludur.');
    error.status = 400;
    throw error;
  }
  if (cleanDatabase.length > 128) {
    const error = new Error('ERP veritabanı adı 128 karakterden uzun olamaz.');
    error.status = 400;
    throw error;
  }
  const branchNumber = Number(branch);
  if (!Number.isInteger(branchNumber) || branchNumber < 0 || branchNumber > 999) {
    const error = new Error('Şube kodu 0-999 arasında bir tam sayı olmalıdır.');
    error.status = 400;
    throw error;
  }
  return { erpDatabase: cleanDatabase, branch: branchNumber };
}

function resolveUserScope(user, defaults = {}) {
  const fallbackDatabase = String(
    defaults.database ?? getSetting('erp.database', config.erp.database) ?? '',
  ).trim();
  const fallbackBranchRaw = defaults.branch ?? getSettingNumber('app.branch', config.branch);
  const fallbackBranch = Number(fallbackBranchRaw);
  const database = String(user?.erp_database || '').trim() || fallbackDatabase;
  const branchRaw = user?.branch;
  const branch = branchRaw === null || branchRaw === undefined || branchRaw === ''
    ? (Number.isFinite(fallbackBranch) ? fallbackBranch : 0)
    : Number(branchRaw);
  return {
    database,
    branch: Number.isFinite(branch) ? branch : 0,
  };
}

function listUsers({ search = '' } = {}) {
  const where = search
    ? 'WHERE username LIKE ? OR full_name LIKE ?'
    : '';
  const params = search ? [`%${search}%`, `%${search}%`] : [];
  const rows = db.prepare(`
    SELECT id, username, full_name, role, is_active, must_change_password, erp_database, branch,
           last_login_at, created_at, updated_at
    FROM users
    ${where}
    ORDER BY role = 'admin' DESC, username
  `).all(...params);
  return rows.map(publicUser);
}

function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(Number(id)) || null;
}

function getUserByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(String(username || '')) || null;
}

function getUserPermissions(userId) {
  const rows = db.prepare('SELECT permission_key, allowed FROM user_permissions WHERE user_id = ?').all(Number(userId));
  return rows.map((row) => ({ key: row.permission_key, allowed: Boolean(row.allowed) }));
}

function setUserPermissions(userId, selectedKeys, actorId = null) {
  const selected = new Set(selectedKeys || []);
  const defaults = new Set(ROLE_DEFAULTS.user);
  transaction(() => {
    db.prepare('DELETE FROM user_permissions WHERE user_id = ?').run(Number(userId));
    for (const permission of PERMISSIONS) {
      if (selected.has(permission.key)) {
        db.prepare('INSERT INTO user_permissions (user_id, permission_key, allowed) VALUES (?, ?, 1)')
          .run(Number(userId), permission.key);
      } else if (defaults.has(permission.key)) {
        db.prepare('INSERT INTO user_permissions (user_id, permission_key, allowed) VALUES (?, ?, 0)')
          .run(Number(userId), permission.key);
      }
    }
  });
  return getUserPermissions(userId);
}

function createUser({
  username,
  password,
  fullName,
  role = 'user',
  permissions = [],
  erpDatabase,
  branch,
}, actorId = null) {
  const cleanUsername = String(username || '').trim();
  if (!USERNAME_RE.test(cleanUsername)) {
    const error = new Error('Kullanıcı adı 3-32 karakter olmalı; harf, rakam, nokta, tire ve alt çizgi içerebilir.');
    error.status = 400;
    throw error;
  }
  if (!['admin', 'user'].includes(role)) {
    const error = new Error('Geçersiz rol.');
    error.status = 400;
    throw error;
  }
  const passwordError = validatePassword(password);
  if (passwordError) {
    const error = new Error(passwordError);
    error.status = 400;
    throw error;
  }
  if (getUserByUsername(cleanUsername)) {
    const error = new Error('Bu kullanıcı adı zaten kullanılıyor.');
    error.status = 409;
    throw error;
  }

  const scope = normalizeUserScope({ erpDatabase, branch });
  const ts = nowIso();
  const result = db.prepare(`
    INSERT INTO users (
      username, password_hash, full_name, role, is_active, must_change_password,
      erp_database, branch, created_at, created_by, updated_at, updated_by
    )
    VALUES (?, ?, ?, ?, 1, 1, ?, ?, ?, ?, ?, ?)
  `).run(
    cleanUsername,
    hashPassword(password),
    String(fullName || '').trim(),
    role,
    scope.erpDatabase,
    scope.branch,
    ts,
    actorId,
    ts,
    actorId,
  );
  const userId = Number(result.lastInsertRowid);
  if (role === 'user') setUserPermissions(userId, permissions.length ? permissions : ROLE_DEFAULTS.user, actorId);
  return getUserById(userId);
}

function updateUser(id, { fullName, role, erpDatabase, branch }, actorId = null) {
  const user = getUserById(id);
  if (!user) {
    const error = new Error('Kullanıcı bulunamadı.');
    error.status = 404;
    throw error;
  }
  if (!['admin', 'user'].includes(role)) {
    const error = new Error('Geçersiz rol.');
    error.status = 400;
    throw error;
  }

  let nextDatabase = user.erp_database;
  let nextBranch = user.branch;
  if (erpDatabase !== undefined || branch !== undefined) {
    const scope = normalizeUserScope({
      erpDatabase: erpDatabase !== undefined ? erpDatabase : user.erp_database,
      branch: branch !== undefined ? branch : user.branch,
    });
    nextDatabase = scope.erpDatabase;
    nextBranch = scope.branch;
  }

  db.prepare(`
    UPDATE users
    SET full_name = ?, role = ?, erp_database = ?, branch = ?, updated_at = ?, updated_by = ?
    WHERE id = ?
  `).run(
    String(fullName || '').trim(),
    role,
    nextDatabase,
    nextBranch,
    nowIso(),
    actorId,
    Number(id),
  );
  if (role === 'admin') {
    db.prepare('DELETE FROM user_permissions WHERE user_id = ?').run(Number(id));
  }
  return getUserById(id);
}

function setUserPassword(id, password, { mustChange = false, actorId = null } = {}) {
  const user = getUserById(id);
  if (!user) {
    const error = new Error('Kullanıcı bulunamadı.');
    error.status = 404;
    throw error;
  }
  const passwordError = validatePassword(password);
  if (passwordError) {
    const error = new Error(passwordError);
    error.status = 400;
    throw error;
  }
  db.prepare(`
    UPDATE users SET password_hash = ?, must_change_password = ?, updated_at = ?, updated_by = ? WHERE id = ?
  `).run(hashPassword(password), mustChange ? 1 : 0, nowIso(), actorId, Number(id));
  deleteUserSessions(id);
  return getUserById(id);
}

function setUserActive(id, isActive, actorId = null) {
  const user = getUserById(id);
  if (!user) {
    const error = new Error('Kullanıcı bulunamadı.');
    error.status = 404;
    throw error;
  }
  db.prepare(`
    UPDATE users SET is_active = ?, updated_at = ?, updated_by = ? WHERE id = ?
  `).run(isActive ? 1 : 0, nowIso(), actorId, Number(id));
  if (!isActive) deleteUserSessions(id);
  return getUserById(id);
}

function deleteUserSessions(id) {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(Number(id));
}

function countActiveAdmins(excludeId = null) {
  if (excludeId) {
    return db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND is_active = 1 AND id <> ?").get(Number(excludeId)).c;
  }
  return db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND is_active = 1").get().c;
}

function recordLoginAttempt(username, ip, success) {
  db.prepare('INSERT INTO login_attempts (username, ip, success, created_at) VALUES (?, ?, ?, ?)')
    .run(String(username || ''), String(ip || ''), success ? 1 : 0, nowIso());
}

function failedLoginCount(username, ip, minutes = 15) {
  const cutoff = new Date(Date.now() - minutes * 60000).toISOString();
  const row = db.prepare(`
    SELECT COUNT(*) AS c FROM login_attempts
    WHERE success = 0 AND created_at >= ? AND (username = ? OR ip = ?)
  `).get(cutoff, String(username || ''), String(ip || ''));
  return row.c;
}

function touchLastLogin(id) {
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(nowIso(), Number(id));
}

module.exports = {
  publicUser,
  normalizeUserScope,
  resolveUserScope,
  listUsers,
  getUserById,
  getUserByUsername,
  getUserPermissions,
  setUserPermissions,
  createUser,
  updateUser,
  setUserPassword,
  setUserActive,
  deleteUserSessions,
  countActiveAdmins,
  recordLoginAttempt,
  failedLoginCount,
  touchLastLogin,
};
