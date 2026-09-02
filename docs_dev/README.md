# 📚 التوثيق الاحترافي — maghzaccount-pro

> **المرجع الرسمي الشامل** لنظام المحاسبة وال تخطيط للموارد المؤسسية — maghzaccount-pro v0.11.1

---

## 🗂️ هيكل التوثيق

```
docs_dev/
├── README.md                        ← هذا الملف (الفهرس الرئيسي)
├── 01-getting-started/             ← البدء والتهيئة
├── 02-user-guide/                   ← أدلة المستخدم لكل وحدة
├── 03-reports/                      ← التقارير والتحليلات
├── 04-ai-assistant/                 ← الوكيل المحاسبي الذكي
├── 05-technical/                    ← التوثيق التقني
└── 06-appendix/                     ← الملاحق والمراجع
```

---

## 📖 دليل القراءة السريع

### أنت مستخدم جديد؟
1. ابدأ بـ **[نظرة عامة على النظام](01-getting-started/01-overview.md)**
2. ثم **[التثبيت والتهيئة الأولى](01-getting-started/02-installation.md)**
3. ثم **[معالج التهيئة الأول](01-getting-started/03-onboarding.md)**
4. ثم **[تسجيل الدخول والواجهة الرئيسية](01-getting-started/04-login-interface.md)**

### أنت محاسب؟
- **[وحدة الحسابات](02-user-guide/01-accounting.md)** — القيود، الشجرة، السندات، التقارير المالية
- **[دليل المستخدمات المالية (المبيعات والمشتريات)](02-user-guide/03-sales.md)**

### أنت مدير نظام؟
- **[الإعدادات الكاملة](02-user-guide/10-settings.md)** — كل ما يُضبط
- **[المستخدمون والصلاحيات (RBAC)](02-user-guide/11-users-roles.md)**
- **[قاعدة البيانات والنسخ الاحتياطي](05-technical/03-database.md)**

### أنت مطور؟
- **[البنية المعمارية](05-technical/01-architecture.md)**
- **[مرجع قاعدة البيانات](05-technical/03-database.md)**
- **[مرجع واجهات API](05-technical/04-api-reference.md)**

---

## 📋 جدول المحتويات الكامل

### 📁 01-getting-started — البدء والتهيئة
| الملف | المحتوى |
|---|---|
| [01-overview.md](01-getting-started/01-overview.md) | نظرة عامة على النظام والميزات والوحدات |
| [02-installation.md](01-getting-started/02-installation.md) | متطلبات التشغيل، التثبيت، أوضاع قاعدة البيانات |
| [03-onboarding.md](01-getting-started/03-onboarding.md) | معالج التهيئة الأول خطوة بخطوة (قاعدة بيانات → شركة → بيانات أولية) |
| [04-login-interface.md](01-getting-started/04-login-interface.md) | تسجيل الدخول، الجلسات، الواجهة الرئيسية (الشريط الجانبي، الرأس، الأوامر السريعة) |
| [05-quickstart-workflow.md](01-getting-started/05-quickstart-workflow.md) | سير عمل كامل من الصفر: منتج → عميل → فاتورة → سند → تقرير |

### 📁 02-user-guide — أدلة المستخدم (11 وحدة)
| الملف | المحتوى |
|---|---|
| [01-accounting.md](02-user-guide/01-accounting.md) | الحسابات: شجرة الحسابات، قيود اليومية، دفتر الأستاذ، ميزان المراجعة، الميزانية، الأرباح والخسائر، التدفق النقدي، سندات القبض والصرف |
| [02-inventory.md](02-user-guide/02-inventory.md) | المخازن: المنتجات، المستودعات، الأرصدة، الحركات، التسويات، التحويلات |
| [03-sales.md](02-user-guide/03-sales.md) | المبيعات: فواتير (نقدي/آجل)، عملاء، عروض أسعار، مردودات، الدفعات والخصومات |
| [04-purchases.md](02-user-guide/04-purchases.md) | المشتريات: فواتير، أوامر شراء، موردون، مردودات |
| [05-manufacturing.md](02-user-guide/05-manufacturing.md) | التصنيع: BOM، أوامر التشغيل، دورة الإنتاج، تكاليف الإنتاج، تحليل الانحرافات |
| [06-hr.md](02-user-guide/06-hr.md) | الموارد البشرية: موظفون، أقسام، حضور، رواتب، إجازات، نهاية الخدمة |
| [07-crm.md](02-user-guide/07-crm.md) | علاقات العملاء: محتملون، فرص (Kanban)، مهام، أنشطة |
| [08-dashboard.md](02-user-guide/08-dashboard.md) | لوحة التحكم الرئيسية: KPIs، المخططات، التنبيهات، الفلترة |
| [10-settings.md](02-user-guide/10-settings.md) | الإعدادات الكاملة: شركة، عملات، ضريبة، تسلسلات، خزائن، حسابات افتراضية، سياسات HR، نسخ احتياطي |
| [11-users-roles.md](02-user-guide/11-users-roles.md) | المستخدمون، الأدوار، نظام الصلاحيات RBAC، سجل التدقيق |

### 📁 03-reports — التقارير
| الملف | المحتوى |
|---|---|
| [01-reports-hub.md](03-reports/01-reports-hub.md) | مركز التقارير + نظرة شاملة |
| [02-financial-reports.md](03-reports/02-financial-reports.md) | التقارير المالية (ميزان، ميزانية، أرباح، تدفق) |
| [03-sales-purchase-reports.md](03-reports/03-sales-purchase-reports.md) | تقارير المبيعات والمشتريات |
| [04-inventory-reports.md](03-reports/04-inventory-reports.md) | تقارير المخزون (تقييم، حركة، نواقص، تحليل ABC) |
| [05-customer-supplier-statements.md](03-reports/05-customer-supplier-statements.md) | كشوف الحسابات وأعمار الديون |
| [06-crm-reports.md](03-reports/06-crm-reports.md) | تقارير CRM (تحويل المحتملين، أنباق الفرص) |
| [07-custom-report-builder.md](03-reports/07-custom-report-builder.md) | منشئ التقارير المخصصة |
| [08-export-print.md](03-reports/08-export-print.md) | التصدير (Excel/PDF) والطباعة |

### 📁 04-ai-assistant — الوكيل الذكي
| الملف | المحتوى |
|---|---|
| [01-ai-overview.md](04-ai-assistant/01-ai-overview.md) | نظرة شاملة على الوكيل المحاسبي الذكي |
| [02-ai-setup.md](04-ai-assistant/02-ai-setup.md) | إعداد المزود (Gemini/OpenAI/...) ومفتاح API |
| [03-ai-usage.md](04-ai-assistant/03-ai-usage.md) | الاستخدام اليومي: المحادثة، بطاقات الموافقة، الإدخال الصوتي |
| [04-ai-tools.md](04-ai-assistant/04-ai-tools.md) | مرجع الأدوات الكامل (249 أداة) |
| [05-ai-safety.md](04-ai-assistant/05-ai-safety.md) | حوادث الأمان: الموافقات، حارس الهلوسة، حارس التكرار |

### 📁 05-technical — التوثيق التقني
| الملف | المحتوى |
|---|---|
| [01-architecture.md](05-technical/01-architecture.md) | البنية المعمارية (Electron + React + TypeScript + PostgreSQL) |
| [02-security.md](05-technical/02-security.md) | الأمان: الجلسات، RBAC على مستويين، عزل الشركات، حماية SQL |
| [03-database.md](05-technical/03-database.md) | قاعدة البيانات: 58 جدولاً، الترحيلات، الأرصدة الافتتاحية |
| [04-api-reference.md](05-technical/04-api-reference.md) | مرجع واجهات API لكل وحدة |
| [05-multicurrency.md](05-technical/05-multicurrency.md) | نظام تعدد العملات |
| [06-document-numbering.md](05-technical/06-document-numbering.md) | نظام ترقيم المستندات |

### 📁 06-appendix — الملاحق
| الملف | المحتوى |
|---|---|
| [01-glossary.md](06-appendix/01-glossary.md) | المسرد المحاسبي (عربي ↔ إنجليزي) |
| [02-permissions-matrix.md](06-appendix/02-permissions-matrix.md) | مصفوفة الصلاحيات الكاملة |
| [03-workflows.md](06-appendix/03-workflows.md) | مخططات سير العمل (دورات حياة المستندات) |
| [04-troubleshooting.md](06-appendix/04-troubleshooting.md) | حل المشكلات الشائعة |
| [05-faq.md](06-appendix/05-faq.md) | الأسئلة الشائعة |

---

## 🏷️ معلومات النسخة

| البند | القيمة |
|---|---|
| **الإصدار** | v0.11.1 |
| **المنصة** | Electron (سطح المكتب) + Web Browser |
| **اللغات** | العربية (افتراضي RTL) + الإنجليزية |
| **قاعدة البيانات** | PostgreSQL 16+ / PGlite (محلية) |
| **الوحدات** | 11 وحدة ERP متكاملة |
| **الجداول** | 58 جدولاً |
| **صفحات التطبيق** | 59 صفحة |

---

*آخر تحديث للتوثيق: 2026-09-02*
