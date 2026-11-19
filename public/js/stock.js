'use strict';

(function () {
  const page = document.getElementById('stockPage');
  if (!page) return;

  const canExport = page.dataset.canExport === '1';
  const el = (id) => document.getElementById(id);
  const els = {
    reload: el('stockReload'),
    exportButton: el('stockExport'),
    search: el('stockSearch'),
    state: el('stockState'),
    window: el('stockWindow'),
    includeService: el('stockIncludeService'),
    updated: el('stockUpdated'),
    body: el('stockBody'),
    summary: el('stockSummary'),
    prev: el('stockPrev'),
    next: el('stockNext'),
    pageInfo: el('stockPageInfo'),
    kpiProducts: el('stockKpiProducts'),
    kpiProductsSub: el('stockKpiProductsSub'),
    kpiLitre: el('stockKpiLitre'),
    kpiAdet: el('stockKpiAdet'),
    kpiAge: el('stockKpiAge'),
    kpiAgeSub: el('stockKpiAgeSub'),
    kpiValue: el('stockKpiValue'),
    kpiValueSub: el('stockKpiValueSub'),
    detailModal: el('stockDetailModal'),
    detailTitle: el('stockDetailTitle'),
    detailMeta: el('stockDetailMeta'),
    detailBody: el('stockDetailBody'),
  };

  const state = {
    q: '',
    state: 'in',
    window: 30,
    includeService: false,
    sort: 'stock',
    dir: 'desc',
    page: 1,
    pageSize: 50,
    data: null,
    requestId: 0,
  };

  const quantityFormat = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 3 });
  const dayFormat = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });
  const moneyFormat = new Intl.NumberFormat('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const escapeHtml = (value) => App.escapeHtml(value);

  function quantity(value) {
    if (value === null || value === undefined) return '—';
    return quantityFormat.format(Number(value));
  }

  function days(value) {
    if (value === null || value === undefined) return '—';
    return `${dayFormat.format(Number(value))} g`;
  }

  function money(value) {
    if (value === null || value === undefined) return '—';
    return moneyFormat.format(Number(value));
  }

  function date(value) {
    return value ? App.formatDate(value) : '—';
  }

  function renderKpis(summary) {
    if (!summary) return;
    els.kpiProducts.textContent = quantityFormat.format(Number(summary.inStockCount || 0));
    els.kpiProductsSub.textContent = summary
      ? `${quantityFormat.format(Number(summary.productCount || 0))} ürün · ${quantityFormat.format(Number(summary.zeroCount || 0))} sıfır · ${quantityFormat.format(Number(summary.negativeCount || 0))} negatif`
      : 'Hesaplanıyor…';
    els.kpiLitre.textContent = summary.totalLt === null || summary.totalLt === undefined
      ? '—'
      : quantityFormat.format(Number(summary.totalLt));
    els.kpiAdet.textContent = summary.totalAd === null || summary.totalAd === undefined
      ? '—'
      : quantityFormat.format(Number(summary.totalAd));
    els.kpiAge.textContent = summary.averageAgeDays === null || summary.averageAgeDays === undefined
      ? '—'
      : `${dayFormat.format(Number(summary.averageAgeDays))} gün`;
    els.kpiAgeSub.textContent = 'Stokla ağırlıklı FIFO';
    els.kpiValue.textContent = summary.totalValue === null || summary.totalValue === undefined
      ? '—'
      : `${moneyFormat.format(Number(summary.totalValue))} ₺`;
    els.kpiValueSub.textContent = 'Son alış fiyatına göre';
  }

  function stockDaysCell(value) {
    if (value === null || value === undefined) return '<span class="money-muted">—</span>';
    const number = Number(value);
    let className = 'days-pill';
    if (number <= 7) className += ' days-danger';
    else if (number <= 14) className += ' days-warning';
    else if (number >= 60) className += ' days-success';
    return `<span class="${className}">${dayFormat.format(number)} g</span>`;
  }

  function renderTable(data) {
    if (!data.items.length) {
      els.body.innerHTML = '<tr><td colspan="13" class="empty-state">Bu filtrelerle eşleşen stok bulunamadı.</td></tr>';
      return;
    }

    els.body.innerHTML = data.items.map((item) => {
      const rowClass = item.state === 'negative' ? ' class="is-negative"' : '';
      const unit = item.primaryUnit ? `<span class="stock-unit">${escapeHtml(item.primaryUnit)}</span>` : '';
      const priceSub = item.lastSalePriceLt === null || item.lastSalePriceLt === undefined
        ? ''
        : `<span class="stock-sub">${money(item.lastSalePriceLt)} / Lt</span>`;
      const group = item.group ? escapeHtml(item.group) : '—';
      return `<tr${rowClass} data-code="${escapeHtml(item.code)}" tabindex="0" title="Hareketleri görmek için tıklayın">
        <td><strong class="stock-code">${escapeHtml(item.code)}</strong></td>
        <td><div class="cari-cell"><strong>${escapeHtml(item.name)}</strong><span>${group}</span></div></td>
        <td class="num"><strong>${quantity(item.stock)}</strong> ${unit}</td>
        <td class="num">${quantity(item.stockLt)}</td>
        <td class="num">${quantity(item.stockAd)}</td>
        <td>${date(item.lastPurchaseDate)}</td>
        <td>${date(item.lastSaleDate)}</td>
        <td class="num">${quantity(item.avgDailySales)}</td>
        <td class="num">${stockDaysCell(item.stockDays)}</td>
        <td class="num">${days(item.avgAgeDays)}</td>
        <td class="num">${days(item.oldestAgeDays)}</td>
        <td class="num money">${money(item.lastSalePrice)}${priceSub}</td>
        <td class="num money">${money(item.value)}</td>
      </tr>`;
    }).join('');
  }

  function renderPagination(data) {
    els.summary.textContent = `${quantityFormat.format(Number(data.filteredCount || 0))} kayıt · ${quantityFormat.format(Number(data.summary?.productCount || 0))} toplam ürün`;
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
    els.updated.textContent = `${data.asOf} · ${data.windowDays} gün penceresi · ${time} itibarıyla`;
  }

  function updateSortMarks() {
    document.querySelectorAll('.th-sort').forEach((button) => {
      const mark = button.querySelector('.sort-mark');
      const isActive = button.dataset.sort === state.sort;
      button.classList.toggle('is-active', isActive);
      if (mark) {
        mark.textContent = isActive ? (state.dir === 'asc' ? '↑' : '↓') : '';
      }
    });
  }

  function renderLoading() {
    els.updated.textContent = 'Yükleniyor…';
  }

  function renderError(error) {
    els.updated.textContent = 'Veri alınamadı';
    els.body.innerHTML = `<tr><td colspan="13" class="empty-state">${escapeHtml(error.message || 'Stok verisi alınamadı.')}</td></tr>`;
    els.summary.textContent = '';
    els.pageInfo.textContent = '';
    els.prev.disabled = true;
    els.next.disabled = true;
    App.toast(error.message || 'Stok verisi alınamadı.', 'error');
  }

  function queryParams() {
    const params = new URLSearchParams({
      state: state.state,
      window: String(state.window),
      sort: state.sort,
      dir: state.dir,
      page: String(state.page),
      pageSize: String(state.pageSize),
    });
    if (state.q) params.set('q', state.q);
    if (state.includeService) params.set('services', '1');
    return params;
  }

  async function load({ refresh = false } = {}) {
    const requestId = ++state.requestId;
    renderLoading();
    const params = queryParams();
    if (refresh) params.set('refresh', '1');

    try {
      const data = await App.api(`/api/stock?${params.toString()}`);
      if (requestId !== state.requestId) return;
      state.data = data;
      renderKpis(data.summary);
      renderTable(data);
      renderPagination(data);
      renderUpdated(data);
      updateSortMarks();
    } catch (error) {
      if (requestId !== state.requestId) return;
      renderError(error);
    }
  }

  function movementBadge(item) {
    if (item.type === 'L/G') return 'badge-info';
    if (item.type === 'J/C') return 'badge-success';
    if (item.type === 'L/C' || item.type === 'J/G') return 'badge-danger';
    return item.direction === 'in' ? 'badge-muted' : 'badge-warning';
  }

  function renderDetail(data, item) {
    const product = item || {};
    const unit = product.primaryUnit ? ` ${product.primaryUnit}` : '';
    els.detailTitle.textContent = 'Stok Hareketleri';
    els.detailMeta.textContent = [
      product.code || data.code,
      product.name,
      product.stock !== undefined ? `${quantity(product.stock)}${unit} stok` : null,
      `${data.items.length} hareket`,
    ].filter(Boolean).join(' · ');

    if (!data.items.length) {
      els.detailBody.innerHTML = '<tr><td colspan="7" class="empty-state">Bu stok için hareket bulunamadı.</td></tr>';
      return;
    }

    els.detailBody.innerHTML = data.items.map((movement) => {
      const signedClass = movement.direction === 'in' ? 'money-success' : 'money-danger';
      const signedPrefix = movement.direction === 'in' ? '+' : '−';
      const description = movement.description ? escapeHtml(movement.description) : '—';
      return `<tr>
        <td>${App.formatDate(movement.date)}</td>
        <td><span class="badge ${movementBadge(movement)}">${escapeHtml(movement.typeLabel)}</span></td>
        <td><span class="stock-code">${escapeHtml(movement.fisNo || '—')}</span></td>
        <td>${escapeHtml(movement.cariKod || '—')}</td>
        <td class="num ${signedClass}">${signedPrefix}${quantity(movement.quantity)}${unit}</td>
        <td class="num money">${money(movement.unitPrice)}</td>
        <td class="message-cell"><span class="message-text" title="${description}">${description}</span></td>
      </tr>`;
    }).join('');
  }

  async function openDetail(code) {
    const item = state.data?.items?.find((row) => row.code === code) || null;
    els.detailMeta.textContent = item ? `${item.code} · ${item.name}` : code;
    els.detailBody.innerHTML = '<tr><td colspan="7" class="empty-state">Yükleniyor…</td></tr>';
    App.openModal(els.detailModal);

    try {
      const data = await App.api(`/api/stock/${encodeURIComponent(code)}/movements?limit=50`);
      renderDetail(data, item);
    } catch (error) {
      els.detailBody.innerHTML = `<tr><td colspan="7" class="empty-state">${escapeHtml(error.message || 'Hareketler alınamadı.')}</td></tr>`;
      App.toast(error.message || 'Stok hareketleri alınamadı.', 'error');
    }
  }

  function exportHref() {
    const params = queryParams();
    params.delete('page');
    params.delete('pageSize');
    return `/api/stock/export.xlsx?${params.toString()}`;
  }

  if (els.search) {
    App.debounceSearch(els.search, () => {
      state.q = els.search.value.trim();
      state.page = 1;
      load();
    }, 350);
  }

  if (els.state) {
    els.state.addEventListener('change', () => {
      state.state = els.state.value;
      state.page = 1;
      load();
    });
  }

  if (els.window) {
    els.window.addEventListener('change', () => {
      state.window = Number(els.window.value) || 30;
      state.page = 1;
      load();
    });
  }

  if (els.includeService) {
    els.includeService.addEventListener('change', () => {
      state.includeService = els.includeService.checked;
      state.page = 1;
      load();
    });
  }

  if (els.reload) {
    els.reload.addEventListener('click', () => {
      load({ refresh: true });
    });
  }

  if (els.exportButton && canExport) {
    els.exportButton.addEventListener('click', () => {
      window.location.href = exportHref();
    });
  }

  if (els.prev) {
    els.prev.addEventListener('click', () => {
      if (state.page <= 1) return;
      state.page -= 1;
      load();
    });
  }

  if (els.next) {
    els.next.addEventListener('click', () => {
      if (!state.data || state.page >= state.data.pageCount) return;
      state.page += 1;
      load();
    });
  }

  document.querySelectorAll('.th-sort').forEach((button) => {
    button.addEventListener('click', () => {
      const key = button.dataset.sort;
      if (state.sort === key) {
        state.dir = state.dir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sort = key;
        state.dir = key === 'code' || key === 'name' ? 'asc' : 'desc';
      }
      state.page = 1;
      updateSortMarks();
      load();
    });
  });

  if (els.body) {
    els.body.addEventListener('click', (event) => {
      const row = event.target.closest('tr[data-code]');
      if (!row) return;
      openDetail(row.dataset.code);
    });
    els.body.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const row = event.target.closest('tr[data-code]');
      if (!row) return;
      event.preventDefault();
      openDetail(row.dataset.code);
    });
  }

  updateSortMarks();
  load();
})();
