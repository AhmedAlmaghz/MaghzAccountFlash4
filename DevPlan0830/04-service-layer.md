# المرحلة ٤ — إكمال طبقة الخدمات وإزالة الازدواجية

> الأولوية: عالية | المخاطرة: متوسطة | الجهد: ٤-٧ أيام

---

## الهدف

تحويل منطق الأعمال من طبقات API و UI المشتتة إلى خدمات موحدة وإزالة الازدواجية.

---

## الحالة الحالية

- `src/core/services`: `BaseService`, `TransactionManager`, `ImmutableRecordGuard`, `context`, `errors`, `logger`, `stateMachine`.
- `src/modules/*/services/*Service.ts`: موجودة لكن الربط ضعيف.
- فقط `accounting/api.ts` يستورد `accountingService`، بينما `sales/api.ts` لم يستخدم `SalesService`.

---

## المهام التفصيلية

### ٤.١ — توجيه كل استخدامات الـ API إلى الـ services الموحدة

الوحدات المستهدفة: Sales و Purchases و Inventory و Manufacturing و HR و CRM.

1. حدّد الوظائف الحقيقية في الـ services الموجودة.
2. وجّه الـ methods في api.ts إليها مع الحفاظ على casts الصحيحة للـ UUID.
3. حافظ على CTE patterns الموجودة في createInvoice ونظيرها.

### ٤.٢ — إزالة الازدواجية في validation و maps

1. وحّد schemas الـ zod في `validation.ts`.
2. وحّد تحويل الـ snake_case إلى camelCase في `mapRows` المشترك.
3. وحّد المعالجة الخطأ في طبقة UI.

### ٤.٣ — توحيد الأنماط في النفس癖hooks

1. استخدم hooks بنهج `useXxxPaginated()` موحد بدل التكرار في كل صفحة.
2. إزالة التكرار في حقول الـ form.

---

## معايير القبول

- لا منطق أعمال في UI فقط.
- الـ services تحفظ multi-tenancy و casts.
- بقيت tests ناجحة بعد كل تحويل.
