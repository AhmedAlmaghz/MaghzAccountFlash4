# وثائق البنية التقنية — maghzaccount-pro

> **الغرض:** يصف هذا الملف البنية المعمارية العامة للنظام، طبقات البيانات، تدفق المعلومات، نماذج التصميم المعماري (Architectural Patterns)، واستراتيجيات التوسع والأمان. هو المرجع التقني الأساسي للمهندسين المعماريين والمطورين الرئيسيين.

---

## 1. المخطط المعماري العام (High-Level Architecture)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Presentation Layer                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────────────┐  │
│  │   React UI   │  │  Zustand     │  │   i18n Engine (ar/en/RTL)      │  │
│  │  (Renderer)  │  │   Store      │  │   + Cairo/Inter Fonts          │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────────────────────────────┘  │
│         │                 │                                                 │
├─────────┴─────────────────┴─────────────────────────────────────────────────┤
│                        Application Layer                                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │   Business   │  │   Database   │  │   Reports    │  │   Electron IPC │  │
│  │    Logic     │  │   Adapters   │  │   Engine     │  │   (Main ↔ Ren) │  │
│  │   (Hooks)    │  │   (PG/Mock)  │  │ (Recharts/   │  │                │  │
│  └──────────────┘  └──────┬───────┘  │  Tremor/PDF) │  └────────────────┘  │
│                           │           └──────────────┘                       │
├───────────────────────────┴─────────────────────────────────────────────────┤
│                         Data Layer                                          │
│  ┌─────────────────┐  ┌─────────────────┐                                  │
│  │   PostgreSQL    │  │   Mock/Dexie    │                                  │
│  │  (Production)   │  │   (Web Dev)     │                                  │
│  │   via Drizzle   │  │                 │                                  │
│  └─────────────────┘  └─────────────────┘                                  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. المعمارية المقسمة (Modular Architecture)

يتبنى maghzaccount-pro **Modular Monolith** — كل وحدة ERP مستقلة داخلياً لكنها جزء من تطبيق واحد:

```
src/
├── core/                           ← الطبقة الأساسية المشتركة
│   ├── ui/                         ← Design System (Tailwind + CSS Variables)
│   │   ├── components/             ← Button, Input, Modal, Card, Table...
│   │   ├── charts/                 ← Recharts wrappers (BarChart, LineChart...)
│   │   ├── tokens/                 ← Colors, Typography, Spacing
│   │   └── icons.ts                ← Lucide icons registry
│   ├── store/                      ← Zustand stores
│   │   ├── appStore.ts             ← الحالة المركزية
│   │   └── slices/                 ← uiSlice, authSlice, companySlice, dbSlice
│   ├── i18n/                       ← نظام الترجمة
│   │   ├── ar.json                 ← Arabic dictionary
│   │   ├── en.json                 ← English dictionary
│   │   └── useTranslation.ts       ← Hook
│   ├── database/                   ← طبقات البيانات الموحدة
│   │   ├── adapters/               ← Database adapter (PG only)
│   │   │   ├── index.ts            ← Adapter factory
│   │   │   ├── electronPgAdapter.ts ← PostgreSQL via Electron IPC
│   │   │   └── types.ts            ← DbAdapter interface
│   │   ├── schema/                 ← Drizzle schema (per module)
│   │   │   ├── core.ts             ← companies, users, settings
│   │   │   ├── accounting.ts       ← accounts, transactions, journalEntries
│   │   │   ├── inventory.ts        ← products, warehouses, stockMoves
│   │   │   ├── sales.ts            ← invoices, quotations, customers
│   │   │   ├── purchases.ts        ← purchaseInvoices, POs, vendors
│   │   │   ├── manufacturing.ts    ← BOMs, workOrders, production
│   │   │   ├── hr.ts               ← employees, attendance, payroll
│   │   │   ├── crm.ts              ← leads, opportunities, activities
│   │   │   └── index.ts            ← Export all schemas
│   │   ├── migrations/             ← Drizzle migrations
│   ├── reports/                    ← محرك التقارير المركزي
│   │   ├── engine/                 ← ReportBuilder, QueryBuilder
│   │   ├── export/                 ← PDF, Excel, CSV exporters
│   │   └── shared/                 ← Report types, utilities
│   └── utils/                      ← formatCurrency, formatDate, validators...
│
├── modules/                        ← وحدات ERP المنفصلة (11 وحدة)
│   ├── auth/                       ← 01. تسجيل دخول + المستخدمين
│   ├── settings/                   ← 02. إعدادات النظام
│   ├── accounting/                 ← 03. الحسابات (GL + Reports)
│   ├── inventory/                  ← 04. المخازن (Inventory + Reports)
│   ├── sales/                      ← 05. المبيعات (Sales + Reports)
│   ├── purchases/                  ← 06. المشتريات (Purchases + Reports)
│   ├── manufacturing/              ← 07. التصنيع (Mfg + Reports)
│   ├── hr/                         ← 08. الموظفين (HR + Reports)
│   ├── crm/                        ← 09. علاقات العملاء (CRM + Reports)
│   └── reports/                    ← 10. التقارير المركزية + Dashboard
│       ├── dashboards/             ← Main Dashboard, KPI widgets
│       ├── analytics/              ← Cross-module analytics
│       └── shared/                 ← Shared report components
│
├── app/                            ← تطبيق React Router
│   ├── layout.tsx                  ← App Shell (Sidebar + Header + Content)
│   ├── page.tsx                    ← Dashboard (default route)
│   └── [...module]/               ← Dynamic routing للوحدات
│
└── electron/                       ← Electron Main + Preload
    ├── main.ts
    └── preload.ts
```

### 2.1 هيكل كل وحدة (Module Anatomy)

كل وحدة تتبع الهيكل نفسه:

```
modules/[name]/
├── index.ts                        ← Public API (exports only)
├── types.ts                        ← أنواع TypeScript الخاصة
│
├── api/                            ← Database Adapters (per module)
│   ├── index.ts                    ← Module API facade
│   ├── queries.ts                  ← Read operations
│   ├── mutations.ts                ← Write operations
│   └── types.ts                    ← DTOs
│
├── components/                     ← React Components
│   ├── [Feature]Page.tsx           ← الصفحة الرئيسية
│   ├── [Feature]Form.tsx           ← النماذج
│   ├── [Feature]List.tsx           ← القوائم
│   └── [Feature]Detail.tsx         ← التفاصيل
│
├── hooks/                          ← Custom Hooks
│   ├── use[Feature].ts             ← Data fetching
│   └── use[Feature]Mutations.ts    ← Data mutations
│
├── store.ts                        ← Zustand slice (optional)
│
├── reports/                        ← تقارير الوحدة
│   ├── [Report]Page.tsx            ← صفحة تقرير
│   ├── [Report]Chart.tsx           ← رسم بياني
│   ├── [Report]Table.tsx           ← جدول بيانات
│   └── index.ts                    ← Export reports
│
└── i18n/                           ← ترجمة الوحدة (optional)
    ├── ar.json
    └── en.json
```

---

## 3. طبقات البيانات (Data Layer)

### 3.1 استراتيجية متعددة الطبقات (Multi-Layer Strategy)

```
عند بدء التشغيل:
│
├─ هل Electron متاح؟
│  ├─ نعم → هل PostgreSQL يستجيب؟
│  │         ├─ نعم → Mode: PostgreSQL (Layer 1)
│  │         └─ لا  → Mode: Mock (Layer 2)
│  └─ لا → Mode: Mock/Dexie (Layer 2)
```

| الطبقة | التقنية | البيئة | الغرض |
|--------|---------|--------|-------|
| **Layer 1** | PostgreSQL + Drizzle ORM | Electron + PG متاح | المصدر الوحيد للحقيقة (Source of Truth) |
| **Layer 2** | Dexie / Mock | Browser أو بدون PG | تطوير الويب + اختبار + fallback

### 3.2 Database Adapter Interface (موحد)

```ts
// src/core/database/adapters/index.ts

export interface DatabaseAdapter {
  // Core
  getCompany(): Promise<Company | null>;
  saveCompany(company: Company): Promise<void>;

  // Accounting
  getAccounts(): Promise<Account[]>;
  getAccountById(id: string): Promise<Account | null>;
  createTransaction(tx: Transaction): Promise<void>;
  getJournalEntries(txId: string): Promise<JournalEntry[]>;

  // Inventory
  getProducts(): Promise<Product[]>;
  updateStock(productId: string, qty: number): Promise<void>;

  // Sales
  getInvoices(): Promise<Invoice[]>;
  createInvoice(invoice: Invoice): Promise<void>;

  // ... etc for each module
}

// Factory pattern
export function createDatabaseAdapter(): DatabaseAdapter {
  if (isElectron() && isPgAvailable()) {
    return new PgAdapter();
  }
  return new MockAdapter();
}
```

### 3.3 Drizzle Schema (Per Module)

```ts
// src/core/database/schema/accounting.ts
import { pgTable, uuid, varchar, numeric, timestamp } from 'drizzle-orm/pg-core';
import { companies } from './core';

export const accounts = pgTable('accounts', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').references(() => companies.id, { onDelete: 'cascade' }),
  code: varchar('code', { length: 20 }).notNull(),
  nameAr: varchar('name_ar', { length: 255 }).notNull(),
  nameEn: varchar('name_en', { length: 255 }),
  parentId: uuid('parent_id'),
  type: varchar('type', { length: 20 }).notNull(), // asset, liability, equity, revenue, expense
  nature: varchar('nature', { length: 10 }).notNull(), // debit, credit
  isGroup: boolean('is_group').default(false).notNull(),
  balance: numeric('balance', { precision: 18, scale: 4 }).default('0').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const transactions = pgTable('transactions', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').references(() => companies.id, { onDelete: 'cascade' }),
  date: date('date').notNull(),
  reference: varchar('reference', { length: 100 }),
  description: text('description'),
  totalAmount: numeric('total_amount', { precision: 18, scale: 4 }).default('0').notNull(),
  status: varchar('status', { length: 20 }).default('draft').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const journalEntries = pgTable('journal_entries', {
  id: uuid('id').defaultRandom().primaryKey(),
  transactionId: uuid('transaction_id').references(() => transactions.id, { onDelete: 'cascade' }),
  accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'restrict' }),
  debit: numeric('debit', { precision: 18, scale: 4 }).default('0').notNull(),
  credit: numeric('credit', { precision: 18, scale: 4 }).default('0').notNull(),
  memo: text('memo'),
});
```

---

## 4. محرك التقارير (Reports Engine)

### 4.1 البنية

```
core/reports/
├── engine/
│   ├── ReportBuilder.ts          ← Builder pattern for reports
│   ├── QueryBuilder.ts           ← SQL query builder
│   ├── Aggregator.ts             ← Data aggregation (sum, avg, groupBy)
│   └── FilterEngine.ts           ← Filter parsing & validation
├── export/
│   ├── pdf/
│   │   ├── PdfExporter.ts        ← jspdf wrapper (lazy-loaded)
│   │   ├── templates/            ← InvoiceTemplate, ReportTemplate
│   │   └── utils.ts              ← RTL support, font loading (Cairo)
│   ├── excel/
│   │   ├── ExcelExporter.ts      ← xlsx (SheetJS) wrapper
│   │   ├── formatters.ts         ← Cell formatting
│   │   └── templates/            ↑ Pre-defined Excel layouts
│   └── csv/
│       └── CsvExporter.ts        ← Simple CSV export
├── shared/
│   ├── types.ts                  ← ReportConfig, ChartConfig, ColumnConfig
│   ├── utils.ts                  ← Data manipulation helpers
│   └── constants.ts              ↑ Default configs
└── index.ts                      ← Public API
```

### 4.2 نظام التقارير (Report System)

```ts
// Example: Building a report
import { ReportBuilder } from '@/core/reports';

const report = new ReportBuilder()
  .from('sales_invoices')
  .select(['date', 'customer_name', 'total', 'tax_amount'])
  .where({ companyId: 'uuid-123', dateRange: ['2026-01-01', '2026-12-31'] })
  .groupBy('month')
  .aggregate({ total: 'sum', count: 'count' })
  .chart('bar')           ← Recharts bar chart
  .export(['pdf', 'xlsx']) ← Export options
  .build();
```

### 4.3 Dashboard Architecture

```
modules/reports/dashboards/
├── MainDashboard.tsx             ← الصفحة الرئيسية ("/")
├── components/
│   ├── KpiGrid.tsx               ← شبكة KPI Cards (2x2, 3x3)
│   ├── KpiCard.tsx               ← بطاقة مؤشر (Revenue, Expenses, Profit)
│   ├── ChartSection.tsx          ← حاوية الرسوم البيانية
│   ├── AlertFeed.tsx             ← قائمة التنبيهات الذكية
│   └── QuickActions.tsx          ← أزرار إجراءات سريعة
├── widgets/                      ← ويدجات قابلة لإعادة الاستخدام
│   ├── RevenueChart.tsx          ← بيع شهري (LineChart)
│   ├── TopProductsChart.tsx      ← أفضل منتجات (BarChart)
│   ├── ArAgingChart.tsx          ← عمر الديون (PieChart/Donut)
│   └── CashFlowWidget.tsx        ← التدفق النقدي (AreaChart)
└── hooks/
    ├── useDashboardData.ts       ← جلب بيانات Dashboard
    └── useKpiCalculations.ts     ← حساب KPIs
```

---

## 5. إدارة الحالة (State Management)

### 5.1 Zustand Store Architecture

```
core/store/
├── appStore.ts                   ← Store الرئيسي (combines all slices)
├── slices/
│   ├── uiSlice.ts                ← sidebarOpen, activeView, theme, language
│   ├── authSlice.ts              ← user, token, role, permissions
│   ├── companySlice.ts           ← activeCompany, currency, fiscalYear
│   ├── dbSlice.ts                ← dbLayer, connectionStatus
│   └── notificationSlice.ts      ← toasts, alerts, confirmations
└── index.ts
```

### 5.2 Module Stores (Optional)

```ts
// modules/sales/store.ts
import { create } from 'zustand';

interface SalesState {
  invoices: Invoice[];
  selectedInvoice: Invoice | null;
  filters: SalesFilters;
  setInvoices: (invoices: Invoice[]) => void;
  setSelectedInvoice: (invoice: Invoice | null) => void;
  setFilters: (filters: Partial<SalesFilters>) => void;
}

export const useSalesStore = create<SalesState>((set) => ({
  invoices: [],
  selectedInvoice: null,
  filters: { dateRange: null, customer: null, status: null },
  setInvoices: (invoices) => set({ invoices }),
  setSelectedInvoice: (invoice) => set({ selectedInvoice: invoice }),
  setFilters: (filters) => set((state) => ({ filters: { ...state.filters, ...filters } })),
}));
```

---

## 6. تدفق البيانات (Data Flow)

### 6.1 سيناريو: عرض Dashboard رئيسي

```
User opens app → route "/"
    │
    ▼
MainDashboard.tsx
    │
    ├── useDashboardData() hook
    │       │
    │       ├── fetch KPIs from multiple modules
    │       │       ├── accounting: getNetProfit()
    │       │       ├── sales: getMonthlyRevenue()
    │       │       ├── inventory: getLowStockCount()
    │       │       └── hr: getPendingPayrolls()
    │       │
    │       └── aggregate in hook
    │
    ├── KpiGrid ← displays KpiCards
    ├── ChartSection ← Recharts components
    └── AlertFeed ← Smart alerts
```

### 6.2 سيناريو: إنشاء فاتورة مبيعات + تصدير PDF

```
User fills SalesInvoiceForm → clicks Save
    │
    ▼
useCreateInvoiceMutation()
    │
    ├── Validation (items total = invoice total, VAT calc)
    ├── Database Adapter (createInvoice)
    │       └── PostgreSQL → Drizzle insert
    │
    ├── Update stock (inventory module)
    ├── Create journal entries (accounting module)
    ├── Log activity (core activityLogs)
    │
    └── Success → offer PDF export
            │
            └── PdfRenderer.tsx
                    ├── load Cairo font (RTL)
                    ├── InvoiceTemplate.tsx
                    └── generate PDF blob → download
```

### 6.3 سيناريو: تشغيل تقرير تحليلي

```
User opens "Sales Analysis Report"
    │
    ▼
SalesAnalysisPage.tsx
    │
    ├── ReportBuilder
    │       ├── QueryBuilder → generate SQL query
    │       ├── execute via Database Adapter
    │       └── aggregate data
    │
    ├── FilterPanel → user adjusts filters
    ├── DataTable (TanStack Table) → tabular view
    ├── BarChart (Recharts) → visual view
    │
    └── ExportPanel
            ├── PDF → jspdf + jspdf-autotable (lazy-loaded)
            ├── Excel → xlsx
            └── CSV → native
```

---

## 7. الأمان (Security)

### 7.1 Authentication & Authorization

```
auth/
├── login/                        ← تسجيل الدخول
├── register/                     ← تسجيل مستخدم جديد
└── rbac/                         ← Role-Based Access Control
    ├── roles.ts                  ← Super Admin, Manager, Accountant, Viewer
    ├── permissions.ts            ← canCreateInvoice, canDeleteTransaction...
    └── usePermissions.ts         ← Hook للتحقق من الصلاحيات
```

| الدور | الصلاحيات |
|-------|----------|
| **Super Admin** | كل شيء |
| **Manager** | كل شيء ما عدا حذف الشركة |
| **Accountant** | الحسابات، المبيعات، المشتريات، المخازن |
| **Sales Rep** | المبيعات + CRM فقط |
| **HR Admin** | الموظفين + الرواتب |
| **Viewer** | قراءة فقط (لا يمكن إنشاء/تعديل) |

### 7.2 البيانات المحلية (Electron)
- **التشفير:** Mock adapter بدون تشفير.
- **النسخ الاحتياطي:** تصدير تلقائي إلى JSON/SQL dump.

### 7.3 البيانات البعيدة (PostgreSQL)
- **SSL:** إجبارية للاتصالات البعيدة.
- **Row-Level Security (RLS):** صلاحيات على مستوى الصفوف.
- **Audit Trail:** كل عملية تسجل في `activity_logs`.

---

## 8. الأداء والتخزين المؤقت (Performance)

### 8.1 استراتيجيات

| الاستراتيجية | التنفيذ |
|-------------|---------|
| **Zustand Selectors** | استخدام selectors دقيقة لمنع re-renders |
| **TanStack Query** | (مستقبلي) caching و background refetch |
| **Virtualization** | TanStack Virtual للجداول الكبيرة (>100 صف) |
| **Code Splitting** | `React.lazy()` + Dynamic imports لكل وحدة |
| **Memoization** | `useMemo`/`useCallback` للحسابات الثقيلة |

### 8.2 تحسينات قاعدة البيانات
- **Indexes:** فهرس مركب `(company_id, created_at)` على كل الجداول.
- **Partial Indexes:** على `is_active = true` للجداول الكبيرة.
- **Pagination:** `limit`/`offset` لكل API.
- **Connection Pool:** `pg` pool مع `max: 5` connections.

---

## 9. قابلية التوسع (Scalability)

### 9.1 إضافة وحدة ERP جديدة

```bash
# 1. إنشاء المجلد
mkdir src/modules/newmodule

# 2. إنشاء الملفات الأساسية
touch src/modules/newmodule/{index.ts,types.ts,store.ts}
touch src/modules/newmodule/api/{index.ts,queries.ts,mutations.ts}
touch src/modules/newmodule/components/{NewModulePage.tsx}
touch src/modules/newmodule/reports/{NewModuleReport.tsx}

# 3. إضافة schema
# في src/core/database/schema/newmodule.ts

# 4. إضافة route
# في src/app/router.tsx

# 5. إضافة i18n keys
# في src/core/i18n/ar.json و en.json
```

### 9.2 إضافة تقرير لوحدة موجودة

```
modules/[name]/reports/
├── NewReport.tsx                 ← صفحة التقرير
├── NewReportChart.tsx            ← الرسم البياني
├── NewReportTable.tsx            ← الجدول
└── index.ts                      ← Export
```

---

## 10. الرسوم البيانية (Diagrams)

### 10.1 ERD — الكيانات الرئيسية

```
companies ||--o{ users : has
companies ||--o{ accounts : has
companies ||--o{ products : has
companies ||--o{ warehouses : has
companies ||--o{ contacts : has
companies ||--o{ transactions : has
companies ||--o{ invoices : has
companies ||--o{ purchase_invoices : has
companies ||--o{ employees : has
companies ||--o{ activity_logs : has

users ||--o{ transactions : creates
users ||--o{ invoices : creates

accounts ||--o{ journal_entries : debited/credited
transactions ||--|{ journal_entries : contains

products ||--o{ stock_moves : tracked_in
warehouses ||--o{ stock_moves : located_in

contacts ||--o{ invoices : billed_to
contacts ||--o{ purchase_invoices : billed_from

invoices ||--|{ invoice_lines : contains
purchase_invoices ||--|{ purchase_lines : contains

products ||--o{ bom_items : component_of
products ||--o{ work_orders : produced_by

employees ||--o{ attendance : has
employees ||--o{ payroll_records : paid_in

contacts ||--o{ leads : converted_from
contacts ||--o{ opportunities : associated_with
```

### 10.2 مخطط التسلسل — بدء التطبيق

```
Electron Main Process
    │
    ├─── load index.html ───► Renderer Process
    │                            │
    │                            ├── init React + Tailwind CSS
    │                            ├── detect theme (light/dark)
    │                            ├── load i18n (ar/en)
    │                            ├── connect Database Adapter
    │                            │       ├── try PostgreSQL
    │                            │       └── fallback Mock
    │                            ├── init Zustand Store
    │                            ├── load user session (auth)
    │                            ├── fetch company data
    │                            └── render MainDashboard
```

---

## 11. البيئات (Environments)

| البيئة | الأمر | قاعدة البيانات | Electron | Tailwind |
|--------|-------|---------------|----------|----------|
| **Development (Web)** | `npm run dev` | Dexie/Mock | ❌ | JIT |
| **Development (Electron)** | `npm run electron:dev` | PostgreSQL أو Mock | ✅ | JIT |
| **Staging** | `npm run build:staging` | PostgreSQL staging | ✅ | Build |
| **Production** | `npm run build` | PostgreSQL local | ✅ | Build + Purge |

---

## 12. التقنيات الجديدة والمكتبات

| المكتبة | الاستخدام | رابط |
|---------|----------|------|
| **Tailwind CSS** | Styling + Dark Mode | tailwindcss.com |
| **Recharts** | رسوم بيانية | recharts.org |
| **Tremor** | مكونات Dashboard جاهزة | tremor.so |
| **TanStack React Table** | جداول متقدمة | tanstack.com/table |
| **jspdf** | تصدير PDF (lazy-loaded) | github.com/parallax/jsPDF |
| **jspdf-autotable** | جداول PDF | github.com/simonbengtsson/jsPDF-AutoTable |
| **xlsx (SheetJS)** | تصدير Excel | sheetjs.com |
| **Zustand** | State management | github.com/pmndrs/zustand |
| **Lucide React** | أيقونات | lucide.dev |

---

## 13. نقاط تقنية مفتوحة (Open Decisions)

1. **Supabase:** هل نستخدمه لـ SaaS مستقبلي؟
2. **Sync Engine:** مزامنة bi-directional بين PostgreSQL والنسخ المحلية.
3. **TanStack Query:** هل نضيفه لـ server state management؟
4. **Real-time:** هل ندعم WebSocket لـ live updates؟
5. **PWA:** هل نجعل النسخة Web قابلة للتثبيت كـ PWA؟

---

*آخر تحديث: 2026-05-24 | المعماري الرئيسي: Lead Architect*
