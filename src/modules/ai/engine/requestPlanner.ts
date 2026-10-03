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
  | 'manufacturing.work_order_status'
  | 'pos.sale'
  | 'accounting.asset'
  | 'tax.period'
  | 'settings.manage'
  | 'accounting.asset'
  | 'tax.period'
  | 'settings.manage'
  | 'hr.operations'
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

/** One journal leg with a cleaned account text for resolution. */
export interface PlannedJournalLeg {
  /** Account name as said (amounts/markers stripped) — resolved per-leg. */
  accountText: string;
  debit?: number;
  credit?: number;
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
    /** Deterministic journal legs (accounting.journal only). */
    journalLegs: PlannedJournalLeg[];
    /** Target work-order state (manufacturing.work_order_status only). */
    workOrderStatus?: 'in_progress' | 'completed';
    /** Fiscal year for period/close flows (tax.period only). */
    fiscalYear?: number;
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

const INTENT_WRITE_TOOL: Record<
  Exclude<PlannedIntent, 'generic' | 'invoice.undirected' | 'hr.operations' | 'accounting.asset' | 'tax.period' | 'settings.manage'>,
  string
> = {
  'sales.invoice': 'sales.create_invoice',
  'purchases.invoice': 'purchases.create_invoice',
  'accounting.receipt': 'accounting.create_receipt_voucher',
  'accounting.payment': 'accounting.create_payment_voucher',
  'accounting.journal': 'accounting.create_journal_entry',
  'manufacturing.work_order': 'manufacturing.create_work_order',
  'manufacturing.work_order_status': 'manufacturing.update_work_order_status',
  'pos.sale': 'pos.checkout_sale',
  'crm.lead': 'crm.create_lead',
  'hr.employee': 'hr.create_employee',
  'inventory.product': 'inventory.create_product',
};

const CASH_RE = /نقد|كاش|فور|مدفوع|مقبوض|عاجل|حاضر/;
/** Question words — asking for information, not ordering an action. */
const QUESTION_RE = /؟|^(ما|ماذا|مادا|كم|هل|لماذا|ليش|وين|اين|متى|متا|كيف|اعرض|اوضح|اشرح|هات|اذكر|عدد|بكم)/;
/** Creation/posting/payment verbs and nouns — the user orders an action. */
const ACTION_RE = /انشئ|انشاء|سجل|تسجيل|ضيف|اضف|اضافه|افتح|احذف|حذف|عدل|تعديل|رحل|ترحيل|ادفع|دفع|حول|تحويل|سدد|تسديد|اصرف|صرف|اقبض|قبض|استلم|استلام|ولد|اطبع|صدر|اقفل/;
const MFG_RE = /امر\s*تشغيل|تصنيع|انتاج|شغل.*مصنع|bom/;
/** POS terminal sale — needs cashier/shift/terminal context, never a bare بيع. */
const POS_RE = /كاشير|ورديه|شيفت|نقطه بيع|تقرير\s*z|ايصال/;
/** Fixed assets: register/depreciate/dispose — never an invoice. */
const ASSET_RE = /اصول|اصل ثابت|اهلاك|استبعاد/;
/** Tax periods & year-end close (patterns in normalizeArabic() output form). */
const PERIOD_RE = /فتره|فترات|اقرار|اقفال|سنه\s+(ال)?ماليه|اعاده تقييم/;
/** Settings management (entities resolved via search tools, not the block). */
const SETTINGS_RE = /اعدادات|إعدادات|فرع|فروع|صندوق|صناديق|مركز تكلفه|مركز التكلفة|تسلسل|ترقيم|قوالب|قالب|ثيم|وحده|وحدات/;
/** HR batch operations: payroll/attendance/leaves/components/departments. */
const HR_OPS_RE = /راتب|رواتب|مسير|حضور|غياب|انصراف|اجازه|اجازات|مكونات|بنود.*راتب|كشف.*راتب|موظف|موظفين|قسم|اقسام/;
/** Execution-state change of an EXISTING work order — must beat JOURNAL_RE's bare قيد. */
const WO_STATUS_RE =
  /قيد\s*التنفيذ|قيد\s*التشغيل|مكتمل|اكتمل|انهاء|اغلاق|ابدا\s*التنفيذ/;
const LEAD_RE = /عميل\s*محتمل|عملاء\s*محتملين|فرص|فرصه|تاهيل|متابعه\s*عميل/;
const NEW_EMPLOYEE_RE = /موظف\s*جديد|اضافه\s*موظف|تعيين\s*موظف/;
const NEW_PRODUCT_RE = /منتج\s*جديد|صنف\s*جديد|اضافه\s*صنف|اضافه\s*منتج/;
const SALES_RE = /فاتور\w*\s*(بيع|مبيع)|فواتير\s*بيع|بيع|مبيعات|عميل|عملاء/;
const PURCHASES_RE = /فاتور\w*\s*(شراء|مشتر)|فواتير\s*شراء|مشتريات|مورد|موردين|شراء/;
const RECEIPT_RE = /سند\s*قبض|سندقبض|قبض|تحصيل|استلام.*عميل/;
const PAYMENT_RE = /سند\s*صرف|سندصرف|صرف|سداد.*مورد|دفع.*مورد|مصروف/;
const JOURNAL_RE = /قيد|قيود|يوميه|دفتر/;

function detectIntent(norm: string): PlannedIntent {
  // Specific creation phrases first — they contain generic party words too
  // ("إضافة موظف" contains no invoice words, but "عميل محتمل" contains
  // "عميل" which SALES_RE would swallow).
  if (NEW_EMPLOYEE_RE.test(norm)) return 'hr.employee';
  if (NEW_PRODUCT_RE.test(norm)) return 'inventory.product';
  if (LEAD_RE.test(norm)) return 'crm.lead';
  // Work-order STATUS change ("حول أمر التشغيل إلى قيد التنفيذ") before
  // everything containing قيد — otherwise JOURNAL_RE's bare قيد hijacks it
  // and the engine hunts a chart account named "التنفيذ" (live 2026-10-02).
  if (WO_STATUS_RE.test(norm) && /أمر|امر|تشغيل|طلب|حول|انقل|بدء|ابدا/.test(norm)) {
    return 'manufacturing.work_order_status';
  }
  // HR operational batch (live 2026-10-02 session 3): payroll runs,
  // attendance, leaves and components in one message. No single write tool
  // covers it — the model drives wizards (preview→generate→post) with the
  // pre-resolved employees. Matching it here STOPS the invoice fallback
  // from rendering garbage "extracted lines" (250000 × بسعر 6…) on HR text.
  if (HR_OPS_RE.test(norm)) return 'hr.operations';
  // POS before sales: "بيع في الكاشير" is a terminal sale, not an invoice.
  // POS_RE requires terminal context (bare بيع/نقدي stays sales.invoice).
  if (POS_RE.test(norm)) return 'pos.sale';
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
    // \w never matches Arabic letters — use \S for the word tail (فاتوره).
    if (/\sمن\s/.test(norm)) return 'purchases.invoice';
    if (/فاتور\S*\s+ل/.test(norm)) return 'sales.invoice';
    return 'invoice.undirected';
  }
  // Asset/period/settings AFTER document intents: "الصندوق" inside an
  // invoice/voucher/journal must not reroute to settings.
  if (ASSET_RE.test(norm)) return 'accounting.asset';
  if (PERIOD_RE.test(norm)) return 'tax.period';
  if (SETTINGS_RE.test(norm)) return 'settings.manage';
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
 * Short entity query extractor (live 2026-10-02 follow-up).
 *
 * entityRequests used to carry the FULL user blob ("فاتورة ابو العز هي
 * فاتورة مشتريات"), diluting fuzzy scores with command/doc words until a
 * present entity scored "missing". Stripping the command vocabulary leaves
 * the name ("ابو العز") — dramatically higher scores from the first lookup.
 * Falls back to the full blob when nothing remains (never empty).
 */
const QUERY_STRIP = new Set([
  'سجل', 'انشي', 'انشئ', 'انشاء', 'ضيف', 'اضف', 'اضافه', 'افتح', 'احذف',
  'حذف', 'عدل', 'تعديل', 'رحل', 'ترحيل', 'ادفع', 'دفع', 'حول', 'تحويل',
  'سدد', 'سداد', 'اصرف', 'صرف', 'اقبض', 'قبض', 'استلم', 'استلام',
  'فاتوره', 'فواتير', 'سند', 'سندات', 'قيد', 'قيود', 'مبيعات', 'مشتريات',
  'بيع', 'شراء', 'نقدي', 'نقديه', 'اجل', 'اجله', 'كاش', 'امر', 'تشغيل',
  'هي', 'هو', 'من', 'في', 'علي', 'علي', 'الي', 'الي', 'ب', 'ل', 'الجديد',
  'الجديده', 'جديد', 'جديده',
  // Price words + bare numbers are slots, not names ("بسعر 300" must not
  // dilute "ابو العز"; codes like WH-001 survive — they are not pure digits).
  'سعر', 'بسعر', 'مبلغ', 'بمبلغ', 'مقدار', 'بمقدار', 'قيمه', 'بقيمه',
]);

/** Pure-number tokens carry no name signal (amounts, years, counts). */
function isBareNumber(t: string): boolean {
  return /^\d+(?:\.\d+)?$/.test(t);
}

export function extractEntityQuery(rawText: string): string {
  const norm = normalizeArabic(rawText ?? '');
  const kept = norm
    .split(/\s+/)
    .filter((t) => t.length > 0 && !QUERY_STRIP.has(t) && !isBareNumber(t));
  const short = kept.join(' ').trim();
  // "اسمه X" definition zones: the name follows the marker — prefer it.
  const defZone = norm.match(/(?:اسمه|باسم|المسمي|تحت اسم)\s+(.+?)(?:[،,.\n]|$)/);
  if (defZone && defZone[1].trim().length >= 2) return defZone[1].trim();
  return short.length >= 2 ? short : norm.trim();
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

/** Noise tokens stripped from a leg's account text.
 * Entries MUST be in normalizeArabic() output form (the text is normalized
 * BEFORE tokenizing — e.g. دائن arrives as داين, ة as ه; an unnormalized
 * entry silently never matches). */
const LEG_NOISE = new Set([
  'حساب', 'من', 'الي', 'الى', 'مدين', 'المدين', 'داين', 'الداين',
  'منه', 'عليه', 'و', 'ب', 'Dr', 'Cr',
  // Dictation command words leak into the first leg's span ("سجل قيد 2000
  // إلى حساب المصروفات") — never account names.
  'سجل', 'قيد', 'تسجيل', 'انشاء',
]);

/** Remove amounts, side markers and conjunctions → clean account text.
 * Input MUST already be normalizeArabic() output (see LEG_NOISE). Arabic
 * punctuation (،؛:) is blanked first so it never glues to a name. */
function cleanLegAccount(span: string): string {
  const norm = normalizeArabic(span);
  const tokens = norm
    .replace(/\d+(?:\.\d+)?/g, ' ')
    .replace(/[،؛:]/g, ' ')
    .split(/\s+/)
    .map((t) => (t === 'لحساب' ? 'حساب' : t))
    .filter((t) => t.length > 0 && !LEG_NOISE.has(t));
  return tokens.join(' ').trim();
}

function legSide(spanNorm: string): 'debit' | 'credit' | null {
  // spanNorm is normalizeArabic() output: دائن arrives as داين.
  if (/(^|\s)(مدين|المدين|دين|عليه|منه)(\s|$)/.test(spanNorm)) return 'debit';
  if (/(^|\s)(داين|الداين|داينه|له|لها)(\s|$)/.test(spanNorm)) return 'credit';
  return null;
}

/**
 * Deterministic journal-leg splitter (independent task).
 *
 * Dictation convention: amounts open legs ("500000 الصندوق …"), an explicit
 * مدين/دائن marker wins, "من حساب X" is the CREDIT source, "إلى/لحساب X"
 * is a debit destination, everything else defaults to debit. A single
 * amount-less leg takes the balancing figure (|D−C| on the smaller side);
 * anything else unbalanced is reported, never invented.
 */
export function extractJournalLegs(rawText: string): {
  legs: PlannedJournalLeg[];
  balanced: boolean;
  totalDebit: number;
  totalCredit: number;
} {
  const empty = { legs: [], balanced: false, totalDebit: 0, totalCredit: 0 };
  const text = toLatinDigits(rawText ?? '');
  if (!text.trim()) return empty;
  const clean = stripDateSpans(text);

  // Side tails: "… من حساب رأس المال" (credit source), "… إلى حساب X"
  // or "… لحساب X" (debit destination). Last occurrence wins.
  let main = clean;
  let tailText: string | null = null;
  let tailSide: 'debit' | 'credit' = 'credit';
  const mFrom = clean.match(/^(.*)\sمن\s+(حساب\s+)?(.+)$/);
  const mTo = !mFrom && clean.match(/^(.*)\s(?:إلى|الى|الي|لحساب)\s+(حساب\s+)?(.+)$/);
  if (mFrom) {
    main = mFrom[1];
    tailText = (mFrom[2] ?? '') + mFrom[3];
    tailSide = 'credit';
  } else if (mTo) {
    main = mTo[1];
    tailText = (mTo[2] ?? '') + mTo[3];
    tailSide = 'debit';
  }

  const legs: PlannedJournalLeg[] = [];
  // Each amount opens a leg spanning to the next amount.
  const re = /(\d+(?:\.\d+)?)/g;
  const hits: Array<{ value: number; index: number; end: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(main)) !== null) {
    const n = parseFlexibleNumber(m[1]);
    if (typeof n === 'number' && Number.isFinite(n)) {
      hits.push({ value: n, index: m.index, end: m.index + m[1].length });
    }
  }
  for (let i = 0; i < hits.length; i++) {
    const span = main.slice(hits[i].index, i + 1 < hits.length ? hits[i + 1].index : undefined);
    // Side comes from the region BEFORE this leg's own amount (markers
    // precede their amount: "مدين 1000 …"). Reading the whole span leaks
    // the NEXT leg's marker ("…الصندوق، دائن 1000") into this leg's side.
    const prevEnd = i > 0 ? hits[i - 1].end : 0;
    const side =
      legSide(normalizeArabic(main.slice(prevEnd, hits[i].index))) ?? 'debit';
    const accountText = cleanLegAccount(span);
    if (!accountText) continue;
    legs.push(
      side === 'debit'
        ? { accountText, debit: hits[i].value }
        : { accountText, credit: hits[i].value },
    );
  }
  if (tailText) {
    const accountText = cleanLegAccount(tailText);
    if (accountText) {
      legs.push(
        tailSide === 'debit' ? { accountText, debit: undefined } : { accountText, credit: undefined },
      );
    }
  }

  const totalDebit = legs.reduce((s, l) => s + (l.debit ?? 0), 0);
  const totalCredit = legs.reduce((s, l) => s + (l.credit ?? 0), 0);
  const open = legs.filter((l) => l.debit === undefined && l.credit === undefined);
  if (open.length === 1 && totalDebit !== totalCredit) {
    const diff = Math.abs(totalDebit - totalCredit);
    if (totalDebit > totalCredit) open[0].credit = diff;
    else open[0].debit = diff;
  }
  const d = legs.reduce((s, l) => s + (l.debit ?? 0), 0);
  const c = legs.reduce((s, l) => s + (l.credit ?? 0), 0);
  const balanced = legs.length > 0 && d > 0 && Math.abs(d - c) < 0.01;
  return { legs, balanced, totalDebit: d, totalCredit: c };
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
    case 'pos.sale':
      // Product + customer + till: the shift itself comes from
      // pos.get_active_shift at execution time (rule 47), never from search.
      return ['product', 'customer', 'cash_box'];
    case 'manufacturing.work_order_status':
      // Which order is resolved from the short query (number/product);
      // the target state is already decided below — never searched.
      return ['workOrder'];
    case 'crm.lead':
      return ['lead'];
    case 'hr.employee':
      return ['employee'];
    case 'hr.operations':
      // Employees resolve up-front; the wizards (preview→generate→post,
      // attendance, leaves) consume their UUIDs. No invoice lines ever.
      return ['employee'];
    case 'accounting.asset':
      return ['asset'];
    case 'tax.period':
    case 'settings.manage':
      // Periods/settings resolve via their own search/list tools mid-chain,
      // not the pre-resolution block — the intent match itself is the win
      // (stops invoice/journal fallback garbage on these texts).
      return [];
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
      slots: { quantities: [], prices: [], lines: [], journalLegs: [] },
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
      slots: { quantities: [], prices: [], lines: [], journalLegs: [] },
      entityRequests: [],
      missing: [],
      plan: 'generic',
    };
  }
  if (intent === 'generic') {
    return {
      intent,
      writeTool: null,
      slots: { quantities: [], prices: [], lines: [], journalLegs: [] },
      entityRequests: [],
      missing: [],
      plan: 'generic',
    };
  }

  const isCash = CASH_RE.test(norm);
  const slots: PlannedRequest['slots'] = { quantities: [], prices: [], lines: [], journalLegs: [] };
  const isInvoiceLike =
    intent === 'sales.invoice' ||
    intent === 'purchases.invoice' ||
    intent === 'invoice.undirected' ||
    intent === 'pos.sale';
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
  if (intent === 'manufacturing.work_order_status') {
    slots.workOrderStatus = /مكتمل|اكتمل|انهاء|اغلاق/.test(norm)
      ? 'completed'
      : 'in_progress';
  }
  if (intent === 'tax.period') {
    // Fiscal year travels with the plan — the model must not re-parse it
    // per turn ("اقفل السنة 2025" → 2025, never an amount). Up to two words
    // may sit between ("السنة المالية 2025").
    const m = text.match(/(?:سنة|سنه|عام|فتره|فترة)(?:\s+\S+){0,2}\s*(\d{4})|(\d{4})\s*(?:سنة|سنه|عام)/);
    const y = m ? Number(m[1] ?? m[2]) : NaN;
    if (Number.isInteger(y) && y >= 2000 && y <= 2100) slots.fiscalYear = y;
  }
  // Journal legs split BEFORE entity requests are built — resolution is
  // per-leg (each account text independently).
  const journalSplit =
    intent === 'accounting.journal' ? extractJournalLegs(text) : null;
  if (journalSplit) slots.journalLegs = journalSplit.legs;
  const date = extractDate(text);
  if (date) slots.date = date;

  const kinds = needsFor(intent);
  // Cash invoices need the treasury too — same full-text blob, the box
  // family scores it independently (no name segmentation attempted).
  if ((intent === 'sales.invoice' || intent === 'purchases.invoice') && slots.paymentType === 'cash') {
    kinds.push('cash_box');
  }  // Journal legs resolve per-leg (each account text independently) — one
  // blob request could never separate three accounts. Leg texts are already
  // short; other kinds go through the short-query extractor so command/doc
  // words never dilute the fuzzy score ("فاتورة ابو العز هي فاتورة
  // مشتريات" → "ابو العز").
  const entityRequests: EntityRequest[] =
    intent === 'accounting.journal' && slots.journalLegs.length > 0
      ? slots.journalLegs.map((l) => ({ text: l.accountText, kind: 'account' as const }))
      : kinds.map((kind) => ({ text: extractEntityQuery(text), kind }));

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
  if (intent === 'accounting.journal' && journalSplit) {
    if (journalSplit.legs.length === 0) {
      missing.push({
        field: 'legs',
        questionAr: 'ما أطراف القيد؟ (اذكر كل طرف بمبلغه وحسابه، مثال: مدين 500000 الصندوق الرئيسي، دائن 500000 رأس المال)',
      });
    } else if (!journalSplit.balanced) {
      missing.push({
        field: 'legs',
        questionAr: `أطراف القيد غير متوازنة (مدين ${journalSplit.totalDebit} مقابل دائن ${journalSplit.totalCredit}) — صحّح المبالغ أو الحسابات ثم أعد الطلب`,
      });
    }
  }

  return {
    intent,
    // Undirected invoices name no tool — the block decides (rule 55).
    // HR operations / assets / periods / settings are multi-step by nature.
    writeTool:
      intent === 'invoice.undirected' ||
      intent === 'hr.operations' ||
      intent === 'accounting.asset' ||
      intent === 'tax.period' ||
      intent === 'settings.manage'
        ? null
        : INTENT_WRITE_TOOL[intent],
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
  if (planned.slots.journalLegs.length > 0) {    const bits = planned.slots.journalLegs.map((l) =>
      l.debit !== undefined
        ? `مدين ${l.debit} ← ${l.accountText}`
        : l.credit !== undefined
          ? `دائن ${l.credit} ← ${l.accountText}`
          : `${l.accountText} (يُحسب)`,
    );
    parts.push(
      `- **أطراف القيد المستخرجة (متوازنة — استخدمها كما هي في entries مع معرفات الكتلة أعلاه)**: ${bits.join('؛ ')}`,
    );
  }
  if (planned.slots.date) parts.push(`- **التاريخ**: ${planned.slots.date}`);
  if (planned.slots.fiscalYear) {
    parts.push(`- **السنة المالية**: ${planned.slots.fiscalYear} — استخدمها في أدوات الفترات/الإقفال كما هي`);
  }
  if (planned.slots.workOrderStatus) {
    parts.push(
      planned.slots.workOrderStatus === 'completed'
        ? '- **الحالة المستهدفة**: مكتمل (completed) — مرّر workOrderId من الكتلة أعلاه لأداة update_work_order_status'
        : '- **الحالة المستهدفة**: قيد التنفيذ (in_progress) — مرّر workOrderId من الكتلة أعلاه لأداة update_work_order_status',
    );
  }
  if (planned.slots.paymentType === 'cash') {
    parts.push('- **الدفع**: نقدي — مرّر paymentType=cash مع cashBoxId من الكتلة أعلاه، لا فاتورة آجلة (القاعدة 28)');
  }
  if (parts.length === 0) return null;
  return `📋 **معطيات مستخرجة من الطلب (استخدمها كما هي، لا تُعد حسابها):**\n${parts.join('\n')}`;
}
