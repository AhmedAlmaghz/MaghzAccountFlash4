/**
 * Stock & treasury guardrails (Phase 4 — FIN track, controls matrix).
 *
 * Company policy lives in the generic settings table (secure-by-default:
 * everything blocking unless an admin explicitly allows it):
 *
 *   inventory.default_warehouse_id      — preferred source for auto-resolved
 *                                         outflows (sales/returns/POS/mfg)
 *   manufacturing.default_fg_warehouse_id — receipt home for completed runs
 *   policy.allow_negative_sale          — sales + POS below zero
 *   policy.allow_negative_purchase_return — purchase returns below zero
 *   policy.allow_negative_issue         — manual issues + transfers
 *   policy.allow_negative_cashbox       — treasury disbursement below zero
 *   policy.credit_overlimit             — block | warn | allow
 *
 * Fail-closed: any settings read failure behaves as "block". Every allowed
 * breach writes an audit-log override trail (action 'override').
 */
import { getDbAdapter } from '@/core/database/adapters';
import type { DbAdapter } from '@/core/database/adapters/types';
import { logAudit } from '@/core/utils/auditLogger';

type Queryable = Pick<DbAdapter, 'query'>;

async function getAdapterOrThrow(db?: Queryable) {
  if (db) return db;
  return (await getDbAdapter()) as Queryable;
}

async function readSetting(companyId: string, key: string, db: Queryable): Promise<string | null> {
  try {
    const res = await db.query<{ value: string }>(
      `SELECT value FROM settings WHERE company_id = $1 AND key = $2 LIMIT 1`,
      [companyId, key]
    );
    if (!res.success) return null;
    const v = res.rows?.[0]?.value;
    return v === null || v === undefined ? null : String(v);
  } catch {
    return null;
  }
}

export async function writeSetting(
  companyId: string,
  key: string,
  value: string,
  category: string,
  db?: Queryable
): Promise<{ success: boolean; error?: string }> {
  try {
    const adapter = await getAdapterOrThrow(db);
    const res = await adapter.query(
      `INSERT INTO settings (company_id, key, value, category)
       VALUES ($1::uuid, $2, $3, $4)
       ON CONFLICT (company_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [companyId, key, value, category]
    );
    if (!res.success) return { success: false, error: res.error };
    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

export type CreditOverlimitMode = 'block' | 'warn' | 'allow';

export interface StockPolicies {
  defaultWarehouseId: string | null;
  defaultFgWarehouseId: string | null;
  allowNegativeSale: boolean;
  allowNegativePurchaseReturn: boolean;
  allowNegativeIssue: boolean;
  allowNegativeCashbox: boolean;
  creditOverlimit: CreditOverlimitMode;
}

const isTrue = (v: string | null): boolean => v === 'true' || v === '1';

/** Load all guardrail policies (fail-closed: unknown = blocking). */
export async function getStockPolicies(companyId: string, db?: Queryable): Promise<StockPolicies> {
  const adapter = await getAdapterOrThrow(db);
  const get = (key: string) => readSetting(companyId, key, adapter);
  const [defWh, defFg, negSale, negPRet, negIssue, negCash, over] = await Promise.all([
    get('inventory.default_warehouse_id'),
    get('manufacturing.default_fg_warehouse_id'),
    get('policy.allow_negative_sale'),
    get('policy.allow_negative_purchase_return'),
    get('policy.allow_negative_issue'),
    get('policy.allow_negative_cashbox'),
    get('policy.credit_overlimit'),
  ]);
  const mode = String(over || 'block').toLowerCase();
  return {
    defaultWarehouseId: defWh || null,
    defaultFgWarehouseId: defFg || null,
    allowNegativeSale: isTrue(negSale),
    allowNegativePurchaseReturn: isTrue(negPRet),
    allowNegativeIssue: isTrue(negIssue),
    allowNegativeCashbox: isTrue(negCash),
    creditOverlimit: mode === 'warn' || mode === 'allow' ? mode : 'block',
  };
}

/**
 * Resolve the default source warehouse, validated (exists + active).
 * Returns null when unset, unknown, or inactive — callers fall back to the
 * historical richest/first rules untouched.
 */
export async function resolveDefaultWarehouse(
  companyId: string,
  kind: 'issue' | 'fg' = 'issue',
  db?: Queryable
): Promise<string | null> {
  const adapter = await getAdapterOrThrow(db);
  const key = kind === 'fg' ? 'manufacturing.default_fg_warehouse_id' : 'inventory.default_warehouse_id';
  const id = await readSetting(companyId, key, adapter);
  if (!id) return null;
  try {
    const res = await adapter.query<{ id: string }>(
      `SELECT id FROM warehouses WHERE id = $1::uuid AND company_id = $2::uuid AND COALESCE(is_active, true) = true`,
      [id, companyId]
    );
    if (!res.success) return null;
    return res.rows?.[0]?.id ? String(res.rows[0].id) : null;
  } catch {
    return null;
  }
}

export interface SufficiencyItem {
  productId: string;
  baseQty: number;
  name?: string;
}

export interface Shortage {
  productId: string;
  name: string;
  need: number;
  have: number;
}

/**
 * Richest-warehouse sufficiency check (mirrors the auto-resolution rule:
 * each outflow posts against the warehouse holding the most stock).
 * Pass an explicit warehouseId to check a single location instead
 * (manual issues, transfer sources).
 */
export async function checkStockSufficiency(
  companyId: string,
  items: SufficiencyItem[],
  db?: Queryable,
  warehouseId?: string | null
): Promise<{ ok: true } | { ok: false; shortages: Shortage[] }> {
  const list = items.filter((i) => i.productId && (Number(i.baseQty) || 0) > 0);
  if (list.length === 0) return { ok: true };
  const adapter = await getAdapterOrThrow(db);
  const ids = [...new Set(list.map((i) => i.productId))];
  const placeholders = ids.map((_, i) => `$${i + 2}::uuid`).join(', ');
  const availSql = warehouseId
    ? `SELECT product_id, COALESCE(SUM(quantity), 0) AS have FROM stock
        WHERE company_id = $1::uuid AND warehouse_id = $${ids.length + 2}::uuid AND product_id IN (${placeholders})
        GROUP BY product_id`
    : `SELECT product_id, COALESCE(MAX(quantity), 0) AS have FROM stock
        WHERE company_id = $1::uuid AND product_id IN (${placeholders})
        GROUP BY product_id`;
  const availParams: unknown[] = warehouseId ? [companyId, ...ids, warehouseId] : [companyId, ...ids];
  const [availRes, prodRes] = await Promise.all([
    adapter.query(availSql, availParams),
    adapter.query(
      `SELECT id, COALESCE(name_ar, '') AS name_ar FROM products WHERE company_id = $1 AND id IN (${placeholders})`,
      [companyId, ...ids]
    ),
  ]);
  if (!availRes.success) return { ok: true };
  const have = new Map<string, number>();
  for (const r of (availRes.rows || []) as Record<string, unknown>[]) {
    have.set(String(r.product_id), Number(r.have) || 0);
  }
  const names = new Map<string, string>();
  if (prodRes.success) {
    for (const r of (prodRes.rows || []) as Record<string, unknown>[]) {
      names.set(String(r.id), String(r.name_ar || String(r.id)));
    }
  }
  const need = new Map<string, number>();
  for (const it of list) {
    need.set(it.productId, (need.get(it.productId) || 0) + (Number(it.baseQty) || 0));
  }
  const shortages: Shortage[] = [];
  for (const [pid, qty] of need) {
    const hv = have.get(pid) ?? 0;
    if (hv < qty) {
      const first = list.find((i) => i.productId === pid);
      shortages.push({
        productId: pid,
        name: first?.name || names.get(pid) || pid.slice(0, 8),
        need: Math.round(qty * 10000) / 10000,
        have: Math.round(hv * 10000) / 10000,
      });
    }
  }
  return shortages.length === 0 ? { ok: true } : { ok: false, shortages };
}

/** Arabic shortage detail for honest rejections (names + need/have). */
export function formatShortages(shortages: Shortage[]): string {
  return shortages.map((s) => `${s.name}: مطلوب ${s.need} / متاح ${s.have}`).join('، ');
}

/**
 * Treasury GL balance for a cash box (base currency). Null when the box has
 * no linked GL account — callers treat that as "uncheckable", not zero.
 */
export async function getCashBoxGlBalance(
  companyId: string,
  cashBoxId: string | null | undefined,
  db?: Queryable
): Promise<number | null> {
  if (!cashBoxId) return null;
  try {
    const adapter = await getAdapterOrThrow(db);
    const { getCashBoxAccountId } = await import('@/core/utils/journalEntryGenerator');
    const accountId = await getCashBoxAccountId(companyId, cashBoxId);
    if (!accountId) return null;
    const res = await adapter.query(
      `SELECT COALESCE(SUM(je.debit - je.credit), 0) AS balance
         FROM journal_entries je JOIN transactions t ON t.id = je.transaction_id
        WHERE je.company_id = $1::uuid AND je.account_id = $2::uuid AND t.status = 'posted'`,
      [companyId, accountId]
    );
    if (!res.success) return null;
    return Number((res.rows?.[0] as Record<string, unknown> | undefined)?.balance) || 0;
  } catch {
    return null;
  }
}

/** Fire-and-forget override trail (never blocks the posting itself). */
export async function auditOverride(args: {
  companyId: string;
  userId?: string | null;
  username?: string;
  kind: 'negative-stock' | 'negative-cashbox' | 'credit-overlimit';
  recordId: string;
  label: string;
  detail: Record<string, unknown>;
}): Promise<void> {
  try {
    await logAudit({
      userId: args.userId || 'system',
      username: args.username,
      action: 'override',
      tableName: `policy_${args.kind}`,
      recordId: args.recordId,
      recordLabel: args.label,
      oldValues: undefined,
      newValues: args.detail,
      companyId: args.companyId,
    });
  } catch {
    /* audit never blocks posting */
  }
}
