'use strict';

(function () {
  const page = document.getElementById('ledgerPage');
  if (!page) return;

  const canDetail = page.dataset.canDetail === '1';
  const canFinance = page.dataset.canFinance === '1';
  const today = page.dataset.today || '';
  const yearStart = page.dataset.yearStart || '';

  const el = (id) => document.getElementById(id);
  const els = {
    dealerSearch: el('dealerSearch'),
    dealerOnlyBalance: el('dealerOnlyBalance'),
    dealerReload: el('dealerReload'),
    ledgerRefresh: el('ledgerRefresh'),
    dealerList: el('dealerList'),
    dealerSummary: el('dealerSummary'),
    dealerCount: el('dealerCount'),
    dealerPrev: el('dealerPrev'),
    dealerNext: el('dealerNext'),
    dealerPageInfo: el('dealerPageInfo'),
    statementCard: el('statementCard'),
    statementEmpty: el('statementEmpty'),
    statementWrap: el('statementWrap'),
    stmtTitle: el('stmtTitle'),
    stmtMeta: el('stmtMeta'),
    stmtCurrent: el('stmtCurrent'),
    stmtCurrentNote: el('stmtCurrentNote'),
    stmtStart: el('stmtStart'),
    stmtEnd: el('stmtEnd'),
    stmtApply: el('stmtApply'),
    stmtAll: el('stmtAll'),
    stmtExport: el('stmtExport'),
    stmtRangeNote: el('stmtRangeNote'),
    stmtOpening: el('stmtOpening'),
    stmtDebit: el('stmtDebit'),
    stmtCredit: el('stmtCredit'),
    stmtClosing: el('stmtClosing'),
    stmtWeightedDue: el('stmtWeightedDue'),
    stmtWeightedDueSub: el('stmtWeightedDueSub'),
    stmtAvgMaturity: el('stmtAvgMaturity'),
    stmtWeightedCollection: el('stmtWeightedCollection'),
    stmtWeightedCollectionSub: el('stmtWeightedCollectionSub'),
    stmtCollectionDelay: el('stmtCollectionDelay'),
    stmtTypeCards: el('stmtTypeCards'),
    stmtFundedAmount: el('stmtFundedAmount'),
    stmtFundedAmountSub: el('stmtFundedAmountSub'),
    stmtFundedDays: el('stmtFundedDays'),
    stmtFundedDaysSub: el('stmtFundedDaysSub'),
    stmtLateInterest: el('stmtLateInterest'),
    stmtLateInterestSub: el('stmtLateInterestSub'),
    stmtTotalInterest: el('stmtTotalInterest'),
    stmtTotalInterestSub: el('stmtTotalInterestSub'),
    stmtBody: el('stmtBody'),
    stmtFootLeft: el('stmtFootLeft'),
    stmtFootRight: el('stmtFootRight'),
  };

  const state = {
    page: 1,
    pageSize: 40,
    total: 0,
    totalPages: 1,
    search: '',
    onlyWithBalance: false,
    selectedCode: null,
    allTime: false,
    statementSeq: 0,
  };

  function money(value) {
    return App.money(value, true);
  }

  function balanceClass(value) {
    const number = Number(value || 0);
    if (number > 0) return 'money-danger';
    if (number < 0) return 'money-success';
    return 'money-muted';
  }

  function formatDays(value, { signed = false } = {}) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
    const number = Number(value);
    const abs = Math.abs(number);
    const text = Number.isInteger(abs) ? String(abs) : abs.toFixed(1).replace('.', ',');
    if (signed && number > 0) return `+${text} gün`;
    if (signed && number < 0) return `-${text} gün`;
    return `${text} gün`;
  }

  function typeSummaryTone(item) {
    if (item.debit > 0 && item.credit > 0) return 'mixed';
    if (item.debit > 0) return 'debit';
    if (item.credit > 0) return 'credit';
    return 'neutral';
  }

  function renderTypeCards(typeBreakdown) {
    if (!els.stmtTypeCards) return;
    if (!typeBreakdown.length) {
      els.stmtTypeCards.innerHTML = '<div class="type-summary-empty">Seçili dönemde hareket yok.</div>';
      return;
    }
    els.stmtTypeCards.innerHTML = typeBreakdown.map((item) => {
      const parts = [];
      if (item.debit > 0) parts.push(`Borç ${money(item.debit)}`);
      if (item.credit > 0) parts.push(`Alacak ${money(item.credit)}`);
      return `
        <div class="type-summary type-summary-${typeSummaryTone(item)}">
          <span class="type-summary-label">${App.escapeHtml(item.label)}</span>
          <strong>${money(item.total)}</strong>
          <small>${App.number(item.count)} hareket${parts.length ? ` · ${parts.join(' · ')}` : ''}</small>
        </div>
      `;
    }).join('');
  }

  function renderFinance(finance) {
    if (!canFinance || !els.stmtFundedAmount) return;
    if (!finance) {
      els.stmtFundedAmount.textContent = '—';
      els.stmtFundedAmountSub.textContent = 'Finans verisi yok';
      els.stmtFundedDays.textContent = '—';
      els.stmtFundedDaysSub.textContent = '—';
      els.stmtLateInterest.textContent = '—';
      els.stmtLateInterestSub.textContent = '—';
      els.stmtTotalInterest.textContent = '—';
      els.stmtTotalInterestSub.textContent = '—';
      return;
    }

    const rate = Number(finance.depositRate || 0);
    const hasRate = rate > 0;
    const fundedAmount = Number(finance.fundedAmount || 0);
    const funded = fundedAmount > 0;

    els.stmtFundedAmount.textContent = funded ? money(fundedAmount) : 'Yok';
    els.stmtFundedAmount.className = funded ? 'vade-late' : '';
    els.stmtFundedAmountSub.textContent = funded
      ? `${App.number(finance.fundedInvoiceCount)} vadesi geçmiş fatura`
      : 'Vadesi geçmiş açık fatura yok';
    els.stmtFundedDays.textContent = funded ? formatDays(finance.fundedDays) : '—';
    els.stmtFundedDaysSub.textContent = funded ? 'Tutar ağırlıklı' : 'Fonlama yok';

    els.stmtLateInterest.textContent = hasRate ? money(finance.latePaidInterest) : '—';
    els.stmtLateInterestSub.textContent = !hasRate
      ? 'Oran ayarlardan tanımlanmalı'
      : (finance.latePaidInvoiceCount > 0
        ? `${App.number(finance.latePaidInvoiceCount)} fatura · ${money(finance.latePaidAmount)} · ${formatDays(finance.latePaidDays)}`
        : 'Geç ödenen fatura yok');

    els.stmtTotalInterest.textContent = hasRate ? money(finance.totalInterest) : '—';
    els.stmtTotalInterestSub.textContent = hasRate
      ? `Geç ödenen ${money(finance.latePaidInterest)} · Devam eden ${money(finance.fundedInterest)}`
      : 'Mevduat oranı ayarlardan tanımlanmalı';
  }

  function statementParams() {
    const params = new URLSearchParams({ cariKod: state.selectedCode || '' });
    if (state.allTime) {
      params.set('all', '1');
    } else {
      if (els.stmtStart.value) params.set('start', els.stmtStart.value);
      if (els.stmtEnd.value) params.set('end', els.stmtEnd.value);
    }
    return params;
  }

  function formatPhone(phone) {
    const value = String(phone || '');
    if (/^\+90\d{10}$/.test(value)) {
      const national = value.slice(3);
      return `+90 ${national.slice(0, 3)} ${national.slice(3, 6)} ${national.slice(6, 8)} ${national.slice(8, 10)}`;
    }
    return value || '—';
  }

  function typeTone(type) {
    if (['B', 'BI', 'BK'].includes(type)) return 'type-debit';
    if (['C', 'D', 'G', 'H', 'K', 'CC'].includes(type)) return 'type-credit';
    return 'type-neutral';
  }

  function renderDealerList(items) {
    if (!items.length) {
      els.dealerList.innerHTML = '<div class="dealer-list-empty">Eşleşen cari bulunamadı.</div>';
      return;
    }
    els.dealerList.innerHTML = items.map((dealer) => `
      <button type="button" class="dealer-item ${dealer.cariKod === state.selectedCode ? 'active' : ''}"
              data-cari="${App.escapeHtml(dealer.cariKod)}" ${canDetail ? '' : 'disabled'}>
        <div class="dealer-item-head">
          <div class="dealer-item-title">
            <strong>${App.escapeHtml(dealer.cariIsim)}</strong>
            <span>${App.escapeHtml(dealer.cariKod)}</span>
          </div>
          <span class="dealer-item-balance ${balanceClass(dealer.balance)}">${money(dealer.balance)}</span>
        </div>
        <div class="dealer-item-foot">
          <span>${dealer.lastMovement ? `Son hareket: ${App.formatDate(dealer.lastMovement)}` : 'Hareket yok'}</span>
          <span>${App.number(dealer.movementCount)} kayıt</span>
        </div>
      </button>
    `).join('');
  }

  function updateActiveDealer() {
    for (const item of els.dealerList.querySelectorAll('.dealer-item')) {
      item.classList.toggle('active', item.dataset.cari === state.selectedCode);
    }
  }

  async function loadDealers({ page: wantedPage = state.page, refresh = false } = {}) {
    const params = new URLSearchParams({
      page: String(wantedPage),
      pageSize: String(state.pageSize),
    });
    if (state.search) params.set('q', state.search);
    if (state.onlyWithBalance) params.set('onlyWithBalance', '1');
    if (refresh) params.set('refresh', '1');

    if (!els.dealerList.querySelector('.dealer-item')) {
      els.dealerList.innerHTML = '<div class="dealer-list-empty">Cariler yükleniyor…</div>';
    }
    try {
      const data = await App.api(`/api/ledger/dealers?${params.toString()}`);
      state.page = data.page;
      state.total = data.total;
      state.totalPages = data.totalPages;
      renderDealerList(data.items);
      updateActiveDealer();

      const summary = data.summary || {};
      els.dealerCount.textContent = App.number(data.total);
      els.dealerSummary.textContent = `${App.number(summary.matchedDealers)} eşleşen · ${App.number(summary.debtorCount)} borçlu · ${App.number(summary.creditorCount)} alacaklı`;
      els.dealerPageInfo.textContent = data.total
        ? `Sayfa ${data.page} / ${data.totalPages}`
        : 'Kayıt yok';
      els.dealerPrev.disabled = data.page <= 1;
      els.dealerNext.disabled = data.page >= data.totalPages;
      return data;
    } catch (error) {
      els.dealerList.innerHTML = `<div class="dealer-list-empty">${App.escapeHtml(error.message || 'Cariler yüklenemedi.')}</div>`;
      els.dealerSummary.textContent = 'Liste alınamadı';
      els.dealerCount.textContent = '—';
      els.dealerPageInfo.textContent = '—';
      els.dealerPrev.disabled = true;
      els.dealerNext.disabled = true;
      App.toast(error.message || 'Cari listesi yüklenemedi.', 'error');
      return null;
    }
  }

  function showEmpty(title, message) {
    if (!els.statementEmpty) return;
    els.statementWrap?.classList.add('hidden');
    els.statementEmpty.classList.remove('hidden');
    els.statementEmpty.innerHTML = `
      <span class="ledger-empty-icon">⇄</span>
      <h3>${App.escapeHtml(title)}</h3>
      <p>${App.escapeHtml(message)}</p>
    `;
  }

  function selectDealer(cariKod, { updateUrl = true, scroll = false } = {}) {
    if (!canDetail || !cariKod) return;
    state.selectedCode = cariKod;
    updateActiveDealer();
    if (updateUrl) {
      const next = `/cari-hareketleri?cari=${encodeURIComponent(cariKod)}`;
      window.history.replaceState(null, '', next);
    }
    loadStatement();
    if (scroll && window.matchMedia('(max-width: 1024px)').matches) {
      els.statementCard?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function renderStatement(data) {
    els.statementEmpty?.classList.add('hidden');
    els.statementWrap?.classList.remove('hidden');

    els.stmtTitle.textContent = data.cariIsim || data.cariKod;
    const meta = [`Kod: ${data.cariKod}`];
    if (data.phone) meta.push(`Tel: ${formatPhone(data.phone)}`);
    if (data.city || data.district) meta.push([data.district, data.city].filter(Boolean).join(' / '));
    if (data.taxNumber) meta.push(`VKN: ${data.taxNumber}`);
    els.stmtMeta.textContent = meta.join(' · ');

    els.stmtCurrent.textContent = money(data.currentBalance);
    els.stmtCurrent.className = balanceClass(data.currentBalance);
    els.stmtCurrentNote.textContent = `${data.database || ''} · Şube ${data.branch ?? ''}`;

    els.stmtOpening.textContent = money(data.openingBalance);
    els.stmtDebit.textContent = money(data.totalDebit);
    els.stmtCredit.textContent = money(data.totalCredit);
    els.stmtClosing.textContent = money(data.closingBalance);
    els.stmtClosing.className = balanceClass(data.closingBalance);

    const maturity = data.maturity || {};
    els.stmtWeightedDue.textContent = maturity.weightedDueDate
      ? App.formatDate(maturity.weightedDueDate)
      : '—';
    els.stmtWeightedDueSub.textContent = maturity.invoiceCount
      ? `${App.number(maturity.invoiceCount)} fatura · ${money(maturity.invoiceTotal)}`
      : 'Fatura verisi yok';
    els.stmtAvgMaturity.textContent = formatDays(maturity.averageMaturityDays);
    els.stmtWeightedCollection.textContent = maturity.weightedCollectionDate
      ? App.formatDate(maturity.weightedCollectionDate)
      : '—';
    els.stmtWeightedCollectionSub.textContent = maturity.collectionCount
      ? `${App.number(maturity.collectionCount)} tahsilat · ${money(maturity.collectionTotal)}`
      : 'Tahsilat verisi yok';
    els.stmtCollectionDelay.textContent = formatDays(maturity.averageCollectionDelayDays, { signed: true });
    els.stmtCollectionDelay.className = maturity.averageCollectionDelayDays > 0
      ? 'vade-late'
      : (maturity.averageCollectionDelayDays < 0 ? 'vade-early' : '');

    renderTypeCards(data.typeBreakdown || []);
    renderFinance(data.finance);

    els.stmtRangeNote.textContent = data.allTime
      ? 'Tüm geçmiş'
      : `${App.formatDate(data.startDate)} – ${App.formatDate(data.endDate)}`;

    const rows = [];
    rows.push(`
      <tr class="ledger-opening">
        <td colspan="${canFinance ? 9 : 8}">Devir Bakiyesi</td>
        <td class="num money">—</td>
        <td class="num money">—</td>
        <td class="num money ${balanceClass(data.openingBalance)}">${money(data.openingBalance)}</td>
      </tr>
    `);

    if (!data.items.length) {
      rows.push(`<tr><td colspan="${canFinance ? 12 : 11}" class="empty-state">Seçilen tarih aralığında hareket bulunamadı.</td></tr>`);
    } else {
      for (const item of data.items) {
        const vadeCell = item.vade
          ? `<span class="vade-cell"><span class="${item.vadeSameAsDate ? 'vade-same' : ''}">${App.formatDate(item.vade)}</span>${item.termDays > 0 ? `<small>${formatDays(item.termDays)} vade</small>` : ''}</span>`
          : '<span class="muted">—</span>';

        let delayCell = '<span class="muted">—</span>';
        if (item.direction === 'debit' && item.overdueDays !== null) {
          const vadeText = item.vade ? App.formatDate(item.vade) : '—';
          const delayTitle = item.paymentStatus === 'paid'
            ? `${App.formatDate(item.paidDate)} tarihinde ödendi · vade ${vadeText}`
            : (item.overdueDays > 0
              ? `${item.overdueDays} gün gecikti · vade ${vadeText}`
              : `${item.dueInDays} gün sonra vade`);
          delayCell = item.overdueDays > 0
            ? `<span class="days-pill ${item.overdueDays >= 30 ? 'days-danger' : ''}" title="${App.escapeHtml(delayTitle)}">${item.overdueDays} gün</span>`
            : `<span class="days-pill days-ok" title="${App.escapeHtml(delayTitle)}">0</span>`;
        }

        let paidDateCell = '<span class="muted">—</span>';
        if (item.paidDate) {
          const paymentNote = item.paymentStatus === 'partial'
            ? `<small>Ödenen ${money(item.paidAmount)}</small><small>Kalan ${money(item.remainingAmount)}</small>`
            : '';
          paidDateCell = `<span class="vade-cell"><span>${App.formatDate(item.paidDate)}</span>${paymentNote}</span>`;
        }

        const statusCell = item.paymentStatus
          ? `<span class="status-pill status-${item.paymentStatus}">${App.escapeHtml(item.paymentStatusLabel || item.paymentStatus)}</span>`
          : '<span class="muted">—</span>';

        const interestCell = canFinance
          ? (() => {
              const amount = Number(item.interestAmount || 0);
              if (!(amount > 0)) return '<td class="num money">—</td>';
              const noteParts = [];
              if (Number(item.interestLateAmount) > 0) noteParts.push(`Geç ödenen ${formatDays(item.interestLateDays)}`);
              if (Number(item.interestOpenAmount) > 0) noteParts.push(`Devam eden ${formatDays(item.interestOpenDays)}`);
              return `
                <td class="num money statement-interest">
                  <strong>${money(amount)}</strong>
                  ${noteParts.length ? `<small>${noteParts.join(' · ')}</small>` : ''}
                </td>
              `;
            })()
          : '';

        rows.push(`
          <tr>
            <td class="nowrap">${App.formatDate(item.date)}</td>
            <td class="nowrap">${vadeCell}</td>
            <td class="nowrap">${delayCell}</td>
            ${interestCell}
            <td class="nowrap">${paidDateCell}</td>
            <td class="nowrap">${App.escapeHtml(item.belgeNo || '—')}</td>
            <td><span class="type-pill ${typeTone(item.typeKey)}">${App.escapeHtml(item.typeLabel)}</span></td>
            <td class="nowrap">${statusCell}</td>
            <td class="ledger-desc"><span title="${App.escapeHtml(item.description || '')}">${App.escapeHtml(item.description || '—')}</span></td>
            <td class="num money">${item.debit ? money(item.debit) : ''}</td>
            <td class="num money">${item.credit ? money(item.credit) : ''}</td>
            <td class="num money ${balanceClass(item.balance)}">${money(item.balance)}</td>
          </tr>
        `);
      }
      rows.push(`
        <tr class="statement-total-row">
          <td colspan="${canFinance ? 9 : 8}">Dönem Toplamı</td>
          <td class="num money">${money(data.totalDebit)}</td>
          <td class="num money">${money(data.totalCredit)}</td>
          <td class="num money ${balanceClass(data.closingBalance)}">${money(data.closingBalance)}</td>
        </tr>
      `);
    }
    els.stmtBody.innerHTML = rows.join('');

    els.stmtFootLeft.textContent = `${App.number(data.movementCount)} hareket · ${data.allTime ? 'Tüm geçmiş' : `${App.formatDate(data.startDate)} – ${App.formatDate(data.endDate)}`}`;
    els.stmtFootRight.textContent = `Oluşturulma: ${App.formatDateTime(data.generatedAt)}`;
  }

  async function loadStatement() {
    if (!canDetail || !state.selectedCode) return;
    const seq = ++state.statementSeq;

    els.statementEmpty?.classList.add('hidden');
    els.statementWrap?.classList.remove('hidden');
    els.stmtBody.innerHTML = `<tr><td colspan="${canFinance ? 12 : 11}" class="empty-state">Hareketler yükleniyor…</td></tr>`;

    const params = statementParams();
    if (els.stmtExport) {
      els.stmtExport.hidden = false;
      els.stmtExport.href = `/api/ledger/statement.xlsx?${params.toString()}`;
    }

    try {
      const data = await App.api(`/api/ledger/statement?${params.toString()}`);
      if (seq !== state.statementSeq) return;
      renderStatement(data);
    } catch (error) {
      if (seq !== state.statementSeq) return;
      showEmpty('Ekstre alınamadı', error.message || 'Cari hareketleri yüklenemedi.');
      App.toast(error.message || 'Cari hareketleri yüklenemedi.', 'error');
    }
  }

  function applyRange() {
    const start = els.stmtStart.value;
    const end = els.stmtEnd.value;
    if (start && end && start > end) {
      App.toast('Başlangıç tarihi bitiş tarihinden sonra olamaz.', 'warning');
      return;
    }
    state.allTime = false;
    loadStatement();
  }

  function bindEvents() {
    App.debounceSearch(els.dealerSearch, () => {
      state.search = els.dealerSearch.value.trim();
      loadDealers({ page: 1 });
    }, 350);

    els.dealerOnlyBalance.addEventListener('change', () => {
      state.onlyWithBalance = els.dealerOnlyBalance.checked;
      loadDealers({ page: 1 });
    });

    els.dealerPrev.addEventListener('click', () => loadDealers({ page: state.page - 1 }));
    els.dealerNext.addEventListener('click', () => loadDealers({ page: state.page + 1 }));

    const refresh = async () => {
      await loadDealers({ page: state.page, refresh: true });
      if (state.selectedCode) loadStatement();
    };
    els.dealerReload.addEventListener('click', refresh);
    els.ledgerRefresh.addEventListener('click', refresh);

    els.dealerList.addEventListener('click', (event) => {
      const item = event.target.closest('.dealer-item');
      if (!item) return;
      selectDealer(item.dataset.cari, { scroll: true });
    });

    els.stmtApply?.addEventListener('click', applyRange);
    els.stmtAll?.addEventListener('click', () => {
      state.allTime = true;
      els.stmtStart.value = '';
      if (els.stmtEnd.value === '') els.stmtEnd.value = today;
      loadStatement();
    });

    els.stmtStart?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') applyRange();
    });
    els.stmtEnd?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') applyRange();
    });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    bindEvents();
    const initialCode = new URLSearchParams(window.location.search).get('cari');
    const data = await loadDealers({ page: 1 });
    if (!canDetail) return;

    const firstCode = data?.items?.[0]?.cariKod || null;
    const target = initialCode || firstCode;
    if (target) {
      selectDealer(target, { updateUrl: false });
    } else {
      showEmpty('Cari bulunamadı', 'Arama kriterlerinizi değiştirerek tekrar deneyin.');
    }
  });
})();
