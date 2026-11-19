'use strict';

const express = require('express');
const {
  listStock,
  getStockItem,
  getStockMovementHistory,
  isCaseUnit,
} = require('../services/stock');
const { getStockLitreOverrides, saveStockLitreOverride, deleteStockLitreOverride } = require('../services/stockLitre');
const { parseLitreInput } = require('../services/stockLitreParser');
const { buildStockWorkbook } = require('../services/stockExcel');
const { requirePermission } = require('../middleware/auth');
const { resolveUserScope } = require('../services/users');
const { audit } = require('../services/audit');
const { transaction } = require('../db/sqlite');

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
    windowDays: source.window,
    state: source.state,
    search: source.q,
    sort: source.sort,
    direction: source.dir,
    page: source.page,
    pageSize: source.pageSize,
    refresh: parseBoolean(source.refresh),
    includeService: parseBoolean(source.services),
  };
}

router.get('/', requirePermission('stock.view'), async (req, res) => {
  const scope = resolveUserScope(req.user);
  const data = await listStock({
    ...scope,
    ...optionsFrom(req.query),
    litreOverrides: getStockLitreOverrides(),
  });
  return res.json({ ok: true, data });
});

router.get('/export.xlsx', requirePermission('stock.export'), async (req, res) => {
  const scope = resolveUserScope(req.user);
  const data = await listStock({
    ...scope,
    ...optionsFrom(req.query),
    all: true,
    litreOverrides: getStockLitreOverrides(),
  });
  const workbook = buildStockWorkbook(data);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const fileName = `efes-stok-durumu-${data.asOf}.xlsx`;

  audit(req, 'stock.export', 'stock', `${scope.database}:${scope.branch}`, {
    database: data.database,
    branch: data.branch,
    asOf: data.asOf,
    windowDays: data.windowDays,
    state: data.state,
    search: data.search,
    rowCount: data.items.length,
    format: 'xlsx',
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.setHeader('Content-Length', buffer.length);
  return res.send(buffer);
});

router.get('/litres', requirePermission('stock.litre'), async (req, res) => {
  const scope = resolveUserScope(req.user);
  const overrides = getStockLitreOverrides();
  const source = ['missing', 'manual', 'auto', 'all'].includes(String(req.query.source || ''))
    ? String(req.query.source)
    : 'all';
  const data = await listStock({
    ...scope,
    ...optionsFrom(req.query),
    state: req.query.state || 'all',
    sort: 'code',
    direction: 'asc',
    all: true,
    litreOverrides: overrides,
  });

  const includePackaging = parseBoolean(req.query.packaging);
  const baseItems = includePackaging
    ? data.items
    : data.items.filter((item) => !item.packaging || item.ltSource === 'manual');

  const summary = {
    total: baseItems.length,
    missing: baseItems.filter((item) => !item.ltSource).length,
    manual: baseItems.filter((item) => item.ltSource === 'manual').length,
    auto: baseItems.filter((item) => item.ltSource === 'unit' || item.ltSource === 'name').length,
    missingWithStock: baseItems.filter((item) => !item.ltSource && item.stock !== 0).length,
  };

  let filtered = baseItems;
  if (source === 'missing') {
    filtered = filtered
      .filter((item) => !item.ltSource)
      .sort((left, right) => (Number(right.stock) - Number(left.stock))
        || left.code.localeCompare(right.code, 'tr', { numeric: true }));
  } else if (source === 'manual') {
    filtered = filtered.filter((item) => item.ltSource === 'manual');
  } else if (source === 'auto') {
    filtered = filtered.filter((item) => item.ltSource === 'unit' || item.ltSource === 'name');
  }

  const pageSize = Math.max(1, Math.min(200, Number.parseInt(req.query.pageSize, 10) || 50));
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(Math.max(1, Number.parseInt(req.query.page, 10) || 1), pageCount);
  const items = filtered.slice((page - 1) * pageSize, page * pageSize).map((item) => ({
    code: item.code,
    name: item.name,
    group: item.group,
    service: item.service,
    packaging: item.packaging,
    primaryUnit: item.primaryUnit,
    caseUnit: item.caseUnit,
    stock: item.stock,
    stockLt: item.stockLt,
    ltFactor: item.ltFactor,
    autoLtFactor: item.autoLtFactor,
    ltSource: item.ltSource,
    packFactor: item.packFactor,
    manualLitre: item.manualLitre,
    manualInput: item.manualInput || (item.manualLitre === null ? '' : String(item.manualLitre).replace('.', ',')),
  }));

  return res.json({
    ok: true,
    data: {
      database: data.database,
      branch: data.branch,
      asOf: data.asOf,
      state: data.state,
      source,
      search: data.search,
      includeService: data.includeService,
      includePackaging,
      page,
      pageSize,
      pageCount,
      filteredCount: filtered.length,
      summary,
      items,
    },
  });
});

router.post('/litres', requirePermission('stock.litre'), async (req, res) => {
  const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];
  if (!entries.length) {
    return res.status(400).json({ ok: false, error: 'Kaydedilecek litre değeri bulunamadı.' });
  }
  if (entries.length > 200) {
    return res.status(400).json({ ok: false, error: 'Tek seferde en fazla 200 satır kaydedilebilir.' });
  }

  const scope = resolveUserScope(req.user);
  const overrides = getStockLitreOverrides();
  const data = await listStock({
    ...scope,
    state: 'all',
    all: true,
    includeService: true,
    sort: 'code',
    direction: 'asc',
    litreOverrides: overrides,
  });
  const itemByCode = new Map(data.items.map((item) => [item.code, item]));
  const operations = [];
  const errors = [];
  const seen = new Set();

  for (const entry of entries) {
    const code = String(entry?.code || '').trim();
    if (!code) {
      errors.push({ code: '', error: 'Stok kodu zorunludur.' });
      continue;
    }
    if (seen.has(code)) {
      errors.push({ code, error: 'Aynı stok kodu birden fazla kez gönderildi.' });
      continue;
    }
    seen.add(code);

    const current = itemByCode.get(code);
    const value = entry?.value;
    if (value === null || value === undefined || String(value).trim() === '') {
      operations.push({ code, remove: true });
      continue;
    }
    if (!current) {
      errors.push({ code, error: 'Stok kodu bulunamadı.' });
      continue;
    }

    const parsed = parseLitreInput(value, {
      isCaseUnit: isCaseUnit(current.primaryUnit),
      packFactor: current.packFactor,
    });
    if (!parsed.ok) {
      errors.push({ code, error: parsed.error });
      continue;
    }

    const note = String(entry?.note || '').trim().slice(0, 250);
    operations.push({
      code,
      item: current,
      litre: parsed.litre,
      inputText: parsed.inputText,
      note,
    });
  }

  if (errors.length) {
    return res.status(400).json({
      ok: false,
      error: errors[0].error,
      details: errors,
    });
  }

  let saved = 0;
  let removed = 0;
  transaction(() => {
    for (const operation of operations) {
      if (operation.remove) {
        if (deleteStockLitreOverride(operation.code)) removed += 1;
      } else {
        saveStockLitreOverride({
          code: operation.code,
          name: operation.item.name,
          primaryUnit: operation.item.primaryUnit,
          litre: operation.litre,
          inputText: operation.inputText,
          note: operation.note,
          userId: req.user?.id || null,
        });
        saved += 1;
      }
    }
  });

  audit(req, 'stock.litre.save', 'stock', `${scope.database}:${scope.branch}`, {
    database: scope.database,
    branch: scope.branch,
    saved,
    removed,
    codes: operations.map((operation) => operation.code).slice(0, 100),
  });

  return res.json({ ok: true, data: { saved, removed } });
});

router.delete('/litres/:code', requirePermission('stock.litre'), async (req, res) => {
  const scope = resolveUserScope(req.user);
  const code = String(req.params.code || '').trim();
  const item = await getStockItem({ ...scope, code, litreOverrides: getStockLitreOverrides() });
  const removed = deleteStockLitreOverride(code);
  if (removed) {
    audit(req, 'stock.litre.delete', 'stock', code, {
      database: scope.database,
      branch: scope.branch,
      name: item?.name || null,
    });
  }
  return res.json({ ok: true, data: { code, removed } });
});

router.get('/:stokKodu/movements', requirePermission('stock.view'), async (req, res) => {
  const scope = resolveUserScope(req.user);
  const data = await getStockMovementHistory({
    ...scope,
    stokKodu: req.params.stokKodu,
    limit: req.query.limit,
  });
  return res.json({ ok: true, data });
});

module.exports = router;
