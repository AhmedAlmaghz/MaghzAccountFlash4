import type { ToolDefinition } from '../types';
import { aiApi } from '../api/index';
import { enqueueBatch, getBatch, listBatches } from '../api/batch';
import { summarizeBatchProgress } from '../engine/batchQueue';
import { BATCH_CREATE_CHUNK } from '../api/batchTypes';

/**
 * Batch tools — ONE approval for MANY operations.
 *
 * `ai.enqueue_batch` lets the model group 20–100+ write calls (same type,
 * mixed, or composite with depends_on links) into a single confirmation
 * card. The renderer worker then executes them one by one with per-item
 * RBAC, retry/backoff and skip-downstream semantics; progress survives
 * restarts because all state lives in Postgres (ai_job_batches/items).
 */

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

const BATCH_ITEM_SCHEMA = {
  type: 'object',
  properties: {
    tool: { type: 'string', description: 'اسم الأداة الكتابية (مثل sales.create_invoice)' },
    args: { type: 'object', description: 'وسائط الأداة — نفس وسائط الاستدعاء المفرد' },
    after: {
      description: 'اعتماد على عنصر سابق: رقمه التسلسلي (0-based) أو مرجعه الدلالي ref. يُترك فارغاً للمستقل',
    },
    label: { type: 'string', description: 'شارة عرض بشرية (مثل اتجاه المستند: "معكوس ← مشتريات") — تُعرض في بطاقة الموافقة، لا تُنفَّذ' },
    ref: { type: 'string', description: 'اسم دلالي لهذا العنصر لتشير إليه عناصر لاحقة عبر after' },
  },
  required: ['tool', 'args'],
};

export const batchTools: ToolDefinition[] = [
  {
    name: 'ai.enqueue_batch',
    labelAr: 'إنشاء دفعة عمليات',
    descriptionAr:
      'ينشئ دفعة عمليات مجمّعة تحت موافقة واحدة بدل بطاقة تأكيد لكل عملية — استخدمه لأي طلب يحوي أكثر من 10 عمليات كتابية (إدخال فواتير/سندات/منتجات/عملاء بالجملة، أو عمليات مركبة مرتبطة). رتّب العناصر بحيث يسبق المُعتمَد عليه: المورّد قبل فواتيره، والفاتورة قبل سندها — واربطها عبر after (رقم تسلسلي أو ref دلالي). لتمرير مخرجات عنصر لاحق (معرف المورّد المنشأ مثلاً) استخدم {{ref.id}} أو {{ref.field}} داخل النصوص، أو @ref كقيمة كاملة — تُستبدل تلقائياً من المخرجات المحفوظة، والمرجع المجهول يُفشل العنصر بخطأ واضح. كل المعرفات (عميل/مورد/منتج/خزنة) يجب أن تكون UUID من أدوات البحث — لا تمرر أبداً كلمات حرفية مثل "bank" أو أسماء. كل عنصر يُنفَّذ بنفس صلاحياته وتدقيقه كالاستدعاء المفرد.',
    permission: 'ai.use',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'عنوان الدفعة (يظهر في شريط التقدم)' },
        kind: { type: 'string', description: 'نوع الدفعة: sales_invoice / purchase_invoice / mixed …' },
        items: {
          type: 'array',
          description: `عناصر الدفعة (حتى ${BATCH_CREATE_CHUNK} عنصر)`,
          items: BATCH_ITEM_SCHEMA,
        },
      },
      required: ['items'],
    },
    summarizeArgs: (a) => {
      const items = Array.isArray(a.items) ? a.items as Array<Record<string, unknown>> : [];
      const tools = [...new Set(items.map((i) => String(i.tool || '?')))].slice(0, 3).join('، ');
      const linked = items.filter((i) => i.after !== undefined && i.after !== null).length;
      const linkNote = linked > 0 ? ` — ${linked} مرتبطة` : '';
      const labels = items
        .map((i) => (typeof i.label === 'string' ? i.label.trim() : ''))
        .filter(Boolean)
        .slice(0, 3);
      const labelNote = labels.length > 0 ? ` — ${labels.join('؛ ')}` : '';
      const head = `دفعة ${items.length} عملية (${tools}${items.length > 0 && tools.split('، ').length >= 3 ? '…' : ''})${linkNote}${labelNote}`;
      // Full task preview — the approval card renders argsSummary verbatim
      // and ONE click here consents to every item, so hiding items behind
      // "… و N مهمة أخرى" (old preview cap: 8) made bulk prompt-injection
      // cheap: a crafted attachment could bury hundreds of financial
      // mutations behind a card that mostly said "and 492 more". Show every
      // item up to 60 with its args summary; beyond that sample + count.
      const MAX_PREVIEW = 60;
      const argBit = (it: Record<string, unknown>): string => {
        const inner = (it.args && typeof it.args === 'object' ? it.args : {}) as Record<string, unknown>;
        const bits: string[] = [];
        for (const key of ['name', 'customer', 'supplier', 'product', 'invoiceNumber', 'total', 'amount', 'quantity', 'description', 'title']) {
          const v = inner[key];
          if (v !== undefined && v !== null && String(v).trim()) bits.push(`${key}: ${String(v).slice(0, 30)}`);
        }
        return bits.length > 0 ? ` {${bits.join(', ')}}` : '';
      };
      const shown = items.slice(0, MAX_PREVIEW).map((it, i) => {
        const tool = String(it.tool || '?');
        const label = typeof it.label === 'string' && it.label.trim()
          ? ` — ${it.label.trim().slice(0, 60)}`
          : '';
        const dep = it.after !== undefined && it.after !== null ? ` ← بعد #${typeof it.after === 'number' ? it.after + 1 : it.after}` : '';
        return `${i + 1}. ${tool}${label}${argBit(it)}${dep}`;
      });
      const rest = items.length - shown.length;
      const tail = rest > 0 ? `\n… وعلاوة على ذلك ${rest} مهمة إضافية — اطلب القائمة الكاملة قبل الموافقة إن أردت` : '';
      const warn = items.length > 20 ? `\n⚠️ دفعة كبيرة (${items.length} عملية) برخصة واحدة — راجع كل سطر بعناية قبل الموافقة.` : '';
      return items.length > 0 ? `${head}${warn}\nالمهام:\n${shown.join('\n')}${tail}` : head;
    },
    execute: async (args, ctx) => {
      const rawItems = Array.isArray(args.items) ? args.items as Array<Record<string, unknown>> : [];
      if (rawItems.length === 0) return { error: 'items فارغة — لا توجد عناصر للدفعة' };
      // Hoist stray top-level params into args (the model sometimes emits
      // e.g. customerId as a sibling of args). Liberal at the boundary —
      // tools ignore unknown keys, but a silently DROPPED customerId would
      // create a document without its party. args wins on conflict.
      const KNOWN_ITEM_KEYS = new Set(['tool', 'args', 'after', 'ref', 'label']);
      const items = rawItems.map((it) => {
        const base = (it.args && typeof it.args === 'object' ? it.args : {}) as Record<string, unknown>;
        const stray: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(it)) {
          if (!KNOWN_ITEM_KEYS.has(k) && v !== undefined) stray[k] = v;
        }
        return {
          tool: String(it.tool || ''),
          args: { ...stray, ...base },
          after: (it.after as number | string | undefined) ?? undefined,
          ref: typeof it.ref === 'string' && it.ref.trim() ? it.ref.trim() : undefined,
          label: typeof it.label === 'string' && it.label.trim() ? it.label.trim().slice(0, 200) : undefined,
        };
      });
      const res = await enqueueBatch({
        companyId: ctx.companyId,
        userId: ctx.userId,
        title: str(args.title) || `دفعة ${items.length} عملية`,
        kind: str(args.kind) || 'mixed',
        items,
      });
      if (!res.success || !res.data) return { error: res.error || 'فشل إنشاء الدفعة' };
      return {
        batchId: res.data.batchId,
        total: res.data.total,
        summary: `أُنشئت الدفعة (${res.data.total} عملية) — ستبدأ فور موافقتك، وتستطيع متابعة التقدم لحظة بلحظة`,
        startBatchRun: res.data.batchId,
      };
    },
  },
  {
    name: 'ai.resume_batch',
    labelAr: 'استئناف دفعة متوقفة',
    descriptionAr:
      'يستأنف دفعة متوقفة مؤقتاً أو متعثرة جزئياً (بعد إعادة فتح التطبيق أو إيقاف مؤقت) — يعيد العناصر الفاشلة للطابور ويكمل التنفيذ. استخدم ai.batch_status أولاً لمعرفة الدفعات المتوقفة.',
    permission: 'ai.use',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        batchId: { type: 'string', description: 'معرف الدفعة (من ai.batch_status)' },
      },
      required: ['batchId'],
    },
    summarizeArgs: (a) => `استئناف الدفعة ${String(a.batchId || '').slice(0, 8)}…`,
    execute: async (args, ctx) => {
      const batchId = str(args.batchId);
      if (!batchId) return { error: 'batchId مطلوب — استخدم ai.batch_status لعرض الدفعات' };
      const got = await aiApi.batchGet(ctx.companyId, ctx.userId, batchId);
      if (!got.success || !got.data) return { error: got.error || 'الدفعة غير موجودة' };
      const detail = got.data;
      if (detail.status === 'done') return { error: 'الدفعة مكتملة أصلاً — لا شيء لاستئنافه' };
      if (detail.status === 'cancelled') return { error: 'الدفعة ملغاة — أنشئ دفعة جديدة بدلاً من ذلك' };
      if (detail.failedCount > 0) {
        const retry = await aiApi.batchRetryFailed(ctx.companyId, ctx.userId, batchId);
        if (!retry.success) return { error: retry.error || 'فشل إعادة العناصر الفاشلة' };
      } else if (detail.status === 'paused') {
        const unpause = await aiApi.batchSetStatus(ctx.companyId, ctx.userId, batchId, 'running');
        if (!unpause.success) return { error: unpause.error || 'فشل إلغاء الإيقاف' };
      }
      return {
        batchId,
        summary: `استُؤنفت الدفعة — ${summarizeBatchProgress(detail.doneCount, 0, detail.skippedCount, detail.totalCount)}`,
        startBatchRun: batchId,
      };
    },
  },
  {
    name: 'ai.batch_status',
    labelAr: 'حالة دفعة',
    descriptionAr:
      'يعرض تقدم دفعة (مُنجز/فاشل/مُتخطّى/متبقٍ) مع أول الأخطاء إن وجدت — أو يسرد أحدث الدفعات عند عدم تمرير batchId. استخدمه للإجابة عن "وين وصلت الدفعة؟" ولاحظ أن الفاشل يعرض سببه وإجراءه المقترح.',
    permission: 'ai.use',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        batchId: { type: 'string', description: 'معرف الدفعة (اختياري — بدونه تُسرد أحدث الدفعات)' },
      },
    },
    execute: async (args, ctx) => {
      const batchId = str(args.batchId);
      if (!batchId) {
        const list = await listBatches(undefined, { companyId: ctx.companyId, userId: ctx.userId });
        if (!list.success || !list.data) return { error: list.error || 'فشل جلب الدفعات' };
        if (list.data.length === 0) return { message: 'لا توجد دفعات بعد' };
        return {
          batches: list.data.map((b) => ({
            batchId: b.id,
            title: b.title,
            status: b.status,
            progress: summarizeBatchProgress(b.doneCount, b.failedCount, b.skippedCount, b.totalCount),
          })),
        };
      }
      const got = await getBatch(batchId, { companyId: ctx.companyId, userId: ctx.userId });
      if (!got.success || !got.data) return { error: got.error || 'الدفعة غير موجودة' };
      const d = got.data;
      // Errors as STRINGS (never objects) — the card renderer and the LLM
      // both choke on nested objects ([object Object] blindness, 2026-09-08).
      const errors = d.items
        .filter((i) => i.status === 'failed')
        .slice(0, 5)
        .map((i) => `#${i.seq} ${i.toolName}: ${i.lastError || '؟'}${i.errorCode ? ` (${i.errorCode})` : ''}`);
      return {
        batchId: d.id,
        title: d.title,
        status: d.status,
        progress: summarizeBatchProgress(d.doneCount, d.failedCount, d.skippedCount, d.totalCount),
        errors,
      };
    },
  },
];
