import React, { useState, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Tag, Plus, FileText, CheckSquare, Printer, ArrowRightLeft, Sparkles, Download } from 'lucide-react';
import { Card, Button, DynamicTable, Modal, Pagination, Can, PageHeader, StatsGrid, FilterBar } from '@/core/ui/components';
import { ConfirmDialog } from '@/core/ui/components/ConfirmDialog';
import { DuplicateWarningDialog } from '@/core/ui/components/DuplicateWarningDialog';
import { salesQuotationFingerprint, genericNearScore, detectDocumentDuplicates } from '@/core/utils/documentDuplicate';
import { StatusBadge } from '@/core/ui/components/StatusBadge';
import { ActionButtons } from '@/core/ui/components/ActionButtons';
import { EmptyState } from '@/core/ui/components/EmptyState';
import { useQuotationsPaginated } from '../hooks/useSales';
import { salesApi } from '../api';
import { useAppStore } from '@/core/store';
import { useAuthStore } from '@/modules/auth/store';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useFormatters } from '@/core/utils/useFormatters';
import { roundMoney } from '@/core/utils/locale';
import { useDocumentSequence } from '@/core/utils/useDocumentSequence';
import { useDefaultPaymentAccounts } from '@/core/hooks/useDefaultPaymentAccounts';
import { useSettings } from '@/core/utils/useSettings';
import { YER_CODE } from '@/core/utils/currencyConverter';
import { useOwnerFilter } from '@/core/utils/useOwnerFilter';
import { OwnerFilterToggle } from '@/core/ui/components/OwnerFilterToggle';
import { printDocument } from '@/core/utils/printDocument';
import { todayIso } from '@/core/utils/aging';
import { exportToExcel, exportToPDF } from '@/core/utils/exportEngine';
import { logAudit } from '@/core/utils/auditLogger';
import { useToastStore } from '@/core/store/toastStore';
import type { Quotation } from '../types';
import { toBaseQty } from '@/core/utils/unitConversion';
void toBaseQty;
import type { ProductUnit } from '@/modules/inventory/types';

interface QuotationLineForm {
  productId: string;
  productName: string;
  quantity: number;
  /** Chosen product_units row id + frozen factor + base qty (stock truth). */
  unitId?: string;
  unitFactor?: number;
  baseQuantity?: number;
  unitName?: string;
  unitPrice: number;
  discountPercent: number;
}

export const QuotationsPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const STATUS_FLOW = useMemo(() => ({
    draft: t('sales.status.draft'),
    sent: t('sales.status.sent'),
    accepted: t('sales.status.accepted'),
    rejected: t('sales.status.rejected'),
    converted: t('sales.status.converted'),
  }), [t]);
  const activeCompany = useAppStore(state => state.activeCompany);
  const currentUser = useAuthStore(state => state.user);
  const { showToggle: showOwnerToggle, isOwnOnly, toggleOwnOnly } = useOwnerFilter([], 'sales');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const {
    quotations,
    total,
    page,
    pageSize,
    isLoading,
    goToPage,
    changePageSize,
    create,
    update,
    remove,
    convertToInvoice,
  } = useQuotationsPaginated(activeCompany?.id || '', useMemo(() => ({ status: statusFilter || undefined }), [statusFilter]));

  const filteredQuotations = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return quotations;
    return quotations.filter((qt) => (qt.quotationNumber?.toLowerCase() || '').includes(q) || (qt.customer?.name?.toLowerCase() || '').includes(q));
  }, [quotations, search]);
  const hasFilters = !!(search || statusFilter);
  const { getNextNumber } = useDocumentSequence();
  const { settings } = useSettings(activeCompany?.id || '');
  const { defaultCashBoxId } = useDefaultPaymentAccounts(activeCompany?.id || '');
  const currencySymbol = settings?.defaultCurrency || activeCompany?.currency || YER_CODE;
  const { formatCurrency, formatDate, decimalPlaces: dp } = useFormatters(activeCompany?.id || '');

  const [detailOpen, setDetailOpen] = useState(false);
  const [editingId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Quotation | null>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmConfig, setConfirmConfig] = useState<{ title: string; message: string; onConfirm: () => void; variant?: 'danger' | 'warning' | 'info'; confirmText?: string } | null>(null);

  const [saving, setSaving] = useState(false);
  void saving;
  const [docDuplicateOpen, setDocDuplicateOpen] = useState(false);
  const [docDuplicateInput, setDocDuplicateInput] = useState('');
  const [docDuplicateExact, setDocDuplicateExact] = useState<{ name: string; code?: string } | null>(null);
  const [docDuplicateNear, setDocDuplicateNear] = useState<Array<{ name: string; code?: string; score: number }>>([]);
  const docDuplicateConfirmedRef = useRef(false);

  const [header, setHeader] = useState({ customerId: '', date: new Date().toISOString().split('T')[0], expiryDate: '', paymentType: 'credit', cashBoxId: '', notes: '' });
  const [lines, setLines] = useState<QuotationLineForm[]>([{ productId: '', productName: '', quantity: 1, unitId: undefined, unitFactor: 1, baseQuantity: 1, unitName: undefined, unitPrice: 0, discountPercent: 0 }]);
  const [invoiceDiscount, setInvoiceDiscount] = useState(0);
  const [invoiceDiscountType, setInvoiceDiscountType] = useState<'amount' | 'percent'>('amount');
  // Cache of each line-product's units (fed by ProductUnitSelect) so unit
  // switches can tell auto-filled prices apart from manual entries.
  const [lineUnitsCache, setLineUnitsCache] = useState<Record<string, ProductUnit[]>>({});
  const cacheProductUnits = useCallback((productId: string, units: ProductUnit[]) => {
    setLineUnitsCache((prev) => (prev[productId] === units ? prev : { ...prev, [productId]: units }));
  }, []);
  void lineUnitsCache;
  void cacheProductUnits;
  const showDiscount = settings?.invoiceShowDiscount ?? true;
  const showVat = settings?.invoiceShowVat ?? true;

  const defaultLine = (): QuotationLineForm => ({ productId: '', productName: '', quantity: 1, unitId: undefined, unitFactor: 1, baseQuantity: 1, unitName: undefined, unitPrice: 0, discountPercent: 0 });

  void ((): void => {
    setHeader({ customerId: '', date: new Date().toISOString().split('T')[0], expiryDate: '', paymentType: 'credit', cashBoxId: defaultCashBoxId || '', notes: '' });
    setLines([defaultLine()]);
    setInvoiceDiscount(0);
    setInvoiceDiscountType('amount');
  });

  const openCreate = useCallback(() => {
    navigate('/sales/quotations/new');
  }, [navigate]);

  // Paginated rows carry lines: [] — the editor page refetches by id.
  const handleEditRow = (q: Quotation) => {
    navigate(`/sales/quotations/${q.id}`);
  };



  /**
   * Unit switch: adopt the unit's own sale price unless the user typed a
   * custom price (i.e. current price matches no known unit price for this
   * product). Base quantity is always recomputed.
   */

  const calculations = useMemo(() => {
    const lineDiscountTotal = showDiscount ? lines.reduce((s, l) => s + (l.quantity * l.unitPrice * (l.discountPercent / 100)), 0) : 0;
    const subtotal = lines.reduce((s, l) => s + (l.quantity * l.unitPrice * (showDiscount ? (1 - l.discountPercent / 100) : 1)), 0);
    const invoiceDiscountAmount = showDiscount ? (invoiceDiscountType === 'percent' ? subtotal * (invoiceDiscount / 100) : invoiceDiscount) : 0;
    const cappedInvoiceDiscount = Math.min(invoiceDiscountAmount, subtotal);
    const netSubtotal = subtotal - cappedInvoiceDiscount;
    const vatRate = settings?.vatRate ?? 15;
    const vatAmount = showVat ? netSubtotal * (vatRate / 100) : 0;
    const totalAmount = netSubtotal + vatAmount;
    return {
      subtotal: roundMoney(subtotal, dp),
      vatAmount: roundMoney(vatAmount, dp),
      discountAmount: roundMoney(lineDiscountTotal + cappedInvoiceDiscount, dp),
      invoiceDiscountAmount: roundMoney(cappedInvoiceDiscount, dp),
      totalAmount: roundMoney(totalAmount, dp),
      vatRate,
    };
  }, [lines, invoiceDiscount, invoiceDiscountType, showDiscount, showVat, settings?.vatRate, dp]);

  const buildPayload = (quotationNumber: string): Omit<Quotation, 'id'> => ({
    companyId: activeCompany!.id,
    quotationNumber,
    customerId: header.customerId,
    date: header.date,
    expiryDate: header.expiryDate || undefined,
    totalAmount: calculations.totalAmount,
    paymentType: header.paymentType || 'credit',
    cashBoxId: header.paymentType === 'cash' ? (header.cashBoxId || undefined) : undefined,
    status: 'draft',
    notes: header.notes,
    lines: lines.map(l => ({
      productId: l.productId,
      productName: l.productName,
      quantity: l.quantity,
      unitId: l.unitId,
      unitFactor: l.unitFactor ?? 1,
      baseQuantity: toBaseQty(l.quantity, l.unitFactor ?? 1),
      unitName: l.unitName,
      unitPrice: l.unitPrice,
      discountPercent: l.discountPercent,
      lineTotal: roundMoney(l.quantity * l.unitPrice * (1 - l.discountPercent / 100), dp),
    })),
  });

  const handleSave = async () => {
    if (!header.customerId || lines.length === 0 || !activeCompany?.id) return;
    if (lines.some(l => !l.productId)) {
      addToast('error', t('sales.invoice.productRequired') || t('common.error'));
      return;
    }
    if (lines.some(l => l.quantity <= 0)) {
      addToast('error', t('sales.invoice.quantityPositive') || t('common.error'));
      return;
    }
    setSaving(true);
    let quotationNumber: string;
    if (editingId) {
      const existing = quotations.find(q => q.id === editingId);
      quotationNumber = existing?.quotationNumber || '';
    } else {
      const seq = await getNextNumber('quotation', activeCompany.id);
      if (!seq.success || !seq.number) {
        addToast('error', seq.error || t('sales.quotation.numberError'));
        setSaving(false);
        return;
      }
      quotationNumber = seq.number;
    }
    const payload = buildPayload(quotationNumber);
    // ── حارس تكرار المستند — بصمة كاملة (حظر تام) + قريب (تحذير) ──
    if (!docDuplicateConfirmedRef.current) {
      try {
        const existingRes = await salesApi.getQuotationsPaginated(activeCompany.id, 1, 200);
        const existingList = (existingRes.success && existingRes.data ? ((existingRes.data as unknown as { items?: Quotation[] })?.items ?? (existingRes.data as unknown as Quotation[]) ?? []) : []) as Quotation[];
        const inputForFp = {
          customerId: payload.customerId,
          date: payload.date,
          expiryDate: payload.expiryDate,
          totalAmount: payload.totalAmount,
          lines: payload.lines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice, discountPercent: l.discountPercent })),
        };
        const fp = salesQuotationFingerprint(inputForFp as never);
        const result = detectDocumentDuplicates(
          fp,
          inputForFp,
          existingList as never[],
          (d: unknown) => {
            const doc = d as Quotation;
            return salesQuotationFingerprint({ customerId: doc.customerId, date: doc.date, expiryDate: doc.expiryDate, totalAmount: doc.totalAmount } as never);
          },
          (inp: unknown, ex: unknown) => {
            const a = inp as { customerId?: string; date?: string; lines?: Array<{ productId?: string }>; totalAmount?: unknown };
            const b = ex as Quotation;
            return genericNearScore(a.customerId, b.customerId, a.date, b.date, a.lines ?? [], (b.lines ?? []) as Array<{ productId?: string }>, a.totalAmount, b.totalAmount);
          },
          { excludeId: editingId || undefined },
        );
        if (result.exactMatch) {
          const doc = result.exactMatch as unknown as Quotation;
          setDocDuplicateInput(`${payload.customerId} • ${payload.date} • ${payload.totalAmount}`);
          setDocDuplicateExact({ name: doc.quotationNumber || String(doc.id).slice(0, 8), code: `${doc.date} • ${doc.totalAmount}` });
          setDocDuplicateNear([]);
          setDocDuplicateOpen(true);
          setSaving(false);
          return;
        }
        if (result.nearMatches.length > 0) {
          setDocDuplicateInput(`${payload.customerId} • ${payload.date}`);
          setDocDuplicateNear(
            result.nearMatches.map((m) => {
              const d = m.item as unknown as Quotation;
              return { name: d.quotationNumber || String(d.id).slice(0, 8), code: `${d.date} • ${d.totalAmount}`, score: m.score };
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
        await logAudit({ userId: currentUser?.id || 'system', action: 'update', tableName: 'quotations', recordId: editingId, companyId: activeCompany.id });
        addToast('success', t('sales.quotation.updated'));
      } else {
        addToast('error', res.error || t('error'));
      }
    } else {
      const res = await create(payload);
      if (res.success && res.id && activeCompany.id) {
        await logAudit({ userId: currentUser?.id || 'system', action: 'create', tableName: 'quotations', recordId: res.id, companyId: activeCompany.id });
        addToast('success', t('sales.quotation.created'));
      } else {
        addToast('error', res.error || t('error'));
      }
    }
    setSaving(false);
  };

  const handleDelete = (q: Quotation) => {
    setConfirmConfig({
      title: t('sales.quotation.deleteTitle'),
      message: `${t('sales.quotation.deleteConfirm')} ${q.quotationNumber}؟`,
      variant: 'danger',
      onConfirm: async () => {
        setConfirmOpen(false);
        const res = await remove(q.id);
        if (res.success && activeCompany?.id) {
          await logAudit({ userId: currentUser?.id || 'system', action: 'delete', tableName: 'quotations', recordId: q.id, companyId: activeCompany.id });
          addToast('success', t('sales.quotation.deleted'));
        } else {
          addToast('error', res.error || t('error'));
        }
      },
    });
    setConfirmOpen(true);
  };

  const handleConvertToInvoice = (q: Quotation) => {
    setConfirmConfig({
      title: t('sales.quotation.convertTitle'),
      message: `${t('sales.quotation.convertConfirm')}`,
      variant: 'warning',
      confirmText: t('sales.quotation.convert'),
      onConfirm: async () => {
        setConfirmOpen(false);
        if (!activeCompany?.id) return;
        const fullRes = await salesApi.getQuotationById(q.id, activeCompany.id);
        if (!fullRes.success || !fullRes.data || !fullRes.data.lines?.length) {
          addToast('error', fullRes.error || t('sales.quotation.noLines') || t('error'));
          return;
        }
        const fullQuotation = fullRes.data;
        const seq = await getNextNumber('sales_invoice', activeCompany.id);
        if (!seq.success || !seq.number) {
          addToast('error', seq.error || t('sales.invoice.numberError'));
          return;
        }
        const invoiceNumber = seq.number;
        const payload = {
          companyId: activeCompany.id,
          invoiceNumber,
          customerId: fullQuotation.customerId,
          date: new Date().toISOString().split('T')[0],
          dueDate: new Date().toISOString().split('T')[0],
          subtotal: fullQuotation.totalAmount,
          discountAmount: 0,
          vatAmount: 0,
          totalAmount: fullQuotation.totalAmount,
          paidAmount: 0,
          paymentType: fullQuotation.paymentType || 'credit',
          status: 'draft' as const,
          notes: `${t('sales.quotation.convertedNote')} ${fullQuotation.quotationNumber}`,
          lines: fullQuotation.lines.map(l => ({
            productId: l.productId,
            productName: l.productName,
            quantity: l.quantity,
            unitId: l.unitId,
            unitFactor: l.unitFactor ?? 1,
            baseQuantity: l.baseQuantity ?? l.quantity,
            unitName: l.unitName || l.unit,
            unitPrice: l.unitPrice,
            discountPercent: l.discountPercent,
            vatPercent: 0,
            lineTotal: l.lineTotal,
          })),
        };
        const res = await convertToInvoice(q.id, payload);
        if (res.success && activeCompany.id) {
          await logAudit({ userId: currentUser?.id || 'system', action: 'update', tableName: 'quotations', recordId: q.id, companyId: activeCompany.id, newValues: { status: 'converted' } });
          addToast('success', t('sales.quotation.converted'));
        } else {
          addToast('error', res.error || t('error'));
        }
      },
    });
    setConfirmOpen(true);
  };

  const handlePrint = async (q: Quotation) => {
    let lines = q.lines;
    if ((!lines || lines.length === 0) && activeCompany?.id) {
      const res = await salesApi.getQuotationById(q.id, activeCompany.id);
      if (res.success && res.data?.lines) lines = res.data.lines;
    }
    const isOverdue = q.expiryDate ? q.expiryDate < todayIso() : false;
    printDocument({
      type: 'quotation',
      docNumber: q.quotationNumber,
      date: q.date,
      dueDate: q.expiryDate,
      partyName: q.customer?.name || q.customerId,
      partyLabel: t('sales.customer.title'),
      partyTaxNumber: q.customer?.taxNumber,
      partyAddress: q.customer?.address,
      lines: (lines || []).map(l => ({
        description: l.productName || l.productId,
        productCode: l.productCode,
        barcode: l.barcode,
        sku: l.sku,
        unit: l.unitName || l.unit,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        total: l.lineTotal,
      })),
      subtotal: q.totalAmount,
      vatAmount: 0,
      totalAmount: q.totalAmount,
      notes: q.notes,
      companyName: activeCompany?.name,
      companyTaxNumber: activeCompany?.taxNumber,
      companyAddress: activeCompany?.address,
      companyPhone: activeCompany?.phone,
      companyEmail: activeCompany?.email,
      companyLogoUrl: activeCompany?.logoUrl,
      vatRate: settings?.vatRate ?? 15,
      currency: currencySymbol,
      paymentType: q.paymentType,
      createdBy: q.createdBy,
      statusBadge: STATUS_FLOW[q.status] || q.status,
      statusTone: q.status === 'converted' || q.status === 'accepted' ? 'success' : (isOverdue ? 'warning' : 'muted'),
    }, false, t);
  };

  const handleExportExcel = () => {
    const cols = [
      { key: 'quotationNumber', header: t('sales.quotation.number') },
      { key: 'customerName', header: t('sales.customer.title') },
      { key: 'date', header: t('sales.date') },
      { key: 'expiryDate', header: t('sales.quotation.expiry') },
      { key: 'totalAmount', header: t('sales.total') },
      { key: 'status', header: t('sales.status.label') },
    ];
    exportToExcel(quotations.map(q => ({ quotationNumber: q.quotationNumber, customerName: q.customer?.name || q.customerId, date: q.date, expiryDate: q.expiryDate || '-', totalAmount: q.totalAmount, status: STATUS_FLOW[q.status] || q.status })), cols, `quotations_${new Date().toISOString().split('T')[0]}`);
  };

  const handleExportPdf = () => {
    const exportColumns = [
      { key: 'quotationNumber', header: t('sales.quotation.number') },
      { key: 'customerName', header: t('sales.customer.title') },
      { key: 'date', header: t('sales.date') },
      { key: 'expiryDate', header: t('sales.quotation.expiry') },
      { key: 'totalAmount', header: t('sales.total') },
      { key: 'status', header: t('sales.status.label') },
    ];
    exportToPDF(filteredQuotations.map(q => ({ quotationNumber: q.quotationNumber, customerName: q.customer?.name || q.customerId, date: q.date, expiryDate: q.expiryDate || '-', totalAmount: formatCurrency(q.totalAmount), status: STATUS_FLOW[q.status] || q.status })), exportColumns, `quotations_${new Date().toISOString().split('T')[0]}`, {
      title: t('sales.quotations'),
      rtl: true,
    });
  };

  const kpis = useMemo(() => {
    const accepted = quotations.filter(q => q.status === 'accepted').length;
    const draft = quotations.filter(q => q.status === 'draft').length;
    const converted = quotations.filter(q => q.status === 'converted').length;
    const totalValue = quotations.reduce((s, q) => s + Number(q.totalAmount || 0), 0);
    return { accepted, draft, converted, totalValue };
  }, [quotations]);

  const tableColumns = [
    {
      key: 'quotationNumber',
      header: t('sales.quotation.number'),
      width: '135px',
      mobile: 'title' as const,
      render: (row: Quotation) => (
        <span className="font-mono text-xs font-semibold bg-slate-50 dark:bg-slate-800 px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 flex items-center gap-1 w-fit">
          <Tag size={12} className="text-primary-500" />
          {row.quotationNumber}
       </span>
      ),
    },
    {
      key: 'customerName',
      header: t('sales.customer.title'),
      mobile: 'subtitle' as const,
      render: (row: Quotation) => (
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
            {(row.customer?.name || row.customerId || '?').charAt(0).toUpperCase()}
         </div>
          <span className="font-medium truncate">{row.customer?.name || row.customerId.slice(0, 8)}</span>
       </div>
      ),
    },
    { key: 'date', header: t('sales.date'), width: '110px', render: (row: Quotation) => <span className="font-mono text-xs bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded border tabular-nums">{formatDate(row.date)}</span> },
    { key: 'expiryDate', header: t('sales.quotation.expiry'), width: '110px', render: (row: Quotation) => row.expiryDate ? <span className="font-mono text-xs tabular-nums">{formatDate(row.expiryDate)}</span> : <span className="text-slate-400">—</span> },
    { key: 'totalAmount', header: t('sales.total'), align: 'right' as const, render: (row: Quotation) => <span className="font-bold tabular-nums">{formatCurrency(row.totalAmount)}</span> },
    {
      key: 'paymentType',
      header: t('sales.quotation.paymentType'),
      width: '95px',
      render: (row: Quotation) => (
        <span
          className={`px-2.5 py-1 rounded-full text-xs font-medium border ${row.paymentType === 'cash' ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800' : 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800'}`}
        >
          {row.paymentType === 'cash' ? t('sales.invoice.cash') : t('sales.invoice.credit')}
       </span>
      ),
    },
    { key: 'status', header: t('sales.status.label'), width: '110px', mobile: 'status' as const, render: (row: Quotation) => <StatusBadge status={row.status} /> },
    { key: 'actions', header: t('sales.actions'), width: '220px', mobile: 'actions' as const, render: (row: Quotation) => (
      <div className="flex items-center gap-1">
        <ActionButtons
          onView={async () => {
            if (activeCompany?.id) {
              const res = await salesApi.getQuotationById(row.id, activeCompany.id);
              if (res.success && res.data) { setViewing(res.data); setDetailOpen(true); return; }
            }
            setViewing(row); setDetailOpen(true);
          }}
          onEdit={row.status !== 'converted' ? () => handleEditRow(row) : undefined}
          onDelete={row.status !== 'converted' ? () => handleDelete(row) : undefined}
          onPrint={() => handlePrint(row)}
          showView
          showEdit={row.status !== 'converted'}
          showDelete={row.status !== 'converted'}
          showPrint
        />
        {row.status === 'draft' && (
          <Button size="sm" variant="secondary" onClick={() => handleConvertToInvoice(row)} leftIcon={<ArrowRightLeft size={14} />}>
            {t('sales.quotation.convert')}
          </Button>
        )}
      </div>
    )},
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        icon={<FileText size={22} />}
        title={t('sales.quotations')}
        subtitle={t('sales.quotationsSubtitle')}
        actions={
          <Can action="create" module="sales">
            <Button size="sm" variant="primary" leftIcon={<Plus size={15} />} onClick={openCreate}>{t('sales.quotation.create')}</Button>
          </Can>
        }
      />

      {/* KPI Cards */}
      <StatsGrid
        columns={4}
        items={[
          { label: t('sales.quotation.total'), value: String(quotations.length), icon: <Sparkles size={18} /> },
          { label: t('sales.quotation.accepted'), value: String(kpis.accepted), icon: <CheckSquare size={18} />, tone: 'success' },
          { label: t('sales.quotation.convertedCount'), value: String(kpis.converted), icon: <ArrowRightLeft size={18} />, tone: 'warning' },
          { label: t('sales.quotation.drafts'), value: String(kpis.draft), icon: <FileText size={18} />, tone: 'danger' },
        ]}
      />

      {/* Toolbar */}
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder={t('search')}
        filterOptions={[
          { key: '', label: t('sales.filter.all') },
          { key: 'draft', label: t('sales.status.draft') },
          { key: 'sent', label: t('sales.status.sent') },
          { key: 'accepted', label: t('sales.status.accepted') },
          { key: 'rejected', label: t('sales.status.rejected') },
          { key: 'converted', label: t('sales.status.converted') },
        ]}
        activeFilter={statusFilter}
        onFilterChange={(key) => setStatusFilter(key)}
        actions={
          <>
            <OwnerFilterToggle isOwnOnly={isOwnOnly} showToggle={showOwnerToggle} onToggle={toggleOwnOnly} />
            <Button size="sm" variant="secondary" onClick={handleExportExcel} leftIcon={<Download size={15} className="text-emerald-600" />}>Excel</Button>
            <Button size="sm" variant="secondary" onClick={handleExportPdf} leftIcon={<Printer size={15} />}>PDF</Button>
          </>
        }
      />

      {/* Filter result count */}
      {hasFilters && (
        <div className="text-xs text-slate-500 flex items-center gap-2 px-1">
          <span>{filteredQuotations.length} من {quotations.length}</span>
          {search ? <span>• &ldquo;{search}&rdquo;</span> : null}
          {statusFilter ? <span>• {t('sales.status.' + statusFilter)}</span> : null}
          <button onClick={() => { setSearch(''); setStatusFilter(''); }} className="text-violet-600 hover:underline font-medium ml-2">{t('sales.filter.clearFilters')}</button>
        </div>
      )}

      <Card>
        <div className="flex items-center justify-between py-1 px-1">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{t('sales.quotations')}</h3>
          <span className="text-[11px] uppercase tracking-widest text-slate-400 font-medium">{quotations.length}</span>
        </div>
        {isLoading ? (
          <div className="space-y-3 p-4">
            {[1,2,3,4,5].map(i => <div key={i} className="h-10 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse" />)}
          </div>
        ) : quotations.length === 0 ? (
          <div className="py-8">
            <EmptyState
              icon="inbox"
              title={t('sales.quotation.emptyTitle')}
              description={t('sales.quotation.emptyDesc')}
              action={<Can action="create" module="sales"><Button variant="primary" leftIcon={<Plus size={16} />} onClick={openCreate}>{t('sales.quotation.create')}</Button></Can>}
            />
          </div>
        ) : filteredQuotations.length === 0 ? (
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
            <DynamicTable<Quotation> tableKey="sales.quotations" data={filteredQuotations} columns={tableColumns} keyExtractor={(row, i) => row.id || String(i)} isLoading={isLoading} />
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


      {/* Detail Modal */}
      <Modal isOpen={detailOpen} onClose={() => setDetailOpen(false)} size="lg" title={`${t('sales.quotation.details')} - ${viewing?.quotationNumber}`}>
        {viewing && (
          <div className="space-y-4 p-1">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3"><p className="text-slate-500 dark:text-slate-400">{t('sales.customer.title')}</p><p className="font-semibold">{viewing.customer?.name || viewing.customerId}</p></div>
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3"><p className="text-slate-500 dark:text-slate-400">{t('sales.status.label')}</p><StatusBadge status={viewing.status} /></div>
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3"><p className="text-slate-500 dark:text-slate-400">{t('sales.date')}</p><p className="font-semibold">{viewing.date}</p></div>
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3"><p className="text-slate-500 dark:text-slate-400">{t('sales.quotation.expiry')}</p><p className="font-semibold">{viewing.expiryDate || '-'}</p></div>
            </div>
            <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300"><tr><th className="px-3 py-2 text-right">#</th><th className="px-3 py-2 text-right">{t('inventory.productName')}</th><th className="px-3 py-2 text-right">{t('select.product.unit')}</th><th className="px-3 py-2 text-right">{t('inventory.quantity')}</th><th className="px-3 py-2 text-right">{t('inventory.unitPrice')}</th><th className="px-3 py-2 text-right">{t('sales.total')}</th></tr></thead>
                <tbody>
                  {(viewing.lines || []).map((l, i) => (
                    <tr key={i} className="border-b border-slate-100 dark:border-slate-800">
                      <td className="px-3 py-2 text-slate-500">{i + 1}</td>
                      <td className="px-3 py-2 font-medium">{l.productName || l.productId}</td>
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
              <p className="text-slate-700 dark:text-slate-200 font-medium">{t('sales.total')}</p>
              <p className="text-xl font-bold text-primary-600 dark:text-primary-400">{formatCurrency(viewing.totalAmount)}</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDetailOpen(false)}>{t('close')}</Button>
              <Button variant="primary" onClick={() => handlePrint(viewing)} leftIcon={<Printer size={16} />}>{t('print.title')}</Button>
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
        confirmText={confirmConfig?.confirmText || (t('confirm.confirmText'))}
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
        entityLabel={t('sales.quotations')}
        exactMatch={docDuplicateExact}
        nearMatches={docDuplicateNear}
        isDocument
        isEdit={!!editingId}
      />
    </div>
  );
};

export default QuotationsPage;

