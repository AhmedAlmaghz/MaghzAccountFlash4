import { pgTable, uuid, varchar, text, timestamp, numeric } from 'drizzle-orm/pg-core';
import { companies, users } from './core';
import { cashBoxes } from './settings';
import { salesInvoices } from './sales';

// ─── POS Shifts (ورديات الكاشير) ────────────────────────────────────────────
// One open shift per (company, user) — enforced by the partial unique index
// uq_pos_shifts_open_per_user created in migration 0027.
export const posShifts = pgTable('pos_shifts', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  cashBoxId: uuid('cash_box_id').notNull().references(() => cashBoxes.id, { onDelete: 'restrict' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  openingAmount: numeric('opening_amount', { precision: 18, scale: 4 }).notNull().default('0'),
  closingAmount: numeric('closing_amount', { precision: 18, scale: 4 }),
  expectedAmount: numeric('expected_amount', { precision: 18, scale: 4 }),
  difference: numeric('difference', { precision: 18, scale: 4 }),
  status: varchar('status', { length: 20 }).notNull().default('open'),
  openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  notes: text('notes'),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// ─── POS Payments (دفعات فواتير نقطة البيع) ─────────────────────────────────
// One row per payment applied to a POS invoice. Cash rows carry shift_id so
// closeShift computes expected cash = opening + SUM(cash) without scanning
// invoices; credit rows carry the outstanding part moved to Debtors.
export const posPayments = pgTable('pos_payments', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  shiftId: uuid('shift_id').references(() => posShifts.id, { onDelete: 'cascade' }),
  invoiceId: uuid('invoice_id').notNull().references(() => salesInvoices.id, { onDelete: 'cascade' }),
  method: varchar('method', { length: 20 }).notNull().default('cash'),
  amount: numeric('amount', { precision: 18, scale: 4 }).notNull().default('0'),
  cashBoxId: uuid('cash_box_id').references(() => cashBoxes.id, { onDelete: 'restrict' }),
  reference: text('reference'),
  notes: text('notes'),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});
