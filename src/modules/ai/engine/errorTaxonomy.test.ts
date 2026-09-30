import { describe, it, expect } from 'vitest';
import { classifyToolError, renderErrorGuidance } from './errorTaxonomy';
import { PG_AR_SENTENCES } from '@/core/utils/pgErrors';

/**
 * The taxonomy contract: every classification must yield a REASON (why) and a
 * FIX HINT (what to do next) — the two halves of "guided error handling".
 * Patterns mirror the real API guard messages (Arabic-first) — when a guard
 * message changes, its pattern here must change with it.
 */
describe('classifyToolError', () => {
  it('classifies missing entity ids (MISSING_ID) with a search-first hint', () => {
    const c = classifyToolError('customerId مطلوب — استخدم search.customers أولاً');
    expect(c.code).toBe('MISSING_ID');
    expect(c.reason).toMatch(/معرفات|بحث/);
    expect(c.fixHint).toContain('search');
    expect(c.retryable).toBe(true);
  });

  it('classifies unbalanced journal entries (UNBALANCED_ENTRY) as retryable', () => {
    const c = classifyToolError('مجموع المدين (500) لا يساوي مجموع الدائن (450)');
    expect(c.code).toBe('UNBALANCED_ENTRY');
    expect(c.fixHint).toMatch(/توازن|المدين/);
    expect(c.retryable).toBe(true);
  });

  it('classifies leave balance rejection (INSUFFICIENT_BALANCE) with the remaining-days hint', () => {
    const c = classifyToolError('رصيد غير كاف: التجاوز غير مسموح. المتبقي: 3 أيام');
    expect(c.code).toBe('INSUFFICIENT_BALANCE');
    expect(c.reason).toMatch(/الرصيد/);
    expect(c.fixHint).toContain('hr.get_leave_balances');
    expect(c.retryable).toBe(true);
  });

  it('classifies stage machine rejection (INVALID_STATUS_TRANSITION) as NOT retryable', () => {
    const c = classifyToolError('انتقال غير قانوني: لا يمكن الرجوع من won إلى negotiation — المراحل النهائية مقفلة');
    expect(c.code).toBe('INVALID_STATUS_TRANSITION');
    expect(c.retryable).toBe(false);
    expect(c.fixHint).toMatch(/تسلسل|مسار/);
  });

  it('classifies mutating a posted document (DOCUMENT_NOT_DRAFT) as NOT retryable', () => {
    const c = classifyToolError('لا يمكن حذف فاتورة مرحلة — الفاتورة posted ولها قيد محاسبي');
    expect(c.code).toBe('DOCUMENT_NOT_DRAFT');
    expect(c.retryable).toBe(false);
    expect(c.fixHint).toMatch(/عكسي|مردود/);
  });

  it('classifies delete-with-children guards (DOCUMENT_HAS_CHILDREN)', () => {
    const c = classifyToolError('لا يمكن حذف العميل: له فواتير مرتبطة');
    expect(c.code).toBe('DOCUMENT_HAS_CHILDREN');
    expect(c.fixHint).toMatch(/أرشف|عطّل|isActive|الحركات/);
    expect(c.retryable).toBe(false);
  });

  it('classifies duplicate document fingerprints (DUPLICATE_DOCUMENT)', () => {
    const c = classifyToolError('مرفوض: يوجد مستند مطابق بنفس البيانات (تكرار محتمل)');
    expect(c.code).toBe('DUPLICATE_DOCUMENT');
    expect(c.reason).toMatch(/تكرار|مزدوج/);
  });

  it('classifies duplicate entity names (DUPLICATE_ENTITY) with search-first hint', () => {
    const c = classifyToolError('الاسم مستخدم: يوجد عميل بنفس الاسم');
    expect(c.code).toBe('DUPLICATE_ENTITY');
    expect(c.fixHint).toContain('search');
  });

  it('classifies permission denial (PERMISSION_DENIED) as NOT retryable', () => {
    const c = classifyToolError('ليس لديك صلاحية تنفيذ هذه العملية (settings.edit)');
    expect(c.code).toBe('PERMISSION_DENIED');
    expect(c.retryable).toBe(false);
    expect(c.fixHint).toMatch(/صلاحية|مدير/);
  });

  it('classifies tool timeouts (TIMEOUT) with a smaller-request hint', () => {
    const c = classifyToolError('انتهت مهلة تنفيذ الأداة "التقارير" (30 ثانية)');
    expect(c.code).toBe('TIMEOUT');
    expect(c.fixHint).toMatch(/أصغر|أعد المحاولة/);
    expect(c.retryable).toBe(true);
  });

  it('classifies rate limiting (RATE_LIMIT)', () => {
    const c = classifyToolError('تم تجاوز حد الاستدعاءات المسموح به — حاول مرة أخرى بعد قليل');
    expect(c.code).toBe('RATE_LIMIT');
  });

  it('classifies provider overloads (PROVIDER_ERROR) as retryable — P3 reachable-code fix', () => {
    expect(classifyToolError('انتهت حصة الذكاء الاصطناعي مؤقتاً (429) — انتظر دقيقة ثم قل "تابع"').code).toBe('PROVIDER_ERROR');
    expect(classifyToolError('مزود الذكاء الاصطناعي مثقل حالياً (503) — انتظر قليلاً').code).toBe('PROVIDER_ERROR');
    const c = classifyToolError('تعذر الاتصال بمزود الذكاء الاصطناعي: socket hang up');
    expect(c.code).toBe('PROVIDER_ERROR');
    expect(c.retryable).toBe(true);
  });

  it('classifies technical DB errors (DB_ERROR)', () => {
    const c = classifyToolError('invalid input syntax for type uuid');
    expect(c.code).toBe('DB_ERROR');
    expect(c.reason).toMatch(/تقني/);
  });

  it('falls back to UNKNOWN without losing the raw message', () => {
    const c = classifyToolError('حدث خطأ غريب تماماً');
    expect(c.code).toBe('UNKNOWN');
    expect(c.raw).toBe('حدث خطأ غريب تماماً');
    expect(c.fixHint).toBeTruthy();
  });

  it('matches patterns despite Arabic orthography variants (hamza/teh-marbuta)', () => {
    // Raw message says "مرحّل" (with shadda) — classifier folds diacritics.
    const c = classifyToolError('لا يمكن تعديل مستند مرحّل');
    expect(c.code).toBe('DOCUMENT_NOT_DRAFT');
  });

  it('never returns empty reason/fixHint even for UNKNOWN', () => {
    const c = classifyToolError('');
    expect(c.reason.length).toBeGreaterThan(5);
    expect(c.fixHint.length).toBeGreaterThan(5);
  });

  it('a forwarded stable key beats the regex — FK_VIOLATION becomes INVALID_REFERENCE, not a delete guard', () => {
    // Before the key existed, a CREATE with a dead parentId matched
    // DOCUMENT_HAS_CHILDREN ("archive instead of deleting") — guidance that
    // tells the model to delete the record it just failed to create.
    const c = classifyToolError('مرجع غير صالح — السجل المرتبط غير موجود أو لا يخص هذه الشركة', 'FK_VIOLATION');
    expect(c.code).toBe('INVALID_REFERENCE');
    expect(c.fixHint).toMatch(/search/);
    expect(c.fixHint).not.toMatch(/أرشف/);
    expect(c.retryable).toBe(true);
  });

  it('a forwarded UNIQUE_VIOLATION maps onto the duplicate family', () => {
    const c = classifyToolError('القيمة مستخدمة مسبقاً — لا يمكن التكرار', 'UNIQUE_VIOLATION');
    expect(c.code).toBe('DUPLICATE_ENTITY');
  });

  it('a forwarded INVALID_TEXT maps onto INVALID_VALUE', () => {
    const c = classifyToolError('صيغة قيمة غير صحيحة', 'INVALID_TEXT_REPRESENTATION');
    expect(c.code).toBe('INVALID_VALUE');
  });

  it('an unknown key falls through to the regex as if no key travelled', () => {
    const c = classifyToolError('customerId مطلوب', 'SOMETHING_NEW');
    expect(c.code).toBe('MISSING_ID');
  });

  it('exact-matches every adapter sentence even when no key travelled', () => {
    // Tools forward only `{ error }` today, so the sentence is all the
    // taxonomy gets. These are constants, not prose — pin the whole table.
    const expected: Record<string, string> = {
      FK_VIOLATION: 'INVALID_REFERENCE',
      UNIQUE_VIOLATION: 'DUPLICATE_ENTITY',
      NOT_NULL_VIOLATION: 'INVALID_VALUE',
      CHECK_VIOLATION: 'INVALID_VALUE',
      VALUE_TOO_LONG: 'INVALID_VALUE',
      INVALID_TEXT_REPRESENTATION: 'INVALID_VALUE',
      SERIALIZATION_FAILURE: 'DB_ERROR',
      DEADLOCK_DETECTED: 'DB_ERROR',
      DB_ERROR: 'DB_ERROR',
    };
    for (const [key, code] of Object.entries(expected)) {
      const sentence = PG_AR_SENTENCES[key as keyof typeof PG_AR_SENTENCES];
      const c = classifyToolError(sentence);
      expect(c.code, `${key}: ${sentence}`).toBe(code);
      expect(c.code, key).not.toBe('UNKNOWN');
    }
  });
});

describe('renderErrorGuidance', () => {
  it('renders the structured block with all five fields', () => {
    const c = classifyToolError('customerId مطلوب');
    const block = renderErrorGuidance(c);
    expect(block).toContain('[تصنيف الخطأ: MISSING_ID]');
    expect(block).toContain('ما حدث:');
    expect(block).toContain('السبب:');
    expect(block).toContain('الإجراء المقترح:');
    expect(block).toMatch(/قابلة لإعادة|لن تنجح/);
  });

  it('non-retryable codes say retrying will not work', () => {
    const c = classifyToolError('لا يمكن حذف فاتورة مرحلة');
    const block = renderErrorGuidance(c);
    expect(block).toContain('لن تنجح');
  });
});
