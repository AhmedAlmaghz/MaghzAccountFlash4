# خطة الوحدة: علاقات العملاء (CRM)

> **الهدف:** بناء نظام إدارة علاقات العملاء متكامل يشمل الفرص، المهام، المكالمات، وتحليلات المبيعات.

---

## 1. نظرة عامة

| البند | التفاصيل |
|-------|---------|
| **الاسم** | CRM |
| **المجلد** | `src/modules/crm/` |
| **التبعيات** | Core, Auth, Settings, Sales |
| **المدة** | أسبوع واحد (المرحلة 8) |
| **الأولوية** | متوسطة |

---

## 2. المتطلبات الوظيفية

### 2.1 إدارة العملاء المحتملين (Leads)
- إضافة/تعديل/حذف عميل محتمل.
- تحويل العميل المحتمل إلى عميل فعلي.
- تتبع مصدر العميل.

### 2.2 الفرص (Opportunities)
- إنشاء فرصة جديدة.
- قمع المبيعات (Sales Funnel).
- تتبع مراحل الفرصة.
- تقدير قيمة الفرصة.

### 2.3 المهام والمكالمات
- إنشاء مهمة.
- تسجيل المكالمات.
- جدولة المتابعات.
- تذكيرات تلقائية.

### 2.4 التقارير
- قمع المبيعات (Sales Funnel).
- معدل التحويل (Conversion Rate).
- أداء مندوبي المبيعات.
- سجل النشاطات.

---

## 3. هيكل الملفات

```
src/modules/crm/
├── index.ts
├── types.ts
│
├── api/
│   ├── index.ts
│   ├── queries.ts
│   └── mutations.ts
│
├── components/
│   ├── CrmPage.tsx
│   ├── LeadsList.tsx
│   ├── LeadForm.tsx
│   ├── OpportunitiesList.tsx
│   ├── OpportunityForm.tsx
│   ├── TasksList.tsx
│   ├── TaskForm.tsx
│   ├── SalesFunnel.tsx
│   └── index.ts
│
├── hooks/
│   ├── useLeads.ts
│   ├── useOpportunities.ts
│   ├── useTasks.ts
│   └── index.ts
│
├── reports/
│   ├── SalesFunnelReport.tsx
│   ├── ConversionRate.tsx
│   ├── RepPerformance.tsx
│   ├── ActivityLog.tsx
│   └── index.ts
│
└── utils/
    └── funnelCalculations.ts
```

---

## 4. قاعدة البيانات (Schema)

```ts
// core/database/schema/crm.ts

// العملاء المحتملين
export const leads = pgTable('leads', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  phone: varchar('phone', { length: 50 }),
  email: varchar('email', { length: 255 }),
  company: varchar('company', { length: 255 }),
  source: varchar('source', { length: 100 }), // website, referral, social, etc.
  status: varchar('status', { length: 20 }).default('new').notNull(), // new, contacted, qualified, converted, lost
  estimatedValue: numeric('estimated_value', { precision: 18, scale: 4 }),
  assignedTo: uuid('assigned_to').references(() => users.id),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// الفرص
export const opportunities = pgTable('opportunities', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').notNull(),
  leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'set null' }),
  customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
  name: varchar('name', { length: 255 }).notNull(),
  value: numeric('value', { precision: 18, scale: 4 }).notNull(),
  stage: varchar('stage', { length: 50 }).default('prospecting').notNull(), // prospecting, qualification, proposal, negotiation, closed_won, closed_lost
  probability: integer('probability').default(50), // 0-100
  expectedCloseDate: date('expected_close_date'),
  assignedTo: uuid('assigned_to').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// المهام
export const crmTasks = pgTable('crm_tasks', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').notNull(),
  opportunityId: uuid('opportunity_id').references(() => opportunities.id, { onDelete: 'cascade' }),
  leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  dueDate: date('due_date').notNull(),
  priority: varchar('priority', { length: 20 }).default('medium').notNull(), // low, medium, high
  status: varchar('status', { length: 20 }).default('pending').notNull(), // pending, completed, cancelled
  assignedTo: uuid('assigned_to').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// المكالمات
export const calls = pgTable('calls', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').notNull(),
  leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'set null' }),
  opportunityId: uuid('opportunity_id').references(() => opportunities.id, { onDelete: 'set null' }),
  customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
  type: varchar('type', { length: 20 }).notNull(), // incoming, outgoing
  duration: integer('duration'), // seconds
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});
```

---

## 5. المكونات (Components)

### 5.1 قمع المبيعات (Sales Funnel)

```tsx
// components/SalesFunnel.tsx
export const SalesFunnel = () => {
  const { opportunities } = useOpportunities();

  const stages = [
    { id: 'prospecting', label: 'الاستكشاف', color: 'bg-blue-500' },
    { id: 'qualification', label: 'التأهيل', color: 'bg-indigo-500' },
    { id: 'proposal', label: 'العرض', color: 'bg-purple-500' },
    { id: 'negotiation', label: 'التفاوض', color: 'bg-pink-500' },
    { id: 'closed_won', label: 'مغلق (ربح)', color: 'bg-emerald-500' },
    { id: 'closed_lost', label: 'مغلق (خسارة)', color: 'bg-rose-500' },
  ];

  const opportunitiesByStage = stages.map(stage => ({
    ...stage,
    count: opportunities.filter(o => o.stage === stage.id).length,
    value: opportunities.filter(o => o.stage === stage.id).reduce((sum, o) => sum + Number(o.value), 0),
  }));

  return (
    <div className="space-y-4">
      <h2>قمع المبيعات</h2>
      <div className="flex gap-2">
        {opportunitiesByStage.map(stage => (
          <div key={stage.id} className="flex-1">
            <div className={cn('h-32 rounded-lg flex flex-col items-center justify-center text-white', stage.color)}>
              <span className="text-2xl font-bold">{stage.count}</span>
              <span className="text-sm">{formatCurrency(stage.value)}</span>
            </div>
            <p className="text-center mt-2 text-sm font-medium">{stage.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
};
```

---

## 6. تقسيم المهام

| # | المهمة | المدة | الأولوية |
|---|--------|-------|---------|
| 1 | Schema (leads, opportunities, tasks) | 3 ساعات | عالية |
| 2 | قائمة العملاء المحتملين | 3 ساعات | عالية |
| 3 | الفرص وقمع المبيعات | 4 ساعات | عالية |
| 4 | المهام والمكالمات | 4 ساعات | متوسطة |
| 5 | API للـ CRM | 4 ساعات | عالية |
| 6 | التقارير (4 تقارير) | 6 ساعات | متوسطة |
| 7 | اختبارات الوحدات | 3 ساعات | منخفضة |

---

## 7. معايير القبول

- [ ] إضافة عميل محتمل تعمل.
- [ ] تحويل العميل المحتمل إلى فرصة.
- [ ] إنشاء فرصة جديدة تعمل.
- [ ] تحديث مرحلة الفرصة.
- [ ] إنشاء مهمة تعمل.
- [ ] تسجيل مكالمة يعمل.
- [ ] قمع المبيعات يعرض بشكل صحيح.
- [ ] التقارير تعرض بيانات صحيحة.
- [ ] اختبارات الوحدات تمر.

---

## 8. المخرجات النهائية

1. **نظام العملاء المحتملين**.
2. **إدارة الفرص**.
3. **قمع المبيعات**.
4. **المهام والمكالمات**.
5. **4 تقارير** متقدمة.
6. **API كامل** للـ CRM.
7. **اختبارات** شاملة.

---

*تاريخ الإنشاء: 2026-05-24 | المسؤول: CRM Module Lead*
