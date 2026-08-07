# دليل المهارات والقدرات — maghzaccount-pro

> **الغرض:** يوثق هذا الملف المهارات التقنية المطلوبة للمساهمة في المشروع، وكذلك القدرات الوظيفية (Skills) التي يقدمها النظام للمستخدم النهائي. يُستخدم كأداة توظيف وتدريب داخلية، وكمرجع لوصف القدرات للوكلاء الذكيين.

---

## الجزء الأول: المهارات التقنية (Engineering Skills)

### 1. Frontend Development

#### 1.1 React & TypeScript
- **المستوى:** متوسط إلى متقدم.
- **المتطلبات:**
  - إتقان Functional Components و Hooks.
  - فهم عميق لـ TypeScript Generics و Utility Types.
  - القدرة على إنشاء Custom Hooks مع اعتبارات الأداء.
  - معرفة بـ React Router للتوجيه.
- **الاختبار:** حل مشكلة re-render غير ضروري في قائمة كبيرة.

#### 1.2 State Management (Zustand)
- **المستوى:** متوسط.
- **المتطلبات:**
  - بناء Store متعدد الطبقات (slices).
  - فهم Selectors لمنع الاشتراكات غير الضرورية.
  - تكامل Zustand مع Persist Middleware.

#### 1.3 Tailwind CSS & Design System
- **المستوى:** متوسط إلى متقدم.
- **المتطلبات:**
  - إتقان Tailwind CSS classes و Dark Mode (`dark:` prefix).
  - بناء تصميم RTL-ready باستخدام `rtl:` prefix أو logical properties.
  - فهم Flexbox و CSS Grid في سياق Dashboards.
  - القدرة على إنشاء animations باستخدام Tailwind.

#### 1.4 Charts & Data Visualization
- **المستوى:** متوسط.
- **المتطلبات:**
  - استخدام Recharts للرسوم البيانية (Bar, Line, Pie, Area).
  - استخدام Tremor لمكونات Dashboard الجاهزة.
  - فهم ResponsiveContainer و RTL support في Charts.
  - تخصيص ألوان و styles للرسوم البيانية.

#### 1.5 Tables & Data Grids
- **المستوى:** متوسط.
- **المتطلبات:**
  - استخدام TanStack React Table للجداول المتقدمة.
  - تطبيق Flters و Sorting و Pagination.
  - التعامل مع كميات كبيرة من البيانات (virtualization).

### 2. Backend & Database Layer

#### 2.1 PostgreSQL & Drizzle ORM
- **المستوى:** متوسط.
- **المتطلبات:**
  - تصميم Schema relations (1:N, N:M).
  - كتابة migrations آمنة.
  - فهم Foreign Keys، Constraints، و Indexing.
  - التعامل مع Numeric types (`precision: 18, scale: 4`).

#### 2.2 Database Adapter Pattern
- **المستوى:** متوسط إلى متقدم.
- **المتطلبات:**
  - كتابة DatabaseAdapter interface موحد.
  - تطبيق PG Adapter و Mock Adapter.
  - التعامل مع `convertPlaceholders()` لتحويل `?` → `$N` للـ PostgreSQL.

#### 2.3 Multi-Layer Database Strategy
- **المستوى:** متقدم.
- **المتطلبات:**
  - فهم طبقتين (PostgreSQL → Mock fallback).
  - كتابة Adapter Pattern موحد.
  - التعامل مع البيئات المختلفة (Electron + Browser).

### 3. Reports & Analytics

#### 3.1 Report Engine
- **المستوى:** متوسط.
- **المتطلبات:**
  - استخدام ReportBuilder و QueryBuilder.
  - بناء تقارير مخصصة لكل وحدة.
  - تطبيق فلاتر وتجميعات (aggregations).

#### 3.2 PDF Export
- **المستوى:** متوسط.
- **المتطلبات:**
  - استخدام `jspdf` + `jspdf-autotable` (محمّلان ديناميكياً).
  - تحميل خطوط عربية (Cairo) عبر `doc.addFileToVFS`.
  - تصميم قوالب PDF للفواتير والتقارير.

#### 3.3 Excel Export
- **المستوى:** مبتدئ إلى متوسط.
- **المتطلبات:**
  - استخدام `xlsx` (SheetJS).
  - تنسيق الخلايا والأعمدة.
  - إنشاء ملفات Excel متعددة الأوراق.

### 4. Desktop Development (Electron)
- **المستوى:** متوسط.
- **المتطلبات:**
  - فصل Main Process vs. Renderer Process.
  - IPC Communication (preload scripts, contextBridge).
  - بناء تطبيقات قابلة للتثبيت (electron-builder).
  - التعامل مع Node.js APIs (pg, fs, path).

### 5. Internationalization (i18n)
- **المستوى:** متوسط.
- **المتطلبات:**
  - بناء نظام ترجمة ديناميكي.
  - التعامل مع RTL و LTR.
  - تنسيق الأرقام والتواريخ والعملات.

---

## الجزء الثاني: القدرات الوظيفية (System Skills / Modules)

### 1. الأساس (Core)

| المهارة | الوصف | الحالة |
|---------|-------|--------|
| **Company Profile** | إدارة بيانات المؤسسة (اسم، عملة، ضريبة، شعار) | ✅ نشط |
| **Multi-Currency** | دعم عملات متعددة مع YER كافتراضي | ✅ مخطط |
| **Fiscal Year** | تحديد السنة المالية والفترات | ✅ مخطط |
| **Activity Logging** | سجل العمليات والتدقيق (Audit Trail) | ✅ نشط |

### 2. تسجيل الدخول (Auth)

| المهارة | الوصف | الحالة |
|---------|-------|--------|
| **User Management** | إدارة المستخدمين والأدوار | ✅ مخطط |
| **RBAC** | صلاحيات على مستوى الوظائف (Super Admin, Manager, Accountant, Viewer) | ✅ مخطط |
| **Session Management** | تسجيل الدخول/الخروج، إدارة الجلسات | ✅ مخطط |

### 3. الإعدادات (Settings)

| المهارة | الوصف | الحالة |
|---------|-------|--------|
| **System Settings** | إعدادات عامة (اللغة، الثيم، التنسيقات) | ✅ مخطط |
| **VAT Configuration** | نظام ضريبة القيمة المضافة المرن | ✅ مخطط |
| **Branches** | إدارة الفروع والمستودعات | ✅ مخطط |
| **Backup & Restore** | النسخ الاحتياطي والاستعادة | ✅ مخطط |

### 4. الحسابات (Accounting)

| المهارة | الوصف | الحالة |
|---------|-------|--------|
| **Chart of Accounts** | شجرة حسابات جاهزة (IFRS-compliant) | ✅ مخطط |
| **Journal Entries** | قيود اليومية المزدوجة مع validation | ✅ مخطط |
| **Trial Balance** | ميزان المراجعة التلقائي | ✅ مخطط |
| **Financial Statements** | الميزانية العمومية، قائمة الدخل، التدفقات النقدية | ✅ مخطط |
| **Account Ledger** | دفتر أستاذ تفصيلي لكل حساب | ✅ مخطط |

**التقارير:**
- Trial Balance
- Balance Sheet
- Profit & Loss
- Cash Flow Statement
- Account Activity Report
- Comparative Analysis (Period vs Period)

### 5. المخازن (Inventory)

| المهارة | الوصف | الحالة |
|---------|-------|--------|
| **Products** | إدارة المنتجات والتصنيفات والباركود | ✅ مخطط |
| **Warehouses** | المستودعات والتحويلات بينها | ✅ مخطط |
| **Stock Moves** | حركة المخزون (وارد، صادر، تحويل) | ✅ مخطط |
| **Stock Count** | الجرد الدوري والتسوية | ✅ مخطط |

**التقارير:**
- Item Ledger (بطاقة صنف)
- Stock Status
- Low Stock Alert
- Slow Moving Items
- Inventory Valuation
- Transfer Report

### 6. المبيعات (Sales)

| المهارة | الوصف | الحالة |
|---------|-------|--------|
| **Sales Invoices** | فواتير مبيعات مع VAT | ✅ مخطط |
| **Quotations** | عروض أسعار للعملاء | ✅ مخطط |
| **Returns** | مرتجعات مبيعات | ✅ مخطط |
| **A/R Management** | حسابات العملاء وعمر الديون | ✅ مخطط |
| **Collections** | التحصيل والمقبوضات | ✅ مخطط |

**التقارير:**
- Sales Invoices Report
- Customer Statement
- A/R Aging
- Top Customers
- Top Products
- Seasonal Analysis
- VAT Sales Report

### 7. المشتريات (Purchases)

| المهارة | الوصف | الحالة |
|---------|-------|--------|
| **Purchase Invoices** | فواتير مشتريات مع VAT | ✅ مخطط |
| **Purchase Orders** | أوامر الشراء | ✅ مخطط |
| **Returns** | مرتجعات مشتريات | ✅ مخطط |
| **A/P Management** | حسابات الموردين وعمر الديون | ✅ مخطط |
| **Payments** | الدفعات والأذونات | ✅ مخطط |

**التقارير:**
- Purchase Invoices Report
- Vendor Statement
- A/P Aging
- Price Comparison
- VAT Purchases Report

### 8. التصنيع (Manufacturing)

| المهارة | الوصف | الحالة |
|---------|-------|--------|
| **BOM** | فواتير المواد (Bill of Materials) | ✅ مخطط |
| **Work Orders** | أوامر التشغيل | ✅ مخطط |
| **Production Costing** | تكاليف الإنتاج (Standard vs Actual) | ✅ مخطط |
| **Finished Goods** | المنتج التام | ✅ مخطط |

**التقارير:**
- Production Cost Report
- Work Order Status
- Material Consumption
- Variance Analysis
- Line Efficiency

### 9. الموظفين (HR)

| المهارة | الوصف | الحالة |
|---------|-------|--------|
| **Employee Records** | سجلات الموظفين والأقسام | ✅ مخطط |
| **Attendance** | الحضور والانصراف | ✅ مخطط |
| **Payroll** | مسير الرواتب والاستقطاعات | ✅ مخطط |
| **End of Service** | احتساب نهاية الخدمة | ✅ مخطط |

**التقارير:**
- Payroll Sheet
- Attendance Report
- Leave Balance
- End of Service Calculation
- Salary Analysis

### 10. علاقات العملاء (CRM)

| المهارة | الوصف | الحالة |
|---------|-------|--------|
| **Leads** | العملاء المحتملين | ✅ مخطط |
| **Opportunities** | الفرص وقمع المبيعات | ✅ مخطط |
| **Activities** | المهام والمكالمات والاجتماعات | ✅ مخطط |
| **Support Tickets** | تذاكر الدعم | ✅ مخطط |

**التقارير:**
- Sales Funnel
- Lead Conversion Rate
- Rep Performance
- Activity Log

### 11. التقارير (Reports & Analytics)

| المهارة | الوصف | الحالة |
|---------|-------|--------|
| **Main Dashboard** | لوحة تحكم رئيسية مع KPIs من كل الوحدات | ✅ مخطط |
| **Smart Alerts** | تنبيهات ذكية (مخزون منخفض، فواتير مستحقة) | ✅ مخطط |
| **Forecasting** | توقعات المبيعات والأرباح | ✅ مخطط |
| **Export** | تصدير PDF و Excel | ✅ مخطط |

---

## الجزء الثالث: مصفوفة الكفاءات (Competency Matrix)

| الدور | React/TS | Tailwind | Charts | DB Layer | Electron | Reports | Domain |
|-------|----------|----------|--------|----------|----------|---------|--------|
| **Frontend Engineer** | ★★★★★ | ★★★★★ | ★★★★☆ | ★★★☆☆ | ★★☆☆☆ | ★★★☆☆ | ★★☆☆☆ |
| **Backend Engineer** | ★★★☆☆ | ★★☆☆☆ | ★★☆☆☆ | ★★★★★ | ★★★★☆ | ★★★☆☆ | ★★★☆☆ |
| **Full-Stack Lead** | ★★★★☆ | ★★★★☆ | ★★★☆☆ | ★★★★★ | ★★★★☆ | ★★★★☆ | ★★★★☆ |
| **Data/Report Engineer** | ★★★★☆ | ★★★☆☆ | ★★★★★ | ★★★★☆ | ★★☆☆☆ | ★★★★★ | ★★★★☆ |
| **UX/UI Designer** | ★★☆☆☆ | ★★★★★ | ★★★★☆ | ★☆☆☆☆ | ★☆☆☆☆ | ★★★☆☆ | ★★★★☆ |
| **QA Engineer** | ★★★☆☆ | ★★★☆☆ | ★★★☆☆ | ★★★☆☆ | ★★★☆☆ | ★★★☆☆ | ★★★☆☆ |
| **Product Owner** | ★★☆☆☆ | ★★☆☆☆ | ★★★☆☆ | ★★☆☆☆ | ★★☆☆☆ | ★★★★☆ | ★★★★★ |

---

## الجزء الرابع: الموارد التعليمية

### للمطورين الجدد

**Onboarding Checklist:**
- [ ] قراءة `AGENTS.md` و `ARCHITECTURE.md` و `DESIGN.md` و `STYLEGUIDE.md`.
- [ ] تشغيل `npm run dev` و `npm run electron:dev` بنجاح.
- [ ] فهم هيكل الوحدات الـ 11.
- [ ] كتابة مكون "Hello World" مع Tailwind و Dark Mode.
- [ ] إضافة جدول تجريبي في `schema/` وتشغيل migration.
- [ ] إنشاء تقرير بسيط باستخدام Recharts.
- [ ] فتح Pull Request تجريبي.

### للمصممين

**Design Tokens:**
- جميع الألوان والخطوط متوفرة في `tailwind.config.js`.
- خطوط Cairo (عربي) و Inter (إنجليزي) من Google Fonts.
- نظام ألوان Blue-Slate مع Dark Mode.

### لمطوري التقارير

**Reports Stack:**
- Recharts للرسوم البيانية.
- TanStack Table للجداول.
- `jspdf` + `jspdf-autotable` لتصدير PDF (محمّلان ديناميكياً).
- `xlsx` لتصدير Excel.

---

## الجزء الخامس: المكتبات والأدوات

| الفئة | المكتبة | الاستخدام |
|-------|---------|----------|
| **Styling** | Tailwind CSS | تصميم الواجهات |
| **Charts** | Recharts | الرسوم البيانية |
| **Dashboard** | @tremor/react | مكونات Dashboard |
| **Tables** | @tanstack/react-table | الجداول المتقدمة |
| **State** | Zustand | إدارة الحالة |
| **Icons** | Lucide React | الأيقونات |
| **PDF** | jspdf + jspdf-autotable | تصدير PDF (lazy-loaded) |
| **Excel** | xlsx | تصدير Excel |
| **ORM** | Drizzle ORM | قاعدة البيانات |
| **Desktop** | Electron | تطبيق سطح المكتب |

---

*آخر تحديث: 2026-05-24 | مسؤول التطوير: Lead Engineering*
