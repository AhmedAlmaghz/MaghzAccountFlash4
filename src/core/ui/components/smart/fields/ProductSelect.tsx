import React, { useMemo } from 'react';
import { SmartSelect, type SmartSelectItem } from '../SmartSelect';
import { useProducts } from '@/modules/inventory/hooks/useInventory';
import { useProductTypes } from '@/core/hooks/useSettings';
import { filterProductsByModule, type ProductModule } from '@/core/utils/productTypeFilter';
import { useFormatters } from '@/core/utils/useFormatters';
import { useAppStore } from '@/core/store';
import { useTranslation } from '@/core/i18n/useTranslation';
import type { Product } from '@/modules/inventory/types';

export interface ProductSelectProps {
  companyId: string;
  value?: string | string[];
  onChange: (value: string | string[] | null) => void;
  /**
   * Optional callback invoked with the full Product object whenever the user
   * picks a product. Use this to populate derived fields such as unit price,
   * cost, unit, or barcode without having to look it up again.
   */
  onProductChange?: (product: Product) => void;
  placeholder?: string;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  multiple?: boolean;
  showPrice?: boolean;
  showStock?: boolean;
  showBarcode?: boolean;
  module?: ProductModule;
  categoryId?: string;
  /**
   * Manufacturing semantic filter on the product TYPE:
   *  - 'finished': only products whose type usage is finished/complete
   *    (منتج نهائي / تام الإنتاج)
   *  - 'raw': only products whose type usage is raw material
   *    (مواد أولية / مواد خام)
   * Products without a type are excluded when this filter is active.
   */
  usage?: 'finished' | 'raw';
}

export const ProductSelect: React.FC<ProductSelectProps> = ({
  companyId,
  value,
  onChange,
  onProductChange,
  placeholder,
  disabled,
  size,
  className,
  multiple = false,
  showPrice = true,
  showStock = false,
  showBarcode = true,
  module,
  categoryId,
  usage,
}) => {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder ?? t('select.product.placeholder');
  const { products, isLoading } = useProducts(companyId);
  const { types: productTypes } = useProductTypes(companyId);
  const { activeCompany } = useAppStore();
  const { formatCurrency } = useFormatters(activeCompany?.id || '');

  const options = useMemo<SmartSelectItem[]>(() => {
    let filtered = products;
    if (module) {
      filtered = filterProductsByModule(filtered, productTypes, module);
    }
    if (usage) {
      const typeIds = new Set(
        productTypes.filter((tt) => tt.usage === usage).map((tt) => tt.id)
      );
      filtered = filtered.filter((p) => p.productTypeId != null && typeIds.has(p.productTypeId));
    }
    if (categoryId) {
      filtered = filtered.filter(
        (p) => p.categoryId === categoryId || p.categoryIds?.includes(categoryId)
      );
    }
    return filtered.map((p) => {
      const type = productTypes.find((tt) => tt.id === p.productTypeId);
      const typeLabel = type ? ` • ${type.nameAr}` : '';
      const meta: Array<{ label: string; value: string }> = [];
      if (showPrice) {
        meta.push({ label: t('select.product.price'), value: formatCurrency(p.salePrice) });
      }
      if (showBarcode && p.barcode) {
        meta.push({ label: t('select.product.barcode'), value: p.barcode });
      }
      if (showStock && p.quantity !== undefined) {
        meta.push({ label: t('select.product.stock'), value: String(p.quantity) });
      }
      if (p.unit) {
        meta.push({ label: t('select.product.unit'), value: p.unit });
      }
      return {
        id: p.id,
        label: `${p.nameAr}${typeLabel}`,
        sublabel: showPrice
          ? `${p.code}${p.sku ? ` • ${p.sku}` : ''}`
          : `${p.code}${p.nameEn ? ` • ${p.nameEn}` : ''}`,
        meta,
        disabled: !p.isActive,
      } as SmartSelectItem;
    });
  }, [products, productTypes, showPrice, showStock, showBarcode, module, categoryId, usage, formatCurrency, t]);

  return (
    <SmartSelect
      value={value}
      onChange={(v) => onChange(typeof v === 'string' ? v : multiple ? v : null)}
      onItemSelect={(item) => {
        if (!onProductChange) return;
        const product = products.find((p) => p.id === item.id);
        if (product) onProductChange(product);
      }}
      options={options}
      isLoading={isLoading}
      placeholder={resolvedPlaceholder}
      searchPlaceholder={t('select.product.search')}
      emptyMessage={t('select.product.empty')}
      disabled={disabled}
      size={size}
      className={className}
      multiple={multiple}
      clearable
    />
  );
};

export default ProductSelect;
