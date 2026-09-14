import { describe, it, expect } from 'vitest';
import {
  TaskLedger,
  normalizeEntityName,
  extractLedgerEntity,
  extractLedgerEntitiesFromItems,
  LEDGER_MAX_CHARS,
} from './taskLedger';
import type { ChatMessage } from '../types';

function msg(partial: Partial<ChatMessage> & { id: string }): ChatMessage {
  return {
    role: 'user',
    kind: 'text',
    content: '',
    createdAt: 1,
    ...partial,
  } as ChatMessage;
}

const MISSION = [
  'هذه قائمة مهام لإدخالها إلى النظام أريد منك ترتيبها حسب الأولوية وتنظيمها:',
  'قم باضافة مورد اسمه الشجاع للتجارة رصيده الافتتاحي 204000',
  'قم بإضافة العملاء التالية: مؤسسة غدرة التجارية رصيده الافتتاحي 132500',
  'شوكلاتة سويت مون صغير 65جم الوحدة شدة سعر البيع 10800 سعر التكلفة 10000',
  'تمر محشي سوداني كبير الوحدة درزن سعر البيع 18000 سعر التكلفة 16000',
].join('\n');

describe('normalizeEntityName', () => {
  it('unifies alef forms, taa marbuta, diacritics and spacing for matching', () => {
    expect(normalizeEntityName('الشجاع للتجارة')).toBe(normalizeEntityName('الشجاع  للتجاره'));
    expect(normalizeEntityName('أبو العِزّ')).toBe(normalizeEntityName('ابو العز'));
    expect(normalizeEntityName('مؤسسة الغدَرة')).toBe(normalizeEntityName('مؤسسه الغدره'));
  });
});

describe('extractLedgerEntity', () => {
  it('extracts entity names from master-data create tools', () => {
    expect(extractLedgerEntity({ tool: 'purchases.create_supplier', args: { name: 'الشجاع للتجارة' } }))
      .toEqual({ tool: 'purchases.create_supplier', name: 'الشجاع للتجارة' });
    expect(extractLedgerEntity({ tool: 'inventory.create_product', args: { nameAr: 'شوكلاتة سويت مون' } }))
      .toEqual({ tool: 'inventory.create_product', name: 'شوكلاتة سويت مون' });
    expect(extractLedgerEntity({ tool: 'hr.create_employee', args: { fullName: 'أحمد صالح' } }))
      .toEqual({ tool: 'hr.create_employee', name: 'أحمد صالح' });
  });

  it('never guards documents (invoices/vouchers) — their repeats are legitimate', () => {
    expect(extractLedgerEntity({ tool: 'sales.create_invoice', args: { name: 'فاتورة' } })).toBeNull();
    expect(extractLedgerEntity({ tool: 'accounting.create_receipt_voucher', args: { name: 'سند' } })).toBeNull();
    expect(extractLedgerEntity({ tool: 'sales.create_and_post_invoice', args: {} })).toBeNull();
    expect(extractLedgerEntity({ tool: 'search.suppliers', args: { name: 'الشجاع' } })).toBeNull();
  });

  it('extracts from the model alias shapes (type/data, action/payload)', () => {
    expect(extractLedgerEntitiesFromItems([
      { type: 'sales.create_customer', data: { name: 'غدرة' } },
      { tool: 'purchases.create_supplier', args: { name: 'الحمادي' } },
      { tool: 'sales.create_invoice', args: {} },
      'قيمة غريبة',
    ])).toEqual([
      { tool: 'sales.create_customer', name: 'غدرة' },
      { tool: 'purchases.create_supplier', name: 'الحمادي' },
    ]);
  });
});

describe('TaskLedger', () => {
  it('renders the original mission verbatim — no 120-char truncation', () => {
    const ledger = new TaskLedger();
    ledger.recordRequest(MISSION);
    const block = ledger.render() ?? '';
    expect(block).toContain('سجل المهمة الدائم لهذه الجلسة');
    expect(block).toContain('الشجاع للتجارة');
    expect(block).toContain('سعر البيع 10800');
    expect(block).toContain('سعر التكلفة 16000');
  });

  it('ignores a consecutive identical request (regenerate path)', () => {
    const ledger = new TaskLedger();
    ledger.recordRequest(MISSION);
    ledger.recordRequest(MISSION);
    const block = ledger.render() ?? '';
    expect(block.split('المهمة الأصلية').length - 1).toBe(1);
  });

  it('keeps the mission plus the two latest follow-up requests', () => {
    const ledger = new TaskLedger();
    ledger.recordRequest(MISSION);
    ledger.recordRequest('طلب أ: أضف عميلاً اسمه سالم');
    ledger.recordRequest('طلب ب: أضف مورداً اسمه النور');
    ledger.recordRequest('طلب ج: أضف عميلاً اسمه الكرامة');
    const block = ledger.render() ?? '';
    expect(block).toContain('المهمة الأصلية');
    expect(block).toContain('الكرامة'); // الأحدث
    expect(block).toContain('النور');   // ما قبله
    expect(block).not.toContain('سالم'); // الوسطى القديمة تُسقط لصالح الأحدث
  });

  it('records batch outcomes with created entities and feeds the duplicate guard', () => {
    const ledger = new TaskLedger();
    ledger.recordRequest(MISSION);
    ledger.recordFromBatchDetail({
      title: 'دفعة 1: الجهات والمخازن',
      failedCount: 0,
      skippedCount: 0,
      totalCount: 3,
      items: [
        { toolName: 'purchases.create_supplier', args: { name: 'الشجاع للتجارة' }, status: 'done' },
        { toolName: 'sales.create_customer', args: { name: 'مؤسسة غدرة التجارية' }, status: 'done' },
        { toolName: 'purchases.create_supplier', args: { name: 'مورد فاشل' }, status: 'failed' },
      ],
    });
    const block = ledger.render() ?? '';
    expect(block).toContain('ما نُفّذ فعلاً');
    expect(block).toContain('دفعة «دفعة 1: الجهات والمخازن»');
    expect(block).toContain('أُنشئ: «الشجاع للتجارة»');
    // حارس التكرار: مطابقة مُطبَّعة (مسافات + تاء مربوطة)
    expect(ledger.findDuplicateName('الشجاع  للتجاره')).toEqual({
      display: 'الشجاع للتجارة',
      tool: 'purchases.create_supplier',
    });
    expect(ledger.findDuplicateName('مورد جديد تماماً')).toBeNull();
    // العنصر الفاشل لا يدخل الحارس — يجب أن يُسمح بإعادة إنشائه بعد الإصلاح
    expect(ledger.findDuplicateName('مورد فاشل')).toBeNull();
  });

  it('rebuilds requests from persisted session messages (restore path)', () => {
    const ledger = new TaskLedger();
    ledger.rebuildFromMessages([
      msg({ id: 'u1', role: 'user', kind: 'text', content: MISSION }),
      msg({ id: 'a1', role: 'assistant', kind: 'text', content: 'اكتملت الدفعة: أُنجز 6 — فشل 0' }),
      msg({ id: 'u2', role: 'user', kind: 'text', content: 'استمر' }),
    ]);
    const block = ledger.render() ?? '';
    expect(block).toContain('سعر التكلفة 16000');
    expect(block).toContain('استمر');
  });

  it('keeps the rendered block within the system-prompt budget', () => {
    const ledger = new TaskLedger();
    ledger.recordRequest('مهمة طويلة جداً '.repeat(1000)); // ~18 ألف حرف
    for (let i = 0; i < 30; i++) {
      ledger.recordOutcome({ title: `دفعة ${i}`, line: 'أُنجز 10 — فشل 0 — تخطي 0 (من 10)' });
    }
    const block = ledger.render() ?? '';
    expect(block.length).toBeLessThanOrEqual(LEDGER_MAX_CHARS);
  });

  it('clips a huge mission keeping head AND tail (remaining task items survive)', () => {
    const ledger = new TaskLedger();
    const big = [
      'بداية القائمة — جهات ومخازن',
      ...Array.from({ length: 400 }, (_, i) => `بند رقم ${i} بتفاصيل مالية كثيرة يجب حفظها`),
      'البند الأخير المهم جداً — كشف رواتب أغسطس',
    ].join('\n');
    ledger.recordRequest(big);
    const block = ledger.render() ?? '';
    expect(block).toContain('بداية القائمة');
    expect(block).toContain('البند الأخير المهم جداً');
    expect(block.length).toBeLessThanOrEqual(LEDGER_MAX_CHARS);
  });

  it('returns null for an empty ledger so short sessions get no filler', () => {
    const ledger = new TaskLedger();
    expect(ledger.render()).toBeNull();
    ledger.recordRequest('سؤال بسيط');
    expect(ledger.render()).not.toBeNull();
    ledger.clear();
    expect(ledger.render()).toBeNull();
  });

  // ── المرحلة 21: جدول المهام ───────────────────────────────────────────────

  it('renders a task table with named failures and skipped dependents', () => {
    // الجلسة 2026-09-14: كنافة فشل والمساعد لم يخبر المستخدم أبداً —
    // الجدول يبقي الفاشل والمُخطّى بأسمائهما في ذاكرة النموذج عبر الدورات.
    const ledger = new TaskLedger();
    ledger.recordRequest(MISSION);
    ledger.recordFromBatchDetail({
      title: 'إضافة المنتجات',
      failedCount: 1,
      skippedCount: 1,
      totalCount: 4,
      items: [
        { toolName: 'inventory.create_product', args: { nameAr: 'شوكلاتة' }, status: 'done' },
        { toolName: 'inventory.create_product', args: { nameAr: 'تمر' }, status: 'done' },
        { toolName: 'inventory.create_product', args: { nameAr: 'كنافة' }, status: 'failed' },
        { toolName: 'sales.create_invoice', args: { customerId: 'x' }, status: 'skipped' },
      ],
    });
    const block = ledger.render() ?? '';
    expect(block).toContain('جدول المهام');
    expect(block).toContain('✓ منجز: 2');
    expect(block).toContain('فاشل (1): كنافة');
    expect(block).toContain('مُخطّى (1)');
    expect(block).toContain('أراد إنشاءه/تصحيحه');
  });

  it('updates (not duplicates) a repeated task entry across batch reruns', () => {
    const ledger = new TaskLedger();
    const items = [{ toolName: 'inventory.create_product', args: { nameAr: 'كنافة' }, status: 'failed' }];
    ledger.recordFromBatchDetail({ title: 'دفعة', items });
    ledger.recordFromBatchDetail({ title: 'دفعة', items });
    const block = ledger.render() ?? '';
    expect(block.split('كنافة').length - 1).toBe(1);
  });

  it('omits the task table when only queued/running items exist (live card covers them)', () => {
    const ledger = new TaskLedger();
    ledger.recordRequest(MISSION);
    ledger.recordFromBatchDetail({
      title: 'دفعة',
      items: [{ toolName: 'inventory.create_product', args: { nameAr: 'شوكلاتة' }, status: 'running' }],
    });
    const block = ledger.render() ?? '';
    expect(block).not.toContain('جدول المهام');
  });
});
