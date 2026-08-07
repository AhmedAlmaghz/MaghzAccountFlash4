import { pgTable, uuid, varchar, text, timestamp, numeric, boolean } from 'drizzle-orm/pg-core';
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
