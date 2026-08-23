import React, { useState, useCallback, useMemo } from 'react';
import { Warehouse, Plus, Building2, Search, X, Wallet, CheckCircle2, FileText, Receipt } from 'lucide-react';
import { Card, Button, Input, Modal, Table, Badge } from '@/core/ui/components';
import { ActionButtons } from '@/core/ui/components/ActionButtons';
import { StatusBadge } from '@/core/ui/components/StatusBadge';
import { ConfirmDialog } from '@/core/ui/components/ConfirmDialog';
import { EmptyState } from '@/core/ui/components/EmptyState';
import { BranchSelect } from '@/core/ui/components/smart';
import { useWarehouses, useStockDetailed } from '../hooks/useInventory';
import { useAppStore } from '@/core/store';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useToastStore } from '@/core/store/toastStore';
import { useFormatters } from '@/core/utils/useFormatters';
import { exportToExcel, exportToPDF } from '@/core/utils/exportEngine';
import type { Warehouse as WarehouseType, StockItem } from '../types';
import { Can } from '@/core/ui/components/PermissionGate';

interface FormData {
  name: string;
  code: string;
  branchId: string;
  isActive: boolean;
}

const initialForm: FormData = { name: '', code: '', branchId: '', isActive: true };

export const WarehousesPage: React.FC = () => {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const activeCompany = useAppStore((state) => state.activeCompany);
  const { formatCurrency } = useFormatters(activeCompany?.id || '');
  const { warehouses, isLoading, create, update, remove } = useWarehouses(activeCompany?.id || '');
  const { stock } = useStockDetailed(activeCompany?.id || '');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isStockModalOpen, setIsStockModalOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [formData, setFormData] = useState<FormData>(initialForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedWarehouse, setSelectedWarehouse] = useState<WarehouseType | null>(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState<string>('');

  const filteredWarehouses = useMemo(() => {
    const q = search.trim().toLowerCase();
    return warehouses.filter((w) => {
      if (branchFilter && w.branchId !== branchFilter) return false;
      if (!q) return true;
      return (w.name?.toLowerCase() || '').includes(q) || (w.code?.toLowerCase() || '').includes(q);
    });
  }, [warehouses, search, branchFilter]);

  const stats = useMemo(() => {
    const total = warehouses.length;
    const active = warehouses.filter((w) => w.isActive).length;
    const stockValue = stock.reduce((s, item) => s + (Number(item.quantity) || 0) * (Number(item.costPrice) || 0), 0);
    const branches = new Set(warehouses.map((w) => w.branchId).filter(Boolean)).size;
    return { total, active, inactive: total - active, stockValue, branches };
  }, [warehouses, stock]);

  const hasFilters = !!(search || branchFilter);

  const handleOpenCreate = useCallback(() => {
    setFormData(initialForm);
    setEditingId(null);
    setIsModalOpen(true);
  }, []);

  const handleOpenEdit = useCallback((wh: WarehouseType) => {
    setFormData({ name: wh.name, code: wh.code || '', branchId: wh.branchId || '', isActive: wh.isActive });
    setEditingId(wh.id);
    setIsModalOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
    setFormData(initialForm);
    setEditingId(null);
  }, []);

  const handleSave = async () => {
    if (!activeCompany) return;
    if (!formData.name.trim()) {
      addToast('error', 'الرجاء إدخال اسم المستودع');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        companyId: activeCompany.id,
        name: formData.name.trim(),
        code: formData.code.trim() || undefined,
        branchId: formData.branchId || undefined,
        isActive: formData.isActive,
      };
      let result;
      if (editingId) result = await update(editingId, payload);
      else result = await create(payload);
      if (result?.success) {
        addToast('success', editingId ? t('inventory.warehouse.updated') : t('inventory.warehouse.created'));
        closeModal();
      } else {
        addToast('error', result?.error || t('common.error'));
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const result = await remove(id);
    if (result?.success) addToast('success', t('inventory.warehouse.deleted'));
    else addToast('error', result?.error || t('common.error'));
    setConfirmDelete(null);
  };

  const handleViewStock = useCallback((wh: WarehouseType) => {
    setSelectedWarehouse(wh);
    setIsStockModalOpen(true);
  }, []);

  const warehouseStock = useMemo(() => {
    if (!selectedWarehouse) return [] as StockItem[];
    return stock.filter((s) => s.warehouseId === selectedWarehouse.id);
  }, [stock, selectedWarehouse]);

  const warehouseStockValue = useMemo(() => warehouseStock.reduce((sum, s) => sum + (Number(s.quantity) || 0) * (Number(s.costPrice) || 0), 0), [warehouseStock]);
  const warehouseItemCount = warehouseStock.length;
  const lowStockCount = warehouseStock.filter((s) => s.minStockAlert !== undefined && s.minStockAlert !== null && Number(s.quantity) < Number(s.minStockAlert)).length;

  const handleExportExcel = () => {
    exportToExcel(
      filteredWarehouses.map((w) => ({
        code: w.code || '-',
        name: w.name,
        branchId: w.branchId || '-',
        isActive: w.isActive ? t('settings.common.active') : t('settings.common.inactive'),
      })),
      [
        { key: 'code', header: t('inventory.productCode'), width: 12 },
        { key: 'name', header: t('inventory.warehouse'), width: 28 },
        { key: 'branchId', header: t('inventory.branch'), width: 16 },
        { key: 'isActive', header: t('inventory.status'), width: 12 },
      ],
      `warehouses_${new Date().toISOString().split('T')[0]}`,
    );
  };

  const handleExportPdf = () => {
    exportToPDF(
      filteredWarehouses.map((w) => ({ code: w.code || '-', name: w.name, isActive: w.isActive ? 'نشط' : 'موقوف' })),
      [
        { key: 'code', header: t('inventory.productCode') },
        { key: 'name', header: t('inventory.warehouse') },
        { key: 'isActive', header: t('inventory.status') },
      ],
      `warehouses_${new Date().toISOString().split('T')[0]}`,
      { title: t('inventory.warehouses'), rtl: true, companyName: activeCompany?.name },
    );
  };

  const uniqueBranches = useMemo(() => {
    const map = new Map<string, string>();
    warehouses.forEach((w) => { if (w.branchId) map.set(w.branchId, w.branchId); });
    return Array.from(map.keys());
  }, [warehouses]);

  const columns = useMemo(() => [
    {
      key: 'code',
      header: t('inventory.productCode'),
      width: '120px',
      render: (row: WarehouseType) => row.code ? <span className="font-mono text-xs font-semibold bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded border">{row.code}</span> : <span className="text-slate-400 text-xs">—</span>,
    },
    {
      key: 'name',
      header: t('inventory.warehouse'),
      render: (row: WarehouseType) => (
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center text-white shadow-sm shrink-0">
            <Warehouse size={16} />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-slate-900 dark:text-slate-100 truncate">{row.name}</p>
            <p className="text-xs text-slate-500 truncate">{row.code ? `كود: ${row.code}` : ''}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'branch',
      header: t('inventory.branch'),
      width: '160px',
      render: (row: WarehouseType) => row.branchId ? (
        <span className="inline-flex items-center gap-1.5 text-sm bg-blue-50 dark:bg-blue-900/20 px-2.5 py-1 rounded-full border border-blue-200 dark:border-blue-800">
          <Building2 size={13} className="text-blue-600" /> <span className="font-mono text-xs">{row.branchId.slice(0, 8)}</span>
        </span>
      ) : <span className="text-slate-400 text-xs">—</span>,
    },
    {
      key: 'stockInfo',
      header: 'المخزون',
      width: '140px',
      render: (row: WarehouseType) => {
        const count = stock.filter((s) => s.warehouseId === row.id).length;
        const value = stock.filter((s) => s.warehouseId === row.id).reduce((s, it) => s + Number(it.quantity) * Number(it.costPrice || 0), 0);
        if (!count) return <span className="text-xs text-slate-400">—</span>;
        return (
          <div className="text-xs">
            <p className="font-medium text-slate-900 dark:text-slate-100">{count} صنف</p>
            <p className="text-slate-500 tabular-nums">{formatCurrency(value)}</p>
          </div>
        );
      },
    },
    {
      key: 'isActive',
      header: t('inventory.status'),
      width: '100px',
      render: (row: WarehouseType) => <StatusBadge status={row.isActive ? 'active' : 'inactive'} />,
    },
    {
      key: 'actions',
      header: '',
      width: '150px',
      render: (row: WarehouseType) => (
        <ActionButtons
          onView={() => handleViewStock(row)}
          onEdit={() => handleOpenEdit(row)}
          onDelete={() => setConfirmDelete(row.id)}
          showPrint={false}
          showExport={false}
        />
      ),
    },
  ], [t, handleOpenEdit, handleViewStock, stock, formatCurrency]);

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-primary-600 to-primary-700 flex items-center justify-center shadow-sm">
              <Warehouse size={22} className="text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50 tracking-tight">{t('inventory.warehouses')}</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">{t('inventory.page.subtitle')}</p>
            </div>
          </div>
          <Can action="create" module="inventory">
            <Button variant="primary" leftIcon={<Plus size={16} />} onClick={handleOpenCreate} className="shadow-sm">
              {t('inventory.newWarehouse')}
            </Button>
          </Can>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Card className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">إجمالي المستودعات</p>
              <p className="text-2xl font-bold text-slate-900 dark:text-slate-50 tabular-nums">{stats.total}</p>
              <p className="text-xs text-slate-500">{stats.active} نشط • {stats.inactive} موقوف</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-primary-50 dark:bg-primary-900/20 flex items-center justify-center">
              <Warehouse size={18} className="text-primary-600" />
            </div>
          </Card>
          <Card className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">الفروع</p>
              <p className="text-2xl font-bold text-blue-600 dark:text-blue-400 tabular-nums">{stats.branches}</p>
              <p className="text-xs text-slate-500">فرع مرتبط</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
              <Building2 size={18} className="text-blue-600" />
            </div>
          </Card>
          <Card className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">قيمة المخزون</p>
              <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">{formatCurrency(stats.stockValue)}</p>
              <p className="text-xs text-slate-500">{stock.length} بند مخزني</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center">
              <Wallet size={18} className="text-emerald-600" />
            </div>
          </Card>
          <Card className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">نشط</p>
              <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">{stats.active}</p>
              <p className="text-xs text-slate-500">من {stats.total}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center">
              <CheckCircle2 size={18} className="text-emerald-600" />
            </div>
          </Card>
        </div>

        <Card className="p-3 sm:p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`${t('search')} — اسم / كود المستودع`}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 py-2.5 pr-10 pl-9 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute left-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-slate-400">
                  <X size={14} />
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className="h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm">
                <option value="">كل الفروع</option>
                {uniqueBranches.map((b) => (
                  <option key={b} value={b}>{b.slice(0, 8)}</option>
                ))}
              </select>
              <div className="h-6 w-px bg-slate-200 dark:bg-slate-700 hidden sm:block" />
              <Button size="sm" variant="ghost" onClick={handleExportExcel} className="gap-1.5"><FileText size={14} className="text-emerald-600" /><span className="hidden sm:inline text-xs">Excel</span></Button>
              <Button size="sm" variant="ghost" onClick={handleExportPdf} className="gap-1.5"><Receipt size={14} className="text-rose-600" /><span className="hidden sm:inline text-xs">PDF</span></Button>
            </div>
          </div>
          {hasFilters && (
            <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
              <span>{filteredWarehouses.length} من {warehouses.length} • {search ? `"${search}"` : ''}</span>
              <button onClick={() => { setSearch(''); setBranchFilter(''); }} className="text-primary-600 hover:underline font-medium">مسح الفلترة</button>
            </div>
          )}
        </Card>
      </div>

      <Card noPadding>
        {filteredWarehouses.length === 0 && !isLoading ? (
          <div className="py-10">
            <EmptyState
              icon={hasFilters ? 'search' : 'inbox'}
              title={hasFilters ? 'لا توجد نتائج' : t('inventory.empty.warehouses.title')}
              description={hasFilters ? 'جرّب تغيير البحث' : t('inventory.empty.warehouses.description')}
              action={hasFilters ? <Button variant="secondary" onClick={() => { setSearch(''); setBranchFilter(''); }}>مسح الفلترة</Button> : <Can action="create" module="inventory"><Button variant="primary" leftIcon={<Plus size={16} />} onClick={handleOpenCreate}>{t('inventory.newWarehouse')}</Button></Can>}
            />
          </div>
        ) : (
          <Table<WarehouseType> data={filteredWarehouses} columns={columns as never} keyExtractor={(row) => row.id} isLoading={isLoading} emptyMessage="" />
        )}
      </Card>

      <Modal
        isOpen={isModalOpen}
        onClose={closeModal}
        title={editingId ? t('inventory.editWarehouse') || 'تعديل المستودع' : t('inventory.newWarehouse')}
        description={editingId ? 'تعديل بيانات المستودع' : 'إضافة مستودع جديد'}
        size="md"
        footer={
          <div className="flex gap-2 ml-auto">
            <Button variant="secondary" onClick={closeModal} disabled={saving}>{t('cancel')}</Button>
            <Button variant="primary" onClick={handleSave} isLoading={saving}>{t('save')}</Button>
          </div>
        }
      >
        <div className="space-y-5">
          <div>
            <h4 className="text-xs font-bold tracking-wider uppercase text-slate-500 mb-3 flex items-center gap-2"><Warehouse size={12} /> البيانات الأساسية</h4>
            <div className="space-y-4">
              <Input label={`${t('inventory.warehouse')} *`} value={formData.name} onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))} placeholder="مثال: المستودع الرئيسي" required />
              <Input label={t('inventory.productCode')} value={formData.code} onChange={(e) => setFormData((prev) => ({ ...prev, code: e.target.value }))} placeholder="WH-001" dir="ltr" />
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5 flex items-center gap-1.5"><Building2 size={12} /> {t('inventory.branch')}</label>
                <BranchSelect companyId={activeCompany?.id || ''} value={formData.branchId} onChange={(v) => setFormData((prev) => ({ ...prev, branchId: v || '' }))} />
              </div>
              <label className="flex items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 px-4 py-3 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition">
                <input type="checkbox" checked={formData.isActive} onChange={(e) => setFormData((prev) => ({ ...prev, isActive: e.target.checked }))} className="w-4 h-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500" />
                <div>
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{t('inventory.active')}</p>
                  <p className="text-xs text-slate-500">{formData.isActive ? 'نشط ويمكن التعامل معه' : 'موقوف مؤقتاً'}</p>
                </div>
                <Badge className={`ml-auto border text-xs ${formData.isActive ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-slate-200 text-slate-600 border-slate-300'}`}>{formData.isActive ? 'نشط' : 'موقوف'}</Badge>
              </label>
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={isStockModalOpen}
        onClose={() => setIsStockModalOpen(false)}
        title={`${t('inventory.stockByWarehouse')} — ${selectedWarehouse?.name || ''}`}
        description={selectedWarehouse ? `${warehouseItemCount} صنف • قيمة ${formatCurrency(warehouseStockValue)} • ${lowStockCount ? `${lowStockCount} منخفض` : 'لا يوجد منخفض'}` : undefined}
        size="lg"
        footer={<Button variant="secondary" onClick={() => setIsStockModalOpen(false)}>{t('close')}</Button>}
      >
        {warehouseStock.length === 0 ? (
          <EmptyState icon="inbox" title={t('inventory.empty.stock.title')} description={t('inventory.empty.warehouseProducts.description')} />
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-primary-50 dark:bg-primary-900/20 p-3 rounded-xl border border-primary-200 dark:border-primary-800 text-center">
                <p className="text-xs text-slate-500">الأصناف</p>
                <p className="text-lg font-bold text-primary-700 dark:text-primary-300">{warehouseItemCount}</p>
              </div>
              <div className="bg-emerald-50 dark:bg-emerald-900/20 p-3 rounded-xl border border-emerald-200 dark:border-emerald-800 text-center">
                <p className="text-xs text-slate-500">القيمة</p>
                <p className="text-sm font-bold text-emerald-700 dark:text-emerald-300 tabular-nums">{formatCurrency(warehouseStockValue)}</p>
              </div>
              <div className={`p-3 rounded-xl border text-center ${lowStockCount ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800' : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700'}`}>
                <p className="text-xs text-slate-500">منخفض</p>
                <p className={`text-lg font-bold ${lowStockCount ? 'text-amber-600' : 'text-slate-700 dark:text-slate-300'}`}>{lowStockCount}</p>
              </div>
            </div>
            <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
              <Table
                data={warehouseStock}
                columns={[
                  { key: 'productCode', header: t('inventory.productCode'), width: '110px', render: (row: StockItem) => <span className="font-mono text-xs bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded border">{row.productCode || '-'}</span> },
                  { key: 'productName', header: t('inventory.productName'), render: (row: StockItem) => <span className="font-medium">{row.productName}</span> },
                  { key: 'quantity', header: t('inventory.quantity'), align: 'right' as const, render: (row: StockItem) => {
                    const isLow = row.minStockAlert !== undefined && row.minStockAlert !== null && Number(row.quantity) < Number(row.minStockAlert);
                    return <span className={`font-bold tabular-nums px-2 py-1 rounded-full text-xs border ${isLow ? 'bg-amber-100 text-amber-700 border-amber-200' : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200'}`}>{row.quantity}</span>;
                  }},
                  { key: 'unit', header: t('inventory.unitPrice'), width: '90px', render: (row: StockItem) => <span className="text-xs">{row.unit || '-'}</span> },
                ] as never}
                keyExtractor={(row) => row.id}
              />
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog isOpen={!!confirmDelete} onClose={() => setConfirmDelete(null)} onConfirm={() => confirmDelete && handleDelete(confirmDelete)} title={t('delete')} message={t('inventory.deleteConfirm')} variant="danger" />
    </div>
  );
};

export default WarehousesPage;
