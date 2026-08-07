# خطة الوحدة: الحسابات (Accounting)

> **الهدف:** بناء نظام محاسبي مالي متكامل مع شجرة حسابات جاهزة وقيود يومية مزدوجة وتقارير مالية متقدمة.

---

## 1. نظرة عامة

| البند | التفاصيل |
|-------|---------|
| **الاسم** | Accounting / GL |
| **المجلد** | `src/modules/accounting/` |
| **التبعيات** | Core, Auth, Settings |
| **المدة** | 3 أسابيع (المرحلة 2) |
| **الأولوية** | عالية جداً |

---

## 2. المتطلبات الوظيفية

### 2.1 شجرة الحسابات (Chart of Accounts)
- شجرة حسابات جاهزة متوافقة مع IFRS.
- 5 أنواع رئيسية: الأصول، الالتزامات، حقوق الملكية، الإيرادات، المصروفات.
- إضافة/تعديل/حذف حساب.
- ترميز الحسابات (1-01-001).
- حسابات رئيسية (مجموعات) وفرعية.

### 2.2 القيود اليومية (Journal Entries)
- قيود مزدوجة (Double-Entry) مع validation تلقائي.
- دعم متعدد العملات.
- توزيع المبالغ تلقائياً.
- ربط بالفواتير والمستندات.
- مراجعة واعتماد القيود.

### 2.3 أنواع القيود
- قيد يومي عادي.
- قيد فاتورة مبيعات.
- قيد فاتورة مشتريات.
- قيد صرف/استلام نقدي.
- قيد تسوية.
- قيد إغلاق سنوي.

### 2.4 التقارير المالية
- ميزان المراجعة (Trial Balance).
- الميزانية العمومية (Balance Sheet).
- قائمة الدخل (Profit & Loss).
- قائمة التدفقات النقدية (Cash Flow).
- دفتر أستاذ الحسابات (Account Ledger).
- بطاقة الحساب (Account Statement).

---

## 3. هيكل الملفات

```
src/modules/accounting/
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
│   ├── AccountingPage.tsx
│   ├── AccountsTree.tsx
│   ├── AccountForm.tsx
│   ├── JournalEntryPage.tsx
│   ├── JournalEntryForm.tsx
│   ├── JournalEntryList.tsx
│   └── index.ts
│
├── hooks/
│   ├── useAccounts.ts
│   ├── useJournalEntries.ts
│   ├── useTrialBalance.ts
│   └── index.ts
│
├── reports/
│   ├── TrialBalanceReport.tsx
│   ├── BalanceSheetReport.tsx
│   ├── ProfitLossReport.tsx
│   ├── CashFlowReport.tsx
│   ├── AccountLedgerReport.tsx
│   ├── charts/
│   │   ├── RevenueChart.tsx
│   │   ├── ExpenseChart.tsx
│   │   └── index.ts
│   └── index.ts
│
├── utils/
│   ├── accountHelpers.ts
│   ├── journalValidation.ts
│   └── reportCalculations.ts
│
└── data/
    └── defaultChartOfAccounts.ts
```

---

## 4. قاعدة البيانات (Schema)

```ts
// core/database/schema/accounting.ts

// شجرة الحسابات
export const accounts = pgTable('accounts', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').references(() => companies.id, { onDelete: 'cascade' }).notNull(),
  code: varchar('code', { length: 20 }).notNull(),
  nameAr: varchar('name_ar', { length: 255 }).notNull(),
  nameEn: varchar('name_en', { length: 255 }),
  parentId: uuid('parent_id'),
  type: varchar('type', { length: 20 }).notNull(), // asset, liability, equity, revenue, expense
  nature: varchar('nature', { length: 10 }).notNull(), // debit, credit
  isGroup: boolean('is_group').default(false).notNull(),
  isSystem: boolean('is_system').default(false).notNull(),
  balance: numeric('balance', { precision: 18, scale: 4 }).default('0').notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// القيود اليومية (الرأس)
export const journalEntries = pgTable('journal_entries', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').references(() => companies.id, { onDelete: 'cascade' }).notNull(),
  entryNumber: varchar('entry_number', { length: 50 }).notNull(),
  date: date('date').notNull(),
  reference: varchar('reference', { length: 100 }),
  description: text('description'),
  type: varchar('type', { length: 50 }).default('general').notNull(),
  status: varchar('status', { length: 20 }).default('draft').notNull(), // draft, posted, cancelled
  totalDebit: numeric('total_debit', { precision: 18, scale: 4 }).default('0').notNull(),
  totalCredit: numeric('total_credit', { precision: 18, scale: 4 }).default('0').notNull(),
  createdBy: uuid('created_by').references(() => users.id),
  postedBy: uuid('posted_by').references(() => users.id),
  postedAt: timestamp('posted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// بنود القيد
export const journalEntryLines = pgTable('journal_entry_lines', {
  id: uuid('id').defaultRandom().primaryKey(),
  entryId: uuid('entry_id').references(() => journalEntries.id, { onDelete: 'cascade' }).notNull(),
  accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'restrict' }).notNull(),
  debit: numeric('debit', { precision: 18, scale: 4 }).default('0').notNull(),
  credit: numeric('credit', { precision: 18, scale: 4 }).default('0').notNull(),
  memo: text('memo'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// الفترات المالية
export const fiscalPeriods = pgTable('fiscal_periods', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').references(() => companies.id, { onDelete: 'cascade' }).notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  status: varchar('status', { length: 20 }).default('open').notNull(), // open, closed
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});
```

---

## 5. شجرة الحسابات الافتراضية (IFRS-Compliant)

```
1 - الأصول (Assets)
├── 1-01 الأصول المتداولة
│   ├── 1-01-001 الصندوق
│   ├── 1-01-002 البنك
│   ├── 1-01-003 العملاء
│   ├── 1-01-004 المخزون
│   └── 1-01-005 الموردون - دفعات مقدمة
├── 1-02 الأصول الثابتة
│   ├── 1-02-001 الأراضي
│   ├── 1-02-002 المباني
│   ├── 1-02-003 الآلات والمعدات
│   └── 1-02-004 السيارات
└── 1-03 الأصول الأخرى

2 - الالتزامات (Liabilities)
├── 2-01 الالتزامات المتداولة
│   ├── 2-01-001 الموردون
│   ├── 2-01-002 الرواتب المستحقة
│   └── 2-01-003 الضرائب المستحقة
└── 2-02 الالتزامات طويلة الأجل

3 - حقوق الملكية (Equity)
├── 3-01 رأس المال
├── 3-02 الاحتياطي
├── 3-03 الأرباح المحتجزة
└── 3-04 الأرباح/الخسائر المدورة

4 - الإيرادات (Revenue)
├── 4-01 إيرادات المبيعات
├── 4-02 إيرادات أخرى
└── 4-03 خصم المبيعات

5 - المصروفات (Expenses)
├── 5-01 تكلفة البضاعة المباعة
├── 5-02 مصروفات التشغيل
│   ├── 5-02-001 الرواتب
│   ├── 5-02-002 الإيجار
│   ├── 5-02-003 الكهرباء
│   └── 5-02-004 مصروفات أخرى
└── 5-03 مصروفات إدارية
```

---

## 6. المكونات (Components)

### 6.1 شجرة الحسابات

```tsx
// AccountsTree.tsx
export const AccountsTree = () => {
  const { accounts, isLoading } = useAccounts();
  const [expandedNodes, setExpandedNodes] = useState<string[]>([]);

  const toggleNode = (id: string) => {
    setExpandedNodes(prev => 
      prev.includes(id) ? prev.filter(n => n !== id) : [...prev, id]
    );
  };

  const renderNode = (account: Account, level: number = 0) => {
    const children = accounts.filter(a => a.parentId === account.id);
    const isExpanded = expandedNodes.includes(account.id);

    return (
      <div key={account.id} style={{ paddingInlineStart: `${level * 24}px` }}>
        <div className="flex items-center gap-2 py-2 hover:bg-slate-50 cursor-pointer">
          {account.isGroup && (
            <button onClick={() => toggleNode(account.id)}>
              {isExpanded ? <ChevronDown /> : <ChevronLeft />}
            </button>
          )}
          <span className="font-mono text-sm">{account.code}</span>
          <span>{account.nameAr}</span>
          <span className="mr-auto font-mono">{formatCurrency(account.balance)}</span>
        </div>
        {isExpanded && children.map(child => renderNode(child, level + 1))}
      </div>
    );
  };

  return (
    <div className="card">
      <div className="flex justify-between mb-4">
        <h2>شجرة الحسابات</h2>
        <Button>إضافة حساب</Button>
      </div>
      {accounts.filter(a => !a.parentId).map(root => renderNode(root))}
    </div>
  );
};
```

### 6.2 نموذج القيد اليومي

```tsx
// JournalEntryForm.tsx
export const JournalEntryForm = () => {
  const [lines, setLines] = useState<JournalLine[]>([
    { accountId: '', debit: 0, credit: 0, memo: '' },
    { accountId: '', debit: 0, credit: 0, memo: '' },
  ]);

  const totalDebit = lines.reduce((sum, l) => sum + Number(l.debit), 0);
  const totalCredit = lines.reduce((sum, l) => sum + Number(l.credit), 0);
  const isBalanced = totalDebit === totalCredit;

  return (
    <form className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <Input label="رقم القيد" />
        <DatePicker label="التاريخ" />
      </div>
      
      <TextArea label="الوصف" />
      
      <div className="card">
        <h3>بنود القيد</h3>
        <table>
          <thead>
            <tr>
              <th>الحساب</th>
              <th>مدين</th>
              <th>دائن</th>
              <th>ملاحظة</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, idx) => (
              <tr key={idx}>
                <td><AccountSelect value={line.accountId} onChange={...} /></td>
                <td><Input type="number" value={line.debit} onChange={...} /></td>
                <td><Input type="number" value={line.credit} onChange={...} /></td>
                <td><Input value={line.memo} onChange={...} /></td>
                <td><Button onClick={() => removeLine(idx)}>×</Button></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th>الإجمالي</th>
              <th className={isBalanced ? 'text-emerald-500' : 'text-rose-500'}>
                {formatCurrency(totalDebit)}
              </th>
              <th className={isBalanced ? 'text-emerald-500' : 'text-rose-500'}>
                {formatCurrency(totalCredit)}
              </th>
              <th></th>
              <th></th>
            </tr>
          </tfoot>
        </table>
        
        {!isBalanced && (
          <p className="text-rose-500">المبالغ غير متوازنة</p>
        )}
      </div>
      
      <div className="flex gap-4">
        <Button type="submit" disabled={!isBalanced}>حفظ كمسودة</Button>
        <Button type="button" disabled={!isBalanced}>ترحيل</Button>
        <Button type="button" variant="ghost">إلغاء</Button>
      </div>
    </form>
  );
};
```

---

## 7. التقارير

### 7.1 ميزان المراجعة

```tsx
// reports/TrialBalanceReport.tsx
export const TrialBalanceReport = () => {
  const { data, isLoading } = useTrialBalance();
  const [filters, setFilters] = useState({ dateRange: null });

  return (
    <div className="space-y-6">
      <div className="flex justify-between">
        <h1>ميزان المراجعة</h1>
        <ExportButton data={data} formats={['pdf', 'xlsx']} />
      </div>
      
      <ReportFilter filters={filters} onChange={setFilters} />
      
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>رقم الحساب</th>
              <th>اسم الحساب</th>
              <th>رصيد أولي</th>
              <th>حركة مدين</th>
              <th>حركة دائن</th>
              <th>رصيد نهائي</th>
            </tr>
          </thead>
          <tbody>
            {data?.map(row => (
              <tr key={row.accountId}>
                <td>{row.code}</td>
                <td>{row.name}</td>
                <td className="text-right">{formatCurrency(row.openingBalance)}</td>
                <td className="text-right">{formatCurrency(row.debit)}</td>
                <td className="text-right">{formatCurrency(row.credit)}</td>
                <td className="text-right font-bold">{formatCurrency(row.closingBalance)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-bold">
              <th colSpan={2}>الإجمالي</th>
              <th>{formatCurrency(data?.totalOpening)}</th>
              <th>{formatCurrency(data?.totalDebit)}</th>
              <th>{formatCurrency(data?.totalCredit)}</th>
              <th>{formatCurrency(data?.totalClosing)}</th>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
};
```

### 7.2 قائمة الدخل

```tsx
// reports/ProfitLossReport.tsx
export const ProfitLossReport = () => {
  const { data, isLoading } = useProfitLoss();

  return (
    <div className="space-y-6">
      <div className="flex justify-between">
        <h1>قائمة الدخل</h1>
        <ExportButton data={data} formats={['pdf', 'xlsx']} />
      </div>
      
      <div className="grid grid-cols-2 gap-6">
        <div className="card">
          <h3 className="text-lg font-semibold mb-4">الإيرادات</h3>
          {data?.revenues.map(item => (
            <div key={item.id} className="flex justify-between py-2">
              <span>{item.name}</span>
              <span className="text-emerald-500">{formatCurrency(item.amount)}</span>
            </div>
          ))}
          <div className="flex justify-between py-2 border-t font-bold">
            <span>إجمالي الإيرادات</span>
            <span className="text-emerald-500">{formatCurrency(data?.totalRevenue)}</span>
          </div>
        </div>
        
        <div className="card">
          <h3 className="text-lg font-semibold mb-4">المصروفات</h3>
          {data?.expenses.map(item => (
            <div key={item.id} className="flex justify-between py-2">
              <span>{item.name}</span>
              <span className="text-rose-500">{formatCurrency(item.amount)}</span>
            </div>
          ))}
          <div className="flex justify-between py-2 border-t font-bold">
            <span>إجمالي المصروفات</span>
            <span className="text-rose-500">{formatCurrency(data?.totalExpense)}</span>
          </div>
        </div>
      </div>
      
      <div className="card">
        <div className="flex justify-between py-4 text-xl font-bold">
          <span>صافي الربح/الخسارة</span>
          <span className={data?.netProfit >= 0 ? 'text-emerald-500' : 'text-rose-500'}>
            {formatCurrency(data?.netProfit)}
          </span>
        </div>
      </div>
    </div>
  );
};
```

---

## 8. تقسيم المهام

### الأسبوع الأول

| # | المهمة | المدة | الأولوية |
|---|--------|-------|---------|
| 1 | Schema (accounts, journalEntries, lines) | 4 ساعات | عالية |
| 2 | شجرة الحسابات الافتراضية | 4 ساعات | عالية |
| 3 | مكون شجرة الحسابات | 6 ساعات | عالية |
| 4 | نموذج إضافة/تعديل حساب | 4 ساعات | عالية |
| 5 | API للحسابات | 4 ساعات | عالية |

### الأسبوع الثاني

| # | المهمة | المدة | الأولوية |
|---|--------|-------|---------|
| 6 | نموذج القيد اليومي | 8 ساعات | عالية |
| 7 | التحقق من توازن القيد | 2 ساعة | عالية |
| 8 | API للقيود اليومية | 6 ساعات | عالية |
| 9 | قائمة القيود اليومية | 4 ساعات | عالية |
| 10 | ترحيل/إلغاء القيد | 4 ساعات | عالية |

### الأسبوع الثالث

| # | المهمة | المدة | الأولوية |
|---|--------|-------|---------|
| 11 | تقرير ميزان المراجعة | 6 ساعات | عالية |
| 12 | تقرير الميزانية العمومية | 6 ساعات | عالية |
| 13 | تقرير قائمة الدخل | 6 ساعات | عالية |
| 14 | تقرير دفتر الأستاذ | 4 ساعات | متوسطة |
| 15 | اختبارات الوحدات | 6 ساعات | متوسطة |

---

## 9. معايير القبول

- [ ] شجرة الحسابات تعرض بشكل صحيح.
- [ ] إضافة حساب جديد يعمل.
- [ ] تعديل حساب يعمل.
- [ ] حذف حساب (بدون قيود) يعمل.
- [ ] إنشاء قيد يومي يعمل.
- [ ] التحقق من توازن المدين/الدائن.
- [ ] ترحيل القيد يعمل.
- [ ] إلغاء القيد المرحل يعمل.
- [ ] ميزان المراجعة يعرض بيانات صحيحة.
- [ ] الميزانية العمومية تعمل.
- [ ] قائمة الدخل تعمل.
- [ ] اختبارات الوحدات تمر.

---

## 10. المخرجات النهائية

1. **شجرة حسابات** جاهزة (IFRS-compliant).
2. **نظام قيود يومية** مزدوجة.
3. **تقارير مالية** (5 تقارير).
4. **API كامل** للحسابات.
5. **اختبارات** شاملة.

---

*تاريخ الإنشاء: 2026-05-24 | المسؤول: Accounting Module Lead*
