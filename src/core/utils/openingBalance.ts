import { getDbAdapter } from '@/core/database/adapters';

/**
 * Opening balance accounting (QuickBooks / Odoo style).
 *
 * Every opening balance is posted immediately as a balanced journal entry
 * through the "Opening Balance Equity" account (code 31201, equity/credit),
 * so the books stay Dr = Cr from day one:
 *
 *  - Customer opening  -> Dr Trade Debtors (11201)      / Cr Opening Equity
 *  - Supplier opening  -> Dr Opening Equity             / Cr Trade Creditors (21101)
 *  - Employee opening  -> Dr Employee Advances (11202)  / Cr Opening Equity
 *  - Product stock     -> Dr Inventory (11301)          / Cr Opening Equity (qty x cost)
 *
 * Callers are responsible for stamping `opening_balance_posted` and updating
 * the entity's running balance column after a successful post.
 */

export type OpeningEntityType = 'customer' | 'supplier' | 'employee' | 'product_stock';

const OPENING_EQUITY_CODE = '31201';
const AR_CODE = '11201';
const AP_CODE = '21101';
const ADVANCES_CODE = '11202';
const INVENTORY_CODE = '11301';

async function findAccountIdByCode(companyId: string, code: string): Promise<string | null> {
  const adapter = await getDbAdapter();
  const res = await adapter.query<{ id: string }>(
    'SELECT id FROM accounts WHERE company_id = $1 AND code = $2 LIMIT 1',
    [companyId, code]
  );
  return res.rows?.[0]?.id || null;
}

/** Returns the Opening Balance Equity account, creating it when missing. */
export async function ensureOpeningBalanceEquityAccount(companyId: string): Promise<string | null> {
  const existing = await findAccountIdByCode(companyId, OPENING_EQUITY_CODE);
  if (existing) return existing;

  const adapter = await getDbAdapter();
  // Find a parent: prefer group 312, then 311, then root 3.
  const parentRes = await adapter.query<{ id: string }>(
    "SELECT id FROM accounts WHERE company_id = $1 AND code IN ('312','311','3') ORDER BY CASE code WHEN '312' THEN 0 WHEN '311' THEN 1 ELSE 2 END LIMIT 1",
    [companyId]
  );
  const parentId = parentRes.rows?.[0]?.id || null;
  await adapter.query(
    `INSERT INTO accounts (id, company_id, code, name_ar, name_en, parent_id, type, nature, is_group, balance, is_active)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, CASE WHEN $6 IS NULL THEN NULL ELSE $6::uuid END, 'equity', 'credit', false, 0, true)`,
    [crypto.randomUUID(), companyId, OPENING_EQUITY_CODE, 'حساب الأرصدة الافتتاحية', 'Opening Balance Equity', parentId]
  );
  return findAccountIdByCode(companyId, OPENING_EQUITY_CODE);
}

export interface OpeningBalanceEntryInput {
  entityType: OpeningEntityType;
  entityId?: string;
  /** Human label used in the JE memo, e.g. customer name or product code. */
  label: string;
  /** Positive monetary amount, or quantity for product_stock. */
  amount: number;
  /** Required for entityType === 'product_stock': unit cost used for valuation. */
  costPrice?: number;
}

/**
 * Post the balanced opening journal entry for one entity.
 * Returns the created transaction id on success.
 */
export async function postOpeningBalanceEntry(
  companyId: string,
  input: OpeningBalanceEntryInput
): Promise<{ success: boolean; transactionId?: string; error?: string }> {
  const amount = Math.round(Number(input.amount) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) {
    return { success: false, error: 'الرصيد الافتتاحي يجب أن يكون رقماً موجباً' };
  }

  const obeAccountId = await ensureOpeningBalanceEquityAccount(companyId);
  if (!obeAccountId) return { success: false, error: 'تعذر تجهيز حساب الأرصدة الافتتاحية' };

  let valueAmount = amount;
  if (input.entityType === 'product_stock') {
    valueAmount = Math.round(Number(input.costPrice || 0) * amount * 100) / 100;
    if (valueAmount <= 0) {
      return { success: false, error: 'قيمة مخزون أول المدة يجب أن تكون أكبر من صفر (تأكد من سعر التكلفة)' };
    }
  }

  let drAccountId: string;
  let crAccountId: string;

  if (input.entityType === 'customer') {
    const ar = await findAccountIdByCode(companyId, AR_CODE);
    if (!ar) return { success: false, error: 'حساب المدينين التجاريين غير موجود' };
    drAccountId = ar;
    crAccountId = obeAccountId;
  } else if (input.entityType === 'supplier') {
    const ap = await findAccountIdByCode(companyId, AP_CODE);
    if (!ap) return { success: false, error: 'حساب الدائنين التجاريين غير موجود' };
    drAccountId = obeAccountId;
    crAccountId = ap;
  } else if (input.entityType === 'employee') {
    drAccountId = (await findAccountIdByCode(companyId, ADVANCES_CODE)) || obeAccountId;
    crAccountId = obeAccountId;
  } else if (input.entityType === 'product_stock') {
    const inv = await findAccountIdByCode(companyId, INVENTORY_CODE);
    if (!inv) return { success: false, error: 'حساب المخزون غير موجود' };
    drAccountId = inv;
    crAccountId = obeAccountId;
  } else {
    return { success: false, error: 'نوع كيان غير مدعوم للرصيد الافتتاحي' };
  }

  const lines = [
    { accountId: drAccountId, debit: valueAmount, credit: 0, memo: input.label },
    { accountId: crAccountId, debit: 0, credit: valueAmount, memo: input.label },
  ];

  const adapter = await getDbAdapter();
  const result = await adapter.createTransaction({
    companyId,
    date: new Date().toISOString().split('T')[0],
    reference: 'OPENING',
    description: `رصيد افتتاحي - ${input.label}`,
    totalAmount: valueAmount,
    status: 'posted',
    entries: lines,
  });
  if (!result.success) return { success: false, error: result.error };
  void input.entityId;
  return { success: true, transactionId: result.id };
}

/**
 * Post an account-level opening balance respecting its natural direction:
 * debit-direction takes Dr <account> / Cr OBE, credit-direction mirrors it.
 * Also aligns the stored snapshot `accounts.balance`.
 */
export async function postAccountOpeningBalance(
  companyId: string,
  opts: { accountId: string; accountCode: string; accountName: string; direction: 'debit' | 'credit'; amount: number }
): Promise<{ success: boolean; transactionId?: string; error?: string }> {
  const amount = Math.round(Number(opts.amount) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) {
    return { success: false, error: 'الرصيد الافتتاحي يجب أن يكون رقماً موجباً' };
  }
  const obeAccountId = await ensureOpeningBalanceEquityAccount(companyId);
  if (!obeAccountId) return { success: false, error: 'تعذر تجهيز حساب الأرصدة الافتتاحية' };

  const memo = `${opts.accountCode} - ${opts.accountName}`;
  const drSide = opts.direction === 'debit';
  const lines = [
    { accountId: opts.accountId, debit: drSide ? amount : 0, credit: drSide ? 0 : amount, memo },
    { accountId: obeAccountId, debit: drSide ? 0 : amount, credit: drSide ? amount : 0, memo },
  ];

  const adapter = await getDbAdapter();
  const result = await adapter.createTransaction({
    companyId,
    date: new Date().toISOString().split('T')[0],
    reference: 'OPENING',
    description: `رصيد افتتاحي - ${memo}`,
    totalAmount: amount,
    status: 'posted',
    entries: lines,
  });
  if (result.success && result.id) {
    await adapter.query(
      'UPDATE accounts SET balance = COALESCE(balance,0) + $1::numeric, opening_amount = $1::numeric, opening_direction = $2, opening_balance_posted = true WHERE company_id = $3::uuid AND id = $4::uuid',
      [drSide ? amount : -amount, opts.direction, companyId, opts.accountId]
    );
  }
  return result.success ? { success: true, transactionId: result.id } : { success: false, error: result.error };
}

interface EntityOpeningResult {
  success: boolean;
  error?: string;
}

/** Customer: Dr AR / Cr OBE, then stamp + bump customers.balance. */
export async function postCustomerOpening(
  companyId: string,
  opts: { id: string; name: string; amount: number }
): Promise<EntityOpeningResult> {
  const amount = Math.round(Number(opts.amount) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) return { success: true }; // nothing to post
  const posted = await postOpeningBalanceEntry(companyId, {
    entityType: 'customer', entityId: opts.id, label: opts.name, amount,
  });
  if (!posted.success) return posted;
  const adapter = await getDbAdapter();
  const res = await adapter.query(
    'UPDATE customers SET opening_balance = $1::numeric, opening_balance_posted = true, balance = COALESCE(balance,0) + $1::numeric, updated_at = NOW() WHERE id = $2::uuid AND company_id = $3::uuid',
    [amount, opts.id, companyId]
  );
  return res.success ? { success: true } : { success: false, error: res.error };
}

/** Supplier: Dr OBE / Cr AP, then stamp + bump suppliers.balance. */
export async function postSupplierOpening(
  companyId: string,
  opts: { id: string; name: string; amount: number }
): Promise<EntityOpeningResult> {
  const amount = Math.round(Number(opts.amount) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) return { success: true };
  const posted = await postOpeningBalanceEntry(companyId, {
    entityType: 'supplier', entityId: opts.id, label: opts.name, amount,
  });
  if (!posted.success) return posted;
  const adapter = await getDbAdapter();
  const res = await adapter.query(
    'UPDATE suppliers SET opening_balance = $1::numeric, opening_balance_posted = true, balance = COALESCE(balance,0) + $1::numeric, updated_at = NOW() WHERE id = $2::uuid AND company_id = $3::uuid',
    [amount, opts.id, companyId]
  );
  return res.success ? { success: true } : { success: false, error: res.error };
}

/** Employee advance: Dr Employee Advances / Cr OBE, then stamp. */
export async function postEmployeeOpening(
  companyId: string,
  opts: { id: string; name: string; amount: number }
): Promise<EntityOpeningResult> {
  const amount = Math.round(Number(opts.amount) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) return { success: true };
  const posted = await postOpeningBalanceEntry(companyId, {
    entityType: 'employee', entityId: opts.id, label: opts.name, amount,
  });
  if (!posted.success) return posted;
  const adapter = await getDbAdapter();
  const res = await adapter.query(
    'UPDATE employees SET opening_balance = $1::numeric, opening_balance_posted = true, updated_at = NOW() WHERE id = $2::uuid AND company_id = $3::uuid',
    [amount, opts.id, companyId]
  );
  return res.success ? { success: true } : { success: false, error: res.error };
}

/**
 * Product opening stock: records an 'in' stock movement (reference OPENING),
 * upserts the warehouse stock row, posts Dr Inventory / Cr OBE at cost,
 * then stamps the product row.
 */
export async function postProductStockOpening(
  companyId: string,
  opts: { productId: string; productName: string; quantity: number; warehouseId?: string | null; costPrice: number }
): Promise<EntityOpeningResult> {
  const qty = Math.round(Number(opts.quantity) * 10000) / 10000;
  if (!Number.isFinite(qty) || qty <= 0) return { success: true };
  if (!opts.warehouseId) return { success: false, error: 'يجب اختيار مستودع لمخزون أول المدة' };

  const adapter = await getDbAdapter();
  // 1) movement audit trail
  await adapter.query(
    `INSERT INTO stock_movements (company_id, product_id, warehouse_id, type, quantity, reference, notes)
     VALUES ($1::uuid, $2::uuid, $3::uuid, 'in', $4::numeric, 'OPENING', $5)`,
    [companyId, opts.productId, opts.warehouseId, qty, `مخزون أول المدة - ${opts.productName}`]
  );
  // 2) upsert stock row (no unique constraint exists on these three columns,
  //    so we select first and insert/update explicitly)
  const existing = await adapter.query<{ id: string }>(
    'SELECT id FROM stock WHERE company_id = $1::uuid AND product_id = $2::uuid AND warehouse_id = $3::uuid LIMIT 1',
    [companyId, opts.productId, opts.warehouseId]
  );
  if (existing.success && existing.rows?.[0]?.id) {
    await adapter.query(
      'UPDATE stock SET quantity = quantity + $1::numeric, updated_at = NOW() WHERE id = $2::uuid',
      [qty, existing.rows[0].id]
    );
  } else {
    await adapter.query(
      'INSERT INTO stock (company_id, product_id, warehouse_id, quantity) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::numeric)',
      [companyId, opts.productId, opts.warehouseId, qty]
    );
  }

  // 3) balanced journal entry at cost
  const posted = await postOpeningBalanceEntry(companyId, {
    entityType: 'product_stock',
    entityId: opts.productId,
    label: `${opts.productName} (${qty})`,
    amount: qty,
    costPrice: opts.costPrice,
  });
  if (!posted.success) return posted;

  // 4) stamp product row
  const res = await adapter.query(
    'UPDATE products SET opening_stock_qty = $1::numeric, opening_warehouse_id = $2::uuid, opening_stock_posted = true, updated_at = NOW() WHERE id = $3::uuid AND company_id = $4::uuid',
    [qty, opts.warehouseId, opts.productId, companyId]
  );
  return res.success ? { success: true } : { success: false, error: res.error };
}
