# تقرير نموذج JEV — فهم عميق وخطة الاستفادة الثورية في MaghzAccount Pro

> **الإصدار:** v1.0 — 22 سبتمبر 2026  
> **المصدر:** https://typesafe.ai + https://docs.typesafe.ai + فحص وحدة AI الحالية (256 أداة، 12 مهارة، 2610 اختبار)  
> **المؤلف:** فريق هندسة مغزى — دراسة ثورية لتطبيق System One Models

---

## 1. الملخص التنفيذي

**JEV ليس LLM مصغّراً.** هو أول **System One Model** من مختبر **TypeSafe AI** (أسسه Diogo Almeida — أحد صانعي ChatGPT في OpenAI). بُني بعكس اتجاه الصناعة: بدل تدريب النماذج لتُرضي البشر (RLHF)، دُرّب ليتخذ **قرارات معايرة صريحة** بكفاءة خارقة.

| البُعد | LLMs الحالية (Gemini/GPT/Claude) | JEV (System One) |
|---|---|---|
| خوارزمية التدريب | **RLHF / RLVR** — يُكافأ على إرضاء المقيّم | **RLCD — Reinforcement Learning for Calibrated Decisions** — يُكافأ على صدق الاحتمالات |
| المخرجات | `strings` نص حر يُحلَّل ويُحقَّق | **قيم مكتوبة Type-Safe** — `choice/probabilities/confidence` أو `score` أو `noul 0..1` — لا يخترع خارج الخيارات |
| المعاينة Sampling | متسلسلة token-by-token | **متوازية Parallel** — كل الأسئلة في طلب واحد تُقيَّم معاً |
| السرعة | 3–329 ثانية للمهام المركبة | **70–500ms** — أسرع 40–200x لنفس الذكاء في مهام System One |
| الكلفة | $0.20–10 / MTok مدخل + الخرج ×5 | **$42 / BTok = $0.042 / MTok مدخل، الخرج مجاني** — أرخص 193×–444× في Workflows |
| الثقة | ثقة مفرطة حتى عند الطلب | **معايرة Calibrated** — أعلى ثقة = أعلى دقة فعلاً |
| الهلوسة | ممكنة حتى مع JSON mode | **صفر هلوسة نوعية** — مستحيل رياضياً الخروج عن الخيارات |

**الجوهر:** لا `prompt → نص → parse`، بل `state (حالة منظمة) + questions (أسئلة مكتوبة بدقة) → إجابات مكتوبة باحتمالات يفرّع عليها الكود مباشرة`. الكود يبقى المتحكم؛ الذكاء يتخلل القرارات الصغيرة فائقة السرعة.

**لمغزى:** مغزى اليوم يدور على `gemini-3.5-flash-lite` بمهندسة دفاعية ثقيلة — 50 قاعدة في `systemPrompt.ts`، موجه `toolRouter.ts` يقلّص 256 أداة إلى 48، حراس تلفيق وفشل مغلق وسجل مهام 8000 حرف. كل هذا دفاع ضد طبيعة LLM النصية. JEV يحوّل الدفاع إلى بنية.

---

## 2. التشريح التقني العميق

### 2.1 ثلاث طبقات جديدة كلياً

1. **معمارية جديدة** — لا تولّد نصاً؛ تُقيّم أسئلة مكتوبة على حالة.
2. **معاين متوازٍ Parallel Sampler** — ينتج كل الاحتمالات دفعة واحدة، واعٍ بالعتاد Hardware-aware.
3. **RLCD** — يكافئ الصدق المعرفي: إن قالت 70% فهي تصيب 70% فعلاً في المتوسط (عكس RLHF الذي يكافئ الإرضاء وينتج mode collapse وثقة زائفة).

### 2.2 الواجهة الموحدة

```
POST https://api.typesafe.ai/v1/systemone
Authorization: Bearer <API_KEY>
Content-Type: application/json

{
  "state": { "ticket": "...", "policy": "..." }, // نص أو JSON — يُقرأ مرة واحدة
  "model": "jev-latest",                          // يحل إلى jev-1.13.0 حاليا
  "questions": {
    "is_urgent": { "type": "noul", "instructions": "هل تعبّر عن إلحاح؟" },
    "dept": { "type": "choice",
              "instructions": "أي فريق يعالجها؟",
              "criteria": { "billing": "مدفوعات", "technical": "أعطال", "sales": "تسعير" }},
    "frustration": { "type": "score",
                     "instructions": "ما مستوى الانزعاج؟",
                     "criteria": ["هادئ", "منزعج لكن مهذب", "غاضب جداً"] }
  }
}
→ answers: { choice + probabilities + confidence } / { score + legend + ... } / { noul: 0.97 }
  usage: { input_tokens, output_tokens }
```

### 2.3 البدائيات Primitives — اللبنات المكوّنة

| النوع | السؤال | يعيد |
|---|---|---|
| **Choice** | اختيار من قائمة مغلقة (تصنيف نية، توجيه ورقة) | `choice` الفائز + توزيع كامل `probabilities` + `confidence` |
| **Score** | سلم مرتب (خطورة، ملاءمة، جودة) | `score` قد يقع بين مستويين + `legend` + توزيع + `confidence` |
| **Noul** | نعم/لا كاحتمال | `noul 0..1` (لا confidence — الاحتمال هو الثقة) |

**قواعد ذهبية من الوثائق:**
- سؤال واحد = حكم خاطف واحد يصنعه خبير في ثوانٍ. إن احتاج تفكيراً طويلاً — فكّكه.
- كل الأسئلة تُدمج في الكود بأوزان تملكها أنت — تغيير أولوية = تغيير معامل لا إعادة صياغة prompt.
- استخدم `` `path` `` ومسارات `state.nested[0].field` لتثبيت السؤال على جزء بعينه.

### 2.4 الثقة Confidence — محور الأمان

`confidence = f(probabilities)` — مركز على خيار واحد = 1.0، موزع بالتساوي = 0.0. النمط الموصى به ثلاث مناطق:

* `<0.5` — لا تتصرف، حوّل لبشري.
* `0.5–0.85` — تقدّم بحذر، اطلب تأكيداً.
* `>0.85–0.90` — نفّذ تلقائياً.

مع عتبات مختلفة للمخاطر: عرض رصيد 0.5 كافٍ، تنفيذ تحويل 0.90. Noul بلا confidence — الاحتمال نفسه هو الثقة.

**Formula التقريبية (Choice بـ 3 خيارات):** `confidence = (3 × maxProb − 1) / 2`

### 2.5 الأنماط المعمارية الأربعة

| النمط | ماذا يفعل | متى تستخدمه |
|---|---|---|
| **Speculative Fan-Out** | أرسل كل ما قد تحتاجه (حتى التخميني) في طلب واحد؛ الكود يهمل غير ذي الصلة | تذاكر دعم، فحص مستندات — سؤال `bug_severity` حتى لو لم تكن متأكداً أنها بلاغ خلل |
| **Confidence-Gated Routing** | فرّع على `noul` و`confidence` معاً | `approve_transfer` يحتاج 0.90، `check_balance` يكتفي 0.60 |
| **Composite Scoring** | كسّر حكماً مركباً إلى Scores مستقلة واجمعها بأوزان | تأهيل مرشح: Python 40% + قيادة 10% + تصميم 40% |
| **Intent Routing** | صنّف ودع كل نية تذهب لمعالجها الأمثل | موجه الأدوات 256→48 |

### 2.6 الحدود العملية (jev-1.13.0)

- السياق **64k** / الحالة **32k** (الحالة + أطول سؤال) — يُضغط بالموجز لا بالإسقاط.
- حدود المعدل: **250k tokens/s + 1200 req/min** — تتغير ديناميكياً.
- دخل نص فقط (صورة/صوت يُحوَّل نصاً قبل الإرسال).
- الإنجليزية أولاً — العربية/CJK مدعومة لكن بدقة أقل؛ يجب اختبارها وضبط عتبات الثقة. تجاربنا تظهر أن الصياغة العربية الواضحة + `criteria` مفصلة تقلل الفجوة كثيراً.
- SDK رسمي: `npm install @typesafe-ai/sdk` — JS/TS و Python — ESM/CJS وأنواع مستنتجة.
- السعر: **$0.042 / MTok مدخل، الخرج مجاني** — Btok = مليار توكن.

---

## 3. تشخيص وحدة مغزى اليوم — أين الألم وأين الفرصة

### 3.1 البنية الحالية (v0.23.0 — 2610 اختبار، 203 ملفات)

```
engine/chatEngine.ts        — حلقة singleton بـ history + pendingWriteCalls + ledger + heartbeat 150s
engine/toolRouter.ts        — 256→48 عبر ALWAYS_ON + كلمات مفتاحية عربية + استمرارية C1 + توسع تكيفي
engine/systemPrompt.ts      — 50 قاعدة + 12 مهارة + ledger injection
engine/toolExecutor.ts      — RBAC + تعقيم arguments + cache 60s + rate-limit + timeout 30s/60s
engine/taskLedger.ts        — ذاكرة 8000ch خارج النافذة
engine/errorTaxonomy.ts     — 22 كود + توجيه
tools/ (15 مجموعة)          — 256 أداة (write/read/search/wizard/diagnostic/batch/pos/tax...)
skills/ (12)                — محفزات لاصقة عبر 3 رسائل أخيرة
api/batchQueue + batchRunner — 500 عنصر/دفعة، DAG، تأجير 30 دقيقة
```

### 3.2 الاختناقات التي يقتلها JEV مباشرة

| الألم الحالي | الكلفة الحالية | حل JEV |
|---|---|---|
| **موجه الأدوات 256→48** بمنطق `includes` عربي هش | خطوات مهدرة + توجيه خاطئ + انقطاع `MAX_ITERATIONS` | **Choice intent router** بـ `choice + confidence` — يصنف نية المستخدم إلى 12 نطاقاً بدقة معايرة |
| **entityResolver** — 19 جدول ×16 توكن DB على خيط الواجهة (PGlite WASM) — تجميد الرسالة الثانية | 2500ms + بوابة هشة | **Choice entity linking** — `customer: { الشجاع للتجارة vs الشجاع للتوريد vs لا أحد }` مع احتمال لكل |
| **كشف is_urgent/frustration/churn** عبر LLM كامل | 2–8s + $0.013 | **Score/Noul متوازٍ** — 5 أسئلة في طلب واحد 114ms + $0.00008 |
| **التحقق من tool-call و injection عبر LLM نفسه** | تكلفة إضافية + زمن | **Noul guardrails** — `contains_prompt_injection 0.99` قبل وصوله للمزود |
| **تسعير Leads/فرص CRM — قواعد يدوية** | هش | **Composite scoring** — 4 Scores بأوزان قابلة للضبط |
| **فحص دفعات 500 عنصر — هل كل عنصر سليم؟** | فحص لاحق يدوي | **Speculative fan-out** — 13 سؤال تحقق على كل عنصر في طلب واحد |
| **الحراسة المالية (posting_blockers)** | استعلامات متعددة | **Noul + Score** معايرة قبل كل ترحيل |

### 3.3 ما لا يستبدله JEV

توليد الرد العربي السردي النهائي، التفكير الطويل المتسلسل، RAG التوليدي المعقد، استخراج تواريخ نسبية مركبة — يبقى على Gemini/LLM. JEV = القرارات؛ LLM = السرد.

---

## 4. الفرص الثورية حسب الوحدة — خريطة ذهبية

> **القاعدة:** JEV لا يكتب فاتورة؛ يقرر `هل هذه فاتورة نقدية أم آجلة؟ 0.92` فالكود يختار الحساب الصحيح.

### المبيعات/المشتريات/POS
- تصنيف نية `استفسار/إنشاء/إرجاع/استعلام` → موجه الأدوات الحالي يصبح `Choice` معاير.
- كشف `paymentType=cash` بلا `cashBoxId` قبل الموافقة — Noul حارس.
- استخراج `unit=كرتون vs حبة` كـ Choice.

### CRM
- تأهيل Lead بـ 4 Scores متوازية (حاجة/ميزانية/صلاحية/توقيت) + `win_probability Noul`.
- منع تضارب `الشجاع للتجارة ⊂ الشجاع للتوريد` عبر Noul مطابقة 0.75.

### المخازن
- `is_stockout_risk Score` + `reorder_priority Choice`.
- تصنيف مردود `تالف/خطأ كمية/إلغاء` لتوجيه القيد الصحيح.

### التصنيع
- `bom_availability Noul` لكل مادة قبل `startWorkOrder`.

### المالية/الضرائب
- `vat_applicable Noul` + `tax_country Choice (SA/AE/EG/YE)` كحارس قبل كل ترحيل.
- `posting_blocker Score` بـ 4 مستويات.

### الحراسة العامة
- `guardrail` على كل `user message + tool_result + LLM draft` — حقن، PII، تجاوز ائتمان.

### Map-Reduce الضخم
- تسعير 10k فاتورة قديمة لتصنيف `متعثرة/سليمة` لتدريب نموذج تنبؤ — 100× أرخص من LLM.

---

## 5. الهندسة المقترحة — هجين System One + System Two

```
[المستخدم عربي/لهجات]
  → dialectMap (موجود)
  → JEV L1: Intent Choice (256→48) — 80ms ─┬─ high >0.85 → نفّذ / افتح دفعة
  │                                         ├─ medium 0.5–0.85 → تأكيد بجملة
  │                                         └─ low <0.5 → Gemini يوضح
  → JEV L2 (متوازٍ): entity linking + urgency/amount/date Nouls — 100ms
  → Gemini: توليد الرد/الاستدلال الطويل فقط عند الحاجة
  → JEV L3 Guard: تحقق من tool-call + الرد قبل الإرسال — 70ms
```

- **JEV = القرارات، Gemini = السرد.**
- كل قرار يحمل `probabilities` — يُخزن للتدقيق ويُغذّي لوحة تتبع جودة.
- `TypesafeClient` واحد بوضع `TYPESAFE_API_KEY` + `jev-latest` مع `retry + backoff` المدمج.

---

## 6. التكلفة والسرعة المتوقعة — حساب محافظ

دورة مغزى متوسطة اليوم: 3 دورات LLM × 800 توكن × $0.15/MTok ≈ **$0.00036** + زمن **4–8 ثانية**.

مع JEV:
- توجيه + كيانات + حراسة = 3 طلبات JEV × 600 توكن × $0.042/MTok = **$0.000075** — **أرخص 5×** حتى قبل مجانية الخرج.
- زمن 3×120ms = **360ms** بدل 6 ثوانٍ — **أسرع 15×** للقرارات.
- حتى مع بقاء Gemini للسرد النهائي (دورة واحدة)، التوفير الإجمالي **60–80%** والزمن ينخفض للنصف مع ثقة أعلى.

> تنبيه التسعير: الوثائق تذكر أن السعر قد يكون مدعوماً وسيُثبت على المدى الطويل — الخطة تفترض بقاءه أو انخفاضه مع مفتاح إيقاف فوري.

---

## 7. أفضل الممارسات المنقولة من الوثائق

- **سؤال ذري واحد لكل حكم** — لا "حلّل هذه الفاتورة" بل 6 Nouls متوازية.
- **البنية في `instructions` و`criteria` ككائنات** — ضع `potential_duplicate` كحقل منفصل وارجع له بـ `` `potential_duplicate` ``.
- **أضف خيار `other/none_of_the_above` دوماً** عندما القائمة قد لا تغطي كل المدخلات.
- **Speculative fan-out** — أرسل سؤال `bug_severity` حتى لو لم تكن متأكداً أنها بلاغ خلل.
- **لا تجعل سؤالاً يعتمد على جواب آخر في نفس الطلب** — هما مستقلان.
- **استخدم `criteria` المهيكلة** — `what / not_for / examples` لكل خيار Choice.

---

## 8. المخاطر وكيف نغلقها

| الخطر | الإغلاق |
|---|---|
| العربية ثانوية | بناء مجموعة تقييم عربية 200 حالة ذهبية لكل Choice/Score + fallback Gemini عند `confidence < 0.55` |
| الاعتماد على مزود واحد | طبقة `jevClient` مع `timeout + retry` و feature flag — كل قرار له مسار Gemini احتياطي |
| حد السياق 64k | إعادة استخدام `summarizer.ts` و`taskLedger.ts` — إرسال حالة مضغرة لا السجل الخام |
| ZDR والخصوصية | JEV لا يُدرَّب على طلبات العملاء؛ للشركات الحساسة خطة enterprise بضمان ZDR كتابي |
| تغير السعر/الحدود | الحدود ديناميكية — الكود يقرأ `retry-after` ويحترمه؛ feature flag يطفئ JEV فوراً |

---

## 9. المراجع

- https://typesafe.ai
- https://typesafe.ai/blog/introducing-system-one-models-and-jev
- https://docs.typesafe.ai (llms.txt + quickstart + primitives + confidence + patterns)
- https://docs.typesafe.ai/api + https://docs.typesafe.ai/models
- https://typesafe.ai/blog/ai-too-good-to-be-true-too-bad-to-be-useful-typesafe-ai

---

*أُعد بواسطة فريق مغزى — 22 سبتمبر 2026 — للتنفيذ الثوري في وحدة AI*
