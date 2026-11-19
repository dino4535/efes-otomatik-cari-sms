'use strict';

(function () {
  const page = document.getElementById('stockLitrePage');
  if (!page) return;

  const el = (id) => document.getElementById(id);
  const els = {
    save: el('litreSave'),
    search: el('litreSearch'),
    state: el('litreState'),
    source: el('litreSource'),
    includeService: el('litreIncludeService'),
    includePackaging: el('litreIncludePackaging'),
    updated: el('litreUpdated'),
    body: el('litreBody'),
    summary: el('litreSummary'),
    dirtyCount: el('litreDirtyCount'),
    prev: el('litrePrev'),
    next: el('litreNext'),
    pageInfo: el('litrePageInfo'),
    kpiTotal: el('litreKpiTotal'),
    kpiTotalSub: el('litreKpiTotalSub'),
    kpiMissing: el('litreKpiMissing'),
    kpiManual: el('litreKpiManual'),
    kpiStockMissing: el('litreKpiStockMissing'),
  };

  const state = {
    q: '',
    state: 'all',
    source: 'all',
    includeService: false,
    includePackaging: false,
    page: 1,
    pageSize: 50,
    data: null,
    requestId: 0,
    dirty: new Map(),
    rendered: new Map(),
  };

  const quantityFormat = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 3 });
  const factorFormat = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 3 });
  const escapeHtml = (value) => App.escapeHtml(value);

  function quantity(value) {
    if (value === null || value === undefined) return '—';
    return quantityFormat.format(Number(value));
  }

  function factor(value) {
    if (value === null || value === undefined) return '—';
    return factorFormat.format(Number(value));
  }

  function inputNumber(value) {
    if (value === null || value === undefined || value === '') return '';
    return String(value).replace('.', ',');
  }

  function sourceBadge(item) {
    if (item.ltSource === 'manual') return '<span class="badge badge-info">Manuel</span>';
    if (item.ltSource === 'unit') return '<span class="badge badge-success">Birim</span>';
    if (item.ltSource === 'name') return '<span class="badge badge-warning">Ürün Adı</span>';
    return '<span class="badge badge-danger">Eksik</span>';
  }

  function unitLabel(item) {
    const unit = item.primaryUnit || '—';
    if (item.packFactor && item.packFactor > 1) {
      return `${escapeHtml(unit)} <span class="stock-sub">${factorFormat.format(item.packFactor)} adet / birim</span>`;
    }
    return escapeHtml(unit);
  }

  function parsePreview(value, item) {
    const text = String(value ?? '').trim();
    if (!text) return { ok: true, litre: item.autoLtFactor, automatic: true };
    const normalized = text.replace(/\s+/g, ' ').replace(/,/g, '.');
    const unitMatch = /^(\d+(?:\.\d+)?)\s*(litre|cl|ck|cc|ml|lt|l)$/i.exec(normalized);
    if (unitMatch) {
      const amount = Number(unitMatch[1]);
      const unit = unitMatch[2].toLowerCase();
      if (!Number.isFinite(amount) || amount <= 0) return { ok: false };
      const pieceUnit = ['cl', 'ck', 'cc', 'ml'].includes(unit);
      if (pieceUnit && item.caseUnit && !(Number(item.packFactor) >= 2)) return { ok: false };
      let litre = amount;
      if (unit === 'cl' || unit === 'ck') litre = amount / 100;
      else if (unit === 'cc' || unit === 'ml') litre = amount / 1000;
      if (pieceUnit && item.caseUnit) litre *= Number(item.packFactor);
      return { ok: true, litre, automatic: false };
    }
    if (!/^\d+(?:\.\d+)?$/.test(normalized)) return { ok: false };
    const litre = Number(normalized);
    if (!Number.isFinite(litre) || litre <= 0) return { ok: false };
    return { ok: true, litre, automatic: false };
  }

  function totalFor(item, litre) {
    if (litre === null || litre === undefined) return null;
    return Number(item.stock) * Number(litre);
  }

  function updateRowPreview(code) {
    const row = els.body.querySelector(`tr[data-code="${CSS.escape(code)}"]`);
    const item = state.rendered.get(code);
    if (!row || !item) return;
    const input = row.querySelector('.litre-input');
    const totalCell = row.querySelector('.litre-total');
    if (!input || !totalCell) return;

    const parsed = parsePreview(input.value, item);
    input.classList.toggle('is-invalid', !parsed.ok);
    if (!parsed.ok) {
      totalCell.textContent = '—';
      totalCell.classList.add('money-danger');
      return;
    }
    totalCell.classList.remove('money-danger');
    totalCell.textContent = quantity(totalFor(item, parsed.litre));
  }

  function originalValue(item) {
    if (item.manualLitre === null || item.manualLitre === undefined) return '';
    return item.manualInput || inputNumber(item.manualLitre);
  }

  function updateSaveButton() {
    const count = state.dirty.size;
    els.save.disabled = count === 0;
    els.save.textContent = count
      ? `✓ ${count} Değişikliği Kaydet`
      : '✓ Değişiklikleri Kaydet';
    els.dirtyCount.textContent = count ? `${count} kaydedilmemiş değişiklik` : '';
  }

  function markDirty(code, value, item) {
    const original = originalValue(item);
    if (String(value ?? '').trim() === String(original).trim()) {
      state.dirty.delete(code);
    } else {
      state.dirty.set(code, value);
    }
    const row = els.body.querySelector(`tr[data-code="${CSS.escape(code)}"]`);
    if (row) row.classList.toggle('is-dirty', state.dirty.has(code));
    updateSaveButton();
  }

  function renderKpis(summary) {
    if (!summary) return;
    els.kpiTotal.textContent = quantityFormat.format(Number(summary.total || 0));
    els.kpiTotalSub.textContent = `${quantityFormat.format(Number(summary.auto || 0))} otomatik · ${quantityFormat.format(Number(summary.manual || 0))} manuel`;
    els.kpiMissing.textContent = quantityFormat.format(Number(summary.missing || 0));
    els.kpiManual.textContent = quantityFormat.format(Number(summary.manual || 0));
    els.kpiStockMissing.textContent = quantityFormat.format(Number(summary.missingWithStock || 0));
  }

  function renderTable(data) {
    state.rendered = new Map();
    if (!data.items.length) {
      els.body.innerHTML = '<tr><td colspan="9" class="empty-state">Bu filtrelerle eşleşen stok bulunamadı.</td></tr>';
      return;
    }

    els.body.innerHTML = data.items.map((item) => {
      state.rendered.set(item.code, item);
      const code = escapeHtml(item.code);
      const value = state.dirty.has(item.code)
        ? state.dirty.get(item.code)
        : originalValue(item);
      const currentFactor = item.ltFactor === null ? null : item.ltFactor;
      const placeholder = currentFactor === null
        ? '12 veya 50 CL'
        : `Otomatik: ${factor(currentFactor)}`;
      const rowClass = [
        item.ltSource === 'manual' ? 'is-manual' : '',
        state.dirty.has(item.code) ? 'is-dirty' : '',
      ].filter(Boolean).join(' ');
      const group = item.group ? `<span>${escapeHtml(item.group)}</span>` : '';
      return `<tr data-code="${code}"${rowClass ? ` class="${rowClass}"` : ''}>
        <td><strong class="stock-code">${code}</strong></td>
        <td><div class="cari-cell"><strong>${escapeHtml(item.name)}</strong>${group}</div></td>
        <td>${unitLabel(item)}</td>
        <td class="num"><strong>${quantity(item.stock)}</strong></td>
        <td>${sourceBadge(item)}</td>
        <td class="num">${factor(currentFactor)}</td>
        <td>
          <input type="text"
                 class="litre-input"
                 data-code="${code}"
                 value="${escapeHtml(value)}"
                 placeholder="${escapeHtml(placeholder)}"
                 autocomplete="off"
                 spellcheck="false">
        </td>
        <td class="num litre-total">${quantity(item.stockLt)}</td>
        <td class="actions-cell">
          <button type="button" class="btn btn-ghost btn-xs litre-clear" data-clear="${code}">Temizle</button>
        </td>
      </tr>`;
    }).join('');
    updateSaveButton();
  }

  function renderPagination(data) {
    els.summary.textContent = `${quantityFormat.format(Number(data.filteredCount || 0))} kayıt · ${quantityFormat.format(Number(data.summary?.total || 0))} toplam ürün`;
    els.pageInfo.textContent = `${data.page} / ${data.pageCount}`;
    els.prev.disabled = data.page <= 1;
    els.next.disabled = data.page >= data.pageCount;
  }

  function renderUpdated(data) {
    const time = new Intl.DateTimeFormat('tr-TR', {
      timeZone: 'Europe/Istanbul',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date());
    els.updated.textContent = `${data.asOf} · ${time} itibarıyla`;
  }

  function renderLoading() {
    els.updated.textContent = 'Yükleniyor…';
  }

  function renderError(error) {
    els.updated.textContent = 'Veri alınamadı';
    els.body.innerHTML = `<tr><td colspan="9" class="empty-state">${escapeHtml(error.message || 'Litre tanımları alınamadı.')}</td></tr>`;
    els.summary.textContent = '';
    els.pageInfo.textContent = '';
    els.prev.disabled = true;
    els.next.disabled = true;
    App.toast(error.message || 'Litre tanımları alınamadı.', 'error');
  }

  function queryParams() {
    const params = new URLSearchParams({
      state: state.state,
      source: state.source,
      page: String(state.page),
      pageSize: String(state.pageSize),
    });
    if (state.q) params.set('q', state.q);
    if (state.includeService) params.set('services', '1');
    if (state.includePackaging) params.set('packaging', '1');
    return params;
  }

  async function load() {
    const requestId = ++state.requestId;
    renderLoading();
    try {
      const data = await App.api(`/api/stock/litres?${queryParams().toString()}`);
      if (requestId !== state.requestId) return;
      state.data = data;
      state.page = data.page;
      state.pageSize = data.pageSize;
      renderKpis(data.summary);
      renderTable(data);
      renderPagination(data);
      renderUpdated(data);
      updateSaveButton();
    } catch (error) {
      if (requestId !== state.requestId) return;
      renderError(error);
    }
  }

  function canDiscardDirty() {
    if (!state.dirty.size) return true;
    const confirmed = window.confirm(
      `Kaydedilmemiş ${state.dirty.size} değişiklik var. Devam ederseniz bu değişiklikler kaybolacak.`,
    );
    if (!confirmed) return false;
    state.dirty.clear();
    updateSaveButton();
    return true;
  }

  async function save() {
    if (!state.dirty.size) {
      App.toast('Kaydedilecek değişiklik yok.', 'info');
      return;
    }
    const entries = [...state.dirty.entries()].map(([code, value]) => ({ code, value }));
    App.setBusy(els.save, true, 'Kaydediliyor…');
    try {
      const result = await App.api('/api/stock/litres', {
        method: 'POST',
        body: { entries },
      });
      state.dirty.clear();
      updateSaveButton();
      const parts = [];
      if (result.saved) parts.push(`${result.saved} tanım kaydedildi`);
      if (result.removed) parts.push(`${result.removed} tanım temizlendi`);
      App.toast(parts.join(' · ') || 'Kaydedildi.', 'success');
      await load();
    } catch (error) {
      const details = Array.isArray(error.payload?.details) ? error.payload.details : [];
      for (const detail of details) {
        const row = els.body.querySelector(`tr[data-code="${CSS.escape(detail.code || '')}"]`);
        const input = row?.querySelector('.litre-input');
        if (input) {
          input.classList.add('is-invalid');
          input.title = detail.error || '';
        }
      }
      App.toast(error.message || 'Litre tanımları kaydedilemedi.', 'error');
    } finally {
      App.setBusy(els.save, false);
      updateSaveButton();
    }
  }

  if (els.search) {
    App.debounceSearch(els.search, () => {
      if (!canDiscardDirty()) {
        els.search.value = state.q;
        return;
      }
      state.q = els.search.value.trim();
      state.page = 1;
      load();
    }, 350);
  }

  if (els.state) {
    els.state.addEventListener('change', () => {
      if (!canDiscardDirty()) {
        els.state.value = state.state;
        return;
      }
      state.state = els.state.value;
      state.page = 1;
      load();
    });
  }

  if (els.source) {
    els.source.addEventListener('change', () => {
      if (!canDiscardDirty()) {
        els.source.value = state.source;
        return;
      }
      state.source = els.source.value;
      state.page = 1;
      load();
    });
  }

  if (els.includeService) {
    els.includeService.addEventListener('change', () => {
      if (!canDiscardDirty()) {
        els.includeService.checked = state.includeService;
        return;
      }
      state.includeService = els.includeService.checked;
      state.page = 1;
      load();
    });
  }

  if (els.includePackaging) {
    els.includePackaging.addEventListener('change', () => {
      if (!canDiscardDirty()) {
        els.includePackaging.checked = state.includePackaging;
        return;
      }
      state.includePackaging = els.includePackaging.checked;
      state.page = 1;
      load();
    });
  }

  if (els.prev) {
    els.prev.addEventListener('click', () => {
      if (state.page <= 1 || !canDiscardDirty()) return;
      state.page -= 1;
      load();
    });
  }

  if (els.next) {
    els.next.addEventListener('click', () => {
      if (!state.data || state.page >= state.data.pageCount || !canDiscardDirty()) return;
      state.page += 1;
      load();
    });
  }

  if (els.body) {
    els.body.addEventListener('input', (event) => {
      const input = event.target.closest('.litre-input');
      if (!input) return;
      const code = input.dataset.code;
      const item = state.rendered.get(code);
      if (!item) return;
      markDirty(code, input.value, item);
      updateRowPreview(code);
    });

    els.body.addEventListener('click', (event) => {
      const clear = event.target.closest('[data-clear]');
      if (!clear) return;
      const code = clear.dataset.clear;
      const item = state.rendered.get(code);
      const row = clear.closest('tr[data-code]');
      const input = row?.querySelector('.litre-input');
      if (!item || !input) return;
      input.value = '';
      markDirty(code, '', item);
      updateRowPreview(code);
      input.focus();
    });
  }

  if (els.save) {
    els.save.addEventListener('click', save);
  }

  window.addEventListener('beforeunload', (event) => {
    if (!state.dirty.size) return;
    event.preventDefault();
    event.returnValue = '';
  });

  updateSaveButton();
  load();
})();
