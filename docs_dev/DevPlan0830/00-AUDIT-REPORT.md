# التقرير المتكامل لفحص MaghzAccountPro

> تقرير تحليلي شامل نتيجة فحص عميق للكود والمخططات وقاعدة البيانات والبيانات الافتراضية والإعدادات والتقنيات والتبعيات.
> التاريخ: 2026-08-20 — الإصدار المراجع: `package.json` v0.2.5

---

## 1. الخلاصة التنفيذية

**MaghzAccountPro** هو نظام ERP محاسبي متكامل موجه للمنشآت الصغيرة والمتوسطة في العالم العربي. يمتلك قاعدة معمارية ممتازة وواسعة (11 وحدة، ~356 ملف TypeScript/TSX، 24 مخطط قاعدة بيانات، طبقة اختبارات غنية بوحدات و e2e)، لكنه ما زال يحتاج تحسينات إنتاجية حقيقية قبل الاعتماد عليه كمنصة ERP ذات ثقة مؤسسية عالية.

### التقييم العام

| الجانب | التقييم | ملاحظة |
|--------|---------|-------|
| القوة التقنية | 8/10 | بنية وحدات واضحة + TypeScript واسع |
| الأمان | 6/10 | بعض الثغرات الحرجة المتبقية (قسم 3) |
| موثوقية البيانات | 6.5/10 | الترحيل ليس transaction-safe بالكامل |
| سهولة الصيانة | 7/10 | طبقة services غير مكتملة |
| جاهزية ERP | 8/10 | الأساس قوي جداً |

### النتيجة الجوهرية

المشروع **ممتاز بنيوياً** لكنه يحتاج إغلاق فجوات في الأمان والحوكمة المالية قبل الانتقال إلى الإنتاج.

---

## 2. نقاط القوة (يُشيد بها)

- **بنية وحدات واضحة**: `src/modules/{accounting,inventory,sales,purchases,manufacturing,hr,crm,reports,settings,auth,core,ai}`.
- **TypeScript واسع**: ~356 ملف `.ts/.tsx`، و`npx tsc -b` نظيف بلا أخطاء.
- **قاعدة بيانات PostgreSQL + Drizzle ORM**: 24 migration من `0000_unified_schema.sql` (45KB، ~61 جدول) حتى `0023_activities_user_tracking_columns.sql`.
- **طبقة RBAC** في الواجهة: `<Can>`, `<PermissionGate>`, `usePermission`, `Route RBAC` عبر `PermissionRoute`.
- **توليد أرقام مستندات atomic**: `getNextDocumentNumber` في `src/core/api.ts` يستخدم `UPDATE ... RETURNING` (آمن من التنافس) وليس `SELECT + UPDATE` منفصلين.
- **دعم i18n/Multi-currency/Multi-tenant**: بنية غنية منذ البداية.
- **طبقة services الأساسية موجودة**: `BaseService`, `TransactionManager`, `ImmutableRecordGuard`, `ErrorHandler`, `Logger`, `AuditLogger`.

### الميزات التقنية المؤكدة

- مصدر حقيقة واحد للمخطط عبر Drizzle migrations (ملف موحّد `0000_unified_schema.sql`).
- تشفير كلمات المرور PBKDF2 بـ 100000 تكرار SHA-256 في كل من `electron/dbHandler.js` و `seedDemoData.js` و `pgliteAdapter.ts`.
- القناة المحمية بـ `_exec`/`_execBatch` مع حراس أمان لكل statement وصفحة.

---

## 3. الثغرات الأمنية

### 3.1 حرجة — كلمات مرور قاعدة بيانات مكتوبة نصاً في كود المصدر

**الملفات المتأثرة:**
- `drizzle.config.ts` ـ يحتوي fallback `password: 'Zaamla26'` عند عدم وجود `DB_PASSWORD` في `.env`.
- `drizzle.check.config.ts` ـ يحتوي fallback `password: 'Zaamla2026'`.

**الخطر:** أي وصول للمستودع أو للـ source أو bundle يكشف بيانات اعتماد قاعدة بيانات الإنتاج.

**التوصية:** استخدام `process.env.*` فقط بدون defaults صلبة في الملفات الملتزمة. يجب أن تغير كلمة المرور الفعلية في الإنتاج فوراً وأن تُزال من الكود.

### 3.2 حرجة — التفويض يعمل في العميل

`src/modules/auth/store.ts` يدير الصلاحيات عبر `hasPermission` التي تقرأ `user.role` والمصفوفة `permissions` الممررة عند `login`. هناك أيضاً `FALLBACK_PERMISSIONS` في نفس الملف.

**المشكلة الحقيقية:** `login` يعيد تخزين الـ user في localStorage ويستعيده في `initAuth` مع `permissions: []` (السطر 294). ثم `hasPermission` يستند إلى `FALLBACK_PERMISSIONS` حسب `user.role` المحفوظ. أي عابث يمكنه تعديل `auth_user` في localStorage لتغيير `role` إلى `admin` أو `super_admin`. التحقق الحقيقي موجود في `electron/dbHandler.js` (`SQL_MODULE_TABLE_RULES`, `assertSqlAuthorized`, `extractTableNames`)، لكن:

- **`admin` role يتجاوز كل شيء** عبر `hasPermission` عدا `core.edit` — هذا يعني أن مجرد تعديل `role` في localStorage يمنح كل الصلاحيات في UI.
- **القناة الخام `_exec`/`_execBatch`** ما زالت موجودة في `electronPgAdapter` (2 call site) وتفحص منها per statement بواسطة `isSqlAllowed` و `assertSqlAuthorized` — لكن لا شيء يمنع renderer من استدعائها مباشرة إذا اطلع على الـ API.

### 3.3 حرجة — `Math.random` في معرفات تُستخدم بالمنطق الحساس

- `src/core/errorHandling/ErrorHandler.ts:292` — توليد معرّف خطأ عبر `Math.random().toString(36).substring(2, 6)`. ليس مفيداً للتعقب عبر الأنظمة (problem: تتصادم بسهولة وليس unique عالمياً).
- `src/modules/ai/api/browserBridge.ts:166` — توليد `call_...` بـ `Math.random`. أقل، لكن الـ pattern يشير لاعتماد عام.

> ملاحظة مفيدة: `getNextDocumentNumber` في `src/core/api.ts` **لا** يستخدم `Math.random` (يستخدم `UPDATE ... RETURNING`)، وهذا إيجابي — الأرقام القابلة للتدقيق سليمة.

### 3.4 حرجة/متوسطة — الاعتماد المزدوج على نظامين للبذر (seed) بنية مختلفة

هناك **آليتان منفصلتان** لبذر البيانات الافتراضية:
1. `electron/seedDemoData.js` (86KB) — Node + PostgreSQL عبر `pg`، `hashPasswordNode` بـ PBKDF2.
2. `src/core/database/adapters/pgliteAdapter.ts` (من السطر ~230) — بذر PGlite WASM في المتصفح بـ PBKDF2 أيضاً لكن **بنية مختلفة شجرة الحسابات**.

**الخطر:** انجراف البيانات الافتراضية بين الوضعين، عدم تطابق شجرة الحسابات والـ default accounts، وتكرار منطق الأعمال في مكانين.

### 3.5 متوسطة — قناة `_exec`/`_execBatch` المتبقية

`electronPgAdapter.ts` ما زال يعرض `_exec`/`_execBatch` كـ escape hatch محمي بـ `isSqlAllowed` + `assertSqlAuthorized` لكل statement. الوجود محمي، لكن أي انزلاق في الحراس يعني SQL arbitrary من renderer.

---

## 4. الثغرات المعمارية والهيكلية

### 4.1 طبقة الخدمات غير مكتملة

- `src/core/services/`: `BaseService`, `TransactionManager`, `ImmutableRecordGuard`, `context`, `errors`, `logger`, `stateMachine`, `postingService` — **موجودة وضخمة**.
- `src/modules/{accounting,sales,inventory,purchases,manufacturing,hr,crm}/services/`: موجودة.

**لكن الارتباط الفعلي ضعيف:** فقط `accounting/api.ts` يستورد `accountingService` و `sales/api.ts` غير مربوط بـ `SalesService` (عكس ما يُفترض). الـ services الأخرى تُستدعى فقط في `src/modules/ai/tools/*`.

### 4.2 منطق الأعمال مبعثر بين API و UI

كثير من منطق الأعمال (validation, journal generation, sequence fallback, customer balance) موجود داخل ملفات `api.ts`. صيانة صعبة وتكرار وخطر تناقض.

### 4.3 ازدواجية التقارير/المنطق الثابت

`src/modules/ai/tools/detailedReportTools.ts` (46KB) و `reportTools.ts` (76KB) تُكرر منطق التقارير الموجود في `src/modules/reports/*`.

---

## 5. الثغرات المالية والمحاسبية

### 5.1 الترحيلات ليست Transaction-safe بالكامل

`postInvoice` في `sales/api.ts` و `post` في `purchases/api.ts` تقوم بعدة عمليات (journal entry + stock movement + customer balance) لكن لا يبدو أنها كلها داخل transaction واحدة بشكل مضمون. فشل خطوة بعد نجاح أخرى يؤدي لبيانات مالية غير متوازنة.

### 5.2 حماية التعديل بعد الترحيل غير مكتملة

`ImmutableRecordGuard.ts` موجود (11KB) لكن استخدامه في الـ APIs غير مؤكد. قد يكون هناك `DELETE/UPDATE` للسجلات المرحلة دون مرور عليه.

### 5.3 نقص تتبع أرصدة العملاء والموردين عبر كل العمليات

`postInvoice` و `postReturn` في sales يُحدّثان `customers.balance`، لكن ينبغي التحقق أن كل العمليات المالية (voucher posting, payment application) تفعل ذلك بشكل متناسق عبر كل الوحدات.

---

## 6. مشاكل الصيانة والتطوير

- **ازدواجية الأنماط**: hooks/API/forms/export/print/validation متكررة.
- **عدم تناسق الإصدارات**: `package.json` (0.2.5) مقابل `README.md` (v1.0 / v0.1) مقابل `AGENTS.md` (v0.2.0).
- **ملفات سجل قديمة منتشرة** في الجذر: `.txt`, `.log`, `.json`, `.cjs` (acc-test, auth-test, build-out, dev.log, etc).
- **تقرير وخطة قديمة متناقضة**: `Report-plan.md`, `SECURITY_ARCHITECTURE_IMPLEMENTATION.md`, `Plans/`, `Plans/init-Plans/`, `docs/QUALITY_SECURITY_ROADMAP.md`.

---

## 7. مراجعة برمجية للوحدات

| الوحدة | الحالة | ملاحظات |
|--------|--------|---------|
| core | جيدة | adapters 3 (pg/pglite) + خدمات منفصلة |
| auth | متوسطة | RBAC client-side، جلسات localStorage |
| accounting | جيدة | services غير مكتمل في API، ترحيل منفصل |
| inventory | جيدة | UI كثيرة لكن APIs متعددة |
| sales | جيدة لكن ضخمة (80KB) | تحتاج تقسيم |
| purchases | جيدة لكن ضخمة (63KB) | تحتاج تقسيم |
| manufacturing | قوية | service + CTE atomic في updateWorkOrderStatus |
| hr | منفصل |/ |

---

## 8. قاعدة البيانات

- **24 مخطط** SQL + 24 ملف، مع `meta/_journal.json` (24 entry).
- **إشارات انجراف محتملة** بين Drizzle schema و SQL، بين طبقة بذر PGlite و Node، وبين ما يُنتجه `db:check`.
- `db:check` يستند لـ `drizzle.check.config.ts` خارج المجلد `drizzle` — يحتاج مراجعة أمان (يحتوي on default fallback).

> ملاحظة: الكشف عن كلمات مرور fallback في ملفات config يدخل في نطاق المرحلة ١.

---

## 9. i18n

- ملفات `ar.json` و `en.json` موجودة. آخر فحص يدّعي توازنًا (عدد مفاتيح متساوٍ). يجب التحقق دورياً عبر اختبار `i18n.test.ts`.

---

## 10. الاختبارات

- ملفات اختبار وحدة كثيرة في `src/modules/**/*.test.ts/tsx` و `src/core/**`.
- اختبارات e2e في `e2e/*.spec.ts` (حوالي 17 ملف).
- اختبار migrations في `drizzle/migrations.test.ts` (46KB، 24+ assertions).
- طبقة `src/test/setup.ts` و `src/test` (سأشرح في مرحلة 9).

**ملاحظة:** الاختبارات المقطوعة من `vitest` عبر `exclude` يعتمد على `vitest.config.ts` — سأتحقق من تفاصيلها في مرحلة الاختبارات.

---

## 11. مقارنة مع الخطط القديمة

- `Report-plan.md` — عتيق، والشأن الجديد يستهلكه.
- `SECURITY_ARCHITECTURE_IMPLEMENTATION.md` — عتيق ببعض الادعاءات التي لم تعد view واقعية (مثل "وصول DB محمي" في حين ما زالت القناة `_exec`).
- `Plans/` و `Plans/init-Plans/` — علام مبكرة.

**القرار:** الخطط القديمة تبقى مرجعاً تاريخياً، والخطة الجديدة في `DevPlan0830/` هي المرجع الأعلى.

---

## 12. التوصيات (مربوطة بالملفات الجانبية)

| الأولوية | التوصية | ملف |
|---------|---------|-----|
| 🔴 حرجة | إزالة كلمات مرور DB الصلبة | `01-security-secrets.md` |
| 🔴 حرجة | نقل RBAC إلى الخادم ومنع الـ fallback client-side | `01` + `02` |
| 🔴 حرجة | جعل الترحيل transaction-safe | `05-financial-integrity.md` |
| 🟠 عالية | إكمال طبقة الخدمات | `04-service-layer.md` |
| 🟠 عالية | توحيد بذر البيانات | `03-database-schema-drift.md` |
| 🟡 متوسطة | تنظيف `Math.random` في المعرفات | `01` (خطوات تفصيلية) |
| 🟡 متوسطة | تنظيف ملفات السجل القديمة والوثائق | `07` و`12` |

---

## 13. الخلاصة النهائية

الأساس ممتاز، وأكبر الفرص التحسينية ليست في الواجهة بل في: الأمان، سلامة البيانات، إكمال المعمارية الوظيفية، الحوكمة المالية، وقابلية التشغيل في الإنتاج.

*نهاية التقرير.*
