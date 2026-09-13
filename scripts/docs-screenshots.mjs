// لقطات شاشة توثيق المستخدم — Docs2/assets
// التشغيل: node scripts/docs-screenshots.mjs [group]
// المتطلبات: خادم التطوير يعمل على 5173 مع جسر e2e لقاعدة البيانات
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const BASE_URL = 'http://127.0.0.1:5173';
const OUT = path.resolve('Docs2/assets');

// [المسار، ملف الإخراج، نص يظهر عند جاهزية المحتوى (اختياري)]
const SHOTS = {
  interface: [
    ['/', 'interface/sidebar.png', 'لوحة التحكم'],
  ],
  accounting: [
    ['/accounting/chart', 'accounting/chart-of-accounts.png', 'حساب جديد'],
    ['/accounting/receipt-vouchers', 'accounting/receipt-vouchers.png', 'سند قبض جديد'],
    ['/accounting/payment-vouchers', 'accounting/payment-vouchers.png', 'سند صرف جديد'],
    ['/accounting/trial', 'accounting/trial-balance.png', 'إجمالي مدين'],
    ['/accounting/balance', 'accounting/balance-sheet.png', 'إجمالي الأصول'],
    ['/accounting/profit', 'accounting/income-statement.png', 'إجمالي الإيرادات'],
    ['/accounting/cashflow', 'accounting/cash-flow.png', 'الأنشطة التشغيلية'],
  ],
  inventory: [
    ['/inventory/products', 'inventory/products.png', 'منتج جديد'],
    ['/inventory/warehouses', 'inventory/warehouses.png', 'مستودع'],
    ['/inventory/stock', 'inventory/stock.png', 'الرصيد'],
    ['/inventory/adjustments', 'inventory/adjustments.png', 'تسوية'],
  ],
  sales: [
    ['/sales', 'sales/hub.png', 'المبيعات'],
    ['/sales/customers', 'sales/customers.png', 'عميل جديد'],
    ['/sales/invoices', 'sales/invoices.png', 'فاتورة'],
    ['/sales/quotations', 'sales/quotations.png', 'عرض سعر'],
    ['/sales/returns', 'sales/returns.png', 'مرتجع'],
  ],
  purchases: [
    ['/purchases', 'purchases/hub.png', 'المشتريات'],
    ['/purchases/suppliers', 'purchases/suppliers.png', 'مورد جديد'],
    ['/purchases/invoices', 'purchases/invoices.png', 'فاتورة'],
    ['/purchases/orders', 'purchases/orders.png', 'أمر شراء'],
    ['/purchases/returns', 'purchases/returns.png', 'مرتجع'],
  ],
  pos: [
    ['/pos', 'pos/terminal.png', null],
    ['/pos/shifts', 'pos/shifts.png', 'الوردية'],
    ['/pos/reports', 'pos/reports.png', 'تقرير'],
    ['/pos/settings', 'pos/settings.png', 'إعدادات'],
  ],
  manufacturing: [
    ['/manufacturing', 'manufacturing/hub.png', 'التصنيع'],
    ['/manufacturing/bom', 'manufacturing/bom.png', 'قائمة المواد'],
    ['/manufacturing/work-orders', 'manufacturing/work-orders.png', 'أمر تشغيل'],
    ['/manufacturing/cost-report', 'manufacturing/cost-report.png', 'التكلفة'],
    ['/manufacturing/variance-report', 'manufacturing/variance-report.png', 'الفروقات'],
  ],
  hr: [
    ['/hr', 'hr/hub.png', 'الموظفون'],
    ['/hr/employees', 'hr/employees.png', 'موظف'],
    ['/hr/attendance', 'hr/attendance.png', 'الحضور'],
    ['/hr/payroll', 'hr/payroll.png', 'الرواتب'],
    ['/hr/end-of-service', 'hr/end-of-service.png', 'نهاية الخدمة'],
  ],
  crm: [
    ['/crm', 'crm/hub.png', 'علاقات العملاء'],
    ['/crm/leads', 'crm/leads.png', 'عميل محتمل'],
    ['/crm/opportunities', 'crm/opportunities.png', 'الفرص'],
    ['/crm/tasks', 'crm/tasks.png', 'المهام'],
    ['/crm/activities', 'crm/activities.png', 'الأنشطة'],
  ],
  reports: [
    ['/reports', 'reports/reports-hub.png', 'مركز التقارير'],
    ['/reports/profit-analysis', 'reports/profit-analysis.png', 'تحليل الربحية'],
    ['/reports/customer-statement', 'reports/customer-statement.png', 'كشف'],
    ['/reports/custom-builder', 'reports/custom-builder.png', 'منشئ'],
    ['/reports/sales-analysis', 'reports/sales-analysis.png', 'تحليل المبيعات'],
  ],
  ai: [
    ['/ai', 'ai/ai-chat.png', 'مغزى'],
  ],
};

async function waitContent(page, marker, timeoutMs = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const [text, skeletons] = await page.evaluate(() => [
      document.body.innerText,
      document.querySelectorAll('[class*="animate-pulse"]').length,
    ]).catch(() => ['', 1]);
    const markerOk = marker ? text.includes(marker) : true;
    if (markerOk && skeletons === 0) return true;
    await page.waitForTimeout(500);
  }
  return false;
}

async function main() {
  const groups = process.argv[2] ? [process.argv[2]] : Object.keys(SHOTS);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    locale: 'ar',
  });
  await ctx.addInitScript(() => {
    window.localStorage.setItem('maghzaccount-onboarding', JSON.stringify({
      state: { completed: true, currentStep: 4, companyConfig: {}, seedOption: 'demo', isProcessing: false, processingMessage: '', error: null },
      version: 0,
    }));
  });
  const page = await ctx.newPage();

  // تسجيل الدخول
  await page.goto(BASE_URL + '/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.getByRole('textbox', { name: 'اسم المستخدم*' }).fill('admin');
  await page.getByRole('textbox', { name: 'كلمة المرور*' }).fill('admin1234');
  await page.getByRole('button', { name: 'تسجيل الدخول' }).click();
  await page.waitForURL(u => !u.pathname.includes('login'), { timeout: 30000 });
  console.log('✓ logged in');

  for (const g of groups) {
    for (const [route, file, marker] of SHOTS[g] || []) {
      await page.goto(BASE_URL + route, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      const ok = await waitContent(page, marker);
      await page.waitForTimeout(5000); // ثبات الحركات واكتمال جلب البيانات
      await mkdir(path.dirname(path.join(OUT, file)), { recursive: true });
      await page.screenshot({ path: path.join(OUT, file) });
      console.log((ok ? '✓' : '?') + ' ' + file);
    }
  }
  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
