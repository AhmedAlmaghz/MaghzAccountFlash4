# maghzaccount-pro v1.0

> **نظام ERP محاسبي متكامل للمنشآت الصغيرة والمتوسطة**

---

## المميزات الرئيسية

### الوحدات المتكاملة (11 وحدة)
- **الإعدادات** — بيانات الشركة، العملات، الضريبة، الفروع، المستخدمين، الأدوار
- **الصلاحيات** — RBAC مع Audit Trail كامل
- **الحسابات** — شجرة حسابات IFRS، قيود يومية، سندات قبض/صرف، تقارير مالية
- **المخازن** — منتجات (باركود)، مستودعات، جرد، تحويلات، تسويات
- **المبيعات** — فواتير (ترحيل تلقائي)، عملاء، عروض أسعار، مردودات
- **المشتريات** — فواتير، موردين، أوامر شراء، مردودات
- **التصنيع** — فاتير مواد (BOM)، أوامر تشغيل، تكاليف
- **الموارد البشرية** — موظفين، حضور، رواتب، إجازات، نهاية خدمة
- **علاقات العملاء** — عملاء محتملين، فرص (Kanban)، مهام، نشاطات
- **التقارير** — Dashboard تفاعلي، تقارير تحليلية، Report Builder

### الميزات التقنية
- **3 طبقات للبيانات**: PostgreSQL / Realm / Mock (Browser)
- **تصميم احترافي**: Tailwind v4 + Dark Mode + RTL + Glassmorphism
- **تكامل الأجهزة**: قارئ باركود (Camera/Keyboard) + طابعة حرارية
- **التصدير**: Excel, PDF, CSV مع دعم العربية (RTL)
- **الطباعة**: قوالب جاهزة لكل مستند
- **i18n**: عربي/إنجليزي

---

## متطلبات التشغيل

- Node.js 20+
- PostgreSQL 14+ (للإنتاج)
- npm أو yarn

---

## التثبيت

```bash
# استنساخ المستودع
git clone <repo-url>
cd maghzaccount-pro

# تثبيت التبعيات
npm install

# إعداد بيئة التطوير
cp .env.example .env.local
# عدّل .env.local ببيانات PostgreSQL

# توليد Migration
npx drizzle-kit generate
npx drizzle-kit migrate

# تشغيل التطوير (Web)
npm run dev

# تشغيل التطوير (Electron)
npm run electron:dev
```

---

## أوامر البناء

```bash
npm run dev        # وضع التطوير
npm run build      # بناء الإنتاج
npm run lint       # فحص الأخطاء
npm run test       # اختبارات الوحدات
npm run electron:build  # بناء Electron
```

---

## هيكل المشروع

```
src/
├── core/              # البنية المشتركة
│   ├── ui/components/ # Design System
│   ├── database/      # Schema + Adapters
│   ├── i18n/          # الترجمة
│   ├── utils/         # أدوات مشتركة
│   └── store/         # Zustand Store
├── modules/           # وحدات ERP
│   ├── settings/
│   ├── auth/
│   ├── accounting/
│   ├── inventory/
│   ├── sales/
│   ├── purchases/
│   ├── manufacturing/
│   ├── hr/
│   ├── crm/
│   └── reports/
├── app/               # Router + Layout
└── electron/          # Electron main
```

---

## الترخيص

خاص (Private) — جميع الحقوق محفوظة.

---

**الإصدار الحالي:** v1.0  
**آخر تحديث:** 2026-05-25
