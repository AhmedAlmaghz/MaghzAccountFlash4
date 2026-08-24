import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { Package, Plus, Upload, Camera, X, Search, Hash, RefreshCw, FileText, Receipt, Layers, Tag, TrendingUp, CheckCircle2, AlertCircle } from 'lucide-react';
import { Card, Button, Modal, Table, Pagination, Can, Badge } from '@/core/ui/components';
import { ActionButtons } from '@/core/ui/components/ActionButtons';
import { StatusBadge } from '@/core/ui/components/StatusBadge';
import { ConfirmDialog } from '@/core/ui/components/ConfirmDialog';
import { EmptyState } from '@/core/ui/components/EmptyState';
import { UnitSelect, ProductTypeSelect } from '@/core/ui/components/smart';
import { useProductsPaginated, useProductCategories, useWarehouses } from '../hooks/useInventory';
import { useProductTypes, useDocumentSequences } from '@/core/hooks/useSettings';
import type { ProductType } from '@/core/types';
import { useAppStore } from '@/core/store';
import { useAuthStore } from '@/modules/auth/store';
import { useTranslation } from '@/core/i18n/useTranslation';
import { barcodeScanner } from '@/core/utils/barcodeScanner';
import { logAudit } from '@/core/utils/auditLogger';
import { useFormatters } from '@/core/utils/useFormatters';
import { useToastStore } from '@/core/store/toastStore';
import { getNextDocumentNumber } from '@/core/api';
import { exportToExcel, exportToPDF } from '@/core/utils/exportEngine';
import type { Product } from '../types';

interface FormData {
  code: string;
  codeAuto: boolean;
  nameAr: string;
  nameEn: string;
  barcode: string;
  sku: string;
  unit: string;
  costPrice: string;
  salePrice: string;
  minStock: string;
  maxStock: string;
  reorderPoint: string;
  openingStockQty: string;
  openingWarehouseId: string;
  image: string;
  categoryIds: string[];
  productTypeId: string;
  isActive: boolean;
}

const initialForm: FormData = {
  code: '',
  codeAuto: true,
  nameAr: '',
  nameEn: '',
  barcode: '',
  sku: '',
  unit: '',
  costPrice: '0',
  salePrice: '0',
  minStock: '0',
  maxStock: '0',
  reorderPoint: '0',
  openingStockQty: '',
  openingWarehouseId: '',
  image: '',
  categoryIds: [],
  productTypeId: '',
  isActive: true,
};

export const ProductsPage: React.FC = () => {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const activeCompany = useAppStore((state) => state.activeCompany);
  const user = useAuthStore((state) => state.user);
  const companyId = activeCompany?.id || '';

  const [filterTypeId, setFilterTypeId] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const productFilters = useMemo(() => ({
    productTypeId: filterTypeId || undefined,
    search: searchTerm || undefined,
  }), [filterTypeId, searchTerm]);
  const { products, total, page, pageSize, isLoading, goToPage, changePageSize, create, update, remove } = useProductsPaginated(companyId, productFilters);
  const { categories } = useProductCategories(companyId);
  const { types: productTypes } = useProductTypes(companyId);
  const { warehouses } = useWarehouses(companyId);
  const { formatCurrency } = useFormatters(companyId);
  const { peekNextNumber } = useDocumentSequences(companyId);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [formData, setFormData] = useState<FormData>(initialForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [detailProduct, setDetailProduct] = useState<Product | null>(null);
  const [scanning, setScanning] = useState(false);
  const [filterCategoryId, setFilterCategoryId] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [codePreview, setCodePreview] = useState<string>('');
  const videoRef = useRef<HTMLVideoElement>(null);

  const filteredProducts = useMemo(() => products.filter((p) => {
    if (!filterCategoryId) return true;
    return p.categoryId === filterCategoryId || p.categoryIds?.includes(filterCategoryId);
  }), [products, filterCategoryId]);

  const stats = useMemo(() => {
    const active = filteredProducts.filter((p) => p.isActive).length;
    const inactive = filteredProducts.length - active;
    const avgCost = filteredProducts.length ? filteredProducts.reduce((s, p) => s + Number(p.costPrice || 0), 0) / filteredProducts.length : 0;
    return { total, activePage: active, inactivePage: inactive, avgCost };
  }, [filteredProducts, total]);

  const hasFilters = !!(searchTerm || filterTypeId || filterCategoryId);

  const refreshCodePreview = useCallback(async () => {
    if (!companyId) return;
    const result = await peekNextNumber('product');
    if (result.success && result.number) {
      setCodePreview(result.number);
      setFormData((prev) => (prev.codeAuto ? { ...prev, code: result.number! } : prev));
    }
  }, [companyId, peekNextNumber]);

  useEffect(() => {
    if (isModalOpen && !editingId) {
      refreshCodePreview();
    }
  }, [isModalOpen, editingId, refreshCodePreview]);

  const handleOpenCreate = useCallback(() => {
    setFormData(initialForm);
    setEditingId(null);
    setCodePreview('');
    setIsModalOpen(true);
  }, []);

  const handleOpenEdit = useCallback((product: Product) => {
    setFormData({
      code: product.code,
      codeAuto: false,
      nameAr: product.nameAr,
      nameEn: product.nameEn || '',
      barcode: product.barcode || '',
      sku: product.sku || '',
      unit: product.unit || '',
      costPrice: String(product.costPrice),
      salePrice: String(product.salePrice),
      minStock: String(product.minStock ?? 0),
      maxStock: String(product.maxStock ?? 0),
      reorderPoint: String(product.reorderPoint ?? 0),
      openingStockQty: product.openingStockPosted ? String(product.openingStockQty ?? '') : '',
      openingWarehouseId: product.openingWarehouseId || '',
      image: product.image || '',
      categoryIds: product.categoryIds || [],
      productTypeId: product.productTypeId || '',
      isActive: product.isActive,
    });
    setEditingId(product.id);
    setIsModalOpen(true);
  }, []);

  const handleViewDetail = useCallback((product: Product) => {
    setDetailProduct(product);
    setIsDetailOpen(true);
  }, []);

  const stopBarcodeScan = useCallback(() => {
    setScanning(false);
    barcodeScanner.stopCamera();
  }, []);

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
    stopBarcodeScan();
    setFormData(initialForm);
    setEditingId(null);
    setCodePreview('');
  }, [stopBarcodeScan]);

  const handleSave = async () => {
    if (!activeCompany) return;
    if (!formData.nameAr.trim()) {
      addToast('error', t('inventory.errors.nameRequired'));
      return;
    }
    if (!formData.unit.trim()) {
      addToast('error', t('inventory.errors.unitRequired'));
      return;
    }
    setSaving(true);
    try {
      let finalCode = formData.code.trim();
      if (!editingId && formData.codeAuto) {
        const result = await getNextDocumentNumber(activeCompany.id, 'product');
        if (result.success && result.number) {
          finalCode = result.number;
        } else {
          addToast('error', result.error || t('inventory.errors.codeGenerationFailed'));
          setSaving(false);
          return;
        }
      } else if (!editingId && !finalCode) {
        addToast('error', t('inventory.errors.codeRequired'));
        setSaving(false);
        return;
      }

      const payload = {
        companyId: activeCompany.id,
        code: finalCode,
        nameAr: formData.nameAr.trim(),
        nameEn: formData.nameEn.trim() || undefined,
        barcode: formData.barcode.trim() || undefined,
        sku: formData.sku.trim() || undefined,
        unit: formData.unit,
        costPrice: Number(formData.costPrice) || 0,
        salePrice: Number(formData.salePrice) || 0,
        isActive: formData.isActive,
        image: formData.image || undefined,
        minStock: Number(formData.minStock) || undefined,
        maxStock: Number(formData.maxStock) || undefined,
        reorderPoint: Number(formData.reorderPoint) || undefined,
        categoryIds: formData.categoryIds.length > 0 ? formData.categoryIds : undefined,
        productTypeId: formData.productTypeId || undefined,
        openingStockQty: editingId ? undefined : (Number(formData.openingStockQty) || 0),
        openingWarehouseId: editingId ? undefined : (formData.openingWarehouseId || null),
      };

      if (editingId) {
        const result = await update(editingId, payload);
        if (result.success) {
          await logAudit({ userId: user?.id || '', action: 'update', tableName: 'products', recordId: editingId, companyId: activeCompany.id });
          addToast('success', t('inventory.product.updated'));
          closeModal();
        } else {
          addToast('error', result.error || t('common.error'));
        }
      } else {
        const result = await create(payload);
        if (result.success) {
          await logAudit({ userId: user?.id || '', action: 'create', tableName: 'products', recordId: result.id || '', companyId: activeCompany.id });
          addToast('success', t('inventory.product.created'));
          closeModal();
        } else {
          addToast('error', result.error || t('common.error'));
        }
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!activeCompany) return;
    const result = await remove(id);
    if (result.success) {
      await logAudit({ userId: user?.id || '', action: 'delete', tableName: 'products', recordId: id, companyId: activeCompany.id });
      addToast('success', t('inventory.product.deleted'));
    } else {
      addToast('error', result.error || t('common.error'));
    }
    setConfirmDelete(null);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      addToast('error', t('inventory.errors.imageTooLarge'));
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      setFormData((prev) => ({ ...prev, image: reader.result as string }));
    };
    reader.readAsDataURL(file);
  };

  const startBarcodeScan = useCallback(async () => {
    if (!videoRef.current) return;
    setScanning(true);
    try {
      await barcodeScanner.startCameraScan(
        videoRef.current,
        (result) => {
          setFormData((prev) => ({ ...prev, barcode: result.barcode }));
          setScanning(false);
          barcodeScanner.stopCamera();
        },
      );
    } catch {
      setScanning(false);
      addToast('error', t('inventory.errors.cameraFailed'));
    }
  }, [addToast, t]);

  const toggleCategory = (catId: string) => {
    setFormData((prev) => ({
      ...prev,
      categoryIds: prev.categoryIds.includes(catId)
        ? prev.categoryIds.filter((id) => id !== catId)
        : [...prev.categoryIds, catId],
    }));
  };

  const handleUnitChange = (value: string | null) => {
    setFormData((prev) => ({ ...prev, unit: value || '' }));
  };

  const handleCodeAutoToggle = (auto: boolean) => {
    setFormData((prev) => {
      if (auto) {
        return { ...prev, codeAuto: true, code: codePreview };
      }
      return { ...prev, codeAuto: false };
    });
  };

  const handleExportExcel = () => {
    const cols = [
      { key: 'code', header: t('inventory.productCode'), width: 12 },
      { key: 'nameAr', header: t('inventory.productName'), width: 28 },
      { key: 'barcode', header: t('inventory.barcode'), width: 14 },
      { key: 'unit', header: t('inventory.unitName'), width: 10 },
      { key: 'costPrice', header: t('inventory.costPrice'), width: 12 },
      { key: 'salePrice', header: t('inventory.salePrice'), width: 12 },
      { key: 'isActive', header: t('inventory.status'), width: 10 },
    ];
    exportToExcel(
      filteredProducts.map((p) => ({
        code: p.code,
        nameAr: p.nameAr,
        barcode: p.barcode || '-',
        unit: p.unitName || p.unit,
        costPrice: p.costPrice,
        salePrice: p.salePrice,
        isActive: p.isActive ? t('settings.common.active') : t('settings.common.inactive'),
      })),
      cols,
      `products_${new Date().toISOString().split('T')[0]}`,
    );
  };

  const handleExportPdf = () => {
    exportToPDF(
      filteredProducts.map((p) => ({
        code: p.code,
        nameAr: p.nameAr,
        salePrice: formatCurrency(p.salePrice),
        isActive: p.isActive ? 'نشط' : 'موقوف',
      })),
      [
        { key: 'code', header: t('inventory.productCode') },
        { key: 'nameAr', header: t('inventory.productName') },
        { key: 'salePrice', header: t('inventory.salePrice') },
        { key: 'isActive', header: t('inventory.status') },
      ],
      `products_${new Date().toISOString().split('T')[0]}`,
      { title: t('inventory.products'), rtl: true, companyName: activeCompany?.name },
    );
  };

  const columns = useMemo(() => [
    {
      key: 'image',
      header: '',
      width: '56px',
      render: (row: Product) => row.image ? (
        <img src={row.image} alt="" className="w-10 h-10 rounded-lg object-cover border border-slate-200 dark:border-slate-700 shadow-sm" />
      ) : (
        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-700 flex items-center justify-center border border-slate-200 dark:border-slate-700">
          <Package size={16} className="text-slate-400" />
        </div>
      ),
    },
    {
      key: 'code',
      header: t('inventory.productCode'),
      width: '115px',
      render: (row: Product) => <span className="font-mono text-xs font-semibold bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700">{row.code}</span>,
    },
    {
      key: 'nameAr',
      header: t('inventory.productName'),
      render: (row: Product) => (
        <div className="min-w-0">
          <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">{row.nameAr}</div>
          {row.nameEn ? <div className="text-xs text-slate-500 truncate" dir="ltr">{row.nameEn}</div> : null}
          <div className="flex items-center gap-1 mt-1">
            {row.productTypeName ? <Badge className="bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 text-[10px]">{row.productTypeName}</Badge> : null}
          </div>
        </div>
      ),
    },
    {
      key: 'barcode',
      header: t('inventory.barcode'),
      width: '125px',
      render: (row: Product) => row.barcode ? <span className="font-mono text-xs bg-amber-50 dark:bg-amber-900/20 px-2 py-1 rounded border border-amber-200 dark:border-amber-800">{row.barcode}</span> : <span className="text-slate-400 text-xs">—</span>,
    },
    {
      key: 'unit',
      header: t('inventory.unitName'),
      width: '90px',
      render: (row: Product) => row.unitName ? <span className="text-sm">{row.unitName}</span> : <span className="text-xs text-slate-400 font-mono">{row.unit || '-'}</span>,
    },
    {
      key: 'categories',
      header: t('inventory.categories'),
      width: '160px',
      render: (row: Product) => row.categoryNames && row.categoryNames.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {row.categoryNames.slice(0, 2).map((c) => (
            <span key={c.id} className="px-2 py-0.5 rounded-full bg-primary-50 dark:bg-primary-900/20 text-xs text-primary-700 dark:text-primary-300 border border-primary-200 dark:border-primary-800">{c.name}</span>
          ))}
          {row.categoryNames.length > 2 && <span className="text-xs text-slate-500">+{row.categoryNames.length - 2}</span>}
        </div>
      ) : <span className="text-xs text-slate-400">-</span>,
    },
    {
      key: 'costPrice',
      header: t('inventory.costPrice'),
      align: 'right' as const,
      width: '110px',
      render: (row: Product) => <span className="tabular-nums text-sm text-slate-600 dark:text-slate-300">{formatCurrency(row.costPrice)}</span>,
    },
    {
      key: 'salePrice',
      header: t('inventory.salePrice'),
      align: 'right' as const,
      width: '115px',
      render: (row: Product) => <span className="tabular-nums text-sm font-bold text-primary-600 dark:text-primary-400">{formatCurrency(row.salePrice)}</span>,
    },
    {
      key: 'isActive',
      header: t('inventory.status'),
      width: '90px',
      render: (row: Product) => <StatusBadge status={row.isActive ? 'active' : 'inactive'} />,
    },
    {
      key: 'actions',
      header: '',
      width: '110px',
      render: (row: Product) => (
        <ActionButtons
          onView={() => handleViewDetail(row)}
          onEdit={() => handleOpenEdit(row)}
          onDelete={() => setConfirmDelete(row.id)}
          showPrint={false}
          showExport={false}
        />
      ),
    },
  ], [t, formatCurrency, handleOpenEdit, handleViewDetail]);

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-primary-600 to-primary-700 flex items-center justify-center shadow-sm">
              <Package size={22} className="text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50 tracking-tight">{t('inventory.products')}</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">{t('inventory.page.subtitle')}</p>
            </div>
          </div>
          <Can action="create" module="inventory">
            <Button variant="primary" leftIcon={<Plus size={16} />} onClick={handleOpenCreate} className="shadow-sm">
              {t('inventory.newProduct')}
            </Button>
          </Can>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Card className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">إجمالي المنتجات</p>
              <p className="text-2xl font-bold text-slate-900 dark:text-slate-50 tabular-nums">{total}</p>
              <p className="text-xs text-slate-500">{filteredProducts.length} في الصفحة</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-primary-50 dark:bg-primary-900/20 flex items-center justify-center">
              <Package size={18} className="text-primary-600" />
            </div>
          </Card>
          <Card className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">نشط</p>
              <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">{stats.activePage}</p>
              <p className="text-xs text-slate-500">{stats.inactivePage} موقوف</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center">
              <CheckCircle2 size={18} className="text-emerald-600" />
            </div>
          </Card>
          <Card className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">التصنيفات</p>
              <p className="text-2xl font-bold text-slate-900 dark:text-slate-50 tabular-nums">{categories.length}</p>
              <p className="text-xs text-slate-500">{productTypes.length} أنواع</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
              <Layers size={18} className="text-blue-600" />
            </div>
          </Card>
          <Card className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">متوسط التكلفة</p>
              <p className="text-lg font-bold text-amber-600 dark:text-amber-400 tabular-nums">{formatCurrency(stats.avgCost)}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-900/20 flex items-center justify-center">
              <TrendingUp size={18} className="text-amber-600" />
            </div>
          </Card>
        </div>

        {/* Toolbar */}
        <Card className="p-3 sm:p-4">
          <div className="flex flex-col xl:flex-row gap-3">
            <div className="relative flex-1">
              <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                type="text"
                placeholder={`${t('search')} — كود / اسم / باركود`}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 py-2.5 pr-10 pl-9 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
              />
              {searchTerm && (
                <button onClick={() => setSearchTerm('')} className="absolute left-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-slate-400">
                  <X size={14} />
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={filterCategoryId}
                onChange={(e) => setFilterCategoryId(e.target.value)}
                className="h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20"
              >
                <option value="">{t('inventory.allCategories')}</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
              </select>
              <select
                value={filterTypeId}
                onChange={(e) => setFilterTypeId(e.target.value)}
                className="h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20"
              >
                <option value="">{t('inventory.allTypes')}</option>
                {productTypes.map((tp: ProductType) => (
                  <option key={tp.id} value={tp.id}>{tp.nameAr}</option>
                ))}
              </select>
              <div className="h-6 w-px bg-slate-200 dark:bg-slate-700 hidden sm:block" />
              <Button size="sm" variant="ghost" onClick={handleExportExcel} className="gap-1.5">
                <FileText size={14} className="text-emerald-600" /> <span className="hidden sm:inline text-xs">Excel</span>
              </Button>
              <Button size="sm" variant="ghost" onClick={handleExportPdf} className="gap-1.5">
                <Receipt size={14} className="text-rose-600" /> <span className="hidden sm:inline text-xs">PDF</span>
              </Button>
            </div>
          </div>
          {hasFilters && (
            <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
              <span>{total} منتج • {searchTerm ? `"${searchTerm}"` : ''} {filterCategoryId ? '• تصفية تصنيف (صفحة)' : ''}</span>
              <button onClick={() => { setSearchTerm(''); setFilterTypeId(''); setFilterCategoryId(''); }} className="text-primary-600 hover:underline font-medium">مسح الفلترة</button>
            </div>
          )}
        </Card>
      </div>

      <Card noPadding>
        {filteredProducts.length === 0 && !isLoading ? (
          <div className="py-10">
            <EmptyState
              icon={hasFilters ? 'search' : 'inbox'}
              title={hasFilters ? 'لا توجد نتائج' : t('inventory.empty.products.title')}
              description={hasFilters ? 'جرّب تغيير البحث أو الفلترة' : t('inventory.empty.products.description')}
              action={hasFilters ? <Button variant="secondary" onClick={() => { setSearchTerm(''); setFilterTypeId(''); setFilterCategoryId(''); }}>مسح الفلترة</Button> : <Can action="create" module="inventory"><Button variant="primary" leftIcon={<Plus size={16} />} onClick={handleOpenCreate}>{t('inventory.newProduct')}</Button></Can>}
            />
          </div>
        ) : (
          <>
            <Table<Product> data={filteredProducts} columns={columns as never} keyExtractor={(row) => row.id} isLoading={isLoading} emptyMessage="" />
            <div className="border-t border-slate-200 dark:border-slate-800">
              <Pagination page={page} pageSize={pageSize} total={total} onPageChange={goToPage} onPageSizeChange={changePageSize} />
            </div>
          </>
        )}
      </Card>

      {/* Create/Edit Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={closeModal}
        title={editingId ? t('inventory.editProduct') : t('inventory.newProduct')}
        description={editingId ? 'تعديل بيانات المنتج' : 'إضافة منتج جديد — الحقول المميزة بـ * مطلوبة'}
        size="xl"
        footer={
          <div className="flex items-center justify-between w-full">
            <p className="text-xs text-slate-500 hidden sm:flex items-center gap-1.5"><AlertCircle size={12} /> * حقول مطلوبة</p>
            <div className="flex gap-2 ml-auto">
              <Button variant="secondary" onClick={closeModal} disabled={saving}>{t('cancel')}</Button>
              <Button variant="primary" onClick={handleSave} isLoading={saving}>{t('save')}</Button>
            </div>
          </div>
        }
      >
        <div className="space-y-5">
          <div>
            <h4 className="text-xs font-bold tracking-wider uppercase text-slate-500 mb-3 flex items-center gap-2"><Package size={12} /> الصورة والباركود</h4>
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="flex items-center gap-4">
                <div className="relative shrink-0">
                  {formData.image ? (
                    <img src={formData.image} alt="product" className="w-20 h-20 rounded-xl object-cover border border-slate-200 dark:border-slate-700 shadow-sm" />
                  ) : (
                    <div className="w-20 h-20 rounded-xl bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-700 flex items-center justify-center border border-slate-200 dark:border-slate-700">
                      <Package size={24} className="text-slate-400" />
                    </div>
                  )}
                  <label className="absolute -bottom-2 -right-2 w-8 h-8 bg-primary-600 rounded-full flex items-center justify-center cursor-pointer shadow hover:bg-primary-700 transition">
                    <Upload size={14} className="text-white" />
                    <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                  </label>
                </div>
                <div className="text-xs text-slate-500 leading-relaxed hidden sm:block">
                  <p className="font-medium text-slate-700 dark:text-slate-300">صورة المنتج</p>
                  <p>اختيارية • حتى 2MB</p>
                  <p>JPG, PNG</p>
                </div>
              </div>
              <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1.5">{t('inventory.barcode')}</label>
                  <div className="flex gap-1.5">
                    <input type="text" value={formData.barcode} onChange={(e) => setFormData((prev) => ({ ...prev, barcode: e.target.value }))} className="flex-1 h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-mono" placeholder={t('inventory.barcodePlaceholder')} />
                    {!scanning ? (
                      <Button variant="secondary" size="sm" onClick={startBarcodeScan} title={t('inventory.scanBarcode')} className="h-10 w-10 p-0"><Camera size={14} /></Button>
                    ) : (
                      <Button variant="danger" size="sm" onClick={stopBarcodeScan} title={t('inventory.stopScan')} className="h-10 w-10 p-0"><X size={14} /></Button>
                    )}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1.5">{t('inventory.sku')}</label>
                  <input type="text" value={formData.sku} onChange={(e) => setFormData((prev) => ({ ...prev, sku: e.target.value }))} className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-mono" placeholder={t('inventory.skuPlaceholder')} />
                </div>
              </div>
            </div>
            {scanning && (
              <div className="relative rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-black mt-3">
                <video ref={videoRef} className="w-full h-48 object-cover" playsInline muted />
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-48 h-24 border-2 border-primary-400 rounded-lg opacity-60" />
                </div>
              </div>
            )}
          </div>

          <div className="h-px bg-slate-100 dark:bg-slate-800" />

          <div>
            <h4 className="text-xs font-bold tracking-wider uppercase text-slate-500 mb-3 flex items-center gap-2"><Hash size={12} /> البيانات الأساسية</h4>
            <div className="grid grid-cols-12 gap-3">
              <div className="col-span-12 sm:col-span-4">
                <label className="block text-xs font-semibold text-slate-500 mb-1.5 flex items-center gap-2">
                  {t('inventory.productCode')}
                  {!editingId && (
                    <button type="button" onClick={() => handleCodeAutoToggle(!formData.codeAuto)} className={`text-[10px] px-2 py-0.5 rounded-full border transition ${formData.codeAuto ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300 border-primary-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                      {formData.codeAuto ? <><RefreshCw size={10} className="inline mr-1" />{t('inventory.autoNumber')}</> : t('inventory.manual')}
                    </button>
                  )}
                </label>
                <div className="flex gap-1.5">
                  <input type="text" value={formData.code} onChange={(e) => setFormData((prev) => ({ ...prev, code: e.target.value, codeAuto: false }))} disabled={!editingId && formData.codeAuto} className="flex-1 h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-mono disabled:bg-slate-50 dark:disabled:bg-slate-800/50 disabled:text-slate-500" placeholder={formData.codeAuto ? codePreview : t('inventory.codePlaceholder')} />
                  {!editingId && formData.codeAuto && (
                    <Button variant="ghost" size="sm" onClick={refreshCodePreview} title={t('inventory.refreshCode')} className="h-10 w-10 p-0"><RefreshCw size={14} /></Button>
                  )}
                </div>
                {formData.codeAuto && !editingId && codePreview && <p className="text-xs text-slate-500 mt-1">{t('inventory.nextCodeWillBe')}: <span className="font-mono text-primary-600 font-bold">{codePreview}</span></p>}
              </div>
              <div className="col-span-12 sm:col-span-5">
                <label className="block text-xs font-semibold text-slate-500 mb-1.5">{t('inventory.productName')} <span className="text-rose-500">*</span></label>
                <input type="text" value={formData.nameAr} onChange={(e) => setFormData((prev) => ({ ...prev, nameAr: e.target.value }))} className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm" placeholder={t('inventory.productNamePlaceholder')} required />
              </div>
              <div className="col-span-12 sm:col-span-3">
                <label className="block text-xs font-semibold text-slate-500 mb-1.5">{t('inventory.unitName')} <span className="text-rose-500">*</span></label>
                <UnitSelect companyId={companyId} value={formData.unit} onChange={handleUnitChange} size="sm" />
              </div>
            </div>
            <div className="mt-4">
              <label className="block text-xs font-semibold text-slate-500 mb-1.5">{t('inventory.nameEnglish')}</label>
              <input type="text" value={formData.nameEn} onChange={(e) => setFormData((prev) => ({ ...prev, nameEn: e.target.value }))} className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm" placeholder={t('inventory.nameEnglishPlaceholder')} dir="ltr" />
            </div>
            <div className="mt-4">
              <label className="block text-xs font-semibold text-slate-500 mb-1.5"><Tag size={12} className="inline mr-1" />{t('inventory.productType')}</label>
              <ProductTypeSelect companyId={companyId} value={formData.productTypeId} onChange={(v) => setFormData((prev) => ({ ...prev, productTypeId: v || '' }))} size="sm" />
            </div>
          </div>

          <div className="h-px bg-slate-100 dark:bg-slate-800" />

          <div>
            <h4 className="text-xs font-bold tracking-wider uppercase text-slate-500 mb-3 flex items-center gap-2"><TrendingUp size={12} /> التسعير والحالة</h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5">{t('inventory.costPrice')}</label>
                <input type="number" step="0.01" min="0" value={formData.costPrice} onChange={(e) => setFormData((prev) => ({ ...prev, costPrice: e.target.value }))} className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm tabular-nums" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5">{t('inventory.salePrice')}</label>
                <input type="number" step="0.01" min="0" value={formData.salePrice} onChange={(e) => setFormData((prev) => ({ ...prev, salePrice: e.target.value }))} className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm tabular-nums font-semibold" />
              </div>
              <label className="flex items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 px-4 py-3 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition h-10 mt-6">
                <input type="checkbox" checked={formData.isActive} onChange={(e) => setFormData((prev) => ({ ...prev, isActive: e.target.checked }))} className="w-4 h-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500" />
                <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{t('inventory.active')}</span>
                <Badge className={`ml-auto border text-xs ${formData.isActive ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-slate-200 text-slate-600 border-slate-300'}`}>{formData.isActive ? 'نشط' : 'موقوف'}</Badge>
              </label>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1.5">{t('inventory.minStock')}</label>
              <input type="number" step="0.01" min="0" value={formData.minStock} onChange={(e) => setFormData((prev) => ({ ...prev, minStock: e.target.value }))} className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm tabular-nums" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1.5">{t('inventory.maxStock')}</label>
              <input type="number" step="0.01" min="0" value={formData.maxStock} onChange={(e) => setFormData((prev) => ({ ...prev, maxStock: e.target.value }))} className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm tabular-nums" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1.5">{t('inventory.reorderPoint')}</label>
              <input type="number" step="0.01" min="0" value={formData.reorderPoint} onChange={(e) => setFormData((prev) => ({ ...prev, reorderPoint: e.target.value }))} className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm tabular-nums" />
            </div>
          </div>

          {/* Opening stock (create mode only) */}
          <div className="rounded-xl border border-dashed border-emerald-300 dark:border-emerald-700 bg-emerald-50/50 dark:bg-emerald-900/10 p-4 space-y-3">
            <p className="text-xs font-bold tracking-wider uppercase text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
              <Package size={12} /> {t('openingBalance.stockSection')}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5">{t('openingBalance.stockQty')}</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  disabled={!!editingId}
                  value={formData.openingStockQty}
                  onChange={(e) => setFormData((prev) => ({ ...prev, openingStockQty: e.target.value }))}
                  placeholder="0"
                  className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm tabular-nums disabled:opacity-60 disabled:cursor-not-allowed"
                />
                {Number(formData.openingStockQty) > 0 && (
                  <p className="text-xs text-emerald-700 dark:text-emerald-300 mt-1">
                    {t('openingBalance.stockValue')}: <span className="font-bold tabular-nums">{formatCurrency(Number(formData.openingStockQty) * (Number(formData.costPrice) || 0))}</span>
                  </p>
                )}
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5">{t('inventory.selectWarehouseLabel')}</label>
                <select
                  value={formData.openingWarehouseId}
                  onChange={(e) => setFormData((prev) => ({ ...prev, openingWarehouseId: e.target.value }))}
                  disabled={!!editingId}
                  aria-label={t('inventory.selectWarehouseLabel')}
                  className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <option value="">{t('inventory.selectWarehouseLabel')}</option>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
                {editingId ? (
                  <p className="text-xs text-slate-400 mt-1">{t('openingBalance.postedHint')}</p>
                ) : (
                  <p className="text-xs text-slate-400 mt-1">{t('openingBalance.stockHint')}</p>
                )}
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-2 flex items-center gap-2"><Layers size={12} /> {t('inventory.categories')}</label>
            {categories.length === 0 ? (
              <p className="text-sm text-slate-400 bg-slate-50 dark:bg-slate-800/50 p-3 rounded-lg border border-dashed">{t('inventory.noCategoriesAvailable')}</p>
            ) : (
              <div className="flex flex-wrap gap-2 p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/30">
                {categories.map((cat) => (
                  <button key={cat.id} type="button" onClick={() => toggleCategory(cat.id)} className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${formData.categoryIds.includes(cat.id) ? 'bg-primary-600 text-white border-primary-600 shadow-sm' : 'bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600 hover:bg-slate-100'}`}>
                    {cat.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </Modal>

      {/* Detail Modal */}
      <Modal
        isOpen={isDetailOpen}
        onClose={() => setIsDetailOpen(false)}
        title={t('inventory.productDetails')}
        size="lg"
        footer={
          <div className="flex gap-2 ml-auto">
            <Button variant="secondary" onClick={() => setIsDetailOpen(false)}>{t('close')}</Button>
            <Can action="edit" module="inventory">
              <Button variant="primary" onClick={() => { setIsDetailOpen(false); if (detailProduct) handleOpenEdit(detailProduct); }}>{t('edit')}</Button>
            </Can>
          </div>
        }
      >
        {detailProduct && (
          <div className="space-y-5">
            <div className="flex gap-4">
              {detailProduct.image ? (
                <img src={detailProduct.image} alt={detailProduct.nameAr} className="w-24 h-24 rounded-2xl object-cover border border-slate-200 dark:border-slate-700 shadow-sm" />
              ) : (
                <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-700 flex items-center justify-center border border-slate-200 dark:border-slate-700">
                  <Package size={32} className="text-slate-400" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-bold text-slate-900 dark:text-slate-50 truncate">{detailProduct.nameAr}</h3>
                <p className="text-sm text-slate-500 truncate" dir="ltr">{detailProduct.nameEn || ''}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <StatusBadge status={detailProduct.isActive ? 'active' : 'inactive'} />
                  {detailProduct.productTypeName ? <Badge className="bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border border-blue-200">{detailProduct.productTypeName}</Badge> : null}
                  <span className="font-mono text-xs bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded border">{detailProduct.code}</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
              {[
                { label: t('inventory.productCode'), value: detailProduct.code, mono: true },
                { label: t('inventory.barcode'), value: detailProduct.barcode || '-', mono: true },
                { label: t('inventory.sku'), value: detailProduct.sku || '-', mono: true },
                { label: t('inventory.unitName'), value: detailProduct.unitName || detailProduct.unit || '-' },
                { label: t('inventory.costPrice'), value: formatCurrency(detailProduct.costPrice), mono: false, bold: true },
                { label: t('inventory.salePrice'), value: formatCurrency(detailProduct.salePrice), mono: false, bold: true, primary: true },
                { label: t('inventory.minStock'), value: detailProduct.minStock ?? '-' },
                { label: t('inventory.maxStock'), value: detailProduct.maxStock ?? '-' },
                { label: t('inventory.reorderPoint'), value: detailProduct.reorderPoint ?? '-' },
              ].map((item) => (
                <div key={item.label} className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-100 dark:border-slate-800">
                  <span className="text-xs text-slate-500 block">{item.label}</span>
                  <span className={`font-medium ${item.mono ? 'font-mono text-xs' : ''} ${item.primary ? 'text-primary-600 dark:text-primary-400 font-bold' : 'text-slate-900 dark:text-slate-100'} ${item.bold ? 'font-bold' : ''}`}>{item.value}</span>
                </div>
              ))}
            </div>

            {detailProduct.categoryNames && detailProduct.categoryNames.length > 0 && (
              <div>
                <span className="text-xs font-semibold tracking-wider uppercase text-slate-500 block mb-2">{t('inventory.categories')}</span>
                <div className="flex flex-wrap gap-2">
                  {detailProduct.categoryNames.map((c) => (
                    <span key={c.id} className="px-3 py-1.5 rounded-full bg-primary-50 dark:bg-primary-900/20 text-sm text-primary-700 dark:text-primary-300 border border-primary-200 dark:border-primary-800">
                      {c.name}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>

      <ConfirmDialog isOpen={!!confirmDelete} onClose={() => setConfirmDelete(null)} onConfirm={() => confirmDelete && handleDelete(confirmDelete)} title={t('delete')} message={t('inventory.deleteConfirm')} variant="danger" />
    </div>
  );
};

export default ProductsPage;
