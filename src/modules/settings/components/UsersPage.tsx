import React, { useState, useEffect } from 'react';
import { Users, Plus, Pencil, Trash2, Save, KeyRound } from 'lucide-react';
import { Card, Button, Input, Table, ConfirmDialog, Modal, PageHeader } from '@/core/ui/components';
import { useAppStore } from '@/core/store';
import { useAuthStore } from '@/modules/auth/store';
import { authApi } from '@/modules/auth/api';
import { logAudit } from '@/core/utils/auditLogger';
import { Can } from '@/core/ui/components/PermissionGate';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useToastStore } from '@/core/store/toastStore';

interface User {
  id: string;
  username: string;
  email?: string;
  role: string;
  branchId?: string | null;
  isActive: boolean;
  lastLoginAt?: string;
}

export const UsersPage: React.FC = () => {
  const activeCompany = useAppStore((state) => state.activeCompany);
  const currentUser = useAuthStore((state) => state.user);
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [showResetPassword, setShowResetPassword] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [formData, setFormData] = useState<Partial<User>>({ username: '', email: '', role: 'accountant', isActive: true });

  const loadData = async () => {
    if (!activeCompany?.id) return;
    setIsLoading(true);
    try {
      const result = await authApi.getUsers(activeCompany.id);
      if (result.success && result.data) setUsers(result.data);
    } catch {
      // Error handled by caller
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { loadData(); }, [activeCompany?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    if (!activeCompany?.id || !formData.username) {
      addToast('error', t('settings.users.usernameRequired'));
      return;
    }
    if (!editingId && !newPassword) {
      addToast('error', t('settings.users.passwordRequired'));
      return;
    }
    setIsSaving(true);
    try {
      if (editingId) {
        const result = await authApi.updateUser(activeCompany.id, editingId, formData);
        if (!result.success) throw new Error(result.error);
        addToast('success', t('settings.users.updated'));
      } else {
        const result = await authApi.createUser({
          companyId: activeCompany.id,
          username: formData.username,
          email: formData.email,
          fullName: formData.username,
          role: formData.role,
          isActive: formData.isActive,
          password: newPassword,
        } as Parameters<typeof authApi.createUser>[0]);
        if (!result.success) throw new Error(result.error);
        addToast('success', t('settings.users.created'));
      }

      await logAudit({
        userId: currentUser?.id || 'system',
        username: currentUser?.username,
        action: editingId ? 'update' : 'create',
        tableName: 'users',
        recordId: editingId || 'new',
        recordLabel: formData.username,
        companyId: activeCompany.id,
      });
      setEditingId(null); setNewPassword(''); setFormData({ username: '', email: '', role: 'accountant', isActive: true }); loadData();
    } catch {
      addToast('error', t('settings.users.saveError'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!activeCompany?.id) return;
    if (id === currentUser?.id) {
      addToast('error', t('settings.users.cannotDeleteSelf'));
      return;
    }
    setIsSaving(true);
    try {
      const result = await authApi.deleteUser(activeCompany.id, id);
      if (!result.success) throw new Error(result.error);
      await logAudit({
        userId: currentUser?.id || 'system',
        username: currentUser?.username,
        action: 'delete',
        tableName: 'users',
        recordId: id,
        companyId: activeCompany.id,
      });
      addToast('success', t('settings.users.deleted'));
      setShowDeleteConfirm(null); loadData();
    } catch {
      addToast('error', t('settings.users.deleteError'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetPassword = async () => {
    if (!showResetPassword || !newPassword) {
      addToast('error', t('settings.users.passwordRequired'));
      return;
    }
    if (newPassword.length < 6) {
      addToast('error', t('settings.users.passwordTooShort'));
      return;
    }
    if (newPassword === '123456') {
      addToast('error', t('settings.users.passwordInsecure'));
      return;
    }
    const hasLetter = /[A-Za-z\u0600-\u06FF]/.test(newPassword);
    const hasNumber = /[0-9]/.test(newPassword);
    if (!hasLetter || !hasNumber) {
      addToast('error', t('settings.users.passwordWeak'));
      return;
    }
    setIsSaving(true);
    try {
      const result = await authApi.resetPassword(activeCompany!.id, showResetPassword, newPassword);
      if (!result.success) throw new Error(result.error);
      await logAudit({
        userId: currentUser?.id || 'system',
        username: currentUser?.username,
        action: 'reset_password',
        tableName: 'users',
        recordId: showResetPassword,
        companyId: activeCompany!.id,
      });
      addToast('success', t('settings.users.passwordReset'));
      setShowResetPassword(null); setNewPassword('');
    } catch {
      addToast('error', t('settings.users.saveError'));
    } finally {
      setIsSaving(false);
    }
  };

  const roleLabels: Record<string, string> = {
    admin: t('settings.users.admin'),
    manager: t('settings.users.manager'),
    accountant: t('settings.users.accountant'),
    sales_rep: t('settings.users.salesRep'),
    hr_admin: t('settings.users.hrAdmin'),
    viewer: t('settings.users.viewer'),
  };

  const columns = [
    { key: 'username', header: t('settings.users.username'), mobile: 'title' as const },
    { key: 'email', header: t('settings.users.email'), mobile: 'subtitle' as const, render: (row: User) => row.email || '-' },
    { key: 'role', header: t('settings.users.role'), mobile: 'hidden' as const, render: (row: User) => roleLabels[row.role] || row.role },
    { key: 'isActive', header: t('settings.users.status'), mobile: 'status' as const, render: (row: User) => (
      <span className={row.isActive ? 'badge-posted' : 'badge-draft'}>{row.isActive ? t('settings.common.active') : t('settings.common.disabled')}</span>
    )},
    { key: 'actions', header: '', mobile: 'actions' as const, render: (row: User) => (
      <div className="flex items-center gap-1">
        <Can action="edit" module="settings">
          <Button size="sm" variant="ghost" onClick={() => setShowResetPassword(row.id)} title={t('settings.users.changePassword')}>
            <KeyRound size={14} className="text-blue-600" />
          </Button>
        </Can>
        <Can action="edit" module="settings">
          <Button size="sm" variant="ghost" onClick={() => { setEditingId(row.id); setFormData(row); }}>
            <Pencil size={14} className="text-amber-600" />
          </Button>
        </Can>
        {row.id !== currentUser?.id && (
          <Can action="delete" module="settings">
            <Button size="sm" variant="ghost" onClick={() => setShowDeleteConfirm(row.id)}>
              <Trash2 size={14} className="text-rose-600" />
            </Button>
          </Can>
        )}
      </div>
    )},
  ];

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        title={t('settings.users.title')}
        subtitle={t('settings.users.subtitle')}
        icon={<Users size={22} />}
        actions={
          <Can action="create" module="settings">
            <Button variant="primary" leftIcon={<Plus size={16} />} onClick={() => { setEditingId(null); setFormData({ username: '', email: '', role: 'accountant', isActive: true }); }}>
              {t('settings.users.newUser')}
            </Button>
          </Can>
        }
      />

      <Card>
        {(editingId !== null || (formData.username && formData.username.length > 0)) && (
          <div className="mb-4 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Input label={`${t('settings.users.username')} *`} value={formData.username || ''} onChange={e => setFormData(p => ({ ...p, username: e.target.value }))} />
              <Input label={t('settings.users.email')} type="email" value={formData.email || ''} onChange={e => setFormData(p => ({ ...p, email: e.target.value }))} />
              {!editingId && <Input label={t('settings.users.newPassword')} type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} />}
              <div>
                <label className="form-label block mb-1.5">{t('settings.users.role')}</label>
                <select value={formData.role || 'accountant'} onChange={e => setFormData(p => ({ ...p, role: e.target.value }))} className="form-control">
                  {Object.entries(roleLabels).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-3 flex items-center gap-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.isActive ?? true}
                    onChange={e => setFormData(p => ({ ...p, isActive: e.target.checked }))}
                    className="w-4 h-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                  />
                  <span className="text-sm text-slate-700 dark:text-slate-200">{t('settings.common.active')}</span>
                </label>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => { setEditingId(null); setFormData({ username: '', email: '', role: 'accountant', isActive: true }); }}>{t('settings.common.cancel')}</Button>
              <Button variant="primary" leftIcon={<Save size={16} />} onClick={handleSave} isLoading={isSaving}>{t('settings.common.save')}</Button>
            </div>
          </div>
        )}

        <Table<User>
          data={users}
          columns={columns}
          keyExtractor={(row) => row.id}
          isLoading={isLoading}
          emptyMessage={t('settings.users.emptyMessage')}
        />
      </Card>

      <ConfirmDialog isOpen={!!showDeleteConfirm} onClose={() => setShowDeleteConfirm(null)} onConfirm={() => showDeleteConfirm && handleDelete(showDeleteConfirm)} title={t('settings.users.deleteTitle')} message={t('settings.users.deleteMessage')} confirmText={t('settings.users.deleteConfirm')} variant="danger" />

      <Modal isOpen={!!showResetPassword} onClose={() => setShowResetPassword(null)} title={t('settings.users.resetPassword')} size="sm" footer={<><Button variant="secondary" onClick={() => setShowResetPassword(null)}>{t('settings.common.cancel')}</Button><Button variant="primary" onClick={handleResetPassword}>{t('settings.common.save')}</Button></>}>
        <Input label={t('settings.users.newPassword')} type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} />
      </Modal>
    </div>
  );
};

export default UsersPage;
