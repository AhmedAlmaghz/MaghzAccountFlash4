import { describe, it, expect } from 'vitest';
import {
  isProductAvailableInModule,
  filterProductsByModule,
  shouldTrackStock,
  shouldHaveBOM,
  getDefaultAccountsFromType,
} from './productTypeFilter';
import type { Product } from '@/modules/inventory/types';
import type { ProductType } from '../types';

const makeProduct = (overrides: Partial<Product> = {}): Product => ({
  id: 'p-1',
  companyId: 'c-1',
  code: 'P001',
  nameAr: 'منتج',
  unit: 'piece',
  costPrice: 0,
  salePrice: 0,
  isActive: true,
  productTypeId: 'pt-1',
  ...overrides,
});

const makeType = (overrides: Partial<ProductType> = {}): ProductType => ({
  id: 'pt-1',
  companyId: 'c-1',
  nameAr: 'نوع',
  appearsInSales: true,
  appearsInPurchases: true,
  appearsInInventory: true,
  appearsInManufacturing: false,
  hasStockTracking: true,
  hasBOM: false,
  isActive: true,
  ...overrides,
});

describe('productTypeFilter', () => {
  describe('isProductAvailableInModule', () => {
    it('returns true when no product type assigned', () => {
      const p = makeProduct({ productTypeId: undefined });
      expect(isProductAvailableInModule(p, undefined, 'sales')).toBe(true);
    });

    it('returns false when product type is inactive', () => {
      const p = makeProduct();
      const t = makeType({ isActive: false });
      expect(isProductAvailableInModule(p, t, 'sales')).toBe(false);
    });

    it('returns true when appearsInSales=true and module=sales', () => {
      const p = makeProduct();
      const t = makeType({ appearsInSales: true });
      expect(isProductAvailableInModule(p, t, 'sales')).toBe(true);
    });

    it('returns false when appearsInSales=false and module=sales', () => {
      const p = makeProduct();
      const t = makeType({ appearsInSales: false });
      expect(isProductAvailableInModule(p, t, 'sales')).toBe(false);
    });

    it('handles all four module flags independently', () => {
      const p = makeProduct();
      const t = makeType({
        appearsInSales: true,
        appearsInPurchases: true,
        appearsInInventory: false,
        appearsInManufacturing: true,
      });
      expect(isProductAvailableInModule(p, t, 'sales')).toBe(true);
      expect(isProductAvailableInModule(p, t, 'purchases')).toBe(true);
      expect(isProductAvailableInModule(p, t, 'inventory')).toBe(false);
      expect(isProductAvailableInModule(p, t, 'manufacturing')).toBe(true);
    });
  });

  describe('filterProductsByModule', () => {
    it('returns all products when no types provided', () => {
      const products = [makeProduct({ id: 'p-1' }), makeProduct({ id: 'p-2' })];
      expect(filterProductsByModule(products, [], 'sales')).toEqual(products);
    });

    it('keeps products without productTypeId regardless of module', () => {
      const products = [makeProduct({ id: 'p-1', productTypeId: undefined })];
      expect(filterProductsByModule(products, [], 'sales')).toHaveLength(1);
    });

    it('filters out products whose type does not appear in module', () => {
      const products = [
        makeProduct({ id: 'p-1' }),
        makeProduct({ id: 'p-2', productTypeId: 'pt-2' }),
      ];
      const types = [
        makeType({ id: 'pt-1', appearsInSales: true }),
        makeType({ id: 'pt-2', appearsInSales: false }),
      ];
      const filtered = filterProductsByModule(products, types, 'sales');
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('p-1');
    });
  });

  describe('shouldTrackStock', () => {
    it('defaults to true when no product type', () => {
      expect(shouldTrackStock(null)).toBe(true);
      expect(shouldTrackStock(undefined)).toBe(true);
    });

    it('returns type.hasStockTracking when type provided', () => {
      expect(shouldTrackStock(makeType({ hasStockTracking: false }))).toBe(false);
      expect(shouldTrackStock(makeType({ hasStockTracking: true }))).toBe(true);
    });
  });

  describe('shouldHaveBOM', () => {
    it('defaults to false when no product type', () => {
      expect(shouldHaveBOM(null)).toBe(false);
    });

    it('returns type.hasBOM when type provided', () => {
      expect(shouldHaveBOM(makeType({ hasBOM: true }))).toBe(true);
    });
  });

  describe('getDefaultAccountsFromType', () => {
    it('returns nulls when no product type', () => {
      expect(getDefaultAccountsFromType(null)).toEqual({ sales: null, cogs: null, inventory: null });
    });

    it('extracts default account IDs from type', () => {
      const t = makeType({
        defaultSalesAccountId: 'acc-1',
        defaultCOGSAccountId: 'acc-2',
        defaultInventoryAccountId: 'acc-3',
      });
      expect(getDefaultAccountsFromType(t)).toEqual({ sales: 'acc-1', cogs: 'acc-2', inventory: 'acc-3' });
    });
  });
});
