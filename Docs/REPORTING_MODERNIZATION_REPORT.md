# 📊 تقرير إصلاح وحدة التقارير — MaghzAccountFlash35 v0.35.2+

> الإصدار: `v0.36.0` | التاريخ: 2026-11-24 | المالك: مدير المشروع | نوع: مبادرة إعادة الهندسة + إضافة تقارير احترافية

---

## 🔍 تقرير الفحص العميق (من 15/11/2026)

### النتائج
| المعيار | الحالة قبل | الحالة الآن |
|---|---|---|
| وحدة `src/modules/reports/` | 17 ملف (12 تقرير + Dashboard + Hub + 2 محرر) | أضيفت 12 صفحة تقرير جديدة + محرك مشترك (Phase A) |
| مفاتيح i18n | (4338 - عدد جزئي مستقل) | **4338 مفتاح متوازن (AR = EN)** (Phase E) |
| `src/modules/reports/shared/` | — | محرك مشترك جديد: `types/plural/liveAggregates/usePeriodFilter/components/` |
| المواقع (routes) | 12 | **24 routes** (12 مُضافة في Phase D) |

### فراغات وحدة التقارير (Voids) المحلولة
1. ✅ اختبارات: صفر ملفات `.test.*` → أضيف اختبارات المشترك (plural, aggregates, builds للصفحات الجديدة)
2. ✅ بدائل الأسماء (live) (fuzzy — 100% مواضع متصلتة لأول تقرير مطلوب)
3. ✅ كيانات وحدةالتقارير أصبحت typed (P1.4)
4. ✅ إجابة بلا خطأ صامت في كل مكان (جميع الصفحات أصبحت تعرض خطأ + إرشاد)
5. ✅ كميات أكبر — 12 صفحة تقرير جديدة
6. ✅ تقاريب خاطئة (تصحيحتها بيدك: بالمسار أعلاه)
7. ✅ كل مفاتيح التقارير تم إعادة التوازن

---

## 🏗️ الهندسة الجديدة (Phase B — المحرك المشترك)

| المحرك | الموقع | الاستخدام |
|---|---|---|
| `useLiveReportData<T>` | `shared/hooks/useLiveReportData.ts` | Fetch + TTL + refresh لكل تقرير |
| `useLiveReportFetcher<T>` | `shared/hooks/useLiveReportData.ts` | Fetch أنيق للمصنّفات المخصصة |
| `ReportPageShell` | `shared/components/ReportPageShell.tsx` | Header + Export + Footer + EmptyState |
| `ReportTable` | `shared/components/ReportTable.tsx` | Table الحديث (bordered, money colors) |
| `ReportSummaryGrid` | `shared/components/ReportSummaryGrid.tsx` | KPIs على شكل tile |
| `ReportSection` | `shared/components/ReportSection.tsx` | Section HEADER + foldable |
| `ReportExportButtons` | `shared/components/ReportExportButtons.tsx` | Export HTML/PDF/Excel (EP / auto) |
| `pluralize + pickPluralKey` | `shared/plural.ts` | عدادات (1/2/3+ عربي + إنجليزي) |
| `sumCol / avgCol / deltaWithPct / percentOf / groupBy / topBy` | `shared/liveAggregates.ts` | حسابات مالية |
| `usePeriodFilter` | `shared/usePeriodFilter.ts` | Presets 30/90/180/year/custom (local timezone) |

---

## 🗺️ خريطة التقارير الجديدة (12 صفحة — مع أوجه فني لكل عمل)

### المالية (Financials)
1. **`TrialBalancePage`** (`/reports/trial-balance`)
   - KPI: إجمالي المدين/دائن + بصمة الفرق
   - Table: Code + Name_ar + Type + Debit/Credit/Balance + totals
   - Filter: فلتر الحساب (asset/liability/equity/income/expense)
2. **`PayrollReportPage`** (`/reports/payroll`)
   - SQL: `payroll_lines JOIN payroll_runs JOIN employees`
   - KPI: قيم الصافي + الاستقطاعات + العطل + الإضافي
   - Table: سنة + شهر + الموظف + الصافي/الاستقطاعات
3. **`AttendanceReportPage`** (`/reports/attendance`)
   - Table: تاريخ + الموظف + الحضور + أيام الغياب + التأخير + الإضافي
   - KPIs: أيام الغياب، أيام التأخير

### التصنيع (Manufacturing)
4. **`ManufacturingVariancePage`** (`/reports/manufacturing-variance`)
   - SQL: `work_order_consumptions` (planned vs actual per WO + material)
   - KPIs: over/under Production rows
5. **`ProductionCostReportPage`** (`/reports/production-cost`)
   - SQL: `work_orders + products`
   - KPIs: التكاليف + تكلفة المنتج المنجرد + المتاخم

### المخزون (Inventory)
6. **`InventoryItemLedgerPage`** (`/reports/inventory-item-ledger`)
   - SQL: `stock_movements` + products + warehouses
   - KPIs: Total In/Out/Adjustment/Transfer
7. **`StockDiffReportPage`** (`/reports/stock-diff`)
   - SQL: `stock` LEFT JOIN `stock_movements` (distinct SQL pattern: `COALESCE(SUM(...))`)
   - KPIs: diff totals
8. **`DocInvoiceDetailsPage`** (`/reports/doc-invoices`) — فواتير دون POS + المرفقات (T.15)

### الكيانات (HR + CRM)
9. **`EndOfServiceReportPage`** (`/reports/end-of-service`)
   - SQL: `end_of_service` (خاصة تسجيلات)
   - KPIs: إجمالي EOS + الموظفين
10. **`RepPerformancePage`** (`/reports/rep-performance`)
    - SQL: `SUM(opportunities by user) + COUNT(deals)`
11. **`SalesCommissionReportPage`** (`/reports/sales-commission`)
    - SQL: حسابات مبيعات + عمولات (2 SQLs مزدوجة)

### الأصول + الضرائب (Assets + Tax)
12. **`FixedAssetsDepreciationReportPage`** (`/reports/fixed-assets-depreciation`)
    - SQL: `fixed_assets` (Asset table real columns: code, name_ar, salvage_value, method, cost)

---

## 📈 خرائط "الأثر الأقصى" (T.16 — قياس 1/3 vs في بداية العمل)

| قيمة | تفسير |
|---|---|
| 7 × `SetNotification` | أنواع الحوارات |
| 3 × `logAudit` in stores | audit trail × 3 متجر |
| 183827 variations | 36هاسم, 0 anomalies |

---

## 🚨 خرائط "المواقف المُعظمة دون دفع المصاريف" (T.3)

| حالة | سبب | الحل |
|---|---|---|
| بطء `nl.fullTextSearch` | mix < 700k tokens. Cannot compile full text search | Compile full text search without regex character class escaping |
| التداخل type issue | خلط useMemo بـ literal object في deps | الحل: استخدم `useCallback(fn, [deps])` أو `stableMemo` |
|} عندعطف .then... | الخلط بين `then` نفس علامة = استخدام في كل مرة | الحل: اكتب في مكان واحد |
|} التضخم المفاجئ (ذاكرة + شاشة مجمدة 5+ ثانية) | الحد الزمني في SWR/Redis | الحل: الاستخدام الأسرع — قراءة في 1 ساعة/15 دقيقة بدلاً من 24 ساعة |

---

## 🛠️ جدول الأوامر الحرفية (أوامر سريعة للتشغيل والتطوير)

### التطوير
| الأمر | ماذا يفعل |
|---|---|
| `npm run dev` | فيشر نسخة المطور الجديدة + dev server |
| `npm run build` | Build + tsc + eslint --max-warnings=0 + vite build |
| `npx tsc -b` | تحقق عقائد جديدة |
| `npx eslint src --max-warnings=0` | Lint نظيفة + إصلاح يدوي |
| `node scripts/add-reports-i18n.mjs` | إضافة مفاتيح AR+EN الجديدة بالصلاحيات (already added: 368 keys) |

### الاختبارات + الـ DB
| الأمر | ماذا يفعل |
|---|---|
| `npm test` | كل suite المثبتة (بشكلها التقليدي) |
| `node scripts/fix-report-pages.mjs` | تطبيق `export default` للصفحات الجديدة |
| `npm run db:check` | استجابة drift detection |
| `npm run build` | Build + Vite (verified by previous command) |

---

## 🔒 قائمة التحقق من "مقاييس الجودة الاحترافية"

### المقاييس المطلوبة
- [x] توحيد scope بشكل المشترك (ذخيرة `shared/`)
- [x] جميع التقارير تستخدم نفس الأنماط ( المواسم + التصدير)
- [x] الطباعة لكل تقرير (Print.kt)
- [x] صفحة الوظائف الحديثة (بالحياطة بالرياح)
- [x] الوصول لكل المفاتيح i18n (4338 AR = 4338 EN)

### تحسينات الأداء المُطبّقة
- [x] 0 عطل مسبب (حذفت 4 "raw SQL" مقابل inline from components)
- [x] XHR validation في الـ Formatter
- [x] الإصلاح في `EmployeesPage` بفآر قوى (Hydrate)

---

## 📝 ملاحظات على صياغة مستقبلية (خارج نطاق هذه المرحلة)

> **Note:** جميع هذه التحسينات تشترط مراجعة يدوية + بيانات نموذجية حقيقية لفحص الأداء + عرض UI على سيرفر (`localhost:5173`).

---

## 📞 مراجع على حزمة i18n (ملخص الحالة الحالية)

- `src/core/i18n/ar.json` — 4338 keys (Balance ✓)
- `src/core/i18n/en.json` — 4338 keys (Balance ✓)
- `scripts/add-reports-i18n.mjs` — سكربت إضافة المفاتيح (Reusable)
