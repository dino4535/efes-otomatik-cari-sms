'use strict';

const express = require('express');
const { getAging, getCustomerDetail, invalidateAgingCache } = require('../services/aging');
const { buildAgingWorkbook } = require('../services/agingExcel');
const { requirePermission } = require('../middleware/auth');
const { audit } = require('../services/audit');
const { resolveUserScope } = require('../services/users');
const { todayInIstanbul, isValidDateOnly } = require('../utils/dates');

const router = express.Router();

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', 'dahil'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off', 'hariç', 'haric'].includes(normalized)) return false;
  return fallback;
}

function optionsFrom(source = {}) {
  return {
    asOf: isValidDateOnly(source.asOf) ? source.asOf : todayInIstanbul(),
    tolerance: source.tolerance !== undefined ? Number(source.tolerance) : undefined,
    includePrepaid: parseBoolean(source.includePrepaid, false),
  };
}

function queryOptions(req) {
  const scope = resolveUserScope(req.user);
  return {
    ...optionsFrom(req.query),
    branch: scope.branch,
    database: scope.database,
  };
}

function publicPayload(data) {
  return {
    asOf: data.asOf,
    generatedAt: data.generatedAt,
    database: data.database,
    branch: data.branch,
    customerType: data.customerType,
    tolerance: data.tolerance,
    includePrepaid: data.includePrepaid,
    movementCount: data.movementCount,
    customerCount: data.customerCount,
    summary: data.summary,
    customers: data.customers,
  };
}

router.get('/', requirePermission('aging.view'), async (req, res) => {
  const data = await getAging(queryOptions(req));
  return res.json({ ok: true, data: publicPayload(data) });
});

router.post('/refresh', requirePermission('aging.view'), async (req, res) => {
  invalidateAgingCache();
  const scope = resolveUserScope(req.user);
  const options = {
    ...optionsFrom({ ...req.query, ...(req.body || {}) }),
    branch: scope.branch,
    database: scope.database,
    force: true,
  };
  const data = await getAging(options);
  audit(req, 'aging.refresh', 'aging', data.asOf, {
    asOf: data.asOf,
    database: data.database,
    branch: data.branch,
    tolerance: data.tolerance,
    includePrepaid: data.includePrepaid,
    customerCount: data.summary.debtorCount,
  });
  return res.json({ ok: true, data: publicPayload(data) });
});

router.get('/export.xlsx', requirePermission('aging.export'), async (req, res) => {
  const data = await getAging(queryOptions(req));
  const workbook = buildAgingWorkbook(data);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const modeSuffix = data.includePrepaid ? '-pesin-dahil' : '';
  const fileName = `efes-cari-yaslandirma-${data.asOf}${modeSuffix}.xlsx`;
  audit(req, 'aging.export', 'aging', data.asOf, {
    asOf: data.asOf,
    database: data.database,
    branch: data.branch,
    tolerance: data.tolerance,
    includePrepaid: data.includePrepaid,
    rowCount: data.customers.length,
    format: 'xlsx',
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.setHeader('Content-Length', buffer.length);
  return res.send(buffer);
});

router.get('/export.csv', requirePermission('aging.export'), async (req, res) => {
  const data = await getAging(queryOptions(req));
  const headers = [
    'Cari Kod',
    'Cari İsim',
    'Telefon',
    'Toplam Açık Borç',
    '0-14 Gün',
    '15-21 Gün',
    '22-30 Gün',
    '31-45 Gün',
    '46-60 Gün',
    '61+ Gün',
    '30+ Gün Toplam',
    'En Yaşlı Gün',
    'En Yaşlı Fatura Tarihi',
    'Cari Bakiye',
  ];

  const number = (value) => Number(value || 0).toFixed(2).replace('.', ',');
  const cell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;

  const lines = [headers.map(cell).join(';')];
  for (const customer of data.customers) {
    lines.push([
      customer.cariKod,
      customer.cariIsim,
      customer.phone || customer.rawPhone || '',
      number(customer.totalDebt),
      number(customer.buckets.d0_14),
      number(customer.buckets.d15_21),
      number(customer.buckets.d22_30),
      number(customer.buckets.d31_45),
      number(customer.buckets.d46_60),
      number(customer.buckets.d61),
      number(customer.overdue30),
      customer.oldestDays,
      customer.oldestDate || '',
      number(customer.balance),
    ].map(cell).join(';'));
  }

  const csv = `\uFEFF${lines.join('\r\n')}\r\n`;
  const modeSuffix = data.includePrepaid ? '-pesin-dahil' : '';
  const fileName = `efes-cari-yaslandirma-${data.asOf}${modeSuffix}.csv`;
  audit(req, 'aging.export', 'aging', data.asOf, {
    asOf: data.asOf,
    database: data.database,
    branch: data.branch,
    tolerance: data.tolerance,
    includePrepaid: data.includePrepaid,
    rowCount: data.customers.length,
    format: 'csv',
  });

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  return res.send(csv);
});

router.get('/:cariKod', requirePermission('aging.detail'), async (req, res) => {
  const detail = await getCustomerDetail({
    ...queryOptions(req),
    cariKod: req.params.cariKod,
  });
  if (!detail) {
    return res.status(404).json({ ok: false, error: 'Cari hesap bulunamadı veya açık borcu yok.' });
  }
  return res.json({ ok: true, data: detail });
});

module.exports = router;
