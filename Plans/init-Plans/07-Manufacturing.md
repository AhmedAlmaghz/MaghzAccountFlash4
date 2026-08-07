# خطة الوحدة: التصنيع (Manufacturing)

> **الهدف:** بناء نظام تصنيع متكامل يشمل فواتير المواد (BOM)، أوامر التشغيل، وتكاليف الإنتاج.

---

## 1. نظرة عامة

| البند | التفاصيل |
|-------|---------|
| **الاسم** | Manufacturing |
| **المجلد** | `src/modules/manufacturing/` |
| **التبعيات** | Core, Auth, Settings, Accounting, Inventory |
| **المدة** | 3 أسابيع (المرحلة 6) |
| **الأولوية** | متوسطة |

---

## 2. المتطلبات الوظيفية

### 2.1 فواتير المواد (BOM)
- إنشاء/تعديل/حذف فاتورة مواد.
- تحديد المكونات والكميات.
- حساب التكلفة القياسية.
- إصدارات متعددة من BOM.

### 2.2 أوامر التشغيل (Work Orders)
- إنشاء أمر تشغيل من BOM.
- متابعة حالة الأمر (مخطط، قيد التنفيذ، مكتمل، ملغى).
- تسجيل المواد المستخدمة.
- تسجيل المنتج التام.

### 2.3 تكاليف الإنتاج
- تكلفة المواد الخام.
- تكلفة العمالة.
- تكاليف غير مباشرة (Overhead).
- مقارنة التكلفة القياسية بالفعلية.

### 2.4 التقارير
- تكلفة الإنتاج.
- حالة أوامر التشغيل.
- استهلاك المواد.
- تحليل الفروقات (Variance Analysis).
- كفاءة خط الإنتاج.

---

## 3. هيكل الملفات

```
src/modules/manufacturing/
├── index.ts
├── types.ts
│
├── api/
│   ├── index.ts
│   ├── queries.ts
│   └── mutations.ts
│
├── components/
│   ├── ManufacturingPage.tsx
│   ├── BomList.tsx
│   ├── BomForm.tsx
│   ├── WorkOrdersList.tsx
│   ├── WorkOrderForm.tsx
│   └── index.ts
│
├── hooks/
│   ├── useBoms.ts
│   ├── useWorkOrders.ts
│   └── index.ts
│
├── reports/
│   ├── ProductionCostReport.tsx
│   ├── WorkOrderStatus.tsx
│   ├── MaterialConsumption.tsx
│   ├── VarianceAnalysis.tsx
│   └── index.ts
│
└── utils/
    └── costCalculations.ts
```

---

## 4. قاعدة البيانات (Schema)

```ts
// core/database/schema/manufacturing.ts

// فواتير المواد (BOM)
export const billsOfMaterials = pgTable('bills_of_materials', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').notNull(),
  code: varchar('code', { length: 50 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  productId: uuid('product_id').references(() => products.id, { onDelete: 'restrict' }).notNull(),
  outputQuantity: numeric('output_quantity', { precision: 18, scale: 4 }).notNull(),
  standardCost: numeric('standard_cost', { precision: 18, scale: 4 }).default('0').notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// بنود BOM
export const bomLines = pgTable('bom_lines', {
  id: uuid('id').defaultRandom().primaryKey(),
  bomId: uuid('bom_id').references(() => billsOfMaterials.id, { onDelete: 'cascade' }).notNull(),
  productId: uuid('product_id').references(() => products.id, { onDelete: 'restrict' }).notNull(),
  quantity: numeric('quantity', { precision: 18, scale: 4 }).notNull(),
  unitCost: numeric('unit_cost', { precision: 18, scale: 4 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// أوامر التشغيل
export const workOrders = pgTable('work_orders', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').notNull(),
  orderNumber: varchar('order_number', { length: 50 }).notNull(),
  bomId: uuid('bom_id').references(() => billsOfMaterials.id, { onDelete: 'restrict' }).notNull(),
  productId: uuid('product_id').notNull(),
  plannedQuantity: numeric('planned_quantity', { precision: 18, scale: 4 }).notNull(),
  actualQuantity: numeric('actual_quantity', { precision: 18, scale: 4 }).default('0'),
  startDate: date('start_date'),
  endDate: date('end_date'),
  status: varchar('status', { length: 20 }).default('planned').notNull(), // planned, in_progress, completed, cancelled
  standardCost: numeric('standard_cost', { precision: 18, scale: 4 }).default('0').notNull(),
  actualCost: numeric('actual_cost', { precision: 18, scale: 4 }).default('0'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// استهلاك المواد
export const materialConsumptions = pgTable('material_consumptions', {
  id: uuid('id').defaultRandom().primaryKey(),
  workOrderId: uuid('work_order_id').references(() => workOrders.id, { onDelete: 'cascade' }).notNull(),
  productId: uuid('product_id').notNull(),
  plannedQuantity: numeric('planned_quantity', { precision: 18, scale: 4 }).notNull(),
  actualQuantity: numeric('actual_quantity', { precision: 18, scale: 4 }).notNull(),
  unitCost: numeric('unit_cost', { precision: 18, scale: 4 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});
```

---

## 5. تقسيم المهام

### الأسبوع الأول

| # | المهمة | المدة | الأولوية |
|---|--------|-------|---------|
| 1 | Schema (BOM, work orders) | 4 ساعات | عالية |
| 2 | قائمة فواتير المواد | 4 ساعات | عالية |
| 3 | نموذج BOM | 6 ساعات | عالية |
| 4 | API للـ BOM | 4 ساعات | عالية |

### الأسبوع الثاني

| # | المهمة | المدة | الأولوية |
|---|--------|-------|---------|
| 5 | أوامر التشغيل | 8 ساعات | عالية |
| 6 | استهلاك المواد | 4 ساعات | عالية |
| 7 | إنتاج المنتج التام | 4 ساعات | عالية |
| 8 | حساب التكاليف | 4 ساعات | عالية |

### الأسبوع الثالث

| # | المهمة | المدة | الأولوية |
|---|--------|-------|---------|
| 9 | التقارير (5 تقارير) | 10 ساعات | متوسطة |
| 10 | اختبارات الوحدات | 4 ساعات | متوسطة |

---

## 6. معايير القبول

- [ ] إنشاء BOM جديد يعمل.
- [ ] إضافة مكونات للـ BOM.
- [ ] إنشاء أمر تشغيل من BOM.
- [ ] تسجيل استهلاك المواد.
- [ ] إنتاج المنتج التام.
- [ ] حساب التكلفة الفعلية.
- [ ] التقارير تعرض بيانات صحيحة.
- [ ] اختبارات الوحدات تمر.

---

## 7. المخرجات النهائية

1. **نظام BOM** كامل.
2. **أوامر تشغيل**.
3. **حساب تكاليف الإنتاج**.
4. **5 تقارير** متقدمة.
5. **API كامل** للتصنيع.
6. **اختبارات** شاملة.

---

*تاريخ الإنشاء: 2026-05-24 | المسؤول: Manufacturing Module Lead*
