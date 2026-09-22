# خطة تنفيذ JEV الثورية — MaghzAccount Pro

> **الحالة:** معتمدة للتنفيذ — 22 سبتمبر 2026  
> **النموذج:** `jev-latest` → `jev-1.13.0` — https://api.typesafe.ai/v1/systemone  
> **SDK:** `npm install @typesafe-ai/sdk` — `@typesafe-ai/sdk` (JS/TS)  
> **المنهج:** هجين System One (JEV للقرارات المعايرة) + System Two (Gemini للسرد)

---

## الرؤية

تحويل مغزى من **وكيل LLM ثقيل** (50 قاعدة دفاعية + 256 أداة + 3–8 ثوانٍ) إلى **نظام ذكاء هجين**: JEV يتخذ القرارات المهيكلة في 70–500ms بثقة معايرة، وGemini يولّد السرد فقط عند الحاجة. النتيجة: أسرع 15×، أرخص 60–80%، أدق وأكثر أماناً — مع الحفاظ على كل الضمانات المحاسبية.

---

## الهيكل المستهدف

```
src/modules/ai/jev/
  ├── jevClient.ts          # Singleton TypesafeClient + deadline + retry
  ├── jevConfig.ts          # قراءة المفتاح من settings + feature flags
  ├── jevToolRouter.ts      # Choice intent router (بديل/مكمل لـ toolRouter.ts)
  ├── jevEntityLinker.ts    # Choice مطابقة كيانات (بديل أسرع لـ entityResolver)
  ├── jevGuard.ts           # Noul حراسة (حقن + هلوسة + PII)
  ├── jevScoring.ts         # Composite scoring (CRM/مخازن)
  ├── jevPostingGuard.ts    # حراسة الترحيل المالية
  ├── jevMapReduce.ts       # دفعات ضخمة (Phase 5)
  └── jevMetrics.ts         # لوحة تتبع latency/cost/confidence

settings keys:
  ai.jev_enabled            boolean (default false)
  ai.jev_api_key            string (enc:v1: — نفس keyVault)
  ai.jev_router_enabled     boolean
  ai.jev_guard_enabled      boolean
  ai.jev_model              string (default jev-latest)
```

---

## المراحل الست — تسلسل ثوري بلا كسر

### المرحلة J0 — التأسيس + PoC القياس (3 أيام) ✅ هذه الحزمة

**الهدف:** إثبات الأرقام على بيانات مغزى الحقيقية قبل أي تغيير سلوكي.

**المهام:**
1. `npm install @typesafe-ai/sdk`
2. إنشاء `src/modules/ai/jev/jevClient.ts`:
   ```ts
   import { TypeSafeClient } from '@typesafe-ai/sdk';
   let client: TypeSafeClient | null = null;
   export function getJevClient(): TypeSafeClient | null {
     const key = getJevApiKey(); // من settings أو env TYPESAFE_API_KEY
     if (!key) return null;
     if (!client) client = new TypeSafeClient({ apiKey: key, timeout: 8000 });
     return client;
   }
   ```
   مع `deadlineOr 2s` و fallback صامت — إن فشل JEV → Gemini كالمعتاد.
3. `jevConfig.ts` — قراءة `ai.jev_*` من `settings` + `TYPESAFE_API_KEY` env، `isJevEnabled()`، `getJevModel()`.
4. سكربت `scripts/jev-poc.ts`:
   - 3 حالات ذهبية من مغزى: تذكرة دعم، طلب فاتورة عربي بلهجة يمنية، تأهيل Lead.
   - كل حالة: 5 أسئلة (Choice + Score + Noul) عبر JEV و Gemini — طباعة `choice/confidence/latency_ms/cost`.
   - يخرج جدول مقارنة + توصية عتبات.
5. إعداد `TYPESAFE_API_KEY` في `.env.local` (للتطوير) + حقل في `AiSettingsPage` (للإنتاج).
6. اختبارات `jevClient.test.ts` — null عند غياب المفتاح، deadline، fallback.

**معيار النجاح:** `p95 < 250ms`، `cost < 1%` من Gemini لنفس الأسئلة، `confidence` معاير.

**المخاطر:** لا شيء — لا يلمس الإنتاج.

---

### المرحلة J1 — عقل التوجيه (أسبوع) — أعلى عائد

**الهدف:** استبدال/تكميل `toolRouter.ts` (الـ `includes` العربي الهش) بموجه احتمالي معاير.

**التنفيذ — `jevToolRouter.ts`:**

```ts
// سؤال واحد Choice يصنف النية إلى 12 نطاقاً
const INTENT_CHOICE = {
  sales:       "إنشاء/استعلام فاتورة بيع، عميل، عرض سعر، مردود",
  purchases:  "فاتورة شراء، مورد، أمر شراء",
  inventory:  "مخزون، منتج، مستودع، جرد، كرتون/درزن",
  hr:         "موظف، راتب، حضور، إجازة، نهاية خدمة",
  crm:        "عميل محتمل، فرصة، مهمة، متابعة",
  manufacturing: "تصنيع، BOM، أمر تشغيل",
  pos:        "كاشير، وردية، إيصال",
  settings:  "إعدادات، ثيم، فرع، صندوق",
  accounting: "قيد، حساب، ميزان، سند قبض/صرف",
  tax:        "ضريبة، إقرار، فترة",
  reports:   "تقرير، تحليل، ملخص",
  navigation:"انتقال، افتح صفحة",
  smalltalk: "تحية، شكر، سؤال عام",
  other:     "لا ينتمي لأي مما سبق"
};

export async function jevRouteTools(
  userText: string,
  visibleTools: ToolDefinition[]
): Promise<{ tools: ToolDefinition[]; confidence: number; intent: string; probabilities: Record<string,number> }> {
  const client = getJevClient();
  if (!client || !isJevEnabled()) return fallbackRouter(userText, visibleTools);
  const res = await deadlineOr(
    client.systemOne({
      state: { userText, recentTools: recentCalledToolNames(...) },
      questions: {
        intent: { type: 'choice', instructions: "ما نية المستخدم الرئيسية؟", criteria: INTENT_CHOICE }
      }
    }), 1500, null, 'jev-router'
  );
  if (!res) return fallbackRouter(userText, visibleTools);
  // probabilities لكل نطاق → اختيار النطاقات التي تتجاوز 0.22
  // high >0.85 → مباشر، medium 0.5–0.85 → تأكيد، low <0.5 → Gemini يوضح
}
```

**التكامل:**
- `chatEngine.ts` يستدعي `jevRouteTools` قبل `routeToolsForCycle` — إن نجح JEV يستخدمه، وإلا fallback الحالي.
- `confidence` تُخزن وتُعرض في `jevMetrics` وتغذي القرار: `<0.6` يضيف سؤال توضيحي.

**Feature flag:** `ai.jev_router_enabled` — إيقاف فوري يعيد `toolRouter` القديم.

**الاختبارات:** 20 حالة ذهبية عربية (لهجات يمنية/مصرية/خليجية) — `intent` صحيح + `confidence > 0.7`.

---

### المرحلة J2 — الحراسة والتحقق (أسبوع) — يغلق الهلوسة

**الملف:** `jevGuard.ts`

```ts
export async function jevGuardCheck(
  text: string,
  context?: string
): Promise<{ verdict: 'safe'|'review'|'block', scores: Record<string,number> }> {
  // 3 Nouls متوازية في طلب واحد —Speculative fan-out
  // - contains_prompt_injection (هل يحاول توجيه النظام؟)
  // - citation_supported (هل الاستشهاد مدعوم؟)
  // - is_pii_exposure (هل يكشف بيانات حساسة؟)
  // Choice severity: { safe, review, block }
}
```

- يُستدعى بعد كل `LLM draft` وقبل كل `tool execution` — يغذي `errorTaxonomy` الحالية.
- يستبدل جزءاً من `claims.ts` الهش (regex `INV-`).

---

### المرحلة J3 — التسعير المركب (أسبوع)

**الملف:** `jevScoring.ts`

```ts
// تأهيل Lead بـ 4 Scores متوازية
const res = await client.systemOne({
  state: { lead, companyProfile },
  questions: {
    need:     { type: 'score', criteria: ["لا حاجة", "حاجة ضعيفة", "حاجة واضحة", "حاجة ملحة"] },
    budget:   { type: 'score', criteria: ["لا ميزانية", "محدودة", "كافية", "سخية"] },
    authority:{ type: 'score', criteria: ["لا صلاحية", "مؤثر", "صاحب قرار"] },
    timing:   { type: 'score', criteria: ["لا توقيت", "قريب", "فوري"] },
  }
});
const composite = 0.3*need/3 + 0.3*budget/3 + 0.25*authority/2 + 0.15*timing/2;
// الأوزان في settings.crm_weights — قابلة للضبط دون لمس prompt
```

- يغذي `taskLedger` ولوحة CRM مباشرة + يظهر في `resultCards`.

---

### المرحلة J4 — الضوابط المالية (أسبوع)

**الملف:** `jevPostingGuard.ts`

```ts
// قبل كل postInvoice/postVoucher/closeShift
// Noul: هل الفترة مقفلة؟ Score: posting_risk 0..3, Choice: vat_treatment
// confidence <0.75 → افتح diagnose.posting_blockers تلقائياً
```

- يمنع `cashBoxId` الصامت و`unit_cost` المختلط قبل الموافقة.

---

### المرحلة J5 — الذكاء على البيانات الضخمة (أسبوعان)

**الملف:** `jevMapReduce.ts`

```ts
// مر على 5000 فاتورة — كل 20 صفاً طلب واحد fan-out
// استخرج churn_risk, payment_delay_score كميزات لنموذج CatBoost محلي
// تشغيل ليلي عبر batchRunner الحالي
```

---

### المرحلة J6 — القياس والتعميم (مستمر)

- لوحة `jevMetrics` — `p50/p95 latency, cost/day, confidence histogram, human-override rate`.
- اختبار A/B — 10% حركة على JEV vs Gemini.
- توثيق عربي لعتبات الثقة لكل وحدة.

---

## خطة التنفيذ التفصيلية — الحزمة الحالية (J0+J1)

### الملفات الجديدة

| المسار | المحتوى |
|---|---|
| `src/modules/ai/jev/jevClient.ts` | Singleton + deadline + fallback |
| `src/modules/ai/jev/jevConfig.ts` | قراءة المفتاح + flags |
| `src/modules/ai/jev/jevToolRouter.ts` | Choice router + confidence gates |
| `src/modules/ai/jev/jevMetrics.ts` | تتبع latency/cost |
| `src/modules/ai/jev/index.ts` | barrel |
| `scripts/jev-poc.ts` | PoC قياس |

### التعديلات

| الملف | التعديل |
|---|---|
| `package.json` | إضافة `@typesafe-ai/sdk` |
| `src/modules/ai/engine/chatEngine.ts` | استدعاء `jevRouteTools` كطبقة أولى مع fallback |
| `src/modules/ai/api/providers.ts` | إضافة preset `typesafe` |
| `electron/aiHandler.js` | (لاحقاً) تمرير مفتاح JEV — ليس في J0 |
| `src/core/i18n/ar.json + en.json` | مفاتيح `ai.jev.*` |

### الاختبارات

- `src/modules/ai/jev/jevClient.test.ts` — 6 حالات
- `src/modules/ai/jev/jevToolRouter.test.ts` — 12 حالة ذهبية
- `scripts/jev-poc.test.ts` — (إن وجد مفتاح)

### معايير القبول

- `npm run build` أخضر
- `npx tsc -b` صفر
- `vitest` أخضر (الحزم الجديدة)
- PoC يطبع جدول مقارنة حقيقي عند وجود `TYPESAFE_API_KEY`

---

## المخاطر والتخفيف

| الخطر | التخفيف |
|---|---|
| العربية ثانوية | مجموعة تقييم عربية 200 حالة + fallback Gemini عند `confidence < 0.55` |
| مزود واحد | timeout + retry + feature flag — كل قرار له مسار احتياطي |
| سياق 64k | إعادة استخدام `summarizer` + `taskLedger` — حالة مضغرة |
| ZDR | لا تدريب على طلبات العملاء؛ enterprise ZDR عند الحاجة |
| تغير السعر/الحدود | قراءة `retry-after` + flag إيقاف فوري |

---

## ما بعد J1 — خارطة الطريق الكاملة

```
J0 (3 أيام) ──→ J1 (أسبوع) ──→ J2 (أسبوع) ──→ J3 (أسبوع) ──→ J4 (أسبوع) ──→ J5 (أسبوعان) ──→ J6 (مستمر)
 PoC          توجيه         حراسة        تسعير        ضوابط       Map-Reduce    قياس/A/B
              60% عائد     90% أمان     CRM         مالية       ضخم
```

كل مرحلة feature-flag مستقلة — يمكن شحن J1 وحدها للإنتاج دون انتظار البقية.

---

## المراجع

- https://typesafe.ai
- https://docs.typesafe.ai
- `src/modules/ai/engine/toolRouter.ts` (256→48 الحالي)
- `src/modules/ai/engine/chatEngine.ts` (الحلقة + الحساسيات)

---

*أُعد للتنفيذ الثوري — 22 سبتمبر 2026*
