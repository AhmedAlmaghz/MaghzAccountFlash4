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
- ✅ أضيف generation boundary متزامن للـ AI: logout/user-company switch يوقفGeneration، يمسح history/ledger/attachments/.persistence queue، ويمنع نتائج batch المتأخرة من الكتابة بعد التبديل.
- ✅ حُمي backup/restore داخل main: تحقق company لكل row، parent references، manifest + SHA-256، واستبعاد/رفض password hashes.
- ✅ حُمي fiscal/tax periods في HR posting وPOS/fallback paths، وأصبح تاريخ الترحيل الفارغ/غير الصالح أو فشل الاستعلام fail-closed في `src/modules/tax/engine.ts` و`src/modules/accounting/yearEnd.ts`، وأُوقف partial sales posting RPC من preload/interface مع إبقاء unified transaction path.
- ✅ أضيف scoped restore-guard لـ `users`، وأصبح `resolveExistingUserId` scoped by company مع cache key tenant-aware، وقبل typed `accounting.createTransaction` `posted` مع `accounting.post` + balance/period gates.
- ✅ ضُبطت sales/purchases create APIs على draft فقط، وحُذف wildcard من نوعPermission وعقد الاختبارات، وأضيفت regression tests مباشرة لسلوك raw tenant scope.
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
  - **تقسيم مقصود**: القناة تؤدّي الـ INSERT فقط؛ **توليد رقم المستند** (`document_sequences`) و**قيد الرصيد الافتتاحي** يبقيان في الـ renderer — لأن منطق المال له تنفيذ واحد فقط. الاختبارات تثبت الانقسام: لا `document_sequences` في العملية الرئيسية، ولا `companyId` في الـ payload.
  - **بوابة الكتابة لم تتغيّر**: بلا `permission` صريح لأن قاعدة الجدول (`purchases`) تفرض `create|edit|post` — نفس المجموعة التي كان يفرضها المسار raw. هذا tranche يزيل SQL من السلك، لا يغيّر من يكتب.
- 🧪 **e2e `06-suppliers` صار يمارس قناة الكتابة فعلاً**: الاختبار ينشئ مورداً من الواجهة وينتظر ظهوره في الجدول — أي INSERT حقيقي على PostgreSQL عبر القناة الجديدة (كان يمرّ على raw). نجح 5/5 مع `23-purchases`.
- ✅ **التحقق النهائي بعد tranche B:** `vitest run` كامل = **`2804/2804`** في `217` ملف؛ purchases **`48/48`** (+6: INSERT عبر القناة بلا SQL خام، رقم المستند المولَّد يُرسل في payload، رفض القناة، patch جزئي بلا companyId، تعطيل ناعم، رفض مُرَّر). و`lint` نظيف، `tsc -b --force` صفر، `build` ✓ (9.25s)، `node --check` ×3، `db:check` نظيف. E2E: **`5/5`** (`06-suppliers` + `23-purchases`).
- ✅ **إغلاق المسار العام للترحيل الفوري (Phase 2 #5 — بند مالي):** `createTransaction` صار **draft-only** و`updateTransaction({status:'posted'})` **مرفوض** برسالة تسمّي المسار الصحيح. الترحيل لم يعد حقلاً يُمرَّر في payload — صار انتقالاً له بواباته (قفل الصف، توازن السطور المخزَّنة، فترات ضريبية/مالية، هوية تدقيق من الجلسة). حُذف مسار «الترحيل عبر التعديل» (48 سطراً) الذي كان يتجاوز قفل الصف ويعيد التحقق على تاريخ المخزَّن.
  - **التركيب في مكان واحد**: `createAndPostTransaction()` = إنشاء draft ثم `postTransaction()`. عند فشل الترحيل **يبقى الـ draft** (قابل للمراجعة، لا يُحذف صامتاً).
  - **المتصلون محدَّثون**: `useAccounting` (الـ in-memory والـ paginated) يركّب نيابةً عن الواجهة، فلم يتغيّر `JournalEntriesPage`؛ وأداة AI `accounting.create_journal_entry` صارت تستدعي `createAndPostTransaction` بدل `status:'posted'`.
  - **لم يُمس** مسار مولّدات القيود (`journalEntryGenerator` → `adapter.createTransaction`) لأنه طبقة أخرى لها بواباتها في العملية الرئيسية (`accounting.createTransaction` typed) وهو ما تحتاجه فاتورة المبيعات/المشتريات/الرواتب للترحيل الذري. النطاق مقصود: المسار **العام** فقط.
  - **اختباران قديان يُظهران سلوكاً لم يعد موجوداً** (immediate post عبر الـ service) استُبدلا باختبارات العقد الجديد: الرفض +_verifyأن لا استعلام وصل القاعدة + تركيب صحيح + بقاء الـ draft عند فشل الترحيل.
- 🔍 **درس تشخيص (وهمي في أول مرة)**: فشل اختبار التركيب بخطأ «غير مسودة» رغم أن الـ mock يعيد `status:'draft'`. السبب: تحقق `postTransaction` يعتمد **`rows.length` بعد UPDATE** (إصلاح FIN-0 — `DbAdapter` لا يعرض rowCount) والـ mock كان يعيد `rows: []` ← يُقرأ كـ «0 صفوف متأثرة» = سباق مفقود. **قاعدة**: عند محاكاة مسار يفحص عدد الصفوف المتأثرة، يجب أن يُرجع الـ mock صف UPDATE لا قائمة فارغة.
- ⚠️ **دروس اختبار (تسريب حالة بين المجموعات)**: `vi.clearAllMocks()` **لا يستعيد الـ implementation** — اختبار typed-RPC سابق ترك `isElectronPg=true` و`window.electronDB` مثبَّتين فسقطت اختبارات，后续 في نفس الملف إلى المسار الخطأ. الحل: `beforeEach` صريح بـ `mockReturnValue(false)` + تصفير `window.electronDB` في كل مجموعة تفترض المسار غير-|Electron. (لو استُخدم `resetAllMocks` لانكسرت الـ typed suites لأنها تعتمد على الـ implementation Establishment.)
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
- ⚠️ **متبقٍ قبل إغلاق Phase 0:** `_exec` و`_execBatch` ما زالا موجودين كـ compatibility surface في `preload.cjs` و`preload.js`. أضيف tranche fail-closed لـ11 child table writes عبر `RAW_SQL_CHILD_PARENT_RULES` و`rawChildScopeIsValid`، وscopeت مسارات `sales.postInvoice`، لكن child reads وadapter callsites المتبقية ما زالت تعتمد على التطبيق/typed-RPC مستقبلاً؛ لا يمكن حذف السطح أو إعلان الإغلاق الكامل قبل ترحيلها.
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
    5. **الـ idiom الغالب لم يُطابَق**: شرط الإثبات كان يشترط `:` أو `=` بعد اسم المتغيّر، فنجحت `conditions = [...]` وأخفَت **الأشيع** `conditions.push(\`w.company_id = $1\`)` (استُعمل في `VarianceAnalysisReport`). **البحث عنTrees يحتاج list كل الأشكال الشائعة، لا الشكل الذي كتبته أنت في الملف الذي قرأته أولاً** (وهو بالضبط ما فعلته في tranche_convert مع `Promise<{…}>`).
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
    - **البحث عنTrees يحتاج list كل الأشكال الشائعة**: `conditions = [...]` و`conditions: string[] = []` و`conditions.push(...)` و`WHERE ${where}` — أيُّها تفتقده يُنتج «ثقباً» وهمياً أو إدانةً كاذبة. **النمط الذي تستخدمه في أول ملف تقرأه ليس النمط الشائع في المشروع.**
    - **فخ `Promise<{…}>` تكرر مرتين**: استخراج جسم الدالة اصطدم به في كاتبين مختلفين ⇒ نفس الإصلاح طُبِّق. **الدرس الذي يصلح مرتين يثبت أنه قاعدة لا حادثة.**

## 8. تسلسل المستندات: مصدر واحد + ثلاث محركات تتفق (tranche مُنجز)

- **الأصل**: `getNextDocumentNumber` (core/api.ts) هو المسار الوحيد لترقيم 19 نوع مستند عبر 32+ callsite (مبيعات/مشتريات/POS/محاسبة/تصنيع/HR/مخازن/CRM + أدوات AI). الفشل فيها **صادق لكنه صامت التصميم**: `Sequence not found: <type>` كرسالة runtime لا كخطأ ترجمة.
- **المشكلة المُكتشفة (P1)**: ثلاثة محركات تبذر `document_sequences` (بذرة demo · بذرة PGlite · backfill التسجيل في dbHandler)، و**`fixed_asset` غائب من بذرة PGlite** ⇒ أي شركة في المتصفح/ PGlite **لا تستطيع إنشاء أصل ثابت إطلاقاً** (و`createFixedAsset` في accounting/assets.ts يستدعي الترقيم). البذرتان الأخريان فيه. أُضيف `{ type: 'fixed_asset', prefix: 'FA-', pad: 4 }` لبذرة PGlite.
- **البوابة: `src/test/documentSequenceGate.test.ts` (5 اختبارات)** — كل محرك يجب أن يبذر كل نوع يُستدعى زمن التشغيل (19)، ومفتاحا الخريطة في `core/api.ts` (table↔column) متطابقان، وفحص الـ callsites يرى كل الأنواع الموثّقة (فحص مكسور ينجح بالغياب).
  - **إثبات عكسي**: حُذف سطر `fixed_asset` من بذرة PGlite يدوياً ⇒ البوابة سقطت **بنصّ العطل الحقيقي**؛ ثم أُعيد الإصلاح. **البوابة تُثبت أنها تستطيع أن تفشل قبل الوثوق بها.**
  - **تغطية التغطية**: 19/19 في الثلاثة بعد الإصلاح · صفر نوع مستدعًى غير مُبذَر · 16 صف تسلسل مُبذَر ولا يُستدعى (chart-of-accounts types مثل `asset/liability/branch` لا تاخد تسلسلاً — غير ميت بالضرورة، بل فئات أخرى).
- **درس محادثة**: التراجع عن انحدار مُحقن بـ `git checkout -- <file>` **محا الإصلاح غير الملتزم به في الملف نفسه** (رجع إلى HEAD بلا الإصلاح) ⇒ أُعيد تطبيق الإصلاح. **لا تتراجع بـ git checkout عن ملف تحمل عليه عملك غير الملتزم — احفظه أو استخدم التراجع العكسي (إعادة السطر).**
- **درس أدوات مكرّر**: `node -e` مع اقتباس مركّب ينكسر في PowerShell (عرضُ الخطأ，强调 الأقواس) — استخدم ملف `.cjs` (المساعدة المؤقتة). تكرّر في هذه الجلسة.
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
  - **«ينجح» في واجهة لا تعني «نجح»**: انحراف منصّتين (Electron يفشل، PGlite ينجح) من سبب واحد = قناة واحدة استُعملت لغرضين. **القناة التي لا تحمل الحالة所需的 لا تُستعمل لتغيير الحالة أصلاً.**
  - **نتيجة الأداة/القناة عقد صدق**: `await` بلا فحص = Swallowed error؛ حين يكون الفعل **مالياً** يبتلع الفشل ويُبلّغ نجاحاً كاذباً. **كل انتقال حالة financial يجب أن يفحص عدد الصفوف المتأثرة ويعيدprevious state للتعويض.**
  - **ادّعاء التوثيق يُراجَع كادّعاء**: «يحمي converted» بلا سطر شرط = ثغرة موثّقةythe إذن.
- **التحقق**: `vitest run` = **2865/2865** في **220** ملفاً · lint نظيف · `tsc -b --force` صفر · `build` ✓ · `db:check` نظيف · `node --check` على dbHandler/preload×2 · shim runtime ✓ (backticks متوازنة). (تشغيلان سابقان أظهرا 2 فشل تحت الحمل المتوازي ثم خضراء منفردة — نمط flake معروف، لا انكسار.)

## 10. أولويات التنفيذ

1. Phase 0 immediately.
2. لا تبدأ UI أو JEV enhancements قبل Phase 0 و1.
3. بعد إغلاق security، ينفذ financial state machines.
4. بعدها AI lifecycle/memory.
5. JEV optimization/security بعد توحيد boundary.
6. لا يدّعي اكتمال 100% قبل tests وstaging evidence.

## 11. سجل التغيير

- **2026-09-24:** أضيف إعادة تدقيق static حديثة وخطة تنفيذ جديدة إلى هذا الملف.
- لم تُعدَّل ملفات التطبيق أو migrations أو preload أو adapters في هذا التحديث.
- لا توجد نتائج اختبار جديدة في هذا التحديث؛ نتائج الاختبارات القديمة أعلاه تاريخية وليست اعتماداً للحالة الحالية.

*نهاية التحديث.*
