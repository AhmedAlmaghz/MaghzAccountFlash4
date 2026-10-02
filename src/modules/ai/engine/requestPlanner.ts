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
  | 'invoice.undirected'
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

const INTENT_WRITE_TOOL: Record<Exclude<PlannedIntent, 'generic' | 'invoice.undirected'>, string> = {
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
/** Question words — asking for information, not ordering an action. */
const QUESTION_RE = /؟|^(ما|ماذا|مادا|كم|هل|لماذا|ليش|وين|اين|أين|متى|متا|كيف|اعرض|اوضح|اشرح|هات|اذكر|عدد|بكم)/;
/** Creation/posting/payment verbs and nouns — the user orders an action. */
const ACTION_RE = /أنشئ|انشئ|إنشاء|انشاء|سجل|سجّل|تسجيل|ضيف|أضف|اضف|إضافة|اضافة|افتح|احذف|حذف|عدل|عدّل|تعديل|رحل|رحّل|ترحيل|ادفع|دفع|حوّل|تحويل|سدد|تسديد|اصرف|صرف|اقبض|قبض|استلم|استلام|ولّد|اطبع|صدّر|اقفل/;const MFG_RE = /أمر\s*تشغيل|امر\s*تشغيل|تصنيع|إنتاج|انتاج|شغل.*مصنع|bom/;
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
  // Party-type inference (live session 2026-10-02): a bare "فاتورة من X"
  // with no بيع/شراء keyword must still resolve — مورد/موردين means the
  // party is a supplier (purchase side), عميل/عملاء means customer side.
  // Arabic prepositions disambiguate the rest: "فاتورة من X" (goods FROM
  // a party) leans purchase, "فاتورة لـ/إلى X" leans sales.
  // سند without قبض/صرف stays generic (direction genuinely unknown).
  if (/فاتور|فواتير/.test(norm)) {
    if (/مورد|موردين|توريد/.test(norm)) return 'purchases.invoice';
    if (/عميل|عملاء|زبون|زبائن/.test(norm)) return 'sales.invoice';
    // Prepositions anywhere after the invoice word: "فاتورة نقدية من أبو
    // العز" (goods FROM a party) leans purchase, "فاتورة لغدرة" leans sales.
    if (/\sمن\s/.test(norm)) return 'purchases.invoice';
    // \w never matches Arabic letters — use \S for the word tail (فاتوره).
    if (/فاتور\S*\s+ل/.test(norm)) return 'sales.invoice';
    return 'invoice.undirected';
  }
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

/**
 * Remove date spans before number extraction. Live 2026-10-02: "بتاريخ
 * 2026-10-02" fed 2026/10/02 into the invoice lines as phantom quantities
 * and prices (and would corrupt voucher amounts the same way). Dates are
 * extracted separately by extractDate — they must not also be money.
 */
function stripDateSpans(text: string): string {
  const months =
    'يناير|فبراير|مارس|ابريل|أبريل|مايو|يونيو|يوليو|يوليه|اغسطس|أغسطس|سبتمبر|اكتوبر|أكتوبر|نوفمبر|ديسمبر|كانون|شباط|اذار|آذار|نيسان|ايار|أيار|حزيران|تموز|اب|آب|ايلول|أيلول|تشرين|محرم|صفر|ربيع|جمادى|رجب|شعبان|رمضان|شوال|ذو|الحجة';
  return toLatinDigits(text)
    .replace(/\b\d{4}-\d{1,2}-\d{1,2}\b/g, ' ')
    .replace(/\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/g, ' ')
    .replace(new RegExp(`\\d{1,2}\\s*(?:${months})\\s*\\d{3,4}?`, 'g'), ' ');
}

function extractDocumentNumbers(text: string): number[] {
  return extractNumbers(stripDateSpans(text));
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

/**
 * Numbers that are explicitly PRICES in prose ("بسعر 500") are not
 * quantities. Without this, "فاتورة بسعر 500" (no quantity said) planned a
 * bogus quantity=500 line; with it, the quantity is correctly missing and
 * asked once.
 */
function extractPriceAnchored(text: string): Set<number> {
  const out = new Set<number>();
  const latin = toLatinDigits(text);
  const re = /(?:سعر|بمبلغ|مبلغ|بمقدار|بقيمة|بسعر)\s*(\d+(?:\.\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(latin)) !== null) {
    const n = parseFlexibleNumber(m[1]);
    if (typeof n === 'number' && Number.isFinite(n)) out.add(n);
  }
  return out;
}

function needsFor(intent: PlannedIntent): EntityKind[] {
  switch (intent) {
    case 'sales.invoice':
      return ['customer', 'product'];
    case 'purchases.invoice':
      return ['supplier', 'product'];
    case 'invoice.undirected':
      // Party unknown pre-resolution: ask BOTH families from the same blob.
      // The block then shows which side exists and the model picks the
      // matching create tool (rule 55) — never "مبيعات أم مشتريات؟" when
      // one side hits.
      return ['supplier', 'customer', 'product'];
    case 'accounting.receipt':
      return ['customer'];
    case 'accounting.payment':
      return ['supplier'];
    case 'accounting.journal':
      return ['account'];
    case 'manufacturing.work_order':
      // Product + warehouse (output store) from the same blob — the model
      // needs both UUIDs before create_work_order/complete (live 2026-10-02:
      // empty warehouse searches looped because nothing pre-resolved them).
      return ['product', 'warehouse'];
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
  // Question gate: "ما رصيد العميل؟" / "بكم الكنافة؟" mention entities but
  // order nothing — planning a write (and injecting binding IDs) for a pure
  // question pushes the model toward unprompted creation. Terse verb-less
  // COMMANDS ("فاتورة نقدية من أبو العز") keep their intent; only an
  // explicit question form without any action verb falls back to generic.
  if (intent !== 'generic' && QUESTION_RE.test(norm) && !ACTION_RE.test(norm)) {
    return {
      intent: 'generic',
      writeTool: null,
      slots: { quantities: [], prices: [], lines: [] },
      entityRequests: [],
      missing: [],
      plan: 'generic',
    };
  }
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
  const isInvoiceLike =
    intent === 'sales.invoice' || intent === 'purchases.invoice' || intent === 'invoice.undirected';
  if (isInvoiceLike) {
    slots.paymentType = isCash ? 'cash' : 'credit';
    let nums = extractDocumentNumbers(text);
    // A lone price-anchored number ("بسعر 500", no quantity said) is a
    // KNOWN price with a MISSING quantity — not a quantity of 500.
    let knownPrice: number[] = [];
    if (nums.length === 1 && extractPriceAnchored(text).has(nums[0])) {
      knownPrice = nums;
      nums = [];
    }
    const paired = extractLinePairs(nums);
    slots.quantities = paired.quantities;
    slots.prices = [...paired.prices, ...knownPrice];
    slots.lines = paired.lines;
  }
  if (intent === 'manufacturing.work_order') {
    // Quantity matters; unit cost comes from the BOM (never asked here).
    const paired = extractLinePairs(extractDocumentNumbers(text));
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
  // NOTE (live 2026-10-02): a missing unit price is NOT a gap — the tools
  // require unitPrice but the model fills it from the catalog
  // (search.products costPrice/salePrice), which is data, not invention.
  // Asking the price for every "20 شوكلاتة" (no price said) would block the
  // dominant flow; explicit user prices ride in the hint below and win.
  const missing: MissingField[] = [];
  if (isInvoiceLike) {
    if (slots.quantities.length === 0) {
      missing.push({ field: 'quantity', questionAr: 'ما الكمية المطلوبة؟' });
    }
  }
  if (intent === 'manufacturing.work_order' && slots.quantities.length === 0) {
    missing.push({ field: 'quantity', questionAr: 'ما كمية الإنتاج المطلوبة؟' });
  }
  if (intent === 'accounting.receipt' || intent === 'accounting.payment') {
    const numbers = extractDocumentNumbers(text);
    if (numbers.length === 0) {
      missing.push({ field: 'amount', questionAr: 'ما مبلغ السند؟' });
    } else {
      slots.prices = numbers;
    }
  }

  return {
    intent,
    // Undirected invoices name no tool — the block decides (rule 55).
    writeTool: intent === 'invoice.undirected' ? null : INTENT_WRITE_TOOL[intent],
    slots,
    entityRequests,
    missing,
    plan: missing.length > 0 ? 'ask' : 'single-write',
  };
}

/**
 * Render the planner's extracted scalars as a hint block for the model.
 * The slots were previously computed and then DISCARDED — the model
 * re-parsed numbers from prose every turn and misread them (live
 * 2026-10-02: multi-line invoices built with wrong quantities/prices).
 * These are EXTRACTION hints, not execution orders: IDs still come from
 * the entity block, and priceless lines must be asked (rule 3).
 * Returns null when there is nothing worth showing.
 */
export function renderPlannedSlots(planned: PlannedRequest): string | null {
  if (planned.plan !== 'single-write') return null;
  const parts: string[] = [];
  if (planned.slots.lines.length > 0) {
    const bits = planned.slots.lines.map((l) =>
      l.unitPrice === undefined
        ? `${l.quantity} × (السعر من بطاقة الصنف عبر البحث)`
        : `${l.quantity} × بسعر ${l.unitPrice}`,
    );
    parts.push(`- **البنود المستخرجة**: ${bits.join('؛ ')}`);
  }
  if (planned.slots.date) parts.push(`- **التاريخ**: ${planned.slots.date}`);
  if (planned.slots.paymentType === 'cash') {
    parts.push('- **الدفع**: نقدي — مرّر paymentType=cash مع cashBoxId من الكتلة أعلاه، لا فاتورة آجلة (القاعدة 28)');
  }
  if (parts.length === 0) return null;
  return `📋 **معطيات مستخرجة من الطلب (استخدمها كما هي، لا تُعد حسابها):**\n${parts.join('\n')}`;
}
