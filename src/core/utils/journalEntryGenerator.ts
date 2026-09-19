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
 * Date objects are resolved via `toDateString` (local-time components) —
 * never via `toString()`, whose locale formats like
 * `"Mon Jul 13 2026 00:00:00 GMT+0300 (...)"` PG rejects with
 * `invalid input syntax for type timestamp with time zone`.
 */
function normalizeDate(value: unknown): string {
  const s = toDateString(value);
  if (s) return s;
  // Fallback is local-time too: toISOString() is UTC, so on GMT+3 machines
  // between 00:00–03:00 it would silently back-date new entries by a day.
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
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
  TRADE_DEBTORS: '11201',  // مدينون تجاريون
  INVENTORY: '11301',      // بضاعة أول المدة
  PREPAID_RENT: '11401',   // إيجار مدفوع مقدماً
  TRADE_CREDITORS: '21101',// دائنون تجاريون
  VAT_PAYABLE: '21301',    // ضريبة المخرجات (output)
  VAT_INPUT: '21302',      // ضريبة المدخلات (input, Phase 3 split)
  SALES: '41101',          // مبيعات المنتجات
  SALES_SERVICES: '41102', // مبيعات الخدمات
  SALES_RETURNS: '41103',  // مردودات المبيعات
  DISCOUNT_ALLOWED: '41201', // خصم مسموح به (contra-revenue)
  DISCOUNT_EARNED: '42101',  // خصم مكتسب (other income)
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
  PRICE_VARIANCE: '51901', // فروق أسعار الشراء والتقييم (Phase 1)
  INV_SHORTAGE: '52901',   // عجز المخزون — فاقد (Phase 1)
  INV_SURPLUS: '41901',    // فائض المخزون — عثور (Phase 1)
  FIXED_ASSETS: '12101',   // تكلفة الأصول الثابتة (Phase 5)
  ACC_DEP: '12102',        // مجمع الإهلاك — contra asset (Phase 5)
  DEP_EXPENSE: '52601',    // مصروف الإهلاك (Phase 5)
  RETAINED: '32101',       // الأرباح المبقاة (Phase 5)
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
    '21302': '%مدخلات%',
    '41101': '%مبيعات المنتجات%',
    '41102': '%مبيعات الخدمات%',
    '41103': '%مردودات%',
    '51101': '%تكلفة بضاعة%',
    '41201': '%خصم مسموح%',
    '42101': '%خصم مكتسب%',
    '52101': '%رواتب%',
    '51901': '%فروق%',
    '52901': '%عجز%',
    '41901': '%فائض%',
    '12101': '%أصول ثابتة%',
    '12102': '%مجمع%|%إهلاك%',
    '52601': '%إهلاك%',
    '32101': '%مبقاة%',
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

/** Resolve a default_accounts entry to a GL account id (with hardcoded-code fallback). Exported for AI voucher tools. */
export async function getDefaultAccountId(companyId: string, functionKey: string): Promise<string | null> {
  const adapter = await getDbAdapter();
  const result = await adapter.query<{ account_id: string }>(
    `SELECT account_id FROM default_accounts WHERE company_id = $1 AND function_key = $2`,
    [companyId, functionKey]
  );
  if (result.rows?.[0]?.account_id) return result.rows[0].account_id;
  // Fallback to hardcoded codes
  const fallbackMap: Record<string, string> = {
    default_cash: ACC.CASH,
    default_sales: ACC.SALES,
    default_cogs: ACC.COGS,
    default_inventory: ACC.INVENTORY,
    default_debtors: ACC.TRADE_DEBTORS,
    default_creditors: ACC.TRADE_CREDITORS,
    default_vat_output: ACC.VAT_PAYABLE,
    default_vat_input: ACC.VAT_INPUT,
    default_salaries: ACC.SALARIES,
    default_sales_returns: ACC.SALES_RETURNS,
    default_purchase_returns: ACC.TRADE_CREDITORS,
    default_discount_allowed: ACC.DISCOUNT_ALLOWED,
    default_discount_received: ACC.DISCOUNT_EARNED,
    default_wip: '11302',
    default_finished_goods: '11303',
    default_production_labor: '53101',
    default_production_energy: '53201',
    default_production_packaging: '53301',
    default_production_other: '53401',
    default_production_loss: '53501',
    default_opening_balance: '31201',
    default_shipping: ACC.SHIPPING,
    default_rent: ACC.RENT_OFFICE,
    default_misc_expense: ACC.ELECTRICITY,
    default_salaries_payable: '21501',
    default_payroll_deductions: '21502',
    default_eos_payable: '21503',
    default_eos_expense: '52501',
    default_price_variance: ACC.PRICE_VARIANCE,
    default_inventory_shortage: ACC.INV_SHORTAGE,
    default_inventory_surplus: ACC.INV_SURPLUS,
    default_fixed_assets: ACC.FIXED_ASSETS,
    default_accumulated_depreciation: ACC.ACC_DEP,
    default_depreciation_expense: ACC.DEP_EXPENSE,
    default_retained_earnings: ACC.RETAINED,
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
/**
 * Resolve the GL account linked to a treasury (خزنة). Banks were unified
 * away — every payment location is a cash box whose account_id IS the
 * posting account. Returns null so callers fall back to default_cash.
 */
export async function getCashBoxAccountId(companyId: string, cashBoxId?: string | null): Promise<string | null> {
  if (!cashBoxId) return null;
  const adapter = await getDbAdapter();
  const res = await adapter.query<{ account_id: string | null }>(
    'SELECT account_id FROM cash_boxes WHERE id = $1::uuid AND company_id = $2::uuid LIMIT 1',
    [cashBoxId, companyId]
  );
  return res.rows?.[0]?.account_id || null;
}

/* Round money to 2 decimals — single rounding rule for every posting builder. */
function toMoney(n: unknown): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Guard an explicit discount leg (gross method): the discount can never
 * exceed the gross it reduces, and a positive discount needs its dedicated
 * account — silently dropping the leg would unbalance the entry.
 */
function assertDiscountLeg(discount: number, gross: number, accountId: string | undefined, kind: 'allowed' | 'earned'): void {
  if (discount < 0 || discount > gross + 0.005) {
    throw new Error('الخصم يتجاوز إجمالي المبلغ — راجع مبالغ الخصم في الفاتورة');
  }
  if (discount > 0 && !accountId) {
    throw new Error(
      kind === 'allowed'
        ? 'حساب الخصم المسموح به غير مضبوط — اربطه في الإعدادات ← الحسابات الافتراضية'
        : 'حساب الخصم المكتسب غير مضبوط — اربطه في الإعدادات ← الحسابات الافتراضية'
    );
  }
}

export async function resolvePostingAccounts(
  companyId: string,
  keys: Array<'default_debtors' | 'default_creditors' | 'default_sales' | 'default_sales_returns' | 'default_cogs' | 'default_inventory' | 'default_vat_output' | 'default_vat_input' | 'default_cash' | 'default_discount_allowed' | 'default_discount_received' | 'default_price_variance' | 'default_inventory_shortage' | 'default_inventory_surplus' | 'default_exchange_difference' | 'default_fixed_assets' | 'default_accumulated_depreciation' | 'default_depreciation_expense'>
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

export interface CogsBooking {
  /** Total cost of goods sold for this document (base units × unit cost). */
  total: number;
  inventoryAccount: string;
  cogsAccount: string;
}

/**
 * Base-currency override for a posting (Phase 2 — IAS 21). The LEDGER is
 * always kept in base currency; the document keeps its own currency on the
 * source tables. When omitted the document amounts post as-is (base-only
 * documents: payroll, manufacturing, POS-cash, adjustments).
 */
export interface BaseBooking {
  subtotal: number;
  vatAmount: number;
  totalAmount: number;
}

export function buildSalesInvoicePostingStatements(
  companyId: string,
  invoice: SalesInvoicePostingInput & { paymentType?: string; cashAccountSubstitute?: string | null; cogsAmount?: number; discountAmount?: number; grossSubtotal?: number },
  ids: { debtors: string; sales: string; vat: string; cogs?: string; inventory?: string; discount?: string },
  cogs?: CogsBooking,
  base?: BaseBooking
): TxStatement[] {
  const isCash = invoice.paymentType === 'cash';
  const debitAccount = (isCash && invoice.cashAccountSubstitute) || ids.debtors;
  const bSub = Math.round((Number(base?.subtotal ?? invoice.subtotal) || 0) * 100) / 100;
  const bVat = Math.round((Number(base?.vatAmount ?? invoice.vatAmount) || 0) * 100) / 100;
  const bTotal = Math.round((Number(base?.totalAmount ?? invoice.totalAmount) || 0) * 100) / 100;
  const discount = toMoney(invoice.discountAmount);
  const gross = toMoney(invoice.grossSubtotal ?? (bSub + discount));
  assertDiscountLeg(discount, gross, ids.discount, 'allowed');
  const entries: JournalEntryLine[] = [
    { accountId: debitAccount, debit: bTotal, credit: 0, memo: `فاتورة مبيعات ${invoice.invoiceNumber}${isCash ? ' نقدية' : ''}` },
  ];
  if (discount > 0 && ids.discount) {
    entries.push({ accountId: ids.discount, debit: discount, credit: 0, memo: `خصم مسموح به ${invoice.invoiceNumber}` });
  }
  entries.push(
    { accountId: ids.sales, debit: 0, credit: discount > 0 ? gross : bSub, memo: `إيرادات مبيعات ${invoice.invoiceNumber}` },
    { accountId: ids.vat, debit: 0, credit: bVat, memo: `ضريبة مبيعات ${invoice.invoiceNumber}` },
  );
  const cogsAmt = toMoney(invoice.cogsAmount);
  if (!cogs && cogsAmt > 0 && ids.cogs && ids.inventory) {
    entries.push(
      { accountId: ids.cogs, debit: cogsAmt, credit: 0, memo: `تكلفة بضاعة مباعة ${invoice.invoiceNumber}` },
      { accountId: ids.inventory, debit: 0, credit: cogsAmt, memo: `صرف مخزون ${invoice.invoiceNumber}` },
    );
  }
  const statements: TxStatement[] = [
    buildJournalEntryStatement(companyId, {
      reference: invoice.invoiceNumber,
      description: `قيد تلقائي - فاتورة مبيعات ${invoice.invoiceNumber}${isCash ? ' (نقدية)' : ''}`,
      date: invoice.date,
      totalAmount: bTotal,
      entries,
    }),
  ];
  const cogsTotal = Math.round((Number(cogs?.total) || 0) * 100) / 100;
  if (cogs && cogsTotal > 0) {
    statements.push(
      buildJournalEntryStatement(companyId, {
        reference: `${invoice.invoiceNumber}-COGS`,
        description: `قيد تلقائي - تكلفة فاتورة مبيعات ${invoice.invoiceNumber}`,
        date: invoice.date,
        totalAmount: cogsTotal,
        entries: [
          { accountId: cogs.cogsAccount, debit: cogsTotal, credit: 0, memo: `تكلفة بضاعة مباعة ${invoice.invoiceNumber}` },
          { accountId: cogs.inventoryAccount, debit: 0, credit: cogsTotal, memo: `انقاص مخزون ${invoice.invoiceNumber}` },
        ],
      })
    );
  }
  return statements;
}

export function buildPosSalePostingStatements(
  companyId: string,
  sale: SalesInvoicePostingInput & { receiptNumber: string; cashAmount: number; creditAmount: number; cashAccountId: string | null; cogsAmount?: number; discountAmount?: number; grossSubtotal?: number },
  ids: { debtors: string; sales: string; vat: string; cogs?: string; inventory?: string; discount?: string },
  cogs?: CogsBooking,
  base?: BaseBooking & { cashAmount?: number; creditAmount?: number }
): TxStatement[] {
  const bSub = Math.round((Number(base?.subtotal ?? sale.subtotal) || 0) * 100) / 100;
  const bVat = Math.round((Number(base?.vatAmount ?? sale.vatAmount) || 0) * 100) / 100;
  const bTotal = Math.round((Number(base?.totalAmount ?? sale.totalAmount) || 0) * 100) / 100;
  const bCash = Math.round((Number(base?.cashAmount ?? sale.cashAmount) || 0) * 100) / 100;
  const bCredit = Math.round((Number(base?.creditAmount ?? sale.creditAmount) || 0) * 100) / 100;
  const { receiptNumber, cashAccountId, date } = sale;
  const debitLines: JournalEntryLine[] = [];
  if (bCash > 0) {
    debitLines.push({ accountId: cashAccountId || ids.debtors, debit: bCash, credit: 0, memo: `نقدية نقطة بيع ${receiptNumber}` });
  }
  if (bCredit > 0) {
    debitLines.push({ accountId: ids.debtors, debit: bCredit, credit: 0, memo: `آجل نقطة بيع ${receiptNumber}` });
  }
  if (debitLines.length === 0) {
    debitLines.push({ accountId: ids.debtors, debit: 0, credit: 0, memo: `نقطة بيع ${receiptNumber}` });
  }
  const discount = toMoney(sale.discountAmount);
  const gross = toMoney(sale.grossSubtotal ?? (bSub + discount));
  assertDiscountLeg(discount, gross, ids.discount, 'allowed');
  if (discount > 0 && ids.discount) {
    debitLines.push({ accountId: ids.discount, debit: discount, credit: 0, memo: `خصم مسموح به ${receiptNumber}` });
  }
  const statements: TxStatement[] = [
    buildJournalEntryStatement(companyId, {
      reference: receiptNumber,
      description: `قيد تلقائي - إيصال نقطة بيع ${receiptNumber}`,
      date,
      totalAmount: bTotal,
      entries: [
        ...debitLines,
        { accountId: ids.sales, debit: 0, credit: discount > 0 ? gross : bSub, memo: `إيرادات نقطة بيع ${receiptNumber}` },
        { accountId: ids.vat, debit: 0, credit: bVat, memo: `ضريبة نقطة بيع ${receiptNumber}` },
      ],
    }),
  ];
  const cogsAmt = Math.round(((sale.cogsAmount || 0)) * 100) / 100;
  if (!cogs && cogsAmt > 0 && ids.cogs && ids.inventory) {
    const cogsEntries: JournalEntryLine[] = [
      { accountId: ids.cogs, debit: cogsAmt, credit: 0, memo: `تكلفة بضاعة مباعة ${receiptNumber}` },
      { accountId: ids.inventory, debit: 0, credit: cogsAmt, memo: `صرف مخزون ${receiptNumber}` },
    ];
    const baseEntries = [
      ...debitLines,
      { accountId: ids.sales, debit: 0, credit: discount > 0 ? gross : bSub, memo: `إيرادات نقطة بيع ${receiptNumber}` },
      { accountId: ids.vat, debit: 0, credit: bVat, memo: `ضريبة نقطة بيع ${receiptNumber}` },
      ...cogsEntries,
    ];
    statements[0] = buildJournalEntryStatement(companyId, {
      reference: receiptNumber,
      description: `قيد تلقائي - إيصال نقطة بيع ${receiptNumber}`,
      date,
      totalAmount: bTotal,
      entries: baseEntries,
    });
  }
  const cogsTotal = Math.round((Number(cogs?.total) || 0) * 100) / 100;
  if (cogs && cogsTotal > 0) {
    statements.push(
      buildJournalEntryStatement(companyId, {
        reference: `${receiptNumber}-COGS`,
        description: `قيد تلقائي - تكلفة إيصال نقطة بيع ${receiptNumber}`,
        date,
        totalAmount: cogsTotal,
        entries: [
          { accountId: cogs.cogsAccount, debit: cogsTotal, credit: 0, memo: `تكلفة بضاعة مباعة ${receiptNumber}` },
          { accountId: cogs.inventoryAccount, debit: 0, credit: cogsTotal, memo: `انقاص مخزون ${receiptNumber}` },
        ],
      })
    );
  }
  return statements;
}

export interface CashDifferenceBooking {
  reference: string;
  date: string;
  /** counted − expected (signed; |x| < 0.005 yields no statements). */
  difference: number;
  boxAccountId: string;
  shortageAccountId: string;
  surplusAccountId: string;
}

export function buildCashDifferenceStatements(
  companyId: string,
  b: CashDifferenceBooking
): TxStatement[] {
  const amt = Math.round(Math.abs(Number(b.difference) || 0) * 100) / 100;
  if (amt < 0.005) return [];
  const entries =
    Number(b.difference) < 0
      ? [
          { accountId: b.shortageAccountId, debit: amt, credit: 0, memo: `عجز جرد وردية ${b.reference}` },
          { accountId: b.boxAccountId, debit: 0, credit: amt, memo: `عجز صندوق الوردية` },
        ]
      : [
          { accountId: b.boxAccountId, debit: amt, credit: 0, memo: `فائض صندوق الوردية` },
          { accountId: b.surplusAccountId, debit: 0, credit: amt, memo: `فائض جرد وردية ${b.reference}` },
        ];
  return [
    buildJournalEntryStatement(companyId, {
      reference: b.reference,
      description: `قيد فرق جرد وردية ${b.reference}`,
      date: b.date,
      totalAmount: amt,
      entries,
    }),
  ];
}

export interface StandardPurchaseBooking {
  /** Inventory value at frozen standard cost (Σ baseQty × standard). */
  inventoryAmount: number;
  /** actual − standard: >0 over-spend (Dr PPV), <0 saving (Cr PPV). */
  varianceAmount: number;
  varianceAccount: string;
}

export function buildPurchaseInvoicePostingStatements(
  companyId: string,
  invoice: { invoiceNumber: string; date: string; subtotal: number; vatAmount: number; totalAmount: number; paymentType?: string; cashAccountSubstitute?: string | null; discountAmount?: number; grossSubtotal?: number },
  ids: { inventory: string; creditors: string; vat: string; discount?: string },
  standard?: StandardPurchaseBooking,
  base?: BaseBooking
): TxStatement[] {
  const isCash = invoice.paymentType === 'cash';
  const creditAccount = (isCash && invoice.cashAccountSubstitute) || ids.creditors;
  const bSub = base ? Math.round((Number(base.subtotal) || 0) * 100) / 100 : undefined;
  const bVat = base ? Math.round((Number(base.vatAmount) || 0) * 100) / 100 : undefined;
  const bTotal = base ? Math.round((Number(base.totalAmount) || 0) * 100) / 100 : undefined;
  const discount = toMoney(invoice.discountAmount);
  const gross = toMoney(invoice.grossSubtotal ?? ((bSub ?? invoice.subtotal) + discount));
  assertDiscountLeg(discount, gross, ids.discount, 'earned');
  const inventoryAmount = standard ? Math.round((Number(standard.inventoryAmount) || 0) * 100) / 100 : gross;
  const variance = standard ? Math.round((Number(standard.varianceAmount) || 0) * 100) / 100 : 0;
  const bVatFinal = bVat !== undefined ? bVat : Math.round((Number(invoice.vatAmount) || 0) * 100) / 100;
  const bTotalFinal = bTotal !== undefined ? bTotal : Math.round((Number(invoice.totalAmount) || 0) * 100) / 100;
  const entries: JournalEntryLine[] = [
    { accountId: ids.inventory, debit: inventoryAmount, credit: 0, memo: `مشتريات ${invoice.invoiceNumber}${standard ? ' (بالكلفة المعيارية)' : ''}` },
  ];
  if (standard && variance > 0) {
    entries.push({ accountId: standard.varianceAccount, debit: variance, credit: 0, memo: `فروق أسعار شراء ${invoice.invoiceNumber}` });
  }
  entries.push(
    { accountId: ids.vat, debit: bVatFinal, credit: 0, memo: `ضريبة مشتريات ${invoice.invoiceNumber}` },
    { accountId: creditAccount, debit: 0, credit: bTotalFinal, memo: isCash ? `سداد نقدي ${invoice.invoiceNumber}` : `التزام مورد ${invoice.invoiceNumber}` }
  );
  if (standard && variance < 0) {
    entries.push({ accountId: standard.varianceAccount, debit: 0, credit: -variance, memo: `وفرات أسعار شراء ${invoice.invoiceNumber}` });
  }
  if (discount > 0 && ids.discount) {
    entries.push({ accountId: ids.discount, debit: 0, credit: discount, memo: `خصم مكتسب ${invoice.invoiceNumber}` });
  }
  return [
    buildJournalEntryStatement(companyId, {
      reference: invoice.invoiceNumber,
      description: `قيد تلقائي - فاتورة مشتريات ${invoice.invoiceNumber}${isCash ? ' (نقدية)' : ''}`,
      date: invoice.date,
      totalAmount: bTotalFinal,
      entries,
    }),
  ];
}

export interface SalesReturnCosting {
  subtotal: number;
  vatAmount: number;
  costTotal: number;
}

export async function buildSalesReturnPostingStatements(
  companyId: string,
  ret: { id?: string; returnNumber: string; date: string; customer: string; amount: number; cogsReversal?: number; discountAmount?: number; grossAmount?: number },
  costing?: SalesReturnCosting,
  base?: BaseBooking,
  preferredWarehouseId?: string | null
): Promise<{ success: true; statements: TxStatement[] } | { success: false; error: string }> {
  const resolved = await resolvePostingAccounts(companyId, ['default_sales_returns', 'default_debtors', 'default_inventory', 'default_cogs', 'default_vat_output']);
  if (!resolved.success) return resolved;
  const { default_sales_returns: salesReturnsId, default_debtors: debtorsId, default_inventory: inventoryId, default_cogs: cogsId, default_vat_output: vatOutputId } = resolved.ids;
  const discount = toMoney(ret.discountAmount);
  const gross = toMoney(ret.grossAmount ?? (ret.amount + discount));
  if (discount < 0 || discount > gross + 0.005) {
    return { success: false, error: 'الخصم يتجاوز إجمالي المبلغ — راجع مبالغ الخصم في المردود' };
  }
  let discountId: string | undefined;
  if (discount > 0) {
    discountId = (await getDefaultAccountId(companyId, 'default_discount_allowed')) || undefined;
    if (!discountId) {
      return { success: false, error: 'حساب الخصم المسموح به غير مضبوط — اربطه في الإعدادات ← الحسابات الافتراضية' };
    }
  }
  const subtotal = Math.round((Number(base?.subtotal ?? costing?.subtotal ?? ret.amount) || 0) * 100) / 100;
  const vatAmount = Math.round((Number(base?.vatAmount ?? costing?.vatAmount ?? 0) || 0) * 100) / 100;
  const costTotal = Math.round((Number(costing?.costTotal ?? ret.cogsReversal ?? 0) || 0) * 100) / 100;
  const total = Math.round((subtotal + vatAmount) * 100) / 100;
  const salesDebit = discount > 0 ? gross : subtotal;
  const entries: JournalEntryLine[] = [
    { accountId: salesReturnsId, debit: salesDebit, credit: 0, memo: `مردود مبيعات ${ret.returnNumber}` },
  ];
  if (discount > 0 && discountId) {
    entries.push({ accountId: discountId, debit: 0, credit: discount, memo: `عكس خصم مسموح به ${ret.returnNumber}` });
  }
  if (vatAmount > 0) {
    entries.push({ accountId: vatOutputId, debit: vatAmount, credit: 0, memo: `عكس ضريبة مخرجات ${ret.returnNumber}` });
  }
  entries.push({ accountId: debtorsId, debit: 0, credit: total, memo: `تخفيض ذمة ${ret.customer}` });
  if (costTotal > 0) {
    entries.push({ accountId: inventoryId, debit: costTotal, credit: 0, memo: `إعادة بضاعة للمخزون` });
    entries.push({ accountId: cogsId, debit: 0, credit: costTotal, memo: `عكس تكلفة بضاعة مباعة` });
  }

  const statements: TxStatement[] = [
    buildJournalEntryStatement(companyId, {
      reference: ret.returnNumber,
      description: `قيد تلقائي - مردود مبيعات ${ret.returnNumber}`,
      date: ret.date,
      totalAmount: total,
      entries,
    }),
  ];

  // Phase 4 preferred-source fragment (default warehouse when it holds the
  // line qty). NULL-safe: a NULL preference degrades to richest-first.
  const preferSrc = `(SELECT s2.warehouse_id FROM stock s2 WHERE s2.product_id = srl.product_id AND s2.company_id = sr.company_id AND s2.warehouse_id = $PREF::uuid AND s2.quantity >= COALESCE(NULLIF(srl.base_quantity, 0), srl.quantity) LIMIT 1),`;
  const lateralSrc = (pref: string) => `SELECT COALESCE(
                      ${preferSrc.replaceAll('$PREF', pref)}
                      (SELECT warehouse_id FROM stock WHERE product_id = srl.product_id AND company_id = sr.company_id ORDER BY quantity DESC LIMIT 1),
                      (SELECT id FROM warehouses WHERE company_id = sr.company_id ORDER BY created_at LIMIT 1)
                    ) AS warehouse_id`;

  if (ret.id) {
    // Ensure stock rows exist for returned products (in case product never stocked before)
    statements.push({
      sql: `INSERT INTO stock (company_id, product_id, warehouse_id, quantity)
            SELECT $2::uuid, srl.product_id, wh.warehouse_id, 0
              FROM sales_returns sr
              JOIN sales_return_lines srl ON srl.return_id = sr.id
              JOIN LATERAL (
                ${lateralSrc('$3')}
              ) wh ON true
              LEFT JOIN stock s ON s.company_id = sr.company_id AND s.product_id = srl.product_id AND s.warehouse_id = wh.warehouse_id
             WHERE sr.id = $1::uuid AND sr.company_id = $2::uuid AND wh.warehouse_id IS NOT NULL AND s.id IS NULL
             GROUP BY srl.product_id, wh.warehouse_id`,
      params: [ret.id, companyId, preferredWarehouseId || null],
    });
    statements.push({
      sql: `INSERT INTO stock_movements (company_id, product_id, warehouse_id, type, quantity, reference, notes, created_at)
         SELECT sr.company_id, srl.product_id, wh.warehouse_id, 'in', COALESCE(NULLIF(srl.base_quantity, 0), srl.quantity), $1, 'مردود مبيعات', NOW()
           FROM sales_returns sr
           JOIN sales_return_lines srl ON srl.return_id = sr.id
           JOIN LATERAL (
             ${lateralSrc('$4')}
           ) wh ON true
          WHERE sr.id = $2::uuid AND sr.company_id = $3::uuid AND wh.warehouse_id IS NOT NULL`,
      params: [ret.returnNumber, ret.id, companyId, preferredWarehouseId || null],
    });
    // Increase stock quantities (base units — the document quantity may be
    // expressed in a larger unit such as carton).
    statements.push({
      sql: `UPDATE stock s SET quantity = s.quantity + sub.qty, updated_at = NOW()
              FROM (
                SELECT srl.product_id, wh.warehouse_id, SUM(COALESCE(NULLIF(srl.base_quantity, 0), srl.quantity)) AS qty
                  FROM sales_returns sr
                  JOIN sales_return_lines srl ON srl.return_id = sr.id
                  JOIN LATERAL (
                    ${lateralSrc('$3')}
                  ) wh ON true
                 WHERE sr.id = $1::uuid AND sr.company_id = $2::uuid AND wh.warehouse_id IS NOT NULL
                 GROUP BY srl.product_id, wh.warehouse_id
              ) sub
             WHERE s.company_id = $2::uuid AND s.product_id = sub.product_id AND s.warehouse_id = sub.warehouse_id`,
      params: [ret.id, companyId, preferredWarehouseId || null],
    });
  }
  return { success: true, statements };
}

/**
 * JE statements for a stock adjustment.
 * Phase 1 (IAS 2): the amount is MONEY (|difference| × unitCost) — never the
 * raw quantity — and the counter-leg is a dedicated gain/loss account, never
 * COGS (a stock-count variance is not cost of goods sold and must not move
 * gross margin).
 *   found (actual > system) → Dr Inventory / Cr Surplus gain (41901)
 *   lost  (actual < system) → Dr Shortage loss (52901) / Cr Inventory
 */
export async function buildStockAdjustmentPostingStatements(
  companyId: string,
  adj: { product: string; difference: number; reason: string; date: string; id: string; unitCost?: number }
): Promise<{ success: true; statements: TxStatement[] } | { success: false; error: string }> {
  if (!adj.difference || adj.difference === 0) return { success: true, statements: [] };
  const resolved = await resolvePostingAccounts(companyId, ['default_inventory', 'default_inventory_shortage', 'default_inventory_surplus']);
  if (!resolved.success) return resolved;
  const { default_inventory: inventoryId, default_inventory_shortage: shortageId, default_inventory_surplus: surplusId } = resolved.ids;
  const amount = Math.round(Math.abs(adj.difference) * (Number(adj.unitCost) || 0) * 100) / 100;
  if (amount <= 0) return { success: true, statements: [] };
  const entries: JournalEntryLine[] = [];
  if (adj.difference > 0) {
    entries.push({ accountId: inventoryId, debit: amount, credit: 0, memo: `عثور ${adj.product}` });
    entries.push({ accountId: surplusId, debit: 0, credit: amount, memo: `فائض مخزون` });
  } else {
    entries.push({ accountId: shortageId, debit: amount, credit: 0, memo: `فاقد ${adj.product}` });
    entries.push({ accountId: inventoryId, debit: 0, credit: amount, memo: `عجز مخزون` });
  }
  return {
    success: true,
    statements: [
      buildJournalEntryStatement(companyId, {
        reference: `ADJ-${adj.id}`,
        description: `قيد تلقائي - تسوية مخزون ${adj.id} - ${adj.reason}`,
        date: adj.date,
        totalAmount: amount,
        entries,
      }),
    ],
  };
}

/**
 * Realized exchange-difference JE (Phase 2 — IAS 21): the gap between what a
 * linked payment was worth at the INVOICE rate and what actually moved at the
 * PAYMENT rate. Positive amount with an explicit side — the caller decides
 * direction; this builder only shapes the balanced pair.
 *   receipt, shortfall (received less base value than booked) → Dr FX / Cr debtors
 *   receipt, windfall  → Dr debtors / Cr FX
 *   payment, shortfall (paid less base value than relieved) → Dr creditors / Cr FX
 *   payment, windfall  → Dr FX / Cr creditors
 */
export function buildFxDifferenceStatements(
  companyId: string,
  fx: { reference: string; date: string; memo: string; amount: number; debitAccount: string; creditAccount: string }
): TxStatement[] {
  const amount = Math.round((Number(fx.amount) || 0) * 100) / 100;
  if (amount <= 0) return [];
  return [
    buildJournalEntryStatement(companyId, {
      reference: `${fx.reference}-FX`,
      description: `قيد تلقائي - فروق صرف ${fx.reference}`,
      date: fx.date,
      totalAmount: amount,
      entries: [
        { accountId: fx.debitAccount, debit: amount, credit: 0, memo: fx.memo },
        { accountId: fx.creditAccount, debit: 0, credit: amount, memo: fx.memo },
      ],
    }),
  ];
}

/**
 * JE statements for a receipt voucher: Dr treasury / Cr debtors.
 * Phase 2: posted in BASE amount (treasuries are base-currency by design —
 * cash_boxes carry no currency). Pass baseAmount explicitly; legacy callers
 * without FX data keep posting the document amount.
 */
export async function buildReceiptVoucherStatements(
  companyId: string,
  v: { voucherNumber: string; date: string; customerName: string; customerId?: string; amount: number; paymentMethod: string; cashBoxId?: string | null; baseAmount?: number }
): Promise<{ success: true; statements: TxStatement[] } | { success: false; error: string }> {
  const resolved = await resolvePostingAccounts(companyId, ['default_cash', 'default_debtors']);
  if (!resolved.success) return resolved;
  const { default_cash: cashId, default_debtors: debtorsId } = resolved.ids;
  // Post to the SELECTED خزنة's own GL account, falling back to default cash.
  const debitAccount = (await getCashBoxAccountId(companyId, v.cashBoxId)) || cashId;
  const amount = Math.round((Number(v.baseAmount ?? v.amount) || 0) * 100) / 100;

  return {
    success: true,
    statements: [
      buildJournalEntryStatement(companyId, {
        reference: v.voucherNumber,
        description: `سند قبض - رقم ${v.voucherNumber}${v.customerName ? ` - ${v.customerName}` : ''}`,
        // Guard: callers may forward raw pg DATE values (JS Date at UTC
        // midnight) — normalize before the timestamptz INSERT.
        date: normalizeDate(v.date),
        totalAmount: amount,
        entries: [
          { accountId: debitAccount, debit: amount, credit: 0, memo: `قبض من ${v.customerName || v.customerId || 'العميل'}` },
          { accountId: debtorsId, debit: 0, credit: amount, memo: `تسديد دين` },
        ],
      }),
    ],
  };
}

/**
 * JE statements for a payment voucher: Dr creditors/expense / Cr treasury.
 * Phase 2: posted in BASE amount (same base-currency treasury rule).
 */
export async function buildPaymentVoucherStatements(
  companyId: string,
  v: { voucherNumber: string; date: string; supplierName: string; supplierId?: string; expenseAccountId?: string; amount: number; paymentMethod: string; cashBoxId?: string | null; baseAmount?: number }
): Promise<{ success: true; statements: TxStatement[] } | { success: false; error: string }> {
  const resolved = await resolvePostingAccounts(companyId, ['default_cash', 'default_creditors']);
  if (!resolved.success) return resolved;
  const { default_cash: cashId, default_creditors: creditorsId } = resolved.ids;
  const creditAccount = (await getCashBoxAccountId(companyId, v.cashBoxId)) || cashId;
  const debitAccount = v.expenseAccountId || creditorsId;
  const amount = Math.round((Number(v.baseAmount ?? v.amount) || 0) * 100) / 100;

  return {
    success: true,
    statements: [
      buildJournalEntryStatement(companyId, {
        reference: v.voucherNumber,
        description: `سند صرف - رقم ${v.voucherNumber}${v.supplierName ? ` - ${v.supplierName}` : ''}`,
        // Guard: same normalization as receipt vouchers (raw pg DATE values).
        date: normalizeDate(v.date),
        totalAmount: amount,
        entries: [
          { accountId: debitAccount, debit: amount, credit: 0, memo: `صرف إلى ${v.supplierName || v.supplierId || 'المورد'}` },
          { accountId: creditAccount, debit: 0, credit: amount, memo: `سحب من الخزنة` },
        ],
      }),
    ],
  };
}

export interface PurchaseReturnCosting {
  /** Net (ex-VAT) return value. */
  subtotal: number;
  /** Input VAT to reverse (via default_vat_input — Phase-3-safe). */
  vatAmount: number;
  /** Inventory value leaving stock (method cost basis, NOT the return price). */
  costBasis: number;
}

/** JE + stock-movement statements for a purchase return (goods out of stock). */
export async function buildPurchaseReturnPostingStatements(
  companyId: string,
  ret: { id?: string; returnNumber: string; date: string; supplier: string; amount: number; discountAmount?: number; grossAmount?: number },
  costing?: PurchaseReturnCosting,
  base?: BaseBooking,
  preferredWarehouseId?: string | null
): Promise<{ success: true; statements: TxStatement[] } | { success: false; error: string }> {
  const resolved = await resolvePostingAccounts(companyId, ['default_creditors', 'default_inventory', 'default_vat_input', 'default_price_variance']);
  if (!resolved.success) return resolved;
  const { default_creditors: creditorsId, default_inventory: inventoryId, default_vat_input: vatInputId, default_price_variance: ppvId } = resolved.ids;

  // Phase 1 (IAS 2 + VAT): inventory leaves at COST basis; input VAT reverses
  // on its own leg; any gap between the agreed return price and the cost
  // basis is a price variance — never hidden inside inventory.
  // Phase 2: creditor/VAT legs in base (cost legs are domestic). The gap may
  // therefore absorb FX drift between purchase and return — still P&L-correct
  // (PPV is a profit-and-loss account), just less granular than 42101.
  const subtotal = Math.round((Number(base?.subtotal ?? costing?.subtotal ?? ret.amount) || 0) * 100) / 100;
  const vatAmount = Math.round((Number(base?.vatAmount ?? costing?.vatAmount ?? 0) || 0) * 100) / 100;
  const costBasis = Math.round((Number(costing?.costBasis ?? subtotal) || 0) * 100) / 100;
  const total = Math.round((subtotal + vatAmount) * 100) / 100;
  const gap = Math.round((costBasis - subtotal) * 100) / 100;
  const entries: JournalEntryLine[] = [
    { accountId: creditorsId, debit: total, credit: 0, memo: `تخفيض التزام ${ret.supplier}` },
  ];
  if (gap > 0) {
    entries.push({ accountId: ppvId, debit: gap, credit: 0, memo: `فروق تقييم مردود ${ret.returnNumber}` });
  }
  entries.push({ accountId: inventoryId, debit: 0, credit: costBasis, memo: `إخراج بضاعة مردودة ${ret.returnNumber}` });
  if (vatAmount > 0) {
    entries.push({ accountId: vatInputId, debit: 0, credit: vatAmount, memo: `عكس ضريبة مدخلات ${ret.returnNumber}` });
  }
  if (gap < 0) {
    entries.push({ accountId: ppvId, debit: 0, credit: -gap, memo: `وفورات تقييم مردود ${ret.returnNumber}` });
  }
  const statements: TxStatement[] = [
    buildJournalEntryStatement(companyId, {
      reference: ret.returnNumber,
      description: `قيد تلقائي - مردود مشتريات ${ret.returnNumber}`,
      date: ret.date,
      totalAmount: total,
      entries,
    }),
  ];

  if (ret.id) {
    statements.push({
      sql: `INSERT INTO stock_movements (company_id, product_id, warehouse_id, type, quantity, reference, notes, created_at)
         SELECT pr.company_id, prl.product_id, wh.warehouse_id, 'out', COALESCE(NULLIF(prl.base_quantity, 0), prl.quantity), $1, 'مردود مشتريات', NOW()
           FROM purchase_returns pr
           JOIN purchase_return_lines prl ON prl.return_id = pr.id
           JOIN LATERAL (
             SELECT COALESCE(
               (SELECT s2.warehouse_id FROM stock s2 WHERE s2.product_id = prl.product_id AND s2.company_id = pr.company_id AND s2.warehouse_id = $4::uuid AND s2.quantity >= COALESCE(NULLIF(prl.base_quantity, 0), prl.quantity) LIMIT 1),
               (SELECT s.warehouse_id FROM stock s
                WHERE s.product_id = prl.product_id AND s.company_id = pr.company_id
                ORDER BY s.quantity DESC LIMIT 1)
             ) AS warehouse_id
           ) wh ON true
          WHERE pr.id = $2::uuid AND pr.company_id = $3::uuid`,
      params: [ret.returnNumber, ret.id, companyId, preferredWarehouseId || null],
    });
    // Decrement stock quantities (base units — the document quantity may be
    // expressed in a larger unit such as carton).
    statements.push({
      sql: `UPDATE stock s SET quantity = s.quantity - sub.qty, updated_at = NOW()
              FROM (
                SELECT prl.product_id, wh.warehouse_id, SUM(COALESCE(NULLIF(prl.base_quantity, 0), prl.quantity)) AS qty
                  FROM purchase_returns pr
                  JOIN purchase_return_lines prl ON prl.return_id = pr.id
                  JOIN LATERAL (
                    SELECT warehouse_id FROM stock WHERE product_id = prl.product_id AND company_id = pr.company_id ORDER BY quantity DESC LIMIT 1
                  ) wh ON true
                 WHERE pr.id = $1::uuid AND pr.company_id = $2::uuid
                 GROUP BY prl.product_id, wh.warehouse_id
              ) sub
             WHERE s.company_id = $2::uuid AND s.product_id = sub.product_id AND s.warehouse_id = sub.warehouse_id`,
      params: [ret.id, companyId],
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
  voucher: { voucherNumber: string; date: string; customer: string; amount: number; paymentMethod: string; cashBoxId?: string | null }
) {
  const debtorsId = await getDefaultAccountId(companyId, 'default_debtors');
  const cashId = (await getCashBoxAccountId(companyId, voucher.cashBoxId))
    || await getDefaultAccountId(companyId, 'default_cash');

  if (!cashId || !debtorsId) {
    return { success: false, error: 'Required accounts not found. Please configure default accounts in Settings.' };
  }

  const debitAccount = cashId;

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
 * Cr: Treasury (خزنة account, fallback default cash)
 */
export async function postPaymentVoucher(
  companyId: string,
  voucher: { voucherNumber: string; date: string; supplier: string; amount: number; paymentMethod: string; expenseAccount?: string; cashBoxId?: string | null }
) {
  const creditorsId = await getDefaultAccountId(companyId, 'default_creditors');
  const cashId = (await getCashBoxAccountId(companyId, voucher.cashBoxId))
    || await getDefaultAccountId(companyId, 'default_cash');
  // Best practice: expense accounts resolve via default_accounts first, then chart codes.
  const rentWarehouseId = await findAccountByCode(companyId, ACC.RENT_WAREHOUSE);
  const rentOfficeId = (await getDefaultAccountId(companyId, 'default_rent'))
    || await findAccountByCode(companyId, ACC.RENT_OFFICE);
  const electricityId = await findAccountByCode(companyId, ACC.ELECTRICITY);
  const advertisingId = await findAccountByCode(companyId, ACC.ADVERTISING);
  const maintenanceId = await findAccountByCode(companyId, ACC.MAINTENANCE);
  const shippingId = (await getDefaultAccountId(companyId, 'default_shipping'))
    || await findAccountByCode(companyId, ACC.SHIPPING);

  if (!cashId || !creditorsId) {
    return { success: false, error: 'Required accounts not found. Please configure default accounts in Settings.' };
  }

  const creditAccount = cashId;

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
    { accountId: creditAccount, debit: 0, credit: voucher.amount, memo: `سحب من الخزنة` },
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
 * Post a Sales Return to accounting (reverse of sales).
 * Phase 1: thin delegate over buildSalesReturnPostingStatements — the old
 * inline 70%-of-amount COGS estimate (plus halala-truncating floor) is gone;
 * without explicit costing the JE carries revenue + debtor legs only.
 */
export async function postSalesReturn(
  companyId: string,
  ret: { id?: string; returnNumber: string; date: string; customer: string; amount: number },
  costing?: SalesReturnCosting
) {
  const built = await buildSalesReturnPostingStatements(
    companyId,
    { id: ret.id, returnNumber: ret.returnNumber, date: ret.date, customer: ret.customer, amount: ret.amount },
    costing
  );
  if (!built.success) return built;
  const txResult = await runTransaction(built.statements);
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
         SELECT pr.company_id, prl.product_id, wh.warehouse_id, 'out', prl.quantity, $1, NOW()
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
 * Post a Stock Adjustment to accounting.
 * Phase 1: thin delegate over buildStockAdjustmentPostingStatements — the
 * amount is money (|difference| × unitCost) on dedicated gain/loss accounts.
 * Callers that only know a monetary difference pass it as difference with
 * unitCost 1 (legacy tests do exactly this).
 */
export async function postStockAdjustment(
  companyId: string,
  adj: { id: string; date: string; product: string; difference: number; reason: string; unitCost?: number }
) {
  const built = await buildStockAdjustmentPostingStatements(companyId, {
    product: adj.product,
    difference: adj.difference,
    reason: adj.reason,
    date: adj.date,
    id: adj.id,
    unitCost: adj.unitCost,
  });
  if (!built.success) return built;
  if (built.statements.length === 0) return { success: true, id: 'skip' };
  const txResult = await runTransaction(built.statements);
  if (!txResult.success) return { success: false, error: txResult.error };
  return { success: true };
}
