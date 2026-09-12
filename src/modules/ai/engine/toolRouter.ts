import type { LlmMessage } from '../types';
import { getVisibleTools } from '../tools/registry';

/**
 * Tool router — selects a bounded subset of tools to advertise to the LLM
 * per cycle. Without routing, every visible tool (~200+) reaches the wire,
 * which providers (and our own main-process guard, cap 128) reject outright.
 *
 * Selection is intent-based:
 *   1. An ALWAYS-ON core (navigation, primary search, meta, batch) travels
 *      every cycle so the assistant is never blind in a basic conversation.
 *   2. Intent keywords in the last user messages route the matching DOMAIN
 *      group (sales / purchases / inventory / hr / crm / manufacturing /
 *      settings / accounting) into the advertised set.
 *   3. Adaptive expansion: when the model calls a registered tool that was
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
  // primary search — the backbone of entity resolution
  'search.customers',
  'search.suppliers',
  'search.products',
  'search.sales_invoices',
  'search.purchase_invoices',
  'search.accounts',
  'search.employees',
  'search.journal_entries',
];

interface DomainGroup {
  /** Domain of tools routed in when this group's keywords match. */
  prefixes: readonly string[];
  /** Arabic keywords that signal the user's intent involves this domain. */
  keywords: readonly string[];
}

/**
 * Intent keyword map (Arabic-first). Order matters only for ALWAYS_ON
 * dedup; groups are unioned, first-match-wins is NOT applied — a message
 * mentioning "فاتورة مشتريات" routes BOTH sales and purchases groups.
 */
const DOMAIN_GROUPS: readonly DomainGroup[] = [
  {
    prefixes: ['sales.', 'read.ar_aging', 'read.customer_statement', 'read.sales_analysis'],
    keywords: [
      'بيع', 'مبيعات', 'فاتورة بيع', 'فواتير بيع', 'عميل', 'عملاء', 'عرض سعر', 'عروض أسعار',
      'مردود', 'مرتجع', 'تسعيرة', 'مردودات', 'أجل', 'مدين', 'ذمم', 'أرصدة العملاء',
      'تحصيل', 'العميل',
    ],
  },
  {
    prefixes: ['purchases.', 'read.ap_aging', 'read.supplier_statement'],
    keywords: [
      'شراء', 'مشتريات', 'فاتورة شراء', 'فواتير شراء', 'مورد', 'موردين', 'أمر شراء',
      'أوامر شراء', 'مردود مشتريات', 'مديونية', 'أرصدة الموردين', 'دائن', 'سداد',
    ],
  },
  {
    prefixes: ['inventory.', 'read.inventory_kpis', 'read.inventory_valuation', 'read.low_stock_alert'],
    keywords: [
      'مخزن', 'مخازن', 'مخزون', 'منتج', 'منتجات', 'صنف', 'أصناف', 'مستودع', 'مستودعات',
      'جرد', 'تحويل مخزني', 'تسويات', 'كرتون', 'درزن', 'كميات', 'تالفة', 'راكد',
    ],
  },
  {
    prefixes: ['hr.', 'read.attendance_summary', 'read.employee_payroll_history', 'read.end_of_service', 'read.hr_kpis'],
    keywords: [
      'موظف', 'موظفين', 'موظفون', 'راتب', 'رواتب', 'مسير', 'حضور', 'غياب', 'انصراف',
      'إجازة', 'إجازات', 'دوام', 'علاوة', 'استقطاع', 'نهاية خدمة', 'قسم', 'أقسام',
      'مستحقات', 'بدل', 'خصم',
    ],
  },
  {
    prefixes: ['crm.', 'manufacturing.check_bom_availability'],
    keywords: [
      'عميل محتمل', 'عملاء محتملين', 'فرصة', 'فرص', 'مرشح', 'مرشحين', 'قيادة', 'عملاء جدد',
      'متابعة', 'مهمة', 'مهام', 'نشاط', 'أنشطة', 'مكالمة', 'مسار البيع', 'قمع',
      'تحويل عميل', 'تصفية العميل', 'تأهيل',
    ],
  },
  {
    prefixes: ['manufacturing.', 'search.boms', 'search.work_orders'],
    keywords: [
      'تصنيع', 'إنتاج', 'تشغيل', 'أمر تشغيل', 'أوامر تشغيل', 'bom', 'قائمة مواد',
      'تكلفة الإنتاج', 'خطة الإنتاج', 'منتج نهائي', 'تجميع', 'تصنيعي',
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
    prefixes: ['accounting.', 'read.profit_loss', 'read.balance_sheet', 'read.'],
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
    prefixes: ['sales.', 'purchases.', 'inventory.', 'hr.', 'crm.', 'manufacturing.', 'accounting.', 'reports.', 'read.'],
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
