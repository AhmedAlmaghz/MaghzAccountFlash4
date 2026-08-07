import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { Package, Plus, Upload, Camera, X, Search, Hash, RefreshCw } from 'lucide-react';
import { Card, Button, Modal, Table, Pagination, Can } from '@/core/ui/components';
import { ActionButtons } from '@/core/ui/components/ActionButtons';
import { StatusBadge } from '@/core/ui/components/StatusBadge';
import { ConfirmDialog } from '@/core/ui/components/ConfirmDialog';
import { EmptyState } from '@/core/ui/components/EmptyState';
import { UnitSelect, ProductTypeSelect } from '@/core/ui/components/smart';
import { useProductsPaginated, useProductCategories } from '../hooks/useInventory';
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
  image: '',
  categoryIds: [],
  productTypeId: '',
  isActive: true,
};

export const ProductsPage: React.FC = () => {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const activeCompany = useAppStore(state => state.activeCompany);
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

  const filteredProducts = useMemo(() => products.filter(p => {
    if (!filterCategoryId) return true;
    return p.categoryId === filterCategoryId || p.categoryIds?.includes(filterCategoryId);
  }), [products, filterCategoryId]);

  // Fetch code preview when modal opens for new product
  const refreshCodePreview = useCallback(async () => {
    if (!companyId) return;
    const result = await peekNextNumber('product');
    if (result.success && result.number) {
      setCodePreview(result.number);
      setFormData(prev => prev.codeAuto ? { ...prev, code: result.number! } : prev);
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
      // Auto-generate code if enabled and creating
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
        // Manual code required if auto is off
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
      };

      if (editingId) {
        const result = await update(editingId, payload);
        if (result.success) {
          await logAudit({
            userId: user?.id || '',
            action: 'update',
            tableName: 'products',
            recordId: editingId,
            companyId: activeCompany.id,
          });
          addToast('success', t('inventory.product.updated'));
          closeModal();
        } else {
          addToast('error', result.error || t('common.error'));
        }
      } else {
        const result = await create(payload);
        if (result.success) {
          await logAudit({
            userId: user?.id || '',
            action: 'create',
            tableName: 'products',
            recordId: result.id || '',
            companyId: activeCompany.id,
          });
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
      await logAudit({
        userId: user?.id || '',
        action: 'delete',
        tableName: 'products',
        recordId: id,
        companyId: activeCompany.id,
      });
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
      setFormData(prev => ({ ...prev, image: reader.result as string }));
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
          setFormData(prev => ({ ...prev, barcode: result.barcode }));
          setScanning(false);
          barcodeScanner.stopCamera();
        }
      );
    } catch {
      setScanning(false);
      addToast('error', t('inventory.errors.cameraFailed'));
    }
  }, [addToast, t]);

  const toggleCategory = (catId: string) => {
    setFormData(prev => ({
      ...prev,
      categoryIds: prev.categoryIds.includes(catId)
        ? prev.categoryIds.filter(id => id !== catId)
        : [...prev.categoryIds, catId],
    }));
  };

  const handleUnitChange = (value: string | null) => {
    setFormData(prev => ({ ...prev, unit: value || '' }));
  };

  const handleCodeAutoToggle = (auto: boolean) => {
    setFormData(prev => {
      if (auto) {
        return { ...prev, codeAuto: true, code: codePreview };
      }
      return { ...prev, codeAuto: false };
    });
  };

  const columns = useMemo(() => [
    { key: 'image', header: '', width: '60px', render: (row: Product) => (
      row.image ? (
        <img src={row.image} alt="" className="w-10 h-10 rounded-lg object-cover border border-slate-200 dark:border-slate-700" />
      ) : (
        <div className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
          <Package size={16} className="text-slate-400" />
        </div>
      )
    )},
    { key: 'code', header: t('inventory.productCode'), width: '110px', render: (row: Product) => <span className="font-mono text-xs font-medium">{row.code}</span> },
    { key: 'nameAr', header: t('inventory.productName'), render: (row: Product) => (
      <div>
        <div className="font-medium text-slate-900 dark:text-slate-100">{row.nameAr}</div>
        {row.nameEn && <div className="text-xs text-slate-500">{row.nameEn}</div>}
      </div>
    )},
    { key: 'barcode', header: t('inventory.barcode'), width: '120px', render: (row: Product) => row.barcode ? <span className="font-mono text-xs">{row.barcode}</span> : '-' },
    {
      key: 'unit',
      header: t('inventory.unitName'),
      width: '100px',
      render: (row: Product) => row.unitName ? <span className="text-sm">{row.unitName}</span> : <span className="text-xs text-slate-400 font-mono">{row.unit || '-'}</span>,
    },
    {
      key: 'categories',
      header: t('inventory.categories'),
      width: '180px',
      render: (row: Product) => row.categoryNames && row.categoryNames.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {row.categoryNames.slice(0, 2).map(c => (
            <span key={c.id} className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-xs text-slate-700 dark:text-slate-300">{c.name}</span>
          ))}
          {row.categoryNames.length > 2 && (
            <span className="text-xs text-slate-500">+{row.categoryNames.length - 2}</span>
          )}
        </div>
      ) : <span className="text-xs text-slate-400">-</span>,
    },
    { key: 'costPrice', header: t('inventory.costPrice'), align: 'right' as const, render: (row: Product) => <span className="text-slate-600 dark:text-slate-300">{formatCurrency(row.costPrice)}</span> },
    { key: 'salePrice', header: t('inventory.salePrice'), align: 'right' as const, render: (row: Product) => <span className="font-semibold text-primary-600 dark:text-primary-400">{formatCurrency(row.salePrice)}</span> },
    { key: 'isActive', header: t('inventory.status'), width: '90px', render: (row: Product) => (
      <StatusBadge status={row.isActive ? 'active' : 'inactive'} />
    )},
    { key: 'actions', header: '', width: '120px', render: (row: Product) => (
      <ActionButtons
        onView={() => handleViewDetail(row)}
        onEdit={() => handleOpenEdit(row)}
        onDelete={() => setConfirmDelete(row.id)}
        showPrint={false}
        showExport={false}
      />
    )},
  ], [t, formatCurrency, handleOpenEdit, handleViewDetail]);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Package size={28} className="text-primary-600 dark:text-primary-400" />
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">{t('inventory.products')}</h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm">
              {t('inventory.page.subtitle')}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder={t('search')}
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="h-10 pr-9 pl-3 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm w-48"
              aria-label={t('search')}
            />
          </div>
          <select
            value={filterCategoryId}
            onChange={e => setFilterCategoryId(e.target.value)}
            className="h-10 px-3 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            aria-label={t('inventory.filterByCategory')}
            title={t('inventory.filterByCategory')}
          >
            <option value="">{t('inventory.allCategories')}</option>
            {categories.map(cat => (
              <option key={cat.id} value={cat.id}>{cat.name}</option>
            ))}
          </select>
          <select
            value={filterTypeId}
            onChange={e => setFilterTypeId(e.target.value)}
            className="h-10 px-3 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            aria-label={t('inventory.filterByType')}
            title={t('inventory.filterByType')}
          >
            <option value="">{t('inventory.allTypes')}</option>
            {productTypes.map((tp: ProductType) => (
              <option key={tp.id} value={tp.id}>{tp.nameAr}</option>
            ))}
          </select>
          <Can action="create" module="inventory">
            <Button variant="primary" leftIcon={<Plus size={16} />} onClick={handleOpenCreate}>
              {t('inventory.newProduct')}
            </Button>
          </Can>
        </div>
      </div>

      <Card>
        {filteredProducts.length === 0 && !isLoading ? (
          <EmptyState
            icon="search"
            title={t('inventory.empty.products.title')}
            description={t('inventory.empty.products.description')}
            action={<Can action="create" module="inventory"><Button variant="primary" leftIcon={<Plus size={16} />} onClick={handleOpenCreate}>{t('inventory.newProduct')}</Button></Can>}
          />
        ) : (
          <Table<Product>
            data={filteredProducts}
            columns={columns}
            keyExtractor={(row) => row.id}
            isLoading={isLoading}
            emptyMessage=""
          />
        )}
        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={goToPage}
          onPageSizeChange={changePageSize}
        />
      </Card>

      {/* Create/Edit Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={closeModal}
        title={editingId ? t('inventory.editProduct') : t('inventory.newProduct')}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={closeModal} disabled={saving}>{t('cancel')}</Button>
            <Button variant="primary" onClick={handleSave} disabled={saving}>
              {saving ? t('common.loading') : t('save')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {/* Image + Barcode row */}
          <div className="flex items-center gap-4">
            <div className="relative shrink-0">
              {formData.image ? (
                <img src={formData.image} alt="product" className="w-20 h-20 rounded-lg object-cover border border-slate-200 dark:border-slate-700" />
              ) : (
                <div className="w-20 h-20 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                  <Package size={24} className="text-slate-400" />
                </div>
              )}
              <label className="absolute -bottom-2 -right-2 w-8 h-8 bg-primary-600 rounded-full flex items-center justify-center cursor-pointer shadow-sm hover:bg-primary-700">
                <Upload size={14} className="text-white" />
                <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
              </label>
            </div>
            <div className="flex-1 grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">
                  {t('inventory.barcode')}
                </label>
                <div className="flex gap-1">
                  <input
                    type="text"
                    value={formData.barcode}
                    onChange={e => setFormData(prev => ({ ...prev, barcode: e.target.value }))}
                    className="flex-1 h-10 px-3 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                    placeholder={t('inventory.barcodePlaceholder')}
                  />
                  {!scanning ? (
                    <Button variant="secondary" size="sm" onClick={startBarcodeScan} title={t('inventory.scanBarcode')}>
                      <Camera size={14} />
                    </Button>
                  ) : (
                    <Button variant="danger" size="sm" onClick={stopBarcodeScan} title={t('inventory.stopScan')}>
                      <X size={14} />
                    </Button>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">
                  {t('inventory.sku')}
                </label>
                <input
                  type="text"
                  value={formData.sku}
                  onChange={e => setFormData(prev => ({ ...prev, sku: e.target.value }))}
                  className="w-full h-10 px-3 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                  placeholder={t('inventory.skuPlaceholder')}
                />
              </div>
            </div>
          </div>

          {scanning && (
            <div className="relative rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 bg-black">
              <video ref={videoRef} className="w-full h-48 object-cover" playsInline muted />
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-48 h-24 border-2 border-primary-400 rounded-lg opacity-50" />
              </div>
            </div>
          )}

          {/* Code + Name + Unit row */}
          <div className="grid grid-cols-12 gap-3">
            <div className="col-span-4">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1 flex items-center gap-2">
                <Hash size={14} />
                {t('inventory.productCode')}
                {!editingId && (
                  <button
                    type="button"
                    onClick={() => handleCodeAutoToggle(!formData.codeAuto)}
                    className={`text-xs px-2 py-0.5 rounded-full transition-colors ${
                      formData.codeAuto
                        ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
                        : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                    }`}
                    title={formData.codeAuto ? t('inventory.codeAutoOn') : t('inventory.codeAutoOff')}
                  >
                    {formData.codeAuto ? <><RefreshCw size={10} className="inline mr-1" />{t('inventory.autoNumber')}</> : t('inventory.manual')}
                  </button>
                )}
              </label>
              <div className="flex gap-1">
                <input
                  type="text"
                  value={formData.code}
                  onChange={e => setFormData(prev => ({ ...prev, code: e.target.value, codeAuto: false }))}
                  disabled={!editingId && formData.codeAuto}
                  className="flex-1 h-10 px-3 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-mono disabled:bg-slate-50 dark:disabled:bg-slate-800/50 disabled:text-slate-500"
                  placeholder={formData.codeAuto ? codePreview : t('inventory.codePlaceholder')}
                />
                {!editingId && formData.codeAuto && (
                  <Button variant="ghost" size="sm" onClick={refreshCodePreview} title={t('inventory.refreshCode')}>
                    <RefreshCw size={14} />
                  </Button>
                )}
              </div>
              {formData.codeAuto && !editingId && codePreview && (
                <p className="text-xs text-slate-500 mt-1">
                  {t('inventory.nextCodeWillBe')}: <span className="font-mono text-primary-600 font-semibold">{codePreview}</span>
                </p>
              )}
            </div>
            <div className="col-span-5">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">
                {t('inventory.productName')} <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={formData.nameAr}
                onChange={e => setFormData(prev => ({ ...prev, nameAr: e.target.value }))}
                className="w-full h-10 px-3 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                placeholder={t('inventory.productNamePlaceholder')}
                required
              />
            </div>
            <div className="col-span-3">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">
                {t('inventory.unitName')} <span className="text-rose-500">*</span>
              </label>
              <UnitSelect companyId={companyId} value={formData.unit} onChange={handleUnitChange} size="sm" />
            </div>
          </div>

          {/* English name */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">
              {t('inventory.nameEnglish')}
            </label>
            <input
              type="text"
              value={formData.nameEn}
              onChange={e => setFormData(prev => ({ ...prev, nameEn: e.target.value }))}
              className="w-full h-10 px-3 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              placeholder={t('inventory.nameEnglishPlaceholder')}
              dir="ltr"
            />
          </div>

          {/* Type */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">
              {t('inventory.productType')}
            </label>
            <ProductTypeSelect
              companyId={companyId}
              value={formData.productTypeId}
              onChange={(v) => setFormData(prev => ({ ...prev, productTypeId: v || '' }))}
              size="sm"
            />
          </div>

          {/* Prices + Active */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">
                {t('inventory.costPrice')}
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={formData.costPrice}
                onChange={e => setFormData(prev => ({ ...prev, costPrice: e.target.value }))}
                className="w-full h-10 px-3 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">
                {t('inventory.salePrice')}
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={formData.salePrice}
                onChange={e => setFormData(prev => ({ ...prev, salePrice: e.target.value }))}
                className="w-full h-10 px-3 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              />
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 cursor-pointer h-10">
                <input
                  type="checkbox"
                  checked={formData.isActive}
                  onChange={e => setFormData(prev => ({ ...prev, isActive: e.target.checked }))}
                  className="w-4 h-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                />
                <span className="text-sm text-slate-700 dark:text-slate-200">{t('inventory.active')}</span>
              </label>
            </div>
          </div>

          {/* Min/Max/Reorder */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">
                {t('inventory.minStock')}
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={formData.minStock}
                onChange={e => setFormData(prev => ({ ...prev, minStock: e.target.value }))}
                className="w-full h-10 px-3 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">
                {t('inventory.maxStock')}
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={formData.maxStock}
                onChange={e => setFormData(prev => ({ ...prev, maxStock: e.target.value }))}
                className="w-full h-10 px-3 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">
                {t('inventory.reorderPoint')}
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={formData.reorderPoint}
                onChange={e => setFormData(prev => ({ ...prev, reorderPoint: e.target.value }))}
                className="w-full h-10 px-3 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              />
            </div>
          </div>

          {/* Categories */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">
              {t('inventory.categories')}
            </label>
            {categories.length === 0 ? (
              <p className="text-sm text-slate-400">{t('inventory.noCategoriesAvailable')}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {categories.map(cat => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => toggleCategory(cat.id)}
                    className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                      formData.categoryIds.includes(cat.id)
                        ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
                        : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 hover:bg-slate-200'
                    }`}
                  >
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
          <>
            <Button variant="secondary" onClick={() => setIsDetailOpen(false)}>{t('close')}</Button>
            <Can action="edit" module="inventory">
              <Button variant="primary" onClick={() => { setIsDetailOpen(false); if (detailProduct) handleOpenEdit(detailProduct); }}>
                {t('edit')}
              </Button>
            </Can>
          </>
        }
      >
        {detailProduct && (
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              {detailProduct.image ? (
                <img src={detailProduct.image} alt={detailProduct.nameAr} className="w-24 h-24 rounded-xl object-cover border border-slate-200 dark:border-slate-700" />
              ) : (
                <div className="w-24 h-24 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                  <Package size={32} className="text-slate-400" />
                </div>
              )}
              <div className="flex-1">
                <h3 className="text-lg font-bold text-slate-900 dark:text-slate-50">{detailProduct.nameAr}</h3>
                <p className="text-sm text-slate-500">{detailProduct.nameEn}</p>
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  <StatusBadge status={detailProduct.isActive ? 'active' : 'inactive'} />
                  {detailProduct.productTypeName && (
                    <span className="text-xs px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                      {detailProduct.productTypeName}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
              <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-lg">
                <span className="text-slate-500 block text-xs">{t('inventory.productCode')}</span>
                <span className="font-mono font-medium text-slate-900 dark:text-slate-100">{detailProduct.code}</span>
              </div>
              <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-lg">
                <span className="text-slate-500 block text-xs">{t('inventory.barcode')}</span>
                <span className="font-mono font-medium text-slate-900 dark:text-slate-100">{detailProduct.barcode || '-'}</span>
              </div>
              <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-lg">
                <span className="text-slate-500 block text-xs">{t('inventory.sku')}</span>
                <span className="font-mono font-medium text-slate-900 dark:text-slate-100">{detailProduct.sku || '-'}</span>
              </div>
              <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-lg">
                <span className="text-slate-500 block text-xs">{t('inventory.unitName')}</span>
                <span className="font-medium text-slate-900 dark:text-slate-100">{detailProduct.unitName || detailProduct.unit || '-'}</span>
              </div>
              <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-lg">
                <span className="text-slate-500 block text-xs">{t('inventory.costPrice')}</span>
                <span className="font-medium text-slate-900 dark:text-slate-100">{formatCurrency(detailProduct.costPrice)}</span>
              </div>
              <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-lg">
                <span className="text-slate-500 block text-xs">{t('inventory.salePrice')}</span>
                <span className="font-medium text-primary-600 dark:text-primary-400">{formatCurrency(detailProduct.salePrice)}</span>
              </div>
              <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-lg">
                <span className="text-slate-500 block text-xs">{t('inventory.minStock')}</span>
                <span className="font-medium text-slate-900 dark:text-slate-100">{detailProduct.minStock ?? '-'}</span>
              </div>
              <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-lg">
                <span className="text-slate-500 block text-xs">{t('inventory.maxStock')}</span>
                <span className="font-medium text-slate-900 dark:text-slate-100">{detailProduct.maxStock ?? '-'}</span>
              </div>
              <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-lg">
                <span className="text-slate-500 block text-xs">{t('inventory.reorderPoint')}</span>
                <span className="font-medium text-slate-900 dark:text-slate-100">{detailProduct.reorderPoint ?? '-'}</span>
              </div>
            </div>

            {detailProduct.categoryNames && detailProduct.categoryNames.length > 0 && (
              <div>
                <span className="text-slate-500 block text-sm mb-2">{t('inventory.categories')}</span>
                <div className="flex flex-wrap gap-2">
                  {detailProduct.categoryNames.map(c => (
                    <span key={c.id} className="px-3 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-300">
                      {c.name}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Confirm Delete */}
      <ConfirmDialog
        isOpen={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && handleDelete(confirmDelete)}
        title={t('delete')}
        message={t('inventory.deleteConfirm')}
        variant="danger"
      />
    </div>
  );
};

export default ProductsPage;
