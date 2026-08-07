# خطة تطوير وحدة Sales (المبيعات)

## الوصف
فواتير مبيعات احترافية مع ضريبة، عروض أسعار، عملاء، مرتجعات.

## الشاشات المطلوب تطويرها

### 1. InvoicesPage
- CRUD كامل: إنشاء + تعديل المسودات + حذف المسودات + عرض
- ترحيل (Post) مع تأكيد + توليد القيد اليومي تلقائياً
- طباعة احترافية (قالب فاتورة مع شعار الشركة + الختم)
- تصدير PDF (RTL + Cairo font)
- تصدير Excel (قائمة الفواتير)
- Document Sequence تلقائي (من الإعدادات)
- VAT حساب تلقائي (من الإعدادات)
- تسوية ديون (ربط سند قبض بفاتورة)
- حالات الفاتورة: Draft → Posted → Partially Paid → Paid → Cancelled

### 2. CustomersPage
- CRUD كامل + بطاقة عميل
- كشف حساب (فواتير + مدفوعات + الرصيد)
- تقرير عمر الديون (A/R Aging)

### 3. QuotationsPage
- CRUD + تحويل إلى فاتورة
- طباعة (قالب عرض سعر)
- انتهاء الصلاحية (Expiry date)

### 4. SalesReturnsPage
- CRUD + ربط بالفاتورة الأصلية
- أثر مخزني (إرجاع الكمية)
- أثر محاسبي (عكسي)

## التحديثات على قاعدة البيانات
```ts
+ sales_invoices.sequence_number, posted_by, posted_at, cancelled_by, cancellation_reason
+ sales_invoice_lines.discount_amount, cost_price, warehouse_id
+ sales_invoices.paid_amount, remaining_amount (computed)
+ sales_returns: original_invoice_id, return_reason, status
```

## التكامل
- فاتورة جديدة → Document Sequence (Settings)
- VAT → من VatSettings
- ترحيل → Default Accounts (Settings) + Journal Entry (Accounting)
- صرف مخزني → Inventory Transaction
- عرض سعر → تحويل إلى فاتورة
