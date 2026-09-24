import type { LlmMessage } from '../types';
import { getVisibleTools } from '../tools/registry';

/**
 * Tool router — selects a bounded subset of tools to advertise to the LLM
 * per cycle. Without routing, every visible tool (~200+) reaches the wire,
 * which providers (and our own main-process guard, cap 128) reject outright.
 *
 * Selection is intent-based:
 *   1. An ALWAYS-ON core (navigation, meta, batch, unified search) travels
 *      every cycle so the assistant is never blind in a basic conversation.
 *   2. Intent keywords in the last user messages route the matching DOMAIN
 *      group (sales / purchases / inventory / hr / crm / manufacturing /
 *      settings / accounting) into the advertised set.
 *   3. Workflow continuity (C1): domains of tools the model ALREADY called
 *      in recent turns stay routed — a keyword-less follow-up ("تابع")
 *      mid-chain (create → post → voucher) keeps the whole workflow.
 *   4. Adaptive expansion: when the model calls a registered tool that was
 *      not advertised, that tool (and its domain siblings) join the set for
 *      the rest of the cycle — a mistaken route degrades to one wasted turn,
 *      never a hard failure.
 *
 * RBAC is never bypassed: the router only ever narrows `getVisibleTools()`.
 */

/** Hard cap on advertised tools — safely under the main-process limit (128). */
export const MAX_ADVERTISED_TOOLS = 48;

/** How many trailing user messages are scanned for intent keywords. */
const INTENT_LOOKBACK = 3;

const ALWAYS_ON_TOOLS: readonly string[] = [
  // navigation + meta
  'app.list_pages',
  'app.navigate',
  'core.get_company_info',
  'ai.batch_status',
  'ai.classify_document',
  'ai.enqueue_batch',
  'ai.resume_batch',
  'ai.clear_queue',
  // Unified search is the ONLY always-on search path (session 2026-09-24:
  // advertising search.* next to jev.search_all split the model across two
  // search paths — one LLM turn + one 200-row fetch PER family, up to the
  // iteration cap. Individual search.* tools ride their domain groups below
  // and stay reachable for single-entity verification + adaptive expansion).
  'jev.search_all',
];

interface DomainGroup {
  /** Domain of tools routed in when this group's keywords match. */
  prefixes: readonly string[];
  /** Arabic keywords that signal the user's intent involves this domain. */
  keywords: readonly string[];
  /**
   * Mega-groups (the reports bundle: 9 domains) route on keywords ONLY —
   * workflow continuity must not drag all nine domains in just because the
   * model called one sales tool mid-chain.
   */
  keywordOnly?: boolean;
}

/**
 * Intent keyword map (Arabic-first). Order matters only for ALWAYS_ON
 * dedup; groups are unioned, first-match-wins is NOT applied — a message
 * mentioning "فاتورة مشتريات" routes BOTH sales and purchases groups.
 */
const DOMAIN_GROUPS: readonly DomainGroup[] = [
  {
    // P3 fix: the read.* names here were ghosts from a pre-Phase-94 layout
    // (read.ar_aging, read.customer_statement… do not exist — the only
    // read.* tools are the six in readTools.ts). Ghost prefixes are harmless
    // (visibleByName filters) but lie to the reader; domain prefixes alone
    // already route the whole family (see the reports group below).
    // P1 (JEV): jev.rank_customers_churn rides the sales intent.
    // Search unification (2026-09-24): search.* left ALWAYS_ON for
    // jev.search_all — each family rides its domain so verification stays
    // one intent away, never a blind guess.
    prefixes: [
      'sales.', 'jev.rank_customers_churn',
      'search.customers', 'search.sales_invoices', 'search.quotations', 'search.sales_returns',
    ],
    keywords: [
      'بيع', 'مبيعات', 'فاتورة بيع', 'فواتير بيع', 'عميل', 'عملاء', 'عرض سعر', 'عروض أسعار',
      'مردود', 'مرتجع', 'تسعيرة', 'مردودات', 'أجل', 'مدين', 'ذمم', 'أرصدة العملاء',
      'تحصيل', 'العميل',
    ],
  },
  {
    prefixes: [
      'purchases.',
      'search.suppliers', 'search.purchase_invoices', 'search.purchase_orders', 'search.purchase_returns',
    ],
    keywords: [
      'شراء', 'مشتريات', 'فاتورة شراء', 'فواتير شراء', 'مورد', 'موردين', 'أمر شراء',
      'أوامر شراء', 'مردود مشتريات', 'مديونية', 'أرصدة الموردين', 'دائن', 'سداد',
    ],
  },
  {
    // P1 (JEV): jev.score_stock rides the inventory intent.
    prefixes: [
      'inventory.', 'read.inventory_kpis', 'read.inventory_valuation', 'jev.score_stock',
      'search.products', 'search.product_units', 'search.units', 'search.warehouses',
      'search.categories', 'search.stock_movements', 'search.stock_adjustments', 'search.stock_transfers',
    ],
    keywords: [
      'مخزن', 'مخازن', 'مخزون', 'منتج', 'منتجات', 'صنف', 'أصناف', 'مستودع', 'مستودعات',
      'جرد', 'تحويل مخزني', 'تسويات', 'كرتون', 'درزن', 'كميات', 'تالفة', 'راكد',
    ],
  },
  {
    prefixes: [
      'hr.', 'read.attendance_summary', 'read.employee_payroll_history', 'read.end_of_service', 'read.hr_kpis',
      'search.employees', 'search.attendance', 'search.leaves', 'search.payroll_runs',
      'search.end_of_services', 'search.departments',
    ],
    keywords: [
      'موظف', 'موظفين', 'موظفون', 'راتب', 'رواتب', 'مسير', 'حضور', 'غياب', 'انصراف',
      'إجازة', 'إجازات', 'دوام', 'علاوة', 'استقطاع', 'نهاية خدمة', 'قسم', 'أقسام',
      'مستحقات', 'بدل', 'خصم',
    ],
  },
  {
    // P1 (JEV): jev.score_lead rides the CRM intent.
    prefixes: [
      'crm.', 'manufacturing.check_bom_availability', 'jev.score_lead',
      'search.leads', 'search.opportunities', 'search.tasks', 'search.activities',
    ],
    keywords: [
      'عميل محتمل', 'عملاء محتملين', 'فرصة', 'فرص', 'مرشح', 'مرشحين', 'قيادة', 'عملاء جدد',
      'متابعة', 'مهمة', 'مهام', 'نشاط', 'أنشطة', 'مكالمة', 'مسار البيع', 'قمع',
      'تحويل عميل', 'تصفية العميل', 'تأهيل',
    ],
  },
  {
    prefixes: [
      'manufacturing.', 'search.boms', 'search.work_orders', 'search.products',
    ],
    keywords: [
      'تصنيع', 'إنتاج', 'تشغيل', 'أمر تشغيل', 'أوامر تشغيل', 'bom', 'قائمة مواد',
      'تكلفة الإنتاج', 'خطة الإنتاج', 'منتج نهائي', 'تجميع', 'تصنيعي',
    ],
  },
  {
    prefixes: ['pos.'],
    keywords: [
      'نقطة بيع', 'نقطة البيع', 'كاشير', 'الكاشير', 'وردية', 'ورديات', 'شيفت',
      'إيصال', 'إيصالات', 'تقرير z', 'مبيعات نقدية', 'بيع نقدي',
      'pos', 'cashier', 'shift', 'receipt', 'z',
    ],
  },
  {
    prefixes: ['settings.', 'search.cash_boxes', 'search.cost_centers', 'search.units', 'search.product_types', 'search.document_sequences', 'search.categories'],
    keywords: [
      'إعدادات', 'اعدادات', 'ثيم', 'ثيمات', 'ألوان', 'مظهر', 'واجهة', 'فرع', 'فروع',
      'صندوق', 'صناديق', 'مركز تكلفة', 'وحدة', 'وحدات', 'نوع منتج', 'أنواع منتجات',
      'تسلسل', 'ترقيم', 'قوالب', 'قالب',
    ],
  },
  {
    // Tax & fixed-assets intent: the tax.* family (plus the accounting.*
    // tools that host close_fiscal_year / run_depreciation / vat_summary
    // today) routes in on country/period/return/asset vocabulary.
    prefixes: ['tax.', 'accounting.'],
    keywords: [
      'دولة', 'الدولة', 'السعودية', 'الإمارات', 'مصر', 'اليمن',
      'إقرار', 'الإقرار', 'فترة ضريبية', 'فترات ضريبية', 'فترة', 'فترات',
      'إعادة تقييم', 'فروق صرف', 'مخصص إجازات',
      'أصل', 'أصول', 'الأصول', 'أصل ثابت', 'إهلاك', 'الإهلاك', 'استبعاد',
      'إقفال', 'الإقفال', 'سنة مالية', 'قفل الفترة',
      'tax', 'country', 'return', 'period', 'revalue',
      'fixed', 'depreciation', 'depreciate', 'year-end', 'fiscal',
    ],
  },
  {
    // P3 fix: the catch-all 'read.' suffix made ANY accounting-ish word pull
    // every read.* tool (fine for "حساب" reports, but document the intent).
    // Ghost names (read.profit_loss, read.balance_sheet) removed — only the
    // six real read.* tools (readTools.ts) may be named explicitly.
    prefixes: [
      'accounting.',
      'search.accounts', 'search.cash_boxes', 'search.receipt_vouchers',
      'search.payment_vouchers', 'search.journal_entries', 'search.cost_centers',
    ],
    keywords: [
      'قيود', 'قيد', 'يومية', 'حساب', 'حسابات', 'شجرة الحسابات', 'ميزان', 'ميزانية',
      'أرباح', 'خسائر', 'تدفق نقدي', 'تدفقات', 'سند', 'سندات', 'قبض', 'صرف',
      'مصروف', 'مصروفات', 'رصيد', 'أرصدة', 'ضريبة', 'ضريبة القيمة المضافة', 'vat',
      'مراكز', 'تحليل مالي', 'كشف حساب', 'صافي',
    ],
  },
  {
    prefixes: ['diagnose.', 'reports.'],
    keywords: [
      'تشخيص', 'خطأ', 'أخطاء', 'مشكلة', 'مشاكل', 'فحص', 'لماذا', 'لم', 'تفشل',
      'داشبورد', 'لوحة', 'مؤشرات', 'kpi', 'أداء',
    ],
  },
  {
    // Reports family is expensive to advertise (large schemas) — route it
    // whenever the user asks for analysis/summary/comparison vocabulary.
    // keywordOnly: a called sales.* tool mid-workflow must NOT pull all nine
    // domains in (continuity routes the tool's own narrow domain only).
    keywordOnly: true,
    prefixes: ['sales.', 'purchases.', 'inventory.', 'hr.', 'crm.', 'manufacturing.', 'accounting.', 'reports.', 'read.', 'jev.'],
    keywords: [
      'تقرير', 'تقارير', 'تحليل', 'توليد', 'ملخص', 'أفضل', 'أعلى', 'أقل', 'قارن',
      'مقارنة', 'إحصائيات', 'رتب', 'ترتيب', 'نسب', 'معدل', 'متوسط', 'نمو',
    ],
  },
];

/** Advertised-tool set for the current cycle, RBAC- and registry-respecting. */
export interface RoutedTools {
  /** Tool definitions to advertise this cycle. */
  tools: ReturnType<typeof getVisibleTools>;
  /** Number of tools dropped by the cap (0 = everything fit). */
  dropped: number;
  /** Whether intent routing added any domain group beyond ALWAYS_ON. */
  routedByIntent: boolean;
}

/** Extract intent text from the trailing user messages of a conversation. */
function recentUserText(messages: LlmMessage[], lookback: number): string {
  const texts: string[] = [];
  for (let i = messages.length - 1; i >= 0 && texts.length < lookback; i--) {
    const m = messages[i];
    if (m.role !== 'user') continue;
    const content = m.content;
    if (typeof content === 'string') {
      texts.push(content);
    } else if (Array.isArray(content)) {
      texts.push(content.filter((p): p is { type: 'text'; text: string } => p.type === 'text').map((p) => p.text).join(' '));
    }
  }
  return texts.join(' ');
}

/** Tool names the model called in recent turns (C1 workflow continuity). */
function recentCalledToolNames(messages: LlmMessage[], lookback: number): string[] {
  const out: string[] = [];
  for (let i = messages.length - 1; i >= 0 && out.length < lookback; i--) {
    const m = messages[i];
    if (m.role !== 'assistant') continue;
    const calls = (m as { tool_calls?: Array<{ function?: { name?: string }; name?: string }> }).tool_calls;
    if (!Array.isArray(calls)) continue;
    for (const tc of calls) {
      const name = typeof tc?.function?.name === 'string' && tc.function.name
        ? tc.function.name
        : typeof tc?.name === 'string' ? tc.name : '';
      if (name && !out.includes(name)) out.push(name);
    }
  }
  return out;
}

/** Compute the routed tool set for a cycle. */
export function routeToolsForCycle(messages: LlmMessage[], extraToolNames: ReadonlySet<string> = new Set()): RoutedTools {
  const visible = getVisibleTools();
  const visibleByName = new Map(visible.map((t) => [t.name, t]));

  const selected = new Set<string>();
  // ALWAYS-ON core first — highest priority, always present.
  for (const name of ALWAYS_ON_TOOLS) {
    if (visibleByName.has(name)) selected.add(name);
  }

  // Intent-based domain routing. Matched groups are recorded IN ORDER so
  // relevance ordering below can prioritize them.
  const intentText = recentUserText(messages, INTENT_LOOKBACK);
  let routedByIntent = false;
  const matchedGroups: DomainGroup[] = [];
  if (intentText.trim().length > 0) {
    for (const group of DOMAIN_GROUPS) {
      const matches = group.keywords.some((k) => intentText.includes(k));
      if (!matches) continue;
      routedByIntent = true;
      matchedGroups.push(group);
      for (const t of visible) {
        if (group.prefixes.some((p) => t.name.startsWith(p))) selected.add(t.name);
      }
    }
  }

  // C1 — workflow continuity: the model just called these tools (create →
  // post → voucher chains), so their DOMAINS stay routed even when the
  // follow-up carries no keywords at all ("تابع", "استمر", "تمام").
  // Keyword matching alone would drop the whole workflow mid-chain.
  for (const called of recentCalledToolNames(messages, 6)) {
    if (visibleByName.has(called)) selected.add(called);
    for (const group of DOMAIN_GROUPS) {
      if (matchedGroups.includes(group)) continue;
      if (group.keywordOnly) continue;
      if (!group.prefixes.some((p) => called.startsWith(p))) continue;
      routedByIntent = true;
      matchedGroups.push(group);
      for (const t of visible) {
        if (group.prefixes.some((p) => t.name.startsWith(p))) selected.add(t.name);
      }
    }
  }

  // Adaptive expansion — tools the model already called this cycle stay in.
  for (const name of extraToolNames) {
    if (visibleByName.has(name)) selected.add(name);
  }

  // P1 fix: relevance-ordered slicing. The old code sliced by REGISTRY
  // insertion order, so a broad intent ("تقارير" → ~150 tools across 9
  // domains) kept the first 48 registered — all reads/searches/sales — and
  // silently dropped the very hr./crm./manufacturing. tools the intent had
  // routed. Ordering now:
  //   tier 0 — ALWAYS-ON core (navigation, batching, classify…): protected,
  //            the model must never lose these mid-conversation;
  //   tier 1 — intent-matched domains, ROUND-ROBIN interleaved by domain
  //            (declaration order), so every routed domain stays
  //            REPRESENTED instead of the first domains eating the cap;
  //   tier 2 — adaptive extras outside any matched domain.
  // Within a tier the registry order is preserved (still deterministic for
  // provider caching).
  const inAlwaysOn = (name: string): boolean => (ALWAYS_ON_TOOLS as readonly string[]).includes(name);
  const domainTierOf = (name: string): number => {
    for (let g = 0; g < DOMAIN_GROUPS.length; g++) {
      if (DOMAIN_GROUPS[g].prefixes.some((p) => name.startsWith(p))) return g;
    }
    return -1;
  };
  const matchedDomainSet = new Set(matchedGroups.flatMap((g) => g.prefixes));
  const inMatchedDomain = (name: string): boolean =>
    matchedDomainSet.size > 0 && [...matchedDomainSet].some((p) => name.startsWith(p));
  // Position of each tool among its own domain-tier peers (registry order).
  const posInTier = new Map<string, number>();
  {
    const counters = new Map<string, number>();
    for (const t of visible) {
      if (!selected.has(t.name)) continue;
      const key = inAlwaysOn(t.name) ? 'core' : inMatchedDomain(t.name) ? `d${domainTierOf(t.name)}` : 'adaptive';
      const n = counters.get(key) ?? 0;
      counters.set(key, n + 1);
      posInTier.set(t.name, n);
    }
  }
  const tierOf = (name: string): number => {
    if (inAlwaysOn(name)) return 0;
    if (inMatchedDomain(name)) return 1;
    return 2;
  };
  const ordered = visible
    .filter((t) => selected.has(t.name))
    .map((t, idx) => ({ t, tier: tierOf(t.name), pos: posInTier.get(t.name) ?? idx, idx }))
    .sort((a, b) => a.tier - b.tier || (a.tier === 1 ? (a.pos - b.pos || a.idx - b.idx) : (a.idx - b.idx)))
    .map((x) => x.t);
  const capped = ordered.length > MAX_ADVERTISED_TOOLS ? ordered.slice(0, MAX_ADVERTISED_TOOLS) : ordered;
  const dropped = ordered.length - capped.length;

  return {
    tools: capped,
    dropped,
    routedByIntent,
  };
}

/** Whether an intent-routed or always-on tool set should degrade gracefully. */
export function describeRouting(routed: RoutedTools): string | null {
  if (routed.dropped > 0) {
    return `تم الاقتصاص إلى ${MAX_ADVERTISED_TOOLS} أداة (سقطت ${routed.dropped} أداة من التوجيه)`;
  }
  return null;
}
