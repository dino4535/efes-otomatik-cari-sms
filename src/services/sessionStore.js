'use strict';

const session = require('express-session');

class SqliteSessionStore extends session.Store {
  constructor(db) {
    super();
    this.db = db;
  }

  get(sid, callback) {
    try {
      const row = this.db.prepare('SELECT data, expires_at FROM sessions WHERE sid = ?').get(sid);
      if (!row) return callback(null, null);
      if (Number(row.expires_at) < Date.now()) {
        this.destroy(sid, () => {});
        return callback(null, null);
      }
      return callback(null, JSON.parse(row.data));
    } catch (error) {
      return callback(error);
    }
  }

  set(sid, sess, callback) {
    try {
      const maxAge = sess.cookie?.maxAge || 8 * 60 * 60 * 1000;
      const expiresAt = sess.cookie?.expires
        ? new Date(sess.cookie.expires).getTime()
        : Date.now() + maxAge;
      this.db.prepare(`
        INSERT INTO sessions (sid, user_id, data, expires_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(sid) DO UPDATE SET
          user_id = excluded.user_id,
          data = excluded.data,
          expires_at = excluded.expires_at
      `).run(sid, sess.userId || null, JSON.stringify(sess), expiresAt);
      return callback(null);
    } catch (error) {
      return callback(error);
    }
  }

  destroy(sid, callback) {
    try {
      this.db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      return callback(null);
    } catch (error) {
      return callback(error);
    }
  }

  touch(sid, sess, callback) {
    try {
      const maxAge = sess.cookie?.maxAge || 8 * 60 * 60 * 1000;
      const expiresAt = sess.cookie?.expires
        ? new Date(sess.cookie.expires).getTime()
        : Date.now() + maxAge;
      this.db.prepare('UPDATE sessions SET expires_at = ? WHERE sid = ?').run(expiresAt, sid);
      return callback(null);
    } catch (error) {
      return callback(error);
    }
  }

  clear(callback) {
    try {
      this.db.prepare('DELETE FROM sessions').run();
      return callback(null);
    } catch (error) {
      return callback(error);
    }
  }

  length(callback) {
    try {
      const row = this.db.prepare('SELECT COUNT(*) AS c FROM sessions').get();
      return callback(null, row.c);
    } catch (error) {
      return callback(error);
    }
  }
}

module.exports = { SqliteSessionStore };
