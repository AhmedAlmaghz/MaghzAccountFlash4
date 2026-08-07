# خطة تطوير وحدة Manufacturing (التصنيع)

## الوصف
إدارة الإنتاج: فاتير المواد (BOM)، أوامر التشغيل، تكاليف الإنتاج.

## الشاشات المطلوب تطويرها

### 1. BomPage (فاتير المواد)
- CRUD + تعديل + حذف
- شجرة مواد (منتج رئيسي + مواد خام + كميات + تكاليف)
- تكلفة مقدرة تلقائية
- طباعة BOM

### 2. WorkOrdersPage (أوامر التشغيل)
- CRUD + تعديل
- حالات: Planned → In Progress → Completed → Cancelled
- استهلاك مخزون (عند In Progress)
- توليد منتج (عند Completed)
- تكلفة فعلية مقابل تكلفة مقدرة
- تقرير التباين (Variance Analysis)

## التحديثات على قاعدة البيانات
```ts
+ boms: id, product_id, version, is_active, total_estimated_cost
+ bom_lines: id, bom_id, product_id (raw material), quantity, unit_cost, total_cost
+ work_orders: id, bom_id, product_id, planned_qty, actual_qty, status, planned_cost, actual_cost, variance_amount
+ work_order_consumptions: id, work_order_id, product_id, qty_consumed, warehouse_id
```

## التكامل
- BOM → Work Order (استنساخ)
- Work Order In Progress → صرف مخزني (Inventory)
- Work Order Completed → إنتاج منتج + قيد يومي
