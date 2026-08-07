# خطة تطوير وحدة Reports (التقارير المركزية + Dashboard)

## الوصف
لوحة تحكم احترافية + تقارير تحليلية + Report Builder.

## الشاشات المطلوب تطويرها

### 1. MainDashboard
- فلاتر تاريخ (اليوم/الأسبوع/الشهر/السنة/مخصص)
- مقارنة بالفترة السابقة
- KPIs تفاعلية (الضغط يفتح التقرير)
- رسوم بيانية: Line, Bar, Pie, Donut, Area, Waterfall
- تصدير Dashboard (PDF)
- Widgets قابلة للتخصيص

### 2. Sales Analysis Report
- فلاتر متقدمة (تاريخ، عميل، منتج، مندوب)
- Pivot Table (المنتج × الشهر)
- تصدير Excel

### 3. Inventory Analysis Report
- بطيء الحركة + منخفض المخزون + ربحية المنتج
- ABC Analysis

### 4. Financial Reports
- Trial Balance: فلاتر + Drill-down + تصدير
- Balance Sheet: مقارنة فترات + رسوم بيانية
- P&L: مقارنة فترات + Waterfall chart

### 5. Custom Report Builder (جديدة)
- اختيار الجدول → اختيار الأعمدة → الفلاتر → المعاينة → تصدير

## التحديثات على قاعدة البيانات
```ts
+ dashboard_widgets: id, user_id, widget_type, position, config
+ report_templates: id, user_id, name, table, columns, filters, created_at
```

## التكامل
- Dashboard → يجمع بيانات من كل الوحدات
- تقرير مخصص → أي جدول في النظام
