import { pgTable, uuid, varchar, text, timestamp, numeric, boolean, date, primaryKey } from 'drizzle-orm/pg-core';
import { companies } from './core';
import { productTypes, units } from './settings';

// ─── Product Categories ───────────────────────────────────────────────────────
export const productCategories = pgTable('product_categories', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  parentId: uuid('parent_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ─── Products ─────────────────────────────────────────────────────────────────
export const products = pgTable('products', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  code: varchar('code', { length: 50 }).notNull(),
  nameAr: varchar('name_ar', { length: 255 }).notNull(),
  nameEn: varchar('name_en', { length: 255 }),
  barcode: varchar('barcode', { length: 100 }),
  sku: varchar('sku', { length: 100 }),
  unit: varchar('unit', { length: 50 }).notNull().default('piece'),
  categoryId: uuid('category_id'),
  productTypeId: uuid('product_type_id').references(() => productTypes.id, { onDelete: 'set null' }),
  costPrice: numeric('cost_price', { precision: 18, scale: 4 }).notNull().default('0'),
  salePrice: numeric('sale_price', { precision: 18, scale: 4 }).notNull().default('0'),
  isActive: boolean('is_active').notNull().default(true),
  image: text('image'),
  minStock: numeric('min_stock', { precision: 18, scale: 4 }),
  maxStock: numeric('max_stock', { precision: 18, scale: 4 }),
  reorderPoint: numeric('reorder_point', { precision: 18, scale: 4 }),
  openingStockQty: numeric('opening_stock_qty', { precision: 18, scale: 4 }).notNull().default('0'),
  openingWarehouseId: uuid('opening_warehouse_id'),
  openingStockPosted: boolean('opening_stock_posted').notNull().default(false),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// ─── Product Units (Multi-unit: per-product units linked to global catalog) ──
// factor = how many BASE units equal 1 of this unit (e.g. carton of 12 → 12).
// Stock is always stored in the base unit; documents snapshot unit_id +
// unit_factor + base_quantity at creation time.
export const productUnits = pgTable('product_units', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  unitId: uuid('unit_id').notNull().references(() => units.id, { onDelete: 'restrict' }),
  factor: numeric('factor', { precision: 18, scale: 6 }).notNull().default('1'),
  salePrice: numeric('sale_price', { precision: 18, scale: 4 }).notNull().default('0'),
  purchasePrice: numeric('purchase_price', { precision: 18, scale: 4 }).notNull().default('0'),
  barcode: varchar('barcode', { length: 100 }),
  isBase: boolean('is_base').notNull().default(false),
  isDefaultSale: boolean('is_default_sale').notNull().default(false),
  isDefaultPurchase: boolean('is_default_purchase').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// ─── Product <-> Categories (Many-to-Many) ────────────────────────────────────
export const productProductCategories = pgTable(
  'product_product_categories',
  {
    productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id').notNull().references(() => productCategories.id, { onDelete: 'cascade' }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.productId, table.categoryId] }),
  })
);

// ─── Warehouses ───────────────────────────────────────────────────────────────
export const warehouses = pgTable('warehouses', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  code: varchar('code', { length: 20 }),
  branchId: uuid('branch_id'),
  isActive: boolean('is_active').notNull().default(true),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ─── Stock (Inventory Quantities) ─────────────────────────────────────────────
export const stock = pgTable('stock', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  productId: uuid('product_id').notNull(),
  warehouseId: uuid('warehouse_id').notNull(),
  quantity: numeric('quantity', { precision: 18, scale: 4 }).notNull().default('0'),
  minStockAlert: numeric('min_stock_alert', { precision: 18, scale: 4 }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// ─── Stock Movements ──────────────────────────────────────────────────────────
export const stockMovements = pgTable('stock_movements', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  productId: uuid('product_id').notNull(),
  warehouseId: uuid('warehouse_id').notNull(),
  type: varchar('type', { length: 20 }).notNull(), // in, out, transfer
  quantity: numeric('quantity', { precision: 18, scale: 4 }).notNull(),
  reference: varchar('reference', { length: 100 }), // invoice_id, transfer_id, etc.
  notes: text('notes'),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ─── Warehouse Transfers ──────────────────────────────────────────────────────
export const warehouseTransfers = pgTable('warehouse_transfers', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  fromWarehouseId: uuid('from_warehouse_id').notNull(),
  toWarehouseId: uuid('to_warehouse_id').notNull(),
  transferNumber: varchar('transfer_number', { length: 50 }),
  date: timestamp('date', { withTimezone: true }).defaultNow(),
  reference: varchar('reference', { length: 100 }),
  status: varchar('status', { length: 20 }).default('pending'), // pending, completed, cancelled
  notes: text('notes'),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const warehouseTransferLines = pgTable('warehouse_transfer_lines', {
  id: uuid('id').defaultRandom().primaryKey(),
  transferId: uuid('transfer_id').notNull().references(() => warehouseTransfers.id, { onDelete: 'cascade' }),
  productId: uuid('product_id').notNull(),
  quantity: numeric('quantity', { precision: 18, scale: 4 }).notNull(),
});

// ─── Stock Adjustments ────────────────────────────────────────────────────────
export const stockAdjustments = pgTable('stock_adjustments', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  adjustmentNumber: varchar('adjustment_number', { length: 50 }),
  date: date('date').notNull(),
  productId: uuid('product_id').notNull(),
  warehouseId: uuid('warehouse_id'),
  systemQty: numeric('system_qty', { precision: 18, scale: 4 }).notNull().default('0'),
  actualQty: numeric('actual_qty', { precision: 18, scale: 4 }).notNull().default('0'),
  difference: numeric('difference', { precision: 18, scale: 4 }).notNull().default('0'),
  unitCost: numeric('unit_cost', { precision: 18, scale: 4 }),
  reason: text('reason'),
  status: varchar('status', { length: 20 }).notNull().default('draft'),
  approvedBy: uuid('approved_by'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  postedAt: timestamp('posted_at', { withTimezone: true }),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});
