# خطة تطوير وحدة CRM الاحترافية — v0.9.0

> **الغرض:** تحويل وحدة CRM إلى وحدة احترافية بمصدر حقيقة واحد (Unified API) — كل عملياتها موحّدة، ذرّية، وغير مكررة — يستخدمها التطبيق العادي ووكيل الذكاء الاصطناعي معاً، مع بناء الأدوات والمهارات الخاصة بالوكيل وفق أفضل الممارسات العالمية (Odoo/HubSpot/Salesforce-style MRP-lite for CRM).

> **تاريخ الاعتماد:** 2026-08-31 | **الترقيم:** Migration = `0015_crm_professional` (0014 محجوز لـ HR)

---

## قرارات معمارية معتمدة مسبقاً

| القرار | الخيار المعتمد |
|---|---|
| الجداول الميتة `crm_activities` + `calls` | **حذفهما في migration 0015** |
| آلة حالات الفرص | **تقدمية صارمة + نهائية won/lost** — `new→qualified→proposal→negotiation→{won\|lost}`، won/lost نهائية، أي رجوع مرفوض |
| الفوز بفرصة | **قفل الفرصة (close_date + probability=100) + توجيه الوكيل لإنشاء فاتورة عند الطلب** — لا إنشاء تلقائي |
| ترتيب التنفيذ | **A (API ذرّي موحد) → B (واجهة) → C (أدوات الوكيل) → D (اختبارات)** |

---

## الوضع الحالي — ملخص الفحص الشامل (قبل التنفيذ)

### نقاط قوة موجودة
- CRUD كامل لـ 4 كيانات (Leads/Opportunities/Tasks/Activities) عبر مسارَي RPC+fallback مع zod validation و pagination للسيرفر
- 17+ أداة AI للـ CRM موجودة (create/update/delete + fuzzy search للعملاء المحتملين والفرص)
- Kanban/list/funnel views للفرص + overdue logic صحيح للمهام

### فجوات حرجة مكتشفة
1. **`String(date)` bug** في الـ mappers الأربعة — يكسر تعديل التواريخ في Electron (فخ Phase 45/73 غير مُطبَّق على CRM)
2. **`convertLeadToCustomer` مكرر بـ 4 تطبيقات**: fallback غير ذرّي (4 استعلامات متسلسلة) + RPC CTE ذرّية + shim + مسار AI بتوليد كود مختلف (`CUST-` regex vs `document_sequences`)
3. **لا توجد آلة حالات للفرص** — كانبان يقبل أي انتقال (won → new!)
4. **لا حماية حذف ولا FKs** على `lead_id/opportunity_id/customer_id` → سجلات يتيمة + **لا فهارس إطلاقاً** على جداول CRM = full table scans
5. **لا audit logging** ولا duplicate detection لأي كيان CRM
6. **حقل assignedTo نصي حر** يتطلب لصق UUID (UserSelect موجود لكنه غير مستخدم في CRM)
7. **KPIs تُحسب من الصفحة الحالية فقط** (reduce على items) — خاطئة عند >25 صف
8. أدوات AI: `search.tasks/activities` substring غير fuzzy + جلب كامل غير paginated، لا توجد `crm.update_activity` ولا `crm.get_tasks/get_activities` (أوصاف تشير لأدوات غير موجودة)، **bug: `purchases.delete_supplier` يستدعي `deleteTask`**، entityResolver يغطي leads فقط
9. جداول ميتة (`crm_activities`, `calls`) + التقارير/Dashboard تستعلم SQL مباشرة متجاوزة crmApi
10. بحث الأنشطة client-side فقط (RPC يملك search param لكن fallback/shim لا) — drift بين المسارات
11. `TasksPage` حقل `customerOrOpportunity` مكسور (onChange يكتب opportunityId فقط)
12. `CrmPage` activities count متصلب "—"

---

## المرحلة A — طبقة API موحّدة وذرّية (P0)

### A1. Migration `drizzle/0015_crm_professional.sql`

1. **حذف الجداول الميتة**: `DROP TABLE IF EXISTS crm_activities, calls`
2. **Orphan cleanup ثم FKs** (تحويل يتامى لـ NULL قبل إضافة القيود):
   - `opportunities.lead_id → leads(id) ON DELETE SET NULL`
   - `opportunities.customer_id → customers(id) ON DELETE SET NULL`
   - `tasks.opportunity_id/lead_id/customer_id` + `activities.opportunity_id/lead_id/customer_id` بنفس النمط (SET NULL)
3. **فهارس الأداء**:
   - `idx_leads_company_status (company_id, status)` + `idx_leads_company_created (company_id, created_at)`
   - `idx_opportunities_company_stage (company_id, stage)` + `idx_opportunities_company_close (company_id, expected_close_date)`
   - `idx_tasks_company_status_due (company_id, status, due_date)` + `idx_activities_company_date (company_id, activity_date)`
4. **أعمدة جديدة**: `opportunities.close_date date` (تُختم عند won/lost) + `leads.last_contacted_at timestamptz` (تُحدَّث تلقائياً عند تسجيل نشاط مرتبط بالـ lead)

**تحديثات مرافقة إلزامية:**
- `drizzle/meta/_journal.json`: entry `idx=15, tag: "0015_crm_professional", when: 1796900000000`
- `src/core/database/schema/crm.ts`: إزالة `crmActivities` + `calls` من exports + إضافة `closeDate` للأپپortunities + `lastContactedAt` للـ leads
- `src/core/database/adapters/pgliteAdapter.ts`: import + إضافة `0015_crm_professional` لنهاية مصفوفة `MIGRATIONS` + إزالة `crm_activities/calls` من الـ SQL whitelists/seed (لو موجودان)
- `electron/dbHandler.js` (`SQL_MODULE_TABLE_RULES`) + `src/modules/ai/sqlGuard.ts` + `electron/resetDatabase.js`: إزالة الجداول الميتة من القوائم
- `drizzle/migrations.test.ts`: اختبارات 0015 (drop/FKs/فهارس/orphan cleanup/idempotency) — asserts ديناميكية (length === files) تتكيف تلقائياً

### A2. إصلاحات جوهرية في `crm/api.ts`
- **mappers التواريخ**: `String(r.x)` → `toDateString(r.x)` في mapLeadRow/mapOpportunityRow/mapTaskRow/mapActivityRow
- **mapper الفرص**: إضافة `closeDate` + mapper الـ leads: إضافة `lastContactedAt`
- **توحيد `updated_by`**: fallback يختم `updated_by = safeUserId(userId)` دائماً (حالياً يتخطاه عند undefined — divergence مع RPC)
- **`last_contacted_at` تحديث تلقائي**: `createActivity` مع `leadId` يحدّث `leads.last_contacted_at = activity_date` في نفس العملية (RPC + fallback + shim)

### A3. آلة حالات الفرص (الحارس في API layer — مصدر حقيقة واحد)
```ts
STAGE_ORDER = ['new', 'qualified', 'proposal', 'negotiation'];
// won/lost نهائية — أي انتقال منها مرفوض
// التقدم فقط للأمام (أو ثابت) — لا رجوع من مرحلة متقدمة
```
- في `updateOpportunity` (الـ 3 مسارات): SELECT الحالي → رفض غير القانوني برسالة عربية واضحة
- عند `stage='won'`: ختم `close_date = CURRENT_DATE` + `probability = 100` تلقائياً
- عند `stage='lost'`: ختم `close_date` + `probability = 0`
- Kanban يعرض المراحل القانونية فقط (سحب غير قانوني → toast برسالة الرفض من الـ API)
- الـ zod schema يبقى يتقبل كل المراحل — **الحارس في الـ API لا الـ UI**

### A4. توحيد التحويل `convertLeadToCustomer` — ذرّي وموحد
- **CTE ذرّية واحدة** (نفس نمط RPC الحالي) تصبح التطبيق الوحيد في المسارات الثلاثة (fallback rewritten + RPC + shim)
- **توليد الكود موحّد**: `document_sequences` عبر `getNextDocumentNumber(companyId, 'customer')` — إزالة ازدواجية `CUST-` regex في fallback
- **توسعة signature**: `{ code?, address?, taxNumber?, creditLimit?, phone?, email?, createOpportunity? }`
  - عند `createOpportunity=true`: CTE فرصة أولى باسم "فرصة [اسم العميل]" بنفس الـ transaction
- `logAudit` للعملية + **idempotent guard**: رفض التحويل إذا `status='converted'` أصلاً
- ملاحظة: AI wizard `crm.convert_lead_to_customer` يحوَّل لاستدعاء الـ API الموحد فقط (إزالة توليد الكود في الأداة)

### A5. حماية الحذف + Audit + Duplicate guards
- `deleteLead`: رفض إذا له فرص/مهام/أنشطة نشطة — رسالة عربية واضحة
- `deleteOpportunity/deleteTask/deleteActivity`: فحص المراجع + `logAudit` لكل كتابة (create/update/delete/convert) — نفس نمط sales الـ 19 sites
- **duplicate guard في API layer**: exact match (normalized name/phone) → رفض برسالة واضحة + `allowDuplicate?: boolean` flag للاستثناء المتعمد
- **إصلاح drift بحث الأنشطة**: `search` param في الـ 3 مسارات (RPC يملكه، fallback/shim لا)
- **`crm.getCrmKpis`**: KPIs محسوبة في SQL (COUNT/SUM/GROUP BY على مستوى DB) لكل كيان — إصلاح KPIs الصفحة الحالية

### A6. إعادة توجيه المستهلكين إلى crmApi
- `LeadConversionReport.tsx`, `OpportunityPipelineReport.tsx`, `useDashboard.ts`: استبدال SQL المباشر بـ methods جديدة في crmApi (`getLeadConversionStats`, `getPipelineStats`, `getCrmDashboardKpis`)

---

## المرحلة B — واجهة احترافية (P1)

### B1. حقول ذكية بدل النص الحر
- استبدال `assignedTo` text inputs في الصفحات الأربعة بـ **`UserSelect`** (موجود) مع خيار "تعيين لي" السريع
- `TasksPage`: استبدال حقل `customerOrOpportunity` المكسور بـ **`OpportunitySelect`/`LeadSelect`/`CustomerSelect`** (موجودة، غير مستخدمة)
- `LeadsPage` activity modal و `OpportunitiesPage`: ربط الفرص بـ leads عبر `LeadSelect`

### B2. Duplicate detection + حوار موحد
- ربط `DuplicateWarningDialog` (موجود من Phase 68) في الصفحات الأربعة:
  - leads: name+phone | opportunities: name | tasks: title+dueDate | activities: subject+date
- الحظر exact + تحذير ≥0.85 مع زر "متابعة رغم التشابه"

### B3. مودال التحويل الكامل
- `LeadsPage.handleConvert`: مودال نموذج حقيقي (عنوان/رقم ضريبي/حد ائتماني/هاتف prefilled من الـ lead/checkbox "إنشاء فرصة أولى") بدل ConfirmDialog بالحقول الفارغة

### B4. تحسينات العرض
- **KPIs من السيرفر** (أدوات A2/A5) — إصلاح KPIs الصفحة الحالية + إصلاح `CrmPage` activities count المتصلب
- Kanban: منع سحب غير قانوني + المراحل النهائية بلون مميز مع أيقونة قفل + `close_date` badge
- تصدير Excel/طباعة PDF لـ Leads/Opportunities (نفس نمط TasksPage + `printDocument`)
- `<Can action="edit"/"delete">` حول أزرار التعديل/الحذف في كل الصفحات

---

## المرحلة C — أدوات ومهارات الوكيل (P1)

### C1. إصلاحات فورية
- **إصلاح bug حرك**: `purchases.delete_supplier` يستدعي `deleteTask` (copy-paste) → `purchasesApi.deleteSupplier`
- ترقية `search.tasks/search.activities` إلى **fuzzy** (`findAllFuzzyMatches` + `*Paginated` بدل الجلب الكامل)
- تصحيح الأوصاف: إزالة إشارة `crm.get_activities` غير الموجودة

### C2. أدوات جديدة
- **قراءة**: `crm.get_tasks` (فلاتر status/priority/assignedTo + overdue flag), `crm.get_activities` (فلاتر type/date range)
- **كتابة**: `crm.update_activity`, `crm.complete_task` (shortcut: status=completed)
- **صلاحيات دقيقة**: write tools تتحقق من `crm.edit`/`crm.delete` حسب العملية بدل `crm.create` للجميع
- **`crm.win_opportunity` wizard**: يقفل الفرصة (close_date + probability=100) ويعيد توجيهاً: "تم الفوز — أنشئ فاتورة مبيعات للعميل [name] بقيمة [value]؟ استخدم sales.create_invoice" — **لا إنشاء تلقائي**

### C3. أدوات ذكية تلقائية (best-practice)
- **`crm.follow_ups`**: يجمع تلقائياً — مهام متأخرة + فرص متوقفة بلا نشاط منذ X يوم + leads بـ status=contacted/qualified بلا متابعة + فرص تجاوزت expected_close_date — أولويات مرتبة
- **`crm.rep_performance`**: لكل مستخدم: leads المحولة/فرص won/lost/win-rate/قيمة won/أنشطة مسجلة (SQL aggregation)
- **detailedRegister tools**: `crm.leads_register` / `crm.opportunities_register` (فلاتر كاملة + pagination)
- **`crm.qualify_lead` wizard**: ذرّي — `updateLead(status=qualified)` + `createOpportunity`(من estimated_value) + `createTask`(متابعة خلال 3 أيام) مع rollback تعويضي عند فشل أي خطوة (نمط create_and_post)

### C4. entityResolver + مهارة + برومبت + suggestion chips
- إضافة searchers لـ `opportunity`, `task` في `ENTITY_SEARCHERS` (نفس نمط lead: fetch 50 + rankMatches)
- **مهارة `crmAssistant`** (`skills/`): دليل lifecycle كامل (lead stages ومعناها، متى qualify، متى convert، خريطة المراحل القانونية، أفضل ممارسات المتابعة) تُحقن في البرومبت عند نية CRM
- **قواعد برومبت جديدة (29-31)**: lifecycle الفرص والانتقالات القانونية | قاعدة التحويل (convert ينشئ فرصة أولاً عند الحاجة + مهمة متابعة) | قاعدة "الفوز ≠ فاتورة — اسأل المستخدم"
- **Suggestion chips**: إضافة routes للأدوات الجديدة + التقارير (`crm.follow_ups → /crm/tasks`، `crm.rep_performance → /crm/activities`، إلخ)

---

## المرحلة D — اختبارات وتحقق نهائي

1. **Unit tests**: آلة الحالات (كل الانتقالات القانونية/غير القانونية + ختم close_date) | ذرّية التحويل (فشل خطوة = لا أثر) + توليد الكود الموحد | حمايات الحذف | duplicate | mappers التواريخ | الأدوات الجديدة (follow_ups aggregation, wizard rollback)
2. **shim mirror**: تحديث `e2e/vite-e2e-plugin.ts` بكل SQL المعدل/الجديد — فحص `},` transitions بعد كل edit (القاعدة الذهبية) + فحص shim syntax عبر `new Function` template evaluation
3. **migrations.test.ts**: 0015 (drop/FKs/فهارس/orphan cleanup/idempotency) + UNIFIED_TABLES drift
4. **e2e**: تحديث `14-crm-module.spec.ts` (kanban stage guard + مودال التحويل) + happy path كامل (lead→convert→opportunity→won)
5. **بوابات الجودة النهائية**: `tsc -b` 0 | `eslint --max-warnings=0` 0/0 | `vitest run` كامل | `playwright` | `npm run build` | `db:check` (no drift) + **smoke على PG حقيقي داخل ROLLBACK** للتحويل الذرّي وآلة الحالات

---

## القواعد الذهبية العامة للتنفيذ

- **SQL موحّد حرفياً في المسارات الثلاثة** (RPC + fallback + shim) — يُعدَّل الثلاثة معاً أو لا شيء
- **`safeUserId` + `::uuid` casts** لكل FK nullable — لا `String(date)` خام أبداً (`toDateString`)
- **الحسابات (KPIs/أعداد) في SQL دائماً** لا reduce على صفحة واحدة
- **كل كتابة: `logAudit` + RBAC check + حماية مراجع قبل DELETE**
- أرقام وتواريخ الوكيل تمر عبر `sanitizeToolArgs` (موجود — الأدوات الجديدة ترث تلقائياً)
- **fail-closed للكتابة** في runLoop — الأدوات الجديدة write بطبيعتها فتحصل على بطاقات موافقة تلقائياً
- **آلة الحالة في API layer دائماً** — الـ UI يعرض ويرفض بلطف، الـ API يفرض

---

## حالة التنفيذ

| المرحلة | الحالة |
|---|---|
| A1 — Migration 0015 + مرافقه | ✅ (124 migration tests ✓ + smoke PG ✓) |
| A2 — إصلاحات api.ts الجوهرية | ✅ (mappers + updated_by + last_contacted_at في 3 مسارات) |
| A3 — آلة حالات الفرص | ✅ (API + RPC + shim + 39 unit tests + PG smoke) |
| A4 — توحيد التحويل الذرّي | ✅ (CTE واحدة + document_sequences + createOpportunity + idempotent guard) |
| A5 — حمايات الحذف + Audit + Duplicate | ✅ (refs guard + logAudit + API duplicate guard + search parity + KPIs SQL) |
| A6 — إعادة توجيه المستهلكين | ✅ (useDashboard عبر crmApi + getOpportunityStageBreakdown) |
| B1 — حقول ذكية | ✅ (UserSelect/LeadSelect/OpportunitySelect/CustomerSelect في الصفحات الأربع) |
| B2 — Duplicate detection UI | ✅ (DuplicateWarningDialog في الأربع + allowDuplicate flow) |
| B3 — مودال التحويل | ✅ (نموذج كامل + prefilled + createOpportunity checkbox) |
| B4 — تحسينات العرض | ✅ (KPIs سيرفر + كانبان guard + تصدير + حوارس Can + CrmPage count + activities search) |
| C1 — إصلاحات أدوات فورية | ✅ (bug delete_supplier + fuzzy search.tasks/activities + صلاحيات دقيقة crm.edit/delete) |
| C2 — أدوات جديدة | ✅ (get_tasks/get_activities/update_activity/complete_task/win_opportunity) |
| C3 — أدوات ذكية | ✅ (follow_ups/rep_performance + qualify_lead wizard ذرّي مع rollback) |
| C4 — resolver + مهارة + برومبت | ✅ (searchers للفرص والمهام + مهارة crmAssistant + قواعد 32-34 + chips) |
| D — اختبارات وتحقق | ✅ (tsc 0 | lint 0/0 | vitest 1295/1295 | e2e 80/80 | build ✓ | db:check ✓ | PG smoke ✓) |

## نتائج التحقق النهائية

- `npx tsc -b`: **0 errors** ✓
- `npx eslint src/modules/ai src/modules/crm --max-warnings=0`: **LINT CLEAN** ✓
- `npx vitest run`: **1295/1295 passed** (83 ملف، +64 من baseline 1231) ✓
- `npx playwright test`: **80/80 passed** (12 CRM e2e) ✓
- `npm run build`: **✓ built in 1m 24s** ✓
- `npm run db:check`: **Everything's fine** (لا drift) ✓
- **PG smoke داخل ROLLBACK**: migration 0015 idempotent ×2 | جداول ميتة محذوفة | FK SET NULL | آلة الحالات (won→close_date+100+قفل) | CTE التحويل الموحد (5 assertions) | last_contacted_at | حارس الحذف | 6 فهارس ✓

## ملفات إضافية

- `smoke_crm_0015.cjs` — اختبار تكامل PG حي (يُحذف بعد التسليم أو يُنقل لـ scripts/)

*آخر تحديث: 2026-09-01 — التنفيذ مكتمل*
