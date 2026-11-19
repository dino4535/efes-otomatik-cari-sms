'use strict';

const { db, nowIso } = require('../db/sqlite');

function getClientIp(req) {
  if (!req) return null;
  const forwarded = req.headers?.['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || null;
}

function audit(req, action, entityType = null, entityId = null, detail = null) {
  try {
    const detailText = detail === null || detail === undefined
      ? null
      : (typeof detail === 'string' ? detail : JSON.stringify(detail));
    db.prepare(`
      INSERT INTO audit_logs (user_id, username, action, entity_type, entity_id, detail, ip, user_agent, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req?.user?.id || null,
      req?.user?.username || null,
      String(action),
      entityType ? String(entityType) : null,
      entityId !== null && entityId !== undefined ? String(entityId) : null,
      detailText ? detailText.slice(0, 8000) : null,
      getClientIp(req),
      req?.headers?.['user-agent'] ? String(req.headers['user-agent']).slice(0, 255) : null,
      nowIso(),
    );
  } catch (error) {
    console.error('[audit] kayıt hatası:', error.message);
  }
}

function listAudit({ page = 1, pageSize = 50, search = '', action = '', user = '', dateFrom = '', dateTo = '' } = {}) {
  const where = [];
  const params = [];

  if (search) {
    where.push('(username LIKE ? OR action LIKE ? OR entity_id LIKE ? OR detail LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }
  if (action) {
    where.push('action = ?');
    params.push(action);
  }
  if (user) {
    where.push('username = ?');
    params.push(user);
  }
  if (dateFrom) {
    where.push('created_at >= ?');
    params.push(`${dateFrom}T00:00:00.000Z`);
  }
  if (dateTo) {
    where.push('created_at <= ?');
    params.push(`${dateTo}T23:59:59.999Z`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS c FROM audit_logs ${whereSql}`).get(...params).c;
  const offset = (Math.max(1, page) - 1) * pageSize;
  const rows = db.prepare(`
    SELECT id, user_id, username, action, entity_type, entity_id, detail, ip, user_agent, created_at
    FROM audit_logs
    ${whereSql}
    ORDER BY id DESC
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset);

  return { rows, total, page, pageSize };
}

module.exports = { audit, listAudit, getClientIp };
