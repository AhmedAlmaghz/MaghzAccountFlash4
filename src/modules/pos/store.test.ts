import { describe, it, expect, beforeEach } from 'vitest';
import { usePosStore, computeCartTotals } from './store';
import type { PosCartLine } from './types';

const line = (over: Partial<PosCartLine> = {}): PosCartLine => ({
  productId: over.productId ?? 'p1',
  nameAr: over.nameAr ?? 'شاي',
  code: over.code ?? 'P-1',
  unit: over.unit ?? 'علبة',
  quantity: over.quantity ?? 1,
  unitPrice: over.unitPrice ?? 100,
  discountPercent: over.discountPercent ?? 0,
  vatPercent: over.vatPercent ?? 15,
  stockQty: over.stockQty ?? 10,
  ...over,
});

describe('computeCartTotals (single source of truth)', () => {
  it('computes subtotal, VAT and total with rounding', () => {
    const totals = computeCartTotals(
      [line({ quantity: 2, unitPrice: 100 }), line({ productId: 'p2', quantity: 1, unitPrice: 249.999 })],
      { vatRate: 15, applyVat: true, decimalPlaces: 2 }
    );
    // roundMoney(449.999, 2) = 450 — rounding happens at every step
    expect(totals.subtotal).toBe(450);
    expect(totals.discountAmount).toBe(0);
    expect(totals.vatAmount).toBeCloseTo(67.5, 2); // 15% of 450
    expect(totals.totalAmount).toBeCloseTo(517.5, 2);
    expect(totals.itemsCount).toBe(2);
  });

  it('applies line discounts before VAT', () => {
    const totals = computeCartTotals(
      [line({ quantity: 2, unitPrice: 100, discountPercent: 10 })],
      { vatRate: 15, applyVat: true, decimalPlaces: 2 }
    );
    expect(totals.subtotal).toBe(180); // 200 gross − 10%
    expect(totals.discountAmount).toBe(20);
    expect(totals.vatAmount).toBeCloseTo(27, 2); // 15% of 180
    expect(totals.totalAmount).toBeCloseTo(207, 2);
  });

  it('skips VAT when disabled (invoiceShowVat = false)', () => {
    const totals = computeCartTotals(
      [line({ quantity: 1, unitPrice: 100 })],
      { vatRate: 15, applyVat: false, decimalPlaces: 2 }
    );
    expect(totals.vatAmount).toBe(0);
    expect(totals.totalAmount).toBe(100);
  });
});

describe('usePosStore cart lifecycle', () => {
  beforeEach(() => {
    usePosStore.setState({ companyId: 'c1', lines: [], customerId: null, customerName: null, heldCarts: [] });
  });

  it('addLine merges quantities for the same product', () => {
    const { addLine } = usePosStore.getState();
    addLine(line({ productId: 'a', quantity: 1 }));
    addLine(line({ productId: 'a', quantity: 2 }));
    addLine(line({ productId: 'b', quantity: 1 }));
    const lines = usePosStore.getState().lines;
    expect(lines).toHaveLength(2);
    expect(lines.find((l) => l.productId === 'a')?.quantity).toBe(3);
  });

  it('setQuantity removes the line at zero and clamps edits otherwise', () => {
    const { addLine, setQuantity } = usePosStore.getState();
    addLine(line({ productId: 'a', quantity: 2 }));
    setQuantity('a', 0);
    expect(usePosStore.getState().lines).toHaveLength(0);

    addLine(line({ productId: 'b', quantity: 2 }));
    setQuantity('b', 7);
    expect(usePosStore.getState().lines[0].quantity).toBe(7);
  });

  it('holdCart parks the sale and resumeCart restores it', () => {
    const { addLine, setCustomer, holdCart, resumeCart } = usePosStore.getState();
    addLine(line({ productId: 'a', quantity: 1 }));
    setCustomer('cust-1', 'عميل');
    holdCart('سلة 1');

    expect(usePosStore.getState().lines).toHaveLength(0);
    expect(usePosStore.getState().customerId).toBeNull();
    expect(usePosStore.getState().heldCarts).toHaveLength(1);
    expect(usePosStore.getState().heldCarts[0].customerId).toBe('cust-1');

    resumeCart(usePosStore.getState().heldCarts[0].id);
    expect(usePosStore.getState().lines).toHaveLength(1);
    expect(usePosStore.getState().customerId).toBe('cust-1');
    expect(usePosStore.getState().heldCarts).toHaveLength(0);
  });

  it('setCompany drops everything when the active company changes', () => {
    const { addLine, setCompany } = usePosStore.getState();
    addLine(line({ productId: 'a', quantity: 1 }));
    setCompany('c2');
    expect(usePosStore.getState().lines).toHaveLength(0);
    expect(usePosStore.getState().companyId).toBe('c2');
  });

  it('clearCart resets customer too (walk-in default for the next sale)', () => {
    const { addLine, setCustomer, clearCart } = usePosStore.getState();
    addLine(line({ productId: 'a', quantity: 1 }));
    setCustomer('cust-1', 'عميل');
    clearCart();
    expect(usePosStore.getState().lines).toHaveLength(0);
    expect(usePosStore.getState().customerId).toBeNull();
  });
});
