# خطة الوحدة: الإعدادات (Settings)

> **الهدف:** بناء نظام إعدادات شامل للتطبيق والشركة والضريبة والعملات.

---

## 1. نظرة عامة

| البند | التفاصيل |
|-------|---------|
| **الاسم** | Settings |
| **المجلد** | `src/modules/settings/` |
| **التبعيات** | Core, Auth |
| **المدة** | 3 أيام (المرحلة 1) |
| **الأولوية** | عالية |

---

## 2. المتطلبات الوظيفية

### 2.1 إعدادات النظام
- تغيير اللغة (العربية/الإنجليزية).
- تغيير الثيم (فاتح/داكن/تلقائي).
- تنسيق التواريخ (هجري/ميلادي).
- تنسيق الأرقام (عربي/إنجليزي).

### 2.2 إعدادات الشركة
- تعديل بيانات الشركة (اسم، عنوان، هاتف...).
- رفع الشعار.
- تحديد السنة المالية.
- إدارة الفروع (مستقبلي).

### 2.3 إعدادات الضريبة (VAT)
- تفعيل/تعطيل الضريبة.
- تحديد نسبة الضريبة (5%, 10%, 15%, مخصص).
- رقم التسجيل الضريبي.
- أنواع الفواتير (ضريبية، مبسطة، خاصة).

### 2.4 إدارة العملات
- قائمة العملات المتاحة.
- إضافة عملة جديدة.
- تحديث أسعار الصرف.
- تحديد العملة الافتراضية.

### 2.5 النسخ الاحتياطي
- تصدير البيانات (JSON/SQL).
- استيراد البيانات.
- جدولة النسخ الاحتياطي (مستقبلي).

---

## 3. هيكل الملفات

```
src/modules/settings/
├── index.ts
├── types.ts
│
├── api/
│   ├── index.ts
│   ├── queries.ts
│   └── mutations.ts
│
├── components/
│   ├── SettingsPage.tsx
│   ├── SystemSettings.tsx
│   ├── CompanySettings.tsx
│   ├── VatSettings.tsx
│   ├── CurrencyManager.tsx
│   ├── BackupManager.tsx
│   └── index.ts
│
├── hooks/
│   ├── useSettings.ts
│   ├── useCurrencies.ts
│   └── index.ts
│
└── store/
    └── settingsSlice.ts
```

---

## 4. قاعدة البيانات (Schema)

```ts
// core/database/schema/settings.ts

// إعدادات النظام
export const systemSettings = pgTable('system_settings', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').references(() => companies.id, { onDelete: 'cascade' }).notNull(),
  language: varchar('language', { length: 5 }).default('ar').notNull(),
  theme: varchar('theme', { length: 20 }).default('light').notNull(),
  dateFormat: varchar('date_format', { length: 20 }).default('hijri').notNull(),
  numberFormat: varchar('number_format', { length: 20 }).default('arabic').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// إعدادات الضريبة
export const vatSettings = pgTable('vat_settings', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').references(() => companies.id, { onDelete: 'cascade' }).notNull(),
  isEnabled: boolean('is_enabled').default(true).notNull(),
  rate: numeric('rate', { precision: 5, scale: 2 }).default('15').notNull(),
  registrationNumber: varchar('registration_number', { length: 100 }),
  invoiceType: varchar('invoice_type', { length: 50 }).default('tax').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// أسعار الصرف
export const exchangeRates = pgTable('exchange_rates', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').references(() => companies.id, { onDelete: 'cascade' }).notNull(),
  fromCurrency: char('from_currency', { length: 3 }).notNull(),
  toCurrency: char('to_currency', { length: 3 }).notNull(),
  rate: numeric('rate', { precision: 18, scale: 6 }).notNull(),
  effectiveDate: date('effective_date').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});
```

---

## 5. المكونات (Components)

### 5.1 صفحة الإعدادات الرئيسية

```tsx
// SettingsPage.tsx
export const SettingsPage = () => {
  const [activeTab, setActiveTab] = useState('system');

  const tabs = [
    { id: 'system', label: 'النظام', icon: Settings },
    { id: 'company', label: 'الشركة', icon: Building2 },
    { id: 'vat', label: 'الضريبة', icon: Receipt },
    { id: 'currencies', label: 'العملات', icon: Coins },
    { id: 'backup', label: 'النسخ الاحتياطي', icon: HardDrive },
  ];

  return (
    <div className="space-y-6">
      <h1>الإعدادات</h1>
      
      <div className="flex gap-4">
        <nav className="w-48 space-y-1">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'w-full flex items-center gap-2 px-4 py-2 rounded-lg',
                activeTab === tab.id ? 'bg-blue-100 text-blue-700' : 'hover:bg-slate-100'
              )}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </nav>
        
        <div className="flex-1">
          {activeTab === 'system' && <SystemSettings />}
          {activeTab === 'company' && <CompanySettings />}
          {activeTab === 'vat' && <VatSettings />}
          {activeTab === 'currencies' && <CurrencyManager />}
          {activeTab === 'backup' && <BackupManager />}
        </div>
      </div>
    </div>
  );
};
```

### 5.2 إعدادات الضريبة

```tsx
// VatSettings.tsx
export const VatSettings = () => {
  const { settings, updateSettings } = useVatSettings();

  return (
    <div className="card space-y-6">
      <h2>إعدادات الضريبة (VAT)</h2>
      
      <div className="flex items-center justify-between">
        <label>تفعيل الضريبة</label>
        <Switch checked={settings.isEnabled} onChange={(v) => updateSettings({ isEnabled: v })} />
      </div>
      
      <div>
        <label>نسبة الضريبة (%)</label>
        <Select 
          value={settings.rate} 
          onChange={(v) => updateSettings({ rate: v })}
          options={[
            { value: '5', label: '5%' },
            { value: '10', label: '10%' },
            { value: '15', label: '15%' },
            { value: 'custom', label: 'مخصص' },
          ]}
        />
      </div>
      
      <div>
        <label>رقم التسجيل الضريبي</label>
        <Input value={settings.registrationNumber} onChange={...} />
      </div>
    </div>
  );
};
```

---

## 6. API / Adapters

```ts
// api/queries.ts
export const settingsQueries = {
  getSystemSettings: async (companyId: string): Promise<SystemSettings | null> => {
    const result = await db.select().from(systemSettings).where(eq(systemSettings.companyId, companyId));
    return result[0] || null;
  },

  getVatSettings: async (companyId: string): Promise<VatSettings | null> => {
    const result = await db.select().from(vatSettings).where(eq(vatSettings.companyId, companyId));
    return result[0] || null;
  },

  getExchangeRates: async (companyId: string): Promise<ExchangeRate[]> => {
    return db.select().from(exchangeRates).where(eq(exchangeRates.companyId, companyId));
  },
};

// api/mutations.ts
export const settingsMutations = {
  updateSystemSettings: async (companyId: string, data: Partial<SystemSettings>): Promise<void> => {
    await db.update(systemSettings).set(data).where(eq(systemSettings.companyId, companyId));
  },

  updateVatSettings: async (companyId: string, data: Partial<VatSettings>): Promise<void> => {
    await db.update(vatSettings).set(data).where(eq(vatSettings.companyId, companyId));
  },

  addExchangeRate: async (data: CreateExchangeRateDto): Promise<ExchangeRate> => {
    return db.insert(exchangeRates).values(data).returning();
  },
};
```

---

## 7. تقسيم المهام

| # | المهمة | المدة | الأولوية |
|---|--------|-------|---------|
| 1 | Schema (systemSettings, vatSettings, exchangeRates) | 2 ساعة | عالية |
| 2 | صفحة الإعدادات الرئيسية | 3 ساعات | عالية |
| 3 | إعدادات النظام (اللغة، الثيم) | 2 ساعة | عالية |
| 4 | إعدادات الشركة | 2 ساعة | عالية |
| 5 | إعدادات الضريبة (VAT) | 3 ساعات | عالية |
| 6 | إدارة العملات | 3 ساعات | متوسطة |
| 7 | النسخ الاحتياطي | 2 ساعة | منخفضة |
| 8 | اختبارات الوحدات | 2 ساعة | متوسطة |

---

## 8. معايير القبول

- [ ] تغيير اللغة يعمل ويحفظ.
- [ ] تغيير الثيم يعمل (فاتح/داكن).
- [ ] تعديل بيانات الشركة يعمل.
- [ ] إعدادات الضريبة تعمل.
- [ ] إضافة/تعديل عملة يعمل.
- [ ] تحديث سعر الصرف يعمل.
- [ ] تصدير/استيراد البيانات يعمل.

---

## 9. المخرجات النهائية

1. **صفحة إعدادات** شاملة.
2. **نظام ضريبة** مرن.
3. **إدارة عملات** متعددة.
4. **نسخ احتياطي** وتصدير.
5. **اختبارات** للوحدة.

---

*تاريخ الإنشاء: 2026-05-24 | المسؤول: Settings Module Lead*
