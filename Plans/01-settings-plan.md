# خطة تطوير وحدة Settings (الإعدادات)

## الوصف
وحدة الإعدادات هي القلب التشغيلي للنظام. يجب تطويرها أولاً لأنها تُغذي باقي الوحدات بـ: العملة، الضريبة، الترقيم التلقائي، الفروع، الحسابات الافتراضية.

## الشاشات المطلوب تطويرها

### 1. Company Setup
- شعار الشركة (Upload + Preview)
- الختم الرسمي (Upload)
- بيانات التواصل (هاتف، بريد، عنوان، Tax ID)
- العملة الافتراضية + الفرع الافتراضي
- **CRUD كامل + عرض + طباعة (بطاقة الشركة)**

### 2. VAT Settings
- إضافة/تعديل/حذف أنواع ضريبة متعددة
- ربط كل ضريبة بحساب محاسبي
- تفعيل/تعطيل
- **تطبيق فوري في فواتير المبيعات/المشتريات**

### 3. Currencies
- CRUD كامل + تحديث أسعار الصرف
- تحديد العملة الأساسية
- **تطبيق في كل الشاشات المالية**

### 4. Document Sequences
- **تطبيق فعلي** في توليد أرقام الفواتير/السندات/القيود تلقائياً
- Inline editing محسّن
- معاينة حية + Reset سنوي

### 5. Branches
- CRUD كامل
- ربط المستخدمين والمستودعات بالفرع
- **فلترة البيانات حسب الفرع في كل الوحدات**

### 6. Default Accounts
- ربط الحسابات الافتراضية (مبيعات، مشتريات، نقدية، بنك، ضريبة...)
- **تطبيق تلقائي في ترحيل الفواتير والقيود**

### 7. Users & Roles
- إدارة المستخدمين (CRUD + تفعيل/تعطيل + تعيين فرع)
- إدارة الأدوار (Grid من الصلاحيات لكل وحدة)
- **تطبيق RBAC فعلي على كل Routes و Buttons**

## التحديثات على قاعدة البيانات
```ts
// settings.ts
+ companies.logo, companies.stamp, companies.tax_id
+ vat_settings.account_id (relation to accounts)
+ branches.manager_id, branches.is_default
+ default_accounts (sales, purchases, cash, bank, vat_input, vat_output, inventory, cogs...)
+ audit_logs table
```

## المكونات الجديدة المطلوبة
- `CompanyForm.tsx`
- `VatSettingsForm.tsx`
- `CurrencyForm.tsx`
- `BranchForm.tsx`
- `DefaultAccountsForm.tsx`
- `UserForm.tsx`
- `RolePermissionsForm.tsx`

## التكامل مع الوحدات الأخرى
- كل فاتورة مبيعات/مشتريات → تأخذ VAT من `vat_settings`
- كل مستند جديد → يأخذ رقمه من `document_sequences`
- كل مستخدم → يُعرض له بيانات فرعه فقط (إن لم يكن admin)
- كل قيد يومي/فاتورة → يستخدم `default_accounts`
