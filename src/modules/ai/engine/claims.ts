/**
 * Anti-fabrication claim detection (pure, no I/O) — extracted verbatim from
 * chatEngine.ts (D1-light: the 2,500-line engine decomposes one self-contained
 * block at a time; each move is proven equivalent by the antiFabrication gate
 * plus the in-process verifier before the next block moves).
 *
 * Detects replies that CLAIM a business action happened (document created /
 * posted / voucher paid…) without any real tool execution behind them.
 *
 * The failing pattern from real sessions: the model drifts off the tool
 * loop and imitates earlier success summaries — inventing sequential doc
 * numbers (RV-000002…), "مرحّل Posted" status lines, even account codes —
 * while NOTHING was written to the DB.
 */

/**
 * Any document-looking token (≥1 digit): real sequences are zero-padded but
 * the model also writes WO-5 / INV-3. For CLAIM DETECTION a single digit is
 * enough — evidence matching decides truth, not digit count.
 */
export const DOC_ANY_RE = /\b(?:INV|PINV|QTN|RV|PV|JE|SRT|PRT|WO|PRD|EMP|CUST|LEAD|OPP|DEP|POS)-?\s?\d+\b/i;
/**
 * Business-entity nouns (Arabic + English). A completion verb aimed at one
 * of these ("قمت بإنشاء العميل بنجاح") is a business-action claim even with
 * no document number at all. Deliberately EXCLUDES generic words (عملية،
 * شيء، تمام، عمل) so vague acknowledgements don't trip the guard.
 */
const ENTITY_NOUN_RE =
  /(العميل|العملاء|عميل|عملاء|المورد|الموردين|مورد|موردين|المنتج|المنتجات|منتج|منتجات|الصنف|الأصناف|صنف|أصناف|الفاتورة|الفواتير|فاتورة|فواتير|السند|السندات|سند|سندات|القيد|القيود|قيد|قيود|الموظف|الموظفين|موظف|موظفين|الراتب|الرواتب|راتب|رواتب|المسير|الإجازة|الإجازات|إجازة|إجازات|المهمة|المهام|مهمة|مهام|الفرصة|الفرص|فرصة|فرص|العرض|العروض|عرض|عروض|المردود|المرتجع|مردود|مرتجع|الطلب|الطلبات|طلب|طلبات|الدفعة|الدفعات|دفعة|دفعات|الحساب|الحسابات|حساب|حسابات|المخزون|مخزون|المستودع|المستودعات|مستودع|مستودعات|الخزينة|الخزائن|خزينة|خزائن|الأصل|الأصول|أصل|أصول|القسم|الأقسام|قسم|أقسام|المحتمل|التشغيل|الإصدار|المصروف|المصروفات|مصروف|مصروفات|الإيصال|العقد|الوردية|الشحنة|customer|supplier|product|invoice|voucher|order|employee|payroll|leave|task|opportunity|quotation|return|payment|account|asset|department)/i;
const ACTION_CLAIM_RE =
  /(قمت\s+ب?\s*(إنشاء|تسجيل|ترحيل|إصدار|صرف|قبض|سداد|دفع))|(تم\s+(الآن\s+)?(إنشاء|تسجيل|ترحيل|إصدار|صرف|قبض|سداد))|(أنشأت|سجّلت|سجلت|رحّلت|رحلت|أصدرت|صرفت|قبضت|سدّدت|سددت|دفعت)/;

/** True when the reply asserts a completed business action. */
export function claimsBusinessAction(content: string): boolean {
  if (!content) return false;
  if (!ACTION_CLAIM_RE.test(content)) return false;
  return DOC_ANY_RE.test(content) || /مرحّل|مُرحّل|Posted/i.test(content) || ENTITY_NOUN_RE.test(content);
}

/** Entity nouns mentioned in a claim (normalized, ال/لل stripped) — for evidence matching. */
export function extractClaimedEntities(content: string): string[] {
  const out: string[] = [];
  const re = new RegExp(ENTITY_NOUN_RE.source, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const norm = m[0].replace(/^(ال|لل)/, '');
    if (norm && !out.includes(norm)) out.push(norm);
  }
  return out;
}

/**
 * Arabic noun → English tool-payload counterpart. Tool results are JSON with
 * English keys/values (`customerId`, `voucherNumber`…), while honest
 * follow-up summaries are Arabic ("أنشأت العميل بنجاح"). Without this
 * bridge every numberless Arabic summary after a REAL write would be
 * "corrected" as fabrication — pressuring re-execution and duplicates.
 */
export const NOUN_EN: Record<string, string> = {
  عميل: 'customer', عملاء: 'customer', مورد: 'supplier', موردين: 'supplier',
  منتج: 'product', منتجات: 'product', صنف: 'product', أصناف: 'product',
  فاتورة: 'invoice', فواتير: 'invoice', سند: 'voucher', سندات: 'voucher',
  قيد: 'journal', قيود: 'journal', موظف: 'employee', موظفين: 'employee',
  راتب: 'payroll', رواتب: 'payroll', مسير: 'payroll',
  إجازة: 'leave', إجازات: 'leave', مهمة: 'task', مهام: 'task',
  فرصة: 'opportunity', فرص: 'opportunity', عرض: 'quotation', عروض: 'quotation',
  مردود: 'return', مرتجع: 'return', طلب: 'order', طلبات: 'order',
  دفعة: 'batch', دفعات: 'batch', حساب: 'account', حسابات: 'account',
  مخزون: 'stock', مستودع: 'warehouse', مستودعات: 'warehouse',
  خزينة: 'cash', خزائن: 'cash', أصل: 'asset', أصول: 'asset',
  قسم: 'department', أقسام: 'department', محتمل: 'lead',
  تشغيل: 'work_order', إصدار: 'issue', مصروف: 'expense', مصروفات: 'expense',
  إيصال: 'receipt', عقد: 'contract', وردية: 'shift', شحنة: 'shipment',
};
