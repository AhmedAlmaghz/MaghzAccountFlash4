import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api/index', () => ({
  aiApi: {
    batchCreate: vi.fn(),
    batchGet: vi.fn(),
    batchRetryFailed: vi.fn(),
    batchSetStatus: vi.fn(),
    batchClear: vi.fn(),
  },
}));

import { aiApi } from '../api/index';
import { batchTools } from './batchTools';
import { registerTool, clearToolRegistry, getTool } from './registry';
import { useAppStore } from '@/core/store';
import { useAuthStore } from '@/modules/auth/store';
import type { User } from '@/modules/auth/types';
import type { ToolContext } from '../types';
import { TaskLedger } from '../engine/taskLedger';

const mockedApi = vi.mocked(aiApi, true);
const ctx: ToolContext = { companyId: 'c1', userId: 'u1' };
const adminUser: User = { id: 'u1', username: 'admin', email: 'a@b.com', role: 'admin', isActive: true };

const enqueue = batchTools.find((t) => t.name === 'ai.enqueue_batch')!;
const resume = batchTools.find((t) => t.name === 'ai.resume_batch')!;
const status = batchTools.find((t) => t.name === 'ai.batch_status')!;
const clear = batchTools.find((t) => t.name === 'ai.clear_queue')!;

describe('batchTools registration', () => {
  it('exposes enqueue / preview / resume / status / clear with summaries and ai.use gate', () => {
    expect(batchTools).toHaveLength(5);
    for (const t of batchTools) {
      expect(t.permission).toBe('ai.use');
      expect(typeof t.summarizeArgs === 'function' || t.dangerLevel === 'read').toBe(true);
    }
    expect(enqueue.dangerLevel).toBe('write');
    expect(resume.dangerLevel).toBe('write');
    expect(status.dangerLevel).toBe('read');
    expect(getTool('ai.enqueue_batch')).toBeUndefined(); // not auto-registered here
  });

  it('directs multi-operation requests (>2 writes) to one-approval batches', () => {
    // User contract: more than two write operations in one chat request must
    // go through ai.enqueue_batch (one approval click), never as scattered
    // single calls. Pinned in both the tool description and prompt rule 38.
    expect(enqueue.descriptionAr).toContain('عمليتين');
  });

  it('enqueue summarizes substance (count + tools + links)', () => {
    const s = enqueue.summarizeArgs!({
      items: [
        { tool: 'sales.create_invoice', args: {} },
        { tool: 'sales.create_invoice', args: {}, after: 0 },
      ],
    });
    expect(s).toMatch(/2/);
    expect(s).toMatch(/sales\.create_invoice/);
    expect(s).toMatch(/مرتبطة/);
  });

  it('enqueue summarizes direction labels on the card', () => {
    const s = enqueue.summarizeArgs!({
      items: [
        { tool: 'purchases.create_invoice', args: {}, label: 'معكوس ← مشتريات' },
        { tool: 'purchases.create_invoice', args: {} },
      ],
    });
    expect(s).toContain('معكوس ← مشتريات');
  });

  it('enqueue lists every task with dependencies (no hidden items ≤60)', () => {
    // Anti-injection contract (Phase 94): one approval consents to every
    // item, so the card must show every item — hiding tasks behind an
    // overflow line let crafted attachments bury financial mutations.
    const items = Array.from({ length: 10 }, (_, i) => ({
      tool: 'sales.create_invoice',
      args: {},
      ...(i > 0 ? { after: 0 } : {}),
    }));
    const s = enqueue.summarizeArgs!({ items });
    expect(s).toContain('المهام:');
    expect(s).toContain('1. sales.create_invoice');
    expect(s).toContain('10. sales.create_invoice');
    expect(s).toContain('← بعد #1');
    expect(s).not.toContain('مهمة أخرى');
    expect(s).not.toContain('مهمة إضافية');
  });

  it('enqueue caps the preview at 60 with an explicit overflow tail', () => {
    const items = Array.from({ length: 65 }, () => ({ tool: 'sales.create_invoice', args: {} }));
    const s = enqueue.summarizeArgs!({ items });
    expect(s).toContain('60. sales.create_invoice');
    expect(s).not.toContain('61. sales.create_invoice');
    expect(s).toContain('5 مهمة إضافية');
    expect(s).toContain('دفعة كبيرة');
  });
});

describe('ai.enqueue_batch execute', () => {
  beforeEach(() => {
    clearToolRegistry();
    vi.clearAllMocks();
    useAppStore.setState({ activeCompany: { id: 'c1', name: 'شركة', currency: 'YER' } });
    useAuthStore.getState().login(adminUser);
    for (const t of batchTools) registerTool(t);
    registerTool({
      name: 'sales.create_invoice',
      labelAr: 'أداة',
      descriptionAr: 'وصف',
      permission: 'sales.create',
      dangerLevel: 'write',
      parameters: { type: 'object', properties: {} },
      execute: async () => ({}),
    });
  });

  it('creates the batch and returns the runner marker', async () => {
    mockedApi.batchCreate.mockResolvedValue({ success: true, data: { batchId: 'b1', total: 1, inserted: 1 } });
    const out = (await enqueue.execute({ items: [{ tool: 'sales.create_invoice', args: { x: 1 } }] }, ctx)) as Record<string, unknown>;
    expect(out.batchId).toBe('b1');
    expect(out.startBatchRun).toBe('b1');
    const payload = mockedApi.batchCreate.mock.calls[0][0];
    expect(payload.companyId).toBe('c1');
    expect(payload.items[0].tool_name).toBe('sales.create_invoice');
  });

  it('rejects unknown tools with an honest error', async () => {
    const out = (await enqueue.execute({ items: [{ tool: 'nope.x', args: {} }] }, ctx)) as Record<string, unknown>;
    expect(out.error).toMatch(/غير معروفة/);
    expect(mockedApi.batchCreate).not.toHaveBeenCalled();
  });

  it('rejects empty items', async () => {
    const out = (await enqueue.execute({ items: [] }, ctx)) as Record<string, unknown>;
    expect(out.error).toBeTruthy();
  });

  it('hoists stray top-level params into args (customerId sibling)', async () => {
    mockedApi.batchCreate.mockResolvedValue({ success: true, data: { batchId: 'b1', total: 1, inserted: 1 } });
    await enqueue.execute({
      items: [{ tool: 'sales.create_invoice', customerId: '{{c.id}}', args: { date: '2026-08-21' } }],
    }, ctx);
    const sent = mockedApi.batchCreate.mock.calls[0][0].items[0];
    expect(sent.args).toEqual({ customerId: '{{c.id}}', date: '2026-08-21' });
  });

  it('normalizes the {name, type, data} item shape (transcript regression)', async () => {
    // Real session 2026-09-10: the model emitted items as
    // {name, type, data} instead of {tool, args} and the batch died with
    // "أداة غير معروفة" although every tool was valid.
    mockedApi.batchCreate.mockResolvedValue({ success: true, data: { batchId: 'b1', total: 1, inserted: 1 } });
    const out = (await enqueue.execute({
      items: [{
        name: 'فاتورة عميل',
        type: 'sales.create_invoice',
        data: { customerId: '11111111-1111-4111-8111-111111111111', total: 50000 },
      }],
    }, ctx)) as Record<string, unknown>;
    expect(out.error).toBeUndefined();
    expect(out.batchId).toBe('b1');
    const sent = mockedApi.batchCreate.mock.calls[0][0].items[0];
    expect(sent.tool_name).toBe('sales.create_invoice');
    expect(sent.args).toEqual({
      name: 'فاتورة عميل',
      customerId: '11111111-1111-4111-8111-111111111111',
      total: 50000,
    });
  });

  it('shows real tool names on the card for the alias shape (no blind ?)', async () => {
    const s = enqueue.summarizeArgs!({
      items: [{ name: 'أرز بسمتي', type: 'sales.create_invoice', data: { total: 50000 } }],
    });
    expect(s).toContain('sales.create_invoice');
    expect(s).not.toContain('?');
  });
});

describe('ai.resume_batch execute', () => {
  beforeEach(() => {
    clearToolRegistry();
    vi.clearAllMocks();
    useAuthStore.getState().login(adminUser);
    for (const t of batchTools) registerTool(t);
  });

  it('refuses completed and cancelled batches honestly', async () => {
    mockedApi.batchGet.mockResolvedValue({ success: true, data: { status: 'done' } as never });
    expect(((await resume.execute({ batchId: 'b1' }, ctx)) as Record<string, unknown>).error).toMatch(/مكتملة/);
    mockedApi.batchGet.mockResolvedValue({ success: true, data: { status: 'cancelled' } as never });
    expect(((await resume.execute({ batchId: 'b1' }, ctx)) as Record<string, unknown>).error).toMatch(/ملغاة/);
  });

  it('retries failed items then marks the runner to start', async () => {
    mockedApi.batchGet.mockResolvedValue({
      success: true,
      data: { status: 'partial', doneCount: 3, failedCount: 2, skippedCount: 0, totalCount: 5 } as never,
    });
    mockedApi.batchRetryFailed.mockResolvedValue({ success: true, data: { requeued: 2 } });
    const out = (await resume.execute({ batchId: 'b1' }, ctx)) as Record<string, unknown>;
    expect(mockedApi.batchRetryFailed).toHaveBeenCalledWith('c1', 'u1', 'b1');
    expect(out.startBatchRun).toBe('b1');
  });

  it('refuses resume when every failure is permanent (no futile requeue)', async () => {
    mockedApi.batchGet.mockResolvedValue({
      success: true,
      data: {
        status: 'partial', doneCount: 3, failedCount: 1, skippedCount: 1, totalCount: 5,
        items: [
          { seq: 3, toolName: 'sales.create_invoice', status: 'failed', lastError: 'مرجع غير متوفر (sup)', errorCode: 'UNRESOLVED_REF' },
        ],
      } as never,
    });
    const out = (await resume.execute({ batchId: 'b1' }, ctx)) as Record<string, unknown>;
    expect(mockedApi.batchRetryFailed).not.toHaveBeenCalled();
    expect(out.startBatchRun).toBeUndefined();
    expect(out.resumed).toBe(false);
    expect(String(out.message)).toContain('تعذّر الاستئناف التلقائي');
  });

  it('still resumes when at least one failure is transient', async () => {
    mockedApi.batchGet.mockResolvedValue({
      success: true,
      data: {
        status: 'partial', doneCount: 3, failedCount: 2, skippedCount: 0, totalCount: 5,
        items: [
          { seq: 3, toolName: 'sales.create_invoice', status: 'failed', lastError: 'مرجع غير متوفر (sup)', errorCode: 'UNRESOLVED_REF' },
          { seq: 4, toolName: 'sales.create_invoice', status: 'failed', lastError: 'connection reset', errorCode: 'DB_ERROR' },
        ],
      } as never,
    });
    mockedApi.batchRetryFailed.mockResolvedValue({ success: true, data: { requeued: 2 } });
    const out = (await resume.execute({ batchId: 'b1' }, ctx)) as Record<string, unknown>;
    expect(mockedApi.batchRetryFailed).toHaveBeenCalledWith('c1', 'u1', 'b1');
    expect(out.startBatchRun).toBe('b1');
  });
});

describe('ai.batch_status execute', () => {
  beforeEach(() => {
    clearToolRegistry();
    vi.clearAllMocks();
    useAppStore.setState({ activeCompany: { id: 'c1', name: 'شركة', currency: 'YER' } });
    useAuthStore.getState().login(adminUser);
    for (const t of batchTools) registerTool(t);
  });

  it('reports progress plus top errors', async () => {
    mockedApi.batchGet.mockResolvedValue({
      success: true,
      data: {
        id: 'b1',
        title: 'دفعة',
        status: 'partial',
        doneCount: 8,
        failedCount: 2,
        skippedCount: 0,
        totalCount: 10,
        items: [
          { seq: 3, toolName: 'sales.create_invoice', status: 'failed', lastError: 'عميل مفقود', errorCode: 'NOT_FOUND' },
        ],
      } as never,
    });
    const out = (await status.execute({ batchId: 'b1' }, ctx)) as Record<string, unknown>;
    expect(String(out.progress)).toMatch(/أُنجز 8/);
    expect(JSON.stringify(out.errors)).toMatch(/عميل مفقود/);
  });
});

describe('ai.enqueue_batch session duplicate guard', () => {
  // سجل حقيقي (وليس mock) — نفس التطبيع الذي سيحمي الجلسات الفعلية.
  const ledger = new TaskLedger();
  ledger.registerEntities([{ tool: 'purchases.create_supplier', name: 'الشجاع للتجارة' }]);
  const ledgerCtx: ToolContext = { companyId: 'c1', userId: 'u1', ledger };

  beforeEach(() => {
    clearToolRegistry();
    vi.clearAllMocks();
    useAppStore.setState({ activeCompany: { id: 'c1', name: 'شركة', currency: 'YER' } });
    useAuthStore.getState().login(adminUser);
    for (const t of batchTools) registerTool(t);
    for (const name of ['purchases.create_supplier', 'sales.create_invoice']) {
      registerTool({
        name,
        labelAr: 'أداة',
        descriptionAr: 'وصف',
        permission: 'core.view',
        dangerLevel: 'write',
        parameters: { type: 'object', properties: {} },
        execute: async () => ({}),
      });
    }
  });

  it('drops re-creation of a session-created supplier and discloses the skip', async () => {
    // الجلسة الحقيقية 2026-09-14: دفعة كاملة أعادت إنشاء موردين وعملاء
    // مُنشأين — أرصدة افتتاحية مضاعفة وصفان لكل كيان في البحث.
    mockedApi.batchCreate.mockResolvedValue({ success: true, data: { batchId: 'b1', total: 1, inserted: 1 } });
    const out = (await enqueue.execute({
      items: [
        { tool: 'purchases.create_supplier', args: { name: 'الشجاع للتجارة' } },
        { tool: 'purchases.create_supplier', args: { name: 'مورد جديد' } },
      ],
    }, ledgerCtx)) as Record<string, unknown>;
    expect(out.batchId).toBe('b1');
    const sent = mockedApi.batchCreate.mock.calls[0][0].items;
    expect(sent).toHaveLength(1);
    expect(sent[0].args.name).toBe('مورد جديد');
    expect(out.skippedDuplicates).toEqual([
      { name: 'الشجاع للتجارة', existing: 'الشجاع للتجارة', reason: 'أُنشئ سابقاً في هذه الجلسة' },
    ]);
    expect(String(out.summary)).toContain('أُسقط 1');
    expect(String(out.summary)).toContain('الشجاع للتجارة');
  });

  it('matches normalized names (double space + taa marbuta) — no silent duplicates', async () => {
    mockedApi.batchCreate.mockResolvedValue({ success: true, data: { batchId: 'b1', total: 0, inserted: 0 } });
    const out = (await enqueue.execute({
      items: [{ tool: 'purchases.create_supplier', args: { name: 'الشجاع  للتجاره' } }],
    }, ledgerCtx)) as Record<string, unknown>;
    expect(mockedApi.batchCreate).not.toHaveBeenCalled();
    expect(String(out.error)).toContain('أُنشئت سابقاً في هذه الجلسة');
  });

  it('drops intra-batch identical-name creates (different args escape the idempotency key)', async () => {
    mockedApi.batchCreate.mockResolvedValue({ success: true, data: { batchId: 'b1', total: 1, inserted: 1 } });
    const out = (await enqueue.execute({
      items: [
        { tool: 'purchases.create_supplier', args: { name: 'الحمداني', phone: '1' } },
        { tool: 'purchases.create_supplier', args: { name: 'الحمداني', phone: '2' } },
      ],
    }, ledgerCtx)) as Record<string, unknown>;
    const sent = mockedApi.batchCreate.mock.calls[0][0].items;
    expect(sent).toHaveLength(1);
    expect(out.skippedDuplicates).toEqual([
      { name: 'الحمداني', existing: 'الحمداني', reason: 'مكرر داخل الدفعة نفسها' },
    ]);
  });

  it('cascades the drop to dependents and renumbers numeric after refs', async () => {
    mockedApi.batchCreate.mockResolvedValue({ success: true, data: { batchId: 'b1', total: 2, inserted: 2 } });
    const out = (await enqueue.execute({
      items: [
        { tool: 'purchases.create_supplier', args: { name: 'الشجاع للتجارة' }, ref: 'sup1' }, // مكرر ← إسقاط
        { tool: 'purchases.create_supplier', args: { name: 'الحمادي' } },                     // يبقى — تسلسل 0
        { tool: 'sales.create_invoice', args: { supplierId: '{{sup1.id}}' } },                // تابع ← إسقاط
        { tool: 'sales.create_invoice', args: { total: 5 }, after: 1 },                       // بعد ← يُرقَّم 0
      ],
    }, ledgerCtx)) as Record<string, unknown>;
    const sent = mockedApi.batchCreate.mock.calls[0][0].items;
    expect(sent).toHaveLength(2);
    expect(sent[0].args.name).toBe('الحمادي');
    expect(sent[1].after_seq).toBe(0);
    expect(String(JSON.stringify(out.skippedDuplicates))).toContain('تابع لعنصر مُسقَط');
  });

  it('leaves batches untouched when the context has no ledger (backward compatible)', async () => {
    // بلا سجل جلسة: السلوك القائم — args مختلفة تعني مفتاح idempotency مختلف
    // فيهبطان الاثنان إلى الطابور (حارس الاسم الجلسي هو الجديد فقط).
    mockedApi.batchCreate.mockResolvedValue({ success: true, data: { batchId: 'b1', total: 2, inserted: 2 } });
    const out = (await enqueue.execute({
      items: [
        { tool: 'purchases.create_supplier', args: { name: 'الشجاع للتجارة', phone: '1' } },
        { tool: 'purchases.create_supplier', args: { name: 'الشجاع للتجارة', phone: '2' } },
      ],
    }, ctx)) as Record<string, unknown>;
    expect(mockedApi.batchCreate.mock.calls[0][0].items).toHaveLength(2);
    expect(out.skippedDuplicates).toBeUndefined();
  });

  it('ignores document tools — invoice repeats are legitimate daily work', async () => {
    mockedApi.batchCreate.mockResolvedValue({ success: true, data: { batchId: 'b1', total: 2, inserted: 2 } });
    const out = (await enqueue.execute({
      items: [
        { tool: 'sales.create_invoice', args: { customerId: '11111111-1111-4111-8111-111111111111', total: 100 } },
        { tool: 'sales.create_invoice', args: { customerId: '11111111-1111-4111-8111-111111111111', total: 200 } },
      ],
    }, ledgerCtx)) as Record<string, unknown>;
    expect(mockedApi.batchCreate.mock.calls[0][0].items).toHaveLength(2);
    expect(out.skippedDuplicates).toBeUndefined();
  });
});

describe('ai.enqueue_batch pre-flight validation', () => {
  beforeEach(() => {
    clearToolRegistry();
    vi.clearAllMocks();
    useAppStore.setState({ activeCompany: { id: 'c1', name: 'شركة', currency: 'YER' } });
    useAuthStore.getState().login(adminUser);
    for (const t of batchTools) registerTool(t);
    for (const name of ['purchases.create_supplier', 'sales.create_invoice']) {
      registerTool({
        name,
        labelAr: 'أداة',
        descriptionAr: 'وصف',
        permission: 'core.view',
        dangerLevel: 'write',
        parameters: { type: 'object', properties: {} },
        execute: async () => ({}),
      });
    }
  });

  it('sanitizes a malformed tool name carrying JSON garbage (2026-09-14 session)', async () => {
    // "inventory.create_product},{args:{costPrice:10000,..." — العنصر مات
    // بأداة غير معروفة. الآن الاسم يُعقَّم والأخطاء القاتلة تكشف قبل الموافقة.
    mockedApi.batchCreate.mockResolvedValue({ success: true, data: { batchId: 'b1', total: 1, inserted: 1 } });
    const out = (await enqueue.execute({
      items: [{
        tool: 'purchases.create_supplier},{args:{costPrice:10000,nameAr:',
        args: { name: 'مورد جديد' },
      }],
    }, ctx)) as Record<string, unknown>;
    expect(out.error).toBeUndefined();
    const sent = mockedApi.batchCreate.mock.calls[0][0].items[0];
    expect(sent.tool_name).toBe('purchases.create_supplier');
  });

  it('rejects a non-UUID customerId BEFORE approval (no missing-id batch)', async () => {
    // فاتورتا المبيعات فشلتا MISSING_ID بعد موافقة المستخدم — الآن يموت
    // الفحص المسبق قبل الموافقة وليس بعد التنفيذ.
    const out = (await enqueue.execute({
      items: [{ tool: 'sales.create_invoice', args: { customerId: 'مؤسسة غدرة التجارية', total: 50000 } }],
    }, ctx)) as Record<string, unknown>;
    expect(mockedApi.batchCreate).not.toHaveBeenCalled();
    expect(String(out.error)).toContain('ليس UUID صالحاً');
    expect(String(out.error)).toContain('أدوات البحث');
  });

  it('skips {{ref}} placeholders (resolved at run time, not enqueue time)', async () => {
    mockedApi.batchCreate.mockResolvedValue({ success: true, data: { batchId: 'b1', total: 1, inserted: 1 } });
    const out = (await enqueue.execute({
      items: [{ tool: 'sales.create_invoice', args: { customerId: '{{sup1.id}}', total: 100 } }],
    }, ctx)) as Record<string, unknown>;
    expect(out.error).toBeUndefined();
    expect(out.batchId).toBe('b1');
  });

  it('reports every invalid item with its index and problem', async () => {
    const out = (await enqueue.execute({
      items: [
        { tool: 'sales.create_invoice', args: {} },
        { tool: 'sales.create_invoice', args: { customerId: 'not-a-uuid' } },
      ],
    }, ctx)) as Record<string, unknown>;
    expect(mockedApi.batchCreate).not.toHaveBeenCalled();
    const invalids = out.invalidItems as Array<{ index: number; problem: string }>;
    expect(invalids).toHaveLength(2);
    expect(invalids[0].index).toBe(0);
    expect(invalids[1].index).toBe(1);
    expect(String(out.error)).toContain('العنصر 1');
    expect(String(out.error)).toContain('العنصر 2');
  });
});

describe('ai.preview_batch (dry run)', () => {
  const preview = batchTools.find((t) => t.name === 'ai.preview_batch')!;
  const UUID = '11111111-1111-4111-8111-111111111111';
  const UUID2 = '22222222-2222-4222-8222-222222222222';

  beforeEach(() => {
    clearToolRegistry();
    vi.clearAllMocks();
    useAuthStore.getState().login(adminUser);
    for (const t of batchTools) registerTool(t);
    registerTool({
      name: 'sales.create_invoice',
      labelAr: 'أداة',
      descriptionAr: 'وصف',
      permission: 'sales.create',
      dangerLevel: 'write',
      parameters: { type: 'object', properties: {} },
      execute: async () => ({}),
    });
    registerTool({
      name: 'purchases.create_supplier',
      labelAr: 'أداة',
      descriptionAr: 'وصف',
      permission: 'purchases.create',
      dangerLevel: 'write',
      parameters: { type: 'object', properties: {} },
      execute: async () => ({}),
    });
  });

  it('is a read tool with ai.use gate (no confirmation card of its own)', () => {
    expect(preview.dangerLevel).toBe('read');
    expect(preview.permission).toBe('ai.use');
  });

  it('returns a ready numbered plan for valid items (creates nothing)', async () => {
    // NOTE: the two items carry distinct args — identical tool+args collapse
    // by idempotency key (correct engine behavior, not a preview bug).
    const out = (await preview.execute({
      items: [
        { tool: 'sales.create_invoice', args: { customerId: UUID }, ref: 'inv1' },
        { tool: 'sales.create_invoice', args: { customerId: UUID2 }, after: 'inv1' },
      ],
    }, ctx)) as Record<string, unknown>;
    expect(out.verdict).toBe('ready');
    expect(out.total).toBe(2);
    expect(out.effective).toBe(2);
    const plan = out.plan as Array<{ seq: number; tool: string; after?: number }>;
    expect(plan.map((p) => p.seq)).toEqual([1, 2]);
    expect(plan[1].after).toBe(1);
    expect(mockedApi.batchCreate).not.toHaveBeenCalled();
  });

  it('flags unknown tools without creating', async () => {
    const out = (await preview.execute({
      items: [{ tool: 'nope.x', args: { a: 1 } }],
    }, ctx)) as Record<string, unknown>;
    expect(out.verdict).toBe('fix-first');
    expect(String(JSON.stringify(out.problems))).toContain('غير معروفة');
    expect(mockedApi.batchCreate).not.toHaveBeenCalled();
  });

  it('flags non-UUID reference fields like the real preflight', async () => {
    const out = (await preview.execute({
      items: [{ tool: 'sales.create_invoice', args: { customerId: 'bank' } }],
    }, ctx)) as Record<string, unknown>;
    expect(out.verdict).toBe('fix-first');
    expect(String(JSON.stringify(out.problems))).toContain('customerId');
  });

  it('flags forward references (DAG violation)', async () => {
    const out = (await preview.execute({
      items: [
        { tool: 'sales.create_invoice', args: { customerId: UUID }, after: 1 },
        { tool: 'sales.create_invoice', args: { customerId: UUID } },
      ],
    }, ctx)) as Record<string, unknown>;
    expect(out.verdict).toBe('fix-first');
    expect(String(JSON.stringify(out.problems))).toContain('سابق فقط');
  });

  it('refuses items outside the caller permissions (RBAC pre-check)', async () => {
    useAuthStore.getState().logout();
    useAuthStore.getState().login({ ...adminUser, role: 'viewer' } as never);
    const out = (await preview.execute({
      items: [{ tool: 'sales.create_invoice', args: { customerId: UUID } }],
    }, ctx)) as Record<string, unknown>;
    expect(out.verdict).toBe('fix-first');
    expect(String(JSON.stringify(out.problems))).toContain('صلاحياتك');
  });

  it('previews session duplicates instead of executing them', async () => {
    const ledger = new TaskLedger();
    ledger.registerEntities([{ tool: 'purchases.create_supplier', name: 'مورد مكرر' }]);
    const dupCtx: ToolContext = { ...ctx, ledger };
    const out = (await preview.execute({
      items: [{ tool: 'purchases.create_supplier', args: { name: 'مورد مكرر' } }],
    }, dupCtx)) as Record<string, unknown>;
    expect(out.effective).toBe(0);
    expect((out.skippedDuplicates as unknown[]).length).toBe(1);
    expect(out.verdict).toBe('fix-first');
    expect(String(JSON.stringify(out.problems))).toContain('أُنشئت سابقاً');
    expect(mockedApi.batchCreate).not.toHaveBeenCalled();
  });

  it('tolerates the {name, type, data} alias shape in preview too', async () => {
    const out = (await preview.execute({
      items: [{ name: 'فاتورة', type: 'sales.create_invoice', data: { customerId: UUID } }],
    }, ctx)) as Record<string, unknown>;
    expect(out.verdict).toBe('ready');
    const plan = out.plan as Array<{ tool: string }>;
    expect(plan[0].tool).toBe('sales.create_invoice');
  });
});

describe('ai.enqueue_batch dependency auto-order (session 2026-09-24)', () => {
  // The model rarely links with `after` — a voucher before the capital
  // entry dies "insufficient balance". Layers (entities ← documents ←
  // postings/vouchers) apply automatically as a safety net.
  const UUID = '11111111-1111-4111-8111-111111111111';

  beforeEach(() => {
    clearToolRegistry();
    vi.clearAllMocks();
    useAppStore.setState({ activeCompany: { id: 'c1', name: 'شركة', currency: 'YER' } });
    useAuthStore.getState().login(adminUser);
    for (const t of batchTools) registerTool(t);
    for (const name of [
      'sales.create_customer', 'sales.create_invoice', 'sales.post_invoice',
      'accounting.create_receipt_voucher',
    ]) {
      registerTool({
        name,
        labelAr: 'أداة',
        descriptionAr: 'وصف',
        permission: 'sales.create',
        dangerLevel: 'write',
        parameters: { type: 'object', properties: {} },
        execute: async () => ({}),
      });
    }
  });

  it('executes entities before documents before postings/vouchers', async () => {
    mockedApi.batchCreate.mockResolvedValue({ success: true, data: { batchId: 'b1', total: 3, inserted: 3 } });
    const out = (await enqueue.execute({
      items: [
        { tool: 'accounting.create_receipt_voucher', args: { customerId: UUID, amount: 100 } },
        { tool: 'sales.post_invoice', args: { invoiceId: UUID } },
        { tool: 'sales.create_customer', args: { name: 'عميل جديد' } },
      ],
    }, ctx)) as Record<string, unknown>;
    expect(out.batchId).toBe('b1');
    const sent = mockedApi.batchCreate.mock.calls[0][0].items;
    expect(sent.map((s: { tool_name: string }) => s.tool_name)).toEqual([
      'sales.create_customer',
      'accounting.create_receipt_voucher',
      'sales.post_invoice',
    ]);
  });

  it('keeps stable order within one layer and remaps numeric after', async () => {
    mockedApi.batchCreate.mockResolvedValue({ success: true, data: { batchId: 'b1', total: 3, inserted: 3 } });
    const out = (await enqueue.execute({
      items: [
        { tool: 'sales.create_invoice', args: { customerId: UUID } },
        { tool: 'sales.create_customer', args: { name: 'ع' } },
        { tool: 'sales.post_invoice', args: { invoiceId: UUID }, after: 0 },
      ],
    }, ctx)) as Record<string, unknown>;
    expect(out.batchId).toBe('b1');
    const sent = mockedApi.batchCreate.mock.calls[0][0].items;
    // customer (layer 0) first, then invoice, then post — after remapped to the invoice's new seq
    expect(sent.map((s: { tool_name: string }) => s.tool_name)).toEqual([
      'sales.create_customer',
      'sales.create_invoice',
      'sales.post_invoice',
    ]);
    expect(sent[2].after_seq).toBe(1);
  });

  it('approval card shows execution order with a reorder note', () => {
    const s = enqueue.summarizeArgs!({
      items: [
        { tool: 'sales.post_invoice', args: { invoiceId: UUID } },
        { tool: 'sales.create_customer', args: { name: 'ع' } },
      ],
    });
    // Head line lists tools in send order — the task list below follows
    // execution order (entities first).
    const tasks = s.split('المهام:')[1] ?? '';
    const customerPos = tasks.indexOf('sales.create_customer');
    const postPos = tasks.indexOf('sales.post_invoice');
    expect(customerPos).toBeGreaterThan(-1);
    expect(postPos).toBeGreaterThan(-1);
    expect(customerPos).toBeLessThan(postPos);
    expect(s).toContain('رُتبت تلقائياً');
  });
});

describe('ai.enqueue_batch nested-line preflight (session 2026-09-24)', () => {
  // Five consecutive batches died post-approval with "productId مطلوب" /
  // "materialId" because the preflight saw only top-level args while the
  // literal names hid inside lines[]. The check now descends one level.
  const UUID = '11111111-1111-4111-8111-111111111111';

  beforeEach(() => {
    clearToolRegistry();
    vi.clearAllMocks();
    useAppStore.setState({ activeCompany: { id: 'c1', name: 'شركة', currency: 'YER' } });
    useAuthStore.getState().login(adminUser);
    for (const t of batchTools) registerTool(t);
    registerTool({
      name: 'manufacturing.create_bom',
      labelAr: 'أداة',
      descriptionAr: 'وصف',
      permission: 'manufacturing.create',
      dangerLevel: 'write',
      parameters: { type: 'object', properties: {} },
      execute: async () => ({}),
    });
  });

  it('rejects literal names inside lines[] BEFORE approval', async () => {
    const out = (await enqueue.execute({
      items: [{
        tool: 'manufacturing.create_bom',
        args: { productId: UUID, lines: [{ materialId: 'شوكلاتة خام', quantity: 6 }] },
      }],
    }, ctx)) as Record<string, unknown>;
    expect(mockedApi.batchCreate).not.toHaveBeenCalled();
    expect(String(out.error)).toContain('سطر 1');
    expect(String(out.error)).toContain('materialId');
    expect(String(out.error)).toContain('أدوات البحث');
  });

  it('passes UUIDs inside lines[] and skips {{ref}} placeholders', async () => {
    mockedApi.batchCreate.mockResolvedValue({ success: true, data: { batchId: 'b1', total: 1, inserted: 1 } });
    const out = (await enqueue.execute({
      items: [{
        tool: 'manufacturing.create_bom',
        args: { productId: UUID, lines: [{ materialId: '{{mat1.id}}', quantity: 6 }] },
      }],
    }, ctx)) as Record<string, unknown>;
    expect(out.error).toBeUndefined();
    expect(out.batchId).toBe('b1');
  });
});

describe('ai.enqueue_batch cross-batch document guard (session 2026-09-24)', () => {
  // Same invoices were created twice in two different batches
  // (INV-000001/INV-000003, PINV-0001/PINV-0004) because idempotency was
  // per-batch only. Completed item keys now persist in the session ledger.
  const UUID = '11111111-1111-4111-8111-111111111111';
  const UUID2 = '22222222-2222-4222-8222-222222222222';

  beforeEach(() => {
    clearToolRegistry();
    vi.clearAllMocks();
    useAppStore.setState({ activeCompany: { id: 'c1', name: 'شركة', currency: 'YER' } });
    useAuthStore.getState().login(adminUser);
    for (const t of batchTools) registerTool(t);
    registerTool({
      name: 'sales.create_invoice',
      labelAr: 'أداة',
      descriptionAr: 'وصف',
      permission: 'sales.create',
      dangerLevel: 'write',
      parameters: { type: 'object', properties: {} },
      execute: async () => ({}),
    });
  });

  it('drops a verbatim re-enqueue of a completed document with disclosure', async () => {
    const { buildIdempotencyKey } = await import('../engine/batchQueue');
    const args = { customerId: UUID, total: 198000 };
    const ledger = new TaskLedger();
    ledger.registerCompletedKeys([buildIdempotencyKey('sales.create_invoice', args)]);
    const dupCtx: ToolContext = { companyId: 'c1', userId: 'u1', ledger };
    mockedApi.batchCreate.mockResolvedValue({ success: true, data: { batchId: 'b2', total: 1, inserted: 1 } });
    const out = (await enqueue.execute({
      items: [
        { tool: 'sales.create_invoice', args },
        { tool: 'sales.create_invoice', args: { customerId: UUID2, total: 100 } },
      ],
    }, dupCtx)) as Record<string, unknown>;
    expect(out.batchId).toBe('b2');
    const sent = mockedApi.batchCreate.mock.calls[0][0].items;
    expect(sent).toHaveLength(1);
    expect(out.skippedDuplicates).toEqual([
      { name: 'sales.create_invoice', existing: 'sales.create_invoice', reason: 'نُفّذ بنفس البيانات سابقاً في هذه الجلسة' },
    ]);
  });

  it('keeps working when the ledger lacks the new method (old fakes)', async () => {
    // hasCompletedKey is optional on ToolLedgerView — legacy fakes exposing
    // only findDuplicateName must not crash the guard.
    const legacyLedger = { findDuplicateName: () => null };
    const legacyCtx: ToolContext = { companyId: 'c1', userId: 'u1', ledger: legacyLedger };
    mockedApi.batchCreate.mockResolvedValue({ success: true, data: { batchId: 'b1', total: 1, inserted: 1 } });
    const out = (await enqueue.execute({
      items: [{ tool: 'sales.create_invoice', args: { customerId: UUID, total: 5 } }],
    }, legacyCtx)) as Record<string, unknown>;
    expect(out.batchId).toBe('b1');
  });
});

describe('ai.clear_queue execute', () => {
  beforeEach(() => {
    clearToolRegistry();
    vi.clearAllMocks();
    useAppStore.setState({ activeCompany: { id: 'c1', name: 'شركة', currency: 'YER' } });
    useAuthStore.getState().login(adminUser);
    for (const t of batchTools) registerTool(t);
  });

  it('is a write tool with a substance summary (confirmation card)', () => {
    expect(clear.dangerLevel).toBe('write');
    expect(clear.permission).toBe('ai.use');
    expect(String(clear.summarizeArgs!({}))).toContain('تصفير');
  });

  it('reports cancelled / parked / closed counts honestly', async () => {
    mockedApi.batchClear.mockResolvedValue({
      success: true, data: { cancelled: 2, skipped: 5, cleared: 1 },
    });
    const out = (await clear.execute({}, ctx)) as Record<string, unknown>;
    expect(mockedApi.batchClear).toHaveBeenCalledWith('c1', 'u1');
    expect(out.cleared).toBe(true);
    expect(out.cancelled).toBe(2);
    expect(out.skipped).toBe(5);
    expect(out.clearedPartials).toBe(1);
    expect(String(out.summary)).toContain('2');
    expect(String(out.summary)).toContain('5');
  });

  it('says the queue was already empty when nothing was cleared', async () => {
    mockedApi.batchClear.mockResolvedValue({
      success: true, data: { cancelled: 0, skipped: 0, cleared: 0 },
    });
    const out = (await clear.execute({}, ctx)) as Record<string, unknown>;
    expect(out.cleared).toBe(true);
    expect(String(out.summary)).toContain('فارغ');
  });

  it('surfaces transport failures as errors (no silent no-op)', async () => {
    mockedApi.batchClear.mockResolvedValue({ success: false, error: 'gone' });
    const out = (await clear.execute({}, ctx)) as Record<string, unknown>;
    expect(String(out.error)).toContain('gone');
  });
});
