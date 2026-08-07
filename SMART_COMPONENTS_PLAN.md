# خطة تنفيذ المكونات الذكية والشاشات الإدارية
## `maghzaccount-pro` — نظام ERP احترافي ذكي

> **تاريخ الإنشاء:** 2026-05-24
> **المرحلة:** تنفيذ فوري (Build Mode)
> **المدة التقديرية:** 10-15 جلسة

---

## 1. الرؤية

تحويل `maghzaccount-pro` من نظام يعتمد على `<select>` HTML عادية إلى نظام ذكي بمكونات `SmartSelect` احترافية مربوطة بعلاقات قاعدة البيانات، مع شاشات إدارية مركزية لإدارة الترقيم والتصنيفات والحسابات الافتراضية.

---

## 2. الجداول الجديدة (8 جداول)

| # | الجدول | الهدف |
|---|--------|-------|
| 1 | `document_sequences` | الترقيم المتسلسل لجميع المستندات |
| 2 | `product_types` | أنواع المنتجات مع قواعد الظهور |
| 3 | `product_categories` ← موجود لكن نضيف شاشة | تصنيفات المنتجات |
| 4 | `units` | وحدات القياس مع تحويل |
| 5 | `cash_boxes` | الصناديق ككيانات مستقلة |
| 6 | `banks` | البنوك ككيانات مستقلة |
| 7 | `cost_centers` | مراكز التكلفة |
| 8 | `payroll_components` | مكونات الراتب القابلة للتخصيص |
| 9 | `default_accounts` | الحسابات الافتراضية للقيود الآلية |

---

## 3. المكونات الذكية (Smart Components)

### البنية المقترحة

```
src/core/ui/components/smart/
├── SmartSelect.tsx              ← المحرك الأساسي (cmdk + Search + Create)
├── hooks/
│   └── useSmartSelect.ts        ← إدارة حالة البحث والتحميل
├── types.ts                     ← واجهات عامة مشتركة
└── fields/                      ← مكونات جاهزة لكل نوع
    ├── CurrencySelect.tsx
    ├── CustomerSelect.tsx
    ├── SupplierSelect.tsx
    ├── EmployeeSelect.tsx
    ├── AccountSelect.tsx        ← يدعم شجرة الحسابات
    ├── ProductSelect.tsx
    ├── WarehouseSelect.tsx
    ├── ProductCategorySelect.tsx
    ├── ProductTypeSelect.tsx
    ├── UnitSelect.tsx
    ├── BranchSelect.tsx
    ├── UserSelect.tsx
    ├── BankSelect.tsx
    ├── CashBoxSelect.tsx
    ├── CostCenterSelect.tsx
    ├── PayrollComponentSelect.tsx
    ├── BOMSelect.tsx
    ├── WorkOrderSelect.tsx
    ├── LeadSelect.tsx
    ├── OpportunitySelect.tsx
    └── index.ts
```

### المواصفات التقنية

| الميزة | الوصف |
|--------|-------|
| **بحث فوري** | كتابة 2-3 أحرف يُظهر النتائج المُرشحة |
| **إنشاء سريع** | زر `+ جديد` داخل القائمة يفتح Mini Modal |
| **عرض ذكي** | الاسم + الكود + معلومات مساعدة |
| **Tree Support** | `AccountSelect` يدعم شجرة حسابات منسدلة |
| **Multi-select** | دعم اختيار متعدد حيثما يحتاج |
| **Disabled items** | عناصر معطلة بلون باهت |
| **Clearable** | أيقونة × لمسح الاختيار |
| **Loading** | حالة تحميل عند جلب البيانات |
| **Keyboard Nav** | ↑ ↓ Enter Escape |

---

## 4. الشاشات الإدارية الجديدة (4 شاشات)

### 4.1 إدارة الترقيم المتسلسل (`DocumentSequencesPage`)
- جدول بجميع أنواع المستندات
- تعديل: البادئة، اللاحقة، الرقم الحالي، الخطوة، الـ padding
- معاينة رقم المستند التالي
- إعادة ضبط العداد
- خيار `yearReset` لإعادة العد سنوياً

### 4.2 تصنيفات المنتجات (`ProductCategoriesPage`)
- شجرة متداخلة (Tree View) مع سحب وإفلات
- إضافة/تعديل/حذف فئة مع اختيار الأب
- عدد المنتجات في كل فئة

### 4.3 أنواع المنتجات (`ProductTypesPage`)
- CRUD كامل لأنواع المنتجات
- **أعمدة تحكم الظهور:**
  - ☑️ يظهر في المبيعات
  - ☑️ يظهر في المشتريات
  - ☑️ يظهر في المخازن
  - ☑️ يظهر في التصنيع
  - ☑️ يتبع المخزون
  - ☑️ يدعم BOM
- ربط حسابات افتراضية لكل نوع

### 4.4 الحسابات الافتراضية (`DefaultAccountsPage`)
- قائمة بـ 14 دالة نظامية
- لكل دالة: اختيار الحساب من شجرة الحسابات (`AccountSelect`)
- تمييز الحسابات المطلوبة باللون الأحمر إذا فارغة
- زر "تطبيق القالب" (تجاري / تصنيعي / خدمات)

---

## 5. مراحل التنفيذ

### المرحلة 1: البنية التحتية
- [x] إنشاء 8 جداول جديدة في `schema/`
- [x] إضافة Seed Data واقعية
- [x] بناء APIs CRUD لكل جدول
- [x] بناء Hooks لكل جدول

### المرحلة 2: المحرك الأساسي
- [x] تثبيت `cmdk`
- [x] بناء `SmartSelect` العامة
- [x] بناء `useSmartSelect` hook

### المرحلة 3: المكونات الذكية المتخصصة
- [x] بناء 20+ مكون ذكي
- [x] ربط كل مكون بـ API + Hook
- [x] دعم `creatable`

### المرحلة 4: الشاشات الإدارية
- [x] `DocumentSequencesPage`
- [x] `ProductCategoriesPage`
- [x] `ProductTypesPage`
- [x] `DefaultAccountsPage`

### المرحلة 5: الدمج والتلميع
- [x] استبدال جميع `<select>` العادية بالمكونات الذكية
- [x] تحديث `journalEntryGenerator.ts` ليستخدم `default_accounts`
- [x] تحديث إنشاء الفواتير باستخدام `document_sequences`
- [x] اختبارات Vitest

---

## 6. القرارات التقنية

| القرار | القيمة | السبب |
|--------|--------|-------|
| مكتبة الـ dropdown | `cmdk` | خفيفة، احترافية، تدعم لوحة المفاتيح |
| Product Types | قابلة للتخصيص | tickboxes يتحكم فيها المستخدم |
| الحسابات الافتراضية | قوالب جاهزة | توفر وقت الإعداد الأولي |
| شجرة الحسابات | nested set / recursive | يدعم `AccountSelect` |
| الترقيم | مركزي | `document_sequences` يديره |

---

*آخر تحديث: 2026-05-24 | مفتوح للتنفيذ*
