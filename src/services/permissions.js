'use strict';

const { PERMISSIONS, ROLE_DEFAULTS } = require('./permissionCatalog');

function getUserPermissionSet(db, user) {
  if (!user) return new Set();
  if (user.role === 'admin') return new Set(PERMISSIONS.map((p) => p.key));
  const set = new Set(ROLE_DEFAULTS.user);
  const rows = db.prepare('SELECT permission_key, allowed FROM user_permissions WHERE user_id = ?').all(user.id);
  for (const row of rows) {
    if (row.allowed) set.add(row.permission_key);
    else set.delete(row.permission_key);
  }
  return set;
}

module.exports = { getUserPermissionSet };
