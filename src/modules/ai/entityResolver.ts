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
  | 'warehouse' | 'cashBox' | 'bank'
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

async function searchCustomers(query: string, companyId: string): Promise<EntityMatch[]> {
  const key = `customers:${companyId}`;
  let cached = cacheGet(key);
  if (!cached) {
    const res = await salesApi.getCustomersPaginated(companyId, 1, 8, { isActive: true });
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
    const res = await purchasesApi.getSuppliersPaginated(companyId, 1, 8, { isActive: true });
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
    const res = await hrApi.getEmployeesPaginated(companyId, 1, 8, { isActive: true });
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
    const res = await inventoryApi.getProductsPaginated(companyId, 1, 8, { isActive: true });
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

async function searchBanks(query: string, companyId: string): Promise<EntityMatch[]> {
  const key = `banks:${companyId}`;
  let cached = cacheGet(key);
  if (!cached) {
    const res = await coreApi.getBanks(companyId);
    if (!res.success || !res.data) return [];
    cached = res.data.map((b) => toMatch(b, 'bank', 'بنك', { accountNumber: 'accountNumber', balance: 'balance' }));
    cacheSet(key, cached);
  }
  return rankMatches(query, cached);
}

async function searchInvoices(query: string, companyId: string): Promise<EntityMatch[]> {
  const key = `invoices:${companyId}`;
  let cached = cacheGet(key);
  if (!cached) {
    const res = await salesApi.getInvoices(companyId);
    if (!res.success || !res.data) return [];
    cached = res.data.map((i) => {
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
    const res = await purchasesApi.getInvoices(companyId);
    if (!res.success || !res.data) return [];
    cached = res.data.map((i) => {
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
    const res = await salesApi.getQuotations(companyId);
    if (!res.success || !res.data) return [];
    cached = res.data.map((q) => {
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
    const res = await accountingApi.getReceiptVouchersPaginated(companyId, 1, 8);
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
    const res = await accountingApi.getPaymentVouchersPaginated(companyId, 1, 8);
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
    const res = await manufacturingApi.getWorkOrders(companyId);
    if (!res.success || !res.data) return [];
    cached = res.data.map((w) => {
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
    const res = await manufacturingApi.getBoms(companyId);
    if (!res.success || !res.data) return [];
    cached = res.data.map((b) =>
      toMatch(b, 'bom', 'شجرة منتج', { productName: 'productName', totalCost: 'totalCost' }));
    cacheSet(key, cached);
  }
  return rankMatches(query, cached);
}

async function searchLeads(query: string, companyId: string): Promise<EntityMatch[]> {
  const key = `leads:${companyId}`;
  let cached = cacheGet(key);
  if (!cached) {
    const res = await crmApi.getLeadsPaginated(companyId, 1, 8, { search: query });
    if (!res.success || !res.data) return [];
    cached = res.data.items.map((l) => toMatch(l, 'lead', 'عميل محتمل', { phone: 'phone', status: 'status' }));
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
  { type: 'bank', labelAr: 'بنك', searcher: searchBanks },
  { type: 'invoice', labelAr: 'فاتورة مبيعات', searcher: searchInvoices },
  { type: 'purchaseInvoice', labelAr: 'فاتورة مشتريات', searcher: searchPurchaseInvoices },
  { type: 'quotation', labelAr: 'عرض سعر', searcher: searchQuotations },
  { type: 'receiptVoucher', labelAr: 'سند قبض', searcher: searchReceiptVouchers },
  { type: 'paymentVoucher', labelAr: 'سند صرف', searcher: searchPaymentVouchers },
  { type: 'workOrder', labelAr: 'أمر تشغيل', searcher: searchWorkOrders },
  { type: 'bom', labelAr: 'شجرة منتج', searcher: searchBoms },
  { type: 'lead', labelAr: 'عميل محتمل', searcher: searchLeads },
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
 * Pre-process a user message before it reaches the LLM.
 *
 * Scans for Arabic entity-indicating patterns, fuzzy-matches each candidate
 * against the DB, and returns:
 *  - `all`: every potential match (any confidence)
 *  - `highConfidence`: matches suitable for auto-replacement
 *  - `corrections`: a list of original→corrected pairs for the user alert
 */
export async function resolveEntitiesInText(
  text: string,
  companyId: string,
): Promise<ResolvedEntitiesResult> {
  if (!text || !companyId) return { all: [], highConfidence: [], corrections: [] };

  // Extract distinct candidate words/phrases (≥2 chars after normalisation)
  const words = [...new Set(
    text.split(/[\s،,.\n]+/)
      .map((w) => w.trim())
      .filter((w) => norm(w).length >= 2),
  )];

  // Search all entities for each distinct word, in parallel
  const results: EntityMatch[] = [];
  const seen = new Set<string>();

  const batchSize = 5;
  for (let i = 0; i < words.length; i += batchSize) {
    const batch = words.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(async (word) => {
        const matches = await searchEntities(word, companyId);
        return matches;
      }),
    );
    for (const matches of batchResults) {
      for (const m of matches) {
        // Deduplicate by (type, id)
        const key = `${m.type}:${m.id}`;
        if (!seen.has(key)) {
          seen.add(key);
          results.push(m);
        }
      }
    }
  }

  // Build corrections: for any high-confidence match whose name differs from
  // the user's text (fuzzy match but not exact), record it as a correction.
  const corrections: EntityCorrection[] = [];
  const highConfidence = results.filter((m) => m.confidence >= 0.75);

  for (const match of highConfidence) {
    const nn = norm(match.name);
    // Find which word in the text triggered this match
    for (const word of words) {
      const nw = norm(word);
      if (nw && nn !== nw && score(word, match.name) >= 0.75 && score(word, match.name) < 1) {
        // Avoid duplicates
        if (!corrections.some((c) => c.original === word && c.type === match.type)) {
          corrections.push({
            type: match.type,
            original: word,
            corrected: match.name,
            matchedId: match.id,
            confidence: match.confidence,
          });
        }
      }
    }
  }

  return { all: results, highConfidence, corrections };
}
