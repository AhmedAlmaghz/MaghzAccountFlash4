/**
 * requestPlanner — deterministic per-request planning (Phase 2 of unification).
 *
 * Problem it fixes: the model was planner AND executor at once. It decided
 * whether to search, what to search, and when to write on every iteration,
 * so one vague turn fanned out into 3-6 search calls + failed writes +
 * retries until MAX_ITERATIONS died.
 *
 * What this planner does (pure, no IO):
 * - Detects ONE intent per user turn (sales/purchase invoice, receipt,
 *   payment, journal, or generic).
 * - Extracts scalar slots ONCE (quantities/prices/paymentType/date) via the
 *   same normalizers the executor uses — one truth, not one guess per tool.
 * - Emits entityRequests carrying the FULL user text per needed kind.
 *   Segmentation of Arabic names is deliberately NOT attempted here:
 *   token-aware fuzzy scoring picks the relevant entity per family from the
 *   blob (same principle as jevSearchAll). One request per kind = one lookup.
 * - Names the exact write tool for the intent so the router can narrow the
 *   advertised set instead of offering 48 scattered tools.
 *
 * Name disambiguation (same/confirm/missing) happens in entityService AFTER
 * the plan, from real DB scores — never from heuristics here.
 */
import { normalizeArabic } from '@/core/utils/normalizeArabic';
import { parseFlexibleNumber, toLatinDigits, normalizeDateArg } from './argNormalizers';
import type { EntityRequest, EntityKind } from './entityService';

export type PlannedIntent =
  | 'sales.invoice'
  | 'purchases.invoice'
  | 'accounting.receipt'
  | 'accounting.payment'
  | 'accounting.journal'
  | 'generic';

export interface MissingField {
  field: string;
  questionAr: string;
}

export interface PlannedRequest {
  intent: PlannedIntent;
  /** Exact write tool for this intent (null when generic/ask-only). */
  writeTool: string | null;
  /** Scalar slots extracted once (positional, whole-request). */
  slots: {
    quantities: number[];
    prices: number[];
    paymentType?: 'cash' | 'credit';
    date?: string;
  };
  /** One resolution request per needed entity kind (full-text each). */
  entityRequests: EntityRequest[];
  /** Plan-time gaps (resolution gaps are added by the caller afterwards). */
  missing: MissingField[];
  /** 'single-write' → proceed to entityService; 'ask' → one clarifying question; 'generic' → model-driven. */
  plan: 'single-write' | 'ask' | 'generic';
}

const INTENT_WRITE_TOOL: Record<Exclude<PlannedIntent, 'generic'>, string> = {
  'sales.invoice': 'sales.create_invoice',
  'purchases.invoice': 'purchases.create_invoice',
  'accounting.receipt': 'accounting.create_receipt_voucher',
  'accounting.payment': 'accounting.create_payment_voucher',
  'accounting.journal': 'accounting.create_journal_entry',
};

const CASH_RE = /نقد|كاش|فور|مدفوع|مقبوض|عاجل|حاضر/;
const SALES_RE = /فاتور\w*\s*(بيع|مبيع)|فواتير\s*بيع|بيع|مبيعات|عميل|عملاء/;
const PURCHASES_RE = /فاتور\w*\s*(شراء|مشتر)|فواتير\s*شراء|مشتريات|مورد|موردين|شراء/;
const RECEIPT_RE = /سند\s*قبض|سندقبض|قبض|تحصيل|استلام.*عميل/;
const PAYMENT_RE = /سند\s*صرف|سندصرف|صرف|سداد.*مورد|دفع.*مورد|مصروف/;
const JOURNAL_RE = /قيد|قيود|يومية|دفتر/;

function detectIntent(norm: string): PlannedIntent {
  // Receipt/payment first: they contain party words too ("سند قبض من عميل").
  if (RECEIPT_RE.test(norm)) return 'accounting.receipt';
  if (PAYMENT_RE.test(norm)) return 'accounting.payment';
  if (JOURNAL_RE.test(norm)) return 'accounting.journal';
  if (PURCHASES_RE.test(norm)) return 'purchases.invoice';
  if (SALES_RE.test(norm)) return 'sales.invoice';
  return 'generic';
}

function extractNumbers(text: string): number[] {
  const latin = toLatinDigits(text);
  const out: number[] = [];
  for (const m of latin.matchAll(/(\d+(?:\.\d+)?)/g)) {
    const n = parseFlexibleNumber(m[1]);
    if (typeof n === 'number' && Number.isFinite(n)) out.push(n);
  }
  return out;
}

function extractDate(text: string): string | undefined {
  // Explicit ISO first, then the flexible Arabic parser (12-8, 15 أغسطس…).
  const iso = toLatinDigits(text).match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) {
    const d = normalizeDateArg(`${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`);
    if (d) return d;
  }
  const dmy = toLatinDigits(text).match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (dmy) {
    const d = normalizeDateArg(`${dmy[1]}-${dmy[2]}${dmy[3] ? `-${dmy[3]}` : ''}`);
    if (d) return d;
  }
  const months =
    'يناير|فبراير|مارس|ابريل|أبريل|مايو|يونيو|يوليو|يوليه|اغسطس|أغسطس|سبتمبر|اكتوبر|أكتوبر|نوفمبر|ديسمبر|كانون|شباط|اذار|آذار|نيسان|ايار|أيار|حزيران|تموز|اب|آب|ايلول|أيلول|تشرين|محرم|صفر|ربيع|جمادى|رجب|شعبان|رمضان|شوال|ذو|الحجة';
  const m = text.match(new RegExp(`(\\d{1,2})\\s*(${months})\\s*(\\d{3,4})?`));
  if (m) {
    const d = normalizeDateArg(m[0]);
    if (d) return d;
  }
  return undefined;
}

/**
 * Split the number stream into quantities vs prices. Convention (documented
 * in the prompt example): "10 وحدات … بـ 500" — the FIRST number is the
 * quantity, the LAST is the unit price. Single number → quantity (price must
 * be asked, never invented per rule 3).
 */
function splitQtyPrice(numbers: number[]): { quantities: number[]; prices: number[] } {
  if (numbers.length === 0) return { quantities: [], prices: [] };
  if (numbers.length === 1) return { quantities: [numbers[0]], prices: [] };
  return { quantities: numbers.slice(0, -1), prices: [numbers[numbers.length - 1]] };
}

function needsFor(intent: PlannedIntent): EntityKind[] {
  switch (intent) {
    case 'sales.invoice':
      return ['customer', 'product'];
    case 'purchases.invoice':
      return ['supplier', 'product'];
    case 'accounting.receipt':
      return ['customer'];
    case 'accounting.payment':
      return ['supplier'];
    case 'accounting.journal':
      return ['account'];
    default:
      return [];
  }
}

export function planRequest(rawText: string): PlannedRequest {
  const text = rawText?.trim() ?? '';
  const norm = normalizeArabic(text);
  if (!norm) {
    return {
      intent: 'generic',
      writeTool: null,
      slots: { quantities: [], prices: [] },
      entityRequests: [],
      missing: [],
      plan: 'generic',
    };
  }
  const intent = detectIntent(norm);
  if (intent === 'generic') {
    return {
      intent,
      writeTool: null,
      slots: { quantities: [], prices: [] },
      entityRequests: [],
      missing: [],
      plan: 'generic',
    };
  }

  const isCash = CASH_RE.test(norm);
  const slots: PlannedRequest['slots'] = { quantities: [], prices: [] };
  if (intent === 'sales.invoice' || intent === 'purchases.invoice') {
    slots.paymentType = isCash ? 'cash' : 'credit';
    const { quantities, prices } = splitQtyPrice(extractNumbers(text));
    slots.quantities = quantities;
    slots.prices = prices;
  }
  const date = extractDate(text);
  if (date) slots.date = date;

  const kinds = needsFor(intent);
  // Cash invoices need the treasury too — same full-text blob, the box
  // family scores it independently (no name segmentation attempted).
  if ((intent === 'sales.invoice' || intent === 'purchases.invoice') && slots.paymentType === 'cash') {
    kinds.push('cash_box');
  }
  const entityRequests: EntityRequest[] = kinds.map((kind) => ({ text, kind }));

  // Plan-time gaps only (resolution gaps come from entityService scores).
  const missing: MissingField[] = [];
  if (intent === 'sales.invoice' || intent === 'purchases.invoice') {
    if (slots.quantities.length === 0) {
      missing.push({ field: 'quantity', questionAr: 'ما الكمية المطلوبة؟' });
    }
    if (slots.prices.length === 0) {
      missing.push({ field: 'unitPrice', questionAr: 'ما سعر الوحدة؟ (لا أفترض أسعاراً — أخبرني بالسعر)' });
    }
  }
  if (intent === 'accounting.receipt' || intent === 'accounting.payment') {
    const numbers = extractNumbers(text);
    if (numbers.length === 0) {
      missing.push({ field: 'amount', questionAr: 'ما مبلغ السند؟' });
    } else {
      slots.prices = numbers;
    }
  }

  return {
    intent,
    writeTool: INTENT_WRITE_TOOL[intent],
    slots,
    entityRequests,
    missing,
    plan: missing.length > 0 ? 'ask' : 'single-write',
  };
}
