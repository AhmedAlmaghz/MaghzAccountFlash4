import React, { useState, useEffect, useCallback } from 'react';
import { Building2, Plus, Play, Trash2, X } from 'lucide-react';
import { Card, Button, Input, Modal, Table, PageHeader, StatusBadge } from '@/core/ui/components';
import { ConfirmDialog } from '@/core/ui/components/ConfirmDialog';
import { CashBoxSelect } from '@/core/ui/components/smart';
import { useAppStore } from '@/core/store';
import { useAuthStore } from '@/modules/auth/store';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useFormatters } from '@/core/utils/useFormatters';
import { useToastStore } from '@/core/store/toastStore';
import { Can } from '@/core/ui/components/PermissionGate';
import { fixedAssetsApi, type FixedAsset, type DepreciationMethod } from '../assets';

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const emptyForm = () => ({
  nameAr: '',
  nameEn: '',
  category: '',
  purchaseDate: todayStr(),
  cost: 0,
  salvageValue: 0,
  usefulLifeMonths: 60,
  method: 'straight_line' as DepreciationMethod,
  fundingKind: 'cash' as 'cash' | 'payable' | 'opening',
  fundingCashBoxId: '',
});

export const FixedAssetsPage: React.FC = () => {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const activeCompany = useAppStore((state) => state.activeCompany);
  const currentUser = useAuthStore((s) => s.user);
  const { formatCurrency } = useFormatters(activeCompany?.id || '');

  const [assets, setAssets] = useState<FixedAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<FixedAsset | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<FixedAsset | null>(null);
  // Depreciation run
  const [runOpen, setRunOpen] = useState(false);
  const [runYear, setRunYear] = useState(new Date().getFullYear());
  const [runMonth, setRunMonth] = useState(new Date().getMonth() + 1);
  const [running, setRunning] = useState(false);
  // Disposal
  const [disposing, setDisposing] = useState<FixedAsset | null>(null);
  const [dispDate, setDispDate] = useState(todayStr());
  const [proceeds, setProceeds] = useState(0);
  const [cashBoxId, setCashBoxId] = useState('');
  const [dispReason, setDispReason] = useState('');
  const [dispBusy, setDispBusy] = useState(false);

  const load = useCallback(async () => {
    if (!activeCompany?.id) return;
    setLoading(true);
    try {
      const res = await fixedAssetsApi.getFixedAssets(activeCompany.id);
      if (res.success && res.data) setAssets(res.data);
      else addToast('error', res.error || t('common.error'));
    } finally {
      setLoading(false);
    }
  }, [activeCompany?.id, addToast, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setFormOpen(true);
  };

  const fundingValid = form.fundingKind !== 'cash' || !!form.fundingCashBoxId;

  const openEdit = (a: FixedAsset) => {
    setEditing(a);
    setForm({
      nameAr: a.nameAr,
      nameEn: a.nameEn || '',
      category: a.category || '',
      purchaseDate: a.purchaseDate,
      cost: a.cost,
      salvageValue: a.salvageValue,
      usefulLifeMonths: a.usefulLifeMonths,
      method: a.method,
      fundingKind: 'cash',
      fundingCashBoxId: '',
    });
    setFormOpen(true);
  };

  const handleSave = async () => {
    if (!activeCompany?.id) return;
    if (!form.nameAr.trim() || form.cost <= 0 || form.usefulLifeMonths < 1 || !fundingValid) return;
    setSaving(true);
    try {
      const res = editing
        ? await fixedAssetsApi.updateFixedAsset(editing.id, activeCompany.id, {
            nameAr: form.nameAr.trim(),
            nameEn: form.nameEn.trim(),
            category: form.category.trim(),
            purchaseDate: form.purchaseDate,
            salvageValue: form.salvageValue,
            usefulLifeMonths: form.usefulLifeMonths,
            method: form.method,
          }, currentUser?.id || '')
        : await fixedAssetsApi.createFixedAsset({
            companyId: activeCompany.id,
            nameAr: form.nameAr.trim(),
            nameEn: form.nameEn.trim(),
            category: form.category.trim(),
            purchaseDate: form.purchaseDate,
            cost: form.cost,
            salvageValue: form.salvageValue,
            usefulLifeMonths: form.usefulLifeMonths,
            method: form.method,
            funding: form.fundingKind === 'cash'
              ? { kind: 'cash', cashBoxId: form.fundingCashBoxId }
              : { kind: form.fundingKind },
          }, currentUser?.id || '');
      if (res.success) {
        addToast('success', t('common.saved'));
        setFormOpen(false);
        await load();
      } else {
        addToast('error', res.error || t('common.error'));
      }
    } finally {
      setSaving(false);
    }
  };

  const handleRun = async () => {
    if (!activeCompany?.id) return;
    setRunning(true);
    try {
      const res = await fixedAssetsApi.runDepreciation(activeCompany.id, runYear, runMonth, currentUser?.id || '');
      if (res.success) {
        addToast('success', t('accounting.fixedAssets.runResult', { posted: res.data?.posted || 0, total: formatCurrency(res.data?.total || 0) }));
        setRunOpen(false);
        await load();
      } else {
        addToast('error', res.error || t('common.error'));
      }
    } finally {
      setRunning(false);
    }
  };

  const handleDispose = async () => {
    if (!activeCompany?.id || !disposing || dispReason.trim().length < 3) return;
    setDispBusy(true);
    try {
      const res = await fixedAssetsApi.disposeFixedAsset(
        activeCompany.id,
        disposing.id,
        { date: dispDate, proceeds, cashBoxId: cashBoxId || undefined, reason: dispReason.trim() },
        currentUser?.id || ''
      );
      if (res.success) {
        const extra = (res.data?.gain || 0) > 0
          ? ` — ${t('accounting.fixedAssets.gain')}: ${formatCurrency(res.data?.gain || 0)}`
          : (res.data?.loss || 0) > 0
            ? ` — ${t('accounting.fixedAssets.loss')}: ${formatCurrency(res.data?.loss || 0)}`
            : '';
        addToast('success', `${t('accounting.reverse.success')} (${res.data?.reference})${extra}`);
        setDisposing(null);
        await load();
      } else {
        addToast('error', res.error || t('common.error'));
      }
    } finally {
      setDispBusy(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        icon={<Building2 size={22} />}
        title={t('accounting.fixedAssets.title')}
        subtitle={t('accounting.fixedAssets.subtitle')}
        actions={
          <>
            <Can action="post" module="accounting">
              <Button variant="secondary" leftIcon={<Play size={16} />} onClick={() => setRunOpen(true)}>
                {t('accounting.fixedAssets.run')}
              </Button>
            </Can>
            <Can action="create" module="accounting">
              <Button variant="primary" leftIcon={<Plus size={16} />} onClick={openCreate}>
                {t('accounting.fixedAssets.new')}
              </Button>
            </Can>
          </>
        }
      />

      <Card>
        <Table
          data={assets}
          columns={[
            { key: 'code', header: t('accounting.fixedAssets.code') },
            { key: 'nameAr', header: t('accounting.fixedAssets.name'), mobile: 'title' as const },
            {
              key: 'method', header: t('accounting.fixedAssets.method'), mobile: 'hidden' as const,
              render: (r) => r.method === 'declining_balance' ? t('accounting.fixedAssets.decliningBalance') : t('accounting.fixedAssets.straightLine'),
            },
            { key: 'cost', header: t('accounting.fixedAssets.cost'), align: 'right' as const, render: (r) => <span className="tabular-nums">{formatCurrency(r.cost)}</span> },
            { key: 'accumulated', header: t('accounting.fixedAssets.accumulated'), align: 'right' as const, render: (r) => <span className="tabular-nums">{formatCurrency(r.accumulatedDepreciation)}</span> },
            { key: 'nbv', header: t('accounting.fixedAssets.nbv'), align: 'right' as const, render: (r) => <span className="tabular-nums font-semibold">{formatCurrency(r.netBookValue)}</span> },
            {
              key: 'status', header: t('accounting.fixedAssets.status'), mobile: 'status' as const,
              render: (r) => <StatusBadge status={r.status === 'disposed' ? 'cancelled' : 'posted'} size="sm" />,
            },
            {
              key: 'actions', header: t('edit'), mobile: 'actions' as const, render: (row: FixedAsset) => (
                <div className="flex items-center gap-1">
                  {row.status === 'active' && (
                    <>
                      <Can action="edit" module="accounting">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(row)}>{t('edit')}</Button>
                      </Can>
                      <Can action="post" module="accounting">
                        <Button
                          variant="ghost" size="sm"
                          title={t('accounting.fixedAssets.dispose')}
                          aria-label={t('accounting.fixedAssets.dispose')}
                          onClick={() => { setDisposing(row); setDispDate(todayStr()); setProceeds(0); setCashBoxId(''); setDispReason(''); }}
                        >
                          <Trash2 size={14} />
                        </Button>
                      </Can>
                      {row.accumulatedDepreciation < 0.005 && (
                        <Can action="delete" module="accounting">
                          <Button
                            variant="ghost" size="sm"
                            title={t('delete')}
                            aria-label={t('delete')}
                            onClick={() => setConfirmDelete(row)}
                          >
                            <X size={14} />
                          </Button>
                        </Can>
                      )}
                    </>
                  )}
                </div>
              ),
            },
          ]}
          keyExtractor={(r) => r.id}
          isLoading={loading}
          emptyMessage={t('accounting.fixedAssets.empty')}
        />
      </Card>

      <Modal
        isOpen={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? t('accounting.fixedAssets.edit') : t('accounting.fixedAssets.new')}
        size="lg"
        footer={
          <div className="flex items-center gap-2 justify-end w-full">
            <Button variant="secondary" onClick={() => setFormOpen(false)} disabled={saving}>{t('cancel')}</Button>
            <Button variant="primary" onClick={handleSave} disabled={!form.nameAr.trim() || form.cost <= 0 || !fundingValid} isLoading={saving}>
              {t('common.save')}
            </Button>
          </div>
        }
      >
        <div className="grid grid-cols-2 gap-4">
          <Input label={t('accounting.fixedAssets.name')} value={form.nameAr} onChange={(e) => setForm({ ...form, nameAr: e.target.value })} />
          <Input label={t('accounting.fixedAssets.category')} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          <Input label={t('accounting.fixedAssets.purchaseDate')} type="date" value={form.purchaseDate} onChange={(e) => setForm({ ...form, purchaseDate: e.target.value })} disabled={!!editing && editing.accumulatedDepreciation > 0} />
          <Input label={t('accounting.fixedAssets.cost')} type="number" value={String(form.cost || '')} onChange={(e) => setForm({ ...form, cost: Number(e.target.value) })} disabled={!!editing} />
          <Input label={t('accounting.fixedAssets.salvage')} type="number" value={String(form.salvageValue || '')} onChange={(e) => setForm({ ...form, salvageValue: Number(e.target.value) })} />
          <Input label={t('accounting.fixedAssets.life')} type="number" value={String(form.usefulLifeMonths || '')} onChange={(e) => setForm({ ...form, usefulLifeMonths: Number(e.target.value) })} />
          <label className="block col-span-2">
            <span className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('accounting.fixedAssets.method')}</span>
            <select className="input w-full" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value as DepreciationMethod })}>
              <option value="straight_line">{t('accounting.fixedAssets.straightLine')}</option>
              <option value="declining_balance">{t('accounting.fixedAssets.decliningBalance')}</option>
            </select>
          </label>
          {!editing && (
            <>
              <label className="block col-span-2">
                <span className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('accounting.fixedAssets.funding')}</span>
                <select className="input w-full" value={form.fundingKind} onChange={(e) => setForm({ ...form, fundingKind: e.target.value as 'cash' | 'payable' | 'opening' })}>
                  <option value="cash">{t('accounting.fixedAssets.fundingCash')}</option>
                  <option value="payable">{t('accounting.fixedAssets.fundingPayable')}</option>
                  <option value="opening">{t('accounting.fixedAssets.fundingOpening')}</option>
                </select>
              </label>
              {form.fundingKind === 'cash' && (
                <div className="col-span-2">
                  <CashBoxSelect companyId={activeCompany?.id || ''} value={form.fundingCashBoxId} onChange={(v) => setForm({ ...form, fundingCashBoxId: v || '' })} />
                </div>
              )}
            </>
          )}
        </div>
      </Modal>

      <Modal
        isOpen={runOpen}
        onClose={() => setRunOpen(false)}
        title={t('accounting.fixedAssets.runTitle')}
        size="md"
        footer={
          <div className="flex items-center gap-2 justify-end w-full">
            <Button variant="secondary" onClick={() => setRunOpen(false)} disabled={running}>{t('cancel')}</Button>
            <Button variant="primary" leftIcon={<Play size={16} />} onClick={handleRun} isLoading={running}>
              {t('accounting.fixedAssets.run')}
            </Button>
          </div>
        }
      >
        <div className="grid grid-cols-2 gap-4">
          <Input label={t('accounting.yearEnd.year')} type="number" value={String(runYear)} onChange={(e) => setRunYear(Number(e.target.value))} />
          <Input label={t('accounting.month')} type="number" value={String(runMonth)} onChange={(e) => setRunMonth(Math.min(12, Math.max(1, Number(e.target.value))))} />
        </div>
      </Modal>

      <Modal
        isOpen={!!disposing}
        onClose={() => setDisposing(null)}
        title={`${t('accounting.fixedAssets.disposeTitle')} — ${disposing?.code}`}
        size="md"
        footer={
          <div className="flex items-center gap-2 justify-end w-full">
            <Button variant="secondary" onClick={() => setDisposing(null)} disabled={dispBusy}>{t('cancel')}</Button>
            <Button variant="primary" onClick={handleDispose} disabled={dispReason.trim().length < 3} isLoading={dispBusy}>
              {t('accounting.fixedAssets.dispose')}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="text-sm text-slate-600 dark:text-slate-400">
            {t('accounting.fixedAssets.nbv')}: <span className="font-bold tabular-nums">{formatCurrency(disposing?.netBookValue || 0)}</span>
          </div>
          <Input label={t('accounting.reverse.date')} type="date" value={dispDate} onChange={(e) => setDispDate(e.target.value)} />
          <Input label={t('accounting.fixedAssets.proceeds')} type="number" value={String(proceeds || '')} onChange={(e) => setProceeds(Number(e.target.value))} />
          {proceeds > 0 && (
            <CashBoxSelect companyId={activeCompany?.id || ''} value={cashBoxId} onChange={(v) => setCashBoxId(v || '')} />
          )}
          <label className="block">
            <span className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('accounting.reverse.reason')}</span>
            <textarea className="input w-full min-h-20" value={dispReason} onChange={(e) => setDispReason(e.target.value)} />
          </label>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={async () => {
          if (!confirmDelete || !activeCompany?.id) return;
          const res = await fixedAssetsApi.deleteFixedAsset(confirmDelete.id, activeCompany.id);
          if (res.success) {
            addToast('success', t('common.deleted'));
            setConfirmDelete(null);
            await load();
          } else {
            addToast('error', res.error || t('common.error'));
          }
        }}
        title={t('delete')}
        message={`${t('accounting.fixedAssets.name')}: "${confirmDelete?.nameAr}"?`}
        variant="danger"
      />
    </div>
  );
};

export default FixedAssetsPage;
