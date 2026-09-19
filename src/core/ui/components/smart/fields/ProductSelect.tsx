import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { SmartSelect, type SmartSelectItem } from '../SmartSelect';
import { inventoryApi } from '@/modules/inventory/api';
import { useProductTypes } from '@/core/hooks/useSettings';
import { filterProductsByModule, type ProductModule } from '@/core/utils/productTypeFilter';
import { useFormatters } from '@/core/utils/useFormatters';
import { useAppStore } from '@/core/store';
import { useTranslation } from '@/core/i18n/useTranslation';
import { normalizeArabic } from '@/core/utils/normalizeArabic';
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
   * Manufacturing semantic filter based on the product TYPE flags:
   *  - 'finished': type.appearsInManufacturing = true AND type.hasBOM = false
   *    (المنتج النهائي — يظهَر في التصنيع ولا يدعم BOM)
   *  - 'material': type.appearsInManufacturing = true AND type.hasBOM = true
   *    (المواد — تظهر في التصنيع وتدعم BOM)
   * Products without a type are excluded when this filter is active.
   */
  manufacturingRole?: 'finished' | 'material';
}

// Module-level shared cache for product search results — avoids duplicate fetches
// when many ProductSelect instances (invoice lines) mount simultaneously.
const productSelectCache = new Map<string, { data: Product[]; ts: number }>();
const productSelectPending = new Map<string, Promise<{ success: boolean; data?: Product[]; error?: string }>>();
const CACHE_TTL_MS = 30_000;

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
  manufacturingRole,
}) => {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder ?? t('select.product.placeholder');
  const { types: productTypes } = useProductTypes(companyId);
  const { activeCompany } = useAppStore();
  const { formatCurrency } = useFormatters(activeCompany?.id || '');

  const [query, setQuery] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [knownMap, setKnownMap] = useState<Map<string, Product>>(() => new Map());

  // Accumulate known products for onProductChange and selected-value retention
  useEffect(() => {
    if (products.length === 0) return;
    setKnownMap((prev) => {
      const next = new Map(prev);
      for (const p of products) next.set(p.id, p);
      return next;
    });
  }, [products]);

  const fetchProducts = useCallback(async (search: string) => {
    if (!companyId) {
      setProducts([]);
      return;
    }
    const trimmed = search.trim();
    // Cache key normalized via normalizeArabic so أ/إ variations share cache; server still receives raw trimmed for ILIKE.
    const cacheKey = `${companyId}:${normalizeArabic(trimmed)}`;
    const cached = productSelectCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      setProducts(cached.data);
      return;
    }
    if (productSelectPending.has(cacheKey)) {
      setIsLoading(true);
      const res = await productSelectPending.get(cacheKey)!;
      if (res.success && res.data) {
        productSelectCache.set(cacheKey, { data: res.data, ts: Date.now() });
        setProducts(res.data);
      }
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const promise = inventoryApi.getProductsForSelect(companyId, {
      search: trimmed || undefined,
      isActive: true,
      limit: 25,
    });
    productSelectPending.set(cacheKey, promise);
    try {
      const res = await promise;
      if (res.success && res.data) {
        productSelectCache.set(cacheKey, { data: res.data, ts: Date.now() });
        setProducts(res.data);
      } else {
        setProducts([]);
      }
    } finally {
      productSelectPending.delete(cacheKey);
      setIsLoading(false);
    }
  }, [companyId]);

  // Initial load and when company changes
  useEffect(() => {
    fetchProducts(query);
  }, [fetchProducts, query]);

  // Handle search from SmartSelect (debounced 300ms inside SmartSelect)
  const handleSearchChange = useCallback((q: string) => {
    // Normalize via normalizeArabic for consistent Arabic folding, but keep raw for server fallback.
    // Server ILIKE is byte-exact, so we pass raw trimmed; client-side filter below also uses normalizeArabic.
    setQuery(q);
  }, []);

  const options = useMemo<SmartSelectItem[]>(() => {
    let filtered = products;
    if (module) {
      filtered = filterProductsByModule(filtered, productTypes, module);
    }
    if (manufacturingRole) {
      const wantBom = manufacturingRole === 'material';
      const typeIds = new Set(
        productTypes
          .filter((tt) => tt.appearsInManufacturing === true && tt.hasBOM === wantBom)
          .map((tt) => tt.id)
      );
      filtered = filtered.filter((p) => p.productTypeId != null && typeIds.has(p.productTypeId));
    }
    if (categoryId) {
      filtered = filtered.filter(
        (p) => p.categoryId === categoryId || p.categoryIds?.includes(categoryId)
      );
    }
    // Ensure selected value(s) remain visible even if not in current 25 results
    const selectedIds = multiple ? (Array.isArray(value) ? value : []) : value ? [value as string] : [];
    const missingSelected: Product[] = [];
    for (const sid of selectedIds) {
      if (sid && !filtered.some(p => p.id === sid)) {
        const known = knownMap.get(sid);
        if (known) missingSelected.push(known);
      }
    }
    const withSelected = missingSelected.length ? [...missingSelected, ...filtered] : filtered;

    return withSelected.map((p) => {
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
  }, [products, productTypes, showPrice, showStock, showBarcode, module, categoryId, manufacturingRole, formatCurrency, t, value, multiple, knownMap]);

  // Client-side fallback filter with normalizeArabic is handled by SmartSelect when serverSearch=false,
  // but we have already server-filtered. Keep serverSearch=true to avoid double-filtering on 25 items,
  // yet SmartSelect's normalize is still available if needed (we set serverSearch).
  // For small client filters (module/category) we already applied above on 25 items only.

  return (
    <SmartSelect
      value={value}
      onChange={(v) => onChange(typeof v === 'string' ? v : multiple ? v : null)}
      onItemSelect={(item) => {
        if (!onProductChange) return;
        const product = knownMap.get(item.id) ?? products.find((p) => p.id === item.id);
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
      debounceMs={300}
      maxVisibleOptions={50}
      serverSearch
      onSearchChange={handleSearchChange}
    />
  );
};

export default ProductSelect;
