import React, { useState, useEffect, useCallback } from 'react';
import { CalendarClock, Lock, LockOpen, Download, Printer } from 'lucide-react';
import { Card, Button, Input, Table, PageHeader, StatusBadge } from '@/core/ui/components';
import { ConfirmDialog } from '@/core/ui/components/ConfirmDialog';
import { useAppStore } from '@/core/store';
import { useAuthStore } from '@/modules/auth/store';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useFormatters } from '@/core/utils/useFormatters';
import { useToastStore } from '@/core/store/toastStore';
import { Can } from '@/core/ui/components/PermissionGate';
import { exportToExcel, exportToPDF } from '@/core/utils/exportEngine';
import { DEFAULT_LOCALE } from '@/core/utils/locale';
import {
  getAccountingPeriods,
  previewFiscalClose,
  closeFiscalYear,
  reopenAccountingPeriod,
  generateSubPeriods,
  closeAccountingPeriod,
  reopenAccountingPeriodById,
  type AccountingPeriod,
  type ClosePreview,
  type SubPeriodGranularity,
} from '../yearEnd';

export const YearEndClosePage: React.FC = () => {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const activeCompany = useAppStore((state) => state.activeCompany);
  const currentUser = useAuthStore((s) => s.user);
  const { formatCurrency } = useFormatters(activeCompany?.id || '');

  const yearNow = new Date().getFullYear();
  const [year, setYear] = useState(yearNow - 1);
  const [periods, setPeriods] = useState<AccountingPeriod[]>([]);
  const [preview, setPreview] = useState<ClosePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [closing, setClosing] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmReopen, setConfirmReopen] = useState(false);
  const [granularity, setGranularity] = useState<SubPeriodGranularity>('monthly');
  const [generating, setGenerating] = useState(false);
  const [periodBusy, setPeriodBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeCompany?.id) return;
    setLoading(true);
    try {
      const [pRes, vRes] = await Promise.all([
        getAccountingPeriods(activeCompany.id),
        previewFiscalClose(activeCompany.id, year),
      ]);
      if (pRes.success && pRes.data) setPeriods(pRes.data);
      if (vRes.success && vRes.data) setPreview(vRes.data);
      else if (!vRes.success) addToast('error', vRes.error || t('common.error'));
    } finally {
      setLoading(false);
    }
  }, [activeCompany?.id, year, addToast, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const periodForYear = periods.find((p) => p.year === year && p.periodType === 'annual');
  const isClosed = periodForYear?.status === 'closed';

  const handleGenerate = async () => {
    if (!activeCompany?.id) return;
    setGenerating(true);
    try {
      const res = await generateSubPeriods(activeCompany.id, year, granularity);
      if (res.success) {
        addToast('success', t('accounting.yearEnd.generated', { count: res.data?.length || 0 }));
        await load();
      } else {
        addToast('error', res.error || t('common.error'));
      }
    } finally {
      setGenerating(false);
    }
  };

  const handlePeriodClose = async (p: AccountingPeriod, mode: 'soft' | 'final') => {
    if (!activeCompany?.id) return;
    setPeriodBusy(p.id);
    try {
      const res = await closeAccountingPeriod(activeCompany.id, p.id, currentUser?.id || '', mode);
      if (res.success) {
        addToast('success', t('accounting.yearEnd.periodClosed'));
        await load();
      } else {
        addToast('error', res.error || t('common.error'));
      }
    } finally {
      setPeriodBusy(null);
    }
  };

  const handlePeriodReopen = async (p: AccountingPeriod) => {
    if (!activeCompany?.id) return;
    setPeriodBusy(p.id);
    try {
      const res = await reopenAccountingPeriodById(activeCompany.id, p.id, currentUser?.id || '');
      if (res.success) {
        addToast('success', t('accounting.yearEnd.reopened'));
        await load();
      } else {
        addToast('error', res.error || t('common.error'));
      }
    } finally {
      setPeriodBusy(null);
    }
  };

  const periodTypeLabel = (pt: string) =>
    pt === 'monthly' ? t('accounting.yearEnd.monthly')
    : pt === 'quarterly' ? t('accounting.yearEnd.quarterly')
    : pt === 'half' ? t('accounting.yearEnd.half')
    : pt === 'custom' ? t('accounting.yearEnd.customPeriod')
    : t('accounting.yearEnd.annual');

  const periodStatusLabel = (s: string) =>
    s === 'closed' ? t('accounting.yearEnd.closed')
    : s === 'soft_closed' ? t('accounting.yearEnd.softClosed')
    : t('accounting.yearEnd.open');

  const handleClose = async () => {
    if (!activeCompany?.id) return;
    setConfirmClose(false);
    setClosing(true);
    try {
      const res = await closeFiscalYear(activeCompany.id, year, currentUser?.id || '');
      if (res.success) {
        addToast('success', `${t('accounting.yearEnd.close')} ${year} ✓ (${res.data?.reference})`);
        await load();
      } else {
        addToast('error', res.error || t('common.error'));
      }
    } finally {
      setClosing(false);
    }
  };

  const handleReopen = async () => {
    if (!activeCompany?.id) return;
    setConfirmReopen(false);
    setReopening(true);
    try {
      const res = await reopenAccountingPeriod(activeCompany.id, year, currentUser?.id || '');
      if (res.success) {
        addToast('success', t('accounting.yearEnd.reopened'));
        await load();
      } else {
        addToast('error', res.error || t('common.error'));
      }
    } finally {
      setReopening(false);
    }
  };

  const reportRows = (preview?.lines || []).map((l) => ({
    code: l.code,
    name: l.name,
    debit: l.debit,
    credit: l.credit,
  }));

  const handleExportExcel = () => {
    try {
      exportToExcel(
        reportRows,
        [
          { key: 'code', header: t('accounting.code') },
          { key: 'name', header: t('accounting.yearEnd.account') },
          { key: 'debit', header: t('accounting.debit') },
          { key: 'credit', header: t('accounting.credit') },
        ],
        `close-${year}`
      );
    } catch {
      addToast('error', t('accounting.yearEnd.exportError'));
    }
  };

  const handleExportPDF = () => {
    try {
      exportToPDF(reportRows, [
        { key: 'code', header: t('accounting.code') },
        { key: 'name', header: t('accounting.yearEnd.account') },
        { key: 'debit', header: t('accounting.debit') },
        { key: 'credit', header: t('accounting.credit') },
      ], `close-${year}`, { title: `${t('accounting.yearEnd.reportTitle')} ${year}`, rtl: true });
    } catch {
      addToast('error', t('accounting.yearEnd.exportError'));
    }
  };

  const handlePrint = () => {
    const w = window.open('', '_blank');
    if (!w || !preview) return;
    const rows = (preview.lines || []).map((l, i) => `
      <tr>
        <td style="padding:8px;border:1px solid #e2e8f0;text-align:center">${i + 1}</td>
        <td style="padding:8px;border:1px solid #e2e8f0;text-align:center">${l.code}</td>
        <td style="padding:8px;border:1px solid #e2e8f0">${l.name}</td>
        <td style="padding:8px;border:1px solid #e2e8f0;text-align:left" dir="ltr">${l.debit.toFixed(2)}</td>
        <td style="padding:8px;border:1px solid #e2e8f0;text-align:left" dir="ltr">${l.credit.toFixed(2)}</td>
      </tr>`).join('');
    w.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>${t('accounting.yearEnd.reportTitle')} ${year}</title>
    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap" rel="stylesheet">
    <style>body{font-family:'Cairo',sans-serif;background:#f8fafc;padding:24px}.page{max-width:210mm;margin:0 auto;background:white;padding:32px}h2{color:#1e40af;border-bottom:2px solid #1e40af;padding-bottom:8px}table{width:100%;border-collapse:collapse;font-size:13px;margin-top:16px}th{background:#1e40af;color:white;padding:10px;border:1px solid #1e40af}.tot{background:#f1f5f9;font-weight:bold}</style></head><body>
    <div class="page"><h2>${t('accounting.yearEnd.reportTitle')} ${year}</h2>
    <p><strong>${t('accounting.yearEnd.period')}:</strong> ${preview.startDate} — ${preview.endDate} &nbsp;•&nbsp; <strong>${t('accounting.yearEnd.status')}:</strong> ${isClosed ? t('accounting.yearEnd.closed') : t('accounting.yearEnd.open')}</p>
    <p><strong>${t('accounting.yearEnd.revenue')}:</strong> ${preview.revenue.toFixed(2)} &nbsp;•&nbsp; <strong>${t('accounting.yearEnd.expense')}:</strong> ${preview.expense.toFixed(2)} &nbsp;•&nbsp; <strong>${t('accounting.yearEnd.net')}:</strong> ${preview.net.toFixed(2)}</p>
    <table><thead><tr><th>#</th><th>${t('accounting.code')}</th><th>${t('accounting.yearEnd.account')}</th><th>${t('accounting.debit')}</th><th>${t('accounting.credit')}</th></tr></thead><tbody>${rows}</tbody></table>
    <p style="margin-top:16px;color:#64748b;font-size:12px">${new Date().toLocaleDateString(DEFAULT_LOCALE)} — ${activeCompany?.name || ''}</p>
    </div><script>window.onload=()=>window.print()</script></body></html>`);
    w.document.close();
  };

  const net = preview?.net || 0;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        icon={<CalendarClock size={22} />}
        title={t('accounting.yearEnd.title')}
        subtitle={t('accounting.yearEnd.subtitle')}
        actions={
          <div className="flex items-center gap-2">
            <Input
              type="number"
              value={String(year)}
              onChange={(e) => setYear(Number(e.target.value) || yearNow - 1)}
              aria-label={t('accounting.yearEnd.year')}
              className="w-28"
            />
            <Can action="post" module="accounting">
              {isClosed ? (
                <Button
                  variant="secondary"
                  leftIcon={<LockOpen size={16} />}
                  onClick={() => setConfirmReopen(true)}
                  disabled={reopening || loading}
                  isLoading={reopening}
                  title={t('accounting.yearEnd.reopenHint')}
                >
                  {t('accounting.yearEnd.reopen')}
                </Button>
              ) : (
                <Button
                  variant="primary"
                  leftIcon={<Lock size={16} />}
                  onClick={() => setConfirmClose(true)}
                  disabled={closing || loading}
                  isLoading={closing}
                >
                  {t('accounting.yearEnd.close')}
                </Button>
              )}
            </Can>
          </div>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <div className="text-xs text-slate-500">{t('accounting.yearEnd.revenue')}</div>
          <div className="text-2xl font-bold tabular-nums text-emerald-600">{formatCurrency(preview?.revenue || 0)}</div>
        </Card>
        <Card>
          <div className="text-xs text-slate-500">{t('accounting.yearEnd.expense')}</div>
          <div className="text-2xl font-bold tabular-nums text-rose-600">{formatCurrency(preview?.expense || 0)}</div>
        </Card>
        <Card>
          <div className="text-xs text-slate-500">
            {t('accounting.yearEnd.net')} — {net >= 0 ? t('accounting.yearEnd.profit') : t('accounting.yearEnd.loss')}
          </div>
          <div className={`text-2xl font-bold tabular-nums ${net >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
            {formatCurrency(net)}
          </div>
        </Card>
      </div>

      <Card>
        <div className="flex items-center justify-between mb-2">
          <div className="font-semibold">
            {t('accounting.yearEnd.preview')} {year} ({preview?.startDate} — {preview?.endDate})
            {isClosed && <span className="ms-2 text-xs text-slate-500">• {t('accounting.yearEnd.closed')}</span>}
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={handleExportExcel} title={t('common.excel')} aria-label={t('common.excel')}>
              <Download size={16} className="text-emerald-600" />
            </Button>
            <Button variant="ghost" size="sm" onClick={handleExportPDF} title={t('common.pdf')} aria-label={t('common.pdf')}>
              <Download size={16} className="text-rose-600" />
            </Button>
            <Button variant="ghost" size="sm" onClick={handlePrint} title={t('settings.common.print')} aria-label={t('settings.common.print')}>
              <Printer size={16} className="text-slate-600" />
            </Button>
          </div>
        </div>
        {!preview?.lines.length ? (
          <div className="text-sm text-slate-500 py-4">{t('accounting.yearEnd.noActivity')}</div>
        ) : (
          <Table
            data={preview.lines}
            columns={[
              { key: 'code', header: t('accounting.code') },
              { key: 'name', header: t('accounting.yearEnd.account') },
              { key: 'debit', header: t('accounting.debit'), align: 'right' as const, render: (r) => <span className="tabular-nums">{formatCurrency(r.debit)}</span> },
              { key: 'credit', header: t('accounting.credit'), align: 'right' as const, render: (r) => <span className="tabular-nums">{formatCurrency(r.credit)}</span> },
            ]}
            keyExtractor={(r) => r.accountId}
          />
        )}
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <div className="font-semibold">{t('accounting.yearEnd.periods')}</div>
          <Can action="post" module="accounting">
            <div className="flex items-center gap-2">
              <select
                value={granularity}
                onChange={(e) => setGranularity(e.target.value as SubPeriodGranularity)}
                aria-label={t('accounting.yearEnd.granularity')}
                className="input w-36"
              >
                <option value="monthly">{t('accounting.yearEnd.monthly')}</option>
                <option value="quarterly">{t('accounting.yearEnd.quarterly')}</option>
                <option value="half">{t('accounting.yearEnd.half')}</option>
              </select>
              <Button variant="secondary" size="sm" onClick={handleGenerate} disabled={generating || loading} isLoading={generating}>
                {t('accounting.yearEnd.generate')}
              </Button>
            </div>
          </Can>
        </div>
        <Table
          data={periods}
          columns={[
            { key: 'year', header: t('accounting.yearEnd.year') },
            { key: 'type', header: t('accounting.yearEnd.periodKind'), render: (r) => periodTypeLabel(r.periodType) },
            { key: 'period', header: t('accounting.yearEnd.period'), render: (r) => `${r.startDate} — ${r.endDate}` },
            {
              key: 'status', header: t('accounting.yearEnd.status'),
              render: (r) => <StatusBadge status={r.status === 'closed' ? 'closed' : r.status === 'soft_closed' ? 'pending' : 'open'} size="sm" />,
            },
            {
              key: 'actions', header: '', render: (r: AccountingPeriod) => (
                <div className="flex items-center gap-1 justify-end">
                  {r.status === 'open' && r.periodType !== 'annual' && (
                    <Can action="post" module="accounting">
                      <Button variant="ghost" size="sm" disabled={periodBusy === r.id} onClick={() => handlePeriodClose(r, 'soft')}>
                        {t('accounting.yearEnd.softClose')}
                      </Button>
                      <Button variant="ghost" size="sm" disabled={periodBusy === r.id} onClick={() => handlePeriodClose(r, 'final')}>
                        {t('accounting.yearEnd.close')}
                      </Button>
                    </Can>
                  )}
                  {r.status !== 'open' && r.periodType !== 'annual' && (
                    <Can action="post" module="accounting">
                      <Button variant="ghost" size="sm" disabled={periodBusy === r.id} onClick={() => handlePeriodReopen(r)}>
                        {t('accounting.yearEnd.reopen')}
                      </Button>
                    </Can>
                  )}
                </div>
              ),
            },
          ]}
          keyExtractor={(r) => r.id}
          isLoading={loading}
          emptyMessage={t('accounting.noData')}
        />
        <p className="mt-2 text-xs text-slate-500">{periodStatusLabel('soft_closed')}: {t('accounting.yearEnd.softHint')}</p>
      </Card>

      <ConfirmDialog
        isOpen={confirmClose}
        onClose={() => setConfirmClose(false)}
        onConfirm={handleClose}
        title={t('accounting.yearEnd.close')}
        message={t('accounting.yearEnd.closeConfirm')}
        variant="warning"
      />
      <ConfirmDialog
        isOpen={confirmReopen}
        onClose={() => setConfirmReopen(false)}
        onConfirm={handleReopen}
        title={t('accounting.yearEnd.reopen')}
        message={t('accounting.yearEnd.reopenConfirm')}
        variant="warning"
      />
    </div>
  );
};

export default YearEndClosePage;
