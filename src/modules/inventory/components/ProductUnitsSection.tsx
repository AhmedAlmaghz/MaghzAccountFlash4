import React, { useMemo, useState, useCallback } from 'react';
import { Plus, Pencil, Trash2, Star, ShoppingCart, ShoppingBag } from 'lucide-react';
import { Button, Badge } from '@/core/ui/components';
import { useProductUnits } from '../hooks/useInventory';
import { useUnits } from '@/core/hooks/useSettings';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useFormatters } from '@/core/utils/useFormatters';
import { useToastStore } from '@/core/store/toastStore';
import { suggestUnitPrice } from '@/core/utils/unitConversion';
import type { ProductUnit } from '../types';

interface ProductUnitsSectionProps {
  companyId: string;
  productId: string;
  baseSalePrice: number;
  basePurchasePrice: number;
}

interface UnitForm {
  unitId: string;
  factor: string;
  salePrice: string;
  purchasePrice: string;
  barcode: string;
  isDefaultSale: boolean;
  isDefaultPurchase: boolean;
}

const emptyForm: UnitForm = {
  unitId: '',
  factor: '',
  salePrice: '',
  purchasePrice: '',
  barcode: '',
  isDefaultSale: false,
  isDefaultPurchase: false,
};

/**
 * Per-product units manager (migration 0021). Lives inside the product
 * modal in edit mode: the base row is auto-created, extra rows (carton,
 * dozen, …) carry their own factor + sale/purchase prices.
 */
export const ProductUnitsSection: React.FC<ProductUnitsSectionProps> = ({
  companyId,
  productId,
  baseSalePrice,
  basePurchasePrice,
}) => {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const { formatCurrency } = useFormatters(companyId);
  const { units, isLoading, create, update, remove } = useProductUnits(companyId, productId);
  const { units: catalog } = useUnits(companyId);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ProductUnit | null>(null);
  const [form, setForm] = useState<UnitForm>(emptyForm);
  const [saving, setSaving] = useState(false);

  const usedUnitIds = useMemo(() => new Set(units.map((u) => u.unitId)), [units]);
  const availableCatalog = useMemo(
    () => catalog.filter((u) => u.isActive && (editing ? u.id === editing.unitId || !usedUnitIds.has(u.id) : !usedUnitIds.has(u.id))),
    [catalog, usedUnitIds, editing],
  );
  const baseUnitName = useMemo(() => units.find((u) => u.isBase)?.unitName ?? '', [units]);

  const openCreate = useCallback(() => {
    setEditing(null);
    setForm(emptyForm);
    setFormOpen(true);
  }, []);

  const openEdit = useCallback((row: ProductUnit) => {
    setEditing(row);
    setForm({
      unitId: row.unitId,
      factor: String(row.factor),
      salePrice: String(row.salePrice),
      purchasePrice: String(row.purchasePrice),
      barcode: row.barcode || '',
      isDefaultSale: row.isDefaultSale,
      isDefaultPurchase: row.isDefaultPurchase,
    });
    setFormOpen(true);
  }, []);

  const handleCatalogChange = useCallback((unitId: string) => {
    setForm((prev) => {
      const next = { ...prev, unitId };
      const factor = Number(next.factor) > 0 ? Number(next.factor) : 1;
      if (next.salePrice === '') next.salePrice = String(suggestUnitPrice(baseSalePrice, factor));
      if (next.purchasePrice === '') next.purchasePrice = String(suggestUnitPrice(basePurchasePrice, factor));
      return next;
    });
  }, [baseSalePrice, basePurchasePrice]);

  const handleFactorChange = useCallback((factorStr: string) => {
    setForm((prev) => {
      const next = { ...prev, factor: factorStr };
      const factor = Number(factorStr) > 0 ? Number(factorStr) : 1;
      // Re-suggest prices from the base card price while the user hasn't
      // typed custom ones yet (same "don't clobber manual entry" rule as
      // invoice price auto-fill).
      if (prev.salePrice === '' || Number(prev.salePrice) === suggestUnitPrice(baseSalePrice, Number(prev.factor) > 0 ? Number(prev.factor) : 1)) {
        next.salePrice = String(suggestUnitPrice(baseSalePrice, factor));
      }
      if (prev.purchasePrice === '' || Number(prev.purchasePrice) === suggestUnitPrice(basePurchasePrice, Number(prev.factor) > 0 ? Number(prev.factor) : 1)) {
        next.purchasePrice = String(suggestUnitPrice(basePurchasePrice, factor));
      }
      return next;
    });
  }, [baseSalePrice, basePurchasePrice]);

  /** Clearing a uniqueness flag (base/default) on sibling rows first. */
  const clearSiblingsFlag = useCallback(async (
    flag: 'isBase' | 'isDefaultSale' | 'isDefaultPurchase',
    exceptId?: string,
  ) => {
    const sib = units.find((u) => u[flag] && u.id !== exceptId);
    if (sib) {
      await update(sib.id, { [flag]: false } as Partial<Omit<ProductUnit, 'id' | 'companyId' | 'productId'>>);
    }
  }, [units, update]);

  const handleSave = useCallback(async () => {
    if (!form.unitId) {
      addToast('error', t('inventory.productUnits.errors.unitRequired'));
      return;
    }
    const factor = Number(form.factor);
    if (!(factor > 0)) {
      addToast('error', t('inventory.productUnits.errors.factorPositive'));
      return;
    }
    setSaving(true);
    try {
      // Uniqueness flags (partial unique indexes) must be cleared on
      // siblings BEFORE the write — otherwise PG raises
      // uq_product_units_default_sale / _purchase (or _base).
      if (editing) {
        if (form.isDefaultSale) await clearSiblingsFlag('isDefaultSale', editing.id);
        if (form.isDefaultPurchase) await clearSiblingsFlag('isDefaultPurchase', editing.id);
        const res = await update(editing.id, {
          unitId: form.unitId,
          factor,
          salePrice: Number(form.salePrice) || 0,
          purchasePrice: Number(form.purchasePrice) || 0,
          barcode: form.barcode.trim() || undefined,
          isDefaultSale: form.isDefaultSale,
          isDefaultPurchase: form.isDefaultPurchase,
        });
        if (res.success) {
          addToast('success', t('inventory.productUnits.updated'));
          setFormOpen(false);
        } else {
          addToast('error', res.error || t('common.error'));
        }
      } else {
        if (form.isDefaultSale) await clearSiblingsFlag('isDefaultSale');
        if (form.isDefaultPurchase) await clearSiblingsFlag('isDefaultPurchase');
        const res = await create({
          unitId: form.unitId,
          factor,
          salePrice: Number(form.salePrice) || 0,
          purchasePrice: Number(form.purchasePrice) || 0,
          barcode: form.barcode.trim() || undefined,
          isBase: false,
          isDefaultSale: form.isDefaultSale,
          isDefaultPurchase: form.isDefaultPurchase,
        });
        if (res.success) {
          addToast('success', t('inventory.productUnits.created'));
          setFormOpen(false);
        } else {
          addToast('error', res.error || t('common.error'));
        }
      }
    } finally {
      setSaving(false);
    }
  }, [form, editing, create, update, clearSiblingsFlag, addToast, t]);

  const handleDelete = useCallback(async (row: ProductUnit) => {
    const res = await remove(row.id);
    if (res.success) {
      addToast('success', t('inventory.productUnits.deleted'));
    } else {
      addToast('error', res.error || t('common.error'));
    }
  }, [remove, addToast, t]);

  const setAsBase = useCallback(async (row: ProductUnit) => {
    await clearSiblingsFlag('isBase', row.id);
    const res = await update(row.id, { factor: 1, isBase: true });
    if (res.success) {
      addToast('success', t('inventory.productUnits.updated'));
    } else {
      addToast('error', res.error || t('common.error'));
    }
  }, [clearSiblingsFlag, update, addToast, t]);

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-bold tracking-wider uppercase text-slate-500">{t('inventory.productUnits.title')}</p>
          <p className="text-xs text-slate-400 mt-0.5">{t('inventory.productUnits.description')}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={openCreate} title={t('inventory.productUnits.add')}>
          <Plus size={14} className="mr-1" />{t('inventory.productUnits.add')}
        </Button>
      </div>

      {isLoading ? (
        <p className="text-xs text-slate-400">{t('settings.common.loading')}</p>
      ) : units.length === 0 ? (
        <p className="text-xs text-slate-400">{t('inventory.productUnits.empty')}</p>
      ) : (
        <div className="space-y-2">
          {units.map((u) => (
            <div key={u.id} className="flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{u.unitName}</span>
                  {u.isBase && <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px]"><Star size={9} className="inline mr-0.5" />{t('inventory.productUnits.base')}</Badge>}
                  {u.isDefaultSale && <Badge className="bg-blue-50 text-blue-700 border-blue-200 text-[10px]"><ShoppingCart size={9} className="inline mr-0.5" />{t('inventory.productUnits.defaultSale')}</Badge>}
                  {u.isDefaultPurchase && <Badge className="bg-amber-50 text-amber-700 border-amber-200 text-[10px]"><ShoppingBag size={9} className="inline mr-0.5" />{t('inventory.productUnits.defaultPurchase')}</Badge>}
                </div>
                <div className="text-xs text-zinc-500 tabular-nums mt-0.5">
                  {u.isBase
                    ? `${t('inventory.productUnits.factor')}: 1`
                    : `1 = ${u.factor} ${baseUnitName}`}
                  {' • '}{t('inventory.productUnits.salePrice')}: {formatCurrency(u.salePrice)}
                  {' • '}{t('inventory.productUnits.purchasePrice')}: {formatCurrency(u.purchasePrice)}
                  {u.barcode ? ` • ${u.barcode}` : ''}
                </div>
              </div>
              {!u.isBase && (
                <button type="button" onClick={() => setAsBase(u)} title={t('inventory.productUnits.setAsBase')} className="p-1.5 rounded-md text-slate-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition">
                  <Star size={14} />
                </button>
              )}
              <button type="button" onClick={() => openEdit(u)} title={t('inventory.productUnits.edit')} aria-label={t('inventory.productUnits.edit')} className="p-1.5 rounded-md text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition">
                <Pencil size={14} />
              </button>
              {units.length > 1 && (
                <button type="button" onClick={() => handleDelete(u)} title={t('settings.common.delete')} aria-label={t('settings.common.delete')} className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition">
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {formOpen && (
        <div className="rounded-lg border border-primary-200 dark:border-primary-800 bg-white dark:bg-slate-900 p-3 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1.5">{t('inventory.productUnits.unit')} <span className="text-rose-500">*</span></label>
              <select
                value={form.unitId}
                onChange={(e) => handleCatalogChange(e.target.value)}
                disabled={!!editing?.isBase}
                aria-label={t('inventory.productUnits.unit')}
                className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm disabled:opacity-60"
              >
                <option value="">{t('select.unit.placeholder')}</option>
                {availableCatalog.map((u) => (
                  <option key={u.id} value={u.id}>{u.nameAr}{u.nameEn ? ` • ${u.nameEn}` : ''}{u.code ? ` (${u.code})` : ''}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1.5">{t('inventory.productUnits.factor')} <span className="text-rose-500">*</span></label>
              <input
                type="number" step="any" min="0" value={form.factor}
                onChange={(e) => handleFactorChange(e.target.value)}
                disabled={!!editing?.isBase}
                placeholder={t('inventory.productUnits.factorHint')}
                aria-label={t('inventory.productUnits.factor')}
                className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm tabular-nums disabled:opacity-60"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1.5">{t('inventory.productUnits.salePrice')}</label>
              <input type="number" step="0.01" min="0" value={form.salePrice} onChange={(e) => setForm((p) => ({ ...p, salePrice: e.target.value }))} aria-label={t('inventory.productUnits.salePrice')} className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm tabular-nums" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1.5">{t('inventory.productUnits.purchasePrice')}</label>
              <input type="number" step="0.01" min="0" value={form.purchasePrice} onChange={(e) => setForm((p) => ({ ...p, purchasePrice: e.target.value }))} aria-label={t('inventory.productUnits.purchasePrice')} className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm tabular-nums" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-500 mb-1.5">{t('inventory.productUnits.barcode')}</label>
              <input type="text" value={form.barcode} onChange={(e) => setForm((p) => ({ ...p, barcode: e.target.value }))} aria-label={t('inventory.productUnits.barcode')} className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-mono" dir="ltr" />
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
              <input type="checkbox" checked={form.isDefaultSale} onChange={(e) => setForm((p) => ({ ...p, isDefaultSale: e.target.checked }))} className="w-4 h-4 rounded border-slate-300 text-primary-600" />
              {t('inventory.productUnits.defaultSale')}
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
              <input type="checkbox" checked={form.isDefaultPurchase} onChange={(e) => setForm((p) => ({ ...p, isDefaultPurchase: e.target.checked }))} className="w-4 h-4 rounded border-slate-300 text-primary-600" />
              {t('inventory.productUnits.defaultPurchase')}
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setFormOpen(false)}>{t('settings.common.cancel')}</Button>
            <Button size="sm" onClick={handleSave} disabled={saving}>{t('settings.common.save')}</Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProductUnitsSection;
