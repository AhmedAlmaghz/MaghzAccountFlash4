import { pgTable, uuid, varchar, text, timestamp, numeric, boolean, date, integer } from 'drizzle-orm/pg-core';
import { companies } from './core';

// ─── Accounts (Chart of Accounts) ─────────────────────────────────────────────
export const accounts = pgTable('accounts', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  code: varchar('code', { length: 20 }).notNull(),
  nameAr: varchar('name_ar', { length: 255 }).notNull(),
  nameEn: varchar('name_en', { length: 255 }),
  parentId: uuid('parent_id'),
  type: varchar('type', { length: 20 }).notNull(), // asset, liability, equity, revenue, expense
  nature: varchar('nature', { length: 10 }).notNull(), // debit, credit
  isGroup: boolean('is_group').notNull().default(false),
  balance: numeric('balance', { precision: 18, scale: 4 }).notNull().default('0'),
  openingAmount: numeric('opening_amount', { precision: 18, scale: 4 }).notNull().default('0'),
  openingDirection: varchar('opening_direction', { length: 10 }).notNull().default('debit'),
  openingBalancePosted: boolean('opening_balance_posted').notNull().default(false),
  openingDate: date('opening_date'),
  isActive: boolean('is_active').notNull().default(true),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// ─── Transactions ─────────────────────────────────────────────────────────────
export const transactions = pgTable('transactions', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  date: timestamp('date', { withTimezone: true }).notNull(),
  reference: varchar('reference', { length: 100 }),
  description: text('description'),
  totalAmount: numeric('total_amount', { precision: 18, scale: 4 }).notNull().default('0'),
  status: varchar('status', { length: 20 }).notNull().default('draft'), // draft, posted, cancelled
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// ─── Accounting Periods (fiscal lock per year: open/closed) ─────────────────
export const accountingPeriods = pgTable('accounting_periods', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  year: integer('year').notNull(),
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  status: varchar('status', { length: 20 }).notNull().default('open'), // open, closed
  closedAt: timestamp('closed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// ─── Fixed Assets (straight-line + declining-balance register) ──────────────
export const fixedAssets = pgTable('fixed_assets', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  code: varchar('code', { length: 50 }).notNull(),
  nameAr: varchar('name_ar', { length: 200 }).notNull(),
  nameEn: varchar('name_en', { length: 200 }),
  category: varchar('category', { length: 100 }),
  purchaseDate: date('purchase_date').notNull(),
  cost: numeric('cost', { precision: 18, scale: 4 }).notNull().default('0'),
  salvageValue: numeric('salvage_value', { precision: 18, scale: 4 }).notNull().default('0'),
  usefulLifeMonths: integer('useful_life_months').notNull().default(60),
  method: varchar('method', { length: 20 }).notNull().default('straight_line'), // straight_line, declining_balance
  accumulatedDepreciation: numeric('accumulated_depreciation', { precision: 18, scale: 4 }).notNull().default('0'),
  status: varchar('status', { length: 20 }).notNull().default('active'), // active, disposed
  disposedAt: date('disposed_at'),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// ─── Journal Entries (flat design: one row per account × debit/credit tuple) ─
// companyId is denormalized from transactions for fast multi-tenant queries.
export const journalEntries = pgTable('journal_entries', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  transactionId: uuid('transaction_id').notNull().references(() => transactions.id, { onDelete: 'cascade' }),
  accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'restrict' }),
  debit: numeric('debit', { precision: 18, scale: 4 }).notNull().default('0'),
  credit: numeric('credit', { precision: 18, scale: 4 }).notNull().default('0'),
  memo: text('memo'),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});
