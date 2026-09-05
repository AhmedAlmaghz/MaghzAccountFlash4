import React, { useState, useMemo, useCallback, useRef } from 'react';
import { Plus, FileText, Phone, Mail, MapPin, Hash, Info, Clock, Wallet, Truck, UserCheck, Receipt, AlertCircle } from 'lucide-react';
import { exportToExcel, exportToPDF } from '@/core/utils/exportEngine';
import { logAudit } from '@/core/utils/auditLogger';
import { Card, Button, Modal, Input, Pagination, Table, Badge, PageHeader, FilterBar } from '@/core/ui/components';
import { StatusBadge } from '@/core/ui/components/StatusBadge';
import { DuplicateWarningDialog } from '@/core/ui/components/DuplicateWarningDialog';
import { detectDuplicates } from '@/core/utils/duplicateDetection';
import { ActionButtons } from '@/core/ui/components/ActionButtons';
import { ConfirmDialog } from '@/core/ui/components/ConfirmDialog';
import { EmptyState } from '@/core/ui/components/EmptyState';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useSuppliersPaginated, useSupplierDetails } from '../hooks/usePurchases';
import { useAppStore } from '@/core/store';
import { useAuthStore } from '@/modules/auth/store';
import type { Supplier } from '../types';
import { printDocument } from '@/core/utils/printDocument';
import { purchasesApi } from '../api';
import { useFormatters } from '@/core/utils/useFormatters';
import { useDocumentSequence } from '@/core/utils/useDocumentSequence';
import { useToastStore } from '@/core/store/toastStore';
import { Can } from '@/core/ui/components/PermissionGate';

interface SupplierForm {
  name: string;
  code: string;
  phone: string;
  email: string;
  address: string;
  taxNumber: string;
  openingBalance: string;
  openingDate: string;
  isActive: boolean;
}

type FormErrors = Partial<Record<'name' | 'phone' | 'email' | 'code', string>>;
type TabKey = 'details' | 'statement' | 'aging';

const initialForm = (): SupplierForm => ({
  name: '',
  code: '',
  phone: '',
  email: '',
  address: '',
  taxNumber: '',
  openingBalance: '',
  openingDate: '',
  isActive: true,
});

export const SuppliersPage: React.FC = () => {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const activeCompany = useAppStore((state) => state.activeCompany);
  const user = useAuthStore((state) => state.user);
  const { formatCurrency, formatDate } = useFormatters(activeCompany?.id || '');
  const { getNextNumber } = useDocumentSequence();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const supplierFilters = useMemo(() => {
    const isActive = statusFilter === 'all' ? undefined : statusFilter === 'active';
    return { isActive, search: search || undefined } as { isActive?: boolean; search?: string };
  }, [search, statusFilter]);

  const { suppliers, total, page, pageSize, isLoading, goToPage, changePageSize, create, update, remove } = useSuppliersPaginated(
    activeCompany?.id || '',
    supplierFilters,
  );

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<SupplierForm>(initialForm());
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [duplicateInputName, setDuplicateInputName] = useState('');
  const [duplicateExact, setDuplicateExact] = useState<{ name: string; code?: string } | null>(null);
  const [duplicateNear, setDuplicateNear] = useState<Array<{ name: string; code?: string; score: number }>>([]);
  const duplicateConfirmedRef = useRef(false);
  const [cardOpen, setCardOpen] = useState(false);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('details');
  const { supplier, statement, aging, isLoading: cardLoading } = useSupplierDetails(activeCompany?.id || '', selectedSupplierId);

  const validateForm = useCallback((): boolean => {
    const errors: FormErrors = {};
    if (!form.name.trim()) errors.name = t('validation.required') || 'مطلوب';
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errors.email = 'بريد إلكتروني غير صحيح';
    if (form.phone && form.phone.length < 7) errors.phone = 'رقم هاتف غير صحيح';
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  }, [form, t]);

  const openCreate = useCallback(async () => {
    setEditingId(null);
    setForm(initialForm());
    setFormErrors({});
    if (activeCompany) {
      const seq = await getNextNumber('supplier', activeCompany.id);
      if (seq?.number) setForm((prev) => ({ ...prev, code: seq.number || '' }));
    }
    setModalOpen(true);
  }, [activeCompany, getNextNumber]);

  const openEdit = useCallback((s: Supplier) => {
    setEditingId(s.id);
    setForm({
      name: s.name,
      code: s.code || '',
      phone: s.phone || '',
      email: s.email || '',
      address: s.address || '',
      taxNumber: s.taxNumber || '',
      openingBalance: s.openingBalancePosted ? String(s.openingBalance || '') : '',
      openingDate: s.openingDate ? String(s.openingDate).slice(0, 10) : '',
      isActive: s.isActive,
    });
    setFormErrors({});
    setModalOpen(true);
  }, []);

  const openCard = useCallback((s: Supplier) => {
    setSelectedSupplierId(s.id);
    setActiveTab('details');
    setCardOpen(true);
  }, []);

  const handleSave = useCallback(async () => {
    if (!activeCompany?.id) return;
    if (!validateForm()) {
      addToast('error', t('validation.required') || 'يرجى تصحيح الحقول');
      return;
    }
    const inputName = form.name.trim();
    if (!duplicateConfirmedRef.current && inputName) {
      try {
        const allRes = await purchasesApi.getSuppliers(activeCompany.id);
        if (allRes.success && allRes.data) {
          const result = detectDuplicates(inputName, allRes.data as Supplier[], (s) => s.name, {
            excludeId: editingId || undefined,
            getId: (s) => s.id,
            getCode: (s) => s.code,
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
      name: form.name.trim(),
      code: form.code?.trim() || undefined,
      phone: form.phone?.trim() || undefined,
      email: form.email?.trim() || undefined,
      address: form.address?.trim() || undefined,
      taxNumber: form.taxNumber?.trim() || undefined,
      balance: 0,
      openingBalance: editingId ? undefined : (Number(form.openingBalance) || 0),
      openingDate: editingId ? undefined : (form.openingDate?.trim() || undefined),
      isActive: form.isActive,
    };
    try {
      if (editingId) {
        const res = await update(editingId, payload);
        if (res.success) {
          addToast('success', t('purchases.supplier.updated'));
          await logAudit({ userId: user?.id || '', action: 'update', tableName: 'suppliers', recordId: editingId, companyId: activeCompany.id });
          setModalOpen(false);
          setEditingId(null);
          setForm(initialForm());
          setFormErrors({});
        } else {
          addToast('error', res.error || t('common.error'));
        }
      } else {
        const result = await create(payload);
        if (result.success && result.id) {
          addToast('success', t('purchases.supplier.created'));
          await logAudit({ userId: user?.id || '', action: 'create', tableName: 'suppliers', recordId: result.id, companyId: activeCompany.id });
          setModalOpen(false);
          setForm(initialForm());
          setFormErrors({});
        } else {
          addToast('error', result.error || t('common.error'));
        }
      }
    } finally {
      setSaving(false);
    }
  }, [activeCompany, form, editingId, create, update, user, addToast, t, validateForm]);

  const handleDelete = useCallback((id: string) => {
    setConfirmDelete(id);
  }, []);

  const confirmDeleteAction = useCallback(async () => {
    if (!confirmDelete || !activeCompany?.id) return;
    const result = await remove(confirmDelete);
    if (result.success) {
      addToast('success', t('purchases.supplier.deleted'));
      await logAudit({ userId: user?.id || '', action: 'delete', tableName: 'suppliers', recordId: confirmDelete, companyId: activeCompany.id });
    } else {
      addToast('error', result.error || t('common.error'));
    }
    setConfirmDelete(null);
  }, [confirmDelete, activeCompany, remove, user, addToast, t]);

  const handleExportExcel = useCallback(() => {
    exportToExcel(
      suppliers,
      [
        { key: 'code', header: t('purchases.supplier.code'), width: 14 },
        { key: 'name', header: t('purchases.supplier.name'), width: 26 },
        { key: 'phone', header: t('purchases.supplier.phone'), width: 16 },
        { key: 'email', header: t('purchases.supplier.email'), width: 22 },
        { key: 'address', header: t('purchases.supplier.address'), width: 28 },
        { key: 'balance', header: t('purchases.supplier.totalBalance'), width: 16 },
        { key: 'isActive', header: t('purchases.supplier.isActive'), width: 12 },
      ],
      `suppliers_${new Date().toISOString().split('T')[0]}`,
    );
  }, [suppliers, t]);

  const handlePrintStatement = useCallback(
    async (s: Supplier) => {
      try {
        if (!activeCompany?.id) return;
        const res = await purchasesApi.getSupplierStatement(s.id, activeCompany.id);
        if (!res.success || !res.data) {
          addToast('error', res.error || t('common.error'));
          return;
        }
        const statementLines = res.data.map((r) => ({
          date: typeof r.date === 'string' && r.date.length > 10 ? r.date.slice(0, 10) : r.date || '',
          docNumber: r.documentNumber,
          description: r.description || r.type,
          debit: r.debit,
          credit: r.credit,
          balance: r.balance,
        }));
        const totalDebit = statementLines.reduce((sum, l) => sum + l.debit, 0);
        const totalCredit = statementLines.reduce((sum, l) => sum + l.credit, 0);
        const closingBalance = statementLines.length > 0 ? statementLines[statementLines.length - 1].balance : 0;
        printDocument({
          type: 'statement',
          docNumber: s.code || s.id.slice(0, 8),
          date: new Date().toISOString().split('T')[0],
          partyName: s.name,
          partyLabel: t('purchases.supplier.name'),
          partyTaxNumber: s.taxNumber,
          partyAddress: s.address,
          lines: [],
          statementLines,
          subtotal: totalDebit,
          vatAmount: totalCredit,
          totalAmount: closingBalance,
          companyName: activeCompany.name,
          companyTaxNumber: activeCompany.taxNumber,
          companyPhone: activeCompany.phone,
          companyAddress: activeCompany.address,
          companyLogoUrl: activeCompany.logoUrl,
          currency: activeCompany.currency || 'YER',
        });
      } catch (err) {
        addToast('error', String(err));
      }
    },
    [activeCompany, addToast, t],
  );

  const handleExportPdf = useCallback(() => {
    exportToPDF(
      suppliers,
      [
        { key: 'name', header: t('purchases.supplier.name') },
        { key: 'phone', header: t('purchases.supplier.phone') },
        { key: 'email', header: t('purchases.supplier.email') },
        { key: 'balance', header: t('purchases.supplier.totalBalance') },
      ],
      `suppliers_${new Date().toISOString().split('T')[0]}`,
      { title: t('purchases.suppliers'), rtl: true, companyName: activeCompany?.name },
    );
  }, [suppliers, t, activeCompany]);

  const columns = useMemo(
    () => [
      {
        key: 'code',
        header: t('purchases.supplier.code'),
        width: '110px',
        mobile: 'hidden' as const,
        render: (row: Supplier) => (
          <span className="inline-flex items-center gap-1.5 font-mono text-xs font-medium text-zinc-700 dark:text-zinc-300 bg-zinc-50 dark:bg-zinc-800 px-2 py-1 rounded-md border border-zinc-200 dark:border-zinc-700">
            <Hash size={12} className="text-zinc-400" />
            {row.code || '-'}
          </span>
        ),
      },
      {
        key: 'name',
        header: t('purchases.supplier.name'),
        mobile: 'title' as const,
        render: (row: Supplier) => (
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 dark:from-amber-600 dark:to-orange-700 flex items-center justify-center text-white font-bold text-sm shadow-sm shrink-0">
              {row.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-zinc-900 dark:text-zinc-100 truncate">{row.name}</p>
              {row.taxNumber && <p className="text-xs text-zinc-500 truncate">{row.taxNumber}</p>}
            </div>
          </div>
        ),
      },
      {
        key: 'phone',
        header: t('purchases.supplier.phone'),
        mobile: 'subtitle' as const,
        render: (row: Supplier) =>
          row.phone ? (
            <span className="inline-flex items-center gap-1.5 text-sm text-zinc-700 dark:text-zinc-300">
              <span className="w-7 h-7 rounded-full bg-emerald-50 dark:bg-emerald-900/30 flex items-center justify-center shrink-0">
                <Phone size={13} className="text-emerald-600 dark:text-emerald-400" />
              </span>
              <span dir="ltr" className="tabular-nums">
                {row.phone}
              </span>
            </span>
          ) : (
            <span className="text-zinc-400 text-sm">-</span>
          ),
      },
      {
        key: 'email',
        header: t('purchases.supplier.email'),
        render: (row: Supplier) =>
          row.email ? (
            <span className="inline-flex items-center gap-1.5 text-sm text-zinc-600 dark:text-zinc-300 max-w-[180px]">
              <Mail size={13} className="text-zinc-400 shrink-0" />
              <span className="truncate">{row.email}</span>
            </span>
          ) : (
            <span className="text-zinc-400 text-sm">-</span>
          ),
      },
      {
        key: 'balance',
        header: t('purchases.supplier.totalBalance'),
        align: 'right' as const,
        render: (row: Supplier) => {
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
                      : 'bg-zinc-50 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700'
                }`}
              >
                {formatCurrency(bal)}
              </span>
              {bal !== 0 && <p className={`text-[11px] mt-0.5 ${isDebit ? 'text-amber-600' : 'text-emerald-600'}`}>{isDebit ? 'مدين' : 'دائن'}</p>}
            </div>
          );
        },
      },
      {
        key: 'isActive',
        header: t('purchases.supplier.isActive'),
        width: '110px',
        render: (row: Supplier) => <StatusBadge status={row.isActive ? 'active' : 'inactive'} />,
      },
      {
        key: 'actions',
        header: t('purchases.actions'),
        width: '150px',
        mobile: 'actions' as const,
        render: (row: Supplier) => (
          <ActionButtons
            onView={() => openCard(row)}
            onEdit={() => openEdit(row)}
            onDelete={() => handleDelete(row.id)}
            onPrint={() => handlePrintStatement(row)}
            showView
            showEdit
            showDelete
            showPrint
            showExport={false}
          />
        ),
      },
    ],
    [t, openCard, openEdit, handleDelete, handlePrintStatement, formatCurrency],
  );

  const totalBalance = useMemo(() => suppliers.reduce((s, sup) => s + (Number(sup.balance) || 0), 0), [suppliers]);
  // Payable (positive balances) vs credit-to-us (negative) — the CURRENT NET
  // balance is the headline; debit/credit shown as a breakdown, never summed.
  const payableTotal = useMemo(() => suppliers.reduce((s, sup) => s + Math.max(0, Number(sup.balance) || 0), 0), [suppliers]);
  const creditTotal = useMemo(() => suppliers.reduce((s, sup) => s + Math.abs(Math.min(0, Number(sup.balance) || 0)), 0), [suppliers]);
  const activeCount = useMemo(() => suppliers.filter((s) => s.isActive).length, [suppliers]);
  const inactiveCount = total - activeCount;
  const hasActiveFilter = search.trim().length > 0 || statusFilter !== 'all';

  const statementTotals = useMemo(() => {
    if (!statement.length) return null;
    const debit = statement.reduce((s, r) => s + (Number(r.debit) || 0), 0);
    const credit = statement.reduce((s, r) => s + (Number(r.credit) || 0), 0);
    const bal = statement[statement.length - 1]?.balance || 0;
    return { debit, credit, bal };
  }, [statement]);

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Page Header */}
      <PageHeader
        icon={<Truck size={22} />}
        title={t('purchases.suppliers')}
        subtitle={t('purchases.suppliersSubtitle')}
        actions={
          <Can action="create" module="purchases">
            <Button variant="primary" leftIcon={<Plus size={16} />} onClick={openCreate} className="shadow-sm">
              {t('purchases.supplier.new')}
            </Button>
          </Can>
        }
      />

      {/* Filter Bar */}
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder={`${t('search')} — ${t('purchases.supplier.name')} / ${t('purchases.supplier.phone')} / ${t('purchases.supplier.code')}`}
        filterOptions={[
          { key: 'all', label: t('purchases.filter.all') || 'الكل' },
          { key: 'active', label: t('settings.common.active') },
          { key: 'inactive', label: t('settings.common.inactive') },
        ]}
        activeFilter={statusFilter}
        onFilterChange={(key) => setStatusFilter(key as 'all' | 'active' | 'inactive')}
        actions={
          <>
            <Button size="sm" variant="ghost" onClick={handleExportExcel} className="gap-1.5">
              <FileText size={15} className="text-emerald-600" />
              <span className="hidden sm:inline text-xs">Excel</span>
            </Button>
            <Button size="sm" variant="ghost" onClick={handleExportPdf} className="gap-1.5">
              <Receipt size={15} className="text-rose-600" />
              <span className="hidden sm:inline text-xs">PDF</span>
            </Button>
          </>
        }
      />
      {hasActiveFilter && (
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <span>
            {total} {t('purchases.supplier.invoices')} • {search ? `"${search}"` : ''} {statusFilter !== 'all' ? `• ${statusFilter === 'active' ? t('settings.common.active') : t('settings.common.inactive')}` : ''}
          </span>
          <button onClick={() => { setSearch(''); setStatusFilter('all'); }} className="text-primary-600 hover:underline font-medium">
            مسح الفلترة
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="relative overflow-hidden">
          <div className="p-5 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">{t('purchases.supplier.total')}</p>
              <p className="mt-1 text-3xl font-bold text-slate-900 dark:text-slate-50 tabular-nums">{total}</p>
              <p className="mt-1 text-xs text-slate-500">
                {activeCount} نشط • {inactiveCount} غير نشط
              </p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800 flex items-center justify-center">
              <Truck size={20} className="text-amber-600 dark:text-amber-400" />
            </div>
          </div>
          <div className="h-1 bg-gradient-to-r from-amber-500 to-orange-600" />
        </Card>
        <Card className="relative overflow-hidden">
          <div className="p-5 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">{t('purchases.supplier.active')}</p>
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
              <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">{t('purchases.supplier.totalBalance')}</p>
              <p className={`mt-1 text-2xl font-bold tabular-nums truncate ${totalBalance > 0 ? 'text-amber-600 dark:text-amber-400' : totalBalance < 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-900 dark:text-slate-50'}`} title={formatCurrency(totalBalance)}>
                {formatCurrency(totalBalance)}
              </p>
              <p className="mt-1 text-xs text-slate-500 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="inline-flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                  دائن (مستحق لنا للمورد): <span className="font-semibold tabular-nums">{formatCurrency(payableTotal)}</span>
                </span>
                {creditTotal > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    مدين: <span className="font-semibold tabular-nums">{formatCurrency(creditTotal)}</span>
                  </span>
                )}
              </p>
            </div>
            <div className={`w-12 h-12 rounded-xl border flex items-center justify-center shrink-0 ml-3 ${totalBalance > 0 ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-100 dark:border-amber-800' : totalBalance < 0 ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-100 dark:border-emerald-800' : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700'}`}>
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
        ) : suppliers.length === 0 ? (
          <div className="py-8">
            <EmptyState
              icon={hasActiveFilter ? 'search' : 'inbox'}
              title={hasActiveFilter ? 'لا توجد نتائج' : t('purchases.supplier.emptyTitle')}
              description={hasActiveFilter ? 'جرّب تغيير كلمات البحث أو الفلترة' : t('purchases.supplier.emptyDesc')}
              action={
                hasActiveFilter ? (
                  <Button variant="secondary" onClick={() => { setSearch(''); setStatusFilter('all'); }}>
                    مسح الفلترة
                  </Button>
                ) : (
                  <Can action="create" module="purchases">
                    <Button variant="primary" leftIcon={<Plus size={16} />} onClick={openCreate}>
                      {t('purchases.supplier.new')}
                    </Button>
                  </Can>
                )
              }
            />
          </div>
        ) : (
          <>
            <Table<Supplier> data={suppliers} columns={columns as never} keyExtractor={(row) => row.id} isLoading={isLoading} />
            <div className="border-t border-slate-200 dark:border-slate-800">
              <Pagination page={page} pageSize={pageSize} total={total} onPageChange={goToPage} onPageSizeChange={changePageSize} />
            </div>
          </>
        )}
      </Card>

      {/* Create / Edit Modal */}
      <Modal
        isOpen={modalOpen}
        title={editingId ? t('purchases.supplier.edit') : t('purchases.supplier.new')}
        description={editingId ? 'تعديل بيانات المورد' : 'إضافة مورد جديد — الحقول المميزة بـ * مطلوبة'}
        onClose={() => {
          setModalOpen(false);
          setEditingId(null);
          setForm(initialForm());
          setFormErrors({});
        }}
        size="lg"
        footer={
          <div className="flex items-center justify-between w-full">
            <p className="text-xs text-slate-500 hidden sm:block">* حقول مطلوبة</p>
            <div className="flex gap-2 ml-auto">
              <Button variant="secondary" onClick={() => { setModalOpen(false); setEditingId(null); }}>
                {t('cancel')}
              </Button>
              <Button variant="primary" onClick={handleSave} isLoading={saving} leftIcon={<Plus size={16} />}>
                {editingId ? t('save') : t('create')}
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-5">
          <div>
            <h4 className="text-xs font-bold tracking-wider uppercase text-slate-500 mb-3 flex items-center gap-2">
              <Hash size={12} /> البيانات الأساسية
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Input label={`${t('purchases.supplier.code')} (${t('optional')})`} value={form.code} onChange={(e) => setForm((prev) => ({ ...prev, code: e.target.value }))} placeholder="SUP-001" error={formErrors.code} helperText={!formErrors.code ? 'يُنشأ تلقائياً إن تُرك فارغاً' : undefined} />
              <div className="sm:col-span-2">
                <Input label={`${t('purchases.supplier.name')} *`} value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="مثال: شركة التوريد المتكاملة" error={formErrors.name} required />
              </div>
            </div>
          </div>
          <div className="h-px bg-slate-100 dark:bg-slate-800" />
          <div>
            <h4 className="text-xs font-bold tracking-wider uppercase text-slate-500 mb-3 flex items-center gap-2">
              <Phone size={12} /> التواصل
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input label={t('purchases.supplier.phone')} value={form.phone} onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))} placeholder="77xxxxxxx" leftIcon={<Phone size={14} />} error={formErrors.phone} dir="ltr" />
              <Input label={t('purchases.supplier.email')} type="email" value={form.email} onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))} placeholder="name@supplier.com" leftIcon={<Mail size={14} />} error={formErrors.email} dir="ltr" />
            </div>
            <div className="mt-4">
              <label className="text-xs font-semibold text-slate-500 flex items-center gap-1.5 mb-1.5">
                <MapPin size={12} /> {t('purchases.supplier.address')}
              </label>
              <textarea
                value={form.address}
                onChange={(e) => setForm((prev) => ({ ...prev, address: e.target.value }))}
                placeholder="العنوان التفصيلي..."
                rows={2}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2.5 text-sm text-slate-900 dark:text-slate-50 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition resize-none"
              />
            </div>
          </div>
          <div className="h-px bg-slate-100 dark:bg-slate-800" />
          <div>
            <h4 className="text-xs font-bold tracking-wider uppercase text-slate-500 mb-3 flex items-center gap-2">
              <Wallet size={12} /> البيانات المالية والحالة
            </h4>
            <Input label={t('purchases.supplier.taxNumber')} value={form.taxNumber} onChange={(e) => setForm((prev) => ({ ...prev, taxNumber: e.target.value }))} placeholder="الرقم الضريبي" dir="ltr" />
            <Input
              label={t('openingBalance.title')}
              type="number"
              min={0}
              step="0.01"
              disabled={!!editingId}
              value={form.openingBalance}
              onChange={(e) => setForm((prev) => ({ ...prev, openingBalance: e.target.value }))}
              placeholder="0.00"
              helperText={editingId ? t('openingBalance.postedHint') : t('openingBalance.supplierHint')}
              leftIcon={<span className="text-[11px] font-bold text-slate-400">{activeCompany?.currency || 'YER'}</span>}
            />
            <Input
              label={t('openingBalance.dateLabel')}
              type="date"
              disabled={!!editingId}
              value={form.openingDate}
              onChange={(e) => setForm((prev) => ({ ...prev, openingDate: e.target.value }))}
              helperText={t('openingBalance.dateHint')}
            />
            <label className="mt-4 flex items-center gap-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 px-3.5 py-3 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition">
              <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((prev) => ({ ...prev, isActive: e.target.checked }))} className="w-4 h-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500" />
              <div>
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{t('purchases.supplier.isActive')}</p>
                <p className="text-xs text-slate-500">{form.isActive ? 'المورد نشط ويمكن التعامل معه' : 'المورد موقوف مؤقتاً'}</p>
              </div>
              <Badge className={`ml-auto ${form.isActive ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-slate-200 text-slate-600 border-slate-300'} border`}>{form.isActive ? 'نشط' : 'موقوف'}</Badge>
            </label>
          </div>
        </div>
      </Modal>

      {/* Supplier Card Modal with Tabs */}
      <Modal isOpen={cardOpen} title={supplier ? `${t('purchases.supplier.card')} — ${supplier.name}` : t('purchases.supplier.card')} description={supplier ? `${supplier.code || ''} ${supplier.phone ? '• ' + supplier.phone : ''}` : undefined} onClose={() => { setCardOpen(false); setSelectedSupplierId(null); }} size="xl">
        {cardLoading ? (
          <div className="space-y-3">
            <div className="h-10 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse" />
            <div className="h-10 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse" />
          </div>
        ) : supplier ? (
          <div className="space-y-4">
            <div className="flex gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-800 w-fit">
              {(
                [
                  { key: 'details', label: t('purchases.supplier.details') || 'التفاصيل', icon: Info },
                  { key: 'statement', label: t('purchases.supplier.statement'), icon: FileText },
                  { key: 'aging', label: t('purchases.supplier.aging'), icon: Clock },
                ] as { key: TabKey; label: string; icon: typeof Info }[]
              ).map((tab) => {
                const Icon = tab.icon;
                const active = activeTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all ${active ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm border border-slate-200 dark:border-slate-600' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'}`}
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
                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white font-bold text-xl shadow">{supplier.name.charAt(0).toUpperCase()}</div>
                    <div className="min-w-0">
                      <h3 className="text-base font-bold text-slate-900 dark:text-slate-50 truncate">{supplier.name}</h3>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="font-mono text-xs bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700">{supplier.code || '-'}</span>
                        <StatusBadge status={supplier.isActive ? 'active' : 'inactive'} />
                      </div>
                    </div>
                  </div>
                  <div className="space-y-2.5 pt-3 border-t border-slate-100 dark:border-slate-800 text-sm">
                    <p className="flex items-center gap-2.5 text-slate-700 dark:text-slate-200">
                      <span className="w-8 h-8 rounded-full bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center shrink-0"><Phone size={14} className="text-emerald-600" /></span>
                      <span dir="ltr" className="tabular-nums">{supplier.phone || '-'}</span>
                    </p>
                    <p className="flex items-center gap-2.5 text-slate-700 dark:text-slate-200">
                      <span className="w-8 h-8 rounded-full bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center shrink-0"><Mail size={14} className="text-blue-600" /></span>
                      <span className="truncate">{supplier.email || '-'}</span>
                    </p>
                    <p className="flex items-start gap-2.5 text-slate-700 dark:text-slate-200">
                      <span className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0 mt-0.5"><MapPin size={14} className="text-slate-500" /></span>
                      <span className="flex-1 leading-relaxed">{supplier.address || '-'}</span>
                    </p>
                    <p className="flex items-center gap-2.5 text-slate-700 dark:text-slate-200">
                      <span className="w-8 h-8 rounded-full bg-amber-50 dark:bg-amber-900/20 flex items-center justify-center shrink-0"><Receipt size={14} className="text-amber-600" /></span>
                      {t('purchases.supplier.taxNumber')}: <span className="font-mono text-xs">{supplier.taxNumber || '-'}</span>
                    </p>
                  </div>
                </Card>
                <div className="space-y-4">
                  <Card className="p-5">
                    <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">{t('accounting.balance')}</p>
                    <p className={`mt-1 text-3xl font-bold tabular-nums ${Number(supplier.balance) > 0 ? 'text-amber-600 dark:text-amber-400' : Number(supplier.balance) < 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-900 dark:text-slate-50'}`}>
                      {formatCurrency(Number(supplier.balance) || 0)} <span className="text-sm font-normal text-slate-500">YER</span>
                    </p>
                    {Number(supplier.openingBalance) > 0 && (
                      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                        {t('openingBalance.title')}: <span className="font-semibold tabular-nums">{formatCurrency(Number(supplier.openingBalance) || 0)}</span>
                      </p>
                    )}
                    {Number(supplier.balance) !== 0 && (
                      <span className={`inline-flex mt-2 text-xs px-2 py-1 rounded-full border ${Number(supplier.balance) > 0 ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-emerald-50 border-emerald-200 text-emerald-700'}`}>{Number(supplier.balance) > 0 ? 'ذمة مدينة للمورد' : 'رصيد دائن'}</span>
                    )}
                  </Card>
                  <Card className="p-5 bg-slate-50 dark:bg-slate-800/50 border-dashed">
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center gap-2"><FileText size={14} /> كشف سريع</p>
                    <p className="text-xs text-slate-500 mt-1">اعرض كشف الحساب وتقسيم الاستحقاق من التبويبات أعلاه</p>
                  </Card>
                </div>
              </div>
            )}

            {activeTab === 'statement' && (
              <div className="space-y-3">
                {statementTotals && (
                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3 text-center">
                      <p className="text-xs text-amber-700 dark:text-amber-300">إجمالي مدين</p>
                      <p className="text-sm font-bold text-amber-800 dark:text-amber-200 tabular-nums">{formatCurrency(statementTotals.debit)}</p>
                    </div>
                    <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 p-3 text-center">
                      <p className="text-xs text-emerald-700 dark:text-emerald-300">إجمالي دائن</p>
                      <p className="text-sm font-bold text-emerald-800 dark:text-emerald-200 tabular-nums">{formatCurrency(statementTotals.credit)}</p>
                    </div>
                    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3 text-center">
                      <p className="text-xs text-slate-600 dark:text-slate-400">الرصيد الختامي</p>
                      <p className="text-sm font-bold text-slate-900 dark:text-slate-100 tabular-nums">{formatCurrency(statementTotals.bal)}</p>
                    </div>
                  </div>
                )}
                {statement.length > 0 ? (
                  <Card noPadding>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
                            <th className="px-3 py-2.5 text-start text-xs font-semibold text-slate-500 whitespace-nowrap">{t('date')}</th>
                            <th className="px-3 py-2.5 text-start text-xs font-semibold text-slate-500 whitespace-nowrap">{t('documentNumber')}</th>
                            <th className="px-3 py-2.5 text-start text-xs font-semibold text-slate-500">{t('description')}</th>
                            <th className="px-3 py-2.5 text-end text-xs font-semibold text-slate-500">{t('accounting.debit')}</th>
                            <th className="px-3 py-2.5 text-end text-xs font-semibold text-slate-500">{t('accounting.credit')}</th>
                            <th className="px-3 py-2.5 text-end text-xs font-semibold text-slate-500">{t('balance')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {statement.map((r) => (
                            <tr key={r.id} className={r.type === 'opening' ? 'bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700' : 'border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50'}>
                              <td className="px-3 py-2.5 tabular-nums text-xs whitespace-nowrap">{r.date ? formatDate(r.date) : '-'}</td>
                              <td className="px-3 py-2.5 font-mono text-xs">{r.type === 'opening' ? '—' : r.documentNumber}</td>
                              <td className="px-3 py-2.5 max-w-[180px] truncate" title={r.description}>{r.type === 'opening' ? <span className="font-bold text-primary-700 dark:text-primary-300">{r.description}</span> : (r.description || r.type)}</td>
                              <td className="px-3 py-2.5 text-end tabular-nums">{Number(r.debit || 0) > 0 ? <span className="text-amber-700 font-medium">{formatCurrency(r.debit || 0)}</span> : <span className="text-slate-300">-</span>}</td>
                              <td className="px-3 py-2.5 text-end tabular-nums">{Number(r.credit || 0) > 0 ? <span className="text-emerald-700 font-medium">{formatCurrency(r.credit || 0)}</span> : <span className="text-slate-300">-</span>}</td>
                              <td className="px-3 py-2.5 text-end tabular-nums font-bold">{formatCurrency(r.balance || 0)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                ) : (
                  <EmptyState icon="file" title={t('purchases.supplier.noTransactions')} description={t('purchases.supplier.noTransactionsDesc')} />
                )}
              </div>
            )}

            {activeTab === 'aging' && (
              <div className="space-y-4">
                {aging.length > 0 && aging.some((a) => a.amount > 0) ? (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                      {aging.map((bucket) => {
                        const meta: Record<string, { bg: string; border: string; dot: string; text: string; label: string }> = {
                          '0-30': { bg: 'bg-emerald-50 dark:bg-emerald-900/20', border: 'border-emerald-200 dark:border-emerald-800', dot: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-300', label: '0–30 يوم' },
                          '31-60': { bg: 'bg-amber-50 dark:bg-amber-900/20', border: 'border-amber-200 dark:border-amber-800', dot: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-300', label: '31–60 يوم' },
                          '61-90': { bg: 'bg-orange-50 dark:bg-orange-900/20', border: 'border-orange-200 dark:border-orange-800', dot: 'bg-orange-500', text: 'text-orange-700 dark:text-orange-300', label: '61–90 يوم' },
                          '>90': { bg: 'bg-rose-50 dark:bg-rose-900/20', border: 'border-rose-200 dark:border-rose-800', dot: 'bg-rose-600', text: 'text-rose-700 dark:text-rose-300', label: '> 90 يوم' },
                        };
                        const bucketKey = bucket.bucket.includes('>') ? '>90' : bucket.bucket.includes('61') ? '61-90' : bucket.bucket.includes('31') ? '31-60' : '0-30';
                        const m = meta[bucketKey] || meta['0-30'];
                        const maxAmt = Math.max(...aging.map((b) => b.amount), 1);
                        const pct = (bucket.amount / maxAmt) * 100;
                        return (
                          <Card key={bucket.bucket} className={`p-4 border ${m.border} ${m.bg}`}>
                            <div className="flex items-center gap-2 mb-2">
                              <span className={`w-2.5 h-2.5 rounded-full ${m.dot}`} />
                              <p className={`text-xs font-bold ${m.text}`}>{m.label}</p>
                              {bucket.amount > 0 && bucketKey === '>90' && <AlertCircle size={12} className="text-rose-500 ml-auto" />}
                            </div>
                            <p className={`text-xl font-bold tabular-nums ${m.text}`}>{formatCurrency(bucket.amount || 0)}</p>
                            <div className="mt-3 h-1.5 rounded-full bg-white/70 dark:bg-slate-800 overflow-hidden">
                              <div className={`h-full rounded-full ${m.dot} transition-all`} style={{ width: `${pct}%` }} />
                            </div>
                          </Card>
                        );
                      })}
                    </div>
                    <Card className="p-4 bg-gradient-to-r from-slate-900 to-slate-800 dark:from-slate-800 dark:to-slate-900 border-slate-700 text-white">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center"><Wallet size={18} className="text-white" /></div>
                          <div>
                            <p className="text-sm text-slate-300">إجمالي المستحق</p>
                            <p className="text-xs text-slate-400">ذمم دائنة متأخرة</p>
                          </div>
                        </div>
                        <p className="text-2xl font-bold tabular-nums">{formatCurrency(aging.reduce((s, b) => s + (b.amount || 0), 0))}</p>
                      </div>
                    </Card>
                  </>
                ) : (
                  <EmptyState icon="search" title={t('purchases.supplier.noAging')} description={t('purchases.supplier.noAgingDesc')} />
                )}
              </div>
            )}
          </div>
        ) : (
          <EmptyState icon="search" title={t('purchases.supplier.emptyTitle')} />
        )}
      </Modal>

      <ConfirmDialog
        isOpen={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={confirmDeleteAction}
        title={t('purchases.supplier.deleteTitle')}
        message={t('purchases.supplier.deleteConfirm')}
        variant="danger"
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
        entityLabel={t('purchases.suppliers')}
        exactMatch={duplicateExact}
        nearMatches={duplicateNear}
        isEdit={!!editingId}
      />
    </div>
  );
};

export default SuppliersPage;
