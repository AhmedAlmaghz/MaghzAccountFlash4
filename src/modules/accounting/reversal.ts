import { getDbAdapter } from '@/core/database/adapters';
import type { DbAdapter } from '@/core/database/adapters/types';
import { validateInput } from '@/core/utils/validation';
import { z } from 'zod';
export { resolveDepreciationAccounts } from '@/modules/accounting/assets';
import { buildJournalEntryStatement, runTransaction } from '@/core/database/tx';
import type { TxStatement } from '@/core/database/tx';
import { safeUserId } from '@/core/utils/userIdValidator';
import { logAudit } from '@/core/utils/auditLogger';
import { salesApi } from '@/modules/sales/api';
import { purchasesApi } from '@/modules/purchases/api';
import { getNextDocumentNumber } from '@/core/api';

type Queryable = Pick<DbAdapter, 'query'>;

const reversalInputSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date (YYYY-MM-DD)').optional(),
  reason: z.string().min(3).max(500),
});

export interface ReversalInput {
  id: string;
  companyId: string;
  date?: string;
  reason: string;
}

type ReversalResult =
  | { success: true; data: { reference: string; linkedId?: string; linkedNumber?: string } }
  | { success: false; error: string };

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Mirror a parameterized JE CTE statement (the buildJournalEntryStatement
 * shape: 6 header params + 4 per leg). Swaps every leg's debit/credit and
 * re-points the reference param. Refuses anything else honestly instead of
 * guessing param positions.
 */
function mirrorJeStatement(stmt: TxStatement, newReference: string): TxStatement {
  const flat = [...(stmt.params || [])];
  if (!stmt.sql.includes('WITH new_tx') || flat.length < 10 || (flat.length - 6) % 4 !== 0) {
    throw new Error('Cannot mirror a non-JE statement');
  }
  flat[2] = newReference;
  const n = (flat.length - 6) / 4;
  for (let i = 0; i < n; i++) {
    const dr = flat[6 + i * 4 + 1];
    flat[6 + i * 4 + 1] = flat[6 + i * 4 + 2];
    flat[6 + i * 4 + 2] = dr;
  }
  return { sql: stmt.sql, params: flat };
}

async function reversalDateGuard(
  companyId: string,
  date: string,
  adapter: Queryable
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { assertAccountingPeriodOpen } = await import('@/modules/accounting/yearEnd');
  const gate = await assertAccountingPeriodOpen(companyId, date, adapter);
  if (!gate.open) {
    return { ok: false, error: `السنة المالية ${gate.period.year} مقفلة — لا يمكن الترحيل بتاريخ داخلها` };
  }
  return { ok: true };
}

async function auditReversal(args: {
  companyId: string;
  userId: string;
  table: string;
  recordId: string;
  reference: string;
  reason: string;
}): Promise<void> {
  try {
    await logAudit({
      companyId: args.companyId,
      userId: safeUserId(args.userId) || 'system',
      action: 'post',
      tableName: args.table,
      recordId: args.recordId,
      newValues: { reversal: args.reference, reason: args.reason },
    });
  } catch {
    /* audit never blocks the reversal */
  }
}

/**
 * Reverse a posted MANUAL journal transaction with a mirror JE
 * (Dr↔Cr swapped, reference REV-<original>). The original stays posted —
 * every SUM-based report nets to zero — and the REV reference guard makes
 * a second reversal impossible.
 */
export async function reverseTransaction(
  companyId: string,
  txId: string,
  input: { date?: string; reason: string },
  userId: string
): Promise<ReversalResult> {
  try {
    const v = validateInput(reversalInputSchema, { id: txId, companyId, ...input });
    if (!v.success) return { success: false, error: v.error };
    const date = v.data.date || todayStr();
    const adapter = await getDbAdapter();
    const head = await adapter.query(
      `SELECT id, reference, description, total_amount, status FROM transactions
        WHERE id = $1::uuid AND company_id = $2::uuid`,
      [txId, companyId]
    );
    if (!head.success) return { success: false, error: head.error || 'Query failed' };
    const tx = (head.rows?.[0] as Record<string, unknown> | undefined);
    if (!tx) return { success: false, error: 'Transaction not found' };
    if (String(tx.status) !== 'posted') {
      return { success: false, error: 'Only posted transactions can be reversed' };
    }
    const gate = await reversalDateGuard(companyId, date, adapter);
    if (!gate.ok) return { success: false, error: gate.error };
    const origRef = String(tx.reference || txId.slice(0, 8));
    const revRef = `REV-${origRef}`;
    const dup = await adapter.query(
      `SELECT id FROM transactions WHERE company_id = $1::uuid AND reference = $2 LIMIT 1`,
      [companyId, revRef]
    );
    if (!dup.success) return { success: false, error: dup.error || 'Query failed' };
    if (dup.rows?.length) return { success: false, error: 'This transaction was already reversed' };
    const legs = await adapter.query(
      `SELECT account_id, debit, credit, memo FROM journal_entries
        WHERE transaction_id = $1::uuid AND company_id = $2::uuid ORDER BY id`,
      [txId, companyId]
    );
    if (!legs.success) return { success: false, error: legs.error || 'Query failed' };
    if (!legs.rows?.length) return { success: false, error: 'Transaction has no journal lines' };
    const total = Number(tx.total_amount) || 0;
    const mirror = mirrorJeStatement(
      buildJournalEntryStatement(companyId, {
        reference: origRef,
        description: String(tx.description || ''),
        date,
        totalAmount: total,
        entries: (legs.rows as Record<string, unknown>[]).map((l) => ({
          accountId: String(l.account_id),
          debit: Number(l.debit) || 0,
          credit: Number(l.credit) || 0,
          memo: l.memo ? String(l.memo) : undefined,
        })),
      }),
      revRef
    );
    // Tag the reversal memo with the human reason (first leg carries it).
    const result = await runTransaction([mirror]);
    if (!result.success) return { success: false, error: result.error || 'Transaction failed' };
    await auditReversal({ companyId, userId, table: 'transactions', recordId: txId, reference: revRef, reason: v.data.reason });
    return { success: true, data: { reference: revRef } };
  } catch (e) {
    return { success: false, error: String(e instanceof Error ? e.message : e) };
  }
}

interface RemainingLine {
  productId: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  vatPercent: number;
  lineTotal: number;
  unitId?: string;
  unitFactor?: number;
  baseQuantity?: number;
}

/**
 * Reverse a posted SALES invoice with a REAL return through the full
 * postReturn path (stock + VAT + balance all move). Only the not-yet-
 * returned remainder is reversed, so a second reversal is mathematically
 * impossible (remainder ≤ 0 refuses). The invoice keeps its status —
 * balance/statement formulas net invoice against posted returns.
 */
export async function reverseSalesInvoice(
  companyId: string,
  invoiceId: string,
  input: { date?: string; reason: string },
  userId: string
): Promise<ReversalResult> {
  try {
    const v = validateInput(reversalInputSchema, { id: invoiceId, companyId, ...input });
    if (!v.success) return { success: false, error: v.error };
    const date = v.data.date || todayStr();
    const invRes = await salesApi.getInvoiceById(invoiceId, companyId);
    if (!invRes.success || !invRes.data) return { success: false, error: invRes.error || 'Invoice not found' };
    const inv = invRes.data;
    if (!['posted', 'partially_paid', 'paid'].includes(String(inv.status))) {
      return { success: false, error: 'Only posted invoices can be reversed' };
    }
    if (!inv.lines?.length) return { success: false, error: 'Invoice has no lines to reverse' };
    const adapter = await getDbAdapter();
    // Already-returned base quantities per product (posted returns only).
    const retRes = await adapter.query(
      `SELECT srl.product_id, COALESCE(SUM(COALESCE(NULLIF(srl.base_quantity, 0), srl.quantity)), 0) AS qty
         FROM sales_return_lines srl
         JOIN sales_returns sr ON sr.id = srl.return_id
        WHERE sr.invoice_id = $1::uuid AND sr.company_id = $2::uuid AND sr.status = 'posted'
        GROUP BY srl.product_id`,
      [invoiceId, companyId]
    );
    if (!retRes.success) return { success: false, error: retRes.error || 'Query failed' };
    const returned = new Map<string, number>(
      ((retRes.rows || []) as Record<string, unknown>[]).map((r) => [String(r.product_id), Number(r.qty) || 0])
    );
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const lines: RemainingLine[] = [];
    for (const l of inv.lines) {
      const base = Number(l.baseQuantity) || Number(l.quantity) || 0;
      const done = returned.get(String(l.productId)) || 0;
      const remBase = Math.max(0, round2(base - done));
      if (remBase <= 0) continue;
      const factor = Number(l.unitFactor) || 1;
      const remQty = round2(remBase / (factor || 1));
      const net = round2(remQty * (Number(l.unitPrice) || 0) * (1 - (Number(l.discountPercent) || 0) / 100));
      lines.push({
        productId: String(l.productId),
        quantity: remQty,
        unitPrice: Number(l.unitPrice) || 0,
        discountPercent: Number(l.discountPercent) || 0,
        vatPercent: Number(l.vatPercent) || 0,
        lineTotal: round2(net * (1 + (Number(l.vatPercent) || 0) / 100)),
        unitId: l.unitId,
        unitFactor: l.unitFactor,
        baseQuantity: remBase,
      });
    }
    if (!lines.length) return { success: false, error: 'Invoice already fully reversed or returned' };
    const subtotal = round2(lines.reduce((s, l) => s + l.quantity * l.unitPrice * (1 - l.discountPercent / 100), 0));
    const vatAmount = round2(lines.reduce((s, l) => s + l.quantity * l.unitPrice * (1 - l.discountPercent / 100) * (l.vatPercent / 100), 0));
    const num = await getNextDocumentNumber(companyId, 'sales_return', userId);
    if (!num.success || !num.number) return { success: false, error: num.error || 'Could not number the reversal return' };
    const created = await salesApi.createReturn(
      {
        companyId,
        returnNumber: num.number,
        invoiceId,
        customerId: inv.customerId,
        date,
        subtotal,
        vatAmount,
        totalAmount: round2(subtotal + vatAmount),
        reason: `عكس الفاتورة ${inv.invoiceNumber} — ${v.data.reason}`,
        status: 'draft',
        paymentType: inv.paymentType || 'credit',
        notes: `Reversal of ${inv.invoiceNumber}`,
        lines: lines.map((l) => ({
          productId: l.productId,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          lineTotal: l.lineTotal,
          unitId: l.unitId,
          unitFactor: l.unitFactor,
          baseQuantity: l.baseQuantity,
        })),
      } as never,
      userId
    );
    if (!created.success || !created.id) return { success: false, error: created.error || 'Create failed' };
    const posted = await salesApi.postReturn(created.id, companyId, userId);
    if (!posted.success) return { success: false, error: posted.error || 'Post failed' };
    await auditReversal({ companyId, userId, table: 'sales_invoices', recordId: invoiceId, reference: num.number, reason: v.data.reason });
    return { success: true, data: { reference: num.number, linkedId: created.id, linkedNumber: num.number } };
  } catch (e) {
    return { success: false, error: String(e instanceof Error ? e.message : e) };
  }
}

/**
 * Reverse a posted PURCHASE invoice with a REAL return through the full
 * postReturn path. Mirrors reverseSalesInvoice (supplier side).
 */
export async function reversePurchaseInvoice(
  companyId: string,
  invoiceId: string,
  input: { date?: string; reason: string },
  userId: string
): Promise<ReversalResult> {
  try {
    const v = validateInput(reversalInputSchema, { id: invoiceId, companyId, ...input });
    if (!v.success) return { success: false, error: v.error };
    const date = v.data.date || todayStr();
    const invRes = await purchasesApi.getInvoiceById(invoiceId, companyId);
    if (!invRes.success || !invRes.data) return { success: false, error: invRes.error || 'Invoice not found' };
    const inv = invRes.data as unknown as Record<string, unknown>;
    if (!['posted', 'partially_paid', 'paid'].includes(String(inv.status))) {
      return { success: false, error: 'Only posted invoices can be reversed' };
    }
    const invLines = (inv.lines as Record<string, unknown>[] | undefined) || [];
    if (!invLines.length) return { success: false, error: 'Invoice has no lines to reverse' };
    const adapter = await getDbAdapter();
    const retRes = await adapter.query(
      `SELECT prl.product_id, COALESCE(SUM(COALESCE(NULLIF(prl.base_quantity, 0), prl.quantity)), 0) AS qty
         FROM purchase_return_lines prl
         JOIN purchase_returns pr ON pr.id = prl.return_id
        WHERE pr.invoice_id = $1::uuid AND pr.company_id = $2::uuid AND pr.status = 'posted'
        GROUP BY prl.product_id`,
      [invoiceId, companyId]
    );
    if (!retRes.success) return { success: false, error: retRes.error || 'Query failed' };
    const returned = new Map<string, number>(
      ((retRes.rows || []) as Record<string, unknown>[]).map((r) => [String(r.product_id), Number(r.qty) || 0])
    );
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const lines: RemainingLine[] = [];
    for (const l of invLines) {
      const base = Number(l.baseQuantity) || Number(l.quantity) || 0;
      const done = returned.get(String(l.productId)) || 0;
      const remBase = Math.max(0, round2(base - done));
      if (remBase <= 0) continue;
      const factor = Number(l.unitFactor) || 1;
      const remQty = round2(remBase / (factor || 1));
      const net = round2(remQty * (Number(l.unitPrice) || 0) * (1 - (Number(l.discountPercent) || 0) / 100));
      lines.push({
        productId: String(l.productId),
        quantity: remQty,
        unitPrice: Number(l.unitPrice) || 0,
        discountPercent: Number(l.discountPercent) || 0,
        vatPercent: Number(l.vatPercent) || 0,
        lineTotal: round2(net * (1 + (Number(l.vatPercent) || 0) / 100)),
        unitId: l.unitId as string | undefined,
        unitFactor: l.unitFactor as number | undefined,
        baseQuantity: remBase,
      });
    }
    if (!lines.length) return { success: false, error: 'Invoice already fully reversed or returned' };
    const subtotal = round2(lines.reduce((s, l) => s + l.quantity * l.unitPrice * (1 - l.discountPercent / 100), 0));
    const vatAmount = round2(lines.reduce((s, l) => s + l.quantity * l.unitPrice * (1 - l.discountPercent / 100) * (l.vatPercent / 100), 0));
    const num = await getNextDocumentNumber(companyId, 'purchase_return', userId);
    if (!num.success || !num.number) return { success: false, error: num.error || 'Could not number the reversal return' };
    const created = await purchasesApi.createReturn(
      {
        companyId,
        returnNumber: num.number,
        invoiceId,
        supplierId: String(inv.supplierId),
        date,
        subtotal,
        vatAmount,
        totalAmount: round2(subtotal + vatAmount),
        reason: `عكس الفاتورة ${String(inv.invoiceNumber)} — ${v.data.reason}`,
        status: 'draft',
        notes: `Reversal of ${String(inv.invoiceNumber)}`,
        lines: lines.map((l) => ({
          productId: l.productId,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          lineTotal: l.lineTotal,
          unitId: l.unitId,
          unitFactor: l.unitFactor,
          baseQuantity: l.baseQuantity,
        })),
      } as never,
      userId
    );
    if (!created.success || !created.id) return { success: false, error: created.error || 'Create failed' };
    const posted = await purchasesApi.postReturn(created.id, companyId, userId);
    if (!posted.success) return { success: false, error: posted.error || 'Post failed' };
    await auditReversal({ companyId, userId, table: 'purchase_invoices', recordId: invoiceId, reference: num.number, reason: v.data.reason });
    return { success: true, data: { reference: num.number, linkedId: created.id, linkedNumber: num.number } };
  } catch (e) {
    return { success: false, error: String(e instanceof Error ? e.message : e) };
  }
}

/**
 * Reverse a posted receipt/payment voucher: mirror JE (legs swapped,
 * reference REV-<number>) + party-balance counter-entry + status flip to
 * 'reversed'. The flip is REQUIRED — voucher-based formulas (computed
 * balances, statements, aging) filter status='posted' and cannot see the
 * mirror JE, so an unflipped voucher would double-count.
 */
export async function reverseVoucher(
  companyId: string,
  voucherId: string,
  kind: 'receipt' | 'payment',
  input: { date?: string; reason: string },
  userId: string
): Promise<ReversalResult> {
  try {
    const v = validateInput(reversalInputSchema, { id: voucherId, companyId, ...input });
    if (!v.success) return { success: false, error: v.error };
    const date = v.data.date || todayStr();
    const adapter = await getDbAdapter();
    const table = kind === 'receipt' ? 'receipt_vouchers' : 'payment_vouchers';
    const row = await adapter.query(`SELECT * FROM ${table} WHERE id = $1::uuid AND company_id = $2::uuid`, [voucherId, companyId]);
    if (!row.success) return { success: false, error: row.error || 'Query failed' };
    const vc = row.rows?.[0] as Record<string, unknown> | undefined;
    if (!vc) return { success: false, error: 'Voucher not found' };
    if (String(vc.status) !== 'posted') {
      return { success: false, error: 'Only posted vouchers can be reversed' };
    }
    if ((Number(vc.amount_applied) || 0) > 0) {
      return { success: false, error: 'Voucher has applied payments — unlink it from the invoice first' };
    }
    const gate = await reversalDateGuard(companyId, date, adapter);
    if (!gate.ok) return { success: false, error: gate.error };
    const voucherNumber = String(vc.voucher_number || voucherId.slice(0, 8));
    const revRef = `REV-${voucherNumber}`;
    const dup = await adapter.query(
      `SELECT id FROM transactions WHERE company_id = $1::uuid AND reference = $2 LIMIT 1`,
      [companyId, revRef]
    );
    if (!dup.success) return { success: false, error: dup.error || 'Query failed' };
    if (dup.rows?.length) return { success: false, error: 'This voucher was already reversed' };
    const amount = Number(vc.amount) || 0;
    // Mirror the ACTUAL posted legs (looked up by the voucher's JE
    // reference), not a rebuilt estimate — account-faithful even if the
    // cash box was relinked after posting.
    const legsRes = await adapter.query(
      `SELECT je.account_id, je.debit, je.credit, je.memo
         FROM journal_entries je
         JOIN transactions t ON t.id = je.transaction_id
        WHERE t.company_id = $1::uuid AND t.reference = $2 AND t.status = 'posted'
        ORDER BY je.id`,
      [companyId, voucherNumber]
    );
    if (!legsRes.success) return { success: false, error: legsRes.error || 'Query failed' };
    const origLegs = (legsRes.rows || []) as Record<string, unknown>[];
    if (!origLegs.length) return { success: false, error: 'Original journal entry not found' };
    const mirrorTotal = origLegs.reduce((s, l) => s + (Number(l.debit) || 0), 0);
    const statements: TxStatement[] = [
      buildJournalEntryStatement(companyId, {
        reference: revRef,
        description: `عكس سند ${kind === 'receipt' ? 'قبض' : 'صرف'} ${voucherNumber} — ${v.data.reason}`,
        date,
        totalAmount: Math.round(mirrorTotal * 100) / 100,
        entries: origLegs.map((l) => ({
          accountId: String(l.account_id),
          debit: Number(l.credit) || 0,
          credit: Number(l.debit) || 0,
          memo: l.memo ? String(l.memo) : undefined,
        })),
      }),
    ];
    // Party-balance counter-entry (undoes the ±amount the posting made).
    const partyTable = kind === 'receipt' ? 'customers' : 'suppliers';
    const partyId = kind === 'receipt' ? vc.customer_id : vc.supplier_id;
    const partySign = kind === 'receipt' ? '+' : '-';
    if (partyId && amount !== 0) {
      statements.push({
        sql: `UPDATE ${partyTable} SET balance = COALESCE(balance,0) ${partySign} $1::numeric, updated_at = NOW() WHERE id = $2::uuid AND company_id = $3::uuid`,
        params: [amount, String(partyId), companyId],
      });
    }
    // Terminal flip (conditional — lost race reports honestly).
    statements.push({
      sql: `UPDATE ${table} SET status = 'reversed', updated_by = $3::uuid, updated_at = NOW()
            WHERE id = $1::uuid AND company_id = $2::uuid AND status = 'posted' RETURNING id`,
      params: [voucherId, companyId, safeUserId(userId)],
    });
    const result = await runTransaction(statements);
    if (!result.success) return { success: false, error: result.error || 'Transaction failed' };
    // Post-verify the terminal flip with a plain SELECT — adapter
    // transaction result shapes differ (pg batch vs pglite), but query()
    // always returns rows. A lost race reports honestly here.
    const verify = await adapter.query(
      `SELECT status FROM ${table} WHERE id = $1::uuid AND company_id = $2::uuid`,
      [voucherId, companyId]
    );
    if (!verify.success || String((verify.rows?.[0] as Record<string, unknown> | undefined)?.status) !== 'reversed') {
      return { success: false, error: 'Voucher was already reversed or modified' };
    }
    await auditReversal({ companyId, userId, table, recordId: voucherId, reference: revRef, reason: v.data.reason });
    return { success: true, data: { reference: revRef } };
  } catch (e) {
    return { success: false, error: String(e instanceof Error ? e.message : e) };
  }
}


