/**
 * Tool Error Taxonomy — the classification layer that turns raw tool errors
 * into GUIDED, actionable guidance instead of a flat error string.
 *
 * Contract:
 *   - Tool APIs return `{ error: string }` (Arabic-first business messages).
 *   - `classifyToolError` maps the raw message onto a stable `ToolErrorCode`
 *     plus structured guidance: what happened (userMessage), WHY it happened
 *     (reason), and WHAT TO DO NEXT (fixHint — often a concrete tool call or
 *     UI path). `retryable` tells the model whether retrying makes sense.
 *   - The engine injects the structured hint into the LLM context so the
 *     assistant explains the failure and proposes the next step itself —
 *   "يكتشف الخطأ ويوجه المستخدم ويعرض سبب الخطأ وما يجب فعله" —
 *     instead of parroting the raw error.
 *
 * Classification runs in three layers, in order:
 *   1. a STABLE KEY the tool forwarded (`errorCode` from the adapter
 *      classification) — a key cannot be misread;
 *   2. an EXACT match against the adapter's constant database sentences —
 *      constants cannot drift the way prose does;
 *   3. REGEXES over the normalized Arabic business message: the API layer's
 *      messages are the contract (they already carry the cause, e.g.
 *      "المتبقي: 3 أيام", "لا يمكن حذف فاتورة مرحلة"). New API guards should
 *      phrase messages so a classifier pattern catches the family — and new
 *      patterns MUST come with a test.
 */

import { PG_AR_SENTENCES, type PgFailureCode } from '@/core/utils/pgErrors';

export type ToolErrorCode =
  // ── Validation & input ──────────────────────────────────────────────────
  | 'MISSING_ID'               // a required entity id was absent
  | 'MISSING_FIELD'            // a required business field was absent
  | 'INVALID_VALUE'            // quantity/amount/date out of range or malformed
  | 'INVALID_REFERENCE'        // a foreign-key reference is dead or cross-tenant
  | 'AMOUNT_NOT_POSITIVE'
  | 'UNBALANCED_ENTRY'        // journal debit != credit
  | 'DUPLICATE_DOCUMENT'      // identical fingerprint blocked
  | 'DUPLICATE_ENTITY'         // customer/supplier/product name blocked
  // ── Business rules & state machines ────────────────────────────────────
  | 'INVALID_STATUS_TRANSITION'// stage/status machine refused the move
  | 'INSUFFICIENT_BALANCE'     // leave balance exceeded, stock shortfall…
  | 'DOCUMENT_NOT_DRAFT'       // mutating/deleting a posted document
  | 'DOCUMENT_HAS_CHILDREN'    // FK/refs guard refused delete
  | 'PERIOD_LOCKED'            // duplicate payroll period etc.
  | 'NO_COMPANY_DATA'          // e.g. no warehouse exists yet
  // ── Infrastructure ──────────────────────────────────────────────────────
  | 'NOT_FOUND'
  | 'PERMISSION_DENIED'
  | 'TIMEOUT'
  | 'RATE_LIMIT'
  | 'DB_ERROR'
  | 'PROVIDER_ERROR'
  | 'UNKNOWN';

export interface ToolErrorClassification {
  code: ToolErrorCode;
  /** What the user sees — short, human, no jargon. */
  userMessage: string;
  /** WHY it happened — the business/accounting reason. */
  reason: string;
  /** WHAT TO DO NEXT — a concrete next step (tool call or UI path). */
  fixHint: string;
  /** Whether re-running the SAME tool with corrected args can succeed. */
  retryable: boolean;
  /** The original raw error (never lost — audit + fallback). */
  raw: string;
}

interface Pattern {
  code: ToolErrorCode;
  re: RegExp;
  reason: string;
  fixHint: string;
  retryable: boolean;
}

/**
 * Ordered patterns — FIRST match wins. More specific families must precede
 * generic ones (e.g. "الرصيد غير كاف" before a generic "غير مسموح").
 */
const PATTERNS: Pattern[] = [
  {
    code: 'MISSING_ID',
    re: /(customerId|supplierId|productId|invoiceId|employeeId|accountId|branchId|cashBoxId|warehouseId|leadId|opportunityId|taskId|transactionId|workOrderId|bomId|sequenceId|departmentId)\s*مطلوب|استخدم\s+search\./,
    reason: 'أحد المعرفات المطلوبة للعملية غير متوفر — أسماء الكيانات يجب تحويلها إلى معرفات عبر أدوات البحث قبل التنفيذ.',
    fixHint: 'استدعِ أداة search المناسبة (مثل search.customers أو search.products) باسم الكيان من كلام المستخدم، ثم أعد التنفيذ بالمعرف المُرجع.',
    retryable: true,
  },
  {
    code: 'MISSING_FIELD',
    re: /مطلوب.*(اختيار|إدخال|حقل)|الاسم مطلوب|عنوان النشاط مطلوب|وصف القيد مطلوب|يجب تمرير (صنف|حقل|طرف)/,
    reason: 'بيانات إلزامية ناقصة في الطلب — لا يمكن للنظام إنشاء المستند بدونها.',
    fixHint: 'اسأل المستخدم عن الحقل الناقص تحديداً (الاسم/الكمية/التاريخ…) ثم أعد المحاولة.',
    retryable: true,
  },
  {
    // Live 2026-10-02: the model called search.* with an EMPTY query over
    // and over ("نص البحث مطلوب" ×N across tools). An empty search can never
    // succeed — mark it non-retryable so the loop guard kills the spiral and
    // the model asks for (or derives) a real search text instead.
    code: 'INVALID_VALUE',
    re: /نص البحث مطلوب/,
    reason: 'استدعيت البحث بنص فارغ — البحث الفارغ لا يعيد شيئاً أبداً.',
    fixHint: 'مرّر اسم الكيان أو جزأه في query (من كلام المستخدم أو كتلة الحل) — ولا تعاود الاستدعاء الفارغ أبداً.',
    retryable: false,
  },
  {
    code: 'UNBALANCED_ENTRY',
    re: /مجموع المدين .* لا يساوي مجموع الدائن|القيد غير متوازن/,
    reason: 'القيد المحاسبي مكسور التوازن: مجموع المدين لا يساوي مجموع الدائن — وهو شرط القيد المزدوج.',
    fixHint: 'راجع أطراف القيد: أضف الطرف الناقص أو صحّح المبالغ حتى يتساوى المدين والدائن، ثم أعد الإنشاء.',
    retryable: true,
  },
  {
    code: 'INSUFFICIENT_BALANCE',
    re: /الرصيد (غير كاف|لا يكفي)|تجاوز الرصيد|المتبقي:?\s*\d+|لا يوجد رصيد كاف|نقص.*(المخزون|الكمية)/,
    reason: 'العملية تتجاوز الرصيد المتاح (رصيد إجازات، كمية مخزون، حد ائتماني…) — النظام يفرض الرصيد الصارم على مستوى الـ API.',
    fixHint: 'أخبر المستخدم بالرصيد المتبقي الفعلي (استخدم hr.get_leave_balances أو manufacturing.check_bom_availability أو فحص المخزون) واقترح تعديل الكمية/التواريخ أو تأجيل العملية.',
    retryable: true,
  },
  {
    code: 'INVALID_STATUS_TRANSITION',
    re: /انتقال غير (مسموح|قانوني)|لا يمكن (تحويل|ترحيل|إعادة فتح).*الحالة|المرحلة النهائية|الحالة الحالية لا تسمح/,
    reason: 'آلة الحالات الصارمة للنظام رفضت الانتقال — كل مستند يمر بتسلسل حالات محدد ولا يمكن القفز أو الرجوع.',
    fixHint: 'اشرح للمستخدم التسلسل القانوني للحالات (مثلاً: draft → posted، أو new → qualified → proposal…) واقترح المسار الصحيح للوصول للهدف.',
    retryable: false,
  },
  {
    code: 'DOCUMENT_NOT_DRAFT',
    re: /لا يمكن (حذف|تعديل).*(مرحل|مرحّل|posted)|فاتورة مرحلة|سند.*(مرحل|مطبق)|لا تعديل على مستند مرحل/,
    reason: 'المستند مرحّل (posted) — له أثر محاسبي نافذ، والنظام يمنع التعديل/الحذف المباشر حفاظاً على سلامة الدفاتر.',
    fixHint: 'إن كان خطأ: أنشئ مستنداً عكسياً (مردود/سند معاكس) بدل تعديل المرحّل. إن كانت مسودة المطلوبة: نفّذ العملية على المستند الصحيح بمعرفه من أدوات البحث.',
    retryable: false,
  },
  {
    code: 'DOCUMENT_HAS_CHILDREN',
    re: /لا يمكن الحذف.*(مرتبط|يوجد)|له (فواتير|حركات|مسيرات|إجازات|سجلات|مهام|فرص|أنشطة)|FK violation|مرتبط بحركات/,
    reason: 'الكيان لديه حركات/مستندات مرتبطة — حذفه سيفقد بيانات محاسبية أو تشغيلية، والنظام يمنع الحذف المتسلسل الصامت.',
    fixHint: 'إمّا أرشف/عطّل الكيان (isActive=false) بدل الحذف، أو احذف الحركات المرتبطة أولاً من الشاشة المخصصة بعد مراجعة أثرها.',
    retryable: false,
  },
  {
    code: 'DUPLICATE_DOCUMENT',
    re: /تكرار|مستند مطابق|نفس البيانات|fingerprint/,
    reason: 'حارس التكرار وجد مستنداً مطابقاً (نفس الطرف والتاريخ والأصناف والمبلغ) — منع الصمت المحاسبي للتسجيل المزدوج.',
    fixHint: 'إن كان قصداً: أبلغ المستخدم بوجود المستند المطابق واعرض بياناته (استخدم أدوات البحث). إن كان جديداً فعلاً: عدّل التاريخ أو أضف صنفاً مميزاً.',
    retryable: false,
  },
  {
    code: 'DUPLICATE_ENTITY',
    re: /الاسم مستخدم|عميل موجود|موظف موجود|منتج موجود|كود مستخدم|حساب موجود/,
    reason: 'يوجد كيان بنفس الاسم/الكود — النظام يمنع التكرار الصامت للكيانات المرجعية.',
    fixHint: 'ابحث بالاسم أولاً (search.*) وأعرض النتائج على المستخدم: إمّا استخدم الموجود، أو أضف مميزاً للاسم الجديد (فرع/كود مختلف).',
    retryable: true,
  },
  {
    code: 'PERIOD_LOCKED',
    re: /الفترة (مقفلة|مستخدمة)|مسير.*(موجود|سابق) لهذه الفترة/,
    reason: 'الفترة المحاسبية/الشهرية عليها مسير قائم — النظام يمنع التكرار الزمني (قيد فريد لكل فترة).',
    fixHint: 'اعرض المسير القائم للفترة (search.payroll_runs أو أدوات القيود) — عدّله أو ألغِه أولاً، أو اختر فترة مختلفة.',
    retryable: false,
  },
  {
    code: 'NO_COMPANY_DATA',
    re: /لا يوجد (مستودع|خزنة|فرع|قسم|حساب مصروف)/,
    reason: 'بيانات مرجعية أساسية للعملية غير موجودة بعد في هذه الشركة.',
    fixHint: 'أنشئ الكيان المرجعي أولاً (inventory.create_warehouse / settings.create_cash_box…) ثم أعد العملية.',
    retryable: true,
  },
  {
    code: 'AMOUNT_NOT_POSITIVE',
    re: /(المبلغ|الكمية|السعر|الراتب).*(أكبر من صفر|لا يمكن أن يكون سالب)|سالب/,
    reason: 'قيمة مالية/كمية غير صالحة — النظام لا يقبل الأصفار والسالبات في العمليات المالية.',
    fixHint: 'تأكد من الرقم مع المستخدم (ربما فُهم خطأ أو التبست الأرقام العربية/الفواصل) وأعد المحاولة بقيمة موجبة.',
    retryable: true,
  },
  {
    code: 'INVALID_VALUE',
    re: /غير صحيح|غير صالح|خارج النطاق|بين 1 و 12|طريقة دفع غير|نوع نشاط غير|سبب إنهاء خدمة غير/,
    reason: 'قيمة خارج النطاق أو صيغة غير مقبولة (تاريخ، enum، رقم) — النظام يتحقق من كل قيمة على مستوى الـ API.',
    fixHint: 'اقرأ الوصف في تعريف الأداة واعرض الخيارات المقبولة للمستخدم (مثلاً: paymentMethod = cash/bank/check)، ثم أعد المحاولة.',
    retryable: true,
  },
  {
    code: 'NOT_FOUND',
    re: /غير موجود|لم يتم العثور|لا توجد (نتائج|بيانات)|فشل جلب/,
    reason: 'الكيان المطلوب غير موجود (أو حُذف) في هذه الشركة.',
    fixHint: 'أعد البحث باسم/كود مختلف (البحث الضبابي يتسامح مع الأخطاء الإملائية) — وإن لم يوجد فالكيان غير مسجّل: أنشئه أو صحّح المعرف.',
    retryable: true,
  },
  {
    code: 'PERMISSION_DENIED',
    // Must precede generic DB_ERROR: auth strings contain "Authentication required" which
    // also matches DB's "authentication" substring. Classify as PERMISSION, not DB.
    re: /ليس لديك صلاحية|صلاحية|Authentication required|Login required|غير مصرح|انتهت الجلسة|expired session/i,
    reason: 'انتهت جلسة العمل أو لا يملك المستخدم صلاحية هذه العملية — النظام يطلب إعادة تسجيل الدخول.',
    fixHint: 'سجّل خروجك ثم دخولك من جديد لإحياء الجلسة، أو اطلب صلاحية ai.use/الوحدة المطلوبة من مدير النظام. لا تعيد نفس الدفعة قبل تجديد الجلسة.',
    retryable: false,
  },
  {
    code: 'TIMEOUT',
    re: /انتهت مهلة|timeout/i,
    reason: 'تجاوز تنفيذ العملية المهلة (30 ثانية للقراءة، 60 للكتابة) — غالباً بطء في الاتصال بقاعدة البيانات أو طلب كبير جداً.',
    fixHint: 'جرّب طلباً أصغر (فترة أقصر، فلاتر أدق، عدد نتائج أقل) أو أعد المحاولة بعد قليل.',
    retryable: true,
  },
  {
    code: 'RATE_LIMIT',
    re: /تجاوز حد الاستدعاءات/,
    reason: 'تجاوز الوكيل حد الاستدعاءات في الدقيقة — حماية من الحلقات الجامحة.',
    fixHint: 'انتظر دقيقة ثم أعد الطلب بصياغة واحدة مركّزة بدل عدة طلبات متتالية.',
    retryable: true,
  },
  {
    // P3 fix: PROVIDER_ERROR was UNREACHABLE — provider failures (429/503/529
    // overloads, network stalls) fell through to UNKNOWN with no guidance.
    // Retryable: these are transient by nature (see the engine's one-shot
    // backoff retry for the same codes).
    code: 'PROVIDER_ERROR',
    re: /انتهت حصة|مثقل حالياً|overloaded|LLM provider error|تعذر الاتصال بمزود|انتهت مهلة الاتصال بمزود/,
    reason: 'مزود الذكاء الاصطناعي مثقل أو غير متاح مؤقتاً — ليس خطأ في الطلب ولا في البيانات.',
    fixHint: 'انتظر دقيقة وقل "تابع" — الجلسة والدفعات محفوظة. إن تكرر، جرّب طلباً أصغر أو تحقق من إعدادات المزود.',
    retryable: true,
  },
  {
    code: 'DB_ERROR',
    re: /DATABASE|DB (down|error)|connection|syntax for type|does not exist|violation/i,
    reason: 'خطأ تقني في قاعدة البيانات — ليس خطأ المستخدم ولا بياناته.',
    fixHint: 'أعد المحاولة مرة واحدة؛ إن تكرر فالخلل تقني يستدعي مراجعة السجلات — لا تكرر نفس الطلب آلياً.',
    retryable: true,
  },
];

const UNKNOWN_REASON = 'خطأ غير مصنّف — رسالة الـ API الخام هي المرجع.';
const UNKNOWN_FIX = 'اقرأ رسالة الخطأ الخام واشرحها للمستخدم ببساطة، واقترح بديلاً يدوياً من الشاشات إن تعذّر التنفيذ.';

/**
 * A database failure that reached a tool never carries raw PG prose any more:
 * every adapter classifies at its boundary and reports a constant sentence
 * (`PG_AR_SENTENCES`) plus — when the key survived — a stable code. Both land
 * here on the same taxonomy family, because these strings are constants, not
 * locale-moving prose.
 *
 * INVALID_REFERENCE fills a hole the regexes left: a CREATE with a dead
 * parentId used to fall into DOCUMENT_HAS_CHILDREN ("archive instead of
 * deleting"), whose guidance actively harms a create — it told the model to
 * delete the record it had just failed to create.
 */
const STABLE_KEY_TO_CODE: Record<PgFailureCode, ToolErrorCode> = {
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

const INVALID_REFERENCE = {
  reason:
    'مرجع ميت: المعرف الممرَّر (عميل/مورد/منتج/حساب أب…) غير موجود في هذه الشركة — غالباً معرف ملفّق أو منسوخ من سياق آخر، لا سجل حقيقي.',
  fixHint:
    'لا تخترع معرفات ولا تعيد نفسها: استدعِ أداة search المناسبة بالاسم من كلام المستخدم، وإن لم يوجد فأنشئ الكيان أولاً (أو اسأل المستخدم) ثم أعد التنفيذ. معرف UUID حرفي في الحقول = توقف فوراً.',
  retryable: true,
};

/** Fold Arabic variants so classifier patterns match despite orthography. */
function normalizeForClassify(s: string): string {
  return s
    .replace(/[\u064B-\u0652]/g, '') // diacritics
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه');
}

/**
 * @param rawError  the tool's error text, as always.
 * @param stableKey the database stable key when it survived to the tool
 *                  (`errorCode` on a tool's returned object). Beats the regex:
 *                  a key cannot be misread, a sentence can.
 */
export function classifyToolError(rawError: string, stableKey?: string | null): ToolErrorClassification {
  const raw = (rawError || '').trim();

  if (stableKey && stableKey in STABLE_KEY_TO_CODE) {
    const code = STABLE_KEY_TO_CODE[stableKey as PgFailureCode];
    if (code === 'INVALID_REFERENCE') {
      return { code, userMessage: raw, reason: INVALID_REFERENCE.reason, fixHint: INVALID_REFERENCE.fixHint, retryable: INVALID_REFERENCE.retryable, raw };
    }
    const p = PATTERNS.find((pattern) => pattern.code === code)!;
    return { code, userMessage: raw, reason: p.reason, fixHint: p.fixHint, retryable: p.retryable, raw };
  }

  // No key travelled with the failure — but the adapters report database
  // sentences from a constant table, so an EXACT match is still a key:
  // constants cannot drift the way prose does.
  for (const [key, sentence] of Object.entries(PG_AR_SENTENCES)) {
    if (raw === (sentence as string)) {
      return classifyToolError(raw, key);
    }
  }

  const norm = normalizeForClassify(raw);

  for (const p of PATTERNS) {
    if (p.re.test(raw) || p.re.test(norm)) {
      return {
        code: p.code,
        userMessage: raw,
        reason: p.reason,
        fixHint: p.fixHint,
        retryable: p.retryable,
        raw,
      };
    }
  }

  return {
    code: 'UNKNOWN',
    userMessage: raw,
    reason: UNKNOWN_REASON,
    fixHint: UNKNOWN_FIX,
    retryable: true,
    raw,
  };
}

/**
 * Render the classification as the structured block injected into the LLM
 * context (and shown compactly in the error card) — the model reads this and
 * guides the user in its own words instead of dumping the raw error.
 */
export function renderErrorGuidance(c: ToolErrorClassification): string {
  return [
    `[تصنيف الخطأ: ${c.code}]`,
    `ما حدث: ${c.userMessage}`,
    `السبب: ${c.reason}`,
    `الإجراء المقترح: ${c.fixHint}`,
    c.retryable ? 'العملية قابلة لإعادة المحاولة بمعطيات مصححة.' : 'إعادة نفس الطلب بنفس المعطيات لن تنجح — اتبع الإجراء المقترح.',
  ].join('\n');
}
