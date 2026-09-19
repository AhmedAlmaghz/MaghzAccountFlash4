/**
 * Perpetual inventory valuation engine (Phase 1 — FIN track).
 *
 * One company = one method, stored in the generic settings table under
 * `inventory.valuation_method` (moving_average | fifo | standard, default
 * moving_average). Every posting flow resolves costs through this module so
 * COGS, averages, layers and variances share a single implementation:
 *
 *   moving_average — COGS at current products.cost_price; purchases re-blend
 *     it (weighted by base quantities). Matches the pre-existing
 *     manufacturing completion blending.
 *   fifo — receipts open cost layers; outflows consume oldest-first by
 *     (received_date, created_at). Returns restore a layer at the ORIGINAL
 *     cost so the ledger never invents margins.
 *   standard — postings use the frozen products.standard_cost (falling back
 *     to cost_price when unset); purchase price differences hit the PPV
 *     account (51901) instead of silently moving inventory value.
 *
 * Money: unit costs keep 4 decimals (column scale), journal totals 2.
 * Design rule: costing functions READ, statement builders WRITE — the
 * caller composes both into ONE atomic transaction.
 */
import { getDbAdapter } from '@/core/database/adapters';
import type { DbAdapter } from '@/core/database/adapters/types';
import type { TxStatement } from '@/core/database/tx';

export type ValuationMethod = 'moving_average' | 'fifo' | 'standard';

export const VALUATION_METHODS: ValuationMethod[] = ['moving_average', 'fifo', 'standard'];
export const DEFAULT_VALUATION_METHOD: ValuationMethod = 'moving_average';
export const VALUATION_SETTING_KEY = 'inventory.valuation_method';

type Queryable = Pick<DbAdapter, 'query'>;

async function getAdapterOrThrow(db?: Queryable) {
  if (db) return db;
  return (await getDbAdapter()) as Queryable;
}

/** Company valuation method (settings key; safe default when unset/invalid). */
export async function getValuationMethod(companyId: string, db?: Queryable): Promise<ValuationMethod> {
  try {
    const adapter = await getAdapterOrThrow(db);
    const res = await adapter.query<{ value: string }>(
      `SELECT value FROM settings WHERE company_id = $1 AND key = $2 LIMIT 1`,
      [companyId, VALUATION_SETTING_KEY]
    );
    const v = String(res.rows?.[0]?.value || '').trim().toLowerCase();
    if ((VALUATION_METHODS as string[]).includes(v)) return v as ValuationMethod;
  } catch {
    /* fall through to default — valuation must never crash posting */
  }
  return DEFAULT_VALUATION_METHOD;
}

/** Persist the company valuation method (settings upsert). */
export async function setValuationMethod(
  companyId: string,
  method: ValuationMethod,
  db?: Queryable
): Promise<{ success: boolean; error?: string }> {
  if (!VALUATION_METHODS.includes(method)) return { success: false, error: 'Invalid valuation method' };
  try {
    const adapter = await getAdapterOrThrow(db);
    const res = await adapter.query(
      `INSERT INTO settings (company_id, key, value, category)
       VALUES ($1::uuid, $2, $3, 'inventory')
       ON CONFLICT (company_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [companyId, VALUATION_SETTING_KEY, method]
    );
    if (!res.success) return { success: false, error: res.error || 'Database query failed' };
    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

export const roundCost = (n: number): number => Math.round((Number(n) || 0) * 10000) / 10000;
export const roundMoney = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Split a base-currency total back into subtotal + VAT so that
 * sub + vat === total EXACTLY (rounding dust goes to subtotal, never to a
 * 1-cent imbalance that would unbalance the journal).
 */
export function splitBaseTotal(
  baseTotal: number,
  docVat: number,
  docTotal: number
): { sub: number; vat: number; total: number } {
  const total = roundMoney(baseTotal);
  if (!docTotal) return { sub: total, vat: 0, total };
  const vat = roundMoney((docVat / docTotal) * total);
  return { sub: roundMoney(total - vat), vat, total };
}

export interface CostedItem {
  productId: string;
  baseQty: number;
}

/** Current cost snapshot per product (average + frozen standard). */
export async function getProductCostMap(
  companyId: string,
  productIds: string[],
  db?: Queryable
): Promise<Map<string, { costPrice: number; standardCost: number | null; name: string }>> {
  const map = new Map<string, { costPrice: number; standardCost: number | null; name: string }>();
  const ids = [...new Set(productIds)].filter(Boolean);
  if (ids.length === 0) return map;
  const adapter = await getAdapterOrThrow(db);
  const placeholders = ids.map((_, i) => `$${i + 2}::uuid`).join(', ');
  const res = await adapter.query(
    `SELECT id, COALESCE(cost_price, 0) AS cost_price, standard_cost, COALESCE(name_ar, '') AS name_ar
       FROM products WHERE company_id = $1 AND id IN (${placeholders})`,
    [companyId, ...ids]
  );
  if (!res.success) throw new Error(res.error || 'Failed to load product costs');
  for (const r of (res.rows || []) as Record<string, unknown>[]) {
    const pid = String(r.id);
    const std = r.standard_cost === null || r.standard_cost === undefined ? null : Number(r.standard_cost);
    map.set(pid, {
      costPrice: Number(r.cost_price) || 0,
      standardCost: std !== null && std > 0 ? std : null,
      name: String(r.name_ar || pid),
    });
  }
  return map;
}

/**
 * Unit cost per BASE unit for a sale, by method — NO side effects.
 * FIFO peeks the oldest open layer (no consumption here); missing layers
 * (pre-Phase-1 stock) fall back to the current average, documented.
 */
export async function resolveSaleUnitCosts(
  companyId: string,
  items: CostedItem[],
  db?: Queryable
): Promise<{ success: true; method: ValuationMethod; costs: Map<string, number> } | { success: false; error: string }> {
  try {
    const adapter = await getAdapterOrThrow(db);
    const method = await getValuationMethod(companyId, adapter);
    const costs = new Map<string, number>();
    const products = await getProductCostMap(companyId, items.map((i) => i.productId), adapter);
    if (method === 'fifo') {
      const ids = [...new Set(items.map((i) => i.productId))].filter(Boolean);
      if (ids.length > 0) {
        const placeholders = ids.map((_, i) => `$${i + 2}::uuid`).join(', ');
        const layers = await adapter.query(
          `SELECT DISTINCT ON (product_id) product_id, unit_cost
             FROM inventory_layers
            WHERE company_id = $1 AND product_id IN (${placeholders}) AND qty_remaining > 0
            ORDER BY product_id, received_date ASC, created_at ASC`,
          [companyId, ...ids]
        );
        if (!layers.success) return { success: false, error: layers.error || 'Failed to load cost layers' };
        const oldest = new Map<string, number>();
        for (const r of (layers.rows || []) as Record<string, unknown>[]) {
          oldest.set(String(r.product_id), Number(r.unit_cost) || 0);
        }
        for (const it of items) {
          const p = products.get(it.productId);
          costs.set(it.productId, oldest.get(it.productId) ?? p?.costPrice ?? 0);
        }
        return { success: true, method, costs };
      }
      return { success: true, method, costs };
    }
    for (const it of items) {
      const p = products.get(it.productId);
      if (method === 'standard') {
        costs.set(it.productId, p?.standardCost ?? p?.costPrice ?? 0);
      } else {
        costs.set(it.productId, p?.costPrice ?? 0);
      }
    }
    return { success: true, method, costs };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

export interface FifoConsumption {
  layerId: string;
  productId: string;
  qty: number;
  unitCost: number;
}

/**
 * Allocate an outflow across FIFO layers (oldest-first). Pure read — the
 * caller persists via buildFifoConsumeStatements() in the SAME transaction
 * as the JE + stock updates. Shortage fails HONESTLY naming the product
 * (a FIFO ledger cannot price what was never received).
 */
export async function allocateFifoOutflow(
  companyId: string,
  items: (CostedItem & { name?: string })[],
  db?: Queryable,
  opts?: { partial?: boolean }
): Promise<
  | { success: true; consumptions: FifoConsumption[]; total: number; shortfall: number }
  | { success: false; error: string }
> {
  try {
    const adapter = await getAdapterOrThrow(db);
    const ids = [...new Set(items.map((i) => i.productId))].filter(Boolean);
    const byProduct = new Map<string, Array<{ id: string; qty: number; cost: number }>>();
    if (ids.length > 0) {
      const placeholders = ids.map((_, i) => `$${i + 2}::uuid`).join(', ');
      const res = await adapter.query(
        `SELECT id, product_id, qty_remaining, unit_cost
           FROM inventory_layers
          WHERE company_id = $1 AND product_id IN (${placeholders}) AND qty_remaining > 0
          ORDER BY product_id, received_date ASC, created_at ASC`,
        [companyId, ...ids]
      );
      if (!res.success) return { success: false, error: res.error || 'Database query failed' };
      for (const r of (res.rows || []) as Record<string, unknown>[]) {
        const pid = String(r.product_id);
        const arr = byProduct.get(pid) || [];
        arr.push({ id: String(r.id), qty: Number(r.qty_remaining) || 0, cost: Number(r.unit_cost) || 0 });
        byProduct.set(pid, arr);
      }
    }
    const consumptions: FifoConsumption[] = [];
    let total = 0;
    let shortfall = 0;
    for (const it of items) {
      let need = Math.max(0, Number(it.baseQty) || 0);
      if (need <= 0) continue;
      const layers = byProduct.get(it.productId) || [];
      for (const layer of layers) {
        if (need <= 0) break;
        if (layer.qty <= 0) continue;
        const take = Math.min(need, layer.qty);
        layer.qty = roundCost(layer.qty - take);
        need = roundCost(need - take);
        consumptions.push({ layerId: layer.id, productId: it.productId, qty: take, unitCost: layer.cost });
        total = roundMoney(total + take * layer.cost);
      }
      if (need > 0.0001) {
        // Strict (sales/returns/manufacturing): a FIFO ledger cannot price
        // what was never received — fail honestly naming the product.
        // Partial (stock-count adjustments): consume what's there; the caller
        // prices the shortfall at average and the books keep moving.
        if (!opts?.partial) {
          const label = it.name || it.productId;
          return {
            success: false,
            error: `Insufficient FIFO stock for ${label}: missing ${need} base units (no cost layers to consume)`,
          };
        }
        shortfall = roundCost(shortfall + need);
      }
    }
    return { success: true, consumptions, total: roundMoney(total), shortfall };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/** Decrement consumed FIFO layers (race-guarded: never below zero). */
export function buildFifoConsumeStatements(companyId: string, consumptions: FifoConsumption[]): TxStatement[] {
  return consumptions.map((c) => ({
    sql: `UPDATE inventory_layers SET qty_remaining = qty_remaining - $1::numeric WHERE id = $2::uuid AND company_id = $3::uuid AND qty_remaining >= $1::numeric`,
    params: [c.qty, c.layerId, companyId],
  }));
}

/** Open a FIFO layer for an inflow (purchase / manufacturing / return). */
export function buildFifoRestoreStatement(
  companyId: string,
  layer: { productId: string; warehouseId: string | null; qty: number; unitCost: number; receivedDate: string; sourceRef: string }
): TxStatement | null {
  const qty = roundCost(layer.qty);
  if (qty <= 0) return null;
  return {
    sql: `INSERT INTO inventory_layers (company_id, product_id, warehouse_id, qty_remaining, unit_cost, received_date, source_ref)
          VALUES ($1::uuid, $2::uuid, $3::uuid, $4::numeric, $5::numeric, $6::date, $7)`,
    params: [companyId, layer.productId, layer.warehouseId, qty, roundCost(layer.unitCost), layer.receivedDate, layer.sourceRef],
  };
}

/** INSERT layers for a purchase receipt (one row per line, resolved warehouse). */
export function buildPurchaseLayerStatements(
  companyId: string,
  lines: Array<{ productId: string; warehouseId: string; baseQty: number; lineTotal: number; receivedDate: string; sourceRef: string }>
): TxStatement[] {
  const out: TxStatement[] = [];
  for (const l of lines) {
    const qty = roundCost(l.baseQty);
    if (qty <= 0) continue;
    const unitCost = roundCost(qty > 0 ? (Number(l.lineTotal) || 0) / qty : 0);
    const stmt = buildFifoRestoreStatement(companyId, {
      productId: l.productId,
      warehouseId: l.warehouseId,
      qty,
      unitCost,
      receivedDate: l.receivedDate,
      sourceRef: l.sourceRef,
    });
    if (stmt) out.push(stmt);
  }
  return out;
}

/** First warehouse of the company (matches the purchase inflow rule). */
export async function resolveFirstWarehouse(companyId: string, db?: Queryable): Promise<string | null> {
  const adapter = await getAdapterOrThrow(db);
  const res = await adapter.query<{ id: string }>(
    `SELECT id FROM warehouses WHERE company_id = $1 ORDER BY created_at LIMIT 1`,
    [companyId]
  );
  if (!res.success) throw new Error(res.error || 'Failed to resolve warehouse');
  const id = res.rows?.[0]?.id;
  return id ? String(id) : null;
}

/** Warehouse holding the most stock of a product (matches the sales outflow rule). */
export async function resolveRichestWarehouse(
  companyId: string,
  productId: string,
  db?: Queryable
): Promise<string | null> {
  const adapter = await getAdapterOrThrow(db);
  const res = await adapter.query<{ warehouse_id: string }>(
    `SELECT COALESCE(
       (SELECT warehouse_id FROM stock WHERE product_id = $2::uuid AND company_id = $1::uuid ORDER BY quantity DESC LIMIT 1),
       (SELECT id FROM warehouses WHERE company_id = $1::uuid ORDER BY created_at LIMIT 1)
     ) AS warehouse_id`,
    [companyId, productId]
  );
  if (!res.success) throw new Error(res.error || 'Failed to resolve warehouse');
  const id = res.rows?.[0]?.warehouse_id;
  return id ? String(id) : null;
}

export interface AverageUpdate {
  productId: string;
  newCost: number;
}

/**
 * Moving-average re-blend for a posted purchase: newAvg =
 * (onHand × oldAvg + Σ received × unitCost) / (onHand + Σ received).
 * Pure computation — the caller persists via buildAverageUpdateStatements().
 */
export async function computePurchaseAverages(
  companyId: string,
  lines: Array<{ productId: string; baseQty: number; lineTotal: number }>,
  db?: Queryable
): Promise<{ success: true; updates: AverageUpdate[] } | { success: false; error: string }> {
  try {
    const adapter = await getAdapterOrThrow(db);
    const byProduct = new Map<string, { qty: number; cost: number }>();
    for (const l of lines) {
      const qty = Math.max(0, Number(l.baseQty) || 0);
      if (qty <= 0) continue;
      const unit = qty > 0 ? (Number(l.lineTotal) || 0) / qty : 0;
      const cur = byProduct.get(l.productId) || { qty: 0, cost: 0 };
      cur.cost += qty * unit;
      cur.qty = roundCost(cur.qty + qty);
      byProduct.set(l.productId, cur);
    }
    const ids = [...byProduct.keys()];
    if (ids.length === 0) return { success: true, updates: [] };
    const placeholders = ids.map((_, i) => `$${i + 2}::uuid`).join(', ');
    const stockRes = await adapter.query(
      `SELECT product_id, COALESCE(SUM(quantity), 0) AS q FROM stock
        WHERE company_id = $1 AND product_id IN (${placeholders}) GROUP BY product_id`,
      [companyId, ...ids]
    );
    if (!stockRes.success) return { success: false, error: stockRes.error || 'Failed to load stock balances' };
    const onHand = new Map<string, number>();
    for (const r of (stockRes.rows || []) as Record<string, unknown>[]) {
      onHand.set(String(r.product_id), Math.max(0, Number(r.q) || 0));
    }
    const costs = await getProductCostMap(companyId, ids, adapter);
    const updates: AverageUpdate[] = [];
    for (const [pid, add] of byProduct) {
      const oldQty = onHand.get(pid) ?? 0;
      const oldAvg = costs.get(pid)?.costPrice ?? 0;
      const denom = roundCost(oldQty + add.qty);
      if (denom <= 0) continue;
      updates.push({ productId: pid, newCost: roundCost((oldQty * oldAvg + add.cost) / denom) });
    }
    return { success: true, updates };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/** Persist re-blended moving averages. */
export function buildAverageUpdateStatements(companyId: string, updates: AverageUpdate[]): TxStatement[] {
  return updates.map((u) => ({
    sql: `UPDATE products SET cost_price = $1::numeric, updated_at = NOW() WHERE id = $2::uuid AND company_id = $3::uuid`,
    params: [u.newCost, u.productId, companyId],
  }));
}

/**
 * Seed FIFO opening layers from current on-hand stock at current average
 * (used when a company WITH stock switches TO fifo — otherwise the first
 * FIFO sale would fail with "no cost layers"). Idempotent per product:
 * only products that have stock but zero layers get a layer.
 */
export async function ensureFifoOpeningLayers(
  companyId: string,
  asOfDate: string,
  db?: Queryable
): Promise<{ success: true; created: number } | { success: false; error: string }> {
  try {
    const adapter = await getAdapterOrThrow(db);
    const res = await adapter.query(
      `INSERT INTO inventory_layers (company_id, product_id, warehouse_id, qty_remaining, unit_cost, received_date, source_ref)
       SELECT s.company_id, s.product_id, s.warehouse_id, s.quantity, COALESCE(NULLIF(p.cost_price, 0), 0), $2::date, 'OPENING-METHOD-CHANGE'
         FROM stock s
         JOIN products p ON p.id = s.product_id
        WHERE s.company_id = $1::uuid AND s.quantity > 0
          AND NOT EXISTS (
            SELECT 1 FROM inventory_layers l
             WHERE l.company_id = s.company_id AND l.product_id = s.product_id
          )
       RETURNING id`,
      [companyId, asOfDate]
    );
    if (!res.success) return { success: false, error: res.error || 'Database query failed' };
    return { success: true, created: res.rows?.length || 0 };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}
