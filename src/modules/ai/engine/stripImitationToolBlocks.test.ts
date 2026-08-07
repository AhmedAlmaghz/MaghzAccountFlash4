import { describe, it, expect } from 'vitest';
import { stripImitationToolBlocks } from './chatEngine';

describe('stripImitationToolBlocks', () => {
  it('returns empty/undefined/null input unchanged', () => {
    expect(stripImitationToolBlocks('')).toBe('');
    expect(stripImitationToolBlocks(undefined as unknown as string)).toBeUndefined();
    expect(stripImitationToolBlocks(null as unknown as string)).toBeNull();
  });

  it('strips lines starting with [تم تنفيذ: ...]', () => {
    const content = 'مرحباً\n[تم تنفيذ: search.accounts] {"matches":[{"id":"a1b2c3d4"}]}\nهل يمكنني المساعدة؟';
    expect(stripImitationToolBlocks(content)).toBe('مرحباً\nهل يمكنني المساعدة؟');
  });

  it('strips lines starting with [تم استدعاء: ...]', () => {
    const content = '[تم استدعاء: sales.create_invoice — لم يتم إرجاع نتيجة بعد]';
    expect(stripImitationToolBlocks(content)).toBe('');
  });

  it('strips the new internal TOOL_RESULT format including its JSON payload line', () => {
    const content = 'نص قبل\n[TOOL_RESULT: search.customers]\n{"matches":[]}\nنص بعد';
    expect(stripImitationToolBlocks(content)).toBe('نص قبل\nنص بعد');
  });

  it('strips multiline JSON payload after a marker', () => {
    const content = '[TOOL_RESULT: search.accounts]\n{\n  "matches": []\n}\nخاتمة';
    expect(stripImitationToolBlocks(content)).toBe('خاتمة');
  });

  it('strips the new internal TOOL_CALLED format', () => {
    const content = 'جملة\n[TOOL_CALLED: test.read — لم يتم إرجاع نتيجة بعد]';
    expect(stripImitationToolBlocks(content)).toBe('جملة');
  });

  it('strips blocks with leading whitespace/indentation', () => {
    const content = '  [تم تنفيذ: search.products] {...}\nنص نظيف';
    expect(stripImitationToolBlocks(content)).toBe('نص نظيف');
  });

  it('handles multiple consecutive blocks', () => {
    const content = '[تم تنفيذ: a]\n[تم تنفيذ: b]\n[TOOL_RESULT: c]\nآخر سطر';
    expect(stripImitationToolBlocks(content)).toBe('آخر سطر');
  });

  it('keeps normal Arabic text mentioning تم تنفيذ without brackets', () => {
    const content = 'تم تنفيذ العملية بنجاح وتم إنشاء الفاتورة.';
    expect(stripImitationToolBlocks(content)).toBe('تم تنفيذ العملية بنجاح وتم إنشاء الفاتورة.');
  });

  it('keeps lines where the block marker is not at line start', () => {
    const content = 'نص يذكر [تم تنفيذ: x] في منتصف السطر بشكل غير مقصود';
    expect(stripImitationToolBlocks(content)).toContain('[تم تنفيذ: x]');
  });

  it('trims surrounding whitespace of the result', () => {
    expect(stripImitationToolBlocks('\n\n  [تم تنفيذ: x] {...}  \n\n')).toBe('');
  });
});
