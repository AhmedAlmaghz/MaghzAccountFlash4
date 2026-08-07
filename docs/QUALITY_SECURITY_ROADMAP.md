# خطة تقوية MaghzAccountPro

آخر تحديث: 2026-06-17  
النطاق: الأمان، قاعدة البيانات، جودة الكود، الأداء، الاختبارات، تجربة المستخدم، وقابلية الصيانة.

## 1. الهدف

تحويل التطبيق إلى نظام ERP أكثر احترافية وقوة ومرونة وسهولة في الصيانة والتطوير والاستخدام، مع تقليل مخاطر الأمان، وضمان سلامة البيانات المحاسبية والمخزنية، ورفع موثوقية الاختبارات وعمليات التطوير.

## 2. الحالة الحالية

النقاط القوية الحالية:

- المشروع منظم بنمط modules واضح.
- TypeScript build ينجح عبر `npx tsc -b`.
- اختبارات الوحدة ناجحة: `289/289`.
- توجد migrations وقاعدة بيانات PostgreSQL واسعة: 60 جدول.
- توجد طبقة RBAC في الواجهة عبر `<Can>` و`PermissionGate`.
- تم تنفيذ i18n على نطاق واسع.
- server-side pagination موجود في عدد كبير من الصفحات.
- توجد e2e tests أساسية.
- توجد بنية multi-currency وتقارير متعددة.

المخاطر الحالية:

- الواجهة تملك وصول raw SQL عبر `window.electronDB.query`.
- RBAC مطبق في الواجهة أكثر من طبقة الخدمة/قاعدة البيانات.
- الجلسة تعتمد على `localStorage` ويمكن التلاعب بها محلياً.
- `db:check` يولد migration كامل بدلاً من إثبات عدم وجود drift.
- توجد مخاطر HTML injection في export/print.
- توجد fallbacks عشوائية لأرقام المستندات.
- بعض عمليات business posting ليست transaction-safe بالكامل.
- بعض التقارير بها بقايا i18n fallback وسلوك فلترة ناقص.
- توجد فجوة بين الوثائق والواقع في بعض النقاط مثل version وconsole cleanup.

## 3. ملاحظات تشغيل الفحص

تم تنفيذ فحوص قراءة فقط قدر الإمكان أثناء مرحلة الفحص:

- `npx tsc -b --pretty false`: نجح.
- `npm test`: نجح، 27 ملف اختبار و289 اختبار.
- `npm run lint`: انتهى بالـ timeout بعد 120 ثانية، النتيجة غير مؤكدة.
- `npm run db:check`: ولّد ملف drift كامل داخل `.drizzle-drift-check`.
- `git status --short`: أظهر تعديل `drizzle/meta/_journal.json`.

ملاحظة مهمة:

- أمر `npm run db:check` أحدث أثراً جانبياً في `drizzle/meta/_journal.json` بإضافة entry للـ migration `0008_voucher_cash_box_id`.
- يجب مراجعة هذا التغيير قبل أي commit.
- لا يتم الرجوع عنه إلا بقرار صريح من مالك المشروع.

## 4. الأولويات التنفيذية

### المرحلة 1: إغلاق الثغرات الأمنية الحرجة

الهدف:

- منع أي مستخدم أو XSS من تنفيذ SQL مباشر.
- نقل الثقة الأمنية من renderer إلى main/service layer.

المهام:

- إزالة أو تقييد `window.electronDB.query` من renderer.
- إنشاء IPC API محددة لكل عملية business مثل `sales.createInvoice`, `accounting.postTransaction`, `inventory.createStockMovement`.
- منع raw SQL من الواجهة إلا في e2e/dev mode.
- إضافة allowlist صارمة للعمليات في main process.
- جعل كل IPC operation تستقبل `session/user/companyId` وتتحقق منها.
- نقل RBAC checks إلى main/service layer.
- رفض أي create/update/delete/post/export بدون permission فعلي.
- إضافة audit log لكل العمليات الحساسة.

الملفات المحورية:

- `electron/preload.*`
- `electron/main.*`
- `src/core/database/adapters/electronPgAdapter.ts`
- `src/core/database/adapters/index.ts`
- `src/modules/auth/store.ts`
- `src/core/ui/components/PermissionGate.tsx`
- كل `src/modules/*/api.ts`

اختبارات مطلوبة:

- محاولة تنفيذ عملية بدون صلاحية يجب أن تفشل.
- مستخدم sales_rep لا يستطيع الوصول لبيانات شركة أخرى.
- renderer لا يستطيع تنفيذ SQL arbitrary.
- e2e login ثم محاولة عملية غير مصرح بها.

معايير القبول:

- لا يوجد exposure مباشر لـ raw `query(sql, params)` في production renderer.
- كل العمليات الحساسة تمر من service method typed.
- كل service method يطبق RBAC وcompany isolation.

### المرحلة 2: إصلاح المصادقة والجلسات

الهدف:

- منع التلاعب بـ `localStorage` لتغيير الدور أو الصلاحيات.
- تحسين أمان كلمات المرور.

المهام:

- استبدال الثقة بـ `auth_user` في `localStorage` بجلسة موقعة أو تخزين آمن عبر Electron.
- جعل بيانات user في الواجهة للعرض فقط، لا مصدر صلاحيات.
- تحميل الصلاحيات من قاعدة البيانات أو session موثقة.
- فرض انتهاء الجلسة من طبقة موثوقة.
- تعطيل أو حماية `admin/admin` في production.
- إجبار تغيير كلمة المرور الافتراضية عند أول دخول.
- ترقية legacy SHA-256 password hash إلى PBKDF2 عند login ناجح.
- إضافة rate limiting محلي لمحاولات تسجيل الدخول.

الملفات المحورية:

- `src/modules/auth/api.ts`
- `src/modules/auth/store.ts`
- `electron/seedDemoData.js`
- `src/app/router.tsx`
- `src/app/layout.tsx`

اختبارات مطلوبة:

- تعديل `localStorage.auth_user.role` لا يمنح صلاحيات.
- كلمة المرور legacy تُرقى بعد login.
- admin default يجبر تغيير كلمة المرور.
- inactive user لا يستطيع الدخول.

معايير القبول:

- صلاحيات المستخدم لا تُستمد من localStorage.
- session tampering لا يمنح صلاحيات.
- كلمات المرور الجديدة PBKDF2 فقط.

### المرحلة 3: إصلاح فحص Schema Drift والمigrations

الهدف:

- جعل فحص قاعدة البيانات موثوقاً وقابلاً للاستخدام في CI.
- ضمان توافق Drizzle schema مع SQL migrations.

المهام:

- مراجعة `drizzle/meta/_journal.json` والتأكد من وجود entry صحيح لـ `0008_voucher_cash_box_id`.
- إصلاح `npm run db:check` لأنه حالياً يولد migration كامل في `.drizzle-drift-check`.
- استبدال طريقة الفحص الحالية بآلية لا تعدل ملفات المشروع.
- جعل drift check يفشل بوضوح عند وجود اختلاف.
- إضافة test يتأكد أن كل migration file له journal entry.
- إضافة test يتأكد أن journal entries تقابل ملفات موجودة.
- التحقق من أن كل SQL migration idempotent عند الحاجة.
- مراجعة nullability لـ `company_id` في الجداول الأساسية وتوثيق الاستثناءات.

الملفات المحورية:

- `drizzle/meta/_journal.json`
- `drizzle/*.sql`
- `drizzle.check.config.ts`
- `drizzle/migrations.test.ts`
- `package.json`

اختبارات مطلوبة:

- journal entries match migration files.
- لا يوجد migration file بلا entry.
- لا يوجد journal entry بلا file.
- db:check لا يغير `drizzle/meta/_journal.json`.
- db:check يرجع exit code غير صفر عند وجود drift.

معايير القبول:

- `npm run db:check` لا يغير أي ملف tracked.
- CI يستطيع كشف drift بوضوح.
- journal وmigrations متزامنان.

### المرحلة 4: تعقيم التصدير والطباعة

الهدف:

- منع HTML/script injection في كل exports وprint windows.

المهام:

- إضافة utility مركزية مثل `escapeHtml(value)`.
- منع استخدام `element.innerHTML` في export.
- تحويل `dataToHtmlTable` ليهرب كل labels والقيم.
- مراجعة كل `window.open`, `document.write`, وHTML template strings.
- تعقيم محتوى تقارير التصنيع والطباعة.
- إزالة الاعتماد على external Google fonts في print عند الإمكان أو جعله اختيارياً.

الملفات المحورية:

- `src/core/utils/export.ts`
- `src/core/utils/printDocument.ts`
- `src/modules/manufacturing/components/WorkOrdersPage.tsx`
- تقارير print/export في `src/modules/**`

اختبارات مطلوبة:

- قيمة مثل `<img onerror=alert(1)>` تظهر كنص آمن.
- export table لا يحتوي script قابل للتنفيذ.
- print templates تهرب user input.
- لا يوجد استخدام غير مبرر لـ `innerHTML`.

معايير القبول:

- كل HTML generated من بيانات المستخدم معقم.
- لا توجد interpolation مباشرة لقيم user داخل HTML.

### المرحلة 5: إصلاح أرقام المستندات والتسلسل

الهدف:

- منع تكرار أرقام السندات والفواتير.
- جعل الترقيم transaction-safe وقابل للتدقيق.

المهام:

- إزالة `Math.random` من fallback أرقام السندات.
- جعل `useDocumentSequence` يفشل إذا لم يوجد `companyId` بدلاً من توليد رقم عشوائي.
- نقل توليد الأرقام إلى DB transaction أو service method.
- ضمان unique constraints على أرقام المستندات لكل شركة.
- إضافة locking مناسب عند توليد الرقم التالي.
- مراجعة كل `getNextDocumentNumber` وdocument_sequences.

الملفات المحورية:

- `src/core/utils/useDocumentSequence.ts`
- `src/modules/accounting/components/ReceiptVouchersPage.tsx`
- `src/modules/accounting/components/PaymentVouchersPage.tsx`
- `src/core/api.ts`
- `src/core/database/schema/settings.ts`
- `drizzle/*.sql`

اختبارات مطلوبة:

- توليد رقمين متوازيين لا ينتج duplicate.
- غياب companyId يرجع error لا fallback.
- إنشاء voucher يستخدم sequence فقط.
- unique violation تظهر كرسالة مفهومة.

معايير القبول:

- لا يوجد `Math.random` في أرقام المستندات الإنتاجية.
- كل document number audit-safe.

### المرحلة 6: جعل العمليات المالية والمخزنية Transaction-Safe

الهدف:

- ضمان أن posting لا يترك النظام في حالة جزئية.

المهام:

- مراجعة كل عمليات `post`, `complete`, `approve`.
- لف sales invoice posting داخل transaction واحدة.
- لف purchase invoice posting داخل transaction واحدة.
- لف receipt/payment voucher posting داخل transaction واحدة.
- لف manufacturing work order completion داخل transaction واحدة.
- إدخال stock movements وjournal entries والحالة النهائية كعملية ذرية.
- منع تعديل posted documents إلا عبر reversal/correction workflow.
- إضافة status transition rules موحدة.

الملفات المحورية:

- `src/modules/sales/api.ts`
- `src/modules/purchases/api.ts`
- `src/modules/accounting/api.ts`
- `src/modules/inventory/api.ts`
- `src/modules/manufacturing/api.ts`
- `src/core/utils/journalEntryGenerator.ts`

اختبارات مطلوبة:

- posting invoice ينتج journal balanced.
- posting sales invoice يقلل المخزون عند الحاجة.
- posting purchase invoice يزيد المخزون.
- فشل إدخال journal entry يرجع كل التغييرات.
- لا يمكن حذف posted document.
- returns تنشئ reversal صحيح.

معايير القبول:

- كل business posting إما ينجح بالكامل أو يفشل بالكامل.
- لا توجد عمليات جزئية في المخزون أو القيود.

### المرحلة 7: تقوية العزل متعدد الشركات

الهدف:

- منع أي cross-tenant read/write.

المهام:

- جعل `companyId` إلزامياً في كل API method.
- إصلاح `manufacturingApi.updateConsumption` ليطلب `companyId`.
- مراجعة كل queries التي تستخدم child table بدون join على parent company.
- إضافة tests تبحث عن `WHERE id = $1` بدون `company_id`.
- منع أي operation تعتمد على id فقط.
- إضافة database-level constraints حيث ممكن.

الملفات المحورية:

- `src/modules/*/api.ts`
- `src/core/database/adapters/electronPgAdapter.ts`
- `src/core/utils/validation.ts`

اختبارات مطلوبة:

- tenant A لا يستطيع قراءة/تحديث id من tenant B.
- كل by-id API يرفض بدون companyId.
- static test يبحث عن patterns الخطرة.

معايير القبول:

- لا توجد method إنتاجية تقبل id فقط لبيانات tenant-owned.
- كل read/update/delete يفلتر company_id مباشرة أو عبر parent verified.

### المرحلة 8: إصلاح التقارير وi18n المتبقي

الهدف:

- إزالة fallbacks الصلبة.
- جعل التقارير دقيقة وسهلة الاستخدام.

المهام:

- تنظيف `StockMovementReport` من `t(...) || 'fallback'`.
- إصلاح `productFilter` في `StockMovementReport` ليؤثر فعلياً على query أو data.
- إضافة `sm.company_id = $1` صراحة في كل stock movement query.
- إزالة fallback `data.companyName || 'الشركة'` من `printDocument`.
- إضافة test يمنع hardcoded Arabic/English fallbacks في JSX.
- مراجعة كل التقارير الجديدة بعد آخر مراحل i18n.

الملفات المحورية:

- `src/modules/reports/StockMovementReport.tsx`
- `src/core/utils/printDocument.ts`
- `src/core/i18n/ar.json`
- `src/core/i18n/en.json`
- `src/core/i18n/i18n.test.ts`

اختبارات مطلوبة:

- i18n balance.
- لا توجد patterns مثل `t('x') || 'Text'`.
- product filter يغير نتائج التقرير.
- report queries تحتوي company filter.

معايير القبول:

- لا fallbacks صلبة في UI.
- تقرير حركة المخزون يفلتر المنتج بشكل صحيح.

### المرحلة 9: تحسين جودة الاختبارات وCI

الهدف:

- جعل CI يعكس جودة الإنتاج فعلياً.

المهام:

- تعديل `preflight` إلى `npm run lint && npx tsc -b && npm test`.
- إضافة coverage config وthreshold تدريجي.
- إصلاح warning في `PermissionGate.test.tsx` حول `act`.
- إضافة integration tests ضد PostgreSQL لمسارات business.
- تشغيل e2e في CI مع reset DB واضح.
- إضافة اختبار يمنع raw SQL exposure في production build.
- إضافة اختبار يمنع `Math.random` في business identifiers.
- إضافة اختبار يمنع `dangerouslySetInnerHTML` و`innerHTML` غير المعقم.

الملفات المحورية:

- `package.json`
- `vitest.config.ts`
- `playwright.config.ts`
- `src/core/ui/components/PermissionGate.test.tsx`
- `e2e/*.spec.ts`

اختبارات مطلوبة:

- preflight يمر محلياً.
- coverage لا يقل عن threshold.
- e2e critical flows تمر.
- static safety tests تمر.

معايير القبول:

- CI يفشل عند build/lint/test/schema drift.
- لا توجد warnings اختبارية معروفة.

### المرحلة 10: تحسين الأداء والقابلية للتوسع

الهدف:

- تقليل الاستعلامات الكبيرة والتكرار.

المهام:

- مراجعة APIs غير paginated مثل `electronPgAdapter.getTransactions`.
- نقل كل القوائم الكبيرة إلى server-side pagination.
- إضافة indexes للتقارير الثقيلة حسب explain plans.
- إزالة loops التي تنفذ query داخل loop، خصوصاً manufacturing completion.
- إضافة caching خفيف للتقارير dashboard إذا لزم.
- تقييم virtualization للجداول الكبيرة.
- مراجعة bundle وتقليل dependencies غير المستخدمة.

الملفات المحورية:

- `src/core/database/adapters/electronPgAdapter.ts`
- `src/core/hooks/usePaginatedList.ts`
- `src/modules/reports/**`
- `src/modules/*/api.ts`
- `vite.config.ts`
- `package.json`

اختبارات مطلوبة:

- API pagination لا تجلب كل الصفوف.
- تقارير كبيرة تستخدم indexes.
- لا يوجد for-await query loop في API.
- bundle لا يحتوي dependencies غير مستخدمة.

معايير القبول:

- القوائم الثقيلة paginated.
- تقارير KPI لا تسبب بطئاً واضحاً على بيانات كبيرة.

### المرحلة 11: تحسين قابلية الصيانة والتوثيق

الهدف:

- جعل المشروع أسهل للتطوير طويل المدى.

المهام:

- توحيد version بين `package.json` و`AGENTS.md`.
- تحديث AGENTS.md ليعكس الواقع بعد الإصلاحات.
- نقل constants الحساسة إلى `.env.example` بدون passwords.
- حذف dependencies غير المستخدمة بعد التأكد.
- توحيد patterns بين APIs.
- تقليل legacy methods داخل `electronPgAdapter`.
- إضافة ADR مختصر لقرارات: raw SQL ممنوع، RBAC in service layer، migration strategy.
- إضافة docs للـ posting workflow والمحاسبة.

الملفات المحورية:

- `package.json`
- `AGENTS.md`
- `ARCHITECTURE.md`
- `TESTING.md`
- `DEPLOYMENT.md`
- `drizzle.check.config.ts`
- `.env.example`

اختبارات مطلوبة:

- لا توجد secrets افتراضية في configs.
- version موحد.
- docs تذكر أوامر CI الصحيحة.

معايير القبول:

- مطور جديد يستطيع فهم architecture وworkflow بسهولة.
- لا توجد وثائق متعارضة مع الكود.

## 5. ترتيب التنفيذ المقترح

الترتيب الموصى به:

1. مراجعة أثر `db:check` على `drizzle/meta/_journal.json`.
2. إصلاح `db:check` وmigrations journal.
3. إغلاق raw SQL من renderer.
4. نقل RBAC إلى service/main layer.
5. إصلاح auth/session trust.
6. تعقيم export/print.
7. إزالة `Math.random` من أرقام المستندات.
8. جعل posting operations transaction-safe.
9. تقوية multi-tenancy by-id checks.
10. تنظيف i18n/report fallbacks.
11. تحسين preflight/coverage/e2e.
12. تحسين الأداء والتوثيق.

## 6. معايير جاهزية الإنتاج

يعتبر التطبيق أقرب لجاهزية إنتاجية عندما تتحقق الشروط التالية:

- لا raw SQL exposed في renderer.
- لا صلاحيات تعتمد على localStorage.
- RBAC مفروض في طبقة الخدمة.
- كل tenant-owned query يحتوي company isolation.
- كل posting transaction-safe.
- كل journal entries balanced باختبارات.
- كل document numbers sequence-based.
- schema drift check موثوق ولا يعدل ملفات.
- lint وtsc وunit وe2e وdb check تمر في CI.
- exports وprint templates معقمة.
- لا default admin/admin في production.
- لا hardcoded fallback UI strings.
- docs والversion متزامنة.

## 7. مخاطر يجب الانتباه لها أثناء التنفيذ

- تغيير adapter layer قد يكسر e2e bridge، لذلك يجب تحديث `e2e/vite-e2e-plugin.ts` بالتوازي.
- نقل RBAC إلى service layer يتطلب معرفة user/session في كل operation.
- تعديل sequence generation قد يحتاج migration لإضافة unique constraints.
- جعل posting transaction-safe قد يكشف bugs قديمة في journal generation.
- إصلاح db:check قد يتطلب تغيير طريقة استخدام Drizzle Kit.
- إزالة raw SQL تدريجياً أفضل من تغيير شامل دفعة واحدة.

## 8. أول دفعة تنفيذ مقترحة

الدفعة الأولى صغيرة ومحددة:

- مراجعة وتثبيت `drizzle/meta/_journal.json`.
- إصلاح `package.json` `preflight` إلى `npx tsc -b`.
- إصلاح `db:check` حتى لا يعدل tracked files.
- إضافة tests للـ migration journal.
- إصلاح `useDocumentSequence` لمنع fallback العشوائي عند غياب companyId.
- تنظيف `StockMovementReport` من fallbacks وإصلاح product filter.
- إضافة `escapeHtml` وتعقيم `dataToHtmlTable`.

سبب اختيار هذه الدفعة:

- تأثير عالي.
- مخاطرة منخفضة مقارنة بإعادة تصميم IPC.
- تجهز الأرضية للدفعات الأمنية الأكبر.
- يمكن التحقق منها بسرعة عبر `tsc`, `test`, `lint`, `db:check`.

## 9. ثاني دفعة تنفيذ مقترحة

الدفعة الثانية أمنية:

- تصميم service IPC layer typed.
- منع raw SQL في production renderer.
- نقل permission checks إلى service methods.
- إضافة tests لمحاولات bypass.
- تحديث e2e bridge لاستخدام endpoints آمنة أو إبقاؤه dev-only بوضوح.

## 10. ثالث دفعة تنفيذ مقترحة

الدفعة الثالثة business integrity:

- transaction-safe posting للمبيعات.
- transaction-safe posting للمشتريات.
- transaction-safe vouchers.
- transaction-safe manufacturing completion.
- منع تعديل posted documents مباشرة.
- إضافة reversal/correction workflow لاحقاً.
