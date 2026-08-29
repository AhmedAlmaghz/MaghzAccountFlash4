/**
 * كشف تكرار المستندات — بصمة كاملة + تشابه عالٍ.
 * يُستخدم عند إنشاء أي مستند (فاتورة/عرض/مردود/سند/قيد...) لمنع التكرار الصامت.
 *
 * أفضل الممارسات:
 * - بصمة مستقرة: ترتيب السطور + تطبيع تواريخ/أرقام/نصوص + تقليم
 * - مقارنة داخل نفس الشركة فقط (company_id مفلتر قبل الاستدعاء)
 * - استبعاد الملغاة (cancelled) من المقارنة
 * - استبعاد الذات عند التعديل (excludeId)
 * - فصل تام (exact): بصمة متطابقة حرفياً → حظر كامل
 * - قريب جداً (near): نفس الطرف + نفس التاريخ + خطوط متداخلة ≥85% → تحذير مع تخيير
 * - Pure functions — قابلة للاختبار — لا side-effects
 */
import { normalizeArabic, fuzzyMatchScore } from './normalizeArabic';
import { toDateString } from './mapPgRow';

const NEAR_THRESHOLD = 0.85;

function normDate(d: string | undefined | null): string {
  if (!d) return '';
  const s = toDateString(d);
  if (s) return s;
  // fallback: YYYY-MM-DD
  const t = String(d).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : String(d).trim();
}

function normNum(n: unknown, decimals = 2): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return (0).toFixed(decimals);
  return v.toFixed(decimals);
}

function normStr(s: unknown): string {
  return normalizeArabic(String(s ?? '').trim());
}

function linesFingerprint(
  lines: Array<{ productId?: string; quantity?: unknown; unitPrice?: unknown; discountPercent?: unknown; lineTotal?: unknown }>,
): string {
  if (!lines?.length) return '';
  const normed = lines
    .map((l) => {
      const pid = String(l.productId ?? '').trim();
      const qty = normNum(l.quantity, 4);
      const price = normNum(l.unitPrice, 2);
      const disc = normNum(l.discountPercent ?? 0, 2);
      return `${pid}:${qty}:${price}:${disc}`;
    })
    .sort();
  return normed.join('|');
}

function voucherFingerprint(p: {
  partyId?: string | null;
  date?: string;
  amount?: unknown;
  currencyCode?: string;
  paymentMethod?: string;
  reference?: string;
}): string {
  return [
    normStr(p.partyId),
    normDate(p.date),
    normNum(p.amount, 2),
    normStr(p.currencyCode || 'YER'),
    normStr(p.paymentMethod),
    normStr(p.reference),
  ].join('|');
}

function journalFingerprint(p: {
  date?: string;
  description?: string;
  lines?: Array<{ accountId?: string; debit?: unknown; credit?: unknown }>;
}): string {
  const linesKey =
    p.lines
      ?.map((l) => `${String(l.accountId ?? '').trim()}:${normNum(l.debit, 2)}:${normNum(l.credit, 2)}`)
      .sort()
      .join('|') ?? '';
  return [normDate(p.date), normStr(p.description), linesKey].join('|');
}

// ---------- Per-type fingerprint builders (exact) ----------

export function salesInvoiceFingerprint(input: {
  customerId?: string;
  date?: string;
  currencyCode?: string;
  paymentType?: string;
  totalAmount?: unknown;
  discountAmount?: unknown;
  vatAmount?: unknown;
  lines?: Array<{ productId?: string; quantity?: unknown; unitPrice?: unknown; discountPercent?: unknown }>;
}): string {
  // البصمة الأساسية للرأس فقط (بدون سطور) لضمان الكشف حتى بدون جلب السطور
  // السطور تُفحص في nearScore عند توفرها
  return [
    normStr(input.customerId),
    normDate(input.date),
    normStr(input.currencyCode || 'YER'),
    normStr(input.paymentType),
    normNum(input.totalAmount, 2),
    normNum(input.discountAmount, 2),
    normNum(input.vatAmount, 2),
  ].join('|');
}

export function salesQuotationFingerprint(input: {
  customerId?: string;
  date?: string;
  expiryDate?: string;
  totalAmount?: unknown;
  lines?: Array<{ productId?: string; quantity?: unknown; unitPrice?: unknown; discountPercent?: unknown }>;
}): string {
  return [
    normStr(input.customerId),
    normDate(input.date),
    normDate(input.expiryDate),
    normNum(input.totalAmount, 2),
  ].join('|');
}

export function salesReturnFingerprint(input: {
  customerId?: string;
  invoiceId?: string;
  date?: string;
  reason?: string;
  totalAmount?: unknown;
  lines?: Array<{ productId?: string; quantity?: unknown; unitPrice?: unknown }>;
}): string {
  return [
    normStr(input.customerId),
    normStr(input.invoiceId),
    normDate(input.date),
    normNum(input.totalAmount, 2),
    normStr(input.reason),
  ].join('|');
}

export function purchaseInvoiceFingerprint(input: {
  supplierId?: string;
  date?: string;
  currencyCode?: string;
  totalAmount?: unknown;
  lines?: Array<{ productId?: string; quantity?: unknown; unitPrice?: unknown; discountPercent?: unknown }>;
}): string {
  return [
    normStr(input.supplierId),
    normDate(input.date),
    normStr(input.currencyCode || 'YER'),
    normNum(input.totalAmount, 2),
  ].join('|');
}

export function purchaseOrderFingerprint(input: {
  supplierId?: string;
  date?: string;
  expectedDate?: string;
  totalAmount?: unknown;
  lines?: Array<{ productId?: string; quantity?: unknown; unitPrice?: unknown }>;
}): string {
  return [
    normStr(input.supplierId),
    normDate(input.date),
    normDate(input.expectedDate),
    normNum(input.totalAmount, 2),
  ].join('|');
}

export function purchaseReturnFingerprint(input: {
  supplierId?: string;
  invoiceId?: string;
  date?: string;
  totalAmount?: unknown;
  lines?: Array<{ productId?: string; quantity?: unknown; unitPrice?: unknown }>;
}): string {
  return [
    normStr(input.supplierId),
    normStr(input.invoiceId),
    normDate(input.date),
    normNum(input.totalAmount, 2),
  ].join('|');
}

export function receiptVoucherFingerprint(input: {
  customerId?: string;
  date?: string;
  amount?: unknown;
  currencyCode?: string;
  paymentMethod?: string;
  reference?: string;
}): string {
  return voucherFingerprint({
    partyId: input.customerId,
    date: input.date,
    amount: input.amount,
    currencyCode: input.currencyCode,
    paymentMethod: input.paymentMethod,
    reference: input.reference,
  });
}

export function paymentVoucherFingerprint(input: {
  supplierId?: string;
  expenseAccountId?: string;
  date?: string;
  amount?: unknown;
  currencyCode?: string;
  paymentMethod?: string;
  reference?: string;
}): string {
  const party = input.supplierId || input.expenseAccountId;
  return voucherFingerprint({
    partyId: party,
    date: input.date,
    amount: input.amount,
    currencyCode: input.currencyCode,
    paymentMethod: input.paymentMethod,
    reference: input.reference,
  });
}

export function journalEntryFingerprint(input: {
  date?: string;
  description?: string;
  lines?: Array<{ accountId?: string; debit?: unknown; credit?: unknown }>;
}): string {
  return journalFingerprint(input);
}

// ---------- Generic near-score helpers ----------

function jaccardProductOverlap(
  aLines: Array<{ productId?: string }>,
  bLines: Array<{ productId?: string }>,
): number {
  const aSet = new Set(aLines.map((l) => String(l.productId ?? '').trim()).filter(Boolean));
  const bSet = new Set(bLines.map((l) => String(l.productId ?? '').trim()).filter(Boolean));
  if (aSet.size === 0 && bSet.size === 0) return 1;
  if (aSet.size === 0 || bSet.size === 0) return 0;
  let inter = 0;
  for (const v of aSet) if (bSet.has(v)) inter++;
  const union = new Set([...aSet, ...bSet]).size;
  return union === 0 ? 0 : inter / union;
}

function totalSimilarity(a: unknown, b: unknown): number {
  const av = Number(a);
  const bv = Number(b);
  if (!Number.isFinite(av) || !Number.isFinite(bv)) return av === bv ? 1 : 0;
  if (av === 0 && bv === 0) return 1;
  const max = Math.max(Math.abs(av), Math.abs(bv), 1);
  return Math.max(0, 1 - Math.abs(av - bv) / max);
}

function salesInvoiceNearScore(
  input: Parameters<typeof salesInvoiceFingerprint>[0],
  existing: Parameters<typeof salesInvoiceFingerprint>[0],
): number {
  if (normStr(input.customerId) !== normStr(existing.customerId)) return 0;
  if (normDate(input.date) !== normDate(existing.date)) return 0;
  if (normStr(input.currencyCode || 'YER') !== normStr(existing.currencyCode || 'YER')) return 0;
  const linesOverlap = jaccardProductOverlap(input.lines ?? [], existing.lines ?? []);
  // مقارنة السطور عبر fuzzy على المفتاح المرتب
  const linesKeyA = linesFingerprint(input.lines ?? []);
  const linesKeyB = linesFingerprint(existing.lines ?? []);
  const linesScore = linesKeyA && linesKeyB ? fuzzyMatchScore(linesKeyA, linesKeyB) : linesOverlap;
  const tScore = totalSimilarity(input.totalAmount, existing.totalAmount);
  // وزن: خطوط 60% + إجمالي 40%
  return linesScore * 0.6 + tScore * 0.4 + linesOverlap * 0.0; // linesScore already captures overlap
}

export function genericNearScore(
  inputParty: string | undefined,
  existingParty: string | undefined,
  inputDate: string | undefined,
  existingDate: string | undefined,
  inputLines: Array<{ productId?: string }>,
  existingLines: Array<{ productId?: string }>,
  inputTotal: unknown,
  existingTotal: unknown,
): number {
  if (normStr(inputParty) !== normStr(existingParty)) return 0;
  if (normDate(inputDate) !== normDate(existingDate)) return 0;
  const overlap = jaccardProductOverlap(inputLines, existingLines);
  const tScore = totalSimilarity(inputTotal, existingTotal);
  const linesKeyA = linesFingerprint(inputLines as never);
  const linesKeyB = linesFingerprint(existingLines as never);
  const linesScore = linesKeyA && linesKeyB ? fuzzyMatchScore(linesKeyA, linesKeyB) : overlap;
  // if no lines (e.g. vouchers), rely on total
  if (!inputLines.length && !existingLines.length) return tScore;
  return overlap * 0.3 + linesScore * 0.4 + tScore * 0.3;
}

// ---------- Public registry ----------

export type DocumentType =
  | 'sales_invoice'
  | 'sales_quotation'
  | 'sales_return'
  | 'purchase_invoice'
  | 'purchase_order'
  | 'purchase_return'
  | 'receipt_voucher'
  | 'payment_voucher'
  | 'journal_entry'
  | 'stock_adjustment'
  | 'stock_transfer'
  | 'work_order'
  | 'bom';

export interface DocumentDuplicateResult<T> {
  exactMatch: T | null;
  nearMatches: Array<{ item: T; score: number }>;
  hasDuplicates: boolean;
}

/**
 * الكشف العام — exact عبر بصمة متطابقة، near عبر درجة تشابه.
 * يستبعد الملغاة و الذات.
 */
export function detectDocumentDuplicates<T extends { id?: string; status?: string }>(
  inputFingerprint: string,
  inputNearPayload: unknown,
  existingDocs: T[],
  getFingerprint: (doc: T) => string,
  getNearScore: (input: unknown, existing: T) => number,
  options: { excludeId?: string; nearThreshold?: number; limit?: number } = {},
): DocumentDuplicateResult<T> {
  const { excludeId, nearThreshold = NEAR_THRESHOLD, limit = 5 } = options;
  let exact: T | null = null;
  const near: Array<{ item: T; score: number }> = [];

  for (const doc of existingDocs) {
    if (excludeId && doc.id === excludeId) continue;
    if (doc.status === 'cancelled' || doc.status === 'rejected') continue;
    const fp = getFingerprint(doc);
    if (fp === inputFingerprint) {
      exact = doc;
      break;
    }
  }
  if (exact) return { exactMatch: exact, nearMatches: [], hasDuplicates: true };

  for (const doc of existingDocs) {
    if (excludeId && doc.id === excludeId) continue;
    if (doc.status === 'cancelled' || doc.status === 'rejected') continue;
    const score = getNearScore(inputNearPayload, doc);
    if (score >= nearThreshold) near.push({ item: doc, score });
  }
  near.sort((a, b) => b.score - a.score);
  return { exactMatch: null, nearMatches: near.slice(0, limit), hasDuplicates: near.length > 0 };
}

// ---------- Convenience wrappers per type ----------

export function detectSalesInvoiceDuplicate<T extends { id?: string; status?: string; customerId?: string; date?: string; currencyCode?: string; totalAmount?: unknown; lines?: Array<{ productId?: string; quantity?: unknown; unitPrice?: unknown; discountPercent?: unknown }> }>(
  input: Parameters<typeof salesInvoiceFingerprint>[0],
  existing: T[],
  excludeId?: string,
): DocumentDuplicateResult<T> {
  const fp = salesInvoiceFingerprint(input);
  return detectDocumentDuplicates(
    fp,
    input,
    existing,
    (d) =>
      salesInvoiceFingerprint({
        customerId: (d as unknown as { customerId?: string }).customerId,
        date: (d as unknown as { date?: string }).date,
        currencyCode: (d as unknown as { currencyCode?: string }).currencyCode,
        totalAmount: (d as unknown as { totalAmount?: unknown }).totalAmount,
        discountAmount: (d as unknown as { discountAmount?: unknown }).discountAmount,
        vatAmount: (d as unknown as { vatAmount?: unknown }).vatAmount,
        lines: (d as unknown as { lines?: Array<{ productId?: string; quantity?: unknown; unitPrice?: unknown; discountPercent?: unknown }> }).lines,
      }),
    (inp, ex) => salesInvoiceNearScore(inp as Parameters<typeof salesInvoiceFingerprint>[0], ex as Parameters<typeof salesInvoiceFingerprint>[0]),
    { excludeId, nearThreshold: NEAR_THRESHOLD },
  );
}

export function detectPurchaseInvoiceDuplicate<T extends { id?: string; status?: string }>(
  input: Parameters<typeof purchaseInvoiceFingerprint>[0],
  existing: T[],
  excludeId?: string,
): DocumentDuplicateResult<T> {
  const fp = purchaseInvoiceFingerprint(input);
  return detectDocumentDuplicates(
    fp,
    input,
    existing,
    (d) =>
      purchaseInvoiceFingerprint({
        supplierId: (d as unknown as { supplierId?: string }).supplierId,
        date: (d as unknown as { date?: string }).date,
        currencyCode: (d as unknown as { currencyCode?: string }).currencyCode,
        totalAmount: (d as unknown as { totalAmount?: unknown }).totalAmount,
        lines: (d as unknown as { lines?: Array<{ productId?: string }> }).lines as never,
      }),
    (inp, ex) =>
      genericNearScore(
        (inp as { supplierId?: string }).supplierId,
        (ex as { supplierId?: string }).supplierId,
        (inp as { date?: string }).date,
        (ex as { date?: string }).date,
        (inp as { lines?: Array<{ productId?: string }> }).lines ?? [],
        (ex as { lines?: Array<{ productId?: string }> }).lines ?? [],
        (inp as { totalAmount?: unknown }).totalAmount,
        (ex as { totalAmount?: unknown }).totalAmount,
      ),
    { excludeId },
  );
}

export function detectJournalDuplicate<T extends { id?: string; status?: string }>(
  input: Parameters<typeof journalEntryFingerprint>[0],
  existing: T[],
  excludeId?: string,
): DocumentDuplicateResult<T> {
  const fp = journalEntryFingerprint(input);
  return detectDocumentDuplicates(
    fp,
    input,
    existing,
    (d) =>
      journalEntryFingerprint({
        date: (d as unknown as { date?: string }).date,
        description: (d as unknown as { description?: string }).description,
        lines: (d as unknown as { lines?: Array<{ accountId?: string; debit?: unknown; credit?: unknown }> }).lines,
      }),
    (inp, ex) => {
      const a = inp as Parameters<typeof journalEntryFingerprint>[0];
      const b = ex as unknown as Parameters<typeof journalEntryFingerprint>[0];
      if (normDate(a.date) !== normDate(b.date)) return 0;
      if (normStr(a.description) !== normStr(b.description)) return 0.4;
      const aKey = journalFingerprint(a);
      const bKey = journalFingerprint(b);
      return fuzzyMatchScore(aKey, bKey);
    },
    { excludeId },
  );
}

export function detectVoucherDuplicate<T extends { id?: string; status?: string }>(
  input: { partyId?: string; date?: string; amount?: unknown; currencyCode?: string; paymentMethod?: string },
  existing: T[],
  excludeId?: string,
): DocumentDuplicateResult<T> {
  const fp = voucherFingerprint(input);
  return detectDocumentDuplicates(
    fp,
    input,
    existing,
    (d) => {
      const dd = d as unknown as { customerId?: string; supplierId?: string; expenseAccountId?: string; date?: string; amount?: unknown; currencyCode?: string; paymentMethod?: string };
      const party = dd.customerId || dd.supplierId || dd.expenseAccountId;
      return voucherFingerprint({ partyId: party, date: dd.date, amount: dd.amount, currencyCode: dd.currencyCode, paymentMethod: dd.paymentMethod });
    },
    (inp, ex) => {
      const a = inp as { partyId?: string; date?: string; amount?: unknown };
      const b = ex as unknown as { customerId?: string; supplierId?: string; expenseAccountId?: string; date?: string; amount?: unknown };
      const bParty = b.customerId || b.supplierId || b.expenseAccountId;
      if (normStr(a.partyId) !== normStr(bParty)) return 0;
      if (normDate(a.date) !== normDate(b.date)) return 0;
      return totalSimilarity(a.amount, b.amount);
    },
    { excludeId },
  );
}
