/**
 * Confirmation-card enrichment — resolves raw UUID arguments to HUMAN-READABLE
 * names/numbers before the approval card renders.
 *
 * A user asked to approve "ترحيل فاتورة (المعرف: 3f2a1b9c…)" cannot verify
 * WHAT they are approving — the confirmation becomes a rubber stamp. This
 * module turns the args into substance: "ترحيل فاتورة مبيعات INV-0012 —
 * شركة الأمل — 172,500 ر.ي".
 *
 * Design:
 *  - Pure resolution over a per-tool ARG_RESOLVERS map: key = args field,
 *    resolver = async lookup that returns a display label or null.
 *  - Batched: all resolvers for a tool run in parallel (single round-trip
 *    each; the entity cache absorbs repeats).
 *  - Names are cached per companyId for the card's lifetime (30s TTL matches
 *    the entityResolver cache — a write invalidates nothing here because a
 *    stale display name on an APPROVAL card is harmless: the id is what
 *    executes; the label is what the human reads).
 */

import { salesApi } from '@/modules/sales/api';
import { purchasesApi } from '@/modules/purchases/api';
import { inventoryApi } from '@/modules/inventory/api';
import { hrApi } from '@/modules/hr/api';
import { crmApi } from '@/modules/crm/api';
import type { ToolContext } from '../types';

/** Display label for an id, or null when it cannot be resolved. */
type IdResolver = (id: string, ctx: ToolContext) => Promise<string | null>;

/**
 * P2 fix: the header comment claimed "names are cached per companyId (30s
 * TTL)" but NO cache existed — every approval card fired up to N×200-row
 * fetches on the time-critical confirmation path. This is a real bounded
 * cache: key = `${companyId}:${kind}:${id}`, 30s TTL, 500-entry cap with
 * oldest-first eviction. A stale display name on an APPROVAL card is
 * harmless (the id is what executes; the label is what the human reads).
 */
const LABEL_CACHE = new Map<string, { label: string; at: number }>();
const LABEL_CACHE_TTL_MS = 30_000;
const LABEL_CACHE_MAX = 500;

function cacheGet(companyId: string, kind: string, id: string): string | null | undefined {
  const hit = LABEL_CACHE.get(`${companyId}:${kind}:${id}`);
  if (!hit) return undefined;
  if (Date.now() - hit.at > LABEL_CACHE_TTL_MS) {
    LABEL_CACHE.delete(`${companyId}:${kind}:${id}`);
    return undefined;
  }
  return hit.label;
}

function cacheSet(companyId: string, kind: string, id: string, label: string): void {
  if (LABEL_CACHE.size >= LABEL_CACHE_MAX) {
    const oldest = LABEL_CACHE.keys().next();
    if (!oldest.done) LABEL_CACHE.delete(oldest.value);
  }
  LABEL_CACHE.set(`${companyId}:${kind}:${id}`, { label, at: Date.now() });
}

/** Test helper — clears the label cache between runs. */
export function clearLabelCache(): void {
  LABEL_CACHE.clear();
}

async function cachedResolve(
  companyId: string, kind: string, id: string, fetch: () => Promise<string | null>,
): Promise<string | null> {
  const hit = cacheGet(companyId, kind, id);
  if (hit !== undefined) return hit;
  const label = await fetch();
  if (label) cacheSet(companyId, kind, id, label);
  return label;
}

/** Per-entity resolvers — every one returns a HUMAN label, never an id. */
const RESOLVERS: Record<string, IdResolver> = {
  customerId: async (id, ctx) => cachedResolve(ctx.companyId, 'customer', id, async () => {
    const res = await salesApi.getCustomersPaginated(ctx.companyId, 1, 200);
    if (!res.success || !res.data) return null;
    const c = res.data.items.find((x) => x.id === id);
    return c ? `عميل: ${c.name}` : null;
  }),
  supplierId: async (id, ctx) => cachedResolve(ctx.companyId, 'supplier', id, async () => {
    const res = await purchasesApi.getSuppliersPaginated(ctx.companyId, 1, 200);
    if (!res.success || !res.data) return null;
    const s = res.data.items.find((x) => x.id === id);
    return s ? `مورد: ${s.name}` : null;
  }),
  employeeId: async (id, ctx) => cachedResolve(ctx.companyId, 'employee', id, async () => {
    const res = await hrApi.getEmployeeById(id, ctx.companyId);
    return res.success && res.data ? `موظف: ${res.data.fullName}` : null;
  }),
  leadId: async (id, ctx) => cachedResolve(ctx.companyId, 'lead', id, async () => {
    const res = await crmApi.getLeadById(id, ctx.companyId);
    return res.success && res.data ? `عميل محتمل: ${res.data.name}` : null;
  }),
  opportunityId: async (id, ctx) => cachedResolve(ctx.companyId, 'opportunity', id, async () => {
    const res = await crmApi.getOpportunitiesPaginated(ctx.companyId, 1, 200);
    if (!res.success || !res.data) return null;
    const o = res.data.items.find((x) => x.id === id);
    return o ? `فرصة: ${o.name}` : null;
  }),
  productId: async (id, ctx) => cachedResolve(ctx.companyId, 'product', id, async () => {
    const res = await inventoryApi.getProductsPaginated(ctx.companyId, 1, 200);
    if (!res.success || !res.data) return null;
    const p = res.data.items.find((x) => x.id === id);
    return p ? `${p.nameAr}${p.code ? ` (${p.code})` : ''}` : null;
  }),
};

/**
 * Resolve a product_units row id (the `unitId` inside document lines and
 * the flat `unitId` arg) to "الوحدة: كرتون (×12)" so the approval card
 * shows WHICH unit each line will use — the user consents to substance,
 * never a blind factor.
 */
async function resolveUnitRow(unitRowId: string, productId: string | undefined, ctx: ToolContext): Promise<string | null> {
  try {
    if (productId) {
      const res = await inventoryApi.getProductUnits(productId, ctx.companyId);
      if (res.success && res.data) {
        const u = res.data.find((x) => x.id === unitRowId);
        if (u) return `الوحدة: ${u.unitName || ''}${u.factor > 1 ? ` (×${u.factor})` : ''}`.trim() || null;
      }
    }
  } catch { /* best-effort */ }
  return null;
}

/** Fields whose values are UUID ids to resolve (per tool arg name). */
const ID_FIELDS = new Set([
  'customerId', 'supplierId', 'employeeId', 'leadId', 'opportunityId', 'productId',
]);

/**
 * Resolve the ids inside a tool-call argument object into a compact
 * "اسم: قيمة" list for the confirmation card. Best-effort: unresolvable ids
 * are simply omitted — the card falls back to the plain summary.
 */
export async function resolveArgsForCard(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string[]> {
  const labels: string[] = [];
  const seen = new Set<string>();
  const jobs: Array<Promise<void>> = [];

  for (const [key, value] of Object.entries(args)) {
    if (!ID_FIELDS.has(key)) continue;
    const id = typeof value === 'string' && value.trim() ? value.trim() : '';
    if (!id || seen.has(`${key}:${id}`)) continue;
    seen.add(`${key}:${id}`);
    const resolver = RESOLVERS[key];
    if (!resolver) continue;
    jobs.push(
      resolver(id, ctx).then((label) => {
        if (label && !labels.includes(label)) labels.push(label);
      }).catch(() => { /* best-effort */ }),
    );
  }

  // lines[] arrays carry productId per line — resolve each unique product
  // once, plus the line's unitId (product_units row) so the card shows the
  // resolved unit ("الوحدة: كرتون (×12)") instead of a blind factor.
  if (Array.isArray(args.lines)) {
    const productIds = new Set<string>();
    const unitJobs: Array<{ unitRowId: string; productId: string }> = [];
    for (const l of args.lines as Array<Record<string, unknown>>) {
      const pid = typeof l?.productId === 'string' ? l.productId.trim() : '';
      if (pid) productIds.add(pid);
      const uid = typeof l?.unitId === 'string' ? l.unitId.trim() : '';
      if (uid && pid) unitJobs.push({ unitRowId: uid, productId: pid });
    }
    for (const pid of productIds) {
      if (seen.has(`productId:${pid}`)) continue;
      seen.add(`productId:${pid}`);
      jobs.push(
        RESOLVERS.productId(pid, ctx).then((label) => {
          if (label && !labels.includes(label)) labels.push(label);
        }).catch(() => { /* best-effort */ }),
      );
    }
    for (const uj of unitJobs) {
      if (seen.has(`unitRow:${uj.unitRowId}`)) continue;
      seen.add(`unitRow:${uj.unitRowId}`);
      jobs.push(
        resolveUnitRow(uj.unitRowId, uj.productId, ctx).then((label) => {
          if (label && !labels.includes(label)) labels.push(label);
        }).catch(() => { /* best-effort */ }),
      );
    }
  }

  await Promise.all(jobs);
  return labels;
}
