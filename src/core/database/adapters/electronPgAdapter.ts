import type { DbAdapter } from './types';

export interface ElectronDB extends PreloadDB {
  updateConfig?(config: { host?: string; port?: number | string; database?: string; user?: string; password?: string }): Promise<{ success: boolean; error?: string }>;
  testConnection?(config: { host?: string; port?: number | string; database?: string; user?: string; password?: string }): Promise<{ success: boolean; db?: string; version?: string; error?: string }>;
  clearAll?(payload?: { confirm?: boolean; username?: string; password?: string }): Promise<{ success: boolean; error?: string }>;
  seedDefault?(adminPassword?: string): Promise<{ success: boolean; companyId?: string; adminPassword?: string; error?: string }>;
  seedDemo?(adminPassword?: string): Promise<{ success: boolean; companyId?: string; adminPassword?: string; error?: string }>;
  reset?(): Promise<{ success: boolean; error?: string }>;

  // Typed RPC surface (Phase 4) — preferred over `_exec` for new code.
  // Each method sends a structured payload to a fixed SQL statement in
  // the main process; the renderer never composes SQL.
  accounting?: {
    getAccounts(payload: { companyId: string }): Promise<{ success: boolean; rows?: Record<string, unknown>[]; error?: string }>;
    createAccount(payload: { companyId: string; code: string; nameAr: string; nameEn?: string; parentId?: string | null; type?: string; nature?: string; isGroup?: boolean; balance?: number }): Promise<{ success: boolean; rows?: Record<string, unknown>[]; error?: string }>;
    getTransactions(payload: { companyId: string }): Promise<{ success: boolean; rows?: Record<string, unknown>[]; error?: string }>;
    createTransaction(payload: { data: { companyId: string; date: string; reference?: string; description?: string; totalAmount: number; status?: string; entries: Array<{ accountId: string; debit: number; credit: number; memo?: string }> } }): Promise<{ success: boolean; rows?: Record<string, unknown>[]; error?: string }>;
  };
  inventory?: {
    getProducts(payload: { companyId: string }): Promise<{ success: boolean; rows?: Record<string, unknown>[]; error?: string }>;
    createProduct(payload: { companyId: string; code: string; nameAr: string; nameEn?: string; barcode?: string | null; sku?: string | null; unit?: string | null; categoryId?: string | null; productTypeId?: string | null; costPrice?: number; salePrice?: number; isActive?: boolean; createdBy?: string | null; updatedBy?: string | null }): Promise<{ success: boolean; rows?: Record<string, unknown>[]; error?: string }>;
    createProductCategories(payload: { productId: string; categoryIds: string[] }): Promise<{ success: boolean; rows?: Record<string, unknown>[]; error?: string }>;
  };
  contacts?: {
    getCustomers(payload: { companyId: string }): Promise<{ success: boolean; rows?: Record<string, unknown>[]; error?: string }>;
    getSuppliers(payload: { companyId: string }): Promise<{ success: boolean; rows?: Record<string, unknown>[]; error?: string }>;
    createCustomer(payload: { companyId: string; code?: string | null; name: string; phone?: string | null; email?: string | null; address?: string | null; taxNumber?: string | null; balance?: number }): Promise<{ success: boolean; rows?: Record<string, unknown>[]; error?: string }>;
    createSupplier(payload: { companyId: string; code?: string | null; name: string; phone?: string | null; email?: string | null; address?: string | null; taxNumber?: string | null; balance?: number }): Promise<{ success: boolean; rows?: Record<string, unknown>[]; error?: string }>;
  };
  // Session-derived company scoping (Phase 4 slice 3). No company id in
  // payload; the main process uses the authenticated session. The renderer
  // can never reference another company's row.
  core?: {
    getCompany(payload?: Record<string, unknown>): Promise<{ success: boolean; rows?: Record<string, unknown>[]; error?: string }>;
    updateCompany(payload: { name: string; nameEn?: string | null; currency?: string | null; taxNumber?: string | null; address?: string | null; phone?: string | null; email?: string | null }): Promise<{ success: boolean; rows?: Record<string, unknown>[]; error?: string }>;
  };
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

// Typed RPC bridge — preferred path for new code. The renderer sends a
// structured payload and the main process composes the SQL. Each method
// returns the same normalized envelope as `_exec` so callers can use the
// existing `normalizeResult` helper.
type ElectronRpcSurface = NonNullable<Required<ElectronDB>['accounting']>
  & NonNullable<Required<ElectronDB>['inventory']>
  & NonNullable<Required<ElectronDB>['contacts']>
  & NonNullable<Required<ElectronDB>['core']>;

function getRPC(): ElectronRpcSurface {
  if (typeof window !== 'undefined' && window.electronDB) {
    const db = window.electronDB;
    const acc = db.accounting;
    const inv = db.inventory;
    const ctc = db.contacts;
    const core = db.core;
    if (!acc || !inv || !ctc || !core) {
      throw new Error('electronDB typed RPC surface not available (accounting/inventory/contacts/core)');
    }
    return {
      ...acc,
      ...inv,
      ...ctc,
      ...core,
    } as ElectronRpcSurface;
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
    // Typed RPC (Phase 4 slice 3) — the main process derives the company id
    // from the authenticated session, closing the cross-tenant read of the
    // legacy `SELECT * FROM companies LIMIT 1`.
    const raw = await getRPC().getCompany({});
    const result = normalizeResult(raw);
    if (result.success && result.rows && result.rows.length > 0) {
      return { success: true, data: result.rows[0] };
    }
    return { success: false, error: 'No company found' };
  },

  async updateCompany(data) {
    // Typed RPC (Phase 4 slice 3) — the main process scopes the UPDATE to
    // the authenticated session's company and derives `updated_by` from
    // the session. The renderer cannot touch another company's row.
    if (!data?.name) return { success: false, error: 'name required' };
    const result = await getRPC().updateCompany({
      name: data.name,
      nameEn: data.nameEn,
      currency: data.currency,
      taxNumber: data.taxNumber,
      address: data.address,
      phone: data.phone,
      email: data.email,
    });
    return result.success ? { success: true } : { success: false, error: result.error };
  },

  async getAccounts(companyId) {
    // Typed RPC (Phase 4): renderer sends { companyId }, main process
    // composes the SQL and runs the auth/RBAC checks.
    const result = await getRPC().getAccounts({ companyId });
    return { success: result.success, data: result.rows, error: result.error };
  },

  async createAccount(data) {
    const result = await getRPC().createAccount({
      companyId: data.companyId,
      code: data.code,
      nameAr: data.nameAr,
      nameEn: data.nameEn,
      parentId: data.parentId,
      type: data.type,
      nature: data.nature,
      isGroup: data.isGroup,
      balance: data.balance,
    });
    if (result.success && result.rows?.length && result.rows[0]) {
      return { success: true, id: String(result.rows[0].id) };
    }
    return { success: false, error: result.error };
  },

  async getTransactions(companyId) {
    // Typed RPC returns transactions with entries already embedded via
    // json_agg, so the renderer no longer needs a second round-trip.
    const result = await getRPC().getTransactions({ companyId });
    if (!result.success) return { success: false, error: result.error };
    const transactions = (normalizeResult<Record<string, unknown>>(result).rows || []) as Record<string, unknown>[];
    if (transactions.length === 0) return { success: true, data: [] };

    for (const tx of transactions) {
      const rawEntries = Array.isArray(tx.entries) ? (tx.entries as Record<string, unknown>[]) : [];
      tx.entries = rawEntries.map((row) => ({
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

  async createTransaction(data) {
    // Typed RPC composes the CTE + VALUES in the main process so the
    // renderer only sends structured data.
    const result = await getRPC().createTransaction({
      data: {
        companyId: data.companyId,
        date: data.date,
        reference: data.reference,
        description: data.description,
        totalAmount: data.totalAmount,
        status: data.status,
        entries: data.entries || [],
      },
    });
    if (result.success && result.rows?.[0]) {
      return { success: true, id: String((result.rows[0] as { transaction_id: unknown }).transaction_id) };
    }
    return { success: false, error: result.error || 'Failed to create transaction' };
  },

  async getProducts(companyId) {
    // Typed RPC (Phase 4 slice 2): main process composes the SQL with
    // json_agg for category_ids so the renderer doesn't need a second
    // round-trip to fetch the m2m mapping.
    const result = await getRPC().getProducts({ companyId });
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
    const result = await getRPC().createProduct({
      companyId: data.companyId,
      code: data.code,
      nameAr: data.nameAr,
      nameEn: data.nameEn,
      barcode: data.barcode,
      sku: data.sku,
      unit: data.unit,
      categoryId: data.categoryId,
      productTypeId: data.productTypeId,
      costPrice: data.costPrice,
      salePrice: data.salePrice,
      isActive: data.isActive,
      createdBy: data.createdBy,
      updatedBy: data.updatedBy,
    });
    if (result.success && result.rows?.length && result.rows[0]) {
      const productId = String(result.rows[0].id);
      // Fan out the m2m category rows via a second typed channel.
      if (Array.isArray(data.categoryIds) && data.categoryIds.length > 0) {
        await getRPC().createProductCategories({
          productId,
          categoryIds: data.categoryIds,
        });
      }
      return { success: true, id: productId };
    }
    return { success: false, error: result.error };
  },

  async getContacts(companyId, type) {
    // customers and suppliers live in separate tables — the renderer
    // chooses which typed channel to call based on `type`.
    const rpc = getRPC();
    const result = (!type || type === 'customer')
      ? await rpc.getCustomers({ companyId })
      : await rpc.getSuppliers({ companyId });
    return { success: result.success, data: result.rows, error: result.error };
  },

  async createContact(data) {
    const rpc = getRPC();
    const result = data.type === 'supplier'
      ? await rpc.createSupplier({
          companyId: data.companyId,
          code: data.code,
          name: data.name,
          phone: data.phone,
          email: data.email,
          address: data.address,
          taxNumber: data.taxNumber,
          balance: data.balance,
        })
      : await rpc.createCustomer({
          companyId: data.companyId,
          code: data.code,
          name: data.name,
          phone: data.phone,
          email: data.email,
          address: data.address,
          taxNumber: data.taxNumber,
          balance: data.balance,
        });
    return result.success && result.rows?.length && result.rows[0]
      ? { success: true, id: String(result.rows[0].id) }
      : { success: false, error: result.error };
  },

  // Onboarding / Seeding — delegate to Electron preload bridge
  async updateConfig(config) {
    if (typeof window !== 'undefined' && window.electronDB?.updateConfig) {
      return await window.electronDB.updateConfig(config);
    }
    return { success: false, error: 'electronDB not available' };
  },

  async clearAll(payload) {
    if (typeof window !== 'undefined' && window.electronDB?.clearAll) {
      return await window.electronDB.clearAll(payload);
    }
    return { success: false, error: 'electronDB not available' };
  },

  async seedDefault(adminPassword) {
    if (typeof window !== 'undefined' && window.electronDB?.seedDefault) {
      return await window.electronDB.seedDefault(adminPassword);
    }
    return { success: false, error: 'electronDB not available' };
  },

  async seedDemo(adminPassword) {
    if (typeof window !== 'undefined' && window.electronDB?.seedDemo) {
      return await window.electronDB.seedDemo(adminPassword);
    }
    return { success: false, error: 'electronDB not available' };
  },
};
