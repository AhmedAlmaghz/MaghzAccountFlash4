import React, { useState, useEffect, useCallback } from 'react';
import { CalendarClock, Lock } from 'lucide-react';
import { Card, Button, Input, Table, PageHeader, StatusBadge } from '@/core/ui/components';
import { ConfirmDialog } from '@/core/ui/components/ConfirmDialog';
import { useAppStore } from '@/core/store';
import { useAuthStore } from '@/modules/auth/store';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useFormatters } from '@/core/utils/useFormatters';
import { useToastStore } from '@/core/store/toastStore';
import { Can } from '@/core/ui/components/PermissionGate';
import {
  getAccountingPeriods,
  previewFiscalClose,
  closeFiscalYear,
  type AccountingPeriod,
  type ClosePreview,
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
  const [confirmClose, setConfirmClose] = useState(false);

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
              <Button
                variant="primary"
                leftIcon={<Lock size={16} />}
                onClick={() => setConfirmClose(true)}
                disabled={closing || loading}
                isLoading={closing}
              >
                {t('accounting.yearEnd.close')}
              </Button>
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
        <div className="font-semibold mb-2">
          {t('accounting.yearEnd.preview')} {year} ({preview?.startDate} — {preview?.endDate})
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
        <div className="font-semibold mb-2">{t('accounting.yearEnd.periods')}</div>
        <Table
          data={periods}
          columns={[
            { key: 'year', header: t('accounting.yearEnd.year') },
            { key: 'period', header: t('accounting.yearEnd.period'), render: (r) => `${r.startDate} — ${r.endDate}` },
            {
              key: 'status', header: t('accounting.yearEnd.status'),
              render: (r) => <StatusBadge status={r.status === 'closed' ? 'closed' : 'open'} size="sm" />,
            },
          ]}
          keyExtractor={(r) => r.id}
          isLoading={loading}
          emptyMessage={t('accounting.noData')}
        />
      </Card>

      <ConfirmDialog
        isOpen={confirmClose}
        onClose={() => setConfirmClose(false)}
        onConfirm={handleClose}
        title={t('accounting.yearEnd.close')}
        message={t('accounting.yearEnd.closeConfirm')}
        variant="warning"
      />
    </div>
  );
};

export default YearEndClosePage;
