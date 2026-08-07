# خطة تطوير وحدة Purchases (المشتريات)

## الوصف
فواتير مشتريات، أوامر شراء، موردين، مرتجعات.

## الشاشات المطلوب تطويرها

### 1. PurchaseInvoicesPage
- CRUD كامل + تعديل + حذف + عرض
- ترحيل + توليد القيد اليومي
- طباعة + تصدير
- Document Sequence تلقائي
- ربط بأمر شراء

### 2. SuppliersPage
- CRUD + بطاقة مورد
- كشف حساب (فواتير + مدفوعات)
- تقرير عمر الديون (A/P Aging)

### 3. PurchaseOrdersPage
- CRUD + تحويل إلى فاتورة
- طباعة (قالب أمر شراء)
- حالات: Draft → Sent → Partially Received → Received → Invoiced

### 4. PurchaseReturnsPage
- CRUD + ربط بالفاتورة الأصلية
- أثر مخزني

## التحديثات على قاعدة البيانات
```ts
+ purchase_orders: status, received_amount
+ purchase_order_lines: received_qty, remaining_qty
+ purchase_invoices: purchase_order_id, posted_by, posted_at
+ purchase_returns: original_invoice_id, return_reason
```

## التكامل
- أمر شراء → فاتورة مشتريات
- فاتورة مشتريات → استلام مخزني
- مرتجع → عكسي محاسبي + مخزني
