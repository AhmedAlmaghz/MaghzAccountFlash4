# خطة الوحدة: المبيعات (Sales)

> **الهدف:** بناء نظام مبيعات متكامل يشمل الفواتير الضريبية، عروض الأسعار، حسابات العملاء، والتقارير المتقدمة.

---

## 1. نظرة عامة

| البند | التفاصيل |
|-------|---------|
| **الاسم** | Sales |
| **المجلد** | `src/modules/sales/` |
| **التبعيات** | Core, Auth, Settings, Accounting, Inventory |
| **المدة** | 3 أسابيع (المرحلة 4) |
| **الأولوية** | عالية |

---

## 2. المتطلبات الوظيفية

### 2.1 فواتير المبيعات
- إنشاء/تعديل/حذف فاتورة.
- حساب الضريبة (VAT) تلقائياً.
- دعم متعدد العملات.
- طباعة الفاتورة (PDF).
- ربط الفاتورة بالقيود المحاسبية.

### 2.2 عروض الأسعار (Quotations)
- إنشاء عرض سعر.
- تحويل عرض السعر إلى فاتورة.
- متابعة حالة العرض (معلق، مقبول، مرفوض).

### 2.3 مرتجعات المبيعات
- إنشاء فاتورة مرتجع.
- تحديث المخزون تلقائياً.
- حساب الضريبة المعكوسة.

### 2.4 حسابات العملاء (A/R)
- دليل العملاء.
- سجل حركات العميل.
- عمر الديون (A/R Aging).
- التحصيل والمقبوضات.

### 2.5 التقارير
- فواتير المبيعات.
- كشف حساب العميل.
- أعلى العملاء مبيعاً.
- أعلى المنتجات مبيعاً.
- التحليل الموسمي.
- تقرير الضريبة (VAT).

---

## 3. هيكل الملفات

```
src/modules/sales/
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
│   ├── SalesPage.tsx
│   ├── InvoicesList.tsx
│   ├── InvoiceForm.tsx
│   ├── InvoiceDetail.tsx
│   ├── QuotationsList.tsx
│   ├── QuotationForm.tsx
│   ├── ReturnsList.tsx
│   ├── ReturnForm.tsx
│   ├── CustomersList.tsx
│   ├── CustomerForm.tsx
│   └── index.ts
│
├── hooks/
│   ├── useInvoices.ts
│   ├── useQuotations.ts
│   ├── useCustomers.ts
│   ├── useInvoiceMutations.ts
│   └── index.ts
│
├── reports/
│   ├── SalesInvoicesReport.tsx
│   ├── CustomerStatement.tsx
│   ├── TopCustomersReport.tsx
│   ├── TopProductsReport.tsx
│   ├── SeasonalAnalysis.tsx
│   ├── ArAgingReport.tsx
│   ├── VatSalesReport.tsx
│   ├── charts/
│   │   ├── MonthlyRevenueChart.tsx
│   │   ├── TopProductsChart.tsx
│   │   └── index.ts
│   └── index.ts
│
└── utils/
    ├── invoiceCalculations.ts
    ├── vatCalculator.ts
    └── pdfTemplate.ts
```

---

## 4. قاعدة البيانات (Schema)

```ts
// core/database/schema/sales.ts

// العملاء
export const customers = pgTable('customers', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').references(() => companies.id, { onDelete: 'cascade' }).notNull(),
  code: varchar('code', { length: 50 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  phone: varchar('phone', { length: 50 }),
  email: varchar('email', { length: 255 }),
  address: text('address'),
  taxNumber: varchar('tax_number', { length: 50 }),
  creditLimit: numeric('credit_limit', { precision: 18, scale: 4 }),
  balance: numeric('balance', { precision: 18, scale: 4 }).default('0').notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// فواتير المبيعات
export const salesInvoices = pgTable('sales_invoices', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').references(() => companies.id, { onDelete: 'cascade' }).notNull(),
  invoiceNumber: varchar('invoice_number', { length: 50 }).notNull(),
  customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'restrict' }).notNull(),
  date: date('date').notNull(),
  dueDate: date('due_date'),
  currency: char('currency', { length: 3 }).default('YER').notNull(),
  exchangeRate: numeric('exchange_rate', { precision: 18, scale: 6 }).default('1').notNull(),
  subtotal: numeric('subtotal', { precision: 18, scale: 4 }).default('0').notNull(),
  discountAmount: numeric('discount_amount', { precision: 18, scale: 4 }).default('0').notNull(),
  vatAmount: numeric('vat_amount', { precision: 18, scale: 4 }).default('0').notNull(),
  total: numeric('total', { precision: 18, scale: 4 }).default('0').notNull(),
  status: varchar('status', { length: 20 }).default('draft').notNull(), // draft, posted, paid, cancelled
  notes: text('notes'),
  journalEntryId: uuid('journal_entry_id'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// بنود الفاتورة
export const salesInvoiceLines = pgTable('sales_invoice_lines', {
  id: uuid('id').defaultRandom().primaryKey(),
  invoiceId: uuid('invoice_id').references(() => salesInvoices.id, { onDelete: 'cascade' }).notNull(),
  productId: uuid('product_id').references(() => products.id, { onDelete: 'restrict' }).notNull(),
  description: varchar('description', { length: 255 }),
  quantity: numeric('quantity', { precision: 18, scale: 4 }).notNull(),
  unitPrice: numeric('unit_price', { precision: 18, scale: 4 }).notNull(),
  discountPercent: numeric('discount_percent', { precision: 5, scale: 2 }).default('0'),
  lineTotal: numeric('line_total', { precision: 18, scale: 4 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// عروض الأسعار
export const salesQuotations = pgTable('sales_quotations', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').notNull(),
  quotationNumber: varchar('quotation_number', { length: 50 }).notNull(),
  customerId: uuid('customer_id').notNull(),
  date: date('date').notNull(),
  validUntil: date('valid_until'),
  total: numeric('total', { precision: 18, scale: 4 }).default('0').notNull(),
  status: varchar('status', { length: 20 }).default('pending').notNull(), // pending, accepted, rejected, converted
  convertedToInvoiceId: uuid('converted_to_invoice_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// المدفوعات
export const salesPayments = pgTable('sales_payments', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').notNull(),
  invoiceId: uuid('invoice_id').references(() => salesInvoices.id, { onDelete: 'restrict' }),
  customerId: uuid('customer_id').notNull(),
  date: date('date').notNull(),
  amount: numeric('amount', { precision: 18, scale: 4 }).notNull(),
  method: varchar('method', { length: 50 }).notNull(), // cash, bank, check
  reference: varchar('reference', { length: 100 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});
```

---

## 5. المكونات (Components)

### 5.1 نموذج الفاتورة

```tsx
// InvoiceForm.tsx
export const InvoiceForm = ({ invoice, onSubmit }: InvoiceFormProps) => {
  const { customers } = useCustomers();
  const { products } = useProducts();
  const { vatSettings } = useVatSettings();
  const [lines, setLines] = useState<InvoiceLine[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);

  const calculations = useMemo(() => {
    const subtotal = lines.reduce((sum, l) => sum + Number(l.lineTotal), 0);
    const vatAmount = vatSettings.isEnabled 
      ? subtotal * (Number(vatSettings.rate) / 100) 
      : 0;
    const total = subtotal + vatAmount;
    return { subtotal, vatAmount, total };
  }, [lines, vatSettings]);

  return (
    <form className="space-y-6">
      <div className="grid grid-cols-4 gap-4">
        <Input label="رقم الفاتورة" value={invoice?.invoiceNumber} readOnly />
        <DatePicker label="التاريخ" required />
        <DatePicker label="تاريخ الاستحقاق" />
        <Select label="العميل" options={customers} required />
      </div>
      
      <div className="card">
        <h3>بنود الفاتورة</h3>
        <table>
          <thead>
            <tr>
              <th>المنتج</th>
              <th>الوصف</th>
              <th>الكمية</th>
              <th>السعر</th>
              <th>الخصم %</th>
              <th>الإجمالي</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, idx) => (
              <tr key={idx}>
                <td><ProductSelect value={line.productId} onChange={...} /></td>
                <td><Input value={line.description} onChange={...} /></td>
                <td><Input type="number" value={line.quantity} onChange={...} /></td>
                <td><Input type="number" value={line.unitPrice} onChange={...} /></td>
                <td><Input type="number" value={line.discountPercent} onChange={...} /></td>
                <td className="font-bold">{formatCurrency(line.lineTotal)}</td>
                <td><Button onClick={() => removeLine(idx)}>×</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <Button onClick={addLine}>إضافة بند</Button>
      </div>
      
      <div className="grid grid-cols-2 gap-6">
        <div className="card">
          <TextArea label="ملاحظات" />
        </div>
        <div className="card space-y-2">
          <div className="flex justify-between">
            <span>المبلغ قبل الضريبة:</span>
            <span>{formatCurrency(calculations.subtotal)}</span>
          </div>
          {vatSettings.isEnabled && (
            <div className="flex justify-between">
              <span>الضريبة ({vatSettings.rate}%):</span>
              <span>{formatCurrency(calculations.vatAmount)}</span>
            </div>
          )}
          <div className="flex justify-between text-xl font-bold border-t pt-2">
            <span>الإجمالي:</span>
            <span>{formatCurrency(calculations.total)}</span>
          </div>
        </div>
      </div>
      
      <div className="flex gap-4">
        <Button type="submit">حفظ كمسودة</Button>
        <Button type="button">ترحيل</Button>
        <Button type="button" variant="outline">طباعة</Button>
        <Button type="button" variant="ghost">إلغاء</Button>
      </div>
    </form>
  );
};
```

---

## 6. التقارير

### 6.1 أعلى العملاء مبيعاً

```tsx
// reports/TopCustomersReport.tsx
export const TopCustomersReport = () => {
  const { data, isLoading } = useTopCustomers();
  const [limit, setLimit] = useState(10);

  return (
    <div className="space-y-6">
      <div className="flex justify-between">
        <h1>أعلى العملاء مبيعاً</h1>
        <ExportButton data={data} formats={['pdf', 'xlsx']} />
      </div>
      
      <div className="flex gap-4">
        <Select label="الحد" value={limit} onChange={setLimit} options={[
          { value: '5', label: 'أعلى 5' },
          { value: '10', label: 'أعلى 10' },
          { value: '20', label: 'أعلى 20' },
        ]} />
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h3 className="font-semibold mb-4">الترتيب</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={data} layout="vertical">
              <XAxis type="number" />
              <YAxis dataKey="name" type="category" width={100} />
              <Tooltip />
              <Bar dataKey="total" fill="#2563eb" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        
        <div className="card">
          <h3 className="font-semibold mb-4">التفاصيل</h3>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>العميل</th>
                <th>عدد الفواتير</th>
                <th>إجمالي المبيعات</th>
              </tr>
            </thead>
            <tbody>
              {data?.map((item, idx) => (
                <tr key={item.id}>
                  <td>{idx + 1}</td>
                  <td>{item.name}</td>
                  <td>{item.invoiceCount}</td>
                  <td className="font-bold">{formatCurrency(item.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
```

### 6.2 عمر الديون (A/R Aging)

```tsx
// reports/ArAgingReport.tsx
export const ArAgingReport = () => {
  const { data, isLoading } = useArAging();

  return (
    <div className="space-y-6">
      <div className="flex justify-between">
        <h1>عمر الديون (A/R Aging)</h1>
        <ExportButton data={data} formats={['pdf', 'xlsx']} />
      </div>
      
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>العميل</th>
              <th>الرصيد</th>
              <th>حالي</th>
              <th>1-30 يوم</th>
              <th>31-60 يوم</th>
              <th>61-90 يوم</th>
              <th>+90 يوم</th>
            </tr>
          </thead>
          <tbody>
            {data?.map(item => (
              <tr key={item.customerId}>
                <td>{item.customerName}</td>
                <td className="font-bold">{formatCurrency(item.total)}</td>
                <td>{formatCurrency(item.current)}</td>
                <td>{formatCurrency(item.days1to30)}</td>
                <td>{formatCurrency(item.days31to60)}</td>
                <td>{formatCurrency(item.days61to90)}</td>
                <td className="text-rose-500">{formatCurrency(item.over90)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-bold">
              <th>الإجمالي</th>
              <th>{formatCurrency(data?.totalBalance)}</th>
              <th>{formatCurrency(data?.totalCurrent)}</th>
              <th>{formatCurrency(data?.total1to30)}</th>
              <th>{formatCurrency(data?.total31to60)}</th>
              <th>{formatCurrency(data?.total61to90)}</th>
              <th>{formatCurrency(data?.totalOver90)}</th>
            </tr>
          </tfoot>
        </table>
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
| 1 | Schema (customers, invoices, lines) | 4 ساعات | عالية |
| 2 | دليل العملاء | 4 ساعات | عالية |
| 3 | نموذج الفاتورة | 8 ساعات | عالية |
| 4 | حساب الضريبة (VAT) | 4 ساعات | عالية |

### الأسبوع الثاني

| # | المهمة | المدة | الأولوية |
|---|--------|-------|---------|
| 5 | API للفواتير | 6 ساعات | عالية |
| 6 | ربط الفاتورة بالقيود المحاسبية | 4 ساعات | عالية |
| 7 | تحديث المخزون عند البيع | 4 ساعات | عالية |
| 8 | عروض الأسعار | 4 ساعات | متوسطة |
| 9 | مرتجعات المبيعات | 4 ساعات | متوسطة |

### الأسبوع الثالث

| # | المهمة | المدة | الأولوية |
|---|--------|-------|---------|
| 10 | تقرير فواتير المبيعات | 4 ساعات | عالية |
| 11 | تقرير كشف حساب العميل | 4 ساعات | عالية |
| 12 | تقرير أعلى العملاء | 3 ساعات | متوسطة |
| 13 | تقرير عمر الديون | 4 ساعات | عالية |
| 14 | تقرير الضريبة (VAT) | 3 ساعات | عالية |
| 15 | اختبارات الوحدات | 4 ساعات | متوسطة |

---

## 8. معايير القبول

- [ ] إنشاء فاتورة مبيعات تعمل.
- [ ] حساب الضريبة تلقائياً.
- [ ] تحديث رصيد العميل.
- [ ] تحديث المخزون عند الترحيل.
- [ ] إنشاء قيد يومي تلقائي.
- [ ] طباعة الفاتورة (PDF).
- [ ] عروض الأسعار تعمل.
- [ ] تحويل عرض السعر إلى فاتورة.
- [ ] مرتجعات المبيعات تعمل.
- [ ] التقارير تعرض بيانات صحيحة.
- [ ] اختبارات الوحدات تمر.

---

## 9. المخرجات النهائية

1. **نظام فواتير مبيعات** كامل مع VAT.
2. **عروض أسعار** وتحويلها.
3. **مرتجعات مبيعات**.
4. **حسابات العملاء** (A/R).
5. **7 تقارير** متقدمة.
6. **API كامل** للمبيعات.
7. **اختبارات** شاملة.

---

*تاريخ الإنشاء: 2026-05-24 | المسؤول: Sales Module Lead*
