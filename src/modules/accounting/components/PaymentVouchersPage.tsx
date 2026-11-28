import React, { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { CreditCard, Plus, CheckSquare, Hash, Wallet, Landmark, FileText, Receipt, Paperclip, Undo2 } from 'lucide-react';
import { printDocument } from '@/core/utils/printDocument';
import { Card, Button, DynamicTable, Badge, PageHeader, FilterBar } from '@/core/ui/components';
import { ConfirmDialog, StatusBadge, ActionButtons } from '@/core/ui/components';
import { useAppStore } from '@/core/store';
import { useAuthStore } from '@/modules/auth/store';
import { useTranslation } from '@/core/i18n/useTranslation';
import { usePaymentVouchersPaginated } from '../hooks/useAccounting';
import { accountingApi } from '../api';
import { reverseVoucher } from '../reversal';
import { ReverseDialog } from './ReverseDialog';
import { useSettings } from '@/core/utils/useSettings';
import { useFormatters } from '@/core/utils/useFormatters';
import { Can } from '@/core/ui/components/PermissionGate';
import { Pagination } from '@/core/ui/components/Pagination';
import { useUserMap } from '@/core/utils/useUserMap';
import { EmptyState } from '@/core/ui/components/EmptyState';
import { exportToExcel, exportToPDF } from '@/core/utils/exportEngine';
import type { PaymentVoucher } from '../types';
import { useToastStore } from '@/core/store/toastStore';

export const PaymentVouchersPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const activeCompany = useAppStore((state) => state.activeCompany);
  const user = useAuthStore((state) => state.user);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [methodFilter, setMethodFilter] = useState<string>('');
  const voucherFilters = useMemo(
    () => ({ status: statusFilter || undefined, search: search || undefined, paymentMethod: methodFilter || undefined }),
    [statusFilter, search, methodFilter],
  );
  const { vouchers, total, page, pageSize, isLoading, goToPage, changePageSize, update, remove, reload } =
      usePaymentVouchersPaginated(activeCompany?.id || '', voucherFilters);
  const [reverseRow, setReverseRow] = useState<PaymentVoucher | null>(null);

  const handleReverseConfirm = async (date: string, reason: string) => {
    if (!activeCompany?.id || !reverseRow) return;
    const res = await reverseVoucher(activeCompany.id, reverseRow.id, 'payment', { date, reason }, user?.id || '');
    if (res.success) {
      addToast('success', `${t('accounting.reverse.success')} (${res.data.reference})`);
      setReverseRow(null);
      await reload();
    } else {
      addToast('error', res.error || t('common.error'));
    }
  };
  const { settings } = useSettings(activeCompany?.id || '');
  const { formatCurrency, formatDate } = useFormatters(activeCompany?.id || '');
  const { getUserName } = useUserMap();
  const currencySymbol = settings?.defaultCurrency || activeCompany?.currency || 'YER';

  const [postingId, setPostingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<PaymentVoucher | null>(null);

  const handlePrint = useCallback(
    (voucher: PaymentVoucher) => {
      const STATUS_LABELS: Record<string, string> = {
        draft: t('accounting.draft'),
        posted: t('accounting.posted'),
        cancelled: t('accounting.cancelled'),
      };
      printDocument({
        type: 'payment-voucher',
        docNumber: voucher.voucherNumber,
        date: voucher.date,
        partyName: voucher.supplierName || voucher.notes || '',
        partyLabel: t('accounting.beneficiary'),
        lines: [
          {
            description: t('accounting.paymentVouchers'),
            productName: voucher.supplierName,
            quantity: 1,
            unitPrice: voucher.amount,
            total: voucher.amount,
          },
        ],
        subtotal: voucher.amount,
        vatAmount: 0,
        totalAmount: voucher.amount,
        notes: voucher.notes,
        companyName: activeCompany?.name,
        companyTaxNumber: activeCompany?.taxNumber,
        companyAddress: activeCompany?.address,
        companyPhone: activeCompany?.phone,
        companyEmail: activeCompany?.email,
        companyLogoUrl: activeCompany?.logoUrl,
        currency: voucher.currencyCode || currencySymbol,
        vatRate: settings?.vatRate,
        paymentMethod: voucher.paymentMethod === 'cash' ? t('accounting.voucher.methodCash') : voucher.paymentMethod === 'bank' ? t('accounting.voucher.methodBank') : t('accounting.voucher.methodCheck'),
        checkNumber: voucher.checkNumber,
        checkDate: voucher.checkDate,
        createdBy: voucher.createdBy ? getUserName(voucher.createdBy) : undefined,
        statusBadge: STATUS_LABELS[voucher.status] || voucher.status,
      statusTone: voucher.status === 'posted' ? 'success' : 'muted',
    }, false, t);
    },
    [t, activeCompany, currencySymbol, getUserName, settings?.vatRate],
  );

  const handlePost = async (voucher: PaymentVoucher) => {
    if (!activeCompany?.id) return;
    setPostingId(voucher.id);
    // Unified atomic posting via the API (JE + supplier balance + status flip).
    const result = await accountingApi.postVoucher(voucher.id, activeCompany.id, 'payment', user?.id || '');
    setPostingId(null);
    if (result.success) {
      await update(voucher.id, { status: 'posted' });
      addToast('success', t('accounting.paymentVoucher.posted'));
    } else {
      addToast('error', `${t('accounting.postFailed')}: ${result.error || t('error')}`);
    }
  };

  const handleEdit = (voucher: PaymentVoucher) => {
    if (voucher.status === 'posted') {
      addToast('error', t('accounting.voucher.postedLocked'));
      return;
    }
    navigate(`/accounting/payment-vouchers/${voucher.id}`);
  };

  const handleExportExcel = useCallback(() => {
    const cols = [
      { key: 'voucherNumber', header: t('accounting.voucherNumber'), width: 16 },
      { key: 'date', header: t('accounting.date'), width: 14 },
      { key: 'supplierName', header: t('accounting.supplier'), width: 24 },
      { key: 'amount', header: t('accounting.amount'), width: 14 },
      { key: 'paymentMethod', header: t('accounting.paymentMethod'), width: 14 },
      { key: 'status', header: t('accounting.status'), width: 12 },
    ];
    exportToExcel(
      vouchers.map((v) => ({
        voucherNumber: v.voucherNumber,
        date: v.date,
        supplierName: v.supplierName || '-',
        amount: v.amount,
        paymentMethod: v.paymentMethod === 'cash' ? t('accounting.cash') : v.paymentMethod === 'bank' ? t('accounting.bank') : t('accounting.check'),
        status: v.status === 'posted' ? t('accounting.posted') : v.status === 'draft' ? t('accounting.draft') : t('accounting.cancelled'),
      })),
      cols,
      `payment_vouchers_${new Date().toISOString().split('T')[0]}`,
    );
  }, [vouchers, t]);

  const handleExportPdf = useCallback(() => {
    const cols = [
      { key: 'voucherNumber', header: t('accounting.voucherNumber') },
      { key: 'supplierName', header: t('accounting.supplier') },
      { key: 'amount', header: t('accounting.amount') },
      { key: 'status', header: t('accounting.status') },
    ];
    exportToPDF(
      vouchers.map((v) => ({
        voucherNumber: v.voucherNumber,
        supplierName: v.supplierName || '-',
        amount: formatCurrency(v.amount),
        status: v.status,
      })),
      cols,
      `payment_vouchers_${new Date().toISOString().split('T')[0]}`,
      { title: t('accounting.paymentVouchers'), rtl: true, companyName: activeCompany?.name },
    );
  }, [vouchers, t, formatCurrency, activeCompany?.name]);

  const totalCash = useMemo(() => vouchers.filter((v) => v.status === 'posted' && v.paymentMethod === 'cash').reduce((s, v) => s + v.amount, 0), [vouchers]);
  const totalBank = useMemo(() => vouchers.filter((v) => v.status === 'posted' && v.paymentMethod === 'bank').reduce((s, v) => s + v.amount, 0), [vouchers]);
  const draftCount = useMemo(() => vouchers.filter((v) => v.status === 'draft').length, [vouchers]);
  const hasActiveFilter = search.trim().length > 0 || statusFilter || methodFilter;

  const columns = useMemo(
    () => [
      {
        key: 'voucherNumber',
        header: t('accounting.voucherNumber'),
        width: '145px',
        mobile: 'title' as const,
        render: (row: PaymentVoucher) => (
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-semibold bg-slate-50 dark:bg-slate-800 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 flex items-center gap-1">
              <Hash size={11} className="text-slate-400" />
              {row.voucherNumber}
            </span>
            {row.invoiceId && <span title={t('accounting.invoiceLinked')}><Paperclip size={12} className="text-primary-500" /></span>}
          </div>
        ),
      },
      {
        key: 'date',
        header: t('accounting.date'),
        width: '120px',
        mobile: 'meta' as const,
        render: (row: PaymentVoucher) => <span className="tabular-nums text-xs text-slate-700 dark:text-slate-300">{row.date ? formatDate(row.date) : '-'}</span>,
      },
      {
        key: 'supplierName',
        header: t('accounting.supplier'),
        mobile: 'subtitle' as const,
        render: (row: PaymentVoucher) => (
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
              {(row.supplierName || row.expenseAccountId || '?').charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="font-medium text-slate-900 dark:text-slate-100 truncate">{row.supplierName || (row.expenseAccountId ? t('accounting.voucher.expenseAccount') : '-')}</p>
              {row.expenseAccountId && !row.supplierId && <p className="text-xs text-slate-500 truncate">{t('accounting.voucher.directExpense')}</p>}
            </div>
          </div>
        ),
      },
      {
        key: 'amount',
        header: t('accounting.amount'),
        align: 'right' as const,
        render: (row: PaymentVoucher) => (
          <div className="text-end">
            <p className="font-bold tabular-nums text-slate-900 dark:text-slate-100">{formatCurrency(row.amount)}</p>
            <p className="text-[11px] text-slate-500 flex items-center justify-end gap-1">
              <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border text-[10px]">{row.currencyCode || 'YER'}</span>
              {row.invoiceId ? <span className="text-amber-600">• {t('accounting.voucher.linked')}</span> : null}
            </p>
          </div>
        ),
      },
      {
        key: 'paymentMethod',
        header: t('accounting.paymentMethod'),
        width: '115px',
        render: (row: PaymentVoucher) => (
          <Badge
            className={
              row.paymentMethod === 'cash'
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-800 border'
                : row.paymentMethod === 'bank'
                  ? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-800 border'
                  : 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800 border'
            }
          >
            {row.paymentMethod === 'cash' ? t('accounting.cash') : row.paymentMethod === 'bank' ? t('accounting.bank') : t('accounting.check')}
          </Badge>
        ),
      },
      {
        key: 'status',
        header: t('sales.status.label'),
        width: '110px',
        mobile: 'status' as const,
        render: (row: PaymentVoucher) => <StatusBadge status={row.status} size="sm" />,
      },
      {
        key: 'createdBy',
        header: t('accounting.createdBy'),
        width: '110px',
        mobile: 'hidden' as const,
        render: (row: PaymentVoucher) => <span className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-[100px] inline-block">{getUserName(row.createdBy)}</span>,
      },
      {
        key: 'actions',
        header: t('edit'),
        width: '170px',
        mobile: 'actions' as const,
        render: (row: PaymentVoucher) => (
          <div className="flex items-center gap-1.5">
            <ActionButtons
              size="sm"
              onView={() => {}}
              onEdit={() => handleEdit(row)}
              onDelete={() => setConfirmDelete(row)}
              onPreview={() => handlePrint(row)}
              onPrint={() => handlePrint(row)}
              showView={false}
              showPreview
              showPrint
              showExport={false}
                disabledEdit={row.status === 'posted' || row.status === 'reversed'}
                disabledDelete={row.status === 'posted' || row.status === 'reversed'}
              />
              {row.status === 'posted' && (
                <Can action="post" module="accounting">
                  <Button
                    size="sm"
                    variant="ghost"
                    title={t('accounting.reverse.title')}
                    aria-label={t('accounting.reverse.title')}
                    onClick={() => setReverseRow(row)}
                    className="h-7 text-xs px-2"
                  >
                    <Undo2 size={13} />
                  </Button>
                </Can>
              )}
            {row.status === 'draft' && (
              <Button size="sm" variant="secondary" leftIcon={<CheckSquare size={13} />} onClick={() => handlePost(row)} disabled={postingId === row.id} className="h-7 text-xs px-2">
                {postingId === row.id ? t('accounting.posting') : t('accounting.post')}
              </Button>
            )}
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, formatCurrency, formatDate, getUserName, postingId],
  );

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Page Header */}
      <PageHeader
        icon={<CreditCard size={22} />}
        title={t('accounting.paymentVouchers')}
        subtitle={t('accounting.voucher.paymentSubtitle')}
        actions={
          <Can action="create" module="accounting">
            <Button variant="primary" leftIcon={<Plus size={16} />} onClick={() => navigate('/accounting/payment-vouchers/new')} className="shadow-sm">
              {t('accounting.newPaymentVoucher')}
            </Button>
          </Can>
        }
      />

      {/* Filter Bar: search + status pills + method pills + exports */}
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder={`${t('search')} — ${t('accounting.voucherNumber')} / ${t('accounting.supplier')}`}
        filterOptions={[
          { key: '', label: t('accounting.all') },
          { key: 'draft', label: t('accounting.draft') },
          { key: 'posted', label: t('accounting.posted') },
        ]}
        activeFilter={statusFilter}
        onFilterChange={(key) => setStatusFilter(key)}
        actions={
          <>
            <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800">
              {[
                { v: '', l: t('common.all') },
                { v: 'cash', l: t('accounting.cash') },
                { v: 'bank', l: t('accounting.bank') },
                { v: 'check', l: t('accounting.check') },
              ].map((o) => (
                <button
                  key={o.v}
                  onClick={() => setMethodFilter(o.v)}
                  className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition ${methodFilter === o.v ? 'bg-white dark:bg-slate-700 shadow-sm border border-slate-200 dark:border-slate-600 text-slate-900 dark:text-slate-100' : 'text-slate-600 dark:text-slate-400'}`}
                >
                  {o.l}
                </button>
              ))}
            </div>
            <Button size="sm" variant="ghost" onClick={handleExportExcel} className="gap-1.5">
              <FileText size={14} className="text-emerald-600" /> <span className="hidden sm:inline text-xs">{t('common.excel')}</span>
            </Button>
            <Button size="sm" variant="ghost" onClick={handleExportPdf} className="gap-1.5">
              <Receipt size={14} className="text-rose-600" /> <span className="hidden sm:inline text-xs">PDF</span>
            </Button>
          </>
        }
      />
      {hasActiveFilter && (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span>
              {total} {t('accounting.voucher.unit')} • {search ? `"${search}"` : ''} {statusFilter ? `• ${statusFilter === 'draft' ? t('accounting.voucher.draft') : statusFilter === 'cancelled' ? t('accounting.voucher.cancelled') : t('accounting.voucher.posted')}` : ''} {methodFilter ? `• ${methodFilter === 'cash' ? t('accounting.voucher.methodCash') : methodFilter === 'bank' ? t('accounting.voucher.methodBank') : t('accounting.voucher.methodCheck')}` : ''}
          </span>
              <button onClick={() => { setSearch(''); setStatusFilter(''); setMethodFilter(''); }} className="text-primary-600 hover:underline font-medium">
                {t('sales.filter.clearFilters')}
              </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="relative overflow-hidden">
          <div className="p-5 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">{t('accounting.totalCashPayments')}</p>
              <p className="mt-1 text-2xl font-bold text-rose-600 dark:text-rose-400 tabular-nums">{formatCurrency(totalCash)}</p>
              <p className="text-xs text-slate-500 mt-1">{currencySymbol} • {t('accounting.voucher.postedCash')}</p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-rose-50 dark:bg-rose-900/20 border border-rose-100 dark:border-rose-800 flex items-center justify-center">
              <Wallet size={20} className="text-rose-600 dark:text-rose-400" />
            </div>
          </div>
          <div className="h-1 bg-gradient-to-r from-rose-500 to-rose-600" />
        </Card>
        <Card className="relative overflow-hidden">
          <div className="p-5 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">{t('accounting.totalBankPayments')}</p>
              <p className="mt-1 text-2xl font-bold text-blue-600 dark:text-blue-400 tabular-nums">{formatCurrency(totalBank)}</p>
              <p className="text-xs text-slate-500 mt-1">{currencySymbol} • {t('accounting.voucher.postedBank')}</p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 flex items-center justify-center">
              <Landmark size={20} className="text-blue-600 dark:text-blue-400" />
            </div>
          </div>
          <div className="h-1 bg-gradient-to-r from-blue-500 to-blue-600" />
        </Card>
        <Card className="relative overflow-hidden">
          <div className="p-5 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">{t('accounting.voucherCount')}</p>
              <p className="mt-1 text-3xl font-bold text-slate-900 dark:text-slate-50 tabular-nums">{total}</p>
              <p className="text-xs text-slate-500 mt-1">{draftCount} {t('accounting.voucher.draft')} • {total - draftCount} {t('accounting.voucher.posted')}</p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center">
              <FileText size={20} className="text-slate-600 dark:text-slate-400" />
            </div>
          </div>
          <div className="h-1 bg-slate-200 dark:bg-slate-700" />
        </Card>
      </div>

      <Card noPadding>
        {isLoading ? (
          <div className="space-y-3 p-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-14 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : vouchers.length === 0 ? (
          <div className="py-8">
            <EmptyState
              icon={hasActiveFilter ? 'search' : 'inbox'}
              title={hasActiveFilter ? t('common.noResults') : t('accounting.noData')}
              description={hasActiveFilter ? t('accounting.voucher.tryDifferentSearch') : t('accounting.voucher.paymentCreateHint')}
              action={
                hasActiveFilter ? (
                <Button variant="secondary" onClick={() => { setSearch(''); setStatusFilter(''); setMethodFilter(''); }}>
                {t('sales.filter.clearFilters')}
                </Button>
                ) : (
                  <Can action="create" module="accounting">
                    <Button variant="primary" leftIcon={<Plus size={16} />} onClick={() => navigate('/accounting/payment-vouchers/new')}>
                      {t('accounting.newPaymentVoucher')}
                    </Button>
                  </Can>
                )
              }
            />
          </div>
        ) : (
          <>
            <DynamicTable tableKey="accounting.paymentVouchers" data={vouchers} columns={columns as never} keyExtractor={(row) => row.id} isLoading={isLoading} emptyMessage={t('accounting.noData')} />
            <div className="border-t border-slate-200 dark:border-slate-800">
              <Pagination page={page} pageSize={pageSize} total={total} onPageChange={goToPage} onPageSizeChange={changePageSize} />
            </div>
          </>
        )}
      </Card>

      <ConfirmDialog
        isOpen={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={async () => {
          if (confirmDelete) {
            const result = await remove(confirmDelete.id);
            if (result?.success) addToast('success', t('accounting.paymentVoucher.deleted'));
            else addToast('error', result?.error || t('common.error'));
            setConfirmDelete(null);
          }
        }}
        title={t('delete')}
        message={`${t('accounting.deletePaymentVoucherConfirm')} "${confirmDelete?.voucherNumber}"طں`}
        variant="danger"
      />

      <ReverseDialog
        open={!!reverseRow}
        onClose={() => setReverseRow(null)}
        docLabel={reverseRow?.voucherNumber || ''}
        onConfirm={handleReverseConfirm}
      />

    </div>
  );
};

export default PaymentVouchersPage;


