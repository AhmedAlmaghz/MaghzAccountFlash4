# خطة الوحدة: المخازن (Inventory)

> **الهدف:** بناء نظام إدارة مخازن متكامل يشمل المنتجات والمستودعات والجرد والتحويلات.

---

## 1. نظرة عامة

| البند | التفاصيل |
|-------|---------|
| **الاسم** | Inventory |
| **المجلد** | `src/modules/inventory/` |
| **التبعيات** | Core, Auth, Settings |
| **المدة** | أسبوعان (المرحلة 3) |
| **الأولوية** | عالية |

---

## 2. المتطلبات الوظيفية

### 2.1 إدارة المنتجات
- إضافة/تعديل/حذف منتج.
- تصنيفات المنتجات.
- وحدات القياس (قطعة، كيلو، متر...).
- الباركود و SKU.
- سعر التكلفة وسعر البيع.
- الحد الأدنى للمخزون.

### 2.2 المستودعات
- إنشاء/تعديل/حذف مستودع.
- ربط المستودعات بالفروع.
- صلاحيات الوصول للمستودعات.

### 2.3 حركة المخزون
- استلام بضاعة (من المشتريات).
- صرف بضاعة (للمبيعات).
- تحويل بين المستودعات.
- تسوية المخزون (جرد).

### 2.4 التقارير
- بطاقة الصنف (Item Ledger).
- حالة المخزون.
- تنبيه الحد الأدنى.
- المنتجات بطيئة الحركة.
- تقييم المخزون.

---

## 3. هيكل الملفات

```
src/modules/inventory/
├── index.ts
├── types.ts
│
├── api/
│   ├── index.ts
│   ├── queries.ts
│   └── mutations.ts
│
├── components/
│   ├── InventoryPage.tsx
│   ├── ProductsList.tsx
│   ├── ProductForm.tsx
│   ├── WarehousesList.tsx
│   ├── WarehouseForm.tsx
│   ├── StockMovesList.tsx
│   ├── StockMoveForm.tsx
│   └── index.ts
│
├── hooks/
│   ├── useProducts.ts
│   ├── useWarehouses.ts
│   ├── useStockMoves.ts
│   └── index.ts
│
├── reports/
│   ├── ItemLedgerReport.tsx
│   ├── StockStatusReport.tsx
│   ├── LowStockAlert.tsx
│   ├── SlowMovingReport.tsx
│   ├── InventoryValuation.tsx
│   └── index.ts
│
└── utils/
    ├── stockCalculations.ts
    └── barcodeGenerator.ts
```

---

## 4. قاعدة البيانات (Schema)

```ts
// core/database/schema/inventory.ts

// المنتجات
export const products = pgTable('products', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').references(() => companies.id, { onDelete: 'cascade' }).notNull(),
  code: varchar('code', { length: 50 }).notNull(),
  nameAr: varchar('name_ar', { length: 255 }).notNull(),
  nameEn: varchar('name_en', { length: 255 }),
  barcode: varchar('barcode', { length: 100 }),
  sku: varchar('sku', { length: 100 }),
  categoryId: uuid('category_id'),
  unit: varchar('unit', { length: 50 }).default('قطعة').notNull(),
  costPrice: numeric('cost_price', { precision: 18, scale: 4 }).default('0').notNull(),
  salePrice: numeric('sale_price', { precision: 18, scale: 4 }).default('0').notNull(),
  minStock: numeric('min_stock', { precision: 18, scale: 4 }),
  maxStock: numeric('max_stock', { precision: 18, scale: 4 }),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// تصنيفات المنتجات
export const productCategories = pgTable('product_categories', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').references(() => companies.id, { onDelete: 'cascade' }).notNull(),
  nameAr: varchar('name_ar', { length: 100 }).notNull(),
  nameEn: varchar('name_en', { length: 100 }),
  parentId: uuid('parent_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// المستودعات
export const warehouses = pgTable('warehouses', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').references(() => companies.id, { onDelete: 'cascade' }).notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  code: varchar('code', { length: 20 }),
  address: text('address'),
  isDefault: boolean('is_default').default(false).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// رصيد المخزون
export const stockBalances = pgTable('stock_balances', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').notNull(),
  warehouseId: uuid('warehouse_id').references(() => warehouses.id, { onDelete: 'cascade' }).notNull(),
  productId: uuid('product_id').references(() => products.id, { onDelete: 'cascade' }).notNull(),
  quantity: numeric('quantity', { precision: 18, scale: 4 }).default('0').notNull(),
  averageCost: numeric('average_cost', { precision: 18, scale: 4 }).default('0').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// حركات المخزون
export const stockMoves = pgTable('stock_moves', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').notNull(),
  warehouseId: uuid('warehouse_id').references(() => warehouses.id, { onDelete: 'restrict' }).notNull(),
  productId: uuid('product_id').references(() => products.id, { onDelete: 'restrict' }).notNull(),
  type: varchar('type', { length: 20 }).notNull(), // in, out, transfer, adjustment
  quantity: numeric('quantity', { precision: 18, scale: 4 }).notNull(),
  unitCost: numeric('unit_cost', { precision: 18, scale: 4 }),
  reference: varchar('reference', { length: 100 }),
  referenceId: uuid('reference_id'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});
```

---

## 5. المكونات (Components)

### 5.1 قائمة المنتجات

```tsx
// ProductsList.tsx
export const ProductsList = () => {
  const { products, isLoading } = useProducts();
  const [filters, setFilters] = useState({ category: null, search: '' });

  const columns = [
    { key: 'code', header: 'الكود' },
    { key: 'nameAr', header: 'الاسم' },
    { key: 'barcode', header: 'الباركود' },
    { key: 'unit', header: 'الوحدة' },
    { key: 'costPrice', header: 'سعر التكلفة', render: (v) => formatCurrency(v) },
    { key: 'salePrice', header: 'سعر البيع', render: (v) => formatCurrency(v) },
    { key: 'stockQty', header: 'الرصيد', render: (v) => formatNumber(v) },
    { key: 'actions', header: '' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-between">
        <h1>المنتجات</h1>
        <Button>إضافة منتج</Button>
      </div>
      
      <div className="flex gap-4">
        <Input placeholder="بحث..." />
        <Select placeholder="التصنيف" />
      </div>
      
      <DataTable data={products} columns={columns} pagination />
    </div>
  );
};
```

### 5.2 نموذج المنتج

```tsx
// ProductForm.tsx
export const ProductForm = ({ product, onSubmit }: ProductFormProps) => {
  const { categories } = useProductCategories();
  
  return (
    <form className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <Input label="الكود" required />
        <Input label="الباركود" />
      </div>
      
      <div className="grid grid-cols-2 gap-4">
        <Input label="الاسم (عربي)" required />
        <Input label="الاسم (إنجليزي)" />
      </div>
      
      <Select label="التصنيف" options={categories} />
      
      <div className="grid grid-cols-3 gap-4">
        <Input label="الوحدة" required />
        <Input label="سعر التكلفة" type="number" required />
        <Input label="سعر البيع" type="number" required />
      </div>
      
      <div className="grid grid-cols-2 gap-4">
        <Input label="الحد الأدنى للمخزون" type="number" />
        <Input label="الحد الأقصى للمخزون" type="number" />
      </div>
      
      <div className="flex gap-4">
        <Button type="submit">حفظ</Button>
        <Button type="button" variant="ghost">إلغاء</Button>
      </div>
    </form>
  );
};
```

---

## 6. التقارير

### 6.1 بطاقة الصنف

```tsx
// reports/ItemLedgerReport.tsx
export const ItemLedgerReport = () => {
  const { data, isLoading } = useItemLedger();
  const [filters, setFilters] = useState({ 
    productId: null, 
    warehouseId: null, 
    dateRange: null 
  });

  return (
    <div className="space-y-6">
      <div className="flex justify-between">
        <h1>بطاقة الصنف</h1>
        <ExportButton data={data} formats={['pdf', 'xlsx']} />
      </div>
      
      <div className="grid grid-cols-3 gap-4">
        <ProductSelect label="المنتج" required />
        <WarehouseSelect label="المستودع" />
        <DateRangePicker label="الفترة" />
      </div>
      
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>التاريخ</th>
              <th>النوع</th>
              <th>المرجع</th>
              <th>وارد</th>
              <th>صادر</th>
              <th>الرصيد</th>
            </tr>
          </thead>
          <tbody>
            {data?.moves.map((move, idx) => (
              <tr key={idx}>
                <td>{formatDate(move.date)}</td>
                <td>{move.type}</td>
                <td>{move.reference}</td>
                <td className="text-emerald-500">{move.quantityIn > 0 ? formatNumber(move.quantityIn) : '-'}</td>
                <td className="text-rose-500">{move.quantityOut > 0 ? formatNumber(move.quantityOut) : '-'}</td>
                <td className="font-bold">{formatNumber(move.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
```

### 6.2 تنبيه الحد الأدنى

```tsx
// reports/LowStockAlert.tsx
export const LowStockAlert = () => {
  const { data, isLoading } = useLowStockProducts();

  return (
    <div className="space-y-6">
      <h1>تنبيهات المخزون المنخفض</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {data?.map(item => (
          <div key={item.id} className="card border-2 border-amber-500">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-amber-100 rounded-lg flex items-center justify-center">
                <AlertTriangle className="w-6 h-6 text-amber-500" />
              </div>
              <div>
                <h3 className="font-semibold">{item.name}</h3>
                <p className="text-sm text-slate-500">{item.code}</p>
              </div>
            </div>
            <div className="mt-4 flex justify-between text-sm">
              <span>الرصيد الحالي:</span>
              <span className="text-rose-500 font-bold">{formatNumber(item.currentStock)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span>الحد الأدنى:</span>
              <span>{formatNumber(item.minStock)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
```

---

## 7. تقسيم المهام

### الأسبوع الأول

| # | المهمة | المدة | الأولوية |
|---|--------|-------|---------|
| 1 | Schema (products, categories, warehouses) | 4 ساعات | عالية |
| 2 | قائمة المنتجات | 6 ساعات | عالية |
| 3 | نموذج إضافة/تعديل منتج | 4 ساعات | عالية |
| 4 | API للمنتجات | 4 ساعات | عالية |
| 5 | إدارة المستودعات | 4 ساعات | عالية |

### الأسبوع الثاني

| # | المهمة | المدة | الأولوية |
|---|--------|-------|---------|
| 6 | حركات المخزون (استلام/صرف) | 6 ساعات | عالية |
| 7 | التحويل بين المستودعات | 4 ساعات | عالية |
| 8 | تقرير بطاقة الصنف | 4 ساعات | عالية |
| 9 | تقرير حالة المخزون | 3 ساعات | متوسطة |
| 10 | تنبيه الحد الأدنى | 3 ساعات | متوسطة |
| 11 | اختبارات الوحدات | 4 ساعات | متوسطة |

---

## 8. معايير القبول

- [ ] إضافة منتج جديد تعمل.
- [ ] تعديل منتج يعمل.
- [ ] حذف منتج (بدون حركات) يعمل.
- [ ] إضافة مستودع يعمل.
- [ ] استلام بضاعة يحدث الرصيد.
- [ ] صرف بضاعة يحدث الرصيد.
- [ ] التحويل بين المستودعات يعمل.
- [ ] تقرير بطاقة الصنف يعرض بيانات صحيحة.
- [ ] تنبيه الحد الأدنى يظهر المنتجات المنخفضة.
- [ ] اختبارات الوحدات تمر.

---

## 9. المخرجات النهائية

1. **نظام منتجات** كامل.
2. **إدارة مستودعات** متعددة.
3. **حركات مخزون** (استلام، صرف، تحويل).
4. **تقارير** (5 تقارير).
5. **API كامل** للمخازن.
6. **اختبارات** شاملة.

---

*تاريخ الإنشاء: 2026-05-24 | المسؤول: Inventory Module Lead*
