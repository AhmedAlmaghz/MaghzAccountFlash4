import { pgTable, uuid, varchar, text, timestamp, numeric, boolean, date, unique } from 'drizzle-orm/pg-core';

// ─── Core / Companies ─────────────────────────────────────────────────────────
export const companies = pgTable('companies', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  nameEn: varchar('name_en', { length: 255 }),
  currency: varchar('currency', { length: 3 }).notNull().default('YER'),
  taxNumber: varchar('tax_number', { length: 50 }),
  address: text('address'),
  phone: varchar('phone', { length: 50 }),
  email: varchar('email', { length: 255 }),
  logoUrl: text('logo_url'),
  dateFormat: varchar('date_format', { length: 20 }).default('yyyy-MM-dd'),
  decimalPlaces: numeric('decimal_places', { precision: 1, scale: 0 }).default('2'),
  calendar: varchar('calendar', { length: 10 }).default('gregorian'),
  fiscalYearStart: date('fiscal_year_start'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// ─── Auth / Users ─────────────────────────────────────────────────────────────
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').references(() => companies.id, { onDelete: 'cascade' }),
  username: varchar('username', { length: 100 }).notNull(),
  email: varchar('email', { length: 255 }),
  fullName: varchar('full_name', { length: 255 }),
  phone: varchar('phone', { length: 50 }),
  passwordHash: text('password_hash'),
  role: varchar('role', { length: 50 }).notNull().default('accountant'),
  branchId: uuid('branch_id'),
  isActive: boolean('is_active').notNull().default(true),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const roles = pgTable('roles', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').references(() => companies.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  description: varchar('description', { length: 255 }),
  permissions: text('permissions'), // JSON array of permission strings
  isSystem: boolean('is_system').default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// ─── Settings ─────────────────────────────────────────────────────────────────
export const settings = pgTable('settings', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').references(() => companies.id, { onDelete: 'cascade' }),
  key: varchar('key', { length: 100 }).notNull(),
  value: text('value'),
  category: varchar('category', { length: 50 }).notNull().default('general'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  companyKeyUnique: unique('settings_company_id_key_unique').on(table.companyId, table.key),
}));

export const branches = pgTable('branches', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').references(() => companies.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  code: varchar('code', { length: 20 }),
  address: text('address'),
  city: varchar('city', { length: 100 }),
  phone: varchar('phone', { length: 50 }),
  isActive: boolean('is_active').notNull().default(true),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const currencies = pgTable('currencies', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').references(() => companies.id, { onDelete: 'cascade' }),
  code: varchar('code', { length: 3 }).notNull(),
  name: varchar('name', { length: 50 }).notNull(),
  symbol: varchar('symbol', { length: 10 }),
  exchangeRate: numeric('exchange_rate', { precision: 18, scale: 6 }).notNull().default('1'),
  isDefault: boolean('is_default').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const vatSettings = pgTable('vat_settings', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').references(() => companies.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).default('ضريبة القيمة المضافة'),
  accountId: uuid('account_id'),
  vatRate: numeric('vat_rate', { precision: 5, scale: 2 }).notNull().default('15'),
  vatNumber: varchar('vat_number', { length: 50 }),
  isInclusive: boolean('is_inclusive').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});
