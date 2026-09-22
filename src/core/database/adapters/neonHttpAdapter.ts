/* eslint-disable @typescript-eslint/no-explicit-any */
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import type { DbAdapter, CompanySeedProfile } from './types';
import { normalizeRow, pgliteAdapter, withoutInternalMigration } from './pgliteAdapter';
import { ensureRemoteSchema } from './remoteSchema';

/**
 * Neon HTTP Adapter — remote Postgres for platforms without TCP sockets
 * (web browsers incl. mobile, and optionally Electron).
 *
 * Uses the official `@neondatabase/serverless` fetch driver: queries AND
 * multi-statement transactions travel over HTTPS as a single
 * non-interactive transaction, so financial atomicity holds exactly like
 * the direct-TCP path. Only Neon-compatible endpoints are routable here
 * (the driver rewrites the host to Neon's SQL-over-HTTPS endpoint) —
 * other providers on web get an explicit capability error, never a
 * cryptic network failure. See `connection.resolveDriver`.
 *
 * Security: the connection string lives only in module memory + the
 * connection vault (safeStorage on desktop, device storage on web). It is
 * never logged, never interpolated into SQL, and never returned by ping().
 */

type NeonSql = NeonQueryFunction<false, false>;

let sql: NeonSql | null = null;
let activeUrl = '';

/** (Re)bind the adapter to a connection string. Throws on empty input. */
export function configureNeonHttp(databaseUrl: string): void {
  const url = (databaseUrl || '').trim();
  if (!url) throw new Error('DATABASE_URL is empty');
  if (url !== activeUrl || !sql) {
    sql = neon(url, {
      disableWarningInBrowsers: true,
      fetchOptions: { signal: AbortSignal.timeout(30000) },
    });
    activeUrl = url;
  }
}

/** Forget the bound connection (tests + explicit disconnect). */
export function resetNeonHttp(): void {
  sql = null;
  activeUrl = '';
}

function requireSql(): { ok: true; fn: NeonSql } | { ok: false; error: string } {
  if (!sql) {
    return {
      ok: false,
      error: 'Neon connection is not configured. Open Settings → Database and add a Neon DATABASE_URL.',
    };
  }
  return { ok: true, fn: sql };
}

function neonErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  // Defense-in-depth: never let a secret leak through a driver error.
  if (activeUrl) {
    try {
      const u = new URL(activeUrl);
      if (u.password && msg.includes(u.password)) return msg.replaceAll(u.password, '****');
    } catch {
      /* ignore */
    }
  }
  return msg;
}

export const neonHttpAdapter: DbAdapter = {
  async ping() {
    const s = requireSql();
    if (!s.ok) return { success: false, message: s.error };
    try {
      const rows = (await s.fn.query('SELECT current_database() AS db, version() AS version')) as unknown as Record<string, unknown>[];
      return { success: true, db: String(rows?.[0]?.db ?? 'neon') };
    } catch (err) {
      return { success: false, message: neonErrorMessage(err) };
    }
  },

  async query<T = any>(sqlText: string, params?: any[]) {
    const s = requireSql();
    if (!s.ok) return { success: false, error: s.error };
    try {
      const rows = (await s.fn.query(sqlText, params ?? [])) as unknown as Record<string, unknown>[];
      return { success: true, rows: (rows ?? []).map(normalizeRow) as unknown as T[] };
    } catch (err) {
      return { success: false, error: neonErrorMessage(err) };
    }
  },

  async transaction(queries: { sql: string; params?: any[] }[]) {
    const s = requireSql();
    if (!s.ok) return { success: false, error: s.error };
    try {
      // One HTTPS round-trip, one non-interactive Postgres transaction.
      const results = (await s.fn.transaction(
        queries.map((q) => s.fn.query(q.sql, q.params ?? [])),
      )) as unknown as Record<string, unknown>[][];
      return {
        success: true,
        results: (results ?? []).map((rows) => ({ rows: (rows ?? []).map(normalizeRow) })),
      };
    } catch (err) {
      return { success: false, error: neonErrorMessage(err) };
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
      `UPDATE companies SET name = $1, name_en = COALESCE($2, name_en), currency = COALESCE($3, currency),
              tax_number = COALESCE($4, tax_number), address = COALESCE($5, address), phone = COALESCE($6, phone),
              email = COALESCE($7, email), logo_url = COALESCE($8, logo_url), date_format = COALESCE($9, date_format),
              decimal_places = COALESCE($10::numeric, decimal_places), calendar = COALESCE($11, calendar),
              fiscal_year_start = COALESCE($12::date, fiscal_year_start),
              updated_by = $13, updated_at = NOW() WHERE id = $14`,
      [data.name, data.nameEn ?? null, data.currency ?? null, data.taxNumber ?? null, data.address ?? null, data.phone ?? null,
        data.email ?? null, data.logoUrl ?? null, data.dateFormat ?? null, data.decimalPlaces ?? null, data.calendar ?? null,
        data.fiscalYearStart ?? null, updatedBy || null, data.id],
    );
  },

  async getAccounts(companyId: string) {
    const result = await this.query(
      `SELECT a.*, COALESCE((SELECT SUM(je.debit - je.credit)
         FROM journal_entries je JOIN transactions t ON je.transaction_id = t.id
         WHERE je.account_id = a.id AND t.company_id = a.company_id AND t.status = 'posted'), 0) AS running_balance
       FROM accounts a WHERE a.company_id = $1 ORDER BY a.code`,
      [companyId],
    );
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
      const txEntries = entriesByTx.get(String(tx.id)) || [];
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
    const result = await this.query(
      `WITH new_tx AS (
         INSERT INTO transactions (company_id, date, reference, description, total_amount, status)
         VALUES ($1, $2::timestamptz, $3, $4, $5, $6)
         RETURNING id
       )
       INSERT INTO journal_entries (transaction_id, account_id, debit, credit, memo, company_id)
       VALUES ${entryValues.join(', ')}
       RETURNING transaction_id`,
      params,
    );
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
    const finalSql = (!type || type === 'customer')
      ? `SELECT id, company_id, 'customer' AS type, name, phone, email, address,
                tax_number, balance, is_active, created_at, updated_at
                FROM customers WHERE company_id = $1 ORDER BY name`
      : `SELECT id, company_id, 'supplier' AS type, name, phone, email, address,
                tax_number, balance, is_active, created_at, updated_at
                FROM suppliers WHERE company_id = $1 ORDER BY name`;
    const result = await this.query(finalSql, [companyId]);
    return { success: result.success, data: result.rows, error: result.error };
  },

  async createContact(data: any) {
    const table = data.type === 'supplier' ? 'suppliers' : 'customers';
    const result = await this.query(
      `INSERT INTO ${table} (company_id, code, name, phone, email, address, tax_number, balance)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [data.companyId, data.code ?? null, data.name, data.phone ?? null, data.email ?? null, data.address ?? null, data.taxNumber ?? null, data.balance || 0],
    );
    return result.success && result.rows?.length && (result.rows[0] as { id?: unknown }).id
      ? { success: true, id: String((result.rows[0] as { id: unknown }).id) }
      : { success: false, error: result.error };
  },

  async updateConfig(config: { host?: string; port?: number | string; database?: string; user?: string; password?: string; databaseUrl?: string }) {
    try {
      if (config.databaseUrl) {
        configureNeonHttp(config.databaseUrl);
        // Persist so the connection survives reloads (in-memory alone would
        // drop it on the next boot → "no remote connection" error screen).
        const { parseDatabaseUrl, providerLabel } = await import('../connection');
        const { saveRemoteConnection, setStoredActiveRemoteId } = await import('../connectionVault');
        const parsed = parseDatabaseUrl(config.databaseUrl);
        const saved = await saveRemoteConnection({
          name: `${providerLabel(parsed.provider)} · ${parsed.host}`,
          databaseUrl: parsed.raw,
        });
        if (saved.success && saved.connection) setStoredActiveRemoteId(saved.connection.id);
        return { success: true };
      }
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
      const tablesResult = await this.query(
        `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '__pglite_migrations'`,
      );
      if (!tablesResult.success) return { success: false, error: tablesResult.error };
      const tables = ((tablesResult.rows || []) as Record<string, unknown>[])
        .map((r) => String(r.tablename))
        .filter(Boolean);
      if (tables.length === 0) return { success: true };
      const truncateList = tables.map((t) => `"${t.replace(/"/g, '')}"`).join(', ');
      return this.transaction([{ sql: `TRUNCATE ${truncateList} CASCADE` }]).then((r) =>
        r.success ? { success: true } : { success: false, error: r.error },
      );
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  async seedDefault(adminPassword?: string, company?: CompanySeedProfile) {
    const schema = await ensureRemoteSchema(this);
    if (!schema.success) return { success: false, error: schema.error };
    return withoutInternalMigration(() => pgliteAdapter.seedDefault.call(neonHttpAdapter, adminPassword, company));
  },

  async seedDemo(adminPassword?: string, company?: CompanySeedProfile) {
    const schema = await ensureRemoteSchema(this);
    if (!schema.success) return { success: false, error: schema.error };
    return withoutInternalMigration(() => pgliteAdapter.seedDemo.call(neonHttpAdapter, adminPassword, company));
  },
};
