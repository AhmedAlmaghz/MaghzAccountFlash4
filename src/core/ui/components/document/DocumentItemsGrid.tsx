import React, { useCallback } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { ProductSelect, ProductUnitSelect } from '@/core/ui/components/smart';
import { Input } from '../Input';
import { Button } from '../Button';
import { useTranslation } from '@/core/i18n/useTranslation';
import type { Product, ProductUnit } from '@/modules/inventory/types';

export interface DocumentLine {
  productId: string;
  productName: string;
  productCode?: string;
  unitId?: string;
  unitFactor?: number;
  baseQuantity?: number;
  unitName?: string;
  quantity: number;
  unitPrice: number;
}

export interface DocumentItemsGridProps {
  companyId: string;
  lines: DocumentLine[];
  onChange: (lines: DocumentLine[]) => void;
  priceType?: 'sale' | 'cost';
  showUnit?: boolean;
  disabled?: boolean;
}

export const DocumentItemsGrid: React.FC<DocumentItemsGridProps> = ({
  companyId,
  lines,
  onChange,
  priceType = 'sale',
  showUnit = true,
  disabled = false,
}) => {
  const { t } = useTranslation();

  const updateLine = useCallback(
    (index: number, patch: Partial<DocumentLine>) => {
      if (disabled) return;
      const next = lines.map((l, i) => (i === index ? { ...l, ...patch } : l));
      onChange(next);
    },
    [disabled, lines, onChange]
  );

  const removeLine = useCallback(
    (index: number) => {
      if (disabled) return;
      onChange(lines.filter((_, i) => i !== index));
    },
    [disabled, lines, onChange]
  );

  const addLine = useCallback(() => {
    if (disabled) return;
    onChange([
      ...lines,
      {
        productId: '',
        productName: '',
        quantity: 1,
        unitPrice: 0,
        unitFactor: 1,
      },
    ]);
  }, [disabled, lines, onChange]);

  const handleProductChange = useCallback(
    (index: number, product: Product | null) => {
      if (!product) {
        updateLine(index, { productId: '', productName: '' });
        return;
      }
      const current = lines[index];
      const price = current.unitPrice > 0 ? current.unitPrice : priceType === 'sale' ? product.salePrice ?? 0 : product.costPrice ?? 0;
      updateLine(index, {
        productId: product.id,
        productName: product.nameAr,
        productCode: product.code,
        unitPrice: price,
      });
    },
    [lines, priceType, updateLine]
  );

  const handleUnitsLoad = useCallback(
    (index: number, units: ProductUnit[]) => {
      if (disabled) return;
      const line = lines[index];
      if (!line || line.unitId || units.length === 0) return;
      const def = units.find((u) => (priceType === 'sale' ? u.isDefaultSale : u.isDefaultPurchase)) ?? units.find((u) => u.isBase) ?? units[0];
      if (!def) return;
      updateLine(index, {
        unitId: def.id,
        unitFactor: def.factor || 1,
        unitName: def.unitName ?? def.unitCode,
        baseQuantity: (def.factor || 1) * (line.quantity || 1),
      });
    },
    [disabled, lines, priceType, updateLine]
  );

  // Keyboard flow: Enter inside a line moves to the NEXT line's product
  // field (like a spreadsheet) instead of submitting the whole form.
  const focusNextProduct = useCallback(
    (index: number) => {
      const next = index + 1;
      if (next >= lines.length) {
        // No next row — create one and focus it on the next tick.
        addLine();
        window.setTimeout(() => {
          document.querySelector<HTMLElement>(`[data-line-product="${next}"]`)?.focus();
        }, 0);
        return;
      }
      document.querySelector<HTMLElement>(`[data-line-product="${next}"]`)?.focus();
    },
    [lines.length, addLine]
  );

  const onRowKeyDown = useCallback(
    (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      focusNextProduct(index);
    },
    [focusNextProduct]
  );

  // A fixed 12-column track keeps every input a comfortable, EQUAL width and
  // makes the fields fill the whole container — no more cramped qty/price
  // cells. The two numeric entry fields (quantity, unit price) get the widest
  // tracks because they are typed on every row; the computed total is display
  // only. On phones the grid collapses to stacked, full-width fields.
  const gridCols = 'md:grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.6fr)_minmax(0,1fr)]';

  return (
    <div className="space-y-2">
      <div className={`hidden md:grid ${gridCols} gap-3 text-xs font-semibold text-zinc-500 dark:text-zinc-400 px-2 uppercase tracking-wide`}>
        <div>{t('inventory.products.nameAr')}</div>
        {showUnit && <div>{t('common.unit')}</div>}
        <div className="text-center">{t('common.quantity')}</div>
        <div>{t('common.unitPrice')}</div>
        <div className="text-end">{t('common.total')}</div>
      </div>

      <div className="space-y-2 md:space-y-1">
        {lines.map((line, index) => {
          const lineTotal = Math.max(0, line.unitPrice * line.quantity);
          return (
            <div
              key={index}
              className={`rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3 md:p-2 md:grid ${gridCols} gap-3 md:gap-2 md:items-center md:hover:border-primary-300 transition`}
            >
              <div className="flex items-start gap-2 min-w-0">
                <span className="hidden md:inline-flex items-center justify-center w-6 h-9 shrink-0 text-xs font-semibold text-zinc-400 tabular-nums">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <ProductSelect
                    companyId={companyId}
                    value={line.productId || undefined}
                    onChange={() => { /* handled by onProductChange */ }}
                    onProductChange={(p) => handleProductChange(index, p)}
                    showStock
                    showBarcode
                    placeholder={t('inventory.products.nameAr')}
                    selectedLabel={line.productName || undefined}
                    selectedSublabel={line.productCode}
                    triggerProps={{ 'data-line-product': String(index) }}
                  />
                </div>
              </div>

              {showUnit && (
                <div className="mt-2 md:mt-0 min-w-0">
                  <ProductUnitSelect
                    companyId={companyId}
                    productId={line.productId || ''}
                    value={line.unitId}
                    onChange={(u) => updateLine(index, { unitId: u?.id, unitFactor: u?.factor ?? 1, unitName: u?.unitName ?? u?.unitCode, baseQuantity: u ? u.factor * line.quantity : line.baseQuantity })}
                    onUnitsLoad={(units) => handleUnitsLoad(index, units)}
                    placeholder={t('common.unit')}
                  />
                </div>
              )}

              <div className="mt-2 md:mt-0 min-w-0">
                <Input
                  type="number"
                  min={0}
                  step="any"
                  inputMode="decimal"
                  value={String(line.quantity)}
                  onChange={(e) => updateLine(index, {
                    quantity: Number(e.target.value) || 0,
                    baseQuantity: (Number(e.target.value) || 0) * (line.unitFactor || 1),
                  })}
                  onKeyDown={(e) => onRowKeyDown(index, e)}
                  size="lg"
                  className="text-center text-base font-semibold tabular-nums"
                  aria-label={t('common.quantity')}
                />
              </div>

              <div className="mt-2 md:mt-0 min-w-0">
                <Input
                  type="number"
                  min={0}
                  step="any"
                  inputMode="decimal"
                  value={String(line.unitPrice)}
                  onChange={(e) => updateLine(index, { unitPrice: Number(e.target.value) || 0 })}
                  onKeyDown={(e) => onRowKeyDown(index, e)}
                  size="lg"
                  className="text-end text-base font-semibold tabular-nums"
                  aria-label={t('common.unitPrice')}
                />
              </div>

              <div className="mt-2 md:mt-0 min-w-0 flex items-center justify-between md:justify-end gap-2">
                <span className="md:hidden text-xs text-zinc-500 font-semibold tabular-nums">{lineTotal.toFixed(2)}</span>
                <span className="hidden md:block text-sm font-semibold tabular-nums">{lineTotal.toFixed(2)}</span>
                <button
                  type="button"
                  onClick={() => removeLine(index)}
                  disabled={disabled}
                  aria-label={t('common.delete')}
                  className="p-2 rounded-lg text-zinc-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/30 transition min-h-11 min-w-11 flex items-center justify-center"
                >
                  <Trash2 size={16} />
                </button>
              </div>

              {showUnit && line.unitFactor && line.unitFactor !== 1 && (
                <div className="md:col-span-full text-xs text-zinc-400 px-1">
                  ≈ {(line.quantity * (line.unitFactor || 1)).toFixed(2)} {t('common.baseUnit')}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Button type="button" variant="outline" size="sm" leftIcon={<Plus size={16} />} onClick={addLine} disabled={disabled} block>
        {t('common.addLine')}
      </Button>

      {lines.length === 0 && (
        <p className="text-center text-sm text-zinc-400 py-6">{t('common.noLines')}</p>
      )}
    </div>
  );
};
