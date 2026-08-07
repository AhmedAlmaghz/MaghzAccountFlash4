# خطة تطوير وحدة CRM (علاقات العملاء)

## الوصف
إدارة العملاء المحتملين، الفرص البيعية، المهام، والمتابعات.

## الشاشات المطلوب تطويرها

### 1. LeadsPage
- CRUD + تحويل إلى عميل
- سجل المكالمات/المتابعات
- تقييم: Hot/Warm/Cold

### 2. OpportunitiesPage
- لوحة Kanban: New → Qualified → Proposal → Negotiation → Won/Lost
- Drag & Drop بين المراحل
- قيمة الفرصة + نسبة الإغلاق المتوقعة
- تقرير قمع المبيعات (Sales Funnel)

### 3. TasksPage
- CRUD + تخصيص + تاريخ استحقاق
- تنبيهات (Due soon/Overdue)
- ربط بعميل/فرصة

### 4. ActivitiesPage (جديدة)
- سجل المكالمات/الاجتماعات/البريد
- تقرير أداء المندوبين

## التحديثات على قاعدة البيانات
```ts
+ leads: id, name, email, phone, source, status, assigned_to, converted_customer_id
+ opportunities: id, lead_id/customer_id, title, value, probability, stage, expected_close_date, assigned_to
+ crm_activities: id, type (call, meeting, email, note), related_type, related_id, date, notes, created_by
```

## التكامل
- Lead → Customer (Sales)
- Opportunity → Quotation/Invoice (Sales)
- Task → Notification (Core)
