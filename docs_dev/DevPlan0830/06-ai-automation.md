# المرحلة ٦ — الذكاء الاصطناعي والأتمتة

> الأولوية: متوسطة | المخاطرة: متوسطة | الجهد: ٣-٥ أيام

---

## الهدف

توجيه أدوات الذكاء الاصطناعي للعمل عبر طبقة الخدمات بدلاً من SQL المباشر، وإغلاق سطح الحقن، وإضافة rate limiting، وتحسين الـ system prompt.

---

## المهام

### ٦.١ — توجيه أدوات AI عبر الخدمات

ملفات الأدوات: `src/modules/ai/tools/*` (reportTools, searchTools, writeTools, wizardTools, detailedReportTools, navigationTools, readTools).

العمل:
1. استبدال بناء SQL الديناميكي الخام باستدعاء الخدمات.
2. تأكيد أن أدوات التقارير تستخدم accountingService.
3. منع الأدوات من التنفيذ المباشر على جداول حساسة.

### ٦.٢ — إغلاق SQL injection و allowlist صارمة

العمل:
1. إعادة التحقق من اسم الجدول ضد AVAILABLE_TABLES قبل التنفيذ.
2. قصر أوامر القراءة على allowlist.

### ٦.٣ — rate limiting و الـ prompt

العمل:
1. وضع حد لاستدعاء الأدوات.
2. تحسين الـ systemPrompt.

---

## معايير القبول

- أدوات AI لا تنفذ SQL مباشراً.
- لا حقوقن injection.
