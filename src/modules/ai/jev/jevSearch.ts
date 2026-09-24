/**
 * JEV Unified Search — Phase P2 (merged master plan).
 *
 * ONE JEV decision call covers every entity family (customers, suppliers,
 * products, units, accounts, invoices, vouchers, journals, employees,
 * manufacturing, HR, CRM…): N parallel Nouls ("does the query refer to a
 * customer?") + one Choice for the dominant type. Code then executes ONLY
 * the matched families' existing `search.*` tools directly (same functions
 * the LLM would call — zero duplication), merges and ranks.
 *
 * Before: the model burned one LLM turn + one 200-row DB fetch PER family
 * (up to MAX_ITERATIONS=10). After: 1 JEV call (~150ms, ~$0.00002) + 1–3
 * parallel DB reads. On PGlite (UI thread) this removes the multi-table
 * fan-out that froze the second message.
 *
 * Fail-closed: any JEV miss → keyword fallback (offline, zero-cost) → the
 * matched families only. Never "search everything".
 */

import { getTool, getVisibleTools } from '../tools/registry';
import type { ToolContext } from '../types';
import { jevSystemOne } from './jevClient';
import { estimateJevCost, recordJevMetric } from './jevMetrics';
import { normalizeArabic } from '@/core/utils/normalizeArabic';

// ─── Entity-type table ───────────────────────────────────────────────────
// Each family reuses its existing search.* tool verbatim (execute path).
// RBAC: a family is eligible only if its tool is visible to the caller.

export interface SearchFamily {
  /** Stable key used in results and tests. */
  key: string;
  /** Existing search tool to execute when this family matches. */
  toolName: string;
  /** Arabic question fragment for the Noul ("هل يشير النص إلى …؟"). */
  labelAr: string;
  /** Offline keyword fallback (also documents the family's vocabulary). */
  keywords: readonly string[];
}

export const SEARCH_FAMILIES: readonly SearchFamily[] = [
  { key: 'customer', toolName: 'search.customers', labelAr: 'عميل', keywords: ['عميل', 'عملاء', 'زبون', 'الشركة', 'شركة'] },
  { key: 'supplier', toolName: 'search.suppliers', labelAr: 'مورد', keywords: ['مورد', 'موردين', 'مورّد'] },
  { key: 'product', toolName: 'search.products', labelAr: 'منتج أو صنف', keywords: ['منتج', 'منتجات', 'صنف', 'أصناف', 'بضاعة', 'كرتون', 'درزن', 'مادة', 'مواد'] },
  { key: 'unit', toolName: 'search.units', labelAr: 'وحدة قياس', keywords: ['وحدة', 'وحدات', 'كرتون', 'درزن', 'دستة', 'علبة'] },
  { key: 'account', toolName: 'search.accounts', labelAr: 'حساب محاسبي', keywords: ['حساب', 'حسابات', 'شجرة', 'ميزان', 'قيد', 'قيود', 'مصروف', 'إيراد'] },
  { key: 'sales_invoice', toolName: 'search.sales_invoices', labelAr: 'فاتورة بيع', keywords: ['فاتورة بيع', 'فواتير بيع', 'فاتورة', 'فواتير', 'inv-'] },
  { key: 'purchase_invoice', toolName: 'search.purchase_invoices', labelAr: 'فاتورة شراء', keywords: ['فاتورة شراء', 'فواتير شراء', 'فاتورة', 'فواتير', 'pinv-'] },
  { key: 'quotation', toolName: 'search.quotations', labelAr: 'عرض سعر', keywords: ['عرض سعر', 'عروض', 'qtn-', 'عرض'] },
  { key: 'sales_return', toolName: 'search.sales_returns', labelAr: 'مردود مبيعات', keywords: ['مردود مبيعات', 'مرتجع', 'srt-'] },
  { key: 'purchase_return', toolName: 'search.purchase_returns', labelAr: 'مردود مشتريات', keywords: ['مردود مشتريات', 'prt-'] },
  { key: 'receipt_voucher', toolName: 'search.receipt_vouchers', labelAr: 'سند قبض', keywords: ['سند قبض', 'قبض', 'rv-'] },
  { key: 'payment_voucher', toolName: 'search.payment_vouchers', labelAr: 'سند صرف', keywords: ['سند صرف', 'صرف', 'pv-'] },
  { key: 'journal', toolName: 'search.journal_entries', labelAr: 'قيد يومي', keywords: ['قيد يومي', 'قيود', 'je-'] },
  { key: 'employee', toolName: 'search.employees', labelAr: 'موظف', keywords: ['موظف', 'موظفين', 'راتب', 'emp-'] },
  { key: 'warehouse', toolName: 'search.warehouses', labelAr: 'مستودع', keywords: ['مستودع', 'مستودعات', 'مخزن', 'مخازن'] },
  { key: 'bom', toolName: 'search.boms', labelAr: 'شجرة منتج (BOM)', keywords: ['شجرة', 'bom', 'قائمة مواد', 'تصنيع'] },
  { key: 'work_order', toolName: 'search.work_orders', labelAr: 'أمر تشغيل', keywords: ['أمر تشغيل', 'تشغيل', 'wo-'] },
  { key: 'lead', toolName: 'search.leads', labelAr: 'عميل محتمل', keywords: ['محتمل', 'فرصة', 'lead'] },
  { key: 'opportunity', toolName: 'search.opportunities', labelAr: 'فرصة بيعية', keywords: ['فرصة', 'صفقة', 'opp-'] },
  { key: 'cash_box', toolName: 'search.cash_boxes', labelAr: 'خزينة', keywords: ['خزينة', 'خزائن', 'صندوق', 'نقدية'] },
];

export const SEARCH_TYPE_THRESHOLD = 0.5;
export const SEARCH_TYPE_FALLBACK_MIN = 0.35;
export const SEARCH_MAX_FAMILIES = 3;
export const SEARCH_ROUTE_CACHE_TTL_MS = 60_000;
const SEARCH_ROUTE_CACHE_MAX = 100;

// normalized-query → routed family keys (60s TTL, capped)
const routeCache = new Map<string, { at: number; families: string[] }>();

function normalizeQueryKey(q: string): string {
  return q.trim().replace(/\s+/g, ' ').slice(0, 200);
}

function getCachedRoute(query: string): string[] | null {
  const entry = routeCache.get(normalizeQueryKey(query));
  if (!entry) return null;
  if (Date.now() - entry.at > SEARCH_ROUTE_CACHE_TTL_MS) {
    routeCache.delete(normalizeQueryKey(query));
    return null;
  }
  return entry.families;
}

function setCachedRoute(query: string, families: string[]): void {
  if (routeCache.size >= SEARCH_ROUTE_CACHE_MAX) {
    const oldest = routeCache.keys().next().value;
    if (oldest !== undefined) routeCache.delete(oldest);
  }
  routeCache.set(normalizeQueryKey(query), { at: Date.now(), families });
}

export function clearSearchRouteCache(): void {
  routeCache.clear();
}

/** Families the caller may search (RBAC via the tools registry). */
export function visibleFamilies(): SearchFamily[] {
  const visible = new Set(getVisibleTools().map((t) => t.name));
  return SEARCH_FAMILIES.filter((f) => visible.has(f.toolName));
}

/**
 * Offline keyword fallback — zero-cost, zero-network.
 * Both sides pass through normalizeArabic (alef/yeh/teh variants, diacritics,
 * kashida) so "إشتراك" matches "اشتراك" and "للتجارة" matches "للتجاره".
 * Keywords are normalized once at module load; the query per call.
 */
const NORMALIZED_KEYWORDS: ReadonlyMap<string, readonly string[]> = new Map(
  SEARCH_FAMILIES.map((f) => [f.key, f.keywords.map((k) => normalizeArabic(k))]),
);

export function keywordGuessTypes(query: string, families: SearchFamily[] = visibleFamilies()): string[] {
  const q = normalizeArabic(query.trim());
  if (!q) return [];
  const scored = families
    .map((f) => {
      const norms = NORMALIZED_KEYWORDS.get(f.key) ?? [];
      return { key: f.key, hit: norms.some((k) => k && q.includes(k)) };
    })
    .filter((s) => s.hit)
    .map((s) => s.key);
  return scored.slice(0, SEARCH_MAX_FAMILIES);
}

export interface RoutedFamily {
  key: string;
  prob: number;
}

/**
 * ONE JEV call: N parallel Nouls (one per visible family) + Choice for the
 * dominant type. Returns families sorted by probability, highest first.
 */
export async function jevRouteSearch(
  companyId: string,
  query: string,
): Promise<{ families: RoutedFamily[]; dominant: string | null; jevUsed: boolean; latencyMs: number }> {
  const start = Date.now();
  const families = visibleFamilies();
  const empty = { families: [] as RoutedFamily[], dominant: null as string | null, jevUsed: false, latencyMs: Date.now() - start };
  if (!query.trim() || families.length === 0) return empty;

  const cached = getCachedRoute(query);
  if (cached) {
    return {
      families: cached.map((key) => ({ key, prob: 1 })),
      dominant: cached[0] ?? null,
      jevUsed: false,
      latencyMs: Date.now() - start,
    };
  }

  const questions: Record<string, { type: 'noul'; instructions: string }> = {};
  for (const f of families) {
    questions[`is_${f.key}`] = {
      type: 'noul',
      instructions: `هل يشير النص التالي إلى ${f.labelAr}؟ النص: "${query.slice(0, 500)}"`,
    };
  }
  // Dominant-type Choice doubles as a tiebreaker and a dominant signal.
  const criteria: Record<string, string> = {};
  for (const f of families) criteria[f.key] = f.labelAr;
  const withDominant = {
    ...questions,
    __dominant__: {
      type: 'choice' as const,
      instructions: 'ما نوع الكيان الغالب الذي يشير إليه النص؟',
      criteria,
    },
  };

  const res = await jevSystemOne(
    companyId,
    { state: { query: query.slice(0, 1000) }, questions: withDominant as never },
    { timeoutMs: 2000, label: 'jev-search-route' },
  );

  if (!res?.answers) return empty;

  const routed: RoutedFamily[] = [];
  for (const f of families) {
    const ans = (res.answers as Record<string, { noul?: number }>)[`is_${f.key}`];
    const prob = typeof ans?.noul === 'number' ? ans.noul : 0;
    if (prob >= SEARCH_TYPE_THRESHOLD) routed.push({ key: f.key, prob });
  }
  routed.sort((a, b) => b.prob - a.prob);
  // Fallback: nobody crossed the bar — take the single best if it clears the floor
  if (routed.length === 0) {
    let best: RoutedFamily | null = null;
    for (const f of families) {
      const ans = (res.answers as Record<string, { noul?: number }>)[`is_${f.key}`];
      const prob = typeof ans?.noul === 'number' ? ans.noul : 0;
      if (!best || prob > best.prob) best = { key: f.key, prob };
    }
    if (best && best.prob >= SEARCH_TYPE_FALLBACK_MIN) routed.push(best);
  }

  const domAns = (res.answers as Record<string, { choice?: string }>)['__dominant__'];
  const dominant = typeof domAns?.choice === 'string' ? domAns.choice : (routed[0]?.key ?? null);

  const latencyMs = Date.now() - start;
  recordJevMetric({
    at: Date.now(), label: 'search-route', latencyMs,
    inputTokens: 200 + families.length * 15, outputTokens: 0,
    costUsd: estimateJevCost(200 + families.length * 15),
    confidence: routed[0]?.prob ?? 0, jevUsed: true,
  });
  setCachedRoute(query, routed.slice(0, SEARCH_MAX_FAMILIES).map((r) => r.key));

  return { families: routed.slice(0, SEARCH_MAX_FAMILIES), dominant, jevUsed: true, latencyMs };
}

// ─── Orchestrator ──────────────────────────────────────────────────────────

export interface UnifiedSearchHit {
  type: string;
  id: string;
  name: string;
  score: number;
  extra?: Record<string, unknown>;
}

export interface UnifiedSearchResult {
  hits: UnifiedSearchHit[];
  routedTypes: string[];
  dominant: string | null;
  /** JEV probability per routed family (route stage) — drives injection gates. */
  familyProbs: Record<string, number>;
  jevUsed: boolean;
  fallback: boolean;
  latencyMs: number;
  /** True when the Choice rank stage ran (top hit is JEV-ordered, not just family-ordered). */
  ranked: boolean;
  /** True when the top two candidates are within 0.1 — caller should ask the user. */
  ambiguous: boolean;
  /**
   * Per-family winners from the batched link stage — the ONLY entities the
   * fast-path may auto-inject. A winner counts as injectable only when
   * familyProb >= INJECT_FAMILY_FLOOR and confidence >= INJECT_CONF_FLOOR;
   * anything weaker stays a candidate the model must verify.
   */
  linked: LinkedEntity[];
}

/** One family winner from the batched link stage. */
export interface LinkedEntity {
  type: string;
  id: string;
  name: string;
  confidence: number;
  familyProb: number;
  /** True when strong enough for fast-path auto-injection. */
  injectable: boolean;
}

/** Arabic labels for entity families (cards, badges, rank choices). */
export const SEARCH_TYPE_LABELS_AR: Readonly<Record<string, string>> = {
  customer: 'عميل', supplier: 'مورد', product: 'منتج', unit: 'وحدة',
  account: 'حساب', sales_invoice: 'فاتورة بيع', purchase_invoice: 'فاتورة شراء',
  quotation: 'عرض سعر', sales_return: 'مردود مبيعات', purchase_return: 'مردود مشتريات',
  receipt_voucher: 'سند قبض', payment_voucher: 'سند صرف', journal: 'قيد يومي',
  employee: 'موظف', warehouse: 'مستودع', bom: 'شجرة منتج', work_order: 'أمر تشغيل',
  lead: 'عميل محتمل', opportunity: 'فرصة بيعية', cash_box: 'خزينة',
};

/**
 * Rank only when it matters: many hits or cross-family ambiguity.
 * Note extractHits caps each family at 5, so the single-family bar must sit
 * at or below 5 — otherwise rank could never trigger for one family.
 */
export const RANK_MIN_HITS = 4;
export const RANK_MIN_FAMILIES = 2;
export const RANK_MIN_HITS_MULTI_FAMILY = 3;
export const AMBIGUITY_GAP = 0.1;
/** Per-family link winners below this confidence are candidates, not injections. */
export const LINK_FLOOR = 0.55;
/** Fast-path auto-injection requires family prob AND link confidence at/above these. */
export const INJECT_FAMILY_FLOOR = 0.6;
export const INJECT_CONF_FLOOR = 0.7;
const RANK_SHORTLIST = 12;
const LINK_SHORTLIST_PER_FAMILY = 5;

function extractHits(type: string, raw: unknown): UnifiedSearchHit[] {
  if (!raw || typeof raw !== 'object') return [];
  const r = raw as { matches?: Array<{ id?: unknown; name?: unknown; score?: unknown }> };
  if (!Array.isArray(r.matches)) return [];
  return r.matches.slice(0, 5).map((m) => ({
    type,
    id: String(m.id ?? ''),
    name: String(m.name ?? ''),
    score: typeof m.score === 'number' ? m.score : 0.5,
    extra: m as unknown as Record<string, unknown>,
  })).filter((h) => h.id && h.name);
}

/**
 * Search everything the query refers to — one JEV decision + parallel DB reads.
 * Executes the existing search.* tools directly (no LLM round-trips).
 */
export async function jevSearchAll(
  ctx: ToolContext,
  query: string,
  opts?: { maxFamilies?: number; perFamilyLimit?: number },
): Promise<UnifiedSearchResult> {
  const start = Date.now();
  const maxFamilies = opts?.maxFamilies ?? SEARCH_MAX_FAMILIES;
  const q = query.trim();
  if (!q) return { hits: [], routedTypes: [], dominant: null, familyProbs: {}, jevUsed: false, fallback: false, latencyMs: 0, ranked: false, ambiguous: false, linked: [] };

  const families = visibleFamilies();
  const byKey = new Map(families.map((f) => [f.key, f]));

  // 1) Route (JEV → keyword fallback → empty)
  let routedKeys: string[] = [];
  let dominant: string | null = null;
  let jevUsed = false;
  let fallback = false;
  const familyProbs: Record<string, number> = {};

  try {
    const route = await jevRouteSearch(ctx.companyId, q);
    jevUsed = route.jevUsed;
    dominant = route.dominant;
    routedKeys = route.families.map((f) => f.key);
    for (const f of route.families) familyProbs[f.key] = f.prob;
  } catch {
    jevUsed = false;
  }
  if (routedKeys.length === 0) {
    routedKeys = keywordGuessTypes(q, families);
    fallback = true;
    if (routedKeys.length === 0) {
      return { hits: [], routedTypes: [], dominant: null, familyProbs: {}, jevUsed: false, fallback: true, latencyMs: Date.now() - start, ranked: false, ambiguous: false, linked: [] };
    }
  }
  routedKeys = routedKeys.slice(0, maxFamilies);

  // 2) Execute matched families in parallel (bounded, individually guarded)
  const settled = await Promise.all(
    routedKeys.map(async (key) => {
      const fam = byKey.get(key);
      if (!fam) return { key, hits: [] as UnifiedSearchHit[] };
      const tool = getTool(fam.toolName);
      if (!tool) return { key, hits: [] as UnifiedSearchHit[] };
      try {
        const raw = await tool.execute({ query: q }, ctx);
        return { key, hits: extractHits(key, raw) };
      } catch {
        return { key, hits: [] as UnifiedSearchHit[] };
      }
    }),
  );

  // 3) Merge — family order (JEV probability) then in-family score
  let hits = settled.flatMap((s) => s.hits);
  const hitsByFamily = new Map<string, UnifiedSearchHit[]>();
  for (const h of hits) {
    const arr = hitsByFamily.get(h.type) ?? [];
    arr.push(h);
    hitsByFamily.set(h.type, arr);
  }

  // 4) Link stage (jevLinkGroups): ONE JEV call with one Choice PER ROUTED
  // FAMILY — each family judges only its own candidates, so a supplier can
  // never "win" a warehouse question (the bank-instead-of-warehouse bug).
  // Produces per-family winners (linked[]) with calibrated confidence plus
  // ambiguity flags; hits are reordered family-by-family, winner first.
  let ranked = false;
  let ambiguous = false;
  const linked: LinkedEntity[] = [];
  const displayName = (h: UnifiedSearchHit): string =>
    `${h.name} (${SEARCH_TYPE_LABELS_AR[h.type] ?? h.type})`;
  const familyCount = new Set(hits.map((h) => h.type)).size;
  const needsRank =
    jevUsed &&
    hits.length > 1 &&
    (hits.length > RANK_MIN_HITS || (familyCount >= RANK_MIN_FAMILIES && hits.length > RANK_MIN_HITS_MULTI_FAMILY));
  if (needsRank) {
    try {
      const { jevLinkGroups } = await import('./jevEntityLinker');
      const groups = routedKeys
        .map((key) => ({
          key,
          cands: (hitsByFamily.get(key) ?? []).slice(0, LINK_SHORTLIST_PER_FAMILY),
        }))
        .filter((g) => g.cands.length > 0);
      const links = await jevLinkGroups(
        ctx.companyId,
        groups.map((g) => ({
          token: `${SEARCH_TYPE_LABELS_AR[g.key] ?? g.key}: ${q}`,
          candidates: g.cands.map((h) => ({ id: h.id, name: displayName(h) })),
        })),
        'search-rank',
      );
      // Rebuild hits in routed-family order, winner first per family.
      const reordered: UnifiedSearchHit[] = [];
      links.forEach((link, gi) => {
        const g = groups[gi];
        if (!g) return;
        const famHits = [...g.cands];
        const winnerIdx = famHits.findIndex((h) => displayName(h) === link.choice);
        const probs = Object.values(link.probabilities ?? {}).sort((a, b) => (b as number) - (a as number)) as number[];
        const photoFinish = probs.length > 1 && probs[0] - probs[1] < AMBIGUITY_GAP;
        const famProb = familyProbs[g.key] ?? 0;
        if (link.choice !== '__none__' && link.confidence >= LINK_FLOOR && winnerIdx >= 0) {
          const [winner] = famHits.splice(winnerIdx, 1);
          winner.score = Math.max(winner.score, link.confidence);
          famHits.unshift(winner);
          linked.push({
            type: g.key,
            id: winner.id,
            name: winner.name,
            confidence: link.confidence,
            familyProb: famProb,
            injectable: famProb >= INJECT_FAMILY_FLOOR && link.confidence >= INJECT_CONF_FLOOR,
          });
          if (photoFinish) ambiguous = true;
        } else if (link.confidence > 0 && link.confidence < LINK_FLOOR) {
          // Weak winner — a candidate, never an injection.
          if (photoFinish) ambiguous = true;
        }
        reordered.push(...famHits);
      });
      // Preserve any hits from families that dropped out of linking.
      const seen = new Set(reordered.map((h) => `${h.type}:${h.id}`));
      for (const h of hits) {
        if (!seen.has(`${h.type}:${h.id}`)) reordered.push(h);
      }
      hits = reordered.slice(0, Math.max(RANK_SHORTLIST, reordered.length));
      ranked = true;
    } catch {
      // Rank is enrichment — unranked merge is still correct
    }
  }

  const latencyMs = Date.now() - start;
  // Honest accounting: fallback reads cost nothing on JEV (local DB only).
  recordJevMetric({
    at: Date.now(), label: 'search-all', latencyMs,
    inputTokens: jevUsed ? 120 : 0, outputTokens: 0, costUsd: jevUsed ? estimateJevCost(120) : 0,
    jevUsed,
  });

  return { hits, routedTypes: routedKeys, dominant, familyProbs, jevUsed, fallback, latencyMs, ranked, ambiguous, linked };
}
