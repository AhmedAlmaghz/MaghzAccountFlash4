import type { ToolDefinition, ToolLedgerView } from '../types';
import { aiApi } from '../api/index';
import { enqueueBatch, getBatch, listBatches } from '../api/batch';
import { planBatchResume, summarizeBatchProgress } from '../engine/batchQueue';
import { BATCH_CREATE_CHUNK } from '../api/batchTypes';
import { isBatchActive } from '../engine/batchRunner';
import { getTool } from './registry';
import { extractLedgerEntity, normalizeEntityName } from '../engine/taskLedger';

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

/** هل تشير وسائط العنصر إلى مرجع عنصر مُسقَط؟ ({{ref}} / {{ref.field}} / @ref) */
function argsReferenceRef(value: unknown, ref: string): boolean {
  if (typeof value === 'string') {
    return value === `@${ref}` || value.includes(`{{${ref}}}`) || value.includes(`{{${ref}.`);
  }
  if (Array.isArray(value)) return value.some((v) => argsReferenceRef(v, ref));
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some((v) => argsReferenceRef(v, ref));
  }
  return false;
}

/**
 * تعقيم اسم أداة العنصر: الجلسة 2026-09-14 سجلت عنصراً باسم يحوي JSON
 * مشوهاً ("inventory.create_product},{args:{costPrice:10000,...") فمات
 * العنصر بأداة غير معروفة. اقتطاع كل ما بعد أول فاصل JSON يعيد اسم الأداة
 * الحقيقي غالباً — والعنصر يفشل لاحقاً بفحص واضح إن كانت الوسائط مفقودة
 * فعلاً بدل رسالة "أداة غير معروفة" غامضة.
 */
function sanitizeBatchToolName(raw: string): string {
  if (!raw) return raw;
  const cut = raw.split(/[{}[\]]/)[0];
  return cut.trim() || raw.trim();
}

/** الحقول المرجعية الشائعة التي يجب أن تكون UUID حقيقية (قاعدة 42). */
const ID_FIELDS = [
  'customerId', 'supplierId', 'productId', 'warehouseId', 'fromWarehouseId',
  'toWarehouseId', 'cashBoxId', 'employeeId', 'accountId', 'unitId',
  'baseUnitId', 'productTypeId', 'categoryId', 'departmentId', 'leadId',
  'opportunityId', 'workOrderId', 'bomId', 'bomProductId', 'shiftId', 'payrollRunId',
  'openingStockWarehouseId',
] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PreflightProblem {
  index: number;
  problem: string;
}

/**
 * فحص مسبق لعناصر الدفعة قبل الإرسال — الأخطاء القاتلة (حقل مرجعي ليس
 * UUID، وسائط فارغة) تكشف هنا بإفصاح لكل عنصر بدل أن تكشف بعد موافقة
 * المستخدم وقت التنفيذ (MISSING_ID بعد الموافقة = "عمليات ناقصة" وافق
 * عليها المستخدم دون علمه). المراجع {{ref}} و@ref تُتخطى — تُحل وقت التشغيل.
 */
function preflightValidateItems(items: NormalizedBatchItem[]): PreflightProblem[] {
  const problems: PreflightProblem[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it.tool) {
      problems.push({ index: i, problem: 'اسم الأداة فارغ — كل عنصر يحتاج {tool, args}' });
      continue;
    }
    // أدوات غير معروفة: الفحص المسبق يخص الأدوات المعروفة — الأداة المجهولة
    // تحافظ على مسارها الحالي (رفض "أداة غير معروفة" من enqueueBatch).
    if (!getTool(it.tool)) continue;
    const argKeys = Object.keys(it.args);
    if (argKeys.length === 0) {
      problems.push({ index: i, problem: `الوسائط args فارغة لـ ${it.tool} — أعد إرسال العنصر بصيغة صحيحة` });
      continue;
    }
    for (const field of ID_FIELDS) {
      const v = it.args[field];
      if (v === undefined || v === null) continue;
      if (typeof v !== 'string') continue;
      if (v.includes('{{') || v.startsWith('@')) continue; // مرجع يُحل وقت التشغيل
      if (!UUID_RE.test(v.trim())) {
        problems.push({
          index: i,
          problem: `الحقل ${field} في ${it.tool} ليس UUID صالحاً ("${v.slice(0, 40)}") — استخدم معرفاً من أدوات البحث (search.*) ولا تمرر أسماء أو أكواداً حرفية`,
        });
      }
    }
  }
  return problems;
}

interface NormalizedBatchItem {
  tool: string;
  args: Record<string, unknown>;
  after?: number | string;
  ref?: string;
  label?: string;
}

/**
 * حارس التكرار الجلسي: يُسقط عناصر إعادة إنشاء كيان أُنشئ سابقاً في نفس
 * الجلسة (من سجل المهمة) أو مرتين داخل الدفعة نفسها — والتابعون لها يُسقطون
 * تتابعياً (مرجعهم لم يعد يُنشأ). يعيد العناصر الفعّالة بعد إعادة ترقيم
 * after الرقمية، مع قائمة الإفصاح.
 * الجلسة الحقيقية 2026-09-14: نسيان المهمة أدى إلى دفعة أعادت إنشاء 5 كيانات
 * (موردين وعملاء) مكررين — الأرصدة الافتتاحية تضاعفت والبحث أعاد صفين لكل كيان.
 */
function filterSessionDuplicates(
  items: NormalizedBatchItem[],
  ledger: ToolLedgerView | null,
): { effective: NormalizedBatchItem[]; skippedDuplicates: Array<{ name: string; existing: string; reason: string }> } {
  const skippedDuplicates: Array<{ name: string; existing: string; reason: string }> = [];
  if (!ledger || items.length === 0) return { effective: items, skippedDuplicates };

  const droppedIdx = new Set<number>();
  const droppedRefs = new Set<string>();
  const seenInBatch = new Map<string, string>(); // normName → أول ظهور

  for (let i = 0; i < items.length; i++) {
    const entity = extractLedgerEntity(items[i]);
    if (!entity) continue;
    const norm = normalizeEntityName(entity.name);
    if (!norm) continue;
    const sessionDup = ledger.findDuplicateName(entity.name);
    if (sessionDup) {
      droppedIdx.add(i);
      if (items[i].ref) droppedRefs.add(items[i].ref as string);
      skippedDuplicates.push({ name: entity.name, existing: sessionDup.display, reason: 'أُنشئ سابقاً في هذه الجلسة' });
      continue;
    }
    if (seenInBatch.has(norm)) {
      droppedIdx.add(i);
      if (items[i].ref) droppedRefs.add(items[i].ref as string);
      skippedDuplicates.push({ name: entity.name, existing: seenInBatch.get(norm) as string, reason: 'مكرر داخل الدفعة نفسها' });
      continue;
    }
    seenInBatch.set(norm, entity.name);
  }

  // تتابع الإسقاط: تابع عنصر مُسقَط (after رقمي/اسمي أو {{ref}} في الوسائط)
  // لا يمكنه التنفيذ — مرجعه لم يعد سيُنشأ.
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < items.length; i++) {
      if (droppedIdx.has(i)) continue;
      const it = items[i];
      const afterDropped =
        (typeof it.after === 'number' && droppedIdx.has(it.after)) ||
        (typeof it.after === 'string' && droppedRefs.has(it.after)) ||
        Array.from(droppedRefs).some((r) => argsReferenceRef(it.args, r));
      if (afterDropped) {
        droppedIdx.add(i);
        if (it.ref) droppedRefs.add(it.ref);
        skippedDuplicates.push({ name: it.label || it.tool, existing: it.label || it.tool, reason: 'تابع لعنصر مُسقَط (مكرر)' });
        changed = true;
      }
    }
  }

  if (droppedIdx.size === 0) return { effective: items, skippedDuplicates };

  // إعادة ترقيم after الرقمية بعد الإسقاط (التسلسل = الفهرس الفعلي الجديد).
  const remap = new Map<number, number>();
  const effective: NormalizedBatchItem[] = [];
  items.forEach((it, i) => {
    if (!droppedIdx.has(i)) {
      remap.set(i, effective.length);
      effective.push(it);
    }
  });
  for (const it of effective) {
    if (typeof it.after === 'number') {
      const mapped = remap.get(it.after);
      if (mapped === undefined) {
        // تابع لعنصر مُسقَط لم يلتقطه التتابع (سلامة قبل الدقة)
        it.after = undefined;
      } else {
        it.after = mapped;
      }
    }
  }
  return { effective, skippedDuplicates };
}

export const batchTools: ToolDefinition[] = [
  {
    name: 'ai.enqueue_batch',
    labelAr: 'إنشاء دفعة عمليات',
    descriptionAr:
      'ينشئ دفعة عمليات مجمّعة تحت موافقة واحدة بدل بطاقة تأكيد لكل عملية — استخدمه لأي طلب يحوي أكثر من عمليتين كتابيتين (إدخال فواتير/سندات/منتجات/عملاء بالجملة، أو عمليات مركبة مرتبطة) فالموافقة واحدة بزر واحد. رتّب العناصر بحيث يسبق المُعتمَد عليه: المورّد قبل فواتيره، والفاتورة قبل سندها — واربطها عبر after (رقم تسلسلي أو ref دلالي). لتمرير مخرجات عنصر لاحق (معرف المورّد المنشأ مثلاً) استخدم {{ref.id}} أو {{ref.field}} داخل النصوص، أو @ref كقيمة كاملة — تُستبدل تلقائياً من المخرجات المحفوظة، والمرجع المجهول يُفشل العنصر بخطأ واضح. كل المعرفات (عميل/مورد/منتج/خزنة) يجب أن تكون UUID من أدوات البحث — لا تمرر أبداً كلمات حرفية مثل "bank" أو أسماء. شكل كل عنصر حصراً: {"tool": "<domain.verb>", "args": {...}, "after"?: رقم/اسم, "ref"?: "اسم", "label"?: "وصف"} — مثال: {"items": [{"tool": "sales.create_invoice", "args": {"customerId": "..."}}]}. كل عنصر يُنفَّذ بنفس صلاحياته وتدقيقه كالاستدعاء المفرد. حارس التكرار: أي عنصر يعيد إنشاء كيان (مورد/عميل/منتج/مستودع/موظف…) أُنشئ سابقاً في نفس الجلسة يُسقط تلقائياً مع إفصاح في النتيجة — فلا تعِد إنشاء ما في "ما نُفّذ" بسجل المهمة؛ ابحث عنه بـsearch.* بدلاً من ذلك.',
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
      // Same shape tolerance as execute(): the model sometimes emits
      // {name, type, data} or {action, payload} — the card must show the
      // real tool, never '?'.
      const toolOf = (i: Record<string, unknown>) => String(i.tool || i.type || i.action || '?');
      const tools = [...new Set(items.map((i) => toolOf(i)))].slice(0, 3).join('، ');
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
        const rawArgs = it.args ?? it.data ?? it.payload;
        const inner = (rawArgs && typeof rawArgs === 'object' ? rawArgs : {}) as Record<string, unknown>;
        const bits: string[] = [];
        for (const key of ['name', 'customer', 'supplier', 'product', 'invoiceNumber', 'total', 'amount', 'quantity', 'description', 'title']) {
          const v = inner[key] ?? (key === 'name' && typeof it.name === 'string' ? it.name : undefined);
          if (v !== undefined && v !== null && String(v).trim()) bits.push(`${key}: ${String(v).slice(0, 30)}`);
        }
        return bits.length > 0 ? ` {${bits.join(', ')}}` : '';
      };
      const shown = items.slice(0, MAX_PREVIEW).map((it, i) => {
        const tool = toolOf(it);
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
      // Shape aliases: the model emits item shapes from several conventions
      // ({tool,args} canonical; {name,type,data} and {action,payload,ref}
      // seen in real sessions) — normalize (type|action→tool,
      // data|payload→args) so the batch fails only on genuinely unknown
      // tools, never on a renamed key. Stray siblings (e.g. name) still
      // hoist into args below.
      const KNOWN_ITEM_KEYS = new Set(['tool', 'args', 'after', 'ref', 'label', 'type', 'data', 'action', 'payload']);
      const items = rawItems.map((it) => {
        const rawArgs = it.args ?? it.data ?? it.payload;
        const base = (rawArgs && typeof rawArgs === 'object' ? rawArgs : {}) as Record<string, unknown>;
        const stray: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(it)) {
          if (!KNOWN_ITEM_KEYS.has(k) && v !== undefined) stray[k] = v;
        }
        return {
          tool: sanitizeBatchToolName(String(it.tool || it.type || it.action || '')),
          args: { ...stray, ...base },
          after: (it.after as number | string | undefined) ?? undefined,
          ref: typeof it.ref === 'string' && it.ref.trim() ? it.ref.trim() : undefined,
          label: typeof it.label === 'string' && it.label.trim() ? it.label.trim().slice(0, 200) : undefined,
        };
      });
      // فحص مسبق (Pre-flight) قبل الإرسال: العناصر المكسورة تموت هنا بإفصاح
      // لكل عنصر بدل أن تموت بعد الموافقة وقت التنفيذ. الجلسة 2026-09-14:
      // فاتورتا مبيعات أُرسلتا بلا customerId (MISSING_ID) بعد موافقة
      // المستخدم — "عمليات ناقصة" وافق عليها المستخدم دون علمه.
      const invalidItems = preflightValidateItems(items);
      if (invalidItems.length > 0) {
        return {
          error: `فشل الفحص المسبق لـ ${invalidItems.length} عنصراً — لم تُنشأ أي دفعة. أصلح العناصر التالية وأعد الإرسال كدفعة واحدة:\n${invalidItems.slice(0, 8).map((e) => `- العنصر ${e.index + 1}: ${e.problem}`).join('\n')}`,
          invalidItems,
        };
      }
      // حارس التكرار الجلسي — قبل الإرسال: إعادة إنشاء كيان مُنشأ في نفس
      // الجلسة (نسيان المهمة) يُسقط بإفصاح صريح بدل تلويث الأرصدة والتقارير.
      const { effective, skippedDuplicates } = filterSessionDuplicates(items, ctx.ledger ?? null);
      if (effective.length === 0) {
        return {
          error: 'كل عناصر الدفعة كيانات أُنشئت سابقاً في هذه الجلسة — لم يُنشأ شيء. استخدم أدوات البحث (search.*) للوصول إليها بدل إعادة الإنشاء، وإذا أراد المستخدم كياناً جديداً بالاسم نفسه فميّزه أولاً (هاتف أو رمز).',
          skippedDuplicates,
        };
      }
      const res = await enqueueBatch({
        companyId: ctx.companyId,
        userId: ctx.userId,
        title: str(args.title) || `دفعة ${effective.length} عملية`,
        kind: str(args.kind) || 'mixed',
        items: effective,
      });
      if (!res.success || !res.data) return { error: res.error || 'فشل إنشاء الدفعة' };
      // P2: disclose dedup — exact-duplicate items are dropped by the
      // idempotency key (ON CONFLICT DO NOTHING); the model must know its
      // batch shrank instead of wondering where items went.
      const deduped = res.data.deduped ?? 0;
      const dupNote = skippedDuplicates.length > 0
        ? ` — ⚠️ أُسقط ${skippedDuplicates.length} عنصراً مكرراً (${skippedDuplicates.slice(0, 5).map((d) => d.name).join('، ')}) لأنه أُنشئ سابقاً في هذه الجلسة — لا تعِد إنشاءه`
        : '';
      return {
        batchId: res.data.batchId,
        total: res.data.total,
        ...(deduped > 0 ? { deduped, dedupNote: `أُسقط ${deduped} عنصراً مكرراً تماماً (نفس الأداة والوسائط) — لن تُنفَّذ مرتين` } : {}),
        ...(skippedDuplicates.length > 0 ? { skippedDuplicates } : {}),
        summary: `أُنشئت الدفعة (${res.data.total} عملية${deduped > 0 ? ` بعد إسقاط ${deduped} مكرر` : ''})${dupNote} — ستبدأ فور موافقتك، وتستطيع متابعة التقدم لحظة بلحظة`,
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
      // P1 fix: a worker may already drive this batch in THIS renderer (the
      // card shows live progress). Re-approving "resume" must not report a
      // fresh resume — and must not request a second worker loop. Report
      // honestly with no startBatchRun (runBatch would short-circuit anyway,
      // but the model/user deserve the truth, not "resumed").
      if (isBatchActive(batchId)) {
        return {
          batchId,
          alreadyRunning: true,
          summary: 'الدفعة تعمل حالياً في هذه الجلسة — تقدّمها ظاهر على بطاقتها، لا حاجة لاستئناف.',
        };
      }
      const got = await aiApi.batchGet(ctx.companyId, ctx.userId, batchId);
      if (!got.success || !got.data) return { error: got.error || 'الدفعة غير موجودة' };
      const detail = got.data;
      if (detail.status === 'done') return { error: 'الدفعة مكتملة أصلاً — لا شيء لاستئنافه' };
      if (detail.status === 'cancelled') return { error: 'الدفعة ملغاة — أنشئ دفعة جديدة بدلاً من ذلك' };
      if (detail.failedCount > 0) {
        // Same honesty contract as the banner resume (chatEngine): permanent
        // failures re-fail verbatim, so report them with fixes instead of a
        // futile requeue + worker cycle the user reads as "resume is broken".
        const failed = (detail.items ?? []).filter((i) => i.status === 'failed');
        const plan = planBatchResume(failed);
        if (plan.action === 'refuse-permanent') {
          return { batchId, resumed: false, message: plan.message };
        }
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
