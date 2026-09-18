import React, { useState, useEffect, useCallback } from 'react';
import { FileCheck, Lock, LockOpen, Send, Plus } from 'lucide-react';
import { Card, Button, Table, Can } from '@/core/ui/components';
import { useAppStore } from '@/core/store';
import { useAuthStore } from '@/modules/auth/store';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useToastStore } from '@/core/store/toastStore';
import { useFormatters } from '@/core/utils/useFormatters';
import { logAudit } from '@/core/utils/auditLogger';
import {
  getCompanyTaxContext,
  listTaxPeriods,
  openTaxPeriod,
  setTaxPeriodStatus,
  computeVatReturn,
} from '../engine';
import type { TaxPeriod, VatReturn } from '../types';

/**
 * VAT return workspace (Phase 3): tax periods with open/close/file lifecycle
 * plus the computed return per period — sourced from POSTED journal VAT legs
 * (output minus input), never from document headers.
 */
export const VatReturnPanel: React.FC = () => {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const activeCompany = useAppStore((state) => state.activeCompany);
  const user = useAuthStore((state) => state.user);
  const { formatCurrency } = useFormatters(activeCompany?.id || '');
  const companyId = activeCompany?.id || '';

  const [periods, setPeriods] = useState<TaxPeriod[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [ret, setRet] = useState<VatReturn | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ startDate: '', endDate: '', periodType: 'manual' });

  const reload = useCallback(async () => {
    if (!companyId) return;
    setIsLoading(true);
    try {
      const list = await listTaxPeriods(companyId);
      setPeriods(list);
      if (list.length > 0 && !selectedId) setSelectedId(list[0].id);
    } finally {
      setIsLoading(false);
    }
  }, [companyId, selectedId]);

  useEffect(() => { reload(); }, [reload]);

  const selected = periods.find((p) => p.id === selectedId) || null;

  const handleCompute = useCallback(async () => {
    if (!companyId || !selected) return;
    setIsWorking(true);
    try {
      const res = await computeVatReturn(companyId, selected);
      if (!res.success || !res.data) {
        addToast('error', res.error || t('settings.tax.returnError'));
        setRet(null);
        return;
      }
      setRet(res.data);
    } finally {
      setIsWorking(false);
    }
  }, [companyId, selected, addToast, t]);

  useEffect(() => {
    setRet(null);
    if (selectedId) handleCompute();
  }, [selectedId, handleCompute]);

  const handleCreate = async () => {
    if (!companyId || !form.startDate || !form.endDate) return;
    setIsWorking(true);
    try {
      const ctx = await getCompanyTaxContext(companyId);
      const res = await openTaxPeriod(companyId, {
        countryCode: ctx.countryCode,
        periodType: form.periodType,
        startDate: form.startDate,
        endDate: form.endDate,
      });
      if (!res.success) {
        addToast('error', res.error || t('settings.tax.returnError'));
        return;
      }
      await logAudit({
        userId: user?.id || 'system', username: user?.username, action: 'create',
        tableName: 'tax_periods', recordId: res.id || '', recordLabel: `${form.startDate}..${form.endDate}`, companyId,
      });
      setShowNew(false);
      setForm({ startDate: '', endDate: '', periodType: 'manual' });
      await reload();
      if (res.id) setSelectedId(res.id);
      addToast('success', t('settings.tax.periodOpened'));
    } finally {
      setIsWorking(false);
    }
  };

  const handleStatus = async (status: 'open' | 'closed' | 'filed') => {
    if (!companyId || !selected) return;
    setIsWorking(true);
    try {
      const res = await setTaxPeriodStatus(companyId, selected.id, status);
      if (!res.success) {
        addToast('error', res.error || t('settings.tax.returnError'));
        return;
      }
      await logAudit({
        userId: user?.id || 'system', username: user?.username, action: 'update',
        tableName: 'tax_periods', recordId: selected.id, recordLabel: `status=${status}`, companyId,
      });
      await reload();
      addToast('success', t('settings.tax.periodStatusSaved'));
    } finally {
      setIsWorking(false);
    }
  };

  const columns = [
    { key: 'range', header: t('settings.tax.period'), render: (row: TaxPeriod) => `${row.startDate} – ${row.endDate}` },
    { key: 'countryCode', header: t('settings.tax.country') },
    {
      key: 'status', header: t('settings.tax.status'),
      render: (row: TaxPeriod) => (
        <span className={`px-2 py-0.5 rounded-full text-xs ${row.status === 'open' ? 'bg-emerald-100 text-emerald-700' : row.status === 'closed' ? 'bg-amber-100 text-amber-700' : 'bg-slate-200 text-slate-600'}`}>
          {row.status}
        </span>
      ),
    },
    {
      key: 'actions', header: '', render: (row: TaxPeriod) => (
        <Button size="sm" variant="ghost" onClick={() => setSelectedId(row.id)}>
          {t('settings.tax.viewReturn')}
        </Button>
      ),
    },
  ];

  return (
    <Card className="border-t-4 border-t-emerald-500">
      <div className="p-1 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-50 flex items-center gap-2">
              <FileCheck size={18} className="text-emerald-600" />
              {t('settings.tax.returnTitle')}
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">{t('settings.tax.returnSubtitle')}</p>
          </div>
          <Can action="create" module="settings">
            <Button variant="secondary" leftIcon={<Plus size={16} />} onClick={() => setShowNew((v) => !v)}>
              {t('settings.tax.newPeriod')}
            </Button>
          </Can>
        </div>

        {showNew && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
            <div>
              <label className="mb-1.5 block text-sm font-medium">{t('settings.tax.from')}</label>
              <input type="date" value={form.startDate} onChange={(e) => setForm((p) => ({ ...p, startDate: e.target.value }))} className="form-control" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">{t('settings.tax.to')}</label>
              <input type="date" value={form.endDate} onChange={(e) => setForm((p) => ({ ...p, endDate: e.target.value }))} className="form-control" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">{t('settings.tax.periodType')}</label>
              <select value={form.periodType} onChange={(e) => setForm((p) => ({ ...p, periodType: e.target.value }))} className="form-control">
                <option value="manual">{t('settings.tax.manual')}</option>
                <option value="monthly">{t('settings.tax.monthly')}</option>
                <option value="quarterly">{t('settings.tax.quarterly')}</option>
              </select>
            </div>
            <div className="flex items-end">
              <Button variant="primary" onClick={handleCreate} isLoading={isWorking}>{t('settings.common.save')}</Button>
            </div>
          </div>
        )}

        <Table<TaxPeriod>
          data={periods}
          columns={columns}
          keyExtractor={(row) => row.id}
          isLoading={isLoading}
          emptyMessage={t('settings.tax.noPeriods')}
        />

        {selected && (
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="font-semibold text-slate-900 dark:text-slate-50">
                {t('settings.tax.returnFor')} {selected.startDate} – {selected.endDate}
              </p>
              <div className="flex gap-2">
                <Can action="edit" module="settings">
                  {selected.status === 'open' ? (
                    <Button size="sm" variant="secondary" leftIcon={<Lock size={14} />} onClick={() => handleStatus('closed')} isLoading={isWorking}>
                      {t('settings.tax.closePeriod')}
                    </Button>
                  ) : (
                    <Button size="sm" variant="secondary" leftIcon={<LockOpen size={14} />} onClick={() => handleStatus('open')} isLoading={isWorking}>
                      {t('settings.tax.reopenPeriod')}
                    </Button>
                  )}
                  {selected.status === 'closed' && (
                    <Button size="sm" variant="primary" leftIcon={<Send size={14} />} onClick={() => handleStatus('filed')} isLoading={isWorking}>
                      {t('settings.tax.markFiled')}
                    </Button>
                  )}
                </Can>
              </div>
            </div>
            {selected.status !== 'open' && (
              <p className="text-xs text-amber-600 dark:text-amber-400">{t('settings.tax.lockedHint')}</p>
            )}
            {ret ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="rounded-lg bg-slate-50 dark:bg-slate-800/50 p-3">
                  <p className="text-xs text-slate-500">{t('settings.tax.outputVat')}</p>
                  <p className="font-bold text-lg tabular-nums">{formatCurrency(ret.outputVat)}</p>
                </div>
                <div className="rounded-lg bg-slate-50 dark:bg-slate-800/50 p-3">
                  <p className="text-xs text-slate-500">{t('settings.tax.inputVat')}</p>
                  <p className="font-bold text-lg tabular-nums">{formatCurrency(ret.inputVat)}</p>
                </div>
                <div className={`rounded-lg p-3 ${ret.payable ? 'bg-rose-50 dark:bg-rose-900/20' : 'bg-emerald-50 dark:bg-emerald-900/20'}`}>
                  <p className="text-xs text-slate-500">{ret.payable ? t('settings.tax.netPayable') : t('settings.tax.netRefundable')}</p>
                  <p className="font-bold text-lg tabular-nums">{formatCurrency(Math.abs(ret.netPayable))} {ret.currencyCode}</p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-500">{t('settings.tax.noReturn')}</p>
            )}
          </div>
        )}
      </div>
    </Card>
  );
};

export default VatReturnPanel;
