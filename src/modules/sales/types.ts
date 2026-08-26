export interface Customer {
  id: string;
  companyId: string;
  code?: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  taxNumber?: string;
  creditLimit?: number;
  balance: number;
  /** Opening receivable balance (customer owes us) - posted via Opening Balance Equity. */
  openingBalance?: number;
  openingBalancePosted?: boolean;
  isActive: boolean;
  createdBy?: string;
  updatedBy?: string;
}

export interface InvoiceAttachment {
  id: string;
  name: string;
  contentType: string;
  size: number;
  dataUrl: string;
}
export interface CustomerStatementRow {
  date: string;
  documentType: string;
  documentNumber: string;
  debit: number;
  credit: number;
  balance: number;
  notes?: string;
}

export interface SalesInvoice {
  id: string;
  companyId: string;
  invoiceNumber: string;
  customerId: string;
  customer?: Customer;
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
  status: 'draft' | 'posted' | 'paid' | 'partially_paid' | 'cancelled';
  notes?: string;
  attachments?: InvoiceAttachment[];
  lines: SalesInvoiceLine[];
  createdBy?: string;
  updatedBy?: string;
}

export interface SalesInvoiceLine {
  id?: string;
  invoiceId?: string;
  productId: string;
  productName?: string;
  productCode?: string;
  barcode?: string;
  sku?: string;
  unit?: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  vatPercent: number;
  lineTotal: number;
  currencyCode?: string;
  exchangeRate?: number;
  baseCurrencyLineTotal?: number;
}

export interface Quotation {
  id: string;
  companyId: string;
  quotationNumber: string;
  customerId: string;
  customer?: Customer;
  date: string;
  expiryDate?: string;
  totalAmount: number;
  paymentType?: string;
  cashBoxId?: string;
  status: 'draft' | 'sent' | 'accepted' | 'rejected' | 'converted';
  notes?: string;
  lines: QuotationLine[];
  createdBy?: string;
  updatedBy?: string;
}

export interface QuotationLine {
  id?: string;
  quotationId?: string;
  productId: string;
  productName?: string;
  productCode?: string;
  barcode?: string;
  sku?: string;
  unit?: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  lineTotal: number;
}

export interface SalesReturn {
  id: string;
  companyId: string;
  returnNumber: string;
  invoiceId: string;
  invoice?: SalesInvoice;
  customerId: string;
  customer?: Customer;
  date: string;
  subtotal: number;
  vatAmount: number;
  totalAmount: number;
  reason: string;
  paymentType?: string;
  cashBoxId?: string;
  status: 'draft' | 'posted' | 'cancelled';
  notes?: string;
  lines: SalesReturnLine[];
  createdBy?: string;
  updatedBy?: string;
}

export interface SalesReturnLine {
  id?: string;
  returnId?: string;
  productId: string;
  productName?: string;
  productCode?: string;
  barcode?: string;
  sku?: string;
  unit?: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface ArAgingBucket {
  period: string;
  amount: number;
  count: number;
}

export interface CustomerArAging {
  customerId: string;
  customerName: string;
  totalDue: number;
  buckets: ArAgingBucket[];
}
