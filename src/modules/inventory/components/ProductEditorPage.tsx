import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Save, CheckCircle2 } from 'lucide-react';
import { Card, Button, Input, Badge } from '@/core/ui/components';
import { DocumentPageShell, TotalsPanel, useDocumentEditorGuard, UnsavedChangesDialog } from '@/core/ui/components/document';
import { UnitSelect, ProductTypeSelect, WarehouseSelect } from '@/core/ui/components/smart';
import { Card as CardRoot } from '@/core/ui/components/Card';
import { useAppStore } from '@/core/store';
import { useAuthStore } from '@/modules/auth/store';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useToastStore } from '@/core/store/toastStore';
import { useFormatters } from '@/core/utils/useFormatters';
import { toDateString } from '@/core/utils/mapPgRow';
import { getNextDocumentNumber } from '@/core/api';
import { useProductCategories, useWarehouses } from '../hooks/useInventory';
import { inventoryApi } from '../api';
import { ProductUnitsSection } from './ProductUnitsSection';
import type { Product } from '../types';

interface FormData {
  code: string;
  nameAr: string;
  nameEn: string;
  barcode: string;
  sku: string;
  unit: string;
  costPrice: string;
  standardCost: string;
  salePrice: string;
  minStock: string;
  maxStock: string;
  reorderPoint: string;
  openingStockQty: string;
  openingWarehouseId: string;
  openingDate: string;
  isActive: boolean;
  categoryIds: string[];
  productTypeId: string;
}

const initialForm: FormData = {
  code: '',
  nameAr: '',
  nameEn: '',
  barcode: '',
  sku: '',
  unit: '',
  costPrice: '0',
  standardCost: '',
  salePrice: '0',
  minStock: '0',
  maxStock: '0',
  reorderPoint: '0',
  openingStockQty: '',
  openingWarehouseId: '',
  openingDate: '',
  isActive: true,
  categoryIds: [],
  productTypeId: '',
};

export const ProductEditorPage: React.FC = () => {
  const { t } = useTranslation();
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const activeCompany = useAppStore((s) => s.activeCompany);
  const user = useAuthStore((s) => s.user);
  const companyId = activeCompany?.id || '';
  const { formatCurrency } = useFormatters(companyId);

  const isEdit = Boolean(id);
  const [form, setForm] = useState<FormData>(initialForm);
  const [productId, setProductId] = useState<string | null>(id ?? null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(Boolean(id));
  const { blocked, proceed, reset, guardNavigate, clearDraft } = useDocumentEditorGuard('product', { ...form }, loading, isEdit, saving);

  const { categories } = useProductCategories(companyId);
  void useWarehouses(companyId);

  const setField = useCallback((key: keyof FormData, value: FormData[keyof FormData]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!id || !companyId) return;
    setLoading(true);
    (async () => {
      const res = await inventoryApi.getProductsPaginated(companyId, 1, 1, { search: '' });
      void res;
      const { getDbAdapter } = await import('@/core/database/adapters');
      const adapter = await getDbAdapter();
      const r = await adapter.query(
        'SELECT * FROM products WHERE id = $1::uuid AND company_id = $2::uuid',
        [id, companyId]
      );
      if (cancelled) return;
      setLoading(false);
      if (r?.success && r.rows?.[0]) {
        const row = r.rows[0] as Record<string, unknown>;
        setForm({
          code: String(row.code ?? ''),
          nameAr: String(row.name_ar ?? ''),
          nameEn: String(row.name_en ?? ''),
          barcode: String(row.barcode ?? ''),
          sku: String(row.sku ?? ''),
          unit: String(row.unit ?? ''),
          costPrice: String(row.cost_price ?? '0'),
          standardCost: row.standard_cost != null ? String(row.standard_cost) : '',
          salePrice: String(row.sale_price ?? '0'),
          minStock: String(row.min_stock ?? '0'),
          maxStock: String(row.max_stock ?? '0'),
          reorderPoint: String(row.reorder_point ?? '0'),
          openingStockQty: '',
          openingWarehouseId: '',
          openingDate: row.opening_date ? toDateString(row.opening_date) ?? '' : '',
          isActive: row.is_active !== false,
          categoryIds: ((row.category_ids as unknown) as string[] | undefined) ?? [],
          productTypeId: String(row.product_type_id ?? ''),
        });
        setProductId(id);
      } else {
        addToast('error', r?.error || t('common.noResults'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, companyId, addToast, t]);

  const summary = useMemo(() => ({
    subtotal: Number(form.costPrice) || 0,
    discountAmount: 0,
    vatAmount: 0,
    totalAmount: Number(form.salePrice) || 0,
  }), [form.costPrice, form.salePrice]);

  const handleSave = async () => {
    if (!companyId) return;
    if (!form.nameAr.trim()) {
      addToast('error', t('validation.required'));
      return;
    }
    // رمز المنتج: تلقائياً من ترقيم `document_sequences` (PRD-) عند عدم وجود رمز مُدخل —
    // الحقل مخفي في الواجهة (لا داعٍ لتعبئته يدوياً).
    let code = form.code.trim();
    if (!code) {
      const seq = await getNextDocumentNumber(companyId, 'product');
      if (seq.success && seq.number) code = seq.number;
    }
    setSaving(true);
    const payload = {
      companyId,
      code: code || undefined,
      nameAr: form.nameAr.trim(),
      nameEn: form.nameEn.trim() || undefined,
      barcode: form.barcode.trim() || undefined,
      sku: form.sku.trim() || undefined,
      unit: form.unit || '',
      costPrice: Number(form.costPrice) || 0,
      standardCost: form.standardCost === '' ? undefined : Number(form.standardCost) || 0,
      salePrice: Number(form.salePrice) || 0,
      minStock: Number(form.minStock) || 0,
      maxStock: Number(form.maxStock) || 0,
      reorderPoint: Number(form.reorderPoint) || 0,
      openingStockQty: form.openingStockQty === '' ? undefined : Number(form.openingStockQty) || 0,
      openingWarehouseId: form.openingWarehouseId || undefined,
      openingDate: form.openingDate || undefined,
      isActive: form.isActive,
      categoryIds: form.categoryIds,
      productTypeId: form.productTypeId || undefined,
    };
    const result = isEdit && productId
      ? await inventoryApi.updateProduct(productId, companyId, user?.id, payload as Partial<Product>)
      : await inventoryApi.createProduct(payload as never, user?.id);
    setSaving(false);
    if (result.success) {
      clearDraft();
      addToast('success', t('common.saved'));
      if (result.warning) addToast('error', result.warning);
      navigate('/inventory/products');
    } else {
      addToast('error', result.error || t('common.error'));
    }
  };

  const title = isEdit ? t('inventory.editProduct') : t('inventory.newProduct');

  const actions = (
    <>
      <Button variant="secondary" onClick={() => navigate('/inventory/products')}>{t('common.cancel')}</Button>
      <Button variant="primary" leftIcon={<Save size={16} />} onClick={handleSave} isLoading={saving}>
        {t('common.save')}
      </Button>
    </>
  );

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 text-sm text-zinc-500">{t('common.loading')}</div>
    );
  }

  return (
    <DocumentPageShell
      title={title}
      subtitle={isEdit ? id : undefined}
      onBack={() => guardNavigate(() => navigate('/inventory/products'))}
      statusBadge={<Badge>{form.isActive ? t('common.enabled') : t('common.disabled')}</Badge>}
      headerActions={actions}
      footerActions={actions}
      summary={<TotalsPanel totals={summary} formatCurrency={formatCurrency} />}
    >
      <Card className="p-4 sm:p-5 space-y-4">
        <h2 className="font-bold">{t('common.name')}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label={t('inventory.products.nameAr')} value={form.nameAr} onChange={(e) => setField('nameAr', e.target.value)} required />
          <Input label={t('inventory.nameEnglish')} value={form.nameEn} onChange={(e) => setField('nameEn', e.target.value)} />
          {/* The code field is hidden: it's auto-generated from `document_sequences`. */}
          <input type="hidden" value={form.code} />
          <Input label={t('inventory.barcode')} value={form.barcode} onChange={(e) => setField('barcode', e.target.value)} />
          <Input label={t('inventory.sku')} value={form.sku} onChange={(e) => setField('sku', e.target.value)} />
          <UnitSelect companyId={companyId} value={form.unit || ''} onChange={(v) => setField('unit', v ?? '')} placeholder={t('inventory.unitName')} />
          <ProductTypeSelect companyId={companyId} value={form.productTypeId || undefined} onChange={(v) => setField('productTypeId', v ?? '')} />
          <div className="space-y-2">
            <span className="text-sm font-medium">{t('inventory.categories')}</span>
            <div className="flex flex-wrap gap-2">
              {categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setField('categoryIds', form.categoryIds.includes(c.id) ? form.categoryIds.filter((x) => x !== c.id) : [...form.categoryIds, c.id])}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold border min-h-9 ${form.categoryIds.includes(c.id) ? 'bg-primary-50 border-primary-500 text-primary-700 dark:bg-primary-900/30' : 'border-zinc-200 dark:border-zinc-700'}`}
                  aria-pressed={form.categoryIds.includes(c.id)}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Card>

      <Card className="p-4 sm:p-5 space-y-4">
        <h2 className="font-bold">{t('inventory.stockValue')}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Input type="number" label={t('inventory.costPrice')} value={form.costPrice} onChange={(e) => setField('costPrice', e.target.value)} />
          <Input type="number" label={t('inventory.salePrice')} value={form.salePrice} onChange={(e) => setField('salePrice', e.target.value)} />
          <Input type="number" label={t('inventory.standardCost')} value={form.standardCost} onChange={(e) => setField('standardCost', e.target.value)} />
          <Input type="number" label={t('inventory.minStock')} value={form.minStock} onChange={(e) => setField('minStock', e.target.value)} />
          <Input type="number" label={t('inventory.maxStock')} value={form.maxStock} onChange={(e) => setField('maxStock', e.target.value)} />
          <Input type="number" label={t('inventory.reorderPoint')} value={form.reorderPoint} onChange={(e) => setField('reorderPoint', e.target.value)} />
        </div>
      </Card>

      {!isEdit && (
        <Card className="p-4 sm:p-5 space-y-4">
          <h2 className="font-bold">{t('inventory.stockValue')}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Input type="number" label={t('inventory.quantity')} value={form.openingStockQty} onChange={(e) => setField('openingStockQty', e.target.value)} />
            <WarehouseSelect companyId={companyId} value={form.openingWarehouseId || undefined} onChange={(v) => setField('openingWarehouseId', v ?? '')} />
            <Input type="date" value={form.openingDate} onChange={(e) => setField('openingDate', e.target.value)} />
          </div>
        </Card>
      )}

      {isEdit && productId && (
        <CardRoot className="p-4 sm:p-5">
          <ProductUnitsSection productId={productId} companyId={companyId} baseSalePrice={Number(form.salePrice) || 0} basePurchasePrice={Number(form.costPrice) || 0} />
        </CardRoot>
      )}

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.isActive} onChange={(e) => setField('isActive', e.target.checked)} className="rounded" />
        {t('common.enabled')}
      </label>
      <div className="flex items-center gap-2 text-xs text-zinc-500">
        <CheckCircle2 size={14} />
        <span>{t('common.saved')}</span>
      </div>
      <UnsavedChangesDialog blocked={blocked} onLeave={proceed} onStay={reset} />
    </DocumentPageShell>
  );
};




export default ProductEditorPage;
