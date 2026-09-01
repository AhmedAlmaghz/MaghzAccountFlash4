/**
 * Entity resolver — provides autocomplete suggestions and in-text entity
 * resolution for the AI chat.
 *
 * Two main entry points:
 *  - `searchEntities(query, companyId, types?)` → used by the autocomplete UI
 *  - `resolveEntitiesInText(text, companyId)` → pre-processes user messages
 *    before they reach the LLM; returns corrections + the modified text
 *
 * All search functions follow the same pattern as the AI search tools and
 * use the same module APIs.  Results are cached with a 30-second TTL for
 * fast autocomplete responses.
 */

import { normalizeArabic, fuzzyMatchScore } from '@/core/utils/normalizeArabic';
import { salesApi } from '@/modules/sales/api';
import { purchasesApi } from '@/modules/purchases/api';
import { inventoryApi } from '@/modules/inventory/api';
import { accountingApi } from '@/modules/accounting/api';
import { hrApi } from '@/modules/hr/api';
import { manufacturingApi } from '@/modules/manufacturing/api';
import { crmApi } from '@/modules/crm/api';
import * as coreApi from '@/core/api';

// ─── Types ───────────────────────────────────────────────────────────────────

export type EntityType =
  | 'account' | 'customer' | 'supplier' | 'employee' | 'product'
  | 'warehouse' | 'cashBox'
  | 'invoice' | 'purchaseInvoice' | 'quotation'
  | 'receiptVoucher' | 'paymentVoucher'
  | 'journalEntry' | 'workOrder' | 'bom'
  | 'lead' | 'opportunity' | 'task';

export interface EntityMatch {
  type: EntityType;
  id: string;
  name: string;
  code?: string;
  labelAr: string;
  confidence: number;
  data?: Record<string, unknown>;
}

export interface EntityCorrection {
  type: EntityType;
  original: string;
  corrected: string;
  matchedId: string;
  confidence: number;
}

export interface ResolvedEntitiesResult {
  /** All matches found (any confidence), sorted by confidence desc */
  all: EntityMatch[];
  /** High-confidence matches suitable for auto-replacement (confidence >= 0.75) */
  highConfidence: EntityMatch[];
  /** Corrections: original user text → corrected canonical name */
  corrections: EntityCorrection[];
  /** The message with guarded corrections applied (=== input when none) */
  text: string;
}

// ─── Cache ───────────────────────────────────────────────────────────────────

interface CacheEntry {
  data: EntityMatch[];
  ts: number;
}

const searchCache = new Map<string, CacheEntry>();
const CACHE_TTL = 30_000;

function cacheGet(key: string): EntityMatch[] | null {
  const e = searchCache.get(key);
  if (!e) return null;
  if (Date.now() - e.ts > CACHE_TTL) { searchCache.delete(key); return null; }
  return e.data;
}

function cacheSet(key: string, data: EntityMatch[]): void {
  searchCache.set(key, { data, ts: Date.now() });
  if (searchCache.size > 500) {
    // Evict oldest entries when cache grows too large
    const oldest = [...searchCache.entries()]
      .sort((a, b) => a[1].ts - b[1].ts)
      .slice(0, 100)
      .map(([k]) => k);
    for (const k of oldest) searchCache.delete(k);
  }
}

export function clearEntityCache(): void {
  searchCache.clear();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function norm(text: string): string {
  return normalizeArabic(text);
}

function score(query: string, target: string): number {
  return fuzzyMatchScore(query, target);
}

/** Escape a literal string for safe use inside a RegExp. */
function escapeForRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Internal record type for raw DB rows we map into EntityMatch. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbRow = Record<string, any>;

/** Safe string field accessor. */
function str(row: DbRow, ...keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return '';
}

/** Flatten hierarchical accounts tree into a flat list. */
function flattenAccounts(rows: DbRow[]): DbRow[] {
  const out: DbRow[] = [];
  const walk = (list: DbRow[]) => {
    for (const a of list) {
      out.push(a);
      if (Array.isArray(a.children) && a.children.length) walk(a.children);
    }
  };
  walk(rows);
  return out;
}

/** Spread a DbRow into an EntityMatch (with confidence=0; rankMatches recomputes it). */
function toMatch(row: DbRow, type: EntityType, labelAr: string, props: Record<string, string>): EntityMatch {
  const data: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(props)) {
    const v = row[field];
    if (v !== undefined && v !== null) data[key] = v;
  }
  return {
    type,
    id: String(row.id ?? ''),
    name: str(row, 'name_ar', 'name', 'fullName', 'full_name'),
    code: row.code ? String(row.code) : row.employeeNumber ? String(row.employeeNumber) : undefined,
    labelAr,
    confidence: 0,
    data,
  };
}

// ─── Entity Searchers ───────────────────────────────────────────────────────

async function searchAccounts(query: string, companyId: string): Promise<EntityMatch[]> {
  const key = `accounts:${companyId}`;
  let cached = cacheGet(key);
  if (!cached) {
    const res = await accountingApi.getAccounts(companyId);
    if (!res.success || !res.data) return [];
    cached = flattenAccounts(res.data).map((a) =>
      toMatch(a, 'account', 'حساب', { code: 'code', balance: 'balance', accountType: 'type' }));
    cacheSet(key, cached);
  }
  return rankMatches(query, cached);
}

// Window fetched per entity type and held in the 30s cache. Large enough for
// reliable fuzzy correction, small enough to stay a single fast query.
const ENTITY_FETCH_LIMIT = 50;

async function searchCustomers(query: string, companyId: string): Promise<EntityMatch[]> {
  const key = `customers:${companyId}`;
  let cached = cacheGet(key);
  if (!cached) {
    const res = await salesApi.getCustomersPaginated(companyId, 1, ENTITY_FETCH_LIMIT, { isActive: true });
    if (!res.success || !res.data) return [];
    cached = res.data.items.map((c) => toMatch(c, 'customer', 'عميل', { phone: 'phone', balance: 'balance' }));
    cacheSet(key, cached);
  }
  return rankMatches(query, cached);
}

async function searchSuppliers(query: string, companyId: string): Promise<EntityMatch[]> {
  const key = `suppliers:${companyId}`;
  let cached = cacheGet(key);
  if (!cached) {
    const res = await purchasesApi.getSuppliersPaginated(companyId, 1, ENTITY_FETCH_LIMIT, { isActive: true });
    if (!res.success || !res.data) return [];
    cached = res.data.items.map((s) => toMatch(s, 'supplier', 'مورد', { phone: 'phone', balance: 'balance' }));
    cacheSet(key, cached);
  }
  return rankMatches(query, cached);
}

async function searchEmployees(query: string, companyId: string): Promise<EntityMatch[]> {
  const key = `employees:${companyId}`;
  let cached = cacheGet(key);
  if (!cached) {
    const res = await hrApi.getEmployeesPaginated(companyId, 1, ENTITY_FETCH_LIMIT, { isActive: true });
    if (!res.success || !res.data) return [];
    cached = res.data.items.map((e) =>
      toMatch(e, 'employee', 'موظف', { department: 'department', phone: 'phone' }));
    cacheSet(key, cached);
  }
  return rankMatches(query, cached);
}

async function searchProducts(query: string, companyId: string): Promise<EntityMatch[]> {
  const key = `products:${companyId}`;
  let cached = cacheGet(key);
  if (!cached) {
    const res = await inventoryApi.getProductsPaginated(companyId, 1, ENTITY_FETCH_LIMIT, { isActive: true });
    if (!res.success || !res.data) return [];
    cached = res.data.items.map((p) =>
      toMatch(p, 'product', 'منتج', { salePrice: 'salePrice', costPrice: 'costPrice', unit: 'unit', barcode: 'barcode', sku: 'sku' }));
    cacheSet(key, cached);
  }
  return rankMatches(query, cached);
}

async function searchWarehouses(query: string, companyId: string): Promise<EntityMatch[]> {
  const key = `warehouses:${companyId}`;
  let cached = cacheGet(key);
  if (!cached) {
    const res = await inventoryApi.getWarehouses(companyId);
    if (!res.success || !res.data) return [];
    cached = res.data.map((w) => toMatch(w, 'warehouse', 'مستودع', {}));
    cacheSet(key, cached);
  }
  return rankMatches(query, cached);
}

async function searchCashBoxes(query: string, companyId: string): Promise<EntityMatch[]> {
  const key = `cashBoxes:${companyId}`;
  let cached = cacheGet(key);
  if (!cached) {
    const res = await coreApi.getCashBoxes(companyId);
    if (!res.success || !res.data) return [];
    cached = res.data.map((c) => toMatch(c, 'cashBox', 'خزنة', { balance: 'balance' }));
    cacheSet(key, cached);
  }
  return rankMatches(query, cached);
}

async function searchInvoices(query: string, companyId: string): Promise<EntityMatch[]> {
  const key = `invoices:${companyId}`;
  let cached = cacheGet(key);
  if (!cached) {
    // Capped recent window — the old full-table fetch loaded EVERY invoice
    // on the first message of every session (major cold-start latency).
    const res = await salesApi.getInvoicesPaginated(companyId, 1, ENTITY_FETCH_LIMIT);
    if (!res.success || !res.data) return [];
    cached = res.data.items.map((i) => {
      const inv = str(i, 'invoiceNumber');
      return {
        ...toMatch(i, 'invoice', 'فاتورة مبيعات', { customerName: 'customerName', total: 'totalAmount', date: 'date', status: 'status' }),
        name: inv ? `فاتورة ${inv}` : String(i.id ?? '').slice(0, 8),
        code: inv || undefined,
      };
    });
    cacheSet(key, cached);
  }
  return rankMatches(query, cached, ['invoiceNumber', 'customerName']);
}

async function searchPurchaseInvoices(query: string, companyId: string): Promise<EntityMatch[]> {
  const key = `purchaseInvoices:${companyId}`;
  let cached = cacheGet(key);
  if (!cached) {
    const res = await purchasesApi.getInvoicesPaginated(companyId, 1, ENTITY_FETCH_LIMIT);
    if (!res.success || !res.data) return [];
    cached = res.data.items.map((i) => {
      const inv = str(i, 'invoiceNumber');
      return {
        ...toMatch(i, 'purchaseInvoice', 'فاتورة مشتريات', { supplierName: 'supplierName', total: 'totalAmount', date: 'date', status: 'status' }),
        name: inv ? `فاتورة مشتريات ${inv}` : String(i.id ?? '').slice(0, 8),
        code: inv || undefined,
      };
    });
    cacheSet(key, cached);
  }
  return rankMatches(query, cached, ['invoiceNumber', 'supplierName']);
}

async function searchQuotations(query: string, companyId: string): Promise<EntityMatch[]> {
  const key = `quotations:${companyId}`;
  let cached = cacheGet(key);
  if (!cached) {
    const res = await salesApi.getQuotationsPaginated(companyId, 1, ENTITY_FETCH_LIMIT);
    if (!res.success || !res.data) return [];
    cached = res.data.items.map((q) => {
      const qn = str(q, 'quotationNumber');
      return {
        ...toMatch(q, 'quotation', 'عرض سعر', { customerName: 'customerName', total: 'totalAmount', date: 'date', status: 'status' }),
        name: qn ? `عرض سعر ${qn}` : String(q.id ?? '').slice(0, 8),
        code: qn || undefined,
      };
    });
    cacheSet(key, cached);
  }
  return rankMatches(query, cached, ['quotationNumber', 'customerName']);
}

async function searchReceiptVouchers(query: string, companyId: string): Promise<EntityMatch[]> {
  const key = `receiptVouchers:${companyId}`;
  let cached = cacheGet(key);
  if (!cached) {
    const res = await accountingApi.getReceiptVouchersPaginated(companyId, 1, ENTITY_FETCH_LIMIT);
    if (!res.success || !res.data) return [];
    cached = res.data.items.map((v) => {
      const vn = str(v, 'voucherNumber');
      return {
        ...toMatch(v, 'receiptVoucher', 'سند قبض', { customerName: 'customerName', amount: 'amount', date: 'date', status: 'status' }),
        name: vn ? `سند قبض ${vn}` : String(v.id ?? '').slice(0, 8),
        code: vn || undefined,
      };
    });
    cacheSet(key, cached);
  }
  return rankMatches(query, cached, ['voucherNumber', 'customerName']);
}

async function searchPaymentVouchers(query: string, companyId: string): Promise<EntityMatch[]> {
  const key = `paymentVouchers:${companyId}`;
  let cached = cacheGet(key);
  if (!cached) {
    const res = await accountingApi.getPaymentVouchersPaginated(companyId, 1, ENTITY_FETCH_LIMIT);
    if (!res.success || !res.data) return [];
    cached = res.data.items.map((v) => {
      const vn = str(v, 'voucherNumber');
      return {
        ...toMatch(v, 'paymentVoucher', 'سند صرف', { supplierName: 'supplierName', amount: 'amount', date: 'date', status: 'status' }),
        name: vn ? `سند صرف ${vn}` : String(v.id ?? '').slice(0, 8),
        code: vn || undefined,
      };
    });
    cacheSet(key, cached);
  }
  return rankMatches(query, cached, ['voucherNumber', 'supplierName']);
}

async function searchWorkOrders(query: string, companyId: string): Promise<EntityMatch[]> {
  const key = `workOrders:${companyId}`;
  let cached = cacheGet(key);
  if (!cached) {
    const res = await manufacturingApi.getWorkOrdersPaginated(companyId, 1, ENTITY_FETCH_LIMIT);
    if (!res.success || !res.data) return [];
    cached = res.data.items.map((w) => {
      const on = str(w, 'orderNumber');
      return {
        ...toMatch(w, 'workOrder', 'أمر تشغيل', { productName: 'productName', quantity: 'quantity', status: 'status' }),
        name: on ? `أمر تشغيل ${on}` : String(w.id ?? '').slice(0, 8),
        code: on || undefined,
      };
    });
    cacheSet(key, cached);
  }
  return rankMatches(query, cached, ['orderNumber', 'productName']);
}

async function searchBoms(query: string, companyId: string): Promise<EntityMatch[]> {
  const key = `boms:${companyId}`;
  let cached = cacheGet(key);
  if (!cached) {
    const res = await manufacturingApi.getBomsPaginated(companyId, 1, ENTITY_FETCH_LIMIT);
    if (!res.success || !res.data) return [];
    cached = res.data.items.map((b) =>
      toMatch(b, 'bom', 'شجرة منتج', { productName: 'productName', totalCost: 'totalCost' }));
    cacheSet(key, cached);
  }
  return rankMatches(query, cached);
}

async function searchLeads(query: string, companyId: string): Promise<EntityMatch[]> {
  const key = `leads:${companyId}`;
  let cached = cacheGet(key);
  if (!cached) {
    // Query-independent fetch: the cache key is per-company, so the payload
    // must be too (a query-filtered fetch would poison the cache for other
    // queries). Ranking happens locally below.
    const res = await crmApi.getLeadsPaginated(companyId, 1, ENTITY_FETCH_LIMIT);
    if (!res.success || !res.data) return [];
    cached = res.data.items.map((l) => toMatch(l, 'lead', 'عميل محتمل', { phone: 'phone', status: 'status' }));
    cacheSet(key, cached);
  }
  return rankMatches(query, cached);
}

async function searchOpportunities(query: string, companyId: string): Promise<EntityMatch[]> {
  const key = `opportunities:${companyId}`;
  let cached = cacheGet(key);
  if (!cached) {
    const res = await crmApi.getOpportunitiesPaginated(companyId, 1, ENTITY_FETCH_LIMIT);
    if (!res.success || !res.data) return [];
    cached = res.data.items.map((o) => toMatch(o, 'opportunity', 'فرصة بيعية', { stage: 'stage' }));
    cacheSet(key, cached);
  }
  return rankMatches(query, cached);
}

async function searchTasks(query: string, companyId: string): Promise<EntityMatch[]> {
  const key = `tasks:${companyId}`;
  let cached = cacheGet(key);
  if (!cached) {
    const res = await crmApi.getTasksPaginated(companyId, 1, ENTITY_FETCH_LIMIT);
    if (!res.success || !res.data) return [];
    cached = res.data.items.map((t) => toMatch(t, 'task', 'مهمة', { priority: 'priority', status: 'status' }));
    cacheSet(key, cached);
  }
  return rankMatches(query, cached);
}

// ─── Registry ────────────────────────────────────────────────────────────────

interface EntitySearcherDef {
  type: EntityType;
  labelAr: string;
  searcher: (query: string, companyId: string) => Promise<EntityMatch[]>;
}

const ENTITY_SEARCHERS: EntitySearcherDef[] = [
  { type: 'customer', labelAr: 'عميل', searcher: searchCustomers },
  { type: 'supplier', labelAr: 'مورد', searcher: searchSuppliers },
  { type: 'employee', labelAr: 'موظف', searcher: searchEmployees },
  { type: 'account', labelAr: 'حساب', searcher: searchAccounts },
  { type: 'product', labelAr: 'منتج', searcher: searchProducts },
  { type: 'warehouse', labelAr: 'مستودع', searcher: searchWarehouses },
  { type: 'cashBox', labelAr: 'خزنة', searcher: searchCashBoxes },
  { type: 'invoice', labelAr: 'فاتورة مبيعات', searcher: searchInvoices },
  { type: 'purchaseInvoice', labelAr: 'فاتورة مشتريات', searcher: searchPurchaseInvoices },
  { type: 'quotation', labelAr: 'عرض سعر', searcher: searchQuotations },
  { type: 'receiptVoucher', labelAr: 'سند قبض', searcher: searchReceiptVouchers },
  { type: 'paymentVoucher', labelAr: 'سند صرف', searcher: searchPaymentVouchers },
  { type: 'workOrder', labelAr: 'أمر تشغيل', searcher: searchWorkOrders },
  { type: 'bom', labelAr: 'شجرة منتج', searcher: searchBoms },
  { type: 'lead', labelAr: 'عميل محتمل', searcher: searchLeads },
  { type: 'opportunity', labelAr: 'فرصة بيعية', searcher: searchOpportunities },
  { type: 'task', labelAr: 'مهمة', searcher: searchTasks },
];

// ─── Ranking ─────────────────────────────────────────────────────────────────

/**
 * Given a query and a list of entities (with confidence=0), compute fuzzy match
 * scores against the entity name and (optionally) alternate match fields.
 * Returns filtered + sorted results (best first).
 */
function rankMatches(
  query: string,
  entities: EntityMatch[],
  altFields: string[] = [],
): EntityMatch[] {
  const nq = norm(query);
  if (!nq) return [];

  const results: EntityMatch[] = [];

  for (const e of entities) {
    const nn = norm(e.name);
    const nc = e.code ? norm(e.code) : '';
    const alts = altFields.map((f) => norm(String(e.data?.[f] ?? ''))).filter(Boolean);

    // Best score among all candidate fields
    let bestScore = 0;

    if (nn) bestScore = Math.max(bestScore, score(query, e.name));

    // Code exact match → high confidence
    if (nc && (nc.includes(nq) || nq.includes(nc))) {
      bestScore = Math.max(bestScore, 0.9);
    }

    // Alternate fields
    for (const alt of alts) {
      if (alt) bestScore = Math.max(bestScore, score(query, alt));
    }

    if (bestScore >= 0.3) {
      results.push({ ...e, confidence: bestScore });
    }
  }

  results.sort((a, b) => b.confidence - a.confidence);
  return results.slice(0, 10);
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Search for entities matching a query string.
 * Used by the autocomplete UI (debounced, cached).
 */
export async function searchEntities(
  query: string,
  companyId: string,
  types?: EntityType[],
): Promise<EntityMatch[]> {
  const trimmed = query.trim();
  if (!trimmed || !companyId) return [];

  const searchers = types
    ? ENTITY_SEARCHERS.filter((s) => types.includes(s.type))
    : ENTITY_SEARCHERS;

  const results = await Promise.all(
    searchers.map(async (s) => {
      // For lean queries (1-2 chars), only search the most common types
      if (trimmed.length <= 2 && !['customer', 'supplier', 'employee', 'product', 'account', 'cashBox'].includes(s.type)) {
        return [];
      }
      try {
        return await s.searcher(trimmed, companyId);
      } catch {
        return [];
      }
    }),
  );

  const flattened = results.flat();
  flattened.sort((a, b) => b.confidence - a.confidence);
  return flattened.slice(0, 15);
}

/**
 * Warm the entity cache in the background (fire-and-forget). Called when the
 * chat panel mounts so the FIRST user message doesn't pay the cold-fetch cost
 * of every entity type — by the time the user finishes typing, all lists are
 * already in memory.
 */
export function prefetchEntityCache(companyId: string): void {
  if (!companyId) return;
  // Each searcher checks its own cache first — safe to call unconditionally.
  void Promise.allSettled(ENTITY_SEARCHERS.map((s) => s.searcher('ا', companyId)));
}

/**
 * Pre-process a user message before it reaches the LLM.
 *
 * Scans for Arabic entity-indicating patterns, fuzzy-matches each candidate
 * against the DB, and returns:
 *  - `all`: every potential match (any confidence)
 *  - `highConfidence`: matches suitable for auto-replacement
 *  - `corrections`: a list of original→corrected pairs for the user alert
 */
/**
 * Pre-process a user message before it reaches the LLM.
 *
 * Scans for Arabic entity-indicating patterns, fuzzy-matches each candidate
 * against the DB, and returns:
 *  - `all`: every potential match (any confidence)
 *  - `highConfidence`: matches suitable for auto-replacement
 *  - `corrections`: original→corrected pairs for the user alert
 *  - `text`: the message with safe corrections applied (when any)
 *
 * Safety guards (a wrong auto-correction corrupts real business data —
 * e.g. renaming a brand-new supplier while creating it):
 *   1. Definition zones — words after "اسمه / باسم / المسمى …" introduce a
 *      NEW entity name and are never corrected.
 *   2. Generic commercial suffixes ("للتجارة", "المحدودة", …) are never
 *      treated as unambiguous references on their own.
 *   3. If the canonical name is already fully present in the text, nothing
 *      needs correcting (prevents "الشجاع للتجارة" → "الشجاع الشجاع للتجارة"
 *      duplication when only its suffix was scanned).
 *   4. Ambiguous matches (two entities of the same type within 0.05 score)
 *      are never auto-replaced.
 */
const DEFINITION_MARKER_RE =
  /(?:[اأإ]سم(?:ه|ها|هم|هما|كم)?|ب[اأإ]سم|ب[اأإ]لاسم|المسم[ىي]|المسما[ةه]|تحت\s+[اأإ]سم)\s*/g;

/** Normalised generic name fragments — never valid entity references alone. */
const GENERIC_TOKENS = new Set([
  'للتجاره', 'التجاره', 'تجاره', 'التجاريه', 'للتجارهوالاستيراد',
  'للاستيراد', 'الاستيراد', 'للتصدير', 'التصدير',
  'المحدوده', 'محدوده', 'وشركاه', 'ذمم', 'للمقاولات', 'التجاريين',
]);

/** Max characters of a defined name zone to protect after a marker. */
const DEFINITION_ZONE_MAX = 48;

export async function resolveEntitiesInText(
  text: string,
  companyId: string,
): Promise<ResolvedEntitiesResult> {
  const empty: ResolvedEntitiesResult = { all: [], highConfidence: [], corrections: [], text };
  if (!text || !companyId) return empty;

  // ── 1. Protected zones: names being DEFINED ("اسمه X …") ──────────────
  const protectedSpans: Array<[number, number]> = [];
  DEFINITION_MARKER_RE.lastIndex = 0;
  let dm: RegExpExecArray | null;
  while ((dm = DEFINITION_MARKER_RE.exec(text)) !== null) {
    const start = dm.index + dm[0].length;
    const clauseEnd = text.slice(start).search(/[،,.؟\n]/);
    const end = start + Math.min(clauseEnd === -1 ? DEFINITION_ZONE_MAX : clauseEnd, DEFINITION_ZONE_MAX);
    protectedSpans.push([start, Math.max(start, end)]);
  }
  const isProtected = (idx: number) => protectedSpans.some(([s, e]) => idx >= s && idx < e);

  // ── 2. Candidate tokens (with position, deduped by normalised form) ───
  // Resolution runs BEFORE the LLM call, so it is strictly budgeted: only
  // letter-bearing tokens are candidates (pure numbers never typo-match a
  // name) and only the first MAX_RESOLVE_TOKENS of them are searched.
  const MAX_RESOLVE_TOKENS = 16;
  interface Token { raw: string; norm: string; index: number }
  const tokens: Token[] = [];
  const seenTokens = new Set<string>();
  for (const m of text.matchAll(/[^\s،,.\n]+/g)) {
    const nw = norm(m[0]);
    if (nw.length < 2 || seenTokens.has(nw)) continue;
    if (!/[\u0600-\u06FFa-zA-Z]/.test(nw)) continue;
    seenTokens.add(nw);
    tokens.push({ raw: m[0], norm: nw, index: m.index ?? 0 });
    if (tokens.length >= MAX_RESOLVE_TOKENS) break;
  }

  // ── 3. Fuzzy-search each candidate against the DB (batched) ───────────
  // Hard wall-clock budget: entity correction is best-effort and must never
  // be the reason a message feels slow to send.
  const RESOLVE_DEADLINE_MS = 2500;
  const startedAt = Date.now();
  const results: EntityMatch[] = [];
  const seen = new Set<string>();
  const batchSize = 5;
  for (let i = 0; i < tokens.length; i += batchSize) {
    if (Date.now() - startedAt > RESOLVE_DEADLINE_MS) break;
    const batch = tokens.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(async (token) => {
        try {
          return await searchEntities(token.raw, companyId);
        } catch {
          return [];
        }
      }),
    );
    for (const matches of batchResults) {
      for (const m of matches) {
        const key = `${m.type}:${m.id}`;
        if (!seen.has(key)) {
          seen.add(key);
          results.push(m);
        }
      }
    }
  }

  const nText = norm(text);
  const highConfidence = results.filter((m) => m.confidence >= 0.75);

  // ── 4. Build guarded corrections ──────────────────────────────────────
  const corrections: EntityCorrection[] = [];
  for (const match of highConfidence) {
    // Guard 4 — ambiguity: another entity of the same type scores nearly as
    // well → replacing blindly risks pointing at the wrong record.
    const rival = results.some(
      (r) => r.type === match.type && r.id !== match.id && r.confidence >= match.confidence - 0.05,
    );
    if (rival) continue;

    const nName = norm(match.name);
    for (const token of tokens) {
      if (nName === token.norm) continue;
      const s = score(token.raw, match.name);
      if (s < 0.75 || s >= 1) continue;

      // Guard 2 — generic suffix tokens are not references.
      if (GENERIC_TOKENS.has(token.norm)) continue;
      // Guard 1 — token sits inside a "name definition" zone.
      if (isProtected(token.index)) continue;
      // Guard 3 — the canonical name is already referenced verbatim as a
      // standalone phrase elsewhere in the text → nothing to fix (replacing
      // its fragment would duplicate part of the name, e.g.
      // "الشجاع للتجارة" → "الشجاع الشجاع للتجارة").
      const namePresentRe = new RegExp(
        `(?<![\\u0600-\\u06FF])${escapeForRegExp(nName)}(?![\\u0600-\\u06FF])`,
      );
      if (namePresentRe.test(nText)) continue;

      if (!corrections.some((c) => c.original === token.raw && c.type === match.type)) {
        corrections.push({
          type: match.type,
          original: token.raw,
          corrected: match.name,
          matchedId: match.id,
          confidence: match.confidence,
        });
      }
    }
  }

  // ── 5. Apply corrections with standalone-token boundaries ─────────────
  let correctedText = text;
  if (corrections.length > 0) {
    correctedText = text;
    for (const c of corrections) {
      const escaped = c.original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // (?<!Arabic-letter) / (?![Arabic-letter]) → never replace mid-word.
      correctedText = correctedText.replace(
        new RegExp(`(?<![\\u0600-\\u06FF])${escaped}(?![\\u0600-\\u06FF])`, 'g'),
        c.corrected,
      );
    }
  }

  return { all: results, highConfidence, corrections, text: correctedText };
}
