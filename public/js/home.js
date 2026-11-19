'use strict';

(function () {
  const el = (id) => document.getElementById(id);

  function istanbulParts() {
    const parts = new Intl.DateTimeFormat('tr-TR', {
      timeZone: 'Europe/Istanbul',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date());
    const hour = Number(parts.find((part) => part.type === 'hour')?.value || 0);
    const minute = parts.find((part) => part.type === 'minute')?.value || '00';
    return { hour, minute };
  }

  function updateClock() {
    const clock = el('homeClock');
    const date = el('homeDate');
    if (!clock && !date) return;

    const { hour, minute } = istanbulParts();
    if (clock) {
      clock.textContent = `${String(hour).padStart(2, '0')}:${minute}`;
    }
    if (date) {
      date.textContent = new Intl.DateTimeFormat('tr-TR', {
        timeZone: 'Europe/Istanbul',
        day: '2-digit',
        month: 'long',
        year: 'numeric',
        weekday: 'long',
      }).format(new Date());
    }

    const greeting = el('homeGreeting');
    if (greeting) {
      const name = greeting.dataset.name || '';
      let prefix = 'İyi akşamlar';
      if (hour < 6) prefix = 'İyi geceler';
      else if (hour < 12) prefix = 'Günaydın';
      else if (hour < 18) prefix = 'İyi günler';
      greeting.textContent = name ? `${prefix}, ${name}` : prefix;
    }
  }

  function setText(id, text) {
    const node = el(id);
    if (node) node.textContent = text;
  }

  async function loadAging() {
    if (!el('homeTotalDebt')) return;
    try {
      const data = await App.api('/api/aging');
      const summary = data.summary || {};
      setText('homeTotalDebt', App.money(summary.totalDebt, true));
      setText('homeTotalDebtSub', `${App.number(summary.debtorCount)} caride açık bakiye`);
      setText('homeOverdue', App.money(summary.overdue30, true));
      setText('homeOverdueSub', `${App.number(summary.overdueCustomerCount)} cari 30+ gecikmede`);
      setText('homeDebtors', App.number(summary.debtorCount));
      setText('homeDebtorsSub', `Kontrol toplamı ${App.money(summary.controlTotal, true)}`);
    } catch (error) {
      setText('homeTotalDebt', '—');
      setText('homeTotalDebtSub', 'Veriler alınamadı');
      setText('homeOverdue', '—');
      setText('homeOverdueSub', error.message || 'Veriler alınamadı');
      setText('homeDebtors', '—');
      setText('homeDebtorsSub', 'Veriler alınamadı');
    }
  }

  async function loadSms() {
    if (!el('homeSmsToday')) return;
    try {
      const data = await App.api('/api/sms/stats');
      const byStatus = data.today?.byStatus || {};
      const success = (byStatus.sent || 0) + (byStatus.simulated || 0) + (byStatus.delivered || 0);
      const failed = byStatus.failed || 0;
      setText('homeSmsToday', App.number(data.today?.total || 0));
      setText('homeSmsSub', `${App.number(success)} başarılı · ${App.number(failed)} başarısız`);
    } catch (error) {
      setText('homeSmsToday', '—');
      setText('homeSmsSub', 'Veriler alınamadı');
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    updateClock();
    window.setInterval(updateClock, 30000);
    loadAging();
    loadSms();
  });
})();
