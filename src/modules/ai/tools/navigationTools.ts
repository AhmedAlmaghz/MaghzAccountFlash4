import type { ToolDefinition } from '../types';
import type { Permission } from '@/modules/auth/types';
import { useAuthStore } from '@/modules/auth/store';
import { navigateTo } from '../engine/navigationBridge';

/**
 * Navigation tools — the assistant can open any page in the app for the user.
 * The catalog is permission-filtered so the LLM only sees accessible pages.
 */

interface PageEntry {
  key: string;
  labelAr: string;
  path: string;
  permission: Permission;
}

export const PAGE_CATALOG: PageEntry[] = [
  { key: 'dashboard', labelAr: 'لوحة التحكم', path: '/', permission: 'core.view' },
  // Accounting
  { key: 'accounting.chart', labelAr: 'شجرة الحسابات', path: '/accounting/chart', permission: 'accounting.view' },
  { key: 'accounting.journal', labelAr: 'القيود اليومية', path: '/accounting/journal', permission: 'accounting.view' },
  { key: 'accounting.trial', labelAr: 'ميزان المراجعة', path: '/accounting/trial', permission: 'accounting.view' },
  { key: 'accounting.balance', labelAr: 'الميزانية العمومية', path: '/accounting/balance', permission: 'accounting.view' },
  { key: 'accounting.profit', labelAr: 'قائمة الدخل', path: '/accounting/profit', permission: 'accounting.view' },
  { key: 'accounting.cashflow', labelAr: 'التدفقات النقدية', path: '/accounting/cashflow', permission: 'accounting.view' },
  { key: 'accounting.receipt_vouchers', labelAr: 'سندات القبض', path: '/accounting/receipt-vouchers', permission: 'accounting.view' },
  { key: 'accounting.payment_vouchers', labelAr: 'سندات الصرف', path: '/accounting/payment-vouchers', permission: 'accounting.view' },
  // Inventory
  { key: 'inventory.products', labelAr: 'المنتجات', path: '/inventory/products', permission: 'inventory.view' },
  { key: 'inventory.warehouses', labelAr: 'المستودعات', path: '/inventory/warehouses', permission: 'inventory.view' },
  { key: 'inventory.stock', labelAr: 'المخزون', path: '/inventory/stock', permission: 'inventory.view' },
  { key: 'inventory.transactions', labelAr: 'الحركات المخزنية', path: '/inventory/transactions', permission: 'inventory.view' },
  { key: 'inventory.adjustments', labelAr: 'التسويات', path: '/inventory/adjustments', permission: 'inventory.view' },
  // Sales
  { key: 'sales.invoices', labelAr: 'فواتير المبيعات', path: '/sales/invoices', permission: 'sales.view' },
  { key: 'sales.customers', labelAr: 'العملاء', path: '/sales/customers', permission: 'sales.view' },
  { key: 'sales.quotations', labelAr: 'عروض الأسعار', path: '/sales/quotations', permission: 'sales.view' },
  { key: 'sales.returns', labelAr: 'مردودات المبيعات', path: '/sales/returns', permission: 'sales.view' },
  // Purchases
  { key: 'purchases.invoices', labelAr: 'فواتير المشتريات', path: '/purchases/invoices', permission: 'purchases.view' },
  { key: 'purchases.suppliers', labelAr: 'الموردين', path: '/purchases/suppliers', permission: 'purchases.view' },
  { key: 'purchases.orders', labelAr: 'أوامر الشراء', path: '/purchases/orders', permission: 'purchases.view' },
  { key: 'purchases.returns', labelAr: 'مردودات المشتريات', path: '/purchases/returns', permission: 'purchases.view' },
  // Manufacturing
  { key: 'manufacturing.bom', labelAr: 'فواتير المواد', path: '/manufacturing/bom', permission: 'manufacturing.view' },
  { key: 'manufacturing.work_orders', labelAr: 'أوامر التشغيل', path: '/manufacturing/work-orders', permission: 'manufacturing.view' },
  // HR
  { key: 'hr.employees', labelAr: 'الموظفين', path: '/hr/employees', permission: 'hr.view' },
  { key: 'hr.attendance', labelAr: 'الحضور', path: '/hr/attendance', permission: 'hr.view' },
  { key: 'hr.payroll', labelAr: 'الرواتب', path: '/hr/payroll', permission: 'hr.view' },
  { key: 'hr.leaves', labelAr: 'الإجازات', path: '/hr/leaves', permission: 'hr.view' },
  // CRM
  { key: 'crm.leads', labelAr: 'العملاء المحتملين', path: '/crm/leads', permission: 'crm.view' },
  { key: 'crm.opportunities', labelAr: 'الفرص', path: '/crm/opportunities', permission: 'crm.view' },
  { key: 'crm.tasks', labelAr: 'المهام', path: '/crm/tasks', permission: 'crm.view' },
  { key: 'crm.activities', labelAr: 'النشاطات', path: '/crm/activities', permission: 'crm.view' },
  // Reports
  { key: 'reports.hub', labelAr: 'مركز التقارير', path: '/reports', permission: 'reports.view' },
  { key: 'reports.sales_analysis', labelAr: 'تحليل المبيعات', path: '/reports/sales-analysis', permission: 'reports.view' },
  { key: 'reports.profit_analysis', labelAr: 'تحليل الأرباح', path: '/reports/profit-analysis', permission: 'reports.view' },
  { key: 'reports.customer_statement', labelAr: 'كشف حساب عميل', path: '/reports/customer-statement', permission: 'reports.view' },
  // Settings
  { key: 'settings.company', labelAr: 'بيانات الشركة', path: '/settings/company', permission: 'settings.view' },
  { key: 'settings.ai', labelAr: 'إعدادات الذكاء الاصطناعي', path: '/settings/ai', permission: 'settings.view' },
];

function accessiblePages(): PageEntry[] {
  const { hasPermission } = useAuthStore.getState();
  return PAGE_CATALOG.filter((p) => hasPermission(p.permission));
}

export const navigationTools: ToolDefinition[] = [
  {
    name: 'app.list_pages',
    labelAr: 'قائمة الصفحات',
    descriptionAr: 'يعرض قائمة الصفحات المتاحة في النظام مع مفاتيحها. استخدمه لمعرفة مفتاح الصفحة قبل الانتقال إليها.',
    permission: 'core.view',
    dangerLevel: 'read',
    parameters: { type: 'object', properties: {} },
    execute: async () => ({
      pages: accessiblePages().map((p) => ({ key: p.key, name: p.labelAr })),
    }),
  },
  {
    name: 'app.navigate',
    labelAr: 'الانتقال إلى صفحة',
    descriptionAr: 'يفتح صفحة محددة في التطبيق للمستخدم. استخدم مفتاح الصفحة (key) من أداة app.list_pages. مثال: للانتقال لفواتير المبيعات استخدم sales.invoices',
    permission: 'core.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        page: { type: 'string', description: 'مفتاح الصفحة (key) من app.list_pages' },
      },
      required: ['page'],
    },
    execute: async (args) => {
      const key = String(args.page || '').trim();
      const page = accessiblePages().find((p) => p.key === key);
      if (!page) {
        return { error: `صفحة غير موجودة أو غير مصرح بها: ${key}. استخدم app.list_pages لرؤية المفاتيح المتاحة.` };
      }
      const navigated = navigateTo(page.path);
      if (!navigated) return { error: 'التنقل غير متاح حالياً' };
      return { navigated: true, page: page.labelAr, path: page.path };
    },
  },
];
