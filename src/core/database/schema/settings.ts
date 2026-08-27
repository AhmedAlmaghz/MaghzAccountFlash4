import { pgTable, uuid, varchar, text, timestamp, numeric, boolean, integer } from 'drizzle-orm/pg-core';
import { companies } from './core';
import { accounts } from './accounting';

// ─── Document Sequences (Auto Numbering) ──────────────────────────────────────
export const documentSequences = pgTable('document_sequences', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  documentType: varchar('document_type', { length: 50 }).notNull(),
  prefix: varchar('prefix', { length: 30 }).notNull().default(''),
  suffix: varchar('suffix', { length: 30 }).notNull().default(''),
  startingNumber: integer('starting_number').notNull().default(1),
  currentNumber: integer('current_number').notNull().default(1),
  incrementStep: integer('increment_step').notNull().default(1),
  paddingLength: integer('padding_length').notNull().default(4),
  yearReset: boolean('year_reset').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// ─── Product Types ────────────────────────────────────────────────────────────
export const productTypes = pgTable('product_types', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  nameAr: varchar('name_ar', { length: 100 }).notNull(),
  nameEn: varchar('name_en', { length: 100 }),
  code: varchar('code', { length: 20 }),
  appearsInSales: boolean('appears_in_sales').notNull().default(true),
  appearsInPurchases: boolean('appears_in_purchases').notNull().default(true),
  appearsInInventory: boolean('appears_in_inventory').notNull().default(true),
  appearsInManufacturing: boolean('appears_in_manufacturing').notNull().default(false),
  hasStockTracking: boolean('has_stock_tracking').notNull().default(true),
  hasBOM: boolean('has_bom').notNull().default(false),
  // Semantic classification for manufacturing pickers:
  // 'finished' (منتج نهائي/تام), 'raw' (مواد أولية/خام), 'other'.
  usage: varchar('usage', { length: 20 }).notNull().default('other'),
  defaultSalesAccountId: uuid('default_sales_account_id').references(() => accounts.id),
  defaultCOGSAccountId: uuid('default_cogs_account_id').references(() => accounts.id),
  defaultInventoryAccountId: uuid('default_inventory_account_id').references(() => accounts.id),
  isActive: boolean('is_active').notNull().default(true),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// ─── Units (UOM) ──────────────────────────────────────────────────────────────
export const units = pgTable('units', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  nameAr: varchar('name_ar', { length: 50 }).notNull(),
  nameEn: varchar('name_en', { length: 50 }),
  code: varchar('code', { length: 20 }),
  conversionFactor: numeric('conversion_factor', { precision: 18, scale: 6 }).notNull().default('1'),
  baseUnitId: uuid('base_unit_id'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ─── Cash Boxes ───────────────────────────────────────────────────────────────
export const cashBoxes = pgTable('cash_boxes', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  code: varchar('code', { length: 20 }),
  accountId: uuid('account_id').references(() => accounts.id),
  branchId: uuid('branch_id'),
  responsibleUserId: uuid('responsible_user_id'),
  isActive: boolean('is_active').notNull().default(true),
  currentBalance: numeric('current_balance', { precision: 18, scale: 4 }).notNull().default('0'),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ─── Cost Centers ─────────────────────────────────────────────────────────────
export const costCenters = pgTable('cost_centers', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  nameAr: varchar('name_ar', { length: 100 }).notNull(),
  nameEn: varchar('name_en', { length: 100 }),
  code: varchar('code', { length: 20 }),
  parentId: uuid('parent_id'),
  type: varchar('type', { length: 20 }).notNull().default('branch'), // branch, department, project, product_line
  budgetAmount: numeric('budget_amount', { precision: 18, scale: 4 }).default('0'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ─── Payroll Components ───────────────────────────────────────────────────────
export const payrollComponents = pgTable('payroll_components', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  nameAr: varchar('name_ar', { length: 100 }).notNull(),
  nameEn: varchar('name_en', { length: 100 }),
  code: varchar('code', { length: 20 }),
  type: varchar('type', { length: 20 }).notNull().default('earning'), // earning, deduction, tax, insurance, net
  calculationMethod: varchar('calculation_method', { length: 50 }).default('fixed'), // fixed, percentage, formula
  defaultAmount: numeric('default_amount', { precision: 18, scale: 4 }).default('0'),
  affectsGrossSalary: boolean('affects_gross_salary').notNull().default(true),
  affectsTax: boolean('affects_tax').notNull().default(false),
  affectsSocialInsurance: boolean('affects_social_insurance').notNull().default(false),
  defaultAccountId: uuid('default_account_id').references(() => accounts.id),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// ─── Default Accounts Configuration ───────────────────────────────────────────
export const defaultAccounts = pgTable('default_accounts', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  functionKey: varchar('function_key', { length: 50 }).notNull(),
  accountId: uuid('account_id').references(() => accounts.id),
  isRequired: boolean('is_required').notNull().default(true),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});
