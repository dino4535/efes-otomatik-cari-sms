'use strict';

const express = require('express');
const { listDealers, getStatement } = require('../services/customerLedger');
const { buildStatementWorkbook } = require('../services/ledgerExcel');
const { requirePermission } = require('../middleware/auth');
const { resolveUserScope } = require('../services/users');
const { audit } = require('../services/audit');

const router = express.Router();

router.get('/dealers', requirePermission('aging.view'), async (req, res) => {
  const scope = resolveUserScope(req.user);
  const data = await listDealers({
    ...scope,
    search: req.query.q,
    page: req.query.page,
    pageSize: req.query.pageSize,
    onlyWithBalance: req.query.onlyWithBalance,
    refresh: req.query.refresh,
  });
  return res.json({ ok: true, data });
});

router.get('/statement.xlsx', requirePermission('aging.detail'), async (req, res) => {
  const scope = resolveUserScope(req.user);
  const includeFinance = res.locals.can('finance.view');
  const data = await getStatement({
    ...scope,
    cariKod: req.query.cariKod,
    startDate: req.query.start,
    endDate: req.query.end,
    allTime: req.query.all,
    includeFinance,
  });
  if (!data) {
    return res.status(404).json({ ok: false, error: 'Cari hesap bulunamadı.' });
  }

  const workbook = buildStatementWorkbook(data);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const safeCode = String(data.cariKod || 'cari').replace(/[^A-Za-z0-9_-]/g, '_');
  const rangeSuffix = data.allTime ? '-tum-gecmis' : `-${data.endDate}`;
  const fileName = `efes-cari-ekstre-${safeCode}${rangeSuffix}.xlsx`;

  audit(req, 'ledger.export', 'ledger', data.cariKod, {
    cariKod: data.cariKod,
    database: data.database,
    branch: data.branch,
    startDate: data.startDate,
    endDate: data.endDate,
    allTime: data.allTime,
    rowCount: data.items.length,
    format: 'xlsx',
    finance: includeFinance,
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.setHeader('Content-Length', buffer.length);
  return res.send(buffer);
});

router.get('/statement', requirePermission('aging.detail'), async (req, res) => {
  const scope = resolveUserScope(req.user);
  const data = await getStatement({
    ...scope,
    cariKod: req.query.cariKod,
    startDate: req.query.start,
    endDate: req.query.end,
    allTime: req.query.all,
    includeFinance: res.locals.can('finance.view'),
  });
  if (!data) {
    return res.status(404).json({ ok: false, error: 'Cari hesap bulunamadı.' });
  }
  return res.json({ ok: true, data });
});

module.exports = router;
