# خطة تطوير المرحلة 0: البنية التحتية المشتركة (Core Upgrade)

## الوصف
إصلاحات بنيوية حرجة + تطوير Design System + مكونات مشتركة لكل الوحدات.

## المشاكل الحالية
1. `drizzle.config.ts` المسار `./src/database/schema.ts` غير موجود
2. لا يوجد `src/core/database/schema/index.ts`
3. `tailwind.config.js` يستخدم بنية v3 بينما CSS يستخدم v4
4. النصوص داخل المكونات hardcoded عربية
5. Table Component بسيط جداً
6. لا يوجد Form validation
7. لا يوجد Toast/Confirm dialogs
8. لا يوجد Detail View layout موحد

## الملفات المطلوب إنشاؤها/تعديلها

### إصلاحات بنيوية
| الملف | الإجراء | التفاصيل |
|-------|---------|----------|
| `drizzle.config.ts` | تعديل | المسار: `./src/core/database/schema/index.ts` |
| `src/core/database/schema/index.ts` | إنشاء | Export all schemas + relations |
| `tailwind.config.js` | حذف أو تحديث | Tailwind v4 يستخدم CSS config |
| `src/index.css` | تحديث | Theme جديد + Custom utilities |

### مكونات Design System الجديدة
| الملف | الغرض |
|-------|-------|
| `src/core/ui/components/DataTablePro.tsx` | TanStack Table + Pagination + Sort + Filter + Export + Bulk Actions |
| `src/core/ui/components/FormEngine.tsx` | Smart Form مع Zod validation |
| `src/core/ui/components/DetailView.tsx` | Layout موحد: Header + Tabs + Content + Audit Trail |
| `src/core/ui/components/FilterPanel.tsx` | فلاتر متقدمة (DateRange, Select, Search) |
| `src/core/ui/components/ConfirmDialog.tsx` | تأكيد الحذف/الترحيل |
| `src/core/ui/components/ToastProvider.tsx` | Toast notifications (sonner) |
| `src/core/ui/components/Breadcrumb.tsx` | مسار التنقل |
| `src/core/ui/components/EmptyState.tsx` | رسوم توضيحية عند عدم وجود بيانات |
| `src/core/ui/components/KpiCardPro.tsx` | بطاقات Dashboard محسّنة |
| `src/core/ui/components/StatusBadge.tsx` | Badges للحالات (Draft, Posted, Paid...) |
| `src/core/ui/components/ActionButtons.tsx` | أزرار CRUD موحدة (عرض، تعديل، حذف، طباعة، تصدير) |

### Utilities جديدة
| الملف | الغرض |
|-------|-------|
| `src/core/utils/printDocument.ts` | قوالب طباعة احترافية (فاتورة، سند، عرض سعر...) |
| `src/core/utils/exportEngine.ts` | PDF/Excel/CSV engine موحد |
| `src/core/utils/barcodeScanner.ts` | تكامل قارئ الباركود |
| `src/core/utils/thermalPrinter.ts` | تكامل طابعة حرارية |
| `src/core/utils/useDocumentSequence.ts` | Hook لتوليد الأرقام التسلسلية من الإعدادات |
| `src/core/utils/useSettings.ts` | Hook لجلب الإعدادات (VAT, Currency, Accounts) |
| `src/core/utils/auditLogger.ts` | تسجيل العمليات في audit_logs |

### i18n
| الملف | الإجراء |
|-------|---------|
| `src/core/i18n/ar.json` | تحديث شامل (جميع المفاتيح لكل الوحدات) |
| `src/core/i18n/en.json` | تحديث شامل |

## التصميم الجديد

### الألوان (Indigo-Slate Theme)
| العنصر | Light | Dark |
|--------|-------|------|
| Primary | `#4f46e5` (indigo-600) | `#6366f1` (indigo-500) |
| Background | `#ffffff` | `#0f172a` (slate-900) |
| Surface | `#f8fafc` (slate-50) | `#1e293b` (slate-800) |
| Text | `#0f172a` (slate-900) | `#f8fafc` (slate-50) |
| Success | `#10b981` | `#34d399` |
| Warning | `#f59e0b` | `#fbbf24` |
| Danger | `#ef4444` | `#f87171` |
| Info | `#3b82f6` | `#60a5fa` |
| Gold (Financial) | `#d97706` | `#fbbf24` |

### Typography
- Arabic: Cairo (موجود)
- English: Inter (موجود)
- Numbers: `font-variant-numeric: tabular-nums`

### Effects
- Glassmorphism خفيف في Cards
- Shadows: `shadow-sm`, `shadow-md` للـ hover
- Border radius: `rounded-xl` للبطاقات
- Transitions: `150ms ease-out`

### Animations (Framer Motion)
- Page transition: Fade + slide up
- Modal: Scale + fade
- List items: Staggered fade in
- Kanban cards: Drag smooth

## المكتبات الجديدة
```bash
npm install @tanstack/react-table @tanstack/react-virtual
npm install zod react-hook-form @hookform/resolvers
npm install framer-motion
npm install sonner
npm install @radix-ui/react-dialog @radix-ui/react-dropdown-menu @radix-ui/react-tabs @radix-ui/react-tooltip
npm install date-fns
npm install jspdf html2canvas
npm install file-saver
npm install barcode-detector   # for barcode scanner
```

## ترتيب التنفيذ
1. إصلاح drizzle.config.ts + schema/index.ts
2. تحديث index.css (Tailwind v4 theme)
3. إنشاء DataTablePro
4. إنشاء FormEngine
5. إنشاء DetailView + FilterPanel + ConfirmDialog + ToastProvider
6. إنشاء utilities (print, export, barcode, thermal, audit)
7. تحديث i18n files
8. اختبار البنية
