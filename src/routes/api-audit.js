'use strict';

const express = require('express');
const { requirePermission } = require('../middleware/auth');
const { listAudit } = require('../services/audit');

const router = express.Router();

router.get('/', requirePermission('audit.view'), (req, res) => {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(200, Math.max(10, Number.parseInt(req.query.pageSize, 10) || 50));
  const result = listAudit({
    page,
    pageSize,
    search: req.query.search || '',
    action: req.query.action || '',
    user: req.query.user || '',
    dateFrom: req.query.dateFrom || '',
    dateTo: req.query.dateTo || '',
  });
  return res.json({ ok: true, data: result });
});

module.exports = router;
