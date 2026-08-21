# المرحلة ٩ — الاختبارات والتكامل المستمر (CI)

> الأولوية: متوسطة | المخاطرة: منخفضة | الجهد: ٤-٦ أيام

---

## الهدف

جعل CI يعكس جودة الإنتاج فعلياً عبر preflight يشمل lint و tsc و test، مع إضافة عتبات تغطية، والخروج بـ e2e موثوقة.

---

## المهام

### ٩.١ — تحسين preflight والـ CI

1. تعديل preflight إلى: `npm run lint && npx tsc -b && npm test`.
2. إدراج الجهد) coverage عبر عتبة متدرجة.
3. ضمان أن الـ e2e لديها DB reset واضح و admin password.

### ٩.٢ — اختبارات الأمان

1. اختبار يحظر raw SQL exposure في production build.
2. اختبار يحظر استخدام Math.random في identifiers حساس.
3. اختبار يحظر `dangerouslySetInnerHTML`.

### ٩.٣ — استقرار e2e

1. إصلاح race conditions.
2. إضافة اختبارات critical.

---

## معايير القبول

- CI يفشل عند build/lint/test/schema drift.
- لا warnings معروفة.
- التغطية لا تقل عن الحد المقرر.
