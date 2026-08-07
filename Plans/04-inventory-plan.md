# خطة تطوير وحدة Inventory (المخازن)

## الوصف
إدارة المنتجات والمستودعات والجرد والتحويلات مع تكامل المحاسبي.

## الشاشات المطلوب تطويرها

### 1. ProductsPage
- CRUD كامل + تعديل + حذف
- صورة المنتج (Upload + Preview)
- باركود (Scanner integration)
- وحدات قياس فرعية (Box = 12 Piece)
- تصنيفات متعددة (Tags)
- مستويات تنبيه (Min/Max/Reorder)

### 2. WarehousesPage
- CRUD + ربط بالفرع + مسؤول المستودع
- عرض المخزون حسب المستودع

### 3. StockPage (جديد)
- جدول المخزون (منتج × مستودع)
- تحويل مخزني (من مستودع إلى آخر)
- تسوية مخزون

### 4. InventoryTransactionsPage
- سجل الحركات (استلام، صرف، تحويل، تسوية)
- طباعة (سند استلام/صرف)
- تصدير

### 5. StockAdjustmentPage
- سبب التسوية + تأثير على الحسابات
- موافقة (Approval workflow)

## التحديثات على قاعدة البيانات
```ts
+ products.image_url, products.barcode, products.reorder_level, products.min_stock, products.max_stock
+ product_units: id, product_id, unit_name, conversion_rate, is_default
+ warehouse_transfers: id, from_warehouse_id, to_warehouse_id, product_id, quantity, date, status
+ stock_adjustments: id, warehouse_id, product_id, adjustment_qty, reason, account_id, approved_by, status
```

## التكامل
- تسوية مخزون → قيد يومي (إذا كان هناك أثر محاسبي)
- فاتورة مبيعات → صرف من المستودع تلقائي
- فاتورة مشتريات → استلام في المستودع تلقائي
