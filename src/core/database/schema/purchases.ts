import { pgTable, uuid, varchar, text, timestamp, numeric, boolean, date } from 'drizzle-orm/pg-core';
import { companies } from './core';
import { products } from './inventory';

// ─── Suppliers ────────────────────────────────────────────────────────────────
export const suppliers = pgTable('suppliers', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  code: varchar('code', { length: 50 }),
  name: varchar('name', { length: 255 }).notNull(),
  phone: varchar('phone', { length: 50 }),
  email: varchar('email', { length: 255 }),
  address: text('address'),
  taxNumber: varchar('tax_number', { length: 50 }),
  balance: numeric('balance', { precision: 18, scale: 4 }).notNull().default('0'),
  openingBalance: numeric('opening_balance', { precision: 18, scale: 4 }).notNull().default('0'),
  openingBalancePosted: boolean('opening_balance_posted').notNull().default(false),
  openingDate: date('opening_date'),
  isActive: boolean('is_active').notNull().default(true),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// ─── Purchase Invoices ────────────────────────────────────────────────────────
export const purchaseInvoices = pgTable('purchase_invoices', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  invoiceNumber: varchar('invoice_number', { length: 50 }).notNull(),
  supplierId: uuid('supplier_id').notNull(),
  purchaseOrderId: uuid('purchase_order_id'),
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
  cashBoxId: uuid('cash_box_id'),
  notes: text('notes'),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// ─── Purchase Invoice Lines ───────────────────────────────────────────────────
export const purchaseInvoiceLines = pgTable('purchase_invoice_lines', {
  id: uuid('id').defaultRandom().primaryKey(),
  invoiceId: uuid('invoice_id').notNull().references(() => purchaseInvoices.id, { onDelete: 'cascade' }),
  productId: uuid('product_id'),
  description: text('description'),
  quantity: numeric('quantity', { precision: 18, scale: 4 }).notNull(),
  unitId: uuid('unit_id'),
  unitFactor: numeric('unit_factor', { precision: 18, scale: 6 }).notNull().default('1'),
  baseQuantity: numeric('base_quantity', { precision: 18, scale: 4 }).notNull().default('0'),
  unitPrice: numeric('unit_price', { precision: 18, scale: 4 }).notNull(),
  discountPercent: numeric('discount_percent', { precision: 5, scale: 2 }).notNull().default('0'),
  vatPercent: numeric('vat_percent', { precision: 5, scale: 2 }).notNull().default('0'),
  lineTotal: numeric('line_total', { precision: 18, scale: 4 }).notNull(),
  currencyCode: varchar('currency_code', { length: 3 }).notNull().default('YER'),
  exchangeRate: numeric('exchange_rate', { precision: 18, scale: 6 }).notNull().default('1'),
  baseCurrencyLineTotal: numeric('base_currency_line_total', { precision: 18, scale: 4 }).notNull().default('0'),
});

// ─── Purchase Orders ──────────────────────────────────────────────────────────
export const purchaseOrders = pgTable('purchase_orders', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  orderNumber: varchar('order_number', { length: 50 }).notNull(),
  supplierId: uuid('supplier_id').notNull(),
  date: date('date').notNull(),
  expectedDate: date('expected_date'),
  totalAmount: numeric('total_amount', { precision: 18, scale: 4 }).notNull().default('0'),
  status: varchar('status', { length: 20 }).default('draft'),
  paymentType: varchar('payment_type', { length: 10 }).notNull().default('credit'),
  cashBoxId: uuid('cash_box_id'),
  notes: text('notes'),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const purchaseOrderLines = pgTable('purchase_order_lines', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderId: uuid('order_id').notNull().references(() => purchaseOrders.id, { onDelete: 'cascade' }),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'restrict' }),
  description: text('description'),
  quantity: numeric('quantity', { precision: 18, scale: 4 }).notNull(),
  unitId: uuid('unit_id'),
  unitFactor: numeric('unit_factor', { precision: 18, scale: 6 }).notNull().default('1'),
  baseQuantity: numeric('base_quantity', { precision: 18, scale: 4 }).notNull().default('0'),
  unitPrice: numeric('unit_price', { precision: 18, scale: 4 }).notNull(),
  lineTotal: numeric('line_total', { precision: 18, scale: 4 }).notNull(),
  receivedQuantity: numeric('received_quantity', { precision: 18, scale: 4 }).notNull().default('0'),
});

// ─── Purchase Returns ─────────────────────────────────────────────────────────
export const purchaseReturns = pgTable('purchase_returns', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  returnNumber: varchar('return_number', { length: 50 }).notNull(),
  invoiceId: uuid('invoice_id'),
  supplierId: uuid('supplier_id').notNull(),
  date: date('date').notNull(),
  subtotal: numeric('subtotal', { precision: 18, scale: 4 }).notNull().default('0'),
  vatAmount: numeric('vat_amount', { precision: 18, scale: 4 }).default('0'),
  totalAmount: numeric('total_amount', { precision: 18, scale: 4 }).notNull().default('0'),
  reason: text('reason'),
  status: varchar('status', { length: 20 }).default('draft'),
  paymentType: varchar('payment_type', { length: 10 }).notNull().default('credit'),
  cashBoxId: uuid('cash_box_id'),
  notes: text('notes'),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const purchaseReturnLines = pgTable('purchase_return_lines', {
  id: uuid('id').defaultRandom().primaryKey(),
  returnId: uuid('return_id').notNull().references(() => purchaseReturns.id, { onDelete: 'cascade' }),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'restrict' }),
  description: text('description'),
  quantity: numeric('quantity', { precision: 18, scale: 4 }).notNull(),
  unitId: uuid('unit_id'),
  unitFactor: numeric('unit_factor', { precision: 18, scale: 6 }).notNull().default('1'),
  baseQuantity: numeric('base_quantity', { precision: 18, scale: 4 }).notNull().default('0'),
  unitPrice: numeric('unit_price', { precision: 18, scale: 4 }).notNull(),
  lineTotal: numeric('line_total', { precision: 18, scale: 4 }).notNull(),
});
