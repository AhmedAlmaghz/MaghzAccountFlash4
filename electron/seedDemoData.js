import { pbkdf2Sync, randomBytes } from 'crypto';
import { fileURLToPath } from 'url';
import path from 'path';

/**
 * Comprehensive demo data seeder for PostgreSQL
 * Populates a freshly-created (or empty) company with realistic demo data
 * for all 11 ERP modules. Safe to re-run: every insert is guarded by
 * either a UNIQUE constraint or an explicit WHERE NOT EXISTS.
 *
 * Conventions:
 *   - Account codes mirror those created by seedInitialData (5 digits, e.g. 11101)
 *   - All multi-tenant tables filter on company_id
 *   - All created_by/updated_by are set to the admin user if available
 */

const PBKDF2_ITERATIONS = 100000;
const SALT_LENGTH = 32;
function hashPasswordNode(password) {
  const salt = randomBytes(SALT_LENGTH).toString('hex');
  const hash = pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, 'sha256').toString('hex');
  return `pbkdf2:${PBKDF2_ITERATIONS}:${salt}:${hash}`;
}

// Strong random fallback so no hardcoded default password ever exists.
function crypto_randPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(20);
  let out = '';
  for (let i = 0; i < 20; i++) out += chars[bytes[i] % chars.length];
  return out;
}

const VAT_RATE = 0.15;

const ACCOUNTS = [
  // Assets
  { code: '1', name_ar: 'الأصول', name_en: 'Assets', type: 'asset', nature: 'debit', is_group: true, parent_code: null },
  { code: '11', name_ar: 'الأصول المتداولة', name_en: 'Current Assets', type: 'asset', nature: 'debit', is_group: true, parent_code: '1' },
  { code: '111', name_ar: 'الصندوق والبنوك', name_en: 'Cash & Treasuries', type: 'asset', nature: 'debit', is_group: true, parent_code: '11' },
  { code: '11101', name_ar: 'الصندوق الرئيسي', name_en: 'Main Cash', type: 'asset', nature: 'debit', is_group: false, balance: 5000000, parent_code: '111' },
  { code: '112', name_ar: 'المدينون', name_en: 'Receivables', type: 'asset', nature: 'debit', is_group: true, parent_code: '11' },
  { code: '11201', name_ar: 'المدينون التجاريون', name_en: 'Trade Customers', type: 'asset', nature: 'debit', is_group: false, parent_code: '112' },
  { code: '11202', name_ar: 'سلف الموظفين', name_en: 'Employee Advances', type: 'asset', nature: 'debit', is_group: false, parent_code: '112' },
  { code: '113', name_ar: 'المخزون', name_en: 'Inventory', type: 'asset', nature: 'debit', is_group: true, parent_code: '11' },
  { code: '11301', name_ar: 'بضاعة أول المدة', name_en: 'Opening Inventory', type: 'asset', nature: 'debit', is_group: false, parent_code: '113' },
  // Liabilities
  { code: '2', name_ar: 'الالتزامات', name_en: 'Liabilities', type: 'liability', nature: 'credit', is_group: true, parent_code: null },
  { code: '21', name_ar: 'الالتزامات المتداولة', name_en: 'Current Liabilities', type: 'liability', nature: 'credit', is_group: true, parent_code: '2' },
  { code: '211', name_ar: 'الدائنون', name_en: 'Payables', type: 'liability', nature: 'credit', is_group: true, parent_code: '21' },
  { code: '21101', name_ar: 'الدائنون التجاريون', name_en: 'Trade Suppliers', type: 'liability', nature: 'credit', is_group: false, parent_code: '211' },
  { code: '213', name_ar: 'الضرائب', name_en: 'Taxes', type: 'liability', nature: 'credit', is_group: true, parent_code: '21' },
  { code: '21301', name_ar: 'ضريبة القيمة المضافة', name_en: 'VAT Payable', type: 'liability', nature: 'credit', is_group: false, parent_code: '213' },
  // Equity
  { code: '3', name_ar: 'حقوق الملكية', name_en: 'Equity', type: 'equity', nature: 'credit', is_group: true, parent_code: null },
  { code: '311', name_ar: 'رأس المال', name_en: 'Capital', type: 'equity', nature: 'credit', is_group: true, parent_code: '3' },
  { code: '31101', name_ar: 'رأس المال المدفوع', name_en: 'Paid-in Capital', type: 'equity', nature: 'credit', is_group: false, balance: 20000000, parent_code: '311' },
  { code: '312', name_ar: 'أرصدة افتتاحية وفروق تسوية', name_en: 'Opening Balance & Adjustments', type: 'equity', nature: 'credit', is_group: true, parent_code: '3' },
  { code: '31201', name_ar: 'حساب الأرصدة الافتتاحية', name_en: 'Opening Balance Equity', type: 'equity', nature: 'credit', is_group: false, parent_code: '312' },
  // Revenues
  { code: '4', name_ar: 'الإيرادات', name_en: 'Revenues', type: 'revenue', nature: 'credit', is_group: true, parent_code: null },
  { code: '41', name_ar: 'إيرادات المبيعات', name_en: 'Sales Revenue', type: 'revenue', nature: 'credit', is_group: true, parent_code: '4' },
  { code: '411', name_ar: 'المبيعات', name_en: 'Sales', type: 'revenue', nature: 'credit', is_group: true, parent_code: '41' },
  { code: '41101', name_ar: 'مبيعات المنتجات', name_en: 'Product Sales', type: 'revenue', nature: 'credit', is_group: false, parent_code: '411' },
  { code: '41102', name_ar: 'مبيعات الخدمات', name_en: 'Services Sales', type: 'revenue', nature: 'credit', is_group: false, parent_code: '411' },
  { code: '41103', name_ar: 'مردودات المبيعات', name_en: 'Sales Returns', type: 'revenue', nature: 'credit', is_group: false, parent_code: '411' },
  // Expenses
  { code: '5', name_ar: 'المصروفات', name_en: 'Expenses', type: 'expense', nature: 'debit', is_group: true, parent_code: null },
  { code: '51', name_ar: 'تكلفة المبيعات', name_en: 'Cost of Sales', type: 'expense', nature: 'debit', is_group: true, parent_code: '5' },
  { code: '511', name_ar: 'تكلفة البضاعة', name_en: 'COGS', type: 'expense', nature: 'debit', is_group: true, parent_code: '51' },
  { code: '51101', name_ar: 'تكلفة بضاعة مباعة', name_en: 'Cost of Goods Sold', type: 'expense', nature: 'debit', is_group: false, parent_code: '511' },
  { code: '52', name_ar: 'مصاريف تشغيلية', name_en: 'Operating Expenses', type: 'expense', nature: 'debit', is_group: true, parent_code: '5' },
  { code: '52101', name_ar: 'رواتب الموظفين', name_en: 'Employee Salaries', type: 'expense', nature: 'debit', is_group: false, parent_code: '52' },
  { code: '52201', name_ar: 'مصروفات الإيجار', name_en: 'Rent Expense', type: 'expense', nature: 'debit', is_group: false, parent_code: '52' },
  // Production costs (capitalized into finished-goods cost on work-order completion)
  { code: '53', name_ar: 'تكاليف الإنتاج', name_en: 'Production Costs', type: 'expense', nature: 'debit', is_group: true, parent_code: '5' },
  { code: '53101', name_ar: 'تكاليف إنتاج - أجور', name_en: 'Production Costs - Labor', type: 'expense', nature: 'debit', is_group: false, parent_code: '53' },
  { code: '53201', name_ar: 'تكاليف إنتاج - طاقة', name_en: 'Production Costs - Energy', type: 'expense', nature: 'debit', is_group: false, parent_code: '53' },
  { code: '53301', name_ar: 'تكاليف إنتاج - تغليف', name_en: 'Production Costs - Packaging', type: 'expense', nature: 'debit', is_group: false, parent_code: '53' },
  { code: '53401', name_ar: 'تكاليف إنتاج - أخرى', name_en: 'Production Costs - Other', type: 'expense', nature: 'debit', is_group: false, parent_code: '53' },
];

const PRODUCT_TYPES = [
  { code: 'TRADE', name_ar: 'سلعة تجارية', name_en: 'Trading Goods', appears_in_sales: true, appears_in_purchases: true, appears_in_inventory: true, appears_in_manufacturing: false, has_stock_tracking: true, has_bom: false, sales: '41101', cogs: '51101', inv: '11301' },
  { code: 'SRV',   name_ar: 'خدمة',           name_en: 'Service',          appears_in_sales: true, appears_in_purchases: false, appears_in_inventory: false, appears_in_manufacturing: false, has_stock_tracking: false, has_bom: false, sales: '41102', cogs: null, inv: null },
  { code: 'RAW',   name_ar: 'مواد أولية',     name_en: 'Raw Materials',    appears_in_sales: false, appears_in_purchases: true, appears_in_inventory: true, appears_in_manufacturing: true, has_stock_tracking: true, has_bom: true, sales: null, cogs: '51101', inv: '11301' },
  { code: 'FG',    name_ar: 'سلع تامة الإنتاج', name_en: 'Finished Goods',  appears_in_sales: true, appears_in_purchases: false, appears_in_inventory: true, appears_in_manufacturing: true, has_stock_tracking: true, has_bom: false, sales: '41101', cogs: '51101', inv: '11301' },
  { code: 'CON',   name_ar: 'مستهلك',         name_en: 'Consumable',       appears_in_sales: false, appears_in_purchases: true, appears_in_inventory: true, appears_in_manufacturing: false, has_stock_tracking: true, has_bom: false, sales: null, cogs: null, inv: '11301' },
];

const UNITS = [
  { code: 'UNT',  name_ar: 'وحدة',       name_en: 'Unit',    conv: 1 },
  { code: 'CTN', name_ar: 'كرتون',     name_en: 'Carton',   conv: 1 },
  { code: 'KG',  name_ar: 'كيلوغرام',   name_en: 'Kilogram', conv: 1 },
  { code: 'LTR', name_ar: 'لتر',         name_en: 'Liter',    conv: 1 },
  { code: 'MTR', name_ar: 'متر',         name_en: 'Meter',    conv: 1 },
  { code: 'PC',  name_ar: 'حبة',  name_en: 'Piece',  conv: 1 },
  { code: 'PK',  name_ar: 'شدة',  name_en: 'Pack',   conv: 1 }, // أو Bundle
  { code: 'CAN', name_ar: 'علبة', name_en: 'Can',    conv: 1 }, // أو Tin / Box (BX)
  { code: 'DZ',  name_ar: 'درزن', name_en: 'Dozen',  conv: 1 },
  { code: 'BKT', name_ar: 'سطل',  name_en: 'Bucket', conv: 1 }, // أو Pail
  { code: 'BLK', name_ar: 'قالب', name_en: 'Block',  conv: 1 }, // أو Mold
];

const CURRENCIES = [
  { code: 'YER', name: 'الريال اليمني', symbol: 'ر.ي', rate: 1,    is_default: true },
  { code: 'USD', name: 'دولار أمريكي',  symbol: '$',   rate: 535, is_default: false },
  { code: 'SAR', name: 'ريال سعودي',    symbol: 'ر.س', rate: 140,  is_default: false },
];

const DEFAULT_ACCOUNTS = [
  { key: 'default_cash', code: '11101', required: true,  desc: 'الحساب الافتراضي للصناديق النقدية' },
  { key: 'default_sales', code: '41101', required: true,  desc: 'حساب المبيعات الافتراضي' },
  { key: 'default_cogs', code: '51101', required: true,  desc: 'حساب تكلفة البضاعة المباعة' },
  { key: 'default_inventory', code: '11301', required: true, desc: 'حساب المخزون الافتراضي' },
  { key: 'default_debtors', code: '11201', required: true, desc: 'حساب المدينون التجاريون' },
  { key: 'default_creditors', code: '21101', required: true, desc: 'حساب الدائنون التجاريون' },
  { key: 'default_vat_output', code: '21301', required: true, desc: 'ضريبة القيمة المضافة على المبيعات' },
  { key: 'default_vat_input', code: '21301', required: true, desc: 'ضريبة القيمة المضافة على المشتريات' },
  { key: 'default_salaries', code: '52101', required: false, desc: 'حساب الرواتب' },
  { key: 'default_sales_returns', code: '41103', required: false, desc: 'حساب مردودات المبيعات' },
  { key: 'default_discount_allowed', code: '41101', required: false, desc: 'خصم مسموح به' },
  { key: 'default_discount_received', code: '21101', required: false, desc: 'خصم مكتسب' },
  { key: 'default_purchase_returns', code: '21101', required: true, desc: 'مردودات المشتريات' },
];

const BRANCHES = [
  { code: 'HQ',  name: 'الفرع الرئيسي - صنعاء', address: 'صنعاء - شارع الستين' },
  { code: 'HD',  name: 'فرع الحديدة',           address: 'الحديدة - شارع صنعاء' },
  { code: 'AD',  name: 'فرع عدن',                address: 'عدن - المنصورة' },
];

const COST_CENTERS = [
  { code: 'HQ',      name_ar: 'الفرع الرئيسي',  name_en: 'Main Branch',         type: 'branch',     budget: 0 },
  { code: 'CC-SAL',  name_ar: 'قسم المبيعات',   name_en: 'Sales Department',    type: 'department', budget: 1500000 },
  { code: 'CC-PRD',  name_ar: 'قسم الإنتاج',    name_en: 'Production Department', type: 'department', budget: 2500000 },
  { code: 'CC-EXP',  name_ar: 'مشروع التوسع',   name_en: 'Expansion Project',   type: 'project',    budget: 8000000 },
];

const PAYROLL_COMPONENTS = [
  { code: 'BAS', name_ar: 'الراتب الأساسي',      name_en: 'Base Salary',          type: 'earning',    method: 'fixed',      amount: 0,     gross: true,  tax: true,  ins: false },
  { code: 'HOU', name_ar: 'بدل سكن',             name_en: 'Housing Allowance',    type: 'earning',    method: 'fixed',      amount: 150000, gross: true,  tax: false, ins: false },
  { code: 'TRN', name_ar: 'بدل نقل',             name_en: 'Transport Allowance',  type: 'earning',    method: 'fixed',      amount: 50000,  gross: true,  tax: false, ins: false },
  { code: 'TAX', name_ar: 'ضريبة دخل',           name_en: 'Income Tax',           type: 'tax',        method: 'formula',    amount: 0,     gross: false, tax: true,  ins: false },
  { code: 'INS', name_ar: 'تأمينات اجتماعية',     name_en: 'Social Insurance',     type: 'deduction',  method: 'percentage', amount: 9,     gross: false, tax: false, ins: true },
];



const CASH_BOXES = [
  { name: 'الصندوق الرئيسي',  code: 'CB-MAIN',  balance: 5000000, account_code: '11101', responsible_role: 'admin' },
];

const PRODUCT_CATEGORIES = [
  { name: 'المواد الغذائية' },
  { name: 'مواد التنظيف' },
  { name: 'العناية الشخصية' },
];

const PRODUCTS = [
  { code: 'PRD-001', name_ar: 'أرز بسمتي فاخر',         name_en: 'Premium Basmati Rice',   barcode: '6223000123456', sku: 'RICE-BAS-5KG',  unit: 'كيس',  cost: 2800,  price: 3200,  type: 'TRADE' },
  { code: 'PRD-002', name_ar: 'زيت نباتي 3 لتر',        name_en: 'Vegetable Oil 3L',       barcode: '6223000123457', sku: 'OIL-VEG-3L',   unit: 'علبة', cost: 4200,  price: 4800,  type: 'TRADE' },
  { code: 'PRD-003', name_ar: 'سكر أبيض 50 كغ',         name_en: 'White Sugar 50kg',       barcode: '6223000123458', sku: 'SUG-WHT-50KG', unit: 'كيس',  cost: 15000, price: 16500, type: 'TRADE' },
  { code: 'PRD-004', name_ar: 'دقيق فاخر 50 كغ',        name_en: 'Premium Flour 50kg',     barcode: '6223000123459', sku: 'FLR-PRM-50KG', unit: 'كيس',  cost: 9500,  price: 10500, type: 'TRADE' },
  { code: 'PRD-005', name_ar: 'معجون طماطم 400غ',       name_en: 'Tomato Paste 400g',      barcode: '6223000123460', sku: 'TOM-PST-400G', unit: 'علبة', cost: 380,   price: 450,   type: 'TRADE' },
  { code: 'PRD-006', name_ar: 'شاي ليبتون 200غ',        name_en: 'Lipton Tea 200g',        barcode: '6223000123461', sku: 'TEA-LIP-200G', unit: 'علبة', cost: 1200,  price: 1400,  type: 'TRADE' },
  { code: 'PRD-007', name_ar: 'حليب مجفف 2.5 كغ',       name_en: 'Milk Powder 2.5kg',      barcode: '6223000123462', sku: 'MLK-PWD-2.5K', unit: 'علبة', cost: 8500,  price: 9500,  type: 'TRADE' },
  { code: 'PRD-008', name_ar: 'تونة معلبة 185غ',        name_en: 'Canned Tuna 185g',       barcode: '6223000123463', sku: 'TUN-CAN-185G', unit: 'علبة', cost: 650,   price: 750,   type: 'TRADE' },
  { code: 'PRD-009', name_ar: 'صابون لوكس 125غ',        name_en: 'Lux Soap 125g',          barcode: '6223000123464', sku: 'SOAP-LUX-125G',unit: 'قطعة', cost: 280,   price: 330,   type: 'CON' },
  { code: 'PRD-010', name_ar: 'شامبو هيد آند شولدرز 400مل', name_en: 'Head & Shoulders 400ml', barcode: '6223000123465', sku: 'SHP-HNS-400M', unit: 'علبة', cost: 1800,  price: 2100,  type: 'CON' },
  { code: 'PRD-011', name_ar: 'معجون أسنان كولجيت 100مل', name_en: 'Colgate Toothpaste 100ml', barcode: '6223000123466', sku: 'PAS-COL-100M', unit: 'علبة', cost: 420,   price: 500,   type: 'CON' },
  { code: 'PRD-012', name_ar: 'منظف جليكسون 1 لتر',    name_en: 'Gleason Cleaner 1L',     barcode: '6223000123467', sku: 'CLN-GLX-1L',   unit: 'علبة', cost: 1100,  price: 1300,  type: 'CON' },
  { code: 'PRD-013', name_ar: 'مناديل فاين 200 منديل',  name_en: 'Fine Tissues 200',       barcode: '6223000123468', sku: 'TIS-FIN-200',  unit: 'علبة', cost: 350,   price: 420,   type: 'CON' },
  { code: 'PRD-014', name_ar: 'قهوة العربية 250غ',      name_en: 'Arabian Coffee 250g',    barcode: '6223000123469', sku: 'COF-ARA-250G', unit: 'علبة', cost: 2200,  price: 2600,  type: 'TRADE' },
  { code: 'PRD-015', name_ar: 'بسكويت أوريو 154غ',      name_en: 'Oreo Biscuits 154g',     barcode: '6223000123470', sku: 'BIS-ORE-154G', unit: 'علبة', cost: 550,   price: 650,   type: 'TRADE' },
  { code: 'PRD-016', name_ar: 'قمح سائب 100 كغ',        name_en: 'Bulk Wheat 100kg',       barcode: '6223000123471', sku: 'WHT-BLK-100KG', unit: 'كيس', cost: 18000, price: 20000, type: 'RAW' },
  { code: 'PRD-017', name_ar: 'زيت طعام سائب 20 لتر',   name_en: 'Bulk Cooking Oil 20L',   barcode: '6223000123472', sku: 'OIL-BLK-20L',  unit: 'عبوة', cost: 35000, price: 38000, type: 'RAW' },
  { code: 'PRD-018', name_ar: 'سلة الأمل التموينية',    name_en: 'Al-Amal Food Basket',    barcode: '6223000123473', sku: 'BSK-AML-001',  unit: 'سلة', cost: 25000, price: 30000, type: 'FG' },
];

const WAREHOUSES = [
  { code: 'WH-MAIN', name: 'المستودع الرئيسي - صنعاء' },
  { code: 'WH-HD',   name: 'مستودع الحديدة' },
  { code: 'WH-AD',   name: 'مستودع عدن' },
];

const CUSTOMERS = [
  { code: 'CUST-001', name: 'شركة البحر الأحمر للتجارة',     phone: '+967334455667', email: 'redsea@ye.com',     address: 'الحديدة - كمران',       balance: 950000 },
  { code: 'CUST-002', name: 'مؤسسة الجود للصناعات الغذائية',  phone: '+967112233445', email: 'aljawd@ye.com',    address: 'صنعاء - شارع الستين',   balance: 1200000 },
  { code: 'CUST-003', name: 'مؤسسة الصافي للمواد الغذائية',   phone: '+967778899001', email: 'alsafi@ye.com',    address: 'صنعاء - شارع الستين',   balance: 650000 },
  { code: 'CUST-004', name: 'شركة اليمن الدولية للاستيراد',  phone: '+967223344556', email: 'yemenintl@ye.com', address: 'صنعاء - شارع تعز',     balance: 1800000 },
  { code: 'CUST-005', name: 'مؤسسة الحديدة التجارية',         phone: '+967556677889', email: 'hodeidah@ye.com',  address: 'الحديدة - شارع صنعاء',  balance: 320000 },
  { code: 'CUST-006', name: 'مؤسسة عدن التجارية',             phone: '+967667788990', email: 'aden@ye.com',      address: 'عدن - المنصورة',        balance: 450000 },
  { code: 'CUST-007', name: 'مؤسسة إب للصناعات',             phone: '+967778899112', email: 'ibb@ye.com',       address: 'إب - الجمهورية',        balance: 280000 },
  { code: 'CUST-008', name: 'مؤسسة تعز التجارية',             phone: '+967889900223', email: 'taiz@ye.com',      address: 'تعز - المطار القديم',    balance: 510000 },
];

const SUPPLIERS = [
  { code: 'SUP-001', name: 'شركة الخليج للاستيراد', phone: '+967998877665', email: 'gulf@ye.com',   address: 'جدة - السعودية',  balance: 0 },
  { code: 'SUP-002', name: 'مؤسسة الوفاق التجارية', phone: '+967112233990', email: 'wefaq@ye.com',  address: 'صنعاء - شارع الستين', balance: 0 },
  { code: 'SUP-003', name: 'شركة الإمارات للتجارة',  phone: '+97144223311',  email: 'uae@em.com',    address: 'دبي - الإمارات',  balance: 0 },
  { code: 'SUP-004', name: 'مؤسسة السعيد للتجارة',   phone: '+967334455112', email: 'alsaeed@ye.com', address: 'صنعاء - شارع تعز', balance: 0 },
  { code: 'SUP-005', name: 'شركة البركة للاستيراد',  phone: '+967556677334', email: 'baraka@ye.com', address: 'الحديدة - شارع صنعاء', balance: 0 },
  { code: 'SUP-006', name: 'مؤسسة الرشيد التجارية',  phone: '+967778899445', email: 'rashid@ye.com', address: 'عدن - المنصورة',  balance: 0 },
  { code: 'SUP-007', name: 'شركة الصقر الدولية',     phone: '+967889900556', email: 'saqr@ye.com',   address: 'إب - الجمهورية',  balance: 0 },
  { code: 'SUP-008', name: 'مؤسسة النجاح للتجارة',   phone: '+967990011667', email: 'najah@ye.com',  address: 'تعز - المطار القديم', balance: 0 },
];

const DEPARTMENTS = ['الإدارة', 'المبيعات', 'المخازن', 'المحاسبة'];

const EMPLOYEES = [
  { number: 'EMP-001', name: 'أحمد علي عبدالله',         phone: '+967111222333', email: 'ahmed@demo.ye',     dept: 'الإدارة',   position: 'مدير عام',         grade: 'A', hire_date: '2020-01-15', salary: 450000 },
  { number: 'EMP-002', name: 'خالد سعيد الحسني',         phone: '+967222333444', email: 'khaled@demo.ye',    dept: 'المبيعات',  position: 'مدير مبيعات',      grade: 'A', hire_date: '2020-03-10', salary: 350000 },
  { number: 'EMP-003', name: 'محمد صالح القاضي',         phone: '+967333444555', email: 'mohammed@demo.ye',  dept: 'المخازن',   position: 'مدير مخازن',       grade: 'B', hire_date: '2021-02-01', salary: 280000 },
  { number: 'EMP-004', name: 'فاطمة عبدالرحمن',         phone: '+967444555666', email: 'fatima@demo.ye',    dept: 'المحاسبة',  position: 'رئيسة محاسبين',    grade: 'A', hire_date: '2020-06-20', salary: 320000 },
  { number: 'EMP-005', name: 'عبدالله يحيى المخلافي',     phone: '+967555666777', email: 'abdullah@demo.ye',  dept: 'المبيعات',  position: 'مندوب مبيعات',     grade: 'C', hire_date: '2022-01-10', salary: 180000 },
  { number: 'EMP-006', name: 'سميرة علي الأحمدي',         phone: '+967666777888', email: 'samira@demo.ye',    dept: 'المحاسبة',  position: 'محاسبة',           grade: 'C', hire_date: '2022-04-15', salary: 170000 },
  { number: 'EMP-007', name: 'ياسر محمود الكبسي',         phone: '+967777888999', email: 'yaser@demo.ye',     dept: 'المخازن',   position: 'أمين مخزن',        grade: 'C', hire_date: '2023-01-05', salary: 150000 },
  { number: 'EMP-008', name: 'هند صالح البركاني',         phone: '+967888999000', email: 'hind@demo.ye',      dept: 'الإدارة',   position: 'سكرتيرة',          grade: 'C', hire_date: '2023-03-12', salary: 140000 },
];

const LEADS = [
  { name: 'محمد عبدالله السقاف',  phone: '+967111000111', email: 'm.saqaf@example.com',    company: 'شركة السقاف التجارية',  source: 'معرض',           status: 'new',        value: 500000 },
  { name: 'سمير علي الحميري',     phone: '+967222000222', email: 's.alhamiri@example.com',  company: 'مؤسسة الحميري',        source: 'موقع إلكتروني', status: 'contacted',   value: 350000 },
  { name: 'ليلى محمود الأصبحي',    phone: '+967333000333', email: 'l.ashbah@example.com',    company: 'شركة الأصبحي',         source: 'توصية',         status: 'qualified',   value: 800000 },
  { name: 'عمر فاروق بامطرف',     phone: '+967444000444', email: 'o.bamtraf@example.com',   company: 'مؤسسة بامطرف',         source: 'إعلان',         status: 'new',        value: 200000 },
  { name: 'نادية صالح الكحلاني',  phone: '+967555000555', email: 'n.kahlan@example.com',    company: 'شركة الكحلاني',        source: 'معرض',           status: 'contacted',   value: 600000 },
  { name: 'هشام أحمد الجندي',     phone: '+967666000666', email: 'h.aljundi@example.com',   company: 'مؤسسة الجندي',         source: 'اتصال وارد',   status: 'qualified',   value: 450000 },
];

// ─── Helpers ────────────────────────────────────────────────────────────────
async function ensureRow(client, sql, params, label) {
  const res = await client.query(sql, params);
  return res.rows[0]?.id;
}

async function getAdminUser(client, companyId) {
  const r = await client.query(
    `SELECT id FROM users WHERE company_id = $1 AND role = 'admin' ORDER BY created_at ASC LIMIT 1`,
    [companyId]
  );
  return r.rows[0]?.id || null;
}

export async function seedComprehensiveDemoData(client, companyId, adminPassword) {
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();
  let adminId = await getAdminUser(client, companyId);
  let generatedPassword = null;
  if (!adminId) {
    // Create the default admin user for the demo company — use the operator
    // supplied password, never a hardcoded one.
    const pw = typeof adminPassword === 'string' && adminPassword.length >= 8
      ? adminPassword
      : crypto_randPassword();
    const r = await client.query(
      `INSERT INTO users (company_id, username, email, full_name, password_hash, role, is_active)
       VALUES ($1::uuid, 'admin', 'admin@demo.ye', 'مدير النظام',
               $2, 'admin', TRUE)
       RETURNING id`,
      [companyId, hashPasswordNode(pw)]
    );
    adminId = r.rows[0]?.id;
    if (adminId) {
      generatedPassword = pw;
      console.log('[SEED] Created admin user (admin) with operator-supplied password');
    }
  }

  // ─── 1. Branches ──────────────────────────────────────────────────────────
  console.log('[SEED] Inserting branches...');
  for (const b of BRANCHES) {
    await client.query(
      `INSERT INTO branches (company_id, name, code, address, is_active, created_by, updated_by)
       SELECT $1::uuid, $2::text, $3::text, $4::text, TRUE, $5::uuid, $5::uuid
       WHERE NOT EXISTS (SELECT 1 FROM branches WHERE company_id = $1::uuid AND code = $3::text);`,
      [companyId, b.name, b.code, b.address, adminId]
    );
  }

  // ─── 2. Chart of Accounts ────────────────────────────────────────────────
  console.log('[SEED] Inserting chart of accounts...');
  const codeToId = new Map();
  for (const acc of ACCOUNTS) {
    const parentId = acc.parent_code ? codeToId.get(acc.parent_code) : null;
    const r = await client.query(
      `INSERT INTO accounts (company_id, code, name_ar, name_en, parent_id, type, nature, is_group, balance, is_active)
       SELECT $1::uuid, $2::text, $3::text, $4::text, $5::uuid, $6::text, $7::text, $8::bool, COALESCE($9::numeric, 0), TRUE
       WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE company_id = $1::uuid AND code = $2::text)
       RETURNING id;`,
      [companyId, acc.code, acc.name_ar, acc.name_en, parentId, acc.type, acc.nature, acc.is_group, acc.balance ?? null]
    );
    let id = r.rows[0]?.id;
    if (!id) {
      const sel = await client.query(`SELECT id FROM accounts WHERE company_id = $1::uuid AND code = $2::text`, [companyId, acc.code]);
      id = sel.rows[0]?.id;
    }
    if (id) codeToId.set(acc.code, id);
  }

  // ─── 3. Product Types ────────────────────────────────────────────────────
  console.log('[SEED] Inserting product types...');
  const typeCodeToId = new Map();
  for (const pt of PRODUCT_TYPES) {
    const salesId = pt.sales ? codeToId.get(pt.sales) : null;
    const cogsId = pt.cogs ? codeToId.get(pt.cogs) : null;
    const invId = pt.inv ? codeToId.get(pt.inv) : null;
    const r = await client.query(
      `INSERT INTO product_types (company_id, code, name_ar, name_en, appears_in_sales, appears_in_purchases, appears_in_inventory, appears_in_manufacturing, has_stock_tracking, has_bom, default_sales_account_id, default_cogs_account_id, default_inventory_account_id, is_active, created_by, updated_by)
       SELECT $1::uuid, $2::text, $3::text, $4::text, $5::bool, $6::bool, $7::bool, $8::bool, $9::bool, $10::bool, $11::uuid, $12::uuid, $13::uuid, TRUE, $14::uuid, $14::uuid
       WHERE NOT EXISTS (SELECT 1 FROM product_types WHERE company_id = $1::uuid AND code = $2::text)
       RETURNING id;`,
      [companyId, pt.code, pt.name_ar, pt.name_en, pt.appears_in_sales, pt.appears_in_purchases, pt.appears_in_inventory, pt.appears_in_manufacturing, pt.has_stock_tracking, pt.has_bom, salesId, cogsId, invId, adminId]
    );
    let id = r.rows[0]?.id;
    if (!id) {
      const sel = await client.query(`SELECT id FROM product_types WHERE company_id = $1::uuid AND code = $2::text`, [companyId, pt.code]);
      id = sel.rows[0]?.id;
    }
    if (id) typeCodeToId.set(pt.code, id);
  }

  // ─── 4. Units ────────────────────────────────────────────────────────────
  console.log('[SEED] Inserting units...');
  for (const u of UNITS) {
    await client.query(
      `INSERT INTO units (company_id, code, name_ar, name_en, conversion_factor, is_active)
       SELECT $1::uuid, $2::text, $3::text, $4::text, $5::numeric, TRUE
       WHERE NOT EXISTS (SELECT 1 FROM units WHERE company_id = $1::uuid AND code = $2::text);`,
      [companyId, u.code, u.name_ar, u.name_en, u.conv]
    );
  }

  // ─── 5. Cost Centers ─────────────────────────────────────────────────────
  console.log('[SEED] Inserting cost centers...');
  for (const cc of COST_CENTERS) {
    await client.query(
      `INSERT INTO cost_centers (company_id, code, name_ar, name_en, type, budget_amount, is_active)
       SELECT $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::numeric, TRUE
       WHERE NOT EXISTS (SELECT 1 FROM cost_centers WHERE company_id = $1::uuid AND code = $2::text);`,
      [companyId, cc.code, cc.name_ar, cc.name_en, cc.type, cc.budget]
    );
  }

  // ─── 6b. Cash Boxes ──────────────────────────────────────────────────────
  console.log('[SEED] Inserting cash boxes...');
  for (const cb of CASH_BOXES) {
    const accountId = codeToId.get(cb.account_code);
    const responsibleUserId = cb.responsible_role === 'admin' ? adminId
      : cb.responsible_role === 'manager' ? adminId
      : adminId;
    await client.query(
      `INSERT INTO cash_boxes (company_id, name, code, account_id, responsible_user_id, is_active, current_balance, created_by, updated_by)
       SELECT $1::uuid, $2::text, $3::text, $4::uuid, $5::uuid, TRUE, $6::numeric, $7::uuid, $7::uuid
       WHERE NOT EXISTS (SELECT 1 FROM cash_boxes WHERE company_id = $1::uuid AND code = $3::text);`,
      [companyId, cb.name, cb.code, accountId, responsibleUserId, cb.balance, adminId]
    );
  }

  // ─── 7. Default Accounts ─────────────────────────────────────────────────
  console.log('[SEED] Linking default accounts...');
  for (const da of DEFAULT_ACCOUNTS) {
    const accountId = codeToId.get(da.code);
    if (!accountId) continue;
    await client.query(
      `INSERT INTO default_accounts (company_id, function_key, account_id, is_required, description)
       SELECT $1::uuid, $2::text, $3::uuid, $4::bool, $5::text
       WHERE NOT EXISTS (SELECT 1 FROM default_accounts WHERE company_id = $1::uuid AND function_key = $2::text);`,
      [companyId, da.key, accountId, da.required, da.desc]
    );
  }

  // ─── 8. Currencies ───────────────────────────────────────────────────────
  console.log('[SEED] Inserting currencies...');
  for (const c of CURRENCIES) {
    await client.query(
      `INSERT INTO currencies (company_id, code, name, symbol, exchange_rate, is_default, is_active, created_by, updated_by)
       SELECT $1::uuid, $2::text, $3::text, $4::text, $5::numeric, $6::bool, TRUE, $7::uuid, $7::uuid
       WHERE NOT EXISTS (SELECT 1 FROM currencies WHERE company_id = $1::uuid AND code = $2::text);`,
      [companyId, c.code, c.name, c.symbol, c.rate, c.is_default, adminId]
    );
  }

  // ─── 9. VAT Settings ────────────────────────────────────────────────────
  console.log('[SEED] Inserting VAT settings...');
  await client.query(
    `INSERT INTO vat_settings (company_id, vat_rate, vat_number, is_inclusive, is_active)
     SELECT $1::uuid, 15, $2::text, FALSE, TRUE
     WHERE NOT EXISTS (SELECT 1 FROM vat_settings WHERE company_id = $1::uuid);`,
    [companyId, '3100123456']
  );

  // ─── 10. Document Sequences ──────────────────────────────────────────────
  console.log('[SEED] Inserting document sequences...');
  
  
  const sequences = [
    // Sales
    { type: 'sales_invoice',     prefix: 'INV-',  start: 1, current: 6,  pad: 6 },
    { type: 'sales_return',      prefix: 'SRT-',  start: 1, current: 4,  pad: 4 },
    { type: 'quotation',         prefix: 'QOT-',  start: 1, current: 2,  pad: 4 },
    // Purchases
    { type: 'purchase_order',    prefix: 'PO-',   start: 1, current: 6,  pad: 6 },
    { type: 'purchase_invoice',  prefix: 'PINV-', start: 1, current: 4,  pad: 4 },
    { type: 'purchase_return',   prefix: 'PRT-',  start: 1, current: 2,  pad: 4 },
    // Accounting
    { type: 'journal_voucher',   prefix: 'JV-',   start: 1, current: 0,  pad: 7 },
    { type: 'receipt_voucher',   prefix: 'RV-',   start: 1, current: 3,  pad: 6 },
    { type: 'payment_voucher',   prefix: 'PV-',   start: 1, current: 3,  pad: 6 },
    // Manufacturing
    { type: 'work_order',        prefix: 'WO-',   start: 1, current: 0,  pad: 4 },
    { type: 'bom',               prefix: 'BOM-',  start: 1, current: 0,  pad: 4 },
    // HR
    { type: 'payroll_run',       prefix: 'PAY-',  start: 1, current: 0,  pad: 6 },
    // Inventory
    { type: 'product',           prefix: 'PRD-',  start: 1, current: 15,  pad: 7 },
    { type: 'warehouse',         prefix: 'WH-',   start: 1, current: 1,  pad: 3 },
    { type: 'stock_adjustment',  prefix: 'ADJ-',  start: 1, current: 0,  pad: 6 },
    { type: 'inventory_transfer',prefix: 'TRF-',  start: 1, current: 0,  pad: 6 },
    // CRM
    { type: 'customer',          prefix: 'CUS-',  start: 1, current: 5,  pad: 5 },
    { type: 'supplier',          prefix: 'SUP-',  start: 1, current: 5,  pad: 4 },
    // HR
    { type: 'employee',          prefix: 'EMP-',  start: 1, current: 15,  pad: 4 },
  ];


  for (const s of sequences) {
    await client.query(
      `INSERT INTO document_sequences (company_id, document_type, prefix, suffix, starting_number, current_number, increment_step, padding_length, year_reset, is_active)
       SELECT $1::uuid, $2::text, $3::text, '', $4::int, $5::int, 1, $6::int, FALSE, TRUE
       WHERE NOT EXISTS (SELECT 1 FROM document_sequences WHERE company_id = $1::uuid AND document_type = $2::text);`,
      [companyId, s.type, s.prefix, s.start, s.current, s.pad]
    );
  }

  // ─── 11. Customers ───────────────────────────────────────────────────────
  console.log('[SEED] Inserting customers...');
  for (const c of CUSTOMERS) {
    await client.query(
      `INSERT INTO customers (company_id, code, name, phone, email, address, balance, is_active)
       SELECT $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text, $7::numeric, TRUE
       WHERE NOT EXISTS (SELECT 1 FROM customers WHERE company_id = $1::uuid AND code = $2::text);`,
      [companyId, c.code, c.name, c.phone, c.email, c.address, c.balance]
    );
  }

  // ─── 12. Suppliers ───────────────────────────────────────────────────────
  console.log('[SEED] Inserting suppliers...');
  for (const s of SUPPLIERS) {
    await client.query(
      `INSERT INTO suppliers (company_id, code, name, phone, email, address, balance, is_active)
       SELECT $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text, $7::numeric, TRUE
       WHERE NOT EXISTS (SELECT 1 FROM suppliers WHERE company_id = $1::uuid AND code = $2::text);`,
      [companyId, s.code, s.name, s.phone, s.email, s.address, s.balance]
    );
  }

  // ─── 13. Product Categories ──────────────────────────────────────────────
  console.log('[SEED] Inserting product categories...');
  const catIdByName = new Map();
  for (const c of PRODUCT_CATEGORIES) {
    const r = await client.query(
      `INSERT INTO product_categories (company_id, name)
       SELECT $1::uuid, $2::text
       WHERE NOT EXISTS (SELECT 1 FROM product_categories WHERE company_id = $1::uuid AND name = $2::text)
       RETURNING id;`,
      [companyId, c.name]
    );
    let id = r.rows[0]?.id;
    if (!id) {
      const sel = await client.query(`SELECT id FROM product_categories WHERE company_id = $1::uuid AND name = $2::text`, [companyId, c.name]);
      id = sel.rows[0]?.id;
    }
    if (id) catIdByName.set(c.name, id);
  }
  const foodCatId = catIdByName.get('المواد الغذائية');

  // ─── 14. Products + category links ───────────────────────────────────────
  console.log('[SEED] Inserting products...');
  const productIdByCode = new Map();
  for (const p of PRODUCTS) {
    const typeId = typeCodeToId.get(p.type) || null;
    const r = await client.query(
      `INSERT INTO products (company_id, code, name_ar, name_en, barcode, sku, unit, category_id, product_type_id, cost_price, sale_price, is_active, created_by, updated_by)
       SELECT $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text, $7::text, $8::uuid, $9::uuid, $10::numeric, $11::numeric, TRUE, $12::uuid, $12::uuid
       WHERE NOT EXISTS (SELECT 1 FROM products WHERE company_id = $1::uuid AND code = $2::text)
       RETURNING id;`,
      [companyId, p.code, p.name_ar, p.name_en, p.barcode, p.sku, p.unit, foodCatId, typeId, p.cost, p.price, adminId]
    );
    let id = r.rows[0]?.id;
    if (!id) {
      const sel = await client.query(`SELECT id FROM products WHERE company_id = $1::uuid AND code = $2::text`, [companyId, p.code]);
      id = sel.rows[0]?.id;
    }
    if (id) {
      productIdByCode.set(p.code, id);
      if (foodCatId) {
        await client.query(
          `INSERT INTO product_product_categories (product_id, category_id)
           SELECT $1::uuid, $2::uuid
           WHERE NOT EXISTS (SELECT 1 FROM product_product_categories WHERE product_id = $1::uuid AND category_id = $2::uuid);`,
          [id, foodCatId]
        );
      }
    }
  }

  // ─── 15. Warehouses ──────────────────────────────────────────────────────
  console.log('[SEED] Inserting warehouses...');
  const whIdByCode = new Map();
  for (const w of WAREHOUSES) {
    const r = await client.query(
      `INSERT INTO warehouses (company_id, name, code, is_active)
       SELECT $1::uuid, $2::text, $3::text, TRUE
       WHERE NOT EXISTS (SELECT 1 FROM warehouses WHERE company_id = $1::uuid AND code = $3::text)
       RETURNING id;`,
      [companyId, w.name, w.code]
    );
    let id = r.rows[0]?.id;
    if (!id) {
      const sel = await client.query(`SELECT id FROM warehouses WHERE company_id = $1::uuid AND code = $2::text`, [companyId, w.code]);
      id = sel.rows[0]?.id;
    }
    if (id) whIdByCode.set(w.code, id);
  }
  const mainWhId = whIdByCode.get('WH-MAIN');

  // ─── 16. Stock ────────────────────────────────────────────────────────────
  console.log('[SEED] Inserting stock...');
  if (mainWhId) {
    const stockQtys = [500, 300, 200, 350, 1000, 600, 150, 800, 1200, 250, 900, 400, 700, 180, 500];
    let i = 0;
    for (const [, productId] of productIdByCode) {
      const qty = stockQtys[i] !== undefined ? stockQtys[i] : 0;
      const minAlert = Math.max(10, Math.round(qty * 0.1));
      await client.query(
        `INSERT INTO stock (company_id, product_id, warehouse_id, quantity, min_stock_alert)
         SELECT $1::uuid, $2::uuid, $3::uuid, $4::numeric, $5::numeric
         WHERE NOT EXISTS (SELECT 1 FROM stock WHERE company_id = $1::uuid AND product_id = $2::uuid AND warehouse_id = $3::uuid);`,
        [companyId, productId, mainWhId, qty, minAlert]
      );
      // Also create a corresponding stock_movement record
      await client.query(
        `INSERT INTO stock_movements (company_id, product_id, warehouse_id, type, quantity, reference, notes, created_by, updated_by)
         SELECT $1::uuid, $2::uuid, $3::uuid, 'in', $4::numeric, 'OPENING-BALANCE', 'رصيد افتتاحي', $5::uuid, $5::uuid
         WHERE NOT EXISTS (SELECT 1 FROM stock_movements WHERE company_id = $1::uuid AND reference = 'OPENING-BALANCE' AND product_id = $2::uuid);`,
        [companyId, productId, mainWhId, qty, adminId]
      );
      i++;
    }
  }

  // ─── 17. Employees + Departments ─────────────────────────────────────────
  console.log('[SEED] Inserting departments and employees...');
  const deptIdByName = new Map();
  for (const deptName of DEPARTMENTS) {
    const r = await client.query(
      `INSERT INTO departments (company_id, name)
       SELECT $1::uuid, $2::text
       WHERE NOT EXISTS (SELECT 1 FROM departments WHERE company_id = $1::uuid AND name = $2::text)
       RETURNING id;`,
      [companyId, deptName]
    );
    let id = r.rows[0]?.id;
    if (!id) {
      const sel = await client.query(`SELECT id FROM departments WHERE company_id = $1::uuid AND name = $2::text`, [companyId, deptName]);
      id = sel.rows[0]?.id;
    }
    if (id) deptIdByName.set(deptName, id);
  }
  const empIdByNumber = new Map();
  for (const emp of EMPLOYEES) {
    const deptId = deptIdByName.get(emp.dept);
    const r = await client.query(
      `INSERT INTO employees (company_id, employee_number, full_name, phone, email, department_id, position, grade, hire_date, base_salary, is_active, created_by, updated_by)
       SELECT $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::uuid, $7::text, $8::text, $9::date, $10::numeric, TRUE, $11::uuid, $11::uuid
       WHERE NOT EXISTS (SELECT 1 FROM employees WHERE company_id = $1::uuid AND employee_number = $2::text)
       RETURNING id;`,
      [companyId, emp.number, emp.name, emp.phone, emp.email, deptId, emp.position, emp.grade, emp.hire_date, emp.salary, adminId]
    );
    let id = r.rows[0]?.id;
    if (!id) {
      const sel = await client.query(`SELECT id FROM employees WHERE company_id = $1::uuid AND employee_number = $2::text`, [companyId, emp.number]);
      id = sel.rows[0]?.id;
    }
    if (id) empIdByNumber.set(emp.number, id);
  }

  // ─── 18. Payroll Components + Payroll Run ────────────────────────────────
  console.log('[SEED] Inserting payroll components...');
  for (const pc of PAYROLL_COMPONENTS) {
    await client.query(
      `INSERT INTO payroll_components (company_id, code, name_ar, name_en, type, calculation_method, default_amount, affects_gross_salary, affects_tax, affects_social_insurance, is_active)
       SELECT $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text, $7::numeric, $8::bool, $9::bool, $10::bool, TRUE
       WHERE NOT EXISTS (SELECT 1 FROM payroll_components WHERE company_id = $1::uuid AND code = $2::text);`,
      [companyId, pc.code, pc.name_ar, pc.name_en, pc.type, pc.method, pc.amount, pc.gross, pc.tax, pc.ins]
    );
  }

  // Create a draft payroll run for the current month
  if (empIdByNumber.size > 0) {
    console.log('[SEED] Inserting payroll run...');
    const payrollRunId = await client.query(
      `INSERT INTO payroll_runs (company_id, month, year, total_amount, status, created_by, updated_by)
       SELECT $1::uuid, $2::int, $3::int, 0, 'draft', $4::uuid, $4::uuid
       WHERE NOT EXISTS (SELECT 1 FROM payroll_runs WHERE company_id = $1::uuid AND month = $2::int AND year = $3::int)
       RETURNING id;`,
      [companyId, currentMonth, currentYear, adminId]
    );
    let prId = payrollRunId.rows[0]?.id;
    if (!prId) {
      const sel = await client.query(`SELECT id FROM payroll_runs WHERE company_id = $1::uuid AND month = $2::int AND year = $3::int`, [companyId, currentMonth, currentYear]);
      prId = sel.rows[0]?.id;
    }
    if (prId) {
      let total = 0;
      for (const [, empId] of empIdByNumber) {
        const empRes = await client.query(`SELECT base_salary FROM employees WHERE id = $1::uuid`, [empId]);
        const baseSalary = parseFloat(empRes.rows[0]?.base_salary || 0);
        const allowances = 200000;
        const deductions = Math.round(baseSalary * 0.09);
        const net = baseSalary + allowances - deductions;
        total += net;
        await client.query(
          `INSERT INTO payroll_lines (payroll_run_id, employee_id, base_salary, allowances, deductions, overtime, net_salary)
           SELECT $1::uuid, $2::uuid, $3::numeric, $4::numeric, $5::numeric, 0, $6::numeric
           WHERE NOT EXISTS (SELECT 1 FROM payroll_lines WHERE payroll_run_id = $1::uuid AND employee_id = $2::uuid);`,
          [prId, empId, baseSalary, allowances, deductions, net]
        );
      }
      if (total > 0) {
        await client.query(`UPDATE payroll_runs SET total_amount = $1::numeric WHERE id = $2::uuid`, [total, prId]);
      }
    }
  }

  // ─── 19. Sales Invoices (with lines) ─────────────────────────────────────
  console.log('[SEED] Inserting sales invoices...');
  // Helper: look up a customer or product id by code (mock-friendly pattern)
  async function lookupIdByCode(table, code) {
    const r = await client.query(`SELECT id FROM ${table} WHERE company_id = $1::uuid AND code = $2::text LIMIT 1`, [companyId, code]);
    return r.rows[0]?.id;
  }
  const customerCodes = ['CUST-001', 'CUST-002', 'CUST-003', 'CUST-004', 'CUST-005'];
  const productCodes = ['PRD-001', 'PRD-002', 'PRD-003', 'PRD-004', 'PRD-005', 'PRD-006', 'PRD-007', 'PRD-008', 'PRD-009'];
  const custIds = [];
  for (const c of customerCodes) { const id = await lookupIdByCode('customers', c); if (id) custIds.push({ code: c, id }); }
  const prodInfos = [];
  for (const c of productCodes) {
    const r = await client.query(`SELECT id, sale_price FROM products WHERE company_id = $1::uuid AND code = $2::text`, [companyId, c]);
    if (r.rows[0]) prodInfos.push({ code: c, id: r.rows[0].id, price: r.rows[0].sale_price });
  }
  if (custIds.length >= 5 && prodInfos.length >= 9) {
    const sampleInvoices = [
      { number: 'INV-0001', date: `${currentYear}-${String(currentMonth).padStart(2,'0')}-05`, custIdx: 0, lines: [{ prodIdx: 0, qty: 10 }, { prodIdx: 1, qty: 5 }] },
      { number: 'INV-0002', date: `${currentYear}-${String(currentMonth).padStart(2,'0')}-12`, custIdx: 1, lines: [{ prodIdx: 2, qty: 20 }] },
      { number: 'INV-0003', date: `${currentYear}-${String(currentMonth).padStart(2,'0')}-18`, custIdx: 2, lines: [{ prodIdx: 3, qty: 8 }, { prodIdx: 4, qty: 12 }] },
      { number: 'INV-0004', date: `${currentYear}-${String(currentMonth).padStart(2,'0')}-22`, custIdx: 3, lines: [{ prodIdx: 5, qty: 30 }] },
      { number: 'INV-0005', date: `${currentYear}-${String(currentMonth).padStart(2,'0')}-28`, custIdx: 4, lines: [{ prodIdx: 6, qty: 15 }, { prodIdx: 7, qty: 25 }, { prodIdx: 8, qty: 6 }] },
    ];
    for (const inv of sampleInvoices) {
      const subtotal = inv.lines.reduce((s, l) => s + (parseFloat(prodInfos[l.prodIdx].price) * l.qty), 0);
      const vatAmount = Math.round(subtotal * VAT_RATE);
      const totalAmount = subtotal + vatAmount;
      const insRes = await client.query(
        `INSERT INTO sales_invoices (company_id, invoice_number, customer_id, date, subtotal, vat_amount, total_amount, status, notes, created_by, updated_by)
         SELECT $1::uuid, $2::text, $3::uuid, $4::date, $5::numeric, $6::numeric, $7::numeric, 'posted', 'فاتورة تجريبية', $8::uuid, $8::uuid
         WHERE NOT EXISTS (SELECT 1 FROM sales_invoices WHERE company_id = $1::uuid AND invoice_number = $2::text)
         RETURNING id;`,
        [companyId, inv.number, custIds[inv.custIdx].id, inv.date, subtotal, vatAmount, totalAmount, adminId]
      );
      let invId = insRes.rows[0]?.id;
      if (!invId) {
        const sel = await client.query(`SELECT id FROM sales_invoices WHERE company_id = $1::uuid AND invoice_number = $2::text`, [companyId, inv.number]);
        invId = sel.rows[0]?.id;
      }
      if (invId) {
        for (const line of inv.lines) {
          const p = prodInfos[line.prodIdx];
          const lineTotal = parseFloat(p.price) * line.qty;
          await client.query(
            `INSERT INTO sales_invoice_lines (invoice_id, product_id, quantity, unit_price, discount_percent, vat_percent, line_total)
             VALUES ($1::uuid, $2::uuid, $3::numeric, $4::numeric, 0, 15, $5::numeric);`,
            [invId, p.id, line.qty, p.price, lineTotal]
          );
        }
      }
    }
  }

  // ─── 20. Purchase Orders (with lines) ────────────────────────────────────
  console.log('[SEED] Inserting purchase orders...');
  const supplierCodes = ['SUP-001', 'SUP-002', 'SUP-003'];
  const supIds = [];
  for (const c of supplierCodes) { const id = await lookupIdByCode('suppliers', c); if (id) supIds.push({ code: c, id }); }
  if (supIds.length >= 3 && prodInfos.length >= 5) {
    const samplePOs = [
      { number: 'PO-0001', date: `${currentYear}-${String(currentMonth).padStart(2,'0')}-03`, supIdx: 0, lines: [{ prodIdx: 0, qty: 100, price: 2800 }, { prodIdx: 1, qty: 50, price: 4200 }] },
      { number: 'PO-0002', date: `${currentYear}-${String(currentMonth).padStart(2,'0')}-10`, supIdx: 1, lines: [{ prodIdx: 2, qty: 200, price: 15000 }] },
      { number: 'PO-0003', date: `${currentYear}-${String(currentMonth).padStart(2,'0')}-20`, supIdx: 2, lines: [{ prodIdx: 3, qty: 80, price: 9500 }, { prodIdx: 4, qty: 150, price: 380 }] },
    ];
    for (const po of samplePOs) {
      const total = po.lines.reduce((s, l) => s + (l.qty * l.price), 0);
      const insRes = await client.query(
        `INSERT INTO purchase_orders (company_id, order_number, supplier_id, date, total_amount, status, notes, created_by, updated_by)
         SELECT $1::uuid, $2::text, $3::uuid, $4::date, $5::numeric, 'sent', 'طلب شراء تجريبي', $6::uuid, $6::uuid
         WHERE NOT EXISTS (SELECT 1 FROM purchase_orders WHERE company_id = $1::uuid AND order_number = $2::text)
         RETURNING id;`,
        [companyId, po.number, supIds[po.supIdx].id, po.date, total, adminId]
      );
      let poId = insRes.rows[0]?.id;
      if (!poId) {
        const sel = await client.query(`SELECT id FROM purchase_orders WHERE company_id = $1::uuid AND order_number = $2::text`, [companyId, po.number]);
        poId = sel.rows[0]?.id;
      }
      if (poId) {
        for (const line of po.lines) {
          await client.query(
            `INSERT INTO purchase_order_lines (order_id, product_id, quantity, unit_price, line_total)
             VALUES ($1::uuid, $2::uuid, $3::numeric, $4::numeric, $5::numeric);`,
            [poId, prodInfos[line.prodIdx].id, line.qty, line.price, line.qty * line.price]
          );
        }
      }
    }
  }

  // ─── 21. Purchase Invoices (with lines) ──────────────────────────────────
  console.log('[SEED] Inserting purchase invoices...');
  if (supIds.length >= 3 && prodInfos.length >= 5) {
    const samplePIs = [
      { number: 'PINV-0001', date: `${currentYear}-${String(currentMonth).padStart(2,'0')}-06`, supIdx: 0, lines: [{ prodIdx: 0, qty: 100, price: 2800 }, { prodIdx: 1, qty: 50, price: 4200 }] },
      { number: 'PINV-0002', date: `${currentYear}-${String(currentMonth).padStart(2,'0')}-14`, supIdx: 1, lines: [{ prodIdx: 2, qty: 200, price: 15000 }] },
      { number: 'PINV-0003', date: `${currentYear}-${String(currentMonth).padStart(2,'0')}-24`, supIdx: 2, lines: [{ prodIdx: 3, qty: 80, price: 9500 }] },
    ];
    for (const pi of samplePIs) {
      const subtotal = pi.lines.reduce((s, l) => s + (l.qty * l.price), 0);
      const vatAmount = Math.round(subtotal * VAT_RATE);
      const total = subtotal + vatAmount;
      const insRes = await client.query(
        `INSERT INTO purchase_invoices (company_id, invoice_number, supplier_id, date, subtotal, vat_amount, total_amount, status, notes, created_by, updated_by)
         SELECT $1::uuid, $2::text, $3::uuid, $4::date, $5::numeric, $6::numeric, $7::numeric, 'posted', 'فاتورة مشتريات تجريبية', $8::uuid, $8::uuid
         WHERE NOT EXISTS (SELECT 1 FROM purchase_invoices WHERE company_id = $1::uuid AND invoice_number = $2::text)
         RETURNING id;`,
        [companyId, pi.number, supIds[pi.supIdx].id, pi.date, subtotal, vatAmount, total, adminId]
      );
      let piId = insRes.rows[0]?.id;
      if (!piId) {
        const sel = await client.query(`SELECT id FROM purchase_invoices WHERE company_id = $1::uuid AND invoice_number = $2::text`, [companyId, pi.number]);
        piId = sel.rows[0]?.id;
      }
      if (piId) {
        for (const line of pi.lines) {
          await client.query(
            `INSERT INTO purchase_invoice_lines (invoice_id, product_id, quantity, unit_price, line_total)
             VALUES ($1::uuid, $2::uuid, $3::numeric, $4::numeric, $5::numeric);`,
            [piId, prodInfos[line.prodIdx].id, line.qty, line.price, line.qty * line.price]
          );
        }
      }
    }
  }

  // ─── 22. Quotations (with lines) ─────────────────────────────────────────
  console.log('[SEED] Inserting quotations...');
  if (custIds.length >= 2 && prodInfos.length >= 3) {
    const sampleQuotes = [
      { number: 'QOT-0001', date: `${currentYear}-${String(currentMonth).padStart(2,'0')}-02`, custIdx: 0, lines: [{ prodIdx: 0, qty: 15, disc: 5 }, { prodIdx: 1, qty: 8, disc: 0 }] },
      { number: 'QOT-0002', date: `${currentYear}-${String(currentMonth).padStart(2,'0')}-15`, custIdx: 1, lines: [{ prodIdx: 2, qty: 25, disc: 3 }] },
    ];
    for (const q of sampleQuotes) {
      const total = q.lines.reduce((s, l) => {
        const p = prodInfos[l.prodIdx];
        return s + (l.qty * parseFloat(p.price) * (1 - l.disc / 100));
      }, 0);
      const insRes = await client.query(
        `INSERT INTO quotations (company_id, quotation_number, customer_id, date, total_amount, status, notes, created_by, updated_by)
         SELECT $1::uuid, $2::text, $3::uuid, $4::date, $5::numeric, 'open', 'عرض سعر تجريبي', $6::uuid, $6::uuid
         WHERE NOT EXISTS (SELECT 1 FROM quotations WHERE company_id = $1::uuid AND quotation_number = $2::text)
         RETURNING id;`,
        [companyId, q.number, custIds[q.custIdx].id, q.date, Math.round(total), adminId]
      );
      let qId = insRes.rows[0]?.id;
      if (!qId) {
        const sel = await client.query(`SELECT id FROM quotations WHERE company_id = $1::uuid AND quotation_number = $2::text`, [companyId, q.number]);
        qId = sel.rows[0]?.id;
      }
      if (qId) {
        for (const line of q.lines) {
          const p = prodInfos[line.prodIdx];
          const lineTotal = line.qty * parseFloat(p.price) * (1 - line.disc / 100);
          await client.query(
            `INSERT INTO quotation_lines (quotation_id, product_id, quantity, unit_price, discount_percent, line_total)
             VALUES ($1::uuid, $2::uuid, $3::numeric, $4::numeric, $5::numeric, $6::numeric);`,
            [qId, p.id, line.qty, p.price, line.disc, Math.round(lineTotal)]
          );
        }
      }
    }
  }

  // ─── 23. Sales Returns (with lines) ──────────────────────────────────────
  console.log('[SEED] Inserting sales returns...');
  const recentInvoice = (await client.query(`SELECT id, customer_id FROM sales_invoices WHERE company_id = $1::uuid AND invoice_number = 'INV-0001' LIMIT 1`, [companyId])).rows[0];
  if (recentInvoice && prodInfos.length > 0) {
    const returnQty = 2;
    const p = prodInfos[0];
    const subtotal = parseFloat(p.price) * returnQty;
    const vatAmount = Math.round(subtotal * VAT_RATE);
    const totalAmount = subtotal + vatAmount;
    const insRes = await client.query(
      `INSERT INTO sales_returns (company_id, return_number, invoice_id, customer_id, date, subtotal, vat_amount, total_amount, reason, status, notes, created_by, updated_by)
       SELECT $1::uuid, 'RET-0001', $2::uuid, $3::uuid, CURRENT_DATE, $4::numeric, $5::numeric, $6::numeric, 'منتج معيب', 'posted', 'مردود مبيعات تجريبي', $7::uuid, $7::uuid
       WHERE NOT EXISTS (SELECT 1 FROM sales_returns WHERE company_id = $1::uuid AND return_number = 'RET-0001')
       RETURNING id;`,
      [companyId, recentInvoice.id, recentInvoice.customer_id, subtotal, vatAmount, totalAmount, adminId]
    );
    const retId = insRes.rows[0]?.id;
    if (retId) {
      await client.query(
        `INSERT INTO sales_return_lines (return_id, product_id, quantity, unit_price, line_total)
         VALUES ($1::uuid, $2::uuid, $3::numeric, $4::numeric, $5::numeric);`,
        [retId, p.id, returnQty, p.price, subtotal]
      );
    }
  }

  // ─── 24. Purchase Returns (with lines) ───────────────────────────────────
  console.log('[SEED] Inserting purchase returns...');
  const recentPI = (await client.query(`SELECT id, supplier_id FROM purchase_invoices WHERE company_id = $1::uuid AND invoice_number = 'PINV-0001' LIMIT 1`, [companyId])).rows[0];
  if (recentPI && prodInfos.length > 0) {
    const returnQty = 5;
    const p = prodInfos[0];
    const unitPrice = parseFloat(p.price) * 0.85;
    const subtotal = unitPrice * returnQty;
    const vatAmount = Math.round(subtotal * VAT_RATE);
    const totalAmount = subtotal + vatAmount;
    const insRes = await client.query(
      `INSERT INTO purchase_returns (company_id, return_number, invoice_id, supplier_id, date, subtotal, vat_amount, total_amount, reason, status, notes, created_by, updated_by)
       SELECT $1::uuid, 'PRET-0001', $2::uuid, $3::uuid, CURRENT_DATE, $4::numeric, $5::numeric, $6::numeric, 'منتج معيب', 'posted', 'مردود مشتريات تجريبي', $7::uuid, $7::uuid
       WHERE NOT EXISTS (SELECT 1 FROM purchase_returns WHERE company_id = $1::uuid AND return_number = 'PRET-0001')
       RETURNING id;`,
      [companyId, recentPI.id, recentPI.supplier_id, subtotal, vatAmount, totalAmount, adminId]
    );
    const retId = insRes.rows[0]?.id;
    if (retId) {
      await client.query(
        `INSERT INTO purchase_return_lines (return_id, product_id, quantity, unit_price, line_total)
         VALUES ($1::uuid, $2::uuid, $3::numeric, $4::numeric, $5::numeric);`,
        [retId, p.id, returnQty, unitPrice, subtotal]
      );
    }
  }

  // ─── 25. Receipt Vouchers (سند قبض) ──────────────────────────────────────
  console.log('[SEED] Inserting receipt vouchers...');
  if (custIds.length > 0) {
    const boxRes = await client.query(`SELECT id FROM cash_boxes WHERE company_id = $1::uuid AND is_active ORDER BY created_at LIMIT 1`, [companyId]);
    const boxId = boxRes.rows[0]?.id;
    for (let i = 0; i < 3; i++) {
      const amount = 500000 + (i * 250000);
      const number = `RV-${String(i + 1).padStart(4, '0')}`;
      const date = `${currentYear}-${String(currentMonth).padStart(2,'0')}-${String(10 + i * 5).padStart(2,'0')}`;
      await client.query(
        `INSERT INTO receipt_vouchers (company_id, voucher_number, date, customer_id, amount, payment_method, cash_box_id, status, notes, created_by, updated_by)
         SELECT $1::uuid, $2::text, $3::date, $4::uuid, $5::numeric, $6::text, $7::uuid, 'posted', 'سند قبض تجريبي', $8::uuid, $8::uuid
         WHERE NOT EXISTS (SELECT 1 FROM receipt_vouchers WHERE company_id = $1::uuid AND voucher_number = $2::text);`,
        [companyId, number, date, custIds[i % custIds.length].id, amount, i === 0 ? 'cash' : 'bank', boxId, adminId]
      );
    }
  }

  // ─── 26. Payment Vouchers (سند صرف) ──────────────────────────────────────
  console.log('[SEED] Inserting payment vouchers...');
  if (supIds.length > 0) {
    const boxRes = await client.query(`SELECT id FROM cash_boxes WHERE company_id = $1::uuid AND is_active ORDER BY created_at LIMIT 1`, [companyId]);
    const boxId = boxRes.rows[0]?.id;
    const expRes = await client.query(`SELECT id FROM accounts WHERE company_id = $1::uuid AND code = '52101' LIMIT 1`, [companyId]);
    const expId = expRes.rows[0]?.id;
    for (let i = 0; i < 3; i++) {
      const amount = 300000 + (i * 200000);
      const number = `PV-${String(i + 1).padStart(4, '0')}`;
      const date = `${currentYear}-${String(currentMonth).padStart(2,'0')}-${String(12 + i * 5).padStart(2,'0')}`;
      await client.query(
        `INSERT INTO payment_vouchers (company_id, voucher_number, date, supplier_id, expense_account_id, amount, payment_method, cash_box_id, status, notes, created_by, updated_by)
         SELECT $1::uuid, $2::text, $3::date, $4::uuid, $5::uuid, $6::numeric, $7::text, $8::uuid, 'posted', 'سند صرف تجريبي', $9::uuid, $9::uuid
         WHERE NOT EXISTS (SELECT 1 FROM payment_vouchers WHERE company_id = $1::uuid AND voucher_number = $2::text);`,
        [companyId, number, date, supIds[i % supIds.length].id, expId, amount, i === 0 ? 'cash' : 'bank', boxId, adminId]
      );
    }
  }

  // ─── 27. Leads, Opportunities, CRM Activities ───────────────────────────
  console.log('[SEED] Inserting CRM data...');
  for (const lead of LEADS) {
    await client.query(
      `INSERT INTO leads (company_id, name, phone, email, company, source, status, estimated_value, notes, created_by, updated_by)
       SELECT $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text, $7::text, $8::numeric, $9::text, $10::uuid, $10::uuid
       WHERE NOT EXISTS (SELECT 1 FROM leads WHERE company_id = $1::uuid AND phone = $3::text);`,
      [companyId, lead.name, lead.phone, lead.email, lead.company, lead.source, lead.status, lead.value, lead.notes || '', adminId]
    );
  }

  // ─── 28. Opportunities (converted from leads) ────────────────────────────
  const leadIds = await client.query(`SELECT id FROM leads WHERE company_id = $1::uuid ORDER BY created_at ASC LIMIT 2`, [companyId]);
  for (let i = 0; i < leadIds.rows.length; i++) {
    const lid = leadIds.rows[i]?.id;
    if (!lid) continue;
    const oppTitle = i === 0 ? 'فرصة بيع منتجات تقنية' : 'فرصة خدمات استشارية';
    const oppStage = i === 0 ? 'proposal' : 'negotiation';
    const oppValue = i === 0 ? 150000 : 75000;
    await client.query(
      `INSERT INTO opportunities (company_id, lead_id, name, stage, value, expected_close_date, assigned_to, created_by, updated_by)
       SELECT $1::uuid, $2::uuid, $3::text, $4::text, $5::numeric, CURRENT_DATE + INTERVAL '30 days', $6::uuid, $6::uuid, $6::uuid
       WHERE NOT EXISTS (SELECT 1 FROM opportunities WHERE company_id = $1::uuid AND lead_id = $2::uuid);`,
      [companyId, lid, oppTitle, oppStage, oppValue, adminId]
    );
  }

  // ─── 29. Manufacturing: BOMs + Work Orders ───────────────────────────────
  console.log('[SEED] Inserting BOMs and work orders...');
  if (prodInfos.length >= 2) {
    const bomRes = await client.query(
      `INSERT INTO boms (company_id, product_id, version, is_active, total_cost, notes, created_by, updated_by)
       SELECT $1::uuid, $2::uuid, '1.0', TRUE, 5600, 'BOM للسلع النهائية - المواد الخام', $3::uuid, $3::uuid
       WHERE NOT EXISTS (SELECT 1 FROM boms WHERE company_id = $1::uuid AND product_id = $2::uuid)
       RETURNING id;`,
      [companyId, prodInfos[0].id, adminId]
    );
    const bomId = bomRes.rows[0]?.id;
    if (bomId) {
      await client.query(
        `INSERT INTO bom_lines (bom_id, material_id, quantity, unit_cost, total_cost)
         VALUES ($1::uuid, $2::uuid, 2, 2800, 5600);`,
        [bomId, prodInfos[1].id]
      );
      await client.query(
        `INSERT INTO work_orders (company_id, order_number, product_id, bom_id, quantity, status, planned_start_date, planned_end_date, total_cost, notes, created_by, updated_by)
         SELECT $1::uuid, 'WO-0001', $2::uuid, $3::uuid, 50, 'planned', CURRENT_DATE, CURRENT_DATE + INTERVAL '7 days', 280000, 'أمر تشغيل تجريبي', $4::uuid, $4::uuid
         WHERE NOT EXISTS (SELECT 1 FROM work_orders WHERE company_id = $1::uuid AND order_number = 'WO-0001');`,
        [companyId, prodInfos[0].id, bomId, adminId]
      );
    }
  }

  // ─── 30. CRM Tasks & Activities ──────────────────────────────────────────
  console.log('[SEED] Inserting tasks and activities...');
  const leadRes = await client.query(`SELECT id FROM leads WHERE company_id = $1::uuid ORDER BY created_at ASC LIMIT 1`, [companyId]);
  const leadId = leadRes.rows[0]?.id;
  if (leadId) {
    await client.query(
      `INSERT INTO tasks (company_id, lead_id, title, description, due_date, priority, status, assigned_to, created_by, updated_by)
       SELECT $1::uuid, $2::uuid, $3::text, $4::text, CURRENT_DATE + INTERVAL '7 days', $5::text, $6::text, $7::uuid, $8::uuid, $8::uuid
       WHERE NOT EXISTS (SELECT 1 FROM tasks WHERE company_id = $1::uuid AND title = $3::text);`,
      [companyId, leadId, 'متابعة عرض السعر', 'إرسال عرض سعر محدث للعميل المحتمل', 'high', 'pending', adminId, adminId]
    );
    await client.query(
      `INSERT INTO tasks (company_id, lead_id, title, description, due_date, priority, status, assigned_to, created_by, updated_by)
       SELECT $1::uuid, $2::uuid, $3::text, $4::text, CURRENT_DATE + INTERVAL '14 days', $5::text, $6::text, $7::uuid, $8::uuid, $8::uuid
       WHERE NOT EXISTS (SELECT 1 FROM tasks WHERE company_id = $1::uuid AND title = $3::text);`,
      [companyId, leadId, 'ترتيب اجتماع', 'تنسيق اجتماع لعرض المنتجات', 'medium', 'pending', adminId, adminId]
    );
    await client.query(
      `INSERT INTO activities (company_id, lead_id, type, subject, description, activity_date, duration_minutes, assigned_to)
       SELECT $1::uuid, $2::uuid, $3::text, $4::text, $5::text, NOW() - INTERVAL '2 days', $6::int, $7::uuid
       WHERE NOT EXISTS (SELECT 1 FROM activities WHERE company_id = $1::uuid AND subject = $4::text);`,
      [companyId, leadId, 'call', 'متابعة هاتفية', 'تم الاتصال بالعميل لمناقشة العرض', 15, adminId]
    );
    await client.query(
      `INSERT INTO activities (company_id, lead_id, type, subject, description, activity_date, duration_minutes, assigned_to)
       SELECT $1::uuid, $2::uuid, $3::text, $4::text, $5::text, NOW() - INTERVAL '1 day', $6::int, $7::uuid
       WHERE NOT EXISTS (SELECT 1 FROM activities WHERE company_id = $1::uuid AND subject = $4::text);`,
      [companyId, leadId, 'email', 'إرسال عرض', 'تم إرسال عرض السعر عبر البريد الإلكتروني', 5, adminId]
    );
  }

  // ─── 31. Stock Adjustments ────────────────────────────────────────────────
  console.log('[SEED] Inserting stock adjustments...');
  const whRes = await client.query(`SELECT id FROM warehouses WHERE company_id = $1::uuid ORDER BY created_at ASC LIMIT 1`, [companyId]);
  const warehouseId = whRes.rows[0]?.id;
  if (prodInfos.length > 0 && warehouseId) {
    const today = new Date().toISOString().split('T')[0];
    await client.query(
      `INSERT INTO stock_adjustments (company_id, date, product_id, warehouse_id, system_qty, actual_qty, difference, unit_cost, reason, status, created_by, updated_by)
       SELECT $1::uuid, $2::date, $3::uuid, $4::uuid, $5::numeric, $6::numeric, $7::numeric, 0, $8::text, $9::text, $10::uuid, $10::uuid
       WHERE NOT EXISTS (SELECT 1 FROM stock_adjustments WHERE company_id = $1::uuid AND product_id = $3::uuid AND date = $2::date);`,
      [companyId, today, prodInfos[0].id, warehouseId, 100, 98, -2, 'جرد دوري', 'posted', adminId]
    );
  }

  return { success: true, companyId, masterDataOnly: false, adminPassword: generatedPassword };
}

// ─── Standalone CLI entry ───────────────────────────────────────────────────
// Usage:
//   node electron/seedDemoData.js                # seeds into the existing demo company
//   node electron/seedDemoData.js --company "X"  # resolve/create a company by name
//   node electron/seedDemoData.js --help
//
// Env vars: DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD (.env.local optional),
//           DEMO_ADMIN_PASSWORD (choose the seed admin password; if unset a
//           strong random one is generated and printed once)
const __seedFilename = fileURLToPath(import.meta.url);
const __seedDirname = path.dirname(__seedFilename);

if (process.argv[1] && path.resolve(process.argv[1]) === __seedFilename) {
  import('dotenv').then(async ({ default: dotenv }) => {
    dotenv.config({ path: path.join(__seedDirname, '..', '.env.local') });

    const args = process.argv.slice(2);
    if (args.includes('--help')) {
      console.log(`Demo data seeder

Usage:
  node electron/seedDemoData.js [--company "Name"] [--admin-password PW]

Options:
  --company "Name"       Company to seed into (created if missing, default "Demo Company")
  --admin-password PW    Admin password (>= 8 chars). Default: strong random generated once.
  --help                 Show this help

Env vars (required unless set in .env.local):
  DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD`);
      process.exit(0);
    }

    const companyName = (args.indexOf('--company') >= 0 ? args[args.indexOf('--company') + 1] : null) || process.env.DEMO_COMPANY_NAME || 'Demo Company';
    const pwIdx = args.indexOf('--admin-password');
    const adminPassword = pwIdx >= 0 ? args[pwIdx + 1] : process.env.DEMO_ADMIN_PASSWORD;

    const required = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
    for (const key of required) {
      if (!process.env[key]) {
        console.error(`[SEED] Missing required environment variable: ${key}`);
        process.exit(1);
      }
    }

    let client;
    try {
      const { Client } = await import('pg');
      client = new Client({
        host: process.env.DB_HOST,
        port: parseInt(process.env.DB_PORT, 10),
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
      });
      await client.connect();

      let sel = await client.query(`SELECT id FROM companies WHERE name = $1 LIMIT 1`, [companyName]);
      let companyId = sel.rows[0]?.id || null;
      if (!companyId) {
        const ins = await client.query(
          `INSERT INTO companies (name, name_en, currency, tax_number, address, phone, email, date_format, decimal_places, calendar, fiscal_year_start)
           VALUES ($1, $2, 'YER', '', '', '', '', 'yyyy-MM-dd', 2, 'gregorian', $3) RETURNING id;`,
          [companyName, companyName, `${new Date().getFullYear()}-01-01`]
        );
        companyId = ins.rows[0]?.id;
      }
      if (!companyId) throw new Error('Could not resolve or create demo company');

      console.log(`[SEED] Company: ${companyName} (${companyId})`);
      const result = await seedComprehensiveDemoData(client, companyId, adminPassword);
      if (result?.adminPassword) {
        console.log(`[SEED] Admin account created — username: admin  password: ${result.adminPassword}`);
        console.log('[SEED] Save this password now. It is shown only once.');
      } else if (adminPassword) {
        console.log(`[SEED] Admin account: admin / ${adminPassword} (from DEMO_ADMIN_PASSWORD)`);
      }
      console.log('[SEED] Done.');
      await client.end();
      process.exit(0);
    } catch (err) {
      console.error(`[SEED] Failed: ${err.message}`);
      if (client) await client.end().catch(() => {});
      process.exit(1);
    }
  });
}
