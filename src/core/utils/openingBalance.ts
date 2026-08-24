import { getDbAdapter } from '@/core/database/adapters';
import { runTransaction, buildJournalEntryStatement } from '@/core/database/tx';

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
 * Each flow runs as ONE atomic transaction: the journal entry, the entity
 * stamp and the running-balance update all commit together or not at all.
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

interface EntityOpeningResult {
  success: boolean;
  error?: string;
}

/** Customer: Dr AR / Cr OBE + stamp + bump customers.balance — atomically. */
export async function postCustomerOpening(
  companyId: string,
  opts: { id: string; name: string; amount: number }
): Promise<EntityOpeningResult> {
  const amount = Math.round(Number(opts.amount) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) return { success: true }; // nothing to post

  const ar = await findAccountIdByCode(companyId, AR_CODE);
  const obe = await ensureOpeningBalanceEquityAccount(companyId);
  if (!ar || !obe) return { success: false, error: 'تعذر تجهيز حسابات الرصيد الافتتاحي (المدينون/الأرصدة الافتتاحية)' };

  const result = await runTransaction([
    buildJournalEntryStatement(companyId, {
      reference: 'OPENING',
      description: `رصيد افتتاحي - ${opts.name}`,
      date: new Date().toISOString().split('T')[0],
      totalAmount: amount,
      entries: [
        { accountId: ar, debit: amount, credit: 0, memo: opts.name },
        { accountId: obe, debit: 0, credit: amount, memo: opts.name },
      ],
    }),
    {
      sql: `UPDATE customers SET opening_balance = $1::numeric, opening_balance_posted = true,
              balance = COALESCE(balance,0) + $1::numeric, updated_at = NOW()
            WHERE id = $2::uuid AND company_id = $3::uuid`,
      params: [amount, opts.id, companyId],
    },
  ]);
  return result.success ? { success: true } : { success: false, error: result.error };
}

/** Supplier: Dr OBE / Cr AP + stamp + bump suppliers.balance — atomically. */
export async function postSupplierOpening(
  companyId: string,
  opts: { id: string; name: string; amount: number }
): Promise<EntityOpeningResult> {
  const amount = Math.round(Number(opts.amount) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) return { success: true };

  const ap = await findAccountIdByCode(companyId, AP_CODE);
  const obe = await ensureOpeningBalanceEquityAccount(companyId);
  if (!ap || !obe) return { success: false, error: 'تعذر تجهيز حسابات الرصيد الافتتاحي (الدائنون/الأرصدة الافتتاحية)' };

  const result = await runTransaction([
    buildJournalEntryStatement(companyId, {
      reference: 'OPENING',
      description: `رصيد افتتاحي - ${opts.name}`,
      date: new Date().toISOString().split('T')[0],
      totalAmount: amount,
      entries: [
        { accountId: obe, debit: amount, credit: 0, memo: opts.name },
        { accountId: ap, debit: 0, credit: amount, memo: opts.name },
      ],
    }),
    {
      sql: `UPDATE suppliers SET opening_balance = $1::numeric, opening_balance_posted = true,
              balance = COALESCE(balance,0) + $1::numeric, updated_at = NOW()
            WHERE id = $2::uuid AND company_id = $3::uuid`,
      params: [amount, opts.id, companyId],
    },
  ]);
  return result.success ? { success: true } : { success: false, error: result.error };
}

/** Employee advance: Dr Advances / Cr OBE + stamp — atomically. */
export async function postEmployeeOpening(
  companyId: string,
  opts: { id: string; name: string; amount: number }
): Promise<EntityOpeningResult> {
  const amount = Math.round(Number(opts.amount) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) return { success: true };

  const obe = await ensureOpeningBalanceEquityAccount(companyId);
  if (!obe) return { success: false, error: 'تعذر تجهيز حساب الأرصدة الافتتاحية' };
  const advances = await findAccountIdByCode(companyId, ADVANCES_CODE);

  const statements = [
    buildJournalEntryStatement(companyId, {
      reference: 'OPENING',
      description: `رصيد افتتاحي - ${opts.name}`,
      date: new Date().toISOString().split('T')[0],
      totalAmount: amount,
      entries: [
        { accountId: advances || obe, debit: amount, credit: 0, memo: opts.name },
        { accountId: obe, debit: 0, credit: amount, memo: opts.name },
      ],
    }),
    {
      sql: `UPDATE employees SET opening_balance = $1::numeric, opening_balance_posted = true, updated_at = NOW()
            WHERE id = $2::uuid AND company_id = $3::uuid`,
      params: [amount, opts.id, companyId],
    },
  ];
  const result = await runTransaction(statements);
  return result.success ? { success: true } : { success: false, error: result.error };
}

/**
 * Product opening stock: movement audit trail + stock row upsert +
 * Dr Inventory / Cr OBE at cost + product stamp — all in one transaction.
 */
export async function postProductStockOpening(
  companyId: string,
  opts: { productId: string; productName: string; quantity: number; warehouseId?: string | null; costPrice: number }
): Promise<EntityOpeningResult> {
  const qty = Math.round(Number(opts.quantity) * 10000) / 10000;
  if (!Number.isFinite(qty) || qty <= 0) return { success: true };
  if (!opts.warehouseId) return { success: false, error: 'يجب اختيار مستودع لمخزون أول المدة' };

  const valueAmount = Math.round(Number(opts.costPrice || 0) * qty * 100) / 100;
  if (valueAmount <= 0) return { success: false, error: 'قيمة مخزون أول المدة يجب أن تكون أكبر من صفر (تأكد من سعر التكلفة)' };

  const inv = await findAccountIdByCode(companyId, INVENTORY_CODE);
  const obe = await ensureOpeningBalanceEquityAccount(companyId);
  if (!inv || !obe) return { success: false, error: 'تعذر تجهيز حسابات الرصيد الافتتاحي (المخزون/الأرصدة الافتتاحية)' };

  // Pre-read stock row (read-only) so the batch can use a deterministic UPDATE or INSERT.
  const adapter = await getDbAdapter();
  const existing = await adapter.query<{ id: string }>(
    'SELECT id FROM stock WHERE company_id = $1::uuid AND product_id = $2::uuid AND warehouse_id = $3::uuid LIMIT 1',
    [companyId, opts.productId, opts.warehouseId]
  );
  const stockRowId = existing.success ? existing.rows?.[0]?.id : undefined;

  const statements = [
    // 1) movement audit trail
    {
      sql: `INSERT INTO stock_movements (company_id, product_id, warehouse_id, type, quantity, reference, notes)
            VALUES ($1::uuid, $2::uuid, $3::uuid, 'in', $4::numeric, 'OPENING', $5)`,
      params: [companyId, opts.productId, opts.warehouseId, qty, `مخزون أول المدة - ${opts.productName}`],
    },
    // 2) stock row upsert (deterministic branch chosen outside the tx)
    stockRowId
      ? { sql: 'UPDATE stock SET quantity = quantity + $1::numeric, updated_at = NOW() WHERE id = $2::uuid', params: [qty, stockRowId] }
      : {
          sql: 'INSERT INTO stock (company_id, product_id, warehouse_id, quantity) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::numeric)',
          params: [companyId, opts.productId, opts.warehouseId, qty],
        },
    // 3) balanced journal entry at cost
    buildJournalEntryStatement(companyId, {
      reference: 'OPENING',
      description: `رصيد افتتاحي مخزون - ${opts.productName} (${qty})`,
      date: new Date().toISOString().split('T')[0],
      totalAmount: valueAmount,
      entries: [
        { accountId: inv, debit: valueAmount, credit: 0, memo: `${opts.productName} (${qty})` },
        { accountId: obe, debit: 0, credit: valueAmount, memo: `${opts.productName} (${qty})` },
      ],
    }),
    // 4) stamp the product row
    {
      sql: `UPDATE products SET opening_stock_qty = $1::numeric, opening_warehouse_id = $2::uuid,
              opening_stock_posted = true, updated_at = NOW()
            WHERE id = $3::uuid AND company_id = $4::uuid`,
      params: [qty, opts.warehouseId, opts.productId, companyId],
    },
  ];

  const result = await runTransaction(statements);
  return result.success ? { success: true } : { success: false, error: result.error };
}

/**
 * Account-level opening balance respecting its direction:
 * debit-direction takes Dr <account> / Cr OBE, credit-direction mirrors it.
 * JE + snapshot balance alignment happen in one transaction.
 */
export async function postAccountOpeningBalance(
  companyId: string,
  opts: { accountId: string; accountCode: string; accountName: string; direction: 'debit' | 'credit'; amount: number }
): Promise<EntityOpeningResult> {
  const amount = Math.round(Number(opts.amount) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) {
    return { success: false, error: 'الرصيد الافتتاحي يجب أن يكون رقماً موجباً' };
  }
  const obe = await ensureOpeningBalanceEquityAccount(companyId);
  if (!obe) return { success: false, error: 'تعذر تجهيز حساب الأرصدة الافتتاحية' };

  const memo = `${opts.accountCode} - ${opts.accountName}`;
  const drSide = opts.direction === 'debit';

  const result = await runTransaction([
    buildJournalEntryStatement(companyId, {
      reference: 'OPENING',
      description: `رصيد افتتاحي - ${memo}`,
      date: new Date().toISOString().split('T')[0],
      totalAmount: amount,
      entries: [
        { accountId: opts.accountId, debit: drSide ? amount : 0, credit: drSide ? 0 : amount, memo },
        { accountId: obe, debit: drSide ? 0 : amount, credit: drSide ? amount : 0, memo },
      ],
    }),
    {
      sql: `UPDATE accounts SET balance = COALESCE(balance,0) + $1::numeric,
              opening_amount = $2::numeric, opening_direction = $3, opening_balance_posted = true, updated_at = NOW()
            WHERE company_id = $4::uuid AND id = $5::uuid`,
      params: [drSide ? amount : -amount, amount, opts.direction, companyId, opts.accountId],
    },
  ]);
  return result.success ? { success: true } : { success: false, error: result.error };
}
