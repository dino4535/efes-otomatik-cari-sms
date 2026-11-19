'use strict';

(function () {
  const App = window.App;
  const canManage = Boolean(document.getElementById('newUserBtn'));
  const pageInfo = document.querySelector('[data-current-role]');
  const currentRole = pageInfo?.dataset.currentRole || 'user';
  const currentUserId = pageInfo?.dataset.currentUserId || '';
  const els = {
    body: document.getElementById('usersBody'),
    search: document.getElementById('userSearch'),
    count: document.getElementById('userCount'),
    modal: document.getElementById('userModal'),
    form: document.getElementById('userForm'),
    formError: document.getElementById('userFormError'),
    userId: document.getElementById('userId'),
    username: document.getElementById('userUsername'),
    fullName: document.getElementById('userFullName'),
    role: document.getElementById('userRole'),
    erpDatabase: document.getElementById('userErpDatabase'),
    branch: document.getElementById('userBranch'),
    password: document.getElementById('userPassword'),
    passwordField: document.getElementById('passwordField'),
    permissionsSection: document.getElementById('permissionsSection'),
    saveBtn: document.getElementById('userSaveBtn'),
    modalTitle: document.getElementById('userModalTitle'),
    passwordModal: document.getElementById('passwordModal'),
    passwordForm: document.getElementById('passwordForm'),
    passwordError: document.getElementById('passwordFormError'),
    passwordUserId: document.getElementById('passwordUserId'),
    passwordValue: document.getElementById('passwordValue'),
    passwordMeta: document.getElementById('passwordModalMeta'),
  };

  const state = {
    users: [],
    search: '',
    editing: null,
    createDefaults: [],
    permSnapshot: null,
    defaultErpDatabase: pageInfo?.dataset.defaultErpDatabase || '',
    defaultBranch: pageInfo?.dataset.defaultBranch || '',
  };

  function roleBadge(role) {
    return role === 'admin'
      ? '<span class="badge badge-warning">Yönetici</span>'
      : '<span class="badge badge-muted">Kullanıcı</span>';
  }

  function activeBadge(active) {
    return active
      ? '<span class="badge badge-success">Aktif</span>'
      : '<span class="badge badge-danger">Pasif</span>';
  }

  function filteredUsers() {
    const needle = state.search.toLocaleLowerCase('tr');
    if (!needle) return state.users;
    return state.users.filter((user) =>
      [user.username, user.fullName].join(' ').toLocaleLowerCase('tr').includes(needle));
  }

  function render() {
    const users = filteredUsers();
    els.count.textContent = `${users.length} kullanıcı`;
    if (!users.length) {
      els.body.innerHTML = '<tr><td colspan="7" class="empty-state">Kullanıcı bulunamadı.</td></tr>';
      return;
    }

    els.body.innerHTML = users.map((user) => {
      const isSelf = currentUserId ? Number(currentUserId) === Number(user.id) : false;
      const canTouch = canManage && (currentRole === 'admin' || user.role !== 'admin');
      const scopeLabel = user.erpDatabase
        ? `${App.escapeHtml(user.erpDatabase)} · Şube ${App.escapeHtml(String(user.branch ?? '—'))}`
        : '<span class="muted">Varsayılan</span>';
      const actions = canTouch
        ? `
          <button type="button" class="btn btn-ghost btn-xs" data-edit="${user.id}">Düzenle</button>
          <button type="button" class="btn btn-ghost btn-xs" data-password="${user.id}">Şifre</button>
          <button type="button" class="btn ${user.isActive ? 'btn-danger-ghost' : 'btn-ghost'} btn-xs" data-active="${user.id}" data-next="${user.isActive ? '0' : '1'}" ${isSelf ? 'disabled title="Kendi hesabınız"' : ''}>
            ${user.isActive ? 'Pasifleştir' : 'Aktifleştir'}
          </button>
        `
        : '<span class="muted">—</span>';

      return `
        <tr>
          <td>
            <div class="cari-cell">
              <strong>${App.escapeHtml(user.username)}</strong>
              <span>${App.escapeHtml(user.fullName || '—')}</span>
            </div>
          </td>
          <td>${roleBadge(user.role)}</td>
          <td>${scopeLabel}</td>
          <td>${activeBadge(user.isActive)}${user.mustChangePassword ? ' <span class="badge badge-warning">Şifre bekliyor</span>' : ''}</td>
          <td>${user.lastLoginAt ? App.formatDateTime(user.lastLoginAt) : '<span class="muted">Hiç giriş yapmadı</span>'}</td>
          <td>${App.formatDate(user.createdAt)}</td>
          <td class="actions-cell">${actions}</td>
        </tr>
      `;
    }).join('');
  }

  async function loadUsers() {
    try {
      const data = await App.api('/api/users');
      state.users = data.users;
      render();
    } catch (error) {
      els.body.innerHTML = `<tr><td colspan="7" class="empty-state">${App.escapeHtml(error.message)}</td></tr>`;
      App.toast(error.message, 'error');
    }
  }

  function setCheckedPermissions(selected) {
    const set = new Set(selected || []);
    els.permissionsSection.querySelectorAll('input[data-permission]').forEach((input) => {
      input.checked = set.has(input.dataset.permission);
    });
  }

  function currentPermissions() {
    return [...els.permissionsSection.querySelectorAll('input[data-permission]:checked')]
      .map((input) => input.dataset.permission);
  }

  function setPermissionInputsDisabled(disabled) {
    els.permissionsSection.querySelectorAll('input[data-permission]').forEach((input) => {
      input.disabled = disabled;
    });
    els.permissionsSection.classList.toggle('muted', disabled);
  }

  function syncRoleUi() {
    const isAdmin = els.role.value === 'admin';
    if (isAdmin) {
      if (!state.permSnapshot) state.permSnapshot = currentPermissions();
      els.permissionsSection.querySelectorAll('input[data-permission]').forEach((input) => { input.checked = true; });
      setPermissionInputsDisabled(true);
    } else {
      setCheckedPermissions(state.permSnapshot || state.createDefaults);
      state.permSnapshot = null;
      setPermissionInputsDisabled(false);
    }
  }

  function openCreate() {
    state.editing = null;
    state.permSnapshot = null;
    els.form.reset();
    els.userId.value = '';
    els.modalTitle.textContent = 'Yeni Kullanıcı';
    els.username.disabled = false;
    els.passwordField.classList.remove('hidden');
    els.password.required = true;
    els.role.value = 'user';
    if (els.erpDatabase) els.erpDatabase.value = state.defaultErpDatabase;
    if (els.branch) els.branch.value = state.defaultBranch;
    setCheckedPermissions(state.createDefaults);
    setPermissionInputsDisabled(false);
    els.formError.classList.add('hidden');
    els.formError.textContent = '';
    App.openModal(els.modal);
  }

  function openEdit(user) {
    state.editing = user;
    state.permSnapshot = null;
    els.form.reset();
    els.formError.classList.add('hidden');
    els.formError.textContent = '';
    els.modalTitle.textContent = 'Kullanıcı Düzenle';
    els.userId.value = user.id;
    els.username.value = user.username;
    els.username.disabled = true;
    els.fullName.value = user.fullName || '';
    els.role.value = user.role;
    if (els.erpDatabase) els.erpDatabase.value = user.erpDatabase || '';
    if (els.branch) els.branch.value = user.branch ?? '';
    els.passwordField.classList.add('hidden');
    els.password.required = false;
    els.password.value = '';

    const selected = (user.permissions || []).filter((permission) => permission.allowed).map((permission) => permission.key);
    if (user.role === 'admin') {
      els.permissionsSection.querySelectorAll('input[data-permission]').forEach((input) => { input.checked = true; });
      setPermissionInputsDisabled(true);
      state.permSnapshot = state.createDefaults;
    } else {
      setCheckedPermissions(selected);
      setPermissionInputsDisabled(false);
    }
    App.openModal(els.modal);
  }

  async function saveUser(event) {
    event.preventDefault();
    els.formError.classList.add('hidden');
    const isEdit = Boolean(state.editing);
    const payload = {
      username: els.username.value.trim(),
      fullName: els.fullName.value.trim(),
      role: els.role.value,
      permissions: els.role.value === 'user' ? currentPermissions() : [],
    };
    if (els.erpDatabase) payload.erpDatabase = els.erpDatabase.value.trim();
    if (els.branch) payload.branch = Number(els.branch.value);
    if (!isEdit) payload.password = els.password.value;

    try {
      App.setBusy(els.saveBtn, true, 'Kaydediliyor…');
      if (isEdit) {
        await App.api(`/api/users/${state.editing.id}`, { method: 'PUT', body: payload });
        if (payload.role === 'user') {
          await App.api(`/api/users/${state.editing.id}/permissions`, {
            method: 'PUT',
            body: { permissions: payload.permissions },
          });
        }
        App.toast('Kullanıcı güncellendi.', 'success');
      } else {
        await App.api('/api/users', { method: 'POST', body: payload });
        App.toast('Kullanıcı oluşturuldu. İlk girişte şifresini değiştirmek zorunda.', 'success');
      }
      App.closeModal(els.modal);
      await loadUsers();
    } catch (error) {
      els.formError.textContent = error.message;
      els.formError.classList.remove('hidden');
    } finally {
      App.setBusy(els.saveBtn, false);
    }
  }

  function openPassword(user) {
    state.editing = user;
    els.passwordForm.reset();
    els.passwordError.classList.add('hidden');
    els.passwordUserId.value = user.id;
    els.passwordMeta.textContent = `${user.username} · ${user.fullName || '—'}`;
    App.openModal(els.passwordModal);
  }

  async function savePassword(event) {
    event.preventDefault();
    els.passwordError.classList.add('hidden');
    const button = els.passwordForm.querySelector('button[type="submit"]');
    try {
      App.setBusy(button, true, 'Kaydediliyor…');
      await App.api(`/api/users/${els.passwordUserId.value}/password`, {
        method: 'POST',
        body: { password: els.passwordValue.value },
      });
      App.closeModal(els.passwordModal);
      App.toast('Şifre sıfırlandı. Kullanıcı sonraki girişte değiştirmek zorunda.', 'success');
      await loadUsers();
    } catch (error) {
      els.passwordError.textContent = error.message;
      els.passwordError.classList.remove('hidden');
    } finally {
      App.setBusy(button, false);
    }
  }

  async function toggleActive(user, nextActive) {
    const verb = nextActive ? 'aktifleştirilsin' : 'pasifleştirilsin';
    if (!window.confirm(`${user.username} hesabı ${verb} mi?`)) return;
    try {
      await App.api(`/api/users/${user.id}/active`, {
        method: 'POST',
        body: { isActive: nextActive },
      });
      App.toast(nextActive ? 'Kullanıcı aktifleştirildi.' : 'Kullanıcı pasifleştirildi.', 'success');
      await loadUsers();
    } catch (error) {
      App.toast(error.message, 'error');
    }
  }

  function bindEvents() {
    document.getElementById('newUserBtn')?.addEventListener('click', openCreate);

    els.search.addEventListener('input', App.debounce(() => {
      state.search = els.search.value.trim();
      render();
    }, 200));

    els.body.addEventListener('click', (event) => {
      const editButton = event.target.closest('[data-edit]');
      if (editButton) {
        const user = state.users.find((item) => Number(item.id) === Number(editButton.dataset.edit));
        if (user) openEdit(user);
        return;
      }
      const passwordButton = event.target.closest('[data-password]');
      if (passwordButton) {
        const user = state.users.find((item) => Number(item.id) === Number(passwordButton.dataset.password));
        if (user) openPassword(user);
        return;
      }
      const activeButton = event.target.closest('[data-active]');
      if (activeButton) {
        const user = state.users.find((item) => Number(item.id) === Number(activeButton.dataset.active));
        if (user) toggleActive(user, activeButton.dataset.next === '1');
      }
    });

    els.role.addEventListener('change', syncRoleUi);
    els.form.addEventListener('submit', saveUser);
    els.passwordForm.addEventListener('submit', savePassword);
  }

  state.createDefaults = [...document.querySelectorAll('#permissionsSection input[data-permission]:checked')]
    .map((input) => input.dataset.permission);

  bindEvents();
  loadUsers();
})();
