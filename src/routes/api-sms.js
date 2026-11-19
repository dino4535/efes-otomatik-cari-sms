'use strict';

const express = require('express');
const { requirePermission } = require('../middleware/auth');
const { audit } = require('../services/audit');
const { getCustomerDetail } = require('../services/aging');
const { getAllSettings } = require('../services/settings');
const { resolveUserScope } = require('../services/users');
const {
  listSmsLogs,
  listScheduledSms,
  getSmsStats,
  getSmsHistoryForCustomer,
  getCustomerSmsSettings,
  upsertCustomerSmsSettings,
  listTemplates,
  getTemplate,
  getActiveTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  renderSmsTemplate,
  templateVars,
  smsSegments,
  sendSms,
} = require('../services/sms');
const { runSmsJobNow, listJobRuns, isRunning } = require('../services/scheduler');

const router = express.Router();

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function pageParams(req) {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(200, Math.max(10, Number.parseInt(req.query.pageSize, 10) || 50));
  return { page, pageSize };
}

function scopeFor(req) {
  return resolveUserScope(req.user);
}

async function findCustomer(cariKod, scope) {
  const detail = await getCustomerDetail({ cariKod, ...scope });
  if (!detail) throw fail('Cari hesap bulunamadı veya açık borcu yok.', 404);
  return detail.customer;
}

function resolveMessage({ customer, templateId, message, branch }) {
  if (message !== undefined && message !== null && String(message).trim()) {
    const text = String(message).trim();
    if (text.length > 500) throw fail('SMS mesajı 500 karakterden uzun olamaz.');
    return { text, template: null };
  }
  const settings = getAllSettings();
  if (branch !== undefined) settings['app.branch'] = String(branch);
  const template = getTemplate(templateId)
    || getTemplate(Number(settings['sms.template_id'] || 0))
    || getActiveTemplate();
  if (!template) throw fail('Kullanılabilir SMS şablonu bulunamadı.', 400);
  const text = renderSmsTemplate(template.body, templateVars(customer, settings));
  return { text, template };
}

router.get('/logs', requirePermission('sms.view'), (req, res) => {
  const result = listSmsLogs({
    ...pageParams(req),
    search: req.query.search || '',
    status: req.query.status || '',
    trigger: req.query.trigger || '',
    dateFrom: req.query.dateFrom || '',
    dateTo: req.query.dateTo || '',
  });
  return res.json({ ok: true, data: result });
});

router.get('/scheduled', requirePermission('sms.view'), async (req, res) => {
  const result = await listScheduledSms({
    ...pageParams(req),
    search: req.query.search || '',
    scope: scopeFor(req),
  });
  return res.json({ ok: true, data: result });
});

router.get('/stats', requirePermission('sms.view'), (req, res) => {
  return res.json({
    ok: true,
    data: {
      ...getSmsStats(),
      running: isRunning(),
      jobs: listJobRuns(10),
    },
  });
});

router.get('/templates', requirePermission('sms.view'), (req, res) => {
  return res.json({ ok: true, data: { templates: listTemplates() } });
});

router.post('/templates', requirePermission('settings.manage'), (req, res) => {
  const template = createTemplate({
    name: req.body.name,
    body: req.body.body,
    isActive: req.body.isActive !== false,
  }, req.user.id);
  audit(req, 'sms.template_create', 'sms_template', template.id, { name: template.name });
  return res.status(201).json({ ok: true, data: { template } });
});

router.put('/templates/:id', requirePermission('settings.manage'), (req, res) => {
  const template = updateTemplate(Number(req.params.id), {
    name: req.body.name,
    body: req.body.body,
    isActive: req.body.isActive !== false,
  }, req.user.id);
  audit(req, 'sms.template_update', 'sms_template', template.id, { name: template.name });
  return res.json({ ok: true, data: { template } });
});

router.delete('/templates/:id', requirePermission('settings.manage'), (req, res) => {
  deleteTemplate(Number(req.params.id));
  audit(req, 'sms.template_delete', 'sms_template', req.params.id, null);
  return res.json({ ok: true, data: { deleted: true } });
});

router.post('/preview', requirePermission('sms.send'), async (req, res) => {
  const scope = scopeFor(req);
  const customer = await findCustomer(req.body.cariKod, scope);
  const { text, template } = resolveMessage({
    customer,
    templateId: req.body.templateId,
    message: req.body.message,
    branch: scope.branch,
  });
  return res.json({
    ok: true,
    data: {
      message: text,
      templateId: template?.id || null,
      templateName: template?.name || null,
      ...smsSegments(text),
      phone: customer.phone,
      cariIsim: customer.cariIsim,
    },
  });
});

router.post('/send', requirePermission('sms.send'), async (req, res) => {
  const scope = scopeFor(req);
  const customer = await findCustomer(req.body.cariKod, scope);
  const { text, template } = resolveMessage({
    customer,
    templateId: req.body.templateId,
    message: req.body.message,
    branch: scope.branch,
  });
  const result = await sendSms({
    cariKod: customer.cariKod,
    customer,
    message: text,
    triggerType: 'manual',
    userId: req.user.id,
    force: req.body.force !== false,
    templateId: template?.id || null,
  });
  if (!result.skipped) {
    audit(req, 'sms.send', 'customer', customer.cariKod, {
      status: result.status,
      phone: customer.phone,
      logId: result.logId,
      templateId: template?.id || null,
    });
  }
  return res.json({ ok: true, data: result });
});

router.post('/run-job', requirePermission('sms.send'), async (req, res) => {
  const result = await runSmsJobNow({
    userId: req.user.id,
    triggerType: 'manual',
    force: Boolean(req.body.force),
    scope: scopeFor(req),
  });
  audit(req, 'sms.run_job', 'sms_job', null, result);
  return res.json({ ok: true, data: result });
});

router.get('/customers/:cariKod', requirePermission('sms.view'), (req, res) => {
  return res.json({
    ok: true,
    data: {
      settings: getCustomerSmsSettings(req.params.cariKod),
      history: getSmsHistoryForCustomer(req.params.cariKod, 20),
    },
  });
});

router.put('/customers/:cariKod', requirePermission('sms.settings'), (req, res) => {
  const settings = upsertCustomerSmsSettings(req.params.cariKod, {
    phoneOverride: req.body.phoneOverride,
    smsEnabled: req.body.smsEnabled,
    intervalDays: req.body.intervalDays,
    nextSmsAt: req.body.nextSmsAt,
    optOut: req.body.optOut,
    note: req.body.note,
  }, req.user.id);
  audit(req, 'sms.customer_settings', 'customer', req.params.cariKod, settings);
  return res.json({ ok: true, data: { settings } });
});

module.exports = router;
