import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Building2, Plus, Play, Trash2, X, Download, Printer, Search, CalendarClock } from 'lucide-react';
import { Card, Button, Input, Modal, Table, PageHeader, StatusBadge } from '@/core/ui/components';
import { Pagination } from '@/core/ui/components/Pagination';
import { ConfirmDialog } from '@/core/ui/components/ConfirmDialog';
import { CashBoxSelect } from '@/core/ui/components/smart';
import { useAppStore } from '@/core/store';
import { useAuthStore } from '@/modules/auth/store';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useFormatters } from '@/core/utils/useFormatters';
import { useToastStore } from '@/core/store/toastStore';
import { Can } from '@/core/ui/components/PermissionGate';
import { exportToExcel, exportToPDF } from '@/core/utils/exportEngine';
import { DEFAULT_LOCALE } from '@/core/utils/locale';
import { fixedAssetsApi, computeTargetAccumulated, type FixedAsset, type DepreciationMethod } from '../assets';

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
  location: '',
  custodian: '',
  serialNumber: '',
  warrantyExpiry: '',
  notes: '',
});

const PAGE_SIZE = 25;

export const FixedAssetsPage: React.FC = () => {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const activeCompany = useAppStore((state) => state.activeCompany);
  const currentUser = useAuthStore((s) => s.user);
  const { formatCurrency } = useFormatters(activeCompany?.id || '');

  const [assets, setAssets] = useState<FixedAsset[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | 'active' | 'disposed'>('');
  const [loading, setLoading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<FixedAsset | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<FixedAsset | null>(null);
  const [scheduleFor, setScheduleFor] = useState<FixedAsset | null>(null);
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

  const filters = useMemo(
    () => ({ search: search.trim() || undefined, status: statusFilter || undefined }),
    [search, statusFilter]
  );

  const load = useCallback(async () => {
    if (!activeCompany?.id) return;
    setLoading(true);
    try {
      const res = await fixedAssetsApi.getFixedAssetsPaginated(activeCompany.id, page, PAGE_SIZE, filters);
      if (res.success && res.data) {
        setAssets(res.data.items);
        setTotal(res.data.total);
      } else {
        addToast('error', res.error || t('common.error'));
      }
    } finally {
      setLoading(false);
    }
  }, [activeCompany?.id, page, filters, addToast, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter]);

  const kpis = useMemo(() => {
    const cost = assets.reduce((s, a) => s + (Number(a.cost) || 0), 0);
    const acc = assets.reduce((s, a) => s + (Number(a.accumulatedDepreciation) || 0), 0);
    return { count: total, cost, acc, nbv: cost - acc };
  }, [assets, total]);

  const schedule = useMemo(() => {
    if (!scheduleFor) return [];
    const rows: Array<{ m: number; label: string; charge: number; accum: number; nbv: number }> = [];
    const [py, pm] = scheduleFor.purchaseDate.split('-').map(Number);
    const life = Math.max(1, scheduleFor.usefulLifeMonths);
    let prev = 0;
    for (let m = 1; m <= life; m++) {
      const d = new Date(py, pm - 1 + m, 1);
      const asOf = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
      const accum = computeTargetAccumulated(scheduleFor, scheduleFor.purchaseDate, asOf);
      const charge = Math.max(0, Math.round((accum - prev) * 100) / 100);
      prev = accum;
      rows.push({
        m,
        label: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        charge,
        accum,
        nbv: Math.round((scheduleFor.cost - accum) * 100) / 100,
      });
      if (accum >= scheduleFor.cost - scheduleFor.salvageValue - 0.005) break;
    }
    return rows;
  }, [scheduleFor]);

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
      location: a.location || '',
      custodian: a.custodian || '',
      serialNumber: a.serialNumber || '',
      warrantyExpiry: a.warrantyExpiry || '',
      notes: a.notes || '',
    });
    setFormOpen(true);
  };

  const handleSave = async () => {
    if (!activeCompany?.id) return;
    if (!form.nameAr.trim() || form.cost <= 0 || form.usefulLifeMonths < 1 || !fundingValid) return;
    if (form.salvageValue >= form.cost) {
      addToast('error', t('accounting.fixedAssets.salvageBelowCost'));
      return;
    }
    setSaving(true);
    try {
      const ops = {
        location: form.location.trim() || undefined,
        custodian: form.custodian.trim() || undefined,
        serialNumber: form.serialNumber.trim() || undefined,
        warrantyExpiry: form.warrantyExpiry || undefined,
        notes: form.notes.trim() || undefined,
      };
      const res = editing
        ? await fixedAssetsApi.updateFixedAsset(editing.id, activeCompany.id, {
            nameAr: form.nameAr.trim(),
            nameEn: form.nameEn.trim(),
            category: form.category.trim(),
            // Purchase date locks once depreciation is posted (API rejects it)
            // — don't send a locked anchor the server must refuse.
            ...(editing.accumulatedDepreciation > 0 ? {} : { purchaseDate: form.purchaseDate }),
            salvageValue: form.salvageValue,
            usefulLifeMonths: form.usefulLifeMonths,
            method: form.method,
            ...ops,
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
            ...ops,
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

  const registerRows = assets.map((a) => ({
    code: a.code,
    nameAr: a.nameAr,
    category: a.category || '',
    purchaseDate: a.purchaseDate,
    cost: a.cost,
    accumulated: a.accumulatedDepreciation,
    nbv: a.netBookValue,
    location: a.location || '',
    custodian: a.custodian || '',
    status: a.status === 'disposed' ? t('accounting.fixedAssets.disposed') : t('accounting.fixedAssets.active'),
  }));

  const registerCols = [
    { key: 'code', header: t('accounting.fixedAssets.code') },
    { key: 'nameAr', header: t('accounting.fixedAssets.name') },
    { key: 'category', header: t('accounting.fixedAssets.category') },
    { key: 'purchaseDate', header: t('accounting.fixedAssets.purchaseDate') },
    { key: 'cost', header: t('accounting.fixedAssets.cost') },
    { key: 'accumulated', header: t('accounting.fixedAssets.accumulated') },
    { key: 'nbv', header: t('accounting.fixedAssets.nbv') },
    { key: 'location', header: t('accounting.fixedAssets.location') },
    { key: 'custodian', header: t('accounting.fixedAssets.custodian') },
    { key: 'status', header: t('accounting.fixedAssets.status') },
  ];

  const handleExportExcel = () => {
    try {
      exportToExcel(registerRows, registerCols, `fixed-assets-${todayStr()}`);
    } catch {
      addToast('error', t('accounting.fixedAssets.exportError'));
    }
  };

  const handleExportPDF = () => {
    try {
      exportToPDF(registerRows, registerCols, `fixed-assets-${todayStr()}`, { title: t('accounting.fixedAssets.registerTitle'), rtl: true });
    } catch {
      addToast('error', t('accounting.fixedAssets.exportError'));
    }
  };

  const handlePrint = () => {
    const w = window.open('', '_blank');
    if (!w) return;
    const rows = registerRows.map((a, i) => `
      <tr>
        <td style="padding:8px;border:1px solid #e2e8f0;text-align:center">${i + 1}</td>
        <td style="padding:8px;border:1px solid #e2e8f0;text-align:center">${a.code}</td>
        <td style="padding:8px;border:1px solid #e2e8f0">${a.nameAr}</td>
        <td style="padding:8px;border:1px solid #e2e8f0;text-align:center">${a.purchaseDate}</td>
        <td style="padding:8px;border:1px solid #e2e8f0;text-align:left" dir="ltr">${Number(a.cost).toFixed(2)}</td>
        <td style="padding:8px;border:1px solid #e2e8f0;text-align:left" dir="ltr">${Number(a.accumulated).toFixed(2)}</td>
        <td style="padding:8px;border:1px solid #e2e8f0;text-align:left" dir="ltr">${Number(a.nbv).toFixed(2)}</td>
        <td style="padding:8px;border:1px solid #e2e8f0">${a.location}</td>
        <td style="padding:8px;border:1px solid #e2e8f0">${a.custodian}</td>
      </tr>`).join('');
    w.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>${t('accounting.fixedAssets.registerTitle')}</title>
    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap" rel="stylesheet">
    <style>body{font-family:'Cairo',sans-serif;background:#f8fafc;padding:24px}.page{max-width:297mm;margin:0 auto;background:white;padding:32px}h2{color:#1e40af;border-bottom:2px solid #1e40af;padding-bottom:8px}table{width:100%;border-collapse:collapse;font-size:12px;margin-top:16px}th{background:#1e40af;color:white;padding:10px;border:1px solid #1e40af}</style></head><body>
    <div class="page"><h2>${t('accounting.fixedAssets.registerTitle')}</h2>
    <p><strong>${t('accounting.fixedAssets.count')}:</strong> ${total} &nbsp;•&nbsp; <strong>${t('accounting.fixedAssets.totalCost')}:</strong> ${kpis.cost.toFixed(2)} &nbsp;•&nbsp; <strong>${t('accounting.fixedAssets.totalNbv')}:</strong> ${kpis.nbv.toFixed(2)}</p>
    <table><thead><tr><th>#</th><th>${t('accounting.fixedAssets.code')}</th><th>${t('accounting.fixedAssets.name')}</th><th>${t('accounting.fixedAssets.purchaseDate')}</th><th>${t('accounting.fixedAssets.cost')}</th><th>${t('accounting.fixedAssets.accumulated')}</th><th>${t('accounting.fixedAssets.nbv')}</th><th>${t('accounting.fixedAssets.location')}</th><th>${t('accounting.fixedAssets.custodian')}</th></tr></thead><tbody>${rows}</tbody></table>
    <p style="margin-top:16px;color:#64748b;font-size:12px">${new Date().toLocaleDateString(DEFAULT_LOCALE)} — ${activeCompany?.name || ''}</p>
    </div><script>window.onload=()=>window.print()</script></body></html>`);
    w.document.close();
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        icon={<Building2 size={22} />}
        title={t('accounting.fixedAssets.title')}
        subtitle={t('accounting.fixedAssets.subtitle')}
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={handleExportExcel} title={t('common.excel')} aria-label={t('common.excel')}>
              <Download size={16} className="text-emerald-600" />
            </Button>
            <Button variant="ghost" size="sm" onClick={handleExportPDF} title={t('common.pdf')} aria-label={t('common.pdf')}>
              <Download size={16} className="text-rose-600" />
            </Button>
            <Button variant="ghost" size="sm" onClick={handlePrint} title={t('settings.common.print')} aria-label={t('settings.common.print')}>
              <Printer size={16} className="text-slate-600" />
            </Button>
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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <div className="text-xs text-slate-500">{t('accounting.fixedAssets.count')}</div>
          <div className="text-2xl font-bold tabular-nums">{kpis.count}</div>
        </Card>
        <Card>
          <div className="text-xs text-slate-500">{t('accounting.fixedAssets.totalCost')}</div>
          <div className="text-2xl font-bold tabular-nums">{formatCurrency(kpis.cost)}</div>
        </Card>
        <Card>
          <div className="text-xs text-slate-500">{t('accounting.fixedAssets.totalAccum')}</div>
          <div className="text-2xl font-bold tabular-nums text-amber-600">{formatCurrency(kpis.acc)}</div>
        </Card>
        <Card>
          <div className="text-xs text-slate-500">{t('accounting.fixedAssets.totalNbv')}</div>
          <div className="text-2xl font-bold tabular-nums text-emerald-700">{formatCurrency(kpis.nbv)}</div>
        </Card>
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <div className="relative flex-1 min-w-52">
            <Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('accounting.fixedAssets.search')}
              aria-label={t('accounting.fixedAssets.search')}
              className="ps-9"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as '' | 'active' | 'disposed')}
            aria-label={t('accounting.fixedAssets.status')}
            className="input w-40"
          >
            <option value="">{t('accounting.fixedAssets.allStatuses')}</option>
            <option value="active">{t('accounting.fixedAssets.active')}</option>
            <option value="disposed">{t('accounting.fixedAssets.disposed')}</option>
          </select>
        </div>
        <Table
          data={assets}
          columns={[
            { key: 'code', header: t('accounting.fixedAssets.code') },
            { key: 'nameAr', header: t('accounting.fixedAssets.name'), mobile: 'title' as const },
            { key: 'custodian', header: t('accounting.fixedAssets.custodian'), mobile: 'hidden' as const, render: (r) => r.custodian || '—' },
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
                  <Button variant="ghost" size="sm" onClick={() => setScheduleFor(row)} title={t('accounting.fixedAssets.schedule')} aria-label={t('accounting.fixedAssets.schedule')}>
                    <CalendarClock size={14} />
                  </Button>
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
        <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
      </Card>

      <Modal
        isOpen={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? t('accounting.fixedAssets.edit') : t('accounting.fixedAssets.new')}
        size="3xl"
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
          <Input label={t('accounting.fixedAssets.nameEn')} value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} />
          <Input label={t('accounting.fixedAssets.category')} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          <Input label={t('accounting.fixedAssets.serialNumber')} value={form.serialNumber} onChange={(e) => setForm({ ...form, serialNumber: e.target.value })} />
          <Input label={t('accounting.fixedAssets.purchaseDate')} type="date" value={form.purchaseDate} onChange={(e) => setForm({ ...form, purchaseDate: e.target.value })} disabled={!!editing && editing.accumulatedDepreciation > 0} />
          <Input label={t('accounting.fixedAssets.cost')} type="number" value={String(form.cost || '')} onChange={(e) => setForm({ ...form, cost: Number(e.target.value) })} disabled={!!editing} />
          <Input label={t('accounting.fixedAssets.salvage')} type="number" value={String(form.salvageValue || '')} onChange={(e) => setForm({ ...form, salvageValue: Number(e.target.value) })} />
          <Input label={t('accounting.fixedAssets.life')} type="number" value={String(form.usefulLifeMonths || '')} onChange={(e) => setForm({ ...form, usefulLifeMonths: Number(e.target.value) })} />
          <Input label={t('accounting.fixedAssets.location')} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
          <Input label={t('accounting.fixedAssets.custodian')} value={form.custodian} onChange={(e) => setForm({ ...form, custodian: e.target.value })} />
          <Input label={t('accounting.fixedAssets.warrantyExpiry')} type="date" value={form.warrantyExpiry} onChange={(e) => setForm({ ...form, warrantyExpiry: e.target.value })} />
          <label className="block">
            <span className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('accounting.fixedAssets.method')}</span>
            <select className="input w-full" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value as DepreciationMethod })}>
              <option value="straight_line">{t('accounting.fixedAssets.straightLine')}</option>
              <option value="declining_balance">{t('accounting.fixedAssets.decliningBalance')}</option>
            </select>
          </label>
          <label className="block col-span-2">
            <span className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('accounting.fixedAssets.notes')}</span>
            <textarea className="input w-full min-h-16" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
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
        isOpen={!!scheduleFor}
        onClose={() => setScheduleFor(null)}
        title={`${t('accounting.fixedAssets.schedule')} — ${scheduleFor?.code}`}
        size="lg"
      >
        <Table
          data={schedule}
          columns={[
            { key: 'm', header: '#', align: 'right' as const },
            { key: 'label', header: t('accounting.fixedAssets.schedMonth') },
            { key: 'charge', header: t('accounting.fixedAssets.schedCharge'), align: 'right' as const, render: (r) => <span className="tabular-nums">{formatCurrency(r.charge)}</span> },
            { key: 'accum', header: t('accounting.fixedAssets.accumulated'), align: 'right' as const, render: (r) => <span className="tabular-nums">{formatCurrency(r.accum)}</span> },
            { key: 'nbv', header: t('accounting.fixedAssets.nbv'), align: 'right' as const, render: (r) => <span className="tabular-nums font-semibold">{formatCurrency(r.nbv)}</span> },
          ]}
          keyExtractor={(r) => String(r.m)}
          emptyMessage={t('accounting.noData')}
        />
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
