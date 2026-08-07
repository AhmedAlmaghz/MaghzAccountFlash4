import type { DbAdapter } from './types';

export interface ElectronDB extends PreloadDB {
  updateConfig?(config: { host?: string; port?: number | string; database?: string; user?: string; password?: string }): Promise<{ success: boolean; error?: string }>;
  testConnection?(config: { host?: string; port?: number | string; database?: string; user?: string; password?: string }): Promise<{ success: boolean; db?: string; version?: string; error?: string }>;
  clearAll?(payload?: { confirm?: boolean; username?: string; password?: string }): Promise<{ success: boolean; error?: string }>;
  seedDefault?(adminPassword?: string): Promise<{ success: boolean; companyId?: string; adminPassword?: string; error?: string }>;
  seedDemo?(adminPassword?: string): Promise<{ success: boolean; companyId?: string; adminPassword?: string; error?: string }>;
  reset?(): Promise<{ success: boolean; error?: string }>;
}

interface PreloadDB {
  ping(): Promise<{ success: boolean; message?: string; db?: string }>;
  _exec(sql: string, params?: unknown[]): Promise<{ success: boolean; rows?: Record<string, unknown>[]; error?: string }>;
  _execBatch(queries: { sql: string; params?: unknown[] }[]): Promise<{ success: boolean; results?: unknown[][]; error?: string }>;
}

interface ElectronAuth {
  login(credentials: { username: string; password: string }): Promise<{
    success: boolean;
    user?: { id: string; companyId: string; username: string; role: string; roleId?: string; branchId?: string; email?: string; fullName?: string; phone?: string; isActive: boolean };
    permissions?: string[];
    error?: string;
  }>;
  getSession(): Promise<{ success: boolean; user?: ElectronAuthUser; permissions?: string[] }>;
  logout(): Promise<{ success: boolean }>;
  listUsers(): Promise<{ success: boolean; data?: Record<string, unknown>[]; error?: string }>;
  createUser(data: Record<string, unknown>): Promise<{ success: boolean; id?: string; error?: string }>;
  updateUser(id: string, data: Record<string, unknown>): Promise<{ success: boolean; error?: string }>;
  resetPassword(id: string, password: string): Promise<{ success: boolean; error?: string }>;
  deleteUser(id: string): Promise<{ success: boolean; error?: string }>;
  listRoles(): Promise<{ success: boolean; data?: Record<string, unknown>[]; error?: string }>;
  createRole(data: Record<string, unknown>): Promise<{ success: boolean; id?: string; error?: string }>;
  updateRole(id: string, data: Record<string, unknown>): Promise<{ success: boolean; error?: string }>;
  deleteRole(id: string): Promise<{ success: boolean; error?: string }>;
  getAuditLogs(filters?: object): Promise<{ success: boolean; data?: Record<string, unknown>[]; error?: string }>;
}

interface ElectronAuthUser {
  id: string;
  companyId: string;
  username: string;
  role: string;
  roleId?: string;
  branchId?: string;
  email?: string;
  fullName?: string;
  phone?: string;
  isActive: boolean;
}

declare global {
  interface Window {
    electronDB?: ElectronDB;
    electronAuth?: ElectronAuth;
  }
}

// Use window.electronDB exposed by preload script
// This avoids importing 'electron' directly which breaks browser builds
function getDB(): PreloadDB {
  if (typeof window !== 'undefined' && window.electronDB) {
    return window.electronDB;
  }
  throw new Error('electronDB not available');
}

// PostgreSQL numeric types are returned as strings by node-postgres.
// Auto-convert known numeric columns to actual JS numbers to avoid NaN / "ليس رقماً".
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

function normalizeResult<T = unknown>(result: { success: boolean; rows?: Record<string, unknown>[]; error?: string }): { success: boolean; rows?: T[]; error?: string } {
  if (result.success && result.rows) {
    return { ...result, rows: result.rows.map(normalizeRow) as unknown as T[] };
  }
  return result as { success: boolean; rows?: T[]; error?: string };
}

/** Convert SQLite-style ? placeholders to PostgreSQL $1, $2... */
function convertPlaceholders(sql: string): string {
  let i = 1;
  return sql.replace(/\?/g, () => `$${i++}`);
}
// ensure-rebuild: v2

/**
 * Electron IPC Adapter (PostgreSQL via main process)
 * Used when running in Electron with PostgreSQL available
 */
export const electronPgAdapter: DbAdapter = {
  async ping() {
    return getDB().ping();
  },

  async query(sql, params) {
    const pgSql = convertPlaceholders(sql);
    const raw = await getDB()._exec(pgSql, params);
    return normalizeResult(raw);
  },

  async transaction(queries) {
    const pgQueries = queries.map(q => ({
      sql: convertPlaceholders(q.sql),
      params: q.params,
    }));
    const raw = await getDB()._execBatch(pgQueries);
    return raw;
  },

  async getCompany() {
    const raw = await getDB()._exec('SELECT * FROM companies LIMIT 1');
    const result = normalizeResult(raw);
    if (result.success && result.rows && result.rows.length > 0) {
      return { success: true, data: result.rows[0] };
    }
    return { success: false, error: 'No company found' };
  },

  async getAccounts(companyId) {
    const result = await getDB()._exec(
      'SELECT * FROM accounts WHERE company_id = $1 ORDER BY code',
      [companyId],
    );
    return { success: result.success, data: result.rows, error: result.error };
  },

  async createAccount(data) {
    const result = await getDB()._exec(
      `INSERT INTO accounts (company_id, code, name_ar, name_en, parent_id, type, nature, is_group, balance)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [data.companyId, data.code, data.nameAr, data.nameEn, data.parentId, data.type, data.nature, data.isGroup, data.balance || 0],
    );
    if (result.success && result.rows?.length && result.rows[0]) {
      return { success: true, id: String(result.rows[0].id) };
    }
    return { success: false, error: result.error };
  },

  async getTransactions(companyId) {
    // Fetch transactions and entries separately to avoid json_agg issues
    const txResult = await getDB()._exec(
      `SELECT * FROM transactions WHERE company_id = $1 ORDER BY date DESC`,
      [companyId],
    );
    if (!txResult.success) return { success: false, error: txResult.error };
    
    const transactions = (normalizeResult<Record<string, unknown>>(txResult).rows || []) as Record<string, unknown>[];
    if (transactions.length === 0) {
      return { success: true, data: [] };
    }

    const txIds = transactions.map((t) => String(t.id));
    const entriesResult = await getDB()._exec(
      `SELECT je.*, a.name_ar as account_name, a.code as account_code 
       FROM journal_entries je 
       LEFT JOIN accounts a ON je.account_id = a.id 
       WHERE je.transaction_id = ANY($1)`,
      [txIds],
    );
    
    const allEntries = (normalizeResult(entriesResult).rows || []) as Record<string, unknown>[];
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
          code: row.account_code || row.accountCode 
        } : undefined,
        debit: Number(row.debit) || 0,
        credit: Number(row.credit) || 0,
        memo: row.memo,
      }));
    }
    
    return { success: true, data: transactions };
  },

  async createTransaction(data) {
    const entries = data.entries || [];
    if (entries.length === 0) {
      return { success: false, error: 'No journal entries provided' };
    }

    // Build VALUES for journal entries
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

    const result = await getDB()._exec(sql, params);

    if (result.success && result.rows?.[0]) {
      return { success: true, id: String((result.rows[0] as { transaction_id: unknown }).transaction_id) };
    }
    return { success: false, error: result.error || 'Failed to create transaction' };
  },

  async getProducts(companyId) {
    const result = await getDB()._exec(
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
    if (!result.success) {
      return { success: false, error: result.error };
    }
    const rows = (result.rows || []).map((r: Record<string, unknown>) => ({
      ...r,
      categoryIds: Array.isArray(r.category_ids) ? r.category_ids : [],
    }));
    return { success: true, data: rows };
  },

  async createProduct(data) {
    const result = await getDB()._exec(
      `INSERT INTO products (company_id, code, name_ar, name_en, barcode, sku, unit, category_id, product_type_id, cost_price, sale_price, is_active, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
      [data.companyId, data.code, data.nameAr, data.nameEn, data.barcode, data.sku, data.unit, data.categoryId ?? null, data.productTypeId ?? null, data.costPrice, data.salePrice, data.isActive ?? true, data.createdBy ?? null, data.updatedBy ?? null],
    );
    if (result.success && result.rows?.length && result.rows[0]) {
      const productId = String(result.rows[0].id);
      if (Array.isArray(data.categoryIds) && data.categoryIds.length > 0) {
        const catValues = data.categoryIds.map((_: string, i: number) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(', ');
        const catParams = data.categoryIds.flatMap((cid: string) => [productId, cid]);
        await getDB()._exec(
          `INSERT INTO product_product_categories (product_id, category_id) VALUES ${catValues} ON CONFLICT DO NOTHING`,
          catParams,
        );
      }
      return { success: true, id: productId };
    }
    return { success: false, error: result.error };
  },

  async getContacts(companyId, type) {
    // customers and suppliers are separate tables in the Drizzle schema.
    // The legacy `contacts` table does not exist; we route to the correct table.
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
    const result = await getDB()._exec(finalSql, params);
    return { success: result.success, data: result.rows, error: result.error };
  },

  async createContact(data) {
    // Route to the correct table based on type
    if (data.type === 'supplier') {
      const result = await getDB()._exec(
      `INSERT INTO suppliers (company_id, code, name, phone, email, address, tax_number, balance)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [data.companyId, data.code ?? null, data.name, data.phone ?? null, data.email ?? null, data.address ?? null, data.taxNumber ?? null, data.balance || 0],
      );
      return result.success && result.rows?.length && result.rows[0]
        ? { success: true, id: String(result.rows[0].id) }
        : { success: false, error: result.error };
    }
    // default to customer
    const result = await getDB()._exec(
      `INSERT INTO customers (company_id, code, name, phone, email, address, tax_number, balance)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [data.companyId, data.code ?? null, data.name, data.phone ?? null, data.email ?? null, data.address ?? null, data.taxNumber ?? null, data.balance || 0],
    );
    return result.success && result.rows?.length && result.rows[0]
      ? { success: true, id: String(result.rows[0].id) }
      : { success: false, error: result.error };
  },
};
