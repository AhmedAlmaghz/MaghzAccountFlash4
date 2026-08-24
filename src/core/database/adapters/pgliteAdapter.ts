/* eslint-disable @typescript-eslint/no-explicit-any */
import type { DbAdapter } from './types';
import { PGlite } from '@electric-sql/pglite';

/**
 * PGlite (PostgreSQL WASM) Adapter
 * Runs a real PostgreSQL engine inside the browser/Electron via WebAssembly.
 * Data persists in IndexedDB ("idb://") — no server required.
 *
 * This is the "local, no-install" database option. Because it is genuine
 * PostgreSQL, every SQL statement the app already uses works unchanged
 * (JOINs, CTEs, RETURNING, ::uuid casts, ILIKE, generate_series, ...).
 */

// In-memory fallback for environments without IndexedDB (e.g. some tests / SSR)
let pglite: PGlite | null = null;
let initPromise: Promise<PGlite> | null = null;

function isBrowserIndexedDB(): boolean {
  return typeof indexedDB !== 'undefined';
}

async function getInstance(): Promise<PGlite> {
  if (pglite) return pglite;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const dataDir = isBrowserIndexedDB() ? 'idb://maghzaccount-pglite' : undefined;
    const instance = new PGlite({ dataDir });
    await instance.waitReady;
    pglite = instance;
    return instance;
  })();

  try {
    return await initPromise;
  } catch (err) {
    initPromise = null;
    throw err;
  }
}

/** Convert SQLite-style `?` placeholders to PostgreSQL `$1, $2...` */
function convertPlaceholders(sql: string): string {
  let i = 1;
  return sql.replace(/\?/g, () => `$${i++}`);
}

/** Auto-convert known numeric columns to actual JS numbers (like the PG adapter). */
const NUMERIC_COLUMNS = new Set([
  'balance', 'debit', 'credit', 'total_amount', 'subtotal', 'vat_amount',
  'paid_amount', 'discount_amount', 'cost_price', 'sale_price', 'stock_qty',
  'min_stock_alert', 'unit_price', 'line_total', 'quantity', 'exchange_rate',
  'vat_rate', 'amount', 'base_salary', 'allowances', 'deductions', 'overtime',
  'net_salary', 'estimated_value', 'probability', 'duration',
  'estimated_cost', 'actual_cost', 'planned_cost', 'variance_cost', 'variance_qty',
  'unit_cost', 'actual_unit_cost', 'total_cost', 'stock_value', 'revenue', 'cost',
  'profit', 'avg_value', 'credit_limit', 'tax_rate', 'rate',
  'base_currency_amount', 'base_currency_paid', 'base_currency_line_total',
  'min_stock', 'max_stock', 'reorder_point', 'overtime_hours',
  'produced_quantity', 'planned_quantity', 'actual_quantity',
  'service_years', 'last_salary', 'eos_amount', 'days',
  'system_qty', 'actual_qty', 'difference',
]);

function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  if (!row || typeof row !== 'object') return row;
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(row)) {
    if (val === null || val === undefined) {
      out[key] = val;
    } else if (NUMERIC_COLUMNS.has(key)) {
      const n = Number(val);
      out[key] = isNaN(n) ? 0 : n;
    } else {
      out[key] = val;
    }
  }
  return out;
}

function normalizeResult<T = unknown>(result: { rows?: unknown[]; error?: unknown }): { success: boolean; rows?: T[]; error?: string } {
  if (result.error) {
    return { success: false, error: String(result.error) };
  }
  const rows = (result.rows || []) as Record<string, unknown>[];
  return { success: true, rows: rows.map(normalizeRow) as unknown as T[] };
}

// ─── Migration support ────────────────────────────────────────────────────────
// Vite exposes the raw SQL from the drizzle folder via ?raw imports.
// Pre-production squash: a SINGLE consolidated baseline generated from the
// Drizzle schemas (single source of truth). Replay safety on existing browser
// databases is provided by normalizeIdempotent() below — mirroring
// electron/migrationRunner.js.

import schemaInit from '@root/drizzle/0000_init.sql?raw';

const MIGRATIONS: { name: string; sql: string }[] = [
  { name: '0000_init', sql: schemaInit },
];

/**
 * Run all pending migrations. Tracks applied migrations in a
 * `__pglite_migrations` table so it is idempotent across reloads.
 * The result is cached so subsequent calls are no-ops (avoids 24
 * SELECT checks on every query — a major PGlite performance win).
 */
/**
 * Normalize a generated migration into an idempotent one so replaying the
 * baseline over an existing browser database (IndexedDB persists across
 * reloads) never crashes on pre-existing tables/constraints.
 * Mirrors electron/migrationRunner.js — keep both in sync.
 */
function normalizeIdempotent(rawSql: string): string {
  let sql = rawSql;

  sql = sql.replace(/\bCREATE TABLE (?!IF NOT EXISTS)/g, 'CREATE TABLE IF NOT EXISTS ');
  sql = sql.replace(/\bCREATE UNIQUE INDEX (?!IF NOT EXISTS)/g, 'CREATE UNIQUE INDEX IF NOT EXISTS ');
  sql = sql.replace(/\bCREATE INDEX (?!IF NOT EXISTS)/g, 'CREATE INDEX IF NOT EXISTS ');

  const constraintRe = /^ALTER TABLE (?:ONLY )?("[^"]+"|[\w.]+)\s+ADD CONSTRAINT\s+("[^"]+"|[\w.]+)([^;]*);/gm;
  const guarded: string[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = constraintRe.exec(sql)) !== null) {
    const conname = m[2].replace(/"/g, '');
    guarded.push(sql.slice(last, m.index));
    guarded.push(
      `DO $$ BEGIN\n  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${conname}') THEN\n    ALTER TABLE ${m[1]} ADD CONSTRAINT ${m[2]}${m[3]};\n  END IF;\nEND $$;`
    );
    last = m.index + m[0].length;
  }
  guarded.push(sql.slice(last));
  return guarded.join('\n');
}

let migrationsPromise: Promise<{ success: boolean; error?: string }> | null = null;

export function runPgliteMigrations(): Promise<{ success: boolean; error?: string }> {
  if (!migrationsPromise) {
    migrationsPromise = runPgliteMigrationsInternal();
  }
  return migrationsPromise;
}

async function runPgliteMigrationsInternal(): Promise<{ success: boolean; error?: string }> {
  try {
    const db = await getInstance();
    // Create migration tracking table if needed
    await db.exec(`
      CREATE TABLE IF NOT EXISTS __pglite_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    for (const migration of MIGRATIONS) {
      const existing = await db.query('SELECT 1 FROM __pglite_migrations WHERE name = $1 LIMIT 1', [migration.name]);
      if (existing.rows.length > 0) continue;
      await db.exec(normalizeIdempotent(migration.sql));
      await db.query('INSERT INTO __pglite_migrations (name) VALUES ($1)', [migration.name]);
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// =====================================================================
// Seed support (browser-compatible, no Node crypto)
// =====================================================================

const PBKDF2_ITERATIONS = 100000;
const SALT_LENGTH = 32;
const KEY_LENGTH = 256;

function generateSalt(): string {
  const salt = new Uint8Array(SALT_LENGTH);
  crypto.getRandomValues(salt);
  return Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(password: string): Promise<string> {
  const salt = generateSalt();
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: encoder.encode(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    KEY_LENGTH
  );
  const hashArray = Array.from(new Uint8Array(derivedBits));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return `pbkdf2:${PBKDF2_ITERATIONS}:${salt}:${hashHex}`;
}

function randomPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < 20; i++) out += chars[bytes[i] % chars.length];
  return out;
}

const ACCOUNTS: Array<{
  code: string; name_ar: string; name_en: string; type: string; nature: string;
  is_group: boolean; parent_code: string | null; balance?: number;
}> = [
    { code: '1', name_ar: 'الأصول', name_en: 'Assets', type: 'asset', nature: 'debit', is_group: true, parent_code: null },
    { code: '11', name_ar: 'الأصول المتداولة', name_en: 'Current Assets', type: 'asset', nature: 'debit', is_group: true, parent_code: '1' },
    { code: '111', name_ar: 'الصندوق والبنوك', name_en: 'Cash & Banks', type: 'asset', nature: 'debit', is_group: true, parent_code: '11' },
    { code: '11101', name_ar: 'الصندوق الرئيسي', name_en: 'Main Cash', type: 'asset', nature: 'debit', is_group: false, parent_code: '111', balance: 0 },
    { code: '11102', name_ar: 'البنك اليمني الدولي', name_en: 'Yemen International Bank', type: 'asset', nature: 'debit', is_group: false, parent_code: '111', balance: 0 },
    { code: '11103', name_ar: 'محفظة جيب', name_en: 'Jibe Wallet', type: 'asset', nature: 'debit', is_group: false, parent_code: '111', balance: 0 },
    { code: '112', name_ar: 'المدينون', name_en: 'Receivables', type: 'asset', nature: 'debit', is_group: true, parent_code: '11' },
    { code: '11201', name_ar: 'المدينون التجاريون', name_en: 'Trade Customers', type: 'asset', nature: 'debit', is_group: false, parent_code: '112' },
    { code: '113', name_ar: 'المخزون', name_en: 'Inventory', type: 'asset', nature: 'debit', is_group: true, parent_code: '11' },
    { code: '11301', name_ar: 'بضاعة أول المدة', name_en: 'Opening Inventory', type: 'asset', nature: 'debit', is_group: false, parent_code: '113' },
    { code: '2', name_ar: 'الالتزامات', name_en: 'Liabilities', type: 'liability', nature: 'credit', is_group: true, parent_code: null },
    { code: '21', name_ar: 'الالتزامات المتداولة', name_en: 'Current Liabilities', type: 'liability', nature: 'credit', is_group: true, parent_code: '2' },
    { code: '211', name_ar: 'الدائنون', name_en: 'Payables', type: 'liability', nature: 'credit', is_group: true, parent_code: '21' },
    { code: '21101', name_ar: 'الدائنون التجاريون', name_en: 'Trade Suppliers', type: 'liability', nature: 'credit', is_group: false, parent_code: '211' },
    { code: '213', name_ar: 'الضرائب', name_en: 'Taxes', type: 'liability', nature: 'credit', is_group: true, parent_code: '21' },
    { code: '21301', name_ar: 'ضريبة القيمة المضافة', name_en: 'VAT Payable', type: 'liability', nature: 'credit', is_group: false, parent_code: '213' },
    { code: '3', name_ar: 'حقوق الملكية', name_en: 'Equity', type: 'equity', nature: 'credit', is_group: true, parent_code: null },
    { code: '311', name_ar: 'رأس المال', name_en: 'Capital', type: 'equity', nature: 'credit', is_group: true, parent_code: '3' },
    { code: '31101', name_ar: 'رأس المال المدفوع', name_en: 'Paid-in Capital', type: 'equity', nature: 'credit', is_group: false, parent_code: '311', balance: 0 },
    { code: '4', name_ar: 'الإيرادات', name_en: 'Revenues', type: 'revenue', nature: 'credit', is_group: true, parent_code: null },
    { code: '41', name_ar: 'إيرادات المبيعات', name_en: 'Sales Revenue', type: 'revenue', nature: 'credit', is_group: true, parent_code: '4' },
    { code: '411', name_ar: 'المبيعات', name_en: 'Sales', type: 'revenue', nature: 'credit', is_group: true, parent_code: '41' },
    { code: '41101', name_ar: 'مبيعات المنتجات', name_en: 'Product Sales', type: 'revenue', nature: 'credit', is_group: false, parent_code: '411' },
    { code: '41102', name_ar: 'مبيعات الخدمات', name_en: 'Services Sales', type: 'revenue', nature: 'credit', is_group: false, parent_code: '411' },
    { code: '41103', name_ar: 'مردودات المبيعات', name_en: 'Sales Returns', type: 'revenue', nature: 'credit', is_group: false, parent_code: '411' },
    { code: '5', name_ar: 'المصروفات', name_en: 'Expenses', type: 'expense', nature: 'debit', is_group: true, parent_code: null },
    { code: '51', name_ar: 'تكلفة المبيعات', name_en: 'Cost of Sales', type: 'expense', nature: 'debit', is_group: true, parent_code: '5' },
    { code: '511', name_ar: 'تكلفة البضاعة', name_en: 'COGS', type: 'expense', nature: 'debit', is_group: true, parent_code: '51' },
    { code: '51101', name_ar: 'تكلفة بضاعة مباعة', name_en: 'Cost of Goods Sold', type: 'expense', nature: 'debit', is_group: false, parent_code: '511' },
    { code: '52', name_ar: 'مصاريف تشغيلية', name_en: 'Operating Expenses', type: 'expense', nature: 'debit', is_group: true, parent_code: '5' },
    { code: '52101', name_ar: 'رواتب الموظفين', name_en: 'Employee Salaries', type: 'expense', nature: 'debit', is_group: false, parent_code: '52' },
    { code: '52201', name_ar: 'مصروفات الإيجار', name_en: 'Rent Expense', type: 'expense', nature: 'debit', is_group: false, parent_code: '52' },
    { code: '52301', name_ar: 'مصروفات متنوعة ونثريات', name_en: 'Miscellaneous Expenses', type: 'expense', nature: 'debit', is_group: false, parent_code: '52' },
  ];

const PRODUCT_TYPES: Array<{
  code: string; name_ar: string; name_en: string;
  appears_in_sales: boolean; appears_in_purchases: boolean;
  appears_in_inventory: boolean; appears_in_manufacturing: boolean;
  has_stock_tracking: boolean; has_bom: boolean;
  sales: string | null; cogs: string | null; inv: string | null;
}> = [
    { code: 'TRADE', name_ar: 'بضاعة تجارية', name_en: 'Trade Goods', appears_in_sales: true, appears_in_purchases: true, appears_in_inventory: true, appears_in_manufacturing: false, has_stock_tracking: true, has_bom: false, sales: '41101', cogs: '51101', inv: '11301' },
    { code: 'SRV', name_ar: 'خدمات', name_en: 'Services', appears_in_sales: true, appears_in_purchases: false, appears_in_inventory: false, appears_in_manufacturing: false, has_stock_tracking: false, has_bom: false, sales: '41102', cogs: null, inv: null },
    { code: 'RAW', name_ar: 'مواد خام', name_en: 'Raw Materials', appears_in_sales: false, appears_in_purchases: true, appears_in_inventory: true, appears_in_manufacturing: true, has_stock_tracking: true, has_bom: true, sales: null, cogs: '51101', inv: '11301' },
    { code: 'FG', name_ar: 'منتج نهائي', name_en: 'Finished Goods', appears_in_sales: true, appears_in_purchases: false, appears_in_inventory: true, appears_in_manufacturing: true, has_stock_tracking: true, has_bom: true, sales: '41101', cogs: '51101', inv: '11301' },
    { code: 'CON', name_ar: 'مواد استهلاكية', name_en: 'Consumables', appears_in_sales: true, appears_in_purchases: true, appears_in_inventory: true, appears_in_manufacturing: false, has_stock_tracking: true, has_bom: false, sales: null, cogs: null, inv: '11301' },
  ];

const UNITS: Array<{ code: string; name_ar: string; name_en: string; conv: number }> = [
  { code: 'UNT', name_ar: 'وحدة', name_en: 'Unit', conv: 1 },
  { code: 'CTN', name_ar: 'كرتون', name_en: 'Carton', conv: 1 },
  { code: 'KG', name_ar: 'كيلوغرام', name_en: 'Kilogram', conv: 1 },
  { code: 'LTR', name_ar: 'لتر', name_en: 'Liter', conv: 1 },
  { code: 'MTR', name_ar: 'متر', name_en: 'Meter', conv: 1 },
  { code: 'PC', name_ar: 'حبة', name_en: 'Piece', conv: 1 },
  { code: 'PK', name_ar: 'علبة', name_en: 'Pack', conv: 1 },
  { code: 'CAN', name_ar: 'تنكة', name_en: 'Can', conv: 1 },
  { code: 'DZ', name_ar: 'درزن', name_en: 'Dozen', conv: 1 },
  { code: 'BKT', name_ar: 'سطل', name_en: 'Bucket', conv: 1 },
  { code: 'BLK', name_ar: 'قالب', name_en: 'Block', conv: 1 },
  { code: 'SHD', name_ar: 'شدة', name_en: 'Shadah', conv: 1 },
];

const CURRENCIES: Array<{ code: string; name: string; symbol: string; rate: number; is_default: boolean }> = [
  { code: 'YER', name: 'الريال اليمني', symbol: 'ر.ي', rate: 1, is_default: true },
  { code: 'USD', name: 'الدولار الأمريكي', symbol: '$', rate: 535, is_default: false },
  { code: 'SAR', name: 'الريال السعودي', symbol: 'ر.س', rate: 140, is_default: false },
];

const DEFAULT_ACCOUNTS: Array<{ key: string; account_code: string; required: boolean; description: string }> = [
  { key: 'default_cash', account_code: '11101', required: true, description: 'الصندوق الرئيسي' },
  { key: 'default_bank', account_code: '11102', required: false, description: 'البنك الرئيسي' },
  { key: 'default_bank', account_code: '11103', required: false, description: 'محفظة جيب' },
  { key: 'default_sales', account_code: '41101', required: true, description: 'إيرادات المبيعات' },
  { key: 'default_cogs', account_code: '51101', required: true, description: 'تكلفة البضاعة المباعة' },
  { key: 'default_inventory', account_code: '11301', required: true, description: 'حساب المخزون' },
  { key: 'default_debtors', account_code: '11201', required: true, description: 'المدينون التجاريون' },
  { key: 'default_creditors', account_code: '21101', required: true, description: 'الدائنون التجاريون' },
  { key: 'default_vat_output', account_code: '21301', required: true, description: 'ضريبة المخرجات' },
  { key: 'default_vat_input', account_code: '21301', required: true, description: 'ضريبة المدخلات' },
  { key: 'default_salaries', account_code: '52101', required: false, description: 'مصاريف الرواتب' },
  { key: 'default_sales_returns', account_code: '41103', required: false, description: 'مردودات المبيعات' },
  { key: 'default_discount_allowed', account_code: '41101', required: false, description: 'الخصم الممنوح' },
  { key: 'default_discount_received', account_code: '21101', required: false, description: 'الخصم المكتسب' },
  { key: 'default_purchase_returns', account_code: '21101', required: true, description: 'مردودات المشتريات' },
];

const BRANCHES: Array<{ code: string; name: string; address: string }> = [
  { code: 'HQ', name: 'الفرع الرئيسي - صنعاء', address: 'صنعاء - شارع الستين' },
  { code: 'HD', name: 'فرع الحديدة', address: 'الحديدة - شارع صنعاء' },
  { code: 'AD', name: 'فرع عدن', address: 'عدن - المنصورة' },
];

const COST_CENTERS: Array<{ code: string; name_ar: string; name_en: string; type: string; budget: number }> = [
  { code: 'HQ', name_ar: 'الإدارة العامة', name_en: 'Head Office', type: 'branch', budget: 0 },
  { code: 'CC-SAL', name_ar: 'مركز الرواتب', name_en: 'Salaries Center', type: 'department', budget: 1500000 },
  { code: 'CC-PRD', name_ar: 'مركز الإنتاج', name_en: 'Production Center', type: 'department', budget: 2500000 },
  { code: 'CC-EXP', name_ar: 'مركز المصروفات', name_en: 'Expenses Center', type: 'project', budget: 8000000 },
];

const PAYROLL_COMPONENTS: Array<{
  code: string; name_ar: string; name_en: string; type: string; method: string; amount: number;
  gross: boolean; tax: boolean; ins: boolean;
}> = [
    { code: 'BAS', name_ar: 'الراتب الأساسي', name_en: 'Basic Salary', type: 'earning', method: 'fixed', amount: 0, gross: true, tax: true, ins: false },
    { code: 'HOU', name_ar: 'بدل الساعات الإضافية', name_en: 'Overtime Allowance', type: 'earning', method: 'fixed', amount: 150000, gross: true, tax: false, ins: false },
    { code: 'TRN', name_ar: 'بدل المواصلات', name_en: 'Transport Allowance', type: 'earning', method: 'fixed', amount: 50000, gross: true, tax: false, ins: false },
    { code: 'TAX', name_ar: 'ضريبة الدخل', name_en: 'Income Tax', type: 'tax', method: 'formula', amount: 0, gross: false, tax: true, ins: false },
    { code: 'INS', name_ar: 'التأمينات الاجتماعية', name_en: 'Social Insurance', type: 'deduction', method: 'percentage', amount: 9, gross: false, tax: false, ins: true },
  ];

const BANKS: Array<{ name: string; bank_name: string; account_number: string; iban: string; balance: number; account_code: string }> = [
  { name: 'حساب البنك اليمني الدولي', bank_name: 'البنك اليمني الدولي', account_number: '1234567890', iban: 'YE12345678901234', balance: 5800000, account_code: '11102' },
];

const CASH_BOXES: Array<{ name: string; code: string; balance: number; account_code: string; responsible_role: string }> = [
  { name: 'الصندوق الرئيسي', code: 'CB-MAIN', balance: 0, account_code: '11101', responsible_role: 'admin' },
];

const PRODUCT_CATEGORIES: string[] = ['المواد الغذائية', 'مواد التنظيف', 'العناية الشخصية'];

const PRODUCTS: Array<{
  code: string; name_ar: string; name_en: string; barcode: string; sku: string;
  unit: string; cost: number; price: number; type: string;
}> = [
    { code: 'PRD-001', name_ar: 'أرز بسمتي فاخر', name_en: 'Premium Basmati Rice', barcode: '6223000123456', sku: 'RICE-BAS-5KG', unit: 'كيس', cost: 2800, price: 3200, type: 'TRADE' },
    { code: 'PRD-002', name_ar: 'زيت نباتي 3 لتر', name_en: 'Vegetable Oil 3L', barcode: '6223000123457', sku: 'OIL-VEG-3L', unit: 'علبة', cost: 4200, price: 4800, type: 'TRADE' },
    { code: 'PRD-003', name_ar: 'سكر أبيض 50 كغ', name_en: 'White Sugar 50kg', barcode: '6223000123458', sku: 'SUG-WHT-50KG', unit: 'كيس', cost: 15000, price: 16500, type: 'TRADE' },
    { code: 'PRD-004', name_ar: 'دقيق فاخر 50 كغ', name_en: 'Premium Flour 50kg', barcode: '6223000123459', sku: 'FLR-PRM-50KG', unit: 'كيس', cost: 9500, price: 10500, type: 'TRADE' },
    { code: 'PRD-005', name_ar: 'معجون طماطم 400غ', name_en: 'Tomato Paste 400g', barcode: '6223000123460', sku: 'TOM-PST-400G', unit: 'علبة', cost: 380, price: 450, type: 'TRADE' },
    { code: 'PRD-006', name_ar: 'شاي ليبتون 200غ', name_en: 'Lipton Tea 200g', barcode: '6223000123461', sku: 'TEA-LIP-200G', unit: 'علبة', cost: 1200, price: 1400, type: 'TRADE' },
    { code: 'PRD-007', name_ar: 'حليب مجفف 2.5 كغ', name_en: 'Milk Powder 2.5kg', barcode: '6223000123462', sku: 'MLK-PWD-2.5K', unit: 'علبة', cost: 8500, price: 9500, type: 'TRADE' },
    { code: 'PRD-008', name_ar: 'تونة معلبة 185غ', name_en: 'Canned Tuna 185g', barcode: '6223000123463', sku: 'TUN-CAN-185G', unit: 'علبة', cost: 650, price: 750, type: 'TRADE' },
    { code: 'PRD-009', name_ar: 'صابون لوكس 125غ', name_en: 'Lux Soap 125g', barcode: '6223000123464', sku: 'SOAP-LUX-125G', unit: 'قطعة', cost: 280, price: 330, type: 'CON' },
    { code: 'PRD-010', name_ar: 'شامبو هيد آند شولدرز 400مل', name_en: 'Head & Shoulders 400ml', barcode: '6223000123465', sku: 'SHP-HNS-400M', unit: 'علبة', cost: 1800, price: 2100, type: 'CON' },
    { code: 'PRD-011', name_ar: 'معجون أسنان كولجيت 100مل', name_en: 'Colgate Toothpaste 100ml', barcode: '6223000123466', sku: 'PAS-COL-100M', unit: 'علبة', cost: 420, price: 500, type: 'CON' },
    { code: 'PRD-012', name_ar: 'منظف جليكسون 1 لتر', name_en: 'Gleason Cleaner 1L', barcode: '6223000123467', sku: 'CLN-GLX-1L', unit: 'علبة', cost: 1100, price: 1300, type: 'CON' },
    { code: 'PRD-013', name_ar: 'مناديل فاين 200 منديل', name_en: 'Fine Tissues 200', barcode: '6223000123468', sku: 'TIS-FIN-200', unit: 'علبة', cost: 350, price: 420, type: 'CON' },
    { code: 'PRD-014', name_ar: 'قهوة العربية 250غ', name_en: 'Arabian Coffee 250g', barcode: '6223000123469', sku: 'COF-ARA-250G', unit: 'علبة', cost: 2200, price: 2600, type: 'TRADE' },
    { code: 'PRD-015', name_ar: 'بسكويت أوريو 154غ', name_en: 'Oreo Biscuits 154g', barcode: '6223000123470', sku: 'BIS-ORE-154G', unit: 'علبة', cost: 550, price: 650, type: 'TRADE' },
  ];

const WAREHOUSES: Array<{ code: string; name: string }> = [
  { code: 'WH-MAIN', name: 'المستودع الرئيسي - صنعاء' },
  { code: 'WH-HD', name: 'مستودع الحديدة' },
  { code: 'WH-AD', name: 'مستودع عدن' },
];

const CUSTOMERS: Array<{ code: string; name: string; phone: string; email: string; address: string; balance: number }> = [
  { code: 'CUST-001', name: 'شركة البحر الأحمر للتجارة', phone: '+967334455667', email: 'redsea@ye.com', address: 'الحديدة - كمران', balance: 950000 },
  { code: 'CUST-002', name: 'مؤسسة الجود للصناعات الغذائية', phone: '+967112233445', email: 'aljawd@ye.com', address: 'صنعاء - شارع الستين', balance: 1200000 },
  { code: 'CUST-003', name: 'مؤسسة الصافي للمواد الغذائية', phone: '+967778899001', email: 'alsafi@ye.com', address: 'صنعاء - شارع الستين', balance: 650000 },
  { code: 'CUST-004', name: 'شركة اليمن الدولية للاستيراد', phone: '+967223344556', email: 'yemenintl@ye.com', address: 'صنعاء - شارع تعز', balance: 1800000 },
  { code: 'CUST-005', name: 'مؤسسة الحديدة التجارية', phone: '+967556677889', email: 'hodeidah@ye.com', address: 'الحديدة - شارع صنعاء', balance: 320000 },
  { code: 'CUST-006', name: 'مؤسسة عدن التجارية', phone: '+967667788990', email: 'aden@ye.com', address: 'عدن - المنصورة', balance: 450000 },
  { code: 'CUST-007', name: 'مؤسسة إب للصناعات', phone: '+967778899112', email: 'ibb@ye.com', address: 'إب - الجمهورية', balance: 280000 },
  { code: 'CUST-008', name: 'مؤسسة تعز التجارية', phone: '+967889900223', email: 'taiz@ye.com', address: 'تعز - المطار القديم', balance: 510000 },
];

const SUPPLIERS: Array<{ code: string; name: string; phone: string; email: string; address: string }> = [
  { code: 'SUP-001', name: 'شركة الخليج للاستيراد', phone: '+967998877665', email: 'gulf@ye.com', address: 'جدة - السعودية' },
  { code: 'SUP-002', name: 'مؤسسة الوفاق التجارية', phone: '+967112233990', email: 'wefaq@ye.com', address: 'صنعاء - شارع الستين' },
  { code: 'SUP-003', name: 'شركة الإمارات للتجارة', phone: '+97144223311', email: 'uae@em.com', address: 'دبي - الإمارات' },
  { code: 'SUP-004', name: 'مؤسسة السعيد للتجارة', phone: '+967334455112', email: 'alsaeed@ye.com', address: 'صنعاء - شارع تعز' },
  { code: 'SUP-005', name: 'شركة البركة للاستيراد', phone: '+967556677334', email: 'baraka@ye.com', address: 'الحديدة - شارع صنعاء' },
  { code: 'SUP-006', name: 'مؤسسة الرشيد التجارية', phone: '+967778899445', email: 'rashid@ye.com', address: 'عدن - المنصورة' },
  { code: 'SUP-007', name: 'شركة الصقر الدولية', phone: '+967889900556', email: 'saqr@ye.com', address: 'إب - الجمهورية' },
  { code: 'SUP-008', name: 'مؤسسة النجاح للتجارة', phone: '+967990011667', email: 'najah@ye.com', address: 'تعز - المطار القديم' },
];

const DEPARTMENTS: string[] = ['الإدارة', 'المبيعات', 'المخازن', 'المحاسبة'];

const EMPLOYEES: Array<{
  number: string; name: string; phone: string; email: string;
  dept: string; position: string; grade: string; hire_date: string; salary: number;
}> = [
    { number: 'EMP-001', name: 'أحمد علي عبدالله', phone: '+967111222333', email: 'ahmed@demo.ye', dept: 'الإدارة', position: 'مدير عام', grade: 'A', hire_date: '2020-01-15', salary: 450000 },
    { number: 'EMP-002', name: 'خالد سعيد الحسني', phone: '+967222333444', email: 'khaled@demo.ye', dept: 'المبيعات', position: 'مدير مبيعات', grade: 'A', hire_date: '2020-03-10', salary: 350000 },
    { number: 'EMP-003', name: 'محمد صالح القاضي', phone: '+967333444555', email: 'mohammed@demo.ye', dept: 'المخازن', position: 'مدير مخازن', grade: 'B', hire_date: '2021-02-01', salary: 280000 },
    { number: 'EMP-004', name: 'فاطمة عبدالرحمن', phone: '+967444555666', email: 'fatima@demo.ye', dept: 'المحاسبة', position: 'رئيسة محاسبين', grade: 'A', hire_date: '2020-06-20', salary: 320000 },
    { number: 'EMP-005', name: 'عبدالله يحيى المخلافي', phone: '+967555666777', email: 'abdullah@demo.ye', dept: 'المبيعات', position: 'مندوب مبيعات', grade: 'C', hire_date: '2022-01-10', salary: 180000 },
    { number: 'EMP-006', name: 'سميرة علي الأحمدي', phone: '+967666777888', email: 'samira@demo.ye', dept: 'المحاسبة', position: 'محاسبة', grade: 'C', hire_date: '2022-04-15', salary: 170000 },
    { number: 'EMP-007', name: 'ياسر محمود الكبسي', phone: '+967777888999', email: 'yaser@demo.ye', dept: 'المخازن', position: 'أمين مخزن', grade: 'C', hire_date: '2023-01-05', salary: 150000 },
    { number: 'EMP-008', name: 'هند صالح البركاني', phone: '+967888999000', email: 'hind@demo.ye', dept: 'الإدارة', position: 'سكرتيرة', grade: 'C', hire_date: '2023-03-12', salary: 140000 },
  ];

const LEADS: Array<{
  name: string; phone: string; email: string; company: string;
  source: string; status: string; value: number; notes: string;
}> = [
    { name: 'محمد عبدالله السقاف', phone: '+967111000111', email: 'm.saqaf@example.com', company: 'شركة السقاف التجارية', source: 'معرض', status: 'new', value: 500000, notes: 'عميل محتمل من معرض صنعاء' },
    { name: 'سمير علي الحميري', phone: '+967222000222', email: 's.alhamiri@example.com', company: 'مؤسسة الحميري', source: 'موقع إلكتروني', status: 'contacted', value: 350000, notes: 'تواصل عبر الموقع' },
    { name: 'ليلى محمود الأصبحي', phone: '+967333000333', email: 'l.ashbah@example.com', company: 'شركة الأصبحي', source: 'توصية', status: 'qualified', value: 800000, notes: 'موصى به من عميل حالي' },
    { name: 'عمر فاروق بامطرف', phone: '+967444000444', email: 'o.bamtraf@example.com', company: 'مؤسسة بامطرف', source: 'إعلان', status: 'new', value: 200000, notes: 'استجابة لإعلان فيسبوك' },
    { name: 'نادية صالح الكحلاني', phone: '+967555000555', email: 'n.kahlan@example.com', company: 'شركة الكحلاني', source: 'معرض', status: 'contacted', value: 600000, notes: 'مهتمة بمنتجات التنظيف' },
    { name: 'هشام أحمد الجندي', phone: '+967666000666', email: 'h.aljundi@example.com', company: 'مؤسسة الجندي', source: 'اتصال وارد', status: 'qualified', value: 450000, notes: 'طلب عرض أسعار' },
  ];

const SEQUENCES: Array<{ type: string; prefix: string; start: number; current: number; pad: number }> = [
  { type: 'sales_invoice', prefix: 'INV-', start: 1, current: 0, pad: 6 },
  { type: 'sales_return', prefix: 'SRT-', start: 1, current: 0, pad: 4 },
  { type: 'quotation', prefix: 'QOT-', start: 1, current: 0, pad: 4 },
  { type: 'purchase_order', prefix: 'PO-', start: 1, current: 0, pad: 6 },
  { type: 'purchase_invoice', prefix: 'PINV-', start: 1, current: 0, pad: 4 },
  { type: 'purchase_return', prefix: 'PRT-', start: 1, current: 0, pad: 4 },
  { type: 'journal_voucher', prefix: 'JV-', start: 1, current: 0, pad: 7 },
  { type: 'receipt_voucher', prefix: 'RV-', start: 1, current: 0, pad: 6 },
  { type: 'payment_voucher', prefix: 'PV-', start: 1, current: 0, pad: 6 },
  { type: 'work_order', prefix: 'WO-', start: 1, current: 0, pad: 4 },
  { type: 'bom', prefix: 'BOM-', start: 1, current: 0, pad: 0 },
  { type: 'payroll_run', prefix: 'PAY-', start: 1, current: 0, pad: 6 },
  { type: 'product', prefix: 'PRD-', start: 1, current: 15, pad: 0 },
  { type: 'warehouse', prefix: 'WH-', start: 1, current: 1, pad: 0 },
  { type: 'stock_adjustment', prefix: 'ADJ-', start: 1, current: 0, pad: 6 },
  { type: 'inventory_transfer', prefix: 'TRF-', start: 1, current: 0, pad: 6 },
  { type: 'customer', prefix: 'CUS-', start: 1, current: 0, pad: 5 },
  { type: 'supplier', prefix: 'SUP-', start: 1, current: 0, pad: 4 },
  { type: 'employee', prefix: 'EMP-', start: 1, current: 0, pad: 4 },
];

// System roles seeded for every company. Permission lists mirror
// FALLBACK_PERMISSIONS in src/modules/auth/store.ts (and electron/dbHandler.js)
// so role-based users get the same access in PGlite as in the desktop app.
// The role names must match users.role values used at login.
const SYSTEM_ROLES: Array<{ name: string; name_ar: string; description: string; permissions: string[] }> = [
  {
    name: 'admin',
    name_ar: 'مدير النظام',
    description: 'صلاحيات كاملة على جميع الوحدات',
    permissions: ['*'],
  },
  {
    name: 'manager',
    name_ar: 'مدير',
    description: 'إدارة العمليات اليومية دون إعدادات النظام',
    permissions: [
      'core.view', 'accounting.view', 'accounting.create', 'accounting.edit', 'accounting.post',
      'inventory.view', 'inventory.create', 'inventory.edit',
      'sales.view', 'sales.create', 'sales.edit', 'sales.post',
      'purchases.view', 'purchases.create', 'purchases.edit',
      'manufacturing.view', 'manufacturing.create', 'manufacturing.edit', 'manufacturing.post',
      'reports.view', 'reports.export',
      'settings.view',
      'ai.use',
    ],
  },
  {
    name: 'accountant',
    name_ar: 'محاسب',
    description: 'العمليات المحاسبية والمالية والتقارير',
    permissions: [
      'core.view',
      'accounting.view', 'accounting.create', 'accounting.edit', 'accounting.post',
      'inventory.view',
      'sales.view', 'sales.create', 'sales.edit',
      'purchases.view', 'purchases.create', 'purchases.edit',
      'manufacturing.view',
      'reports.view', 'reports.export',
      'ai.use',
    ],
  },
  {
    name: 'sales_rep',
    name_ar: 'مندوب مبيعات',
    description: 'المبيعات وخدمة العملاء — سجلاته الخاصة فقط',
    permissions: [
      'sales.own', 'sales.create', 'sales.edit',
      'inventory.own',
      'crm.own', 'crm.create', 'crm.edit',
      'reports.view',
      'ai.use',
    ],
  },
  {
    name: 'viewer',
    name_ar: 'مطلع',
    description: 'عرض فقط دون تعديل أو إنشاء',
    permissions: [
      'core.view', 'accounting.view', 'inventory.view', 'sales.view',
      'purchases.view', 'manufacturing.view', 'reports.view',
    ],
  },
];

const STOCK_QTYS = [500, 300, 200, 350, 1000, 600, 150, 800, 1200, 250, 900, 400, 700, 180, 500];

async function ensureRow(
  this: DbAdapter,
  sql: string,
  params: unknown[],
  fallbackSql: string,
  fallbackParams: unknown[]
): Promise<string | null> {
  const res = await this.query(sql, params);
  if (res.success && res.rows && res.rows.length > 0) {
    const id = (res.rows[0] as { id?: unknown }).id;
    return id !== undefined && id !== null ? String(id) : null;
  }
  const fb = await this.query(fallbackSql, fallbackParams);
  if (fb.success && fb.rows && fb.rows.length > 0) {
    const id = (fb.rows[0] as { id?: unknown }).id;
    return id !== undefined && id !== null ? String(id) : null;
  }
  return null;
}

async function seedCompanyAndAdmin(
  this: DbAdapter,
  passwordHash: string
): Promise<{ companyId: string; adminId: string }> {
  const fiscalYearStart = `${new Date().getFullYear()}-01-01`;
  const companyRes = await this.query(
    `INSERT INTO companies (name, name_en, currency, tax_number, address, phone, email, date_format, decimal_places, calendar, fiscal_year_start)
     VALUES ($1, $2, 'YER', '', '', '', '', 'yyyy-MM-dd', 2, 'gregorian', $3)
     RETURNING id`,
    ['الشركة الرئيسية', 'Main Company', fiscalYearStart]
  );
  if (!companyRes.success || !companyRes.rows || companyRes.rows.length === 0) {
    throw new Error(companyRes.error || 'Failed to create company');
  }
  const companyId = String((companyRes.rows[0] as { id: unknown }).id);

  const adminRes = await this.query(
    `INSERT INTO users (company_id, username, email, full_name, password_hash, role, is_active)
     VALUES ($1::uuid, 'admin', 'admin@demo.ye', 'مدير النظام', $2, 'admin', TRUE)
     RETURNING id`,
    [companyId, passwordHash]
  );
  if (!adminRes.success || !adminRes.rows || adminRes.rows.length === 0) {
    throw new Error(adminRes.error || 'Failed to create admin user');
  }
  const adminId = String((adminRes.rows[0] as { id: unknown }).id);

  return { companyId, adminId };
}

async function seedChartOfAccounts(this: DbAdapter, companyId: string): Promise<Map<string, string>> {
  const codeToId = new Map<string, string>();
  for (const acc of ACCOUNTS) {
    const parentId = acc.parent_code ? codeToId.get(acc.parent_code) || null : null;
    const id = await ensureRow.call(
      this,
      `INSERT INTO accounts (company_id, code, name_ar, name_en, parent_id, type, nature, is_group, balance, is_active)
       SELECT $1::uuid, $2::text, $3::text, $4::text, $5::uuid, $6::text, $7::text, $8::bool, COALESCE($9::numeric, 0), TRUE
       WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE company_id = $1::uuid AND code = $2::text)
       RETURNING id`,
      [companyId, acc.code, acc.name_ar, acc.name_en, parentId, acc.type, acc.nature, acc.is_group, acc.balance ?? null],
      `SELECT id FROM accounts WHERE company_id = $1::uuid AND code = $2::text LIMIT 1`,
      [companyId, acc.code]
    );
    if (id) codeToId.set(acc.code, id);
  }
  return codeToId;
}

async function seedProductTypes(this: DbAdapter, companyId: string, adminId: string, codeToId: Map<string, string>): Promise<Map<string, string>> {
  const typeCodeToId = new Map<string, string>();
  for (const pt of PRODUCT_TYPES) {
    const salesId = pt.sales ? codeToId.get(pt.sales) || null : null;
    const cogsId = pt.cogs ? codeToId.get(pt.cogs) || null : null;
    const invId = pt.inv ? codeToId.get(pt.inv) || null : null;
    const id = await ensureRow.call(
      this,
      `INSERT INTO product_types (company_id, code, name_ar, name_en, appears_in_sales, appears_in_purchases, appears_in_inventory, appears_in_manufacturing, has_stock_tracking, has_bom, default_sales_account_id, default_cogs_account_id, default_inventory_account_id, is_active, created_by, updated_by)
       SELECT $1::uuid, $2::text, $3::text, $4::text, $5::bool, $6::bool, $7::bool, $8::bool, $9::bool, $10::bool, $11::uuid, $12::uuid, $13::uuid, TRUE, $14::uuid, $14::uuid
       WHERE NOT EXISTS (SELECT 1 FROM product_types WHERE company_id = $1::uuid AND code = $2::text)
       RETURNING id`,
      [companyId, pt.code, pt.name_ar, pt.name_en, pt.appears_in_sales, pt.appears_in_purchases, pt.appears_in_inventory, pt.appears_in_manufacturing, pt.has_stock_tracking, pt.has_bom, salesId, cogsId, invId, adminId],
      `SELECT id FROM product_types WHERE company_id = $1::uuid AND code = $2::text LIMIT 1`,
      [companyId, pt.code]
    );
    if (id) typeCodeToId.set(pt.code, id);
  }
  return typeCodeToId;
}

async function seedUnits(this: DbAdapter, companyId: string): Promise<void> {
  for (const u of UNITS) {
    await ensureRow.call(
      this,
      `INSERT INTO units (company_id, code, name_ar, name_en, conversion_factor, is_active)
       SELECT $1::uuid, $2::text, $3::text, $4::text, $5::numeric, TRUE
       WHERE NOT EXISTS (SELECT 1 FROM units WHERE company_id = $1::uuid AND code = $2::text)
       RETURNING id`,
      [companyId, u.code, u.name_ar, u.name_en, u.conv],
      `SELECT id FROM units WHERE company_id = $1::uuid AND code = $2::text LIMIT 1`,
      [companyId, u.code]
    );
  }
}

async function seedCostCenters(this: DbAdapter, companyId: string): Promise<void> {
  for (const cc of COST_CENTERS) {
    await ensureRow.call(
      this,
      `INSERT INTO cost_centers (company_id, code, name_ar, name_en, type, budget_amount, is_active)
       SELECT $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::numeric, TRUE
       WHERE NOT EXISTS (SELECT 1 FROM cost_centers WHERE company_id = $1::uuid AND code = $2::text)
       RETURNING id`,
      [companyId, cc.code, cc.name_ar, cc.name_en, cc.type, cc.budget],
      `SELECT id FROM cost_centers WHERE company_id = $1::uuid AND code = $2::text LIMIT 1`,
      [companyId, cc.code]
    );
  }
}

async function seedBanks(this: DbAdapter, companyId: string, codeToId: Map<string, string>): Promise<void> {
  for (const b of BANKS) {
    const accountId = codeToId.get(b.account_code) || null;
    await ensureRow.call(
      this,
      `INSERT INTO banks (company_id, name, bank_name, account_number, iban, is_active, current_balance, account_id)
       SELECT $1::uuid, $2::text, $3::text, $4::text, $5::text, TRUE, $6::numeric, $7::uuid
       WHERE NOT EXISTS (SELECT 1 FROM banks WHERE company_id = $1::uuid AND bank_name = $3::text)
       RETURNING id`,
      [companyId, b.name, b.bank_name, b.account_number, b.iban, b.balance, accountId],
      `SELECT id FROM banks WHERE company_id = $1::uuid AND bank_name = $2::text LIMIT 1`,
      [companyId, b.bank_name]
    );
  }
}

async function seedCashBoxes(this: DbAdapter, companyId: string, adminId: string, codeToId: Map<string, string>): Promise<void> {
  for (const cb of CASH_BOXES) {
    const accountId = codeToId.get(cb.account_code) || null;
    await ensureRow.call(
      this,
      `INSERT INTO cash_boxes (company_id, name, code, account_id, responsible_user_id, is_active, current_balance, created_by, updated_by)
       SELECT $1::uuid, $2::text, $3::text, $4::uuid, $5::uuid, TRUE, $6::numeric, $7::uuid, $7::uuid
       WHERE NOT EXISTS (SELECT 1 FROM cash_boxes WHERE company_id = $1::uuid AND code = $3::text)
       RETURNING id`,
      [companyId, cb.name, cb.code, accountId, adminId, cb.balance, adminId],
      `SELECT id FROM cash_boxes WHERE company_id = $1::uuid AND code = $2::text LIMIT 1`,
      [companyId, cb.code]
    );
  }
}

async function seedDefaultAccounts(this: DbAdapter, companyId: string, codeToId: Map<string, string>): Promise<void> {
  for (const da of DEFAULT_ACCOUNTS) {
    const accountId = codeToId.get(da.account_code);
    if (!accountId) continue;
    await ensureRow.call(
      this,
      `INSERT INTO default_accounts (company_id, function_key, account_id, is_required, description)
       SELECT $1::uuid, $2::text, $3::uuid, $4::bool, $5::text
       WHERE NOT EXISTS (SELECT 1 FROM default_accounts WHERE company_id = $1::uuid AND function_key = $2::text)
       RETURNING id`,
      [companyId, da.key, accountId, da.required, da.description],
      `SELECT id FROM default_accounts WHERE company_id = $1::uuid AND function_key = $2::text LIMIT 1`,
      [companyId, da.key]
    );
  }
}

async function seedCurrencies(this: DbAdapter, companyId: string, adminId: string): Promise<void> {
  for (const c of CURRENCIES) {
    await ensureRow.call(
      this,
      `INSERT INTO currencies (company_id, code, name, symbol, exchange_rate, is_default, is_active, created_by, updated_by)
       SELECT $1::uuid, $2::text, $3::text, $4::text, $5::numeric, $6::bool, TRUE, $7::uuid, $7::uuid
       WHERE NOT EXISTS (SELECT 1 FROM currencies WHERE company_id = $1::uuid AND code = $2::text)
       RETURNING id`,
      [companyId, c.code, c.name, c.symbol, c.rate, c.is_default, adminId],
      `SELECT id FROM currencies WHERE company_id = $1::uuid AND code = $2::text LIMIT 1`,
      [companyId, c.code]
    );
  }
}

async function seedVatSettings(this: DbAdapter, companyId: string): Promise<void> {
  await ensureRow.call(
    this,
    `INSERT INTO vat_settings (company_id, vat_rate, vat_number, is_inclusive, is_active)
     SELECT $1::uuid, 15, $2::text, FALSE, TRUE
     WHERE NOT EXISTS (SELECT 1 FROM vat_settings WHERE company_id = $1::uuid)
     RETURNING id`,
    [companyId, '3100123456'],
    `SELECT id FROM vat_settings WHERE company_id = $1::uuid LIMIT 1`,
    [companyId]
  );
}

async function seedDocumentSequences(this: DbAdapter, companyId: string): Promise<void> {
  for (const s of SEQUENCES) {
    await ensureRow.call(
      this,
      `INSERT INTO document_sequences (company_id, document_type, prefix, suffix, starting_number, current_number, increment_step, padding_length, year_reset, is_active)
       SELECT $1::uuid, $2::text, $3::text, '', $4::int, $5::int, 1, $6::int, FALSE, TRUE
       WHERE NOT EXISTS (SELECT 1 FROM document_sequences WHERE company_id = $1::uuid AND document_type = $2::text)
       RETURNING id`,
      [companyId, s.type, s.prefix, s.start, s.current, s.pad],
      `SELECT id FROM document_sequences WHERE company_id = $1::uuid AND document_type = $2::text LIMIT 1`,
      [companyId, s.type]
    );
  }
}

async function seedBranches(this: DbAdapter, companyId: string, adminId: string): Promise<void> {
  for (const b of BRANCHES) {
    await ensureRow.call(
      this,
      `INSERT INTO branches (company_id, name, code, address, is_active, created_by, updated_by)
       SELECT $1::uuid, $2::text, $3::text, $4::text, TRUE, $5::uuid, $5::uuid
       WHERE NOT EXISTS (SELECT 1 FROM branches WHERE company_id = $1::uuid AND code = $3::text)
       RETURNING id`,
      [companyId, b.name, b.code, b.address, adminId],
      `SELECT id FROM branches WHERE company_id = $1::uuid AND code = $2::text LIMIT 1`,
      [companyId, b.code]
    );
  }
}

async function seedRoles(this: DbAdapter, companyId: string): Promise<void> {
  for (const role of SYSTEM_ROLES) {
    await ensureRow.call(
      this,
      `INSERT INTO roles (company_id, name, description, permissions, is_system)
       SELECT $1::uuid, $2::text, $3::text, $4::text, TRUE
       WHERE NOT EXISTS (SELECT 1 FROM roles WHERE company_id = $1::uuid AND name = $2::text)
       RETURNING id`,
      [companyId, role.name, `${role.name_ar} — ${role.description}`, JSON.stringify(role.permissions)],
      `SELECT id FROM roles WHERE company_id = $1::uuid AND name = $2::text LIMIT 1`,
      [companyId, role.name]
    );
  }
}

// Default accountant user — same password as the seeded admin so the operator
// gets a working non-admin login out of the box (no extra credential to show).
async function seedAccountantUser(
  this: DbAdapter,
  companyId: string,
  passwordHash: string
): Promise<string> {
  const id = await ensureRow.call(
    this,
    `INSERT INTO users (company_id, username, email, full_name, password_hash, role, is_active)
     SELECT $1::uuid, 'accountant', 'accountant@demo.ye', 'محاسب الشركة', $2::text, 'accountant', TRUE
     WHERE NOT EXISTS (SELECT 1 FROM users WHERE company_id = $1::uuid AND username = 'accountant')
     RETURNING id`,
    [companyId, passwordHash],
    `SELECT id FROM users WHERE company_id = $1::uuid AND username = 'accountant' LIMIT 1`,
    [companyId]
  );
  if (!id) throw new Error('Failed to create accountant user');
  return id;
}

async function seedCustomers(this: DbAdapter, companyId: string): Promise<void> {
  for (const c of CUSTOMERS) {
    await ensureRow.call(
      this,
      `INSERT INTO customers (company_id, code, name, phone, email, address, balance, is_active)
       SELECT $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text, $7::numeric, TRUE
       WHERE NOT EXISTS (SELECT 1 FROM customers WHERE company_id = $1::uuid AND code = $2::text)
       RETURNING id`,
      [companyId, c.code, c.name, c.phone, c.email, c.address, c.balance],
      `SELECT id FROM customers WHERE company_id = $1::uuid AND code = $2::text LIMIT 1`,
      [companyId, c.code]
    );
  }
}

async function seedSuppliers(this: DbAdapter, companyId: string): Promise<void> {
  for (const s of SUPPLIERS) {
    await ensureRow.call(
      this,
      `INSERT INTO suppliers (company_id, code, name, phone, email, address, balance, is_active)
       SELECT $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text, 0, TRUE
       WHERE NOT EXISTS (SELECT 1 FROM suppliers WHERE company_id = $1::uuid AND code = $2::text)
       RETURNING id`,
      [companyId, s.code, s.name, s.phone, s.email, s.address],
      `SELECT id FROM suppliers WHERE company_id = $1::uuid AND code = $2::text LIMIT 1`,
      [companyId, s.code]
    );
  }
}

async function seedProductCategories(this: DbAdapter, companyId: string): Promise<Map<string, string>> {
  const catIdByName = new Map<string, string>();
  for (const name of PRODUCT_CATEGORIES) {
    const id = await ensureRow.call(
      this,
      `INSERT INTO product_categories (company_id, name)
       SELECT $1::uuid, $2::text
       WHERE NOT EXISTS (SELECT 1 FROM product_categories WHERE company_id = $1::uuid AND name = $2::text)
       RETURNING id`,
      [companyId, name],
      `SELECT id FROM product_categories WHERE company_id = $1::uuid AND name = $2::text LIMIT 1`,
      [companyId, name]
    );
    if (id) catIdByName.set(name, id);
  }
  return catIdByName;
}

async function seedProducts(
  this: DbAdapter,
  companyId: string,
  adminId: string,
  typeCodeToId: Map<string, string>,
  catIdByName: Map<string, string>
): Promise<Map<string, string>> {
  const productIdByCode = new Map<string, string>();
  const foodCatId = catIdByName.get('المواد الغذائية') || null;
  for (const p of PRODUCTS) {
    const typeId = typeCodeToId.get(p.type) || null;
    const id = await ensureRow.call(
      this,
      `INSERT INTO products (company_id, code, name_ar, name_en, barcode, sku, unit, category_id, product_type_id, cost_price, sale_price, is_active, created_by, updated_by)
       SELECT $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text, $7::text, $8::uuid, $9::uuid, $10::numeric, $11::numeric, TRUE, $12::uuid, $12::uuid
       WHERE NOT EXISTS (SELECT 1 FROM products WHERE company_id = $1::uuid AND code = $2::text)
       RETURNING id`,
      [companyId, p.code, p.name_ar, p.name_en, p.barcode, p.sku, p.unit, foodCatId, typeId, p.cost, p.price, adminId],
      `SELECT id FROM products WHERE company_id = $1::uuid AND code = $2::text LIMIT 1`,
      [companyId, p.code]
    );
    if (id) {
      productIdByCode.set(p.code, id);
      if (foodCatId) {
        await this.query(
          `INSERT INTO product_product_categories (product_id, category_id)
           SELECT $1::uuid, $2::uuid
           WHERE NOT EXISTS (SELECT 1 FROM product_product_categories WHERE product_id = $1::uuid AND category_id = $2::uuid)`,
          [id, foodCatId]
        );
      }
    }
  }
  return productIdByCode;
}

async function seedWarehouses(this: DbAdapter, companyId: string): Promise<Map<string, string>> {
  const whIdByCode = new Map<string, string>();
  for (const w of WAREHOUSES) {
    const id = await ensureRow.call(
      this,
      `INSERT INTO warehouses (company_id, name, code, is_active)
       SELECT $1::uuid, $2::text, $3::text, TRUE
       WHERE NOT EXISTS (SELECT 1 FROM warehouses WHERE company_id = $1::uuid AND code = $3::text)
       RETURNING id`,
      [companyId, w.name, w.code],
      `SELECT id FROM warehouses WHERE company_id = $1::uuid AND code = $2::text LIMIT 1`,
      [companyId, w.code]
    );
    if (id) whIdByCode.set(w.code, id);
  }
  return whIdByCode;
}

async function seedStock(
  this: DbAdapter,
  companyId: string,
  adminId: string,
  productIdByCode: Map<string, string>,
  whIdByCode: Map<string, string>
): Promise<void> {
  const mainWhId = whIdByCode.get('WH-MAIN');
  if (!mainWhId) return;
  for (let i = 0; i < PRODUCTS.length; i++) {
    const p = PRODUCTS[i];
    const productId = productIdByCode.get(p.code);
    if (!productId) continue;
    const qty = STOCK_QTYS[i] || 100;
    const minAlert = Math.max(10, Math.round(qty * 0.1));
    await ensureRow.call(
      this,
      `INSERT INTO stock (company_id, product_id, warehouse_id, quantity, min_stock_alert)
       SELECT $1::uuid, $2::uuid, $3::uuid, $4::numeric, $5::numeric
       WHERE NOT EXISTS (SELECT 1 FROM stock WHERE product_id = $2::uuid AND warehouse_id = $3::uuid)
       RETURNING id`,
      [companyId, productId, mainWhId, qty, minAlert],
      `SELECT id FROM stock WHERE product_id = $1::uuid AND warehouse_id = $2::uuid LIMIT 1`,
      [productId, mainWhId]
    );
    await ensureRow.call(
      this,
      `INSERT INTO stock_movements (company_id, product_id, warehouse_id, type, quantity, reference, notes, created_by, updated_by)
       SELECT $1::uuid, $2::uuid, $3::uuid, 'in', $4::numeric, 'OPENING-BALANCE', 'رصيد افتتاحي', $5::uuid, $5::uuid
       WHERE NOT EXISTS (SELECT 1 FROM stock_movements WHERE reference = 'OPENING-BALANCE' AND product_id = $2::uuid)
       RETURNING id`,
      [companyId, productId, mainWhId, qty, adminId],
      `SELECT id FROM stock_movements WHERE reference = 'OPENING-BALANCE' AND product_id = $1::uuid LIMIT 1`,
      [productId]
    );
  }
}

async function seedDepartments(this: DbAdapter, companyId: string): Promise<Map<string, string>> {
  const deptIdByName = new Map<string, string>();
  for (const name of DEPARTMENTS) {
    const id = await ensureRow.call(
      this,
      `INSERT INTO departments (company_id, name)
       SELECT $1::uuid, $2::text
       WHERE NOT EXISTS (SELECT 1 FROM departments WHERE company_id = $1::uuid AND name = $2::text)
       RETURNING id`,
      [companyId, name],
      `SELECT id FROM departments WHERE company_id = $1::uuid AND name = $2::text LIMIT 1`,
      [companyId, name]
    );
    if (id) deptIdByName.set(name, id);
  }
  return deptIdByName;
}

async function seedEmployees(
  this: DbAdapter,
  companyId: string,
  adminId: string,
  deptIdByName: Map<string, string>
): Promise<Map<string, string>> {
  const empIdByNumber = new Map<string, string>();
  for (const emp of EMPLOYEES) {
    const deptId = deptIdByName.get(emp.dept) || null;
    const id = await ensureRow.call(
      this,
      `INSERT INTO employees (company_id, employee_number, full_name, phone, email, department_id, position, grade, hire_date, base_salary, is_active, created_by, updated_by)
       SELECT $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::uuid, $7::text, $8::text, $9::date, $10::numeric, TRUE, $11::uuid, $11::uuid
       WHERE NOT EXISTS (SELECT 1 FROM employees WHERE company_id = $1::uuid AND employee_number = $2::text)
       RETURNING id`,
      [companyId, emp.number, emp.name, emp.phone, emp.email, deptId, emp.position, emp.grade, emp.hire_date, emp.salary, adminId],
      `SELECT id FROM employees WHERE company_id = $1::uuid AND employee_number = $2::text LIMIT 1`,
      [companyId, emp.number]
    );
    if (id) empIdByNumber.set(emp.number, id);
  }
  return empIdByNumber;
}

async function seedPayrollComponents(this: DbAdapter, companyId: string): Promise<void> {
  for (const pc of PAYROLL_COMPONENTS) {
    await ensureRow.call(
      this,
      `INSERT INTO payroll_components (company_id, code, name_ar, name_en, type, calculation_method, default_amount, affects_gross_salary, affects_tax, affects_social_insurance, is_active)
       SELECT $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text, $7::numeric, $8::bool, $9::bool, $10::bool, TRUE
       WHERE NOT EXISTS (SELECT 1 FROM payroll_components WHERE company_id = $1::uuid AND code = $2::text)
       RETURNING id`,
      [companyId, pc.code, pc.name_ar, pc.name_en, pc.type, pc.method, pc.amount, pc.gross, pc.tax, pc.ins],
      `SELECT id FROM payroll_components WHERE company_id = $1::uuid AND code = $2::text LIMIT 1`,
      [companyId, pc.code]
    );
  }
}

async function seedLeads(this: DbAdapter, companyId: string, adminId: string): Promise<Map<string, string>> {
  const leadIdByPhone = new Map<string, string>();
  for (const lead of LEADS) {
    const id = await ensureRow.call(
      this,
      `INSERT INTO leads (company_id, name, phone, email, company, source, status, estimated_value, notes, created_by, updated_by)
       SELECT $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text, $7::text, $8::numeric, $9::text, $10::uuid, $10::uuid
       WHERE NOT EXISTS (SELECT 1 FROM leads WHERE company_id = $1::uuid AND phone = $3::text)
       RETURNING id`,
      [companyId, lead.name, lead.phone, lead.email, lead.company, lead.source, lead.status, lead.value, lead.notes, adminId],
      `SELECT id FROM leads WHERE company_id = $1::uuid AND phone = $2::text LIMIT 1`,
      [companyId, lead.phone]
    );
    if (id) leadIdByPhone.set(lead.phone, id);
  }
  return leadIdByPhone;
}

export const pgliteAdapter: DbAdapter = {
  async ping() {
    try {
      const db = await getInstance();
      const res = await db.query('SELECT version() AS version');
      const version = (res.rows[0] as { version?: string } | undefined)?.version || 'PostgreSQL (PGlite)';
      return { success: true, db: 'PGlite (local)', message: version };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  async query<T = any>(sql: string, params?: any[]): Promise<{ success: boolean; rows?: T[]; error?: string }> {
    try {
      const db = await getInstance();
      await runPgliteMigrations();
      const pgSql = convertPlaceholders(sql);
      const result = await db.query(pgSql, params || []);
      return normalizeResult(result);
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  async transaction(queries: { sql: string; params?: any[] }[]): Promise<{ success: boolean; results?: any[]; error?: string }> {
    try {
      const db = await getInstance();
      await runPgliteMigrations();
      const results: any[] = [];
      await db.exec('BEGIN');
      try {
        for (const q of queries) {
          const pgSql = convertPlaceholders(q.sql);
          const result = await db.query(pgSql, q.params || []);
          results.push({ rows: result.rows, rowCount: result.rows?.length || 0 });
        }
        await db.exec('COMMIT');
        return { success: true, results };
      } catch (err) {
        await db.exec('ROLLBACK');
        throw err;
      }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  async getCompany() {
    const result = await this.query('SELECT * FROM companies LIMIT 1');
    if (result.success && result.rows && result.rows.length > 0) {
      return { success: true, data: result.rows[0] };
    }
    return { success: false, error: 'No company found' };
  },

  async updateCompany(data: any, updatedBy?: string) {
    if (!data?.id) return { success: false, error: 'Company id required' };
    return this.query(
      `UPDATE companies SET name = $1, name_en = $2, currency = $3, tax_number = $4, address = $5, phone = $6, email = $7, updated_by = $8, updated_at = NOW() WHERE id = $9`,
      [data.name, data.nameEn, data.currency, data.taxNumber, data.address, data.phone, data.email, updatedBy || null, data.id]
    );
  },

  async getAccounts(companyId: string) {
    const result = await this.query('SELECT * FROM accounts WHERE company_id = $1 ORDER BY code', [companyId]);
    return { success: result.success, data: result.rows, error: result.error };
  },

  async createAccount(data: any) {
    const result = await this.query(
      `INSERT INTO accounts (company_id, code, name_ar, name_en, parent_id, type, nature, is_group, balance)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [data.companyId, data.code, data.nameAr, data.nameEn, data.parentId, data.type, data.nature, data.isGroup, data.balance || 0],
    );
    if (result.success && result.rows?.length && (result.rows[0] as { id?: unknown }).id) {
      return { success: true, id: String((result.rows[0] as { id: unknown }).id) };
    }
    return { success: false, error: result.error };
  },

  async getTransactions(companyId: string) {
    const txResult = await this.query('SELECT * FROM transactions WHERE company_id = $1 ORDER BY date DESC', [companyId]);
    if (!txResult.success) return { success: false, error: txResult.error };

    const transactions = (txResult.rows || []) as Record<string, unknown>[];
    if (transactions.length === 0) return { success: true, data: [] };

    const txIds = transactions.map((t) => String(t.id));
    const entriesResult = await this.query(
      `SELECT je.*, a.name_ar as account_name, a.code as account_code
       FROM journal_entries je
       LEFT JOIN accounts a ON je.account_id = a.id
       WHERE je.transaction_id = ANY($1)`,
      [txIds],
    );

    const allEntries = (entriesResult.rows || []) as Record<string, unknown>[];
    const entriesByTx = new Map<string, Record<string, unknown>[]>();
    for (const entry of allEntries) {
      const txId = String(entry.transaction_id || entry.transactionId);
      if (!entriesByTx.has(txId)) entriesByTx.set(txId, []);
      entriesByTx.get(txId)!.push(entry);
    }

    for (const tx of transactions) {
      const txId = String(tx.id);
      const txEntries = entriesByTx.get(txId) || [];
      tx.entries = txEntries.map((row: Record<string, unknown>) => ({
        id: row.id,
        transactionId: row.transaction_id || row.transactionId,
        accountId: row.account_id || row.accountId,
        account: row.account_name ? {
          id: row.account_id || row.accountId,
          nameAr: row.account_name || row.accountName,
          code: row.account_code || row.accountCode,
        } : undefined,
        debit: Number(row.debit) || 0,
        credit: Number(row.credit) || 0,
        memo: row.memo,
      }));
    }

    return { success: true, data: transactions };
  },

  async createTransaction(data: any) {
    const entries = data.entries || [];
    if (entries.length === 0) return { success: false, error: 'No journal entries provided' };

    const entryValues: string[] = [];
    const params: unknown[] = [
      data.companyId, data.date, data.reference, data.description,
      data.totalAmount, data.status || 'posted',
    ];
    let paramIdx = 7;

    for (const entry of entries) {
      entryValues.push(`((SELECT id FROM new_tx), $${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4})`);
      params.push(entry.accountId, entry.debit, entry.credit, entry.memo, data.companyId);
      paramIdx += 5;
    }

    const sql = `
      WITH new_tx AS (
        INSERT INTO transactions (company_id, date, reference, description, total_amount, status)
        VALUES ($1, $2::timestamptz, $3, $4, $5, $6)
        RETURNING id
      )
      INSERT INTO journal_entries (transaction_id, account_id, debit, credit, memo, company_id)
      VALUES ${entryValues.join(', ')}
      RETURNING transaction_id
    `;

    const result = await this.query(sql, params);
    if (result.success && result.rows?.[0]) {
      return { success: true, id: String((result.rows[0] as { transaction_id: unknown }).transaction_id) };
    }
    return { success: false, error: result.error || 'Failed to create transaction' };
  },

  async getProducts(companyId: string) {
    const result = await this.query(
      `SELECT p.*, COALESCE(
        (SELECT json_agg(ppc.category_id)
         FROM product_product_categories ppc
         WHERE ppc.product_id = p.id), '[]'::json
      ) AS category_ids
      FROM products p
      WHERE p.company_id = $1
      ORDER BY p.name_ar`,
      [companyId],
    );
    if (!result.success) return { success: false, error: result.error };
    const rows = (result.rows || []).map((r: Record<string, unknown>) => ({
      ...r,
      categoryIds: Array.isArray(r.category_ids) ? r.category_ids : [],
    }));
    return { success: true, data: rows };
  },

  async createProduct(data: any) {
    const result = await this.query(
      `INSERT INTO products (company_id, code, name_ar, name_en, barcode, sku, unit, category_id, product_type_id, cost_price, sale_price, is_active, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
      [data.companyId, data.code, data.nameAr, data.nameEn, data.barcode, data.sku, data.unit, data.categoryId ?? null, data.productTypeId ?? null, data.costPrice, data.salePrice, data.isActive ?? true, data.createdBy ?? null, data.updatedBy ?? null],
    );
    if (result.success && result.rows?.length && (result.rows[0] as { id?: unknown }).id) {
      const productId = String((result.rows[0] as { id: unknown }).id);
      if (Array.isArray(data.categoryIds) && data.categoryIds.length > 0) {
        const catValues = data.categoryIds.map((_: string, i: number) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(', ');
        const catParams = data.categoryIds.flatMap((cid: string) => [productId, cid]);
        await this.query(
          `INSERT INTO product_product_categories (product_id, category_id) VALUES ${catValues} ON CONFLICT DO NOTHING`,
          catParams,
        );
      }
      return { success: true, id: productId };
    }
    return { success: false, error: result.error };
  },

  async getContacts(companyId: string, type?: string) {
    const params: unknown[] = [companyId];
    let finalSql: string;
    if (!type || type === 'customer') {
      finalSql = `SELECT id, company_id, 'customer' AS type, name, phone, email, address,
                  tax_number, balance, is_active, created_at, updated_at
                  FROM customers WHERE company_id = $1 ORDER BY name`;
    } else {
      finalSql = `SELECT id, company_id, 'supplier' AS type, name, phone, email, address,
                  tax_number, balance, is_active, created_at, updated_at
                  FROM suppliers WHERE company_id = $1 ORDER BY name`;
    }
    const result = await this.query(finalSql, params);
    return { success: result.success, data: result.rows, error: result.error };
  },

  async createContact(data: any) {
    if (data.type === 'supplier') {
      const result = await this.query(
        `INSERT INTO suppliers (company_id, code, name, phone, email, address, tax_number, balance)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [data.companyId, data.code ?? null, data.name, data.phone ?? null, data.email ?? null, data.address ?? null, data.taxNumber ?? null, data.balance || 0],
      );
      return result.success && result.rows?.length && (result.rows[0] as { id?: unknown }).id
        ? { success: true, id: String((result.rows[0] as { id: unknown }).id) }
        : { success: false, error: result.error };
    }
    const result = await this.query(
      `INSERT INTO customers (company_id, code, name, phone, email, address, tax_number, balance)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [data.companyId, data.code ?? null, data.name, data.phone ?? null, data.email ?? null, data.address ?? null, data.taxNumber ?? null, data.balance || 0],
    );
    return result.success && result.rows?.length && (result.rows[0] as { id?: unknown }).id
      ? { success: true, id: String((result.rows[0] as { id: unknown }).id) }
      : { success: false, error: result.error };
  },

  // Onboarding / Seeding — PGlite is local, no external config needed
  async updateConfig(_config: { host?: string; port?: number | string; database?: string; user?: string; password?: string }) {
    try {
      // PGlite is local (IndexedDB in browser, file in Node). No external config to update.
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  async clearAll(payload?: { confirm?: boolean; username?: string; password?: string }) {
    try {
      if (!payload?.confirm) {
        return { success: false, error: 'Confirmation required to clear all data.' };
      }
      // Delete in FK-safe order. ON DELETE CASCADE on company_id will cascade to most tables.
      // We explicitly delete from tables that may not have CASCADE on company_id.
      const tables = [
        'audit_logs',
        'stock_movements',
        'stock_adjustments',
        'stock',
        'warehouse_transfers',
        'warehouses',
        'product_product_categories',
        'products',
        'product_categories',
        'product_types',
        'units',
        'currencies',
        'vat_settings',
        'default_accounts',
        'cost_centers',
        'cash_boxes',
        'banks',
        'payroll_lines',
        'payroll_runs',
        'payroll_components',
        'employees',
        'departments',
        'leads',
        'opportunities',
        'crm_activities',
        'tasks',
        'activities',
        'receipt_vouchers',
        'payment_vouchers',
        'sales_return_lines',
        'sales_returns',
        'sales_invoice_lines',
        'sales_invoices',
        'quotation_lines',
        'quotations',
        'purchase_return_lines',
        'purchase_returns',
        'purchase_invoice_lines',
        'purchase_invoices',
        'purchase_order_lines',
        'purchase_orders',
        'work_order_consumptions',
        'work_orders',
        'bom_lines',
        'boms',
        'journal_entries',
        'transactions',
        'accounts',
        'document_sequences',
        'branches',
        'users',
        'roles',
        'companies',
      ];
      for (const table of tables) {
        await this.query(`DELETE FROM ${table}`, []);
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  async seedDefault(this: DbAdapter, adminPassword?: string) {
    try {
      // Ensure migrations are applied
      await runPgliteMigrations();

      // Use provided password if >= 8 chars, otherwise generate a random one
      const provided = typeof adminPassword === 'string' && adminPassword.length >= 8;
      const finalPassword = provided ? adminPassword as string : randomPassword();
      const passwordHash = await hashPassword(finalPassword);

      // Create company + admin user
      const { companyId, adminId } = await seedCompanyAndAdmin.call(this, passwordHash);

      // Seed the full default-settings set (chart of accounts, numbering,
      // currencies, VAT, branches, units, cost centers, banks, cash box,
      // default accounts, product types, product categories, roles + a
      // default accountant user) so the company is usable out of the box —
      // matching the desktop seed behaviour.
      const codeToId = await seedChartOfAccounts.call(this, companyId);
      await seedCurrencies.call(this, companyId, adminId);
      await seedVatSettings.call(this, companyId);
      await seedDocumentSequences.call(this, companyId);
      await seedBranches.call(this, companyId, adminId);
      await seedProductTypes.call(this, companyId, adminId, codeToId);
      await seedUnits.call(this, companyId);
      await seedCostCenters.call(this, companyId);
      await seedBanks.call(this, companyId, codeToId);
      await seedCashBoxes.call(this, companyId, adminId, codeToId);
      await seedDefaultAccounts.call(this, companyId, codeToId);
      await seedProductCategories.call(this, companyId);
      await seedRoles.call(this, companyId);
      await seedAccountantUser.call(this, companyId, passwordHash);

      return {
        success: true,
        companyId,
        adminId,
        adminPassword: provided ? undefined : finalPassword,
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  async seedDemo(this: DbAdapter, adminPassword?: string) {
    try {
      // Ensure migrations are applied
      await runPgliteMigrations();

      // Use provided password if >= 8 chars, otherwise generate a random one
      const provided = typeof adminPassword === 'string' && adminPassword.length >= 8;
      const finalPassword = provided ? adminPassword as string : randomPassword();
      const passwordHash = await hashPassword(finalPassword);

      // Create company + admin user
      const { companyId, adminId } = await seedCompanyAndAdmin.call(this, passwordHash);

      // Seed chart of accounts (required for any accounting operation)
      const codeToId = await seedChartOfAccounts.call(this, companyId);

      // System roles + default accountant user
      await seedRoles.call(this, companyId);
      await seedAccountantUser.call(this, companyId, passwordHash);

      // Seed master data in dependency order
      await seedCurrencies.call(this, companyId, adminId);
      await seedVatSettings.call(this, companyId);
      await seedDocumentSequences.call(this, companyId);
      await seedBranches.call(this, companyId, adminId);
      const typeCodeToId = await seedProductTypes.call(this, companyId, adminId, codeToId);
      await seedUnits.call(this, companyId);
      await seedCostCenters.call(this, companyId);
      await seedBanks.call(this, companyId, codeToId);
      await seedCashBoxes.call(this, companyId, adminId, codeToId);
      await seedDefaultAccounts.call(this, companyId, codeToId);
      await seedCustomers.call(this, companyId);
      await seedSuppliers.call(this, companyId);
      const catIdByName = await seedProductCategories.call(this, companyId);
      const productIdByCode = await seedProducts.call(this, companyId, adminId, typeCodeToId, catIdByName);
      const whIdByCode = await seedWarehouses.call(this, companyId);
      await seedStock.call(this, companyId, adminId, productIdByCode, whIdByCode);
      const deptIdByName = await seedDepartments.call(this, companyId);
      await seedEmployees.call(this, companyId, adminId, deptIdByName);
      await seedPayrollComponents.call(this, companyId);
      await seedLeads.call(this, companyId, adminId);

      return {
        success: true,
        companyId,
        adminId,
        adminPassword: provided ? undefined : finalPassword,
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};