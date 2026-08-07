# دليل أسلوب الكود والتنسيق — maghzaccount-pro

> **الغرض:** يحدد هذا الملف القواعد اللغوية والتنسيقية والتسمية التي يجب اتباعها عند كتابة أي كود TypeScript، CSS، أو SQL ضمن هذا المشروع. يهدف إلى ضمان اتساق الشفرة المصدرية وسهولة القراءة والصيانة.

---

## 1. عام

- **اللغة:** كل التعليقات والوثائق داخل الكود باللغة **الإنجليزية**. الملفات التوثيقية الخارجية (مثل `.md`) بالعربية.
- **الترميز:** UTF-8 دائماً.
- **نهاية السطر:** LF (Line Feed). اضبط Git على `core.autocrlf=false`.
- **المسافة البادئة:** 2 مسافات (Spaces). لا تستخدم Tabs.
- **المنسق:** Prettier (اختياري) أو Tailwind Prettier Plugin.

---

## 2. هيكل الوحدات (Module Structure)

### 2.1 تسمية الوحدات

| الوحدة | اسم المجلد | prefix |
|--------|-----------|--------|
| الأساس | `core/` | — |
| تسجيل الدخول | `auth/` | `auth` |
| الإعدادات | `settings/` | `settings` |
| الحسابات | `accounting/` | `acc` |
| المخازن | `inventory/` | `inv` |
| المبيعات | `sales/` | `sales` |
| المشتريات | `purchases/` | `purch` |
| التصنيع | `manufacturing/` | `mfg` |
| الموظفين | `hr/` | `hr` |
| علاقات العملاء | `crm/` | `crm` |
| التقارير | `reports/` | `rpt` |

### 2.2 هيكل كل وحدة

```
modules/[name]/
├── index.ts                    ← Public API (export * from './...')
├── types.ts                    ← أنواع TypeScript
├── api/
│   ├── index.ts                ← API facade
│   ├── queries.ts              ← قراءة البيانات
│   ├── mutations.ts            ← كتابة البيانات
│   └── types.ts                ← DTOs
├── components/
│   ├── [Feature]Page.tsx       ← الصفحة الرئيسية
│   ├── [Feature]Form.tsx       ← النموذج
│   ├── [Feature]List.tsx       ← القائمة
│   └── [Feature]Detail.tsx     ← التفاصيل
├── hooks/
│   ├── use[Feature].ts         ← جلب البيانات
│   └── use[Feature]Mutations.ts ← تعديل البيانات
├── store.ts                    ← Zustand slice (اختياري)
├── reports/                    ← تقارير الوحدة
│   ├── [Report]Page.tsx
│   ├── [Report]Chart.tsx
│   └── index.ts
└── i18n/                       ← ترجمة الوحدة (اختياري)
    ├── ar.json
    └── en.json
```

### 2.3 Export Pattern

```ts
// modules/sales/index.ts
export * from './components';
export * from './hooks';
export * from './api';
export * from './types';
export * from './reports';
```

```ts
// modules/sales/components/index.ts
export { SalesInvoicePage } from './SalesInvoicePage';
export { SalesInvoiceForm } from './SalesInvoiceForm';
export { SalesInvoiceList } from './SalesInvoiceList';
```

---

## 3. TypeScript & React

### 3.1 تنسيق الملفات

- **الامتداد:** `.ts` للمنطق، `.tsx` للمكونات.
- **الترتيب داخل الملف:**
  1. Imports (React → Libraries → Internal → Types)
  2. Types / Interfaces
  3. Constants
  4. Helper functions
  5. Main Component / Logic
  6. Exports

### 3.2 التسمية (Naming Conventions)

| النوع | النمط | مثال |
|-------|-------|------|
| **Modules (folders)** | kebab-case | `sales/`, `accounting/`, `hr/` |
| **Components (React)** | PascalCase | `SalesInvoicePage.tsx`, `KpiCard.tsx` |
| **Pages** | PascalCase + `Page` | `SalesInvoicePage.tsx`, `DashboardPage.tsx` |
| **Forms** | PascalCase + `Form` | `SalesInvoiceForm.tsx`, `JournalEntryForm.tsx` |
| **Lists** | PascalCase + `List` | `ProductsList.tsx`, `AccountsList.tsx` |
| **Charts** | PascalCase + `Chart` | `RevenueChart.tsx`, `ArAgingChart.tsx` |
| **Reports** | PascalCase + `Report` | `SalesAnalysisReport.tsx` |
| **Hooks** | camelCase + `use` | `useSalesInvoices.ts`, `useDashboardData.ts` |
| **Mutations** | camelCase + `Mutations` | `useSalesMutations.ts` |
| **Stores (Zustand)** | camelCase + `Store` | `salesStore.ts`, `appStore.ts` |
| **Interfaces / Types** | PascalCase | `Invoice`, `InvoiceLine`, `DashboardKpi` |
| **DTOs** | PascalCase + `Dto` | `CreateInvoiceDto`, `UpdateProductDto` |
| **Enums** | PascalCase | `InvoiceStatus`, `AccountType` |
| **Functions** | camelCase | `calculateTotal()`, `formatCurrency()` |
| **Variables** | camelCase | `activeCompany`, `isLoading` |
| **Constants (global)** | UPPER_SNAKE_CASE | `MAX_RETRY_COUNT`, `DEFAULT_CURRENCY` |
| **Boolean variables** | prefix `is`, `has`, `should` | `isElectron`, `hasError`, `shouldSync` |
| **Database Tables** | snake_case (plural) | `sales_invoices`, `journal_entries` |
| **Database Columns** | snake_case | `company_id`, `created_at` |

### 3.3 أنماط React

**المكونات:** دائماً Functional Components + Arrow Functions.

```tsx
// ✅ جيد
import { useState } from 'react';
import type { ReactNode } from 'react';

interface CardProps {
  title: string;
  children: ReactNode;
  onAction?: () => void;
}

export const Card = ({ title, children, onAction }: CardProps) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-700">
      <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
        {title}
      </h3>
      <div className="mt-4">{children}</div>
      {onAction && (
        <button 
          onClick={onAction}
          className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg"
        >
          Action
        </button>
      )}
    </div>
  );
};
```

**الـ Props:**
- استخدم destructuring دائماً.
- حدد default values عند الحاجة.

```tsx
// ✅ جيد
export const KpiCard = ({ 
  title, 
  value, 
  change, 
  trend = 'up',
  icon: Icon,
}: KpiCardProps) => {
  // ...
};
```

### 3.4 TypeScript Best Practices

```ts
// ✅ استخدم unknown بدل any
function parseJson(input: string): unknown {
  return JSON.parse(input);
}

// ✅ استخدم satisfies للتحقق
const chartColors = {
  primary: '#2563eb',
  secondary: '#64748b',
} satisfies Record<string, string>;

// ✅ استخدم const assertions للثوابت
const INVOICE_STATUS = {
  DRAFT: 'draft',
  POSTED: 'posted',
  CANCELLED: 'cancelled',
} as const;

type InvoiceStatus = typeof INVOICE_STATUS[keyof typeof INVOICE_STATUS];

// ✅ استخدم Optional Chaining
const companyName = company?.name ?? 'Unknown';

// ✅ استخدم Pick / Omit / Partial
type CreateInvoiceDto = Omit<Invoice, 'id' | 'createdAt'>;
type UpdateInvoiceDto = Partial<CreateInvoiceDto>;
```

---

## 4. Tailwind CSS

### 4.1 قواعد الاستخدام

- **استخدم Tailwind classes مباشرة** في JSX.
- **لا تستخدم CSS مخصص** إلا عند الضرورة.
- **استخدم `@apply`** فقط في ملفات CSS مشتركة.

### 4.2 ترتيب Classes

```tsx
// الترتيب المقترح:
// 1. Layout (display, position, flex, grid)
// 2. Box Model (w, h, p, m, border)
// 3. Typography (font, text, color)
// 4. Visual (bg, opacity, shadow)
// 5. Interactivity (cursor, transition)
// 6. States (hover:, focus:, dark:)

<div className="flex items-center gap-4 p-4 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 transition-colors dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700">
  {/* المحتوى */}
</div>
```

### 4.3 Dark Mode

```tsx
// استخدم dark: prefix لكل لون
<div className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100">
  {/* المحتوى */}
</div>
```

### 4.4 RTL Support

```tsx
// استخدم logical properties أو rtl: prefix
<div className="ms-4 rtl:ms-0 rtl:me-4">
  {/* المحتوى */}
</div>
```

### 4.5 Custom Classes (مكونات مشتركة)

```css
/* src/styles/components.css */
@tailwind components;

@layer components {
  .btn-primary {
    @apply px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors;
  }
  
  .btn-secondary {
    @apply px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium transition-colors dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700;
  }
  
  .card {
    @apply bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-6 shadow-sm;
  }
  
  .input {
    @apply h-10 px-3 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all;
  }
}
```

---

## 5. قاعدة البيانات (Database)

### 5.1 Schema Design (Drizzle ORM)

```ts
// core/database/schema/sales.ts
import { pgTable, uuid, varchar, numeric, timestamp, boolean, date, text } from 'drizzle-orm/pg-core';
import { companies } from './core';

export const salesInvoices = pgTable('sales_invoices', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id')
    .references(() => companies.id, { onDelete: 'cascade' })
    .notNull(),
  invoiceNumber: varchar('invoice_number', { length: 50 }).notNull(),
  customerId: uuid('customer_id').notNull(),
  date: date('date').notNull(),
  subtotal: numeric('subtotal', { precision: 18, scale: 4 }).default('0').notNull(),
  taxAmount: numeric('tax_amount', { precision: 18, scale: 4 }).default('0').notNull(),
  total: numeric('total', { precision: 18, scale: 4 }).default('0').notNull(),
  status: varchar('status', { length: 20 }).default('draft').notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const salesInvoiceLines = pgTable('sales_invoice_lines', {
  id: uuid('id').defaultRandom().primaryKey(),
  invoiceId: uuid('invoice_id')
    .references(() => salesInvoices.id, { onDelete: 'cascade' })
    .notNull(),
  productId: uuid('product_id').notNull(),
  quantity: numeric('quantity', { precision: 18, scale: 4 }).notNull(),
  unitPrice: numeric('unit_price', { precision: 18, scale: 4 }).notNull(),
  lineTotal: numeric('line_total', { precision: 18, scale: 4 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});
```

### 5.2 قواعد Schema

| القاعدة | التفاصيل |
|---------|---------|
| **المفتاح الأساسي** | `uuid('id').defaultRandom().primaryKey()` |
| **الطوابع الزمنية** | `createdAt`, `updatedAt` في كل جدول |
| **العزل** | `companyId` في كل جدول (multi-tenancy) |
| **الأرقام المالية** | `numeric(18, 4)` — 14 رقم صحيح + 4 كسور |
| **Booleans** | prefix بـ `is_` (`is_active`, `is_posted`) |
| **Foreign Keys** | `onDelete: 'cascade'` للتابعين، `'restrict'` للمراجع |
| **أسماء الجداول** | snake_case جمع (`sales_invoices`, `journal_entries`) |
| **أسماء الأعمدة** | snake_case (`company_id`, `invoice_number`) |

---

## 6. التقارير (Reports)

### 6.1 تسمية التقارير

| النوع | النمط | مثال |
|-------|-------|------|
| **صفحة تقرير** | PascalCase + `Report` | `SalesAnalysisReport.tsx` |
| **رسم بياني** | PascalCase + `Chart` | `RevenueChart.tsx`, `ArAgingChart.tsx` |
| **جدول تقرير** | PascalCase + `Table` | `TrialBalanceTable.tsx` |

### 6.2 هيكل التقرير

```tsx
// modules/sales/reports/SalesAnalysisReport.tsx
import { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { useSalesReportData } from '../hooks/useSalesReportData';
import { ReportFilter } from '@/core/reports/shared/ReportFilter';
import { ExportButton } from '@/core/reports/export/ExportButton';

export const SalesAnalysisReport = () => {
  const [filters, setFilters] = useState({ dateRange: null, customer: null });
  const { data, isLoading } = useSalesReportData(filters);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">تحليل المبيعات</h1>
        <ExportButton data={data} formats={['pdf', 'xlsx']} />
      </div>
      
      <ReportFilter filters={filters} onChange={setFilters} />
      
      {isLoading ? (
        <div className="animate-pulse">Loading...</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="card">
            <h3 className="text-lg font-semibold mb-4">المبيعات الشهرية</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={data.monthly}>
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="total" fill="#2563eb" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          
          <div className="card">
            <h3 className="text-lg font-semibold mb-4">أفضل المنتجات</h3>
            {/* جدول أو رسم بياني آخر */}
          </div>
        </div>
      )}
    </div>
  );
};
```

### 6.3 Recharts Conventions

```tsx
// استخدم ResponsiveContainer دائماً
<ResponsiveContainer width="100%" height={300}>
  <BarChart data={data}>
    {/* المحتوى */}
  </BarChart>
</ResponsiveContainer>

// استخدم الألوان من theme
const CHART_COLORS = {
  primary: '#2563eb',
  secondary: '#64748b',
  success: '#10b981',
  danger: '#ef4444',
};

// استخدم Tooltip مخصص للـ RTL
<Tooltip 
  contentStyle={{ 
    direction: 'rtl',
    fontFamily: 'Cairo, sans-serif',
  }} 
/>
```

---

## 7. الترجمة (i18n)

### 7.1 المفاتيح

- استخدم تدرجاً هرمياً: `module.feature.element`
- تجنب المفاتيح العميقة (>4 مستويات)

### 7.2 البنية

```json
{
  "sales": {
    "invoice": {
      "title": "فاتورة مبيعات",
      "number": "رقم الفاتورة",
      "date": "التاريخ",
      "customer": "العميل",
      "total": "الإجمالي",
      "actions": {
        "create": "إنشاء فاتورة",
        "edit": "تعديل",
        "delete": "حذف",
        "print": "طباعة"
      },
      "status": {
        "draft": "مسودة",
        "posted": "مرحلة",
        "cancelled": "ملغاة"
      }
    },
    "reports": {
      "analysis": "تحليل المبيعات",
      "aging": "عمر الديون"
    }
  },
  "common": {
    "save": "حفظ",
    "cancel": "إلغاء",
    "delete": "حذف",
    "search": "بحث...",
    "loading": "جاري التحميل...",
    "noData": "لا توجد بيانات"
  }
}
```

### 7.3 في الكود

```tsx
const { t } = useTranslation();

// ✅ جيد
<button>{t('sales.invoice.actions.create')}</button>

// ❌ سيئ
<button>إنشاء فاتورة</button>
```

---

## 8. Git & Commits

### 8.1 تنسيق الرسائل (Conventional Commits)

```
<type>(<scope>): <subject>

<body>

<footer>
```

### 8.2 الأنواع (Types)

| النوع | الاستخدام |
|-------|----------|
| `feat` | ميزة جديدة |
| `fix` | إصلاح خلل |
| `docs` | تغييرات توثيقية |
| `style` | تنسيق كود (بدون تغيير منطق) |
| `refactor` | إعادة بناء الكود |
| `perf` | تحسين الأداء |
| `test` | إضافة/تعديل اختبارات |
| `chore` | مهام الصيانة |
| `report` | إضافة/تعديل تقرير |

### 8.3 النطاقات (Scopes)

| النطاق | الوحدة |
|--------|--------|
| `core` | الأساس |
| `auth` | تسجيل الدخول |
| `settings` | الإعدادات |
| `accounting` | الحسابات |
| `inventory` | المخازن |
| `sales` | المبيعات |
| `purchases` | المشتريات |
| `manufacturing` | التصنيع |
| `hr` | الموظفين |
| `crm` | علاقات العملاء |
| `reports` | التقارير |
| `ui` | مكونات UI |
| `db` | قاعدة البيانات |

### 8.4 أمثلة

```
feat(sales): add sales invoice creation form

fix(accounting): correct journal entry balance validation

report(sales): add monthly revenue analysis chart

refactor(ui): extract KpiCard component

docs(architecture): update module structure diagram

test(inventory): add stock movement tests
```

### 8.5 Branches

| الفرع | الاستخدام |
|-------|----------|
| `main` | الإنتاج |
| `develop` | التطوير الرئيسي |
| `feature/<module>-<feature>` | ميزات جديدة |
| `fix/<module>-<issue>` | إصلاحات |
| `report/<module>-<name>` | تقارير جديدة |
| `release/vX.X.X` | إعداد الإصدار |

---

## 9. ESLint & Prettier

### 9.1 الإعدادات

```js
// eslint.config.js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      react,
      'react-hooks': reactHooks,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': 'off',
    },
  }
);
```

### 9.2 Prettier

```json
// .prettierrc
{
  "semi": true,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "es5",
  "printWidth": 100,
  "plugins": ["prettier-plugin-tailwindcss"]
}
```

---

## 10. التعليقات والتوثيق

### 10.1 تعليقات الكود

```ts
/**
 * Calculates the trial balance for a given company and date range.
 * @param companyId - The UUID of the company.
 * @param startDate - Start of the fiscal period (YYYY-MM-DD).
 * @param endDate - End of the fiscal period (YYYY-MM-DD).
 * @returns Array of account balances grouped by account type.
 */
export function calculateTrialBalance(
  companyId: string,
  startDate: string,
  endDate: string
): TrialBalanceRow[] {
  // Implementation
}
```

### 10.2 TODO Comments

```ts
// TODO(author): description — target version
// TODO(ahmed): Add multi-currency support — v1.1.0
// FIXME: Handle null companyId edge case
// HACK: Temporary workaround for Realm sync issue
```

---

## 11. الاختصارات (Shortcuts)

| الاختصار | المعنى |
|---------|--------|
| `KPI` | Key Performance Indicator |
| `GL` | General Ledger |
| `A/R` | Accounts Receivable |
| `A/P` | Accounts Payable |
| `BOM` | Bill of Materials |
| `VAT` | Value Added Tax |
| `PO` | Purchase Order |
| `DTO` | Data Transfer Object |

---

*آخر تحديث: 2026-05-24 | مسؤول الجودة: Lead Code Reviewer*
