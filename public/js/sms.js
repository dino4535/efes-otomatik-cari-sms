'use strict';

(function () {
  const App = window.App;
  const canSend = Boolean(document.getElementById('runJobBtn'));
  const canSettings = document.querySelector('[data-can-settings]')?.dataset.canSettings === '1';

  const els = {
    logSearch: document.getElementById('logSearch'),
    logStatus: document.getElementById('logStatus'),
    logTrigger: document.getElementById('logTrigger'),
    logDateFrom: document.getElementById('logDateFrom'),
    logDateTo: document.getElementById('logDateTo'),
    logFilterBtn: document.getElementById('logFilterBtn'),
    logBody: document.getElementById('logBody'),
    logPrev: document.getElementById('logPrev'),
    logNext: document.getElementById('logNext'),
    logPageInfo: document.getElementById('logPageInfo'),
    scheduledSearch: document.getElementById('scheduledSearch'),
    scheduledFilterBtn: document.getElementById('scheduledFilterBtn'),
    scheduledBody: document.getElementById('scheduledBody'),
    scheduledPrev: document.getElementById('scheduledPrev'),
    scheduledNext: document.getElementById('scheduledNext'),
    scheduledPageInfo: document.getElementById('scheduledPageInfo'),
    scheduledGlobalInfo: document.getElementById('scheduledGlobalInfo'),
    refresh: document.getElementById('refreshSmsBtn'),
    runJob: document.getElementById('runJobBtn'),
    sendModal: document.getElementById('sendSmsModal'),
    sendForm: document.getElementById('sendSmsForm'),
    sendCariKod: document.getElementById('sendCariKod'),
    sendMeta: document.getElementById('sendSmsMeta'),
    sendTemplateId: document.getElementById('sendTemplateId'),
    sendMessage: document.getElementById('sendMessage'),
    sendCharCount: document.getElementById('sendCharCount'),
    sendPreview: document.getElementById('sendPreviewBtn'),
    sendError: document.getElementById('sendSmsError'),
    scheduleModal: document.getElementById('scheduleSmsModal'),
    scheduleForm: document.getElementById('scheduleSmsForm'),
    scheduleCariKod: document.getElementById('scheduleCariKod'),
    scheduleMeta: document.getElementById('scheduleSmsMeta'),
    schedulePhone: document.getElementById('schedulePhone'),
    scheduleInterval: document.getElementById('scheduleInterval'),
    scheduleNextAt: document.getElementById('scheduleNextAt'),
    scheduleNote: document.getElementById('scheduleNote'),
    scheduleEnabled: document.getElementById('scheduleEnabled'),
    scheduleOptOut: document.getElementById('scheduleOptOut'),
    scheduleError: document.getElementById('scheduleSmsError'),
  };

  const state = {
    logs: { page: 1, pageSize: 50, total: 0, loaded: false },
    scheduled: { page: 1, pageSize: 50, total: 0, loaded: false },
    scheduledRows: [],
    current: null,
  };

  function statusBadge(status) {
    const map = {
      sent: ['badge-success', 'Gönderildi'],
      simulated: ['badge-info', 'Simüle edildi'],
      delivered: ['badge-success', 'Teslim edildi'],
      failed: ['badge-danger', 'Başarısız'],
    };
    const [cls, label] = map[status] || ['badge-muted', status || '—'];
    return `<span class="badge ${cls}">${App.escapeHtml(label)}</span>`;
  }

  function triggerBadge(trigger) {
    return trigger === 'scheduled'
      ? '<span class="badge badge-muted">Otomatik</span>'
      : '<span class="badge badge-info">Manuel</span>';
  }

  function formatPhone(phone) {
    const value = String(phone || '');
    if (/^\+90\d{10}$/.test(value)) {
      const national = value.slice(3);
      return `+90 ${national.slice(0, 3)} ${national.slice(3, 6)} ${national.slice(6, 8)} ${national.slice(8, 10)}`;
    }
    return value || '—';
  }

  function updatePageInfo(el, info) {
    el.textContent = info.total
      ? `Sayfa ${info.page} / ${Math.max(1, Math.ceil(info.total / info.pageSize))} · ${App.number(info.total)} kayıt`
      : 'Kayıt yok';
  }

  async function loadStats() {
    try {
      const data = await App.api('/api/sms/stats');
      const byStatus = data.today.byStatus || {};
      const success = (byStatus.sent || 0) + (byStatus.simulated || 0) + (byStatus.delivered || 0);
      const failed = byStatus.failed || 0;
      document.getElementById('smsTodayTotal').textContent = App.number(data.today.total);
      document.getElementById('smsTodaySub').textContent = `${App.number(data.total)} toplam kayıt`;
      document.getElementById('smsSuccessTotal').textContent = App.number(success);
      document.getElementById('smsSuccessSub').textContent = `${App.number(byStatus.sent || 0)} gerçek · ${App.number(byStatus.simulated || 0)} simüle`;
      document.getElementById('smsFailedTotal').textContent = App.number(failed);
      document.getElementById('smsLastSent').textContent = data.lastSentAt ? App.formatDateTime(data.lastSentAt) : 'Henüz yok';

      let jobText = 'Otomatik iş henüz çalışmadı';
      if (data.running) {
        jobText = 'Otomatik iş şu anda çalışıyor…';
      } else if (data.jobs && data.jobs.length) {
        const job = data.jobs[0];
        const labels = {
          success: 'Başarılı',
          partial: 'Kısmi başarılı',
          failed: 'Başarısız',
          skipped: 'Atlandı',
          running: 'Çalışıyor',
        };
        jobText = `Son iş: ${labels[job.status] || job.status} · ${App.formatDateTime(job.finished_at || job.started_at)}`;
      }
      document.getElementById('smsJobStatus').textContent = jobText;
    } catch (error) {
      App.toast(`SMS istatistikleri yüklenemedi: ${error.message}`, 'error');
    }
  }

  async function loadLogs(page = state.logs.page) {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(state.logs.pageSize),
    });
    if (els.logSearch.value.trim()) params.set('search', els.logSearch.value.trim());
    if (els.logStatus.value) params.set('status', els.logStatus.value);
    if (els.logTrigger.value) params.set('trigger', els.logTrigger.value);
    if (els.logDateFrom.value) params.set('dateFrom', els.logDateFrom.value);
    if (els.logDateTo.value) params.set('dateTo', els.logDateTo.value);

    els.logBody.innerHTML = '<tr><td colspan="8" class="empty-state">Kayıtlar yükleniyor…</td></tr>';
    try {
      const data = await App.api(`/api/sms/logs?${params.toString()}`);
      state.logs.page = data.page;
      state.logs.total = data.total;
      state.logs.loaded = true;
      renderLogs(data.rows);
      updatePageInfo(els.logPageInfo, { ...state.logs, page: data.page, pageSize: data.pageSize });
      els.logPrev.disabled = data.page <= 1;
      els.logNext.disabled = data.page >= Math.ceil(data.total / data.pageSize);
    } catch (error) {
      els.logBody.innerHTML = `<tr><td colspan="8" class="empty-state">${App.escapeHtml(error.message)}</td></tr>`;
      App.toast(error.message, 'error');
    }
  }

  function renderLogs(rows) {
    if (!rows.length) {
      els.logBody.innerHTML = '<tr><td colspan="8" class="empty-state">Kayıt bulunamadı.</td></tr>';
      return;
    }
    els.logBody.innerHTML = rows.map((row) => `
      <tr>
        <td class="nowrap">${App.formatDateTime(row.created_at)}</td>
        <td>
          <div class="cari-cell">
            <strong>${App.escapeHtml(row.cari_isim || '—')}</strong>
            <span>${App.escapeHtml(row.cari_kod || '')}</span>
          </div>
        </td>
        <td class="nowrap">${App.escapeHtml(formatPhone(row.phone))}</td>
        <td>${triggerBadge(row.trigger_type)}</td>
        <td>${statusBadge(row.status)}</td>
        <td class="num money">${row.overdue_debt === null || row.overdue_debt === undefined ? '—' : App.money(row.overdue_debt)}</td>
        <td class="message-cell"><span class="message-text" title="${App.escapeHtml(row.message)}">${App.escapeHtml(row.message || '—')}</span></td>
        <td class="message-cell"><span class="message-text" title="${App.escapeHtml(row.error_message || '')}">${App.escapeHtml(row.error_message || '—')}</span></td>
      </tr>
    `).join('');
  }

  async function loadScheduled(page = state.scheduled.page) {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(state.scheduled.pageSize),
    });
    if (els.scheduledSearch.value.trim()) params.set('search', els.scheduledSearch.value.trim());

    els.scheduledBody.innerHTML = '<tr><td colspan="8" class="empty-state">Planlanan SMS\'ler yükleniyor…</td></tr>';
    try {
      const data = await App.api(`/api/sms/scheduled?${params.toString()}`);
      state.scheduled.page = data.page;
      state.scheduled.total = data.total;
      state.scheduled.loaded = true;
      state.scheduledRows = data.rows;
      renderScheduled(data.rows);
      updatePageInfo(els.scheduledPageInfo, { ...state.scheduled, page: data.page, pageSize: data.pageSize });
      els.scheduledPrev.disabled = data.page <= 1;
      els.scheduledNext.disabled = data.page >= Math.ceil(data.total / data.pageSize);
      els.scheduledGlobalInfo.textContent = `Genel aralık: ${data.globalIntervalDays} gün · ${App.number(data.total)} cari aday`;
    } catch (error) {
      els.scheduledBody.innerHTML = `<tr><td colspan="8" class="empty-state">${App.escapeHtml(error.message)}</td></tr>`;
      App.toast(error.message, 'error');
    }
  }

  function scheduledStatus(row) {
    if (row.optOut) return '<span class="badge badge-danger">Opt-out</span>';
    if (!row.smsEnabled) return '<span class="badge badge-muted">Kapalı</span>';
    if (!row.phone) return '<span class="badge badge-warning">Telefon yok</span>';
    if (row.nextSmsAt && new Date(row.nextSmsAt).getTime() > Date.now()) {
      return '<span class="badge badge-info">Planlandı</span>';
    }
    return '<span class="badge badge-success">Gönderime hazır</span>';
  }

  function renderScheduled(rows) {
    if (!rows.length) {
      els.scheduledBody.innerHTML = '<tr><td colspan="8" class="empty-state">30+ gecikmiş SMS adayı bulunamadı.</td></tr>';
      return;
    }
    els.scheduledBody.innerHTML = rows.map((row) => {
      const next = row.nextSmsAt
        ? App.formatDateTime(row.nextSmsAt)
        : '<span class="muted">Aralık sonrası</span>';
      const actions = [];
      if (canSettings) actions.push(`<button type="button" class="btn btn-ghost btn-xs" data-edit-schedule="${App.escapeHtml(row.cariKod)}">Plan</button>`);
      if (canSend) actions.push(`<button type="button" class="btn btn-ghost btn-xs" data-send="${App.escapeHtml(row.cariKod)}">Gönder</button>`);
      return `
        <tr>
          <td>
            <div class="cari-cell">
              <strong>${App.escapeHtml(row.cariIsim)}</strong>
              <span>${App.escapeHtml(row.cariKod)}${row.oldestDays ? ` · ${row.oldestDays} gün` : ''}</span>
            </div>
          </td>
          <td class="nowrap">${App.escapeHtml(formatPhone(row.phone))}${row.smsEnabled ? '' : ' <span class="muted">(kapalı)</span>'}</td>
          <td class="num money money-danger">${App.money(row.overdue30)}</td>
          <td class="num">${row.intervalDays} gün</td>
          <td class="nowrap">${row.lastSmsAt ? App.formatDateTime(row.lastSmsAt) : '<span class="muted">—</span>'}</td>
          <td class="nowrap">${next}</td>
          <td>${scheduledStatus(row)}</td>
          <td class="actions-cell">${actions.join(' ') || '<span class="muted">—</span>'}</td>
        </tr>
      `;
    }).join('');
  }

  function updateSendCharCount() {
    const length = els.sendMessage.value.length;
    const segments = length <= 70 ? 1 : Math.ceil(length / 67);
    els.sendCharCount.textContent = `${length} / 500 · ${segments} SMS (tahmini)`;
  }

  async function previewSend() {
    if (!state.current) return null;
    try {
      const data = await App.api('/api/sms/preview', {
        method: 'POST',
        body: {
          cariKod: state.current.cariKod,
          templateId: els.sendTemplateId.value || undefined,
          message: els.sendMessage.value.trim() || undefined,
        },
      });
      els.sendMessage.value = data.message;
      els.sendCharCount.textContent = `${data.length} / 500 · ${data.segments} SMS · ${data.encoding}`;
      return data;
    } catch (error) {
      els.sendError.textContent = error.message;
      els.sendError.classList.remove('hidden');
      return null;
    }
  }

  async function openSend(cariKod) {
    const row = state.scheduledRows.find((item) => item.cariKod === cariKod);
    if (!row) return;
    state.current = row;
    els.sendForm.reset();
    els.sendError.classList.add('hidden');
    els.sendError.textContent = '';
    els.sendCariKod.value = row.cariKod;
    els.sendMeta.textContent = `${row.cariIsim} · ${formatPhone(row.phone)} · 30+ borç: ${App.money(row.overdue30, true)}`;
    els.sendMessage.value = '';
    updateSendCharCount();
    App.openModal(els.sendModal);
    await previewSend();
    updateSendCharCount();
  }

  async function submitSend(event) {
    event.preventDefault();
    if (!state.current) return;
    if (!window.confirm(`${state.current.cariIsim} için SMS gönderilsin mi?`)) return;
    const button = els.sendForm.querySelector('button[type="submit"]');
    els.sendError.classList.add('hidden');
    try {
      App.setBusy(button, true, 'Gönderiliyor…');
      const data = await App.api('/api/sms/send', {
        method: 'POST',
        body: {
          cariKod: state.current.cariKod,
          templateId: els.sendTemplateId.value || undefined,
          message: els.sendMessage.value.trim() || undefined,
          force: true,
        },
      });
      if (data.skipped) {
        App.toast(`Gönderilmedi: ${data.reason}`, 'warning');
      } else if (data.status === 'failed') {
        App.toast(`SMS gönderilemedi: ${data.error}`, 'error');
      } else {
        App.toast(data.status === 'simulated' ? 'SMS simüle edildi (test modu).' : 'SMS gönderildi.', 'success');
        App.closeModal(els.sendModal);
      }
      await Promise.all([loadStats(), loadLogs(1), loadScheduled(state.scheduled.page)]);
    } catch (error) {
      els.sendError.textContent = error.message;
      els.sendError.classList.remove('hidden');
    } finally {
      App.setBusy(button, false);
    }
  }

  async function openSchedule(cariKod) {
    const row = state.scheduledRows.find((item) => item.cariKod === cariKod);
    if (!row) return;
    state.current = row;
    els.scheduleForm.reset();
    els.scheduleError.classList.add('hidden');
    els.scheduleError.textContent = '';
    els.scheduleCariKod.value = row.cariKod;
    els.scheduleMeta.textContent = `${row.cariIsim} · ${formatPhone(row.phone)}`;
    els.schedulePhone.value = '';
    els.scheduleInterval.value = '';
    els.scheduleNextAt.value = App.toDateTimeLocal(row.nextSmsAt);
    els.scheduleNote.value = row.note || '';
    els.scheduleEnabled.checked = row.smsEnabled;
    els.scheduleOptOut.checked = row.optOut;
    App.openModal(els.scheduleModal);

    try {
      const data = await App.api(`/api/sms/customers/${encodeURIComponent(cariKod)}`);
      const settings = data.settings;
      els.schedulePhone.value = settings.phoneOverride || '';
      els.scheduleInterval.value = settings.intervalDays ?? '';
      els.scheduleNextAt.value = App.toDateTimeLocal(settings.nextSmsAt);
      els.scheduleNote.value = settings.note || '';
      els.scheduleEnabled.checked = Boolean(settings.smsEnabled);
      els.scheduleOptOut.checked = Boolean(settings.optOut);
    } catch (error) {
      App.toast(`SMS planı yüklenemedi: ${error.message}`, 'error');
    }
  }

  async function saveSchedule(event) {
    event.preventDefault();
    if (!state.current) return;
    const button = els.scheduleForm.querySelector('button[type="submit"]');
    els.scheduleError.classList.add('hidden');
    try {
      App.setBusy(button, true, 'Kaydediliyor…');
      await App.api(`/api/sms/customers/${encodeURIComponent(state.current.cariKod)}`, {
        method: 'PUT',
        body: {
          phoneOverride: els.schedulePhone.value.trim() || null,
          intervalDays: els.scheduleInterval.value === '' ? null : Number(els.scheduleInterval.value),
          nextSmsAt: els.scheduleNextAt.value ? new Date(els.scheduleNextAt.value).toISOString() : null,
          note: els.scheduleNote.value.trim() || null,
          smsEnabled: els.scheduleEnabled.checked,
          optOut: els.scheduleOptOut.checked,
        },
      });
      App.closeModal(els.scheduleModal);
      App.toast('SMS planı kaydedildi.', 'success');
      await Promise.all([loadStats(), loadScheduled(state.scheduled.page)]);
    } catch (error) {
      els.scheduleError.textContent = error.message;
      els.scheduleError.classList.remove('hidden');
    } finally {
      App.setBusy(button, false);
    }
  }

  async function runJob() {
    if (!window.confirm('Otomatik SMS görevi şimdi çalıştırılsın mı? Planlanan aralıklar ve günlük limit uygulanır.')) return;
    try {
      App.setBusy(els.runJob, true, 'Çalışıyor…');
      const data = await App.api('/api/sms/run-job', { method: 'POST', body: { force: false } });
      if (data.skipped) {
        App.toast(`Görev çalıştırılmadı: ${data.reason}`, 'warning', 6000);
      } else {
        App.toast(`Görev tamamlandı: ${data.sent} gönderim, ${data.skippedCount} atlandı, ${data.failed} hata.`, data.failed ? 'warning' : 'success', 7000);
      }
      await Promise.all([loadStats(), loadLogs(1), loadScheduled(state.scheduled.page)]);
    } catch (error) {
      App.toast(error.message, 'error');
    } finally {
      App.setBusy(els.runJob, false);
    }
  }

  function bindEvents() {
    els.logFilterBtn.addEventListener('click', () => loadLogs(1));
    els.scheduledFilterBtn.addEventListener('click', () => loadScheduled(1));
    els.logSearch.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); loadLogs(1); }
    });
    els.scheduledSearch.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); loadScheduled(1); }
    });
    els.logPrev.addEventListener('click', () => loadLogs(Math.max(1, state.logs.page - 1)));
    els.logNext.addEventListener('click', () => loadLogs(state.logs.page + 1));
    els.scheduledPrev.addEventListener('click', () => loadScheduled(Math.max(1, state.scheduled.page - 1)));
    els.scheduledNext.addEventListener('click', () => loadScheduled(state.scheduled.page + 1));
    els.refresh.addEventListener('click', () => {
      loadStats();
      if (state.logs.loaded) loadLogs(state.logs.page);
      if (state.scheduled.loaded) loadScheduled(state.scheduled.page);
    });
    els.runJob?.addEventListener('click', runJob);

    els.sendMessage.addEventListener('input', updateSendCharCount);
    els.sendTemplateId.addEventListener('change', async () => {
      await previewSend();
      updateSendCharCount();
    });
    els.sendPreview.addEventListener('click', async () => {
      await previewSend();
      updateSendCharCount();
    });
    els.sendForm.addEventListener('submit', submitSend);
    els.scheduleForm.addEventListener('submit', saveSchedule);

    els.scheduledBody.addEventListener('click', (event) => {
      const sendButton = event.target.closest('[data-send]');
      if (sendButton) { openSend(sendButton.dataset.send); return; }
      const scheduleButton = event.target.closest('[data-edit-schedule]');
      if (scheduleButton) { openSchedule(scheduleButton.dataset.editSchedule); return; }
    });

    document.querySelectorAll('[data-tabs] .tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        if (tab.dataset.tab === 'scheduled' && !state.scheduled.loaded) loadScheduled(1);
      });
    });
  }

  bindEvents();
  loadStats();
  loadLogs(1);
})();
