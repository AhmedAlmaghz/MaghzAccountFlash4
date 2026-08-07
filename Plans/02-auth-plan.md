# خطة تطوير وحدة Auth (تسجيل الدخول والصلاحيات)

## الوصف
نظام مصادقة وصلاحيات احترافي مع سجل مراجعة كامل.

## الشاشات المطلوب تطويرها

### 1. LoginPage
- تحسين UI (خلفية تفاعلية + Animation)
- تذكرني + استعادة كلمة المرور

### 2. UsersPage
- CRUD كامل + عرض التفاصيل + Reset Password
- تعيين فرع + تفعيل/تعطيل

### 3. RolesPage
- شاشة جديدة (جدول صلاحيات: الصف=الوحدة، العمود=العملية)
- الأدوار الافتراضية: Super Admin, Manager, Accountant, Sales Rep, HR Admin, Viewer

### 4. Audit Trail
- `modules/auth/components/AuditLogPage.tsx`
- سجل العمليات: من أنشأ/عدّل/حذف/متى/أي جدول
- فلاتر (تاريخ، مستخدم، نوع العملية)
- **تصدير Excel/PDF**

## التحديثات على قاعدة البيانات
```ts
+ audit_logs: id, user_id, action, table_name, record_id, old_values, new_values, timestamp, ip_address
+ users.branch_id, users.is_active, users.last_login
+ roles.permissions: jsonb (structured: { module: string, actions: string[] })
```

## المكونات الجديدة
- `AuditLogTable.tsx`
- `RolePermissionsGrid.tsx`
- `UserProfileCard.tsx`

## التكامل
- كل عملية Create/Update/Delete → تسجل في `audit_logs`
- كل Route → يتحقق من الصلاحية
- كل Button → يُخفي إذا لم يكن لدى المستخدم الصلاحية
