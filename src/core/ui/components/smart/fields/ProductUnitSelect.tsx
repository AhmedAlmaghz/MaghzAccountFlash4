import React, { useEffect, useMemo, useRef } from 'react';
import { SmartSelect, type SmartSelectItem } from '../SmartSelect';
import { useProductUnits } from '@/modules/inventory/hooks/useInventory';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useFormatters } from '@/core/utils/useFormatters';
import { stockInUnit, defaultSaleUnit, defaultPurchaseUnit } from '@/core/utils/unitConversion';
import type { ProductUnit } from '@/modules/inventory/types';

export interface ProductUnitSelectProps {
  companyId: string;
  productId: string;
  /** Selected product_units row id. */
  value?: string;
  /** Fires with the full unit row (or null on clear). */
  onChange: (unit: ProductUnit | null) => void;
  /** Which price to surface: sale (default) or purchase. */
  mode?: 'sale' | 'purchase';
  /** Available stock in BASE units — shown converted per unit option. */
  stockBaseQty?: number;
  /**
   * Auto-pick the mode default (default-sale/purchase → base → first) when
   * no value is set. Document line editors rely on this so picking a
   * product immediately yields a priced unit without an extra click.
   */
  autoSelectDefault?: boolean;
  /** Fires once per loaded list so parents can cache units for price logic. */
  onUnitsLoad?: (units: ProductUnit[]) => void;
  placeholder?: string;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

/**
 * Unit picker scoped to ONE product's own units (migration 0021).
 * Shows per-unit price + converted availability; the value is the
 * product_units row id whose factor/price snapshot the document line.
 */
export const ProductUnitSelect: React.FC<ProductUnitSelectProps> = ({
  companyId,
  productId,
  value,
  onChange,
  mode = 'sale',
  stockBaseQty,
  placeholder,
  disabled,
  size,
  className,
  autoSelectDefault = true,
  onUnitsLoad,
}) => {
  const { t } = useTranslation();
  const { units, isLoading } = useProductUnits(companyId, productId);
  const { formatCurrency } = useFormatters(companyId);
  const autoFiredRef = useRef<string>('');

  useEffect(() => {
    onUnitsLoad?.(units);
  }, [units, onUnitsLoad]);

  // Auto-select the mode default once per product (guarded by ref so the
  // parent's state update doesn't re-fire for the same product).
  useEffect(() => {
    if (!autoSelectDefault || value || isLoading || units.length === 0 || disabled || !productId) return;
    if (autoFiredRef.current === productId) return;
    autoFiredRef.current = productId;
    const def = mode === 'purchase' ? defaultPurchaseUnit(units) : defaultSaleUnit(units);
    if (def) onChange(def);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [units, isLoading, value, productId]);

  const baseUnitName = useMemo(
    () => units.find((u) => u.isBase)?.unitName ?? '',
    [units],
  );

  const options = useMemo<SmartSelectItem[]>(() => {
    return units.map((u) => {
      const price = mode === 'purchase' ? u.purchasePrice : u.salePrice;
      const meta: Array<{ label: string; value: string }> = [
        { label: t('select.productUnit.price'), value: formatCurrency(price) },
      ];
      if (!u.isBase && baseUnitName) {
        meta.push({ label: t('select.productUnit.equals'), value: `${u.factor} ${baseUnitName}` });
      }
      if (stockBaseQty !== undefined) {
        meta.push({
          label: t('select.productUnit.available'),
          value: `${stockInUnit(stockBaseQty, u.factor)}`,
        });
      }
      if (u.isBase) {
        meta.push({ label: '', value: t('select.productUnit.base') });
      }
      return {
        id: u.id,
        label: u.unitName || u.unitCode || u.id,
        sublabel: u.barcode ?? undefined,
        meta,
      } as SmartSelectItem;
    });
  }, [units, mode, baseUnitName, stockBaseQty, formatCurrency, t]);

  return (
    <SmartSelect
      value={value}
      onChange={(v) => {
        if (typeof v === 'string') {
          const unit = units.find((u) => u.id === v) ?? null;
          onChange(unit);
        } else {
          onChange(null);
        }
      }}
      options={options}
      isLoading={isLoading}
      placeholder={placeholder ?? t('select.productUnit.placeholder')}
      searchPlaceholder={t('select.productUnit.search')}
      emptyMessage={t('select.productUnit.empty')}
      disabled={disabled || !productId}
      size={size}
      className={className}
      clearable={false}
    />
  );
};

export default ProductUnitSelect;
