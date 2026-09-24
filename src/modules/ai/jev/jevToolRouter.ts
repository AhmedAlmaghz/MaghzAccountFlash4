/**
 * JEV Tool Router — probabilistic intent routing via System One Choice.
 *
 * Replaces/augments the keyword `toolRouter.ts` (256→48) with a calibrated
 * Choice over 13 intent buckets. Each user turn:
 *   1. Ask JEV: "ما نية المستخدم الرئيسية؟" → choice + probabilities + confidence
 *   2. Select every domain whose probability > THRESHOLD (multi-intent: "فاتورة مشتريات")
 *   3. Confidence-gated: high → route silently, medium → ask one clarifying line, low → fallback to legacy router
 *
 * Feature flag: ai.jev_router_enabled (requires ai.jev_enabled + apiKey).
 * Fallback: legacy routeToolsForCycle() on any JEV failure — never blocks chat.
 */

import type { LlmMessage } from '../types';
import { getVisibleTools } from '../tools/registry';
import { getJevConfig } from './jevConfig';
import { jevSystemOne } from './jevClient';
import { routeToolsForCycle as legacyRouteToolsForCycle, MAX_ADVERTISED_TOOLS, type RoutedTools } from '../engine/toolRouter';

// ─── Intent taxonomy — 13 buckets covering every domain ────────────────────

export const JEV_INTENT_CRITERIA = {
  sales: 'إنشاء أو استعلام أو تعديل فاتورة بيع، عميل، عرض سعر، مردود مبيعات، ذمم مدينة، تحصيل',
  purchases: 'فاتورة شراء، مورد، أمر شراء، مردود مشتريات، مديونية، أرصدة موردين، سداد',
  inventory: 'مخزون، منتج، صنف، مستودع، جرد، تحويل مخزني، تسوية، كرتون/درزن/وحدات',
  hr: 'موظف، راتب، مسير رواتب، حضور، انصراف، إجازة، دوام، علاوة، نهاية خدمة، قسم',
  crm: 'عميل محتمل، فرصة، قمع مبيعات، مهمة، نشاط، متابعة، تحويل عميل، تأهيل',
  manufacturing: 'تصنيع، إنتاج، أمر تشغيل، BOM، قائمة مواد، تكلفة إنتاج، منتج نهائي',
  pos: 'نقطة بيع، كاشير، وردية، إيصال، تقرير Z، مبيعات نقدية',
  settings: 'إعدادات، ثيم، ألوان، فرع، صندوق نقدية، مركز تكلفة، وحدة، نوع منتج، تسلسل',
  accounting: 'قيود يومية، حساب، شجرة الحسابات، ميزان، أرباح وخسائر، سند قبض/صرف، مصروف',
  tax: 'دولة ضريبية، إقرار ضريبي، فترة ضريبية، إعادة تقييم، فروق صرف، أصول ثابتة، إهلاك، إقفال سنة مالية',
  reports: 'تقرير، تحليل، ملخص، إحصائيات، مقارنة، ترتيب، أفضل/أعلى/أقل، نمو، متوسط',
  navigation: 'انتقال، افتح صفحة، اذهب إلى، اعرض',
  smalltalk: 'تحية، شكر، سؤال عام، دردشة، مساعدة عامة بلا إجراء محاسبي',
  other: 'لا ينتمي لأي مما سبق أو طلب غير واضح',
} as const;

export type JevIntent = keyof typeof JEV_INTENT_CRITERIA;

// Domain → tool name prefixes (mirrors DOMAIN_GROUPS in toolRouter.ts).
// Search unification (2026-09-24): each search.* family rides its domain so
// verification stays one intent away; jev.search_all alone is always-on.
const INTENT_TO_PREFIXES: Record<JevIntent, readonly string[]> = {
  sales: ['sales.', 'jev.rank_customers_churn', 'search.customers', 'search.sales_invoices', 'search.quotations', 'search.sales_returns'],
  purchases: ['purchases.', 'search.suppliers', 'search.purchase_invoices', 'search.purchase_orders', 'search.purchase_returns'],
  inventory: ['inventory.', 'read.inventory_kpis', 'read.inventory_valuation', 'search.boms', 'search.work_orders', 'jev.score_stock', 'search.products', 'search.product_units', 'search.units', 'search.warehouses', 'search.categories', 'search.stock_movements', 'search.stock_adjustments', 'search.stock_transfers'],
  hr: ['hr.', 'read.attendance_summary', 'read.employee_payroll_history', 'read.end_of_service', 'read.hr_kpis', 'search.employees', 'search.attendance', 'search.leaves', 'search.payroll_runs', 'search.end_of_services'],
  crm: ['crm.', 'manufacturing.check_bom_availability', 'jev.score_lead', 'search.leads', 'search.opportunities', 'search.tasks', 'search.activities'],
  manufacturing: ['manufacturing.', 'search.boms', 'search.work_orders', 'search.products'],
  pos: ['pos.'],
  settings: ['settings.', 'search.cash_boxes', 'search.cost_centers', 'search.units', 'search.product_types', 'search.document_sequences', 'search.categories'],
  accounting: ['accounting.', 'search.accounts', 'search.cash_boxes', 'search.receipt_vouchers', 'search.payment_vouchers', 'search.journal_entries'],
  tax: ['tax.', 'accounting.'], // tax intent routes accounting close/depreciation too
  reports: ['sales.', 'purchases.', 'inventory.', 'hr.', 'crm.', 'manufacturing.', 'accounting.', 'reports.', 'read.', 'diagnose.', 'jev.'],
  navigation: ['app.'],
  smalltalk: [],
  other: [],
};

const ALWAYS_ON = [
  'app.list_pages', 'app.navigate', 'core.get_company_info',
  'ai.batch_status', 'ai.classify_document', 'ai.enqueue_batch', 'ai.resume_batch',
  'ai.clear_queue',
  // Unified search is the ONLY always-on search path (session 2026-09-24 —
  // see toolRouter.ts). Individual search.* tools ride their intent below.
  'jev.search_all',
] as const;

const PROB_THRESHOLD = 0.22; // multi-intent: "فاتورة مشتريات" → sales 0.48 + purchases 0.51
const HIGH_CONFIDENCE = 0.85;
const LOW_CONFIDENCE = 0.50;

export interface JevRouteResult extends RoutedTools {
  /** JEV intent that drove the routing (or 'fallback'). */
  intent: JevIntent | 'fallback';
  /** Full probability distribution from JEV (null when fallback). */
  probabilities: Record<string, number> | null;
  /** Confidence of the winning intent. */
  confidence: number;
  /** Whether JEV was consulted (false = disabled / no key / timeout). */
  jevUsed: boolean;
  /** True when this result came from the per-send cache (no new JEV call). */
  cached?: boolean;
}

/**
 * Per-send router cache: iterations 2..N of one send() share the same user
 * text, so re-asking JEV every loop turn burns ~150ms × 9 for an identical
 * answer. Key = normalized user text + sorted adaptive extras (expansion
 * invalidates naturally). TTL 60s, capped — a new user message misses.
 */
const ROUTE_CACHE_TTL_MS = 60_000;
const ROUTE_CACHE_MAX = 50;
const routeCache = new Map<string, { at: number; result: JevRouteResult }>();

function routeCacheKey(userText: string, extraToolNames: ReadonlySet<string>): string {
  const norm = userText.trim().replace(/\s+/g, ' ').slice(0, 2000);
  const extras = [...extraToolNames].sort().join(',');
  return `${norm}‖${extras}`;
}

function getCachedRoute(key: string): JevRouteResult | null {
  const entry = routeCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > ROUTE_CACHE_TTL_MS) {
    routeCache.delete(key);
    return null;
  }
  return { ...entry.result, cached: true };
}

function setCachedRoute(key: string, result: JevRouteResult): void {
  if (routeCache.size >= ROUTE_CACHE_MAX) {
    const oldest = routeCache.keys().next().value;
    if (oldest !== undefined) routeCache.delete(oldest);
  }
  routeCache.set(key, { at: Date.now(), result: { ...result, cached: false } });
}

export function clearRouterCache(): void {
  routeCache.clear();
}

function recentUserText(messages: LlmMessage[], lookback = 2): string {
  const texts: string[] = [];
  for (let i = messages.length - 1; i >= 0 && texts.length < lookback; i--) {
    const m = messages[i];
    if (m.role !== 'user') continue;
    const c = m.content;
    if (typeof c === 'string') texts.push(c);
    else if (Array.isArray(c)) texts.push(c.filter((p): p is { type: 'text'; text: string } => p.type === 'text').map((p) => p.text).join(' '));
  }
  return texts.join(' ').slice(0, 2000);
}

function recentCalledToolNames(messages: LlmMessage[], lookback = 6): string[] {
  const out: string[] = [];
  for (let i = messages.length - 1; i >= 0 && out.length < lookback; i--) {
    const m = messages[i];
    if (m.role !== 'assistant') continue;
    const calls = (m as { tool_calls?: Array<{ function?: { name?: string }; name?: string }> }).tool_calls;
    if (!Array.isArray(calls)) continue;
    for (const tc of calls) {
      const name = typeof tc?.function?.name === 'string' && tc.function.name ? tc.function.name : typeof tc?.name === 'string' ? tc.name : '';
      if (name && !out.includes(name)) out.push(name);
    }
  }
  return out;
}

/**
 * JEV-powered routing. Falls back to legacy keyword router on any failure.
 */
export async function jevRouteToolsForCycle(
  companyId: string,
  messages: LlmMessage[],
  extraToolNames: ReadonlySet<string> = new Set(),
): Promise<JevRouteResult> {
  const config = await getJevConfig(companyId).catch(() => null);
  const jevEnabled = !!config?.enabled && !!config.apiKey && !!config.routerEnabled;

  if (!jevEnabled) {
    const legacy = legacyRouteToolsForCycle(messages, extraToolNames);
    return { ...legacy, intent: 'fallback', probabilities: null, confidence: 0, jevUsed: false };
  }

  const userText = recentUserText(messages, 2);
  if (!userText.trim()) {
    const legacy = legacyRouteToolsForCycle(messages, extraToolNames);
    return { ...legacy, intent: 'fallback', probabilities: null, confidence: 0, jevUsed: false };
  }

  // Per-send cache hit → zero-cost reuse (adaptive extras are part of the key).
  const cacheKey = routeCacheKey(userText, extraToolNames);
  const cached = getCachedRoute(cacheKey);
  if (cached) return cached;

  const result = await jevSystemOne(
    companyId,
    {
      state: { userText },
      questions: {
        intent: {
          type: 'choice',
          instructions: 'ما نية المستخدم الرئيسية في هذه الرسالة؟ اختر الفئة الأقرب.',
          criteria: JEV_INTENT_CRITERIA as unknown as Record<string, string>,
        },
      },
    },
    { timeoutMs: 1800, label: 'jev-router' },
  );

  if (!result || !result.answers?.intent) {
    const legacy = legacyRouteToolsForCycle(messages, extraToolNames);
    const out: JevRouteResult = { ...legacy, intent: 'fallback', probabilities: null, confidence: 0, jevUsed: false };
    setCachedRoute(cacheKey, out);
    return out;
  }

  const answer = result.answers.intent as { choice: string; confidence: number; probabilities: Record<string, number> };
  const winner = answer.choice as JevIntent;
  const confidence = answer.confidence ?? 0;
  const probs = answer.probabilities ?? {};

  // Low confidence → fall back to legacy router (don't guess intent)
  if (confidence < LOW_CONFIDENCE) {
    const legacy = legacyRouteToolsForCycle(messages, extraToolNames);
    const out: JevRouteResult = { ...legacy, intent: winner, probabilities: probs, confidence, jevUsed: true };
    setCachedRoute(cacheKey, out);
    return out;
  }

  // Build routed set from probabilities > threshold (multi-intent)
  const visible = getVisibleTools();
  const visibleByName = new Map(visible.map((t) => [t.name, t]));
  const selected = new Set<string>();

  for (const name of ALWAYS_ON) if (visibleByName.has(name)) selected.add(name);

  // Winner always routed (even if prob just under threshold due to spread)
  const intentsToRoute = new Set<JevIntent>();
  intentsToRoute.add(winner);
  for (const [intent, prob] of Object.entries(probs)) {
    if ((prob as number) >= PROB_THRESHOLD && intent in INTENT_TO_PREFIXES) {
      intentsToRoute.add(intent as JevIntent);
    }
  }

  for (const intent of intentsToRoute) {
    const prefixes = INTENT_TO_PREFIXES[intent];
    if (!prefixes || prefixes.length === 0) continue;
    for (const t of visible) {
      if (prefixes.some((p) => t.name.startsWith(p) || t.name === p)) selected.add(t.name);
    }
  }

  // Workflow continuity (C1) — keep domains of recently called tools
  for (const called of recentCalledToolNames(messages, 6)) {
    if (visibleByName.has(called)) selected.add(called);
    for (const [intent, prefixes] of Object.entries(INTENT_TO_PREFIXES)) {
      if (intentsToRoute.has(intent as JevIntent)) continue;
      if (!prefixes.some((p) => called.startsWith(p))) continue;
      // Don't drag the expensive 'reports' mega-group via continuity
      if (intent === 'reports') continue;
      intentsToRoute.add(intent as JevIntent);
      for (const t of visible) {
        if (prefixes.some((p) => t.name.startsWith(p) || t.name === p)) selected.add(t.name);
      }
    }
  }

  for (const name of extraToolNames) if (visibleByName.has(name)) selected.add(name);

  // Relevance-ordered slicing — tier 0 ALWAYS_ON, tier 1 matched, tier 2 adaptive
  const inAlwaysOn = (name: string): boolean => (ALWAYS_ON as readonly string[]).includes(name);
  const inMatched = (name: string): boolean => {
    for (const intent of intentsToRoute) {
      const prefs = INTENT_TO_PREFIXES[intent];
      if (prefs?.some((p) => name.startsWith(p) || name === p)) return true;
    }
    return false;
  };
  const tierOf = (name: string): number => {
    if (inAlwaysOn(name)) return 0;
    if (inMatched(name)) return 1;
    return 2;
  };

  const posInTier = new Map<string, number>();
  {
    const counters = new Map<string, number>();
    for (const t of visible) {
      if (!selected.has(t.name)) continue;
      const key = tierOf(t.name) === 0 ? 'core' : tierOf(t.name) === 1 ? 'matched' : 'adaptive';
      const n = counters.get(key) ?? 0;
      counters.set(key, n + 1);
      posInTier.set(t.name, n);
    }
  }

  const ordered = visible
    .filter((t) => selected.has(t.name))
    .map((t, idx) => ({ t, tier: tierOf(t.name), pos: posInTier.get(t.name) ?? idx, idx }))
    .sort((a, b) => a.tier - b.tier || (a.tier === 1 ? a.pos - b.pos || a.idx - b.idx : a.idx - b.idx))
    .map((x) => x.t);

  const capped = ordered.length > MAX_ADVERTISED_TOOLS ? ordered.slice(0, MAX_ADVERTISED_TOOLS) : ordered;
  const dropped = ordered.length - capped.length;

  const out: JevRouteResult = {
    tools: capped,
    dropped,
    routedByIntent: intentsToRoute.size > 0,
    intent: winner,
    probabilities: probs,
    confidence,
    jevUsed: true,
  };
  setCachedRoute(cacheKey, out);
  return out;
}

/** Whether JEV routing is active for this company (for metrics/UI). */
export function isJevRouterActive(config: { enabled: boolean; routerEnabled: boolean; apiKey: string | null } | null): boolean {
  return !!config?.enabled && !!config.routerEnabled && !!config?.apiKey;
}

export { HIGH_CONFIDENCE, LOW_CONFIDENCE, PROB_THRESHOLD };
