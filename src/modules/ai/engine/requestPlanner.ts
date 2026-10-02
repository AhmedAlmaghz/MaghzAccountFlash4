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
 *   payment, journal, work order, lead, employee, product, or generic).
 * - Extracts scalar slots ONCE (line pairs quantity+price, paymentType, date)
 *   via the same normalizers the executor uses — one truth, not one guess
 *   per tool.
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
  | 'manufacturing.work_order'
  | 'crm.lead'
  | 'hr.employee'
  | 'inventory.product'
  | 'generic';

export interface MissingField {
  field: string;
  questionAr: string;
}

export interface PlannedLine {
  quantity: number;
  /** Absent when the user gave a quantity with no price — asked, never invented. */
  unitPrice?: number;
}

export interface PlannedRequest {
  intent: PlannedIntent;
  /** Exact write tool for this intent (null when generic/ask-only). */
  writeTool: string | null;
  /** Scalar slots extracted once (positional, whole-request). */
  slots: {
    quantities: number[];
    prices: number[];
    /** Paired lines for multi-item documents (C3) — preferred over the flat arrays. */
    lines: PlannedLine[];
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
  'manufacturing.work_order': 'manufacturing.create_work_order',
  'crm.lead': 'crm.create_lead',
  'hr.employee': 'hr.create_employee',
  'inventory.product': 'inventory.create_product',
};

const CASH_RE = /نقد|كاش|فور|مدفوع|مقبوض|عاجل|حاضر/;
const MFG_RE = /أمر\s*تشغيل|امر\s*تشغيل|تصنيع|إنتاج|انتاج|شغل.*مصنع|bom/;
const LEAD_RE = /عميل\s*محتمل|عملاء\s*محتملين|فرص|فرصة|تأهيل|متابعة\s*عميل/;
const NEW_EMPLOYEE_RE = /موظف\s*جديد|إضافة\s*موظف|اضافة\s*موظف|تعيين\s*موظف/;
const NEW_PRODUCT_RE = /منتج\s*جديد|صنف\s*جديد|إضافة\s*صنف|اضافة\s*صنف|إضافة\s*منتج|اضافة\s*منتج/;
const SALES_RE = /فاتور\w*\s*(بيع|مبيع)|فواتير\s*بيع|بيع|مبيعات|عميل|عملاء/;
const PURCHASES_RE = /فاتور\w*\s*(شراء|مشتر)|فواتير\s*شراء|مشتريات|مورد|موردين|شراء/;
const RECEIPT_RE = /سند\s*قبض|سندقبض|قبض|تحصيل|استلام.*عميل/;
const PAYMENT_RE = /سند\s*صرف|سندصرف|صرف|سداد.*مورد|دفع.*مورد|مصروف/;
const JOURNAL_RE = /قيد|قيود|يومية|دفتر/;

function detectIntent(norm: string): PlannedIntent {
  // Specific creation phrases first — they contain generic party words too
  // ("إضافة موظف" contains no invoice words, but "عميل محتمل" contains
  // "عميل" which SALES_RE would swallow).
  if (NEW_EMPLOYEE_RE.test(norm)) return 'hr.employee';
  if (NEW_PRODUCT_RE.test(norm)) return 'inventory.product';
  if (LEAD_RE.test(norm)) return 'crm.lead';
  if (MFG_RE.test(norm)) return 'manufacturing.work_order';
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
 * Pair the number stream into document lines (C3). Convention: quantities
 * and unit prices alternate in reading order — "10 كرتون بـ 500 و5 علب بـ
 * 200" → [(10,500),(5,200)]. A trailing lone number is a quantity whose
 * price must be ASKED (never invented per rule 3). This replaces the old
 * first-all-but-last-are-quantities split, which misread every multi-line
 * invoice ("10 X 500 و 5 Y 200" gave quantities [10,500,5] + price [200]).
 */
function extractLinePairs(numbers: number[]): {
  lines: PlannedLine[];
  quantities: number[];
  prices: number[];
} {
  const lines: PlannedLine[] = [];
  for (let i = 0; i < numbers.length; i += 2) {
    const quantity = numbers[i];
    const unitPrice = numbers[i + 1];
    lines.push(unitPrice === undefined ? { quantity } : { quantity, unitPrice });
  }
  return {
    lines,
    quantities: lines.map((l) => l.quantity),
    prices: lines.map((l) => l.unitPrice).filter((p): p is number => p !== undefined),
  };
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
    case 'manufacturing.work_order':
      return ['product'];
    case 'crm.lead':
      return ['lead'];
    case 'hr.employee':
      return ['employee'];
    case 'inventory.product':
      return ['product'];
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
      slots: { quantities: [], prices: [], lines: [] },
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
      slots: { quantities: [], prices: [], lines: [] },
      entityRequests: [],
      missing: [],
      plan: 'generic',
    };
  }

  const isCash = CASH_RE.test(norm);
  const slots: PlannedRequest['slots'] = { quantities: [], prices: [], lines: [] };
  if (intent === 'sales.invoice' || intent === 'purchases.invoice') {
    slots.paymentType = isCash ? 'cash' : 'credit';
    const paired = extractLinePairs(extractNumbers(text));
    slots.quantities = paired.quantities;
    slots.prices = paired.prices;
    slots.lines = paired.lines;
  }
  if (intent === 'manufacturing.work_order') {
    // Quantity matters; unit cost comes from the BOM (never asked here).
    const paired = extractLinePairs(extractNumbers(text));
    slots.quantities = paired.quantities;
    slots.prices = paired.prices;
    slots.lines = paired.lines;
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
    const priceless = slots.lines.filter((l) => l.unitPrice === undefined).length;
    if (priceless > 0) {
      missing.push({
        field: 'unitPrice',
        questionAr:
          priceless > 1
            ? `هناك ${priceless} بنود بلا سعر — ما أسعار الوحدات؟ (لا أفترض أسعاراً — أخبرني بها)`
            : 'ما سعر الوحدة؟ (لا أفترض أسعاراً — أخبرني بالسعر)',
      });
    }
  }
  if (intent === 'manufacturing.work_order' && slots.quantities.length === 0) {
    missing.push({ field: 'quantity', questionAr: 'ما كمية الإنتاج المطلوبة؟' });
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
