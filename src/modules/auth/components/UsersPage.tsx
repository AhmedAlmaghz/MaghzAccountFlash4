import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Plus, Search, User as UserIcon, Mail, Phone, KeyRound, ToggleLeft, ToggleRight, Building2 } from 'lucide-react';
import { Card, Button, Input, Modal, Badge } from '@/core/ui/components';
import { StatusBadge } from '@/core/ui/components/StatusBadge';
import { ActionButtons } from '@/core/ui/components/ActionButtons';
import { ConfirmDialog } from '@/core/ui/components/ConfirmDialog';
import { DataTablePro } from '@/core/ui/components/DataTablePro';
import { Can } from '@/core/ui/components/PermissionGate';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useToastStore } from '@/core/store/toastStore';
import { useAuthStore } from '../store';
import { useUsers } from '../hooks/useAuth';
import { useAppStore } from '@/core/store';
import type { User } from '../types';
import type { ColumnDef } from '@tanstack/react-table';

export const UsersPage: React.FC = () => {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const navigate = useNavigate();
  const activeCompany = useAppStore((state) => state.activeCompany);
  const hasPermission = useAuthStore((state) => state.hasPermission);
  const currentUser = useAuthStore((state) => state.user);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const { users, isLoading, create, update, remove, resetPassword, toggleActive } = useUsers(activeCompany?.id || '', {
    search,
    role: roleFilter || undefined,
  });

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isResetPasswordOpen, setIsResetPasswordOpen] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; title: string; message: string; onConfirm: () => void; variant?: 'danger' | 'warning' | 'info' }>({
    open: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  const [editing, setEditing] = useState<User | null>(null);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    fullName: '',
    phone: '',
    role: 'accountant' as User['role'],
    branchId: '' as string | null,
    isActive: true,
  });
  const [newPassword, setNewPassword] = useState('');

  // Redirect if no permission
  React.useEffect(() => {
    if (!hasPermission('settings.users')) {
      navigate('/');
    }
  }, [hasPermission, navigate]);

  const openModal = useCallback((user?: User) => {
    if (user) {
      setEditing(user);
      setFormData({
        username: user.username,
        email: user.email || '',
        fullName: user.fullName || '',
        phone: user.phone || '',
        role: user.role,
        branchId: user.branchId || null,
        isActive: user.isActive,
      });
    } else {
      setEditing(null);
      setFormData({ username: '', email: '', fullName: '', phone: '', role: 'accountant', branchId: null, isActive: true });
    }
    setIsModalOpen(true);
  }, []);

  const handleSave = async () => {
    if (!activeCompany) return;

    const data = {
      companyId: activeCompany.id,
      username: formData.username,
      email: formData.email,
      fullName: formData.fullName,
      phone: formData.phone,
      role: formData.role,
      branchId: formData.branchId,
      isActive: formData.isActive,
    };

    if (editing) {
      await update(editing.id, data);
      addToast('success', t('auth.users.updated'));
    } else {
      await create(data);
      addToast('success', t('auth.users.created'));
    }

    setIsModalOpen(false);
    setEditing(null);
    setFormData({ username: '', email: '', fullName: '', phone: '', role: 'accountant', branchId: null, isActive: true });
  };

  const handleDelete = (user: User) => {
    setConfirmDialog({
      open: true,
      title: t('auth.users.deleteTitle'),
      message: t('auth.users.deleteConfirm', { name: user.username }),
      variant: 'danger',
      onConfirm: async () => {
        await remove(user.id);
        addToast('success', t('auth.users.deleted'));
        setConfirmDialog((prev) => ({ ...prev, open: false }));
      },
    });
  };

  const handleToggleActive = (user: User) => {
    const action = user.isActive ? t('auth.users.deactivateTitle') : t('auth.users.activateTitle');
    setConfirmDialog({
      open: true,
      title: action,
      message: user.isActive
        ? t('auth.users.deactivateConfirm', { name: user.username })
        : t('auth.users.activateConfirm', { name: user.username }),
      variant: 'warning',
      onConfirm: async () => {
        await toggleActive(user.id, !user.isActive);
        addToast('success', t(user.isActive ? 'auth.users.updated' : 'auth.users.updated'));
        setConfirmDialog((prev) => ({ ...prev, open: false }));
      },
    });
  };

  const handleResetPassword = async () => {
    if (!selectedUser || !newPassword) return;
    await resetPassword(selectedUser.id, newPassword);
    addToast('success', t('auth.users.updated'));
    setIsResetPasswordOpen(false);
    setNewPassword('');
    setSelectedUser(null);
  };

  const ROLE_LABELS: Record<string, string> = {
    super_admin: t('auth.users.role_super_admin'),
    admin: t('auth.users.role_admin'),
    manager: t('auth.users.role_manager'),
    accountant: t('auth.users.role_accountant'),
    sales_rep: t('auth.users.role_sales_rep'),
    viewer: t('auth.users.role_viewer'),
  };

  const columns: ColumnDef<User>[] = [
    {
      accessorKey: 'username',
      header: t('auth.users.formUsername'),
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-600 flex items-center justify-center font-bold text-xs">
            {row.original.username.charAt(0)}
          </div>
          <span className="font-medium text-slate-900 dark:text-slate-50">{row.original.username}</span>
        </div>
      ),
    },
    {
      accessorKey: 'email',
      header: t('auth.users.formEmail'),
      cell: ({ row }) => row.original.email || '-',
    },
    {
      accessorKey: 'role',
      header: t('auth.users.role'),
      cell: ({ row }) => (
        <Badge className="text-xs bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
          {ROLE_LABELS[row.original.role] || row.original.role}
        </Badge>
      ),
    },
    {
      accessorKey: 'branchName',
      header: t('auth.users.branch'),
      cell: ({ row }) => row.original.branchName || row.original.branchId || '-',
    },
    {
      accessorKey: 'isActive',
      header: t('auth.users.status'),
      cell: ({ row }) => (
        <StatusBadge status={row.original.isActive ? 'active' : 'inactive'} />
      ),
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => {
        const user = row.original;
        const isCurrentUser = currentUser?.id === user.id;
        return (
          <div className="flex items-center gap-1">
            <ActionButtons
              onView={() => { setSelectedUser(user); setIsDetailOpen(true); }}
              onEdit={() => openModal(user)}
              onDelete={() => handleDelete(user)}
              showDelete={!isCurrentUser}
              size="sm"
            />
            <Button
              size="sm"
              variant="ghost"
              onClick={() => { setSelectedUser(user); setIsResetPasswordOpen(true); }}
              title={t('auth.users.resetPassword')}
              className="text-violet-600 hover:text-violet-700 hover:bg-violet-50 dark:hover:bg-violet-900/20"
              disabled={isCurrentUser}
            >
              <KeyRound size={14} />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => handleToggleActive(user)}
              title={user.isActive ? t('auth.users.deactivateTitle') : t('auth.users.activateTitle')}
              className={user.isActive ? 'text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-900/20' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800'}
              disabled={isCurrentUser}
            >
              {user.isActive ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary-600 rounded-xl flex items-center justify-center shadow-lg shadow-primary-600/20">
            <Users size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">{t('auth.users.title')}</h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm">{t('auth.users.subtitle')}</p>
          </div>
        </div>
        <Can action="edit" module="settings">
          <Button variant="primary" leftIcon={<Plus size={16} />} onClick={() => openModal()}>
            {t('auth.users.newButton')}
          </Button>
        </Can>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="relative flex-1 w-full sm:w-auto">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث في المستخدمين..."
            className="form-control pr-9 w-full sm:w-72"
          />
        </div>
        <select
          title="تصفية حسب الدور"
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="form-control w-full sm:w-48"
        >
          <option value="">كل الأدوار</option>
          <option value="admin">أدمن</option>
          <option value="manager">مدير</option>
          <option value="accountant">محاسب</option>
          <option value="sales_rep">مندوب مبيعات</option>
          <option value="viewer">مشاهد فقط</option>
        </select>
      </div>

      {/* Table */}
      <Card className="p-0 overflow-hidden">
        <DataTablePro<User>
          data={users}
          columns={columns}
          keyExtractor={(row) => row.id}
          isLoading={isLoading}
          emptyMessage="لا يوجد مستخدمين"
          searchable={false}
          title="قائمة المستخدمين"
        />
      </Card>

      {/* Create/Edit Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editing ? 'تعديل مستخدم' : 'مستخدم جديد'}
        size="md"
        footer={
          <div className="flex items-center gap-2 justify-end w-full">
            <Button variant="secondary" onClick={() => setIsModalOpen(false)}>إلغاء</Button>
            <Button variant="primary" onClick={handleSave}>حفظ</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="اسم المستخدم"
              value={formData.username}
              onChange={(e) => setFormData((prev) => ({ ...prev, username: e.target.value }))}
              required
            />
            <Input
              label="البريد الإلكتروني"
              type="email"
              value={formData.email}
              onChange={(e) => setFormData((prev) => ({ ...prev, email: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="الاسم الكامل"
              value={formData.fullName}
              onChange={(e) => setFormData((prev) => ({ ...prev, fullName: e.target.value }))}
            />
            <Input
              label="رقم الهاتف"
              value={formData.phone}
              onChange={(e) => setFormData((prev) => ({ ...prev, phone: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5 block">الدور</label>
              <select
                title="تصفية حسب الدور"
                value={formData.role}
                onChange={(e) => setFormData((prev) => ({ ...prev, role: e.target.value as User['role'] }))}
                className="form-control w-full"
              >
                <option value="admin">أدمن</option>
                <option value="manager">مدير</option>
                <option value="accountant">محاسب</option>
                <option value="sales_rep">مندوب مبيعات</option>
                <option value="viewer">مشاهد فقط</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5 block">الفرع</label>
              <select
                value={formData.branchId || ''}
                title="تصفية حسب الفرع"
                onChange={(e) => setFormData((prev) => ({ ...prev, branchId: e.target.value || null }))}
                className="form-control w-full"
              >
                <option value="">كل الفروع</option>
                <option value="branch-1">الفرع الرئيسي - صنعاء</option>
                <option value="branch-2">فرع عدن</option>
                <option value="branch-3">فرع الحديدة</option>
              </select>
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={formData.isActive}
              onChange={(e) => setFormData((prev) => ({ ...prev, isActive: e.target.checked }))}
              className="w-4 h-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
            />
            <span className="text-sm text-slate-700 dark:text-slate-300">حساب نشط</span>
          </label>
        </div>
      </Modal>

      {/* User Details Modal */}
      <Modal
        isOpen={isDetailOpen}
        onClose={() => { setIsDetailOpen(false); setSelectedUser(null); }}
        title="تفاصيل المستخدم"
        size="md"
      >
        {selectedUser && (
          <div className="space-y-4">
            <div className="flex items-center gap-4 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl">
              <div className="w-16 h-16 rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-600 flex items-center justify-center text-xl font-bold">
                {selectedUser.username.charAt(0)}
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-slate-50">{selectedUser.username}</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400">{ROLE_LABELS[selectedUser.role] || selectedUser.role}</p>
              </div>
              <StatusBadge status={selectedUser.isActive ? 'active' : 'inactive'} className="mr-auto" />
            </div>

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                <Mail size={16} className="text-slate-400" />
                <span>{selectedUser.email || '-'}</span>
              </div>
              <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                <Phone size={16} className="text-slate-400" />
                <span>{selectedUser.phone || '-'}</span>
              </div>
              <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                <Building2 size={16} className="text-slate-400" />
                <span>الفرع: {selectedUser.branchName || selectedUser.branchId || '-'}</span>
              </div>
              <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                <UserIcon size={16} className="text-slate-400" />
                <span>الاسم الكامل: {selectedUser.fullName || '-'}</span>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-200 dark:border-slate-700">
              <p className="text-xs text-slate-400">
                تاريخ الإنشاء: {selectedUser.createdAt ? new Date(selectedUser.createdAt).toLocaleDateString('ar-YE') : '-'}
              </p>
              <p className="text-xs text-slate-400">
                آخر دخول: {selectedUser.lastLoginAt ? new Date(selectedUser.lastLoginAt).toLocaleDateString('ar-YE') : '-'}
              </p>
            </div>
          </div>
        )}
      </Modal>

      {/* Reset Password Modal */}
      <Modal
        isOpen={isResetPasswordOpen}
        onClose={() => { setIsResetPasswordOpen(false); setNewPassword(''); setSelectedUser(null); }}
        title="إعادة تعيين كلمة المرور"
        size="sm"
        footer={
          <div className="flex items-center gap-2 justify-end w-full">
            <Button variant="secondary" onClick={() => { setIsResetPasswordOpen(false); setNewPassword(''); }}>إلغاء</Button>
            <Button variant="primary" onClick={handleResetPassword} disabled={!newPassword}>تأكيد</Button>
          </div>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            سيتم إعادة تعيين كلمة المرور للمستخدم: <strong>{selectedUser?.username}</strong>
          </p>
          <Input
            label="كلمة المرور الجديدة"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoFocus
          />
        </div>
      </Modal>

      {/* Confirm Dialog */}
      <ConfirmDialog
        isOpen={confirmDialog.open}
        onClose={() => setConfirmDialog((prev) => ({ ...prev, open: false }))}
        onConfirm={confirmDialog.onConfirm}
        title={confirmDialog.title}
        message={confirmDialog.message}
        variant={confirmDialog.variant}
      />
    </div>
  );
};

export default UsersPage;
