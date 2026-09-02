# مصفوفة الصلاحيات الكاملة

> مرجع RBAC الكامل — الأدوار × الوحدات

---

## بنية الصلاحية

```
<module>.<action>
```
الأفعال: `view` (كل السجلات) • `own` (سجلاتي فقط) • `create` • `edit` • `delete` • `post` (ترحيل)

---

## الأدوار الجاهزة (Fallback Permissions)

### super_admin
| النطاق | الصلاحيات |
|---|---|
| كل شيء | `*` — تجاوز كامل لكل الفحوصات |

### admin
| النطاق | الصلاحيات |
|---|---|
| كل شيء | عدا `core.edit` |

### manager — مدير
| الوحدة | view | own | create | edit | delete | post |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| core (لوحة) | ✅ | | | ❌ | | |
| accounting | ✅ | | ✅ | ✅ | | ✅ |
| inventory | ✅ | | ✅ | ✅ | | |
| sales | ✅ | | ✅ | ✅ | | ✅ |
| purchases | ✅ | | ✅ | ✅ | | |
| manufacturing | ✅ | | ✅ | ✅ | | ✅ |
| hr | ✅ | | | | | |
| crm | ✅ | | | | | |
| reports | ✅ + export | | | | | |
| settings | ✅ | | | | | |
| ai | ✅ use | | | | | |

### accountant — محاسب
| الوحدة | view | own | create | edit | delete | post |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| core | ✅ | | | | | |
| accounting | ✅ | | ✅ | ✅ | | ✅ |
| inventory | ✅ (قراءة) | | | | | |
| sales | ✅ | | ✅ | ✅ | | |
| purchases | ✅ | | ✅ | ✅ | | |
| manufacturing | ✅ (قراءة) | | | | | |
| reports | ✅ + export | | | | | |
| ai | ✅ use | | | | | |

### sales_rep — مندوب مبيعات
| الوحدة | view | own | create | edit | delete | post |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| sales | | ✅ (فواتيره) | ✅ | ✅ | | |
| inventory | | ✅ | | | | |
| crm | | ✅ | ✅ | ✅ | | |
| reports | ✅ | | | | | |
| ai | ✅ use | | | | | |

> المندوب يرى **فواتيره فقط** — الفلتر خدمي وليس واجهياً.

### viewer — قراءة فقط
| الوحدة | view |
|---|---|
| core, accounting, inventory, sales, purchases, manufacturing, reports | ✅ (بلا create/edit/delete/post/export) |

---

## الصلاحيات الخاصة (خارج الأنماط)

| الصلاحية | تفتح | الدور الافتراضي |
|---|---|---|
| `reports.export` | أزرار Excel/PDF | manager, accountant |
| `reports.custom` | منشئ التقارير المخصص | (أدوار مخصصة) |
| `settings.users` | صفحة المستخدمين | admin |
| `settings.roles` | صفحة الأدوار | admin |
| `settings.audit_log` | سجل العمليات | admin |
| `ai.use` | الدردشة والودج | manager, accountant, sales_rep |
| `ai.settings` | إعداد المزود | admin |
| `core.edit` | تعديرات نادرة ببيانات الشركة | super_admin فقط |

---

## قواعد التقييم (hasPermission)

```
1. super_admin          → true دائماً
2. admin                → true إلا core.edit
3. دور له قائمة صلاحيات → مطابقة القائمة (يدعم wildcard *)
4. وإلا                 → Fallback حسب الدور (الجداول أعلاه)
```

الأدوار المخصصة (من صفحة `/roles`) تستخدم **قائمة الصلاحيات المخزنة** — لا fallback.

---

## الوصول للقوائم (useCanAccessModule)

يظهر عنصر القائمة إذا: `view` **أو** `own` **أو** `create` للوحدة —
(مندوب بـ `sales.own` يرى قائمة المبيعات رغم عدم امتلاكه `sales.view`)

---

## RBAC على مستوى SQL (الطبقة الثانية)

في نسخة سطح المكتب، كل statement يفحص ضد قواعد الجداول:

| الجدول | قراءة تتطلب | كتابة تتطلب |
|---|---|---|
| جداول أعمال الوحدة | module.view أو module.own | module.create أو edit أو post |
| مرجعية (currencies/units/vat/cash_boxes/default_accounts/sequences) | readAny (الجميع) | أي module.create |
| warehouses | readAny | inventory.* + manufacturing.* (cross-module) |
| stock_movements | inventory.view | inventory.* + manufacturing.* |
| transactions/journal_entries | accounting.view | accounting.* + hr.create/edit (مسير/EOS) |
| audit_logs | settings.audit_log | writeAny (كل flow) |

---

## مثال: تصميم أدوار مخصصة

| الدور المقترح | الصلاحيات |
|---|---|
| **أمين مخزن** | inventory.view + create + edit (+ manufacturing.view) |
| **محاسب تحصيل** | accounting.view + create + edit • sales.view • reports.view + export |
| **موظف استقبال** | crm.view + create + edit • sales.own + create |
| **مراجع خارجي** | viewer (قراءة شاملة بلا تصدير) |
| **مساعد مالي** | accounting.view • reports.view (بلا create ولا export) |

> أنشئها من `/roles` — الأدوار النظامية تُستنسخ (Clone) ثم تعدل.

---

## الاختبار السريع لصلاحياتك

```
سجّل الدخول ثم اسأل الوكيل: «ايش الصفحات اللي أقدر أفتحها؟»
→ app.list_pages يعرض كتالوجك المفلتر
```

---

## روابط ذات صلة
- **[دليل المستخدمين والأدوار →](../02-user-guide/11-users-roles.md)**
- **[توثيق الأمان التقني →](../05-technical/02-security.md)**

---

- العودة إلى **[الفهرس الرئيسي](../README.md)**
