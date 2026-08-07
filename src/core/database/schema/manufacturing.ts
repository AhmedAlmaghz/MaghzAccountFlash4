import { pgTable, uuid, varchar, text, timestamp, numeric, boolean, date } from 'drizzle-orm/pg-core';
import { companies } from './core';

// ─── Bills of Materials (BOM) ─────────────────────────────────────────────────
export const boms = pgTable('boms', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  productId: uuid('product_id').notNull(), // finished product
  version: varchar('version', { length: 20 }).default('1.0'),
  isActive: boolean('is_active').notNull().default(true),
  totalCost: numeric('total_cost', { precision: 18, scale: 4 }).default('0'),
  notes: text('notes'),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const bomLines = pgTable('bom_lines', {
  id: uuid('id').defaultRandom().primaryKey(),
  bomId: uuid('bom_id').notNull().references(() => boms.id, { onDelete: 'cascade' }),
  materialId: uuid('material_id').notNull(), // raw material product
  quantity: numeric('quantity', { precision: 18, scale: 4 }).notNull(),
  unitCost: numeric('unit_cost', { precision: 18, scale: 4 }).default('0'),
  totalCost: numeric('total_cost', { precision: 18, scale: 4 }).default('0'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// ─── Work Orders ──────────────────────────────────────────────────────────────
export const workOrders = pgTable('work_orders', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  orderNumber: varchar('order_number', { length: 50 }).notNull(),
  productId: uuid('product_id').notNull(),
  bomId: uuid('bom_id'),
  quantity: numeric('quantity', { precision: 18, scale: 4 }).notNull(),
  producedQuantity: numeric('produced_quantity', { precision: 18, scale: 4 }).default('0'),
  status: varchar('status', { length: 20 }).default('planned'), // planned, in_progress, completed, cancelled
  plannedStartDate: date('planned_start_date'),
  plannedEndDate: date('planned_end_date'),
  actualStartDate: date('actual_start_date'),
  actualEndDate: date('actual_end_date'),
  totalCost: numeric('total_cost', { precision: 18, scale: 4 }).default('0'),
  notes: text('notes'),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// ─── Work Order Consumptions ──────────────────────────────────────────────────
export const workOrderConsumptions = pgTable('work_order_consumptions', {
  id: uuid('id').defaultRandom().primaryKey(),
  workOrderId: uuid('work_order_id').notNull().references(() => workOrders.id, { onDelete: 'cascade' }),
  materialId: uuid('material_id').notNull(),
  plannedQuantity: numeric('planned_quantity', { precision: 18, scale: 4 }).notNull(),
  actualQuantity: numeric('actual_quantity', { precision: 18, scale: 4 }).default('0'),
  unitCost: numeric('unit_cost', { precision: 18, scale: 4 }).default('0'),
  actualUnitCost: numeric('actual_unit_cost', { precision: 18, scale: 4 }).default('0'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});
