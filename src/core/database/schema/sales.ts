import { pgTable, uuid, varchar, text, timestamp, numeric, boolean, date, jsonb } from 'drizzle-orm/pg-core';
import { companies } from './core';
import { products } from './inventory';

// ─── Customers ────────────────────────────────────────────────────────────────
export const customers = pgTable('customers', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  code: varchar('code', { length: 50 }),
  name: varchar('name', { length: 255 }).notNull(),
  phone: varchar('phone', { length: 50 }),
  email: varchar('email', { length: 255 }),
  address: text('address'),
  taxNumber: varchar('tax_number', { length: 50 }),
  creditLimit: numeric('credit_limit', { precision: 18, scale: 4 }),
  balance: numeric('balance', { precision: 18, scale: 4 }).notNull().default('0'),
  openingBalance: numeric('opening_balance', { precision: 18, scale: 4 }).notNull().default('0'),
  openingBalancePosted: boolean('opening_balance_posted').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// ─── Sales Invoices ───────────────────────────────────────────────────────────
export const salesInvoices = pgTable('sales_invoices', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  invoiceNumber: varchar('invoice_number', { length: 50 }).notNull(),
  customerId: uuid('customer_id').notNull(),
  date: date('date').notNull(),
  dueDate: date('due_date'),
  subtotal: numeric('subtotal', { precision: 18, scale: 4 }).notNull().default('0'),
  discountAmount: numeric('discount_amount', { precision: 18, scale: 4 }).default('0'),
  vatAmount: numeric('vat_amount', { precision: 18, scale: 4 }).default('0'),
  totalAmount: numeric('total_amount', { precision: 18, scale: 4 }).notNull().default('0'),
  paidAmount: numeric('paid_amount', { precision: 18, scale: 4 }).default('0'),
  currencyCode: varchar('currency_code', { length: 3 }).notNull().default('YER'),
  exchangeRate: numeric('exchange_rate', { precision: 18, scale: 6 }).notNull().default('1'),
  baseCurrencyAmount: numeric('base_currency_amount', { precision: 18, scale: 4 }).notNull().default('0'),
  baseCurrencyPaid: numeric('base_currency_paid', { precision: 18, scale: 4 }).notNull().default('0'),
  status: varchar('status', { length: 20 }).default('draft'),
  paymentType: varchar('payment_type', { length: 10 }).notNull().default('credit'),
  notes: text('notes'),
  attachments: jsonb('attachments').default([]).notNull(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// ─── Sales Invoice Lines ──────────────────────────────────────────────────────
export const salesInvoiceLines = pgTable('sales_invoice_lines', {
  id: uuid('id').defaultRandom().primaryKey(),
  invoiceId: uuid('invoice_id').notNull().references(() => salesInvoices.id, { onDelete: 'cascade' }),
  productId: uuid('product_id').notNull(),
  quantity: numeric('quantity', { precision: 18, scale: 4 }).notNull(),
  unitPrice: numeric('unit_price', { precision: 18, scale: 4 }).notNull(),
  discountPercent: numeric('discount_percent', { precision: 5, scale: 2 }).default('0'),
  vatPercent: numeric('vat_percent', { precision: 5, scale: 2 }).default('15'),
  lineTotal: numeric('line_total', { precision: 18, scale: 4 }).notNull(),
  currencyCode: varchar('currency_code', { length: 3 }).notNull().default('YER'),
  exchangeRate: numeric('exchange_rate', { precision: 18, scale: 6 }).notNull().default('1'),
  baseCurrencyLineTotal: numeric('base_currency_line_total', { precision: 18, scale: 4 }).notNull().default('0'),
});

// ─── Quotations ───────────────────────────────────────────────────────────────
export const quotations = pgTable('quotations', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  quotationNumber: varchar('quotation_number', { length: 50 }).notNull(),
  customerId: uuid('customer_id').notNull(),
  date: date('date').notNull(),
  expiryDate: date('expiry_date'),
  totalAmount: numeric('total_amount', { precision: 18, scale: 4 }).notNull().default('0'),
  status: varchar('status', { length: 20 }).default('draft'),
  paymentType: varchar('payment_type', { length: 10 }).notNull().default('credit'),
  notes: text('notes'),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// ─── Quotation Lines ──────────────────────────────────────────────────────────
export const quotationLines = pgTable('quotation_lines', {
  id: uuid('id').defaultRandom().primaryKey(),
  quotationId: uuid('quotation_id').notNull().references(() => quotations.id, { onDelete: 'cascade' }),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'restrict' }),
  quantity: numeric('quantity', { precision: 18, scale: 4 }).notNull(),
  unitPrice: numeric('unit_price', { precision: 18, scale: 4 }).notNull(),
  discountPercent: numeric('discount_percent', { precision: 5, scale: 2 }).default('0'),
  lineTotal: numeric('line_total', { precision: 18, scale: 4 }).notNull(),
});

// ─── Sales Returns ────────────────────────────────────────────────────────────
export const salesReturns = pgTable('sales_returns', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  returnNumber: varchar('return_number', { length: 50 }).notNull(),
  invoiceId: uuid('invoice_id'),
  customerId: uuid('customer_id').notNull(),
  date: date('date').notNull(),
  subtotal: numeric('subtotal', { precision: 18, scale: 4 }).notNull().default('0'),
  vatAmount: numeric('vat_amount', { precision: 18, scale: 4 }).default('0'),
  totalAmount: numeric('total_amount', { precision: 18, scale: 4 }).notNull().default('0'),
  reason: text('reason'),
  status: varchar('status', { length: 20 }).default('draft'),
  paymentType: varchar('payment_type', { length: 10 }).notNull().default('credit'),
  notes: text('notes'),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// ─── Sales Return Lines ───────────────────────────────────────────────────────
export const salesReturnLines = pgTable('sales_return_lines', {
  id: uuid('id').defaultRandom().primaryKey(),
  returnId: uuid('return_id').notNull().references(() => salesReturns.id, { onDelete: 'cascade' }),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'restrict' }),
  quantity: numeric('quantity', { precision: 18, scale: 4 }).notNull(),
  unitPrice: numeric('unit_price', { precision: 18, scale: 4 }).notNull(),
  lineTotal: numeric('line_total', { precision: 18, scale: 4 }).notNull(),
});
