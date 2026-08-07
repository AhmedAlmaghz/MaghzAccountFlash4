export interface Supplier {
id: string;
companyId: string;
code?: string;
name: string;
phone?: string;
email?: string;
address?: string;
taxNumber?: string;
balance: number;
isActive: boolean;
createdAt?: string;
updatedAt?: string;
createdBy?: string;
updatedBy?: string;
}

export interface PurchaseInvoice {
  id: string;
  companyId: string;
  invoiceNumber: string;
  supplierId: string;
  supplier?: Supplier;
  purchaseOrderId?: string;
  date: string;
  dueDate?: string;
  subtotal: number;
  discountAmount: number;
  vatAmount: number;
  totalAmount: number;
  paidAmount: number;
  currencyCode?: string;
  exchangeRate?: number;
  baseCurrencyAmount?: number;
  baseCurrencyPaid?: number;
  paymentType?: string;
  cashBoxId?: string;
  bankAccountId?: string;
  status: 'draft' | 'posted' | 'paid' | 'partially_paid' | 'cancelled';
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
  updatedBy?: string;
  lines: PurchaseInvoiceLine[];
}

export interface PurchaseInvoiceLine {
  id?: string;
  invoiceId?: string;
  productId?: string;
  productName?: string;
  productCode?: string;
  barcode?: string;
  sku?: string;
  unit?: string;
  description?: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  vatPercent: number;
  lineTotal: number;
  currencyCode?: string;
  exchangeRate?: number;
  baseCurrencyLineTotal?: number;
}

export interface PurchaseOrder {
id: string;
companyId: string;
orderNumber: string;
supplierId: string;
supplier?: Supplier;
date: string;
expectedDate?: string;
totalAmount: number;
paymentType?: string;
cashBoxId?: string;
bankAccountId?: string;
status: 'draft' | 'sent' | 'partially_received' | 'received' | 'invoiced' | 'cancelled';
notes?: string;
createdAt?: string;
updatedAt?: string;
createdBy?: string;
updatedBy?: string;
lines?: PurchaseOrderLine[];
}

export interface PurchaseOrderLine {
id?: string;
orderId?: string;
productId?: string;
productName?: string;
productCode?: string;
barcode?: string;
sku?: string;
unit?: string;
description?: string;
quantity: number;
unitPrice: number;
lineTotal: number;
receivedQuantity?: number;
}

export interface PurchaseReturn {
id: string;
companyId: string;
returnNumber: string;
invoiceId?: string;
invoiceNumber?: string;
supplierId: string;
supplier?: Supplier;
date: string;
subtotal: number;
vatAmount: number;
totalAmount: number;
paymentType?: string;
cashBoxId?: string;
bankAccountId?: string;
status: 'draft' | 'posted' | 'cancelled';
notes?: string;
reason?: string;
createdAt?: string;
updatedAt?: string;
createdBy?: string;
updatedBy?: string;
lines: PurchaseReturnLine[];
}

export interface PurchaseReturnLine {
id?: string;
returnId?: string;
productId?: string;
productName?: string;
productCode?: string;
barcode?: string;
sku?: string;
unit?: string;
description?: string;
quantity: number;
unitPrice: number;
lineTotal: number;
}

export interface SupplierStatementItem {
id: string;
date: string;
type: 'invoice' | 'payment' | 'return' | 'opening';
documentNumber: string;
description: string;
debit: number;
credit: number;
balance: number;
}

export interface ApAgingBucket {
bucket: string;
amount: number;
count: number;
}
