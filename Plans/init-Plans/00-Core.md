# خطة الوحدة: الأساس (Core)

> **الهدف:** بناء الطبقة الأساسية المشتركة التي تعتمد عليها جميع الوحدات الأخرى.

---

## 1. نظرة عامة

| البند | التفاصيل |
|-------|---------|
| **الاسم** | Core |
| **المجلد** | `src/core/` |
| **التبعيات** | لا توجد (الأساس) |
| **المدة** | أسبوعان (المرحلة 0) |
| **الأولوية** | عالية جداً — يجب أن تكتمل أولاً |

---

## 2. المتطلبات الوظيفية

### 2.1 إدارة الشركات (Companies)
- إنشاء/تعديل/حذف شركة.
- تحديد العملة الأساسية (YER افتراضياً).
- تحديد السنة المالية.
- رفع شعار المؤسسة.
- إدارة الفروع (مستقبلي).

### 2.2 إدارة العملات (Currencies)
- قائمة عملات جاهزة (YER, USD, EUR, SAR, AED...).
- أسعار الصرف.
- العملة الافتراضية.

### 2.3 طبقات قاعدة البيانات (Database Layers)
- PostgreSQL (Layer 1) — الإنتاج.
- Realm DB (Layer 2) — Offline.
- Mock/Dexie (Layer 3) — التطوير.

### 2.4 نظام الترجمة (i18n)
- العربية (افتراضي) + الإنجليزية.
- تبديل اللغة في الوقت الحقيقي.
- دعم RTL/LTR.

### 2.5 إدارة الحالة (State Management)
- Zustand store مركزي.
- Slices: ui, auth, company, db, notifications.

### 2.6 نظام التصميم (Design System)
- Tailwind CSS configuration.
- CSS Variables للألوان.
- خطوط Cairo/Inter.
- Dark/Light mode.

---

## 3. هيكل الملفات

```
src/core/
├── ui/
│   ├── components/
│   │   ├── Button.tsx
│   │   ├── Input.tsx
│   │   ├── Select.tsx
│   │   ├── Modal.tsx
│   │   ├── Card.tsx
│   │   ├── Table.tsx
│   │   ├── Toast.tsx
│   │   ├── Skeleton.tsx
│   │   └── index.ts
│   ├── charts/
│   │   ├── BarChart.tsx
│   │   ├── LineChart.tsx
│   │   ├── PieChart.tsx
│   │   └── index.ts
│   ├── tokens/
│   │   ├── colors.ts
│   │   └── typography.ts
│   └── index.ts
│
├── store/
│   ├── appStore.ts
│   ├── slices/
│   │   ├── uiSlice.ts
│   │   ├── authSlice.ts
│   │   ├── companySlice.ts
│   │   ├── dbSlice.ts
│   │   └── notificationSlice.ts
│   └── index.ts
│
├── i18n/
│   ├── ar.json
│   ├── en.json
│   ├── useTranslation.ts
│   └── index.ts
│
├── database/
│   ├── adapters/
│   │   ├── index.ts
│   │   ├── types.ts
│   │   ├── pgAdapter.ts
│   │   ├── realmAdapter.ts
│   │   └── mockAdapter.ts
│   ├── schema/
│   │   ├── core.ts
│   │   └── index.ts
│   ├── realm/
│   │   └── index.ts
│   └── index.ts
│
├── reports/
│   ├── engine/
│   │   ├── ReportBuilder.ts
│   │   ├── QueryBuilder.ts
│   │   └── index.ts
│   ├── export/
│   │   ├── PdfExporter.ts
│   │   ├── ExcelExporter.ts
│   │   └── index.ts
│   └── index.ts
│
├── utils/
│   ├── formatCurrency.ts
│   ├── formatDate.ts
│   ├── validators.ts
│   └── index.ts
│
└── types/
    ├── common.ts
    └── index.ts
```

---

## 4. قاعدة البيانات (Schema)

### 4.1 الجداول الأساسية

```ts
// core/database/schema/core.ts

// الشركات
export const companies = pgTable('companies', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  nameEn: varchar('name_en', { length: 255 }),
  currency: char('currency', { length: 3 }).default('YER').notNull(),
  taxNumber: varchar('tax_number', { length: 50 }),
  address: text('address'),
  phone: varchar('phone', { length: 50 }),
  email: varchar('email', { length: 255 }),
  logoUrl: text('logo_url'),
  fiscalYearStart: date('fiscal_year_start'),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// العملات
export const currencies = pgTable('currencies', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: char('code', { length: 3 }).notNull().unique(),
  nameAr: varchar('name_ar', { length: 100 }).notNull(),
  nameEn: varchar('name_en', { length: 100 }),
  symbol: varchar('symbol', { length: 10 }),
  exchangeRate: numeric('exchange_rate', { precision: 18, scale: 6 }).default('1').notNull(),
  isDefault: boolean('is_default').default(false).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
});

// سجل النشاطات
export const activityLogs = pgTable('activity_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').references(() => companies.id, { onDelete: 'cascade' }),
  userId: varchar('user_id', { length: 50 }),
  userName: varchar('user_name', { length: 100 }),
  action: text('action').notNull(),
  module: varchar('module', { length: 100 }),
  details: text('details'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});
```

---

## 5. المكونات (Components)

### 5.1 مكونات UI الأساسية

| المكون | الوصف | الأولوية |
|--------|-------|---------|
| `Button` | أزرار متعددة الأنواع (Primary, Secondary, Outline, Ghost, Destructive) | عالية |
| `Input` | حقول إدخال نصية مع validation | عالية |
| `Select` | قوائم منسدلة مع بحث | عالية |
| `Modal` | نوافذ منبثقة | عالية |
| `Card` | بطاقات للمحتوى | عالية |
| `Table` | جداول بيانات | عالية |
| `Toast` | رسائل تنبيه | متوسطة |
| `Skeleton` | حالة التحميل | متوسطة |
| `Dropdown` | قوائم سياقية | متوسطة |
| `Tabs` | تبويبات | متوسطة |

### 5.2 مكونات الرسوم البيانية

| المكون | الوصف | الأولوية |
|--------|-------|---------|
| `BarChart` | مخطط أعمدة | عالية |
| `LineChart` | مخطط خطي | عالية |
| `PieChart` | مخطط دائري | متوسطة |
| `AreaChart` | مخطط مساحي | متوسطة |
| `KpiCard` | بطاقة مؤشر | عالية |

---

## 6. API / Adapters

### 6.1 Database Adapter Interface

```ts
// core/database/adapters/types.ts
export interface DatabaseAdapter {
  // Company
  getCompany(): Promise<Company | null>;
  saveCompany(company: Company): Promise<void>;
  updateCompany(id: string, data: Partial<Company>): Promise<void>;
  
  // Currency
  getCurrencies(): Promise<Currency[]>;
  getDefaultCurrency(): Promise<Currency | null>;
  
  // Activity Log
  logActivity(log: ActivityLog): Promise<void>;
  getActivityLogs(companyId: string): Promise<ActivityLog[]>;
}
```

### 6.2 Factory Pattern

```ts
// core/database/adapters/index.ts
export function createDatabaseAdapter(): DatabaseAdapter {
  if (isElectron() && isPgAvailable()) {
    return new PgAdapter();
  }
  if (isElectronRealm()) {
    return new RealmAdapter();
  }
  return new MockAdapter();
}
```

---

## 7. نظام الترجمة (i18n)

### 7.1 الهيكل

```json
// core/i18n/ar.json
{
  "common": {
    "save": "حفظ",
    "cancel": "إلغاء",
    "delete": "حذف",
    "edit": "تعديل",
    "create": "إنشاء",
    "search": "بحث...",
    "loading": "جاري التحميل...",
    "noData": "لا توجد بيانات",
    "confirm": "تأكيد",
    "yes": "نعم",
    "no": "لا"
  },
  "sidebar": {
    "dashboard": "لوحة التحكم",
    "accounts": "الحسابات",
    "inventory": "المخازن",
    "sales": "المبيعات",
    "purchases": "المشتريات",
    "manufacturing": "التصنيع",
    "hr": "الموظفين",
    "crm": "علاقات العملاء",
    "reports": "التقارير",
    "settings": "الإعدادات"
  },
  "theme": {
    "light": "فاتح",
    "dark": "داكن",
    "system": "تلقائي"
  },
  "language": {
    "ar": "العربية",
    "en": "English"
  }
}
```

---

## 8. تقسيم المهام (Tasks Breakdown)

### الأسبوع الأول

| # | المهمة | المدة | الأولوية |
|---|--------|-------|---------|
| 1 | تهيئة المشروع (Vite + React + TS + Tailwind) | 4 ساعات | عالية |
| 2 | إعداد Tailwind + Dark Mode + RTL | 2 ساعة | عالية |
| 3 | تحميل خطوط Cairo/Inter | 1 ساعة | عالية |
| 4 | بناء Zustand store أساسي | 3 ساعات | عالية |
| 5 | نظام الترجمة (i18n) | 4 ساعات | عالية |
| 6 | مكونات UI أساسية (Button, Input, Select) | 6 ساعات | عالية |

### الأسبوع الثاني

| # | المهمة | المدة | الأولوية |
|---|--------|-------|---------|
| 7 | Database Adapters (PG, Realm, Mock) | 8 ساعات | عالية |
| 8 | Schema الأساسي (companies, currencies) | 4 ساعات | عالية |
| 9 | مكونات UI إضافية (Modal, Card, Table) | 6 ساعات | عالية |
| 10 | مكونات Charts (Recharts wrappers) | 6 ساعات | متوسطة |
| 11 | محرك التقارير الأساسي | 4 ساعات | متوسطة |
| 12 | اختبارات الوحدات | 4 ساعات | متوسطة |

---

## 9. معايير القبول (Acceptance Criteria)

- [ ] التطبيق يعمل على `npm run dev` بدون أخطاء.
- [ ] Dark Mode يعمل بشكل صحيح.
- [ ] تبديل اللغة يعمل (العربية ↔ الإنجليزية).
- [ ] RTL/LTR يعمل بشكل صحيح.
- [ ] Database Adapter يتصل بـ PostgreSQL أو Realm أو Mock حسب البيئة.
- [ ] جميع مكونات UI الأساسية تعمل.
- [ ] اختبارات الوحدات تمر بنسبة ≥ 80%.

---

## 10. المخاطر والاحتياطات

| المخاطرة | الاحتياط |
|----------|---------|
| تعارض إصدارات الحزم | استخدم `npm ci` بدلاً من `npm install` |
| مشاكل Realm في المتصفح | استخدم Mock adapter في بيئة الويب |
| خطوط لا تُحمّل | استخدم Google Fonts CDN مع fallback |
| Dark Mode لا يعمل | تأكد من `darkMode: 'class'` في tailwind.config.js |

---

## 11. المخرجات النهائية

1. **مجلد `src/core/`** كامل.
2. **نظام تصميم** جاهز للاستخدام.
3. **نظام ترجمة** ثنائي اللغة.
4. **طبقات قاعدة بيانات** موحدة.
5. **مكونات UI** قابلة لإعادة الاستخدام.
6. **اختبارات** لكل جزء.

---

*تاريخ الإنشاء: 2026-05-24 | المسؤول: Lead Engineer*
