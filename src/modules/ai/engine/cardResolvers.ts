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

/** Per-entity resolvers — every one returns a HUMAN label, never an id. */
const RESOLVERS: Record<string, IdResolver> = {
  customerId: async (id, ctx) => {
    const res = await salesApi.getCustomersPaginated(ctx.companyId, 1, 200);
    if (!res.success || !res.data) return null;
    const c = res.data.items.find((x) => x.id === id);
    return c ? `عميل: ${c.name}` : null;
  },
  supplierId: async (id, ctx) => {
    const res = await purchasesApi.getSuppliersPaginated(ctx.companyId, 1, 200);
    if (!res.success || !res.data) return null;
    const s = res.data.items.find((x) => x.id === id);
    return s ? `مورد: ${s.name}` : null;
  },
  employeeId: async (id, ctx) => {
    const res = await hrApi.getEmployeeById(id, ctx.companyId);
    return res.success && res.data ? `موظف: ${res.data.fullName}` : null;
  },
  leadId: async (id, ctx) => {
    const res = await crmApi.getLeadById(id, ctx.companyId);
    return res.success && res.data ? `عميل محتمل: ${res.data.name}` : null;
  },
  opportunityId: async (id, ctx) => {
    const res = await crmApi.getOpportunitiesPaginated(ctx.companyId, 1, 200);
    if (!res.success || !res.data) return null;
    const o = res.data.items.find((x) => x.id === id);
    return o ? `فرصة: ${o.name}` : null;
  },
  productId: async (id, ctx) => {
    const res = await inventoryApi.getProductsPaginated(ctx.companyId, 1, 200);
    if (!res.success || !res.data) return null;
    const p = res.data.items.find((x) => x.id === id);
    return p ? `${p.nameAr}${p.code ? ` (${p.code})` : ''}` : null;
  },
};

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

  // lines[] arrays carry productId per line — resolve each unique product once.
  if (Array.isArray(args.lines)) {
    const productIds = new Set<string>();
    for (const l of args.lines as Array<Record<string, unknown>>) {
      const pid = typeof l?.productId === 'string' ? l.productId.trim() : '';
      if (pid) productIds.add(pid);
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
  }

  await Promise.all(jobs);
  return labels;
}
