/**
 * entityService — unified entity-resolution choke point (Phase 1 of unification).
 *
 * Problem it fixes: the engine had TWO competing pre-LLM search paths
 * (jevSearchAll + resolveEntitiesInText token fan-out) PLUS ~30 individual
 * search.* tools the model could fan out to. The same request paid the
 * search cost 3-6 times and each path ranked differently, so the model
 * re-searched instead of executing.
 *
 * Contract (approved):
 * - Local fuzzy resolution FIRST (single source: entityResolver.searchEntities).
 * - JEV is FALLBACK only, consulted once for ambiguous (0.55–0.85) cases.
 * - score ≥ 0.85 → 'same' (execute silently).
 * - score < 0.55 or zero hits → 'missing' (ask to create, never retry silently).
 * - in between → 'confirm' (exactly ONE clarifying question, never execute blind).
 */
import { normalizeArabic } from '@/core/utils/normalizeArabic';
import {
  searchEntities,
  type EntityMatch,
  type EntityType,
} from '../entityResolver';

export type EntityKind =
  | 'customer'
  | 'supplier'
  | 'product'
  | 'account'
  | 'cash_box'
  | 'warehouse'
  | 'employee'
  | 'lead'
  | 'opportunity'
  | 'invoice'
  | 'purchaseInvoice'
  | 'quotation'
  | 'receiptVoucher'
  | 'paymentVoucher'
  | 'workOrder'
  | 'bom';

export interface EntityRequest {
  /** Raw user text for this entity ("محمد الأحمدي"، "كرتون"). */
  text: string;
  kind: EntityKind;
}

export type ResolveStatus = 'same' | 'confirm' | 'missing';

export interface ResolvedEntity {
  request: EntityRequest;
  status: ResolveStatus;
  /** Usable UUID when status === 'same'. */
  id: string | null;
  /** Canonical display name. */
  name: string | null;
  /** Local fuzzy score of the best candidate (0–1). */
  score: number;
  /** Top candidates for the single clarifying question / create suggestion. */
  candidates: Array<{ id: string; name: string; score: number }>;
}

/** Approved thresholds: ≥0.85 auto, <0.55 missing, between → confirm once. */
export const ENTITY_SAME_THRESHOLD = 0.85;
export const ENTITY_MISSING_THRESHOLD = 0.55;
/** Rival within this gap of the winner forces 'confirm' (never guess). */
const AMBIGUITY_GAP = 0.05;
/** JEV fallback promotes to 'same' only at/above this confidence. */
const JEV_PROMOTE_CONFIDENCE = 0.7;

const KIND_TO_TYPES: Record<EntityKind, EntityType[]> = {
  customer: ['customer'],
  supplier: ['supplier'],
  product: ['product'],
  account: ['account'],
  cash_box: ['cashBox'],
  warehouse: ['warehouse'],
  employee: ['employee'],
  lead: ['lead'],
  opportunity: ['opportunity'],
  invoice: ['invoice'],
  purchaseInvoice: ['purchaseInvoice'],
  quotation: ['quotation'],
  receiptVoucher: ['receiptVoucher'],
  paymentVoucher: ['paymentVoucher'],
  workOrder: ['workOrder'],
  bom: ['bom'],
};

const KIND_LABEL_AR: Record<EntityKind, string> = {
  customer: 'عميل',
  supplier: 'مورد',
  product: 'منتج',
  account: 'حساب',
  cash_box: 'خزنة',
  warehouse: 'مستودع',
  employee: 'موظف',
  lead: 'عميل محتمل',
  opportunity: 'فرصة بيعية',
  invoice: 'فاتورة مبيعات',
  purchaseInvoice: 'فاتورة مشتريات',
  quotation: 'عرض سعر',
  receiptVoucher: 'سند قبض',
  paymentVoucher: 'سند صرف',
  workOrder: 'أمر تشغيل',
  bom: 'شجرة منتج',
};

export function entityKindLabel(kind: EntityKind): string {
  return KIND_LABEL_AR[kind] ?? kind;
}

/**
 * Stable dedup key for the read-loop guard: same entity text + kind asked
 * twice with different spelling ("شركة" vs "شركه") maps to one key so the
 * second identical search is nudged, not executed.
 */
export function normalizeEntityKey(kind: string, text: string): string {
  return `${normalizeArabic(kind)}::${normalizeArabic(text)}`;
}

function toCandidates(matches: EntityMatch[], limit = 3): ResolvedEntity['candidates'] {
  return matches.slice(0, limit).map((m) => ({
    id: m.id,
    name: m.name,
    score: Math.round(m.confidence * 100) / 100,
  }));
}

/**
 * JEV fallback for the ambiguous band only. Resolves via a single Choice call
 * over the local shortlist — never a fresh DB fan-out. Returns the winner's
 * confidence, or null when JEV is unavailable/misses (caller → 'confirm').
 */
async function jevFallbackConfidence(
  companyId: string,
  label: string,
  token: string,
  matches: EntityMatch[],
): Promise<number | null> {
  try {
    const { jevLinkGroups } = await import('../jev/jevEntityLinker');
    const links = await jevLinkGroups(
      companyId,
      [
        {
          token: `${label}: ${token}`,
          candidates: matches.slice(0, 5).map((m) => ({ id: m.id, name: m.name })),
        },
      ],
      'entity-service-fallback',
    );
    const link = links?.[0];
    if (!link || link.choice === '__none__') return null;
    const winner = matches.find((m) => m.id === link.choice);
    if (!winner) return null;
    return typeof link.confidence === 'number' ? link.confidence : null;
  } catch {
    return null;
  }
}

async function resolveOne(
  req: EntityRequest,
  companyId: string,
  opts?: { jevFallback?: boolean; rbacFilter?: boolean },
): Promise<ResolvedEntity> {
  const text = req.text?.trim() ?? '';
  if (!text) {
    return { request: req, status: 'missing', id: null, name: null, score: 0, candidates: [] };
  }
  const types = KIND_TO_TYPES[req.kind] ?? [];
  let matches: EntityMatch[] = [];
  try {
    // Engine pass (rbacFilter:false): every callable tool is RBAC-gated at
    // the executor, so filtering here would only break typo fixing (same
    // rationale as resolveEntitiesInText). The ai.resolve_entities TOOL
    // path passes rbacFilter:true — a mid-chain model call must not resolve
    // entity types the user cannot view.
    matches = await searchEntities(text, companyId, types, { rbacFilter: opts?.rbacFilter === true });
  } catch {
    matches = [];
  }
  if (matches.length === 0) {
    return { request: req, status: 'missing', id: null, name: null, score: 0, candidates: [] };
  }
  const best = matches[0];
  const rival = matches.find(
    (m) => m.id !== best.id && m.confidence >= best.confidence - AMBIGUITY_GAP,
  );

  if (best.confidence >= ENTITY_SAME_THRESHOLD && !rival) {
    return {
      request: req,
      status: 'same',
      id: best.id,
      name: best.name,
      score: best.confidence,
      candidates: toCandidates(matches),
    };
  }
  if (best.confidence < ENTITY_MISSING_THRESHOLD) {
    return {
      request: req,
      status: 'missing',
      id: null,
      name: null,
      score: best.confidence,
      candidates: toCandidates(matches),
    };
  }
  // Ambiguous band (0.55–0.85) or near-tie: single JEV fallback, then confirm.
  if (opts?.jevFallback !== false) {
    const conf = await jevFallbackConfidence(
      companyId,
      KIND_LABEL_AR[req.kind] ?? req.kind,
      text,
      matches,
    );
    if (typeof conf === 'number' && conf >= JEV_PROMOTE_CONFIDENCE && !rival) {
      return {
        request: req,
        status: 'same',
        id: best.id,
        name: best.name,
        score: best.confidence,
        candidates: toCandidates(matches),
      };
    }
  }
  return {
    request: req,
    status: 'confirm',
    id: null,
    name: null,
    score: best.confidence,
    candidates: toCandidates(matches),
  };
}

/**
 * Resolve a batch of entity requests with per-entity error isolation: one
 * failing type never rejects the whole batch (the old Promise.all fan-out
 * collapsed to [] on a single API failure).
 *
 * Bounded parallelism (3): requests are independent (different kinds, no
 * shared state), so the old sequential for-await paid 2-3× fetch latency
 * for a cash invoice for nothing. Order of the returned array still matches
 * the input order. JEV fallbacks inside resolveOne stay rare (ambiguous
 * band only) and also run within the bound.
 */
const RESOLVE_CONCURRENCY = 3;

export async function resolveEntities(
  requests: EntityRequest[],
  companyId: string,
  opts?: { jevFallback?: boolean; rbacFilter?: boolean },
): Promise<ResolvedEntity[]> {
  if (!companyId || requests.length === 0) return [];
  const out: ResolvedEntity[] = new Array(requests.length);
  const missingFor = (req: EntityRequest): ResolvedEntity => ({
    request: req,
    status: 'missing',
    id: null,
    name: null,
    score: 0,
    candidates: [],
  });
  for (let i = 0; i < requests.length; i += RESOLVE_CONCURRENCY) {
    const slice = requests
      .map((req, idx) => ({ req, idx }))
      .slice(i, i + RESOLVE_CONCURRENCY);
    const settled = await Promise.all(
      slice.map(async ({ req, idx }) => {
        try {
          return { idx, r: await resolveOne(req, companyId, opts) };
        } catch {
          return { idx, r: missingFor(req) };
        }
      }),
    );
    for (const { idx, r } of settled) out[idx] = r;
  }
  return out;
}

/**
 * Render the authoritative entity block injected into the LLM context.
 * Same shape as the JEV block so prompt rule 52 ("المعرفات نهائية وملزمة")
 * stays valid whichever path produced it.
 */
export function renderEntityBlock(resolved: ResolvedEntity[]): string | null {
  if (resolved.length === 0) return null;
  const lines: string[] = [];
  for (const r of resolved) {
    const label = KIND_LABEL_AR[r.request.kind] ?? r.request.kind;
    if (r.status === 'same' && r.id && r.name) {
      lines.push(`- **${label}**: "${r.name}" (id: ${r.id}) — ثقة ${(r.score * 100).toFixed(0)}%`);
    } else if (r.status === 'confirm' && r.candidates.length > 0) {
      lines.push(
        `- **${label} "${r.request.text}"**: مرشحون (تحقق بسؤال واحد فقط، ولا تنشئ كياناً جديداً قبل سؤال المستخدم): ${r.candidates.map((c) => `"${c.name}"`).join('، ')}`,
      );
    } else {
      lines.push(
        `- **${label} "${r.request.text}"**: غير موجود — أخبر المستخدم واسأله "أتريد إنشاءه؟"، ولا تكرر البحث.`,
      );
    }
  }
  return `⚡ **حلّ الكيانات تلقائياً:**\n${lines.join('\n')}\n\n_المعرفات ذات الثقة العالية نهائية وملزمة — ممنوع استدعاء أي أداة search.* لها. ابحث فقط عن كيانات غير مذكورة أعلاه._`;
}
