import React, { useState } from 'react';
import { CalendarClock, Lock, FileText, Printer } from 'lucide-react';
import { Card, Button, Table, Modal, Input, PageHeader, StatusBadge, EmptyState, Pagination } from '@/core/ui/components';
import { useAppStore } from '@/core/store';
import { useFormatters } from '@/core/utils/useFormatters';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useToastStore } from '@/core/store/toastStore';
import { useAuthStore } from '@/modules/auth/store';
import { logAudit } from '@/core/utils/auditLogger';
import { usePosShifts, useShiftSummary } from '../hooks/usePosShifts';
import { posApi } from '../api';
import { printPosZReport } from '../receipt';
import type { PosShift } from '../types';

export const PosShiftsPage: React.FC = () => {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const activeCompany = useAppStore((s) => s.activeCompany);
  const user = useAuthStore((s) => s.user);
  const companyId = activeCompany?.id || '';
  const { formatCurrency, formatDateTime } = useFormatters(companyId);

  const { shifts, total, page, pageSize, isLoading, goToPage, changePageSize, reload } = usePosShifts(companyId);

  const [closeTarget, setCloseTarget] = useState<PosShift | null>(null);
  const [countedAmount, setCountedAmount] = useState('');
  const [closeNotes, setCloseNotes] = useState('');
  const [isClosing, setIsClosing] = useState(false);
  const [reportShift, setReportShift] = useState<PosShift | null>(null);

  // Z-report data loads lazily for the reported shift
  const { summary } = useShiftSummary(companyId, reportShift?.id ?? null);
  const { summary: closeSummary } = useShiftSummary(companyId, closeTarget?.id ?? null);

  const openCloseDialog = (shift: PosShift) => {
    setCloseTarget(shift);
    setCountedAmount('');
    setCloseNotes('');
  };

  const handleCloseShift = async () => {
    if (!closeTarget || !companyId) return;
    const counted = Number(countedAmount);
    if (!Number.isFinite(counted) || counted < 0) {
      addToast('error', t('pos.countedAmount') + ': ' + t('common.invalidAmount', { default: 'قيمة غير صحيحة' }));
      return;
    }
    setIsClosing(true);
    const result = await posApi.closeShift(companyId, closeTarget.id, counted, closeNotes || undefined, user?.id);
    setIsClosing(false);
    if (result.success && result.data) {
      addToast('success', t('pos.shiftClosed'));
      logAudit({
        userId: user?.id || 'unknown',
        action: 'update',
        tableName: 'pos_shifts',
        recordId: closeTarget.id,
        companyId,
        newValues: { countedAmount: counted, expected: result.data.expectedAmount, difference: result.data.difference },
      });
      setCloseTarget(null);
      reload();
    } else {
      addToast('error', result.error || t('pos.checkoutFailed'));
    }
  };

  const columns = [
    {
      key: 'cashier',
      header: t('pos.cashier'),
      mobile: 'title' as const,
      render: (row: PosShift) => (
        <div className="flex flex-col">
          <span className="font-medium">{row.cashierName || row.cashBoxName || '-'}</span>
          <span className="text-xs text-zinc-500">{row.cashBoxName}</span>
        </div>
      ),
    },
    {
      key: 'openedAt',
      header: t('pos.openedAt'),
      width: '150px',
      render: (row: PosShift) => <span className="text-sm">{formatDateTime(row.openedAt)}</span>,
    },
    {
      key: 'openingAmount',
      header: t('pos.openingAmount'),
      width: '130px',
      align: 'right' as const,
      render: (row: PosShift) => <span className="tabular-nums">{formatCurrency(row.openingAmount)}</span>,
    },
    {
      key: 'closingAmount',
      header: t('pos.closingAmount'),
      width: '130px',
      align: 'right' as const,
      render: (row: PosShift) => (
        <span className="tabular-nums">{row.closingAmount != null ? formatCurrency(row.closingAmount) : '—'}</span>
      ),
    },
    {
      key: 'difference',
      header: t('pos.difference'),
      width: '110px',
      align: 'right' as const,
      mobile: 'subtitle' as const,
      render: (row: PosShift) => {
        if (row.difference == null) return <span className="text-zinc-400">—</span>;
        const d = row.difference;
        const color = Math.abs(d) < 0.005 ? 'text-emerald-600' : d > 0 ? 'text-sky-600' : 'text-rose-600';
        const label = Math.abs(d) < 0.005 ? t('pos.balanced') : d > 0 ? t('pos.surplus') : t('pos.shortage');
        return <span className={`tabular-nums ${color}`}>{label} {formatCurrency(Math.abs(d))}</span>;
      },
    },
    {
      key: 'status',
      header: t('pos.status'),
      width: '100px',
      mobile: 'status' as const,
      render: (row: PosShift) => (
        <StatusBadge status={row.status === 'open' ? 'posted' : 'paid'} />
      ),
    },
    {
      key: 'actions',
      header: '',
      width: '160px',
      mobile: 'actions' as const,
      render: (row: PosShift) => (
        <div className="flex gap-1">
          {row.status === 'open' && (
            <Button size="sm" variant="outline" leftIcon={<Lock size={14} />} onClick={() => openCloseDialog(row)}>
              {t('pos.closeShift')}
            </Button>
          )}
          <Button size="sm" variant="ghost" leftIcon={<FileText size={14} />} onClick={() => setReportShift(row)} title={t('pos.zReport')}>
            {t('pos.zReport')}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader
        title={t('pos.shifts')}
        subtitle={t('pos.shiftsSubtitle')}
        icon={<CalendarClock size={22} />}
        actions={
          <Button variant="secondary" onClick={() => window.location.hash = '#/pos'}>
            {t('pos.terminal')}
          </Button>
        }
      />

      <Card>
        {shifts.length === 0 && !isLoading ? (
          <EmptyState
            icon="inbox"
            title={t('pos.noShifts')}
            description={t('pos.noShiftsDesc')}
            action={null}
          />
        ) : (
          <>
            <Table<PosShift>
              data={shifts}
              columns={columns}
              keyExtractor={(row) => row.id}
              isLoading={isLoading}
              emptyMessage={t('pos.noShifts')}
            />
            <Pagination
              page={page}
              pageSize={pageSize}
              total={total}
              onPageChange={goToPage}
              onPageSizeChange={changePageSize}
            />
          </>
        )}
      </Card>

      {/* Close shift dialog — counted vs expected */}
      {closeTarget && (
        <Modal isOpen onClose={() => setCloseTarget(null)} title={t('pos.closeShiftTitle')} size="sm">
          <div className="space-y-4">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">{t('pos.closeShiftConfirm')}</p>
            {closeSummary && (
              <div className="rounded-xl bg-zinc-50 dark:bg-zinc-800/50 p-3 space-y-1.5 text-sm">
                <div className="flex justify-between"><span className="text-zinc-500">{t('pos.cashPayments')}</span><span className="tabular-nums">{formatCurrency(closeSummary.cashTotal)}</span></div>
                <div className="flex justify-between"><span className="text-zinc-500">{t('pos.openingAmount')}</span><span className="tabular-nums">{formatCurrency(closeSummary.openingAmount)}</span></div>
                <div className="flex justify-between font-semibold border-t border-dashed border-zinc-300 dark:border-zinc-700 pt-1.5"><span>{t('pos.expectedAmount')}</span><span className="tabular-nums">{formatCurrency(closeSummary.expectedAmount)}</span></div>
                {countedAmount && Number.isFinite(Number(countedAmount)) && (
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-500">{t('pos.difference')}</span>
                    <span className={`tabular-nums font-bold ${Math.abs(Number(countedAmount) - closeSummary.expectedAmount) < 0.005 ? 'text-emerald-600' : Number(countedAmount) > closeSummary.expectedAmount ? 'text-sky-600' : 'text-rose-600'}`}>
                      {Number(countedAmount) > closeSummary.expectedAmount ? t('pos.surplus') : Number(countedAmount) < closeSummary.expectedAmount ? t('pos.shortage') : t('pos.balanced')} {formatCurrency(Math.abs(Number(countedAmount) - closeSummary.expectedAmount))}
                    </span>
                  </div>
                )}
              </div>
            )}
            <Input
              label={t('pos.countedAmount')}
              type="number"
              value={countedAmount}
              onChange={(e) => setCountedAmount(e.target.value)}
              autoFocus
            />
            <Input
              label={t('settings.common.notes', { default: 'ملاحظات' })}
              value={closeNotes}
              onChange={(e) => setCloseNotes(e.target.value)}
            />
          </div>
          <div className="mt-5 flex gap-2 justify-end">
            <Button variant="secondary" onClick={() => setCloseTarget(null)}>{t('common.cancel')}</Button>
            <Button variant="primary" isLoading={isClosing} onClick={handleCloseShift}>{t('pos.closeShift')}</Button>
          </div>
        </Modal>
      )}

      {/* Z-report dialog */}
      {reportShift && (
        <Modal isOpen onClose={() => setReportShift(null)} title={t('pos.zReportTitle')} size="md">
          {summary ? (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-zinc-50 dark:bg-zinc-800/50 p-3">
                  <div className="text-xs text-zinc-500">{t('pos.invoicesCount')}</div>
                  <div className="font-bold tabular-nums">{summary.invoicesCount}</div>
                </div>
                <div className="rounded-xl bg-zinc-50 dark:bg-zinc-800/50 p-3">
                  <div className="text-xs text-zinc-500">{t('pos.total')}</div>
                  <div className="font-bold tabular-nums">{formatCurrency(summary.netTotal)}</div>
                </div>
                <div className="rounded-xl bg-zinc-50 dark:bg-zinc-800/50 p-3">
                  <div className="text-xs text-zinc-500">{t('pos.cashPayments')}</div>
                  <div className="font-bold tabular-nums text-emerald-600">{formatCurrency(summary.cashTotal)}</div>
                </div>
                <div className="rounded-xl bg-zinc-50 dark:bg-zinc-800/50 p-3">
                  <div className="text-xs text-zinc-500">{t('pos.creditPayments')}</div>
                  <div className="font-bold tabular-nums text-amber-600">{formatCurrency(summary.creditTotal)}</div>
                </div>
                <div className="rounded-xl bg-zinc-50 dark:bg-zinc-800/50 p-3">
                  <div className="text-xs text-zinc-500">{t('pos.expectedAmount')}</div>
                  <div className="font-bold tabular-nums">{formatCurrency(summary.expectedAmount)}</div>
                </div>
                <div className="rounded-xl bg-zinc-50 dark:bg-zinc-800/50 p-3">
                  <div className="text-xs text-zinc-500">{t('pos.discount')}</div>
                  <div className="font-bold tabular-nums">{formatCurrency(summary.discountAmount)}</div>
                </div>
              </div>
              {reportShift.closingAmount != null && (
                <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 p-3">
                  <div className="text-xs text-zinc-500">{t('pos.difference')}</div>
                  <div className={`font-bold tabular-nums ${((reportShift.difference ?? 0) < 0) ? 'text-rose-600' : 'text-emerald-600'}`}>
                    {formatCurrency(reportShift.difference ?? 0)}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="py-8 text-center text-sm text-zinc-500">{t('common.loading', { default: '...' })}</div>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setReportShift(null)}>{t('common.close')}</Button>
            <Button
              variant="primary"
              leftIcon={<Printer size={16} />}
              disabled={!summary}
              onClick={() => summary && printPosZReport({ company: activeCompany, shift: reportShift, summary, fmtCurrency: formatCurrency })}
            >
              {t('pos.print')}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default PosShiftsPage;
