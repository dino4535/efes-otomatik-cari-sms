'use strict';

(function () {
  const App = window.App;
  const els = {
    body: document.getElementById('agingBody'),
    search: document.getElementById('filterSearch'),
    asOf: document.getElementById('filterAsOf'),
    tolerance: document.getElementById('filterTolerance'),
    includePrepaid: document.getElementById('filterIncludePrepaid'),
    onlyOverdue: document.getElementById('filterOnlyOverdue'),
    withPhone: document.getElementById('filterWithPhone'),
    reset: document.getElementById('resetFilters'),
    refresh: document.getElementById('refreshAging'),
    export: document.getElementById('exportAging'),
    meta: document.getElementById('agingMeta'),
    tableCount: document.getElementById('tableCount'),
    tableSummary: document.getElementById('tableSummary'),
    modal: document.getElementById('customerModal'),
    detailLoading: document.getElementById('detailLoading'),
    detailContent: document.getElementById('detailContent'),
    detailTitle: document.getElementById('customerModalTitle'),
    detailMeta: document.getElementById('customerModalMeta'),
    detailKpis: document.getElementById('detailKpis'),
    detailBuckets: document.getElementById('detailBuckets'),
    invoices: document.getElementById('detailInvoices'),
    credits: document.getElementById('detailCredits'),
    matches: document.getElementById('detailMatches'),
    matchSummary: document.getElementById('matchSummary'),
    matchMeta: document.getElementById('matchMeta'),
    smsHistory: document.getElementById('smsHistoryBody'),
  };

  const typeLabels = {
    A: 'Devir',
    B: 'Fatura',
    C: 'İade Faturası',
    D: 'Nakit Tahsilat',
    E: 'Senet',
    G: 'Çek',
    K: 'Nakit / Banka',
  };

  function typeLabel(item) {
    if (item?.isCreditCard) return 'Kredi Kartı Tahsilatı';
    return typeLabels[item?.type] || item?.type || '—';
  }

  const bucketLabels = {
    d0_14: '0-14',
    d15_21: '15-21',
    d22_30: '22-30',
    d31_45: '31-45',
    d46_60: '46-60',
    d61: '61+',
  };

  const state = {
    data: null,
    loading: false,
    filters: {
      search: '',
      bucket: '',
      onlyOverdue: false,
      withPhone: false,
    },
    current: null,
    detail: null,
    smsLoaded: false,
    templatesLoaded: false,
  };

  function formatPhone(phone) {
    const value = String(phone || '');
    if (/^\+90\d{10}$/.test(value)) {
      const national = value.slice(3);
      return `+90 ${national.slice(0, 3)} ${national.slice(3, 6)} ${national.slice(6, 8)} ${national.slice(8, 10)}`;
    }
    return value || '—';
  }

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

  function filteredCustomers() {
    if (!state.data) return [];
    const needle = state.filters.search.toLocaleLowerCase('tr');
    return state.data.customers.filter((customer) => {
      if (state.filters.onlyOverdue && !(customer.overdue30 > 0)) return false;
      if (state.filters.withPhone && !customer.phone) return false;
      if (state.filters.bucket && !(customer.buckets[state.filters.bucket] > 0)) return false;
      if (!needle) return true;
      const haystack = [
        customer.cariKod,
        customer.cariIsim,
        customer.phone,
        customer.rawPhone,
        customer.city,
        customer.district,
      ].join(' ').toLocaleLowerCase('tr');
      return haystack.includes(needle);
    });
  }

  function renderKpis() {
    const summary = state.data.summary;
    document.getElementById('kpiTotal').textContent = App.money(summary.totalDebt, true);
    document.getElementById('kpiOverdue').textContent = App.money(summary.overdue30, true);
    document.getElementById('kpiOverdueCustomers').textContent = App.number(summary.overdueCustomerCount);
    document.getElementById('kpiControl').textContent = App.money(summary.controlTotal, true);

    document.getElementById('kpiTotalSub').textContent = `${summary.debtorCount} açık borçlu cari`;
    document.getElementById('kpiOverdueSub').textContent =
      summary.totalDebt > 0
        ? `Toplam borcun %${((summary.overdue30 / summary.totalDebt) * 100).toFixed(1)}'i`
        : '—';
    document.getElementById('kpiCustomerSub').textContent = `${summary.debtorCount} cari içinde`;
    const diff = Number(summary.difference || 0);
    const unmatured = Number(summary.unmatured || 0);
    document.getElementById('kpiControlSub').textContent =
      Math.abs(diff) < 0.005
        ? 'Cari bakiyeleriyle birebir uyumlu'
        : Math.abs(diff) < 0.05
          ? `Yuvarlama farkı: ${App.money(diff, true)}`
          : (unmatured > 0
            ? `Fark: ${App.money(diff, true)} · vadesi gelmemiş ${App.money(unmatured, true)}`
            : `Fark: ${App.money(diff, true)}`);

    document.getElementById('bucketAll').textContent = App.money(summary.totalDebt);
    document.getElementById('bucketD0').textContent = App.money(summary.buckets.d0_14);
    document.getElementById('bucketD15').textContent = App.money(summary.buckets.d15_21);
    document.getElementById('bucketD22').textContent = App.money(summary.buckets.d22_30);
    document.getElementById('bucketD31').textContent = App.money(summary.buckets.d31_45);
    document.getElementById('bucketD46').textContent = App.money(summary.buckets.d46_60);
    document.getElementById('bucketD61').textContent = App.money(summary.buckets.d61);
  }

  function renderTable() {
    const customers = filteredCustomers();
    const filteredTotal = customers.reduce((sum, customer) => sum + Number(customer.totalDebt || 0), 0);
    const filteredOverdue = customers.reduce((sum, customer) => sum + Number(customer.overdue30 || 0), 0);

    els.tableCount.textContent = `${App.number(customers.length)} cari`;
    els.tableSummary.textContent = customers.length
      ? ` · ${App.money(filteredTotal, true)} açık borç · ${App.money(filteredOverdue, true)} 30+ gecikmiş`
      : '';

    if (!customers.length) {
      els.body.innerHTML = '<tr><td colspan="12" class="empty-state">Filtrelere uyan cari bulunamadı.</td></tr>';
      return;
    }

    els.body.innerHTML = customers.map((customer) => {
      const oldestClass = customer.oldestDays >= 31 ? 'days-danger' : '';
      const phone = customer.phone
        ? formatPhone(customer.phone)
        : (customer.rawPhone ? `${App.escapeHtml(customer.rawPhone)} <span class="muted">(geçersiz)</span>` : '<span class="muted">—</span>');
      return `
        <tr data-cari="${App.escapeHtml(customer.cariKod)}">
          <td>
            <div class="cari-cell">
              <strong>${App.escapeHtml(customer.cariIsim)}</strong>
              <span>${App.escapeHtml(customer.cariKod)}${customer.district ? ` · ${App.escapeHtml(customer.district)}` : ''}</span>
            </div>
          </td>
          <td>${phone}</td>
          <td class="num money">${App.money(customer.totalDebt)}</td>
          <td class="num money">${App.money(customer.buckets.d0_14)}</td>
          <td class="num money">${App.money(customer.buckets.d15_21)}</td>
          <td class="num money">${App.money(customer.buckets.d22_30)}</td>
          <td class="num money">${App.money(customer.buckets.d31_45)}</td>
          <td class="num money">${App.money(customer.buckets.d46_60)}</td>
          <td class="num money">${App.money(customer.buckets.d61)}</td>
          <td class="num money ${customer.overdue30 > 0 ? 'money-danger' : ''}">${App.money(customer.overdue30)}</td>
          <td class="num"><span class="days-pill ${oldestClass}">${customer.oldestDays} gün</span></td>
          <td class="actions-cell"><button type="button" class="btn btn-ghost btn-xs" data-detail="${App.escapeHtml(customer.cariKod)}">Detay</button></td>
        </tr>
      `;
    }).join('');
  }

  function renderMeta() {
    if (!state.data) return;
    const generated = App.formatDateTime(state.data.generatedAt);
    const prepaidLabel = state.data.includePrepaid ? 'Dahil' : 'Hariç';
    els.meta.textContent =
      `Veritabanı: ${state.data.database} · Şube: ${state.data.branch} · ` +
      `Rapor tarihi: ${App.formatDate(state.data.asOf)} · Tolerans: ${App.money(state.data.tolerance)} TL · ` +
      `Peşin faturalar: ${prepaidLabel} · ` +
      `${App.number(state.data.movementCount)} hareket / ${App.number(state.data.customerCount)} cari · Son hesaplama: ${generated}`;
    if (els.export) {
      els.export.href = `/api/aging/export.xlsx?asOf=${encodeURIComponent(state.data.asOf)}` +
        `&tolerance=${encodeURIComponent(state.data.tolerance)}` +
        `&includePrepaid=${state.data.includePrepaid ? '1' : '0'}`;
    }
  }

  function renderAll() {
    renderKpis();
    renderTable();
    renderMeta();
  }

  function setLoading(loading) {
    state.loading = loading;
    els.refresh.disabled = loading;
  }

  async function loadAging(force = false) {
    if (state.loading) return;
    setLoading(true);
    const includePrepaid = els.includePrepaid?.value === '1';
    const params = new URLSearchParams();
    if (els.asOf.value) params.set('asOf', els.asOf.value);
    if (els.tolerance.value !== '') params.set('tolerance', els.tolerance.value);
    params.set('includePrepaid', includePrepaid ? '1' : '0');
    if (!force) {
      els.meta.textContent = 'Veriler yükleniyor…';
      els.body.innerHTML = '<tr><td colspan="12" class="empty-state">Veriler yükleniyor…</td></tr>';
    }

    try {
      let data;
      if (force) {
        data = await App.api('/api/aging/refresh', {
          method: 'POST',
          body: {
            asOf: els.asOf.value,
            tolerance: els.tolerance.value === '' ? 0 : Number(els.tolerance.value),
            includePrepaid,
          },
        });
      } else {
        data = await App.api(`/api/aging?${params.toString()}`);
      }
      state.data = data;
      renderAll();
      if (force) App.toast('Cari yaşlandırma verileri yenilendi.', 'success');
    } catch (error) {
      els.meta.textContent = `Veriler yüklenemedi: ${error.message}`;
      els.body.innerHTML = `<tr><td colspan="12" class="empty-state">${App.escapeHtml(error.message)}</td></tr>`;
      App.toast(error.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  function detailQuery() {
    const params = new URLSearchParams();
    if (state.data?.asOf) params.set('asOf', state.data.asOf);
    if (state.data?.tolerance !== undefined) params.set('tolerance', state.data.tolerance);
    params.set('includePrepaid', state.data?.includePrepaid ? '1' : '0');
    return params.toString();
  }

  function openDetail(cariKod) {
    const customer = state.data?.customers.find((item) => item.cariKod === cariKod);
    state.current = customer || null;
    state.detail = null;
    state.smsLoaded = false;
    els.detailTitle.textContent = customer?.cariIsim || cariKod;
    els.detailMeta.textContent = customer
      ? `${customer.cariKod} · ${formatPhone(customer.phone)}${customer.district ? ` · ${customer.district}` : ''}`
      : cariKod;
    els.detailLoading.classList.remove('hidden');
    els.detailLoading.textContent = 'Cari detayı yükleniyor…';
    els.detailContent.classList.add('hidden');
    App.openModal(els.modal);

    App.api(`/api/aging/${encodeURIComponent(cariKod)}?${detailQuery()}`)
      .then((detail) => {
        state.detail = detail;
        renderDetail(detail);
      })
      .catch((error) => {
        els.detailLoading.textContent = error.message;
        App.toast(error.message, 'error');
      });
  }

  function renderMatches(matches, prepaidIncluded = false) {
    if (!els.matches || !els.matchSummary) return;
    const includePrepaid = Boolean(prepaidIncluded);
    const exact = (matches || []).filter((match) => match.kind === 'exact_same_day');
    const totalAmount = exact.reduce((sum, match) => sum + Number(match.amount || 0), 0);
    const dates = exact.map((match) => match.debit.date).sort();
    const firstDate = dates[0];
    const lastDate = dates[dates.length - 1];

    els.matchSummary.innerHTML = `
      <div class="detail-kpi"><span>Toplam Eşleşme</span><strong>${App.number(exact.length)}</strong></div>
      <div class="detail-kpi"><span>Eşleşen Tutar</span><strong>${App.money(totalAmount, true)}</strong></div>
      <div class="detail-kpi"><span>İlk Eşleşme</span><strong>${firstDate ? App.formatDate(firstDate) : '—'}</strong></div>
      <div class="detail-kpi"><span>Son Eşleşme</span><strong>${lastDate ? App.formatDate(lastDate) : '—'}</strong></div>
    `;

    if (els.matchMeta) {
      els.matchMeta.textContent = includePrepaid
        ? 'Peşin faturalar dahil · Aynı gün eşit çiftler ayrıca eşleştirilmedi, tahsilatlar FIFO ile uygulandı'
        : `${App.number(exact.length)} kayıt · Fatura tutarı = aynı gün tahsilat tutarı`;
    }

    if (!exact.length) {
      els.matches.innerHTML = includePrepaid
        ? '<tr><td colspan="5" class="empty-state">Peşin faturalar bu hesaplamaya dahil edildiği için aynı gün eşit çiftler ayrıca eşleştirilmedi; tahsilatlar FIFO ile eski faturalara uygulandı.</td></tr>'
        : '<tr><td colspan="5" class="empty-state">Bu cari için fatura tutarı ile aynı günkü tahsilat tutarı birebir eşit olan kayıt bulunmuyor.</td></tr>';
      return;
    }

    els.matches.innerHTML = exact.map((match) => `
      <tr>
        <td class="match-party">
          <span class="match-date">${App.formatDate(match.debit.date)}</span>
          <strong>${App.escapeHtml(match.debit.belgeNo || '—')}</strong>
          <span class="match-desc" title="${App.escapeHtml(match.debit.description)}">${App.escapeHtml(match.debit.description || '—')}</span>
        </td>
        <td class="match-party">
          <span class="match-date">${App.formatDate(match.credit.date)}</span>
          <strong>${App.escapeHtml(match.credit.belgeNo || '—')}</strong>
          <span class="match-desc" title="${App.escapeHtml(match.credit.description)}">${App.escapeHtml(match.credit.description || '—')}</span>
        </td>
        <td class="num money">${App.money(match.debit.amount)}</td>
        <td class="num money">${App.money(match.credit.amount)}</td>
        <td class="num money money-success">${App.money(match.amount)}</td>
      </tr>
    `).join('');
  }

  function renderDetail(detail) {
    const customer = detail.customer;
    els.detailLoading.classList.add('hidden');
    els.detailContent.classList.remove('hidden');
    els.detailTitle.textContent = customer.cariIsim;
    els.detailMeta.textContent =
      `${customer.cariKod} · ${formatPhone(customer.phone)}` +
      (customer.city || customer.district ? ` · ${[customer.city, customer.district].filter(Boolean).join(' / ')}` : '') +
      ` · Rapor: ${App.formatDate(detail.asOf)} · Peşin faturalar: ${detail.includePrepaid ? 'Dahil' : 'Hariç'}`;

    els.detailKpis.innerHTML = `
      <div class="detail-kpi"><span>Toplam Açık Borç</span><strong>${App.money(customer.totalDebt, true)}</strong></div>
      <div class="detail-kpi danger"><span>30+ Gecikmiş</span><strong>${App.money(customer.overdue30, true)}</strong></div>
      <div class="detail-kpi"><span>Cari Bakiye</span><strong>${App.money(customer.balance, true)}</strong></div>
      <div class="detail-kpi"><span>En Yaşlı Fatura</span><strong>${customer.oldestDays} gün</strong></div>
    `;

    els.detailBuckets.innerHTML = Object.entries(bucketLabels).map(([key, label]) => {
      const amount = customer.buckets[key] || 0;
      const hot = ['d31_45', 'd46_60', 'd61'].includes(key) && amount > 0;
      return `<div class="detail-bucket ${hot ? 'hot' : ''}"><span>${label} Gün</span><strong>${App.money(amount)}</strong></div>`;
    }).join('');

    if (!customer.openItems.length) {
      els.invoices.innerHTML = '<tr><td colspan="8" class="empty-state">Açık fatura bulunmuyor.</td></tr>';
    } else {
      els.invoices.innerHTML = customer.openItems.map((item) => `
        <tr>
          <td>${App.formatDate(item.date)}</td>
          <td>${App.escapeHtml(item.belgeNo || '—')}</td>
          <td>${App.escapeHtml(typeLabel(item))}</td>
          <td class="message-cell"><span class="message-text" title="${App.escapeHtml(item.description)}">${App.escapeHtml(item.description || '—')}</span></td>
          <td class="num money">${App.money(item.amount)}</td>
          <td class="num money money-danger">${App.money(item.remaining)}</td>
          <td class="num">${item.days}</td>
          <td>${App.escapeHtml(item.bucket || '')}</td>
        </tr>
      `).join('');
    }

    if (!customer.credits.length) {
      els.credits.innerHTML = '<tr><td colspan="7" class="empty-state">Uygulanmış tahsilat veya alacak bulunmuyor.</td></tr>';
    } else {
      els.credits.innerHTML = customer.credits.map((item) => `
        <tr>
          <td>${App.formatDate(item.date)}</td>
          <td>${App.escapeHtml(item.belgeNo || '—')}</td>
          <td>${App.escapeHtml(typeLabel(item))}</td>
          <td class="message-cell"><span class="message-text" title="${App.escapeHtml(item.description)}">${App.escapeHtml(item.description || '—')}</span></td>
          <td class="num money">${App.money(item.amount)}</td>
          <td class="num money">${App.money(item.applied)}</td>
          <td class="num money">${App.money(item.remaining)}</td>
        </tr>
      `).join('');
    }

    renderMatches(customer.matches, detail.includePrepaid);

    const smsPanel = document.querySelector('[data-panel="sms"]');
    if (smsPanel) {
      smsPanel.dataset.cariKod = customer.cariKod;
      loadSmsData(customer.cariKod);
    }
  }

  async function loadSmsData(cariKod) {
    if (!document.querySelector('[data-panel="sms"]')) return;
    try {
      const [data] = await Promise.all([
        App.api(`/api/sms/customers/${encodeURIComponent(cariKod)}`),
        ensureTemplates(),
      ]);
      state.smsLoaded = true;
      fillSmsSettings(data.settings);
      renderSmsHistory(data.history);
      if (document.getElementById('sendSmsBtn')) {
        await previewSms(false);
      }
    } catch (error) {
      App.toast(`SMS bilgileri yüklenemedi: ${error.message}`, 'error');
    }
  }

  function fillSmsSettings(settings) {
    const form = document.getElementById('smsSettingsForm');
    if (!form) return;
    const phone = form.elements.phoneOverride;
    const interval = form.elements.intervalDays;
    const next = form.elements.nextSmsAt;
    const note = form.elements.note;
    const enabled = form.elements.smsEnabled;
    const optOut = form.elements.optOut;

    if (phone) phone.value = settings.phoneOverride || '';
    if (interval) interval.value = settings.intervalDays ?? '';
    if (next) next.value = App.toDateTimeLocal(settings.nextSmsAt);
    if (note) note.value = settings.note || '';
    if (enabled) enabled.checked = Boolean(settings.smsEnabled);
    if (optOut) optOut.checked = Boolean(settings.optOut);
  }

  function renderSmsHistory(history) {
    if (!els.smsHistory) return;
    if (!history.length) {
      els.smsHistory.innerHTML = '<tr><td colspan="5" class="empty-state">SMS kaydı yok.</td></tr>';
      return;
    }
    els.smsHistory.innerHTML = history.map((row) => `
      <tr>
        <td>${App.formatDateTime(row.created_at)}</td>
        <td>${App.escapeHtml(formatPhone(row.phone))}</td>
        <td>${statusBadge(row.status)}</td>
        <td>${row.trigger_type === 'scheduled' ? 'Otomatik' : 'Manuel'}</td>
        <td class="message-cell"><span class="message-text" title="${App.escapeHtml(row.message)}">${App.escapeHtml(row.message || '')}</span></td>
      </tr>
    `).join('');
  }

  async function ensureTemplates() {
    if (state.templatesLoaded) return;
    const select = document.getElementById('smsTemplateSelect');
    if (!select) return;
    try {
      const data = await App.api('/api/sms/templates');
      select.innerHTML = '<option value="">Varsayılan şablon</option>' + data.templates
        .map((template) => `<option value="${template.id}">${App.escapeHtml(template.name)}${template.is_active ? '' : ' (pasif)'}</option>`)
        .join('');
      state.templatesLoaded = true;
    } catch {
      // Şablon listesi alınamazsa varsayılan şablonla devam edilir.
    }
  }

  function updateCharCount() {
    const textarea = document.getElementById('smsMessage');
    const counter = document.getElementById('smsCharCount');
    if (!textarea || !counter) return;
    const length = textarea.value.length;
    const segments = length <= 70 ? 1 : Math.ceil(length / 67);
    counter.textContent = `${length} / 500 · ${segments} SMS (tahmini)`;
  }

  async function previewSms(showToast = true) {
    if (!state.current) return null;
    const textarea = document.getElementById('smsMessage');
    const select = document.getElementById('smsTemplateSelect');
    const message = textarea ? textarea.value.trim() : '';
    try {
      const data = await App.api('/api/sms/preview', {
        method: 'POST',
        body: {
          cariKod: state.current.cariKod,
          templateId: select?.value || undefined,
          message: message || undefined,
        },
      });
      if (textarea) textarea.value = data.message;
      const counter = document.getElementById('smsCharCount');
      if (counter) {
        counter.textContent = `${data.length} / 500 · ${data.segments} SMS · ${data.encoding}`;
      }
      if (showToast) App.toast('Mesaj önizlemesi hazır.', 'success');
      return data;
    } catch (error) {
      App.toast(error.message, 'error');
      return null;
    }
  }

  async function saveSmsSettings(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const payload = {
      phoneOverride: form.elements.phoneOverride.value.trim() || null,
      smsEnabled: form.elements.smsEnabled.checked,
      optOut: form.elements.optOut.checked,
      intervalDays: form.elements.intervalDays.value === '' ? null : Number(form.elements.intervalDays.value),
      nextSmsAt: form.elements.nextSmsAt.value ? new Date(form.elements.nextSmsAt.value).toISOString() : null,
      note: form.elements.note.value.trim() || null,
    };
    try {
      App.setBusy(button, true, 'Kaydediliyor…');
      const data = await App.api(`/api/sms/customers/${encodeURIComponent(state.current.cariKod)}`, {
        method: 'PUT',
        body: payload,
      });
      fillSmsSettings(data.settings);
      App.toast('SMS ayarları kaydedildi.', 'success');
    } catch (error) {
      App.toast(error.message, 'error');
    } finally {
      App.setBusy(button, false);
    }
  }

  async function sendSms() {
    if (!state.current) return;
    if (!window.confirm(`${state.current.cariIsim} için SMS gönderilsin mi?`)) return;
    const button = document.getElementById('sendSmsBtn');
    const textarea = document.getElementById('smsMessage');
    const select = document.getElementById('smsTemplateSelect');
    try {
      App.setBusy(button, true, 'Gönderiliyor…');
      const data = await App.api('/api/sms/send', {
        method: 'POST',
        body: {
          cariKod: state.current.cariKod,
          templateId: select?.value || undefined,
          message: textarea?.value.trim() || undefined,
          force: true,
        },
      });
      if (data.skipped) {
        App.toast(`Gönderilmedi: ${data.reason}`, 'warning');
      } else if (data.status === 'failed') {
        App.toast(`SMS gönderilemedi: ${data.error}`, 'error');
      } else {
        App.toast(data.status === 'simulated' ? 'SMS simüle edildi (test modu).' : 'SMS gönderildi.', 'success');
      }
      const history = await App.api(`/api/sms/customers/${encodeURIComponent(state.current.cariKod)}`);
      renderSmsHistory(history.history);
      fillSmsSettings(history.settings);
    } catch (error) {
      App.toast(error.message, 'error');
    } finally {
      App.setBusy(button, false);
    }
  }

  function bindEvents() {
    els.search.addEventListener('input', App.debounce(() => {
      state.filters.search = els.search.value.trim();
      renderTable();
    }, 200));

    els.onlyOverdue.addEventListener('change', () => {
      state.filters.onlyOverdue = els.onlyOverdue.checked;
      renderTable();
    });
    els.withPhone.addEventListener('change', () => {
      state.filters.withPhone = els.withPhone.checked;
      renderTable();
    });

    els.asOf.addEventListener('change', () => loadAging(false));
    els.tolerance.addEventListener('change', () => loadAging(false));
    if (els.includePrepaid) {
      els.includePrepaid.addEventListener('change', () => loadAging(false));
    }

    document.getElementById('bucketRow').addEventListener('click', (event) => {
      const chip = event.target.closest('[data-bucket]');
      if (!chip) return;
      const bucket = chip.dataset.bucket;
      state.filters.bucket = state.filters.bucket === bucket ? '' : bucket;
      document.querySelectorAll('#bucketRow [data-bucket]').forEach((item) => {
        item.classList.toggle('active', item.dataset.bucket === state.filters.bucket && state.filters.bucket !== '');
      });
      renderTable();
    });

    els.reset.addEventListener('click', () => {
      els.search.value = '';
      els.onlyOverdue.checked = false;
      els.withPhone.checked = false;
      state.filters = { search: '', bucket: '', onlyOverdue: false, withPhone: false };
      document.querySelectorAll('#bucketRow [data-bucket]').forEach((item) => item.classList.remove('active'));
      renderTable();
    });

    els.refresh.addEventListener('click', () => loadAging(true));

    els.body.addEventListener('click', (event) => {
      const button = event.target.closest('[data-detail]');
      const row = event.target.closest('tr[data-cari]');
      const cariKod = button?.dataset.detail || row?.dataset.cari;
      if (cariKod) openDetail(cariKod);
    });

    els.modal.addEventListener('click', (event) => {
      if (event.target.closest('.tab[data-tab="sms"]') && state.current && !state.smsLoaded) {
        loadSmsData(state.current.cariKod);
      }
    });

    const smsForm = document.getElementById('smsSettingsForm');
    if (smsForm) smsForm.addEventListener('submit', saveSmsSettings);

    const templateSelect = document.getElementById('smsTemplateSelect');
    if (templateSelect) {
      templateSelect.addEventListener('change', () => previewSms(false));
    }

    const message = document.getElementById('smsMessage');
    if (message) message.addEventListener('input', updateCharCount);

    const previewButton = document.getElementById('previewSms');
    if (previewButton) previewButton.addEventListener('click', () => previewSms(true));

    const sendButton = document.getElementById('sendSmsBtn');
    if (sendButton) sendButton.addEventListener('click', sendSms);
  }

  bindEvents();
  loadAging(false);
})();
