import { describe, it, expect } from 'vitest';
import { classifyToolError, renderErrorGuidance } from './errorTaxonomy';

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
