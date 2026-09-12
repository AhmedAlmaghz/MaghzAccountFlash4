import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PosCartLine, PosCartTotals } from './types';
import { roundMoney } from '@/core/utils/locale';

/**
 * POS terminal state — cart, held carts and the chosen walk-in/customer.
 * Persisted under 'maghzaccount-pos' so a page refresh never loses an
 * in-progress sale. Company scoping: the store keeps the companyId the cart
 * was built for and drops the cart if the active company changes.
 */

interface HeldCart {
  id: string;
  label: string;
  lines: PosCartLine[];
  customerId: string | null;
  customerName: string | null;
  heldAt: number;
}

interface PosState {
  companyId: string | null;
  customerId: string | null;
  customerName: string | null;
  lines: PosCartLine[];
  heldCarts: HeldCart[];

  // Cart lifecycle
  setCompany: (companyId: string | null) => void;
  setCustomer: (customerId: string | null, customerName: string | null) => void;
  addLine: (line: PosCartLine) => void;
  setQuantity: (productId: string, quantity: number, unitId?: string | null) => void;
  removeLine: (productId: string, unitId?: string | null) => void;
  clearCart: () => void;

  // Held carts (park a sale, serve the next customer, resume later)
  holdCart: (label: string) => void;
  resumeCart: (heldId: string) => void;
  discardHeldCart: (heldId: string) => void;
}

export const usePosStore = create<PosState>()(
  persist(
    (set, get) => ({
      companyId: null,
      customerId: null,
      customerName: null,
      lines: [],
      heldCarts: [],

      setCompany: (companyId) => {
        // Company switch (or logout) invalidates everything stored.
        if (get().companyId !== companyId) {
          set({ companyId, lines: [], customerId: null, customerName: null, heldCarts: [] });
        }
      },

      setCustomer: (customerId, customerName) => set({ customerId, customerName }),

      addLine: (line) => {
        // Key by productId + unitId (same product as carton vs piece are different lines)
        const key = (l: PosCartLine) => `${l.productId}::${l.unitId ?? ''}`;
        const incomingKey = key(line);
        const existing = get().lines.find((l) => key(l) === incomingKey);
        if (existing) {
          set({
            lines: get().lines.map((l) =>
              key(l) === incomingKey ? { ...l, quantity: l.quantity + line.quantity } : l
            ),
          });
        } else {
          set({ lines: [...get().lines, line] });
        }
      },

      setQuantity: (productId, quantity, unitId) => {
        const targetKey = `${productId}::${unitId ?? ''}`;
        const hasUnit = unitId !== undefined;
        if (quantity <= 0) {
          set({
            lines: get().lines.filter((l) => {
              if (hasUnit) return `${l.productId}::${l.unitId ?? ''}` !== targetKey;
              return l.productId !== productId;
            }),
          });
          return;
        }
        set({
          lines: get().lines.map((l) => {
            const k = `${l.productId}::${l.unitId ?? ''}`;
            const match = hasUnit ? k === targetKey : l.productId === productId;
            return match ? { ...l, quantity } : l;
          }),
        });
      },

      removeLine: (productId, unitId) => {
        if (unitId !== undefined) {
          const targetKey = `${productId}::${unitId ?? ''}`;
          set({ lines: get().lines.filter((l) => `${l.productId}::${l.unitId ?? ''}` !== targetKey) });
        } else {
          set({ lines: get().lines.filter((l) => l.productId !== productId) });
        }
      },

      clearCart: () => set({ lines: [], customerId: null, customerName: null }),

      holdCart: (label) => {
        const { lines, customerId, customerName, heldCarts } = get();
        if (lines.length === 0) return;
        set({
          heldCarts: [...heldCarts, {
            id: crypto.randomUUID(),
            label: label || `#${heldCarts.length + 1}`,
            lines: [...lines],
            customerId,
            customerName,
            heldAt: Date.now(),
          }],
          lines: [],
          customerId: null,
          customerName: null,
        });
      },

      resumeCart: (heldId) => {
        const held = get().heldCarts.find((h) => h.id === heldId);
        if (!held) return;
        // A resume replaces whatever is currently in the cart (the cashier
        // explicitly asked for this cart back).
        set({
          lines: [...held.lines],
          customerId: held.customerId,
          customerName: held.customerName ?? null,
          heldCarts: get().heldCarts.filter((h) => h.id !== heldId),
        });
      },

      discardHeldCart: (heldId) => set({ heldCarts: get().heldCarts.filter((h) => h.id !== heldId) }),
    }),
    {
      name: 'maghzaccount-pos',
      partialize: (s) => ({
        companyId: s.companyId,
        customerId: s.customerId,
        customerName: s.customerName,
        lines: s.lines,
        heldCarts: s.heldCarts,
      }),
    }
  )
);

/**
 * Pure cart-total calculator — the SINGLE source of truth for subtotal /
 * discount / VAT / total. Runs the exact InvoicesPage arithmetic:
 * lineDiscount → subtotal → VAT (invoice-level when enabled) → total,
 * rounded at every step through roundMoney.
 */
export function computeCartTotals(
  lines: PosCartLine[],
  opts: { vatRate: number; applyVat: boolean; decimalPlaces: number }
): PosCartTotals {
  const { vatRate, applyVat, decimalPlaces } = opts;
  let subtotal = 0;
  let discountAmount = 0;
  let itemsCount = 0;
  for (const line of lines) {
    const gross = line.unitPrice * line.quantity;
    const lineDiscount = gross * (line.discountPercent / 100);
    const netLine = Math.max(0, gross - lineDiscount);
    subtotal += netLine;
    discountAmount += lineDiscount;
    itemsCount += 1;
  }
  subtotal = roundMoney(subtotal, decimalPlaces);
  discountAmount = roundMoney(discountAmount, decimalPlaces);
  const vatAmount = applyVat ? roundMoney(subtotal * (vatRate / 100), decimalPlaces) : 0;
  const totalAmount = roundMoney(subtotal + vatAmount, decimalPlaces);
  return { subtotal, discountAmount, vatAmount, totalAmount, itemsCount };
}
