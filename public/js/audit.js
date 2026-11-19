'use strict';

(function () {
  const App = window.App;
  const els = {
    search: document.getElementById('auditSearch'),
    action: document.getElementById('auditAction'),
    user: document.getElementById('auditUser'),
    dateFrom: document.getElementById('auditDateFrom'),
    dateTo: document.getElementById('auditDateTo'),
    filter: document.getElementById('auditFilterBtn'),
    body: document.getElementById('auditBody'),
    prev: document.getElementById('auditPrev'),
    next: document.getElementById('auditNext'),
    pageInfo: document.getElementById('auditPageInfo'),
  };

  const state = { page: 1, pageSize: 50, total: 0 };

  const actionLabels = {
    'auth.login': 'Giriş',
    'auth.logout': 'Çıkış',
    'auth.login_failed': 'Başarısız giriş',
    'auth.login_inactive': 'Pasif hesap girişi',
    'auth.password_changed': 'Şifre değişti',
    'users.create': 'Kullanıcı oluşturma',
    'users.update': 'Kullanıcı güncelleme',
    'users.activate': 'Kullanıcı aktifleştirme',
    'users.deactivate': 'Kullanıcı pasifleştirme',
    'users.password_reset': 'Şifre sıfırlama',
    'users.permissions': 'Yetki değişikliği',
    'settings.update': 'Ayar değişikliği',
    'settings.test_erp': 'ERP bağlantı testi',
    'aging.refresh': 'Yaşlandırma yenileme',
    'aging.export': 'Excel indirme',
    'sms.send': 'SMS gönderimi',
    'sms.run_job': 'SMS görevi çalıştırma',
    'sms.customer_settings': 'Cari SMS ayarı',
    'sms.template_create': 'Şablon oluşturma',
    'sms.template_update': 'Şablon güncelleme',
    'sms.template_delete': 'Şablon silme',
  };

  async function load(page = state.page) {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(state.pageSize),
    });
    if (els.search.value.trim()) params.set('search', els.search.value.trim());
    if (els.action.value.trim()) params.set('action', els.action.value.trim());
    if (els.user.value.trim()) params.set('user', els.user.value.trim());
    if (els.dateFrom.value) params.set('dateFrom', els.dateFrom.value);
    if (els.dateTo.value) params.set('dateTo', els.dateTo.value);

    els.body.innerHTML = '<tr><td colspan="6" class="empty-state">Kayıtlar yükleniyor…</td></tr>';
    try {
      const data = await App.api(`/api/audit?${params.toString()}`);
      state.page = data.page;
      state.total = data.total;
      render(data.rows);
      els.pageInfo.textContent = data.total
        ? `Sayfa ${data.page} / ${Math.max(1, Math.ceil(data.total / data.pageSize))} · ${App.number(data.total)} kayıt`
        : 'Kayıt yok';
      els.prev.disabled = data.page <= 1;
      els.next.disabled = data.page >= Math.ceil(data.total / data.pageSize);
    } catch (error) {
      els.body.innerHTML = `<tr><td colspan="6" class="empty-state">${App.escapeHtml(error.message)}</td></tr>`;
      App.toast(error.message, 'error');
    }
  }

  function render(rows) {
    if (!rows.length) {
      els.body.innerHTML = '<tr><td colspan="6" class="empty-state">Kayıt bulunamadı.</td></tr>';
      return;
    }
    els.body.innerHTML = rows.map((row) => {
      const label = actionLabels[row.action] || '';
      const detail = row.detail || '';
      const entity = [row.entity_type, row.entity_id].filter(Boolean).join(' / ') || '—';
      return `
        <tr>
          <td class="nowrap">${App.formatDateTime(row.created_at)}</td>
          <td>${App.escapeHtml(row.username || '—')}</td>
          <td>
            <div class="cari-cell">
              <strong>${App.escapeHtml(label || row.action)}</strong>
              <span><code>${App.escapeHtml(row.action)}</code></span>
            </div>
          </td>
          <td class="nowrap">${App.escapeHtml(entity)}</td>
          <td class="detail-cell"><span class="detail-text" title="${App.escapeHtml(detail)}">${App.escapeHtml(detail || '—')}</span></td>
          <td class="nowrap">${App.escapeHtml(row.ip || '—')}</td>
        </tr>
      `;
    }).join('');
  }

  els.filter.addEventListener('click', () => load(1));
  els.search.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); load(1); }
  });
  els.action.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); load(1); }
  });
  els.user.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); load(1); }
  });
  els.prev.addEventListener('click', () => load(Math.max(1, state.page - 1)));
  els.next.addEventListener('click', () => load(state.page + 1));

  load(1);
})();
