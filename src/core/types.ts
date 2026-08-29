export interface DocumentSequence {
  id: string;
  companyId: string;
  documentType: string;
  prefix: string;
  suffix: string;
  startingNumber: number;
  currentNumber: number;
  incrementStep: number;
  paddingLength: number;
  yearReset: boolean;
  isActive: boolean;
}

export interface ProductType {
  id: string;
  companyId: string;
  nameAr: string;
  nameEn?: string;
  code?: string;
  appearsInSales: boolean;
  appearsInPurchases: boolean;
  appearsInInventory: boolean;
  appearsInManufacturing: boolean;
  hasStockTracking: boolean;
  hasBOM: boolean;
  /** Semantic classification: 'finished' (منتج نهائي/تام), 'raw' (مواد أولية/خام), 'other'. */
  usage?: 'finished' | 'raw' | 'other';
  defaultSalesAccountId?: string;
  defaultCOGSAccountId?: string;
  defaultInventoryAccountId?: string;
  isActive: boolean;
}

export interface Unit {
  id: string;
  companyId: string;
  nameAr: string;
  nameEn?: string;
  code?: string;
  conversionFactor: number;
  baseUnitId?: string;
  isActive: boolean;
}

export interface CashBox {
  id: string;
  companyId: string;
  name: string;
  code?: string;
  accountId?: string;
  branchId?: string;
  responsibleUserId?: string;
  isActive: boolean;
  currentBalance: number;
}

export interface CostCenter {
  id: string;
  companyId: string;
  nameAr: string;
  nameEn?: string;
  code?: string;
  parentId?: string;
  type: string;
  budgetAmount: number;
  isActive: boolean;
}

export interface PayrollComponent {
  id: string;
  companyId: string;
  nameAr: string;
  nameEn?: string;
  code?: string;
  type: string;
  calculationMethod: string;
  defaultAmount: number;
  affectsGrossSalary: boolean;
  affectsTax: boolean;
  affectsSocialInsurance: boolean;
  defaultAccountId?: string;
  isActive: boolean;
}

export interface DefaultAccount {
  id: string;
  companyId: string;
  functionKey: string;
  accountId?: string | null;
  isRequired: boolean;
  description?: string;
}

export const DEFAULT_ACCOUNT_FUNCTIONS: { key: string; labelAr: string; labelEn: string; required: boolean }[] = [
  { key: 'default_cash', labelAr: 'الصندوق الافتراضي', labelEn: 'Default Cash', required: true },
  { key: 'default_sales', labelAr: 'مبيعات', labelEn: 'Sales', required: true },
  { key: 'default_cogs', labelAr: 'تكلفة البضاعة المباعة', labelEn: 'COGS', required: true },
  { key: 'default_inventory', labelAr: 'المخزون', labelEn: 'Inventory', required: true },
  { key: 'default_debtors', labelAr: 'العملاء', labelEn: 'Debtors', required: true },
  { key: 'default_creditors', labelAr: 'الموردين', labelEn: 'Creditors', required: true },
  { key: 'default_vat_output', labelAr: 'ضريبة مبيعات', labelEn: 'VAT Output', required: true },
  { key: 'default_vat_input', labelAr: 'ضريبة مشتريات', labelEn: 'VAT Input', required: true },
  { key: 'default_salaries', labelAr: 'الرواتب', labelEn: 'Salaries', required: true },
  { key: 'default_discount_allowed', labelAr: 'خصم مسموح', labelEn: 'Discount Allowed', required: false },
  { key: 'default_discount_received', labelAr: 'خصم مقبوض', labelEn: 'Discount Received', required: false },
  { key: 'default_sales_returns', labelAr: 'مردودات مبيعات', labelEn: 'Sales Returns', required: true },
  { key: 'default_purchase_returns', labelAr: 'مردودات مشتريات', labelEn: 'Purchase Returns', required: true },
  // ── المخازن والتصنيع ──
  { key: 'default_wip', labelAr: 'بضاعة تحت التشغيل', labelEn: 'Work in Progress', required: false },
  { key: 'default_finished_goods', labelAr: 'مخزون البضاعة التامة', labelEn: 'Finished Goods', required: false },
  { key: 'default_production_labor', labelAr: 'عمالة الإنتاج', labelEn: 'Production Labor', required: false },
  { key: 'default_production_energy', labelAr: 'طاقة الإنتاج', labelEn: 'Production Energy', required: false },
  { key: 'default_production_packaging', labelAr: 'تغليف الإنتاج', labelEn: 'Production Packaging', required: false },
  { key: 'default_production_other', labelAr: 'تكاليف إنتاج أخرى', labelEn: 'Production Other', required: false },
  { key: 'default_production_loss', labelAr: 'خسائر الإنتاج', labelEn: 'Production Losses', required: false },
  // ── حسابات عامة ──
  { key: 'default_opening_balance', labelAr: 'الأرصدة الافتتاحية', labelEn: 'Opening Balance Equity', required: false },
  { key: 'default_shipping', labelAr: 'النقل والشحن', labelEn: 'Shipping & Freight', required: false },
  { key: 'default_rent', labelAr: 'الإيجار', labelEn: 'Rent', required: false },
  { key: 'default_misc_expense', labelAr: 'مصروفات متنوعة', labelEn: 'Miscellaneous Expenses', required: false },
];
