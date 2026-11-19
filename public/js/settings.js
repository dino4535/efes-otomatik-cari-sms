'use strict';

(function () {
  const App = window.App;
  const els = {
    save: document.getElementById('saveSettingsBtn'),
    testErp: document.getElementById('testErpBtn'),
    templateModal: document.getElementById('templateModal'),
    templateForm: document.getElementById('templateForm'),
    templateId: document.getElementById('templateId'),
    templateName: document.getElementById('templateName'),
    templateBody: document.getElementById('templateBody'),
    templateActive: document.getElementById('templateActive'),
    templateCharCount: document.getElementById('templateCharCount'),
    templateError: document.getElementById('templateFormError'),
    templateTitle: document.getElementById('templateModalTitle'),
    templateBodyTable: document.getElementById('templateTableBody'),
  };

  function collectSettings() {
    const settings = {};
    document.querySelectorAll('[data-setting]').forEach((input) => {
      const key = input.dataset.setting;
      if (key === 'erp.password' && !input.value) return;
      if (input.type === 'checkbox') {
        settings[key] = input.checked ? '1' : '0';
      } else {
        settings[key] = input.value;
      }
    });
    return settings;
  }

  function collectErpConnection() {
    const connection = {};
    document.querySelectorAll('[data-setting^="erp."]').forEach((input) => {
      const key = input.dataset.setting.slice(4);
      if (key === 'password') {
        if (input.value) connection.password = input.value;
        return;
      }
      if (key === 'encrypt') {
        connection.encrypt = input.checked;
        return;
      }
      if (key === 'trust_cert') {
        connection.trustServerCertificate = input.checked;
        return;
      }
      connection[key] = input.value;
    });
    return connection;
  }

  async function saveSettings() {
    try {
      App.setBusy(els.save, true, 'Kaydediliyor…');
      const data = await App.api('/api/settings', {
        method: 'PUT',
        body: { settings: collectSettings() },
      });
      const erpChanged = data.changed.some((item) => item.key.startsWith('erp.'));
      if (erpChanged) {
        const passwordInput = document.querySelector('[data-setting="erp.password"]');
        if (passwordInput) {
          passwordInput.value = '';
          passwordInput.placeholder = 'Kayıtlı şifre kullanılıyor — değiştirmek için girin';
        }
      }
      App.toast(
        data.changed.length
          ? `${data.changed.length} ayar güncellendi.${erpChanged ? ' Yeni ERP bağlantısı bir sonraki sorguda kullanılacak.' : ''}`
          : 'Değişiklik yok.',
        'success',
      );
    } catch (error) {
      App.toast(error.message, 'error');
    } finally {
      App.setBusy(els.save, false);
    }
  }

  async function testErp() {
    try {
      App.setBusy(els.testErp, true, 'Test ediliyor…');
      const data = await App.api('/api/settings/test-erp', {
        method: 'POST',
        body: { connection: collectErpConnection() },
      });
      const label = data.serverName ? `${data.database} (${data.serverName})` : data.database;
      App.toast(`ERP bağlantısı başarılı: ${label}`, 'success', 6000);
    } catch (error) {
      App.toast(`ERP bağlantısı başarısız: ${error.message}`, 'error', 8000);
    } finally {
      App.setBusy(els.testErp, false);
    }
  }

  function updateTemplateCharCount() {
    const length = els.templateBody.value.length;
    const segments = length <= 70 ? 1 : Math.ceil(length / 67);
    els.templateCharCount.textContent = `${length} / 500 · ${segments} SMS (tahmini)`;
  }

  function openTemplate(template) {
    els.templateForm.reset();
    els.templateError.classList.add('hidden');
    els.templateError.textContent = '';
    els.templateId.value = template?.id || '';
    els.templateName.value = template?.name || '';
    els.templateBody.value = template?.body || '';
    els.templateActive.checked = template ? Boolean(template.is_active) : true;
    els.templateTitle.textContent = template ? 'Şablonu Düzenle' : 'Yeni Şablon';
    updateTemplateCharCount();
    App.openModal(els.templateModal);
    window.setTimeout(() => els.templateName.focus(), 80);
  }

  async function editTemplate(id) {
    try {
      const data = await App.api('/api/sms/templates');
      const template = data.templates.find((item) => Number(item.id) === Number(id));
      if (!template) throw new Error('Şablon bulunamadı.');
      openTemplate(template);
    } catch (error) {
      App.toast(error.message, 'error');
    }
  }

  async function saveTemplate(event) {
    event.preventDefault();
    els.templateError.classList.add('hidden');
    const id = els.templateId.value;
    const payload = {
      name: els.templateName.value.trim(),
      body: els.templateBody.value.trim(),
      isActive: els.templateActive.checked,
    };
    const button = els.templateForm.querySelector('button[type="submit"]');
    try {
      App.setBusy(button, true, 'Kaydediliyor…');
      await App.api(id ? `/api/sms/templates/${id}` : '/api/sms/templates', {
        method: id ? 'PUT' : 'POST',
        body: payload,
      });
      App.closeModal(els.templateModal);
      App.toast(id ? 'Şablon güncellendi.' : 'Şablon oluşturuldu.', 'success');
      window.setTimeout(() => window.location.reload(), 350);
    } catch (error) {
      els.templateError.textContent = error.message;
      els.templateError.classList.remove('hidden');
    } finally {
      App.setBusy(button, false);
    }
  }

  async function deleteTemplate(id) {
    const row = els.templateBodyTable.querySelector(`[data-template-row="${id}"]`);
    const name = row?.querySelector('strong')?.textContent || 'Bu şablon';
    if (!window.confirm(`"${name}" şablonu silinsin mi?`)) return;
    try {
      await App.api(`/api/sms/templates/${id}`, { method: 'DELETE' });
      App.toast('Şablon silindi.', 'success');
      window.setTimeout(() => window.location.reload(), 300);
    } catch (error) {
      App.toast(error.message, 'error');
    }
  }

  els.save.addEventListener('click', saveSettings);
  els.testErp?.addEventListener('click', testErp);
  document.getElementById('newTemplateBtn').addEventListener('click', () => openTemplate(null));
  els.templateForm.addEventListener('submit', saveTemplate);
  els.templateBody.addEventListener('input', updateTemplateCharCount);
  els.templateBodyTable.addEventListener('click', (event) => {
    const editButton = event.target.closest('[data-edit-template]');
    if (editButton) {
      editTemplate(editButton.dataset.editTemplate);
      return;
    }
    const deleteButton = event.target.closest('[data-delete-template]');
    if (deleteButton) deleteTemplate(deleteButton.dataset.deleteTemplate);
  });
})();
