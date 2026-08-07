# خطة تطوير وحدة HR (الموارد البشرية)

## الوصف
إدارة الموظفين، الحضور، الرواتب، الإجازات، نهاية الخدمة.

## الشاشات المطلوب تطويرها

### 1. EmployeesPage
- ربط بـ API (CRUD حقيقي) — الحالي useState محلي فقط!
- صورة شخصية + مرفقات (C.V., عقد...)
- معلومات التواصل، البنك، الضمان الاجتماعي
- تعديل + حذف + عرض

### 2. AttendancePage
- تسجيل يدوي (Check-in/Check-out)
- تقويم شهري (أيام الحضور/الغياب)
- استيراد من جهاز بصمة (إن توفر)
- تقرير الحضور (تصدير/طباعة)

### 3. PayrollPage
- مكونات الراتب: أساسي + بدلات + خصومات
- توليد مسير رواتب (شهري)
- حساب تلقائي: الراتب الصافي
- طباعة مسير (قالب احترافي)
- تقرير الرواتب (تصدير)

### 4. LeavesPage (جديدة)
- إجازات سنوية/مرضية/طارئة
- موافقة (Manager Approval)

### 5. EndOfServicePage (جديدة)
- حساب نهاية الخدمة تلقائياً
- طباعة

## التحديثات على قاعدة البيانات
```ts
+ employees: photo_url, email, phone, bank_account, social_security, department_id, branch_id, hire_date, termination_date
+ attendance: id, employee_id, date, check_in, check_out, status (present, absent, late, overtime)
+ payroll_runs: id, month, year, status, generated_by, generated_at
+ payroll_lines: id, payroll_run_id, employee_id, basic_salary, allowances, deductions, net_salary
+ payroll_components: id, name, type (allowance/deduction), is_percentage, value, is_active
+ leaves: id, employee_id, type, start_date, end_date, days, status, approved_by
+ end_of_service: id, employee_id, years_of_service, total_salary, eos_amount, paid_at
```

## التكامل
- مسير الرواتب → قيد يومي (Accounting) + سند صرف
- إجازة → خصم من الراتب (Payroll)
