# 🔍 التقرير الشامل لفحص وإصلاح وحدة الذكاء الاصطناعي — maghzaccount-pro

> **تاريخ الفحص:** 2026-09-11 | **المنهجية:** 8 بعثات تدقيق عميق متوازية (محرك الدردشة، الطوابير، أدوات الكتابة، أدوات القراءة، مكونات الواجهة، طبقة Electron، تدفق الوحدات، صلاحيات 119 أداة قراءة)
> **النطاق:** 130+ نتيجة موثقة بمواقع الملفات والأسطر
> **حالة التنفيذ:** ✅ مكتمل بالكامل — المراحل 0→4 (انظر "سجل التنفيذ" في الأسفل)

---

## نتائج التحقق النهائية

| الفحص | النتيجة |
|---|---|
| `tsc -b` | ✅ 0 errors |
| `vitest run` (كامل) | ✅ 168 ملفاً، 2113 اختباراً، 0 فشل |
| `npm run build` | ✅ built in ~27s (تحذيرات INEFFECTIVE_DYNAMIC_IMPORT الموثقة مسبقاً فقط) |
| دخان حي على PostgreSQL حقيقي (داخل ROLLBACK) | ✅ migration 0028 + lease claim/recover + floor guard + transfer E2E = 13/13 |
| e2e (غير مدمّرة، بلا reset) | ✅ 18-ai-chat 3/3 + 01-auth 4/4 |
| e2e الكاملة + `e2e:reset` | ✅ 90 passed + إصلاح خلل selector واحد (91/91 بعد الإصلاح — انظر أدناه) |

### دورة e2e الكاملة (2026-09-12)
1. نسخة احتياطية pg_dump لقاعدة التطوير (بيانات حقيقية: 1 شركة/1 مستخدم/8 عملاء/8 موردين/18 منتجاً/5 فواتير)
2. `e2e:reset` + بذر → مجموعة e2e الكاملة: **90 ناجح، 1 فاشل**
3. الفاشل (`14-crm switch-to-list-view`): **خلل selector في الاختبار لا في التطبيق** — زر `قائمة المستخدم` (أفتار الهيدر) يسبق زر التبديل في DOM فكان `.first()` ينقره. أُصلح بمطابقة تامة `^قائمة$` → **1/1 أخضر** (المجموع الفعلي 91/91)
4. استعادة pg_restore --clean + تحقق عدّادات (8/8 مطابقة) + إعادة تطبيق migration 0028 + `db:check` سليم

## سجل التنفيذ (ما طُبّق فعلاً)

### المرحلة 0 — الوحدات (طلب المستخدم المباشر)
- U1: `resolveUnitName` يحل الافتراضي من الكتالوج (حبة/Piece/PC) + توسيع JOIN في `ensureBaseProductUnit` بـ `name_en` (المسارات الثلاثة: api + RPC + shim)
- U2: مسار `unitName`/`unit` في سطور الفواتير الست (parseLines/LINES_SCHEMA/zod/resolveLineUnits)
- U3: مصالحة السعر/الكمية + رفض `unitPrice≤0` + `priceMismatchNotes` في نتائج الأدوات الست
- U4: البطاقة تعرض الوحدات (`summarizeDocLines` + حلال unitId في cardResolvers)
- U5: self-heal عبر `ensureBaseProductUnit` عند فراغ الوحدات
- U6: `create_product_unit` يقترح الأسعار بدل 0
- U7: `search.products` يعرض الوحدات الافتراضية + تنبيه التفسير
- M4: دعم الوحدات في التحويلات/التسويات/BOM/أوامر التشغيل (تحويل للأساسية + إفصاح)

### المرحلة 1 — P0 (9) + بوابات CI
- P0-1..P0-9: إعفاء رسالة النظام من سقف 20K، حظر send أثناء البطاقات + إدراج بعد الشريك، ترتيب update_branch، ترحيل السندات عبر postVoucher، التسوية draft+post، إعادة تقييد 4 أدوات قراءة، annotation المعرّف الأساسي، حجب كتل الداشبورد، تقسيم search.returns
- البوابات: promptBudget + قاعدة أدوات القراءة + schemaDrift glob + تكافؤ preload (أمسك انحراف `pos` فوراً) + aiGuards retention

### المرحلة 2 — P1
- المحرك: التقاط done-result + tc.id الحقيقي + فحص التلفيق عبر التاريخ + round-robin للموجّه + تصفير sessionId
- الطوابير: migration 0028 + claim×10 + حد الجولات الفارغة + TIMEOUT غير قابل لإعادة المحاولة للكتابات + إلغاء queued-only + حارس الاستئناف
- الأدوات: invoiceId، update_account dynamic-SET، transfer_stock عبر completeStockTransfer + floor ذرّي، حارس JE، عائلة الإسقاط الصامت، مفاتيح posting_blockers، join الأرقام البشرية، نوافذ 200، retention '0'، حارس sender

### المرحلة 3 — P2
- الطوابير: عكس cascade في retry + ذرّية مسار الفشل + total dedup + claim shape
- الواجهة: snapshot متزامن، regenerate نظيف، Set الصوتي، Escape، حراسة جديد/مسح + تأكيد، idempotency
- SQL: تجميعات HR server-side، quotations det+agg، date::date، استبعاد الملغاة، UTC محلي
- محاسبي: إفصاح vatUnset، حوارات balance/converted، صدق rollback، userId، حوارات المبالغ، حراس المردودات، COALESCE الشركة

### المرحلة 4 — P3
- parity drifts، backoff، سقف result_data (اقتطاع بدل تصفير)، escaping `$`، حراسة JSON.parse، a11y/i18n (زوايا RTL، TTS، جداول، clipboard، aria، blob، بحث الدرج، ref-effect، مفاتيح)، entityResolver مغلق + توحيد cashBox، كتالوج التنقل

### اكتشافان حرجان أثناء التنفيذ (مثبتان حياً على PG)
1. **ظهر `1/0` الثابت يُطوى في التخطيط** — الحارس الأصلي كان سيُجهض كل تحويل. أُبدل بمقام معتمد على البيانات (مثبت: يُجهض عند النقص ويمر عند الكفاية + تحويل حي كامل 5/5)
2. **قارئ CTE الخارجي يرى snapshot البداية** — تحقق الدخان الأول كان خاطئ المنهجية؛ الإنتاج (قراءة عبر مخرجات CTE) سليم ومثبت


---

## الملخص التنفيذي

| المؤشر | العدد | الملاحظة الحاسمة |
|---|---|---|
| **P0 — حرجة** | **9** | وحدة AI في Electron **معطّلة بالكامل** حالياً + ثقوب سلامة دفاتر + تسريب بيانات HR |
| **P1 — عالية** | **24** | فساد بروتوكول المحادثة، إلغاء الدفعات لا يعمل، ازدواج كتابات مالية |
| **P2 — متوسطة** | **~45** | إسقاط صامت لحقول، بوابات CI عمياء، نوافذ بحث تقصّ أصنافاً قديمة |
| **P3 — منخفضة** | **~55** | انحرافات parity، تسريبات ذاكرة صغيرة، a11y |

**الاكتشافان البنيويان الأهم:**
1. **مسار Electron لم يكن ضمن أي اختبار** — كل الفحصات الأخيرة كانت على مسار المتصفح (browserBridge) الذي لا يطبق نفس التحققات. النتيجة: وحدة AI في سطح المكتب ميتة بالكامل (P0-1) ولم يكتشفها أحد.
2. **عقود الأدوات (tool → API) بلا بوابة** — انحرافات ترتيب وسائط وأسماء حقول تنجح في الاختبارات لأن الـ mocks تُطابق الأداة لا الـ API الحقيقي.

---

## 🔴 النتائج الحرجة P0 (9)

### P0-1. وحدة AI في Electron ميتة بالكامل — سقف الرسائل يرفض النظام
- **الموقع:** `electron/aiHandler.js:400-407` مقابل `systemPrompt.ts:211-242`
- `isValidMessages` يرفض أي رسالة نصية > 20,000 حرف. البرومبت المُركَّب فعلياً = **~22,000 حرف قبل أي أداة** (قواعد 8,639 + مهارات always-on ~8,750 + مسرد + نموذج محاسبي) و**~29,200 مع جرد الأدوات**.
- **الأثر:** كل طلب `ai:complete` و`ai:start-stream` في سطح المكتب يُرفض برسالة مضللة `messages must be a non-empty array`. مسار المتصفح بلا هذا التحقق — لذلك لم يكتشفه أي اختبار.
- **الإصلاح:** إعفاء رسالة النظام من فحص الطول (أو سقف 40K) + رسالة خطأ صادقة + بوابة CI تحسب حجم البرومبت المُركَّب.

### P0-2. `send()` غير محجوب أثناء بطاقات التأكيد → فساد بروتوكول دائم
- **الموقع:** `chatEngine.ts:403-407` (الحراسة الوحيدة `isProcessing`، و`finally:546-549` يصفّرها والبطاقات معلّقة)
- المستخدم يكتب رسالة جديدة بينما `assistant(tool_calls)` معلّق **بلا نتيجة tool** → مسار thought_signature يرسل `assistant(tool_calls)` يتبعها `user` → **رفض 400 من المزوّد للأبد** (الجلسة تموت حتى `reset()`)؛ ومسار flatten يجعل النموذج يعيد نفس الكتابة → **بطاقة ثانية لنفس العملية المالية**.
- **الإصلاح:** حظر الإرسال عند `pendingWriteCalls.length > 0` (toast صادق) أو حلّ البطاقات تلقائياً + إدراج نتائج tool بعد شريكها المباشر لا في الذيل.

### P0-3. `settings.update_branch` — ترتيب وسائط معكوس → صمت كامل مع نجاح كاذب
- **الموقع:** `writeTools/settings.ts:109` — يستدعي `updateBranch(branchId, ctx.companyId)` والتوقيع الحقيقي `(companyId, id)` في `core/api.ts:204`. UUID يمر عبر validation → `WHERE id = <companyId>` → **0 صفوف تُعدَّل أبداً** والنتيجة `{updated: true}`.

### P0-4. ترحيل السندات عبر الوكيل يقلب الحالة بدون قيد محاسبي
- **الموقع:** `writeTools/accounting.ts:754, 777` — يستدعي `updateVoucher({status:'posted'})` (UPDATE عاري) بدل `postVoucher()` الحقيقي (`accounting/api.ts:554-626`) الذي يبني JE + يحرك رصيد الطرف + يطبق الدفعة.
- **الأثر:** سند "مرحّل" في كل القوائم **بلا أثر في دفتر الأستاذ**.

### P0-5. `create_stock_adjustment` بـ `status:'posted'` — يتجاوز خط الترحيل كلياً
- **الموقع:** `writeTools/inventory.ts:246-258` — INSERT عاري بلا `stock_movements` ولا JE ولا تحديث رصيد (`postStockAdjustment` في `inventory/api.ts:909-962` هو الحقيقي). والصف لا يمكن ترحيله لاحقاً.

### P0-6. تسريب بيانات HR/Inventory لأي حائز `ai.use`
- **الموقع:** `readTools.ts:501, 526, 566, 608` — أربع أدوات (`inventory_valuation`, `employee_payroll_history`, `attendance_summary`, `end_of_service`) مقيدة بـ `ai.use` فقط. `sales_rep` يسأل "اعرض رواتب كل الموظفين" فيحصل عليها.

### P0-7. `resolveOutputId` في الدفعات — "أول مفتاح ينتهي بـ Id" يربط المرجع بالكيان الخطأ
- **الموقع:** `batchQueue.ts:217-223` — نتيجة `{customerId, invoiceId}` تربط `@ref` بأول مفتاح. ربط سند بفاتورة خاطئة = **فساد بيانات**.

### P0-8. `reports.dashboard` يكشف `totalPayrollAmount` (رواتب!) عبر `reports.view` بلا `hr.view`
- **الموقع:** `reportTools.ts` — كتلة HR في الداشبورد تستدعي `hrApi.getHrKpis` بلا حارس صلاحية. نفس الحال لكتلة التصنيع.

### P0-9. `search.returns` يبحث في مردودات المبيعات والمشتريات معاً عبر `sales.view` فقط
- **الموقع:** `searchTools.ts:765-776` — يكشف أسماء الموردين وحالات ومبالغ مردودات المشتريات لحائز `sales.view` فقط.

---

## 🟠 النتائج العالية P1 (24)

### أ) بروتوكول المحادثة (chatEngine)
| # | الموقع | العيب |
|---|---|---|
| 1 | `chatEngine.ts:1284-1339` | **نتيجة done للبث تُهمل** عند وصول أي chunk — انقطاع 90s من المزوّد يُقدَّم كرد ناجح كامل (`finishReason: null`) — تقارير مالية مقطوعة تبدو سليمة |
| 2 | `chatEngine.ts:1549-1576` | حارس التكرار يدفع نتائج tool بـ **tool_call_id مُختلق** (`exhausted-<ts>`) → رفض 400 دائم في مسار signature — الحارس نفسه يقتل الجلسة |
| 3 | `chatEngine.ts:1449` | حارس التلفيق **محصور بـ send()** — تلخيص صادق لعملية حقيقية من دور سابق يُحذف ويُحقن تصحيح كاذب → النموذج يعيد الكتابة → **مستند مكرر** |
| 4 | `toolRouter.ts:200-202` | السقف 48 يقتطع **بترتيب التسجيل** — نية "تقارير" تختار 150+ أداة فتُقصّ hr/crm/manufacturing التي وجهتها النية. القصّ صامت |
| 5 | `ChatPanel.tsx:53` + `persistence.ts` | **تسريب cross-tenant**: تبديل الشركة لا يصفّر `sessionId` → الحفظ التالي يُنشئ جلسة جديدة تحت الشركة الجديدة تحوي **كامل محادثة الشركة القديمة** |

### ب) نظام الطوابير (Batch)
| # | الموقع | العيب |
|---|---|---|
| 6 | `batchRunner.ts:216-288` | **الإلغاء لا يُحترم داخل chunk الـ 100** — حتى 99 كتابة مالية تستمر بعد "إلغاء"، تُسجَّل skipped (كذب في السجل)، وفشل `batchItemDone` يُهمل بصمت |
| 7 | `aiHandler.js:1345-1399` | **recover يفشل أصناف عامل حي** (بلا lease/liveness) — نافذة ثانية تقتل عناصر الأولى → الكتابة نُفِّذت لكنها مسجلة failed + **دوران 1.5s لانهائي** |
| 8 | `toolExecutor.ts:262-277` | المهلة **تهجر** الوعد ولا تلغيه + `TIMEOUT retryable:true` → إعادة تنفيذ كتابة ربما التزمت → **مستندات مكررة** |
| 9 | `aiHandler.js:910-923` + `browserBridge.ts:826` | **`retention_days='0'` (أبدياً) يُتجاهل** → حذف transcripts رغم إرادة المدير — في الطبقتين |
| 10 | `aiHandler.js:741-823` | إغلاق نافذة أثناء البث → **رمي مزدوج** (sender مدمّر) → unhandled rejection + اتصال مزوّد مسرّب (لا `controller.abort()`) |

### ج) أدوات الكتابة
| # | الموقع | العيب |
|---|---|---|
| 11 | `writeTools/sales.ts:309` | `invoiceId: str(...) \|\| ''` — مردود بلا فاتورة أصلية **مرفوض 100%** (uuid لا يقبل `''`) |
| 12 | `accounting.ts:507` + `api.ts:136-149` | `update_account` يعد بتحديث جزئي لكن الـ API **كتابة كاملة** → تعديل `isActive` فقط **يصفّر اسم/كود/نوع الحساب** |
| 13 | `wizardTools.ts:434-489` | `transfer_stock`: بلا `stock_movements`، SELECT-then-UPDATE بلا `WHERE quantity >= $1` (رصيد سالب)، غير ذرّي |
| 14 | `accounting.ts:605-611` | `delete_journal_entry` **بلا حارس posted** — أصغر من أمان الواجهة |
| 15 | `sales.ts:488` | `update_quotation.validUntil` مُسقط (الـ API يقرأ `expiryDate`) |
| 16 | `crm.ts:467` | `update_task.notes` مُسقط (zod strips + API لا يعرف notes؛ `complete_task` يربطها بـ description بشكل صحيح) |
| 17 | `manufacturing.ts:287-291` | `update_bom.status` مُسقط (لا عمود؛ `isActive` لا يُربط) |
| 18 | `settings.ts:70` | `update_company.taxId` مُسقط (الحقل `taxNumber`) |

### د) أدوات القراءة/التشخيص
| # | الموقع | العيب |
|---|---|---|
| 19 | `diagnosticTools.ts:129-149` | `posting_blockers` يفحص `default_ar/default_ap` — **مفاتيح غير موجودة** (الحقيقية `default_debtors/default_creditors`) → `canPost:false` لكل فاتورة سليمة |
| 20 | `detailedReportTools.ts:620-668` | `movements_by_party` يربط `sm.reference = si.id::text` والمرجع يخزن **أرقاماً بشرية** (INV-0001) → حقل party فارغ دائماً |
| 21 | `searchTools.ts:765-776` | `search.returns` يعمل `String(r.customer)` على **object** → بحث الاسم عاجز + `[object Object]` |
| 22 | `searchTools.ts:630,662,832` | سندات/حركات: نافذة **8 صفوف** فقط — أي سند أقدم "غير موجود" |

---

## 🟡 النتائج المتوسطة P2 (~45) — حسب الفئة

**الطوابير:**
- `retry-failed` لا يُلغي skip التابعين المُسقطين — فشل عابر واحد يقتل سلسلة كاملة نهائياً
- مسار الفشل (fail+doomed) غير ذرّي — نافذة انهيار تترك orphans لا يطالبها أحد
- إلغاء الدفعة أثناء كتابة جارية: العملية نُفِّذت لكنها مسجلة `skipped`
- `total_count` يُحسب قبل dedup → "متبقي" وهمي دائم
- `ai.resume_batch` أثناء عامل نشط يُبلَّغ "توقفت" وهي تعمل + إعادة استئناف بلا سقف يعيد تصفير attempts
- نتيجة done للبث (P1-1 أعلاه) — التقاطها قبل الوثوق بالـ chunks

**بوابات CI عمياء (السبب الجذري لتكرار نفس فئات الأخطاء):**
- `toolsContract` لا يفحص صلاحيات **أدوات القراءة** إطلاقاً (لهذا نجت P0-6)
- `schemaDrift` لا يمسح ملفات `writeTools/*` الثمانية المقسمة ولا `batchTools`
- لا بوابة تكافؤ بين `preload.js` و`preload.cjs` (الأول ينقصه `purgeOldSessions`)
- لا بوابة تكافؤ SQL بين `browserBridge` و`aiHandler`

**حسابات على نوافذ مرقّمة (نتائج صامتة خاطئة):**
- `quotations_detailed` يفلتر تواريخ client-side على 200 صف → صفر نتائج رغم وجود مئات
- `hr.employees_report` يحسب متوسط الرواتب على أحدث 200 موظف فقط
- `payroll_report` نافذة 50 مسيراً — الشهر المطلوب "يختفي" بعد 4 سنوات
- UTC-midnight يعيش في `AccountingService.ts:298,341` و`accounting/api.ts:1031` (فخ Phase 76 نُظّف من الأدوات ونجا في الخدمة)

**سلامة محاسبية:**
- مردودات/أوامر detailed تُدرج `cancelled` في الإجماليات
- `t.date BETWEEN` على `timestamptz` يستبعد مساء اليوم الأخير (سجل القيود + تشخيص التوازن)
- `update_invoice` يقبل `discountAmount/paidAmount` بلا إعادة حساب أو حارس دفع زائد
- `update_customer.balance` كتابة خام على مرآة مهجورة (المصدر = كشف الحساب منذ Phase 81)
- `crm.update_lead_status` يسمح `'converted'` مباشرة بلا إنشاء عميل — يفسد قمع التحويل
- `vatUnset` لا يُفصح عنه في نتائج الفواتير — ضريبة صفرية صامتة
- `update_return` (sales/purchases) بلا حارس posted مثل نظيره invoice

**الواجهة:**
- regenerate يكرر رسالة المستخدم في النص والسياق (كل نقرة نسخة)
- التعرف الصوتي يفقد المقاطع النهائية بعد إعادة تشغيل Chrome الصامتة (Set لا يُصفَّر)
- Escape يمسح النص **ويبقي المرفقات** (ترسل ملفات ظننت أنها حُذفت)
- دردشة جديدة/مسح بلا حراسة أثناء المعالجة + المسح بلا تأكيد
- `resolveConfirmation` غير idempotent — double-approve ممكن تحت تشبع الخيط
- سباق تبديل الجلسة مع الحفظ الجاري → محادثة سابقة قد لا تُحفظ أبداً (snapshot لا يُؤخذ عند in-flight)
- كتالوج التنقل: `/settings/ai` يتطلب `settings.view` بينما حارس المسار يطلب `ai.settings`

**تدقيق الصلاحيات الواسع (119 أداة قراءة) — إضافات:**
- `sales.vat_summary` يجمع VAT مشتريات عبر sales.view (قابل للنقاش → accounting.view)
- `settings.get_payroll_components` يكشف defaultAmount عبر settings.view (→ hr.view)
- `entityResolver` fallback متساهل `?? 'ai.use'` (يجب فشل مغلق) + عدم تطابق `cashBox` (settings.view في resolver مقابل accounting.view في search — والباحث يحمل `balance`!)
- `crm.sales_funnel` / `diagnose.posting_blockers` — قابلة للنقاش (توثيق أو تقييد مزدوج)

---

## 🧮 تدقيق الوحدات (طلب المستخدم المباشر) — الحقيقة المكتشفة

| الطلب | الحقيقة |
|---|---|
| "استخدم الوحدة الافتراضية للبيع/الشراء إذا لم يذكرها المستخدم" | **مُنفَّذ نظرياً** (`resolveLineUnits` في `writeTools/shared.ts:199` يفرّق sale↔purchase فعلاً) — لكن **3 فجوات تفسده عملياً** |
| "المساعد لا يضيف الوحدة التي ذكرها المستخدم للمنتج الجديد" | **مُصلَّح في الطبقة العليا** (Phase 98/100: `unit`+`unitName` يُحفظان في `products.unit` + صف `product_units` أساسي) — لكن **ثقب `piece` الصامت يكسر السلسلة** |

### الفجوات الثلاث:

**B1 — حرجة: `'piece'` الافتراضي لا يطابق الكتالوج أبداً**
- `writeTools/inventory.ts:26`: غياب الوحدة → `unit: 'piece'` حرفياً
- `ensureBaseProductUnit` يطابق `u.name_ar = p.unit OR u.code = p.unit` — الكتالوج يحوي `حبة/PC` وليس `piece`، و`name_en` **خارج الـ JOIN**
- **النتيجة:** كل منتج AI بلا وحدة مذكورة = **بلا صف `product_units` إطلاقاً** (INSERT صمت يُدرج 0 صفوف) → كل فاتورة AI له تسقط إلى factor=1 → **"كيس" يُخصم من المخزون كحبة**

**B2 — حرجة: `unitName` في سطور الفواتير يُسقط بصمت**
- `parseLines`/`LINES_SCHEMA`/zod `lineUnitFields` يقبلون **`unitId` فقط** (`shared.ts:141,160`)
- النموذج تعلّم من `create_product` أن `unitName` هو الطريق → يضعه في سطر الفاتورة → **يتبخر**
- **النتيجة:** "بِع له 3 كراتين" → 3 حبات بدل 36 — **فساد مخزون + فاتورة خاطئة**

**B3 — عالية: السعر/الكمية لا يُصالحان مع الوحدة المحلولة**
- `resolveLineUnits` يحلّ الوحدة ويحلّق factor/baseQuantity، لكن `lineTotal = qty × unitPrice` بسعر النموذج الخام
- `search.products` يعرض أسعار الوحدة الأساسية بلا معلومة الوحدة الافتراضية
- **النتيجة:** منتج افتراضه كرتون×12، النموذج يمرر سعر الحبة → الفاتورة تحاسب بالحبة والمخزون يُخصم بالكرتون — **12× الخطأ بصمت**

**فجوات مكملة:**
- **M1:** بطاقة التأكيد عمياء للوحدات (`summarizeDocLines` بلا وحدة، `cardResolvers` بلا حلال unitId)
- **M2:** مسار AI يتخطى الـ self-heal (`ensureBaseProductUnit` عند فراغ الوحدات — الواجهة تشفيه، الوكيل لا)
- **M3:** `create_product_unit` بلا أسعار → 0 بدل اقتراح `suggestUnitPrice`
- **M4:** أدوات التصنيع/التحويل/التسوية **بلا دعم وحدات نهائياً** (كمياتها ضمنياً أساسية)
- **M5:** `search.products` لا يعرض الوحدة الافتراضية للبيع/الشراء
- **M6:** كود ميت: `buildLineUnitSnapshot` غير مستخدم + تكرار `summarizeDocLines` بين shared/wizardTools

---

## ⚪ P3 (~55) — موجز
انحرافات parity الخمس بين aiHandler/browserBridge (claim shape، مواضع header flip، ثوابت hardcoded) • off-by-one في backoff (شريحة 5 دقائم لا تصل) • سقف result_data بـ 2KB يصفّر refs بعد restart • `String.replace` يفسد قيماً تحوي `$` • تسريب blob URL في الكاميرا • TTS بـ ar-SA (STT صُحح لـ ar-YE) • معاملات عربية لا تطابق enum إنجليزي في 5 أدوات بحث • جداول RichText/ToolCallCard تُسقط الخلايا الفارغة • aria مكرر في الإعدادات • `{ok:false}` envelope من `authenticateIpcSession` • `createdAt` Date مقابل string • NaN createdAt يقتل الحفظ • `cachedApiKeys` بلا انتهاء • rate limiter يحسب الفاشل ضد الحصة • `JSON.parse(r.args)` بلا try/catch • save-config مفتاح مسافة بيضاء يُتجاهل بصمت • e2e shim متخلف عن السطح الحقيقي

---

## ✅ ما تأكدت سلامته (نقاط قوة محفوظة)
- بنّاء VALUES في `batch-create` سليم (bug Phase 84 مُصلَّح ومتحقق في المسارين)
- `persistSession` ذرّي (BEGIN/COMMIT/ROLLBACK) مع ترتيب sort_order صحيح و`'[]'` للـ attachments
- claim CTE نمطي سليم (FOR UPDATE SKIP LOCKED + بوابة اعتماد + سقف محاولات)
- RBAC أدوات الكتابة محاذى ومفروض في المنفّذ + طبقة registry
- عزل البث بـ streamId + ملكية + maxTokens متطابق (10240)
- أولوية مفتاح API (stored > env) + مسار SQL كله مُعامل بـ casts صريحة
- `resolveLineUnits` يفرّق sale/purchase فعلاً + snapshot يُحفظ في المسارين
- `create_product` يتحقق من الوحدة بصوت عالٍ ضد الكتالوج (resolveUnitName)
- خريطة `ENTITY_PERMISSIONS` في entityResolver تغطي كل الـ 18 نوعاً

---

# 🛠️ خطة الإصلاح المعتمدة

## المرحلة 0 — الوحدات (طلب المستخدم المباشر)

| # | الإصلاح | الملفات | اختبار التثبيت |
|---|---|---|---|
| U1 | `piece` → حل من الكتالوج (`حبة` مع مطابقة `name_en='Piece'`) + **توسيع JOIN في `ensureBaseProductUnit`** بـ `OR u.name_en = p.unit` في المسارين (api.ts + dbHandler RPC + e2e shim) | `writeTools/inventory.ts`, `inventory/api.ts`, `electron/dbHandler.js`, `e2e/vite-e2e-plugin.ts` | smoke على PG: منتج AI بلا وحدة → صف `product_units` موجود |
| U2 | **مسار `unitName`/`unit` في السطور**: إضافتهما إلى `RawLine`+`parseLines`+`LINES_SCHEMA`+zod → `resolveLineUnits` يحل الاسم المطوَّع ضد `product_units` للمنتج، خطأ صريح عند الغموض | `writeTools/shared.ts`, `validation.ts` | سطر بـ `unitName:'كرتون'` → factor صحيح؛ غير معروف → خطأ موجّه |
| U3 | **مصالحة السعر/الكمية**: مقارنة `unitPrice` مع سعر الوحدة المحلولة عند `factor≠1` → تعليق تحذيري في النتيجة والبطاقة + رفض `unitPrice≤0` في `parseLines` | `writeTools/shared.ts` | سعر حبة + وحدة كرتون → تحذير ظاهر |
| U4 | **البطاقة تعرض الوحدات**: `summarizeDocLines` يعرض الوحدة المحلولة + `≈ بالأساسية`، و`cardResolvers` يضيف حلاً لـ unitId→اسم | `shared.ts`, `cardResolvers.ts` | بطاقة تحتوي "كرتون (×12)" |
| U5 | **الـ self-heal في مسار AI**: `resolveLineUnits` عند فراغ الوحدات يستدعي `ensureBaseProductUnit` مرة ثم يعيد الجلب قبل السقوط إلى factor=1 | `writeTools/shared.ts` | منتج قديم بلا صفوف → يشفي |
| U6 | `create_product_unit` بلا أسعار → `suggestUnitPrice` من المنتج بدل 0 | `writeTools/inventory.ts` | اختبار الافتراض |
| U7 | `search.products` يعرض `defaultSaleUnit`/`defaultPurchaseUnit` (اسم+factor) | `searchTools.ts` | اختبار الحقول |

## المرحلة 1 — P0 الحرجة (9) + بوابات CI فورية

| # | الإصلاح | اختبار التثبيت |
|---|---|---|
| 1.1 | إعفاء رسالة النظام من سقف 20K في `isValidMessages` + رسالة صادقة | **بوابة `promptBudget.test.ts`**: تركيب البرومبت الكامل < السقف |
| 1.2 | حظر `send()` عند بطاقات معلّقة + إدراج نتائج tool بعد شريكها | إرسال أثناء pending ← مرفوض + لا tool_calls يتيم |
| 1.3 | `updateBranch(ctx.companyId, branchId, ...)` | اختبار ترتيب الوسائط |
| 1.4 | `post_receipt/payment_voucher` عبر `accountingApi.postVoucher()` | smoke: JE يُنشأ + رصيد الطرف يتحرك |
| 1.5 | تسوية المخزون: create draft ثم `postStockAdjustment` | smoke: stock_movements + JE موجودان |
| 1.6 | إعادة تقييد 4 أدوات قراءة | قاعدة بوابة: أداة قراءة تلمس وحدة X ⇐ تتطلب X.view |
| 1.7 | `resolveOutputId`: annotation مفتاح أساسي لكل أداة منشئة | نتائج متعددة Ids ترتبط بالأساسي الصحيح |
| 1.8 | `reports.dashboard`: كتلة HR تُقيَّد بـ hr.view وقت التشغيل + كتلة التصنيع كذلك | اختبار: بلا hr.view ← لا رواتب |
| 1.9 | `search.returns` → تقسيم لأداتين بصلاحيتين | اختبار صلاحية كل نصف |

**بوابات CI (تُبنى فوراً في هذه المرحلة):**
1. `promptBudget.test.ts` — حجم البرومبت المُركَّب < سقف main
2. قاعدة أدوات القراءة في `toolsContract`: ممنوع `ai.use` وحدها (allowlist موثق) + خريطة جدول→صلاحية
3. `schemaDrift` → glob يشمل writeTools المقسمة + batchTools
4. بوابة تكافؤ preload (.js مقابل .cjs)
5. بوابة تكافؤ SQL browserBridge↔aiHandler

## المرحلة 2 — P1 (24)

**المحرك (5):** التقاط done-result للبث • حارس التكرار يحفظ `tc.id` الحقيقي • حارس التلفيق يفحص history قبل الاتهام • toolRouter يقتطع بالصلة ويسجل dropped • تصفير `sessionId` عند تبديل الشركة.

**الطوابير (5) — migration 0027 (معتمد):** أعمدة `claimed_by`/`claim_expires_at` + recover لا يقتل إلا الـ leases المنتهية • فحص header بين الأصناف + claim بدفعات صغيرة • سقف جولات فارغة يخرج • `TIMEOUT=retryable:false` للكتابات في مسار الدفعات • إلغاء الدفعة يقيَّد بـ queued.

**الأدوات (14):** invoiceId بلا `||''` • `update_account` dynamic-SET • `transfer_stock` عبر `completeStockTransfer` • حارس posted لحذف القيود • عائلة الإسقاط الصامت (validUntil/notes/status/taxId) • مفاتيح `posting_blockers` الصحيحة + resolution عبر getDefaultAccountId • join أرقام المستندات البشرية • أسماء search.returns • نوافذ البحث 200+ • retention `'0'` في الطبقتين • حارس sender المدمّر + `controller.abort()`.

**حالات النقاش (تُوثَّق وتُنفَّذ):** vat_summary→accounting.view • get_payroll_components→hr.view • entityResolver فشل مغلق + توحيد cashBox + إسقاط balance من بيانات المحلل • `/settings/ai`→ai.settings في الكتالوج.

## المرحلة 3 — P2 (~45)

- **الطوابير:** unskip التابعين في retry-failed (عكس cascade) • ذرّية مسار الفشل (transaction) • `total_count` بعد dedup • resume يحرس activeBatches • claim shape كاملة في main
- **الواجهة:** snapshot متزامن في `saveCurrentSession` • regenerate نظيف • تصفير Set الصوتي عند restart • Escape يمسح المرفقات • تعطيل جديد/مسح أثناء المعالجة + تأكيد • idempotency في `resolveConfirmation` (prune قبل await)
- **الحسابات → SQL aggregates:** متوسط رواتب، مسيرات بفلاتر month/year، quotations بفلاتر تواريخ server-side • `date::date BETWEEN` على timestamptz • استبعاد cancelled من المردودات/الأوامر
- **UTC:** تطهير `AccountingService.ts:298,341` + `accounting/api.ts:1031` (localToday)
- **المحاسبي:** إفصاح `vatUnset` • منع `update_customer.balance` و`'converted'` المباشر • فحص نتائج rollback الـ wizards بصدق • تمرير `ctx.userId` للإنشاءات • حوارات paidAmount/discountAmount • حارس posted في update_return

## المرحلة 4 — P3 + التحصين (~55)

- توحيد الـ parity drifts الخمسة (claim shape، مواضع bh، ثوابت مشتركة)
- backoff off-by-one + تمييز null/0 • سقف result_data (اقتطاع بدل تصفير) • escaping `$` في الاستبدال • `JSON.parse(r.args)` بأمان
- **دخان مسار Electron** (سكربت يشغّل aiHandler فعلياً ضد البرومبت الحقيقي — يغلق فجوة "كل اختباراتنا كانت مسار متصفح")
- a11y/i18n: زوايا RTL منطقية، TTS ar-YE، جداول لا تُسقط خلايا فارغة، aria المكرر، مفاتيح مفقودة
- **M4: دعم وحدات التصنيع/التحويلات/التسويات** (unitId/unitName على BOM/WO/transfer/adjustment)

## سلسلة التحقق لكل مرحلة
```
tsc -b → eslint --max-warnings=0 → vitest run (كامل) → build →
smoke حي على PG داخل ROLLBACK (لكل إصلاح محاسبي/SQL) →
e2e (sales/payment/batch/hr) → دخان Electron-path (مرحلة 1+4)
```

**النطاق الكلي: ~130 إصلاحاً + 10 بوابات CI + migration 0027**

---

*وُلّد هذا التقرير عبر فحص شامل بـ 8 بعثات تدقيق متوازية — كل نتيجة موثقة بمرجع ملف:سطر مع اقتباس كود فعلي.*
