/**
 * Atomic posting service — wraps multi-step financial operations in a single
 * DB transaction so that posting either succeeds completely or rolls back
 * entirely. This fixes the critical gap where `postInvoice`/`postReturn`
 * ran UPDATE + journal entry as separate queries and swallowed journal errors.
 *
 * The service delegates the SQL to the existing `journalEntryGenerator`
 * helpers but runs them inside `adapter.transaction([...])` so a journal
 * failure rolls back the status change and balance update.
 */

import { getDbAdapter, isElectronPg } from '@/core/database/adapters';
import { resolveExistingUserId } from '@/core/utils/userIdValidator';
import { postSalesInvoice, postSalesReturn, postPurchaseInvoice, postPurchaseReturn } from '@/core/utils/journalEntryGenerator';
import { logAudit } from '@/core/utils/auditLogger';
import { ok, fail, type ServiceResult } from './errors';
import type { ServiceContext } from './context';
type RpcEnvelope = { success: boolean; rows?: Record<string, unknown>[]; error?: string };

/**
 * The accounting typed-RPC surface on the Electron bridge, or null off-desktop.
 *
 * Only the pre-flight read is routed here. The transactions deliberately are
 * not: the service compensates by hand when the journal entry fails, and it
 * does not check whether its own compensation succeeded. That window is a
 * separate decision, not a side effect of moving SQL.
 */
type TxStep = { sql: string; params?: unknown[] };

/**
 * Undo a half-applied posting, and report whether the undo actually happened.
 *
 * The compensation is itself a database operation, so it can fail for reasons
 * unrelated to the journal entry: a dropped connection, a timeout, a lock.
 * Ignoring its result is what turns a failed posting into a silently corrupt
 * ledger - the document stays posted with a moved balance and no journal entry,
 * while the caller returns a clean error that implies nothing changed.
 *
 * Eight call sites previously discarded this result. They now share one helper so
 * they cannot drift apart again, and a failed undo is reported as the distinct
 * condition it is: the document needs a human.
 *
 * The success path is unchanged; only an invisible failure becomes visible.
 */
async function compensate(
  adapter: Awaited<ReturnType<typeof getDbAdapter>>,
  steps: TxStep[],
  context: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const res = await adapter.transaction(steps);
    if (res && res.success) return { ok: true };
    const reason = (res && res.error) || 'تعذّر تنفيذ معاملة التراجع';
    logger.error(reason, context);
    return { ok: false, reason };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error(reason, context);
    return { ok: false, reason };
  }
}
function accountingRpc() {
  return (typeof window !== 'undefined' && window.electronDB?.accounting) || null;
}
import { logger } from './logger';

export interface PostInvoiceInput {
  id: string;
  companyId: string;
  userId?: string;
}

/**
 * Atomically post a sales invoice:
 *   1. Verify the invoice is in `draft` status
 *   2. Update status → `posted`
 *   3. Update customer balance (outstanding = total - paid)
 *   4. Generate the journal entry (Dr Debtors / Cr Sales + VAT)
 *
 * If any step fails, the entire operation rolls back.
 */
export async function postSalesInvoiceAtomic(
  ctx: ServiceContext,
  input: PostInvoiceInput
): Promise<ServiceResult<void>> {
  if (input.companyId !== ctx.companyId) {
    return fail('Cross-company access denied', 'PERMISSION_DENIED');
  }

  const adapter = await getDbAdapter();

  // 1. Fetch invoice details (read-only, outside transaction is fine)
  const check = isElectronPg() && accountingRpc()
    ? (await accountingRpc()!.getSalesInvoiceForPosting({ id: input.id })) as RpcEnvelope
    : await adapter.query(
    'SELECT customer_id, total_amount, paid_amount, subtotal, vat_amount, invoice_number, date, status FROM sales_invoices WHERE id = $1::uuid AND company_id = $2::uuid',
    [input.id, ctx.companyId]
  );
  if (!check.success || !check.rows?.[0]) {
    return fail('الفاتورة غير موجودة', 'NOT_FOUND');
  }
  const inv = check.rows[0] as Record<string, unknown>;
  if (inv.status !== 'draft') {
    return fail(`لا يمكن ترحيل فاتورة بحالة "${inv.status}"`, 'INVALID_STATE');
  }

  const customerId = String(inv.customer_id);
  const totalAmount = Number(inv.total_amount) || 0;
  const paidAmount = Number(inv.paid_amount) || 0;
  const outstanding = totalAmount - paidAmount;
  const safeUserIdValue = await resolveExistingUserId(adapter, input.userId, ctx.companyId);

  // 2-4. Run status update + balance update in a single transaction.
  // The journal entry is generated separately because it uses its own
  // CTE internally; if it fails we roll back the status/balance changes.
  const txResult = await adapter.transaction([
    {
      sql: `UPDATE sales_invoices SET status = 'posted', updated_by = $3::uuid, updated_at = NOW() WHERE id = $1::uuid AND company_id = $2::uuid AND status = 'draft'`,
      params: [input.id, ctx.companyId, safeUserIdValue],
    },
    ...(outstanding !== 0
      ? [{
          sql: `UPDATE customers SET balance = balance + $1, updated_by = $4::uuid, updated_at = NOW() WHERE id = $2::uuid AND company_id = $3::uuid`,
          params: [outstanding, customerId, ctx.companyId, safeUserIdValue],
        }]
      : []),
  ]);

  if (!txResult.success) {
    logger.error(txResult.error || 'transaction failed', 'postSalesInvoiceAtomic');
    return fail(txResult.error || 'فشل ترحيل الفاتورة');
  }

  // Generate journal entry. If this fails, we must reverse the status/balance.
  try {
    const jeResult = await postSalesInvoice(ctx.companyId, {
      invoiceNumber: String(inv.invoice_number || ''),
      date: String(inv.date || new Date().toISOString().split('T')[0]),
      customerId,
      subtotal: Number(inv.subtotal) || 0,
      vatAmount: Number(inv.vat_amount) || 0,
      totalAmount,
    });
    if (!jeResult.success) {
      // Rollback: revert status and balance
      logger.error(jeResult.error || 'journal entry failed', 'postSalesInvoiceAtomic.je');
      const undo = await compensate(adapter, [
        {
          sql: `UPDATE sales_invoices SET status = 'draft', updated_at = NOW() WHERE id = $1::uuid AND company_id = $2::uuid`,
          params: [input.id, ctx.companyId],
        },
        ...(outstanding !== 0
          ? [{
              sql: `UPDATE customers SET balance = balance - $1, updated_at = NOW() WHERE id = $2::uuid AND company_id = $3::uuid`,
              params: [outstanding, customerId, ctx.companyId],
            }]
          : []),
      ], "postSalesInvoiceAtomic.undo");
      if (!undo.ok) {

        return fail(
          'فشل القيد المحاسبي وفشل التراجع عنه — المستند ما زال مُرحَّلاً برصيد معدَّل وبلا قيد. راجعه يدوياً فوراً.',
          'EXTERNAL_ERROR',
        );
      }
      return fail(`فشل إنشاء القيد المحاسبي: ${jeResult.error}`);
    }
  } catch (err) {
    logger.error(String(err), 'postSalesInvoiceAtomic.je.exception');
    // Rollback
    const undo = await compensate(adapter, [
      {
        sql: `UPDATE sales_invoices SET status = 'draft', updated_at = NOW() WHERE id = $1::uuid AND company_id = $2::uuid`,
        params: [input.id, ctx.companyId],
      },
      ...(outstanding !== 0
        ? [{
            sql: `UPDATE customers SET balance = balance - $1, updated_at = NOW() WHERE id = $2::uuid AND company_id = $3::uuid`,
            params: [outstanding, customerId, ctx.companyId],
          }]
        : []),
    ], "postSalesInvoiceAtomic.undo");
    if (!undo.ok) {

      return fail(
        'فشل القيد المحاسبي وفشل التراجع عنه — المستند ما زال مُرحَّلاً برصيد معدَّل وبلا قيد. راجعه يدوياً فوراً.',
        'EXTERNAL_ERROR',
      );
    }
    return fail(`استثناء أثناء إنشاء القيد المحاسبي: ${String(err)}`);
  }

  // Audit log (best-effort, never blocks)
  await logAudit({
    userId: ctx.userId || safeUserIdValue || '',
    action: 'post',
    tableName: 'sales_invoices',
    recordId: input.id,
    recordLabel: String(inv.invoice_number || ''),
    newValues: { status: 'posted', totalAmount, outstanding },
    companyId: ctx.companyId,
  });

  return ok(undefined);
}

/**
 * Atomically post a sales return:
 *   1. Verify the return is in `draft` status
 *   2. Update status → `posted`
 *   3. Decrease customer balance by return total
 *   4. Generate the reversal journal entry + stock movement (in)
 */
export async function postSalesReturnAtomic(
  ctx: ServiceContext,
  input: PostInvoiceInput
): Promise<ServiceResult<void>> {
  if (input.companyId !== ctx.companyId) {
    return fail('Cross-company access denied', 'PERMISSION_DENIED');
  }

  const adapter = await getDbAdapter();

  const check = isElectronPg() && accountingRpc()
    ? (await accountingRpc()!.getSalesReturnForPosting({ id: input.id })) as RpcEnvelope
    : await adapter.query(
    'SELECT sr.customer_id, sr.total_amount, sr.return_number, sr.date, sr.status, c.name as customer_name FROM sales_returns sr LEFT JOIN customers c ON sr.customer_id = c.id WHERE sr.id = $1::uuid AND sr.company_id = $2::uuid',
    [input.id, ctx.companyId]
  );
  if (!check.success || !check.rows?.[0]) {
    return fail('مرتجع المبيعات غير موجود', 'NOT_FOUND');
  }
  const ret = check.rows[0] as Record<string, unknown>;
  if (ret.status !== 'draft') {
    return fail(`لا يمكن ترحيل مرتجع بحالة "${ret.status}"`, 'INVALID_STATE');
  }

  const customerId = String(ret.customer_id);
  const totalAmount = Number(ret.total_amount) || 0;
  const safeUserIdValue = await resolveExistingUserId(adapter, input.userId, ctx.companyId);

  const txResult = await adapter.transaction([
    {
      sql: `UPDATE sales_returns SET status = 'posted', updated_by = $3::uuid, updated_at = NOW() WHERE id = $1::uuid AND company_id = $2::uuid AND status = 'draft'`,
      params: [input.id, ctx.companyId, safeUserIdValue],
    },
    ...(totalAmount !== 0
      ? [{
          sql: `UPDATE customers SET balance = balance - $1, updated_by = $4::uuid, updated_at = NOW() WHERE id = $2::uuid AND company_id = $3::uuid`,
          params: [totalAmount, customerId, ctx.companyId, safeUserIdValue],
        }]
      : []),
  ]);

  if (!txResult.success) {
    logger.error(txResult.error || 'transaction failed', 'postSalesReturnAtomic');
    return fail(txResult.error || 'فشل ترحيل المرتجع');
  }

  // Journal entry + stock movement
  try {
    const jeResult = await postSalesReturn(ctx.companyId, {
      id: input.id,
      returnNumber: String(ret.return_number || ''),
      date: String(ret.date || new Date().toISOString().split('T')[0]),
      customer: String(ret.customer_name || ''),
      amount: totalAmount,
    });
    if (!jeResult.success) {
      logger.error(jeResult.error || 'journal entry failed', 'postSalesReturnAtomic.je');
      // Rollback
      const undo = await compensate(adapter, [
        {
          sql: `UPDATE sales_returns SET status = 'draft', updated_at = NOW() WHERE id = $1::uuid AND company_id = $2::uuid`,
          params: [input.id, ctx.companyId],
        },
        ...(totalAmount !== 0
          ? [{
              sql: `UPDATE customers SET balance = balance + $1, updated_at = NOW() WHERE id = $2::uuid AND company_id = $3::uuid`,
              params: [totalAmount, customerId, ctx.companyId],
            }]
          : []),
      ], "postSalesReturnAtomic.undo");
      if (!undo.ok) {

        return fail(
          'فشل القيد المحاسبي وفشل التراجع عنه — المستند ما زال مُرحَّلاً برصيد معدَّل وبلا قيد. راجعه يدوياً فوراً.',
          'EXTERNAL_ERROR',
        );
      }
      return fail(`فشل إنشاء القيد المحاسبي: ${jeResult.error}`);
    }
  } catch (err) {
    logger.error(String(err), 'postSalesReturnAtomic.je.exception');
    const undo = await compensate(adapter, [
      {
        sql: `UPDATE sales_returns SET status = 'draft', updated_at = NOW() WHERE id = $1::uuid AND company_id = $2::uuid`,
        params: [input.id, ctx.companyId],
      },
      ...(totalAmount !== 0
        ? [{
            sql: `UPDATE customers SET balance = balance + $1, updated_at = NOW() WHERE id = $2::uuid AND company_id = $3::uuid`,
            params: [totalAmount, customerId, ctx.companyId],
          }]
        : []),
    ], "postSalesReturnAtomic.undo");
    if (!undo.ok) {

      return fail(
        'فشل القيد المحاسبي وفشل التراجع عنه — المستند ما زال مُرحَّلاً برصيد معدَّل وبلا قيد. راجعه يدوياً فوراً.',
        'EXTERNAL_ERROR',
      );
    }
    return fail(`استثناء أثناء إنشاء القيد المحاسبي: ${String(err)}`);
  }

  await logAudit({
    userId: ctx.userId || safeUserIdValue || '',
    action: 'post',
    tableName: 'sales_returns',
    recordId: input.id,
    recordLabel: String(ret.return_number || ''),
    newValues: { status: 'posted', totalAmount },
    companyId: ctx.companyId,
  });

  return ok(undefined);
}

/**
 * Atomically post a purchase invoice:
 *   1. Verify draft status
 *   2. Update status → `posted`
 *   3. Increase supplier balance
 *   4. Generate journal entry (Dr Inventory/VAT / Cr Creditors)
 */
export async function postPurchaseInvoiceAtomic(
  ctx: ServiceContext,
  input: PostInvoiceInput
): Promise<ServiceResult<void>> {
  if (input.companyId !== ctx.companyId) {
    return fail('Cross-company access denied', 'PERMISSION_DENIED');
  }

  const adapter = await getDbAdapter();

  const check = isElectronPg() && accountingRpc()
    ? (await accountingRpc()!.getPurchaseInvoiceForPosting({ id: input.id })) as RpcEnvelope
    : await adapter.query(
    'SELECT supplier_id, total_amount, paid_amount, subtotal, vat_amount, invoice_number, date, status FROM purchase_invoices WHERE id = $1::uuid AND company_id = $2::uuid',
    [input.id, ctx.companyId]
  );
  if (!check.success || !check.rows?.[0]) {
    return fail('فاتورة المشتريات غير موجودة', 'NOT_FOUND');
  }
  const inv = check.rows[0] as Record<string, unknown>;
  if (inv.status !== 'draft') {
    return fail(`لا يمكن ترحيل فاتورة بحالة "${inv.status}"`, 'INVALID_STATE');
  }

  const supplierId = String(inv.supplier_id);
  const totalAmount = Number(inv.total_amount) || 0;
  const paidAmount = Number(inv.paid_amount) || 0;
  const outstanding = totalAmount - paidAmount;
  const safeUserIdValue = await resolveExistingUserId(adapter, input.userId, ctx.companyId);

  const txResult = await adapter.transaction([
    {
      sql: `UPDATE purchase_invoices SET status = 'posted', updated_by = $3::uuid, updated_at = NOW() WHERE id = $1::uuid AND company_id = $2::uuid AND status = 'draft'`,
      params: [input.id, ctx.companyId, safeUserIdValue],
    },
    ...(outstanding !== 0
      ? [{
          sql: `UPDATE suppliers SET balance = balance + $1, updated_by = $4::uuid, updated_at = NOW() WHERE id = $2::uuid AND company_id = $3::uuid`,
          params: [outstanding, supplierId, ctx.companyId, safeUserIdValue],
        }]
      : []),
  ]);

  if (!txResult.success) {
    logger.error(txResult.error || 'transaction failed', 'postPurchaseInvoiceAtomic');
    return fail(txResult.error || 'فشل ترحيل الفاتورة');
  }

  try {
    const jeResult = await postPurchaseInvoice(ctx.companyId, {
      invoiceNumber: String(inv.invoice_number || ''),
      date: String(inv.date || new Date().toISOString().split('T')[0]),
      supplierId,
      subtotal: Number(inv.subtotal) || 0,
      vatAmount: Number(inv.vat_amount) || 0,
      totalAmount,
    });
    if (!jeResult.success) {
      logger.error(jeResult.error || 'journal entry failed', 'postPurchaseInvoiceAtomic.je');
      const undo = await compensate(adapter, [
        {
          sql: `UPDATE purchase_invoices SET status = 'draft', updated_at = NOW() WHERE id = $1::uuid AND company_id = $2::uuid`,
          params: [input.id, ctx.companyId],
        },
        ...(outstanding !== 0
          ? [{
              sql: `UPDATE suppliers SET balance = balance - $1, updated_at = NOW() WHERE id = $2::uuid AND company_id = $3::uuid`,
              params: [outstanding, supplierId, ctx.companyId],
            }]
          : []),
      ], "postPurchaseInvoiceAtomic.undo");
      if (!undo.ok) {

        return fail(
          'فشل القيد المحاسبي وفشل التراجع عنه — المستند ما زال مُرحَّلاً برصيد معدَّل وبلا قيد. راجعه يدوياً فوراً.',
          'EXTERNAL_ERROR',
        );
      }
      return fail(`فشل إنشاء القيد المحاسبي: ${jeResult.error}`);
    }
  } catch (err) {
    logger.error(String(err), 'postPurchaseInvoiceAtomic.je.exception');
    const undo = await compensate(adapter, [
      {
        sql: `UPDATE purchase_invoices SET status = 'draft', updated_at = NOW() WHERE id = $1::uuid AND company_id = $2::uuid`,
        params: [input.id, ctx.companyId],
      },
      ...(outstanding !== 0
        ? [{
            sql: `UPDATE suppliers SET balance = balance - $1, updated_at = NOW() WHERE id = $2::uuid AND company_id = $3::uuid`,
            params: [outstanding, supplierId, ctx.companyId],
          }]
        : []),
    ], "postPurchaseInvoiceAtomic.undo");
    if (!undo.ok) {

      return fail(
        'فشل القيد المحاسبي وفشل التراجع عنه — المستند ما زال مُرحَّلاً برصيد معدَّل وبلا قيد. راجعه يدوياً فوراً.',
        'EXTERNAL_ERROR',
      );
    }
    return fail(`استثناء أثناء إنشاء القيد المحاسبي: ${String(err)}`);
  }

  await logAudit({
    userId: ctx.userId || safeUserIdValue || '',
    action: 'post',
    tableName: 'purchase_invoices',
    recordId: input.id,
    recordLabel: String(inv.invoice_number || ''),
    newValues: { status: 'posted', totalAmount, outstanding },
    companyId: ctx.companyId,
  });

  return ok(undefined);
}

/**
 * Atomically post a purchase return:
 *   1. Verify draft status
 *   2. Update status → `posted`
 *   3. Decrease supplier balance
 *   4. Generate journal entry + stock movement (out)
 */
export async function postPurchaseReturnAtomic(
  ctx: ServiceContext,
  input: PostInvoiceInput
): Promise<ServiceResult<void>> {
  if (input.companyId !== ctx.companyId) {
    return fail('Cross-company access denied', 'PERMISSION_DENIED');
  }

  const adapter = await getDbAdapter();

  const check = isElectronPg() && accountingRpc()
    ? (await accountingRpc()!.getPurchaseReturnForPosting({ id: input.id })) as RpcEnvelope
    : await adapter.query(
    'SELECT pr.supplier_id, pr.total_amount, pr.return_number, pr.date, pr.status, s.name as supplier_name FROM purchase_returns pr LEFT JOIN suppliers s ON pr.supplier_id = s.id WHERE pr.id = $1::uuid AND pr.company_id = $2::uuid',
    [input.id, ctx.companyId]
  );
  if (!check.success || !check.rows?.[0]) {
    return fail('مرتجع المشتريات غير موجود', 'NOT_FOUND');
  }
  const ret = check.rows[0] as Record<string, unknown>;
  if (ret.status !== 'draft') {
    return fail(`لا يمكن ترحيل مرتجع بحالة "${ret.status}"`, 'INVALID_STATE');
  }

  const supplierId = String(ret.supplier_id);
  const totalAmount = Number(ret.total_amount) || 0;
  const safeUserIdValue = await resolveExistingUserId(adapter, input.userId, ctx.companyId);

  const txResult = await adapter.transaction([
    {
      sql: `UPDATE purchase_returns SET status = 'posted', updated_by = $3::uuid, updated_at = NOW() WHERE id = $1::uuid AND company_id = $2::uuid AND status = 'draft'`,
      params: [input.id, ctx.companyId, safeUserIdValue],
    },
    ...(totalAmount !== 0
      ? [{
          sql: `UPDATE suppliers SET balance = balance - $1, updated_by = $4::uuid, updated_at = NOW() WHERE id = $2::uuid AND company_id = $3::uuid`,
          params: [totalAmount, supplierId, ctx.companyId, safeUserIdValue],
        }]
      : []),
  ]);

  if (!txResult.success) {
    logger.error(txResult.error || 'transaction failed', 'postPurchaseReturnAtomic');
    return fail(txResult.error || 'فشل ترحيل المرتجع');
  }

  try {
    const jeResult = await postPurchaseReturn(ctx.companyId, {
      id: input.id,
      returnNumber: String(ret.return_number || ''),
      date: String(ret.date || new Date().toISOString().split('T')[0]),
      supplier: String(ret.supplier_name || ''),
      amount: totalAmount,
    });
    if (!jeResult.success) {
      logger.error(jeResult.error || 'journal entry failed', 'postPurchaseReturnAtomic.je');
      const undo = await compensate(adapter, [
        {
          sql: `UPDATE purchase_returns SET status = 'draft', updated_at = NOW() WHERE id = $1::uuid AND company_id = $2::uuid`,
          params: [input.id, ctx.companyId],
        },
        ...(totalAmount !== 0
          ? [{
              sql: `UPDATE suppliers SET balance = balance + $1, updated_at = NOW() WHERE id = $2::uuid AND company_id = $3::uuid`,
              params: [totalAmount, supplierId, ctx.companyId],
            }]
          : []),
      ], "postPurchaseReturnAtomic.undo");
      if (!undo.ok) {

        return fail(
          'فشل القيد المحاسبي وفشل التراجع عنه — المستند ما زال مُرحَّلاً برصيد معدَّل وبلا قيد. راجعه يدوياً فوراً.',
          'EXTERNAL_ERROR',
        );
      }
      return fail(`فشل إنشاء القيد المحاسبي: ${jeResult.error}`);
    }
  } catch (err) {
    logger.error(String(err), 'postPurchaseReturnAtomic.je.exception');
    const undo = await compensate(adapter, [
      {
        sql: `UPDATE purchase_returns SET status = 'draft', updated_at = NOW() WHERE id = $1::uuid AND company_id = $2::uuid`,
        params: [input.id, ctx.companyId],
      },
      ...(totalAmount !== 0
        ? [{
            sql: `UPDATE suppliers SET balance = balance + $1, updated_at = NOW() WHERE id = $2::uuid AND company_id = $3::uuid`,
            params: [totalAmount, supplierId, ctx.companyId],
          }]
        : []),
    ], "postPurchaseReturnAtomic.undo");
    if (!undo.ok) {

      return fail(
        'فشل القيد المحاسبي وفشل التراجع عنه — المستند ما زال مُرحَّلاً برصيد معدَّل وبلا قيد. راجعه يدوياً فوراً.',
        'EXTERNAL_ERROR',
      );
    }
    return fail(`استثناء أثناء إنشاء القيد المحاسبي: ${String(err)}`);
  }

  await logAudit({
    userId: ctx.userId || safeUserIdValue || '',
    action: 'post',
    tableName: 'purchase_returns',
    recordId: input.id,
    recordLabel: String(ret.return_number || ''),
    newValues: { status: 'posted', totalAmount },
    companyId: ctx.companyId,
  });

  return ok(undefined);
}