/* eslint-disable @typescript-eslint/no-explicit-any */
import type { DbAdapter, CompanySeedProfile } from './types';
import { normalizeRow, pgliteAdapter, withoutInternalMigration } from './pgliteAdapter';
import { neonHttpAdapter } from './neonHttpAdapter';
import { classifyPgFailure, pgFailureMessage } from '@/core/utils/pgErrors';
import { getActiveRemoteUrl } from '../connectionVault';
import { relayCall } from '../relayClient';

/**
 * Relay HTTP Adapter — ANY Postgres provider for platforms without TCP
 * (web browsers incl. mobile). Executes through the same-origin relay
 * (`/api/db`, api/db.ts in production) with per-call JWT sessions.
 *
 * Transport here is deliberately thin (ping/query/transaction over the
 * relay). Every higher-level method reuses the Neon adapter's proven SQL by
 * rebinding its implementation (`neonHttpAdapter.X.call(relaySelf, ...)`),
 * so the statement text lives in exactly ONE place. Two deliberate
 * exceptions: `getLedger` rebinds the PGlite implementation (the Neon
 * original queries the wrong database), and `updateConfig`/seeds are
 * relay-aware (vault-only binding, schema ensure over the relay).
 */

async function activeUrl(): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const url = await getActiveRemoteUrl();
  if (!url) {
    return {
      ok: false,
      error: 'No remote database selected. Add a DATABASE_URL in Settings → Database, or keep using the local database.',
    };
  }
  return { ok: true, url };
}

function relayFailure(err: unknown): { success: false; error: string; errorCode?: string } {
  const failure = classifyPgFailure(err);
  if (failure) return { success: false, error: pgFailureMessage(failure), errorCode: failure.code };
  return { success: false, error: err instanceof Error ? err.message : String(err) };
}

export const relayHttpAdapter: DbAdapter = {
  async ping() {
    const u = await activeUrl();
    if (!u.ok) return { success: false, message: u.error };
    const r = await relayCall('pingdb', { databaseUrl: u.url });
    if (!r.success) return { success: false, message: r.error || 'relay unreachable' };
    return { success: true, db: 'relay' };
  },

  async query<T = any>(sqlText: string, params?: any[]) {
    const u = await activeUrl();
    if (!u.ok) return { success: false, error: u.error };
    try {
      const r = await relayCall('query', { databaseUrl: u.url, sql: sqlText, params: params ?? [] });
      if (!r.success) return { success: false, error: r.error, errorCode: r.errorCode };
      return { success: true, rows: ((r.rows ?? []).map(normalizeRow) as unknown as T[]) };
    } catch (err) {
      return relayFailure(err);
    }
  },

  async transaction(queries: { sql: string; params?: any[] }[]) {
    const u = await activeUrl();
    if (!u.ok) return { success: false, error: u.error };
    try {
      const r = await relayCall('transaction', {
        databaseUrl: u.url,
        queries: queries.map((q) => ({ sql: q.sql, params: q.params ?? [] })),
      });
      if (!r.success) return { success: false, error: r.error, errorCode: r.errorCode };
      return {
        success: true,
        results: ((r.results ?? []).map((res) => {
          const rows = ((res as { rows?: unknown[] }).rows ?? []) as Record<string, unknown>[];
          return { rows: rows.map(normalizeRow), rowCount: (res as { rowCount?: number }).rowCount };
        })),
      };
    } catch (err) {
      return relayFailure(err);
    }
  },

  async getCompany() {
    // Scoped to the JWT company: the bare `SELECT * … LIMIT 1` the Neon
    // implementation uses carries no tenant predicate and the relay guard
    // (same contract as the desktop channel) rightly refuses it.
    const { getRelayCompanyId } = await import('../relayClient');
    const cid = getRelayCompanyId();
    if (cid) {
      const result = await this.query('SELECT * FROM companies WHERE id = $1 LIMIT 1', [cid]);
      if (result.success && result.rows && result.rows.length > 0) {
        return { success: true, data: result.rows[0] };
      }
      return { success: false, error: 'No company found' };
    }
    return neonHttpAdapter.getCompany.call(relayHttpAdapter);
  },

  async updateCompany(data: any, updatedBy?: string) {
    return neonHttpAdapter.updateCompany.call(relayHttpAdapter, data, updatedBy);
  },

  async getAccounts(companyId: string) {
    // Guard-shaped sibling of the Neon statement: every tenant table
    // carries an explicit `= $1` predicate on its own (denormalized)
    // company column, which the relay authorization — same contract as the
    // desktop channel — requires. The correlated form the Neon driver runs
    // unguarded cannot prove the journal leg scope.
    const result = await this.query(
      `SELECT a.*, COALESCE(b.running_balance, 0) AS running_balance
         FROM accounts a
         LEFT JOIN (
           SELECT je.account_id AS account_id, SUM(je.debit - je.credit) AS running_balance
             FROM journal_entries je
             JOIN transactions t ON je.transaction_id = t.id
            WHERE je.company_id = $1 AND t.company_id = $1 AND t.status = 'posted'
            GROUP BY je.account_id
         ) b ON b.account_id = a.id
        WHERE a.company_id = $1 ORDER BY a.code`,
      [companyId],
    );
    return { success: result.success, data: result.rows, error: result.error };
  },

  async createAccount(data: any) {
    return neonHttpAdapter.createAccount.call(relayHttpAdapter, data);
  },

  async getLedger(payload: { accountId: string; companyId: string; startDate?: string | null; endDate?: string | null }) {
    // NOTE: neonHttpAdapter.getLedger queries the LOCAL PGlite database by
    // mistake (pre-existing). The relay rebinds the PGlite implementation so
    // the statement runs against the remote through this adapter.
    return pgliteAdapter.getLedger.call(relayHttpAdapter, payload);
  },

  async getTransactions(companyId: string) {
    // Guard-shaped sibling of the Neon implementation: the legs query pins
    // both the denormalized leg company and the joined account company to
    // the session company (missing-account legs survive via the null arm).
    const txResult = await this.query('SELECT * FROM transactions WHERE company_id = $1 ORDER BY date DESC', [companyId]);
    if (!txResult.success) return { success: false, error: txResult.error };
    const transactions = (txResult.rows || []) as Record<string, unknown>[];
    if (transactions.length === 0) return { success: true, data: [] };
    const txIds = transactions.map((t) => String(t.id));
    const entriesResult = await this.query(
      `SELECT je.*, a.name_ar as account_name, a.code as account_code
        FROM journal_entries je
        LEFT JOIN accounts a ON je.account_id = a.id
        WHERE je.transaction_id = ANY($1) AND je.company_id = $2 AND (a.id IS NULL OR a.company_id = $2)`,
      [txIds, companyId],
    );
    if (!entriesResult.success) return { success: false, error: entriesResult.error };
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
    return neonHttpAdapter.createTransaction.call(relayHttpAdapter, data);
  },

  async getProducts(companyId: string) {
    return neonHttpAdapter.getProducts.call(relayHttpAdapter, companyId);
  },

  async createProduct(data: any) {
    // Guard-shaped sibling of the Neon implementation: the category fan-out
    // rides ONE statement (CTE) so the child-table rule sees its scoped
    // parent — a standalone child INSERT is refused on every guarded
    // channel, desktop included.
    const headerParams = [data.companyId, data.code, data.nameAr, data.nameEn, data.barcode, data.sku, data.unit, data.categoryId ?? null, data.productTypeId ?? null, data.costPrice, data.salePrice, data.isActive ?? true, data.createdBy ?? null, data.updatedBy ?? null, data.image ?? null, data.minStock ?? null, data.maxStock ?? null, data.reorderPoint ?? null, data.standardCost ?? null];
    const cats = Array.isArray(data.categoryIds) ? data.categoryIds.filter((c: unknown) => typeof c === 'string' && c) as string[] : [];
    let sql: string;
    let params: unknown[];
    if (cats.length > 0) {
      const placeholders = cats.map((_, i) => `($${20 + i})`).join(', ');
      sql = `WITH p AS (
               INSERT INTO products (company_id, code, name_ar, name_en, barcode, sku, unit, category_id, product_type_id, cost_price, sale_price, is_active, created_by, updated_by, image, min_stock, max_stock, reorder_point, standard_cost)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19) RETURNING id
             )
             INSERT INTO product_product_categories (product_id, category_id)
             SELECT p.id, v.cid FROM p JOIN (VALUES ${placeholders}) v(cid) ON true
             ON CONFLICT DO NOTHING
             RETURNING product_id`;
      params = [...headerParams, ...cats];
      const result = await this.query(sql, params);
      if (!result.success) return { success: false, error: result.error };
      const productId = result.rows?.[0] ? String((result.rows[0] as { product_id: unknown }).product_id) : undefined;
      if (!productId) {
        const fetched = await this.query('SELECT id FROM products WHERE company_id = $1 AND code = $2 ORDER BY created_at DESC LIMIT 1', [data.companyId, data.code]);
        const fallbackId = fetched.rows?.[0] ? String((fetched.rows[0] as { id: unknown }).id) : undefined;
        if (!fallbackId) return { success: false, error: result.error || 'Failed to create product' };
        return { success: true, id: fallbackId };
      }
      return { success: true, id: productId };
    }
    const result = await this.query(
      `INSERT INTO products (company_id, code, name_ar, name_en, barcode, sku, unit, category_id, product_type_id, cost_price, sale_price, is_active, created_by, updated_by, image, min_stock, max_stock, reorder_point, standard_cost)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19) RETURNING id`,
      headerParams,
    );
    if (result.success && result.rows?.length && (result.rows[0] as { id?: unknown }).id) {
      return { success: true, id: String((result.rows[0] as { id: unknown }).id) };
    }
    return { success: false, error: result.error };
  },

  async getContacts(companyId: string, type?: string) {
    return neonHttpAdapter.getContacts.call(relayHttpAdapter, companyId, type);
  },

  async createContact(data: any) {
    return neonHttpAdapter.createContact.call(relayHttpAdapter, data);
  },

  async updateConfig(config: { host?: string; port?: number | string; database?: string; user?: string; password?: string; databaseUrl?: string }) {
    try {
      if (config.databaseUrl) {
        // Relay binding is per-call from the vault — nothing to configure
        // locally. Persist so the connection survives reloads.
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
    // TRUNCATE can never travel the client SQL channel (guarded everywhere),
    // so reset runs as a dedicated server-side relay action — same posture
    // as the desktop db:clear-all channel.
    const u = await activeUrl();
    if (!u.ok) return { success: false, error: u.error };
    if (!payload?.confirm) {
      return { success: false, error: 'Confirmation required to clear all data.' };
    }
    const { relayCall } = await import('../relayClient');
    const r = await relayCall('reset', {
      databaseUrl: u.url,
      confirm: true,
      username: payload.username,
      password: payload.password,
    });
    if (!r.success) return { success: false, error: r.error };
    return { success: true };
  },

  async seedDefault(adminPassword?: string, company?: CompanySeedProfile) {
    // Schema first through the relay migrate action (admin JWT, or none on
    // a fresh database), then the idempotent seed DML — never DDL-by-client.
    const u = await activeUrl();
    if (!u.ok) return { success: false, error: u.error };
    const { relayCall } = await import('../relayClient');
    const migrated = await relayCall('migrate', { databaseUrl: u.url });
    if (!migrated.success) return { success: false, error: migrated.error };
    return withoutInternalMigration(() => pgliteAdapter.seedDefault.call(relayHttpAdapter, adminPassword, company));
  },

  async seedDemo(adminPassword?: string, company?: CompanySeedProfile) {
    const u = await activeUrl();
    if (!u.ok) return { success: false, error: u.error };
    const { relayCall } = await import('../relayClient');
    const migrated = await relayCall('migrate', { databaseUrl: u.url });
    if (!migrated.success) return { success: false, error: migrated.error };
    return withoutInternalMigration(() => pgliteAdapter.seedDemo.call(relayHttpAdapter, adminPassword, company));
  },
};
