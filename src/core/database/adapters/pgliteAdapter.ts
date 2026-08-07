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
  'net_salary', 'value', 'estimated_value', 'probability', 'duration',
  'estimated_cost', 'actual_cost', 'planned_cost', 'variance_cost', 'variance_qty',
  'unit_cost', 'actual_unit_cost', 'total_cost', 'stock_value', 'revenue', 'cost',
  'profit', 'avg_value', 'credit_limit', 'tax_rate', 'rate',
  'starting_number', 'current_number', 'increment_step', 'padding_length',
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
// Vite exposes the raw SQL files from the drizzle/ folder via `?raw` imports.
// We import them statically so they are bundled into the web build (this is how
// the app runs in a pure browser with no backend).

import schema0000 from '@root/drizzle/0000_unified_schema.sql?raw';
import schema0001 from '@root/drizzle/0001_multi_currency.sql?raw';
import schema0002 from '@root/drizzle/0002_bom_schema_fix.sql?raw';
import schema0003 from '@root/drizzle/0003_warehouse_transfer_columns.sql?raw';
import schema0004 from '@root/drizzle/0004_performance_indexes.sql?raw';
import schema0005 from '@root/drizzle/0005_work_order_status_updated_at.sql?raw';
import schema0006 from '@root/drizzle/0006_products_min_max_stock.sql?raw';
import schema0007 from '@root/drizzle/0007_opportunity_stage_default.sql?raw';
import schema0008 from '@root/drizzle/0008_voucher_cash_box_id.sql?raw';
import schema0009 from '@root/drizzle/0009_performance_indexes_phase2.sql?raw';
import schema0010 from '@root/drizzle/0010_schema_drift_fix.sql?raw';
import schema0011 from '@root/drizzle/0011_manufacturing_schema_fix.sql?raw';
import schema0012 from '@root/drizzle/0012_purchase_invoice_lines_percents.sql?raw';
import schema0013 from '@root/drizzle/0013_hr_schema_drift_fix.sql?raw';
import schema0014 from '@root/drizzle/0014_audit_logs_table.sql?raw';
import schema0015 from '@root/drizzle/0015_payment_allocation.sql?raw';
import schema0016 from '@root/drizzle/0016_ai_chat_persistence.sql?raw';
import schema0017 from '@root/drizzle/0017_settings_unique.sql?raw';
import schema0018 from '@root/drizzle/0018_sequence_numbering.sql?raw';
import schema0019 from '@root/drizzle/0019_payment_type.sql?raw';
import schema0020 from '@root/drizzle/0020_invoice_payment_accounts.sql?raw';
import schema0021 from '@root/drizzle/0021_user_tracking_columns.sql?raw';
import schema0022 from '@root/drizzle/0022_audit_and_document_sequences_fix.sql?raw';
import schema0023 from '@root/drizzle/0023_activities_user_tracking_columns.sql?raw';

const MIGRATIONS: { name: string; sql: string }[] = [
  { name: '0000_unified_schema', sql: schema0000 },
  { name: '0001_multi_currency', sql: schema0001 },
  { name: '0002_bom_schema_fix', sql: schema0002 },
  { name: '0003_warehouse_transfer_columns', sql: schema0003 },
  { name: '0004_performance_indexes', sql: schema0004 },
  { name: '0005_work_order_status_updated_at', sql: schema0005 },
  { name: '0006_products_min_max_stock', sql: schema0006 },
  { name: '0007_opportunity_stage_default', sql: schema0007 },
  { name: '0008_voucher_cash_box_id', sql: schema0008 },
  { name: '0009_performance_indexes_phase2', sql: schema0009 },
  { name: '0010_schema_drift_fix', sql: schema0010 },
  { name: '0011_manufacturing_schema_fix', sql: schema0011 },
  { name: '0012_purchase_invoice_lines_percents', sql: schema0012 },
  { name: '0013_hr_schema_drift_fix', sql: schema0013 },
  { name: '0014_audit_logs_table', sql: schema0014 },
  { name: '0015_payment_allocation', sql: schema0015 },
  { name: '0016_ai_chat_persistence', sql: schema0016 },
  { name: '0017_settings_unique', sql: schema0017 },
  { name: '0018_sequence_numbering', sql: schema0018 },
  { name: '0019_payment_type', sql: schema0019 },
  { name: '0020_invoice_payment_accounts', sql: schema0020 },
  { name: '0021_user_tracking_columns', sql: schema0021 },
  { name: '0022_audit_and_document_sequences_fix', sql: schema0022 },
  { name: '0023_activities_user_tracking_columns', sql: schema0023 },
];

/**
 * Run all pending migrations. Tracks applied migrations in a
 * `__pglite_migrations` table so it is idempotent across reloads.
 */
export async function runPgliteMigrations(): Promise<{ success: boolean; error?: string }> {
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
      await db.exec(migration.sql);
      await db.query('INSERT INTO __pglite_migrations (name) VALUES ($1)', [migration.name]);
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
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
};