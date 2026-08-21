# المرحلة ٣ — قاعدة البيانات والمخططات وفحص الانجراف (Schema Drift)

> الأولوية: عالية | المخاطرة: متوسطة | الجهد: ٣-٥ أيام

---

## الهدف

توحيد المخطط عبر مصدر حقيقة واحد (Drizzle migrations)، ضمان الاتساق والـ idempotency، تحسين الفهارس وبذر البيانات، وجعل `db:check` فحصاً موثوقاً لا يعدّل ملفات المشروع.

---

## الحالة الحالية

- 24 ملف SQL في `drizzle/` (من `0000_unified_schema.sql` إلى `0023_activities_user_tracking_columns.sql`).
- `drizzle/meta/_journal.json` يحوي 24 entry.
- طبقة البذر مزدوجة: `electron/seedDemoData.js` (Node/PG) و `src/core/database/adapters/pgliteAdapter.ts` (PGlite WASM).
- `db:check` يخرج drift كامل داخل `.drizzle-drift-check`.

---

## المهام التفصيلية

### ٣.١ — تثبيت journal الـ migrations

1. أضف اختبار يتحقق أن كل ملف `.sql` له entry مقابل في `_journal.json`، وأن كل entry له ملف موجود.
2. اختبار يتحقق أن journal `tag` يطابق اسم الملف.
3. عدّل `drizzle/migrations.test.ts` ليعكس الـ 24 migration (وليس 14 القديمة).

### ٣.٢ — إصلاح `db:check`

المشكلة: `drizzle.check.config.ts` يولّد مهمة drift كاملة داخل `.drizzle-drift-check` بدلاً من إثبات عدم وجود drift.

1. استبدل آلية الفحص الحالية بطريقة لا تعدّل ملفات المشروع.
2. اجعل drift check يفشل بوضوح عند الاختلاف.
3. أدرج `db:check` في preflight و CI gates (راجع المرحلة ٩).

### ٣.٣ — توحيد بذر البيانات

المشكلة: `electron/seedDemoData.js` و `pgliteAdapter.ts` يكرران المنطق بشجرتي حساب وبيانات اdefault غير متطابقتين.

الحل:
1. استخرج مصفوفات ACCOUNTS و PRODUCT_TYPES و CURRENCIES و DEFAULT_ACCOUNTS و UNITS و BANKS و CASH_BOXES إلى ثوابت مشتركة.
2. اجعل كل بذر يستدعي الدالة المشتركة.
3. اختبر أن `getDefaultAccounts` و شجرة الحسابات متطابقة بين الوضعين.

### ٣.٤ — فحص الـ indexes والـ unique constraints

1. أكد indexes على جداول: customers، sales_invoices، purchase_invoices، journal_entries بأن تُبنى فعلياً.
2. لا indexes مكررة.
3. إزالة أي index غير مستخدم.

---

## استراتيجية الاختبار

- اختبارات journal (ملف مقابل entry).
- اختبار idempotency بإعادة تشغيل الـ seed مرتين.
- اختبار drift يفشل عند إدخال تغيير وهمي في schema.

## معايير القبول

- `db:check` لا يعدّل ملفاً tracked.
- كل migration له journal entry.
- بذر الـ PGlite و الـ PG متطابقان.
