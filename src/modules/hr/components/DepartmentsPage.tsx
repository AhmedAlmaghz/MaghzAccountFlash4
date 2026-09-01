import React, { useState } from 'react';
import { Plus, Building2, Users, Pencil, XCircle } from 'lucide-react';
import { Card, Button, Input, Modal, Table, Can } from '@/core/ui/components';
import { ConfirmDialog } from '@/core/ui/components/ConfirmDialog';
import { EmptyState } from '@/core/ui/components/EmptyState';
import { UserSelect } from '@/core/ui/components/smart';
import { useAppStore } from '@/core/store';
import { useDepartmentsCrud } from '../hooks/useHr';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useToastStore } from '@/core/store/toastStore';
import type { Department } from '../types';

export const DepartmentsPage: React.FC = () => {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const activeCompany = useAppStore((state) => state.activeCompany);
  const companyId = activeCompany?.id || '';
  const { items: departments, isLoading, create, update, remove } = useDepartmentsCrud(companyId);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [formData, setFormData] = useState<{ name: string; managerId: string }>({ name: '', managerId: '' });

  const resetForm = () => {
    setFormData({ name: '', managerId: '' });
    setEditing(null);
  };

  const openCreate = () => {
    setEditing(null);
    setFormData({ name: '', managerId: '' });
    setIsModalOpen(true);
  };

  const openEdit = (row: Department) => {
    setEditing(row);
    setFormData({ name: row.name, managerId: row.managerId || '' });
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      addToast('error', t('hr.departments.name') + ' ' + t('hr.departments.required'));
      return;
    }
    const res = editing
      ? await update(editing.id, { name: formData.name.trim(), managerId: formData.managerId || null })
      : await create({ companyId, name: formData.name.trim(), managerId: formData.managerId || undefined });
    if (res.success) {
      addToast('success', t(editing ? 'hr.departments.updated' : 'hr.departments.created'));
      setIsModalOpen(false);
      resetForm();
    } else {
      addToast('error', res.error || t('common.error'));
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    const res = await remove(confirmDelete);
    if (res.success) {
      addToast('success', t('hr.departments.deleted'));
    } else {
      // Guard error from the API (linked employees) surfaces here.
      addToast('error', res.error || t('common.error'));
    }
    setConfirmDelete(null);
  };

  const columns = [
    { key: 'name', header: t('hr.departments.table.name') },
    { key: 'managerName', header: t('hr.departments.table.manager'), render: (row: Department) => row.managerName || '—' },
    { key: 'employeeCount', header: t('hr.departments.table.employeeCount'), width: '120px', render: (row: Department) => (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-xs font-bold tabular-nums text-slate-700 dark:text-slate-300">
        <Users size={12} /> {row.employeeCount}
      </span>
    )},
    { key: 'actions', header: '', width: '120px', render: (row: Department) => (
      <div className="flex items-center gap-1">
        <Can action="edit" module="hr">
          <Button variant="ghost" size="sm" onClick={() => openEdit(row)} title={t('hr.departments.edit')}>
            <Pencil size={16} className="text-amber-600" />
          </Button>
        </Can>
        <Can action="delete" module="hr">
          <Button variant="ghost" size="sm" className="text-rose-600" onClick={() => setConfirmDelete(row.id)} title={t('hr.departments.delete')}>
            <XCircle size={16} />
          </Button>
        </Can>
      </div>
    )},
  ];

  const totalEmployees = departments.reduce((sum, d) => sum + d.employeeCount, 0);

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Gradient Header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-700 via-indigo-600 to-slate-700 shadow-xl shadow-indigo-900/10 dark:shadow-indigo-900/20">
        <div className="absolute top-0 right-0 w-48 h-48 opacity-15 bg-white rounded-full -translate-y-1/3 translate-x-1/4" />
        <div className="absolute bottom-0 left-0 w-24 h-24 opacity-10 bg-white rounded-full translate-y-1/3 -translate-x-1/4" />
        <div className="relative px-6 py-10 sm:px-8 sm:py-12 text-white">
          <div className="flex items-center gap-3 mb-3">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium tracking-wide text-indigo-100 bg-white/10 px-2.5 py-1 rounded-full backdrop-blur-sm border border-white/10">
              <Building2 size={12} /> {t('hr.departments.title')}
            </span>
          </div>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-3xl font-extrabold tracking-tight mb-2">{t('hr.departments.title')}</h2>
              <p className="text-indigo-100/80 text-base max-w-lg">{t('hr.departments.subtitle')}</p>
            </div>
            <Can action="create" module="hr">
              <Button variant="secondary" leftIcon={<Plus size={16} />} onClick={openCreate} className="bg-white/10 hover:bg-white/20 text-white border-white/20 shrink-0">{t('hr.departments.new')}</Button>
            </Can>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: t('hr.departments.totalDepartments'), value: String(departments.length), icon: Building2, color: 'from-indigo-600 to-indigo-700', bg: 'bg-gradient-to-br from-indigo-50 to-indigo-100 dark:from-indigo-900/10 dark:to-indigo-800/5' },
          { label: t('hr.departments.linkedEmployees'), value: String(totalEmployees), icon: Users, color: 'from-slate-600 to-slate-700', bg: 'bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900/10 dark:to-slate-800/5' },
        ].map((k) => (
          <Card key={k.label} className="p-0 overflow-hidden relative">
            <div className={`absolute top-0 left-0 w-full h-1 bg-gradient-to-r ${k.color}`} />
            <div className={`p-4 ${k.bg}`}>
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 leading-tight truncate">{k.label}</p>
                  <p className="text-xl md:text-2xl font-extrabold tabular-nums leading-tight mt-1 truncate">{k.value}</p>
                </div>
                <div className="p-2 rounded-lg bg-white dark:bg-slate-800 shadow-sm border border-slate-100 dark:border-slate-700 shrink-0">
                  <k.icon size={18} className="text-slate-600 dark:text-slate-300" />
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Table */}
      <Card noPadding>
        {isLoading ? (
          <div className="space-y-3 p-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-14 bg-slate-100 dark:bg-slate-800 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : departments.length === 0 ? (
          <div className="py-8">
            <EmptyState icon="inbox" title={t('hr.departments.emptyTitle')} description={t('hr.departments.emptyDescription')} action={
              <Can action="create" module="hr">
                <Button variant="primary" leftIcon={<Plus size={16} />} onClick={openCreate}>{t('hr.departments.new')}</Button>
              </Can>
            } />
          </div>
        ) : (
          <Table<Department>
            data={departments}
            columns={columns}
            keyExtractor={(row) => row.id}
            emptyMessage={t('hr.departments.emptyTitle')}
          />
        )}
      </Card>

      <Modal
        isOpen={isModalOpen}
        onClose={() => { setIsModalOpen(false); resetForm(); }}
        title={editing ? t('hr.departments.edit') : t('hr.departments.new')}
        size="md"
        footer={
          <div className="flex items-center gap-2 justify-end w-full">
            <Button variant="secondary" onClick={() => { setIsModalOpen(false); resetForm(); }}>{t('settings.common.cancel')}</Button>
            <Button variant="primary" onClick={handleSave}>{t('settings.common.save')}</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Input
            label={t('hr.departments.name')}
            value={formData.name}
            onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
          />
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('hr.departments.manager')}</label>
            <UserSelect
              companyId={companyId}
              value={formData.managerId || undefined}
              onChange={(v) => setFormData((prev) => ({ ...prev, managerId: v || '' }))}
            />
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={handleDelete}
        title={t('hr.departments.deleteTitle')}
        message={t('hr.departments.deleteMessage')}
        variant="danger"
      />
    </div>
  );
};

export default DepartmentsPage;
