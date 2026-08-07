import type { Product } from '@/modules/inventory/types';
import type { ProductType } from '@/core/types';

export type ProductModule = 'sales' | 'purchases' | 'inventory' | 'manufacturing';

const MODULE_TO_FLAG: Record<ProductModule, keyof Pick<ProductType, 'appearsInSales' | 'appearsInPurchases' | 'appearsInInventory' | 'appearsInManufacturing'>> = {
  sales: 'appearsInSales',
  purchases: 'appearsInPurchases',
  inventory: 'appearsInInventory',
  manufacturing: 'appearsInManufacturing',
};

export function isProductAvailableInModule(
  _product: Product,
  productType: ProductType | undefined | null,
  module: ProductModule
): boolean {
  if (!productType) return true;
  if (!productType.isActive) return false;
  const flag = MODULE_TO_FLAG[module];
  return Boolean(productType[flag]);
}

export function filterProductsByModule(
  products: Product[],
  productTypes: ProductType[],
  module: ProductModule
): Product[] {
  if (productTypes.length === 0) return products;
  const typeMap = new Map(productTypes.map((t) => [t.id, t]));
  return products.filter((p) => {
    if (!p.productTypeId) return true;
    return isProductAvailableInModule(p, typeMap.get(p.productTypeId), module);
  });
}

export function shouldTrackStock(productType: ProductType | undefined | null): boolean {
  if (!productType) return true;
  return Boolean(productType.hasStockTracking);
}

export function shouldHaveBOM(productType: ProductType | undefined | null): boolean {
  if (!productType) return false;
  return Boolean(productType.hasBOM);
}

export function getDefaultAccountsFromType(productType: ProductType | undefined | null) {
  if (!productType) {
    return { sales: null, cogs: null, inventory: null };
  }
  return {
    sales: productType.defaultSalesAccountId ?? null,
    cogs: productType.defaultCOGSAccountId ?? null,
    inventory: productType.defaultInventoryAccountId ?? null,
  };
}
