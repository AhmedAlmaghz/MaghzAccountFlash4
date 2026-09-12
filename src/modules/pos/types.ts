// ─── POS Module Types (نقاط البيع) ───────────────────────────────────────────

export interface PosShift {
  id: string;
  companyId: string;
  cashBoxId: string;
  cashBoxName?: string;
  userId: string;
  cashierName?: string;
  openingAmount: number;
  closingAmount?: number | null;
  expectedAmount?: number | null;
  difference?: number | null;
  status: 'open' | 'closed';
  openedAt: string;
  closedAt?: string | null;
  notes?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export type PosPaymentMethod = 'cash' | 'credit';

export interface PosPayment {
  id: string;
  companyId: string;
  shiftId?: string | null;
  invoiceId: string;
  method: PosPaymentMethod;
  amount: number;
  cashBoxId?: string | null;
  reference?: string | null;
  notes?: string | null;
  createdAt?: string;
}

/** A product as shown on the POS grid — catalog fields + live stock. */
export interface PosProduct {
  id: string;
  code: string;
  nameAr: string;
  nameEn?: string | null;
  barcode?: string | null;
  sku?: string | null;
  unit: string;
  salePrice: number;
  productTypeId?: string | null;
  productTypeName?: string | null;
  categoryIds?: string[];
  stockQty: number;
}

/** Cart line in the terminal (client-side only until checkout). */
export interface PosCartLine {
  productId: string;
  nameAr: string;
  code: string;
  unit: string;
  unitId?: string | null;
  unitFactor?: number | null;
  /** Quantity in the chosen unit — baseQuantity is derived (qty × factor). */
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  vatPercent: number;
  stockQty: number;
}

/** Totals computed exactly like InvoicesPage (roundMoney at each step). */
export interface PosCartTotals {
  subtotal: number;
  discountAmount: number;
  vatAmount: number;
  totalAmount: number;
  itemsCount: number;
}

/** What the cashier submits at checkout. */
export interface PosCheckoutInput {
  companyId: string;
  shiftId: string;
  customerId: string;
  cashBoxId: string;
  lines: Array<{
    productId: string;
    quantity: number;
    unitPrice: number;
    discountPercent: number;
    vatPercent: number;
    unitId?: string | null;
    unitFactor?: number | null;
    baseQuantity?: number | null;
    lineTotal: number;
  }>;
  subtotal: number;
  discountAmount: number;
  vatAmount: number;
  totalAmount: number;
  /** Cash part collected now (0 = pure credit sale). */
  cashAmount: number;
  /** Credit part moved to customer balance (0 = pure cash sale). */
  creditAmount: number;
  currencyCode?: string;
  notes?: string;
}

export interface PosCheckoutResult {
  success: boolean;
  invoiceId?: string;
  receiptNumber?: string;
  change?: number;
  error?: string;
}

/** Shift totals for the Z-report and the close dialog. */
export interface PosShiftSummary {
  invoicesCount: number;
  grossTotal: number;
  discountAmount: number;
  vatAmount: number;
  netTotal: number;
  cashTotal: number;
  creditTotal: number;
  openingAmount: number;
  expectedAmount: number;
}

/** POS terminal settings (settings table, pos.* keys). */
export interface PosSettings {
  defaultCashBoxId: string | null;
  defaultWalkInCustomerId: string | null;
  receiptFooter: string;
  autoPrint: boolean;
  allowPriceEdit: boolean;
  allowDiscount: boolean;
  allowNegativeStock: boolean;
}

export const DEFAULT_POS_SETTINGS: PosSettings = {
  defaultCashBoxId: null,
  defaultWalkInCustomerId: null,
  receiptFooter: '',
  autoPrint: true,
  allowPriceEdit: false,
  allowDiscount: true,
  allowNegativeStock: false,
};
