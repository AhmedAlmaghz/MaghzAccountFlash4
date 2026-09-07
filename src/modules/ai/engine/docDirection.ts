import { fuzzyMatchScore, normalizeArabic } from '@/core/utils/normalizeArabic';

/**
 * Document direction classifier (Package C) — pure logic, no DB / IO.
 *
 * A document arriving as a file/photo may be OURS (issued by this company —
 * treat as-is) or EXTERNAL (issued by someone else — mirror the type:
 * their sales invoice is our purchase invoice, their receipt is our
 * payment, …). Guessing wrong corrupts the books, so the classifier is
 * fail-ASK: anything below certainty comes back `ambiguous` and the model
 * MUST ask the user (prompt rule 40) — never flip silently.
 *
 * Signal priority (strongest first):
 *  1. taxNumber exact digits match → same (1.0); both present but differ → external (0.95)
 *  2. phone digits match → same (0.95)
 *  3. normalized name (generic suffixes stripped) exact → same (0.95);
 *     fuzzy ≥ 0.85 → same; < 0.55 with a name present → external (0.7);
 *     in between → ambiguous
 *  4. conflicting signals (name matches, tax differs) → ambiguous, never same
 *  5. no issuer identity at all → ambiguous
 */

export type DocDirection = 'same' | 'external' | 'ambiguous';

export interface IssuerInfo {
  name?: string | null;
  nameEn?: string | null;
  taxNumber?: string | null;
  phone?: string | null;
}

export interface CompanyProfile {
  name: string;
  nameEn?: string | null;
  taxNumber?: string | null;
  phone?: string | null;
}

export interface DirectionVerdict {
  direction: DocDirection;
  /** 0–1. Same/external verdicts below 0.85 SHOULD still be shown to the user. */
  confidence: number;
  matchedOn: Array<'taxNumber' | 'phone' | 'name' | 'nameEn' | 'none'>;
  /** Arabic one-liner explaining the verdict (shown on the badge / asked). */
  reason: string;
}

/** Generic legal-form tokens — never identifying on their own (entityResolver stoplist spirit). */
const GENERIC_TOKENS = [
  'للتجارة', 'التجارية', 'للاستيراد', 'للتصدير', 'للاستيراد والتصدير',
  'المحدودة', 'المساهمة', 'القابضة', 'وشركاه', 'وشركاؤه', 'ذ.م.م', 'ش.م.م',
  'مؤسسة', 'شركة', 'مكتب', 'متجر', 'محلات', 'مجموعة', 'العام', 'العامة',
  'للمقاولات', 'للخدمات', 'للصناعة', 'الصناعية', 'الحديثة', 'الجديدة',
  'company', 'trading', 'limited', 'ltd', 'est', 'group', 'corp',
];

function stripGenericTokens(name: string): string {
  let out = ` ${normalizeArabic(name)} `;
  for (const tok of GENERIC_TOKENS) {
    out = out.split(` ${normalizeArabic(tok)} `).join(' ');
  }
  return out.replace(/\s+/g, ' ').trim();
}

function digitsOnly(v: string | null | undefined): string {
  return (v || '').replace(/\D/g, '');
}

/** Yemeni phone normalization: drop country prefix / trunk so 9677…, 07… and 7… compare equal. */
export function normalizePhone(phone: string | null | undefined): string {
  let d = digitsOnly(phone);
  if (d.startsWith('967')) d = d.slice(3);
  d = d.replace(/^0+/, '');
  return d;
}

/** Mirror map: OUR tool ↔ the tool an EXTERNAL document of that shape needs. */
const DOCUMENT_MIRROR: Record<string, string> = {
  'sales.create_invoice': 'purchases.create_invoice',
  'purchases.create_invoice': 'sales.create_invoice',
  'sales.create_and_post_invoice': 'purchases.create_and_post_invoice',
  'purchases.create_and_post_invoice': 'sales.create_and_post_invoice',
  'sales.post_invoice': 'purchases.post_invoice',
  'purchases.post_invoice': 'sales.post_invoice',
  'sales.create_sales_return': 'purchases.create_purchase_return',
  'purchases.create_purchase_return': 'sales.create_sales_return',
  'sales.post_return': 'purchases.post_return',
  'purchases.post_return': 'sales.post_return',
  'accounting.create_receipt_voucher': 'accounting.create_payment_voucher',
  'accounting.create_payment_voucher': 'accounting.create_receipt_voucher',
  'accounting.post_receipt_voucher': 'accounting.post_payment_voucher',
  'accounting.post_payment_voucher': 'accounting.post_receipt_voucher',
};

/** The tool to execute for an EXTERNAL document shaped like `toolName`, or null when no mirror exists. */
export function mirrorToolFor(toolName: string): string | null {
  return DOCUMENT_MIRROR[toolName] ?? null;
}

const SAME_THRESHOLD = 0.85;
const EXTERNAL_THRESHOLD = 0.55;

export function classifyDirection(issuer: IssuerInfo, company: CompanyProfile): DirectionVerdict {
  const issuerTax = digitsOnly(issuer.taxNumber);
  const companyTax = digitsOnly(company.taxNumber);
  if (issuerTax && companyTax) {
    if (issuerTax === companyTax) {
      return { direction: 'same', confidence: 1, matchedOn: ['taxNumber'], reason: 'الرقم الضريبي في المستند يطابق سجل الشركة' };
    }
    // Tax differs — strong external signal, but a name match alongside it is
    // a conflict (branch? typo?) → ask, never assume.
    const nameScore = bestNameScore(issuer, company);
    if (nameScore.score >= SAME_THRESHOLD) {
      return { direction: 'ambiguous', confidence: 0.5, matchedOn: ['name'], reason: 'الاسم يطابق الشركة لكن الرقم الضريبي مختلف — يلزم التأكيد' };
    }
    return { direction: 'external', confidence: 0.95, matchedOn: ['taxNumber'], reason: 'الرقم الضريبي في المستند لجهة أخرى' };
  }

  const issuerPhone = normalizePhone(issuer.phone);
  const companyPhone = normalizePhone(company.phone);
  if (issuerPhone && companyPhone && issuerPhone.length >= 7 && issuerPhone === companyPhone) {
    return { direction: 'same', confidence: 0.95, matchedOn: ['phone'], reason: 'رقم الهاتف في المستند يطابق الشركة' };
  }

  const { score, field } = bestNameScore(issuer, company);
  if (field === 'none') {
    return { direction: 'ambiguous', confidence: 0, matchedOn: ['none'], reason: 'لا يوجد اسم مُصدِر في المستند للمقارنة — يلزم السؤال' };
  }
  if (score >= SAME_THRESHOLD) {
    return { direction: 'same', confidence: Math.min(0.95, 0.7 + score * 0.25), matchedOn: [field], reason: 'اسم المُصدِر يطابق الشركة' };
  }
  if (score < EXTERNAL_THRESHOLD) {
    return { direction: 'external', confidence: 0.7, matchedOn: [field], reason: 'اسم المُصدِر مختلف عن الشركة — سيُعكس نوع المستند' };
  }
  return { direction: 'ambiguous', confidence: score, matchedOn: [field], reason: 'تشابه جزئي في الاسم — يلزم التأكيد قبل التسجيل' };
}

function bestNameScore(
  issuer: IssuerInfo,
  company: CompanyProfile,
): { score: number; field: 'name' | 'nameEn' | 'none' } {
  const candidates: Array<{ text: string | null | undefined; field: 'name' | 'nameEn' }> = [
    { text: issuer.name, field: 'name' },
    { text: issuer.nameEn, field: 'nameEn' },
  ];
  const companyNames = [stripGenericTokens(company.name), company.nameEn ? stripGenericTokens(company.nameEn) : '']
    .filter(Boolean);
  let best = { score: 0, field: 'none' as 'name' | 'nameEn' | 'none' };
  for (const c of candidates) {
    if (!c.text || !c.text.trim()) continue;
    const cleaned = stripGenericTokens(c.text);
    if (!cleaned) continue;
    for (const companyName of companyNames) {
      if (!companyName) continue;
      const score = cleaned === companyName ? 1 : fuzzyMatchScore(cleaned, companyName);
      if (score > best.score) best = { score, field: c.field };
    }
  }
  return best;
}

/** Arabic badge line for the approval card: direction + mirror, or the mandatory question. */
export function directionBadge(
  verdict: DirectionVerdict,
  docTool: string,
  issuerName?: string | null,
): string {
  const doc = issuerName ? `«${issuerName}»` : 'المستند';
  if (verdict.direction === 'same') return `الاتجاه: مستندنا — يُسجَّل كما هو (${docTool})`;
  if (verdict.direction === 'external') {
    const mirror = mirrorToolFor(docTool);
    return mirror
      ? `الاتجاه: معكوس — ${doc} من جهة أخرى ← يُسجَّل عبر ${mirror}`
      : `الاتجاه: معكوس — ${doc} من جهة أخرى، ولا توجد أداة مرآة لـ ${docTool} — راجع قبل التسجيل`;
  }
  return `الاتجاه غامض — ${doc}: ${verdict.reason}. اسأل المستخدم قبل أي تسجيل`;
}
