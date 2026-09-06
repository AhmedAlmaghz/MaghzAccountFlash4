import { describe, it, expect } from 'vitest';
import {
  toBaseQty,
  fromBaseQty,
  stockInUnit,
  suggestUnitPrice,
  buildLineUnitSnapshot,
  defaultSaleUnit,
  defaultPurchaseUnit,
  baseUnit,
  formatQtyWithUnit,
  type UnitOption,
} from './unitConversion';

const piece: UnitOption = {
  id: 'pu-piece', unitId: 'u-piece', unitName: 'حبة', factor: 1,
  salePrice: 1100, purchasePrice: 900, isBase: true,
  isDefaultSale: false, isDefaultPurchase: false,
};
const carton: UnitOption = {
  id: 'pu-carton', unitId: 'u-carton', unitName: 'كرتون', factor: 12,
  salePrice: 12000, purchasePrice: 10000, isBase: false,
  isDefaultSale: true, isDefaultPurchase: true,
};
const units = [piece, carton];

describe('unitConversion', () => {
  it('toBaseQty multiplies by factor (2 cartons × 12 = 24)', () => {
    expect(toBaseQty(2, 12)).toBe(24);
  });

  it('toBaseQty with factor 1 is identity', () => {
    expect(toBaseQty(5, 1)).toBe(5);
  });

  it('fromBaseQty divides by factor (24 base ÷ 12 = 2 cartons)', () => {
    expect(fromBaseQty(24, 12)).toBe(2);
  });

  it('round-trips: fromBase(toBase(q)) === q', () => {
    expect(fromBaseQty(toBaseQty(3, 12), 12)).toBe(3);
  });

  it('zero/negative/NaN factor falls back to 1 (no crash, no Infinity)', () => {
    expect(toBaseQty(5, 0)).toBe(5);
    expect(toBaseQty(5, -3)).toBe(5);
    expect(toBaseQty(5, NaN)).toBe(5);
    expect(fromBaseQty(5, 0)).toBe(5);
  });

  it('NaN quantity becomes 0 (never propagates)', () => {
    expect(toBaseQty(NaN, 12)).toBe(0);
    expect(fromBaseQty(undefined, 12)).toBe(0);
    expect(toBaseQty('abc', 12)).toBe(0);
  });

  it('stockInUnit expresses base stock in the chosen unit (25 ÷ 12)', () => {
    expect(stockInUnit(25, 12)).toBeCloseTo(2.0833, 4);
  });

  it('suggestUnitPrice scales the base price (1100 × 12 = 13200)', () => {
    expect(suggestUnitPrice(1100, 12)).toBe(13200);
  });

  it('buildLineUnitSnapshot returns the full snapshot triple', () => {
    expect(buildLineUnitSnapshot(2, carton)).toEqual({
      unitId: 'pu-carton',
      unitFactor: 12,
      baseQuantity: 24,
    });
  });

  it('buildLineUnitSnapshot without unit keeps legacy semantics', () => {
    expect(buildLineUnitSnapshot(5, null)).toEqual({ unitFactor: 1, baseQuantity: 5 });
    expect(buildLineUnitSnapshot(5, undefined)).toEqual({ unitFactor: 1, baseQuantity: 5 });
  });

  it('defaultSaleUnit prefers is_default_sale, defaultPurchaseUnit prefers is_default_purchase', () => {
    expect(defaultSaleUnit(units)?.id).toBe('pu-carton');
    expect(defaultPurchaseUnit(units)?.id).toBe('pu-carton');
  });

  it('defaults fall back to base then first when no flags set', () => {
    const plain = [piece, { ...carton, isDefaultSale: false, isDefaultPurchase: false }];
    expect(defaultSaleUnit(plain)?.id).toBe('pu-piece');
    expect(defaultPurchaseUnit(plain)?.id).toBe('pu-piece');
    expect(defaultSaleUnit([])).toBeUndefined();
  });

  it('baseUnit finds isBase, falls back to first', () => {
    expect(baseUnit(units)?.id).toBe('pu-piece');
    expect(baseUnit([carton])?.id).toBe('pu-carton');
    expect(baseUnit([])).toBeUndefined();
  });

  it('formatQtyWithUnit shows base equivalent only when units differ', () => {
    expect(formatQtyWithUnit(2, 'كرتون', 24, 'حبة')).toBe('2 كرتون (≈ 24 حبة)');
    expect(formatQtyWithUnit(5, 'حبة', 5, 'حبة')).toBe('5 حبة');
    expect(formatQtyWithUnit(5, 'حبة')).toBe('5 حبة');
  });
});
