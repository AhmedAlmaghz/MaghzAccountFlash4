# خطة الوحدة: المشتريات (Purchases)

> **الهدف:** بناء نظام مشتريات متكامل يشمل فواتير المشتريات، أوامر الشراء، حسابات الموردين، والتقارير المتقدمة.

---

## 1. نظرة عامة

| البند | التفاصيل |
|-------|---------|
| **الاسم** | Purchases |
| **المجلد** | `src/modules/purchases/` |
| **التبعيات** | Core, Auth, Settings, Accounting, Inventory |
| **المدة** | 3 أسابيع (المرحلة 5) |
| **الأولوية** | عالية |

---

## 2. المتطلبات الوظيفية

### 2.1 فواتير المشتريات
- إنشاء/تعديل/حذف فاتورة مشتريات.
- حساب الضريبة (VAT) تلقائياً.
- دعم متعدد العملات.
- ربط الفاتورة بالقيود المحاسبية.

### 2.2 أوامر الشراء (Purchase Orders)
- إنشاء أمر شراء.
- متابعة حالة الأمر (مفتوح، مستلم، مغلق).
- تحويل أمر الشراء إلى فاتورة.

### 2.3 مرتجعات المشتريات
- إنشاء فاتورة مرتجع مشتريات.
- تحديث المخزون تلقائياً.

### 2.4 حسابات الموردين (A/P)
- دليل الموردين.
- سجل حركات المورد.
- عمر الديون (A/P Aging).
- الدفعات والأذونات.

### 2.5 التقارير
- فواتير المشتريات.
- كشف حساب المورد.
- مقارنة أسعار الموردين.
- تقرير الضريبة (VAT).
- عمر الديون (A/P Aging).

---

## 3. هيكل الملفات

```
src/modules/purchases/
├── index.ts
├── types.ts
│
├── api/
│   ├── index.ts
│   ├── queries.ts
│   ├── mutations.ts
│   └── types.ts
│
├── components/
│   ├── PurchasesPage.tsx
│   ├── PurchaseInvoicesList.tsx
│   ├── PurchaseInvoiceForm.tsx
│   ├── PurchaseOrdersList.tsx
│   ├── PurchaseOrderForm.tsx
│   ├── VendorsList.tsx
│   ├── VendorForm.tsx
│   └── index.ts
│
├── hooks/
│   ├── usePurchaseInvoices.ts
│   ├── usePurchaseOrders.ts
│   ├── useVendors.ts
│   └── index.ts
│
├── reports/
│   ├── PurchaseInvoicesReport.tsx
│   ├── VendorStatement.tsx
│   ├── PriceComparison.tsx
│   ├── ApAgingReport.tsx
│   ├── VatPurchasesReport.tsx
│   └── index.ts
│
└── utils/
    └── purchaseCalculations.ts
```

---

## 4. قاعدة البيانات (Schema)

```ts
// core/database/schema/purchases.ts

// الموردين
export const vendors = pgTable('vendors', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').references(() => companies.id, { onDelete: 'cascade' }).notNull(),
  code: varchar('code', { length: 50 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  phone: varchar('phone', { length: 50 }),
  email: varchar('email', { length: 255 }),
  address: text('address'),
  taxNumber: varchar('tax_number', { length: 50 }),
  balance: numeric('balance', { precision: 18, scale: 4 }).default('0').notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// فواتير المشتريات
export const purchaseInvoices = pgTable('purchase_invoices', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').notNull(),
  invoiceNumber: varchar('invoice_number', { length: 50 }).notNull(),
  vendorId: uuid('vendor_id').references(() => vendors.id, { onDelete: 'restrict' }).notNull(),
  date: date('date').notNull(),
  dueDate: date('due_date'),
  currency: char('currency', { length: 3 }).default('YER').notNull(),
  exchangeRate: numeric('exchange_rate', { precision: 18, scale: 6 }).default('1').notNull(),
  subtotal: numeric('subtotal', { precision: 18, scale: 4 }).default('0').notNull(),
  vatAmount: numeric('vat_amount', { precision: 18, scale: 4 }).default('0').notNull(),
  total: numeric('total', { precision: 18, scale: 4 }).default('0').notNull(),
  status: varchar('status', { length: 20 }).default('draft').notNull(),
  notes: text('notes'),
  journalEntryId: uuid('journal_entry_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// بنود فاتورة المشتريات
export const purchaseInvoiceLines = pgTable('purchase_invoice_lines', {
  id: uuid('id').defaultRandom().primaryKey(),
  invoiceId: uuid('invoice_id').references(() => purchaseInvoices.id, { onDelete: 'cascade' }).notNull(),
  productId: uuid('product_id').references(() => products.id, { onDelete: 'restrict' }).notNull(),
  quantity: numeric('quantity', { precision: 18, scale: 4 }).notNull(),
  unitCost: numeric('unit_cost', { precision: 18, scale: 4 }).notNull(),
  lineTotal: numeric('line_total', { precision: 18, scale: 4 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// أوامر الشراء
export const purchaseOrders = pgTable('purchase_orders', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').notNull(),
  orderNumber: varchar('order_number', { length: 50 }).notNull(),
  vendorId: uuid('vendor_id').notNull(),
  date: date('date').notNull(),
  expectedDate: date('expected_date'),
  total: numeric('total', { precision: 18, scale: 4 }).default('0').notNull(),
  status: varchar('status', { length: 20 }).default('open').notNull(), // open, partial, received, cancelled
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// دفعات الموردين
export const vendorPayments = pgTable('vendor_payments', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').notNull(),
  invoiceId: uuid('invoice_id').references(() => purchaseInvoices.id, { onDelete: 'restrict' }),
  vendorId: uuid('vendor_id').notNull(),
  date: date('date').notNull(),
  amount: numeric('amount', { precision: 18, scale: 4 }).notNull(),
  method: varchar('method', { length: 50 }).notNull(),
  reference: varchar('reference', { length: 100 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});
```

---

## 5. تقسيم المهام

### الأسبوع الأول

| # | المهمة | المدة | الأولوية |
|---|--------|-------|---------|
| 1 | Schema (vendors, invoices, orders) | 4 ساعات | عالية |
| 2 | دليل الموردين | 4 ساعات | عالية |
| 3 | نموذج فاتورة المشتريات | 8 ساعات | عالية |
| 4 | API للمشتريات | 6 ساعات | عالية |

### الأسبوع الثاني

| # | المهمة | المدة | الأولوية |
|---|--------|-------|---------|
| 5 | ربط الفاتورة بالقيود المحاسبية | 4 ساعات | عالية |
| 6 | تحديث المخزون عند الاستلام | 4 ساعات | عالية |
| 7 | أوامر الشراء | 6 ساعات | متوسطة |
| 8 | مرتجعات المشتريات | 4 ساعات | متوسطة |

### الأسبوع الثالث

| # | المهمة | المدة | الأولوية |
|---|--------|-------|---------|
| 9 | التقارير (5 تقارير) | 12 ساعة | عالية |
| 10 | اختبارات الوحدات | 4 ساعات | متوسطة |

---

## 6. معايير القبول

- [ ] إنشاء فاتورة مشتريات تعمل.
- [ ] حساب الضريبة تلقائياً.
- [ ] تحديث رصيد المورد.
- [ ] تحديث المخزون عند الترحيل.
- [ ] إنشاء قيد يومي تلقائي.
- [ ] أوامر الشراء تعمل.
- [ ] مرتجعات المشتريات تعمل.
- [ ] التقارير تعرض بيانات صحيحة.
- [ ] اختبارات الوحدات تمر.

---

## 7. المخرجات النهائية

1. **نظام فواتير مشتريات** كامل.
2. **أوامر شراء**.
3. **مرتجعات مشتريات**.
4. **حسابات الموردين** (A/P).
5. **5 تقارير** متقدمة.
6. **API كامل** للمشتريات.
7. **اختبارات** شاملة.

---

*تاريخ الإنشاء: 2026-05-24 | المسؤول: Purchases Module Lead*
