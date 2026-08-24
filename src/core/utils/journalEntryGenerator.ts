import { getDbAdapter } from '@/core/database/adapters';
import { runTransaction, buildJournalEntryStatement, type TxStatement } from '@/core/database/tx';
import { toDateString } from '@/core/utils/mapPgRow';
/**
 * Automatically generates journal entries (accounting transactions)
 * for business documents like invoices, vouchers, returns, etc.
 */

/**
 * Normalize a date-like value (Date, ISO string, locale-formatted string)
 * to a strict `YYYY-MM-DD` string suitable for PG `timestamp with time zone`.
 * If the value is a `Date` object (e.g. from node-postgres on `timestamptz`
 * columns) we must call `toISOString()` instead of `toString()`; the latter
 * produces locale formats like `"Mon Jul 13 2026 00:00:00 GMT+0300 (...)"`
 * which PG rejects with `invalid input syntax for type timestamp with time zone`.
 */
function normalizeDate(value: unknown): string {
  const s = toDateString(value);
  return s ?? new Date().toISOString().split('T')[0];
}

export interface JournalEntryLine {
  accountId: string;
  debit: number;
  credit: number;
  memo?: string;
}

export interface AutoJournalEntry {
  reference: string;
  description: string;
  date: string;
  totalAmount: number;
  entries: JournalEntryLine[];
}

// Well-known account codes from our chart of accounts
const ACC = {
  CASH: '11101',           // الصندوق الرئيسي
  BANK: '11102',           // حساب بنك الكريمي
  TRADE_DEBTORS: '11201',  // مدينون تجاريون
  INVENTORY: '11301',      // بضاعة أول المدة
  PREPAID_RENT: '11401',   // إيجار مدفوع مقدماً
  TRADE_CREDITORS: '21101',// دائنون تجاريون
  VAT_PAYABLE: '21301',    // ضريبة القيمة المضافة
  SALES: '41101',          // مبيعات المنتجات
  SALES_SERVICES: '41102', // مبيعات الخدمات
  SALES_RETURNS: '41103',  // مردودات المبيعات
  COGS: '51101',           // تكلفة بضاعة مباعة
  SALARIES: '52101',       // رواتب وأجور
  RENT_WAREHOUSE: '52201', // إيجار مستودعات
  RENT_OFFICE: '52202',    // إيجار مكاتب
  ELECTRICITY: '52301',    // كهرباء وماء
  ADVERTISING: '52401',    // إعلانات ودعاية
  MAINTENANCE: '52501',    // صيانة معدات
  SHIPPING: '52601',       // نقل وشحن
  BUILDING_DEP: '52701',   // استهلاك مباني
  EQUIPMENT_DEP: '52702',  // استهلاك معدات
};

async function findAccountByCode(companyId: string, code: string): Promise<string | null> {
  const adapter = await getDbAdapter();
  const result = await adapter.query<{ id: string }>(
    `SELECT id FROM accounts WHERE company_id = $1 AND code = $2`,
    [companyId, code]
  );
  if (result.rows?.[0]?.id) return result.rows[0].id;
  // Fallback: search by name pattern for backwards compatibility
  const nameMap: Record<string, string> = {
    '11101': '%صندوق%',
    '11102': '%بنك%',
    '11201': '%مدينون%',
    '11301': '%مخزون%|%بضاعة%',
    '21101': '%دائنون%',
    '21301': '%ضريبة%',
    '41101': '%مبيعات المنتجات%',
    '41102': '%مبيعات الخدمات%',
    '41103': '%مردودات%',
    '51101': '%تكلفة بضاعة%',
    '52101': '%رواتب%',
  };
  const pattern = nameMap[code];
  if (pattern) {
    const fallback = await adapter.query<{ id: string }>(
      `SELECT id FROM accounts WHERE company_id = $1 AND name_ar SIMILAR TO $2 LIMIT 1`,
      [companyId, pattern]
    );
    return fallback.rows?.[0]?.id || null;
  }
  return null;
}

async function getDefaultAccountId(companyId: string, functionKey: string): Promise<string | null> {
  const adapter = await getDbAdapter();
  const result = await adapter.query<{ account_id: string }>(
    `SELECT account_id FROM default_accounts WHERE company_id = $1 AND function_key = $2`,
    [companyId, functionKey]
  );
  if (result.rows?.[0]?.account_id) return result.rows[0].account_id;
  // Fallback to hardcoded codes
  const fallbackMap: Record<string, string> = {
    default_cash: ACC.CASH,
    default_bank: ACC.BANK,
    default_sales: ACC.SALES,
    default_cogs: ACC.COGS,
    default_inventory: ACC.INVENTORY,
    default_debtors: ACC.TRADE_DEBTORS,
    default_creditors: ACC.TRADE_CREDITORS,
    default_vat_output: ACC.VAT_PAYABLE,
    default_vat_input: ACC.VAT_PAYABLE,
    default_salaries: ACC.SALARIES,
    default_sales_returns: ACC.SALES_RETURNS,
    default_purchase_returns: ACC.TRADE_CREDITORS,
    default_discount_allowed: ACC.SALES,
    default_discount_received: ACC.TRADE_CREDITORS,
  };
  const code = fallbackMap[functionKey];
  if (code) return findAccountByCode(companyId, code);
  return null;
}

async function createTransaction(companyId: string, entry: AutoJournalEntry) {
  const adapter = await getDbAdapter();
  return adapter.createTransaction({
    companyId,
    date: normalizeDate(entry.date),
    reference: entry.reference,
    description: entry.description,
    totalAmount: entry.totalAmount,
    status: 'posted',
    entries: entry.entries,
  });
}

// ─── Composable posting-statement builders ──────────────────────────────────
/**
 * These builders return raw transaction statements so callers can compose the
 * journal entry TOGETHER with document-status flips and party-balance updates
 * in ONE atomic batch — eliminating orphan journal entries entirely.
 * The exported post*() wrappers below run their statements standalone for
 * backward compatibility.
 */

export interface SalesInvoicePostingInput {
  invoiceNumber: string;
  date: string;
  subtotal: number;
  vatAmount: number;
  totalAmount: number;
}

/** Resolve default accounts or return a clear error. */
export async function resolvePostingAccounts(
  companyId: string,
  keys: Array<'default_debtors' | 'default_creditors' | 'default_sales' | 'default_sales_returns' | 'default_cogs' | 'default_inventory' | 'default_vat_output' | 'default_vat_input'>
): Promise<{ success: true; ids: Record<string, string> } | { success: false; error: string }> {
  const ids: Record<string, string> = {};
  for (const key of keys) {
    const id = await getDefaultAccountId(companyId, key);
    if (!id) {
      return { success: false, error: 'Required accounts not found in chart of accounts. Please configure default accounts in Settings.' };
    }
    ids[key] = id;
  }
  return { success: true, ids };
}

export function buildSalesInvoicePostingStatements(
  companyId: string,
  invoice: SalesInvoicePostingInput,
  ids: { debtors: string; sales: string; vat: string }
): TxStatement[] {
  return [
    buildJournalEntryStatement(companyId, {
      reference: invoice.invoiceNumber,
      description: `قيد تلقائي - فاتورة مبيعات ${invoice.invoiceNumber}`,
      date: invoice.date,
      totalAmount: invoice.totalAmount,
      entries: [
        { accountId: ids.debtors, debit: invoice.totalAmount, credit: 0, memo: `فاتورة مبيعات ${invoice.invoiceNumber}` },
        { accountId: ids.sales, debit: 0, credit: invoice.subtotal, memo: `إيرادات مبيعات ${invoice.invoiceNumber}` },
        { accountId: ids.vat, debit: 0, credit: invoice.vatAmount, memo: `ضريبة مبيعات ${invoice.invoiceNumber}` },
      ],
    }),
  ];
}

export function buildPurchaseInvoicePostingStatements(
  companyId: string,
  invoice: { invoiceNumber: string; date: string; subtotal: number; vatAmount: number; totalAmount: number },
  ids: { inventory: string; creditors: string; vat: string }
): TxStatement[] {
  return [
    buildJournalEntryStatement(companyId, {
      reference: invoice.invoiceNumber,
      description: `قيد تلقائي - فاتورة مشتريات ${invoice.invoiceNumber}`,
      date: invoice.date,
      totalAmount: invoice.totalAmount,
      entries: [
        { accountId: ids.inventory, debit: invoice.subtotal, credit: 0, memo: `مشتريات ${invoice.invoiceNumber}` },
        { accountId: ids.vat, debit: invoice.vatAmount, credit: 0, memo: `ضريبة مشتريات ${invoice.invoiceNumber}` },
        { accountId: ids.creditors, debit: 0, credit: invoice.totalAmount, memo: `التزام مورد ${invoice.invoiceNumber}` },
      ],
    }),
  ];
}

/** JE + stock-movement statements for a sales return (goods back to stock). */
export async function buildSalesReturnPostingStatements(
  companyId: string,
  ret: { id?: string; returnNumber: string; date: string; customer: string; amount: number }
): Promise<{ success: true; statements: TxStatement[] } | { success: false; error: string }> {
  const resolved = await resolvePostingAccounts(companyId, ['default_sales_returns', 'default_debtors', 'default_inventory', 'default_cogs']);
  if (!resolved.success) return resolved;
  const { default_sales_returns: salesReturnsId, default_debtors: debtorsId, default_inventory: inventoryId, default_cogs: cogsId } = resolved.ids;

  const statements: TxStatement[] = [
    buildJournalEntryStatement(companyId, {
      reference: ret.returnNumber,
      description: `قيد تلقائي - مردود مبيعات ${ret.returnNumber}`,
      date: ret.date,
      totalAmount: ret.amount,
      entries: [
        { accountId: salesReturnsId, debit: ret.amount, credit: 0, memo: `مردود مبيعات ${ret.returnNumber}` },
        { accountId: debtorsId, debit: 0, credit: ret.amount, memo: `تخفيض ذمة ${ret.customer}` },
        // Simplified COGS reversal at an assumed 70% cost ratio.
        { accountId: inventoryId, debit: Math.floor(ret.amount * 0.7), credit: 0, memo: `إعادة بضاعة للمخزون` },
        { accountId: cogsId || inventoryId, debit: 0, credit: Math.floor(ret.amount * 0.7), memo: `عكس تكلفة بضاعة مباعة` },
      ],
    }),
  ];

  if (ret.id) {
    statements.push({
      sql: `INSERT INTO stock_movements (company_id, product_id, warehouse_id, quantity, type, reference, created_at)
         SELECT sr.company_id, srl.product_id, wh.warehouse_id, srl.quantity, 'in', $1, NOW()
           FROM sales_returns sr
           JOIN sales_return_lines srl ON srl.return_id = sr.id
           JOIN LATERAL (
             SELECT s.warehouse_id FROM stock s
              WHERE s.product_id = srl.product_id AND s.company_id = sr.company_id
              ORDER BY s.quantity DESC LIMIT 1
           ) wh ON true
          WHERE sr.id = $2 AND sr.company_id = $3`,
      params: [ret.returnNumber, ret.id, companyId],
    });
  }
  return { success: true, statements };
}

/** JE + stock-movement statements for a purchase return (goods out of stock). */
export async function buildPurchaseReturnPostingStatements(
  companyId: string,
  ret: { id?: string; returnNumber: string; date: string; supplier: string; amount: number }
): Promise<{ success: true; statements: TxStatement[] } | { success: false; error: string }> {
  const resolved = await resolvePostingAccounts(companyId, ['default_creditors', 'default_inventory']);
  if (!resolved.success) return resolved;
  const { default_creditors: creditorsId, default_inventory: inventoryId } = resolved.ids;

  const statements: TxStatement[] = [
    buildJournalEntryStatement(companyId, {
      reference: ret.returnNumber,
      description: `قيد تلقائي - مردود مشتريات ${ret.returnNumber}`,
      date: ret.date,
      totalAmount: ret.amount,
      entries: [
        { accountId: creditorsId, debit: ret.amount, credit: 0, memo: `تخفيض التزام ${ret.supplier}` },
        { accountId: inventoryId, debit: 0, credit: ret.amount, memo: `إخراج بضاعة مردودة ${ret.returnNumber}` },
      ],
    }),
  ];

  if (ret.id) {
    statements.push({
      sql: `INSERT INTO stock_movements (company_id, product_id, warehouse_id, quantity, type, reference, created_at)
         SELECT pr.company_id, prl.product_id, wh.warehouse_id, prl.quantity, 'out', $1, NOW()
           FROM purchase_returns pr
           JOIN purchase_return_lines prl ON prl.return_id = pr.id
           JOIN LATERAL (
             SELECT s.warehouse_id FROM stock s
              WHERE s.product_id = prl.product_id AND s.company_id = pr.company_id
              ORDER BY s.quantity DESC LIMIT 1
           ) wh ON true
          WHERE pr.id = $2 AND pr.company_id = $3`,
      params: [ret.returnNumber, ret.id, companyId],
    });
  }
  return { success: true, statements };
}

/**
 * Post a Sales Invoice to accounting
 * Dr: Trade Debtors (Customer)
 * Cr: Sales Revenue
 * Cr: VAT Payable
 */
export async function postSalesInvoice(
  companyId: string,
  invoice: { invoiceNumber: string; date: string; customerId: string; subtotal: number; vatAmount: number; totalAmount: number }
) {
  const debtorsId = await getDefaultAccountId(companyId, 'default_debtors');
  const salesId = await getDefaultAccountId(companyId, 'default_sales');
  const vatId = await getDefaultAccountId(companyId, 'default_vat_output');

  if (!debtorsId || !salesId || !vatId) {
    return { success: false, error: 'Required accounts not found in chart of accounts. Please configure default accounts in Settings.' };
  }

  const entries: JournalEntryLine[] = [
    { accountId: debtorsId, debit: invoice.totalAmount, credit: 0, memo: `فاتورة مبيعات ${invoice.invoiceNumber}` },
    { accountId: salesId, debit: 0, credit: invoice.subtotal, memo: `إيرادات مبيعات ${invoice.invoiceNumber}` },
    { accountId: vatId, debit: 0, credit: invoice.vatAmount, memo: `ضريبة مبيعات ${invoice.invoiceNumber}` },
  ];

  return createTransaction(companyId, {
    reference: invoice.invoiceNumber,
    description: `قيد تلقائي - فاتورة مبيعات ${invoice.invoiceNumber}`,
    date: invoice.date,
    totalAmount: invoice.totalAmount,
    entries,
  });
}

/**
 * Post a Purchase Invoice to accounting
 * Dr: Inventory / Purchases
 * Cr: Trade Creditors (Supplier)
 * Dr: VAT Recoverable (if applicable)
 */
export async function postPurchaseInvoice(
  companyId: string,
  invoice: { invoiceNumber: string; date: string; supplierId: string; subtotal: number; vatAmount: number; totalAmount: number }
) {
  const inventoryId = await getDefaultAccountId(companyId, 'default_inventory');
  const creditorsId = await getDefaultAccountId(companyId, 'default_creditors');
  const vatId = await getDefaultAccountId(companyId, 'default_vat_input');

  if (!inventoryId || !creditorsId || !vatId) {
    return { success: false, error: 'Required accounts not found. Please configure default accounts in Settings.' };
  }

  const entries: JournalEntryLine[] = [
    { accountId: inventoryId, debit: invoice.subtotal, credit: 0, memo: `مشتريات ${invoice.invoiceNumber}` },
    { accountId: vatId, debit: invoice.vatAmount, credit: 0, memo: `ضريبة مشتريات ${invoice.invoiceNumber}` },
    { accountId: creditorsId, debit: 0, credit: invoice.totalAmount, memo: `التزام مورد ${invoice.invoiceNumber}` },
  ];

  return createTransaction(companyId, {
    reference: invoice.invoiceNumber,
    description: `قيد تلقائي - فاتورة مشتريات ${invoice.invoiceNumber}`,
    date: invoice.date,
    totalAmount: invoice.totalAmount,
    entries,
  });
}

/**
 * Post a Receipt Voucher to accounting
 * Dr: Cash / Bank
 * Cr: Trade Debtors
 */
export async function postReceiptVoucher(
  companyId: string,
  voucher: { voucherNumber: string; date: string; customer: string; amount: number; paymentMethod: string }
) {
  const cashId = await getDefaultAccountId(companyId, 'default_cash');
  const bankId = await getDefaultAccountId(companyId, 'default_bank');
  const debtorsId = await getDefaultAccountId(companyId, 'default_debtors');

  if (!cashId || !debtorsId) {
    return { success: false, error: 'Required accounts not found. Please configure default accounts in Settings.' };
  }

  const debitAccount = voucher.paymentMethod === 'bank' && bankId ? bankId : cashId;

  const entries: JournalEntryLine[] = [
    { accountId: debitAccount, debit: voucher.amount, credit: 0, memo: `قبض من ${voucher.customer}` },
    { accountId: debtorsId, debit: 0, credit: voucher.amount, memo: `تخفيض ذمة ${voucher.customer}` },
  ];

  return createTransaction(companyId, {
    reference: voucher.voucherNumber,
    description: `قيد تلقائي - سند قبض ${voucher.voucherNumber} - ${voucher.customer}`,
    date: voucher.date,
    totalAmount: voucher.amount,
    entries,
  });
}

/**
 * Post a Payment Voucher to accounting
 * Dr: Trade Creditors / Expense Account
 * Cr: Cash / Bank
 */
export async function postPaymentVoucher(
  companyId: string,
  voucher: { voucherNumber: string; date: string; supplier: string; amount: number; paymentMethod: string; expenseAccount?: string }
) {
  const cashId = await getDefaultAccountId(companyId, 'default_cash');
  const bankId = await getDefaultAccountId(companyId, 'default_bank');
  const creditorsId = await getDefaultAccountId(companyId, 'default_creditors');
  const rentWarehouseId = await findAccountByCode(companyId, ACC.RENT_WAREHOUSE);
  const rentOfficeId = await findAccountByCode(companyId, ACC.RENT_OFFICE);
  const electricityId = await findAccountByCode(companyId, ACC.ELECTRICITY);
  const advertisingId = await findAccountByCode(companyId, ACC.ADVERTISING);
  const maintenanceId = await findAccountByCode(companyId, ACC.MAINTENANCE);
  const shippingId = await findAccountByCode(companyId, ACC.SHIPPING);

  if (!cashId || !creditorsId) {
    return { success: false, error: 'Required accounts not found. Please configure default accounts in Settings.' };
  }

  const creditAccount = voucher.paymentMethod === 'bank' && bankId ? bankId : cashId;

  // Determine debit account based on expense type
  let debitAccount = creditorsId;
  if (voucher.expenseAccount) {
    const expLower = voucher.expenseAccount.toLowerCase();
    if (expLower.includes('إيجار') && expLower.includes('مستودع')) debitAccount = rentWarehouseId || creditorsId;
    else if (expLower.includes('إيجار')) debitAccount = rentOfficeId || creditorsId;
    else if (expLower.includes('كهرب')) debitAccount = electricityId || creditorsId;
    else if (expLower.includes('إعلان') || expLower.includes('دعاية')) debitAccount = advertisingId || creditorsId;
    else if (expLower.includes('صيانة')) debitAccount = maintenanceId || creditorsId;
    else if (expLower.includes('نقل') || expLower.includes('شحن')) debitAccount = shippingId || creditorsId;
  }

  const entries: JournalEntryLine[] = [
    { accountId: debitAccount, debit: voucher.amount, credit: 0, memo: `صرف لـ ${voucher.supplier}` },
    { accountId: creditAccount, debit: 0, credit: voucher.amount, memo: `سحب نقدي/بنكي` },
  ];

  return createTransaction(companyId, {
    reference: voucher.voucherNumber,
    description: `قيد تلقائي - سند صرف ${voucher.voucherNumber} - ${voucher.supplier}`,
    date: voucher.date,
    totalAmount: voucher.amount,
    entries,
  });
}

/**
 * Post a Sales Return to accounting (reverse of sales)
 * Dr: Sales Returns
 * Cr: Trade Debtors
 */
export async function postSalesReturn(
  companyId: string,
  ret: { id?: string; returnNumber: string; date: string; customer: string; amount: number }
) {
  const salesReturnsId = await getDefaultAccountId(companyId, 'default_sales_returns');
  const debtorsId = await getDefaultAccountId(companyId, 'default_debtors');
  const inventoryId = await getDefaultAccountId(companyId, 'default_inventory');
  const cogsId = await getDefaultAccountId(companyId, 'default_cogs');

  if (!salesReturnsId || !debtorsId || !inventoryId) {
    return { success: false, error: 'Required accounts not found. Please configure default accounts in Settings.' };
  }

  const entries: JournalEntryLine[] = [
    { accountId: salesReturnsId, debit: ret.amount, credit: 0, memo: `مردود مبيعات ${ret.returnNumber}` },
    { accountId: debtorsId, debit: 0, credit: ret.amount, memo: `تخفيض ذمة ${ret.customer}` },
    // Also return inventory (simplified: assume full return to inventory)
    { accountId: inventoryId, debit: Math.floor(ret.amount * 0.7), credit: 0, memo: `إعادة بضاعة للمخزون` },
    { accountId: cogsId || inventoryId, debit: 0, credit: Math.floor(ret.amount * 0.7), memo: `عكس تكلفة بضاعة مباعة` },
  ];

  // Atomic batch: the journal entry AND its stock movements commit together
  // (or roll back together), keeping accounting and inventory in lock-step.
  const statements: TxStatement[] = [
    buildJournalEntryStatement(companyId, {
      reference: ret.returnNumber,
      description: `قيد تلقائي - مردود مبيعات ${ret.returnNumber}`,
      date: ret.date,
      totalAmount: ret.amount,
      entries,
    }),
  ];

  if (ret.id) {
    // Insert stock_movements (type='in') for each return line so inventory
    // reflects goods returning to the warehouse they currently sit in.
    statements.push({
      sql: `INSERT INTO stock_movements (company_id, product_id, warehouse_id, quantity, type, reference, created_at)
         SELECT sr.company_id, srl.product_id, wh.warehouse_id, srl.quantity, 'in', $1, NOW()
           FROM sales_returns sr
           JOIN sales_return_lines srl ON srl.return_id = sr.id
           JOIN LATERAL (
             SELECT s.warehouse_id
               FROM stock s
              WHERE s.product_id = srl.product_id AND s.company_id = sr.company_id
              ORDER BY s.quantity DESC
              LIMIT 1
           ) wh ON true
          WHERE sr.id = $2 AND sr.company_id = $3`,
      params: [ret.returnNumber, ret.id, companyId],
    });
  }

  const txResult = await runTransaction(statements);
  if (!txResult.success) return { success: false, error: txResult.error };
  return { success: true };
}

/**
 * Post a Purchase Return to accounting
 * Dr: Trade Creditors
 * Cr: Inventory
 *
 * Side effect: also creates stock_movements (type='out') for each return line
 * to keep inventory synchronized with the accounting reversal.
 */
export async function postPurchaseReturn(
  companyId: string,
  ret: { id?: string; returnNumber: string; date: string; supplier: string; amount: number }
) {
  const creditorsId = await getDefaultAccountId(companyId, 'default_creditors');
  const inventoryId = await getDefaultAccountId(companyId, 'default_inventory');

  if (!creditorsId || !inventoryId) {
    return { success: false, error: 'Required accounts not found. Please configure default accounts in Settings.' };
  }

  const entries: JournalEntryLine[] = [
    { accountId: creditorsId, debit: ret.amount, credit: 0, memo: `تخفيض التزام ${ret.supplier}` },
    { accountId: inventoryId, debit: 0, credit: ret.amount, memo: `إخراج بضاعة مردودة ${ret.returnNumber}` },
  ];

  // Atomic batch: journal entry + stock movements commit/roll back together.
  const statements: TxStatement[] = [
    buildJournalEntryStatement(companyId, {
      reference: ret.returnNumber,
      description: `قيد تلقائي - مردود مشتريات ${ret.returnNumber}`,
      date: ret.date,
      totalAmount: ret.amount,
      entries,
    }),
  ];

  if (ret.id) {
    statements.push({
      sql: `INSERT INTO stock_movements (company_id, product_id, warehouse_id, quantity, type, reference, created_at)
         SELECT pr.company_id, prl.product_id, wh.warehouse_id, prl.quantity, 'out', $1, NOW()
           FROM purchase_returns pr
           JOIN purchase_return_lines prl ON prl.return_id = pr.id
           JOIN LATERAL (
             SELECT s.warehouse_id
               FROM stock s
              WHERE s.product_id = prl.product_id AND s.company_id = pr.company_id
              ORDER BY s.quantity DESC
              LIMIT 1
           ) wh ON true
          WHERE pr.id = $2 AND pr.company_id = $3`,
      params: [ret.returnNumber, ret.id, companyId],
    });
  }

  const txResult = await runTransaction(statements);
  if (!txResult.success) return { success: false, error: txResult.error };
  return { success: true };
}

/**
 * Post an Inventory Transaction to accounting
 * In: Dr Inventory, Cr Creditors (or Cash if paid)
 * Out: Dr COGS, Cr Inventory
 */
export async function postInventoryTransaction(
  companyId: string,
  tx: { reference: string; date: string; type: 'in' | 'out' | 'adjustment' | 'transfer'; product: string; amount: number }
) {
  const inventoryId = await getDefaultAccountId(companyId, 'default_inventory');
  const cogsId = await getDefaultAccountId(companyId, 'default_cogs');
  const cashId = await getDefaultAccountId(companyId, 'default_cash');

  if (!inventoryId) {
    return { success: false, error: 'Inventory account not found. Please configure default accounts in Settings.' };
  }

  let entries: JournalEntryLine[] = [];
  let description = '';

  if (tx.type === 'in') {
    entries = [
      { accountId: inventoryId, debit: tx.amount, credit: 0, memo: `استلام ${tx.product}` },
      { accountId: cashId || inventoryId, debit: 0, credit: tx.amount, memo: `دفع قيمة المشتريات` },
    ];
    description = `قيد تلقائي - استلام مخزون ${tx.reference}`;
  } else if (tx.type === 'out') {
    entries = [
      { accountId: cogsId || inventoryId, debit: tx.amount, credit: 0, memo: `تكلفة بضاعة مباعة ${tx.product}` },
      { accountId: inventoryId, debit: 0, credit: tx.amount, memo: `صرف ${tx.product}` },
    ];
    description = `قيد تلقائي - صرف مخزون ${tx.reference}`;
  } else if (tx.type === 'adjustment') {
    // Adjustment handled separately
    return { success: true, id: 'skip' };
  }

  if (entries.length === 0) return { success: true, id: 'skip' };

  return createTransaction(companyId, {
    reference: tx.reference,
    description,
    date: tx.date,
    totalAmount: tx.amount,
    entries,
  });
}

/**
 * Post a Stock Adjustment to accounting
 * Positive difference (found): Dr Inventory, Cr Income
 * Negative difference (lost): Dr Loss, Cr Inventory
 */
export async function postStockAdjustment(
  companyId: string,
  adj: { id: string; date: string; product: string; difference: number; reason: string }
) {
  const inventoryId = await getDefaultAccountId(companyId, 'default_inventory');
  const cogsId = await getDefaultAccountId(companyId, 'default_cogs');

  if (!inventoryId) {
    return { success: false, error: 'Inventory account not found. Please configure default accounts in Settings.' };
  }

  const entries: JournalEntryLine[] = [];
  if (adj.difference > 0) {
    entries.push(
      { accountId: inventoryId, debit: adj.difference, credit: 0, memo: `عثور ${adj.product}` },
      { accountId: cogsId || inventoryId, debit: 0, credit: adj.difference, memo: `إيراد عثور` }
    );
  } else if (adj.difference < 0) {
    const loss = Math.abs(adj.difference);
    entries.push(
      { accountId: cogsId || inventoryId, debit: loss, credit: 0, memo: `فاقد ${adj.product}` },
      { accountId: inventoryId, debit: 0, credit: loss, memo: `خسارة مخزون` }
    );
  }

  if (entries.length === 0) return { success: true, id: 'skip' };

  return createTransaction(companyId, {
    reference: `ADJ-${adj.id}`,
    description: `قيد تلقائي - تسوية مخزون ${adj.id} - ${adj.reason}`,
    date: adj.date,
    totalAmount: Math.abs(adj.difference),
    entries,
  });
}
