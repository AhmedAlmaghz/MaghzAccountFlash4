/**
 * كشف التكرار والتشابه للأسماء — مع تطبيع عربي + Levenshtein + تدرج عتبات.
 * يُستخدم عند إنشاء عميل/مورد/موظف/منتج/حساب لمنع التكرار الصامت.
 *
 * يعتمد على normalizeArabic + fuzzyMatchScore الموجودين (لا يعيد اختراع التطبيع).
 * - تطابق تام (exact): النصان متساويان بعد التطبيع → حظر مباشر
 * - تشابه عالٍ (near): درجة تشابه ≥ 0.85 → تحذير مع تخيير (إلغاء / متابعة)
 *
 * أفضل الممارسات المطبقة:
 * - تطبيع شامل (ألف/ياء/تاء مربوطة/همزات/تشكيل/تطويل) قبل أي مقارنة
 * - استبعاد السجل الحالي عند التعديل (excludeId)
 * - تجاهل أسماء أقصر من حرفين (ضجيج)
 * - حد أقصى للنتائج + ترتيب تنازلي
 * - pure functions (سهلة الاختبار، بلا side-effects)
 */
import { normalizeArabic, fuzzyMatchScore } from './normalizeArabic';

export const DUPLICATE_EXACT_SCORE = 1;
export const DUPLICATE_NEAR_THRESHOLD = 0.85;
export const DUPLICATE_LIMIT_DEFAULT = 5;
export const DUPLICATE_MIN_LENGTH = 2;

export interface DuplicateCandidate<T> {
  item: T;
  score: number;
  matchType: 'exact' | 'near';
  /** الاسم المطابق الفعلي (لل­عرض) */
  matchedName: string;
  /** الكود إن وجد */
  matchedCode?: string;
}

export interface DuplicateResult<T> {
  /** تطابق تام واحد على الأكثر (الأعلى) */
  exactMatch: DuplicateCandidate<T> | null;
  /** تشابهات عالية مرتبة تنازلياً */
  nearMatches: DuplicateCandidate<T>[];
  /** هل يوجد أي تكرار (تام أو قريب) */
  hasDuplicates: boolean;
  /** كل المرشحين (تام + قريب) مرتبين */
  all: DuplicateCandidate<T>[];
}

export interface DetectDuplicatesOptions<T> {
  /** عتبة التشابه العالي (افتراضي 0.85) */
  nearThreshold?: number;
  /** حد أقصى للنتائج القريبة (افتراضي 5) */
  limit?: number;
  /** استبعاد هذا الـ id (وضع التعديل) */
  excludeId?: string;
  /** دالة استخراج الـ id للمقارنة مع excludeId */
  getId?: (item: T) => string | undefined;
  /** دالة استخراج الكود (لرفع الدقة عند تطابق الكود) */
  getCode?: (item: T) => string | undefined;
  /** أقل طول بعد التطبيع يُفحص (افتراضي 2) */
  minLength?: number;
}

/**
 * الكشف الشامل عن التكرار.
 * @param inputName الاسم المدخل حديثاً (قبل الحفظ)
 * @param items قائمة السجلات الموجودة (لنفس الشركة)
 * @param getName دالة استخراج الاسم من السجل
 * @param options خيارات العتبات والاستبعاد
 */
export function detectDuplicates<T>(
  inputName: string,
  items: T[],
  getName: (item: T) => string,
  options: DetectDuplicatesOptions<T> = {},
): DuplicateResult<T> {
  const {
    nearThreshold = DUPLICATE_NEAR_THRESHOLD,
    limit = DUPLICATE_LIMIT_DEFAULT,
    excludeId,
    getId,
    getCode,
    minLength = DUPLICATE_MIN_LENGTH,
  } = options;

  const normalizedInput = normalizeArabic(inputName ?? '');
  if (!normalizedInput || normalizedInput.length < minLength) {
    return { exactMatch: null, nearMatches: [], hasDuplicates: false, all: [] };
  }

  const candidates: DuplicateCandidate<T>[] = [];

  for (const item of items) {
    if (excludeId && getId) {
      const id = getId(item);
      if (id && id === excludeId) continue;
    }

    const rawName = getName(item) ?? '';
    const normalizedName = normalizeArabic(rawName);
    if (!normalizedName || normalizedName.length < minLength) continue;

    // فحص تطابق تام بعد التطبيع (يتعامل مع ألف/ياء/تاء مربوطة)
    const isNormalizedExact = normalizedInput === normalizedName;
    let score = isNormalizedExact ? 1 : fuzzyMatchScore(inputName, rawName);

    // تعزيز عند تطابق الكود حرفياً (بعد التطبيع)
    if (getCode) {
      const code = getCode(item);
      if (code) {
        const nCode = normalizeArabic(code);
        const nInput = normalizedInput;
        if (nCode && (nCode === nInput || nCode.includes(nInput) || nInput.includes(nCode))) {
          // تطابق كود يرفع الدرجة إلى 0.95 على الأقل (ليس تاماً إلا إذا الاسم أيضاً تام)
          score = Math.max(score, isNormalizedExact ? 1 : 0.95);
        }
      }
    }

    if (isNormalizedExact) {
      candidates.push({ item, score: 1, matchType: 'exact', matchedName: rawName, matchedCode: getCode?.(item) });
    } else if (score >= nearThreshold) {
      candidates.push({ item, score, matchType: 'near', matchedName: rawName, matchedCode: getCode?.(item) });
    }
  }

  candidates.sort((a, b) => {
    if (a.matchType !== b.matchType) return a.matchType === 'exact' ? -1 : 1;
    return b.score - a.score;
  });

  const exactMatch = candidates.find((c) => c.matchType === 'exact') ?? null;
  const nearMatches = candidates.filter((c) => c.matchType === 'near').slice(0, limit);

  const all = [...(exactMatch ? [exactMatch] : []), ...nearMatches];
  return {
    exactMatch,
    nearMatches,
    hasDuplicates: all.length > 0,
    all,
  };
}

/**
 * مساعد سريع يعيد true إذا يوجد تطابق تام.
 */
export function hasExactDuplicate<T>(
  inputName: string,
  items: T[],
  getName: (item: T) => string,
  options: Omit<DetectDuplicatesOptions<T>, 'nearThreshold' | 'limit'> = {},
): boolean {
  return detectDuplicates(inputName, items, getName, { ...options, nearThreshold: 1 }).exactMatch !== null;
}

/**
 * يبني مفتاح اسم مركب للمنتج/الحساب (عربي + إنجليزي + باركود/كود).
 * يتجاهل القيم الفارغة.
 */
export function buildCompositeName(...parts: Array<string | undefined | null>): string {
  return parts.filter((p): p is string => typeof p === 'string' && p.trim().length > 0).join(' ').trim();
}
