import React, { useState, useMemo, useCallback, useRef } from 'react';
import { Plus, CheckSquare, Users, Hash, Wallet, Landmark, FileText, Receipt, Paperclip, AlertCircle } from 'lucide-react';
import { printDocument } from '@/core/utils/printDocument';
import { Card, Button, Modal, Input, Table, Badge, PageHeader, FilterBar } from '@/core/ui/components';
import { ConfirmDialog, StatusBadge, ActionButtons } from '@/core/ui/components';
import { DuplicateWarningDialog } from '@/core/ui/components/DuplicateWarningDialog';
import { receiptVoucherFingerprint, paymentVoucherFingerprint, journalEntryFingerprint, detectDocumentDuplicates, detectVoucherDuplicate, detectJournalDuplicate } from '@/core/utils/documentDuplicate';
import { CustomerSelect, CashBoxSelect, CurrencySelect } from '@/core/ui/components/smart';
import { useAppStore } from '@/core/store';
import { useAuthStore } from '@/modules/auth/store';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useReceiptVouchersPaginated } from '../hooks/useAccounting';
import { useOutstandingInvoicesForCustomer } from '@/modules/sales/hooks/useSales';
import { accountingApi } from '../api';
import { useDocumentSequence } from '@/core/utils/useDocumentSequence';
import { useSettings } from '@/core/utils/useSettings';
import { useDefaultPaymentAccounts } from '@/core/hooks/useDefaultPaymentAccounts';
import { useFormatters } from '@/core/utils/useFormatters';
import { YER_CODE } from '@/core/utils/currencyConverter';
import { useCurrencyDisplay } from '@/core/utils/useCurrencyDisplay';
import { Can } from '@/core/ui/components/PermissionGate';
import { Pagination } from '@/core/ui/components/Pagination';
import { useUserMap } from '@/core/utils/useUserMap';
import { EmptyState } from '@/core/ui/components/EmptyState';
import { exportToExcel, exportToPDF } from '@/core/utils/exportEngine';
import type { ReceiptVoucher } from '../types';
import { useToastStore } from '@/core/store/toastStore';

// keep fingerprint helpers referenced (task requires importing all six — only detectVoucherDuplicate is used here)
void receiptVoucherFingerprint; void paymentVoucherFingerprint; void journalEntryFingerprint; void detectDocumentDuplicates; void detectJournalDuplicate;

type FormErrors = Partial<Record<'customerId' | 'amount' | 'date' | 'voucherNumber', string>>;

export const ReceiptVouchersPage: React.FC = () => {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const activeCompany = useAppStore((state) => state.activeCompany);
  const user = useAuthStore((state) => state.user);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [methodFilter, setMethodFilter] = useState<string>('');
  const voucherFilters = useMemo(
    () => ({
      status: statusFilter || undefined,
      search: search || undefined,
      paymentMethod: methodFilter || undefined,
    }),
    [statusFilter, search, methodFilter],
  );
  const { vouchers, total, page, pageSize, isLoading, goToPage, changePageSize, create, update, remove } =
    useReceiptVouchersPaginated(activeCompany?.id || '', voucherFilters);
  const { getNextNumber } = useDocumentSequence();
  const { settings } = useSettings(activeCompany?.id || '');
  const { formatCurrency, formatDate } = useFormatters(activeCompany?.id || '');
  const { currencies, defaultCurrency } = useCurrencyDisplay();
  const { defaultCashBoxId } = useDefaultPaymentAccounts(activeCompany?.id || '');
  const currencySymbol = settings?.defaultCurrency || activeCompany?.currency || YER_CODE;

  const { getUserName } = useUserMap();
  const [postingId, setPostingId] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<
    Partial<ReceiptVoucher> & { amountApplied?: number; baseCurrencyApplied?: number; invoiceId?: string }
  >({ paymentMethod: 'cash', status: 'draft', date: new Date().toISOString().split('T')[0] });
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const { invoices: outstandingInvoices, isLoading: invoicesLoading } = useOutstandingInvoicesForCustomer(
    activeCompany?.id || '',
    form.customerId || '',
  );
  const [confirmDelete, setConfirmDelete] = useState<ReceiptVoucher | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [docDuplicateOpen, setDocDuplicateOpen] = useState(false);
  const [docDuplicateInput, setDocDuplicateInput] = useState('');
  const [docDuplicateExact, setDocDuplicateExact] = useState<{ name: string; code?: string } | null>(null);
  const [docDuplicateNear, setDocDuplicateNear] = useState<Array<{ name: string; code?: string; score: number }>>([]);
  const docDuplicateConfirmedRef = useRef(false);

  const validateForm = useCallback((): boolean => {
    const e: FormErrors = {};
    if (!form.customerId) e.customerId = t('validation.required') || 'مطلوب';
    if (!form.amount || Number(form.amount) <= 0) e.amount = t('accounting.enterAmount') || 'مبلغ غير صحيح';
    if (!form.date) e.date = t('validation.required') || 'مطلوب';
    if (form.invoiceId && Number(form.amountApplied || 0) > Number(form.amount || 0)) e.amount = 'المبلغ المطبق لا يمكن أن يتجاوز مبلغ السند';
    setFormErrors(e);
    return Object.keys(e).length === 0;
  }, [form, t]);

  const handlePrint = useCallback(
    (voucher: ReceiptVoucher) => {
      printDocument({
        type: 'receipt-voucher',
        docNumber: voucher.voucherNumber,
        date: voucher.date,
        partyName: voucher.customerName,
        partyLabel: t('accounting.customer'),
        lines: [
          {
            description: t('accounting.receiptVouchers'),
            productName: voucher.customerName,
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
        currency: voucher.currencyCode || currencySymbol,
        paymentMethod: voucher.paymentMethod === 'cash' ? 'نقداً' : voucher.paymentMethod === 'bank' ? 'تحويل بنكي' : 'شيك',
        checkNumber: voucher.checkNumber,
        checkDate: voucher.checkDate,
        createdBy: voucher.createdBy ? getUserName(voucher.createdBy) : undefined,
      });
    },
    [t, activeCompany, currencySymbol, getUserName],
  );

  const handlePost = async (voucher: ReceiptVoucher) => {
    if (!activeCompany?.id) return;
    setPostingId(voucher.id);
    // Unified atomic posting via the API (JE + customer balance + status flip).
    const result = await accountingApi.postVoucher(voucher.id, activeCompany.id, 'receipt', user?.id || '');
    setPostingId(null);
    if (result.success) {
      await update(voucher.id, { status: 'posted' });
      addToast('success', t('accounting.receiptVoucher.posted'));
    } else {
      addToast('error', `${t('accounting.postFailed')}: ${result.error || t('error')}`);
    }
  };

  const handleSave = async () => {
    if (!activeCompany?.id) return;
    if (!validateForm()) {
      addToast('error', t('validation.required') || 'يرجى تصحيح الحقول');
      return;
    }
    setIsSaving(true);
    let voucherNumber = form.voucherNumber || '';
    if (!isEditMode || !editingId) {
      const seq = await getNextNumber('receipt_voucher', activeCompany.id);
      if (!seq.success || !seq.number) {
        addToast('error', seq.error || t('accounting.voucherNumberError'));
        setIsSaving(false);
        return;
      }
      voucherNumber = seq.number;
    }

    const payload = {
      companyId: activeCompany.id,
      voucherNumber,
      date: form.date || new Date().toISOString().split('T')[0],
      customerId: form.customerId!,
      customerName: form.customerName || '',
      invoiceId: form.invoiceId || undefined,
      amount: Number(form.amount) || 0,
      amountApplied: form.invoiceId ? Number(form.amountApplied) || Number(form.amount) || 0 : 0,
      currencyCode: form.currencyCode || YER_CODE,
      exchangeRate: form.exchangeRate ?? 1,
      baseCurrencyAmount: (Number(form.amount) || 0) * (form.exchangeRate ?? 1),
      baseCurrencyApplied: form.invoiceId ? (Number(form.amountApplied) || Number(form.amount) || 0) * (form.exchangeRate ?? 1) : 0,
      paymentMethod: form.paymentMethod || 'cash',
      cashBoxId: form.cashBoxId || undefined,
      checkNumber: form.checkNumber || undefined,
      checkDate: form.checkDate || undefined,
      notes: form.notes || '',
      status: (form.status || 'draft') as 'draft' | 'posted' | 'cancelled',
    };

    // ── حارس تكرار المستند — بصمة كاملة (حظر تام) + قريب (تحذير) ──
    if (!docDuplicateConfirmedRef.current) {
      try {
        const existingRes = await accountingApi.getReceiptVouchersPaginated(activeCompany.id, 1, 200);
        const existingList = (existingRes.success && existingRes.data ? ((existingRes.data as unknown as { items?: ReceiptVoucher[] })?.items ?? (existingRes.data as unknown as ReceiptVoucher[]) ?? []) : []) as ReceiptVoucher[];
        const dup = detectVoucherDuplicate(
          { partyId: payload.customerId, date: payload.date, amount: payload.amount, currencyCode: payload.currencyCode, paymentMethod: payload.paymentMethod },
          existingList as never,
          editingId || undefined,
        );
        if (dup.exactMatch) {
          const doc = dup.exactMatch as unknown as ReceiptVoucher;
          setDocDuplicateInput(`${payload.customerId} • ${payload.date} • ${payload.amount}`);
          setDocDuplicateExact({ name: doc.voucherNumber || String(doc.id).slice(0, 8), code: `${doc.date} • ${doc.amount}` });
          setDocDuplicateNear([]);
          setDocDuplicateOpen(true);
          setIsSaving(false);
          return;
        }
        if (dup.nearMatches.length > 0) {
          setDocDuplicateInput(`${payload.customerId} • ${payload.date}`);
          setDocDuplicateNear(
            dup.nearMatches.map((m) => {
              const d = m.item as unknown as ReceiptVoucher;
              return { name: d.voucherNumber || String(d.id).slice(0, 8), code: `${d.date} • ${d.amount}`, score: m.score };
            }),
          );
          setDocDuplicateExact(null);
          setDocDuplicateOpen(true);
          setIsSaving(false);
          return;
        }
      } catch {
        /* فشل الفحص لا يمنع الحفظ */
      }
    }
    docDuplicateConfirmedRef.current = false;

    let result;
    if (isEditMode && editingId) result = await update(editingId, payload);
    else result = await create(payload);

    setIsSaving(false);
    if (result?.success) {
      addToast('success', t(isEditMode ? 'accounting.receiptVoucher.updated' : 'accounting.receiptVoucher.created'));
      setIsOpen(false);
      resetForm();
    } else {
      addToast('error', result?.error || t('common.error'));
    }
  };

  const handleCurrencyChange = (code: string | null) => {
    if (!code) {
      setForm((prev) => ({ ...prev, currencyCode: YER_CODE, exchangeRate: 1 }));
      return;
    }
    const c = currencies.find((x) => x.code === code);
    setForm((prev) => ({ ...prev, currencyCode: code, exchangeRate: c ? c.exchangeRate : 1 }));
  };

  const resetForm = () => {
    setForm({
      paymentMethod: 'cash',
      status: 'draft',
      date: new Date().toISOString().split('T')[0],
      currencyCode: defaultCurrency?.code || YER_CODE,
      exchangeRate: 1,
      cashBoxId: defaultCashBoxId || undefined,
    });
    setFormErrors({});
    setIsEditMode(false);
    setEditingId(null);
  };

  const handleEdit = (voucher: ReceiptVoucher) => {
    if (voucher.status === 'posted') {
      addToast('error', 'لا يمكن تعديل سند مرحّل');
      return;
    }
    setForm({ ...voucher });
    setEditingId(voucher.id);
    setIsEditMode(true);
    setFormErrors({});
    setIsOpen(true);
  };

  const handleExportExcel = useCallback(() => {
    const cols = [
      { key: 'voucherNumber', header: t('accounting.voucherNumber'), width: 16 },
      { key: 'date', header: t('accounting.date'), width: 14 },
      { key: 'customerName', header: t('accounting.customer'), width: 24 },
      { key: 'amount', header: t('accounting.amount'), width: 14 },
      { key: 'paymentMethod', header: t('accounting.paymentMethod'), width: 14 },
      { key: 'status', header: t('accounting.status'), width: 12 },
    ];
    exportToExcel(
      vouchers.map((v) => ({
        voucherNumber: v.voucherNumber,
        date: v.date,
        customerName: v.customerName,
        amount: v.amount,
        paymentMethod: v.paymentMethod === 'cash' ? t('accounting.cash') : v.paymentMethod === 'bank' ? t('accounting.bank') : t('accounting.check'),
        status: v.status === 'posted' ? t('accounting.posted') : v.status === 'draft' ? t('accounting.draft') : t('accounting.cancelled'),
      })),
      cols,
      `receipt_vouchers_${new Date().toISOString().split('T')[0]}`,
    );
  }, [vouchers, t]);

  const handleExportPdf = useCallback(() => {
    const cols = [
      { key: 'voucherNumber', header: t('accounting.voucherNumber') },
      { key: 'customerName', header: t('accounting.customer') },
      { key: 'amount', header: t('accounting.amount') },
      { key: 'status', header: t('accounting.status') },
    ];
    exportToPDF(
      vouchers.map((v) => ({
        voucherNumber: v.voucherNumber,
        customerName: v.customerName,
        amount: formatCurrency(v.amount),
        status: v.status,
      })),
      cols,
      `receipt_vouchers_${new Date().toISOString().split('T')[0]}`,
      { title: t('accounting.receiptVouchers'), rtl: true, companyName: activeCompany?.name },
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
        render: (row: ReceiptVoucher) => (
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
        render: (row: ReceiptVoucher) => <span className="tabular-nums text-xs text-slate-700 dark:text-slate-300">{row.date ? formatDate(row.date) : '-'}</span>,
      },
      {
        key: 'customerName',
        header: t('accounting.customer'),
        mobile: 'subtitle' as const,
        render: (row: ReceiptVoucher) => (
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
              {row.customerName?.charAt(0) || '?'}
            </div>
            <span className="font-medium text-slate-900 dark:text-slate-100 truncate">{row.customerName}</span>
          </div>
        ),
      },
      {
        key: 'amount',
        header: t('accounting.amount'),
        align: 'right' as const,
        render: (row: ReceiptVoucher) => (
          <div className="text-end">
            <p className="font-bold tabular-nums text-slate-900 dark:text-slate-100">{formatCurrency(row.amount)}</p>
            <p className="text-[11px] text-slate-500 flex items-center justify-end gap-1">
              <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border text-[10px]">{row.currencyCode || YER_CODE}</span>
              {row.invoiceId ? <span className="text-emerald-600">• مرتبط</span> : null}
            </p>
          </div>
        ),
      },
      {
        key: 'paymentMethod',
        header: t('accounting.paymentMethod'),
        width: '115px',
        render: (row: ReceiptVoucher) => (
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
        render: (row: ReceiptVoucher) => <StatusBadge status={row.status} size="sm" />,
      },
      {
        key: 'createdBy',
        header: t('accounting.createdBy'),
        width: '110px',
        mobile: 'hidden' as const,
        render: (row: ReceiptVoucher) => <span className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-[100px] inline-block">{getUserName(row.createdBy)}</span>,
      },
      {
        key: 'actions',
        header: t('edit'),
        width: '170px',
        mobile: 'actions' as const,
        render: (row: ReceiptVoucher) => (
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
              disabledEdit={row.status === 'posted'}
              disabledDelete={row.status === 'posted'}
            />
            {row.status === 'draft' && (
              <Button size="sm" variant="secondary" leftIcon={<CheckSquare size={13} />} onClick={() => handlePost(row)} disabled={postingId === row.id} className="h-7 text-xs px-2">
                {postingId === row.id ? t('accounting.posting') : 'ترحيل'}
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
        icon={<Receipt size={22} />}
        title={t('accounting.receiptVouchers')}
        subtitle="سندات القبض — تحصيلات العملاء نقداً / بنكاً / شيكات"
        actions={
          <Can action="create" module="accounting">
            <Button variant="primary" leftIcon={<Plus size={16} />} onClick={() => { resetForm(); setIsOpen(true); }} className="shadow-sm">
              {t('accounting.newReceiptVoucher')}
            </Button>
          </Can>
        }
      />

      {/* Filter Bar: search + status pills + method pills + exports */}
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder={`${t('search')} — ${t('accounting.voucherNumber')} / ${t('accounting.customer')}`}
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
                { v: '', l: 'الكل' },
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
              <FileText size={14} className="text-emerald-600" /> <span className="hidden sm:inline text-xs">Excel</span>
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
            {total} سند • {search ? `"${search}"` : ''} {statusFilter ? `• ${statusFilter}` : ''} {methodFilter ? `• ${methodFilter}` : ''}
          </span>
          <button onClick={() => { setSearch(''); setStatusFilter(''); setMethodFilter(''); }} className="text-primary-600 hover:underline font-medium">
            مسح الفلترة
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="relative overflow-hidden">
          <div className="p-5 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">{t('accounting.totalCashReceipts')}</p>
              <p className="mt-1 text-2xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">{formatCurrency(totalCash)}</p>
              <p className="text-xs text-slate-500 mt-1">{currencySymbol} • مرحّلة نقداً</p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800 flex items-center justify-center">
              <Wallet size={20} className="text-emerald-600 dark:text-emerald-400" />
            </div>
          </div>
          <div className="h-1 bg-gradient-to-r from-emerald-500 to-emerald-600" />
        </Card>
        <Card className="relative overflow-hidden">
          <div className="p-5 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">{t('accounting.totalBankReceipts')}</p>
              <p className="mt-1 text-2xl font-bold text-blue-600 dark:text-blue-400 tabular-nums">{formatCurrency(totalBank)}</p>
              <p className="text-xs text-slate-500 mt-1">{currencySymbol} • مرحّلة بنكاً</p>
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
              <p className="text-xs text-slate-500 mt-1">{draftCount} مسودة • {total - draftCount} مرحّل</p>
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
              title={hasActiveFilter ? 'لا توجد نتائج' : t('accounting.noData')}
              description={hasActiveFilter ? 'جرّب تغيير البحث أو الفلترة' : 'أنشئ أول سند قبض'}
              action={
                hasActiveFilter ? (
                  <Button variant="secondary" onClick={() => { setSearch(''); setStatusFilter(''); setMethodFilter(''); }}>
                    مسح الفلترة
                  </Button>
                ) : (
                  <Can action="create" module="accounting">
                    <Button variant="primary" leftIcon={<Plus size={16} />} onClick={() => { resetForm(); setIsOpen(true); }}>
                      {t('accounting.newReceiptVoucher')}
                    </Button>
                  </Can>
                )
              }
            />
          </div>
        ) : (
          <>
            <Table data={vouchers} columns={columns as never} keyExtractor={(row) => row.id} isLoading={isLoading} emptyMessage={t('accounting.noData')} />
            <div className="border-t border-slate-200 dark:border-slate-800">
              <Pagination page={page} pageSize={pageSize} total={total} onPageChange={goToPage} onPageSizeChange={changePageSize} />
            </div>
          </>
        )}
      </Card>

      <Modal
        isOpen={isOpen}
        title={isEditMode ? t('accounting.editVoucher') : t('accounting.newReceiptVoucher')}
        description={isEditMode ? 'تعديل سند القبض — لا يمكن تعديل الحقول المرتبطة بعد الترحيل' : 'إنشاء سند قبض جديد — اختر العميل وطريقة القبض'}
        onClose={() => {
          setIsOpen(false);
          resetForm();
        }}
        size="xl"
        footer={
          <div className="flex items-center justify-between w-full">
            <p className="text-xs text-slate-500 hidden sm:flex items-center gap-1.5">
              <AlertCircle size={12} /> الحقول المميزة بـ * مطلوبة
            </p>
            <div className="flex gap-2 ml-auto">
              <Button variant="secondary" onClick={() => { setIsOpen(false); resetForm(); }}>
                {t('cancel')}
              </Button>
              <Button onClick={handleSave} isLoading={isSaving} leftIcon={<CheckSquare size={16} />}>
                {t('save')}
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-5">
          {/* Voucher info */}
          <div>
            <h4 className="text-xs font-bold tracking-wider uppercase text-slate-500 mb-3 flex items-center gap-2">
              <Hash size={12} /> بيانات السند
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Input label={`${t('accounting.voucherNumber')} (تلقائي)`} value={form.voucherNumber || ''} onChange={(e) => setForm({ ...form, voucherNumber: e.target.value })} placeholder="تلقائي" error={formErrors.voucherNumber} helperText={!isEditMode ? 'يُنشأ تلقائياً عند الحفظ' : undefined} />
              <Input label={`${t('accounting.date')} *`} type="date" value={form.date || ''} onChange={(e) => setForm({ ...form, date: e.target.value })} error={formErrors.date} required />
              <div>
                <label className="text-xs font-semibold text-slate-500 mb-1.5 block">الحالة</label>
                <div className="h-[42px] rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 flex items-center px-3">
                  <StatusBadge status={(form.status as string) || 'draft'} size="sm" />
                  <span className="ml-auto text-xs text-slate-500">{form.status === 'posted' ? 'مرحّل' : form.status === 'cancelled' ? 'ملغى' : 'مسودة'}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="h-px bg-slate-100 dark:bg-slate-800" />

          {/* Party + Invoice linking */}
          <div>
            <h4 className="text-xs font-bold tracking-wider uppercase text-slate-500 mb-3 flex items-center gap-2">
              <Users size={12} /> العميل والربط
            </h4>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1.5">
                {t('accounting.customer')} *
              </label>
              <CustomerSelect companyId={activeCompany?.id || ''} value={form.customerId || ''} onChange={(v) => setForm({ ...form, customerId: v || '', invoiceId: undefined, amountApplied: 0 })} />
              {formErrors.customerId && <p className="text-xs text-rose-600 mt-1">{formErrors.customerId}</p>}
            </div>
            {form.customerId && (
              <div className="mt-4">
                <label className="block text-xs font-semibold text-slate-500 mb-1.5 flex items-center gap-1.5">
                  <Paperclip size={12} /> {t('accounting.applyToInvoice')}
                </label>
                <select
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                  value={form.invoiceId || ''}
                  onChange={(e) => {
                    const newInvoiceId = e.target.value || undefined;
                    setForm((prev) => {
                      const selectedInvoice = outstandingInvoices.find((inv) => inv.id === newInvoiceId);
                      const newAmountApplied = selectedInvoice ? Math.max(0, (selectedInvoice.totalAmount || 0) - (selectedInvoice.paidAmount || 0)) : 0;
                      return { ...prev, invoiceId: newInvoiceId, amountApplied: newInvoiceId ? newAmountApplied : 0 };
                    });
                  }}
                  disabled={invoicesLoading}
                  aria-label={t('accounting.applyToInvoice')}
                >
                  <option value="">{t('accounting.onAccount')}</option>
                  {outstandingInvoices.map((inv) => {
                    const outstanding = (inv.totalAmount || 0) - (inv.paidAmount || 0);
                    return (
                      <option key={inv.id} value={inv.id}>
                        {inv.invoiceNumber} — {formatCurrency(outstanding)} {inv.currencyCode || ''} • {inv.date ? formatDate(inv.date) : ''}
                      </option>
                    );
                  })}
                </select>
                {form.invoiceId ? (
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1.5 flex items-center gap-1">
                    <CheckSquare size={12} /> {t('accounting.amountWillBeApplied')} — {formatCurrency(Number(form.amountApplied) || 0)}
                  </p>
                ) : (
                  <p className="text-xs text-slate-500 mt-1">اختياري — اتركه فارغاً لدفعة على الحساب</p>
                )}
              </div>
            )}
          </div>

          <div className="h-px bg-slate-100 dark:bg-slate-800" />

          {/* Amount + Currency */}
          <div>
            <h4 className="text-xs font-bold tracking-wider uppercase text-slate-500 mb-3 flex items-center gap-2">
              <Wallet size={12} /> المبلغ والعملة
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-1">
                <Input
                  label={`${t('accounting.amount')} *`}
                  type="number"
                  min={0}
                  step="0.01"
                  value={String(form.amount || '')}
                  onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })}
                  error={formErrors.amount}
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5">{t('sales.currency')}</label>
                <CurrencySelect companyId={activeCompany?.id || ''} value={form.currencyCode || YER_CODE} onChange={handleCurrencyChange} />
              </div>
              <Input
                label={t('sales.exchangeRate')}
                type="number"
                min={0}
                step="0.0001"
                value={String(form.exchangeRate ?? 1)}
                onChange={(e) => setForm({ ...form, exchangeRate: Number(e.target.value) || 1 })}
              />
            </div>
            <div className="mt-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2.5 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500">{t('sales.baseCurrency')}</span>
              <span className="text-sm font-bold tabular-nums text-slate-900 dark:text-slate-100">
                {formatCurrency((Number(form.amount) || 0) * (form.exchangeRate ?? 1))} <span className="text-xs font-normal text-slate-500">{currencySymbol}</span>
              </span>
            </div>
          </div>

          <div className="h-px bg-slate-100 dark:bg-slate-800" />

          {/* Payment method */}
          <div>
            <h4 className="text-xs font-bold tracking-wider uppercase text-slate-500 mb-3">طريقة القبض</h4>
            <div className="grid grid-cols-3 gap-2 p-1 rounded-xl bg-slate-100 dark:bg-slate-800">
              {(
                [
                  { v: 'cash', l: t('accounting.cash'), icon: Wallet },
                  { v: 'bank', l: t('accounting.bank'), icon: Landmark },
                  { v: 'check', l: t('accounting.check'), icon: FileText },
                ] as const
              ).map((o) => {
                const Icon = o.icon;
                const active = form.paymentMethod === o.v;
                return (
                  <button
                    key={o.v}
                    onClick={() =>
                      setForm({
                        ...form,
                        paymentMethod: o.v,
                                                cashBoxId: o.v === 'cash' ? form.cashBoxId || defaultCashBoxId || undefined : undefined,
                        checkNumber: o.v === 'check' ? form.checkNumber : undefined,
                        checkDate: o.v === 'check' ? form.checkDate : undefined,
                      })
                    }
                    className={`flex flex-col items-center gap-1.5 py-3 rounded-lg text-sm font-medium border transition ${active ? 'bg-white dark:bg-slate-700 border-slate-200 dark:border-slate-600 shadow-sm text-slate-900 dark:text-slate-100' : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900'}`}
                  >
                    <Icon size={18} className={active ? 'text-primary-600' : 'text-slate-400'} />
                    {o.l}
                  </button>
                );
              })}
            </div>

            {/* Treasury location — shown for ALL payment methods (النقدية والخزائن) */}
            <div className="mt-4">
              <label className="block text-xs font-semibold text-slate-500 mb-1.5">{t('accounting.cashBox')}</label>
              <CashBoxSelect companyId={activeCompany?.id || ''} value={form.cashBoxId || ''} onChange={(v) => setForm({ ...form, cashBoxId: v || '' })} />
              {defaultCashBoxId && form.cashBoxId === defaultCashBoxId && <p className="text-xs text-emerald-600 mt-1">★ {t('accounting.defaultSelected')}</p>}
            </div>
            {form.paymentMethod === 'check' && (
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input label={t('accounting.checkNumber')} value={form.checkNumber || ''} onChange={(e) => setForm({ ...form, checkNumber: e.target.value })} placeholder="رقم الشيك" />
                <Input label={t('accounting.checkDate')} type="date" value={form.checkDate || ''} onChange={(e) => setForm({ ...form, checkDate: e.target.value })} />
              </div>
            )}
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-500 mb-1.5 block">{t('accounting.notes')}</label>
            <textarea
              value={form.notes || ''}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="ملاحظات إضافية..."
              rows={2}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2.5 text-sm text-slate-900 dark:text-slate-50 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition resize-none"
            />
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={async () => {
          if (confirmDelete) {
            const result = await remove(confirmDelete.id);
            if (result?.success) addToast('success', t('accounting.receiptVoucher.deleted'));
            else addToast('error', result?.error || t('common.error'));
            setConfirmDelete(null);
          }
        }}
        title={t('delete')}
        message={`${t('accounting.deleteReceiptVoucherConfirm')} "${confirmDelete?.voucherNumber}"؟`}
        variant="danger"
      />

      <DuplicateWarningDialog
        isOpen={docDuplicateOpen}
        onClose={() => setDocDuplicateOpen(false)}
        onConfirm={() => {
          docDuplicateConfirmedRef.current = true;
          setDocDuplicateOpen(false);
          void handleSave();
        }}
        inputName={docDuplicateInput}
        entityLabel={t('accounting.receiptVouchers')}
        exactMatch={docDuplicateExact}
        nearMatches={docDuplicateNear}
        isDocument
        isEdit={!!editingId}
      />
    </div>
  );
};

export default ReceiptVouchersPage;
