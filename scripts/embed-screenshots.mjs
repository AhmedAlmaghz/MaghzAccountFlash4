// إدراج لقطات الشاشة في ملفات توثيق Docs2 — idempotent
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = 'Docs2';

// [الملف، [[نص العنوان، [صور: [مسار الأصل، الوصف]]]]]
const PLAN = [
  ['02-getting-started/02-first-run-wizard.md', [
    ['الخطوة 1: الترحيب', [['getting-started/onboarding-01-welcome.png', 'شاشة الترحيب في معالج الإعداد الأول']]],
    ['الخطوة 2: قاعدة البيانات', [['getting-started/onboarding-02-database.png', 'خطوة اختيار قاعدة البيانات']]],
    ['الخطوة 3: بيانات الشركة', [['getting-started/onboarding-03-company.png', 'خطوة بيانات الشركة']]],
    ['الخطوة 4: البيانات الأولية', [['getting-started/onboarding-04-seed.png', 'خطوة البيانات الأولية (الافتراضية/التجريبية)']]],
    ['الخطوة 5: الإنجاز', [['getting-started/onboarding-05-complete.png', 'شاشة إنجاز الإعداد']]],
  ]],
  ['02-getting-started/03-login.md', [
    ['شاشة تسجيل الدخول', [['getting-started/login.png', 'شاشة تسجيل الدخول']]],
  ]],
  ['03-interface/README.md', [
    ['## الشريط الجانبي', [['interface/sidebar.png', 'الشريط الجانبي مع قائمة الوحدات']]],
    ['## الهيدر', [['interface/header.png', 'شريط الهيدر العلوي']]],
    ['## قائمة المستخدم', [['interface/user-menu.png', 'قائمة المستخدم: اللغة والمظهر والملف الشخصي']]],
    ['صفحة الثيمات', [['settings/themes.png', 'صفحة الثيمات والمظهر']]],
  ]],
  ['04-settings/01-company.md', [
    ['الشاشة: بيانات الشركة', [['settings/company.png', 'شاشة بيانات الشركة']]],
  ]],
  ['04-settings/02-branches-currencies.md', [
    ['القسم الأول: الفروع', [['settings/branches.png', 'شاشة إدارة الفروع']]],
    ['القسم الثاني: العملات', [['settings/currencies.png', 'شاشة إدارة العملات وأسعار الصرف']]],
  ]],
  ['04-settings/03-vat.md', [
    ['الشاشة: أنواع الضريبة', [['settings/vat.png', 'شاشة إعدادات ضريبة القيمة المضافة']]],
  ]],
  ['04-settings/04-document-sequences.md', [
    ['الشاشة: جدول التسلسلات', [['settings/document-sequences.png', 'شاشة ترقيم المستندات']]],
  ]],
  ['04-settings/05-classifications.md', [
    ['1. أنواع المنتجات', [['settings/product-types.png', 'شاشة أنواع المنتجات']]],
    ['2. تصنيفات المنتجات', [['settings/product-categories.png', 'شاشة تصنيفات المنتجات']]],
    ['3. وحدات القياس', [['settings/units.png', 'شاشة وحدات القياس']]],
    ['4. صناديق النقد', [['settings/cash-boxes.png', 'شاشة صناديق النقد']]],
    ['5. مراكز التكلفة', [['settings/cost-centers.png', 'شاشة مراكز التكلفة']]],
  ]],
  ['04-settings/06-default-accounts.md', [
    ['الشاشة: جدول السلوكيات', [['settings/default-accounts.png', 'شاشة الحسابات الافتراضية']]],
  ]],
  ['04-settings/07-hr-settings.md', [
    ['القسم الأول: سياسات HR', [['settings/hr-policies.png', 'شاشة سياسات الموارد البشرية']]],
    ['القسم الثاني: مكونات الرواتب', [['settings/payroll-components.png', 'شاشة مكونات الرواتب']]],
  ]],
  ['04-settings/08-backup-database.md', [
    ['1. النسخ الاحتياطي', [['settings/backup.png', 'شاشة النسخ الاحتياطي']]],
    ['2. قاعدة البيانات', [['settings/database.png', 'شاشة إدارة قاعدة البيانات']]],
  ]],
  ['05-users-roles/README.md', [
    ['شاشة المستخدمون', [['users-roles/users-list.png', 'قائمة المستخدمين'], ['users-roles/user-modal.png', 'نافذة إضافة/تعديل مستخدم']]],
    ['شاشة الأدوار', [['users-roles/roles-list.png', 'قائمة الأدوار والصلاحيات']]],
    ['شاشة سجل التدقيق', [['users-roles/audit-log.png', 'شاشة سجل التدقيق']]],
  ]],
  ['06-accounting/01-chart-of-accounts.md', [
    ['الفلاتر والبطاقات الملخصة', [['accounting/chart-of-accounts.png', 'شاشة شجرة الحسابات']]],
  ]],
  ['06-accounting/02-journal-entries.md', [
    ['## القائمة', [['accounting/journal-entries.png', 'قائمة قيود اليومية']]],
    ['شاشة القيد الجديد', [['accounting/journal-entry-editor.png', 'شاشة إنشاء قيد يومية جديد']]],
  ]],
  ['06-accounting/03-vouchers.md', [
    ['شاشة سندات القبض', [['accounting/receipt-vouchers.png', 'شاشة سندات القبض']]],
    ['شاشة سندات الصرف', [['accounting/payment-vouchers.png', 'شاشة سندات الصرف']]],
  ]],
  ['06-accounting/04-financial-reports.md', [
    ['دفتر الحساب', [['accounting/ledger.png', 'دفتر الأستاذ — حركات حساب محدد']]],
    ['ميزان المراجعة', [['accounting/trial-balance.png', 'تقرير ميزان المراجعة']]],
    ['قائمة المركز المالي', [['accounting/balance-sheet.png', 'قائمة المركز المالي (الميزانية العمومية)']]],
    ['قائمة الدخل', [['accounting/income-statement.png', 'قائمة الدخل (الأرباح والخسائر)']]],
    ['قائمة التدفقات النقدية', [['accounting/cash-flow.png', 'قائمة التدفقات النقدية']]],
  ]],
  ['07-inventory/01-products.md', [
    ['قائمة المنتجات', [['inventory/products.png', 'قائمة المنتجات مع الفلاتر والتصدير']]],
  ]],
  ['07-inventory/02-warehouses-stock.md', [
    ['شاشة المستودعات', [['inventory/warehouses.png', 'شاشة المستودعات']]],
    ['شاشة المخزون', [['inventory/stock.png', 'شاشة أرصدة المخزون حسب المستودع']]],
  ]],
  ['07-inventory/03-adjustments.md', [
    ['شاشة التسويات', [['inventory/adjustments.png', 'شاشة تسويات الجرد']]],
  ]],
  ['08-sales/README.md', [
    ['صفحة مركز المبيعات', [['sales/hub.png', 'مركز المبيعات مع العدادات الحية']]],
  ]],
  ['08-sales/01-customers.md', [
    ['قائمة العملاء', [['sales/customers.png', 'قائمة العملاء']]],
  ]],
  ['08-sales/02-invoices.md', [
    ['## القائمة', [['sales/invoices.png', 'قائمة فواتير المبيعات']]],
  ]],
  ['08-sales/03-quotations.md', [
    ['## القائمة', [['sales/quotations.png', 'قائمة عروض الأسعار']]],
  ]],
  ['08-sales/04-sales-returns.md', [
    ['## القائمة', [['sales/returns.png', 'قائمة مرتجعات البيع']]],
  ]],
  ['09-purchases/01-suppliers.md', [
    ['## نظرة عامة', [['purchases/hub.png', 'مركز المشتريات مع العدادات الحية']]],
    ['قائمة الموردين', [['purchases/suppliers.png', 'قائمة الموردين']]],
  ]],
  ['09-purchases/02-invoices-orders.md', [
    ['فاتورة الشراء — القائمة', [['purchases/invoices.png', 'قائمة فواتير المشتريات']]],
    ['## أمر الشراء', [['purchases/orders.png', 'قائمة أوامر الشراء']]],
  ]],
  ['09-purchases/03-purchase-returns.md', [
    ['## القائمة', [['purchases/returns.png', 'قائمة مرتجعات المشتريات']]],
  ]],
  ['10-pos/README.md', [
    ['نظرة سريعة على الشاشات', [['pos/terminal.png', 'شاشة الكاشير بملء الشاشة']]],
  ]],
  ['10-pos/01-terminal.md', [
    ['## نظرة عامة', [['pos/terminal.png', 'شاشة الكاشير: الباركود وشبكة اللمس وسلة الشراء']]],
  ]],
  ['10-pos/02-shifts.md', [
    ['شاشة الورديات', [['pos/shifts.png', 'شاشة الورديات مع أرصدة الصندوق']]],
  ]],
  ['10-pos/03-settings-reports.md', [
    ['إعدادات POS', [['pos/settings.png', 'إعدادات نقاط البيع']]],
    ['تقارير POS', [['pos/reports.png', 'تقارير نقاط البيع (تقرير Z)']]],
  ]],
  ['11-manufacturing/README.md', [
    ['## نظرة عامة', [['manufacturing/hub.png', 'مركز التصنيع']]],
    ['شاشة قوائم المواد', [['manufacturing/bom.png', 'شاشة قوائم المواد (BOM)']]],
    ['شاشة أوامر التشغيل', [['manufacturing/work-orders.png', 'شاشة أوامر التشغيل']]],
    ['## التقارير', [['manufacturing/cost-report.png', 'تقرير كلفة الإنتاج'], ['manufacturing/variance-report.png', 'تقرير تحليل الفروقات']]],
  ]],
  ['12-hr/01-employees-attendance.md', [
    ['## الموظفون', [['hr/employees.png', 'قائمة الموظفين'], ['hr/hub.png', 'مركز الموارد البشرية']]],
    ['## الحضور', [['hr/attendance.png', 'شاشة سجل الحضور']]],
  ]],
  ['12-hr/02-payroll-eos.md', [
    ['## مسيرات الرواتب', [['hr/payroll.png', 'شاشة مسيرات الرواتب']]],
    ['## نهاية الخدمة', [['hr/end-of-service.png', 'شاشة مستحقات نهاية الخدمة']]],
  ]],
  ['13-crm/README.md', [
    ['## نظرة عامة', [['crm/hub.png', 'مركز علاقات العملاء']]],
    ['## العملاء المحتملون', [['crm/leads.png', 'قائمة العملاء المحتملين']]],
    ['## الفرص', [['crm/opportunities.png', 'قائمة الفرص ومراحلها']]],
    ['## المهام', [['crm/tasks.png', 'قائمة المهام']]],
    ['## الأنشطة', [['crm/activities.png', 'سجل الأنشطة والمكالمات']]],
  ]],
  ['14-reports/01-dashboard.md', [
    ['## نظرة عامة', [['reports/dashboard.png', 'لوحة التحكم الرئيسية مع المؤشرات والرسوم']]],
  ]],
  ['14-reports/02-reports-hub.md', [
    ['قائمة التقارير', [['reports/reports-hub.png', 'مركز التقارير — 12 تقريراً متاحاً']]],
    ['## وصف سريع لكل تقرير', [['reports/sales-analysis.png', 'تحليل المبيعات'], ['reports/profit-analysis.png', 'تحليل الربحية'], ['reports/customer-statement.png', 'كشف حساب العميل وأعمار الذمم']]],
    ['منشئ التقارير المخصص', [['reports/custom-builder.png', 'منشئ التقارير المخصص']]],
  ]],
  ['15-ai-assistant/README.md', [
    ['## نظرة عامة', [['ai/ai-chat.png', 'نافذة المحادثة مع الوكيل الذكي «مغزى»']]],
    ['## الإعداد', [['ai/ai-settings.png', 'إعدادات الذكاء الاصطناعي']]],
  ]],
  ['16-multicurrency/README.md', [
    ['1. إدارة العملات', [['settings/currencies.png', 'إدارة العملات وأسعار الصرف']]],
  ]],
];

let inserted = 0, skipped = 0, missingAnchor = [];
for (const [file, anchors] of PLAN) {
  const fp = path.join(ROOT, file);
  if (!existsSync(fp)) { console.log('SKIP (no file):', file); continue; }
  if (anchors.length === 0) continue;
  const lines = readFileSync(fp, 'utf8').split('\n');
  let modified = false;
  for (const [anchor, images] of anchors) {
    const todo = images.filter(([img]) => !lines.some(l => l.includes(img)));
    if (todo.length === 0) { skipped++; continue; }
    // جدول سطر العنوان المطابق
    const hIdx = lines.findIndex(l => l.startsWith('#') && l.includes(anchor));
    if (hIdx === -1) { missingAnchor.push(file + ' :: ' + anchor); continue; }
    // أوجد موضع الإدراج: بعد العنوان وأي سطر فارغ لا حق مباشرة
    let insertAt = hIdx + 1;
    if (lines[insertAt] === '') insertAt++;
    const block = todo.flatMap(([img, alt]) => ['', `![${alt}](../assets/${img})`]);
    lines.splice(insertAt, 0, ...block);
    modified = true;
    inserted += todo.length;
  }
  if (modified) writeFileSync(fp, lines.join('\n'), 'utf8');
}
console.log('inserted:', inserted, '| already-present:', skipped);
if (missingAnchor.length) { console.log('MISSING ANCHORS:'); console.log(missingAnchor.join('\n')); }
