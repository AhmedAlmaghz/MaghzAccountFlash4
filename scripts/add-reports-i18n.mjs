#!/usr/bin/env node
// Add i18n keys for the new professional reports (reports.* + sidebar.reports.*).
// Run: node scripts/add-reports-i18n.mjs
import fs from 'fs';

const AR_FILE = 'src/core/i18n/ar.json';
const EN_FILE = 'src/core/i18n/en.json';

const ar = JSON.parse(fs.readFileSync(AR_FILE, 'utf8'));
const en = JSON.parse(fs.readFileSync(EN_FILE, 'utf8'));

function getPath(obj, path) {
  let cur = obj;
  for (const p of path.split('.')) { if (cur[p] == null) return undefined; cur = cur[p]; }
  return cur;
}

function setPath(obj, path, value) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

// Tuple: [i18n key, Arabic, English]
const entries = [
  ['reports.tb.title', 'قائمة الحسابات (رصيد الميزانية)', 'Trial Balance (Balance Sheet)'],
  ['reports.tb.subtitle', 'عدد الحسابات + أصول مقارنة مع رصيد ختامي', 'Total Debit / Total Credit / Net Balance of every account'],
  ['reports.tb.fromDate', 'من تاريخ', 'From date'],
  ['reports.tb.toDate', 'إلى تاريخ', 'To date'],
  ['reports.tb.allTypes', 'كل الأنواع', 'All types'],
  ['reports.tb.totalDebit', 'إجمالي المدين', 'Total Debit'],
  ['reports.tb.totalCredit', 'إجمالي الدائن', 'Total Credit'],
  ['reports.tb.difference', 'الفرق (د/إ)', 'Difference (Dr/Cr)'],
  ['reports.tb.accountsCount', 'عدد الحسابات', 'Accounts count'],
  ['reports.tb.total', 'الإجمالي', 'Total'],

  ['reports.payroll.title', 'قائمة الرواتب والاستقطاعات', 'Payroll Report'],
  ['reports.payroll.subtitle', 'رواتب فردية + استقطاعات حسب الفترة', 'Employee salaries + deductions'],
  ['reports.payroll.allStatuses', 'كل الحالات', 'All statuses'],
  ['reports.payroll.totalNet', 'إجمالي الصافي', 'Total Net'],
  ['reports.payroll.totalDeductions', 'إجمالي الاستقطاعات', 'Total Deductions'],
  ['reports.payroll.totalAllowances', 'إجمالي المكمّلات', 'Total Allowances'],
  ['reports.payroll.totalOvertime', 'إجمالي الساعات الإضافية', 'Total Overtime Hours'],
  ['reports.payroll.employeesCount', 'عدد الموظفين', 'Employees count'],
  ['reports.payroll.month', 'الشهر', 'Month'],
  ['reports.payroll.year', 'السنة', 'Year'],
  ['reports.payroll.total', 'الإجمالي', 'Total'],

  ['reports.attendance.title', 'قائمة الحضور والانصراف', 'Attendance Report'],
  ['reports.attendance.subtitle', 'أيام الغياب + التأخير والساعات الإضافية', 'Absent / Late days + Overtime'],
  ['reports.attendance.from', 'من', 'From'],
  ['reports.attendance.to', 'إلى', 'To'],
  ['reports.attendance.status', 'الحالة', 'Status'],
  ['reports.attendance.presentDays', 'الحضور/يوم عمل', 'Present/Working days'],
  ['reports.attendance.absentDays', 'أيام الغياب', 'Absent days'],
  ['reports.attendance.lateDays', 'أيام التأخير', 'Late days'],
  ['reports.attendance.totalOvertime', 'إجمالي الساعات الإضافية', 'Total Overtime Hours'],

  ['reports.eos.title', 'قائمة إنهاء الخدمة (EOS)', 'End of Service Report'],
  ['reports.eos.subtitle', 'إنهاء الخدمة للموظفين المفروضة', 'Termination dates + EOS amounts'],
  ['reports.eos.allStatuses', 'كل الحالات', 'All statuses'],
  ['reports.eos.totalEos', 'إجمالي إنهاء الخدمة', 'Total EOS Amount'],
  ['reports.eos.employeesCount', 'عدد الموظفين', 'Employees count'],
  ['reports.eos.avgEos', 'متوسط المبلغ لكل عام', 'Avg. EOS per year'],
  ['reports.eos.terminationDate', 'تاريخ الإنهاء', 'Termination Date'],
  ['reports.eos.serviceYears', 'سنوات الخدمة', 'Service Years'],
  ['reports.eos.lastSalary', 'الراتب الأخير', 'Last Salary'],
  ['reports.eos.eosAmount', 'مبلغ الإنهاء', 'EOS Amount'],
  ['reports.eos.reason', 'السبب', 'Reason'],
  ['reports.eos.total', 'الإجمالي', 'Total'],

  ['reports.repPerf.title', 'أداء المندوبين (Performance)', 'Sales Rep Performance'],
  ['reports.repPerf.subtitle', 'صفقات + مبيعات حسب المندوب والمصوب', 'Deals + Sales Performance per Rep'],
  ['reports.repPerf.allReps', 'كل المندوبين', 'All reps'],
  ['reports.repPerf.reps', 'عدد المندوبين', 'Reps count'],
  ['reports.repPerf.totalWon', 'إجمالي الصفقات الفازت بها', 'Total Won Value'],
  ['reports.repPerf.totalPipeline', 'إجمالي بورباي حالية', 'Total Current Pipeline'],
  ['reports.repPerf.repName', 'اسم المندوب', 'Rep Name'],
  ['reports.repPerf.deals', 'عدد الصفقات', 'Deals'],
  ['reports.repPerf.won', 'الصفقات الفازت', 'Won'],
  ['reports.repPerf.lost', 'الصفقات الخسرت', 'Lost'],
  ['reports.repPerf.winRate', 'نسبة الفوز', 'Win Rate'],
  ['reports.repPerf.pipelineValue', 'قيمة بورباي حالية', 'Pipeline Value'],
  ['reports.repPerf.wonValue', 'قيمة الصفقات الفازت', 'Won Value'],
  ['reports.repPerf.lossValue', 'قيمة الصفقات الخسرة', 'Lost Value'],
  ['reports.repPerf.avgDeal', 'متوسط قيمة الصفقة', 'Avg Deal Value'],
  ['reports.repPerf.total', 'الإجمالي', 'Total'],

  ['reports.commission.title', 'قائمة العمولات (Sales Commission)', 'Sales Commission Report'],
  ['reports.commission.subtitle', 'عمولات بنسبة محددة على الفواتير المبيعات', 'Commission calculation for sales invoices'],
  ['reports.commission.from', 'من', 'From'],
  ['reports.commission.to', 'إلى', 'To'],
  ['reports.commission.rate', 'نسبة العمولة (%)', 'Commission Rate (%)'],
  ['reports.commission.totalCommission', 'إجمالي العمولات', 'Total Commission'],
  ['reports.commission.invoicesCount', 'عدد الفواتير', 'Invoices count'],
  ['reports.commission.date', 'التاريخ', 'Date'],
  ['reports.commission.invoice', 'رقم الفاتورة', 'Invoice Number'],
  ['reports.commission.customer', 'اسم العميل', 'Customer Name'],
  ['reports.commission.invoiceTotal', 'إجمالي الفاتورة', 'Invoice Total'],
  ['reports.commission.commissionAmount', 'مبلغ العمولة', 'Commission Amount'],
  ['reports.commission.total', 'الإجمالي', 'Total'],

  ['reports.inventoryLedger.title', 'قائمة حركة المخزون (Item Ledger)', 'Inventory Item Ledger'],
  ['reports.inventoryLedger.subtitle', 'جميع حركات المخزون بتاريخ + مرجع', 'All stock movements with date + reference'],
  ['reports.inventoryLedger.productFilter', 'اختر المنتج', 'Select product'],
  ['reports.inventoryLedger.from', 'من', 'From'],
  ['reports.inventoryLedger.to', 'إلى', 'To'],
  ['reports.inventoryLedger.totalIn', 'إجمالي الورودات', 'Total In'],
  ['reports.inventoryLedger.totalOut', 'إجمالي المصروفات', 'Total Out'],
  ['reports.inventoryLedger.totalAdjustment', 'إجمالي التسويات', 'Total Adjustments'],
  ['reports.inventoryLedger.totalTransfer', 'إجمالي التحويلات', 'Total Transfers'],
  ['reports.inventoryLedger.date', 'التاريخ', 'Date'],
  ['reports.inventoryLedger.product', 'المنتج', 'Product'],
  ['reports.inventoryLedger.type', 'النوع', 'Type'],
  ['reports.inventoryLedger.warehouse', 'المستودع', 'Warehouse'],
  ['reports.inventoryLedger.quantity', 'الكمية', 'Quantity'],
  ['reports.inventoryLedger.reference', 'المرجع', 'Reference'],

  ['reports.stockDiff.title', 'فرق المخزون (Stock Diff)', 'Stock Difference'],
  ['reports.stockDiff.subtitle', 'مقارنة كميات بين نقطتي زمنيتين', 'Difference of quantities between two dates'],
  ['reports.stockDiff.from', 'من', 'From'],
  ['reports.stockDiff.to', 'إلى', 'To'],
  ['reports.stockDiff.allWarehouses', 'كل المستودعات', 'All warehouses'],
  ['reports.stockDiff.totalDiff', 'إجمالي الفرق', 'Total Difference'],
  ['reports.stockDiff.totalIn', 'إجمالي الورودات', 'Total In'],
  ['reports.stockDiff.totalOut', 'إجمالي المصروفات', 'Total Out'],
  ['reports.stockDiff.product', 'المنتج', 'Product'],
  ['reports.stockDiff.warehouse', 'المستودع', 'Warehouse'],
  ['reports.stockDiff.qtyBefore', 'قبل', 'Before'],
  ['reports.stockDiff.qtyAfter', 'بعد', 'After'],
  ['reports.stockDiff.diff', 'الفرق', 'Diff'],

  ['reports.mfgVariance.title', 'تحليل تفاوت إنتاج (Variance)', 'Manufacturing Variance Analysis'],
  ['reports.mfgVariance.subtitle', 'تفاوت planned vs actual في ساعات الإنتاج', 'Planned vs Actual Variance'],
  ['reports.mfgVariance.allStatuses', 'كل الحالات', 'All statuses'],
  ['reports.mfgVariance.overProduction', 'إنتاج إضافي', 'Overproduction'],
  ['reports.mfgVariance.underProduction', 'نقص في الإنتاج', 'Underproduction'],
  ['reports.mfgVariance.totalRows', 'عدد الصفوف', 'Total Rows'],
  ['reports.mfgVariance.orderNumber', 'رقم الأمر', 'Order Number'],
  ['reports.mfgVariance.status', 'الحالة', 'Status'],
  ['reports.mfgVariance.material', 'المادة', 'Material'],
  ['reports.mfgVariance.plannedQuantity', 'الكمية المخططة', 'Planned Qty'],
  ['reports.mfgVariance.actualQuantity', 'الكمية الفعلية', 'Actual Qty'],
  ['reports.mfgVariance.plannedUnitCost', 'تكلفة المخططة', 'Planned Unit Cost'],
  ['reports.mfgVariance.actualUnitCost', 'التكلفة الفعلية', 'Actual Unit Cost'],

  ['reports.prodCost.title', 'تكلفة الإنتاج (Production Cost)', 'Production Cost Report'],
  ['reports.prodCost.subtitle', 'تكلفة WIP + الإنتاج التام حسب الأوامر', 'Production WIP + Finished Products by Orders'],
  ['reports.prodCost.productFilter', 'اختر المنتج', 'Select product'],
  ['reports.prodCost.orderNumber', 'رقم الأمر', 'Order Number'],
  ['reports.prodCost.product', 'المنتج', 'Product'],
  ['reports.prodCost.status', 'الحالة', 'Status'],
  ['reports.prodCost.quantity', 'الكمية', 'Quantity'],
  ['reports.prodCost.producedQty', 'المنتج التام', 'Produced Qty'],
  ['reports.prodCost.wipCost', 'تكلفة الخامات', 'WIP Cost'],
  ['reports.prodCost.totalCost', 'إجمالي التكلفة', 'Total Cost'],
  ['reports.prodCost.actualStart', 'البداية الفعلية', 'Actual Start'],
  ['reports.prodCost.actualEnd', 'النهاية الفعلية', 'Actual End'],
  ['reports.prodCost.totalCost', 'الإجمالي', 'Total'],
  ['reports.prodCost.completedCount', 'الأوامر المنتهية', 'Completed Orders'],
  ['reports.prodCost.inProgressCount', 'الأوامر قيد التشغيل', 'In Progress Orders'],

  ['reports.docDetails.title', 'تفاصيل الفواتير (Doc Invoice Details)', 'Invoice Details (Docs)'],
  ['reports.docDetails.subtitle', 'فواتير دون POS + الدفعات + المرفقات', 'Non-POS invoices with payments + attachments'],
  ['reports.docDetails.allTypes', 'كل الأنواع', 'All types'],
  ['reports.docDetails.totalRevenue', 'إجمالي الإيرادات', 'Total Revenue'],
  ['reports.docDetails.totalPaid', 'إجمالي المدفوعات', 'Total Paid'],
  ['reports.docDetails.totalAttachments', 'إجمالي المرفقات', 'Total Attachments'],
  ['reports.docDetails.docsCount', 'عدد الفواتير', 'Docs count'],
  ['reports.docDetails.date', 'التاريخ', 'Date'],
  ['reports.docDetails.invoice', 'رقم الفاتورة', 'Invoice'],
  ['reports.docDetails.customer', 'اسم العميل', 'Customer'],
  ['reports.docDetails.total', 'الإجمالي', 'Total'],
  ['reports.docDetails.paid', 'المدفوع', 'Paid'],
  ['reports.docDetails.paymentType', 'نوع الدفع', 'Payment Type'],
  ['reports.docDetails.status', 'الحالة', 'Status'],
  ['reports.docDetails.attachmentsCount', 'عدد المرفقات', 'Attachments'],

  ['reports.assetsDepr.title', 'تقرير الاستهلاك الخطي (Depreciation)', 'Fixed Assets Depreciation Report'],
  ['reports.assetsDepr.subtitle', 'الأصول الثابتة + الاستهلاك حسب الحيات المتبقية', 'Fixed Assets Register + Depreciation'],
  ['reports.assetsDepr.allStatuses', 'كل الحالات', 'All statuses'],
  ['reports.assetsDepr.active', 'نشط', 'Active'],
  ['reports.assetsDepr.disposed', 'مُنهي', 'Disposed'],
  ['reports.assetsDepr.totalAssetsValue', 'إجمالي قيمة الأصول', 'Total Assets Value'],
  ['reports.assetsDepr.totalDeprAccumulated', 'إجمالي الاستهلاك المتراكم', 'Total Accumulated Depr.'],
  ['reports.assetsDepr.remainingValue', 'القيمة المتبقية', 'Remaining Value'],
  ['reports.assetsDepr.assetsCount', 'عدد الأصول', 'Assets count'],
  ['reports.assetsDepr.code', 'الكود', 'Code'],
  ['reports.assetsDepr.name', 'الاسم', 'Name'],
  ['reports.assetsDepr.category', 'الفئة', 'Category'],
  ['reports.assetsDepr.purchaseDate', 'تاريخ الشراء', 'Purchase Date'],
  ['reports.assetsDepr.cost', 'التكلفة', 'Cost'],
  ['reports.assetsDepr.accumulatedDepr', 'الاستهلاك المتراكم', 'Accumulated Depr.'],
  ['reports.assetsDepr.currentBalance', 'الرصيد الحالي', 'Current Balance'],
  ['reports.assetsDepr.method', 'طريقة الإهلاك', 'Method'],
  ['reports.assetsDepr.status', 'الحالة', 'Status'],
  ['reports.assetsDepr.total', 'الإجمالي', 'Total'],

  ['reports.hub.trialBalance.desc', 'قائمة الحسابات (رصيد الميزانية) الحية', 'Live Trial Balance of accounts'],
  ['reports.hub.payroll.desc', 'قائمة رواتب الموظفين الحية', 'Live payroll for employees'],
  ['reports.hub.attendance.desc', 'قائمة حضور الحضور والغياب', 'Attendance report for presence and absence'],
  ['reports.hub.endOfService.desc', 'قائمة إنهاء خدمة الموظفين', 'Employee End of Service (EOS) register'],
  ['reports.hub.repPerformance.desc', 'أداء المندوبين (مبيعات + صفقات)', 'Sales Rep performance (deals + sales)'],
  ['reports.hub.salesCommission.desc', 'عمولات المبيعات بنسبة محددة', 'Sales commission by percentage'],
  ['reports.hub.inventoryItemLedger.desc', 'قائمة حركة المخزون الحية', 'Live inventory movement ledger'],
  ['reports.hub.stockDiff.desc', 'فروقات كميات المخزون بين تواريخ', 'Stock quantity differences between two dates'],
  ['reports.hub.mfgVariance.desc', 'تفاوت كميات إنتاج الأوامر', 'Production planned vs actual variance'],
  ['reports.hub.prodCost.desc', 'تكاليف الإنتاج (WIP + تام)', 'Production costs (WIP + finished)'],
  ['reports.hub.docDetails.desc', 'تفاصيل الفواتير (دون POS)', 'Invoice details without POS'],
  ['reports.hub.assetsDepr.desc', 'تقرير الاستهلاك الخطي (Fixed Assets)', 'Fixed assets depreciation register'],

  ['sidebar.reports.trialBalance', 'قائمة الحسابات (رصيد الميزانية)', 'Trial Balance (Balance Sheet)'],
  ['sidebar.reports.payroll', 'قائمة الرواتب والاستقطاعات', 'Payroll Report'],
  ['sidebar.reports.attendance', 'قائمة الحضور والانصراف', 'Attendance Report'],
  ['sidebar.reports.endOfService', 'قائمة إنهاء الخدمة (EOS)', 'End of Service Report'],
  ['sidebar.reports.repPerformance', 'أداء المندوبين', 'Sales Rep Performance'],
  ['sidebar.reports.salesCommission', 'قائمة العمولات', 'Sales Commission Report'],
  ['sidebar.reports.inventoryItemLedger', 'قائمة حركة المخزون (Item Ledger)', 'Inventory Item Ledger'],
  ['sidebar.reports.stockDiff', 'فرق المخزون (Stock Diff)', 'Stock Difference'],
  ['sidebar.reports.manufacturingVariance', 'تحليل تفاوت إنتاج', 'Manufacturing Variance Analysis'],
  ['sidebar.reports.productionCost', 'تكلفة الإنتاج', 'Production Cost Report'],
  ['sidebar.reports.docInvoices', 'تفاصيل الفواتير (Docs)', 'Invoice Details'],
  ['sidebar.reports.fixedAssetsDepreciation', 'تقرير الاستهلاك الخطي', 'Fixed Assets Depreciation Report'],
];

let added = 0;
for (const [k, a, e] of entries) {
  const existingA = getPath(ar, k); const existingE = getPath(en, k);
  if (existingA === undefined) { setPath(ar, k, a); added++; }
  if (existingE === undefined) { setPath(en, k, e); added++; }
}

// Balance check: same key count in both files
function countKeys(obj, prefix = '') {
  let n = 0;
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object') n += countKeys(v, prefix + k + '.');
    else n++;
  }
  return n;
}

fs.writeFileSync(AR_FILE, JSON.stringify(ar, null, 2) + '\n');
fs.writeFileSync(EN_FILE, JSON.stringify(en, null, 2) + '\n');
console.log(`Added ${added} keys. ar=${countKeys(ar)} en=${countKeys(en)}`);
