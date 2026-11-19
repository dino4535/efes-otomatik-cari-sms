'use strict';

const PERMISSIONS = [
  { key: 'aging.view', label: 'Cari yaşlandırma raporunu görüntüle', group: 'Cari Yaşlandırma' },
  { key: 'aging.detail', label: 'Müşteri fatura/tahsilat detayını görüntüle', group: 'Cari Yaşlandırma' },
  { key: 'aging.export', label: 'Raporu Excel olarak indir', group: 'Cari Yaşlandırma' },
  { key: 'stock.view', label: 'Stok durumunu görüntüle', group: 'Stok' },
  { key: 'stock.export', label: 'Stok raporunu Excel olarak indir', group: 'Stok' },
  { key: 'stock.litre', label: 'Ortak stok litre tanımlarını düzenle', group: 'Stok' },
  { key: 'finance.view', label: 'Fonlama, mevduat faizi ve tür bazlı finans bilgilerini görüntüle', group: 'Finans' },
  { key: 'sms.view', label: 'SMS loglarını ve planlanan SMS\'leri görüntüle', group: 'SMS' },
  { key: 'sms.send', label: 'Manuel SMS gönder', group: 'SMS' },
  { key: 'sms.settings', label: 'Cari bazlı SMS ayarlarını düzenle', group: 'SMS' },
  { key: 'users.view', label: 'Kullanıcıları görüntüle', group: 'Yönetim' },
  { key: 'users.manage', label: 'Kullanıcı ekle, düzenle, pasifleştir', group: 'Yönetim' },
  { key: 'settings.manage', label: 'Sistem ayarlarını yönet', group: 'Yönetim' },
  { key: 'audit.view', label: 'İşlem kayıtlarını görüntüle', group: 'Yönetim' },
];

const ROLE_DEFAULTS = {
  admin: PERMISSIONS.map((p) => p.key),
  user: ['aging.view', 'aging.detail', 'aging.export', 'stock.view', 'stock.export', 'sms.view'],
};

const ALL_PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);

module.exports = { PERMISSIONS, ROLE_DEFAULTS, ALL_PERMISSION_KEYS };
