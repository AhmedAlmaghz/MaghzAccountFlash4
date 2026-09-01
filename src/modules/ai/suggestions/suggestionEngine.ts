import type { ChatMessage } from '../types';

/**
 * Suggestion engine — turns an assistant message into actionable suggestion
 * chips. Two kinds of actions:
 *   - `navigate`: jump to a page (via the navigation bridge).
 *   - `prompt`: send a follow-up prompt to the engine.
 *
 * Pure logic (no React) so it can be unit-tested in isolation.
 */

export type SuggestionType = 'navigate' | 'prompt';

export interface Suggestion {
  id: string;
  type: SuggestionType;
  /** i18n key for the chip label (and, for prompt chips, the text sent). */
  labelKey: string;
  /** Route path for navigate chips. */
  path?: string;
  /** i18n key whose value is sent to the engine for prompt chips. */
  promptKey?: string;
}

interface RouteTarget {
  path: string;
  labelKey: string;
}

/** Tool-name prefix → destination page. Order matters (first match wins). */
const TOOL_ROUTES: Array<{ prefixes: string[]; target: RouteTarget }> = [
  {
    prefixes: ['read.profit_loss', 'accounting.get_profit_loss', 'accounting.profit_loss'],
    target: { path: '/accounting/profit', labelKey: 'ai.actions.openProfitLoss' },
  },
  {
    prefixes: ['read.balance_sheet', 'accounting.balance_sheet'],
    target: { path: '/accounting/balance', labelKey: 'ai.actions.openBalanceSheet' },
  },
  {
    prefixes: ['accounting.get_trial_balance', 'accounting.trial_balance'],
    target: { path: '/accounting/trial', labelKey: 'ai.actions.openTrialBalance' },
  },
  {
    prefixes: ['accounting.cash_flow'],
    target: { path: '/accounting/cashflow', labelKey: 'ai.actions.openCashFlow' },
  },
  {
    prefixes: ['read.ar_aging', 'sales.get_ar_aging'],
    target: { path: '/reports/customer-statement', labelKey: 'ai.actions.openCustomerStatement' },
  },
  {
    prefixes: ['read.ap_aging', 'purchases.get_ap_aging_total'],
    target: { path: '/reports/supplier-statement', labelKey: 'ai.actions.openSupplierStatement' },
  },
  {
    prefixes: ['read.low_stock_alert', 'inventory.low_stock_alert'],
    target: { path: '/reports/low-stock-alert', labelKey: 'ai.actions.openLowStock' },
  },
  {
    prefixes: ['read.inventory_valuation', 'inventory.stock_valuation'],
    target: { path: '/reports/stock-valuation', labelKey: 'ai.actions.openStockValuation' },
  },
  {
    prefixes: ['read.sales_analysis', 'sales.revenue_analysis'],
    target: { path: '/reports/sales-analysis', labelKey: 'ai.actions.openSalesAnalysis' },
  },
  {
    prefixes: ['read.inventory_kpis', 'inventory.inventory_analysis'],
    target: { path: '/reports/inventory-analysis', labelKey: 'ai.actions.openInventoryAnalysis' },
  },
  {
    prefixes: ['sales.create_customer', 'sales.update_customer'],
    target: { path: '/sales/customers', labelKey: 'ai.actions.openCustomers' },
  },
  {
    prefixes: ['sales.create_quotation'],
    target: { path: '/sales/quotations', labelKey: 'ai.actions.openQuotations' },
  },
  {
    prefixes: ['purchases.create_supplier', 'purchases.update_supplier'],
    target: { path: '/purchases/suppliers', labelKey: 'ai.actions.openSuppliers' },
  },
  {
    prefixes: ['purchases.create_purchase_order'],
    target: { path: '/purchases/orders', labelKey: 'ai.actions.openOrders' },
  },
  {
    prefixes: ['inventory.create_warehouse', 'inventory.update_warehouse'],
    target: { path: '/inventory/warehouses', labelKey: 'ai.actions.openWarehouses' },
  },
  {
    prefixes: ['inventory.create_stock_adjustment', 'inventory.post_stock_adjustment'],
    target: { path: '/inventory/adjustments', labelKey: 'ai.actions.openAdjustments' },
  },
  {
    prefixes: ['inventory.create_stock_transfer'],
    target: { path: '/inventory/transactions', labelKey: 'ai.actions.openInventoryTransactions' },
  },
  {
    prefixes: ['inventory.create_product', 'inventory.update_product'],
    target: { path: '/inventory/products', labelKey: 'ai.actions.openProducts' },
  },
  {
    prefixes: ['accounting.create_journal_flow', 'accounting.create_journal_entry', 'accounting.post_journal_entry'],
    target: { path: '/accounting/journal', labelKey: 'ai.actions.openJournal' },
  },
  {
    prefixes: ['accounting.create_account'],
    target: { path: '/accounting/chart', labelKey: 'ai.actions.openChart' },
  },
  {
    prefixes: ['accounting.create_receipt_voucher', 'accounting.post_receipt_voucher'],
    target: { path: '/accounting/receipt-vouchers', labelKey: 'ai.actions.openReceiptVouchers' },
  },
  {
    prefixes: ['accounting.create_payment_voucher', 'accounting.post_payment_voucher'],
    target: { path: '/accounting/payment-vouchers', labelKey: 'ai.actions.openPaymentVouchers' },
  },
  {
    prefixes: ['manufacturing.create_work_order', 'manufacturing.update_work_order_status'],
    target: { path: '/manufacturing/work-orders', labelKey: 'ai.actions.openWorkOrders' },
  },
  {
    prefixes: ['manufacturing.create_bom', 'manufacturing.update_bom'],
    target: { path: '/manufacturing/bom', labelKey: 'ai.actions.openBoms' },
  },
  {
    prefixes: ['hr.create_employee'],
    target: { path: '/hr/employees', labelKey: 'ai.actions.openEmployees' },
  },
  {
    prefixes: ['hr.create_payroll_run'],
    target: { path: '/hr/payroll', labelKey: 'ai.actions.openPayroll' },
  },
  {
    prefixes: ['hr.create_leave', 'hr.update_leave', 'hr.get_leave_balances'],
    target: { path: '/hr/leaves', labelKey: 'ai.actions.openLeaves' },
  },
  {
    prefixes: ['hr.post_payroll_run', 'hr.process_payroll_flow', 'hr.generate_payroll_run', 'hr.preview_payroll', 'hr.delete_payroll_run'],
    target: { path: '/hr/payroll', labelKey: 'ai.actions.openPayroll' },
  },
  {
    prefixes: ['hr.save_attendance', 'search.attendance'],
    target: { path: '/hr/attendance', labelKey: 'ai.actions.openAttendance' },
  },
  {
    prefixes: ['hr.create_end_of_service', 'hr.pay_end_of_service', 'hr.preview_end_of_service', 'hr.update_end_of_service_status', 'hr.delete_end_of_service'],
    target: { path: '/hr/end-of-service', labelKey: 'ai.actions.openEndOfService' },
  },
  {
    prefixes: ['search.departments', 'hr.create_department', 'hr.update_department', 'hr.delete_department'],
    target: { path: '/hr/departments', labelKey: 'ai.actions.openDepartments' },
  },
  {
    prefixes: ['crm.create_lead', 'crm.convert_lead_to_customer', 'crm.update_lead_status', 'crm.qualify_lead', 'crm.update_lead', 'crm.delete_lead', 'crm.get_leads'],
    target: { path: '/crm/leads', labelKey: 'ai.actions.openLeads' },
  },
  {
    prefixes: ['crm.create_opportunity', 'crm.update_opportunity', 'crm.update_opportunity_stage', 'crm.win_opportunity', 'crm.delete_opportunity', 'crm.opportunity_pipeline', 'crm.get_opportunities'],
    target: { path: '/crm/opportunities', labelKey: 'ai.actions.openOpportunities' },
  },
  {
    prefixes: ['crm.create_task', 'crm.update_task', 'crm.complete_task', 'crm.delete_task', 'crm.follow_ups', 'crm.get_tasks'],
    target: { path: '/crm/tasks', labelKey: 'ai.actions.openTasks' },
  },
  {
    prefixes: ['crm.create_activity', 'crm.update_activity', 'crm.delete_activity', 'crm.rep_performance', 'crm.get_activities', 'crm.sales_funnel', 'crm.lead_conversion'],
    target: { path: '/crm/activities', labelKey: 'ai.actions.openActivities' },
  },
];

/** Module-level fallbacks for tool prefixes that have no explicit route above. */
const MODULE_FALLBACKS: Array<{ prefixes: string[]; target: RouteTarget }> = [
  { prefixes: ['sales.'], target: { path: '/sales/invoices', labelKey: 'ai.actions.openSales' } },
  { prefixes: ['purchases.'], target: { path: '/purchases/invoices', labelKey: 'ai.actions.openPurchases' } },
  { prefixes: ['inventory.'], target: { path: '/inventory/products', labelKey: 'ai.actions.openProducts' } },
  { prefixes: ['accounting.'], target: { path: '/accounting/journal', labelKey: 'ai.actions.openJournal' } },
  { prefixes: ['manufacturing.'], target: { path: '/manufacturing/work-orders', labelKey: 'ai.actions.openWorkOrders' } },
  { prefixes: ['hr.'], target: { path: '/hr/employees', labelKey: 'ai.actions.openEmployees' } },
  { prefixes: ['crm.'], target: { path: '/crm/leads', labelKey: 'ai.actions.openLeads' } },
  { prefixes: ['settings.'], target: { path: '/settings', labelKey: 'ai.actions.openSettings' } },
  { prefixes: ['reports.'], target: { path: '/reports', labelKey: 'ai.actions.openReports' } },
  { prefixes: ['read.'], target: { path: '/reports', labelKey: 'ai.actions.openReports' } },
  { prefixes: ['search.'], target: { path: '/reports', labelKey: 'ai.actions.openReports' } },
];

/** Keyword → navigation suggestion for plain assistant text (no tool call). */
const TEXT_KEYWORDS: Array<{ keywords: string[]; target: RouteTarget }> = [
  { keywords: ['ميزان المراجعة', 'trial balance'], target: { path: '/accounting/trial', labelKey: 'ai.actions.openTrialBalance' } },
  { keywords: ['الأرباح والخسائر', 'أرباح وخسائر', 'profit', 'الربح'], target: { path: '/accounting/profit', labelKey: 'ai.actions.openProfitLoss' } },
  { keywords: ['الميزانية العمومية', 'ميزانية', 'balance sheet'], target: { path: '/accounting/balance', labelKey: 'ai.actions.openBalanceSheet' } },
  { keywords: ['التدفقات النقدية', 'تدفق نقدي', 'cash flow'], target: { path: '/accounting/cashflow', labelKey: 'ai.actions.openCashFlow' } },
  { keywords: ['المخزون المنخفض', 'منخفض المخزون', 'low stock'], target: { path: '/reports/low-stock-alert', labelKey: 'ai.actions.openLowStock' } },
  { keywords: ['فواتير المبيعات', 'فاتورة مبيعات', 'sales invoice'], target: { path: '/sales/invoices', labelKey: 'ai.actions.openSales' } },
  { keywords: ['العملاء', 'customer'], target: { path: '/sales/customers', labelKey: 'ai.actions.openCustomers' } },
  { keywords: ['الموردين', 'supplier'], target: { path: '/purchases/suppliers', labelKey: 'ai.actions.openSuppliers' } },
  { keywords: ['الموظفين', 'employee'], target: { path: '/hr/employees', labelKey: 'ai.actions.openEmployees' } },
  { keywords: ['قيد يومي', 'journal'], target: { path: '/accounting/journal', labelKey: 'ai.actions.openJournal' } },
  { keywords: ['سند قبض', 'receipt voucher'], target: { path: '/accounting/receipt-vouchers', labelKey: 'ai.actions.openReceiptVouchers' } },
  { keywords: ['سند صرف', 'payment voucher'], target: { path: '/accounting/payment-vouchers', labelKey: 'ai.actions.openPaymentVouchers' } },
];

function findRoute(toolName: string): RouteTarget | null {
  for (const { prefixes, target } of TOOL_ROUTES) {
    if (prefixes.some((p) => toolName.startsWith(p) || toolName === p)) return target;
  }
  for (const { prefixes, target } of MODULE_FALLBACKS) {
    if (prefixes.some((p) => toolName.startsWith(p))) return target;
  }
  return null;
}

function isWriteTool(toolName: string): boolean {
  const action = toolName.split('.')[1] ?? '';
  return (
    action.startsWith('create_') ||
    action.startsWith('post_') ||
    action.startsWith('update_') ||
    action.startsWith('delete_') ||
    action.startsWith('convert_')
  );
}

/** Suggestions for an assistant message that carried a tool call. */
export function suggestionsForToolCall(toolName: string): Suggestion[] {
  const target = findRoute(toolName);
  const result: Suggestion[] = [];

  if (target) {
    result.push({
      id: `nav-${toolName}`,
      type: 'navigate',
      labelKey: target.labelKey,
      path: target.path,
    });
  }

  if (isWriteTool(toolName)) {
    result.push({
      id: `prompt-another-${toolName}`,
      type: 'prompt',
      labelKey: 'ai.actions.createAnother',
      promptKey: 'ai.actions.createAnother',
    });
  } else {
    result.push({
      id: `prompt-compare-${toolName}`,
      type: 'prompt',
      labelKey: 'ai.actions.comparePrevious',
      promptKey: 'ai.actions.comparePrevious',
    });
  }

  return result;
}

/** Suggestions for plain assistant text (no tool call) via keyword matching. */
export function suggestionsForText(text: string): Suggestion[] {
  const lower = text.toLowerCase();
  const seen = new Set<string>();
  const result: Suggestion[] = [];

  for (const { keywords, target } of TEXT_KEYWORDS) {
    if (seen.has(target.path)) continue;
    if (keywords.some((k) => lower.includes(k.toLowerCase()))) {
      seen.add(target.path);
      result.push({
        id: `kw-${target.path}`,
        type: 'navigate',
        labelKey: target.labelKey,
        path: target.path,
      });
    }
  }

  return result.slice(0, 4);
}

/** Main entry — derive suggestions from an assistant message. */
export function extractSuggestions(message: ChatMessage): Suggestion[] {
  if (message.role !== 'assistant') return [];

  if (message.toolCall && message.toolCall.status === 'success') {
    return suggestionsForToolCall(message.toolCall.toolName);
  }

  if (message.content) {
    return suggestionsForText(message.content);
  }

  return [];
}
