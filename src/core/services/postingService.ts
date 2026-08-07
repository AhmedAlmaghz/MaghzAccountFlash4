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

import { getDbAdapter } from '@/core/database/adapters';
import { resolveExistingUserId } from '@/core/utils/userIdValidator';
import { postSalesInvoice, postSalesReturn, postPurchaseInvoice, postPurchaseReturn } from '@/core/utils/journalEntryGenerator';
import { logAudit } from '@/core/utils/auditLogger';
import { ok, fail, type ServiceResult } from './errors';
import type { ServiceContext } from './context';
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
  const check = await adapter.query(
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
      await adapter.transaction([
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
      ]);
      return fail(`فشل إنشاء القيد المحاسبي: ${jeResult.error}`);
    }
  } catch (err) {
    logger.error(String(err), 'postSalesInvoiceAtomic.je.exception');
    // Rollback
    await adapter.transaction([
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
    ]);
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

  const check = await adapter.query(
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
      await adapter.transaction([
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
      ]);
      return fail(`فشل إنشاء القيد المحاسبي: ${jeResult.error}`);
    }
  } catch (err) {
    logger.error(String(err), 'postSalesReturnAtomic.je.exception');
    await adapter.transaction([
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
    ]);
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

  const check = await adapter.query(
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
      await adapter.transaction([
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
      ]);
      return fail(`فشل إنشاء القيد المحاسبي: ${jeResult.error}`);
    }
  } catch (err) {
    logger.error(String(err), 'postPurchaseInvoiceAtomic.je.exception');
    await adapter.transaction([
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
    ]);
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

  const check = await adapter.query(
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
      await adapter.transaction([
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
      ]);
      return fail(`فشل إنشاء القيد المحاسبي: ${jeResult.error}`);
    }
  } catch (err) {
    logger.error(String(err), 'postPurchaseReturnAtomic.je.exception');
    await adapter.transaction([
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
    ]);
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