# المرحلة ١ — الأمان والأسرار وإغلاق سطح الهجوم

> الأولوية: حرجة • المخاطرة: منخفضة • الجهد: ٣-٥ أيام
> المتطلبات المسبقة: لا شيء (أولى المراحل)

---

## الهدف

إزالة كلمات المرور الصلبة من كود المصدر، إغلاق القناة الخام لقاعدة البيانات من renderer، نقل التفويض نهائياً إلى طبقة الخادم، وإزالة كل اعتماد على `Math.random` في المعرفات.

---

## المهام التفصيلية

### 1.1 — إزالة كلمات مرور قاعدة البيانات من كود المصدر

**الملفات:**
- `drizzle.config.ts` (السطر 13-14): يحوي `user: process.env.DB_USER || 'maghz'` و `password: process.env.DB_PASSWORD || 'Zaamla26'`.
- `drizzle.check.config.ts` (السطر 13-14): يحوي `password: process.env.DB_PASSWORD || 'Zaamla2026'`.

**العمل:**
1. حذف أي fallback نصي لكلمة المرور. القيمة تأتي فقط من `process.env.DB_PASSWORD`.
2. تغيير كلمة مرور قاعدة البيانات الفعلية فوراً (أصبحت معروفة).
3. إضافة حارس CI يمنع commit أي كلمة مرور fallback في الملفات الملتزمة.

**كود مرجعي (بعد التعديل):**
```ts
dbCredentials: {
  host: process.env.DB_HOST ?? 'localhost',
  port: parseInt(process.env.DB_PORT ?? '5432'),
  database: process.env.DB_NAME ?? 'MaghzAccountFlash35',
  user: process.env.DB_USER ?? 'maghz',
  password: process.env.DB_PASSWORD, // REQUIRED — بدون fallback
  ssl: false,
},
```

### 1.2 — قصر `_exec`/`_execBatch` على النطاق المقصود

**الملفات:** `electron/preload.cjs`, `electron/preload.js`, `src/core/database/adapters/electronPgAdapter.ts`.

1. توثيق صريح أن هاتين الطريقتين داخليتان فقط ولا تستدعيان من كود التطبيق.
2. إضافة تحقق: رفض أي `_exec` بدون جلسة صالحة، ورفض أي statement كتابة على جداول غير مسموح بها للدور.
3. لا تحذف جذرياً الآن — التسليم النهائي في المرحلة 04 بعد تحويل كل call sites إلى typed RPC.

### 1.3 — نفل التحقق من الصلاحيات إلى طبقة الخادم

**المشكلة:** `hasPermission` في `src/modules/auth/store.ts` يمنح `admin` كل الصلاحيات ما عدا `core.edit`، ويمنح `super_admin` كل شيء. الـ fallback يقرأ role الموجود في localStorage، لذا تعديل role من المتصفح يمنح وصولاً كاملاً في الواجهة.

**الإصلاح:**
1. جعل `permissions` (غير `user.role`) هي مصدر الحقيقة في الواجهة.
2. تعديل `hasPermission` لتفرض الاعتماد على `permissions` القادمة من الخادم عبر `session.user.permissions` وليس `user.role`.
3. الاحتفاظ بـ `FALLBACK_PERMISSIONS` فقط للوضع التجريبي (demo) وليس الإنتاج.
4. التأكد أن `initAuth` يستعيد `permissions` من الخادم وليس `[]` (السطر 294 حالياً يُعيدها فارغة).

### 1.4 — تنظيف `Math.random` من المعرفات

**الملفات:**
- `src/core/errorHandling/ErrorHandler.ts:292` — يستبدل بـ `crypto.randomUUID()`.
- `src/modules/ai/api/browserBridge.ts:166` — `call_${crypto.randomUUID()}`.

العمل: استبدال `Math.random().toString(36).substring(2,N)` بـ `crypto.randomUUID()` في كل مكان.

---

## استراتيجية الاختبار

- اختبار يكشف أي fallback لكلمة مرور في الملفات الملتزمة.
- اختبار أن `hasPermission` لا يمنح صلاحيات من `role` عامل تعديل محلي (تعديل رأي).
- اختبار `Math.random` لا يظهر في معرفات الكنز.

## معايير القبول

- لا يوجد fallback كلمة مرور في الكود الملتزم.
- لا قنوات خام غير محمية في renderer (توثيق صريح / قنوات typed RPC).
- لا `Math.random` في معرف عملي (استخدام unique id).
- التغييرات كافة لا تكسر: `npx tsc -b`, `npm test`, `npm run build`.
