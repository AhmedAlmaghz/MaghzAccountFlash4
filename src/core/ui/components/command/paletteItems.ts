import type { Permission } from '@/modules/auth/types';

export type PaletteModule =
  | 'core'
  | 'accounting'
  | 'inventory'
  | 'sales'
  | 'purchases'
  | 'manufacturing'
  | 'hr'
  | 'crm'
  | 'reports'
  | 'settings'
  | 'ai';

export interface PaletteItem {
  id: string;
  labelKey: string;
  path: string;
  module: PaletteModule;
  /** Extra searchable terms (English/Arabic aliases, route words). */
  keywords?: string[];
  /** Optional extra permission (e.g. ai.settings). */
  permission?: Permission;
}

/**
 * Single source of truth for every navigable screen in the app.
 * Mirrors `src/app/router.tsx` — keep in sync when adding routes.
 */
export const paletteItems: PaletteItem[] = [
  // Core / Dashboard
  { id: 'dashboard', labelKey: 'sidebar.dashboard', path: '/', module: 'core', keywords: ['home', 'الرئيسية'] },

  // Accounting
  { id: 'accounting', labelKey: 'sidebar.accounting.title', path: '/accounting', module: 'accounting', keywords: ['accounting', 'محاسبة'] },
  { id: 'accounting-chart', labelKey: 'sidebar.accounting.chartOfAccounts', path: '/accounting/chart', module: 'accounting', keywords: ['chart', 'accounts', 'شجرة'] },
  { id: 'accounting-journal', labelKey: 'sidebar.accounting.journalEntries', path: '/accounting/journal', module: 'accounting', keywords: ['journal', 'entries', 'قيود'] },
  { id: 'accounting-trial', labelKey: 'sidebar.accounting.trialBalance', path: '/accounting/trial', module: 'accounting', keywords: ['trial', 'balance', 'ميزان'] },
  { id: 'accounting-balance', labelKey: 'sidebar.accounting.balanceSheet', path: '/accounting/balance', module: 'accounting', keywords: ['balance', 'sheet', 'مركز مالي'] },
  { id: 'accounting-profit', labelKey: 'sidebar.accounting.profitLoss', path: '/accounting/profit', module: 'accounting', keywords: ['profit', 'loss', 'أرباح', 'خسائر'] },
  { id: 'accounting-cashflow', labelKey: 'sidebar.accounting.cashFlow', path: '/accounting/cashflow', module: 'accounting', keywords: ['cash', 'flow', 'تدفقات'] },
  { id: 'accounting-receipts', labelKey: 'sidebar.accounting.receiptVouchers', path: '/accounting/receipt-vouchers', module: 'accounting', keywords: ['receipt', 'voucher', 'قبض'] },
  { id: 'accounting-payments', labelKey: 'sidebar.accounting.paymentVouchers', path: '/accounting/payment-vouchers', module: 'accounting', keywords: ['payment', 'voucher', 'صرف'] },
  { id: 'accounting-ledger', labelKey: 'accounting.accountLedger', path: '/accounting/ledger', module: 'accounting', keywords: ['ledger', 'دفتر', 'استاذ'] },

  // Inventory
  { id: 'inventory', labelKey: 'sidebar.inventory.title', path: '/inventory', module: 'inventory', keywords: ['inventory', 'مخازن'] },
  { id: 'inventory-products', labelKey: 'sidebar.inventory.products', path: '/inventory/products', module: 'inventory', keywords: ['products', 'items', 'أصناف'] },
  { id: 'inventory-warehouses', labelKey: 'sidebar.inventory.warehouses', path: '/inventory/warehouses', module: 'inventory', keywords: ['warehouses', 'مستودعات'] },
  { id: 'inventory-stock', labelKey: 'sidebar.inventory.stock', path: '/inventory/stock', module: 'inventory', keywords: ['stock', 'أرصدة'] },
  { id: 'inventory-transactions', labelKey: 'sidebar.inventory.transactions', path: '/inventory/transactions', module: 'inventory', keywords: ['movements', 'حركة'] },
  { id: 'inventory-adjustments', labelKey: 'sidebar.inventory.adjustments', path: '/inventory/adjustments', module: 'inventory', keywords: ['adjustment', 'تسويات'] },

  // Sales
  { id: 'sales', labelKey: 'sidebar.sales.title', path: '/sales', module: 'sales', keywords: ['sales', 'مبيعات'] },
  { id: 'sales-invoices', labelKey: 'sidebar.sales.invoices', path: '/sales/invoices', module: 'sales', keywords: ['invoice', 'فواتير'] },
  { id: 'sales-customers', labelKey: 'sidebar.sales.customers', path: '/sales/customers', module: 'sales', keywords: ['customers', 'clients', 'عملاء'] },
  { id: 'sales-quotations', labelKey: 'sidebar.sales.quotations', path: '/sales/quotations', module: 'sales', keywords: ['quotation', 'quote', 'عروض'] },
  { id: 'sales-returns', labelKey: 'sidebar.sales.returns', path: '/sales/returns', module: 'sales', keywords: ['returns', 'مرتجع'] },

  // Purchases
  { id: 'purchases', labelKey: 'sidebar.purchases.title', path: '/purchases', module: 'purchases', keywords: ['purchases', 'مشتريات'] },
  { id: 'purchases-invoices', labelKey: 'sidebar.purchases.invoices', path: '/purchases/invoices', module: 'purchases', keywords: ['invoice', 'فواتير'] },
  { id: 'purchases-suppliers', labelKey: 'sidebar.purchases.suppliers', path: '/purchases/suppliers', module: 'purchases', keywords: ['suppliers', 'vendors', 'موردين'] },
  { id: 'purchases-orders', labelKey: 'sidebar.purchases.orders', path: '/purchases/orders', module: 'purchases', keywords: ['orders', 'طلبات'] },
  { id: 'purchases-returns', labelKey: 'sidebar.purchases.returns', path: '/purchases/returns', module: 'purchases', keywords: ['returns', 'مرتجع'] },

  // Manufacturing
  { id: 'manufacturing', labelKey: 'sidebar.manufacturing.title', path: '/manufacturing', module: 'manufacturing', keywords: ['manufacturing', 'تصنيع'] },
  { id: 'manufacturing-bom', labelKey: 'sidebar.manufacturing.boms', path: '/manufacturing/bom', module: 'manufacturing', keywords: ['bom', 'bill', 'تركيبة'] },
  { id: 'manufacturing-workorders', labelKey: 'sidebar.manufacturing.workOrders', path: '/manufacturing/work-orders', module: 'manufacturing', keywords: ['work', 'order', 'تشغيل'] },
  { id: 'manufacturing-cost', labelKey: 'sidebar.manufacturing.costReport', path: '/manufacturing/cost-report', module: 'manufacturing', keywords: ['cost', 'تكاليف'] },
  { id: 'manufacturing-variance', labelKey: 'sidebar.manufacturing.varianceReport', path: '/manufacturing/variance-report', module: 'manufacturing', keywords: ['variance', 'انحراف'] },

  // HR
  { id: 'hr', labelKey: 'sidebar.hr.title', path: '/hr', module: 'hr', keywords: ['hr', 'موظفين'] },
  { id: 'hr-employees', labelKey: 'sidebar.hr.employees', path: '/hr/employees', module: 'hr', keywords: ['employees', 'staff', 'موظفين'] },
  { id: 'hr-attendance', labelKey: 'sidebar.hr.attendance', path: '/hr/attendance', module: 'hr', keywords: ['attendance', 'حضور'] },
  { id: 'hr-payroll', labelKey: 'sidebar.hr.payroll', path: '/hr/payroll', module: 'hr', keywords: ['payroll', 'رواتب'] },
  { id: 'hr-leaves', labelKey: 'sidebar.hr.leaves', path: '/hr/leaves', module: 'hr', keywords: ['leaves', 'vacation', 'إجازات'] },
  { id: 'hr-eos', labelKey: 'sidebar.hr.endOfService', path: '/hr/end-of-service', module: 'hr', keywords: ['end', 'service', 'نهاية خدمة'] },

  // CRM
  { id: 'crm', labelKey: 'sidebar.crm.title', path: '/crm', module: 'crm', keywords: ['crm', 'عملاء'] },
  { id: 'crm-leads', labelKey: 'sidebar.crm.leads', path: '/crm/leads', module: 'crm', keywords: ['leads', 'عملاء محتملين'] },
  { id: 'crm-opportunities', labelKey: 'sidebar.crm.opportunities', path: '/crm/opportunities', module: 'crm', keywords: ['opportunities', 'فرص'] },
  { id: 'crm-tasks', labelKey: 'sidebar.crm.tasks', path: '/crm/tasks', module: 'crm', keywords: ['tasks', 'مهام'] },
  { id: 'crm-activities', labelKey: 'sidebar.crm.activities', path: '/crm/activities', module: 'crm', keywords: ['activities', 'أنشطة'] },

  // Reports
  { id: 'reports', labelKey: 'sidebar.reports.title', path: '/reports', module: 'reports', keywords: ['reports', 'تقارير'] },
  { id: 'reports-sales', labelKey: 'sidebar.reports.salesAnalysis', path: '/reports/sales-analysis', module: 'reports', keywords: ['sales', 'analysis', 'تحليل'] },
  { id: 'reports-inventory', labelKey: 'sidebar.reports.inventoryAnalysis', path: '/reports/inventory-analysis', module: 'reports', keywords: ['inventory', 'analysis', 'تحليل'] },
  { id: 'reports-lowstock', labelKey: 'reports.lowStockAlert', path: '/reports/low-stock-alert', module: 'reports', keywords: ['low', 'stock', 'ناقص'] },
  { id: 'reports-stockmovement', labelKey: 'reports.stockMovement', path: '/reports/stock-movement', module: 'reports', keywords: ['stock', 'movement', 'حركة'] },
  { id: 'reports-stockvaluation', labelKey: 'reports.stockValuation', path: '/reports/stock-valuation', module: 'reports', keywords: ['stock', 'valuation', 'تقييم'] },
  { id: 'reports-customer', labelKey: 'sidebar.reports.customerStatement', path: '/reports/customer-statement', module: 'reports', keywords: ['customer', 'statement', 'كشف'] },
  { id: 'reports-supplier', labelKey: 'sidebar.reports.supplierStatement', path: '/reports/supplier-statement', module: 'reports', keywords: ['supplier', 'statement', 'كشف'] },
  { id: 'reports-profit', labelKey: 'sidebar.reports.profitAnalysis', path: '/reports/profit-analysis', module: 'reports', keywords: ['profit', 'أرباح', 'تحليل'] },
  { id: 'reports-custom', labelKey: 'sidebar.reports.customBuilder', path: '/reports/custom-builder', module: 'reports', keywords: ['custom', 'builder', 'مخصص'] },
  { id: 'reports-leads', labelKey: 'sidebar.reports.leadConversion', path: '/reports/lead-conversion', module: 'reports', keywords: ['lead', 'conversion', 'تحويل'] },
  { id: 'reports-pipeline', labelKey: 'sidebar.reports.opportunityPipeline', path: '/reports/opportunity-pipeline', module: 'reports', keywords: ['pipeline', 'فرص', 'خط أنابيب'] },

  // Auth / Users
  { id: 'users', labelKey: 'sidebar.settings.users', path: '/users', module: 'settings', keywords: ['users', 'مستخدمين'] },
  { id: 'roles', labelKey: 'sidebar.settings.roles', path: '/roles', module: 'settings', keywords: ['roles', 'أدوار', 'صلاحيات'] },
  { id: 'audit-logs', labelKey: 'palette.pages.auditLogs', path: '/audit-logs', module: 'settings', keywords: ['audit', 'سجل', 'تدقيق'] },

  // Settings
  { id: 'settings', labelKey: 'sidebar.settings.title', path: '/settings', module: 'settings', keywords: ['settings', 'إعدادات'] },
  { id: 'settings-company', labelKey: 'sidebar.settings.company', path: '/settings/company', module: 'settings', keywords: ['company', 'شركة'] },
  { id: 'settings-currencies', labelKey: 'sidebar.settings.currencies', path: '/settings/currencies', module: 'settings', keywords: ['currencies', 'عملات'] },
  { id: 'settings-vat', labelKey: 'sidebar.settings.vat', path: '/settings/vat', module: 'settings', keywords: ['vat', 'ضريبة'] },
  { id: 'settings-branches', labelKey: 'sidebar.settings.branches', path: '/settings/branches', module: 'settings', keywords: ['branches', 'فروع'] },
  { id: 'settings-users', labelKey: 'settings.users.title', path: '/settings/users', module: 'settings', keywords: ['users', 'مستخدمين'] },
  { id: 'settings-ai', labelKey: 'ai.settings.title', path: '/settings/ai', module: 'settings', keywords: ['ai', 'ذكاء', 'اصطناعي'], permission: 'ai.settings' },
  { id: 'settings-sequences', labelKey: 'settings.sequences.title', path: '/settings/document-sequences', module: 'settings', keywords: ['sequences', 'تسلسل'] },
  { id: 'settings-producttypes', labelKey: 'settings.productTypes.title', path: '/settings/product-types', module: 'settings', keywords: ['types', 'أنواع'] },
  { id: 'settings-categories', labelKey: 'settings.productCategories.title', path: '/settings/product-categories', module: 'settings', keywords: ['categories', 'تصنيفات'] },
  { id: 'settings-defaultaccounts', labelKey: 'settings.defaultAccounts.title', path: '/settings/default-accounts', module: 'settings', keywords: ['accounts', 'حسابات'] },
  { id: 'settings-units', labelKey: 'settings.units.title', path: '/settings/units', module: 'settings', keywords: ['units', 'وحدات'] },
  { id: 'settings-cashboxes', labelKey: 'settings.cashBoxes.title', path: '/settings/cash-boxes', module: 'settings', keywords: ['cash', 'صناديق'] },
  { id: 'settings-costcenters', labelKey: 'settings.costCenters.title', path: '/settings/cost-centers', module: 'settings', keywords: ['cost', 'مراكز'] },
  { id: 'settings-backup', labelKey: 'settings.backup.title', path: '/settings/backup', module: 'settings', keywords: ['backup', 'نسخ'] },
  { id: 'settings-reset', labelKey: 'settings.reset.title', path: '/settings/reset', module: 'settings', keywords: ['reset', 'تهيئة'] },

  // AI
  { id: 'ai', labelKey: 'sidebar.ai', path: '/ai', module: 'ai', keywords: ['chat', 'ذكاء'] },
];

/**
 * Whether a user (identified by role + permission checker) can access a module.
 * Mirrors `useCanAccessModule` in `modules/auth/hooks/usePermission.ts`.
 */
export function canAccessModule(
  module: PaletteModule,
  role: string | undefined,
  hasPermission: (permission: string) => boolean,
): boolean {
  if (!role) return false;
  if (role === 'super_admin') return true;
  if (module === 'ai') return hasPermission('ai.use');
  return (
    hasPermission(`${module}.view`) ||
    hasPermission(`${module}.own`) ||
    hasPermission(`${module}.create`)
  );
}

/** Whether a specific palette item is visible to the current user. */
export function canAccessItem(
  item: PaletteItem,
  role: string | undefined,
  hasPermission: (permission: string) => boolean,
): boolean {
  if (role === 'super_admin') return true;
  if (item.permission && !hasPermission(item.permission)) return false;
  return canAccessModule(item.module, role, hasPermission);
}
