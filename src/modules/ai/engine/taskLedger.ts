import type { ChatMessage } from '../types';

/**
 * سجل المهمة الدائم (Session Task Ledger) — ذاكرة المهمة خارج نافذة السياق.
 *
 * الجلسة الحقيقية 2026-09-14: نافذة السياق (30 رسالة) أُسقطت الطلب الأصلي
 * الطويل بعد دورات قليلة، والملخص الاستخلاصي يقتصّ كل طلب مستخدم إلى 120
 * حرفاً — فنسي المساعد قائمة المهام كاملة، طلب من المستخدم إعادة إرسالها
 * مرتين، أعاد إنشاء الموردين والعملاء (تكرارات حقيقية في القاعدة)، بل أنشأ
 * "منتج أ" و"مادة خام ب" ببيانات اختراقها بدل قائمة المنتجات الحقيقية.
 *
 * الحل (نمط Plan-Execute Ledger في وكلاء المهام المتعددة): ذاكرة مهيكلة
 * تعيش خارج نافذة السياق وتُحقن في برومبت النظام كل دورة:
 *   1. طلبات المستخدم بنصها الكامل — المهمة الأصلية لا تُقتصّ إلى سطر.
 *   2. مخرجات ما نُفّذ فعلاً — الدفعات المكتملة والكيانات التي أنشأتها.
 *   3. قواعد ذاكرة: لا إعادة سؤال، لا تكرار إنشاء، استئناف من نقطة التوقف.
 *
 * حارس التكرار: findDuplicateName يكشف اسماً أُنشئ في نفس الجلسة (بتطبيع
 * عربي: التشكيل، الهمزات، التاء المربوطة، المسافات) ليُسقط إعادة إنشاءه —
 * لأن تكرار الكيان المرجعي يفسد الأرصدة والتقارير المالية مباشرة.
 * المستندات (فواتير/سندات/أوامر تشغيل…) لا تدخل الحارس: تكرارها مشروع يومياً.
 */

// ─── ميزانية الحقن في برومبت النظام (أحرف) ─────────────────────────────────
// سقف رسالة النظام في aiHandler.js هو 48000 حرف والبرومبت الأساسي 22-29 ألف —
// 8000 تترك هامشاً آمناً على المسارين (Electron IPC + المتصفح).
export const LEDGER_MAX_CHARS = 8000;
const FIRST_REQUEST_MAX = 4500;
const OTHER_REQUEST_MAX = 1200;
const MAX_OTHER_REQUESTS = 2;
const MAX_OUTCOMES = 8;
const OUTCOME_LINE_MAX = 340;
const MAX_ENTITIES_PER_OUTCOME = 14;

/** كيان مرجعي مستخرج من عنصر دفعة: الأداة + الاسم كما كتبه المستخدم. */
export interface LedgerEntity {
  tool: string;
  name: string;
}

/** أدوات إنشاء الكيانات المرجعية الأساسية — الوحيدة التي يمنع تكرارها. */
const ENTITY_CREATE_TOOL_RE =
  /(?:create_supplier|create_customer|create_product|create_warehouse|create_employee|create_department|create_account|create_lead|create_category|create_product_type|create_unit|create_cash_box|create_cost_center)$/;

/** حقول الاسم المحتملة في وسائط أدوات الإنشاء (بالترتيب). */
const ENTITY_NAME_ARGS = ['name', 'nameAr', 'name_ar', 'fullName', 'full_name', 'title'];

/** تطبيع اسم عربي للمقارنة الآمنة بين دورات الجلسة. */
export function normalizeEntityName(name: string): string {
  return String(name ?? '')
    .replace(/[\u064B-\u0652\u0670\u0640]/g, '') // تشكيل + تطويل
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * يستخرج (الأداة، الاسم) من عنصر دفعة مُطبَّع الشكل {tool, args} —
 * يُرجع null لأدوات المستندات وغير أدوات الإنشاء المرجعي.
 */
export function extractLedgerEntity(item: { tool?: unknown; args?: unknown }): LedgerEntity | null {
  const tool = typeof item?.tool === 'string' ? item.tool : '';
  if (!tool || !ENTITY_CREATE_TOOL_RE.test(tool)) return null;
  const args = (item?.args && typeof item.args === 'object' ? item.args : {}) as Record<string, unknown>;
  for (const key of ENTITY_NAME_ARGS) {
    const v = args[key];
    if (typeof v === 'string' && v.trim()) return { tool, name: v.trim() };
  }
  return null;
}

/** يستخرج كيانات عناصر دفعة كاملة (شكل النموذج الخام: items[]). */
export function extractLedgerEntitiesFromItems(items: unknown): LedgerEntity[] {
  if (!Array.isArray(items)) return [];
  const out: LedgerEntity[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const it = raw as Record<string, unknown>;
    // الشكل الكنسي {tool, args} أو الأسماء المستعارة {type|action, data|payload}
    const tool = it.tool ?? it.type ?? it.action;
    const args = it.args ?? it.data ?? it.payload;
    const entity = extractLedgerEntity({ tool, args });
    if (entity) out.push(entity);
  }
  return out;
}

interface LedgerOutcome {
  title: string;
  line: string;
  entities: LedgerEntity[];
}

interface TaskEntry {
  title: string;
  name: string;
  status: string; // done | failed | skipped | queued | running
}

interface CreatedEntity {
  display: string;
  tool: string;
}

/**
 * مفتاح عدم تكرار جلسي لعنصر دفعة مكتمل: `tool + stable-hash(args)`.
 * يُحسب في طبقة الدفعات (batchQueue.buildIdempotencyKey) ويُمرَّر هنا
 * كنص جاهز — هذا الملف لا يستورد batchQueue عمداً (اعتمادية دائرية:
 * batchQueue يستورد extractLedgerEntity من هنا).
 */

function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  // القوائم الطويلة: احتفظ بالبداية (التوجيهات) والنهاية (بنود متبقية) معاً —
  // اقتضاص الوسط فقط، فالخطأ القديم كان فقدان ذيل القائمة بالكامل.
  const head = Math.floor(max * 0.72);
  const tail = Math.floor(max * 0.24);
  return `${s.slice(0, head)}\n…(اقتُطع من الوسط والنص الكامل عند المستخدم)…\n${s.slice(-tail)}`;
}

/**
 * سجل المهمة — يعيش داخل ChatEngine ويُطبَّع عبر ToolContext.ledger كواجهة
 * قراءة فقط لأدوات الدفعات (حارس التكرار) دون كشف حالة الذاكرة.
 */
export class TaskLedger {
  private requests: string[] = [];
  private outcomes: LedgerOutcome[] = [];
  private created = new Map<string, CreatedEntity>();
  /**
   * مفاتيح عناصر مكتملة (done) في هذه الجلسة — عدم تكرار عبر الدفعات.
   * الجلسة 2026-09-24: نفس الفواتير أُنشئت مرتين في دفعتين مختلفتين
   * (INV-000001/INV-000003، PINV-0001/PINV-0004…) لأن عدم التكرار كان
   * داخل الدفعة الواحدة فقط (UNIQUE(batch_id, idempotency_key)).
   * المستندات المكررة (فواتير/سندات) فساد مالي مباشر، لذا الحارس هنا
   * يشمل المستندات لا الكيانات المرجعية فقط.
   */
  private completedKeys = new Set<string>();
  /** جدول المهام: حالة كل بند دفعة (منجز/فاشل/مُخطّى) — "ما تم وما بقي". */
  private taskEntries: TaskEntry[] = [];

  /** سجل طلب مستخدم بنصه الكامل. التكرار الحرفي المتتالي يُتجاهل (regenerate). */
  recordRequest(text: string): void {
    const clean = String(text ?? '')
      .replace(/<<<BEGIN_ATTACHMENT[\s\S]*?<<<END_ATTACHMENT>>>/g, '[مرفق]')
      .trim();
    if (!clean) return;
    if (this.requests[this.requests.length - 1] === clean) return;
    this.requests.push(clean);
    // احتفظ بالطلب الأول (المهمة الأصلية) + الأحدث؛ واسقط الوسطى القديمة.
    if (this.requests.length > MAX_OTHER_REQUESTS + 1) {
      this.requests.splice(1, this.requests.length - (MAX_OTHER_REQUESTS + 1));
    }
  }

  /** سجل مخرجات ما نُفّذ (سطر تقدم دفعة + كياناتها) وسجّل كياناتها. */
  recordOutcome(outcome: { title?: string | null; line: string; entities?: LedgerEntity[] }): void {
    const line = String(outcome.line ?? '').trim();
    if (!line) return;
    this.outcomes.push({
      title: String(outcome.title ?? '').trim().slice(0, 120),
      line: line.slice(0, OUTCOME_LINE_MAX + 60),
      entities: (outcome.entities ?? []).slice(0, MAX_ENTITIES_PER_OUTCOME),
    });
    if (this.outcomes.length > MAX_OUTCOMES) {
      this.outcomes.splice(0, this.outcomes.length - MAX_OUTCOMES);
    }
    this.registerEntities(outcome.entities ?? []);
  }

  /** سجّل أسماء كيانات أُنشئت فعلاً (لحارس التكرار). الأول يفوز. */
  registerEntities(entities: LedgerEntity[]): void {
    for (const e of entities) {
      const norm = normalizeEntityName(e.name);
      if (norm && !this.created.has(norm)) {
        this.created.set(norm, { display: e.name, tool: e.tool });
      }
    }
  }

  /** ابحث عن كيان بنفس الاسم المُطبَّع أُنشئ سابقاً في هذه الجلسة. */
  findDuplicateName(name: string): CreatedEntity | null {
    return this.created.get(normalizeEntityName(name)) ?? null;
  }

  /** سجّل مفاتيح عناصر مكتملة (تُحسب في طبقة الدفعات). الأول يفوز. */
  registerCompletedKeys(keys: Array<string | null | undefined>): void {
    for (const k of keys) {
      if (typeof k === 'string' && k) this.completedKeys.add(k);
    }
  }

  /** هل نُفّذ عنصر بنفس المفتاح في هذه الجلسة؟ (منع التكرار عبر الدفعات) */
  hasCompletedKey(key: string): boolean {
    return this.completedKeys.has(key);
  }

  get isEmpty(): boolean {
    return this.requests.length === 0 && this.outcomes.length === 0 && this.taskEntries.length === 0;
  }

  /** هل يوجد بند فاشل ما زال معلقاً؟ (ادعاء "كافة المهام" مع فاشل = كذب بالإغفال) */
  hasFailures(): boolean {
    return this.taskEntries.some((t) => t.status === 'failed');
  }

  /** أسماء البنود الفاشلة (لرسالة التصحيح — "ما الذي لم يُنجز فعلاً"). */
  getFailedTaskNames(limit = 8): string[] {
    return this.taskEntries
      .filter((t) => t.status === 'failed')
      .slice(0, Math.max(0, limit))
      .map((t) => t.name);
  }

  clear(): void {
    this.requests = [];
    this.outcomes = [];
    this.created.clear();
    this.completedKeys.clear();
    this.taskEntries = [];
  }

  /**
   * جدول المهام من تفصيل دفعة: كل بند بحالته النهائية (منجز/فاشل/مُخطّى).
   * البند المكرر بنفس الدفعة والعنوان يُحدَّث لا يُكرر.
   */
  recordBatchTaskTable(
    title: string | null | undefined,
    items: Array<{ toolName?: string; args?: Record<string, unknown>; status?: string }>,
  ): void {
    const safeTitle = String(title ?? '').trim() || 'بدون عنوان';
    for (const it of items) {
      const status = String(it.status ?? 'unknown');
      if (!['done', 'failed', 'skipped'].includes(status)) continue; // جارٍ/مطلوب = بطاقة حية
      let name = typeof it.toolName === 'string' ? it.toolName : 'عنصر';
      const entity = extractLedgerEntity({ tool: it.toolName, args: it.args });
      if (entity?.name) name = entity.name;
      const key = `${safeTitle}::${name}`;
      const existing = this.taskEntries.find((t) => `${t.title}::${t.name}` === key);
      if (existing) {
        existing.status = status;
      } else {
        this.taskEntries.push({ title: safeTitle, name, status });
      }
    }
    if (this.taskEntries.length > 120) {
      // الأقدم المنجز يُسقط أولاً — الفاشل والمُخطّى يبقيان مرئيين.
      const keep = this.taskEntries.filter((t) => t.status !== 'done').slice(-100);
      const doneCount = this.taskEntries.filter((t) => t.status === 'done').length;
      this.taskEntries = [...keep, { title: 'الإجمالي', name: `${doneCount} بنداً منجزاً سابقاً`, status: 'done' }];
    }
  }

  /**
   * سجّل من تفصيل دفعة (JobBatchDetail): الكيانات المنفَّذة فقط (status=done) —
   * العنصر الفاشل يجب أن يُسمح بإعادة إنشائه لاحقاً، فلا يدخل حارس التكرار.
   * كما يخزن حالة كل بند في جدول المهام (منجز/فاشل/مُخطّى) الذي يرى النموذج
   * فيه "ما تم وما لم يتم وما بقي" عبر الدورات.
   */
  recordFromBatchDetail(detail: {
    title?: string | null;
    failedCount?: number;
    skippedCount?: number;
    totalCount?: number;
    items?: Array<{ toolName?: string; args?: Record<string, unknown>; status?: string }>;
  }): void {
    const items = detail.items ?? [];
    const done = items.filter((i) => i.status === 'done');
    const entities = done
      .map((i) => extractLedgerEntity({ tool: i.toolName, args: i.args }))
      .filter((e): e is LedgerEntity => e !== null);
    const total = detail.totalCount ?? items.length;
    this.recordOutcome({
      title: detail.title,
      line: `دفعة «${String(detail.title ?? '').trim() || 'بدون عنوان'}»: أُنجز ${done.length} — فشل ${detail.failedCount ?? 0} — تخطي ${detail.skippedCount ?? 0} (من ${total})`,
      entities,
    });
    this.recordBatchTaskTable(detail.title, items);
  }

  /** إعادة بناء الطلبات من رسائل الجلسة المحفوظة (استعادة بعد إعادة الفتح). */
  rebuildFromMessages(messages: ChatMessage[]): void {
    this.clear();
    for (const m of messages ?? []) {
      if (m && m.role === 'user' && m.kind === 'text' && m.content) {
        this.recordRequest(String(m.content));
      }
    }
  }

  /**
   * اعرض كتلة السجل لبرومبت النظام — null عند سجل فارغ (لا حشو للجلسات القصيرة).
   * الطلبات أولاً (المهمة الأصلية بأقصى سعة) ثم المخرجات ثم قواعد الذاكرة.
   */
  render(): string | null {
    if (this.isEmpty) return null;

    const first = this.requests[0] ?? '';
    const others = this.requests.slice(1).slice(-MAX_OTHER_REQUESTS);

    const requestLines: string[] = [];
    if (first) requestLines.push(`【المهمة الأصلية】\n${clip(first, FIRST_REQUEST_MAX)}`);
    for (const o of others) requestLines.push(`【طلب لاحق】\n${clip(o, OTHER_REQUEST_MAX)}`);

    const outcomeLines = this.outcomes.map((o) => {
      const names = o.entities.map((e) => `«${e.name}»`);
      const shown = names.slice(0, 8).join('، ');
      const more = names.length > 8 ? ` و${names.length - 8} أخرى` : '';
      const entityNote = names.length > 0 ? ` — أُنشئ: ${shown}${more}` : '';
      const titleNote = o.title ? `[${o.title}] ` : '';
      return `- ${titleNote}${clip(o.line, OUTCOME_LINE_MAX)}${clip(entityNote, 600)}`;
    });

    const rules = [
      'قواعد الذاكرة (إلزامية):',
      '1. بيانات الطلبات أعلاه معتمدة كما هي — لا تعيد سؤال المستخدم عنها ولا تطلب إعادة إرسالها أبداً.',
      '2. الكيانات المذكورة في "ما نُفّذ" أُنشئت فعلاً — لا تنشئها مرة أخرى؛ ابحث عنها بأدوات search.* للوصول إلى معرفاتها.',
      '3. عند "استمر/بقية المهام/تابع": حدد البنود غير المنفذة من الطلب الأصلي أعلاه ونفّذ الدفعة التالية مباشرة، وعند أي فشل استأنف من نقطة التوقف دون إعادة ما نجح.',
    ].join('\n');

    let body = [
      '🗂️ سجل المهمة الدائم لهذه الجلسة — ذاكرة معتمدة من المستخدم:',
      '',
      '▼ طلبات المستخدم (نص كامل):',
      requestLines.join('\n'),
      '',
    ];
    if (outcomeLines.length > 0) {
      body = body.concat(['▼ ما نُفّذ فعلاً في هذه الجلسة (لا تكرّره):', outcomeLines.join('\n'), '']);
    }
    // جدول المهام: "ما تم وما لم يتم وما بقي" — الفاشل والمُخطّى بأسمائهما
    // فيراه النموذج عبر الدورات ويقترح الإصلاح دون إعادة اكتشاف من السياق.
    if (this.taskEntries.length > 0) {
      const doneN = this.taskEntries.filter((t) => t.status === 'done').length;
      const failedN = this.taskEntries.filter((t) => t.status === 'failed');
      const skippedN = this.taskEntries.filter((t) => t.status === 'skipped');
      const taskLines: string[] = [`✓ منجز: ${doneN}`];
      if (failedN.length > 0) {
        taskLines.push(
          `✗ فاشل (${failedN.length}): ${failedN.slice(0, 10).map((t) => t.name).join('، ')}${failedN.length > 10 ? ` و${failedN.length - 10} أخرى` : ''} — اسأل المستخدم إن أراد إنشاءه/تصحيحه ثم أعد الفاشل`,
        );
      }
      if (skippedN.length > 0) {
        taskLines.push(
          `⊘ مُخطّى (${skippedN.length}): ${skippedN.slice(0, 10).map((t) => t.name).join('، ')}${skippedN.length > 10 ? ` و${skippedN.length - 10} أخرى` : ''} — تابع لعناصر فاشلة`,
        );
      }
      body = body.concat(['▼ جدول المهام:', taskLines.join('\n'), '']);
    }
    body = body.concat([rules]);

    const text = body.join('\n');
    // صمام أمان نهائي — جلسات استثنائية الطول تبقى داخل الميزانية.
    if (text.length <= LEDGER_MAX_CHARS) return text;
    return clip(text, LEDGER_MAX_CHARS);
  }
}
