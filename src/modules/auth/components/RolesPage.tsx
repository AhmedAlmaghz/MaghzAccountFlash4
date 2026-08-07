import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, Plus, Search, Pencil, Trash2, Check, Save, Lock } from 'lucide-react';
import { Card, Button, Input, Modal, Badge } from '@/core/ui/components';
import { ConfirmDialog } from '@/core/ui/components/ConfirmDialog';
import { EmptyState } from '@/core/ui/components/EmptyState';
import { Can } from '@/core/ui/components/PermissionGate';
import { useTranslation } from '@/core/i18n/useTranslation';
import { usePermission } from '../hooks/usePermission';
import { useRoles } from '../hooks/useAuth';
import { useAppStore } from '@/core/store';
import { useToastStore } from '@/core/store/toastStore';
import { PERMISSION_GROUPS } from '../types';
import type { Role, Permission } from '../types';

export const RolesPage: React.FC = () => {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const navigate = useNavigate();
  const activeCompany = useAppStore((state) => state.activeCompany);
  const canManageRoles = usePermission('settings.roles');
  const [search, setSearch] = useState('');
  const { roles, isLoading, create, update, remove } = useRoles(activeCompany?.id || '', { search });

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [confirmDialog, setConfirmDialog] = useState({
    open: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    permissions: [] as Permission[],
  });

  React.useEffect(() => {
    if (!canManageRoles) {
      navigate('/');
    }
  }, [canManageRoles, navigate]);

  const openModal = useCallback((role?: Role) => {
    if (role) {
      setEditingRole(role);
      setFormData({
        name: role.name,
        description: role.description || '',
        permissions: [...role.permissions],
      });
    } else {
      setEditingRole(null);
      setFormData({ name: '', description: '', permissions: [] });
    }
    setIsModalOpen(true);
  }, []);

  const handleSave = async () => {
    if (!activeCompany) return;

    const data = {
      companyId: activeCompany.id,
      name: formData.name,
      description: formData.description,
      permissions: formData.permissions,
      isSystem: editingRole?.isSystem ?? false,
    };

    if (editingRole) {
      await update(editingRole.id, data);
      addToast('success', t('auth.roles.updated'));
    } else {
      await create(data);
      addToast('success', t('auth.roles.created'));
    }

    setIsModalOpen(false);
    setEditingRole(null);
    setFormData({ name: '', description: '', permissions: [] });
  };

  const handleDelete = (role: Role) => {
    if (role.isSystem) return;
    setConfirmDialog({
      open: true,
      title: t('auth.roles.deleteTitle'),
      message: t('auth.roles.deleteConfirm', { name: role.name }),
      onConfirm: async () => {
        await remove(role.id);
        addToast('success', t('auth.roles.deleted'));
        setConfirmDialog((prev) => ({ ...prev, open: false }));
      },
    });
  };

  const handleClone = (role: Role) => {
    setEditingRole(null);
    setFormData({
      name: `${role.name} - ${t('auth.roles.cloneSuffix')}`,
      description: role.description || '',
      permissions: [...role.permissions],
    });
    setIsModalOpen(true);
  };

  const togglePermission = (permission: Permission) => {
    if (editingRole?.isSystem) return;
    setFormData((prev) => ({
      ...prev,
      permissions: prev.permissions.includes(permission)
        ? prev.permissions.filter((p) => p !== permission)
        : [...prev.permissions, permission],
    }));
  };

  const toggleAllModulePermissions = (modulePermissions: Permission[]) => {
    if (editingRole?.isSystem) return;
    setFormData((prev) => {
      const allSelected = modulePermissions.every((p) => prev.permissions.includes(p));
      if (allSelected) {
        return { ...prev, permissions: prev.permissions.filter((p) => !modulePermissions.includes(p as Permission)) };
      } else {
        const newPerms = [...prev.permissions];
        for (const p of modulePermissions) {
          if (!newPerms.includes(p)) newPerms.push(p);
        }
        return { ...prev, permissions: newPerms };
      }
    });
  };

  const isModuleSelected = (modulePermissions: Permission[]) => {
    return modulePermissions.every((p) => formData.permissions.includes(p));
  };

  const isModulePartial = (modulePermissions: Permission[]) => {
    const some = modulePermissions.some((p) => formData.permissions.includes(p));
    const all = modulePermissions.every((p) => formData.permissions.includes(p));
    return some && !all;
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-violet-600 rounded-xl flex items-center justify-center shadow-lg shadow-violet-600/20">
            <Shield size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">{t('auth.roles.title')}</h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm">{t('auth.roles.subtitle')}</p>
          </div>
        </div>
        <Can action="edit" module="settings">
          <Button variant="primary" leftIcon={<Plus size={16} />} onClick={() => openModal()}>
            {t('auth.roles.new')}
          </Button>
        </Can>
      </div>

      {/* Filters */}
      <div className="relative w-full sm:w-72">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('auth.roles.searchPlaceholder')}
          className="form-control pr-9 w-full"
        />
      </div>

      {/* Roles Grid */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 bg-slate-100 dark:bg-slate-800 rounded-xl animate-pulse-soft" />
          ))}
        </div>
      ) : roles.length === 0 ? (
        <EmptyState
          icon="inbox"
          title={t('auth.roles.emptyTitle')}
          description={t('auth.roles.emptyDesc')}
          action={
            <Can action="edit" module="settings">
              <Button variant="primary" leftIcon={<Plus size={16} />} onClick={() => openModal()}>
                {t('auth.roles.new')}
              </Button>
            </Can>
          }
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {roles.map((role) => (
            <Card key={role.id} className="p-5 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-slate-50">{role.name}</h3>
                  {role.description && (
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{role.description}</p>
                  )}
                </div>
                {role.isSystem && (
                  <Badge className="text-[10px] bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-400 flex items-center gap-1">
                    <Lock size={10} />
                    {t('auth.roles.system')}
                  </Badge>
                )}
              </div>

              <div className="flex flex-wrap gap-1.5 mb-4">
                {role.permissions.slice(0, 6).map((perm) => (
                  <span key={perm} className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[10px] rounded-md">
                    {perm}
                  </span>
                ))}
                {role.permissions.length > 6 && (
                  <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-[10px] rounded-md">
                    +{role.permissions.length - 6}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <Can action="edit" module="settings">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => openModal(role)}
                    className="text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-900/20"
                  >
                    <Pencil size={14} />
                    <span className="mr-1">{t('auth.roles.edit')}</span>
                  </Button>
                </Can>
                <Can action="edit" module="settings">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleClone(role)}
                    className="text-sky-600 hover:text-sky-700 hover:bg-sky-50 dark:hover:bg-sky-900/20"
                  >
                    <Plus size={14} />
                    <span className="mr-1">{t('auth.roles.clone')}</span>
                  </Button>
                </Can>
                {!role.isSystem && (
                  <Can action="delete" module="settings">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDelete(role)}
                      className="text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-900/20"
                    >
                      <Trash2 size={14} />
                      <span className="mr-1">{t('auth.roles.delete')}</span>
                    </Button>
                  </Can>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Role Modal with Permission Grid */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingRole ? t('auth.roles.edit') : t('auth.roles.new')}
        size="xl"
        className="max-w-4xl"
        footer={
          <div className="flex items-center gap-2 justify-end w-full">
            <Button variant="secondary" onClick={() => setIsModalOpen(false)}>{t('cancel')}</Button>
            <Button
              variant="primary"
              leftIcon={<Save size={16} />}
              onClick={handleSave}
              disabled={editingRole?.isSystem}
            >
              {editingRole?.isSystem ? t('auth.roles.readOnly') : t('save')}
            </Button>
          </div>
        }
      >
        <div className="space-y-6">
          {editingRole?.isSystem && (
            <div className="flex items-start gap-3 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl text-amber-800 dark:text-amber-200">
              <Lock size={16} className="mt-0.5 shrink-0" />
              <div className="text-sm">
                <p className="font-medium mb-1">{t('auth.roles.systemRole')}</p>
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  {t('auth.roles.systemRoleDesc')}
                </p>
              </div>
            </div>
          )}

          {/* Role Info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label={t('auth.roles.name')}
              value={formData.name}
              onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
              required
              disabled={editingRole?.isSystem}
            />
            <Input
              label={t('auth.roles.description')}
              value={formData.description}
              onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
              disabled={editingRole?.isSystem}
            />
          </div>

          {/* Permission Grid */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-bold text-slate-900 dark:text-slate-50">{t('auth.roles.permissionGrid')}</h4>
              <span className="text-xs text-slate-500">
                {t('auth.roles.selectedPermissions', { count: formData.permissions.length })}
              </span>
            </div>

            <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
              {/* Grid Header */}
              <div className="grid grid-cols-[180px_1fr] bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
                <div className="p-3 text-xs font-bold text-slate-700 dark:text-slate-300 border-l border-slate-200 dark:border-slate-700">
                  {t('auth.roles.moduleAction')}
                </div>
                <div className="p-3 text-xs font-bold text-slate-700 dark:text-slate-300">
                  {t('auth.roles.permissionsLabel')}
                </div>
              </div>

              {/* Grid Body */}
              <div className={`divide-y divide-slate-200 dark:divide-slate-700 max-h-[400px] overflow-y-auto ${editingRole?.isSystem ? 'opacity-60 pointer-events-none' : ''}`}>
                {PERMISSION_GROUPS.map((group) => (
                  <div key={group.module} className="grid grid-cols-[180px_1fr]">
                    <div className="p-3 bg-slate-50/50 dark:bg-slate-800/30 border-l border-slate-200 dark:border-slate-700 flex items-center gap-2">
                      <button
                        onClick={() => toggleAllModulePermissions(group.permissions.map((p) => p.key as Permission))}
                        className="flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-200 hover:text-primary-600 transition-colors"
                        disabled={editingRole?.isSystem}
                      >
                        {isModuleSelected(group.permissions.map((p) => p.key as Permission)) ? (
                          <Check size={16} className="text-emerald-600" />
                        ) : isModulePartial(group.permissions.map((p) => p.key as Permission)) ? (
                          <div className="w-4 h-4 rounded bg-primary-500" />
                        ) : (
                          <div className="w-4 h-4 rounded border-2 border-slate-300 dark:border-slate-600" />
                        )}
                        <span>{group.labelAr}</span>
                      </button>
                    </div>
                    <div className="p-3 flex flex-wrap gap-2">
                      {group.permissions.map((perm) => {
                        const isSelected = formData.permissions.includes(perm.key as Permission);
                        return (
                          <button
                            key={perm.key}
                            onClick={() => togglePermission(perm.key as Permission)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                              isSelected
                                ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400 border-primary-200 dark:border-primary-800'
                                : 'bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:border-slate-300'
                            }`}
                          >
                            <span className="flex items-center gap-1">
                              {isSelected && <Check size={12} />}
                              {perm.labelAr}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={confirmDialog.open}
        onClose={() => setConfirmDialog((prev) => ({ ...prev, open: false }))}
        onConfirm={confirmDialog.onConfirm}
        title={confirmDialog.title}
        message={confirmDialog.message}
        variant="danger"
      />
    </div>
  );
};

export default RolesPage;
