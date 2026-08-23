import React, { useState, useMemo, useCallback } from 'react';
import { Boxes, ArrowRightLeft, Plus, Scale, AlertTriangle, CheckCircle, Search, X, Package, Warehouse, Layers, TrendingUp, FileText, Receipt, Wallet, Hash } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Card, Button, Input, Modal, Table, Can, Badge } from '@/core/ui/components';
import { ActionButtons } from '@/core/ui/components/ActionButtons';
import { StatusBadge } from '@/core/ui/components/StatusBadge';
import { ConfirmDialog } from '@/core/ui/components/ConfirmDialog';
import { EmptyState } from '@/core/ui/components/EmptyState';
import { ProductSelect, WarehouseSelect } from '@/core/ui/components/smart';
import { useStockDetailed, useStockTransfers } from '../hooks/useInventory';
import { useAppStore } from '@/core/store';
import { useDocumentSequence } from '@/core/utils/useDocumentSequence';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useToastStore } from '@/core/store/toastStore';
import { useFormatters } from '@/core/utils/useFormatters';
import { exportToExcel, exportToPDF } from '@/core/utils/exportEngine';
import type { StockItem, StockTransfer } from '../types';

export const StockPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const activeCompany = useAppStore((state) => state.activeCompany);
  const { stock, isLoading } = useStockDetailed(activeCompany?.id || '');
  const { transfers, create: createTransfer, complete: completeTransfer, remove: removeTransfer } = useStockTransfers(activeCompany?.id || '');
  const { getNextNumber } = useDocumentSequence();
  const { formatCurrency } = useFormatters(activeCompany?.id || '');

  const [isTransferOpen, setIsTransferOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmComplete, setConfirmComplete] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [stockSearch, setStockSearch] = useState('');
  const [stockWarehouseFilter, setStockWarehouseFilter] = useState<string>('');
  const [showLowOnly, setShowLowOnly] = useState(false);
  const [transferStatusFilter, setTransferStatusFilter] = useState<string>('');
  const [transferSearch, setTransferSearch] = useState('');

  const [transferForm, setTransferForm] = useState({
    productId: '',
    fromWarehouseId: '',
    toWarehouseId: '',
    quantity: '',
    date: new Date().toISOString().split('T')[0],
    transferNumber: '',
    reference: '',
    notes: '',
  });

  const stockStats = useMemo(() => {
    const totalItems = stock.length;
    const totalQty = stock.reduce((s, it) => s + Number(it.quantity || 0), 0);
    const lowCount = stock.filter((it) => it.minStockAlert !== undefined && it.minStockAlert !== null && Number(it.quantity) < Number(it.minStockAlert)).length;
    const totalValue = stock.reduce((s, it) => s + Number(it.quantity || 0) * Number(it.costPrice || 0), 0);
    return { totalItems, totalQty, lowCount, totalValue };
  }, [stock]);

  const uniqueWarehouses = useMemo(() => {
    const map = new Map<string, string>();
    stock.forEach((s) => { if (s.warehouseId && s.warehouseName) map.set(s.warehouseId, s.warehouseName); });
    transfers.forEach((tr) => {
      if (tr.fromWarehouseId) map.set(tr.fromWarehouseId, tr.fromWarehouseName || tr.fromWarehouseId.slice(0, 8));
      if (tr.toWarehouseId) map.set(tr.toWarehouseId, tr.toWarehouseName || tr.toWarehouseId.slice(0, 8));
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [stock, transfers]);

  const filteredStock = useMemo(() => {
    const q = stockSearch.trim().toLowerCase();
    return stock.filter((it) => {
      if (stockWarehouseFilter && it.warehouseId !== stockWarehouseFilter) return false;
      if (showLowOnly && !(it.minStockAlert !== undefined && it.minStockAlert !== null && Number(it.quantity) < Number(it.minStockAlert))) return false;
      if (!q) return true;
      return (it.productName?.toLowerCase() || '').includes(q) || (it.productCode?.toLowerCase() || '').includes(q) || (it.warehouseName?.toLowerCase() || '').includes(q);
    });
  }, [stock, stockSearch, stockWarehouseFilter, showLowOnly]);

  const filteredTransfers = useMemo(() => {
    const q = transferSearch.trim().toLowerCase();
    return transfers.filter((tr) => {
      if (transferStatusFilter && tr.status !== transferStatusFilter) return false;
      if (!q) return true;
      return (tr.transferNumber?.toLowerCase() || '').includes(q) || (tr.reference?.toLowerCase() || '').includes(q) || (tr.fromWarehouseName?.toLowerCase() || '').includes(q) || (tr.toWarehouseName?.toLowerCase() || '').includes(q);
    });
  }, [transfers, transferSearch, transferStatusFilter]);

  const hasStockFilters = !!(stockSearch || stockWarehouseFilter || showLowOnly);
  const hasTransferFilters = !!(transferSearch || transferStatusFilter);

  const resetForm = useCallback(() => {
    setTransferForm({
      productId: '',
      fromWarehouseId: '',
      toWarehouseId: '',
      quantity: '',
      date: new Date().toISOString().split('T')[0],
      transferNumber: '',
      reference: '',
      notes: '',
    });
  }, []);

  const closeModal = useCallback(() => {
    setIsTransferOpen(false);
    resetForm();
  }, [resetForm]);

  const handleCreateTransfer = async () => {
    if (!activeCompany) return;
    if (!transferForm.productId || !transferForm.fromWarehouseId || !transferForm.toWarehouseId) {
      addToast('error', 'الرجاء إكمال جميع الحقول المطلوبة');
      return;
    }
    if (transferForm.fromWarehouseId === transferForm.toWarehouseId) {
      addToast('error', 'مستودع المصدر والوجهة يجب أن يكونا مختلفين');
      return;
    }
    if (!transferForm.quantity || Number(transferForm.quantity) <= 0) {
      addToast('error', 'الكمية يجب أن تكون أكبر من صفر');
      return;
    }
    setSaving(true);
    try {
      const result = await createTransfer({
        companyId: activeCompany.id,
        productId: transferForm.productId,
        fromWarehouseId: transferForm.fromWarehouseId,
        toWarehouseId: transferForm.toWarehouseId,
        quantity: Number(transferForm.quantity),
        date: transferForm.date,
        transferNumber: transferForm.transferNumber,
        reference: transferForm.reference || undefined,
        notes: transferForm.notes || undefined,
        status: 'draft',
      });
      if (result.success) {
        addToast('success', 'تم إنشاء التحويل بنجاح');
        closeModal();
      } else {
        addToast('error', result.error || t('common.error'));
      }
    } finally {
      setSaving(false);
    }
  };

  const handleCompleteTransfer = async (id: string) => {
    const result = await completeTransfer(id);
    if (result.success) addToast('success', 'تم إكمال التحويل بنجاح');
    else addToast('error', result.error || t('common.error'));
    setConfirmComplete(null);
  };

  const handleDeleteTransfer = async (id: string) => {
    const result = await removeTransfer(id);
    if (result.success) addToast('success', 'تم حذف التحويل بنجاح');
    else addToast('error', result.error || t('common.error'));
    setConfirmDelete(null);
  };

  const handleExportStockExcel = () => {
    exportToExcel(
      filteredStock.map((s) => ({
        productCode: s.productCode || '-',
        productName: s.productName || '-',
        warehouseName: s.warehouseName || '-',
        quantity: s.quantity,
        minStockAlert: s.minStockAlert ?? '-',
        costPrice: s.costPrice || 0,
      })),
      [
        { key: 'productCode', header: t('inventory.productCode'), width: 12 },
        { key: 'productName', header: t('inventory.productName'), width: 28 },
        { key: 'warehouseName', header: t('inventory.warehouse'), width: 18 },
        { key: 'quantity', header: t('inventory.quantity'), width: 10 },
        { key: 'minStockAlert', header: t('inventory.minStock'), width: 12 },
        { key: 'costPrice', header: t('inventory.costPrice'), width: 12 },
      ],
      `stock_${new Date().toISOString().split('T')[0]}`,
    );
  };

  const handleExportStockPdf = () => {
    exportToPDF(
      filteredStock.map((s) => ({
        productCode: s.productCode || '-',
        productName: s.productName || '-',
        warehouseName: s.warehouseName || '-',
        quantity: String(s.quantity),
      })),
      [
        { key: 'productCode', header: t('inventory.productCode') },
        { key: 'productName', header: t('inventory.productName') },
        { key: 'warehouseName', header: t('inventory.warehouse') },
        { key: 'quantity', header: t('inventory.quantity') },
      ],
      `stock_${new Date().toISOString().split('T')[0]}`,
      { title: t('inventory.stock'), rtl: true, companyName: activeCompany?.name },
    );
  };

  const stockColumns = useMemo(() => [
    {
      key: 'productCode',
      header: t('inventory.productCode'),
      width: '115px',
      render: (row: StockItem) => <span className="font-mono text-xs font-semibold bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded border">{row.productCode || '-'}</span>,
    },
    {
      key: 'productName',
      header: t('inventory.productName'),
      render: (row: StockItem) => (
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-50 to-primary-100 dark:from-primary-900/20 dark:to-primary-800/20 flex items-center justify-center border border-primary-200 dark:border-primary-800 shrink-0">
            <Package size={14} className="text-primary-600" />
          </div>
          <span className="font-medium truncate">{row.productName || '-'}</span>
        </div>
      ),
    },
    {
      key: 'warehouseName',
      header: t('inventory.warehouse'),
      width: '150px',
      render: (row: StockItem) => row.warehouseName ? (
        <span className="inline-flex items-center gap-1.5 text-xs bg-blue-50 dark:bg-blue-900/20 px-2.5 py-1 rounded-full border border-blue-200 dark:border-blue-800">
          <Warehouse size={12} className="text-blue-600" /> {row.warehouseName}
        </span>
      ) : <span className="font-mono text-xs">{row.warehouseId.slice(0, 8)}</span>,
    },
    {
      key: 'quantity',
      header: t('inventory.quantity'),
      align: 'right' as const,
      width: '110px',
      render: (row: StockItem) => {
        const isLow = row.minStockAlert !== undefined && row.minStockAlert !== null && Number(row.quantity) < Number(row.minStockAlert);
        return (
          <span className={`font-bold tabular-nums px-2.5 py-1 rounded-full text-xs border ${isLow ? 'bg-amber-100 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800' : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'}`}>
            {row.quantity}
          </span>
        );
      },
    },
    { key: 'unit', header: t('inventory.unitPrice'), width: '80px', render: (row: StockItem) => <span className="text-xs text-slate-500">{row.unit || '-'}</span> },
    {
      key: 'minStockAlert',
      header: t('inventory.minStock'),
      align: 'right' as const,
      width: '100px',
      render: (row: StockItem) => row.minStockAlert !== undefined && row.minStockAlert !== null ? <span className="text-xs tabular-nums">{row.minStockAlert}</span> : <span className="text-slate-400 text-xs">—</span>,
    },
    {
      key: 'alert',
      header: '',
      width: '50px',
      render: (row: StockItem) => {
        if (row.minStockAlert !== undefined && row.minStockAlert !== null && Number(row.quantity) < Number(row.minStockAlert)) {
          return <span className="inline-flex items-center gap-1 text-amber-600" title={t('inventory.lowStock')}><AlertTriangle size={14} /></span>;
        }
        return null;
      },
    },
  ], [t]);

  const transferColumns = useMemo(() => [
    {
      key: 'date',
      header: t('inventory.date'),
      width: '115px',
      render: (row: StockTransfer) => <span className="text-xs tabular-nums bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded border font-mono">{new Date(row.date).toLocaleDateString('ar-EG')}</span>,
    },
    {
      key: 'transferNumber',
      header: t('inventory.transferNumber'),
      width: '125px',
      render: (row: StockTransfer) => row.transferNumber ? <span className="font-mono text-xs font-semibold bg-primary-50 dark:bg-primary-900/20 px-2 py-1 rounded border border-primary-200 dark:border-primary-800">{row.transferNumber}</span> : <span className="text-slate-400">—</span>,
    },
    { key: 'reference', header: t('inventory.reference'), width: '110px', render: (row: StockTransfer) => row.reference ? <span className="text-xs truncate max-w-[110px] inline-block">{row.reference}</span> : <span className="text-slate-400 text-xs">—</span> },
    {
      key: 'fromWarehouseName',
      header: t('inventory.fromWarehouse'),
      render: (row: StockTransfer) => (
        <span className="inline-flex items-center gap-1 text-xs bg-rose-50 dark:bg-rose-900/20 px-2 py-1 rounded-full border border-rose-200 dark:border-rose-800">
          {row.fromWarehouseName || row.fromWarehouseId?.slice(0, 8) || '-'}
        </span>
      ),
    },
    {
      key: 'toWarehouseName',
      header: t('inventory.toWarehouse'),
      render: (row: StockTransfer) => (
        <span className="inline-flex items-center gap-1 text-xs bg-emerald-50 dark:bg-emerald-900/20 px-2 py-1 rounded-full border border-emerald-200 dark:border-emerald-800">
          {row.toWarehouseName || row.toWarehouseId?.slice(0, 8) || '-'}
        </span>
      ),
    },
    {
      key: 'totalQuantity',
      header: t('inventory.quantity'),
      align: 'right' as const,
      width: '110px',
      render: (row: StockTransfer) => (
        <span className="font-bold tabular-nums">
          {row.totalQuantity !== undefined ? row.totalQuantity : row.quantity || 0}
          {row.linesCount !== undefined && row.linesCount > 1 && <span className="text-xs text-slate-500 mr-1">({row.linesCount})</span>}
        </span>
      ),
    },
    { key: 'status', header: t('inventory.status'), width: '100px', render: (row: StockTransfer) => <StatusBadge status={row.status} /> },
    {
      key: 'actions',
      header: '',
      width: '110px',
      render: (row: StockTransfer) => (
        <div className="flex items-center gap-1">
          {row.status === 'draft' && (
            <Button size="sm" variant="ghost" onClick={() => setConfirmComplete(row.id)} title={t('inventory.complete') || 'إكمال'} className="h-7 w-7 p-0">
              <CheckCircle size={14} className="text-emerald-600" />
            </Button>
          )}
          <ActionButtons onView={undefined} onEdit={undefined} onDelete={() => setConfirmDelete(row.id)} showView={false} showEdit={false} showPrint={false} showExport={false} />
        </div>
      ),
    },
  ], [t]);

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-primary-600 to-primary-700 flex items-center justify-center shadow-sm">
              <Boxes size={22} className="text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50 tracking-tight">{t('inventory.stock')}</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">{t('inventory.stockByWarehouse')}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
            <Button variant="secondary" leftIcon={<Scale size={16} />} onClick={() => navigate('/inventory/adjustments')}>
              {t('inventory.adjustments')}
            </Button>
            <Can action="create" module="inventory">
              <Button
                variant="primary"
                leftIcon={<Plus size={16} />}
                onClick={async () => {
                  resetForm();
                  if (activeCompany) {
                    const seq = await getNextNumber('inventory_transfer', activeCompany.id);
                    if (seq?.number) setTransferForm((prev) => ({ ...prev, transferNumber: seq.number || '' }));
                  }
                  setIsTransferOpen(true);
                }}
                className="shadow-sm"
              >
                {t('inventory.newTransfer')}
              </Button>
            </Can>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Card className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">بنود المخزون</p>
              <p className="text-2xl font-bold text-slate-900 dark:text-slate-50 tabular-nums">{stockStats.totalItems}</p>
              <p className="text-xs text-slate-500">{filteredStock.length} ظاهر</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-primary-50 dark:bg-primary-900/20 flex items-center justify-center">
              <Layers size={18} className="text-primary-600" />
            </div>
          </Card>
          <Card className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">إجمالي الكمية</p>
              <p className="text-2xl font-bold text-slate-900 dark:text-slate-50 tabular-nums">{stockStats.totalQty}</p>
              <p className="text-xs text-slate-500">وحدة</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
              <TrendingUp size={18} className="text-blue-600" />
            </div>
          </Card>
          <Card className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">منخفض</p>
              <p className={`text-2xl font-bold tabular-nums ${stockStats.lowCount ? 'text-amber-600 dark:text-amber-400' : 'text-slate-900 dark:text-slate-50'}`}>{stockStats.lowCount}</p>
              <p className="text-xs text-slate-500">{stockStats.lowCount ? 'يحتاج طلب' : 'لا يوجد'}</p>
            </div>
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${stockStats.lowCount ? 'bg-amber-50 dark:bg-amber-900/20' : 'bg-slate-100 dark:bg-slate-800'}`}>
              <AlertTriangle size={18} className={stockStats.lowCount ? 'text-amber-600' : 'text-slate-400'} />
            </div>
          </Card>
          <Card className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">قيمة المخزون</p>
              <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">{formatCurrency(stockStats.totalValue)}</p>
              <p className="text-xs text-slate-500">تكلفة</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center">
              <Wallet size={18} className="text-emerald-600" />
            </div>
          </Card>
        </div>
      </div>

      <Card noPadding>
        <div className="p-3 sm:p-4 border-b border-slate-200 dark:border-slate-700">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                value={stockSearch}
                onChange={(e) => setStockSearch(e.target.value)}
                placeholder={`${t('search')} — منتج / كود / مستودع`}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 py-2.5 pr-10 pl-9 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
              />
              {stockSearch && (
                <button onClick={() => setStockSearch('')} className="absolute left-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-slate-400">
                  <X size={14} />
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <select value={stockWarehouseFilter} onChange={(e) => setStockWarehouseFilter(e.target.value)} className="h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm">
                <option value="">كل المستودعات</option>
                {uniqueWarehouses.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
              <button
                onClick={() => setShowLowOnly(!showLowOnly)}
                className={`h-10 px-3 rounded-lg border text-sm font-medium transition ${showLowOnly ? 'bg-amber-600 text-white border-amber-600' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 hover:bg-slate-50'}`}
              >
                منخفض فقط
              </button>
              <div className="h-6 w-px bg-slate-200 dark:bg-slate-700 hidden sm:block" />
              <Button size="sm" variant="ghost" onClick={handleExportStockExcel} className="gap-1.5"><FileText size={14} className="text-emerald-600" /><span className="hidden sm:inline text-xs">Excel</span></Button>
              <Button size="sm" variant="ghost" onClick={handleExportStockPdf} className="gap-1.5"><Receipt size={14} className="text-rose-600" /><span className="hidden sm:inline text-xs">PDF</span></Button>
            </div>
          </div>
          {hasStockFilters && (
            <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
              <span>{filteredStock.length} من {stock.length} • {stockSearch ? `"${stockSearch}"` : ''}</span>
              <button onClick={() => { setStockSearch(''); setStockWarehouseFilter(''); setShowLowOnly(false); }} className="text-primary-600 hover:underline font-medium">مسح الفلترة</button>
            </div>
          )}
        </div>
        {filteredStock.length === 0 && !isLoading ? (
          <div className="py-10">
            <EmptyState icon={hasStockFilters ? 'search' : 'inbox'} title={hasStockFilters ? 'لا توجد نتائج' : t('inventory.empty.stock.title')} description={hasStockFilters ? 'جرّب تغيير البحث أو الفلترة' : t('inventory.empty.stock.description')} />
          </div>
        ) : (
          <Table<StockItem> data={filteredStock} columns={stockColumns as never} keyExtractor={(row) => row.id} isLoading={isLoading} emptyMessage="" />
        )}
      </Card>

      <div className="pt-2">
        <Card noPadding>
          <div className="p-3 sm:p-4 border-b border-slate-200 dark:border-slate-700">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-50 flex items-center gap-2">
                <ArrowRightLeft size={18} className="text-primary-600" />
                {t('inventory.transfers')}
                <Badge className="bg-slate-100 dark:bg-slate-800 text-slate-600 border">{filteredTransfers.length}</Badge>
              </h2>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  <input value={transferSearch} onChange={(e) => setTransferSearch(e.target.value)} placeholder={t('search')} className="h-9 pr-8 pl-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm w-40" />
                </div>
                <select value={transferStatusFilter} onChange={(e) => setTransferStatusFilter(e.target.value)} className="h-9 px-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm">
                  <option value="">كل الحالات</option>
                  <option value="draft">مسودة</option>
                  <option value="completed">مكتمل</option>
                  <option value="cancelled">ملغي</option>
                </select>
              </div>
            </div>
            {hasTransferFilters && (
              <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                <span>{filteredTransfers.length} من {transfers.length}</span>
                <button onClick={() => { setTransferSearch(''); setTransferStatusFilter(''); }} className="text-primary-600 hover:underline">مسح</button>
              </div>
            )}
          </div>
          {filteredTransfers.length === 0 ? (
            <div className="py-8">
              <EmptyState icon={hasTransferFilters ? 'search' : 'inbox'} title={hasTransferFilters ? 'لا توجد نتائج' : t('inventory.empty.transfers.title')} description={hasTransferFilters ? 'جرّب تغيير البحث' : t('inventory.empty.transfers.description')} />
            </div>
          ) : (
            <Table<StockTransfer> data={filteredTransfers} columns={transferColumns as never} keyExtractor={(row) => row.id} />
          )}
        </Card>
      </div>

      <Modal
        isOpen={isTransferOpen}
        onClose={closeModal}
        title={t('inventory.newTransfer')}
        description="إنشاء تحويل مخزني بين مستودعين"
        size="lg"
        footer={
          <div className="flex gap-2 ml-auto">
            <Button variant="secondary" onClick={closeModal} disabled={saving}>{t('cancel')}</Button>
            <Button variant="primary" onClick={handleCreateTransfer} isLoading={saving}>{t('save')}</Button>
          </div>
        }
      >
        <div className="space-y-5">
          <div className="flex items-center gap-3 p-3 rounded-xl bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800">
            <div className="w-10 h-10 rounded-lg bg-white dark:bg-slate-800 flex items-center justify-center border">
              <Hash size={16} className="text-primary-600" />
            </div>
            <div>
              <p className="text-xs text-slate-500">رقم التحويل</p>
              <p className="font-mono font-bold text-primary-700 dark:text-primary-300">{transferForm.transferNumber || t('inventory.autoGenerate')}</p>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1.5">{t('inventory.productName')} *</label>
            <ProductSelect companyId={activeCompany?.id || ''} value={transferForm.productId} onChange={(v) => setTransferForm((prev) => ({ ...prev, productId: typeof v === 'string' ? v : '' }))} showBarcode showStock module="inventory" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1.5">{t('inventory.fromWarehouse')} *</label>
              <WarehouseSelect companyId={activeCompany?.id || ''} value={transferForm.fromWarehouseId} onChange={(v) => setTransferForm((prev) => ({ ...prev, fromWarehouseId: typeof v === 'string' ? v : '' }))} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1.5">{t('inventory.toWarehouse')} *</label>
              <WarehouseSelect companyId={activeCompany?.id || ''} value={transferForm.toWarehouseId} onChange={(v) => setTransferForm((prev) => ({ ...prev, toWarehouseId: typeof v === 'string' ? v : '' }))} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label={`${t('inventory.quantity')} *`} type="number" min="0.01" step="0.01" value={transferForm.quantity} onChange={(e) => setTransferForm((prev) => ({ ...prev, quantity: e.target.value }))} required />
            <Input label={`${t('inventory.date')} *`} type="date" value={transferForm.date} onChange={(e) => setTransferForm((prev) => ({ ...prev, date: e.target.value }))} required />
          </div>
          <Input label={t('inventory.reference')} value={transferForm.reference} onChange={(e) => setTransferForm((prev) => ({ ...prev, reference: e.target.value }))} placeholder="مرجع اختياري" />
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1.5">{t('inventory.notes')}</label>
            <textarea value={transferForm.notes} onChange={(e) => setTransferForm((prev) => ({ ...prev, notes: e.target.value }))} placeholder="ملاحظات..." rows={2} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 resize-none" />
          </div>
        </div>
      </Modal>

      <ConfirmDialog isOpen={!!confirmComplete} onClose={() => setConfirmComplete(null)} onConfirm={() => confirmComplete && handleCompleteTransfer(confirmComplete)} title="إكمال التحويل" message="هل تريد إكمال هذا التحويل؟ سيتم تحديث المخزون في المستودعين." variant="info" />
      <ConfirmDialog isOpen={!!confirmDelete} onClose={() => setConfirmDelete(null)} onConfirm={() => confirmDelete && handleDeleteTransfer(confirmDelete)} title={t('delete')} message={t('inventory.deleteConfirm')} variant="danger" />
    </div>
  );
};

export default StockPage;
