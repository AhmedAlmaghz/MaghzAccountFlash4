import React, { useState, useMemo, useCallback, useRef } from 'react';
import {
  Users,
  Plus,
  Phone,
  Mail,
  MapPin,
  FileText,
  Receipt,
  Wallet,
  UserCheck,
  Hash,
  Info,
  Clock,
  TrendingUp,
  AlertCircle,
} from 'lucide-react';
import { Card, Button, Table, Input, Modal, PageHeader, FilterBar } from '@/core/ui/components';
import { ConfirmDialog } from '@/core/ui/components/ConfirmDialog';
import { DuplicateWarningDialog } from '@/core/ui/components/DuplicateWarningDialog';
import { detectDuplicates } from '@/core/utils/duplicateDetection';
import { StatusBadge } from '@/core/ui/components/StatusBadge';
import { ActionButtons } from '@/core/ui/components/ActionButtons';
import { EmptyState } from '@/core/ui/components/EmptyState';
import { Pagination } from '@/core/ui/components/Pagination';
import { Badge } from '@/core/ui/components/Badge';
import { useCustomersPaginated, useCustomerStatement, useCustomerArAging } from '../hooks/useSales';
import { useAppStore } from '@/core/store';
import { useAuthStore } from '@/modules/auth/store';
import { useTranslation } from '@/core/i18n/useTranslation';
import { exportToExcel, exportToPDF } from '@/core/utils/exportEngine';
import { printDocument } from '@/core/utils/printDocument';
import { salesApi } from '../api';
import { useFormatters } from '@/core/utils/useFormatters';
import { YER_CODE } from '@/core/utils/currencyConverter';
import { useDocumentSequence } from '@/core/utils/useDocumentSequence';
import { logAudit } from '@/core/utils/auditLogger';
import type { Customer, CustomerStatementRow } from '../types';
import { Can } from '@/core/ui/components/PermissionGate';
import { useToastStore } from '@/core/store/toastStore';

type TabKey = 'details' | 'statement' | 'aging';
type FormErrors = Partial<Record<'name' | 'phone' | 'email' | 'code', string>>;

export const CustomersPage: React.FC = () => {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const activeCompany = useAppStore((state) => state.activeCompany);
  const { formatCurrency } = useFormatters(activeCompany?.id || '');
  const currentUser = useAuthStore((state) => state.user);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const customerFilters = useMemo(
    () => ({
      search: search || undefined,
      isActive: statusFilter === 'all' ? undefined : statusFilter === 'active',
    }),
    [search, statusFilter],
  );
  const {
    customers,
    total,
    page,
    pageSize,
    isLoading,
    goToPage,
    changePageSize,
    create,
    update,
    remove,
  } = useCustomersPaginated(activeCompany?.id || '', customerFilters);
  const { data: arAging, reload: reloadAging } = useCustomerArAging(activeCompany?.id || '');

  const [formOpen, setFormOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Customer | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('details');

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmConfig, setConfirmConfig] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
    variant?: 'danger' | 'warning' | 'info';
  } | null>(null);

  const [formData, setFormData] = useState({
    code: '',
    name: '',
    phone: '',
    email: '',
    address: '',
    taxNumber: '',
    creditLimit: '',
    openingBalance: '',
    openingDate: '',
    isActive: true,
  });
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);
  const { getNextNumber } = useDocumentSequence();

  // Duplicate guard — يمنع صمت التكرار
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [duplicateInputName, setDuplicateInputName] = useState('');
  const [duplicateExact, setDuplicateExact] = useState<{ name: string; code?: string } | null>(null);
  const [duplicateNear, setDuplicateNear] = useState<Array<{ name: string; code?: string; score: number }>>([]);
  const duplicateConfirmedRef = useRef(false);

  const resetForm = useCallback(() => {
    setFormData({ code: '', name: '', phone: '', email: '', address: '', taxNumber: '', creditLimit: '', openingBalance: '', openingDate: '', isActive: true });
    setFormErrors({});
    setEditingId(null);
  }, []);

  const validateForm = useCallback((): boolean => {
    const errors: FormErrors = {};
    if (!formData.name.trim()) errors.name = t('validation.required') || 'مطلوب';
    if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) errors.email = 'بريد إلكتروني غير صحيح';
    if (formData.phone && formData.phone.length < 7) errors.phone = 'رقم هاتف غير صحيح';
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  }, [formData, t]);

  const openCreate = async () => {
    resetForm();
    if (activeCompany) {
      const seq = await getNextNumber('customer', activeCompany.id);
      if (seq?.number) setFormData((prev) => ({ ...prev, code: seq.number || '' }));
    }
    setFormOpen(true);
  };
  const openEdit = (c: Customer) => {
    setEditingId(c.id);
    setFormData({
      code: c.code || '',
      name: c.name,
      phone: c.phone || '',
      email: c.email || '',
      address: c.address || '',
      taxNumber: c.taxNumber || '',
      creditLimit: String(c.creditLimit || ''),
      openingBalance: c.openingBalancePosted ? String(c.openingBalance || '') : '',
      openingDate: c.openingDate ? String(c.openingDate).slice(0, 10) : '',
      isActive: c.isActive,
    });
    setFormErrors({});
    setFormOpen(true);
  };

  const openDetail = async (c: Customer) => {
    setViewing(c);
    setActiveTab('details');
    setDetailOpen(true);
    await reloadAging();
  };

  const handleSave = async () => {
    if (!activeCompany) return;
    if (!validateForm()) {
      addToast('error', t('validation.required') || 'يرجى تصحيح الحقول المطلوبة');
      return;
    }
    const inputName = formData.name.trim();
    if (!duplicateConfirmedRef.current && inputName) {
      try {
        const allRes = await salesApi.getCustomers(activeCompany.id);
        if (allRes.success && allRes.data) {
          const result = detectDuplicates(inputName, allRes.data as Customer[], (c) => c.name, {
            excludeId: editingId || undefined,
            getId: (c) => c.id,
            getCode: (c) => c.code,
            nearThreshold: 0.85,
          });
          if (result.exactMatch) {
            setDuplicateInputName(inputName);
            setDuplicateExact({ name: result.exactMatch.matchedName, code: result.exactMatch.matchedCode });
            setDuplicateNear([]);
            setDuplicateOpen(true);
            return;
          }
          if (result.nearMatches.length > 0) {
            setDuplicateInputName(inputName);
            setDuplicateExact(null);
            setDuplicateNear(result.nearMatches.map((m) => ({ name: m.matchedName, code: m.matchedCode, score: m.score })));
            setDuplicateOpen(true);
            return;
          }
        }
      } catch {
        /* فشل الفحص لا يمنع الحفظ */
      }
    }
    duplicateConfirmedRef.current = false;
    setSaving(true);
    const payload = {
      companyId: activeCompany.id,
      code: formData.code?.trim() || undefined,
      name: formData.name.trim(),
      phone: formData.phone?.trim() || undefined,
      email: formData.email?.trim() || undefined,
      address: formData.address?.trim() || undefined,
      taxNumber: formData.taxNumber?.trim() || undefined,
      creditLimit: Number(formData.creditLimit) || 0,
      balance: 0,
      openingBalance: editingId ? undefined : (Number(formData.openingBalance) || 0),
      openingDate: editingId ? undefined : (formData.openingDate?.trim() || undefined),
      isActive: formData.isActive,
    };
    try {
      if (editingId) {
        const res = await update(editingId, { ...payload, balance: undefined });
        if (res.success && activeCompany.id) {
          await logAudit({
            userId: currentUser?.id || 'system',
            action: 'update',
            tableName: 'customers',
            recordId: editingId,
            companyId: activeCompany.id,
            newValues: payload,
          });
          addToast('success', t('sales.customer.updated'));
          setFormOpen(false);
          resetForm();
        } else {
          addToast('error', res.error || t('error'));
        }
      } else {
        const res = await create(payload);
        if (res.success && res.id && activeCompany.id) {
          await logAudit({
            userId: currentUser?.id || 'system',
            action: 'create',
            tableName: 'customers',
            recordId: res.id,
            companyId: activeCompany.id,
            newValues: payload,
          });
          addToast('success', t('sales.customer.created'));
          setFormOpen(false);
          resetForm();
        } else {
          addToast('error', res.error || t('error'));
        }
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (c: Customer) => {
    setConfirmConfig({
      title: t('sales.customer.deleteTitle'),
      message: `${t('sales.customer.deleteConfirm')} "${c.name}"؟`,
      variant: 'danger',
      onConfirm: async () => {
        setConfirmOpen(false);
        const res = await remove(c.id);
        if (res.success && activeCompany?.id) {
          await logAudit({
            userId: currentUser?.id || 'system',
            action: 'delete',
            tableName: 'customers',
            recordId: c.id,
            companyId: activeCompany.id,
          });
          addToast('success', t('sales.customer.deleted'));
        } else {
          addToast('error', res.error || t('error'));
        }
      },
    });
    setConfirmOpen(true);
  };

  const handlePrintStatement = async (c: Customer) => {
    try {
      if (!activeCompany) return;
      const res = await salesApi.getCustomerStatement(c.id, activeCompany?.id);
      if (!res.success || !res.data) {
        addToast('error', res.error || t('error'));
        return;
      }
      const statementLines = (res.data as CustomerStatementRow[]).map((r) => ({
        date: typeof r.date === 'string' && r.date.length > 10 ? r.date.slice(0, 10) : r.date || '',
        docNumber: String(r.documentNumber || ''),
        description: r.documentType + (r.notes ? ' - ' + r.notes : ''),
        debit: r.debit || 0,
        credit: r.credit || 0,
        balance: r.balance || 0,
      }));
      const totalDebit = statementLines.reduce((s, l) => s + l.debit, 0);
      const totalCredit = statementLines.reduce((s, l) => s + l.credit, 0);
      const closingBalance = statementLines.length > 0 ? statementLines[statementLines.length - 1].balance : 0;
      printDocument({
        type: 'statement',
        docNumber: c.code || c.id.slice(0, 8),
        date: new Date().toISOString().split('T')[0],
        partyName: c.name,
        partyLabel: t('sales.customer.title'),
        partyTaxNumber: c.taxNumber,
        partyAddress: c.address,
        lines: [],
        statementLines,
        subtotal: totalDebit,
        vatAmount: totalCredit,
        totalAmount: closingBalance,
        companyName: activeCompany.name,
        companyTaxNumber: activeCompany.taxNumber,
        companyPhone: activeCompany.phone,
        companyAddress: activeCompany.address,
        currency: activeCompany.currency || YER_CODE,
      });
    } catch (err) {
      addToast('error', String(err));
    }
  };

  const handleExportExcel = useCallback(() => {
    const cols = [
      { key: 'code', header: t('sales.customer.code'), width: 14 },
      { key: 'name', header: t('sales.customer.name'), width: 26 },
      { key: 'phone', header: t('sales.customer.phone'), width: 16 },
      { key: 'email', header: t('sales.customer.email'), width: 22 },
      { key: 'address', header: t('sales.customer.address'), width: 28 },
      { key: 'balance', header: t('accounting.balance'), width: 16 },
      { key: 'isActive', header: t('sales.customer.isActive'), width: 12 },
    ];
    exportToExcel(
      customers.map((c) => ({
        code: c.code || '-',
        name: c.name,
        phone: c.phone || '-',
        email: c.email || '-',
        address: c.address || '-',
        balance: Number(c.balance) || 0,
        isActive: c.isActive ? t('settings.common.active') : t('settings.common.inactive'),
      })),
      cols,
      `customers_${new Date().toISOString().split('T')[0]}`,
    );
  }, [customers, t]);

  const handleExportPdf = useCallback(() => {
    const cols = [
      { key: 'name', header: t('sales.customer.name') },
      { key: 'phone', header: t('sales.customer.phone') },
      { key: 'balance', header: t('accounting.balance') },
      { key: 'isActive', header: t('sales.customer.isActive') },
    ];
    exportToPDF(
      customers.map((c) => ({
        name: c.name,
        phone: c.phone || '-',
        balance: formatCurrency(Number(c.balance) || 0),
        isActive: c.isActive ? t('settings.common.active') : t('settings.common.inactive'),
      })),
      cols,
      `customers_${new Date().toISOString().split('T')[0]}`,
      { title: t('sales.customers'), rtl: true, companyName: activeCompany?.name },
    );
  }, [customers, t, formatCurrency, activeCompany?.name]);

  const customerColumns = useMemo(
    () => [
      {
        key: 'code',
        header: t('sales.customer.code'),
        width: '110px',
        mobile: 'hidden' as const,
        render: (row: Customer) => (
          <span className="inline-flex items-center gap-1.5 font-mono text-xs font-medium text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800 px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700">
            <Hash size={12} className="text-slate-400" />
            {row.code || '-'}
          </span>
        ),
      },
      {
        key: 'name',
        header: t('sales.customer.name'),
        mobile: 'title' as const,
        render: (row: Customer) => (
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary-500 to-primary-600 dark:from-primary-600 dark:to-primary-700 flex items-center justify-center text-white font-bold text-sm shadow-sm shrink-0">
              {row.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-slate-900 dark:text-slate-100 truncate">{row.name}</p>
              {row.taxNumber && <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{row.taxNumber}</p>}
            </div>
          </div>
        ),
      },
      {
        key: 'phone',
        header: t('sales.customer.phone'),
        mobile: 'subtitle' as const,
        render: (row: Customer) =>
          row.phone ? (
            <span className="inline-flex items-center gap-1.5 text-sm text-slate-700 dark:text-slate-300">
              <span className="w-7 h-7 rounded-full bg-emerald-50 dark:bg-emerald-900/30 flex items-center justify-center shrink-0">
                <Phone size={13} className="text-emerald-600 dark:text-emerald-400" />
              </span>
              <span className="truncate" dir="ltr">
                {row.phone}
              </span>
            </span>
          ) : (
            <span className="text-slate-400 text-sm">-</span>
          ),
      },
      {
        key: 'email',
        header: t('sales.customer.email'),
        render: (row: Customer) =>
          row.email ? (
            <span className="inline-flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300 max-w-[180px]">
              <Mail size={13} className="text-slate-400 shrink-0" />
              <span className="truncate">{row.email}</span>
            </span>
          ) : (
            <span className="text-slate-400 text-sm">-</span>
          ),
      },
      {
        key: 'balance',
        header: t('accounting.balance'),
        align: 'right' as const,
        render: (row: Customer) => {
          const bal = Number(row.balance) || 0;
          const isDebit = bal > 0;
          const isCredit = bal < 0;
          return (
            <div className="text-end">
              <span
                className={`inline-flex items-center gap-1 font-semibold tabular-nums px-2.5 py-1 rounded-full text-sm border ${
                  isDebit
                    ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800'
                    : isCredit
                      ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                      : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                }`}
              >
                {isDebit && <TrendingUp size={12} />}
                {formatCurrency(bal)}
              </span>
              {bal !== 0 && (
                <p className={`text-[11px] mt-0.5 ${isDebit ? 'text-amber-600' : 'text-emerald-600'}`}>{isDebit ? 'مدين' : 'دائن'}</p>
              )}
            </div>
          );
        },
      },
      {
        key: 'isActive',
        header: t('sales.customer.isActive'),
        width: '110px',
        render: (row: Customer) => <StatusBadge status={row.isActive ? 'active' : 'inactive'} />,
      },
      {
        key: 'actions',
        header: t('sales.actions'),
        width: '150px',
        mobile: 'actions' as const,
        render: (row: Customer) => (
          <ActionButtons
            onView={() => openDetail(row)}
            onEdit={() => openEdit(row)}
            onDelete={() => handleDelete(row)}
            onPrint={() => handlePrintStatement(row)}
            showView
            showEdit
            showDelete
            showPrint
          />
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, formatCurrency],
  );

  const totalBalance = useMemo(() => customers.reduce((s, c) => s + (Number(c.balance) || 0), 0), [customers]);
  // Receivable (positive balances) vs credit (negative) — the CURRENT NET
  // balance is what matters; debit/credit are shown as a breakdown, never
  // summed together (summing cancels real receivables).
  const receivableTotal = useMemo(() => customers.reduce((s, c) => s + Math.max(0, Number(c.balance) || 0), 0), [customers]);
  const creditTotal = useMemo(() => customers.reduce((s, c) => s + Math.abs(Math.min(0, Number(c.balance) || 0)), 0), [customers]);
  const activeCount = useMemo(() => customers.filter((c) => c.isActive).length, [customers]);
  const inactiveCount = total - activeCount;
  const hasActiveFilter = search.trim().length > 0 || statusFilter !== 'all';

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <PageHeader
          icon={<Users size={22} />}
          title={t('sales.customers')}
          subtitle={t('sales.customersSubtitle')}
          actions={
            <Can action="create" module="sales">
              <Button variant="primary" leftIcon={<Plus size={16} />} onClick={openCreate} className="shadow-sm">
                {t('sales.customer.create')}
              </Button>
            </Can>
          }
        />

        {/* Toolbar */}
        <div>
          <FilterBar
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder={`${t('search')} — ${t('sales.customer.name')} / ${t('sales.customer.phone')} / ${t('sales.customer.code')}`}
            filterOptions={[
              { key: 'all', label: t('purchases.filter.all') || 'الكل' },
              { key: 'active', label: t('settings.common.active') },
              { key: 'inactive', label: t('settings.common.inactive') },
            ]}
            activeFilter={statusFilter}
            onFilterChange={(key) => setStatusFilter(key as 'all' | 'active' | 'inactive')}
            actions={
              <>
                <Button size="sm" variant="ghost" onClick={handleExportExcel} title={t('export')} className="gap-1.5">
                  <FileText size={15} className="text-emerald-600" />
                  <span className="hidden sm:inline text-xs">Excel</span>
                </Button>
                <Button size="sm" variant="ghost" onClick={handleExportPdf} title={t('export')} className="gap-1.5">
                  <Receipt size={15} className="text-rose-600" />
                  <span className="hidden sm:inline text-xs">PDF</span>
                </Button>
              </>
            }
          />
          {hasActiveFilter && (
            <div className="mt-3 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span>
                {total} {t('sales.customer.invoices')} • {search ? `"${search}"` : ''} {statusFilter !== 'all' ? `• ${statusFilter === 'active' ? t('settings.common.active') : t('settings.common.inactive')}` : ''}
              </span>
              <button onClick={() => { setSearch(''); setStatusFilter('all'); }} className="text-primary-600 hover:underline font-medium">
                مسح الفلترة
              </button>
            </div>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="relative overflow-hidden">
          <div className="p-5 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold tracking-wider uppercase text-slate-500 dark:text-slate-400">{t('sales.customer.total')}</p>
              <p className="mt-1 text-3xl font-bold text-slate-900 dark:text-slate-50 tabular-nums">{total}</p>
              <p className="mt-1 text-xs text-slate-500">
                {activeCount} نشط • {inactiveCount} غير نشط
              </p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-primary-50 dark:bg-primary-900/30 border border-primary-100 dark:border-primary-800 flex items-center justify-center">
              <Users size={20} className="text-primary-600 dark:text-primary-400" />
            </div>
          </div>
          <div className="h-1 bg-gradient-to-r from-primary-500 to-primary-600" />
        </Card>
        <Card className="relative overflow-hidden">
          <div className="p-5 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold tracking-wider uppercase text-slate-500 dark:text-slate-400">{t('sales.customer.active')}</p>
              <p className="mt-1 text-3xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">{activeCount}</p>
              <p className="mt-1 text-xs text-slate-500">من إجمالي {total}</p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800 flex items-center justify-center">
              <UserCheck size={20} className="text-emerald-600 dark:text-emerald-400" />
            </div>
          </div>
          <div className="h-1 bg-gradient-to-r from-emerald-500 to-emerald-600" />
        </Card>
        <Card className="relative overflow-hidden">
          <div className="p-5 flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold tracking-wider uppercase text-slate-500 dark:text-slate-400">{t('sales.customer.totalBalance')}</p>
              <p
                className={`mt-1 text-2xl font-bold tabular-nums truncate ${totalBalance > 0 ? 'text-amber-600 dark:text-amber-400' : totalBalance < 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-900 dark:text-slate-50'}`}
                title={formatCurrency(totalBalance)}
              >
                {formatCurrency(totalBalance)}
              </p>
              <p className="mt-1 text-xs text-slate-500 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="inline-flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                  مدين: <span className="font-semibold tabular-nums">{formatCurrency(receivableTotal)}</span>
                </span>
                {creditTotal > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    دائن: <span className="font-semibold tabular-nums">{formatCurrency(creditTotal)}</span>
                  </span>
                )}
              </p>
            </div>
            <div
              className={`w-12 h-12 rounded-xl border flex items-center justify-center shrink-0 ml-3 ${totalBalance > 0 ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-100 dark:border-amber-800' : totalBalance < 0 ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-100 dark:border-emerald-800' : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700'}`}
            >
              <Wallet size={20} className={totalBalance > 0 ? 'text-amber-600 dark:text-amber-400' : totalBalance < 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500'} />
            </div>
          </div>
          <div className={`h-1 ${totalBalance > 0 ? 'bg-gradient-to-r from-amber-500 to-orange-500' : totalBalance < 0 ? 'bg-gradient-to-r from-emerald-500 to-emerald-600' : 'bg-slate-200 dark:bg-slate-700'}`} />
        </Card>
      </div>

      <Card noPadding>
        {isLoading ? (
          <div className="space-y-3 p-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-14 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : customers.length === 0 ? (
          <div className="py-8">
            <EmptyState
              icon={hasActiveFilter ? 'search' : 'inbox'}
              title={hasActiveFilter ? 'لا توجد نتائج' : t('sales.customer.emptyTitle')}
              description={hasActiveFilter ? 'جرّب تغيير كلمات البحث أو الفلترة' : t('sales.customer.emptyDesc')}
              action={
                hasActiveFilter ? (
                  <Button variant="secondary" onClick={() => { setSearch(''); setStatusFilter('all'); }}>
                    مسح الفلترة
                  </Button>
                ) : (
                  <Can action="create" module="sales">
                    <Button variant="primary" leftIcon={<Plus size={16} />} onClick={openCreate}>
                      {t('sales.customer.create')}
                    </Button>
                  </Can>
                )
              }
            />
          </div>
        ) : (
          <>
            <Table<Customer> data={customers} columns={customerColumns} keyExtractor={(row, i) => row.id || String(i)} isLoading={isLoading} />
            <div className="border-t border-slate-200 dark:border-slate-800">
              <Pagination page={page} pageSize={pageSize} total={total} onPageChange={goToPage} onPageSizeChange={changePageSize} />
            </div>
          </>
        )}
      </Card>

      {/* Form Modal */}
      <Modal
        isOpen={formOpen}
        onClose={() => {
          setFormOpen(false);
          resetForm();
        }}
        size="lg"
        title={editingId ? t('sales.customer.edit') : t('sales.customer.new')}
        description={editingId ? 'تعديل بيانات العميل' : 'إضافة عميل جديد — الحقول المميزة بـ * مطلوبة'}
        footer={
          <div className="flex items-center justify-between w-full">
            <p className="text-xs text-slate-500 hidden sm:block">* حقول مطلوبة</p>
            <div className="flex gap-2 ml-auto">
              <Button
                variant="secondary"
                onClick={() => {
                  setFormOpen(false);
                  resetForm();
                }}
              >
                {t('cancel')}
              </Button>
              <Button onClick={handleSave} isLoading={saving} leftIcon={<Plus size={16} />}>
                {editingId ? t('save') : t('create')}
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-5">
          {/* Basic */}
          <div>
            <h4 className="text-xs font-bold tracking-wider uppercase text-slate-500 dark:text-slate-400 mb-3 flex items-center gap-2">
              <Hash size={12} /> البيانات الأساسية
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Input
                label={`${t('sales.customer.code')} (${t('optional')})`}
                value={formData.code}
                onChange={(e) => setFormData((p) => ({ ...p, code: e.target.value }))}
                placeholder="CUST-001"
                error={formErrors.code}
                helperText={!formErrors.code ? 'يُنشأ تلقائياً إن تُرك فارغاً' : undefined}
              />
              <div className="sm:col-span-2">
                <Input
                  label={`${t('sales.customer.name')} *`}
                  value={formData.name}
                  onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
                  placeholder="مثال: شركة الأمل للتجارة"
                  error={formErrors.name}
                  required
                />
              </div>
            </div>
          </div>

          <div className="h-px bg-slate-100 dark:bg-slate-800" />

          {/* Contact */}
          <div>
            <h4 className="text-xs font-bold tracking-wider uppercase text-slate-500 dark:text-slate-400 mb-3 flex items-center gap-2">
              <Phone size={12} /> التواصل
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label={t('sales.customer.phone')}
                value={formData.phone}
                onChange={(e) => setFormData((p) => ({ ...p, phone: e.target.value }))}
                placeholder="77xxxxxxx"
                leftIcon={<Phone size={14} />}
                error={formErrors.phone}
                dir="ltr"
              />
              <Input
                label={t('sales.customer.email')}
                type="email"
                value={formData.email}
                onChange={(e) => setFormData((p) => ({ ...p, email: e.target.value }))}
                placeholder="name@company.com"
                leftIcon={<Mail size={14} />}
                error={formErrors.email}
                dir="ltr"
              />
            </div>
            <div className="mt-4">
              <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1.5 mb-1.5">
                <MapPin size={12} /> {t('sales.customer.address')}
              </label>
              <textarea
                value={formData.address}
                onChange={(e) => setFormData((p) => ({ ...p, address: e.target.value }))}
                placeholder="العنوان التفصيلي..."
                rows={2}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2.5 text-sm text-slate-900 dark:text-slate-50 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition resize-none"
              />
            </div>
          </div>

          <div className="h-px bg-slate-100 dark:bg-slate-800" />

          {/* Financial */}
          <div>
            <h4 className="text-xs font-bold tracking-wider uppercase text-slate-500 dark:text-slate-400 mb-3 flex items-center gap-2">
              <Wallet size={12} /> البيانات المالية والحالة
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label={t('sales.customer.taxNumber')}
                value={formData.taxNumber}
                onChange={(e) => setFormData((p) => ({ ...p, taxNumber: e.target.value }))}
                placeholder="الرقم الضريبي"
                dir="ltr"
              />
              <Input
                label={t('sales.customer.creditLimit')}
                type="number"
                min={0}
                step="0.01"
                value={formData.creditLimit}
                onChange={(e) => setFormData((p) => ({ ...p, creditLimit: e.target.value }))}
                placeholder="0.00"
                leftIcon={<span className="text-[11px] font-bold text-slate-400">{activeCompany?.currency || YER_CODE}</span>}
              />
              <Input
                label={t('openingBalance.title')}
                type="number"
                min={0}
                step="0.01"
                disabled={!!editingId}
                value={formData.openingBalance}
                onChange={(e) => setFormData((p) => ({ ...p, openingBalance: e.target.value }))}
                placeholder="0.00"
                helperText={editingId ? t('openingBalance.postedHint') : t('openingBalance.customerHint')}
                leftIcon={<span className="text-[11px] font-bold text-slate-400">{activeCompany?.currency || YER_CODE}</span>}
              />
              <Input
                label={t('openingBalance.dateLabel')}
                type="date"
                disabled={!!editingId}
                value={formData.openingDate}
                onChange={(e) => setFormData((p) => ({ ...p, openingDate: e.target.value }))}
                helperText={t('openingBalance.dateHint')}
              />
            </div>
            <label className="mt-4 flex items-center gap-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 px-3.5 py-3 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition">
              <input
                type="checkbox"
                checked={formData.isActive}
                onChange={(e) => setFormData((p) => ({ ...p, isActive: e.target.checked }))}
                className="w-4 h-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
              />
              <div>
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{t('sales.customer.isActive')}</p>
                <p className="text-xs text-slate-500">{formData.isActive ? 'العميل نشط ويمكن التعامل معه' : 'العميل موقوف مؤقتاً'}</p>
              </div>
              <Badge className={`ml-auto ${formData.isActive ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-slate-200 text-slate-600 border-slate-300'} border`}>{formData.isActive ? 'نشط' : 'موقوف'}</Badge>
            </label>
          </div>
        </div>
      </Modal>

      {/* Detail Modal */}
      <Modal
        isOpen={detailOpen}
        onClose={() => setDetailOpen(false)}
        size="xl"
        title={viewing ? `${t('sales.customer.card')} — ${viewing.name}` : ''}
        description={viewing ? `${viewing.code || ''} ${viewing.phone ? '• ' + viewing.phone : ''}` : undefined}
      >
        {viewing && (
          <div className="space-y-4">
            <div className="flex gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-800 w-fit">
              {(
                [
                  { key: 'details', label: t('sales.customer.details'), icon: Info },
                  { key: 'statement', label: t('sales.customer.statement'), icon: FileText },
                  { key: 'aging', label: t('sales.customer.aging'), icon: Clock },
                ] as { key: TabKey; label: string; icon: typeof Info }[]
              ).map((tab) => {
                const Icon = tab.icon;
                const active = activeTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                      active
                        ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm border border-slate-200 dark:border-slate-600'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    <Icon size={14} /> {tab.label}
                  </button>
                );
              })}
            </div>

            {activeTab === 'details' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card className="p-5 space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center text-white font-bold text-xl shadow">
                      {viewing.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-base font-bold text-slate-900 dark:text-slate-50 truncate">{viewing.name}</h3>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="font-mono text-xs bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700">{viewing.code || '-'}</span>
                        <StatusBadge status={viewing.isActive ? 'active' : 'inactive'} />
                      </div>
                    </div>
                  </div>
                  <div className="space-y-2.5 pt-3 border-t border-slate-100 dark:border-slate-800 text-sm">
                    <p className="flex items-center gap-2.5 text-slate-700 dark:text-slate-200">
                      <span className="w-8 h-8 rounded-full bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center shrink-0">
                        <Phone size={14} className="text-emerald-600" />
                      </span>
                      <span dir="ltr" className="tabular-nums">
                        {viewing.phone || '-'}
                      </span>
                    </p>
                    <p className="flex items-center gap-2.5 text-slate-700 dark:text-slate-200">
                      <span className="w-8 h-8 rounded-full bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center shrink-0">
                        <Mail size={14} className="text-blue-600" />
                      </span>
                      <span className="truncate">{viewing.email || '-'}</span>
                    </p>
                    <p className="flex items-start gap-2.5 text-slate-700 dark:text-slate-200">
                      <span className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0 mt-0.5">
                        <MapPin size={14} className="text-slate-500" />
                      </span>
                      <span className="flex-1 leading-relaxed">{viewing.address || '-'}</span>
                    </p>
                    <p className="flex items-center gap-2.5 text-slate-700 dark:text-slate-200">
                      <span className="w-8 h-8 rounded-full bg-amber-50 dark:bg-amber-900/20 flex items-center justify-center shrink-0">
                        <Receipt size={14} className="text-amber-600" />
                      </span>
                      {t('sales.customer.taxNumber')}: <span className="font-mono text-xs">{viewing.taxNumber || '-'}</span>
                    </p>
                  </div>
                </Card>
                <div className="space-y-4">
                  <Card className="p-5">
                    <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">{t('accounting.balance')}</p>
                    <p
                      className={`mt-1 text-3xl font-bold tabular-nums ${Number(viewing.balance) > 0 ? 'text-amber-600 dark:text-amber-400' : Number(viewing.balance) < 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-900 dark:text-slate-50'}`}
                    >
                      {formatCurrency(viewing.balance || 0)}{' '}
                      <span className="text-sm font-normal text-slate-500">{activeCompany?.currency || YER_CODE}</span>
                    </p>
                    {Number(viewing.openingBalance) > 0 && (
                      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                        {t('openingBalance.title')}: <span className="font-semibold tabular-nums">{formatCurrency(Number(viewing.openingBalance) || 0)}</span>
                      </p>
                    )}
                    {Number(viewing.balance) !== 0 && (
                      <span className={`inline-flex mt-2 text-xs px-2 py-1 rounded-full border ${Number(viewing.balance) > 0 ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-emerald-50 border-emerald-200 text-emerald-700'}`}>
                        {Number(viewing.balance) > 0 ? 'ذمة مدينة على العميل' : 'رصيد دائن للعميل'}
                      </span>
                    )}
                  </Card>
                  <Card className="p-5">
                    <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">{t('sales.customer.creditLimit')}</p>
                    <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-50 tabular-nums">
                      {formatCurrency(viewing.creditLimit || 0)} <span className="text-sm font-normal text-slate-500">{activeCompany?.currency || YER_CODE}</span>
                    </p>
                    {Number(viewing.creditLimit) > 0 && (
                      <div className="mt-3">
                        <div className="flex justify-between text-xs text-slate-500 mb-1">
                          <span>الاستهلاك</span>
                          <span>{Math.min(100, Math.round((Math.abs(Number(viewing.balance) || 0) / Number(viewing.creditLimit)) * 100))}%</span>
                        </div>
                        <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${Number(viewing.balance) > Number(viewing.creditLimit || 0) ? 'bg-rose-500' : Number(viewing.balance) > (Number(viewing.creditLimit || 0) * 0.8) ? 'bg-amber-500' : 'bg-emerald-500'}`}
                            style={{ width: `${Math.min(100, (Math.abs(Number(viewing.balance) || 0) / Number(viewing.creditLimit)) * 100)}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </Card>
                </div>
              </div>
            )}

            {activeTab === 'statement' && viewing && <CustomerStatementTab customerId={viewing.id} />}
            {activeTab === 'aging' && <CustomerAgingTab aging={arAging?.find((a) => a.customerId === viewing.id)} />}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => {
          confirmConfig?.onConfirm();
        }}
        title={confirmConfig?.title || ''}
        message={confirmConfig?.message || ''}
        variant={confirmConfig?.variant || 'danger'}
      />

      <DuplicateWarningDialog
        isOpen={duplicateOpen}
        onClose={() => setDuplicateOpen(false)}
        onConfirm={() => {
          duplicateConfirmedRef.current = true;
          setDuplicateOpen(false);
          void handleSave();
        }}
        inputName={duplicateInputName}
        entityLabel={t('sales.customer.title')}
        exactMatch={duplicateExact}
        nearMatches={duplicateNear}
        isEdit={!!editingId}
      />
    </div>
  );
};

function CustomerStatementTab({ customerId }: { customerId: string }) {
  const { t } = useTranslation();
  const activeCompany = useAppStore((state) => state.activeCompany);
  const { formatCurrency, formatDate } = useFormatters(activeCompany?.id || '');
  const { rows, isLoading } = useCustomerStatement(customerId, activeCompany?.id);

  const totals = useMemo(() => {
    const debit = rows.reduce((s, r) => s + (r.debit || 0), 0);
    const credit = rows.reduce((s, r) => s + (r.credit || 0), 0);
    const balance = rows.length ? rows[rows.length - 1].balance : 0;
    return { debit, credit, balance };
  }, [rows]);

  const columns = useMemo(
    () => [
      {
        key: 'date',
        header: t('sales.date'),
        width: '120px',
        render: (row: (typeof rows)[0]) => <span className="tabular-nums text-xs">{row.date ? formatDate(row.date) : '-'}</span>,
      },
      {
        key: 'documentType',
        header: t('sales.documentType'),
        width: '130px',
        render: (row: (typeof rows)[0]) => (
          <Badge className={row.documentNumber === 'OPENING' ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 border border-primary-200 dark:border-primary-800 text-xs' : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 text-xs'}>
            {row.documentType}
          </Badge>
        ),
      },
      { key: 'documentNumber', header: t('sales.documentNumber'), width: '140px', render: (row: (typeof rows)[0]) => <span className="font-mono text-xs">{row.documentNumber === 'OPENING' ? '—' : row.documentNumber}</span> },
      {
        key: 'debit',
        header: t('accounting.debit'),
        align: 'right' as const,
        render: (row: (typeof rows)[0]) =>
          row.debit > 0 ? <span className="tabular-nums font-medium text-amber-700 dark:text-amber-300">{formatCurrency(row.debit)}</span> : <span className="text-slate-300">-</span>,
      },
      {
        key: 'credit',
        header: t('accounting.credit'),
        align: 'right' as const,
        render: (row: (typeof rows)[0]) =>
          row.credit > 0 ? <span className="tabular-nums font-medium text-emerald-700 dark:text-emerald-300">{formatCurrency(row.credit)}</span> : <span className="text-slate-300">-</span>,
      },
      {
        key: 'balance',
        header: t('accounting.balance'),
        align: 'right' as const,
        render: (row: (typeof rows)[0]) => (
          <span className={`tabular-nums font-bold ${row.balance > 0 ? 'text-amber-700' : row.balance < 0 ? 'text-emerald-700' : 'text-slate-700'}`}>{formatCurrency(row.balance)}</span>
        ),
      },
    ],
    [t, formatCurrency, formatDate],
  );

  return (
    <div className="space-y-3">
      {rows.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3 text-center">
            <p className="text-xs text-amber-700 dark:text-amber-300">إجمالي مدين</p>
            <p className="text-sm font-bold text-amber-800 dark:text-amber-200 tabular-nums">{formatCurrency(totals.debit)}</p>
          </div>
          <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 p-3 text-center">
            <p className="text-xs text-emerald-700 dark:text-emerald-300">إجمالي دائن</p>
            <p className="text-sm font-bold text-emerald-800 dark:text-emerald-200 tabular-nums">{formatCurrency(totals.credit)}</p>
          </div>
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3 text-center">
            <p className="text-xs text-slate-600 dark:text-slate-400">الرصيد الختامي</p>
            <p className="text-sm font-bold text-slate-900 dark:text-slate-100 tabular-nums">{formatCurrency(totals.balance)}</p>
          </div>
        </div>
      )}
      <Card noPadding>
        {isLoading ? (
          <div className="space-y-3 p-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-10 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="py-6">
            <EmptyState icon="search" title={t('sales.customer.noTransactions')} description={t('sales.customer.noTransactionsDesc')} />
          </div>
        ) : (
          <Table data={rows} columns={columns} keyExtractor={(_r, i) => String(i)} />
        )}
      </Card>
    </div>
  );
}

function CustomerAgingTab({
  aging,
}: {
  aging?: { customerId: string; customerName: string; totalDue: number; buckets: { period: string; amount: number; count: number }[] };
}) {
  const { t } = useTranslation();
  const activeCompany = useAppStore((state) => state.activeCompany);
  const { formatCurrency } = useFormatters(activeCompany?.id || '');
  if (!aging) return <EmptyState icon="search" title={t('sales.customer.noAging')} description={t('sales.customer.noAgingDesc')} />;

  const bucketMeta: Record<string, { label: string; color: string; bg: string; border: string; dot: string }> = {
    '0-30': { label: '0–30 يوم', color: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-50 dark:bg-emerald-900/20', border: 'border-emerald-200 dark:border-emerald-800', dot: 'bg-emerald-500' },
    '31-60': { label: '31–60 يوم', color: 'text-amber-700 dark:text-amber-300', bg: 'bg-amber-50 dark:bg-amber-900/20', border: 'border-amber-200 dark:border-amber-800', dot: 'bg-amber-500' },
    '61-90': { label: '61–90 يوم', color: 'text-orange-700 dark:text-orange-300', bg: 'bg-orange-50 dark:bg-orange-900/20', border: 'border-orange-200 dark:border-orange-800', dot: 'bg-orange-500' },
    '>90': { label: '> 90 يوم', color: 'text-rose-700 dark:text-rose-300', bg: 'bg-rose-50 dark:bg-rose-900/20', border: 'border-rose-200 dark:border-rose-800', dot: 'bg-rose-600' },
  };

  const maxAmt = Math.max(...aging.buckets.map((b) => b.amount), 1);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {aging.buckets.map((b) => {
          const meta = bucketMeta[b.period] || bucketMeta['0-30'];
          const pct = maxAmt ? (b.amount / maxAmt) * 100 : 0;
          return (
            <Card key={b.period} className={`p-4 border ${meta.border} ${meta.bg}`}>
              <div className="flex items-center gap-2 mb-2">
                <span className={`w-2.5 h-2.5 rounded-full ${meta.dot}`} />
                <p className={`text-xs font-bold ${meta.color}`}>{meta.label}</p>
                {b.amount > 0 && b.period === '>90' && <AlertCircle size={12} className="text-rose-500 ml-auto" />}
              </div>
              <p className={`text-xl font-bold tabular-nums ${meta.color}`}>{formatCurrency(b.amount)}</p>
              <p className="text-xs text-slate-500 mt-0.5">
                {b.count} {t('sales.customer.invoices')}
              </p>
              <div className="mt-3 h-1.5 rounded-full bg-white/70 dark:bg-slate-800 overflow-hidden">
                <div className={`h-full rounded-full ${meta.dot} transition-all`} style={{ width: `${pct}%` }} />
              </div>
            </Card>
          );
        })}
      </div>
      <Card className="p-4 bg-gradient-to-r from-slate-900 to-slate-800 dark:from-slate-800 dark:to-slate-900 border-slate-700 text-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
              <Wallet size={18} className="text-white" />
            </div>
            <div>
              <p className="text-sm text-slate-300">{t('sales.customer.totalDue')}</p>
              <p className="text-xs text-slate-400">إجمالي المستحق المتأخر</p>
            </div>
          </div>
          <p className="text-2xl font-bold tabular-nums">{formatCurrency(aging.totalDue)}</p>
        </div>
      </Card>
    </div>
  );
}

export default CustomersPage;
