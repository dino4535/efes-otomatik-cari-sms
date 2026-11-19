'use strict';

(function () {
  const csrfMeta = document.querySelector('meta[name="csrf-token"]');
  const csrfToken = csrfMeta ? csrfMeta.getAttribute('content') : '';

  const openModals = new Set();

  function toast(message, type = 'info', timeout = 4200) {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const element = document.createElement('div');
    element.className = `toast toast-${type}`;
    element.textContent = String(message || '');
    container.appendChild(element);
    window.setTimeout(() => {
      element.style.opacity = '0';
      element.style.transition = 'opacity 0.25s';
      window.setTimeout(() => element.remove(), 260);
    }, timeout);
  }

  async function api(url, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const headers = { Accept: 'application/json', ...(options.headers || {}) };
    if (options.body !== undefined && !(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      options.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      headers['x-csrf-token'] = csrfToken;
    }

    const response = await fetch(url, {
      ...options,
      method,
      headers,
      credentials: 'same-origin',
    });

    let payload = null;
    const text = await response.text();
    if (text) {
      try { payload = JSON.parse(text); } catch { payload = { error: text }; }
    }

    if (!response.ok || (payload && payload.ok === false)) {
      if (response.status === 401) {
        window.location.href = '/login';
      }
      if (payload && payload.code === 'PASSWORD_CHANGE_REQUIRED') {
        window.location.href = '/change-password';
      }
      const error = new Error((payload && payload.error) || `İşlem başarısız (${response.status})`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }

    return payload ? payload.data : null;
  }

  function money(value, withSymbol = false) {
    const number = Number(value || 0);
    const formatted = number.toLocaleString('tr-TR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return withSymbol ? `${formatted} ₺` : formatted;
  }

  function number(value) {
    return Number(value || 0).toLocaleString('tr-TR');
  }

  function formatDate(value) {
    if (!value) return '—';
    const text = String(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      const [year, month, day] = text.split('-');
      return `${day}.${month}.${year}`;
    }
    const date = new Date(text);
    if (Number.isNaN(date.getTime())) return text;
    return new Intl.DateTimeFormat('tr-TR', {
      timeZone: 'Europe/Istanbul',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(date);
  }

  function formatDateTime(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat('tr-TR', {
      timeZone: 'Europe/Istanbul',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }

  function toDateTimeLocal(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function debounce(fn, wait = 250) {
    let timer = null;
    return function debounced(...args) {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => fn.apply(this, args), wait);
    };
  }

  function openModal(target) {
    const modal = typeof target === 'string'
      ? document.getElementById(target)
      : target;
    if (!modal) return null;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    openModals.add(modal);
    document.body.style.overflow = 'hidden';
    const focusable = modal.querySelector('input:not([type="hidden"]), select, textarea, button');
    if (focusable) window.setTimeout(() => focusable.focus(), 60);
    return modal;
  }

  function closeModal(target) {
    const modal = typeof target === 'string'
      ? document.getElementById(target)
      : target?.closest?.('.modal') || target;
    if (!modal) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    openModals.delete(modal);
    if (!openModals.size) document.body.style.overflow = '';
  }

  function closeAllModals() {
    for (const modal of [...openModals]) closeModal(modal);
  }

  function setBusy(button, busy, busyText = 'İşleniyor…') {
    if (!button) return;
    if (busy) {
      button.dataset.originalText = button.textContent;
      button.disabled = true;
      button.textContent = busyText;
    } else {
      button.disabled = false;
      if (button.dataset.originalText) {
        button.textContent = button.dataset.originalText;
        delete button.dataset.originalText;
      }
    }
  }

  function debounceSearch(input, callback, wait = 300) {
    if (!input) return;
    input.addEventListener('input', debounce(callback, wait));
  }

  window.App = {
    csrfToken,
    api,
    money,
    number,
    formatDate,
    formatDateTime,
    toDateTimeLocal,
    escapeHtml,
    debounce,
    debounceSearch,
    toast,
    openModal,
    closeModal,
    closeAllModals,
    setBusy,
  };

  document.addEventListener('DOMContentLoaded', () => {
    const serverDate = document.getElementById('serverDate');
    if (serverDate) {
      serverDate.textContent = new Intl.DateTimeFormat('tr-TR', {
        timeZone: 'Europe/Istanbul',
        day: '2-digit',
        month: 'long',
        year: 'numeric',
        weekday: 'short',
      }).format(new Date());
    }

    const launcherToggle = document.getElementById('launcherToggle');
    const launcher = document.getElementById('appLauncher');
    let launcherOpen = false;

    const setLauncher = (open, focusFirst = false) => {
      if (!launcherToggle || !launcher) return;
      launcherOpen = open;
      launcherToggle.classList.toggle('is-open', open);
      launcherToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      launcher.classList.toggle('open', open);
      launcher.setAttribute('aria-hidden', open ? 'false' : 'true');
      document.body.classList.toggle('launcher-open', open);
      if (open && focusFirst) {
        window.setTimeout(() => launcher.querySelector('.launcher-item')?.focus(), 90);
      }
    };

    if (launcherToggle && launcher) {
      launcherToggle.addEventListener('click', (event) => {
        event.stopPropagation();
        setLauncher(!launcherOpen);
      });

      document.addEventListener('click', (event) => {
        if (!launcherOpen) return;
        if (launcher.contains(event.target) || launcherToggle.contains(event.target)) return;
        setLauncher(false);
      });

      launcher.querySelectorAll('.launcher-item').forEach((item) => {
        item.addEventListener('click', () => setLauncher(false));
      });
    }

    document.querySelectorAll('[data-dismiss-alert]').forEach((button) => {
      button.addEventListener('click', () => button.closest('.alert')?.remove());
    });

    document.addEventListener('click', (event) => {
      const closeTrigger = event.target.closest('[data-close-modal]');
      if (closeTrigger) {
        event.preventDefault();
        closeModal(closeTrigger);
        return;
      }

      const tabButton = event.target.closest('[data-tabs] .tab');
      if (tabButton) {
        const tabs = tabButton.closest('[data-tabs]');
        const container = tabs.parentElement;
        tabs.querySelectorAll('.tab').forEach((tab) => tab.classList.remove('active'));
        tabButton.classList.add('active');
        const name = tabButton.dataset.tab;
        container.querySelectorAll('[data-panel]').forEach((panel) => {
          panel.classList.toggle('hidden', panel.dataset.panel !== name);
        });
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.altKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 'u') {
        if (launcherToggle && launcher) {
          event.preventDefault();
          setLauncher(!launcherOpen, true);
        }
        return;
      }

      if (event.key !== 'Escape') return;

      if (launcherOpen) {
        setLauncher(false);
        launcherToggle?.focus();
        return;
      }

      if (openModals.size) {
        const last = [...openModals].pop();
        closeModal(last);
      }
    });
  });
})();
