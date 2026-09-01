import React, { useState } from 'react';
import { Wallet, Plus, Pencil, Ban, Save } from 'lucide-react';
import { Card, Button, Input, Table, ConfirmDialog, Can } from '@/core/ui/components';
import { SettingsHeader } from './SettingsHeader';
import { useAppStore } from '@/core/store';
import { usePayrollComponentsCrud } from '@/modules/hr/hooks/useHr';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useToastStore } from '@/core/store/toastStore';
import type { PayrollComponent } from '@/modules/hr/types';

const TYPE_BADGE: Record<PayrollComponent['type'], string> = {
  earning: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  deduction: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
  tax: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  insurance: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  net: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300',
};

export const PayrollComponentsPage: React.FC = () => {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const activeCompany = useAppStore((state) => state.activeCompany);
  const companyId = activeCompany?.id || '';
  const { items: components, isLoading, create, update, deactivate } = usePayrollComponentsCrud(companyId);

  const [editing, setEditing] = useState<PayrollComponent | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState<PayrollComponent | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({
    nameAr: '',
    nameEn: '',
    code: '',
    type: 'earning' as PayrollComponent['type'],
    calculationMethod: 'fixed' as PayrollComponent['calculationMethod'],
    defaultAmount: 0,
    isActive: true,
  });

  const resetForm = () => {
    setFormData({ nameAr: '', nameEn: '', code: '', type: 'earning', calculationMethod: 'fixed', defaultAmount: 0, isActive: true });
    setEditing(null);
    setShowForm(false);
  };

  const openEdit = (row: PayrollComponent) => {
    setEditing(row);
    setFormData({
      nameAr: row.nameAr,
      nameEn: row.nameEn || '',
      code: row.code || '',
      type: row.type,
      calculationMethod: row.calculationMethod,
      defaultAmount: row.defaultAmount,
      isActive: row.isActive,
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!formData.nameAr.trim()) {
      addToast('error', t('settings.payrollComponents.nameAr') + ' ' + t('settings.payrollComponents.required'));
      return;
    }
    setIsSaving(true);
    try {
      const payload = {
        nameAr: formData.nameAr.trim(),
        nameEn: formData.nameEn.trim() || undefined,
        code: formData.code.trim() || undefined,
        type: formData.type,
        calculationMethod: formData.calculationMethod,
        defaultAmount: Number(formData.defaultAmount) || 0,
        isActive: formData.isActive,
      };
      const res = editing
        ? await update(editing.id, payload)
        : await create({ companyId, ...payload });
      if (res.success) {
        addToast('success', t(editing ? 'settings.payrollComponents.updated' : 'settings.payrollComponents.created'));
        resetForm();
      } else {
        addToast('error', res.error || t('common.error'));
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeactivate = async () => {
    if (!confirmDeactivate) return;
    const res = await deactivate(confirmDeactivate.id);
    if (res.success) {
      addToast('success', t('settings.payrollComponents.deactivated'));
    } else {
      addToast('error', res.error || t('common.error'));
    }
    setConfirmDeactivate(null);
  };

  const columns = [
    {
      key: 'name',
      header: t('settings.payrollComponents.nameAr'),
      render: (row: PayrollComponent) => (
        <div>
          <p className="font-medium text-slate-900 dark:text-slate-100">{row.nameAr}</p>
          {row.nameEn && <p className="text-xs text-slate-500 dark:text-slate-400">{row.nameEn}</p>}
        </div>
      ),
    },
    {
      key: 'type',
      header: t('settings.payrollComponents.type'),
      width: '110px',
      render: (row: PayrollComponent) => (
        <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-bold ${TYPE_BADGE[row.type] || TYPE_BADGE.net}`}>
          {t(`settings.payrollComponents.types.${row.type}`)}
        </span>
      ),
    },
    {
      key: 'calculationMethod',
      header: t('settings.payrollComponents.method'),
      width: '120px',
      render: (row: PayrollComponent) => t(`settings.payrollComponents.methods.${row.calculationMethod}`),
    },
    {
      key: 'defaultAmount',
      header: t('settings.payrollComponents.amount'),
      width: '120px',
      render: (row: PayrollComponent) => (
        <span className="tabular-nums font-semibold text-slate-700 dark:text-slate-300">
          {row.calculationMethod === 'percentage' ? `${row.defaultAmount}%` : row.defaultAmount.toLocaleString('ar-YE')}
        </span>
      ),
    },
    {
      key: 'isActive',
      header: t('settings.payrollComponents.active'),
      width: '90px',
      render: (row: PayrollComponent) => (
        <span className={row.isActive ? 'badge-posted' : 'badge-draft'}>
          {row.isActive ? t('settings.payrollComponents.active') : t('settings.payrollComponents.inactive')}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: '110px',
      render: (row: PayrollComponent) => (
        <div className="flex items-center gap-1">
          <Can action="edit" module="settings">
            <Button size="sm" variant="ghost" onClick={() => openEdit(row)} title={t('settings.payrollComponents.edit')}>
              <Pencil size={14} className="text-amber-600" />
            </Button>
          </Can>
          {row.isActive && (
            <Can action="edit" module="settings">
              <Button size="sm" variant="ghost" onClick={() => setConfirmDeactivate(row)} title={t('settings.payrollComponents.deactivate')}>
                <Ban size={14} className="text-rose-600" />
              </Button>
            </Can>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5 animate-fade-in">
      <SettingsHeader
        title={t('settings.payrollComponents.title')}
        subtitle={t('settings.payrollComponents.subtitle')}
        icon={Wallet}
        color="from-violet-600 via-violet-500 to-indigo-600"
        action={
          <Can action="create" module="settings">
            <Button variant="secondary" leftIcon={<Plus size={16} />} onClick={() => { setEditing(null); setFormData({ nameAr: '', nameEn: '', code: '', type: 'earning', calculationMethod: 'fixed', defaultAmount: 0, isActive: true }); setShowForm(true); }} className="bg-white/10 hover:bg-white/20 text-white border-white/20">
              {t('settings.payrollComponents.new')}
            </Button>
          </Can>
        }
      />

      {/* Engine integration hint */}
      <Card className="p-3 bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800">
        <div className="flex gap-2 items-start">
          <Wallet size={16} className="text-violet-600 dark:text-violet-400 shrink-0 mt-0.5" />
          <p className="text-xs text-violet-800 dark:text-violet-300 leading-relaxed">{t('settings.payrollComponents.engineHint')}</p>
        </div>
      </Card>

      <Card>
        {showForm && (
          <div className="mb-4 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Input label={t('settings.payrollComponents.nameAr') + ' *'} value={formData.nameAr} onChange={(e) => setFormData((p) => ({ ...p, nameAr: e.target.value }))} />
              <Input label={t('settings.payrollComponents.nameEn')} value={formData.nameEn} onChange={(e) => setFormData((p) => ({ ...p, nameEn: e.target.value }))} />
              <Input label={t('settings.payrollComponents.code')} value={formData.code} onChange={(e) => setFormData((p) => ({ ...p, code: e.target.value }))} />
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('settings.payrollComponents.type')}</label>
                <select value={formData.type} onChange={(e) => setFormData((p) => ({ ...p, type: e.target.value as PayrollComponent['type'] }))} className="form-control">
                  {(['earning', 'deduction', 'tax', 'insurance', 'net'] as const).map((ty) => (
                    <option key={ty} value={ty}>{t(`settings.payrollComponents.types.${ty}`)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('settings.payrollComponents.method')}</label>
                <select value={formData.calculationMethod} onChange={(e) => setFormData((p) => ({ ...p, calculationMethod: e.target.value as PayrollComponent['calculationMethod'] }))} className="form-control">
                  {(['fixed', 'percentage', 'formula'] as const).map((m) => (
                    <option key={m} value={m}>{t(`settings.payrollComponents.methods.${m}`)}</option>
                  ))}
                </select>
              </div>
              <Input
                label={formData.calculationMethod === 'percentage' ? t('settings.payrollComponents.amountPercent') : t('settings.payrollComponents.amountFixed')}
                type="number"
                min={0}
                step={formData.calculationMethod === 'percentage' ? 0.01 : undefined}
                value={String(formData.defaultAmount)}
                onChange={(e) => setFormData((p) => ({ ...p, defaultAmount: Number(e.target.value) }))}
              />
              <div className="md:col-span-3 flex items-center gap-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={formData.isActive} onChange={(e) => setFormData((p) => ({ ...p, isActive: e.target.checked }))} className="w-4 h-4 rounded" />
                  <span className="text-sm">{t('settings.payrollComponents.active')}</span>
                </label>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={resetForm}>{t('settings.common.cancel')}</Button>
              <Button variant="primary" leftIcon={<Save size={16} />} onClick={handleSave} isLoading={isSaving}>{t('settings.common.save')}</Button>
            </div>
          </div>
        )}

        <Table<PayrollComponent>
          data={components}
          columns={columns}
          keyExtractor={(row) => row.id}
          isLoading={isLoading}
          emptyMessage={t('settings.payrollComponents.emptyTitle')}
        />
      </Card>

      <ConfirmDialog
        isOpen={!!confirmDeactivate}
        onClose={() => setConfirmDeactivate(null)}
        onConfirm={handleDeactivate}
        title={t('settings.payrollComponents.deactivate')}
        message={t('settings.payrollComponents.deactivateConfirm')}
        confirmText={t('settings.payrollComponents.deactivate')}
        variant="warning"
      />
    </div>
  );
};

export default PayrollComponentsPage;
