# 📋 خطة تطوير التقارير — MaghzAccountFlash35

> التوثيق الرصيدي ( جزء تفصيلي من `REPORTING_MODERNIZATION_REPORT.md` )

## 🚀 Phase A — المحرك المشترك ( FINISHED)
- إنشاء `src/modules/reports/shared/` بمحرك جديد (TTL-based, PL/SQL-safe)

## 📊 Phase B — 12 صفحة تقرير جديدة ( FINISHED)
| الصفحة | المسار | المجال |
|---|---|---|
| TrialBalancePage | `/reports/trial-balance` | المالية (رصيد الميزانية) |
| PayrollReportPage | `/reports/payroll` | HR (رواتب) |
| AttendanceReportPage | `/reports/attendance` | HR (حضور) |
| EndOfServiceReportPage | `/reports/end-of-service` | HR (EOS) |
| RepPerformancePage | `/reports/rep-performance` | Sales |
| SalesCommissionReportPage | `/reports/sales-commission` | Sales |
| InventoryItemLedgerPage | `/reports/inventory-item-ledger` | المخزون (Item Ledger) |
| StockDiffReportPage | `/reports/stock-diff` | المخزون (Diff) |
| ManufacturingVariancePage | `/reports/manufacturing-variance` | التصنيع |
| ProductionCostReportPage | `/reports/production-cost` | التصنيع |
| DocInvoiceDetailsPage | `/reports/doc-invoices` | الفواتير (non-POS) |
| FixedAssetsDepreciationReportPage | `/reports/fixed-assets-depreciation` | الأصول (Depreciation) |

## 🛠️ Phase C — هندسة متطلبات ( FINISHED)
- Fix web worker timeout (vite build = 16,000ms)
- تنظيف unused imports, patterns mod (≈49 سطر)
- أضف QueryBuilder للـ `formPages` للكتلة الجديدة

## 📝 Phase D — توثيق وإصدار ( FINISHED)
- Changelog entry v0.36.0
- تحديث AGENTS.md (`English reports` per user request)

---

*آخر تحديث: 2026-11-24 | v0.36.0*
