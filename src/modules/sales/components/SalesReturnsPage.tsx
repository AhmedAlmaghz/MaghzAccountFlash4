import React, { useState, useMemo, useCallback, useRef } from 'react';
import { Undo2, Plus, CheckSquare, Trash2, Printer, FileText, Package, BookOpen, Wallet, Layers, Download, RotateCcw } from 'lucide-react';
import { Card, Button, Table, Input, Modal, Pagination, Can, PageHeader, StatsGrid, FilterBar } from '@/core/ui/components';
import { ConfirmDialog } from '@/core/ui/components/ConfirmDialog';
import { DuplicateWarningDialog } from '@/core/ui/components/DuplicateWarningDialog';
import { salesReturnFingerprint, genericNearScore, detectDocumentDuplicates } from '@/core/utils/documentDuplicate';
import { StatusBadge } from '@/core/ui/components/StatusBadge';
import { ActionButtons } from '@/core/ui/components/ActionButtons';
import { EmptyState } from '@/core/ui/components/EmptyState';
import { CustomerSelect, ProductSelect, CashBoxSelect } from '@/core/ui/components/smart';
import { useReturnsPaginated, usePostedInvoicesWithLines } from '../hooks/useSales';
import { useAppStore } from '@/core/store';
import { useAuthStore } from '@/modules/auth/store';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useFormatters } from '@/core/utils/useFormatters';
import { roundMoney } from '@/core/utils/locale';
import { useSettings } from '@/core/utils/useSettings';
import { useDefaultPaymentAccounts } from '@/core/hooks/useDefaultPaymentAccounts';
import { useDocumentSequence } from '@/core/utils/useDocumentSequence';
import { printDocument } from '@/core/utils/printDocument';
import { exportToExcel, exportToPDF } from '@/core/utils/exportEngine';
import { logAudit } from '@/core/utils/auditLogger';
import { salesApi } from '../api';
import { useToastStore } from '@/core/store/toastStore';
import { useOwnerFilter } from '@/core/utils/useOwnerFilter';
import { OwnerFilterToggle } from '@/core/ui/components/OwnerFilterToggle';
import type { SalesReturn } from '../types';

interface ReturnLineForm {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
}

export const SalesReturnsPage: React.FC = () => {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const activeCompany = useAppStore(state => state.activeCompany);
  const currentUser = useAuthStore(state => state.user);
  const { showToggle: showOwnerToggle, isOwnOnly, toggleOwnOnly } = useOwnerFilter([], 'sales');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const {
    returns,
    total,
    page,
    pageSize,
    isLoading: returnsLoading,
    goToPage,
    changePageSize,
    create,
    update,
    remove,
    post,
  } = useReturnsPaginated(activeCompany?.id || '', useMemo(() => ({ status: statusFilter || undefined }), [statusFilter]));

  const filteredReturns = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return returns;
    return returns.filter((r) => (r.returnNumber?.toLowerCase() || '').includes(q) || (r.customer?.name?.toLowerCase() || '').includes(q) || (r.invoice?.invoiceNumber?.toLowerCase() || '').includes(q));
  }, [returns, search]);
  const hasFilters = !!(search || statusFilter);
  const { invoices } = usePostedInvoicesWithLines(activeCompany?.id || '');
  const { getNextNumber } = useDocumentSequence();
  const { settings } = useSettings(activeCompany?.id || '');
  const { formatCurrency, formatDate, decimalPlaces: dp } = useFormatters(activeCompany?.id || '');
  const { defaultCashBoxId } = useDefaultPaymentAccounts(activeCompany?.id || '');

  const [formOpen, setFormOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<SalesReturn | null>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmConfig, setConfirmConfig] = useState<{ title: string; message: string; onConfirm: () => void; variant?: 'danger' | 'warning' | 'info'; confirmText?: string } | null>(null);

  const [postingId, setPostingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [docDuplicateOpen, setDocDuplicateOpen] = useState(false);
  const [docDuplicateInput, setDocDuplicateInput] = useState('');
  const [docDuplicateExact, setDocDuplicateExact] = useState<{ name: string; code?: string } | null>(null);
  const [docDuplicateNear, setDocDuplicateNear] = useState<Array<{ name: string; code?: string; score: number }>>([]);
  const docDuplicateConfirmedRef = useRef(false);

  const [header, setHeader] = useState({ invoiceId: '', customerId: '', date: new Date().toISOString().split('T')[0], paymentType: 'credit', cashBoxId: '', reason: '', notes: '' });
  const [lines, setLines] = useState<ReturnLineForm[]>([{ productId: '', productName: '', quantity: 1, unitPrice: 0 }]);
  const [invoiceDiscount, setInvoiceDiscount] = useState(0);
  const [invoiceDiscountType, setInvoiceDiscountType] = useState<'amount' | 'percent'>('amount');
  const showDiscount = settings?.invoiceShowDiscount ?? true;
  const showVat = settings?.invoiceShowVat ?? true;

  const defaultLine = (): ReturnLineForm => ({ productId: '', productName: '', quantity: 1, unitPrice: 0 });

  const resetForm = useCallback(() => {
    setHeader({ invoiceId: '', customerId: '', date: new Date().toISOString().split('T')[0], paymentType: 'credit', cashBoxId: defaultCashBoxId || '', reason: '', notes: '' });
    setLines([defaultLine()]);
    setInvoiceDiscount(0);
    setInvoiceDiscountType('amount');
    setEditingId(null);
  }, [defaultCashBoxId]);

  const addLine = () => setLines(prev => [...prev, defaultLine()]);
  const removeLine = (idx: number) => setLines(prev => prev.filter((_, i) => i !== idx));
  const updateLine = (idx: number, field: keyof ReturnLineForm, value: string | number) => {
    setLines(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      if (field === 'productId' && typeof value === 'string') next[idx].productName = value;
      return next;
    });
  };

  const handleProductChange = useCallback((idx: number, product: { nameAr: string; salePrice: number }) => {
    setLines(prev => {
      const next = [...prev];
      const current = next[idx];
      next[idx] = {
        ...current,
        productName: product.nameAr,
        unitPrice: current.unitPrice > 0 ? current.unitPrice : product.salePrice,
      };
      return next;
    });
  }, []);

  const vatRate = settings?.vatRate ?? 15;
  const calculations = useMemo(() => {
    const subtotal = lines.reduce((s, l) => s + (l.quantity * l.unitPrice), 0);
    const invoiceDiscountAmount = showDiscount ? (invoiceDiscountType === 'percent' ? subtotal * (invoiceDiscount / 100) : invoiceDiscount) : 0;
    const cappedDiscount = Math.min(invoiceDiscountAmount, subtotal);
    const netSubtotal = subtotal - cappedDiscount;
    const vatAmount = showVat ? roundMoney(netSubtotal * (vatRate / 100), dp) : 0;
    const totalAmount = netSubtotal + vatAmount;
    return {
      subtotal: roundMoney(subtotal, dp),
      vatAmount,
      totalAmount: roundMoney(totalAmount, dp),
      invoiceDiscountAmount: roundMoney(cappedDiscount, dp),
      vatRate,
    };
  }, [lines, vatRate, invoiceDiscount, invoiceDiscountType, showDiscount, showVat, dp]);

  const handleInvoiceSelect = (invoiceId: string) => {
    const inv = invoices.find(i => i.id === invoiceId);
    if (inv) {
      setHeader(prev => ({ ...prev, invoiceId, customerId: inv.customerId }));
      setLines(inv.lines.map(l => ({ productId: l.productId, productName: l.productName || l.productId, quantity: 1, unitPrice: l.unitPrice })));
    } else {
      setHeader(prev => ({ ...prev, invoiceId, customerId: '' }));
      setLines([defaultLine()]);
    }
  };

  const buildPayload = (returnNumber: string): Omit<SalesReturn, 'id'> => ({
    companyId: activeCompany!.id,
    returnNumber,
    invoiceId: header.invoiceId,
    customerId: header.customerId,
    date: header.date,
    subtotal: calculations.subtotal,
    vatAmount: calculations.vatAmount,
    totalAmount: calculations.totalAmount,
    paymentType: header.paymentType || 'credit',
    cashBoxId: header.paymentType === 'cash' ? (header.cashBoxId || undefined) : undefined,
    reason: header.reason,
    status: 'draft',
    notes: header.notes,
    lines: lines.map(l => ({
      productId: l.productId,
      productName: l.productName,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      lineTotal: roundMoney(l.quantity * l.unitPrice, dp),
    })),
  });

  const handleSave = async () => {
    if (!header.customerId || !header.invoiceId || lines.length === 0 || !activeCompany?.id) return;
    if (lines.some(l => !l.productId)) {
      addToast('error', t('sales.invoice.productRequired') || t('common.error'));
      return;
    }
    if (lines.some(l => l.quantity <= 0)) {
      addToast('error', t('sales.invoice.quantityPositive') || t('common.error'));
      return;
    }
    if (!header.reason.trim()) {
      addToast('error', t('sales.return.reason') + ' ' + (t('validation.required') || ''));
      return;
    }
    setSaving(true);
    let returnNumber: string;
    if (editingId) {
      const existing = returns.find(r => r.id === editingId);
      returnNumber = existing?.returnNumber || '';
    } else {
      const seq = await getNextNumber('sales_return', activeCompany.id);
      if (!seq.success || !seq.number) {
        addToast('error', seq.error || t('sales.return.numberError'));
        setSaving(false);
        return;
      }
      returnNumber = seq.number;
    }
    const payload = buildPayload(returnNumber);
    // ── حارس تكرار المستند — بصمة كاملة (حظر تام) + قريب (تحذير) ──
    if (!docDuplicateConfirmedRef.current) {
      try {
        const existingRes = await salesApi.getReturnsPaginated(activeCompany.id, 1, 200);
        const existingList = (existingRes.success && existingRes.data ? ((existingRes.data as unknown as { items?: SalesReturn[] })?.items ?? (existingRes.data as unknown as SalesReturn[]) ?? []) : []) as SalesReturn[];
        const inputForFp = {
          customerId: payload.customerId,
          invoiceId: payload.invoiceId,
          date: payload.date,
          totalAmount: payload.totalAmount,
          reason: payload.reason,
          lines: payload.lines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice })),
        };
        const fp = salesReturnFingerprint(inputForFp as never);
        const result = detectDocumentDuplicates(
          fp,
          inputForFp,
          existingList as never[],
          (d: unknown) => {
            const doc = d as SalesReturn;
            return salesReturnFingerprint({ customerId: doc.customerId, invoiceId: doc.invoiceId, date: doc.date, totalAmount: doc.totalAmount, reason: doc.reason } as never);
          },
          (inp: unknown, ex: unknown) => {
            const a = inp as { customerId?: string; invoiceId?: string; date?: string; lines?: Array<{ productId?: string }>; totalAmount?: unknown };
            const b = ex as SalesReturn;
            if (String(a.invoiceId ?? '') !== String(b.invoiceId ?? '')) return 0;
            return genericNearScore(a.customerId, b.customerId, a.date, b.date, a.lines ?? [], (b.lines ?? []) as Array<{ productId?: string }>, a.totalAmount, b.totalAmount);
          },
          { excludeId: editingId || undefined },
        );
        if (result.exactMatch) {
          const doc = result.exactMatch as unknown as SalesReturn;
          setDocDuplicateInput(`${payload.customerId} • ${payload.date} • ${payload.totalAmount}`);
          setDocDuplicateExact({ name: doc.returnNumber || String(doc.id).slice(0, 8), code: `${doc.date} • ${doc.totalAmount}` });
          setDocDuplicateNear([]);
          setDocDuplicateOpen(true);
          setSaving(false);
          return;
        }
        if (result.nearMatches.length > 0) {
          setDocDuplicateInput(`${payload.customerId} • ${payload.date}`);
          setDocDuplicateNear(
            result.nearMatches.map((m) => {
              const d = m.item as unknown as SalesReturn;
              return { name: d.returnNumber || String(d.id).slice(0, 8), code: `${d.date} • ${d.totalAmount}`, score: m.score };
            }),
          );
          setDocDuplicateExact(null);
          setDocDuplicateOpen(true);
          setSaving(false);
          return;
        }
      } catch {
        /* فشل الفحص لا يمنع الحفظ */
      }
    }
    docDuplicateConfirmedRef.current = false;
    if (editingId) {
      const res = await update(editingId, payload);
      if (res.success && activeCompany.id) {
        await logAudit({ userId: currentUser?.id || 'system', action: 'update', tableName: 'sales_returns', recordId: editingId, companyId: activeCompany.id });
        addToast('success', t('sales.return.updated'));
      } else {
        addToast('error', res.error || t('error'));
      }
    } else {
      const res = await create(payload);
      if (res.success && res.id && activeCompany.id) {
        await logAudit({ userId: currentUser?.id || 'system', action: 'create', tableName: 'sales_returns', recordId: res.id, companyId: activeCompany.id });
        addToast('success', t('sales.return.created'));
      } else {
        addToast('error', res.error || t('error'));
      }
    }
    setSaving(false);
    setFormOpen(false);
    resetForm();
  };

  const handleDelete = (ret: SalesReturn) => {
    if (ret.status !== 'draft') return;
    setConfirmConfig({
      title: t('sales.return.deleteTitle'),
      message: `${t('sales.return.deleteConfirm')} ${ret.returnNumber}؟`,
      variant: 'danger',
      onConfirm: async () => {
        setConfirmOpen(false);
        const res = await remove(ret.id);
        if (res.success && activeCompany?.id) {
          await logAudit({ userId: currentUser?.id || 'system', action: 'delete', tableName: 'sales_returns', recordId: ret.id, companyId: activeCompany.id });
          addToast('success', t('sales.return.deleted'));
        } else {
          addToast('error', res.error || t('error'));
        }
      },
    });
    setConfirmOpen(true);
  };

  const handlePost = (ret: SalesReturn) => {
    if (ret.status !== 'draft') return;
    setConfirmConfig({
      title: t('sales.return.postTitle'),
      message: `${t('sales.return.postConfirm')}`,
      variant: 'warning',
      confirmText: t('sales.return.post'),
      onConfirm: async () => {
        setConfirmOpen(false);
        if (!activeCompany?.id) return;
        setPostingId(ret.id);
        // Single reference: the API posts atomically (JE + stock movements + status flip + customer balance).
        const postResult = await post(ret.id);
        if (postResult.success) {
          await logAudit({ userId: currentUser?.id || 'system', action: 'post', tableName: 'sales_returns', recordId: ret.id, companyId: activeCompany.id });
          addToast('success', t('sales.return.posted'));
        } else {
          addToast('error', postResult.error || t('error'));
        }
        setPostingId(null);
      },
    });
    setConfirmOpen(true);
  };

  // Paginated rows carry lines: [] — refetch the full document so the edit
  // form shows its products instead of an empty list.
  const handleEditRow = async (row: SalesReturn) => {
    let full = row;
    if ((!row.lines || row.lines.length === 0) && activeCompany?.id) {
      const res = await salesApi.getReturnById(row.id, activeCompany.id);
      if (res.success && res.data && res.data.lines.length > 0) full = res.data;
    }
    setEditingId(full.id);
    setLines(full.lines.map(l => ({ productId: l.productId, productName: l.productName || l.productId, quantity: l.quantity, unitPrice: l.unitPrice })));
    setFormOpen(true);
  };

  const handlePrint = async (ret: SalesReturn) => {
    let lines = ret.lines;
    if ((!lines || lines.length === 0) && activeCompany?.id) {
      const res = await salesApi.getReturnById(ret.id, activeCompany.id);
      if (res.success && res.data?.lines) lines = res.data.lines;
    }
    printDocument({
      type: 'sales-return',
      docNumber: ret.returnNumber,
      date: ret.date,
      partyName: ret.customer?.name || ret.customerId,
      partyLabel: t('sales.customer.title'),
      partyTaxNumber: ret.customer?.taxNumber,
      partyAddress: ret.customer?.address,
      lines: (lines || []).map(l => ({
        description: l.productName || l.productId,
        productCode: l.productCode,
        barcode: l.barcode,
        sku: l.sku,
        unit: l.unit,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        total: l.lineTotal,
      })),
      subtotal: ret.subtotal,
      vatAmount: ret.vatAmount,
      totalAmount: ret.totalAmount,
      notes: `${ret.reason}\n${ret.notes || ''}`,
      companyName: activeCompany?.name,
      companyTaxNumber: activeCompany?.taxNumber,
      companyAddress: activeCompany?.address,
      companyPhone: activeCompany?.phone,
      companyEmail: activeCompany?.email,
      currency: activeCompany?.currency,
      paymentType: ret.paymentType,
      createdBy: ret.createdBy,
    });
  };

  const handleExportExcel = () => {
    const cols = [
      { key: 'returnNumber', header: t('sales.return.number') },
      { key: 'invoiceNumber', header: t('sales.invoiceNumber') },
      { key: 'customerName', header: t('sales.customer.title') },
      { key: 'date', header: t('sales.date') },
      { key: 'totalAmount', header: t('sales.total') },
      { key: 'status', header: t('sales.status.label') },
    ];
    exportToExcel(returns.map(r => ({ returnNumber: r.returnNumber, invoiceNumber: r.invoice?.invoiceNumber || r.invoiceId, customerName: r.customer?.name || r.customerId, date: r.date, totalAmount: r.totalAmount, status: r.status })), cols, `sales_returns_${new Date().toISOString().split('T')[0]}`);
  };

  const handleExportPdf = () => {
    const exportColumns = [
      { key: 'returnNumber', header: t('sales.return.number') },
      { key: 'customerName', header: t('sales.customer.title') },
      { key: 'date', header: t('sales.date') },
      { key: 'totalAmount', header: t('sales.total') },
      { key: 'status', header: t('sales.status.label') },
    ];
    exportToPDF(filteredReturns.map(r => ({ returnNumber: r.returnNumber, customerName: r.customer?.name || r.customerId, date: r.date, totalAmount: formatCurrency(r.totalAmount), status: r.status })), exportColumns, `sales_returns_${new Date().toISOString().split('T')[0]}`, {
      title: t('sales.returns'),
      rtl: true,
    });
  };

  const tableColumns = [
    {
      key: 'returnNumber',
      header: t('sales.return.number'),
      width: '135px',
      mobile: 'title' as const,
      render: (row: SalesReturn) => (
        <span className="font-mono text-xs font-semibold bg-slate-50 dark:bg-slate-800 px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 flex items-center gap-1 w-fit">
          <Undo2 size={12} className="text-rose-500" />
          {row.returnNumber}
        </span>
      ),
    },
    { key: 'invoiceNumber', header: t('sales.return.originalInvoice'), width: '140px', render: (row: SalesReturn) => (
      <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400 font-mono text-xs"><FileText size={13} /> {row.invoice?.invoiceNumber || row.invoiceId.slice(0, 8)}</span>
    )},
    {
      key: 'customerName',
      header: t('sales.customer.title'),
      mobile: 'subtitle' as const,
      render: (row: SalesReturn) => (
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-rose-500 to-rose-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
            {(row.customer?.name || row.customerId || '?').charAt(0).toUpperCase()}
          </div>
          <span className="font-medium truncate">{row.customer?.name || row.customerId.slice(0, 8)}</span>
        </div>
      ),
    },
    { key: 'date', header: t('sales.date'), width: '110px', render: (row: SalesReturn) => <span className="font-mono text-xs bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded border tabular-nums">{formatDate(row.date)}</span> },
    { key: 'reason', header: t('sales.return.reason'), render: (row: SalesReturn) => <span className="text-sm text-slate-600 dark:text-slate-300 truncate max-w-[180px] inline-block">{row.reason}</span> },
    { key: 'totalAmount', header: t('sales.total'), align: 'right' as const, render: (row: SalesReturn) => <span className="font-bold tabular-nums text-rose-700 dark:text-rose-300">{formatCurrency(row.totalAmount)}</span> },
    {
      key: 'paymentType',
      header: t('sales.return.paymentType'),
      width: '95px',
      render: (row: SalesReturn) => (
        <span
          className={`px-2.5 py-1 rounded-full text-xs font-medium border ${row.paymentType === 'cash' ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800' : 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800'}`}
        >
          {row.paymentType === 'cash' ? t('sales.invoice.cash') : t('sales.invoice.credit')}
        </span>
      ),
    },
    { key: 'status', header: t('sales.status.label'), width: '110px', mobile: 'status' as const, render: (row: SalesReturn) => <StatusBadge status={row.status} /> },
    { key: 'actions', header: t('sales.actions'), width: '200px', mobile: 'actions' as const, render: (row: SalesReturn) => (
      <div className="flex items-center gap-1">
        <ActionButtons
          onView={async () => {
            if (activeCompany?.id) {
              const res = await salesApi.getReturnById(row.id, activeCompany.id);
              if (res.success && res.data) { setViewing(res.data); setDetailOpen(true); return; }
            }
            setViewing(row); setDetailOpen(true);
          }}
          onEdit={row.status === 'draft' ? () => handleEditRow(row) : undefined}
          onDelete={row.status === 'draft' ? () => handleDelete(row) : undefined}
          onPrint={() => handlePrint(row)}
          showView
          showEdit={row.status === 'draft'}
          showDelete={row.status === 'draft'}
          showPrint
        />
        {row.status === 'draft' && (
          <Button size="sm" variant="secondary" onClick={() => handlePost(row)} disabled={postingId === row.id} leftIcon={<CheckSquare size={14} />}>
            {postingId === row.id ? (t('loading')) : (t('sales.return.post'))}
          </Button>
        )}
      </div>
    )},
  ];

  const stats = useMemo(() => {
    const total = returns.filter(r => r.status === 'posted').reduce((s, r) => s + r.totalAmount, 0);
    const draftCount = returns.filter(r => r.status === 'draft').length;
    const postedCount = returns.filter(r => r.status === 'posted').length;
    return { total, draftCount, postedCount };
  }, [returns]);

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        icon={<RotateCcw size={22} />}
        title={t('sales.returns')}
        subtitle={t('sales.returnsSubtitle')}
        actions={
          <Can action="create" module="sales">
            <Button variant="secondary" leftIcon={<Plus size={16} />} onClick={() => { resetForm(); setFormOpen(true); }} className="shadow-sm">{t('sales.return.create')}</Button>
          </Can>
        }
      />

      {/* KPI Cards */}
      <StatsGrid
        columns={4}
        items={[
          { label: t('sales.return.total'), value: String(total), icon: <Layers size={18} /> },
          { label: t('sales.return.postedTotal'), value: formatCurrency(stats.total), icon: <Wallet size={18} />, tone: 'info' },
          { label: t('sales.return.drafts'), value: String(stats.draftCount), icon: <FileText size={18} />, tone: 'warning' },
          { label: t('sales.status.posted'), value: String(stats.postedCount), icon: <CheckSquare size={18} />, tone: 'success' },
        ]}
      />

      {/* Toolbar */}
      <div>
        <FilterBar
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder={t('search')}
          filterOptions={[
            { key: '', label: t('sales.filter.all') },
            { key: 'draft', label: t('sales.status.draft') },
            { key: 'posted', label: t('sales.status.posted') },
            { key: 'cancelled', label: t('sales.status.cancelled') },
          ]}
          activeFilter={statusFilter}
          onFilterChange={(key) => setStatusFilter(key)}
          actions={
            <>
              <OwnerFilterToggle isOwnOnly={isOwnOnly} showToggle={showOwnerToggle} onToggle={toggleOwnOnly} />
              <Button size="sm" variant="ghost" onClick={handleExportExcel} title={t('export')}><Download size={16} className="text-emerald-600" /></Button>
              <Button size="sm" variant="ghost" onClick={handleExportPdf} title="PDF"><Printer size={16} className="text-rose-600" /></Button>
            </>
          }
        />
        {hasFilters && (
          <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
            <span>{filteredReturns.length} من {returns.length} {search ? `• "${search}"` : ''} {statusFilter ? `• ${t('sales.status.' + statusFilter)}` : ''}</span>
            <button onClick={() => { setSearch(''); setStatusFilter(''); }} className="text-rose-600 hover:underline font-medium">{t('sales.filter.clearFilters')}</button>
          </div>
        )}
      </div>

      <Card noPadding>
        {returnsLoading ? (
          <div className="space-y-3 p-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-14 bg-slate-100 dark:bg-slate-800 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : returns.length === 0 ? (
          <div className="py-8">
            <EmptyState
              icon="inbox"
              title={t('sales.return.emptyTitle')}
              description={t('sales.return.emptyDesc')}
              action={<Can action="create" module="sales"><Button variant="primary" leftIcon={<Plus size={16} />} onClick={() => { resetForm(); setFormOpen(true); }}>{t('sales.return.create')}</Button></Can>}
            />
          </div>
        ) : filteredReturns.length === 0 ? (
          <div className="py-10">
            <EmptyState
              icon="search"
              title={t('sales.filter.noResults')}
              description={t('sales.filter.noResultsDesc')}
              action={<Button variant="secondary" onClick={() => { setSearch(''); setStatusFilter(''); }}>{t('sales.filter.clearFilters')}</Button>}
            />
          </div>
        ) : (
          <>
            <Table<SalesReturn> data={filteredReturns} columns={tableColumns} keyExtractor={(row, i) => row.id || String(i)} isLoading={returnsLoading} />
            <div className="border-t border-slate-200 dark:border-slate-800">
              <Pagination page={page} pageSize={pageSize} total={total} onPageChange={goToPage} onPageSizeChange={changePageSize} />
            </div>
          </>
        )}
      </Card>

      {/* Form Modal — Modern Return Editor */}
      <Modal isOpen={formOpen} onClose={() => { setFormOpen(false); resetForm(); }} size="4xl" title={editingId ? (t('sales.return.edit')) : (t('sales.return.new'))}>
        <div className="space-y-4 p-1">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('sales.return.originalInvoice')}</label>
              <select
                className="form-control w-full"
                value={header.invoiceId}
                onChange={e => handleInvoiceSelect(e.target.value)}
              >
                <option value="">{t('sales.invoice.select')}</option>
                {invoices.filter(i => i.status === 'posted' || i.status === 'partially_paid' || i.status === 'paid').map(inv => (
                  <option key={inv.id} value={inv.id}>{inv.invoiceNumber} - {inv.customer?.name || inv.customerId}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('sales.customer.title')}</label>
              <CustomerSelect companyId={activeCompany?.id || ''} value={header.customerId} onChange={v => setHeader(p => ({ ...p, customerId: v || '' }))} />
            </div>
            <Input label={t('sales.date')} type="date" value={header.date} onChange={e => setHeader(p => ({ ...p, date: e.target.value }))} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('sales.return.paymentType')}</label>
              <select
                value={header.paymentType || 'credit'}
                onChange={e => {
                  const newType = e.target.value;
                  setHeader(p => ({
                    ...p,
                    paymentType: newType,
                    cashBoxId: newType === 'cash' ? (p.cashBoxId || defaultCashBoxId || '') : '',
                  }));
                }}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
                aria-label={t('sales.return.paymentType')}
              >
                <option value="credit">{t('sales.invoice.credit')}</option>
                <option value="cash">{t('sales.invoice.cash')}</option>
              </select>
            </div>
          </div>

          {header.paymentType === 'cash' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('accounting.cashBox')}</label>
                <CashBoxSelect companyId={activeCompany?.id || ''} value={header.cashBoxId || ''} onChange={v => setHeader(p => ({ ...p, cashBoxId: v || '' }))} />
                {defaultCashBoxId && header.cashBoxId === defaultCashBoxId && (
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">★ {t('accounting.defaultSelected')}</p>
                )}
              </div>
            </div>
          )}

          {/* Enlarged Modern Items — Returns */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-sm bg-white dark:bg-slate-900">
            <div className="bg-gradient-to-r from-slate-50 to-white dark:from-slate-800 dark:to-slate-900 px-4 py-3 flex items-center justify-between border-b border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center">
                  <Package size={18} className="text-rose-600 dark:text-rose-400" />
                </div>
                <div>
                  <h4 className="font-bold text-slate-900 dark:text-slate-50 flex items-center gap-2">
                    {t('sales.invoice.lines')}
                    <span className="text-xs font-normal bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full border">{lines.length} {t('sales.itemsCount')}</span>
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 hidden sm:block">حدد المنتجات المرتجعة — الأسعار تُملأ تلقائياً</p>
                </div>
              </div>
              <Button size="sm" onClick={addLine} leftIcon={<Plus size={14} />} className="shadow-sm">{t('sales.invoice.addLine')}</Button>
            </div>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 text-xs uppercase tracking-wider">
                    <th className="px-4 py-3 text-right font-semibold w-[48%]">{t('inventory.productName')}</th>
                    <th className="px-3 py-3 text-center font-semibold w-24">{t('inventory.quantity')}</th>
                    <th className="px-3 py-3 text-right font-semibold w-32">{t('inventory.unitPrice')}</th>
                    <th className="px-4 py-3 text-right font-semibold w-32">{t('sales.total')}</th>
                    <th className="px-2 py-3 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {lines.map((line, idx) => {
                    const lineTotal = line.quantity * line.unitPrice;
                    return (
                      <tr key={idx} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors group">
                        <td className="px-3 py-3"><ProductSelect companyId={activeCompany?.id || ''} value={line.productId} onChange={v => updateLine(idx, 'productId', Array.isArray(v) ? (v[0] || '') : (v || ''))} onProductChange={(p) => handleProductChange(idx, p)} showBarcode showStock size="sm" module="sales" /></td>
                        <td className="px-3 py-2"><Input type="number" min={1} value={String(line.quantity)} onChange={e => updateLine(idx, 'quantity', Number(e.target.value))} size="sm" className="text-center font-medium" /></td>
                        <td className="px-3 py-2"><Input type="number" min={0} value={String(line.unitPrice)} onChange={e => updateLine(idx, 'unitPrice', Number(e.target.value))} size="sm" className="text-right tabular-nums" /></td>
                        <td className="px-4 py-3 text-right font-bold tabular-nums bg-slate-50/50 dark:bg-slate-800/30">{formatCurrency(lineTotal)}</td>
                        <td className="px-2 py-2"><Button size="sm" variant="ghost" onClick={() => removeLine(idx)} className="opacity-60 group-hover:opacity-100 hover:bg-rose-50" leftIcon={<Trash2 size={14} className="text-rose-500" />} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {/* Mobile line-items cards */}
            <div className="md:hidden space-y-3 p-3">
              {lines.map((line, idx) => {
                const lineTotal = line.quantity * line.unitPrice;
                return (
                  <div key={idx} className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/40 p-4 space-y-3">
                    <ProductSelect
                      companyId={activeCompany?.id || ''}
                      value={line.productId}
                      onChange={v => updateLine(idx, 'productId', Array.isArray(v) ? (v[0] || '') : (v || ''))}
                      onProductChange={(p) => handleProductChange(idx, p)}
                      showBarcode
                      showStock
                      size="sm"
                      module="sales"
                    />
                    <div className="grid grid-cols-2 gap-3">
                      <Input type="number" min={1} value={String(line.quantity)} onChange={e => updateLine(idx, 'quantity', Number(e.target.value))} size="sm" className="text-center font-medium" />
                      <Input type="number" min={0} value={String(line.unitPrice)} onChange={e => updateLine(idx, 'unitPrice', Number(e.target.value))} size="sm" className="text-right tabular-nums" />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-zinc-900 dark:text-zinc-50 tabular-nums">{formatCurrency(lineTotal)}</span>
                      <Button size="sm" variant="ghost" onClick={() => removeLine(idx)} className="hover:bg-rose-50 dark:hover:bg-rose-900/20" leftIcon={<Trash2 size={14} className="text-rose-500" />} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            <div className="lg:col-span-3 space-y-4">
              <Input label={t('sales.return.reason')} value={header.reason} onChange={e => setHeader(p => ({ ...p, reason: e.target.value }))} placeholder="سبب الإرجاع..." />
              <Input label={t('sales.notes')} value={header.notes} onChange={e => setHeader(p => ({ ...p, notes: e.target.value }))} placeholder="ملاحظات إضافية..." />
            </div>
            <div className="lg:col-span-2 order-first lg:order-last rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-sm bg-gradient-to-b from-white to-slate-50/50 dark:from-slate-900 dark:to-slate-800/50">
              <div className="px-4 py-3 bg-slate-900 dark:bg-slate-800 text-white flex items-center justify-between">
                <span className="text-sm font-semibold flex items-center gap-2"><Wallet size={16} /> {t('sales.invoice.summary')}</span>
                <span className="text-xs bg-white/15 px-2 py-1 rounded-full">{lines.length} {t('sales.itemsCount')}</span>
              </div>
              <div className="p-4 space-y-2 text-sm">
                <div className="flex justify-between py-2 border-b border-dashed border-slate-200 dark:border-slate-700"><span className="text-slate-600 dark:text-slate-300">{t('sales.subtotal')}</span><span className="font-semibold tabular-nums">{formatCurrency(calculations.subtotal)}</span></div>
                {showDiscount && (
                  <div className="rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-amber-900 dark:text-amber-100">٪ {t('sales.discount')}</span>
                      <div className="flex gap-1 bg-white dark:bg-slate-800 rounded-full p-1 border">
                        <button onClick={() => setInvoiceDiscountType('amount')} className={`px-2.5 py-1 rounded-full text-xs font-medium ${invoiceDiscountType === 'amount' ? 'bg-slate-900 text-white shadow' : 'text-slate-600'}`}>{activeCompany?.currency || 'YER'}</button>
                        <button onClick={() => setInvoiceDiscountType('percent')} className={`px-2.5 py-1 rounded-full text-xs font-medium ${invoiceDiscountType === 'percent' ? 'bg-slate-900 text-white shadow' : 'text-slate-600'}`}>%</button>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Input type="number" min={0} value={String(invoiceDiscount)} onChange={e => setInvoiceDiscount(Math.max(0, Number(e.target.value) || 0))} size="sm" className="flex-1" />
                      <div className="px-3 py-2 bg-white dark:bg-slate-800 rounded-lg border text-sm font-bold min-w-[110px] text-center text-amber-700">-{formatCurrency(calculations.invoiceDiscountAmount)}</div>
                    </div>
                  </div>
                )}
                {showVat ? (
                  <div className="flex justify-between py-2 border-b border-dashed border-slate-200 dark:border-slate-700"><span className="text-slate-600 dark:text-slate-300 flex items-center gap-1">{t('sales.vat')} <span className="text-xs bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">{calculations.vatRate}%</span></span><span className="font-semibold text-emerald-700">{formatCurrency(calculations.vatAmount)}</span></div>
                ) : (
                  <div className="flex justify-between py-2 border-b border-dashed opacity-60 text-xs"><span>{t('sales.vat')} — غير مفعّل</span><span>{formatCurrency(0)}</span></div>
                )}
                <div className="flex justify-between items-center pt-2"><span className="font-black text-slate-900 dark:text-white">{t('sales.total')}</span><span className="text-xl font-black text-rose-600">{formatCurrency(calculations.totalAmount)}</span></div>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-700">
            <Button variant="secondary" onClick={() => { setFormOpen(false); resetForm(); }}>{t('cancel')}</Button>
            <Button onClick={handleSave} isLoading={saving} leftIcon={<CheckSquare size={16} />}>{editingId ? (t('save')) : (t('sales.return.saveDraft'))}</Button>
          </div>
        </div>
      </Modal>

      {/* Detail Modal */}
      <Modal isOpen={detailOpen} onClose={() => setDetailOpen(false)} size="lg" title={`${t('sales.return.details')} - ${viewing?.returnNumber}`}>
        {viewing && (
          <div className="space-y-4 p-1">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3"><p className="text-slate-500 dark:text-slate-400">{t('sales.customer.title')}</p><p className="font-semibold">{viewing.customer?.name || viewing.customerId}</p></div>
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3"><p className="text-slate-500 dark:text-slate-400">{t('sales.status.label')}</p><StatusBadge status={viewing.status} /></div>
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3"><p className="text-slate-500 dark:text-slate-400">{t('sales.return.originalInvoice')}</p><p className="font-semibold flex items-center gap-1"><FileText size={14} /> {viewing.invoice?.invoiceNumber || viewing.invoiceId}</p></div>
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3"><p className="text-slate-500 dark:text-slate-400">{t('sales.return.reason')}</p><p className="font-semibold">{viewing.reason}</p></div>
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3"><p className="text-slate-500 dark:text-slate-400">{t('sales.date')}</p><p className="font-semibold">{viewing.date}</p></div>
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3"><p className="text-slate-500 dark:text-slate-400">{t('sales.total')}</p><p className="font-semibold">{formatCurrency(viewing.totalAmount)}</p></div>
            </div>

            {/* Impact badges */}
            <div className="flex gap-2">
              <div className="flex items-center gap-2 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 rounded-lg px-3 py-2 text-sm">
                <BookOpen size={16} /> {t('sales.return.accountingEffect')}
              </div>
              <div className="flex items-center gap-2 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 rounded-lg px-3 py-2 text-sm">
                <Package size={16} /> {t('sales.return.inventoryEffect')}
              </div>
            </div>

            <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300"><tr><th className="px-3 py-2 text-right">#</th><th className="px-3 py-2 text-right">{t('inventory.productName')}</th><th className="px-3 py-2 text-right">{t('inventory.quantity')}</th><th className="px-3 py-2 text-right">{t('inventory.unitPrice')}</th><th className="px-3 py-2 text-right">{t('sales.total')}</th></tr></thead>
                <tbody>
                  {(viewing.lines || []).map((l, i) => (
                    <tr key={i} className="border-b border-slate-100 dark:border-slate-800">
                      <td className="px-3 py-2 text-slate-500">{i + 1}</td>
                      <td className="px-3 py-2 font-medium">{l.productName || l.productId}</td>
                      <td className="px-3 py-2">{l.quantity}</td>
                      <td className="px-3 py-2">{formatCurrency(l.unitPrice)}</td>
                      <td className="px-3 py-2 font-medium">{formatCurrency(l.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-between items-center bg-slate-50 dark:bg-slate-800 rounded-lg p-3">
              <div className="space-y-1 text-sm">
                <p className="text-slate-500 dark:text-slate-400">{t('sales.subtotal')}: <span className="font-medium text-slate-900 dark:text-slate-50">{formatCurrency(viewing.subtotal)}</span></p>
                <p className="text-slate-500 dark:text-slate-400">{t('sales.vat')}: <span className="font-medium text-slate-900 dark:text-slate-50">{formatCurrency(viewing.vatAmount)}</span></p>
              </div>
              <div className="text-xl font-bold text-primary-600 dark:text-primary-400">
                {t('sales.total')}: {formatCurrency(viewing.totalAmount)}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDetailOpen(false)}>{t('close')}</Button>
              <Button variant="primary" onClick={() => handlePrint(viewing)} leftIcon={<Printer size={16} />}>{t('print')}</Button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => { confirmConfig?.onConfirm(); }}
        title={confirmConfig?.title || ''}
        message={confirmConfig?.message || ''}
        variant={confirmConfig?.variant || 'warning'}
        confirmText={confirmConfig?.confirmText || (t('confirm'))}
        cancelText={t('cancel')}
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
        entityLabel={t('sales.returns')}
        exactMatch={docDuplicateExact}
        nearMatches={docDuplicateNear}
        isDocument
        isEdit={!!editingId}
      />
    </div>
  );
};

export default SalesReturnsPage;
