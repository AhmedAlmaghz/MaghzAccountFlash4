import React, { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Plus, CheckSquare, Printer, Download, Wallet, CheckCircle2, Clock,
ShoppingCart, Undo2 } from 'lucide-react';
import { Card, Button, DynamicTable, Modal, Pagination, Can, PageHeader, StatsGrid, FilterBar } from '@/core/ui/components';
import { ConfirmDialog } from '@/core/ui/components/ConfirmDialog';
import { StatusBadge } from '@/core/ui/components/StatusBadge';
import { ActionButtons } from '@/core/ui/components/ActionButtons';
import { EmptyState } from '@/core/ui/components/EmptyState';
import { useInvoicesPaginated } from '../hooks/useSales';
import { useAppStore } from '@/core/store';
import { useToastStore } from '@/core/store/toastStore';
import { useAuthStore } from '@/modules/auth/store';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useSettings } from '@/core/utils/useSettings';
import { useFormatters } from '@/core/utils/useFormatters';
import { useUserMap } from '@/core/utils/useUserMap';
import { printDocument } from '@/core/utils/printDocument';
import { todayIso } from '@/core/utils/aging';
import { exportToExcel, exportToPDF } from '@/core/utils/exportEngine';
import { salesApi } from '../api';
import { reverseSalesInvoice } from '@/modules/accounting/reversal';
import { ReverseDialog } from '@/modules/accounting/components/ReverseDialog';
import { logAudit } from '@/core/utils/auditLogger';
import { useOwnerFilter } from '@/core/utils/useOwnerFilter';
import { OwnerFilterToggle } from '@/core/ui/components/OwnerFilterToggle';
import type { SalesInvoice } from '../types';

export const InvoicesPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const STATUS_FLOW = useMemo(() => ({
    draft: t('sales.status.draft'),
    posted: t('sales.status.posted'),
    partially_paid: t('sales.status.partially_paid'),
    paid: t('sales.status.paid'),
    cancelled: t('sales.status.cancelled'),
  }), [t]);
  const activeCompany = useAppStore(state => state.activeCompany);
  const currentUser = useAuthStore(state => state.user);
  const { showToggle: showOwnerToggle, isOwnOnly, toggleOwnOnly } = useOwnerFilter([], 'sales');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const {
    invoices,
    total,
    page,
    pageSize,
    isLoading,
    goToPage,
    changePageSize,
    remove,
    post,
    reload,
  } = useInvoicesPaginated(activeCompany?.id || '', useMemo(() => ({
    createdBy: isOwnOnly ? currentUser?.id : undefined,
    status: statusFilter || undefined,
  }), [isOwnOnly, currentUser?.id, statusFilter]));
  const { settings } = useSettings(activeCompany?.id || '');
  const { formatCurrency, formatDate } = useFormatters(activeCompany?.id || '');
  const { getUserName } = useUserMap();
  const currencySymbol = settings?.defaultCurrency || activeCompany?.currency || 'YER';

  const [detailOpen, setDetailOpen] = useState(false);
  const [viewing, setViewing] = useState<SalesInvoice | null>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmConfig, setConfirmConfig] = useState<{ title: string; message: string; onConfirm: () => void; variant?: 'danger' | 'warning' | 'info'; confirmText?: string } | null>(null);

  const [postingId, setPostingId] = useState<string | null>(null);
  const [reverseRow, setReverseRow] = useState<SalesInvoice | null>(null);

  const handleReverseConfirm = async (date: string, reason: string) => {
    if (!activeCompany?.id || !reverseRow) return;
    const res = await reverseSalesInvoice(activeCompany.id, reverseRow.id, { date, reason }, currentUser?.id || '');
    if (res.success) {
      addToast('success', `${t('accounting.reverse.success')} (${res.data.reference})`);
      setReverseRow(null);
      await reload();
    } else {
      addToast('error', res.error || t('common.error'));
    }
  };
  const showDiscount = settings?.invoiceShowDiscount ?? true;

  // Full-page editor (DocumentPageShell + DocumentItemsGrid) replaces the
  // 4xl modal — deep-linkable, mobile-friendly, no crushed line grid.
  const openCreate = useCallback(() => {
    navigate('/sales/invoices/new');
  }, [navigate]);


  // Paginated rows carry lines: [] — the editor page refetches by id.
  const handleEditRow = useCallback((invoice: SalesInvoice) => {
    navigate(`/sales/invoices/${invoice.id}`);
  }, [navigate]);

  const handleDelete = (invoice: SalesInvoice) => {
    if (invoice.status !== 'draft') return;
    setConfirmConfig({
      title: t('sales.invoice.deleteTitle'),
      message: `${t('sales.invoice.deleteConfirm')} ${invoice.invoiceNumber}؟`,
      variant: 'danger',
      confirmText: t('delete'),
      onConfirm: async () => {
        setConfirmOpen(false);
        const res = await remove(invoice.id);
        if (res.success && activeCompany?.id) {
          await logAudit({ userId: currentUser?.id || 'system', action: 'delete', tableName: 'sales_invoices', recordId: invoice.id, companyId: activeCompany.id });
          addToast('success', t('sales.invoice.deleted'));
        } else {
          addToast('error', res.error || t('common.error'));
        }
      },
    });
    setConfirmOpen(true);
  };

  const handlePost = async (invoice: SalesInvoice) => {
    if (invoice.status !== 'draft') return;
    // COGS preview before posting (perpetual, IAS 2): frozen sale-time
    // snapshots already on the lines — zero extra queries when loaded.
    let previewLines = invoice.lines;
    if ((!previewLines || previewLines.length === 0) && activeCompany?.id) {
      const res = await salesApi.getInvoiceById(invoice.id, activeCompany.id);
      if (res.success && res.data?.lines) previewLines = res.data.lines;
    }
    const expectedCogs = Math.round(((previewLines || []).reduce(
      (s, l) => s + (Number(l.baseQuantity) || Number(l.quantity) || 0) * (Number(l.unitCost) || 0), 0
    )) * 100) / 100;
    const previewSuffix = expectedCogs > 0 ? `\n${t('sales.invoice.expectedCogs')}: ${formatCurrency(expectedCogs)}` : '';
    setConfirmConfig({
      title: t('sales.invoice.postTitle'),
      message: `${t('sales.invoice.postConfirm')}${previewSuffix}`,
      variant: 'warning',
      confirmText: t('sales.invoice.post'),
      onConfirm: async () => {
        setConfirmOpen(false);
        if (!activeCompany?.id) return;
        setPostingId(invoice.id);
        // Single reference: the API posts atomically (JE + status flip + customer balance).
        const postResult = await post(invoice.id);
        if (postResult.success) {
          await logAudit({ userId: currentUser?.id || 'system', action: 'post', tableName: 'sales_invoices', recordId: invoice.id, companyId: activeCompany.id });
          const postedCogs = Math.round(((postResult as { cogsAmount?: number }).cogsAmount || 0) * 100) / 100;
          addToast('success', postedCogs > 0 ? `${t('sales.invoice.postedWithCogs')}: ${formatCurrency(postedCogs)}` : t('sales.invoice.posted'));
          const zeroCost = Number((postResult as { zeroCostLines?: number }).zeroCostLines) || 0;
          if (zeroCost > 0) addToast('warning', `${t('sales.invoice.zeroCostHint')} (${zeroCost})`);
        } else {
          addToast('error', `${t('sales.invoice.postFailed')}: ${postResult.error || t('sales.invoice.unknownError')}`);
        }
        setPostingId(null);
      },
    });
    setConfirmOpen(true);
  };

  const handlePrint = async (invoice: SalesInvoice) => {
    let lines = invoice.lines;
    if ((!lines || lines.length === 0) && activeCompany?.id) {
      const res = await salesApi.getInvoiceById(invoice.id, activeCompany.id);
      if (res.success && res.data?.lines) lines = res.data.lines;
    }
    const isOverdue = invoice.dueDate ? invoice.dueDate < todayIso() : false;
    printDocument({
      type: 'sales-invoice',
      docNumber: invoice.invoiceNumber,
      date: invoice.date,
      dueDate: invoice.dueDate,
      partyName: invoice.customer?.name || invoice.customerId,
      partyLabel: t('sales.customer.title'),
      partyTaxNumber: invoice.customer?.taxNumber,
      partyAddress: invoice.customer?.address,
      lines: (lines || []).map(l => ({
        description: l.productName || l.productId,
        productCode: l.productCode,
        productName: l.productName,
        barcode: l.barcode,
        sku: l.sku,
        unit: l.unitName || l.unit,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        total: l.lineTotal,
      })),
      subtotal: invoice.subtotal,
      discountAmount: invoice.discountAmount,
      vatAmount: invoice.vatAmount,
      totalAmount: invoice.totalAmount,
      notes: invoice.notes,
      companyName: activeCompany?.name,
      companyTaxNumber: activeCompany?.taxNumber,
      companyAddress: activeCompany?.address,
      companyPhone: activeCompany?.phone,
      companyEmail: activeCompany?.email,
      companyLogoUrl: activeCompany?.logoUrl,
      vatRate: settings?.vatRate ?? 15,
      currency: currencySymbol,
      paymentType: invoice.paymentType,
      createdBy: invoice.createdBy,
      statusBadge: STATUS_FLOW[invoice.status] || invoice.status,
      statusTone: invoice.status === 'paid' ? 'success' : (isOverdue ? 'warning' : 'muted'),
    }, false, t);
  };

  const handleExportExcel = () => {
    const exportColumns = [
      { key: 'invoiceNumber', header: t('sales.invoiceNumber') },
      { key: 'customerName', header: t('sales.customer.title') },
      { key: 'date', header: t('sales.date') },
      { key: 'dueDate', header: t('sales.dueDate') },
      { key: 'paymentType', header: t('sales.invoice.paymentType') },
      { key: 'currencyCode', header: t('sales.currency') },
      { key: 'status', header: t('sales.status.label') },
      { key: 'subtotal', header: t('sales.subtotal') },
      ...(showDiscount ? [{ key: 'discountAmount', header: t('sales.discount') }] : []),
      { key: 'vatAmount', header: t('sales.vat') },
      { key: 'totalAmount', header: t('sales.total') },
      { key: 'paidAmount', header: t('sales.paid') },
      { key: 'itemsCount', header: t('sales.itemsCount') },
    ];
    const data = invoices.map(i => ({
      invoiceNumber: i.invoiceNumber,
      customerName: i.customer?.name || i.customerId,
      date: i.date,
      dueDate: i.dueDate || '-',
      paymentType: i.paymentType === 'cash' ? t('sales.invoice.cash') : t('sales.invoice.credit'),
      currencyCode: i.currencyCode || '',
      status: STATUS_FLOW[i.status] || i.status,
      subtotal: i.subtotal,
      ...(showDiscount ? { discountAmount: i.discountAmount } : {}),
      vatAmount: i.vatAmount,
      totalAmount: i.totalAmount,
      paidAmount: i.paidAmount,
      itemsCount: i.lines?.length || 0,
    }));
    exportToExcel(data, exportColumns, `sales_invoices_${new Date().toISOString().split('T')[0]}`);
  };

  const handleExportPDF = () => {
    const exportColumns = [
      { key: 'invoiceNumber', header: t('sales.invoiceNumber'), width: 30 },
      { key: 'customerName', header: t('sales.customer.title'), width: 40 },
      { key: 'date', header: t('sales.date'), width: 20 },
      { key: 'status', header: t('sales.status.label'), width: 20 },
      { key: 'totalAmount', header: t('sales.total'), width: 25 },
    ];
    const data = invoices.map(i => ({
      invoiceNumber: i.invoiceNumber,
      customerName: i.customer?.name || i.customerId,
      date: i.date,
      status: STATUS_FLOW[i.status] || i.status,
      totalAmount: formatCurrency(i.totalAmount),
    }));
    exportToPDF(data, exportColumns, `sales_invoices_${new Date().toISOString().split('T')[0]}`, {
      title: t('sales.invoices'),
      rtl: true,
    });
  };

  const tableColumns = [
    {
      key: 'invoiceNumber',
      header: t('sales.invoiceNumber'),
      width: '135px',
      mobile: 'title' as const,
      render: (row: SalesInvoice) => (
        <span className="font-mono text-xs font-semibold bg-slate-50 dark:bg-slate-800 px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 flex items-center gap-1 w-fit">
          <span className="w-1.5 h-1.5 rounded-full bg-primary-500" />
          {row.invoiceNumber}
        </span>
      ),
    },
    {
      key: 'customerName',
      header: t('sales.customer.title'),
      mobile: 'subtitle' as const,
      render: (row: SalesInvoice) => (
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
            {(row.customer?.name || row.customerId || '?').charAt(0).toUpperCase()}
          </div>
          <span className="font-medium truncate">{row.customer?.name || row.customerId.slice(0, 8)}</span>
        </div>
      ),
    },
    { key: 'date', header: t('sales.date'), width: '110px', render: (row: SalesInvoice) => <span className="font-mono text-xs bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded border tabular-nums">{formatDate(row.date)}</span> },
    { key: 'dueDate', header: t('sales.dueDate'), width: '110px', render: (row: SalesInvoice) => row.dueDate ? <span className="font-mono text-xs tabular-nums">{formatDate(row.dueDate)}</span> : <span className="text-slate-400">—</span> },
    { key: 'subtotal', header: t('sales.subtotal'), align: 'right' as const, render: (row: SalesInvoice) => <span className="tabular-nums text-sm">{formatCurrency(row.subtotal)}</span> },
    ...(showDiscount ? [{ key: 'discountAmount', header: t('sales.discount'), align: 'right' as const, render: (row: SalesInvoice) => <span className="tabular-nums text-sm text-amber-700 dark:text-amber-300">{formatCurrency(row.discountAmount)}</span> }] : []),
    { key: 'vatAmount', header: t('sales.vat'), align: 'right' as const, render: (row: SalesInvoice) => <span className="tabular-nums text-sm text-slate-600">{formatCurrency(row.vatAmount)}</span> },
    {
      key: 'totalAmount',
      header: t('sales.total'),
      align: 'right' as const,
      render: (row: SalesInvoice) => (
        <div className="text-end">
          <p className="font-bold tabular-nums">{formatCurrency(row.totalAmount)}</p>
          {row.currencyCode && row.currencyCode !== currencySymbol && <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border text-slate-600">{row.currencyCode}</span>}
        </div>
      ),
    },
    { key: 'paidAmount', header: t('sales.paid'), align: 'right' as const, render: (row: SalesInvoice) => <span className="tabular-nums text-sm text-emerald-700 dark:text-emerald-300">{formatCurrency(row.paidAmount)}</span> },
    {
      key: 'paymentType',
      header: t('sales.invoice.paymentType'),
      width: '95px',
      render: (row: SalesInvoice) => (
        <span
          className={`px-2.5 py-1 rounded-full text-xs font-medium border ${row.paymentType === 'cash' ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800' : 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800'}`}
        >
          {row.paymentType === 'cash' ? t('sales.invoice.cash') : t('sales.invoice.credit')}
        </span>
      ),
    },
    { key: 'status', header: t('sales.status.label'), width: '110px', mobile: 'status' as const, render: (row: SalesInvoice) => <StatusBadge status={row.status} /> },
    { key: 'createdBy', header: t('common.createdBy'), width: '110px', mobile: 'hidden' as const, render: (row: SalesInvoice) => (
      <span className="text-xs text-slate-600 dark:text-slate-400">{getUserName(row.createdBy)}</span>
    ) },
    { key: 'actions', header: t('sales.actions'), width: '180px', mobile: 'actions' as const, render: (row: SalesInvoice) => (
      <div className="flex items-center gap-1">
        <ActionButtons
          onView={async () => {
            if (activeCompany?.id) {
              const res = await salesApi.getInvoiceById(row.id, activeCompany.id);
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
            <Button
              size="sm"
              variant="secondary"
              onClick={() => handlePost(row)}
              disabled={postingId === row.id}
              leftIcon={<CheckSquare size={14} />}
            >
              {postingId === row.id ? (t('loading')) : (t('sales.invoice.post'))}
            </Button>
          )}
          {['posted', 'partially_paid', 'paid'].includes(row.status) && (
            <Can action="post" module="sales">
              <Button
                size="sm"
                variant="ghost"
                title={t('accounting.reverse.title')}
                aria-label={t('accounting.reverse.title')}
                onClick={() => setReverseRow(row)}
              >
                <Undo2 size={14} />
              </Button>
            </Can>
          )}
        </div>
      )},
  ];

  const stats = useMemo(() => {
    const active = invoices.filter(i => i.status !== 'cancelled');
    const total = active.reduce((s, i) => s + i.totalAmount, 0);
    const paid = active.reduce((s, i) => s + i.paidAmount, 0);
    const draftCount = invoices.filter(i => i.status === 'draft').length;
    const postedCount = active.length - draftCount;
    return { total, paid, draftCount, postedCount };
  }, [invoices]);

  const filteredInvoices = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return invoices;
    return invoices.filter((inv) => (inv.invoiceNumber?.toLowerCase() || '').includes(q) || (inv.customer?.name?.toLowerCase() || '').includes(q) || inv.customerId.toLowerCase().includes(q));
  }, [invoices, search]);

  const hasFilters = !!(search || statusFilter);

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-col gap-4">
        <PageHeader
          icon={<ShoppingCart size={22} />}
          title={t('sales.invoices')}
          subtitle={t('sales.invoicesSubtitle')}
          actions={
            <>
              <OwnerFilterToggle isOwnOnly={isOwnOnly} showToggle={showOwnerToggle} onToggle={toggleOwnOnly} />
              <Can action="create" module="sales">
                <Button variant="primary" leftIcon={<Plus size={16} />} onClick={openCreate} className="shadow-sm">
                  {t('sales.invoice.create')}
                </Button>
              </Can>
            </>
          }
        />

        <StatsGrid
          columns={4}
          items={[
            { label: t('sales.invoice.totalInvoices'), value: String(total), hint: `${stats.postedCount} ${t('sales.invoice.postedHint')} • ${stats.draftCount} ${t('sales.status.draft')}`, icon: <FileText size={18} /> },
            { label: t('sales.total'), value: formatCurrency(stats.total), hint: `${currencySymbol} • ${t('sales.invoice.totalHint')}`, icon: <Wallet size={18} />, tone: 'info' },
            { label: t('sales.paid'), value: formatCurrency(stats.paid), hint: `${currencySymbol} • ${t('sales.invoice.collectedHint')}`, icon: <CheckCircle2 size={18} />, tone: 'success' },
            { label: t('sales.invoice.drafts'), value: String(stats.draftCount), hint: t('sales.invoice.pendingHint'), icon: <Clock size={18} />, tone: 'warning' },
          ]}
        />

        <div>
          <FilterBar
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder={t('search')}
            filterOptions={[
              { key: '', label: t('sales.filter.all') },
              { key: 'draft', label: t('sales.status.draft') },
              { key: 'posted', label: t('sales.status.posted') },
              { key: 'paid', label: t('sales.status.paid') },
              { key: 'cancelled', label: t('sales.status.cancelled') },
            ]}
            activeFilter={statusFilter}
            onFilterChange={(key) => setStatusFilter(key)}
            actions={
              <>
                <Button size="sm" variant="ghost" onClick={handleExportExcel} className="gap-1.5">
                  <Download size={14} className="text-emerald-600" /> <span className="hidden sm:inline text-xs">{t('common.excel')}</span>
                </Button>
                <Button size="sm" variant="ghost" onClick={handleExportPDF} className="gap-1.5">
                  <Printer size={14} className="text-rose-600" /> <span className="hidden sm:inline text-xs">PDF</span>
                </Button>
              </>
            }
          />
          {hasFilters && (
            <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
              <span>{filteredInvoices.length} من {invoices.length} • {search ? `"${search}"` : ''} {statusFilter ? `• ${t('sales.status.' + statusFilter)}` : ''}</span>
              <button onClick={() => { setSearch(''); setStatusFilter(''); }} className="text-primary-600 hover:underline font-medium">{t('sales.filter.clearFilters')}</button>
            </div>
          )}
        </div>
      </div>

      <Card noPadding>
        {isLoading ? (
          <div className="space-y-3 p-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-14 bg-slate-100 dark:bg-slate-800 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : invoices.length === 0 ? (
          <div className="py-8">
            <EmptyState
              icon="file"
              title={t('sales.invoice.emptyTitle')}
              description={t('sales.invoice.emptyDescription')}
              action={
                <Can action="create" module="sales">
                  <Button onClick={openCreate} leftIcon={<Plus size={16} />}>{t('sales.invoice.create')}</Button>
                </Can>
              }
            />
          </div>
        ) : filteredInvoices.length === 0 ? (
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
            <DynamicTable<SalesInvoice> tableKey="sales.invoices" data={filteredInvoices} columns={tableColumns} keyExtractor={(row, i) => row.id || String(i)} isLoading={isLoading} />
            <div className="border-t border-slate-200 dark:border-slate-800">
              <Pagination page={page} pageSize={pageSize} total={total} onPageChange={goToPage} onPageSizeChange={changePageSize} />
            </div>
          </>
        )}
      </Card>


      {/* Detail Modal */}
      <Modal isOpen={detailOpen} onClose={() => setDetailOpen(false)} size="lg" title={`${t('sales.invoice.details')} - ${viewing?.invoiceNumber}`}>
        {viewing && (
          <div className="space-y-4 p-1">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3">
                <p className="text-slate-500 dark:text-slate-400">{t('sales.customer.title')}</p>
                <p className="font-semibold text-slate-900 dark:text-slate-50">{viewing.customer?.name || viewing.customerId}</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3">
                <p className="text-slate-500 dark:text-slate-400">{t('sales.status.label')}</p>
                <StatusBadge status={viewing.status} />
              </div>
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3">
                <p className="text-slate-500 dark:text-slate-400">{t('sales.date')}</p>
                <p className="font-semibold text-slate-900 dark:text-slate-50">{formatDate(viewing.date)}</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3">
                <p className="text-slate-500 dark:text-slate-400">{t('sales.dueDate')}</p>
                <p className="font-semibold text-slate-900 dark:text-slate-50">{viewing.dueDate ? formatDate(viewing.dueDate) : '-'}</p>
              </div>
            </div>
            <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                  <tr>
                    <th className="px-3 py-2 text-right">#</th>
                    <th className="px-3 py-2 text-right">{t('inventory.productName')}</th>
                    <th className="px-3 py-2 text-right">{t('select.product.code')}</th>
                    <th className="px-3 py-2 text-right">{t('select.product.barcode')}</th>
                    <th className="px-3 py-2 text-right">{t('select.product.unit')}</th>
                    <th className="px-3 py-2 text-right">{t('inventory.quantity')}</th>
                    <th className="px-3 py-2 text-right">{t('inventory.unitPrice')}</th>
                    <th className="px-3 py-2 text-right">{t('sales.total')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(viewing.lines || []).map((l, i) => (
                    <tr key={i} className="border-b border-slate-100 dark:border-slate-800">
                      <td className="px-3 py-2 text-slate-500">{i + 1}</td>
                      <td className="px-3 py-2 font-medium">{l.productName || l.productId}</td>
                      <td className="px-3 py-2 text-slate-500 font-mono text-xs">{l.productCode || '-'}</td>
                      <td className="px-3 py-2 text-slate-500 font-mono text-xs">{l.barcode || '-'}</td>
                      <td className="px-3 py-2 text-slate-500">{l.unitName || l.unit || '-'}</td>
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
                {showDiscount && viewing.discountAmount > 0 && <p className="text-slate-500 dark:text-slate-400">{t('sales.discount')}: <span className="font-medium text-amber-700 dark:text-amber-300">-{formatCurrency(viewing.discountAmount)}</span></p>}
                <p className="text-slate-500 dark:text-slate-400">{t('sales.vat')}: <span className="font-medium text-slate-900 dark:text-slate-50">{formatCurrency(viewing.vatAmount)}</span></p>
                {viewing.baseCurrencyAmount !== undefined && viewing.baseCurrencyAmount > 0 && viewing.currencyCode !== currencySymbol && (
                  <p className="text-slate-500 dark:text-slate-400">{t('sales.baseCurrency')} ({currencySymbol}): <span className="font-medium text-slate-900 dark:text-slate-50">{formatCurrency(viewing.baseCurrencyAmount)}</span></p>
                )}
              </div>
              <div className="text-xl font-bold text-primary-600 dark:text-primary-400">
                {t('sales.total')}: {formatCurrency(viewing.totalAmount)}
                {viewing.currencyCode && viewing.currencyCode !== currencySymbol && (
                  <span className="text-sm font-normal text-slate-500 mr-2">({viewing.currencyCode})</span>
                )}
              </div>
            </div>
            {viewing.attachments && viewing.attachments.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{t('sales.invoice.attachments')}</p>
                <ul className="space-y-1">
                  {viewing.attachments.map(att => (
                    <li key={att.id} className="flex items-center gap-2 px-3 py-2 bg-slate-50 dark:bg-slate-800 rounded-md text-sm">
                      <FileText size={14} className="text-slate-500" />
                      <a href={att.dataUrl} download={att.name} className="flex-1 text-primary-600 dark:text-primary-400 hover:underline truncate">
                        {att.name}
                       </a>
                      <span className="text-xs text-slate-500">({Math.round(att.size / 1024)} KB)</span>
                     </li>
                  ))}
                 </ul>
               </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDetailOpen(false)}>{t('close')}</Button>
              <Button variant="primary" onClick={() => { handlePrint(viewing); }} leftIcon={<Printer size={16} />}>{t('print.title')}</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Confirm Dialog */}
      <ConfirmDialog
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => { confirmConfig?.onConfirm(); }}
        title={confirmConfig?.title || ''}
        message={confirmConfig?.message || ''}
        variant={confirmConfig?.variant || 'warning'}
          confirmText={confirmConfig?.confirmText || (t('confirm.confirmText'))}
          cancelText={t('cancel')}
        />

        <ReverseDialog
          open={!!reverseRow}
          onClose={() => setReverseRow(null)}
          docLabel={reverseRow?.invoiceNumber || ''}
          onConfirm={handleReverseConfirm}
        />
    </div>
  );
};

export default InvoicesPage;
