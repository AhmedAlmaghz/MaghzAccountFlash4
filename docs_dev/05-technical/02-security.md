# الأمان والصلاحيات (توثيق تقني)

> نموذج الدفاع في العمق — من الواجهة حتى قاعدة البيانات

---

## مخطط الطبقات

```
1️⃣ UI (React)          إخفاء + أزرار مقفلة + حرس مسارات
2️⃣ API layer           Validation (Zod) + حراس العمل (لا تعديل مرحّل...)
3️⃣ IPC (Main Process)  Sessions + RBAC + SQL Whitelist لكل statement
4️⃣ PostgreSQL          FKs + UNIQUE + CHECK + الفهارس
```

**اختراق أي طبقة لا يكفي** — يجب اختراق الأربع معاً.

---

## الطبقة 1 — واجهة React

| الحرس | المكوّن |
|---|---|
| إخفاء عناصر القائمة | `useCanAccessModule(module)` — view OR own OR create |
| إخفاء الأزرار | `<Can action="create" module="sales">` / PermissionGate |
| حرس المسارات | `PermissionRoute` — يوجه للوحة عند وصول مباشر لـ URL محظور |
| حرس بيانات الصفحة | `usePermission('reports.view')` في كل تقرير |

> إخفاء الزر ليس الأمان — لكنه يمنع الالتباس، والطبقات التالية تمنع الاختراق.

---

## الطبقة 2 — API layer (حراس العمل)

كل method يتحقق قبل أي SQL (أمثلة):
- `deleteInvoice`: فحص status='draft' + paid_amount=0 أولاً
- `updateInvoice`: رفض تعديل أسطور المرحّل + رفض تقليل paid_amount
- `createInvoice`: رفض paidAmount > totalAmount وexchangeRate ≤ 0
- `updateLeaveStatus`: آلة حالات + فحص رصيد صارم خدمياً
- `updateOpportunity`: مرحلات للأمام فقط (won/lost نهائية + ختم close_date)
- `postVoucher/applyPaymentToInvoice`: CTE ذرّية (لا نافذة سباق)
- **validation بـ Zod** على كل مدخل + تطبيع (أرقام هندية/تواريخ حرة/`''` → null)

---

## الطبقة 3 — Main Process (الدفاع الحاسم)

### الجلسات (Sessions)
| الخاصية | القيمة |
|---|---|
| التخزين | جلسات خادمية برموز — لا localStorage وحده (مظروف نسخة v2 + بصمة tab) |
| انتهاء الخمول | 30 دقيقة |
| **حد مطلق** | 8 ساعات (سweeper كل 60s يمسح المنتهية) |
| revocation فوري | تغيير كلمة مرور/تعطيل/حذف يبطل كل جلسات المستخدم |
| brute-force | 5 محاولات/60s لكل (username + نافذة) ← قفل 5 دقائق |
| multi-tenant login | username واحد بأكثر من شركة: يُقبل أول **نشط** يطابق كلمة المرور (لا LIMIT 1 اعتباطياً) |

### حماية SQL (أهم طبقة للمطورين)
كل statement يمر بثلاث فحوص قبل التنفيذ:

1. **`isSqlAllowed`** — **قائمة بيضاء للجداول**:
   - `extractTableNames(sql)` يستخرج الجداول فعلياً من FROM/JOIN/INTO/UPDATE (باستثناء CTEs)
   - أي جدول غير معروف ← **رفض** (SQL operation not permitted)
   - `pg_*` و`information_schema` مرفوضة دائماً من الواجهة
   - أنماط ممنوعة anchored: `^\s*(set|show|begin|drop|alter|grant|revoke|truncate)\b` (لا تكسر UPDATE ... SET العادية)
2. **`assertSqlAuthorized`** — RBAC على مستوى الجدول:
   - قراءة جدول أعمال ← يحتاج `module.view` أو `module.own`
   - كتابة ← `module.create|edit|post` (استثناءات موثقة: audit writeAny، مراجعية readAny، stock_movements يشمل manufacturing)
3. **Scope إلزامي** — كل query يجب أن تحوي `AND company_id = $N` صراحة (defense-in-depth حتى لو FK يضمن)

### Typed RPC
- الواجهة ترسل **payload منظماً** — لا SQL عبر IPC إلا من الطبقة الرئيسية
- **companyId/created_by تُستخلص من الجلسة** — لا يمكن لواجهة التلاعب بمعرف شركة
- فحص `paramCount` لكل قناة (يمنع off-by-one)

### الكلمات السرية
- **PBKDF2**: 100k تكرار SHA-256 + salt لكل مستخدم
- مفتاح API للوكيل يخزن في main process — لا يظهر للواجهة بعد الحفظ

---

## الطبقة 4 — قاعدة البيانات

| الحرس | مثال |
|---|---|
| **FK ON DELETE** | CASCADE لأبناء الشركة (عزل مستأجر)، SET NULL للأعمدة التدقيقية، RESTRICT للفواتير↔السندات المربوطة |
| **UNIQUE** | `(company_id, username)`، `uq_attendance_emp_date`، partial `uq_payroll_runs_period WHERE draft/posted` |
| **CHECK** | `amount_applied >= 0 AND <= amount` (سندات) |
| **الحذف المكتوم** | حارس refs في API يرفض حذف كيان له مراجع (رسائل عربية مفهودة) |

---

## عزل المستأجرين (Multi-Tenancy)

| الضمان | الآلية |
|---|---|
| كل جدول أعمال يحمل `company_id` NOT NULL | FK → companies ON DELETE CASCADE |
| كل query تشدد بـ company_id | حتى JOIN المتسلسل يغلق بالمرور المباشر |
| الجلسة تحدد الشركة | الواجهة لا تمرر companyId في typed RPC أبداً |
| getCompany/updateCompany | session-scoped — لا يمكن قراءة/تعديل شركة أخرى بمعرف مزيف |
| الأرصدة الافتتاحية والتسلسلات | كلها مشدودة بالشركة |

---

## سجل التدقيق (Audit)

كل كتابة (شاشة أو وكيل ذكي) تدخل `audit_logs` fire-and-forget:
```
user_id | action (create/update/delete/post/cancel/login/logout/reset_password/toggle_active)
| table_name | record_id (UUID أو اسم أداة AI) | old_values/new_values (jsonb)
| company_id | created_at
```
- **قراءة السجل**: admin/settings فقط
- **كتابة**: مسموحة لكل business flow (writeAny) — لا تعطل العمليات المشروعة
- فهرسة: `(company_id, created_at)` + `(company_id, table_name)` + `(company_id, user_id)`

---

## وكيل الذكي — نفس النموذج

كل أداة (249):
- مفلترة بصلاحياتك (لا تُعرض أصلاً)
- مفحوصة الصلاحية مجدداً عند التنفيذ
- **لا كتابة بلا بطاقة موافقة** — وفشل الأدوات الغير مسجلة نحو الأمان (fail-closed)
- كل كتابة تدخل السجل باسم الأداة

---

## ما نحمي ضده (نموذج التهديد)

| التهديد | الدفاع |
|---|---|
| CSRF/Clickjacking من خارج | Electron لا يحمّل أي محتوى خارجي |
| حقن SQL من الواجهة | قائمة بيضاء + parameterized فقط (لا string interpolation من مدخلات) |
| IDOR (الوصول لسجل غيرك) | company_id إلزامي + scope الجلسة |
| سرقة جلسة | مظروف موقّع ببصمة tab + حد مطلق + revocation |
| تخمين كلمة المرور | rate-limit مزدوج المفتاح + lockout |
| هلوسة الوكيل المالي | بطاقات موافقة + حارس ادعاء + حوارس العمل نفسها |
| سلاسل سحب/إسقاط (destruction) | حذف الكيانات المرجعية مرفوض + RESTRICT + أرشيف jsonb قبل/بعد |

---

## checklist الأمان للمراجعة (للمطورين المساهمين)

- [ ] أي SQL جديدة: جداولها في `SQL_MODULE_TABLE_RULES`؟
- [ ] أي عمود INSERT موجود في migration **و** Drizzle schema؟
- [ ] كل معامل uuid بـ `::uuid` وكل تاريخ بـ toDateString؟
- [ ] `AND company_id = $N` صريحة (حتى لو يضمنها FK)؟
- [ ] حراس العمل (حذف/تعديل/مرحّل) قبل SQL لا بعدها؟
- [ ] أي أداة AI جديدة: dangerLevel + صلاحية + summarizeArgs عربي؟

---

## روابط ذات صلة
- **[المستخدمون والأدوار (دليل المستخدم) →](../02-user-guide/11-users-roles.md)**
- **[أمان الوكيل الذكي →](../04-ai-assistant/05-ai-safety.md)**
- **[مصفوفة الصلاحيات الكاملة →](../06-appendix/02-permissions-matrix.md)**

---

- العودة إلى **[الفهرس الرئيسي](../README.md)**
