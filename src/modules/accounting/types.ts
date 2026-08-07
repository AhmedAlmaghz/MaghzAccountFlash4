export interface Account {
  id: string;
  companyId: string;
  code: string;
  nameAr: string;
  nameEn?: string;
  parentId?: string;
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  nature: 'debit' | 'credit';
  isGroup: boolean;
  balance: number;
  isActive: boolean;
  children?: Account[];
  createdBy?: string;
  updatedBy?: string;
}

export interface Transaction {
  id: string;
  companyId: string;
  date: string;
  reference?: string;
  description?: string;
  totalAmount: number;
  status: 'draft' | 'posted' | 'cancelled';
  entries: JournalEntry[];
  createdAt?: string;
  createdBy?: string;
  updatedBy?: string;
}

export interface JournalEntry {
  id: string;
  transactionId: string;
  accountId: string;
  account?: Account;
  debit: number;
  credit: number;
  memo?: string;
}

export interface TrialBalanceRow {
  accountId: string;
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
  balance: number;
}

export interface FinancialReport {
  type: 'balance_sheet' | 'profit_loss' | 'cash_flow';
  asOfDate: string;
  lines: FinancialReportLine[];
}

export interface FinancialReportLine {
  accountId: string;
  accountCode: string;
  accountName: string;
  amount: number;
  isGroup: boolean;
  level: number;
}

export interface LedgerRow {
  id: string;
  date: string;
  reference?: string;
  description?: string;
  debit: number;
  credit: number;
  balance: number;
}

export interface ReceiptVoucher {
  id: string;
  companyId: string;
  voucherNumber: string;
  date: string;
  customerId: string;
  customerName: string;
  invoiceId?: string;
  amount: number;
  amountApplied: number;
  currencyCode?: string;
  exchangeRate?: number;
  baseCurrencyAmount?: number;
  baseCurrencyApplied?: number;
  paymentMethod: 'cash' | 'bank' | 'check';
  bankAccountId?: string;
  cashBoxId?: string;
  checkNumber?: string;
  checkDate?: string;
  notes?: string;
  status: 'draft' | 'posted' | 'cancelled';
  createdAt?: string;
  createdBy?: string;
  updatedBy?: string;
}

export interface PaymentVoucher {
  id: string;
  companyId: string;
  voucherNumber: string;
  date: string;
  supplierId?: string;
  supplierName?: string;
  invoiceId?: string;
  expenseAccountId?: string;
  amount: number;
  amountApplied: number;
  currencyCode?: string;
  exchangeRate?: number;
  baseCurrencyAmount?: number;
  baseCurrencyApplied?: number;
  paymentMethod: 'cash' | 'bank' | 'check';
  bankAccountId?: string;
  cashBoxId?: string;
  checkNumber?: string;
  checkDate?: string;
  notes?: string;
  status: 'draft' | 'posted' | 'cancelled';
  createdAt?: string;
  createdBy?: string;
  updatedBy?: string;
}