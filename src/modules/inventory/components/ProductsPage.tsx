import React, { useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Package, Plus, FileText, Receipt, Layers, TrendingUp, CheckCircle2 } from 'lucide-react';
import { Card, Button, Modal, Table, Pagination, Can, Badge, PageHeader, FilterBar } from '@/core/ui/components';
import { ActionButtons } from '@/core/ui/components/ActionButtons';
import { StatusBadge } from '@/core/ui/components/StatusBadge';
import { ConfirmDialog } from '@/core/ui/components/ConfirmDialog';
import { EmptyState } from '@/core/ui/components/EmptyState';
import { useProductsPaginated, useProductCategories } from '../hooks/useInventory';
import { useProductTypes } from '@/core/hooks/useSettings';
import type { ProductType } from '@/core/types';
import { useAppStore } from '@/core/store';
import { useAuthStore } from '@/modules/auth/store';
import { useTranslation } from '@/core/i18n/useTranslation';
import { logAudit } from '@/core/utils/auditLogger';
import { useFormatters } from '@/core/utils/useFormatters';
import { useToastStore } from '@/core/store/toastStore';
import { exportToExcel, exportToPDF } from '@/core/utils/exportEngine';
import type { Product } from '../types';

export const ProductsPage: React.FC = () => {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const activeCompany = useAppStore((state) => state.activeCompany);
  const user = useAuthStore((state) => state.user);
  const companyId = activeCompany?.id || '';
  const navigate = useNavigate();

  const [filterTypeId, setFilterTypeId] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const productFilters = useMemo(() => ({
    productTypeId: filterTypeId || undefined,
    search: searchTerm || undefined,
  }), [filterTypeId, searchTerm]);
  const { products, total, page, pageSize, isLoading, goToPage, changePageSize, remove } = useProductsPaginated(companyId, productFilters);
  const { categories } = useProductCategories(companyId);
  const { types: productTypes } = useProductTypes(companyId);
  const { formatCurrency } = useFormatters(companyId);

  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [detailProduct, setDetailProduct] = useState<Product | null>(null);
  const [filterCategoryId, setFilterCategoryId] = useState<string>('');

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

  const handleOpenCreate = useCallback(() => {
    navigate('/inventory/products/new');
  }, [navigate]);

  const handleOpenEdit = useCallback((product: Product) => {
    navigate(`/inventory/products/${product.id}`);
  }, [navigate]);

  const handleViewDetail = useCallback((product: Product) => {
    setDetailProduct(product);
    setIsDetailOpen(true);
  }, []);

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
        isActive: p.isActive ? t('inventory.active') : t('inventory.suspended'),
      })),
      [
        { key: 'code', header: t('inventory.productCode') },
        { key: 'nameAr', header: t('inventory.productName') },
        { key: 'salePrice', header: t('inventory.salePrice') },
        { key: 'isActive', header: t('inventory.status') },
      ],
      `products_${new Date().toISOString().split('T')[0]}`,
      { title: t('inventory.products.title'), rtl: true, companyName: activeCompany?.name },
    );
  };

  const columns = useMemo(() => [
    {
      key: 'image',
      header: '',
      width: '56px',
      mobile: 'hidden' as const,
      render: (row: Product) => row.image ? (
        <img src={row.image} alt="" className="w-10 h-10 rounded-lg object-cover border border-zinc-200 dark:border-zinc-700 shadow-sm" />
      ) : (
        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-zinc-100 to-zinc-200 dark:from-zinc-800 dark:to-zinc-700 flex items-center justify-center border border-zinc-200 dark:border-zinc-700">
          <Package size={16} className="text-zinc-400" />
        </div>
      ),
    },
    {
      key: 'code',
      header: t('inventory.productCode'),
      width: '115px',
      mobile: 'subtitle' as const,
      render: (row: Product) => <span className="font-mono text-xs font-semibold bg-zinc-100 dark:bg-zinc-800 px-2 py-1 rounded-md border border-zinc-200 dark:border-zinc-700">{row.code}</span>,
    },
    {
      key: 'nameAr',
      header: t('inventory.productName'),
      mobile: 'title' as const,
      render: (row: Product) => (
        <div className="min-w-0">
          <div className="font-semibold text-zinc-900 dark:text-zinc-100 truncate">{row.nameAr}</div>
          {row.nameEn ? <div className="text-xs text-zinc-500 truncate" dir="ltr">{row.nameEn}</div> : null}
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
      render: (row: Product) => row.barcode ? <span className="font-mono text-xs bg-amber-50 dark:bg-amber-900/20 px-2 py-1 rounded border border-amber-200 dark:border-amber-800">{row.barcode}</span> : <span className="text-zinc-400 text-xs">—</span>,
    },
    {
      key: 'unit',
      header: t('inventory.unitName'),
      width: '90px',
      render: (row: Product) => row.unitName ? <span className="text-sm">{row.unitName}</span> : <span className="text-xs text-zinc-400 font-mono">{row.unit || '-'}</span>,
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
          {row.categoryNames.length > 2 && <span className="text-xs text-zinc-500">+{row.categoryNames.length - 2}</span>}
        </div>
      ) : <span className="text-xs text-zinc-400">-</span>,
    },
    {
      key: 'costPrice',
      header: t('inventory.costPrice'),
      align: 'right' as const,
      width: '110px',
      render: (row: Product) => <span className="tabular-nums text-sm text-zinc-600 dark:text-zinc-300">{formatCurrency(row.costPrice)}</span>,
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
      mobile: 'status' as const,
      render: (row: Product) => <StatusBadge status={row.isActive ? 'active' : 'inactive'} />,
    },
    {
      key: 'actions',
      header: '',
      width: '110px',
      mobile: 'actions' as const,
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
      {/* Page Header */}
      <PageHeader
        icon={<Package size={22} />}
        title={t('inventory.products.title')}
        subtitle={t('inventory.page.subtitle')}
        actions={
          <Can action="create" module="inventory">
            <Button variant="primary" leftIcon={<Plus size={16} />} onClick={handleOpenCreate} className="shadow-sm">
              {t('inventory.newProduct')}
            </Button>
          </Can>
        }
      />

        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Card className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">{t('inventory.products.totalProducts')}</p>
              <p className="text-2xl font-bold text-slate-900 dark:text-slate-50 tabular-nums">{total}</p>
              <p className="text-xs text-slate-500">{filteredProducts.length} {t('inventory.products.inPage')}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-primary-50 dark:bg-primary-900/20 flex items-center justify-center">
              <Package size={18} className="text-primary-600" />
            </div>
          </Card>
          <Card className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">{t('settings.common.active')}</p>
              <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">{stats.activePage}</p>
              <p className="text-xs text-slate-500">{stats.inactivePage} {t('inventory.suspended')}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center">
              <CheckCircle2 size={18} className="text-emerald-600" />
            </div>
          </Card>
          <Card className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">{t('inventory.products.categoriesLabel')}</p>
              <p className="text-2xl font-bold text-slate-900 dark:text-slate-50 tabular-nums">{categories.length}</p>
              <p className="text-xs text-slate-500">{productTypes.length} {t('inventory.products.typesLabel')}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
              <Layers size={18} className="text-blue-600" />
            </div>
          </Card>
          <Card className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">{t('inventory.products.avgCost')}</p>
              <p className="text-lg font-bold text-amber-600 dark:text-amber-400 tabular-nums">{formatCurrency(stats.avgCost)}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-900/20 flex items-center justify-center">
              <TrendingUp size={18} className="text-amber-600" />
            </div>
          </Card>
        </div>

        {/* Toolbar */}
        <FilterBar
          search={searchTerm}
          onSearchChange={setSearchTerm}
          searchPlaceholder={`${t('search')} — ${t('inventory.products.searchHint')}`}
          actions={
            <>
              <select
                value={filterCategoryId}
                onChange={(e) => setFilterCategoryId(e.target.value)}
                aria-label={t('inventory.categories')}
                className="h-9 px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20"
              >
                <option value="">{t('inventory.allCategories')}</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
              </select>
              <select
                value={filterTypeId}
                onChange={(e) => setFilterTypeId(e.target.value)}
                aria-label={t('inventory.productType')}
                className="h-9 px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20"
              >
                <option value="">{t('inventory.allTypes')}</option>
                {productTypes.map((tp: ProductType) => (
                  <option key={tp.id} value={tp.id}>{tp.nameAr}</option>
                ))}
              </select>
              <Button size="sm" variant="ghost" onClick={handleExportExcel} className="gap-1.5">
                <FileText size={14} className="text-emerald-600" /> <span className="hidden sm:inline text-xs">{t('common.excel')}</span>
              </Button>
              <Button size="sm" variant="ghost" onClick={handleExportPdf} className="gap-1.5">
                <Receipt size={14} className="text-rose-600" /> <span className="hidden sm:inline text-xs">PDF</span>
              </Button>
            </>
          }
        />
        {hasFilters && (
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <span>{total} {t('inventory.products.unit')} • {searchTerm ? `"${searchTerm}"` : ''} {filterCategoryId ? `• ${t('inventory.products.categoryPageFilter')}` : ''}</span>
            <button onClick={() => { setSearchTerm(''); setFilterTypeId(''); setFilterCategoryId(''); }} className="text-primary-600 hover:underline font-medium">{t('sales.filter.clearFilters')}</button>
          </div>
        )}

      <Card noPadding>
        {filteredProducts.length === 0 && !isLoading ? (
          <div className="py-10">
            <EmptyState
              icon={hasFilters ? 'search' : 'inbox'}
              title={hasFilters ? t('common.noResults') : t('inventory.empty.products.title')}
              description={hasFilters ? t('inventory.products.tryDifferentSearch') : t('inventory.empty.products.description')}
              action={hasFilters ? <Button variant="secondary" onClick={() => { setSearchTerm(''); setFilterTypeId(''); setFilterCategoryId(''); }}>{t('sales.filter.clearFilters')}</Button> : <Can action="create" module="inventory"><Button variant="primary" leftIcon={<Plus size={16} />} onClick={handleOpenCreate}>{t('inventory.newProduct')}</Button></Can>}
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
