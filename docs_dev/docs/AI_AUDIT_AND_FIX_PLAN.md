# 🔍 التقرير الشامل لفحص وإصلاح وحدة الذكاء الاصطناعي — maghzaccount-pro

> **تحديث 2026-09-24:** أُعيد تدقيق الوحدة على الحالة الحالية من `main` عند `21dd02e` وإصدار `package.json` `0.25.12`. أضيف في نهاية هذا الملف **تقرير إعادة التدقيق وخطة الإصلاح الحالية**؛ هذا القسم هو المرجع الأحدث، بينما محتويات التقرير الأقدم محفوظة كسجل تاريخي.

> **تاريخ الفحص الأصلي:** 2026-09-11 | **المنهجية الأصلية:** 8 بعثات تدقيق عميق متوازية (محرك الدردشة، الطوابير، أدوات الكتابة، أدوات القراءة، مكونات الواجهة، طبقة Electron، تدفق الوحدات، صلاحيات 119 أداة قراءة)
> **نطاق التدقيق الحالي:** اكتمل جمع الأدلة ساكنة، ثم بدأت تنفيذ Phase 0 مع اختبارات تحقق جزئية؛ ما زالت هناك أعمال ترحيل/اختبارات متبقية.
> **حالة التنفيذ الحالية:** Phase 0 قيد الإغلاق؛ تفاصيل ما نُفذ وما تبقّى موضحة في سجل التنفيذ الحالي.

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

---

# تحديث إعادة التدقيق — 2026-09-24

> **نطاق التحديث:** فحص قراءة فقط للـ AI Harness، JEV، Electron IPC، typed RPC، browser bridge، persistence، batch runner، الأدوات المالية، والاختبارات/CI.
> **الفرع والإصدار:** `main` / commit `21dd02e` / `package.json` `0.25.12`.
> **التحقق:** لم تُشغَّل الاختبارات أو `build` أو قواعد البيانات أثناء هذا التحديث. النتائج	static findings (قراءة ساكنة) وليست ادعاءات نجاح تشغيلية.

## 1. الخلاصة التنفيذية

البنية العامة قوية، لكن وحدة AI لا يمكن اعتمادها بعد في نشر مشترك أو Electron متعدد المستخدمين بسبب مسارات رقمية ومحاسبية تتجاوز الحواجز المركزية. أكبر المخاطر ليست في `runLoop`؛ فـ`MAX_ITERATIONS = 10` قائم ويعمل كحاجز. المخاطر الأهم هي:

1. raw SQL متاح في renderer.
2. custom IPC handlers لا تطبق RBAC بشكل موحد.
3. generic update يسمح بتحويل مستند إلى posted دون posting side effects.
4. tax/fiscal period enforcement يفتح عند فشل الاستعلام.
5. JEV posting guard يعرض warning ولا يمنع التنفيذ.
6. company/user scope غير محمي أثناء preamble وpersistence وlogout.
7. backup/restore لا تفرض envelope أو row-level tenant validation.
8. browser/Neon path لا يملك server-side authorization boundary موحداً.

**التوصية التشغيلية:** تعطيل AI writes وJEV posting في أي بيئة مشتركة حتى اجتياز Phase 0 وPhase 1.

## 2. المعمارية الحالية

```text
Chat UI
  ↓
ChatEngine
  ├─ systemPrompt + active skills + JEV fast path
  ├─ history + context window + task ledger
  ├─ tool router (48 advertised tools/cycle)
  └─ toolExecutor
       ├─ registry + danger level
       ├─ RBAC
       ├─ arg normalization
       ├─ rate limit
       ├─ timeout
       ├─ audit
       └─ tool.execute(context)
            ↓
        module API / service
            ↓
        Electron typed RPC أو BrowserBridge
            ↓
        PostgreSQL / PGlite / Neon
```

### نقاط القوة المحفوظة

- `src/modules/ai/engine/toolRouter.ts:26-27`: توجيه الأدوات بسقف 48.
- `src/modules/ai/engine/toolExecutor.ts:165-241`: مركز تنفيذي واحد للأدوات المعروفة.
- `src/modules/ai/engine/chatEngine.ts:1933-1953`: تصنيف fail-closed للأدوات غير المعروفة.
- `src/modules/ai/engine/batchQueue.ts:134-235`: dependencies للخلف فقط وDAG guard.
- `src/modules/ai/engine/chatEngine.ts:1853-1890`: anti-fabrication وglobal-completion guards.
- `src/modules/ai/engine/taskLedger.ts`: سجل المهمة خارج نافذة الرسائل.
- `src/modules/ai/engine/batchRunner.ts:147-163`: منع worker محلي مكرر لنفس batch.
- `src/modules/ai/jev/jevSearch.ts:341-355`: reuse أدوات البحث القائمة بدل كتابة SQL جديد.

هذه النقاط لا تعوّض غياب authorization على مسارات IPC المباشرة.

## 3. نتائج P0

### P0-1 — raw SQL في renderer

**الأدلة:**

- `electron/preload.cjs:58-61`
- `electron/preload.js:58-61`
- `electron/dbHandler.js:473-499`
- `electron/dbHandler.js:837-871`

`_exec` و`_execBatch` موصوفان داخلياً، لكن preload يعرّضهما فعلياً. `assertSqlAuthorized` يفحص اسم الجدول وpermission فقط ولا يشترط `company_id` أو affected-row tenant scope.

**أثر محتمل مؤكد من الكود:** renderer authenticated يمكنه محاولة قراءة/كتابة جداول مستخدمين، تعديل roles، الوصول إلى hashes أو audit logs، أو تشغيل query تعتمد على functions.

**الإجراء:** حذف السطح من preload. business code لا يستخدم raw SQL؛ ينتقل إلى typed RPC أو API موحد. لا يبقى fallback مكشوف.

### P0-2 — custom IPC يتجاوز RBAC

**المواقع:**

- `electron/dbHandler.js:3290-3367` — `sales.updateInvoice`.
- `electron/dbHandler.js:3454-3508` — `sales.updateQuotation`.
- `electron/dbHandler.js:3585-3651` — `sales.updateReturn`.
- `electron/dbHandler.js:1158-1229` — product unit create/update.
- `electron/dbHandler.js:2672-3018` — HR custom flows متعددة.

عدة handlers تستخدم `getSession` فقط ولا تستدعي `hasPermission` أو `assertSqlAuthorized` لكل statement.

**الأثر:** أي authenticated user قد يعرف channel وdocument ID يستطيع تجاوز route guards والواجهة وAI confirmation.

### P0-3 — posted status قابل للكتابة مباشرة

**الأدلة:**

- `electron/dbHandler.js:3300-3313`
- `electron/dbHandler.js:3330-3333`
- `electron/dbHandler.js:3472-3507`
- `electron/dbHandler.js:3613-3651`

generic update يسمح بـ`status`, `paidAmount`, `paymentType`, totals، وتعديل بعض headers من دون stock/COGS/JE/balance/tax-period pipeline.

**القاعدة المعتمدة:** `posted` لا يقبل من generic update. كل posting operation هي transaction واحدة تشمل state transition + posting effects.

### P0-4 — tax-period fail-open

- `src/modules/tax/engine.ts:94-127`
- `electron/dbHandler.js:371-446`

`tax_periods` غير مدرج في SQL table authorization rules، و`assertPeriodOpen` يعيد open عند query failure/authorization error.

**النتيجة المحتملة:** ترحيل داخل period مغلق إذا فشل query بدل رفضه.

**القاعدة:** query failure = block. `open` نتيجة صريحة من query ناجح فقط.

### P0-5 — JEV posting guard advisory فقط

- `src/modules/ai/engine/chatEngine.ts:2121-2143`: guard fire-and-forget يضيف badge إلى argsSummary.
- `src/modules/ai/engine/chatEngine.ts:708-710`: approval ينفذ الأداة.
- `src/modules/ai/engine/batchRunner.ts:360-370`: batch ينفذ الأدوات مباشرة.
- posting tool list يدوية لا تغطي كل operations.

`verdict: block` لا يمنع الموافقة ولا التنفيذ. لا يصح عرض JEV كطبقة posting protection قبل الربط الإجباري.

### P0-6 — AI company/user scope race

- `src/modules/ai/engine/chatEngine.ts:330-355`: scope check قبل awaits.
- `:386-415`: preamble awaits قبل التقاط epoch.
- `:2154-2190`: epoch يلتقط في `runLoop` متأخراً.
- `src/modules/ai/components/ChatPanel.tsx:51-56`: company effect أثناء request.
- `src/modules/ai/api/persistence.ts:95-120`: context يقرأ عند execution time.
- `src/modules/ai/engine/chatEngine.ts:1073-1107`: UI transcript لا ينتمي للمحرك scope.

قد يكمل طلب started under company A بعد تبديل company B، أو تحفظ queued persistence بيانات A تحت B.

### P0-7 — backup/restore cross-tenant path

- `electron/dbHandler.js:4280-4298`
- `electron/dbHandler.js:4300-4368`

Backup يعيد `users.password_hash`، وrestore يقبل raw rows دون manifest/checksum أو تحقق `company_id` لكل row. UI validation ليست boundary أمنية.

## 4. نتائج P1

### Tenant وRBAC

- Cross-company FK validation غير مفروض في sales, manufacturing, accounting, CRM, inventory, HR.
- optional ownership filters يمكن للم RPC أن يعرض كل سجلات الشركة بدل `.own`.
- `electron/dbHandler.js:162-173` و`src/modules/auth/store.ts:179-197` يقبلان wildcard `*` في custom role.
- تغيير دور أو صلاحيات لا يبطل جلسات users القديمة في كل المسارات.
- تبديل connection/company لا يبطل كل sessions والـ pending work.
- `browserBridge` و`neonHttpAdapter` يوفّران direct SQL path في browser؛ هذا ليس server-side RBAC موحداً.

### financial state races

- `src/modules/manufacturing/api.ts:833-1002,1005-1363,1510-1567`: status reads خارج locks، conditional updates ناقصة، وإعادة فتح completed orders ممكنة.
- `src/modules/inventory/api.ts:586-775`: transfers غير atomics أو delete/complete guards ضعيفة.
- `src/modules/inventory/api.ts:1018-1117`: stock adjustment double-post/recompute/period hazards.
- `electron/dbHandler.js:2801-3018`: HR direct RPCs قد تتخطى payroll/EOS/leave invariants.
- `src/modules/pos/api.ts:679-765`: shift ownership/cash-box/date validation تحتاج تثبيتاً.

### AI permission misalignment

`toolExecutor` يثق في permission المعلن فقط. أدوات posting قد تكون معلنة `create` أو `edit` رغم أنها تنفذ posting أو inventory/GL side effects. examples:

- `writeTools/accounting.ts`: receipt/payment/expense voucher + journal entry.
- `writeTools/inventory.ts`: `create_stock_adjustment` و`post_stock_adjustment`.
- `writeTools/manufacturing.ts`: `update_work_order_status`.
- `writeTools/hr.ts`: `post_payroll_run` وEOS status.

يلزم permission `*.post` صريح، وstrongest permission للـ composite tools.

### Batch/lifecycle

- `src/modules/ai/components/BatchProgressCard.tsx:320-349`: Resume يغير header فقط ولا يشغل worker.
- `src/modules/ai/engine/batchRunner.ts:387-396`: failed `itemDone` يخرج بلا release للـ siblings.
- `src/modules/ai/engine/batchQueue.ts:238-249`: backoff خمس دقائق بلا progress heartbeat؛ `ChatPanel.tsx:27-110` قد يعتبره stuck.
- `src/modules/ai/tools/batchTools.ts:100-103`: preflight يتجاهل required ID الناقص.
- `src/modules/ai/api/browserBridge.ts:583-656,1084-1134`: session/batch writes غير atomic.
- persistence fingerprint في `src/modules/ai/api/persistence.ts:75-87` لا يلتقط result-summary أو batchId إذا لم تتغير message length.
- `src/modules/ai/engine/chatEngine.ts:596-603,985-993`: boolean processing لا يمنع old finalizer من كبح operation جديدة.
- `src/modules/ai/api/index.ts:243-345`: stop لا settled فوراً عند pending provider promise.

### JEV transport/cache/context

- `api/jev-systemone.ts:40-80`: CORS `*`، بلا auth/session/rate limit/body limits.
- `src/modules/ai/jev/jevConfig.ts:109-115` و`jevClient.ts:70-76`: base URL قابل للقراءة من settings ويُمرر إلى browser SDK دون unified exact-origin validation.
- JEV لا يقرأ `ai.browser_disabled` في relay/direct path.
- JEV main proxy مختار لمجرد وجود `window.electronAI`، حتى في PGlite mode.
- `jevSearch.ts:70-93,146-153`: cache key بلا company/user/role، والـ cached probability يصبح `1.0`.
- `jevEntityLinker.ts:65-74`: duplicate names تُطمس إلى candidate واحدة.
- `chatEngine.ts:506-581`: JEV entity context يظهر UI لكنه لا يدخل history الفعلي المرسل للـ provider.
- `jevPostingGuard` لا يغطي args/results/كل batch items.
- prompt/skills تحتوي قواعد متعارضة: unified JEV search، search.* متكرر، VAT 15% قديم، December 31، وأكواد حسابات قديمة.

## 5. نتائج P2

- `tsconfig.app.json` يستثني tests، فلا تظهر أخطاء test contracts في build العادي.
- CI لا يغطي Electron JS، `api/jev-systemone.ts`، configs، أو coverage threshold.
- E2E AI لا تنفذ provider/stream/batch حقيقية، وتحتوي assertions ضعيفة.
- context limiting بالرسائل فقط، وليس token/byte budget؛ raw media يبقى في internal history.
- PDF scan لا يتحول إلى صور فعلية للـ model، وm4a/mp4/webm/ogg collapse إلى mp3 wire format.
- `jevMapReduce.ts` لا يتحقق من zero/negative/unbounded concurrency/chunk size.
- `jevMetrics.ts` global، تقديري، وليس tenant-scoped.
- `RANK_SHORTLIST` في `jevSearch.ts:283,432` لا يقص فعلاً لأن `Math.max(RANK_SHORTLIST, reordered.length)` يعيد كل النتائج.
- `perFamilyLimit` معرّف وغير مستخدم.
- `resetJevClient()` بلا production caller.
- بعض mocks/tests legacy و`getBanks` remnants تحتاج قرار حذف أو توحيد.
- نصوص hardcoded/mojibake وcontract descriptions لا تطابق guards الفعلية.

## 6. خطة التنفيذ المعتمدة

### Phase 0 — Emergency containment

**الهدف:** منع privilege escalation وfinancial bypass قبل أي تحسين UX.

1. حذف `_exec` و`_execBatch` من `electron/preload.cjs` و`electron/preload.js`.
2. إضافة permission gate لكل custom IPC handler.
3. استخراج company/user/audit identity من session فقط.
4. منع generic updates من تغيير posted financial state.
5. تحويل `tax_periods` و`accounting_periods` إلى fail-closed authorization.
6. إضافة row/tenant validation إلى backup/restore داخل main.
7. تعطيل JEV posting mode مؤقتاً إلى أن يصبح block قابلاً للتنفيذ.
8. إضافة security tests لاختبار viewer/custom role وسلطة renderer.

**قبول Phase 0:**

- لا raw SQL methods في preload.
- viewer لا يستطيع استدعاء sales/inventory/HR custom channels.
- لا يمكن تغيير دور مستخدم إلى super_admin من renderer.
- closed tax period يرفض posting في Electron وPGlite.
- restore يرفض cross-company row.
- blocked JEV write لا ينفذ.

#### Phase 0 — سجل التنفيذ الحالي (2026-09-25)
- ✅ أُزيل wildcard من renderer auth store و`core/services` ومنع دور مخصص قديم من منح `*`.
- ✅ أضيف generation boundary متزامن للـ AI: logout/user-company switch يوقف التوليد، يمسح history/ledger/attachments/.persistence queue، ويمنع نتائج batch المتأخرة من الكتابة بعد التبديل.
- ✅ حُمي backup/restore داخل main: تحقق company لكل row، parent references، manifest + SHA-256، واستبعاد/رفض password hashes.
- ✅ حُمي fiscal/tax periods في HR posting وPOS/fallback paths، وأصبح تاريخ الترحيل الفارغ/غير الصالح أو فشل الاستعلام fail-closed في `src/modules/tax/engine.ts` و`src/modules/accounting/yearEnd.ts`، وأُوقف partial sales posting RPC من preload/interface مع إبقاء unified transaction path.
- ✅ أضيف scoped restore-guard لـ `users`، وأصبح `resolveExistingUserId` scoped by company مع cache key tenant-aware، وقبل typed `accounting.createTransaction` `posted` مع `accounting.post` + balance/period gates.
- ✅ ضُبطت sales/purchases create APIs على draft فقط، وحُذف wildcard من نوع الصلاحية وعقد الاختبارات، وأضيفت regression tests مباشرة لسلوك raw tenant scope.
- ✅ **tranche typed-RPC المحاسبي (سلسلة إلى `postTransaction`):** نُقل ترحيل القيد الموجود إلى قناة `accounting.postTransaction({ id })` في `dbHandler.js` + `preload.cjs` + `preload.js` + `ElectronDB`؛ الـ handler يقرأ الـ company/user من session، ويقفل صف القيد بـ`FOR UPDATE`، ويقفل جداول الفترات، ويفرض status= draft + توازن + تاريخ صالح داخل `BEGIN/COMMIT/ROLLBACK`. `accountingApi.postTransaction` يتوجّه عبر `isElectronPg()` إلى القناة، ويفصل التاريخ بـ`toDateString` في fallback خارج Electron. أضيف `postTransaction` إلى e2e shim (مع إصلاح قوسين جعلا `ai` top-level)، وبوابة static في `preloadParity.test.ts` تمنع تكرار انهيار الـ shim. `sales.postInvoice`/`postReturn` typed channels تبقى **مرفوضة بالتحقق عمداً** إلى أن يتوحّد مسار الـ posting.
- ✅ **tranche typed-RPC للمشتريات (شريحة A1 — قراءات دفتر الموردين):** 6 قنوات `purchases.*` في `dbHandler.js` (`getSuppliers`, `getSuppliersPaginated`, `getSupplierById`, `getSupplierStatement`, `getApAging`, `getApAgingTotal`) + `preload.cjs`/`preload.js` + `ElectronDB` + e2e shim. `purchases/api.ts` يتوجّه عبر `isElectronPg()` إلى القناة ويحتفظ بمسار raw خارج Electron؛ الـ SQL مطابق حرفياً في المسارات الثلاثة. استُخرج حساب شرائح الأعمار إلى `bucketAgingLegs()` نقي مشترك بين المسارين (حدود الشرائح تعتمد ساعة المتصل لا قاعدة البيانات). `suppliers` ومبالغ `computed_balance` + كشف الحساب + الأعمار لم تعد SQL في الـ renderer.
- 🔍 **اكتشاف (يحتاج قرار مالك — لم أغيّره):** `receipt_vouchers`/`payment_vouchers` تحت قاعدة `accounting`، بينما كشف حساب المورد/العميل والأعمار **يجب** قراءتها. النتيجة: دور يملك `purchases.view` فقط (أو `sales.own` فقط مثل `sales_rep`) يُرفض على كشف الحساب والأعمار بـ `Permission denied`. السلوك **قائم على المسار raw أيضاً** (نفس `assertSqlAuthorized`)، فليس انحداراً من الترحيل، لكنه يمنع الأدوار الافتراضية المخصصة من الوصول. الخيار: توسيع `readPermissions` لتلك القاعدة على `purchases.view/own` و`sales.view/own` (توسيع قراءة على قناة raw أيضاً) — قرار نماذج صلاحية لا يُتخذ ضمن tranche.
- ✅ **التحقق بعد tranche purchases:** `vitest run` كامل = **`2789/2789`** في `217` ملف؛ purchases `34/34` (7 جديدة: توجيه القناة، عدّاد النافذة، not-found، شرائح الكشف، التجميع، **عدم السقوط إلى raw SQL عند رفض القناة**)، parity `5/5` (بوابة سطح purchases الجديد)، security `16/16`، accounting `66/66`. و`npm run lint` نظيف، `npx tsc -b --force` صفر، `npm run build` ✓ (25s)، `node --check` للـ main وكلا الـ preloads، `npm run db:check` نظيف. E2E: `06-suppliers` + `12-reports` (ومنه كشف حساب المورد الذي يمرّ عبر القنوات الجديدة) = **`13/13`**.
- ✅ **tranche typed-RPC للمشتريات (A2 — مستندات الفواتير/الأوامر/المردودات):** 11 قناة إضافية (`getInvoices`, `getOutstandingInvoicesForSupplier`, `getInvoicesPaginated`, `getInvoiceById`, `getOrders`, `getOrdersPaginated`, `getOrderById`, `getReturns`, `getReturnsPaginated`, `getReturnById`, `getPurchasesKpis`) ⇒ **17 قناة purchases** إجمالاً. الـ `*ById` تطوي سطور المستند في `json_agg` واحد (`lines`) فصار round-trip واحداً بدل اثنين، و`getPurchasesKpis` صف واحد بدل أربعة استعلامات متوازية — القيم متطابقة في المسارين.
- 🧪 **e2e جديد `e2e/23-purchases.spec.ts` (4/4)**: صفحات فواتير/أوامر/مردودات المشتريات + لوحة مؤشرات المشتريات. هذه أول تغطية e2e لهذه الصفحات، وهي تمارس القنوات الجديدة على SQL حقيقي عبر جسر PostgreSQL (وحدة tests تثبّت الـ mapping، والـ e2e يثبت SQL المُؤلَّف). العنوان الفعلي «مرتجعات المشتريات» (لا «مردودات») — قُبل النمطان.
- 🔧 **حادثة shim في A2 (نفسها تتكرر — القاعدة تتثبَّت):** محاولة التراجع عن إدراج خاطئ استخدمت مرساة **غير فريدة** (`getInvoices:async function(){const cid=await this._cid();` موجودة في sales أيضاً) فحذف نطاقاًstarted من `sales.getInvoices` حتى `purchases` — أي نصف سطح sales + purchases كله. الاسترجاع كان من `git checkout` + إعادة بناء. و recoveries من سجل مخرجات الأدوات كانت **تالفة** (dump مقطوع + `\\'` مزيّف) فأُعيد كتابة `postTransaction` من الصفر بدل الاعتماد عليها. **الدروس**: (1) أي تعديل على الـ shim: مرساة فريدة مُتحقَّق منها + كتابة + فحص في نفس السكربت، ولا تراجع أبداً بمرساة نصية؛ (2) لا تُستعَد الشيفرة من سجل مخرجات مقطوع — أعد كتابة القطعة أو ولّدها؛ (3) الفحص المعتمد هو المُحلِّل/المُشغِّل لا عدّاد الأقواس (سلّم خاطئ: HEAD نفسه يُبلّغ depth=2 ويمرّ).
- ✅ **أدوات فحص دائمة أُضيفت لهذه الفئة**: فحص تشغيل فعلي للـ shim في بيئة معزولة (يفحص `Object.keys(window.electronDB)` + installability كل دالة purchases الـ 17 + عدم تداخل أسطح + سلامة sales/pos)، وبوابة `preloadParity` ترفض أي backtick غير مُهرَّب داخل قالب الـ shim (الدرس من A1: backtick واحد يُسقط السطح كاملاً).
- ✅ **التحقق النهائي بعد A2:** `vitest run` كامل = **`2799/2799`** في `217` ملف؛ purchases `42/42` (+8 جديدة: توجيه القائمة، عدّاد النافذة، `lines` بصيغة parsed وstring، لا سطر شبح، Not found، أوامر/مردودات، KPI رقمية لا NaN)، parity `6/6`. و`npm run lint` نظيف، `npx tsc -b --force` صفر، `npm run build` ✓ (9.3s)، `node --check` للـ main وكلا الـ preloads، `npm run db:check` نظيف. E2E: `06-suppliers`+`12-reports` `13/13`، و`23-purchases` **`4/4`**.
- ✅ **tranche typed-RPC للمشتريات (B — كتابة الموردين):** 3 قنوات `purchases.createSupplier` / `updateSupplier` / `deleteSupplier` ⇒ **20 قناة purchases**. `company_id` و`updated_by`/`created_by` من الـ session دائماً، و`updateSupplier` بـ `paramCount: null` (partial SET)، و`deleteSupplier` **تعطيل ناعم** (`is_active=false`) لا DELETE (المورد يحمل مستنداته).
  — **تقسيم مقصود**: القناة تؤدّي الـ INSERT فقط؛ **توليد رقم المستند** (`document_sequences`) و**قيد الرصيد الافتتاحي** يبقيان في الـ renderer — لأن منطق المال له تنفيذ واحد فقط. الاختبارات تثبت الانقسام: لا `document_sequences` في العملية الرئيسية، ولا `companyId` في الـ payload.
  - **بوابة الكتابة لم تتغيّر**: بلا `permission` صريح لأن قاعدة الجدول (`purchases`) تفرض `create|edit|post` — نفس المجموعة التي كان يفرضها المسار raw. هذا tranche يزيل SQL من السلك، لا يغيّر من يكتب.
- 🧪 **e2e `06-suppliers` صار يمارس قناة الكتابة فعلاً**: الاختبار ينشئ مورداً من الواجهة وينتظر ظهوره في الجدول — أي INSERT حقيقي على PostgreSQL عبر القناة الجديدة (كان يمرّ على raw). نجح 5/5 مع `23-purchases`.
- ✅ **التحقق النهائي بعد tranche B:** `vitest run` كامل = **`2804/2804`** في `217` ملف؛ purchases **`48/48`** (+6: INSERT عبر القناة بلا SQL خام، رقم المستند المولَّد يُرسل في payload، رفض القناة، patch جزئي بلا companyId، تعطيل ناعم، رفض مُرَّر). و`lint` نظيف، `tsc -b --force` صفر، `build` ✓ (9.25s)، `node --check` ×3، `db:check` نظيف. E2E: **`5/5`** (`06-suppliers` + `23-purchases`).
- ✅ **إغلاق المسار العام للترحيل الفوري (Phase 2 #5 — بند مالي):** `createTransaction` صار **draft-only** و`updateTransaction({status:'posted'})` **مرفوض** برسالة تسمّي المسار الصحيح. الترحيل لم يعد حقلاً يُمرَّر في payload — صار انتقالاً له بواباته (قفل الصف، توازن السطور المخزَّنة، فترات ضريبية/مالية، هوية تدقيق من الجلسة). حُذف مسار «الترحيل عبر التعديل» (48 سطراً) الذي كان يتجاوز قفل الصف ويعيد التحقق على تاريخ المخزَّن.
  - **التركيب في مكان واحد**: `createAndPostTransaction()` = إنشاء draft ثم `postTransaction()`. عند فشل الترحيل **يبقى الـ draft** (قابل للمراجعة، لا يُحذف صامتاً).
  - **المتصلون محدَّثون**: `useAccounting` (الـ in-memory والـ paginated) يركّب نيابةً عن الواجهة، فلم يتغيّر `JournalEntriesPage`؛ وأداة AI `accounting.create_journal_entry` صارت تستدعي `createAndPostTransaction` بدل `status:'posted'`.
  - **لم يُمس** مسار مولّدات القيود (`journalEntryGenerator` → `adapter.createTransaction`) لأنه طبقة أخرى لها بواباتها في العملية الرئيسية (`accounting.createTransaction` typed) وهو ما تحتاجه فاتورة المبيعات/المشتريات/الرواتب للترحيل الذري. النطاق مقصود: المسار **العام** فقط.
  - **اختباران قديان يُظهران سلوكاً لم يعد موجوداً** (immediate post عبر الـ service) استُبدلا باختبارات العقد الجديد: الرفض + التحقق أن لا استعلام وصل القاعدة + تركيب صحيح + بقاء الـ draft عند فشل الترحيل.
- 🔍 **درس تشخيص (وهمي في أول مرة)**: فشل اختبار التركيب بعنايةأ «غير مسودة» رغم أن الـ mock يعيد `status:'draft'`. السبب: تحقق `postTransaction` يعتمد **`rows.length` بعد UPDATE** (إصلاح FIN-0 — `DbAdapter` لا يعرض rowCount) والـ mock كان يعيد `rows: []` ← يُقرأ كـ «0 صفوف متأثرة» = سباق مفقود. **قاعدة**: عند محاكاة مسار يفحص عدد الصفوف المتأثرة، يجب أن يُرجع الـ mock صف UPDATE لا قائمة فارغة.
- ⚠️ **دروس اختبار (تسريب حالة بين المجموعات)**: `vi.clearAllMocks()` **لا يستعيد الـ implementation** — اختبار typed-RPC سابق ترك `isElectronPg=true` و`window.electronDB` مثبَّتين فسقطت اختبارات لاحقة في نفس الملف إلى المسار الخطأ. الحل: `beforeEach` صريح بـ `mockReturnValue(false)` + تصفير `window.electronDB` في كل مجموعة تفترض المسار غير-|Electron. (لو استُخدم `resetAllMocks` لانكسرت الـ typed suites لأنها تعتمد على الـ implementation Establishment.)
- ✅ **التحقق بعد إغلاق المسار العام:** `vitest run` كامل = **`2808/2808`** في `217` ملف؛ accounting `70/70`، accounting+أدوات AI `424/424`. و`lint` نظيف، `tsc -b --force` صفر، `build` ✓ (16s)، `db:check` نظيف. E2E: `20-phase5` + `12-reports` = **`17/17`** (تشمل شاشة القيود وزر العكس).
- 🔍 **جرد مسارات الترحيل (سكربت حتمي على الكود الفعلي، لا تقدير):** `posting-audit.cjs` استخرج جسم كل دالة ترحيل،/how يُنفَّذ (`adapter.transaction` / `runTransaction` / `adapter.query` / typed RPC)، والجداول التي يكتبها، والحراس الموجودة داخل الجسم. النتيجة صادقت «الفحص الشامل» اليدوي جزئياً وكشفت ما خفي:
  | المسار | التنفيذ | كتابة | حراس |
  |---|---|---|---|
  | sales.postInvoice | `adapter.transaction` | invoice+lines، stock+movements، customers | توازن، فترة ضريبية، سنة مالية، أرضية مخزون، سقف مسدود، مسودة فقط، حالة |
  | sales.postReturn | `adapter.transaction` | sales_returns، customers | فترة، سنة، مخزون، مسودة، حالة |
  | purchases.postInvoice | `adapter.transaction` | purchase_invoices، stock+movements، suppliers | فترة، سنة، مخزون، مسدود، مسودة، حالة |
  | purchases.convertOrderToInvoice | `adapter.query` | purchase_orders | **نطاق الشركة فقط** ⚠️ |
  | pos.checkout | `runTransaction` | invoice+lines، pos_payments، customers | صف قفل، فترة، سنة، مخزون، مسدود، حالة |
  | pos.closeShift | `adapter.query` | pos_shifts | سنة (قيد الفرق في مسار شفاء منفصل) |
  | accounting.postVoucher | `runTransaction` | customers/suppliers | توازن، فترة، سنة، مخزون، مسدود، مسودة، حالة |
  | accounting.revalueForeignBalances | `runTransaction` | — | **company scope فقط** ⚠️ |
  | hr.postPayrollRun / payEndOfService | `runTransaction` | payroll_runs / end_of_service | فترة، سنة، مسودة |
  | manufacturing.start/completeWorkOrder | `runTransaction` | stock+movements، work_orders | توازن، سنة، مخزون، تكرار |
  | inventory.postStockAdjustment | `adapter.transaction` | stock_adjustments، stock، movements | **بلا فترة ولا سنة** ⚠️ |
  | manufacturing.updateWorkOrderStatus | `adapter.query` | work_orders | **false positive**: موحّد يفوّض إلى `startWorkOrder`/`completeWorkOrder` المحروسة |
- ✅ **إغلاق 3 فجوات posting مُثبتة بالسطر (tranche جديد):**
  1. **`convertOrderToInvoice` كان ينتج فاتورتين من أمر واحد (P0):** بلا ح guards على حالة الأمر (المُلغى والمحوَّل يُحوَّلان أيضاً)، وبلا ذرّية — إنشاء الفاتورة معاملة منفصلة عن قلب حالة الأمر. الآن: **حجز شرطي قبل استهلاك رقم المستند** (`UPDATE … WHERE status = ANY(convertible) RETURNING id` — الكيان المتبادل الحقيقي)، **تراجع تعويضي** عند فشل الإنشاء يستعيد **الحالة الأصلية** لا حالة مفترضة، و`NOT EXISTS` على الفاتورة تمنع فك الحجز خلف فاتورة موجودة فعلاً. رفض `cancelled/invoiced` قبل أي رقم.
  2. **`postStockAdjustment` بلا بوابة فترة إطلاقاً (P1):** يكتب قيد تسوية (مخزون ↔ فروق) — كان يمر إلى سنة مالية مقفلة. أُضيف `assertPeriodOpen` + `assertAccountingPeriodOpen` بنفس نمط باقي المسارات.
  3. **`revalueForeignBalances` بلا بوابة فترة (P1):** دالة مستقلة بزر في `CurrenciesPage` وأداة AI — كانت تكتب قيد فروق صرف داخل سنة مقفلة/فترة مُقدَّمة. أُضيفتا البوابتان قبل أي قراءة.
  - **لم يُمس** `applyPaymentToInvoice`: لا إنتاج مستدعٍ لها (اختبارات فقط) — لا مسار قابل للوصول، فباب Auditor عليها بلا قيمة تنفيذية الآن.
  - **الاختبارات**: 5 لخصم التحويل (منها سباق محسوم + تراجع للحالة الأصلية) + 2 لبوابة إعادة التقييم + 3 لبوابة التسوية = **10 جديدة**. المجموع `2808 → 2818` في 217 ملفاً. `lint` نظيف، `tsc` صفر، `build` ✓ (25s)، `db:check` نظيف، shim runtime ✓ (19 surface / 20 method).
  - **قاعدة من التحويل**: **التراجع التعويضي يجب أن يستعيد الحالة الأصلية لا حالة مفترضة** — ترقية `confirmed` كانت ستكتب فوق `partially_received` حالة لم يدخلها الطلب أصلاً. وكل تراجع خلف كتابة مالية يجب أن يكون `NOT EXISTS` محمياً، وإلا أكل فشله الثاني العملية الأولى الصالحة.
  - **قاعدة من الجرد**: **`Promise<{…}>` في نوع الإرجاع يخدع مُطابق الأقواس** — أول `{` بعد `)` يقع داخل `Promise<{ success: boolean }>` فلا يُلتقط جسم الدالة. الجرد الذي يقرأ الجسام يحتاج تخطي نوع الإرجاع (زاوية `<…>`)، وإلا حكم على الدوال كلها بـ«بلا حراس» وهذا أسوأ من غياب الجرد.
- 🔍 **قرار مالك معلّق (لم يُنفَّذ):** `receipt_vouchers`/`payment_vouchers` تحت قاعدة `accounting` بينما كشف حساب المورد/العميل والأعمار يجب قراءتها ⇒ دور يملك `purchases.view` وحده (أو `sales.own`) يُرفض بـ `Permission denied`. السلوك **قائم على المسار raw أيضاً** (نفس `assertSqlAuthorized`)، فليس انحداراً — لكنه يمنع أدواراً مخصصة. الخيار: توسيع `readPermissions` لتلك القاعدة (توسيع قراءة يشمل قناة raw) — قرار نماذج صلاحية لا يُتخذ ضمن tranche.
- ⚠️ **متبقٍ قبل إغلاق Phase 0:** `_exec` و`_execBatch` ما زالا موجودين كـ compatibility surface في `preload.cjs` و`preload.js`. أضيف tranche fail-closed لـ11 child table writes عبر `RAW_SQL_CHILD_PARENT_RULES` و`rawChildScopeIsValid`، ووسّعت مسارات `sales.postInvoice`، لكن child reads وadapter callsites المتبقية ما زالت تعتمد على التطبيق/typed-RPC مستقبلاً؛ لا يمكن حذف السطح أو إعلان الإغلاق الكامل قبل ترحيلها.
- ✅ اكتمل التحقق المحلي بعد tranche child-guard: `2777/2777` اختبار Vitest في `217` ملف، و`lint` و`tsc -b --force` و`node --check electron/dbHandler.js` و`npm run build` نجحت؛ اختبارات security/sales المستهدفة `79/79`. إصلاح provider registry/SSRF وAI settings أزال إخفاقَي الاختبارين المتبقيين.
- ✅ نجح فحص Postgre محلي غير مبدّل: اتصال `MaghzAccountFlash35`، ثم معاملتا `BEGIN/ROLLBACK` لإنشاء شركتين وعملاء لكل منهما والتأكد من فصل `company_id` دون تسريب.
- ✅ **التحقق النهائي بعد tranche accounting typed-RPC:** `vitest run` كامل = **`2781/2781`** في `217` ملف؛ و`npm run lint` (نظيف)، `npx tsc -b --force` (`0`)، `npm run build` (✓، تحذيرات PGlite `eval` المعروفة فقط)، `node --check` للـ main وكلا الـ preloads، `git diff --check` (LF→CRLF فقط)، و`npm run db:check` نظيف. اختبارات الأمان `16/16`، accounting `66/66`، parity `4/4` (المجموع المستهدف `86/86`).
- ✅ ReportsHub يستخدم `.title` للبطاقات التي تمثّل objects، وتم إصلاح selector POS الثاني؛ ونجح `keyVault` fallback/memory مع shared global store، وثُبّت e2e على `maghzaccount-db-mode=pg` ليطابق stub الموجود.
- ✅ بعد tranche accounting نجح E2E المستهدف للمبيعات والمدفوعات وAI settings: **`18/18`** خلال `4.9m` (نفس نتيجة tranche child-guard، لكن بعد إصلاح أقواس الـ shim وإضافة `postTransaction`). وتشغيل `e2e/01-auth` نجح `4/4` (يؤكد أن سطح `window.electronDB` سليم الإقلاع). آخر تشغيل كامل لـPlaywright قبل هذه الـ tranches كان `102/102` خلال `21.2m`، مع تحذيرات أبعاد Recharts المعروفة فقط؛ لم تُعد تشغيل الحزمة الكاملة بعد تعديل main-process guard.
- ⚠️ لم يكتمل بعد: ترحيل adapter callsites المتبقية إلى typed RPC، تدقيق preload removal، وbackup/restore end-to-end. فجوة `_exec`/`_execBatch` ما زالت قائمة، لذلك لا يُغلق Phase 0 بالكامل قبل ذلك.

### Phase 1 — Tenant isolation and RBAC

1. ownership validation لكل foreign key أو composite tenant constraints.
2. اشتقاق `.own` filters من session بدلاً من payload.
3. منع wildcard role permissions.
4. إبطال الجلسات عند role/user/permission changes.
5. auth-boundary disposer لـ AI: abort streams/batches, clear history/store/ledger/blobs/persistence queue.
6. capture company/user/auth generation قبل أول await.
7. context persistence snapshot generation-bound.

**قبول Phase 1:**

- A لا يقرأ/يكتب أي data من B.
- UUID صالح لكن foreign company يُرفض.
- logout/login لا يترك messages/cards/attachments من المستخدم السابق.
- queued save لا يكتب session ID بعد scope change.
- custom role لا يمنح wildcard.

### Phase 2 — Financial correctness

1. state machines موحدة لكل posting workflow.
2. كل transition داخل transaction واحدة.
3. row locks + conditional status updates + affected-row verification.
4. posting side effects الكاملة: stock/valuation/JE/balances/tax/fiscal locks.
5. منع direct `status: posted` من generic updates.
6. AI tool permission يتطابق مع strongest side effect.
7. refusal paths ورسائل rollback صادقة.

**قبول Phase 2:**

- concurrent posting ينفذ inventory/GL مرة واحدة.
- posted documents لا تقبل تعديل financial state.
- reversal هو pathway الوحيد بعد posting.
- tax/fiscal locks لا تُتجاوز.
- كل posting tool يتطلب post permission.

### Phase 3 — AI lifecycle and memory

1. operation tokens بدل boolean processing.
2. منع session switch/delete أثناء processing أو جعلها epoch cancellation.
3. persistence browser atomic.
4. full persisted fingerprint hash.
5. immediate stream cancellation handle.
6. preflight باستخدام schema كل أداة.
7. release batch remainder بعد أي chunk failure.
8. Resume يشغل worker فعلياً.
9. watchdog يعرف backoff/long-running phases.
10. token/byte context budget.
11. aggregate attachment count/size.
12. PDF/audio unsupported formats ترفض بوضوح.
13. task-ledger hydration كامل بعد restore.

**قبول Phase 3:**

- no late result crosses company/session boundary.
- no duplicate worker or duplicate write.
- failed itemDone يعيد siblings إلى queued.
- Resume يشغل worker.
- stop ينهي pending provider call.
- long sessions remain bounded.
- deleted session cannot be resurrected by queued save.

### Phase 4 — JEV hardening

1. auth/session على relay.
2. rate limits/body/state/question limits.
3. exact HTTPS origin/port allowlist.
4. unified transport selection حسب DB mode.
5. kill switch على كل JEV paths.
6. no plaintext fallback عند vault failure.
7. tenant/user/role-generation cache keys.
8. preserve probabilities.
9. duplicate names remain ambiguous.
10. linked entities enter actual provider history.
11. guard on normalized args, results, and batch items.
12. `block` prevents execution.
13. metrics per tenant/provider with real usage.
14. rewrite conflicting prompt/skills.
15. explicit data-egress/privacy controls.

**قبول Phase 4:**

- JEV cannot run after kill switch.
- PGlite does not depend on nonexistent PG session.
- custom URL cannot receive bearer key.
- duplicate names do not auto-inject.
- provider history includes IDs/confidence/ambiguity.
- every posting tool uses same guard.
- cache hit does not change safety decision.

### Phase 5 — Quality and rollout

1. add test/config typecheck projects.
2. lint Electron JavaScript and API routes.
3. two-company security suite.
4. concurrency tests for posting, stock, payroll, work orders.
5. fault-injection tests for persistence and batch.
6. mocked full-send JEV tests.
7. real provider e2e in a controlled environment.
8. coverage thresholds.
9. migration CI with `ON_ERROR_STOP`.
10. feature flags: `ai_writes_enabled`, `jev_enabled`, `jev_guard_enforced`.
11. staging audit and rollback procedure per phase.

**Verification sequence per phase:**

```text
tsc -b
→ eslint --max-warnings=0
→ vitest run
→ build
→ PostgreSQL smoke inside BEGIN/ROLLBACK
→ two-company security tests
→ concurrency/fault-injection tests
→ controlled AI/Electron e2e
```

## 7. تدقيق cross-tenant آلي على raw SQL (tranche مُنجز)

- **المنهج**: `tenant-scan.cjs` بنى قاعدة `company_id` من **الـ 60 جدولاً المقتبسة** في migrations نفسها (لا قائمة يدوية)، ثم فحص كل `adapter.query` وحكم بـدرجتين:
  | الحكم | العدد | المعنى |
  |---|---|---|
  | `UNSCOPED` | **9** | لا `company_id` ولا فلتر مُركَّب |
  | `INTERPOLATED` | **51** | الفلتر داخل متغيّر (`${where}`) |
  | مُثبَت scoping | **51 / 51** | مسافة الدليل الأبعد: 90 سطراً |
  | **غير مُثبَت** | **0** | — |
  - **النتيجة: صفر تسريب cross-tenant مُثبَت** على 601 جملة SQL مفحوصة من 639 `adapter.query` callsite، و**صفر حالة لا يمكن إثباتها**.
  - **الـ 9 child reads المصنَّفة أُغلقت (tranche لاحق):** كلها كانت قراءة سطور بمعرّف أبوها المُقيَّد + `LEFT JOIN products` بلا `p.company_id`. أُضيف `AND p.company_id = $N::uuid` على الـ JOIN (نفس نمط payroll-employees) في 9 مواضع: sales×3 · purchases×3 · manufacturing×2 · pos×1. قائمة `KNOWN_CHILD_READS` في البوابة أصبحت **فارغة بالتصميم** — أي `UNSCOPED` جديد = فشل تلقائي. و7 اختبارات عقد (واحد لكل ملف متأثر + params) تُثبّت الشكل: sales×3 · purchases×1 · manufacturing×2 · pos×1.
  - ✅ **البوابة صارت دائمة في CI: `src/test/tenantScopeGate.test.ts` (5 اختبارات)** — الأداة التي لم تُشحن لا قيمة لها. البوابة تحمل 4 حمايات: (1) تأكيد أن مجموعة الجداول مشتقّة فعلاً (`>40` + 6 جداول حرجة صراحةً، فالتحليل الأعمى ينتج نجاحاً بالغياب)، (2) **اختبار حساسية** يُثبت أنها تستطيع أن تفشل، (3) تأكيد فحص **كلا شكلَي الحرف** (`>300` جملة مفحوصة)، (4) قائمتا `UNSCOPED` المسموح بها (مع سبب مكتوب) و`INTERPOLATED` بلا دليل.
  - **البوابة التقطت فئة غائبة عن الأداة المؤقتة ⇒ ثغرة إضافية (P1):** استخراج جداول نسخة الأولى كان `from|join` فقط، فلم ترَ `UPDATE ai_job_batches SET total_count = … WHERE id = $1::uuid` في `browserBridge.ts:1131` (بلا `company_id`). المعرّف كان من `INSERT` مُقيَّد فصحيح بناءً، لكن **قاعدة Phase 83-A (كل تحديث PK في جداول batch يحمل `AND company_id`) لم تُطبَّق على هذا الموضع** لأنه أضيف لاحقاً مع de-dup. أُضيف `AND company_id = $2::uuid`. **الدرس: الأداة الأضيق تفقد فئة كاملة بصمت —|Port wider the extraction, not just the filters.**
  - **عيوب الماسح التي كشفها التدقيق (أهم من نتيجته):**
    1. **فحص الـ backtick وحده** أعطى «0 اكتشاف» واثقاً — والمقتبسة الأحادية (`'SELECT …'`) كانت خارج التغطية أساساً. **صفر نتيجة على 500+ جملة يستحق التشكيك أولاً**: probe الحساسية (جملة unscoped معروفة) كشف DETECTED، لكنه لا يثبت أن النطاق كان تاماً.
    2. **أنماط DDL مقتبسة** (`CREATE TABLE "branches"`) لا يطابقها `CREATE TABLE \w+` ⇒ تعداد الجداول المت scoping انخفض إلى 9 بدل 60، ثم صفر نتائج وهمية. **الجداول المقتبسة قاعدة في هذا المشروع** — أي تحليل DDL هنا يجب أن يقبل الاقتباس.
    3. **الفلتر المُركَّب يبدو ثقباً**: `${where}` يخفي `company_id` عن الماسح (51 حالة، كلها false positives بعد التحقق عملياً). **التصنيف بدرجتين أنفع من رقم واحد** — الخلط بين النوعين ضجيج يخفي الخطر الحقيقي.
    4. **عتبة نافذة عشوائية = آلة اتهام كاذب**: حُسبت النافذة 60 سطراً، فأدانت `LeadConversionReport` بينما دليلها على بُعد **66 سطراً** (السطر 87 يبني `conditions`، والاستدعاء 157). بعد توسيع النافذة إلى 150 سطراً وإضافة **قياس مسافة الدليل**، صارت 51/51 مُثبَتة (أبعد دليل 90 سطراً). **الحكم يجب أن يحمل مسافة دليله، لا عتبة مُخفية** — وإلا أدان الأداةُ نفسَها ما أثبتته.
    5. **الـ idiom الغالب لم يُطابَق**: شرط الإثبات كان يشترط `:` أو `=` بعد اسم المتغيّر، فنجحت `conditions = [...]` وأخفَت **الأشيع** `conditions.push(\`w.company_id = $1\`)` (استُعمل في `VarianceAnalysisReport`). **البحث عن الأشكال يحتاج قائمة كل الصيغ الشائعة، لا الشكل الذي كتبته أنت في الملف الذي قرأته أولاً** (وهو بالضبط ما فعلته في tranche_convert مع `Promise<{…}>`).
  - **الإصلاح الفعلي:**
    - **`resolveExistingUserId` كان يضعف بصمت (كود ميت، لا ثقب حيّ):** `companyId` كان اختيارياً ⇒ عند غيابه يهبط الاستعلام إلى `SELECT 1 FROM users WHERE id = $1` **بلا شركة** — أي «هل هذا المعرف موجود في أي مستأجر» لعمود معناه «هذا المستخدم من هذا المستأجر». أُغلق **fail-closed**: لا شركة ⇒ `null` بلا استعلام، والفرع غير المقيَّد حُذف. لا متصلين إنتاجيين — لكن بقاؤه فخاً عند أول استدعاء.
    - **JOIN أسماء الموظفين في Payroll**: `LEFT JOIN employees e ON pl.employee_id = e.id` بلا `e.company_id` — سطر مسير مستأجر واحد كان قد يجلب اسم موظف من مستأجر آخر عند أي انحراف تكاملي. أُضيف `AND e.company_id = $2::uuid` (في `getPayrollRuns` و`getPayrollRunsPaginated`).
  - **الاختبارات**: عقد fail-closed الجديد (بلا شركة / شركة غير UUID / الكاش) — `userIdValidator` 16/16، وبوابة cross-tenant 5/5. والمجموع `2819 → 2848` في **219** ملفاً.
  - **بوابة ثانية دائمة: `src/test/postingGate.test.ts` (24 اختباراً)** — تجعل التدقيق أعلاه غير قابل للانحراف: أي مسار ترحيل جديد ينسى البوابة يُكسر في CI. التغطية: 19 مسار ترحيل (فواتير/مردودات المبيعات والمشتريات، POS checkout وإغلاق، القيود والسندات وإعادة التقييم، الرواتب ونهاية الخدمة، أوامر التشغيل، التسويات، العكوسات الأربعة، الإهلاك والاستبعاد).
    - **البوابة تتبع قفزة واحدة في الـ helpers**: بوابة خلف helper خاص (`reversalDateGuard`) تُقبَل — تجاهل الانتقال كان سينتج نفس false negative كما في `updateWorkOrderStatus` بالتدقيق الأصلي.
    - **تفويض موثّق لمسار مُبوَّب**: `reverseSalesInvoice → salesApi.postReturn` و`reversePurchaseInvoice → purchasesApi.postReturn` يُقبَلان *فقط* لأن الهدف صفٌّ مُبوَّب في البوابة نفسها — إذا فقد الهدف بوابته سقط صفّه. **البوابة لا تسجّل التفويض كعذر، بل كعقد على الهدف.**
    - **الاستثناءات الضريبية قائمة مراجعة لا افتراض**: 3 مسارات داخلية بلا حركة ضريبية (بدء/إكمال أمر التشغيل، فرق الصندوق، الإهلاك/الاستبعاد) + المرآتُ العكسية مسجَّلة كلٌّ بسبب مكتوب — وقائمة الـ stale تمنع بقاء استثناء ميت.
    - **البوابة اختبرت نفسها**: فشلت أولاً على اسمين غير موجودين (`createReversal`، `runMonthlyDepreciation`) ⇒ القائمة صُححت (4 دوال عكس حقيقية + `runDepreciation`/`disposeFixedAsset`).
  - **التحقق النهائي للـ tranche**: `vitest run` = **2855/2855** · lint نظيف · `tsc -b --force` صفر · `build` ✓ · `db:check` نظيف.
  - **التحقق النهائي للـ tranche**: `vitest run` = **2824/2824** · lint نظيف · `tsc -b --force` صفر · `build` ✓ · `db:check` نظيف · وحدة AI + `src/test` = 988/988.
  - **قواعد مضافة:**
    - **صفر اكتشاف على نطاق ضخم = ادّعاء مشبوه**: الماسح يُثبَت بprobe معروف، لكن التغطية (شكل الحرف، نمط الاقتباس) تُعلن صراحةً قبل الوثوق بالرقم.
    - **«الفلتر في متغيّر» حالة HYBRID**: تُحكم عليه بالمسافة إلى آخر بناء للدليل وتُعلن تلك المسافة في المخرجات — لا تُسقط ولا تُدين بلا رقم.
    - **الأداة تُشحن كبوابة أو لا تُشحن**: سكربت في `%TEMP%` يوثّق اليوم ويموت غداً. المنقول إلى `src/test/tenantScopeGate.test.ts` = 4 اختبارات تحمي الاستنتاج (مشتقّة الجداول · الحساسية · التغطية · القوائم الموثّقة).
    - **الأداة الأضيق تفقد فئة كاملة بصمت**: استخراج `from|join` فقط غاب عنه `UPDATE <table> SET …` ⇒ UPDATE/DELETE بلا `company_id` مرّ بلا حساب. **الاستخراج يجب أن يغطي الفعل أيضاً** (into/update/delete from)، لا أن يركّز على المُرشِّحات.
    - **البحث عن الأشكال يحتاج قائمة كل الصيغ الشائعة**: `conditions = [...]` و`conditions: string[] = []` و`conditions.push(...)` و`WHERE ${where}` — أيُّها تفتقده يُنتج «ثقباً» وهمياً أو إدانةً كاذبة. **النمط الذي تستخدمه في أول ملف تقرأه ليس النمط الشائع في المشروع.**
    - **فخ `Promise<{…}>` تكرر مرتين**: استخراج جسم الدالة اصطدم به في كاتبين مختلفين ⇒ نفس الإصلاح طُبِّق. **الدرس الذي يصلح مرتين يثبت أنه قاعدة لا حادثة.**

## 8. تسلسل المستندات: مصدر واحد + ثلاث محركات تتفق (tranche مُنجز)

- **الأصل**: `getNextDocumentNumber` (core/api.ts) هو المسار الوحيد لترقيم 19 نوع مستند عبر 32+ callsite (مبيعات/مشتريات/POS/محاسبة/تصنيع/HR/مخازن/CRM + أدوات AI). الفشل فيها **صادق لكنه صامت التصميم**: `Sequence not found: <type>` كرسالة runtime لا كخطأ ترجمة.
- **المشكلة المُكتشفة (P1)**: ثلاثة محركات تبذر `document_sequences` (بذرة demo · بذرة PGlite · backfill التسجيل في dbHandler)، و**`fixed_asset` غائب من بذرة PGlite** ⇒ أي شركة في المتصفح/ PGlite **لا تستطيع إنشاء أصل ثابت إطلاقاً** (و`createFixedAsset` في accounting/assets.ts يستدعي الترقيم). البذرتان الأخريان فيه. أُضيف `{ type: 'fixed_asset', prefix: 'FA-', pad: 4 }` لبذرة PGlite.
- **البوابة: `src/test/documentSequenceGate.test.ts` (5 اختبارات)** — كل محرك يجب أن يبذر كل نوع يُستدعى زمن التشغيل (19)، ومفتاحا الخريطة في `core/api.ts` (table↔column) متطابقان، وفحص الـ callsites يرى كل الأنواع الموثّقة (فحص مكسور ينجح بالغياب).
  - **إثبات عكسي**: حُذف سطر `fixed_asset` من بذرة PGlite يدوياً ⇒ البوابة سقطت **بنصّ العطل الحقيقي**؛ ثم أُعيد الإصلاح. **البوابة تُثبت أنها تستطيع أن تفشل قبل الوثوق بها.**
  - **تغطية التغطية**: 19/19 في الثلاثة بعد الإصلاح · صفر نوع مستدعًى غير مُبذَر · 16 صف تسلسل مُبذَر ولا يُستدعى (chart-of-accounts types مثل `asset/liability/branch` لا تاخد تسلسلاً — غير ميت بالضرورة، بل فئات أخرى).
- **درس محادثة**: التراجع عن انحدار مُحقن بـ `git checkout -- <file>` **محا الإصلاح غير الملتزم به في الملف نفسه** (رجع إلى HEAD بلا الإصلاح) ⇒ أُعيد تطبيق الإصلاح. **لا تتراجع بـ git checkout عن ملف تحمل عليه عملك غير الملتزم — احفظه أو استخدم التراجع العكسي (إعادة السطر).**
- **درس أدوات مكرّر**: `node -e` مع اقتباس مركّب ينكسر في PowerShell (عرض الخطأ بسبب الأقواس المعقدة) — استخدم ملف `.cjs` (المساعدة المؤقتة). تكرّر في هذه الجلسة.
- **التحقق**: `vitest run` = **2860/2860** في **220** ملفاً · lint نظيف · `tsc -b --force` صفر · `build` ✓ · `db:check` نظيف · بوابات `src/test` الخمسون خضراء.

## 9. تحويل عرض السعر ← فاتورة: صمت P0 على سطح المكتب (tranche مُنجز)

- **الثغرة (P0)**: `salesApi.convertQuotationToInvoice` كان ينشئ الفاتورة **ثم** يقلب حالة العرض عبر قناة `sales.updateQuotation` — وهذا الـ handler **يرفض أي status غير `draft`** (`Use the quotation workflow to change status`) و**يعدّل الصفوف المسودة فقط**. والنتيجة **لم تكن تُفحص** (`await` بلا فحص). الأثر على Electron: **الفاتورة تُنشأ، العرض يبقى `sent`، الواجهة تُبلّغ نجاحاً** — ونفس العرض يُحوَّل مجدداً ⇒ **فواتير مكرّرة بصمت، على سطح المكتب فقط**. البوابة PGlite تعمل (fallback raw بلا حراسة) ⇒ انحراف منصّتين.
- **والتوثيق كان يدّعي الحماية**: `docs_dev/05-technical/04-api-reference.md` يكتب «`convertQuotationToInvoice` (يحمي converted)» — حراسة **غير موجودة**. **ادّعاء التوثيق ليس دليلاً** (نفس علة `createReversal` الميتة).
- **الإصلاح (2 قناة typed جديدة + قلب المسار)**:
  - `sales.claimQuotation`: CTE مقفل الصف (`FOR UPDATE`) يتحوّل **شرطياً** من `draft/sent/accepted` فقط، ويعيد `previous_status` + `quotation_number`؛ و`mapResult` يرمي رسالة عربية صادقة إذا صفر صفوف (مُحوَّل مسبقاً / مرفوض).
  - `sales.releaseQuotation`: **تراجع تعويضي** عند فشل إنشاء الفاتورة — يستعيد `previousStatus`، و`NOT EXISTS` على `sales_invoices` تمنع فك الحجز خلف فاتورة موجودة فعلاً (قد يكون الـ commit حدث وضاع الرد).
  - `convertQuotationToInvoice` صار **claim-first**: يحجز قبل الإنشاء ⇒ سباقان متزامنان: الثاني يحصل صفر صفوف فلا فاتورة. **ونتيجة القناة تُفحص** (لا `await` مكبوته).
  - المساران (Electron typed + raw fallback) متوازنان حرفياً في منطق Transition.
- **الاختبارات (5)**: الحجز قبل الإنشاء · سباق محسوم **بلا إنشاء فاتورة** · تراجع للحالة الأصلية مع `NOT EXISTS` · **مسار Electron يستخدم القناة المخصّصة ولا `updateQuotation`** (regression على الفشل الصامت الأصلي) · رفض الحجز على Electron بلا إنشاء.
- **قواعد مضافة:**
  - **«ينجح» في واجهة لا تعني «نجح»**: انحراف منصّتين (Electron يفشل، PGlite ينجح) من سبب واحد = قناة واحدة استُعملت لغرضين. **القناة التي لا تحمل الحالة المطلوبة لا تُستعمل لتغيير الحالة أصلاً.**
  - **نتيجة الأداة/القناة عقد صدق**: `await` بلا فحص = Swallowed error؛ حين يكون الفعل **مالياً** يبتلع الفشل ويُبلّغ نجاحاً كاذباً. **كل انتقال حالة financial يجب أن يفحص عدد الصفوف المتأثرة ويعيدprevious state للتعويض.**
  - **ادّعاء التوثيق يُراجَع كادّعاء**: «يحمي converted» بلا سطر شرط = ثغرة موثّقة إذن.
- **التحقق**: `vitest run` = **2865/2865** في **220** ملفاً · lint نظيف · `tsc -b --force` صفر · `build` ✓ · `db:check` نظيف · `node --check` على dbHandler/preload×2 · shim runtime ✓ (backticks متوازنة). (تشغيلان سابقان أظهرا 2 فشل تحت الحمل المتوازي ثم خضراء منفردة — نمط flake معروف، لا انكسار.)

## 10. نتائج مُهمَلة وتلييف بالبنية: `createProduct` (tranche مُنجز)

- **المنهج**: فاحص حتمي على «نتائج قنوات typed المُهمَلة» — نفس صنف الـP0 السابق (فشل صمت + نجاح كاذب). **مسبار حساسية بنفس المُتنبِّئ** (6 cases: bound / inline-checked / `return await` / `throw await` / bare / compensating) — **المسبار كان فشل أول مرة** لأن دالة الفحص والسكربت لم يكونا نفس الكود، فأعطت 5 إيجابيات كاذبة من 7 (`return await …` قيمة مستعملة). القاعدة: **مسبار يستخدم دالة أخرى لا يثبت شيئاً**.
- **النتيجة بعد الإصلاح: 1** (استثناء موثّق).
- **العيوب المُصلَحة (P1)**: `adapter.createProduct` كان **يُهمل** نتيجة ربط التصنيفات (m2m) ثم يرجّع `success: true` ⇒ منتج بلا تصنيفات ورسالة نجاح. والأهم في `inventoryApi.createProduct`: **أربع خطوات بعد الإنشاء بلا فحص** —
  | الخطوة | الأثر الصامت |
  |---|---|
  | ربط التصنيفات m2m | منتج بلا تصنيفات |
  | `standard_cost` | تكلفة معيارية مفقودة |
  | `ensureBaseProductUnit` | منتج بلا وحدة أساسية (يُفشل التحويل للوحدات) |
  | **`postProductStockOpening`** | **مخزون افتتاحي + قيد محاسبي مفقودان** |
- **تلييف بالبنية (الأخطر)**: أداة `inventory.create_product` كانت تُرجع `openingPosted: !!openingWarehouseId` — أي **«هل مُرِّر مستودع» لا «هل نجح الترحيل»** — ومعها `note: 'المخزون الافتتاحي رُحّل تلقائياً'` **شرطاً**. أي أن الأداة **تُعلن قيداً لم يحدث**. هذا نفس مبدأ «ادّعاء بلا أثر تنفيذ» لكن مُولَّد من سطر واحد.
- **الإصلاح — نجاح جزئي صريح (additive)**:
  - `warning?: string` على نتيجة `createProduct` (إضافة اختيارية: **المستدعون الذين لا يعرفونها يتصرفون تماماً كما قبل** ⇒ لا انحدار).
  - `openingStockPosted?: boolean` **حقيقة صريحة** من الخادم، **لا مشتقة من الطلب** — «مُرِّر مستودع» ليست دليلاً على قيد.
  - الواجهة: `toast('warning', …)` بدل «تم» الصامت. الأداة: `openingPosted: res.openingStockPosted === true` + `note` صادق + تمرير `warning` للنموذج.
- **البوابة: `src/test/discardedRpcGate.test.ts` (3 اختبارات)** — تصنّف كل نتيجة typed RPC، مع `ALLOWED_DISCARDS` كقائمة مراجعة **مسببة** (التراجع التعويضي fire-and-forget شرطه ألّا يبتلع الخطأ الأصلي) + اختبار anti-stale. **إثبات عكسي**: أُعيد حقن سطر `await invokeSalesRpc('updateQuotation', …)` (شكل الـP0 الأصلي) فسقطت البوابة عليه.
- **دروس أدوات مكرّرة (المرة الثانية في هذه الجلسة):**
  - **كائن regex مشترك بين ماسحين = حلقة لا نهائية**: الفاحص الداخلي أعاد `lastIndex = 0` على نفس كائن `/g` الذي يمرّره الماسح الخارجي ⇒ تعليق. **نسخة جديدة لكل مسح** (أو `new RegExp` عند الاستدعاء).
  - **CRLF يكسر المطابقة الحرفية** (مرة ثالثة في هذه الجلسة): `\n` في الـneedle لا يطابق `\r\n` ⇒ الحقن «فشل» وAppear وكأنه عطل منطقي. **استخدم regex متسامحة أو طبّع السطور أولاً**.
  - **النافذة المنزلقة (3 أسطر) تنتج إيجابيات كاذبة**: جملة في سطر + سطر التالي يُقرآن كجملة واحدة. **المسير يجب أن يبدأ من موضع المطابقة ويمشي على حدود الجملة**، لا من حدّ السطر.
- **التحقق**: `vitest run` = **2875/2875** في **221** ملفاً · lint نظيف · `tsc -b` صفر · `build` ✓ · `db:check` نظيف · بوابات `src/test` الخمسون+ خضراء (5 ملفات / 53 اختباراً).

## 11. تعميم صنف «الخطوة المالية غير المُدقَّقة» (tranche مُنجز)

- **المنهج**: فاحص deterministic على **601 جملة كتابة** في مسارات المستخدمين، مع **مسبار حساسية صارم (8 حالات)**. النتيجة الأولى كانت **117** — والمسبار كشف أن الرقم **مضلِّل**: فرعا تصنيف الكتابة في الفاحص **.shutdown ميتان** لأن `stmt` كان يبدأ **بعد** `await` فلا يُستخرج الـcallee قط (فكل ما ظهر كان من فرع SQL الحرفي) — أي أن **نداءات `post*` المجرّدة المستورَدة كانت خارج التغطية تماماً**، وهي بالضبط الصنف المستهدف.
- **بعد الإصلاح: 4 مواضع** في الصنف ذي الأثر المالي (بوابة `post[A-Z]` + `ensureBaseProductUnit`)، المُصلَح منها:
  | الموضع | العيب | الإصلاح |
  |---|---|---|
  | `sales.createCustomer` ×2 مسار | ترحيل **رصيد العميل الافتتاحي** مُهمَل — كشف يتوازن والدفتر لا | `warning` على النتيجة |
  | `purchases.createSupplier` | ترحيل **رصيد المورد الافتتاحي** مُهمَل | `warning` |
  | `hr.createEmployee` ×2 مسار | ترحيل **سلفة الموظف الافتتاحية** (مدين مسحوبات) مُهمَل | `warning` |
  | `shared.resolveLineUnits` | فشل الشفاء الذاتي ⇒ `chosen` غير معرّف ⇒ **`factor = 1` صامت** ⇒ `base_quantity` خاطئة (فساد مخزون صامت) | **خطأ صريح** يوجّه لأداة الإضافة |
  | `useInventory` + `shared` (self-heal) | best-effort مشروع | استثناء موثّق: **الشفاء قد يفشل ما دام السطر التالي يثبت ذلك** (إعادة قراءة + خطأ على قائمة فارغة) |
- **البوابة السادسة `src/test/writeStepGate.test.ts` (3 اختبارات)**: تصنّف نداءات الترحيل المحاسبية، وتطالب بأن تكون **حيّة** (`ledgerCalls > 10`) وأن **قائمة الاستثناءات حيّة** (`reviewedHits > 0`) — فمصنّف لا يطابق شيئاً يمرّ بلا معنى.
- **قرار نطاق موثّق**: القاعدة **الضيّقة** (الترحيل المحاسبي) هي المحجبة، والمسح **العريض** (أي كتابة SQL مُهمَلة) يبقى **تقريراً** لا بوابة — لأن 58 عنصراً مختلطاً (إعدادات، سجل تدقيق، و statements **داخل `adapter.transaction([...])`** التي تُفحص على مستوى المعاملة) كانت ستنقلب إلى قائمة سماح بلا قيمة. **البوابة التي تُطلق 58 مرة تصير صامتة**.
- **دروس أدوات (تالت مرة لكل منها):**
  - **حذف بادئة `await` يقتل فرع تصنيف كامل بصمت** — الفاحص كان «يعمل» ويؤخذ كدليل، والمسبار هو ما كشف أن الحالة الحاسمة لا تُكتشف أصلاً. **قبل أي رقم: اسأل «هل يكتشف الفاحص الحالة التي برّمتها لأجلها؟»**
  - **المسبار يجب أن يشارك نفس دالة الفحص**: أول نسخة «مرّت» بـ permissive `||` فمرّت حالات لم يفحصها شيء.
  - **توقّعي أنا كان خاطئاً لا الأداة**: حالة «قراءة بنتيجة مُهمَلة» توقّعتُها `used=true` والصحيح `false` ⇒ صحّحت توقّعي لا الأداة.
- **التحقق**: `vitest run` = **2879/2879** في **222** ملفاً · lint نظيف · `tsc -b` صفر · `build` ✓ · `db:check` نظيف · **6 بوابات** في `src/test` (56 اختباراً).

## 12. أولويات التنفيذ

1. Phase 0 immediately.
2. لا تبدأ UI أو JEV enhancements قبل Phase 0 و1.
3. بعد إغلاق security، ينفذ financial state machines.
4. بعدها AI lifecycle/memory.
5. JEV optimization/security بعد توحيد boundary.
6. لا يدّعي اكتمال 100% قبل tests وstaging evidence.

## 13. سجل التغيير

- **2026-09-26 (الحزمة 8e: قائمتا السندات مُرحّلتان — و`getTransactions` كُشف أنه شكلان لاشكل واحد):**
  - **ما رُحّل**: `getReceiptVouchers` و`getPaymentVouchers` — قائمتان مسطّحتان بفلتر `ownedByUserId` اختياري. كلتاهما بأمانة: `paramCount: null` لأن المعطيات 1 أو 2 حسب وجود الفلتر. السقف 409 ← **407**.
  - **الدرس الأثقل — البوابات لا تكشف كل الانحراف**: `accounting.getTransactions` مرشَّح في قائمة السلوكية، واسمه صحيح (يصل خاماً فعلاً). لكن جسميه **فرعان يعيدان شكلين مختلفين**: مع `ownedByUserId` يختار `t.*` **بلا** `entries`، وبدونه يستدعي `adapter.getTransactions` الذي يُلحق `entries` مُجمّعة JSON بكل صف. القناة القائمة تطابق الفرع الثاني ⇒ توصيلها كان **يُسقط فلتر `created_by` عن مستدعٍ واحد ويُبقيه عن آخر**.
  - **قُرِبت من الشحن**: أعرفتُ القناة لتصبح أمينة للفرع الأول (فلتر غير مشروط، بلا `entries`) — فكانت **خاطئة للفرعين معاً**. أعاد `git checkout` القناة الأصلية، ورُحِّلت القائمتان الأخريان فقط. **الاسم الصحيح لا يعني «ترجمة ممكنة»**؛ قد لا يكون للطريقة الأشكال شكل واحد أصلاً.
  - **لماذا لم تلتقط البوابات**: `rpcReachabilityCrossCheck` و`channelWiringGate`both يعملان على **أسماء** methods. الشيفرة المتحرّكة وشكلها شيء لا يظهر في اسم. ⇒ **لا يمكن بناء «أمانة» من الـ SQL وحده: تُقرأ جملة الاستدعاء كاملة**، لأن الفارق يسكن في **أي فرع ينفَّذ**.
  - **`getTransactionById` (السابقة 8f)**: جملتان (السجل + أرجله) ⇒ قناة واحدة بـCTE تُرجع الاثنين. **الـmapping وحده بقي في الـrenderer** (`mapTransactionEntries`) — عكس الفخوخ الثلاثة التي نُسخ منطقها في العملية الرئيسية؛ هنا نسخة واحدة حـرّانها SQL وحده. الشكل المُعاد مُثبَّت بمرآة.
  - **الـRPC يُعيد صفوفاً والـrenderer يبني الشكل**: `mapRows<ReceiptVoucher>` بقي في المسارين ⇒ تعريف الكائن واحد. القناة لا تعرف شيئاً عن `PaginatedData` ولا عن أصناف التطبيق.
  - **التحقق**: `tsc -b --force` صفر | `eslint` صفر | **242/242** ملف اختبار (23 بوابة) | `build` | `db:check` سليم. التثبيت: القناتان خرجتا من قائمة السلوكية، ومجموعة الأفخاخ **لم** تكبر، والسقف نزل رقمين.

- **2026-09-26 (الحزمة 8d: بوابة تمنع «القناة الموجودة = الترحيل المكتمل» — وكشفت 7 أفخاخ لا 3):**
  - **البوابة `channelWiringGate`** تدمج قياسين مستقلين: **القنوات المسجَّلة** في `dbHandler.js` مقابل **الـmethods التي تصل إلى SQL خام سلوكياً** (جسر مثبَّت + كاشف). أي method يظهر في **الاثنين** فهو **فخّ كامن**: يمكن وصله في أصيل يوم ظنّاً أنّه «تنظيف»، بينما هو **ليس ترجمة**.
  - **كشفت 7 لا 3**، و**مدخلان من الثلاثة الذين كتبتهم كانا خطأين**: `accounting.getAccounts` **موصول فعلاً** (فلم يظهر) ⇒ التوثيق كان سيصف مشكلة غير موجودة. والخمسة الجديدة في `hr`: `deleteEmployee` · `deleteEndOfService` · `deleteLeave` · `deletePayrollRun` · `postPayrollRun` — أجسامها في الـrenderer **جملتان فأكثر** (حارس حالة/اعتماد ثم الحذف، أو قيد Gross-up كامل)، والقنوات مسجَّلة بـSQL ديناميكي. ⇒ هي **تجميع ذرّي** لا ترجمة حرفية، فهو أفضل لا bug، لكنه **غيّر سلوك الفشل** ⇒ توصيله قرار لا تنظيف، والتوثيق يتطلّب قراءة المعالج.
  - **الدرس الأكبر — التوثيق التلقائي يصحّح التوثيق اليدوي**: كتبتُ الثلاثة **مما لاحظته أنا**، والبوابة أضافت خمسة **لم أنتبه لها**، وصحّحت واحداً **أخطأت فيه**. ⇒ **قائمة مكتوبة يدوياً تفقد-value يوماً ثانياً**؛ القوائم تُشتق من القياس.
  - **مُثبَت عكسياً**: وصلتُ `createAccount` بقناتها كما يفعل أي ترحيل متسرّع ⇒ سقطت البوابة بالاسم، لأن `createAccount` خرج من قائمة الأفخاخ ⇒ **القاعدة: أوصلْها أو واثقها، لا «أنهِ الترحيل»**.
  - **لا ترحيل في هذه الجولة** — بحكم أن المقياس في الطور السابق، وهذه الحزمة تبني الحاجز الذي يمنع تكرار الفخّ لا تفكيكه.
  - **البيئة**: `pool=forks` (ـ`threads` معطّل على هذا الجهاز).
  - **التحقق**: `tsc` نظيف · eslint نظيف · **242/242** ملف اختبار (**23** بوابة) · build · `db:check` نظيف.

- **2026-09-26 (الحزمة 8c: قناة واحدة مُؤمَّنة — والاكتشاف الأكبر أن قنوات موجودة كانت أنصاف ترجمات):**
  - **ما رُحّل**: `accounting.getAccountById` فقط. استدعاؤه في الـrenderer **جملة واحدة غير مُرشَّحة** ⇒ لا مجال لانحراف بين التنفيذين. النتيجة: 412 ← **411**، والاسم اختفى من القائمة السلوكية المرصودة.
  - **الاكتشاف — ثلاث قنوات `accounting` موجودة لكنها أنصاف ترجمات، وموصولة أصلاً لأحد**:
    - **`createAccount`**: القناة تُدرج **9** أعمدة بينما الـrenderer يكتب **13** — بلا `id`، بلا `is_active`، بلا `created_by`/`updated_by`. توصيلها الآن يُسقط **أعمدة التدقيق على سطح المكتب**.
    - **`getTransactions`**: القناة تربط `journal_entries` وتُجمِّع `entries` كـJSON، بينما الـrenderer يختار `t.*` فقط. توصيلها الآن يجعل سطح المكتب **يرجع شكلاً مختلفاً** عن المتصفح.
    - **`getAccounts`**: القناة تبني شكل الشجرة في العملية الرئيسية، والـrenderer لا يفعل.
  - **`getTransactionById` استُثنيت في هذه الحزمة**: جسمها في الـrenderer **جملتان** (السجل، ثم أرجل قيده)، فقناة استدعاء واحد ستكون **شكلاً ثالثاً** لا ترجمة. تركتها لقناة مكتملة الجملتين.
  - **الدرس المحوري**: **وجود القناة ليس دليل اكتمال الترحيل.** القناة الفارغة تبدو كعمل منجز، وهي أخطر من عدمها لأنها **تحجب** الحاجة. والـcross-check كشفها بالسلوك لا بالشكل: `createAccount` و`getTransactions` في القائمة الخام رغم وجود قنواتهما — وهذا في ذاته دليل على أنهما **غير مربوطتين**، لا أنهما ناقصتان.
  - **والفصل الذي تحقَّق**: `rawSqlRatchetGate` (نص) بقي **666** بينما `desktopRawSqlGate` (قابلية وصول) نزل **412 ← 411**. ⇒ **البوابتان تقيسان شيئين مختلفين عمداً**: نص الـfallback لازم باقٍ لـPGlite، والفهرسة الحيّة تنخفض فقط. لو انخفض النص أيضاً لكان ذلك خطأً لا إنجازاً.
  - **البيئة**: `pool=forks` (ـ`threads` معطّل على هذا الجهاز).
  - **التحقق**: `tsc` نظيف · eslint نظيف · **241/241** ملف اختبار (**22** بوابة) · build · `db:check` نظيف.

- **2026-09-26 (توسيع الـcross-check إلى أكبر خمس أسطح — والرقم 412 مُصادَّق عليه من مسار مستقل):**
  - **ما تم**: وسّعت `rpcReachabilityCrossCheck` ليقيس **خمس** أسطح كائن دفعة واحدة (`accounting` · `inventory` · `hr` · `manufacturing` · `crm`) — تشترك كلها في نفس قائمة mocks، فلم تتضاعف التكلفة.
  - **النتيجة — مطابقة في كل مكان**:

    | الوحدة | methods | خام سلوكياً | عدّاد نصي |
    |---|---|---|---|
    | accounting | 31 | 19 | 50 |
    | inventory | 38 | 23 | 47 |
    | hr | 37 | 14 | 44 |
    | manufacturing | 21 | 5 | 34 |
    | crm | 31 | 8 | **9** |

    ⇒ **لا نقص في العدّاد النصي على هذه الخمسة** ⇒ رقم **412** الذي أعلنته **مُؤكَّد بمسار قياس لا يشترك في شيفرته**.
  - **الضبط الاسميّ (لماذا مهم)**: `crm` يقع فوق رقمه الساكن **بواحد** فقط (8 مقابل 9). ⇒ فحص العدد وحده **يتحمّل** انحداراً واحداً. أضفت قائمة **بأسماء الـmethods** مرصودة سلوكياً، فمُثبَت عكسياً: نزعتُ حارساً من method نظيف في crm ⇒ سقط **بالفرق الاسميّ** بينما **نجَز فحص العدد**. ⇒_gate واحد «مكسور badly» لا يكفي؛ يلزم طبقة تُسمّي.
  - **ماBehavioral لا يقوله بصراحة**: هذا يقيس **قابلية الوصول**، لا حجم السطح. `manufacturing` عدّاده 34 وخامّه 5 لأن العدّاد يعدّ **جُمل** والقياس يعدّ **دوال**؛ عدة دوال فيها جمل متعددة. كلاهما صحيح في وحدته، ولا يُجمع بينهما.
  - **الدرس المتكرّر — الفحص الفارغ ينجح**: `getLeadKpis` تبيّن أنه **بلا حارس أصلاً** (لذلك في القائمة) ⇒ العيب يكون حذف حارس من method نظيف، لا «تعطيل» حارس موجود.
  - **البيئة**: `pool=threads` يفشل في تشغيل العمال على هذا الجهاز (transform 0ms). كل التحقق هنا تم بـ`pool=forks`.
  - **التحقق**: `tsc` نظيف · eslint نظيف · **241/241** ملف اختبار (**22** بوابة) · `docsVersionGate` 4/4 (إصدار **0.26.2** + ختم 142 صفحة + `README`).

- **2026-09-25 (لا ترحيل في هذه الجولة — بل قياس لا يكذب: البوابة صارت_cross-checked):**
  - **القرار**: قبل أي ترحيل جديد، تُصلَح الـgate نفسها. ثلاث مرات في أربع جلسات انكسر عدّادنا، و**كل مرة في اتجاه يخفي عملاً**. فبنيت قياساً **بالمُلاحظة لا بقراءة النص**.
  - **الآلية**: `desktopReachabilityGate` يركّب جسراً (وهذا كل ما تنظر إليه `isElectronPg()`) ويسلّم الـadapter كاشفاً. دالةٌ تصل إلى SQL خام على سطح المكتب **ستنادي الكاشف** — لأن محوّل سطح المكتب نفسه يمرّر إلى `_exec`. دالةٌ تذهب عبر typed RPC **لن تلمسه**. ⇒ **السؤال لا يُحلّ بـregex أبداً**، لأنه سؤال تحكّم، والتشكيلات الصحيّة للقسار فيه أربع، بالإضافة إلى نمط مساعد الموجّه.ر فيه أربع، بالإضافة إلى نمط مساعد الموجّه.
  - **النتيجة على `core/api`**: القياس السلوكي كشف methods واحدة فقط — `applyDefaultTemplate` — **مطابق** تماماً للقياس النصي بعد تصحيحه. تطابق.routeِ مستقلان = 숫ر غالباً صحيح.
  - **النتيجة على `accounting`**: **20 من 31** methods في `accountingApi` تصل إلى SQL خام **فعلاً** وقت التشغيل. ورقم العدّاد النصي (50) أكبر منه، فمتوافقان.
  - **الـcross-check نفسه**: `rpcReachabilityCrossCheck` يفرض أن يكون رقم الـgate **≥** عدد الـmethods المرصودة سلوكياً لكل ملف. ⇒ إن انكسر التحليل الساكن يوماً، **يسقط هذا الفحص وحده**، دون أن يقرأ أحد شيفرة. **مُثبَت عكسياً**: خفضتُ رقم accounting في الجدول إلى 3 ⇒ سقط بالاسم: «expected 3 to be greater than or equal to 19».
  - **الدرس الذي كلّف أكثر من اللازم**: أول تشغيل للـcross-check **مرّ ناجحاً وهو أفرغ** — الصنف يصدّر كائناً واحداً لا دوال، فقيست **صفر** دالة. ⇒ **الفحص الفارغ ينجح دائماً**؛ لا بد من `expect(measured).toBeGreaterThan(N)` قبل الوثوق بأي قائمة. (نفس الدرس الذي أنقذ `core/api` حين كشف تناقض 23←2).
  - **الاستثناء الموثَّق**: `adapterMockGate` يشترط أن تُرجع mocksُ الاختبارات `isElectronPg` قيمة `false` (كي تختبر الـfallback). بابا القابلية جديدان يقيسان **سطح المكتب** عمداً ⇒ `true`، وهو **استثناء مكتوب بسببه** لا تجاوز صامت.
  - **لم أُرحّل شيئاً في هذه الجولة** — وهذا هو القرار. ترحيل 50 استدعاءً في `accounting` على أساس عدّاد انكسر ثلاث مرات كان خطأً منهجياً، لا مجهوداً.
  - **التحقق**: `tsc` نظيف · eslint نظيف · **241/241** ملف اختبار (**22** بوابة) · build · `db:check` نظيف.

- **2026-09-25 (الحزمة 8b: «الخدمة الذرّية» ليست ذرّية — والتعويضات الثمانية لم تكن تُفحص):**
  - **العيب**: الملف يقول في رأسه إن الترحيل «إما ينجح كاملاً أو يتراجع بالكامل»، والكود **Saga بتعويض يدوي**: معاملة أمامية (مُفحوصة) ← القيد في معاملة منفصلة ← عند فشله **تعويض**. والمشكلة: **التعويضات الثمانية كلها كانت مُهمَلة** — `await adapter.transaction([...])` بلا فحص للنتيجة. ⇒ عند فشل القيد **وفشل التعويض** (انقطاع/مهلة/قفل) يبقى المستند `posted` برصيد معدَّل و**بلا قيد محاسبي**، والمستخدم يقرأ رسالة خطأ نظيفة توحي بأن شيئاً لم يحدث. وليس خطأً نادراً: أي ارتجاف لحظي في القاعدة أثناء التعويض كان يولّده.
  - **الإصلاح (بلا مساس بالمنطق المحاسبي)**: مساعد واحد مشترك `compensate()` يفحص نتيجة التعويض، ويسجّل سبب الفشل باسم السياق، ويعيد `EXTERNAL_ERROR` **برسالة صريحة** أن المستند ما زال مُرحَّلاً وبلا قيد ويحتاج مراجعة يدوية. **مسار النجاح لم يتغيّر** — فقط فشلٌ كان خفياً صار مرئياً. والمLogging انتقل داخل المساعد فلا تكرار.
  - **لماذا لم أُصلحها ذرّياً**: المعالجة الحقيقية = إدخال القيد في **نفس** معاملة التحديث،COMPARE مع `journalEntryGenerator` الذي يملك معاملاته الخاصة — أي **توحيد posting SQL**، وهو بند قرارك المعلَّق. ما فعلته هنا هو أمان بلا تغيير سلوكي.
  - **اختبارات (6) وُلّدت مع الإصلاح** (لم يكن لـpostingService أي اختبار — جزء من سبب بقاء العيب): فشل القيد + نجاح التعويض ⇒ الرسالة النظيفة القديمة؛ فشل القيد + **فشل التعويض** ⇒ `EXTERNAL_ERROR` + رسالة المراجعة + تسجيل السبب؛ التعويض **يرمي** استثناءً لا يعيد فشلاً ⇒ يُعالَج؛ والمسار الناجح/non-draft لم يتغيّرا. **مُثبَت عكسياً**: بإعادة الملف من `HEAD` سقطت **3** من 6، ونجحت 3 «المسارات غير المتغيّرة» — بالضبط كما صُمّمت.
  - **أثر العدّاد — انتبه لما هو ليس تحصيناً**: 419 ← **412**، و`rawSqlRatchetGate` 673 ← 666 (`core` 106 ← 99). هذا **تجميع** 8 مواقع تعويض في موقع واحد، أي **نقطة اختناق واحدة** للترحيل لاحقاً — **لا** إزالة SQL خام من سطح المكتب. declare it plainly: التعويض ما زال يمرّ عبر `_exec`؛ ما تحسّن هو **الأمان**، وقلّة التكرار.
  - **الملاحظة الحاكمة**: `postingService` 12 موقعاً ← 5 (1 تعويض مشترك + 4 أمامية).
  - **التحقق**: `tsc` نظيف · eslint نظيف · **239/239** ملف اختبار (**20** بوابة / **129** تأكيداً) · build · `db:check` نظيف.

- **2026-09-25 (الحزمة 8a: ترحيل قراءات الترحيل — وكشف أن الرقم 159 كان مُضلِّلاً والحقيقة 419):**
  - **الحزمة (الجزء الآمن فقط)**: استعلامات فحص الحالة الأربعة في `postingService.ts` صارت قناة واحدة لكل مسار. **المعاملات الثلاث عشرة بقيت** — والسبب في الأسفل.
  - **عيب محاسبي حقيقي — «الخدمة الذرّية» ليست ذرّية**: الـheader يقول «posting either succeeds completely or rolls back entirely»، لكن الكود **Saga بتعويض يدوي**: معاملة أمامية (مُفحوصة) ← ثم القيد في معاملة منفصلة ← عند فشله **تعويض** يعيد الحالة والرصيد. والمشكلة: **التعويضات الثمانية كلها غير مُفحوصة** (`await adapter.transaction([...])` بلا فحص للنتيجة) في الدوال الأربع. ⇒ إن فشل القيد **وفشل التعويض** (انقطاع شبكة/مهلة) تبقى الفاتورة `posted` برصيد معدَّل و**بلا قيد محاسبي**، والمستخدم يرى رسالة خطأ نظيفة توحي بأن شيئاً لم يحدث. إصلاح هذا = توحيد posting SQL، وهو بند **يحتاج قرارك**.
  - **الاكتشاف الأكبر — كان عدّادنا يكسر في الاتجاه الخطر**: خطآن متراكمان:
    1. **المُقسِّم لم يعرف دوال كائن التصدير**. كان يتعرّف على `function` و`const` فقط، فابتلع **كل** توابع `export const hrApi = { … }` في آخر دالة مُعلَنة — فنُسبت **65** استدعاءً إلى مساعدٍ من استدعاءين. و mushroom: `hr/api.ts` سُجّل **3** بدل **68**.
    2. **قاعدة «الحارس في أي مكان داخل الدالة»** صفّحت الباقي. الاتجاه هنا هو الخطر: **نقصان** لا زيادة.
  - **النتيجة الصادقة**: السقف كان **159** (وأعلنته كإنجاز)، والحقيقة **419** في 59 ملفاً. كل «التقدّم» من 197 ← 159 كان **جزئياً على أساس قياس معطوب**؛ الحركات الحقيقية (تسلسل المستندات، auth، 6+15 مرجعية، 4 قراءات ترحيل) صحيحة، لكن الرقم المُعلن كان ناقصاً بنحو الضِّعف.
  - **الدرس**: ثلاث مرات في أربع جلسات انكسر عدّادنا، و**كل مرة في اتجاه مختلف** — مرة زاد (197)، مرة نقص (159)، مرة غسل دالةً كاملة. ⇒ **لا يُعلَن رقم عن keamanan قبل إثباته عكسياً**؛ و«القياس» الذي لا يستطيع أن يخطئ صامتاً يجب أن **يخطئ بصوت عالٍ** (اكتشاف الحارس كان ضرورياً: لولا تناقض 23←2 لَما هُنِّد).
  - **الإصلاح**: المُقسِّم يتعرّف على أربع صيغ (منها توابع الكائن)، وقاعدة الحارس تشترط أن **يسبق** أول استدعاء خامً وأن يكون بينهما `return` — **متحفّظة عمداً**: صيغة حارس غير معروفة تُحسب قابلة للوصول، لا معذورة. الزيادة تظهر كعمل، والنقصان يُخفيه.
  - **الحسم لم يأتِ مجاناً**: `postingService` سقط من 16 إلى 4 في القياس الكسول لأن إضافة حارس لقراءة واحد جعل الدالة تبدو محميّة بالكامل — **نفس الغسل الذي حذّرنا منه سابقاً، لكن على مستوى الدالة**. ⇒ لم أقبل الرقم 143؛ قبلت 419.
  - **التحقق**: `tsc` نظيف · eslint نظيف · **238/238** ملف اختبار (**20** بوابة) · build · `db:check` نظيف.

- **2026-09-25 (الحزمة 7b: 15 كتابة مرجعية — وكشف أن `paramCount` عقدٌ لا يراه أحد):**
  - **الحزمة**: `create/update/delete` لـ productTypes و units و cashBoxes و costCenters، و`create/update` لـ payrollComponents، و`updateDefaultAccount`. نفس قرار 7a: **بلا `permission`**، لأن المسار الخام كان يمرّ على `assertSqlAuthorized` أيضاً ⇒ التفويض مطابق بالبناء. والشركة ومستخدم التدقيق من الجلسة.
  - **الاكتشاف الحاسم — 10 من 15 عدّاداً خاطئاً**: كتبت `paramCount` بالعدّ البصري. **لا أحد يراه**: لا اختبار وحدة يدخل العملية الرئيسية، والـshim لا يفرض العدد إطلاقاً ⇒ الخطأ يظهر في الإنتاج على سطح المكتب فقط كـ `Expected N parameter(s), got M` وميزة تتوقف بصمت. والعدّ البصري هو الآخر فشل فعلاً: أول محاولة أعطت «params=18» لقائمة فيها 17 عنصراً (فاصلة أخيرة)، و`$0` لأعلى placeholder بسبب regex لم يحترم CRLF.
  - **الحل: لا تعدّ — نفّذ**. البوابة الجديدة `rpcArityGate.test.ts` تستخرج كائن القناة من `dbHandler.js`، **تقيّمه** بـ`new Function`، ثم **تستدعي `compose` الحقيقي** وتطلب ثلاثة أعداد متسقة: `paramCount` المعلن = `params.length` = أعلى `$N` في SQL. الكود لا يكذب على عدد نفسه. النتيجة: **10 أخطاء حقيقية** وُجدت وأُصلحت في نفس الجلسة.
  - **البوابة تشمل أيضاً**: أن كل قناة تكتب بـ`WHERE id` **تتحقق** من الـid (وإلا وصل معرّف مشوّه إلى PG كخطأ صياغة على عمود uuid بدل رفض الطلب)، وأن كل قناة كتابة تأخذ شركةها من الجلسة. والمُتخطّاة لكل واحدة **سببٌ مكتوب** — الإغفال غير المبرَّر يمرّ كأنه مقصود.
  - **البوابة بوقتها أوقفت مبالغة مني**: كتبت في `BASELINE` أن `core/api.ts` خرج من القائمة، فأسقطت البوابة ذلك — والملف فيه **2** فعلياً (`applyDefaultTemplate`، معاملة متعددة الجمل مؤجّلة). ⇒ كان 23 ← 2، **لا** إلى صفر. أثبتُ العدد الصحيح بسبب مكتوب.
  - **أثر القياس**: السقف 174 ← **159**؛ القنوات 162 ← **177**.
  - **التحقق**: `tsc` نظيف · eslint نظيف · **238/238** ملف اختبار (**20** بوابة / **131** تأكيداً) · build بـ19s · `db:check` نظيف.

- **2026-09-25 (الحزمة 7a: ستّ قراءات مرجعية — وكشف أن حلقة `for` تُطفئ بوابةً بهدوء):**
  - **الحزمة**: `core.getProductTypes/getUnits/getCashBoxes/getCostCenters/getPayrollComponents/getDefaultAccounts`. **بلا `permission` مقصوداً**: المسار الخام الذي تحلّه كان يمرّ على `assertSqlAuthorized` أيضاً، فقواعد الجداول هي التي كانت تقرّر: `units`/`cash_boxes`/`default_accounts` `readAny`، و`product_types` يحتاج `inventory.*`، و`cost_centers` يحتاج `accounting.*`، و`payroll_components` يحتاج `hr.*`. إضافة صلاحية صريحة **لا تُعيد** السلوك القديم بل **تغيّره**. ⇒ التفويض مطابق قبل وبعد بالبناء، لا بالافتراض.
  - **اكتشاف أثناء التنفيذ — حلقة DRY تُطفئ بوابةً بهدوء**: سجّلت القنوات الست في `for` فوق جدول أسماء (بدلاً من ستّ تسجيلات). نظيف للعين، لكن `typedRpcSurfaceGate` يكتشف القنوات بمطابقة `registerRpc` مع اسم محاط بعلامة اقتباس، فالحلقة **تمحو الأسماء من المصدر** وتختفي من 검사 البوابة ⇒ فحص ربط الـpreload يتوقف صامتاً. فكّكت الحلقة وكتبتها واحدة واحدة، وأضفت بوابة ترفض `for … registerRpc(var`. **مصدر مطوّل = ربط مُتحقَّق منه**.
  - **اكتشاف ثانٍ — تعليقي أنا هو ما كسر بوابة `mainProcessTenantGate`**: كتبت في تعليق تفسيري الشكل الحرفي لاسم القناة، فطابقه الماسح **داخل التعليق**، ثم مشى قوسه 276,224 حرفاً ابتلع بها باقي الملف ⇒ العدّ من 162 إلى 20. البوابة لاحظت (فحصها الذاتي «ماسح مكسور يمرّ بالغياب»)، لكن الإصلاح مكانه: `stripComments` قبل المسح مع حفظ الأسطر، فصار التعليق غير قادر على إطفاء التدقيق. **مُثبَت عكسياً**: أعدت التعليق المُعيد тоافق 5/5. الدرس: **تعليق توثيقي يجب ألّا يكون قادراً على إطفاء تدقيق** — صحّة الماسح ليست مسؤولية كاتبه.
  - **ثلاثة تنفيذات يجب أن تتفق**: كل قراءة موجودة في الـrenderer والعملية الرئيسية والـshim. انحرافٌ في الجدول أو `is_active` أو الترتيب يعني أن المتصفح وسطح المكتب يعرضان صفوفاً مرجعية مختلفة في نفس القائمة — عيب **لا يراه أي اختبار وحدة** لأن الاختبار يشغّل واحداً فقط. أضفت بوابة تطابق الثلاثة.
  - **أثر القياس**: السقف 180 ← **174**، و`core/api.ts` 23 ← 17.
  - **التحقق**: `tsc` نظيف · eslint نظيف · **237/237** ملف اختبار (**19** بوابة / **127** تأكيداً) · build بـ13s · `db:check` نظيف.

- **2026-09-25 (الحزمة 6: حارس `auth` كان حقيقياً — لكن إحدى 14 طريقةً كانت تفلت منه):**
  - **ما تحقّقت منه بدل الافتراض**:
    `auth/api.ts` كان ضمن قائمة الـ197. افترضت أن `mainAuthBridge()` يحرسه، فتحقّقت: **13 من 14** طريقةً تستدعي `mainAuthBridge()` قبل استدعاء الـadapter، و**`getUserById` وحدها لا تفعل** — كانت `SELECT * FROM users` خاماً تعبر قناة `db:internal-query` على سطح المكتب في وضع server-PG. باب حقيقي، لا كاذب.
  - **الإصلاح**: قناة `auth:get-user-by-id` في العملية الرئيسية — `getSession` ثم `hasPermission('settings.view')` ثم `UUID_RE`، و`company_id` من الجلسة **لا من الـpayload** (تمرير companyId هنا كان يسمح بقراءة صف مستخدم من مستأجر آخر). التوقيع في `preload.cjs` + `preload.js` + `ElectronAuth` interface، والطريقة صارت تستشير الجسر أولاً. الـshim لم يُلمس: `electronAuth` فيه مصغّر عمداً (`logout` و`getSession` فقط)، و`getDbMode()` في e2e هو PGlite فيعود `mainAuthBridge()` فارغاً — إضافة `getUserById` هناك ستكون كوداً ميتاً.
  - **العيب الأعمق — توقّفت عن الـregex**: الحارس الثاني له **أربع** صيغ صحيحة: `if (mainAuth) { return }` · `if (mainAuth) return` · `if (mainAuth?.listRoles)` · `if (!mainAuth) { ...adapter... }`. كتبتُ regex لكل صيغة، وفي الصيغة الرابعة عجزت فسجّلت 7 طرق «غير مُثبتة» — وكنت على وشك كتابة regex خامس. regexp لا يُثبت الضابط أبداً؛ **السلوك وحده يفعل**. الاختبار الجديد `api.bridgeGuard.test.ts` يركّب الجسر ثم يؤكد أن **أي** طريقة auth لا تلمس الـadapter، فيسقط فوراً لو انكسر أي ضابط مهما كانت صيغته. مُثبَت عكسياً: تعطيل ضابط `getUserById` أسقطه بالاسم («reached adapter.query… called 1 times»).
  - **أثر القياس**: السقف 197 ← **180**، و`auth/api.ts` خرج من القائمة (35 ملفاً ← 34). البوابة تعرف الآن نمطَي الحارس، وكل نمط مربوط بالاختبار الذي يُثبته.
  - **التحقق**: `tsc` نظيف · eslint نظيف · **237/237** ملف اختبار (**19** بوابة / **122** تأكيداً) · build بـ15s · `db:check` نظيف.

- **2026-09-25 (الحزمة 5: قياس «القابل للوصول» كان معكوساً — وتصحيحه كشف 197 استدعاءً على سطح المكتب):**
  - **الخطأ الذي وقعت فيه**: الـtranches السابقة أبلغت «صفر استدعاء خام قابل للوصول على سطح المكتب» واعتبرت الباقي fallback PGlite مُثبَت. هذا الرقم جاء من ماسح يعدّ الاستدعاءات الواقعة **داخل** كتل `isElectronPg()` — وهو الاتجاه **المعاكس**. الاستدعاء داخل تلك الكتلة محمي أصلاً؛ والاستدعاء في دالة أو ملف **لا** يفحص هو الذي يهرب إلى سطح المكتب.
  - **الدليل سطر واحد** من `electronPgAdapter.ts`: `async query(sql, params) { const raw = await getDB()._exec(convertPlaceholders(sql), params); }` — محوّل سطح المكتب **ليس** تنفيذاً ثانياً، بل يمرّر إلى قناة `db:internal-query` مباشرة. فأي `adapter.query` يصله سطح المكتب **هو** SQL خام يعبر حدود العملية.
  - **الرقم المصحَّح**: **197** استدعاءً في **35** ملفاً، لا صفر. (242 بدقة الدالة قبل هذه الحزمة؛ و`browserBridge.ts` معفى بـ37 — جسر PGlite للذكاء الاصطناعي، نظيره على السطح هو `electron/aiHandler.js`.)
  - **خطأ ثانٍ**: أول إعادة قياس جمّعت **حسب الملف**، فتحسين أربع دوال في `core/api.ts` علّم الملف كله «محمي» وغسل 23 استدعاءً خاماً في جيرانها غير المحميين — أي أن الحزمة بدت مكسباً مزدوجاً. البوابة الآن تقيس **على مستوى الدالة** وتثبّت خط أساس **لكل ملف**، حتى لا يستدرج ملف جديد سلفاً داخل ملف قيد الترحيل.
  - **الحزمة نفسها**: `getNextDocumentNumber` أثقل استدعاء خام باقٍ — كل فاتورة وسند وإيصال ورقم منتج يمرّ به، وعلى مسار PGlite يُدرج اسم جدول من خريطة. الخريطتان (`DOC_TYPE_TO_TABLE` و`DOC_TYPE_TO_NUMBER_COLUMN`) انتقلتا إلى العملية الرئيسية، فلا يصل أي معرّف إلى جملة من الـrenderer. أربع قنوات: `core.getDocumentSequences` · `core.updateDocumentSequence` (خلف `settings.edit`) · `core.peekNextDocumentNumber` · `core.getNextDocumentNumber`. والتنسيق (حشو الأرقام واللواحق) يبقى في العرض — الصف هو من يقرّر الحشو.
  - **البوابة مُثبَتة عكسياً**: حقن `adapter.query` واحد غير محمي في `core/api.ts` أسقطها مرّتين — بالمجموع (198 مقابل 197) وبالاسم (`src/core/api.ts: 23 -> 24`). بوابة لم تُسقط قط ليست دليلاً على شيء.
  - **ملاحظتان تشغيليتان**: التعبير `[^}]*` لا يجد نهاية كائن داخل template literal، لأن أجسام الدوال تحتوي `}` فيقتطع المطابقة في منتصفها (وهذا ما أفسد shim الخاص بـe2e في المحاولة الأولى؛ الحل عدّ أقواس واعي بالهروب). وداخل backtick template لا حاجة لهروب علامة الفاصلة المفردة، لذا كُتبت `error:"No company"` بلا هروب — أما كتابة `\'` فتسقط قاعدة `no-useless-escape`.
  - **التحقق**: `tsc` نظيف · eslint نظيف · **236/236** ملف اختبار (**19** بوابة / **116** تأكيداً) · build بـ23s · `db:check` نظيف · shim يُحلَّل بفحص القالب المُقيَّم. Commit `efa4d2f`.

- **2026-09-24 (الحزمة 4: 8 قنوات main كانت تأخذ الشركة من الـpayload — والدفاع كان طبقة واحدة):**
  - **قياس جديد قبل البناء**: بدل عدد الاستعلامات، سألت **«أي طبقة تتجاوز الجلسة»**. النتيجة المفاجئة: **صفر** استدعاء خام داخل كتلة `isElectronPg()` في `src/` ⇒ الوحدات الأساسية مُرحَّلة، والأسطح كلها fallback PGlite. **«صفر» ثمرة مقيسة** — لكنها لم تعطِ عملاً هذا اليوم.
  - **ما وجده المسح بدلاً منه** (على `dbHandler.js` لا `src/`): **8 قنوات `registerRpc` تربط `company_id` من الـpayload** — `accounting.createAccount/getTransactions` · `inventory.getProducts/createProduct` · `contacts.getCustomers/getSuppliers/createCustomer/createSupplier`.
  - **الدفاع القائم**: `registerRpc` **يرفض** companyId المخالف قبل تشغيل المعالج ⇒ ليست ثغرة اليوم. لكنها **ثقة في طبقة واحدة**؛ وطبقة الثقة الوحيدة هي التي سقطت في `audit`. ⇒ **الربط صار من الجلسة**، والقيمة صارت مستحيلة التزوير لا مجردة المرفوضة.
  - **خطآن أخطأتُ بهما وكشفهما الفحص** (لا `node --check`):
    1. استبدال `p.companyId` بـ`session.user.companyId` داخل `validate: (p) =>` **ترك مرجعاً لـ`session` غير معلَن** ⇒ **ReferenceError عند أول نداء**، لقناتين فقط. **صنف جديد من الغيب الصامت**: إشارة تعمل، تعريفها مفقود.
    2. `getAccounts` أصلحته ثم **أعدت الملف من HEAD** ⇒ الإصلاح **مطموس**، ولم تنتبه إلا حين أظهر العدّ 9 لا 8 ⇒ **الاسترجاع من git يبطل عمل الجلسة إن لم يُعد** (درس: **لا تسترجع ملفاً فيه عمل غير مُلتزم**).
  - **البوابتان (2 إضافيتان لـtenantSourceGate ⇒ 7 اختبارات)**:
    - **لا قناة تربط الشركة من الـpayload** (عدّاد لا أسماء ⇒ كاشف الأسماء أخطأ مرتين: أسقط قناة، ونسب واحدة لـ`_cid`).
    - **كل توقيع يصل إلى `session` يعلنه** (بمطابقة أقواس لكل قناة على حدة، 152 قناة).
  - **الشيم**: `getAccounts` فيه كان يقرأ `p.companyId` ⇒ حُوّل ليجلب الشركة كغيره. **المتبقي 8 قنوات شيم** موثّقة **بالعدّ** لا بالإصلاح: محاولة تعديل 8 قنوات دفعةً **أفسدت السطح مرتين** على سطر بـ124,000 حرف ⇒ **الفائدة صفرية** (الشيم أحادي المستأجر موثوق)، والخطر قابل للتوثيق. **القاعدة: لا تُصلح ما لا يُكسر، وثّق ما يُترك** — وإلا أُفسدت ما يعمل.
  - **إثبات عكسي**: حقن `p.companyId` في `contacts.getCustomers` ⇒ سقطت بالاسم؛ وحقن `session` بلا تعريف في `getAccounts` ⇒ سقطت بالاسم. كلاهما مُستعَد.
  - **دروس (تكرار #4 و#5)**: (1) **CRLF يكسر المراسي النصية** (أربع مرات في الجلسة)؛ (2) **الاسترجاع من git** باطل عمل الجلسة؛ (3) **العدّاد لا يُخطئ في الاتجاه الخطير** بينما كاشف الأسماء يخطئ.
  - **التحقق**: tsc · eslint src+e2e · **235 ملف أخضر** · accounting 190/190 · `src/test` **18 بوابة/111** · build 34s · db:check · `node --check` لـdbHandler.

- **2026-09-24 (الحزمة 3: `setJevSetting` — كتابة مفتاح JEV عبر قناة لا payload):**
  - **الهدف المعلن كان رافعة `guardedQuery`** (76 callsite) ⇒ **قياس قبل البناء كشف أنها سليمة**: حارسها `guardSqlQuery` (SELECT + جداول مسموحة)، و13 استدعاءً «بلا company_id» كلها `${w}` يبدأ بـ`company_id=$1::uuid` و`p[0]=ctx.companyId` ⇒ **مُثبتة يدوياً، لا مفترضة**.
  - **البديل عالي الأثر**: مسح «كتابة جدول مشترك من الـrenderer» كشف `setJevSetting` ⇒ `DELETE/INSERT INTO settings` بـ`companyId` من الـpayload ⇒ **مستخدم `settings.edit` في شركة A يستطيع كتابة/مسح مفتاح JEV في B** (نفس صنف `audit`، ومفتاحه **apiKey**).
  - **الإصلاح**: توجيه `setJevSetting` إلى قناتي `core.setSetting` (موجودة، company من الجلسة) + **`core.deleteSetting` جديدة** لمسار الحذف (لم تكن هناك — `core.setSetting` upsert فقط ⇒ مسار الحذف كان يمر حتماً عبر SQL خام). fallback PGlite باقٍ (أحادي المستأجر). **توقيع الدالة لم يتغيّر** ⇒ 6 مواقع استدعاء دون تعديل.
  - **ملاحظة عن الشيم**: `core.setSetting` **لم تكن موجودة في شيم e2e أصلاً** (القناة موجودة في main، والشيم نقصها ⇒ مسار PGlite في e2e كان يتجاوزها). أُضيفت `setSetting` + `deleteSetting` معاً — **الشيم كان ينقصه قناة قائمة أصلاً** ⇒ درس: فحص `typedRpcSurfaceGate` (القناة موجودة في 5 مواضع) هو ما يمنع هذا.
  - **السقف لم يتحرك (673)**: `setJevSetting` يحتفظ بالـfallback. **ما تحرّك هو المسار المنفَّذ على سطح المكتب** — وعدّاد سطحي لا يُقرأ كترحيل.
  - **درس قياس (متكرّر)**: **الهدف الأعلى رافعةً ليس بالضرورةikin cong công** — `guardedQuery` (76) كان مرشّحاً-orruptкي no-op لأن حارسه قوي، و`setJevSetting` (6) هو الأثر الحقيقي. **الترتيب بعدد المستدعين غير كافٍ؛ الترتيب بـ«هل الطبقة تتجاوز الـsession»**.
  - **التحقق**: tsc · eslint src+e2e · **235 ملف أخضر** · `src/test` 18 بوابة/108 · build 10.75s · db:check · الشيم `PARSE_OK` · jev tests 40/40.

- **2026-09-24 (الحزمة 2: سجل التدقيق `audit` — P0 جديد + نسختان متطابقتان تحت اسمين):**
  - **قياس الرافعة قبل العمل**: بدل ترحيل وحدة، قِستُ **المستدعين لكل دالة تحوي SQL خام** ⇒ هدفان: `logAudit` (استعلام واحد، **71 callsite في 30 ملفاً**) و`guardedQuery` (76/7). **ترتيب المتبقي بالرافعة لا بعدد الاستعلامات** — فالدالة الواحدة قد تساوي 71 مساراً.
  - **P0 جديد (لم ترصده بوابة النطاق القائمة)**: `logAudit` كان `INSERT INTO audit_logs (..., company_id) VALUES (..., $9)` والقيمة **من الـrenderer** ⇒ أي مستخدم مُصادقكان يستطيع تسجيل entry في شركة أخرى. **لماذا نجت من الفحص**: البوابةExisting تسأل «هل الجملة تحمل `company_id` predicate» — وهي تحمله. **الـpredicate يثبت أن العمود مُنطَّق، ولا يثبت أن قيمته جاءت من الجلسة.** ⇒ بوابة جديدة `tenantSourceGate` تسأل السؤال الأصعب.
  - **نسختان تحت اسمين** (اكتشاف متلحق): `core/utils/auditLogger.ts` و`core/audit/auditLogger.ts`. الثانية مشتقة user من المتجر لكنها **كانت تفضّل `entry.companyId`** ⇒ نفس الثغرة بقبعة أخرى. **وحدة واحدة، منطقان، ثغرتان.**
  - **الإصلاح**: قناتان `audit.log` + `audit.list` — company **و** user من الجلسة، والـpayload لا يحمل أياً منهما؛ تحويل `logAudit`/`getAuditLogs` إلى القناة مع **fallback PGlite** (أحادي المستأجر ⇒ لا нейود له).
  - **لماذا الإصلاح مسّ الـ`getAuditLogs` أيضاً**: كان يبني SQL ديناميكياً من الـrenderer (5 فلاتر) ⇒ نفس الطبقة، ونفس المعاملة.
  - **قاعدة مقصودة**: الـfallback يبقى عمداً ⇒ **السقف الرقمي لم يتحرك** (673). ما تحرّك هو **أي مسار ينفَّذ على سطح المكتب**، لا عدد الأسطر. **عدّاد سطحي يقيس الشكل لا السلوك** — ولا يجوز أن يُقرأ انخفاضه كترحيل.
  - **البوابة الثانية `shimStringGate` (4 اختبارات)**: صنف **الاقتباس المتباعد** (`"`…`'`) وقع **مرتين في حزمة واحدة** داخل شيم e2e — Symptom: «Invalid or unexpected token» في سطر بـ124,000 حرف. الكاشف يمرّ على السطر حرفاً حرفاً (regex لا يميّز فتح/إغلاق)، و**الأول أنتج إيجابيات كاذبة** على `getAccounts` لأن SQL nests عمداً ⇒ صُحّح ليعتمد **«سلسلة لم تُغلق»** لا «نوع إغلاق مخالف».
  - **إثبات عكسي** (للبوابة): إعادة حقن `NOW())'` سقطت البوابة؛ استُعيدت.
  - **دروس مكرّرة في هذه الحزمة**: (1) `as const` / `: unknown[]` **داخل ملف JS** — `node --check` يمسكها، لكن `node -e` مع PowerShell يرفض الاقتباس قبل ذلك؛ (2) **الأقواس والاقتباسات متوازنة** ≠ الشيفرة تُحلَّل — الاعتماد على `node --check` لملف JS **لا يمسّ** شيم TS داخل template literal؛ (3) **نسخة مزدوجة تحت مسارين**: البحث بالاسم الصريح (`0 imports`) هو ما كشف موت النسخة الثانية.
  - **التحقق**: tsc · eslint src+e2e · **235 ملف اختبار أخضر** (كان 229) · `src/test` **18 بوابة / 108** · build 18.6s · db:check · `node --check` للملفات الثلاثة · **الشيم `PARSE_OK`**.

- **2026-09-24 (الرحلة 1: ترحيل وحدة `tax` إلى typed RPC + محوّل افتراضي الحسابات — ثلاث بوابات جديدة):**
  - **القياس قبل البناء (ودَروسه)**: أول مسح للـSQL الخام أعطى **475** callsite؛ القياس الدقيق (regex **generics-aware**) أعطى **673**. الفارق: `adapter.query<{...}>(...)` — الـgeneric بين الاسم والقوس أهملته. **عدّاد ناقص أسوأ من لا عدّاد: أول ترحيل يبدو كأنه حرّك الرقم بينما حرّك الـregex فقط.**
  - **ما رُحّل**: وحدة `tax` كاملة (7 قنوات) — وهي **حارس ترحيل** يدخل 8 مسارات نشر، فكان وصولها إلى PG عبر القناة الخام. + `core.getDefaultAccountId` (36 callsite في 10 ملفات تمرّ عبرها) + `core.findAccountByCode` (للـfallback بالأنماط، بلا نسخ ثانٍ).
  - **قرار تصميمي**: **بلا `permission` صريح** في أي قناة جديدة — `settings`/`tax_periods` هي `readAny`، وأرجل الدفتر تقرأ تحت `accounting.view|own|reports.view`. تسمية صلاحية هنا = مصدر حقيقة ثانٍ ينحرف.
  - **تحسينان أثناء الترحيل**: `setContext` صار **بياناً واحداً ذرّياً** (`unnest`) بدل حلقة INSERT كان فشلُ الثاني يترك البلد/التوقيت نصف مكتوبين؛ و`computeVatReturn` صار **استعلاماً واحداً مُجمَّعاً** بدل استعلامين (نفس SQL في المسارين).
  - **`core.findAccountByCode` يرجع null في Electron ولا يقع في الـadapter** — الوقوع كان سيعيد `_exec` لمسار النشر عند غياب الـdefault mapping.
  - **البوابة الأولى `typedRpcSurfaceGate` (8 اختبارات)**: كل قناة يجب أن توجد في **5 مواضع** — dbHandler · preload.cjs · preload.js · المحوّل · شيم e2e. و**الشيم يُقيَّم كـtemplate literal** (لا نص خام).
  - **البوابة الثانية `rawSqlRatchetGate` (6)**: سقف لكل وحدة + سقف إجمالي (673). **لا يُرفع السقف إلا بتخفيض رقم**. + تثبيت مسارات `tax` و`getDefaultAccountId`.
  - **البوابة الثالثة `adapterMockGate` (2)**: أي اختبار يحاكي `adapters` **يجب** أن يوفّر `isElectronPg` ⇒ **28 ملف اختبار** أُصلح دفعةً. landmine: كان الخطأ `No "isElectronPg" export is defined on the mock` — يشبه عيب إنتاج.
  - **ثلاث علل حقيقية كشفتها البوابات في كتابي أنا** (لا في الكود القديم): استبدال بمطابقة مرساة **أسقط `core.getSettings`** · استبدال آخر **حذف `pos?: {`** من الواجهة · أقواس اقتباس **متباعدة** (`"` … `'`) في 4 نصوص SQL بالشيم. **كلها مرّت `node --check`** لأن الأخطاء كانت دلالية لا نحوية.
  - **فجوة سابقة كشفتها البوابة**: سطح `purchases` **غير موصول في `getRPC()`** (كان يسقط بصمت لو استُدعي) — وُصل. و`sales.postInvoice`/`postReturn` **معطّلان بالتصميم** (`validate` يرمي دائماً) ⇒ استثناء **موثّق** + اختبار يتحقق أن كل استثناء ما زال معطّلاً فعلاً وأن لا معطّلاً بلا توثيق.
  - **درس تكرار (CRLF/worker)**: (1) مرساة بـ`\n` لا تطابق ملف CRLF — **رابع مرة**؛ و`git show` يُخرج **LF** فالمراسي تتغيّر بعد أي استرجاع؛ (2) "الفشل يتبدّل بين تشغيل وآخر" على جهاز منخفض الذاكرة = **تشويش ذاكرة لا كود**: كل إخفاقات المجموعة الكاملة خضراء منفردة.
  - **التحقق**: tsc · eslint src+e2e نظيفان · **229 ملف اختبار أخضر** (مع 4 worker-timeout من الجهاز، كل ملف منها أخضر منفرداً) · `src/test` **16 بوابة / 99** · build 29s · db:check نظيف · `node --check` للـpreload twins وdbHandler · **الشيم `PARSE_OK` بعد التقييم**.

- **2026-09-24 (البوابة الثالثة عشرة `auditDocIntegrityGate` — تنظيف الوثيقة التي نُشرت مشوّهة):**
  - **الاكتشاف**: بعد نشر v0.26.1 صار واضحاً أن **هذه الوثيقة نفسها** تحمل نصوصاً مشوّهة من كتاباتي السابقة — منشورة، أي أن القارئ يقرأها كادّعاءات لا كأخطاء كتابية.
  - **13 موضعاً مُصلَحاً**: `فاحصResultsilh determinstic` · `القياس Negative important كالإيجابي` · `نوعPermission` · `يوقفGeneration` · `موثّقةythe` · `scopeت` · `عنTrees يحتاج list` · ` dropping بادئة await` · `مسبار الحساسيةSame predicate` · `الرفض +_verifyأن` · `البوابةTenantScope` (مرّتان) · `البحث عنTrees` (صيغتان).
  - **الطريقان الخاطئان قبل الجيد** — وكلاهما أنتج ضجيجاً كلياً:
    1. **«كلمة لاتينية خارج backticks»** ⇒ **711 «مشبوه»** ⇒ عديمة الفائدة: الوثيقة **مزج عربي/إنجليزي مقصود** (`Phase`, `tranche`, `posting`, `typed`)، فأصبح المؤشر عديم التمييز.
    2. **«كلمة ملتصقة بين النصين»** ⇒ **139 «مشبوه»** ⇒ لأن **الفاصلة العربية `،` (U+060C) ضمن الصف العربي** ⇒ كل كلمة قبل فاصلة تطابق. بعد استبعاد الترقيم (أحرف فقط `\u0621-\u064A…`) انخفضت إلى **44**، وبعد استثناء **حروف الجر العربية** (`و`/`ل`/`ب`/`ك`/`ال` — لأن «والـFKs» و«وpersistence» أسلوب عربي سليم) إلى **16** ⇒ وكلها سليمة.
  - **المؤشر الفاصل**: **الكلمة نفسها** glued بلا حرف جر عربي قبلها — لا «كلمة إنجليزية قريبة من العربي».
  - **البوابة (4 اختبارات)**: شظايا مُصلَحة لا تعود · لا كلمة ملتصقة بلا حرف جر · لا محارف بديلة/CJK/نول · الملف المُفحوص действи (حجم + وجود سجل التغيير).
  - **مُثبتة عكسياً**: حقن `فاحصResultsilh determinstic` ⇒ سقطت بالاسم؛ ثم استُعيدت.
  - **درس (تصحيح ذاتي)**: **مسبار قال «لم يُحقن» وكذب** — حسبتُ النتيجة في متغيّر وكتبتُ المتغيّر الآخر (`probe` بدل `t`) ⇒ الملف لم يتغير ⇒ البوابة صدقت تمريرها. **كل «فشل بوابة» يجب أن يُشتبه فيه كخطأ في المسبار أولاً** (المسبار الذي لا يغيّر شيئاً ليس دليلاً على سلامة الهدف).
  - **لماذا بوابة لوثيقة؟** لأنها **منتج قرائي منشور**: خطأ كتابي في سجل قرارات = ادّعاء مشوّه يُؤخذ كسياسة. والبوابة أرخص من مراجعة 900 سطر يدوياً في كل مرة.

- **2026-09-24 (v0.26.1 — الإصدار + البوابة الثانية عشرة `docsVersionGate`):**
  - **الإصدار**: `package.json` + `package-lock.json` (موضعان) → `0.26.1`، مع **143 ملف توثيق** (142 صفحة `Docs/**/*.md` + فهرس `Docs/README.md`) كانت تحمل شارة `0.26.0`.
  - **تصحيح الأرقام**: البحث السريع أعطى «143 ملف» ⇒ ظننتُ أنها 143 صفحة؛ العدّ الدقيق = **142 صفحة + فهرس**. والقياس الصحيح (142 من 142 ملف `.md` يحمل مفتاح `version:`) هو ما جعل البوابة ممكنة.
  - **`__APP_VERSION__` محقون وقت البناء** من `package.json` (define في Vite) ⇒ شارة التطبيق لا تنحرف، **لكن التوثيق المكتوب ينحرف صامتاً** — لا شيء في البناء ينتبه. الفجوة الحقيقية كانت هنا.
  - **البوابة (4 اختبارات)**: حجم الشجرة ذو معنى (أكثر من 100 صفحة) · كل صفحة تُعلن `version` في مقدمة الملف · كل الصفحات تطابق `package.json` · الفهرس يحمل الختم نفسه.
  - **مُثبتة عكسياً**: إرجاع `Docs/ar/03-interface/index.md` إلى `0.26.0` ⇒ سقطت بالاسم؛ ثم استُعيدت.
  - **الدرس الأول (تقدير قبل القياس)**: هذا ثالث مثال على النمط نفسه — تقدير قبل البناء ثم تدقيق: FKs (112 ⇒ جرد دقيق) · قنوات RPC (regex أخترع 256 ⇒ مطابقة أقواس) · صفحات التوثيق (143 ⇒ 142+1). **التقدير يولّد الفرضية، والقياس هو ما يُبنى عليه القيد.**
  - **الترميز**: 8 ملفات فيها BOM أو mojibake — قورنت كل واحدة بـ**HEAD** المرجعي فكانت **8/8 سابقة** للترقية (لا بايتات ضائعة ولا عربية تالفة).
  - **درس (تصحيح ذاتي)**: المقارنة الأولى استخدمت `git show` بمسارات backslash ⇒ فشل صامت ⇒ حكمتُ زوراً «التعديل هو سبب الـBOM». إعادة الفحص بمسارات forward-slash أعادت الحقيقة. **القياس المرجعي يفشل صامتة أيضاً — لا يُوثَّق حكم من قياس واحد.**

- **2026-09-24 (البوابة الحادية عشرة: `mainProcessTenantGate` — قياس سطح العملية الرئيسية ثم تحميته):**
  - **الهدف**: نفس منهج جرد الـFKs، لكن على **سطح SQL في العملية الرئيسية** (`electron/dbHandler.js` — حيث تتحرك الأموال فعلياً) — وهو **لم يُفحص منهجياً** من قبل.
  - **القياس (140 قناة `db:rpc:*` + 30 معالج `ipcMain.handle`)**:
    - **ادّعاء P0 كاذب، ثم تصحيحه**: الكاشف الأول قال إن `accounting.createAccount` و`contacts.createCustomer` يكتبان في `p.companyId` من الـpayload بلا فحص ⇒ «ثغرة cross-tenant». **الفحص اليدوي أثبت العكس**: `registerRpc` فيه `request.companyId !== undefined && String(request.companyId) !== String(session.user.companyId)` ⇒ رفض صريح. **الدرس المتكرر: ادّعاء الكاشف يُفحص يدوياً قبل نشره.**
    - **الطبقتان مؤكَّدتان**: (1) `registerRpc` يرفض companyId المخالف + `assertSqlAuthorized` يفحص **الصلاحية** لكل جدول؛ (2) عزل الـtenant يعيش **داخل SQL نفسه** (WHERE بـ`session.user.companyId`) — لأن فحص الصلاحية **لا يفحص المستأجر**.
    - **النتيجة**: 7 قنوات من 140 لا تذكر `session.user.companyId` أصلاً: **5 قراءة مرجعية** + **2 كتابة** (`createCustomer`/`createSupplier`) تأخذ companyId من الـpayload ⇒ محمية بمُدقِّق `registerRpc`. ⇒ **لا فجوة اليوم**، والبوابة هي ما يبقيها كذلك.
  - **البوابة (5 اختبارات)**: وصول التحليل (>120 قناة + 4 مفاتيح محدّدة) · النطاق محافظ في الغالبية (≥ channels−8) · **حارس `registerRpc` ما زال موجودة** (تطابق نصّي) · **قناة كتابة بلا نطاق ⇒ لابدّ من سبب موثّق** · كل استثناء ما زال موجوداً ويحمل سبباً.
  - **مُثبتة عكسياً**: حقن قناة `contacts.PROBEcreateCustomerWithoutGuard` كتابةً بلا نطاق ⇒ البوابة سقطتها **بالاسم والجدول**، ثم استُعيد `dbHandler.js` (`node --check` نظيف).
  - **درس منهجي (جديد)**: **استخراج استدعاء متداخل الأقواس بمطابقة الأقواس من القوس المفتوح مع تخطي النصوص وbackticks** — `regex` على `[\s\S]{0,4000}?\n\s*\}\);` أعطى **256 قناة** ونسب الصلاحيات لقنوات خاطئة. نفس الدرس الذي عالج line-shape في Phase 77، من جديد على JS لا TS.
  - **الخلاصة**: **القياس السلبي كالإيجابي** — «لا فجوة» ثمرة مقيسة، والبوابة تحفظها. والأهم: مررتُ بفخّ P0 كاذب كاد أن يسجل في التاريخ — **التحقق اليدوي إجباري قبل أي ادّعاء**.

- **2026-09-24 (البوابة العاشرة: `fkCoverageGate` — جرد الـFKs صار ضابطاً دائماً):**
  - **لماذا**: الجرد كشف أربعة P0 في يوم واحد، لكنه كان **سكربتاً مؤقتاً** ⇒ يضيع ويبدأ من الصفر، ولا أحد يضيف عموداً جديداً بعلم. **قياس بلا ضابط ليس ضابطاً دائماً**.
  - **البوابة**: كل عمود مرجعي (`*_id` على جدول حي) إما يحمل FK **أو** له سبب موثّق. أي عمود جديد ⇒ CI يفرض إمّا القيد أو سطر السبب.
  - **السماح موثّق بالكامل (23 استثناءً)**: `unit_id` على 6 جداول سطور (قرار Phase 82: لقطة مجمّدة — حذف الوحدة الكتالوجية لا يكتب التاريخ) · `cash_box_id` على 8 جداول (قرار Phase 62) · `shift_id` (الوردية المغلقة لا تُحذف) · `branch_id` ×2 (لا مسار `deleteBranch`) · `category_id` (العلاقة الحقيقية m2m) · `vat_settings.account_id`. ⇒ **قرار موثّق لا يُصلَح سالباً**.
  - **تحليل SQL: أربعة أشكال** كان على الكاشف أن يتعامل معها (كل واحد أعطى نتيجة خاطئة أولاً): (1) Drizzle `REFERENCES "public"."x"("id")` · (2) هجرات مكتوبة يدوياً `REFERENCES %I(id)` / `REFERENCES x(id)` · (3) المواصفات `'a|b|c|d'` و`'a|b'` · (4) **مصفوفان متوازيان** (0038: `v_tables`/`v_names`، والعمود **مذكور حرفياً** في `FOREIGN KEY (product_id)` لا في الاسم). ⇒ استنتاج العمود من اسم القيد **تخمين عند حدود الشرطة السفلية** (`purchase_invoice_lines_product_id_products_id_fk`) ⇒ قُرئ `products` بدل `product_id` — **القاعدة: خذ العمود من نص العبارة، لا من الاسم**.
  - **الاختبارات (5)**: وصول الجداول (>60 + الستّ المهمة + المتقاعدة الثلاثة بالضبط) · وصول القيود (>180 + **ثمانية مفاتيح محدّدة من كل هجرة**) · **الاختبار العكسي على كاشف حقيقي** (حذف مفتاح `sales_invoices.customer_id` من المجموعة ثمّ تطبيق نفس_predicate ⇒ يجب أن يصير gap) · كل استثناء يحمل سبباً >10 محارف · **كل استثناء ما زال ضرورياً** (استثناء فقد صلاحيته يُسقط الاختبار) · صفر فجوة غير موثّقة.
  - **دروس مُضافة**: **القياس الذي لا يشترط سطراً لكل حالة = قياس يُنسى** · **الوصول (reach) والمدى يُختبران بأسماء مفاتيح محدّدة لا بأرقام** (العدد وحده يكذب مع كاشف معطوب) · **كاشف البوابة يحتاج اختباراته هو** (غير ذلك يصبح allowlist تنمو بهدوء).

- **2026-09-24 (Migration 0042 — مفاتيح الشجرات + توثيق «بلا FK عمداً»):**
  - **القياس قبل الترحيل** (لأن 24 بلا FK ليست كلها إهمالاً): كل عمود حُوِّل بثلاثة أسئلة: `nullability` · هل الحارس في الـAPI يفحص حذف الأب؟ · هل الجدول متقاعد؟ ⇒ `branch_id` على الخزائن/المستودعات **بلا خطر**: **لا يوجد `deleteBranch` في التطبيق إطلاقاً** ⇒ الفجوة نظرية اليوم. وحارس `deleteAccount` كان يفحص القيود فقط ⇒ **حذف حساب أب يترك الشجرة يتيمة** (نصف شجرة في شاشة شجرة الحسابات).
  - **0042**: `accounts`/`product_categories`/`cost_centers` × `parent_id` ⇒ **`CASCADE`** (الشجرة بلا معنى بلا جذرها — بخلاف المرجع المالي، و`deleteAccount` يرفض الحساب ذا القيود أصلاً). اليتامي ⇒ `NOT VALID`.
  - **حارس `deleteAccount`**: يفحص Children أولاً ويسمّي عددهم، ويفشل مغلقاً إذا فشل الفحص.
  - **توثيق «بلا FK عمداً» داخل الـmigration نفسه**: `cash_boxes.branch_id` · `warehouses.branch_id` · `products.category_id` · `vat_settings.account_id` (تصنيف nullable) · `receipt_vouchers/payment_vouchers.cash_box_id` (قرار Phase 62) ⇒ **الجرد اللاحق لن يقرأها كإهمال**. اختبار يثبّت وجود هذه الملاحظات.
  - **إثبات حي (PGlite)**: 3 قيود `del=c` · idempotent · **حذف الجذر أزال الشجرة كاملة (3 مستويات ⇒ 0) في عبارة واحدة** · فرع اليتامي: `NOT VALID` + **التاريخ محفوظ**.
  - **الاختبارات**: 8 لـ0042 (منها «الملاحظات موثّقة») + 4 لحارس `deleteAccount` (الأب/القيود/السليم/fail-closed). المتطلب: `AnyPgColumn` للمرجع الذاتي في Drizzle.
  - **دروس مُضافة**: **«بلا FK» ليست حالة واحدة** — قبل أي هجرة اسأل: (1) هل العمود `NOT NULL`؟ (2) هل هناك مسار حذف أصلاً؟ (3) هل القيم تصنيف أم مرجع مالي؟. ثلاثة من 24 الباقون **قرارات لا أخطاء** ⇒ القياس قبل العمل أرخص بكثير من هجرة كاذبة (وكل هجرة تجرّ syncing بـ Drizzle + pglite + journal + اختبار).

- **2026-09-24 (Migration 0041 — قيود `NOT NULL` المتبقّية: P0 رابع في التصنيع + قفل مستخدم بسبب سجل التدقيق):**
  - **الجرد بعد 0040 ⇒ 24** ⇒ ت-triaged واحداً واحداً (nullability + حارس API + طال/متقاعد). الثمانيةحيّة غير مالية، و**الباقي**جديدان—both `NOT NULL`:
  - **P0 رابع — التصنيع**: `work_orders.product_id` و`boms.product_id` **NOT NULL بلا FK**، و`createWorkOrder` **لا يتحقق** من وجود المنتج، و`deleteProduct` لا يفحص أوامر التشغيل ⇒ حذف منتج له أمر تشغيل/قائمة مواد ⇒ الأمر **يتيمة إلى منتج غير موجود**، وإكماله **يستلم بضاعة تام باسم غير موجود** ⇒ يُفسد حساب تكلفة المخزون (Phase FIN-1). `RESTRICT` + أُضيف `work_orders` لحارس `deleteProduct`.
  - **قفل مستخدم بسبب سجل التدقيق**: `audit_logs.user_id` **NOT NULL بلا FK** ⇒ `SET NULL` مستحيل ⇒ كل حذف مستخدم صار **مرفوضاً** ⇒ **Phase 29 قصدت قابلية حذف المستخدم**. الحل: `DROP NOT NULL` **ضمن فرع SET NULL فقط** (مقيَّد باختبار: تكرار `DROP NOT NULL` = 1) ثم القيد ⇒ السجل ينجو والفعل يُفقد.
  - **إثبات حي (PGlite)**: منتج له أمر تشغيل ⇒ حذف **مرفوض** · مستخدم له سجل ⇒ حذف **مقبول** والسجل ينجو · `del=r`/`del=n` صحيحان. (أُصلح `NOT NULL`/SET NULL بعد أن كشفه الفحص الحي — ظاهرة التحقق حيّة مجدداً.)
  - **الاختبارات**: 8 لـ0041 + 1 لحارس المنتج. تعلّم: **تأكيد «لا FK» يجب أن يكون محصوراً بالجدول** — `0000_init` فيه FKs `product_id` لجداول أخرى (`bom_lines`/`stock`…) ⇒ التوقع العام كاذب.
  - **الدروس**: **`NOT NULL` + بلا FK أمران**: ([أ] لا يمكن تصفيره ⇒ يتيم دائم، [ب] `SET NULL` مستحيل ⇒ الحذف مقفل ⇒ إمّا `RESTRICT` (إن كان المرجع أساسياً) أو `DROP NOT NULL` صراحةً (إن كان المرجع تنسيقياً)). **القرار يُحدَّد بـ«ماذا يفقد الحذف؟» لا بمكان العمود**.

- **2026-09-24 (Migration 0040 — قيود المستودعات؛ P0 ثالث من نفس الصنف):**
  - **الجرد بعد 0038/0039**: من **112** عموداً بلا FK ⇒ **24** فقط (المالية 34 ⇒ 7، وكلها قرارات موثّقة: `cash_box_id` بلا FK عمداً من Phase 62، وسطور الفواتير cascade من 0038). الباقي غير مالي.
  - **P0 جديد من نفس الصنف**: `deleteWarehouse` كان `DELETE` مجرّداً، ولا أي عمود `warehouse_id` كان يحمل FK ⇒ حذف مستودع فيه مخزون كان يترك `stock`/`stock_movements` **يتيمين** — و`warehouse_id` في `stock` **NOT NULL** فلا يمكن حتى تصفيره. النتيجة: أرصدة وحركات لا يقودها أي مستودع من أي شاشة.
  - **0040**: `stock`/`stock_movements`/`stock_adjustments`/`warehouse_transfers`(from/to) ⇒ **`ON DELETE RESTRICT`** (مستودع فيه رصيد = يُعطَّل، لا يُحذف؛ السلاسل هنا كان سيمحو سجل المخزون). اليتامي ⇒ `NOT VALID` بلا حذف لأي بيانات.
  - **الحارس** في `deleteWarehouse` يعدّ لكل مصدر ويميّزه بالاسم، ويفشل مغلقاً إذا فشل الفحص.
  - **البوابة `TenantScope` التقطت الاستعلام الجديد** (بدون `company_id`) ⇒ أُضيف النطاق لكل فرع + تأكيد في الاختبار (4 مرات `company_id = $2::uuid`).
  - **إثبات حي (PGlite، مرّتان)**: 5 قيود `del=r` · idempotent · حذف مستودع فيه رصيد **مرفوض** · فرع اليتامي: `NOT VALID` + **التاريخ محفوظ** + اليتيم الجديد مرفوض.
  - **الاختبارات**: 7 لـ0040 + 3 لحارس المستودع.
  - **دروس مُضافة**: **نفس الجرد كشف P0 ثالثاً** ⇒ الجرد رخيص والمخاطرة عالية. **`NOT NULL` + بلا FK = يتيم لا يمكن إصلاحه** (لا يُصفَّر) ⇒ أخطر من العمود Nullable. **قرار «بلا FK» يجب أن يكون موثّقاً في Migration** (كنمط `cash_box_id` في Phase 62) وإلا يقرأه الجرد اللاحق كإهمال.

- **2026-09-24 (Migration 0039 — قيود FK للأطراف + أعمدة التدقيق؛ P0 مكتشف بالجرد):**
  - **الاكتشاف (جرد شامل)**: كاشف على `0000_init` + كل الـ39 هجرة ⇒ **34 فجوة مالية**. الأخطر: **`customers` و`suppliers` لا يملكان أي FK قادم من أي جدول إطلاقاً** — أي أن `deleteCustomer` كان **يحذف عميلاً له فواتير بنجاح**، والرسالة «Cannot delete customer with existing invoices… Deactivate instead» كانت **كاذبة تماماً**: لم يكن هناك قيد يُخالفه فلا تُشغَّل أبداً (وقد أكّد الفحص أن لا raw ولا RPC فيه أي فحص).
  - **القرار (0039)**: روابط الأطراف بـ **`ON DELETE RESTRICT`** (عميل له مستندات = يُرفض حذفه، **لا يُحذف بالسلاسل** — الاتجاه الوحيد المعقول لربط طرف). أعمدة التدقيق (`created_by`/`updated_by`/`approved_by`) بـ **`ON DELETE SET NULL`** عبر **كل** الجداول التي تحويها (حذف مستخدم لا يحذف مستنداته، يمسح فقط نسبة الفعل) — وهو ما ينصّ عليه التصميم في التوثيق. `journal_entries.account_id` وروابط المنتجات/المخزون/التصنيع إما `RESTRICT`.
  - **بدون حذف لبيانات**: اليتامي ⇒ `NOT VALID` (الجديد يُفحص، التاريخ يُترك) ⇒ الـmigration تنطبق دائماً.
  - **الـAPI صار صريحاً لا انتظاراً لخطأ**: `deleteCustomer` (و`deleteProduct` من 0038) يفحص المراجع باستعلام مُجمَّع يعدّ لكل مصدر ويميّزه بالاسم، ويفشل مغلقاً إذا فشل الفحص.
  - **دروس هندسية (3) من هجرة واحدة**:
    1. **صيغة المواصفات**: `table.column:target:ondelete` ⇒ `string_to_array(':')` يعطي **3** أجزاء لا 4 ⇒ **كل قيود الأطراف سقطت بصمت** والـmigration «نجحت». استُبدلت بفاصل `|` (لأن اسم الجدول نفسه فيه نقطة) — والاختبار يمنع العودة. **درس: عدّ الأجزاء قبل الاعتماد على split — صامت**.
    2. **`FOR v_i IN 1..coalesce(array_length(v_cols,1),0)`** — النطاق `1..0` ينفَّذ **هبطاً** فيزور `v_cols[0]` ⇒ خطأ. استُبدل بـ `FOR ... IN (SELECT)` مباشر.
    3. **`users`/الجداول الاعتيادية قد لا تكون موجودة**: حرس `to_regclass` لكل جدول/عمود مقصود، وحارس `to_regclass('users')` لكتلة التدقيق (fixture بدون `users` كشف ذلك).
    - ⇒ **كل هذا التقطه PGlite حيّ، لا mocks** (3 تشغيلات: تطبيق/idempotent/فرع يتام).
  - **إثبات حي (PGlite)**: تُطبَّق · **idempotent** · `del=r` للأطراف (حذف عميل له فاتورة **مرفوض**) · `del=n` للتدقيق (حذف المستخدم **يُبقي** الفاتورة ويمسح النسبة) · فرع اليتامي: `NOT VALID` + **التاريخ محفوظ** + اليتيم الجديد مرفوض. السكربتات حُذفت.
  - **البوابة `TenantScope` التقطت استعلامي الجديد** (فحص المراجع بـ `customer_id` بلا `company_id`) ⇒ أُضيف النطاق الصريح لكل فرع (وكل ذلك قبل الاعتماد).
  - **الاختبارات**: 9 لـ0039 (متنوعة: «لا FK لـcustomers/suppliers في 0000_init» · RESTRICT · SET NULL · NOT VALID · idempotent · `no FOREACH` · صيغة `|` · journal · pglite) + 4 `deleteCustomer` + 3 `deleteProduct` = 16 اختباراً جديداً.
  - **دروس مُضافة**: **جرد القيود قبل إضافة أي قيد** (الكشف أن صنفاً كاملاً بلا تغطية — `deleteCustomer` رسالة كاذبة). **فشل صامت في migration = indicator على split/format خاطئ** — اختبر على PGlite. **`mockReturnValue` لا يُعاد بين الأوصاف** — بعض اختباراتي تتطلب `beforeEach` إعادة التصريح.

- **2026-09-24 (Migration 0038 — FK منتجات على جدولَي سطور الفواتير، `ON DELETE CASCADE` بقرار المالك):**
  - **الفجوة**: `sales_invoice_lines.product_id` و`purchase_invoice_lines.product_id` **بلا FK إطلاقاً**، بينما الإخوة الخمسة declare القيد في `0000_init`: `quotation_lines` / `sales_return_lines` / `purchase_order_lines` / `purchase_return_lines` (+ `product_product_categories`) ⇒ حذف منتج كان يترك **سطوراً يتيمة** على مستندات إيراد مرحّلة.
  - **القرار**: `ON DELETE CASCADE` (قرار المالك). **الأثر المدرك**: لحاله كان سيمسح سطور فواتير مرحّلة بينما تروستاتها تحتفظ بإجمالياتها ⇒ **`deleteProduct` صار يرفض** حذف صنف يشير إليه أي مستند (استعلام واحد يجمع العدّاد لكل مصدر ويميّزها بالاسم: «sales_invoice_lines: 3، quotation_lines: 1») ويوجّه للعزل بدل الحذف — نفس قاعدة «لا تحذف حساباً له قيود» و«لا تحذف موظفاً له تاريخ».
  - **لا حذف لبيانات مالية**: إن وُجدت سطور يتيمة فالـconstraint يُضاف **`NOT VALID`** (السجلات الجديدة تُفحص من الآن، التاريخ يُترك لمشغّل) —⇒ **الـmigration تنطبق دائماً** ولا تمسّ سطراً واحداً. `FOREACH` ليست في PL/pgSQL القياسي ⇒ استُخدم `FOR v_i IN 1..array_length(...)`.
  - **إثبات حي على PGlite (خطوات متتالية)**: تُطبَّق · **idempotent** (القيد الموجود يُتخطّى) · سطر يتيم **مرفوض** · سطر سليم **مقبول** · `confdeltype='c'` (cascade) · فرع `NOT VALID`: `convalidated=false` + **التاريخ محفوظ** + اليتيم الجديد **مرفوض**. السكربتات حُذفت بعد الإثبات.
  - **تطابق**: `db:check` نظيف (Drizzle ↔ SQL) · `pgliteAdapter.MIGRATIONS` (قائمة يدوية) · `_journal.json` idx=38 · 6 اختبارات migration + 3 لحارس `deleteProduct` + 2 تكامل حي.
  - **التحقق**: `tsc` صفر · `eslint` صفر · `vitest` كامل **226 ملفاً** · `src/test + drizzle` **333** · `build` 12.78s.
  - **قرار تالٍ لك**: إن أردت أن تحمل قاعدة البيانات الحماية بدل الـAPI، فالتبديل إلى `RESTRICT` (كنمط الإخوة الخمسة) هجرة من سطرين — أخبرني وأعملها.

- **2026-09-24 (محرك حقيقي كشف P0 لم تكن الـ mocks تراه — صبّ `VALUES` مفقود):**
  - **الاكتشاف**: اختبار تكامل جديد على PGlite (`src/modules/sales/documentAtomicity.integration.test.ts`) — يثبت على محرّك فعلي أن إعادة كتابة المستند **ترجع بالكامل** عند فشل الإدراج (وأنها تنجح عند النجاح). أول تشغيل رفض: `column "quantity" is of type numeric but expression is of type text`.
  - **الجذر**: مسارات `sales.updateInvoice` / `updateQuotation` / `updateReturn` كانت تبني صفوف `VALUES` بمعاملات **بلا صبّ** للأعمدة الرقمية، بينما `createInvoice` في **الملف نفسه** يحمل الصبّ كاملاً (Phase 42). ⇒ على محرّك الويب (PGlite) **كل تعديل سطور لمسودة يفشل**، بينما مسار Electron (RPC يؤلّف SQL في في العملية الرئيسية) يعمل. **الـ mocks لا ترى ذلك أبداً** لأنها لا تنفّذ SQL.
  - **الإصلاح**: صبّ `::numeric` / `::varchar` صريح على كل معامل في sites السطور الثلاثة + `hr.createPayrollRun` (6 أرقام) + `purchases` موضعين (`notes` varchar، `description` varchar).
  - **اختبار تكامل جديد (2)**: نجاح التعديل يبدّل الرأس **والسطور** معاً · فشل الإدراج (عملة أطول من `varchar(3)`) يُبقي الرأس والسطور **كما هما تماماً** — لا صفر سطور تحت إجمالي جديد.
  - **ملاحظة مخطط**: `sales_invoice_lines.product_id` و`purchase_invoice_lines.product_id` **بلا FK** (بخلاف `quotation_lines`/`sales_return_lines`) ⇒ معرّف منتج وهمي لا يفشل الإدراج.غياب FK نفسه فجوة سلامة (سطور يتيمة) — مرشّح لهجرة لاحقة، غير مُصلَح هنا.
  - **بوابة دائمة ثالثة** `src/test/valuesCastGate.test.ts`: أي placeholder في باني `VALUES` يجب أن يحمل صبّاً صريحاً — **صفر استثناءات**، مع اختبار يفصل صفاً كاملاً عن ناقص + اختبار reach.
  - **صنف مغلق بالقياس (لا عمل)**: «UPDATE/DELETE مربوط بلا فحص» — القياس على **الدالة كاملة** (النافذة الضيقة تعطي 45 false-positive) ⇒ **0**. الكاشف مُثبت على 4 جمل اصطناعية.
  - **المحصلة**: 9 بوابات / 65 اختباراً في `src/test` · `vitest` كامل **226 ملفاً أخضر** · `build` 10.86s · `db:check` سليم.
  - **درس مُضاف**: **الـ mock لا ينفّذ SQL** ⇒ صنف «صبّ مفقود» خفيّ تماماً عنه. اختبار تكامل واحد على PGlite كشف ما لم يفحصه 224 ملف اختبار. **ادفع ثمن محرّك حقيقي واحد عندما يكون الصنف غير ممكن الاكتشاف بالـ mocks**.
  - **درس مُضاف**: «معرّف وهمي في عمود بلا FK» لا يفشل ⇒ لا تستخدمه لإثبات فشل الإدراج؛ استخدم انتهاك قيد حقيقي (varchar length / CHECK / NOT NULL).
  - **درس مُضاف**: `src/test/setup.ts` يستبدل `crypto.randomUUID()` بمُعرّف **غير UUID** — أي اختبار تكامل يستخدم معرّفات مولّدة في JS يجب يستعيد `webcrypto` في `beforeAll` (نمط اختبار POS).

- **2026-09-24 (مسح شامل لنتائج الكتابة المُهمَلة — 17 مخالفة ⇒ صفر):**
  - **المسح**: كاشف static على `src/modules/**/api.ts` بحثاً عن `await adapter.query(...)` لكتابة (INSERT/UPDATE/DELETE) لا تُربط لمتغير ولا تُرجَع ولا تُحاط بشرط. النتيجة الأولى كانت كاذبة (كشف `return await` كـ«مهمَل» بسبب خطأ في حساب البادئة) ⇒ أُعيد بناء الكاشف قبل أي استنتاج. **القياس الصحيح: 17 كتابة مُهمَلة في 11 دالة.**
  - **`hr.createPayrollRun` (الأخطر — رواتب)**: رأس المسير كان يُرسل في `transaction` منفصلة **قبل** سطور `payroll_lines` التي كانت `await` بلا فحص. فشل إدراج السطور يترك مسيراً **بلا موظفين** وإجماليه محسوب — **وأهم**: `uq_payroll_runs_period` (unique جزئي على draft/posted) يجعل هذا المسير اليتيم **يحجز الفترة**، فيُرفض مسير الشهر التالي، أي أن الشركة لا تستطيعصرف الرواتب عملياً. الإصلاح: `runId` يُولَّد في JS (نمط Phase 42) ليشترك الرأس والسطور في **معاملة واحدة**.
  - **`manufacturing.updateBom` / `updateWorkOrder`**: رأس + حذف المواد/الاستهلاك + إعادة إدراجها كانت ثلاث عمليات متتالية تنتهي بـ `success: true` غير مشروطة ⇒ فشل الرأس/material ⇒ **قائمة مواد بلا مواد** (وم_available يقرأها "لا شيء يستهلك") أو رأس جديد فوق خطة قديمة. الآن `buildInsertStatement` (مُركِّب statements بدل منفّذها) + `adapter.transaction` واحدة.
  - **`manufacturing.deleteBom` / `deleteWorkOrder`**: كانا يحذفان السطور أولاً ثم الأب — والفشل في حذف الأب يترك **قائمة مواد ممسوحة** خلف "فشل الحذف". `bom_lines` و `work_order_consumptions` عليهما `ON DELETE CASCADE` (مُتحقَّق في `0000_init.sql:1016-1018`) ⇒ الأب وحده كافٍ، وحُذف الحذف الزائد.
  - **`manufacturing.updateWorkOrderStatus` (إعادة الفتح)**: تصفير الفعلي كان متابعة بلا فحص ⇒ أمر أُعيد فتحه يحتفظ بفعلي التشغيل السابق (ويقرأه تقرير الانحراف كاستهلاك هذه الجولة). صار في نفس المعاملة، **مع نطاق صريح للشركة** (كان `WHERE work_order_id = $1` فقط).
  - **`inventory.createProductUnit` / `updateProductUnit`**: تصفير أعلام الإخوة (base/sale/purchase) قبل الكتابة كان 6 عمليات متتالية بلا فحص — وهو بالضبط ما حذّر منه Phase 82c للـ RPC ولم يُنفَّذ على هذا المسار: سباق مع الـ partial unique index، وفشل الإدراج يترك المنتج **بلا وحدة افتراضية للبيع**. الآن معاملة واحدة (الإدراج `RETURNING id` وقراءته من `results`).
  - **`sales.convertQuotationToInvoice` / `purchases.convertOrderToInvoice`**: تحرير الـ claim عند فشل إنشاء الفاتورة كان نتيجة مهمَلة ⇒ المستند يبقى `converted`/`invoiced` **بلا فاتورة خلفه** (يبدو تحويلاً مكتملاً ولا يُعاد التحويل أبداً). صار الفشل يُبلَّغ صراحةً مع توجيه لمراجعة الحالة.
  - **`auth.login`**: `last_login_at` نتيجة مهمَلة ⇒ `console.warn` بدل ابتلاع (سجل الاستخدام يتوقف صامتاً).
  - **بوابة دائمة ثانية** `src/test/writeResultGate.test.ts`: **أي كتابة raw يجب أن تكون مربوطة لمتغير أو مُرجَعة أو محاطة بشرط** — صفر استثناءات (لا allowlist). ومعها اختبار «reach» يثبت أن الكاشف يرى فعلاً الكتابات (حارس ضد تحلل parser يُخضِر كل شيء). **مُثبتة عكسياً**: حقن كتابة مهمَلة في `accounting.deleteAccount` ⇒ البوابة سقطتها باسم الدالة، ثم استُعيد السطر.
  - **المحصلة**: 17 ⇒ **0** كتابة مهمَلة. البوابات الآن **8 / 62** اختباراً في `src/test`.
  - **اختبارات**: 1 رواتب (معاملة واحدة)، 6 تصنيع (ذرّية ×3 + CASCADE ×2 + الفشل الصادق)، 3 وحدات مخزون (ذرّية الأعلام + الفشل)، 2 بوابة.
  - **التحقق**: `tsc -b --force` صفر | `eslint src --max-warnings=0` صفر | `vitest` كامل (threads) **224 ملفاً كله أخضر** | `build` 29.43s | `db:check` سليم.
  - **درس مُضاف**: الكاشف الذي «يجد الكثير» مشبوه حتى يُعاد التحقق من مُدخلاته — المسح الأول أظهر 86 «مخالفة» كانت كلها كاذبة. **القياس قبل الإصلاح، والقياس بعده بنفس الكاشف** هو الفرق بين 86 و17.
  - **درس مُضاف**: `batchInsertLines` (منفّذ) → `buildInsertStatement` (مُركِّب). تفكيك الأداة ليعمل نصفها فقط = كود ميت جديد؛ prefer امسح الغلاف حين لا مستهلك (tlint كشفه فوراً).

- **2026-09-24 (ذرّية استبدال المجموعات الفرعية):**
  - `sales.updateInvoice` / `updateQuotation` / `updateReturn` (المسار raw): كانت ثلاثة statements متتالية بلا فحص (`UPDATE` الرأس ← `DELETE` السطور ← `INSERT` السطور) تنتهي بـ `return { success: true }` غير مشروطة. فشل `INSERT` بعد نجاح `DELETE` يترك مستنداً **بلا سطور** وإجماليه القديم، ويخبر المستخدم بالح_SUCCESS. غُلِّفت الثلاثة في `adapter.transaction` واحدة (نفس نمط `purchases.updateInvoice`)، مع `return { success: false, error }` صادق عند فشل المعاملة.
  - `inventory.updateProduct`: كانت تبدّل روابط التصنيفات m2m **قبل** تحديث صف المنتج، وبلا فحص نتيجتَي `DELETE`/`INSERT` ولا فحص مزامنة سعر الوحدة الأساسية. الترتيب الخاطئ يعني: فشل تحديث السعر (كود مكرر مثلاً) والمستخدم يُبلَّغ بالفشل بينما تصنيفات المنتج قد استُبدلت بالفعل. أصبح: الصف أولاً ← فحص نتيجته ← عندها استبدال الروابط ← فحص كل خطوة ← `warning` صريح بدل ابتلاع.
  - `purchases` لم تكن مصابة (تلتفّ أصلاً في `adapter.transaction` وتفحص النتيجة).
  - **بوابة دائمة جديدة** `src/test/childReplacementGate.test.ts`: أي دالة تحذف مجموعة فرعية (سطور مستند/روابط تصنيف) يجب أن تُشحن إعادة الكتابة كلها في `adapter.transaction` واحدة. الاستثناء الموثّق الوحيد `inventory.updateProduct` (يفحص كل نتيجة ويرفع `warning`، والصف أولاً). البوابة **مُثبتة عكسياً**: حقن النمط القديم يدوياً ⇒ فشل البوابة على `updateQuotation` بالاسم، ثم استُعيد الملف.
  - **اختبارات**: 4 في `sales/api.test.ts` (الذرّية + لا نجاح أجوف)، 5 في `inventory/api.test.ts` (الترتيب + صدق الفشل + تحذير الروابط/الوحدة الأساسية + نطاق الشركة)، 4 في البوابة.
  - **التحقق**: `tsc -b --force` صفر | `eslint src --max-warnings=0` صفر | `vitest` كامل (threads) **223 ملفاً كله أخضر** | `build` 40.99s | `db:check` سليم.
  - **ملاحظة بيئية**: `--pool=forks` يفشل على هذا الجهاز (ذاكرة حرة ~1.1GB ⇒ "Failed to start forks worker") ويُظهر إخفاقات وهمية في `layout.test.tsx` و`SessionsDrawer.test.tsx`؛ كلاهما أخضر منفرداً وthreads. استخدم `--pool=threads --maxWorkers=1 --no-file-parallelism` للتحقق المحلي.

- **2026-09-24:** أضيف إعادة تدقيق static حديثة وخطة تنفيذ جديدة إلى هذا الملف.
- لم تُعدَّل ملفات التطبيق أو migrations أو preload أو adapters في هذا التحديث.
- لا توجد نتائج اختبار جديدة في هذا التحديث؛ نتائج الاختبارات القديمة أعلاه تاريخية وليست اعتماداً للحالة الحالية.

*نهاية التحديث.*
