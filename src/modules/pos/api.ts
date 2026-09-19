import { getDbAdapter, isElectronPg } from '@/core/database/adapters';
import type { DbAdapter } from '@/core/database/adapters/types';
import { mapRows } from '@/core/utils/mapPgRow';
import { resolveExistingUserId, safeUserId } from '@/core/utils/userIdValidator';
import { validateInput, companyIdSchema, posCheckoutSchema, openPosShiftSchema, closePosShiftSchema } from '@/core/utils/validation';
import { clampPageArgs, paginatedResult, type PaginatedQueryResult } from '@/core/utils/pagination';
import { YER_CODE } from '@/core/utils/currencyConverter';
import { getNextDocumentNumber } from '@/core/api';
import { runTransaction, type TxStatement } from '@/core/database/tx';
import { resolvePostingAccounts, getDefaultAccountId, buildPosSalePostingStatements, buildCashDifferenceStatements, getCashBoxAccountId as getCashBoxGLAccountId } from '@/core/utils/journalEntryGenerator';
import { logAudit } from '@/core/utils/auditLogger';
import { snapshotLineUnit } from '@/core/utils/unitConversion';
import type { PosShift, PosProduct, PosCheckoutInput, PosCheckoutResult, PosShiftSummary, PosPaymentMethod } from './types';

/**
 * POS API — shifts, products, atomic checkout, Z-report.
 *
 * Transport model (mirrors salesApi): Electron RPC for simple reads when the
 * typed surface exists, `getDbAdapter()` otherwise. The CHECKOUT is the one
 * deliberate exception: it runs a single code path on both transports (like
 * salesApi.postInvoice) because it composes journal-entry statements that
 * live renderer-side — the SQL guard cannot authorize a composed CTE batch
 * for a cashier anyway, and PGlite/e2e must exercise the exact same SQL.
 */

// ─── Shared stock helpers (extracted from salesApi.postInvoice — same SQL) ──
// Each returns the statements that (1) ensure stock rows exist, (2) record
// 'out' movements and (3) decrement quantities for every invoice line.
// preferredWarehouseId (Phase 4): validated default source tried first when
// it holds the line qty — appended LAST ($3/$4) so numbering never shifts.
const PREFERRED_LATERAL = (pref: string) => `SELECT COALESCE(
                (SELECT s2.warehouse_id FROM stock s2 WHERE s2.product_id = sil.product_id AND s2.company_id = si.company_id AND s2.warehouse_id = ${pref}::uuid AND s2.quantity >= COALESCE(NULLIF(sil.base_quantity, 0), sil.quantity) LIMIT 1),
                (SELECT warehouse_id FROM stock WHERE product_id = sil.product_id AND company_id = si.company_id ORDER BY quantity DESC LIMIT 1),
                (SELECT id FROM warehouses WHERE company_id = si.company_id ORDER BY created_at LIMIT 1)
              ) AS warehouse_id`;

/**
 * Post the cash-count difference JE for a closed shift (Phase 5).
 * Idempotent per shift (POS-DIFF-<id8> reference guard) and a no-op for
 * balanced closes. Returns the JE reference (or null when nothing posted).
 */
async function postShiftDifferenceJe(
  adapter: DbAdapter,
  companyId: string,
  shiftId: string,
  cashBoxId: string | null,
  difference: number,
  date: string,
  userId?: string
): Promise<{ success: boolean; jeReference: string | null; error?: string }> {
  try {
    const diff = Math.round((Number(difference) || 0) * 100) / 100;
    if (Math.abs(diff) < 0.005) return { success: true, jeReference: null };
    const jeReference = `POS-DIFF-${String(shiftId).slice(0, 8).toUpperCase()}`;
    const dup = await adapter.query(
      `SELECT id FROM transactions WHERE company_id = $1::uuid AND reference = $2 LIMIT 1`,
      [companyId, jeReference]
    );
    if (!dup.success) return { success: false, jeReference: null, error: dup.error };
    if (dup.rows?.length) return { success: true, jeReference };
    let boxAccount: string | null = null;
    if (cashBoxId) {
      boxAccount = await getCashBoxGLAccountId(companyId, cashBoxId);
    }
    if (!boxAccount) {
      return { success: false, jeReference: null, error: 'الخزينة غير مرتبطة بحساب محاسبي — اربطها أولاً ثم أعد إغلاق الوردية' };
    }
    const accs = await resolvePostingAccounts(companyId, ['default_inventory_shortage', 'default_inventory_surplus']);
    if (!accs.success) return { success: false, jeReference: null, error: accs.error };
    const statements = buildCashDifferenceStatements(companyId, {
      reference: jeReference,
      date,
      difference: diff,
      boxAccountId: boxAccount,
      shortageAccountId: accs.ids.default_inventory_shortage,
      surplusAccountId: accs.ids.default_inventory_surplus,
    });
    if (!statements.length) return { success: true, jeReference: null };
    const result = await runTransaction(statements);
    if (!result.success) return { success: false, jeReference: null, error: result.error };
    await logAudit({
      companyId,
      userId: safeUserId(userId) || 'system',
      action: 'post',
      tableName: 'pos_shifts',
      recordId: shiftId,
      newValues: { difference: diff, jeReference },
    }).catch(() => undefined);
    return { success: true, jeReference };
  } catch (e) {
    return { success: false, jeReference: null, error: String(e) };
  }
}

/**
 * Resolve the walk-in customer for cash sales (Phase 6): the configured
 * `pos.defaultWalkInCustomerId` setting wins when it names a live customer;
 * otherwise the conventional CASH customer (find-or-create, race-safe via
 * ON CONFLICT + reselect). Only ever returns null with an honest error —
 * callers must refuse the sale, never INSERT a null customer_id.
 */
async function resolveWalkInCustomer(
  companyId: string,
  adapter: DbAdapter
): Promise<{ success: boolean; customerId?: string; error?: string }> {
  try {
    const setting = await adapter.query(
      `SELECT value FROM settings WHERE company_id = $1::uuid AND key = 'pos.defaultWalkInCustomerId'`,
      [companyId]
    );
    const configured = setting.success ? String((setting.rows?.[0] as Record<string, unknown> | undefined)?.value || '').trim() : '';
    if (configured) {
      const live = await adapter.query(
        `SELECT id FROM customers WHERE id = $1::uuid AND company_id = $2::uuid AND is_active = true`,
        [configured, companyId]
      );
      if (live.success && live.rows?.[0]) {
        return { success: true, customerId: String((live.rows[0] as Record<string, unknown>).id) };
      }
    }
    // Single-statement find-or-create (no check-then-insert race window;
    // customers has no UNIQUE(company_id, code), so ON CONFLICT targets
    // nothing — the WHERE NOT EXISTS inside one statement is the guard).
    const ensured = await adapter.query(
      `WITH sel AS (SELECT id FROM customers WHERE company_id = $1::uuid AND code = 'CASH' LIMIT 1),
            ins AS (INSERT INTO customers (company_id, code, name, is_active)
                    SELECT $1::uuid, 'CASH', 'عملاء النقدية', true
                     WHERE NOT EXISTS (SELECT 1 FROM sel)
                    RETURNING id)
       SELECT id FROM ins UNION ALL SELECT id FROM sel LIMIT 1`,
      [companyId]
    );
    if (!ensured.success) return { success: false, error: ensured.error };
    if (ensured.rows?.[0]) {
      return { success: true, customerId: String((ensured.rows[0] as Record<string, unknown>).id) };
    }
    return { success: false, error: 'عيّن عميل النقدية الافتراضي من إعدادات نقاط البيع' };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

function buildEnsureStockStatements(invoiceId: string, companyId: string, preferredWarehouseId?: string | null): TxStatement[] {
  return [{
    sql: `INSERT INTO stock (company_id, product_id, warehouse_id, quantity)
          SELECT $2::uuid, sil.product_id, wh.warehouse_id, 0
            FROM sales_invoices si
            JOIN sales_invoice_lines sil ON sil.invoice_id = si.id
            JOIN LATERAL (
              ${PREFERRED_LATERAL('$3')}
            ) wh ON true
            LEFT JOIN stock s ON s.company_id = si.company_id AND s.product_id = sil.product_id AND s.warehouse_id = wh.warehouse_id
           WHERE si.id = $1::uuid AND si.company_id = $2::uuid AND wh.warehouse_id IS NOT NULL AND s.id IS NULL
           GROUP BY si.company_id, sil.product_id, wh.warehouse_id`,
    params: [invoiceId, companyId, preferredWarehouseId || null],
  }];
}

function buildStockOutStatements(invoiceId: string, companyId: string, notes: string, preferredWarehouseId?: string | null): TxStatement[] {
  return [{
    sql: `INSERT INTO stock_movements (company_id, product_id, warehouse_id, type, quantity, reference, notes, created_at)
          SELECT si.company_id, sil.product_id, wh.warehouse_id, 'out', COALESCE(NULLIF(sil.base_quantity, 0), sil.quantity), si.invoice_number, $3, NOW()
            FROM sales_invoices si
            JOIN sales_invoice_lines sil ON sil.invoice_id = si.id
            JOIN LATERAL (
              ${PREFERRED_LATERAL('$4')}
            ) wh ON true
           WHERE si.id = $1::uuid AND si.company_id = $2::uuid AND wh.warehouse_id IS NOT NULL`,
    params: [invoiceId, companyId, notes, preferredWarehouseId || null],
  }];
}

function buildDecrementStockStatements(invoiceId: string, companyId: string, preferredWarehouseId?: string | null): TxStatement[] {
  return [{
    sql: `UPDATE stock s SET quantity = s.quantity - sub.qty, updated_at = NOW()
            FROM (
              SELECT sil.product_id, wh.warehouse_id, SUM(COALESCE(NULLIF(sil.base_quantity, 0), sil.quantity)) AS qty
                FROM sales_invoices si
                JOIN sales_invoice_lines sil ON sil.invoice_id = si.id
                JOIN LATERAL (
                  ${PREFERRED_LATERAL('$3')}
                ) wh ON true
               WHERE si.id = $1::uuid AND si.company_id = $2::uuid AND wh.warehouse_id IS NOT NULL
               GROUP BY sil.product_id, wh.warehouse_id
            ) sub
           WHERE s.company_id = $2::uuid AND s.product_id = sub.product_id AND s.warehouse_id = sub.warehouse_id`,
    params: [invoiceId, companyId, preferredWarehouseId || null],
  }];
}

export const posApi = {
  // ─── Products (grid + barcode search, with live stock) ───────────────────
  async getProducts(companyId: string, search?: string, limit = 200): Promise<{ success: boolean; data?: PosProduct[]; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      // Typed RPC in Electron (session-derived companyId); adapter fallback
      // (PGlite/e2e) runs the identical SQL.
      let rows: Record<string, unknown>[] | undefined;
      if (isElectronPg()) {
        const pos = (typeof window !== 'undefined' && window.electronDB?.pos);
        if (!pos) return { success: false, error: 'RPC unavailable' };
        const result = await pos.getProducts({ search: search ?? undefined, limit });
        if (!result.success) return { success: false, error: result.error };
        rows = result.rows;
      } else {
        const adapter = await getDbAdapter();
        const pattern = search ? `%${search}%` : null;
        const result = await adapter.query(
          `SELECT p.id, p.code, p.name_ar, p.name_en, p.barcode, p.sku, p.unit,
                  p.sale_price, p.product_type_id, pt.name_ar AS product_type_name,
                  COALESCE(s.total_qty, 0) AS stock_qty,
                  COALESCE(pcat.category_ids, '[]'::json) AS category_ids
             FROM products p
             LEFT JOIN product_types pt ON pt.id = p.product_type_id
             LEFT JOIN (SELECT product_id, SUM(quantity) AS total_qty FROM stock WHERE company_id = $1 GROUP BY product_id) s
               ON s.product_id = p.id
             LEFT JOIN LATERAL (
               SELECT json_agg(pc.category_id) AS category_ids
                 FROM product_product_categories pc
                WHERE pc.product_id = p.id
             ) pcat ON true
            WHERE p.company_id = $1 AND p.is_active = true
              AND p.sale_price IS NOT NULL
              ${pattern ? 'AND (p.name_ar ILIKE $2 OR p.name_en ILIKE $2 OR p.barcode ILIKE $2 OR p.sku ILIKE $2 OR p.code ILIKE $2)' : ''}
            ORDER BY p.name_ar
            LIMIT ${limit}`,
          pattern ? [companyId, pattern] : [companyId]
        );
        if (!result.success) return { success: false, error: result.error };
        rows = result.rows;
      }
      const data = (rows || []).map((r: Record<string, unknown>) => {
        const mapped = mapRows<PosProduct>([r])[0];
        mapped.salePrice = Number(r.sale_price) || 0;
        mapped.stockQty = Number(r.stock_qty) || 0;
        if (r.category_ids && !Array.isArray(r.category_ids)) {
          try { mapped.categoryIds = JSON.parse(String(r.category_ids)); } catch { /* keep undefined */ }
        }
        return mapped;
      });
      return { success: true, data };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  /** Exact barcode/sku/code lookup — first match wins (scanner path). */
  async findProductByCode(companyId: string, code: string): Promise<{ success: boolean; data?: PosProduct | null; error?: string }> {
    const result = await this.getProducts(companyId, code, 5);
    if (!result.success) return { success: false, error: result.error };
    const cleaned = code.trim();
    // mapRows auto-converts pure-numeric strings (e.g. an EAN-13 barcode) to
    // numbers, so compare via String() rather than calling string methods.
    const asText = (v: unknown): string => v == null ? '' : String(v).trim();
    const hit = (result.data || []).find((p) =>
      asText(p.barcode) === cleaned ||
      asText(p.sku) === cleaned ||
      asText(p.code) === cleaned
    ) || null;
    return { success: true, data: hit };
  },

  // ─── Shifts ───────────────────────────────────────────────────────────────
  async openShift(companyId: string, cashBoxId: string, openingAmount: number, userId?: string): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      const validation = validateInput(openPosShiftSchema, { companyId, cashBoxId, openingAmount });
      if (!validation.success) return { success: false, error: validation.error };
      if (isElectronPg()) {
        const pos = window.electronDB?.pos;
        if (!pos) return { success: false, error: 'RPC unavailable' };
        const result = await pos.openShift({ cashBoxId, openingAmount });
        if (!result.success) return { success: false, error: result.error };
        const row = result.rows?.[0];
        if (row && 'error' in row) return { success: false, error: String(row.error) };
        return row?.id ? { success: true, id: String(row.id) } : { success: false, error: result.error || 'Could not open shift' };
      }
      const adapter = await getDbAdapter();
      const safeUser = await resolveExistingUserId(adapter, userId, companyId);
      if (!safeUser) return { success: false, error: 'User not found' };
      // Atomic guard: single INSERT ... SELECT WHERE NOT EXISTS avoids TOCTOU between SELECT and INSERT.
      // Also catch 23505 from the partial unique index uq_pos_shifts_open_per_user as fallback.
      try {
        const result = await adapter.query(
          `INSERT INTO pos_shifts (company_id, cash_box_id, user_id, opening_amount, status, opened_at, created_by)
           SELECT $1::uuid, $2::uuid, $3::uuid, $4::numeric, 'open', NOW(), $3::uuid
           WHERE NOT EXISTS (SELECT 1 FROM pos_shifts WHERE company_id = $1::uuid AND user_id = $3::uuid AND status = 'open')
           RETURNING id`,
          [companyId, cashBoxId, safeUser, openingAmount]
        );
        if (result.success && result.rows?.[0]) {
          return { success: true, id: result.rows[0].id as string };
        }
        // No row inserted means another concurrent openShift won the race
        if (result.success && !result.rows?.[0]) {
          return { success: false, error: 'You already have an open shift. Close it before opening a new one.' };
        }
        return { success: false, error: result.error };
      } catch (e) {
        const msg = String(e);
        if (msg.includes('duplicate key') || msg.includes('23505') || msg.includes('uq_pos_shifts_open_per_user')) {
          return { success: false, error: 'You already have an open shift. Close it before opening a new one.' };
        }
        return { success: false, error: msg };
      }
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async getActiveShift(companyId: string, userId?: string): Promise<{ success: boolean; data?: PosShift | null; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      if (isElectronPg()) {
        const pos = window.electronDB?.pos;
        if (!pos) return { success: false, error: 'RPC unavailable' };
        const result = await pos.getActiveShift();
        if (!result.success) return { success: false, error: result.error };
        if (!result.rows?.length) return { success: true, data: null };
        const mapped = mapRows<PosShift>([result.rows[0]])[0];
        mapped.openingAmount = Number(result.rows[0].opening_amount) || 0;
        return { success: true, data: mapped };
      }
      const adapter = await getDbAdapter();
      const safeUser = await resolveExistingUserId(adapter, userId, companyId);
      if (!safeUser) return { success: true, data: null };
      const result = await adapter.query(
        `SELECT ps.*, cb.name AS cash_box_name, u.full_name AS cashier_name
           FROM pos_shifts ps
           LEFT JOIN cash_boxes cb ON cb.id = ps.cash_box_id
           LEFT JOIN users u ON u.id = ps.user_id
          WHERE ps.company_id = $1 AND ps.status = 'open'
            AND ps.user_id = $2::uuid
          ORDER BY ps.opened_at DESC LIMIT 1`,
        [companyId, safeUser]
      );
      if (!result.success) return { success: false, error: result.error };
      if (!result.rows?.length) return { success: true, data: null };
      const mapped = mapRows<PosShift>([result.rows[0]])[0];
      mapped.openingAmount = Number(result.rows[0].opening_amount) || 0;
      return { success: true, data: mapped };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async getShiftsPaginated(companyId: string, page = 1, pageSize = 25): Promise<PaginatedQueryResult<PosShift> & { success: boolean; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      const { page: p, pageSize: ps } = clampPageArgs(page, pageSize);
      const mapShiftRow = (r: Record<string, unknown>) => {
        const mapped = mapRows<PosShift>([r])[0];
        mapped.openingAmount = Number(r.opening_amount) || 0;
        if (r.closing_amount != null) mapped.closingAmount = Number(r.closing_amount);
        if (r.expected_amount != null) mapped.expectedAmount = Number(r.expected_amount);
        if (r.difference != null) mapped.difference = Number(r.difference);
        return mapped;
      };
      if (isElectronPg()) {
        const pos = window.electronDB?.pos;
        if (!pos) return { success: false, error: 'RPC unavailable' };
        const result = await pos.getShiftsPaginated({ page: p, pageSize: ps });
        if (!result.success) return { success: false, error: result.error };
        const rows = result.rows || [];
        const total = rows.length ? Number(rows[0].total_count) || rows.length : 0;
        return { success: true, data: paginatedResult(rows.map(mapShiftRow), total, p, ps) };
      }
      const adapter = await getDbAdapter();
      const countResult = await adapter.query(
        'SELECT COUNT(*)::int AS total FROM pos_shifts WHERE company_id = $1',
        [companyId]
      );
      const total = countResult.rows?.[0] ? Number(countResult.rows[0].total) || 0 : 0;
      const result = await adapter.query(
        `SELECT ps.*, cb.name AS cash_box_name, u.full_name AS cashier_name,
                (SELECT COUNT(*)::int FROM pos_payments pp WHERE pp.shift_id = ps.id) AS payments_count
           FROM pos_shifts ps
           LEFT JOIN cash_boxes cb ON cb.id = ps.cash_box_id
           LEFT JOIN users u ON u.id = ps.user_id
          WHERE ps.company_id = $1
          ORDER BY ps.opened_at DESC
          LIMIT $2 OFFSET $3`,
        [companyId, ps, (p - 1) * ps]
      );
      if (!result.success) return { success: false, error: result.error };
      return { success: true, data: paginatedResult((result.rows || []).map(mapShiftRow), total, p, ps) };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  /** Shift totals for the close dialog + Z-report. Single aggregated query. */
  async getShiftSummary(companyId: string, shiftId: string): Promise<{ success: boolean; data?: PosShiftSummary; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      const mapSummary = (r: Record<string, unknown>) => {
        const openingAmount = Number(r.opening_amount) || 0;
        const cashTotal = Number(r.cash_total) || 0;
        const expected = r.expected_amount != null
          ? Number(r.expected_amount)
          : openingAmount + cashTotal;
        return {
          invoicesCount: Number(r.invoices_count) || 0,
          grossTotal: Number(r.gross_total) || 0,
          discountAmount: Number(r.discount_amount) || 0,
          vatAmount: Number(r.vat_amount) || 0,
          netTotal: Number(r.net_total) || 0,
          cashTotal,
          creditTotal: Number(r.credit_total) || 0,
          openingAmount,
          expectedAmount: expected,
        } satisfies PosShiftSummary;
      };
      if (isElectronPg()) {
        const pos = window.electronDB?.pos;
        if (!pos) return { success: false, error: 'RPC unavailable' };
        const result = await pos.getShiftSummary({ id: shiftId });
        if (!result.success || !result.rows?.[0]) return { success: false, error: result.error || 'Shift not found' };
        return { success: true, data: mapSummary(result.rows[0]) };
      }
      const adapter = await getDbAdapter();
      const result = await adapter.query(
        `SELECT
           ps.opening_amount,
           COALESCE(inv.invoices_count, 0)    AS invoices_count,
           COALESCE(inv.gross_total, 0)       AS gross_total,
           COALESCE(inv.discount_amount, 0)   AS discount_amount,
           COALESCE(inv.vat_amount, 0)        AS vat_amount,
           COALESCE(inv.net_total, 0)          AS net_total,
           COALESCE(pay.cash_total, 0)         AS cash_total,
           COALESCE(pay.credit_total, 0)       AS credit_total
         FROM pos_shifts ps
         LEFT JOIN (
           SELECT si.shift_id,
                  COUNT(*) AS invoices_count,
                  SUM(si.subtotal + si.vat_amount) AS gross_total,
                  SUM(si.discount_amount) AS discount_amount,
                  SUM(si.vat_amount) AS vat_amount,
                  SUM(si.total_amount) AS net_total
             FROM sales_invoices si
            WHERE si.company_id = $1 AND si.shift_id = $2::uuid AND si.is_pos = true AND si.status <> 'cancelled'
            GROUP BY si.shift_id
         ) inv ON inv.shift_id = ps.id
         LEFT JOIN (
           SELECT pp.shift_id,
                  SUM(CASE WHEN pp.method = 'cash' THEN pp.amount ELSE 0 END) AS cash_total,
                  SUM(CASE WHEN pp.method = 'credit' THEN pp.amount ELSE 0 END) AS credit_total
             FROM pos_payments pp
            WHERE pp.company_id = $1 AND pp.shift_id = $2::uuid
            GROUP BY pp.shift_id
         ) pay ON pay.shift_id = ps.id
        WHERE ps.company_id = $1 AND ps.id = $2::uuid`,
        [companyId, shiftId]
      );
      if (!result.success || !result.rows?.[0]) return { success: false, error: result.error || 'Shift not found' };
      return { success: true, data: mapSummary(result.rows[0]) };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async closeShift(companyId: string, shiftId: string, countedAmount: number, notes?: string, userId?: string): Promise<{ success: boolean; data?: { expectedAmount: number; difference: number; jeReference?: string | null }; error?: string }> {
    try {
      const validation = validateInput(closePosShiftSchema, { id: shiftId, companyId, countedAmount });
      if (!validation.success) return { success: false, error: validation.error };
      const adapter = await getDbAdapter();
      const today = new Date().toISOString().slice(0, 10);
      // Phase 5: closing posts into today — a closed fiscal year locks the
      // whole close (a stranded open shift is an operational error the
      // message names, not a silent report-only close).
      const { assertAccountingPeriodOpen: assertFiscalClose } = await import('@/modules/accounting/yearEnd');
      const fiscalCloseGate = await assertFiscalClose(companyId, today, adapter);
      if (!fiscalCloseGate.open) {
        return { success: false, error: `السنة المالية ${fiscalCloseGate.period.year} مقفلة — لا يمكن إغلاق الوردية بتاريخ داخلها` };
      }
      // Heal: an already-closed shift whose difference never got its JE
      // (earlier JE failure) posts it now instead of erroring.
      const cur = await adapter.query(
        `SELECT id, status, cash_box_id, expected_amount, difference FROM pos_shifts WHERE id = $1::uuid AND company_id = $2::uuid`,
        [shiftId, companyId]
      );
      if (!cur.success) return { success: false, error: cur.error };
      const curRow = cur.rows?.[0] as Record<string, unknown> | undefined;
      if (curRow && String(curRow.status) === 'closed') {
        const healed = await postShiftDifferenceJe(
          adapter, companyId, shiftId,
          curRow.cash_box_id ? String(curRow.cash_box_id) : null,
          Number(curRow.difference) || 0, today, userId
        );
        if (!healed.success) return { success: false, error: healed.error };
        return {
          success: true,
          data: {
            expectedAmount: Number(curRow.expected_amount) || 0,
            difference: Number(curRow.difference) || 0,
            jeReference: healed.jeReference,
          },
        };
      }
      if (isElectronPg()) {
        const pos = window.electronDB?.pos;
        if (!pos) return { success: false, error: 'RPC unavailable' };
        const result = await pos.closeShift({ id: shiftId, countedAmount, notes: notes ?? null });
        if (!result.success) return { success: false, error: result.error };
        const row = result.rows?.[0];
        if (!row) return { success: false, error: 'Shift not found or already closed' };
        const expected = Number(row.expected_amount) || 0;
        const difference = Number(row.difference) || 0;
        const boxId = curRow?.cash_box_id ? String(curRow.cash_box_id) : null;
        const je = await postShiftDifferenceJe(adapter, companyId, shiftId, boxId, difference, today, userId);
        if (!je.success) return { success: false, error: je.error };
        return { success: true, data: { expectedAmount: expected, difference, jeReference: je.jeReference } };
      }
      const summary = await this.getShiftSummary(companyId, shiftId);
      if (!summary.success || !summary.data) return { success: false, error: summary.error || 'Shift not found' };
      const expected = summary.data.expectedAmount;
      const difference = countedAmount - expected;
      const safeUser = await resolveExistingUserId(adapter, userId, companyId);
      const result = await adapter.query(
        `UPDATE pos_shifts
            SET closing_amount = $3::numeric, expected_amount = $4::numeric, difference = $5::numeric,
                status = 'closed', closed_at = NOW(), notes = COALESCE($6, notes), updated_by = $7::uuid, updated_at = NOW()
          WHERE id = $1::uuid AND company_id = $2::uuid AND status = 'open'
          RETURNING id`,
        [shiftId, companyId, countedAmount, expected, difference, notes ?? null, safeUser]
      );
      if (!result.success) return { success: false, error: result.error };
      if (!result.rows?.length) return { success: false, error: 'Shift not found or already closed' };
      const boxId = curRow?.cash_box_id ? String(curRow.cash_box_id) : null;
      const je = await postShiftDifferenceJe(adapter, companyId, shiftId, boxId, difference, today, userId);
      if (!je.success) return { success: false, error: je.error };
      return { success: true, data: { expectedAmount: expected, difference, jeReference: je.jeReference } };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  // ─── Receipts of a shift (Z-report detail + reprint) ──────────────────────
  async getShiftInvoices(companyId: string, shiftId: string): Promise<{ success: boolean; data?: Array<{ id: string; invoiceNumber: string; totalAmount: number; paidAmount: number; createdAt: string; cashierName?: string }>; error?: string }> {
    try {
      const mapInvoiceRow = (r: Record<string, unknown>) => ({
        id: String(r.id),
        invoiceNumber: String(r.invoice_number),
        totalAmount: Number(r.total_amount) || 0,
        paidAmount: Number(r.paid_amount) || 0,
        createdAt: String(r.created_at),
        cashierName: r.cashier_name ? String(r.cashier_name) : undefined,
      });
      if (isElectronPg()) {
        const pos = window.electronDB?.pos;
        if (!pos) return { success: false, error: 'RPC unavailable' };
        const result = await pos.getShiftInvoices({ id: shiftId });
        if (!result.success) return { success: false, error: result.error };
        return { success: true, data: (result.rows || []).map(mapInvoiceRow) };
      }
      const adapter = await getDbAdapter();
      const result = await adapter.query(
        `SELECT si.id, si.invoice_number, si.total_amount, si.paid_amount, si.created_at, u.full_name AS cashier_name
           FROM sales_invoices si
           LEFT JOIN users u ON u.id = si.created_by
          WHERE si.company_id = $1 AND si.shift_id = $2::uuid AND si.is_pos = true AND si.status <> 'cancelled'
          ORDER BY si.created_at DESC`,
        [companyId, shiftId]
      );
      if (!result.success) return { success: false, error: result.error };
      return { success: true, data: (result.rows || []).map(mapInvoiceRow) };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  /** Full receipt (header + lines + payments) for reprint after checkout. */
  async getReceipt(companyId: string, invoiceId: string): Promise<{ success: boolean; data?: { invoiceNumber: string; date: string; subtotal: number; discountAmount: number; vatAmount: number; totalAmount: number; cashAmount: number; creditAmount: number; customerName?: string; lines: Array<{ nameAr: string; quantity: number; unitPrice: number; lineTotal: number; unit: string }>; payments: Array<{ method: PosPaymentMethod; amount: number }> }; error?: string }> {
    try {
      const paymentsFrom = (raw: unknown): Array<{ method: PosPaymentMethod; amount: number }> => {
        const arr = Array.isArray(raw) ? raw : (typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return []; } })() : []);
        return (Array.isArray(arr) ? arr : []).map((r: Record<string, unknown>) => ({ method: String(r.method) as PosPaymentMethod, amount: Number(r.amount) || 0 }));
      };
      const linesFrom = (raw: unknown): Array<{ nameAr: string; quantity: number; unitPrice: number; lineTotal: number; unit: string }> => {
        const arr = Array.isArray(raw) ? raw : (typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return []; } })() : []);
        return (Array.isArray(arr) ? arr : []).map((r: Record<string, unknown>) => ({
          nameAr: String(r.name_ar || ''),
          quantity: Number(r.quantity) || 0,
          unitPrice: Number(r.unit_price) || 0,
          lineTotal: Number(r.line_total) || 0,
          unit: String(r.unit || ''),
        }));
      };
      if (isElectronPg()) {
        const pos = window.electronDB?.pos;
        if (!pos) return { success: false, error: 'RPC unavailable' };
        const result = await pos.getReceipt({ id: invoiceId });
        if (!result.success || !result.rows?.[0]) return { success: false, error: result.error || 'Receipt not found' };
        const inv = result.rows[0];
        const payments = paymentsFrom(inv.payments);
        return {
          success: true,
          data: {
            invoiceNumber: String(inv.invoice_number),
            date: String(inv.date),
            subtotal: Number(inv.subtotal) || 0,
            discountAmount: Number(inv.discount_amount) || 0,
            vatAmount: Number(inv.vat_amount) || 0,
            totalAmount: Number(inv.total_amount) || 0,
            cashAmount: payments.filter((p) => p.method === 'cash').reduce((s, p) => s + p.amount, 0),
            creditAmount: payments.filter((p) => p.method === 'credit').reduce((s, p) => s + p.amount, 0),
            customerName: inv.customer_name ? String(inv.customer_name) : undefined,
            lines: linesFrom(inv.lines),
            payments,
          },
        };
      }
      const adapter = await getDbAdapter();
      const invRes = await adapter.query(
        `SELECT si.invoice_number, si.date, si.subtotal, si.discount_amount, si.vat_amount, si.total_amount, c.name AS customer_name
           FROM sales_invoices si
           LEFT JOIN customers c ON c.id = si.customer_id
          WHERE si.company_id = $1 AND si.id = $2::uuid AND si.is_pos = true`,
        [companyId, invoiceId]
      );
      if (!invRes.success || !invRes.rows?.[0]) return { success: false, error: invRes.error || 'Receipt not found' };
      const linesRes = await adapter.query(
        `SELECT p.name_ar, l.quantity, l.unit_price, l.line_total, p.unit
           FROM sales_invoice_lines l
           LEFT JOIN products p ON p.id = l.product_id
          WHERE l.invoice_id = $1::uuid
          ORDER BY l.id`,
        [invoiceId]
      );
      const payRes = await adapter.query(
        'SELECT method, amount FROM pos_payments WHERE company_id = $1 AND invoice_id = $2::uuid ORDER BY id',
        [companyId, invoiceId]
      );
      const inv = invRes.rows[0];
      const payments = (payRes.rows || []).map((r: Record<string, unknown>) => ({ method: String(r.method) as PosPaymentMethod, amount: Number(r.amount) || 0 }));
      return {
        success: true,
        data: {
          invoiceNumber: String(inv.invoice_number),
          date: String(inv.date),
          subtotal: Number(inv.subtotal) || 0,
          discountAmount: Number(inv.discount_amount) || 0,
          vatAmount: Number(inv.vat_amount) || 0,
          totalAmount: Number(inv.total_amount) || 0,
          cashAmount: payments.filter((p) => p.method === 'cash').reduce((s, p) => s + p.amount, 0),
          creditAmount: payments.filter((p) => p.method === 'credit').reduce((s, p) => s + p.amount, 0),
          customerName: inv.customer_name ? String(inv.customer_name) : undefined,
          lines: linesFrom(linesRes.rows),
          payments,
        },
      };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  // ─── Checkout (the atomic POS sale) ───────────────────────────────────────
  /**
   * One transaction commits EVERYTHING: invoice header + lines + pos payments,
   * the journal entry (mixed cash/credit aware + perpetual COGS legs), stock
   * movements + decrement, status flip (→ paid when nothing outstanding) and
   * the customer balance.
   *
   * Single code path on both transports — same contract as salesApi.postInvoice
   * (see the module header). The Electron SQL guard authorizes each statement
   * of the batch; the COGS cost lookup below is a plain products SELECT (a
   * read the pos role already holds) and the snapshot rides the lines CTE as
   * a value, so no new guard surface is introduced.
   */
  async checkout(input: PosCheckoutInput, userId?: string): Promise<PosCheckoutResult> {
    try {
      const validation = validateInput(posCheckoutSchema, input);
      if (!validation.success) return { success: false, error: validation.error };
      const adapter = await getDbAdapter();

      // The shift must be open and owned by the company (and the cashier).
      const shiftRes = await adapter.query(
        'SELECT id, cash_box_id, status, user_id FROM pos_shifts WHERE id = $1::uuid AND company_id = $2::uuid AND status = $3',
        [input.shiftId, input.companyId, 'open']
      );
      if (!shiftRes.success || !shiftRes.rows?.[0]) {
        return { success: false, error: 'No open shift for this checkout — open a shift first.' };
      }

      // Normalize walk-in customer: nil UUID → null (FK-safe). The `posCheckoutSchema`
      // accepts the nil UUID as valid uuid, but the DB FK rejects it.
      const NIL_UUID = '00000000-0000-0000-0000-000000000000';
      const normalizedCustomerId = input.customerId === NIL_UUID ? null : input.customerId || null;

      // Credit part requires a real registered customer (never the walk-in).
      if (input.creditAmount > 0 && !normalizedCustomerId) {
        return { success: false, error: 'A registered customer is required for credit sales.' };
      }

      // Phase 6 fix: a cash walk-in sale MUST still reference a customer row
      // (customer_id is NOT NULL) — resolve the configured default, else the
      // conventional CASH customer (find-or-create, race-safe), else fail
      // honestly BEFORE any write. Never a raw NOT NULL crash.
      let walkInCustomerId: string | null = normalizedCustomerId;
      if (!walkInCustomerId) {
        const resolved = await resolveWalkInCustomer(input.companyId, adapter);
        if (!resolved.success || !resolved.customerId) {
          return { success: false, error: resolved.error || 'Walk-in customer unavailable' };
        }
        walkInCustomerId = resolved.customerId;
      }

      // The next POS receipt number (consumes the pos_receipt sequence).
      const numberResult = await getNextDocumentNumber(input.companyId, 'pos_receipt', userId);
      if (!numberResult.success || !numberResult.number) {
        return { success: false, error: numberResult.error || 'Could not generate receipt number' };
      }
      const receiptNumber = numberResult.number;

      // Posting accounts — debtors/sales/VAT plus the perpetual-inventory
      // pair (COGS + inventory) for the cost-of-sales legs.
      // ── Phase 1 (IAS 2): perpetual COGS, resolved BEFORE the lines CTE
      // so posting-time unit costs are frozen on the lines in one shot.
      const {
        getValuationMethod, resolveSaleUnitCosts, allocateFifoOutflow,
        buildFifoConsumeStatements, roundMoney: roundMoneyV,
      } = await import('@/core/utils/valuation');
      const posMethod = await getValuationMethod(input.companyId, adapter);
      const posItems = input.lines.map((l) => {
        const usnap = snapshotLineUnit(l);
        return { productId: String(l.productId), baseQty: Number(usnap.baseQuantity ?? l.quantity) || 0 };
      }).filter((l) => l.baseQty > 0);
      let posUnitCosts = new Map<string, number>();
      let posFifo: Array<{ layerId: string; productId: string; qty: number; unitCost: number }> = [];
      if (posMethod === 'fifo' && posItems.length > 0) {
        const alloc = await allocateFifoOutflow(input.companyId, posItems, adapter);
        if (!alloc.success) return { success: false, error: alloc.error };
        posFifo = alloc.consumptions;
        const perProduct = new Map<string, { qty: number; cost: number }>();
        for (const c of alloc.consumptions) {
          const cur = perProduct.get(c.productId) || { qty: 0, cost: 0 };
          cur.qty += c.qty;
          cur.cost += c.qty * c.unitCost;
          perProduct.set(c.productId, cur);
        }
        for (const [pid, v] of perProduct) posUnitCosts.set(pid, v.qty > 0 ? v.cost / v.qty : 0);
      } else if (posItems.length > 0) {
        const resolved = await resolveSaleUnitCosts(input.companyId, posItems, adapter);
        if (!resolved.success) return { success: false, error: resolved.error };
        posUnitCosts = resolved.costs;
      }
      let posCogsTotal = 0;
      for (const it of posItems) {
        posCogsTotal = roundMoneyV(posCogsTotal + it.baseQty * (posUnitCosts.get(it.productId) || 0));
      }

      // Phase 3: POS posts dated today — closed tax periods reject it.
      const { assertPeriodOpen: assertPosPeriod } = await import('@/modules/tax/engine');
      const posGate = await assertPosPeriod(input.companyId, new Date().toISOString().split('T')[0], adapter);
      if (!posGate.open) {
        return { success: false, error: `الفترة الضريبية مغلقة (${posGate.period.startDate} – ${posGate.period.endDate}) — لا يمكن الترحيل بتاريخ داخلها` };
      }
      // Phase 5: a closed fiscal year locks its dates for every posting path.
      const { assertAccountingPeriodOpen: assertFiscalPos } = await import('@/modules/accounting/yearEnd');
      const fiscalPosGate = await assertFiscalPos(input.companyId, new Date().toISOString().split('T')[0], adapter);
      if (!fiscalPosGate.open) {
        return { success: false, error: `السنة المالية ${fiscalPosGate.period.year} مقفلة — لا يمكن الترحيل بتاريخ داخلها` };
      }

      // Posting accounts — same trio as a sales invoice, plus COGS pair.
      const accounts = await resolvePostingAccounts(input.companyId, ['default_debtors', 'default_sales', 'default_vat_output', 'default_cogs', 'default_inventory']);
      if (!accounts.success) return { success: false, error: accounts.error };

      // Perpetual COGS (IAS 2): sale-time costs from the live moving
      // average — server-side truth, never client-supplied. Snapshot values
      // ride the lines CTE as plain params (no new SQL tables).
      const costByProduct = new Map<string, number>();
      const lineProductIds = [...new Set(input.lines.map((l) => l.productId))];
      if (lineProductIds.length > 0) {
        const placeholders = lineProductIds.map((_, i) => `$${i + 2}::uuid`).join(', ');
        const costRes = await adapter.query(
          `SELECT id, COALESCE(cost_price, 0) AS cost_price FROM products WHERE company_id = $1::uuid AND id IN (${placeholders})`,
          [input.companyId, ...lineProductIds]
        );
        if (!costRes.success) return { success: false, error: costRes.error };
        for (const r of costRes.rows || []) {
          const row = r as Record<string, unknown>;
          costByProduct.set(String(row.id), Number(row.cost_price) || 0);
        }
      }
      let cogsAmount = 0;
      for (const l of input.lines) {
        const baseQty = snapshotLineUnit(l).baseQuantity ?? l.quantity;
        cogsAmount += baseQty * (costByProduct.get(l.productId) || 0);
      }
      cogsAmount = Math.round(cogsAmount * 100) / 100;
      // The cashier's box GL account receives the cash part (falls back to
      // Debtors if the box has no linked account — same fallback as salesApi).
      const cashAccountId = input.cashAmount > 0
        ? await getCashBoxGLAccountId(input.companyId, input.cashBoxId)
        : null;

      const safeUser = await resolveExistingUserId(adapter, userId, input.companyId);
      const invoiceId = crypto.randomUUID();
      const date = new Date().toISOString().split('T')[0];
      const currencyCode = input.currencyCode || YER_CODE;
      // payment_type drives existing lists/badges: full cash = 'cash' (fully
      // paid at post — salesApi semantics), any credit part = 'credit'.
      const paymentType = input.creditAmount > 0 ? 'credit' : 'cash';
      const paidAmount = input.cashAmount;

      // Server-side recompute to prevent client tampering: rebuild totals from lines
      const recomputedLineTotals = input.lines.map((l) => Math.max(0, l.unitPrice * l.quantity * (1 - (l.discountPercent ?? 0) / 100)));
      const recomputedSubtotal = recomputedLineTotals.reduce((a, b) => a + b, 0);
      if (Math.abs(recomputedSubtotal - input.subtotal) > 0.02) {
        return { success: false, error: `Subtotal mismatch: expected ${recomputedSubtotal.toFixed(2)} got ${input.subtotal}` };
      }
      // Explicit discount (gross method): POS carts carry line discounts
      // only, so gross = net subtotal + discount. Verified server-side like
      // the subtotal above — never trusted from the client alone.
      const recomputedDiscount = input.lines.reduce((a, l) => a + l.unitPrice * l.quantity * ((l.discountPercent ?? 0) / 100), 0);
      const discountAmount = Math.round((input.discountAmount ?? 0) * 100) / 100;
      if (Math.abs(recomputedDiscount - discountAmount) > 0.02 * Math.max(1, input.lines.length)) {
        return { success: false, error: `Discount mismatch: expected ${recomputedDiscount.toFixed(2)} got ${discountAmount.toFixed(2)}` };
      }
      const grossSubtotal = Math.round((input.subtotal + discountAmount) * 100) / 100;
      let discountId: string | undefined;
      if (discountAmount > 0) {
        discountId = await getDefaultAccountId(input.companyId, 'default_discount_allowed') || undefined;
        if (!discountId) {
          return { success: false, error: 'حساب الخصم المسموح به غير مضبوط — اربطه في الإعدادات ← الحسابات الافتراضية' };
        }
      }
      if (Math.abs((input.cashAmount + input.creditAmount) - input.totalAmount) > 0.02) {
        return { success: false, error: `Payment mismatch: cash ${input.cashAmount} + credit ${input.creditAmount} != total ${input.totalAmount}` };
      }

      // ── Phase 4 guardrails ──────────────────────────────────────────
      const {
        getStockPolicies: getPosPolicies, checkStockSufficiency: checkPosStock,
        formatShortages: fmtPosShort, auditOverride: auditPos,
      } = await import('@/core/utils/stockPolicy');
      const posPolicies = await getPosPolicies(input.companyId, adapter);
      // Legacy fallback: the older pos.allowNegativeStock key still counts
      // when the unified policy was never set (backward compatible).
      let allowNeg = posPolicies.allowNegativeSale;
      if (!allowNeg) {
        const legacy = await adapter.query(
          `SELECT value FROM settings WHERE company_id = $1 AND key = 'pos.allowNegativeStock' LIMIT 1`,
          [input.companyId]
        );
        const lv = legacy.success ? String(legacy.rows?.[0]?.value ?? '') : '';
        allowNeg = lv === 'true' || lv === '1';
      }
      const posIssueItems = input.lines.map((l) => {
        const usnap = snapshotLineUnit(l);
        return { productId: String(l.productId), baseQty: Number(usnap.baseQuantity ?? l.quantity) || 0 };
      }).filter((l) => l.baseQty > 0);
      const posStockGate = await checkPosStock(input.companyId, posIssueItems, adapter);
      if (!posStockGate.ok && !allowNeg) {
        return { success: false, error: `المخزون لا يكفي للبيع (${fmtPosShort(posStockGate.shortages)})` };
      }
      if (!posStockGate.ok && allowNeg) {
        await auditPos({
          companyId: input.companyId, userId: safeUser, kind: 'negative-stock',
          recordId: `pos-${input.shiftId}`, label: `نقطة بيع (وردية ${input.shiftId.slice(0, 8)})`,
          detail: { shortages: posStockGate.shortages },
        });
      }
      // Credit-limit check on the credit part (cash needs none).
      if (input.creditAmount > 0 && normalizedCustomerId) {
        const custRes = await adapter.query(
          `SELECT COALESCE(balance, 0) AS balance, COALESCE(credit_limit, 0) AS credit_limit
             FROM customers WHERE id = $1::uuid AND company_id = $2::uuid`,
          [normalizedCustomerId, input.companyId]
        );
        if (custRes.success && custRes.rows?.[0]) {
          const crow = custRes.rows[0] as Record<string, unknown>;
          const limit = Number(crow.credit_limit) || 0;
          const wouldBe = (Number(crow.balance) || 0) + input.creditAmount;
          if (limit > 0 && wouldBe > limit) {
            const msg = `تجاوز الحد الائتماني للعميل (الحد ${limit} — سيصبح ${wouldBe})`;
            if (posPolicies.creditOverlimit === 'block') {
              return { success: false, error: msg };
            }
            await auditPos({
              companyId: input.companyId, userId: safeUser, kind: 'credit-overlimit',
              recordId: `pos-${input.shiftId}`, label: `نقطة بيع آجل (وردية ${input.shiftId.slice(0, 8)})`,
              detail: { limit, current: Number(crow.balance) || 0, outstanding: input.creditAmount, mode: posPolicies.creditOverlimit },
            });
          }
        }
      }

      // Statement A — invoice header + all lines (single CTE, atomic by
      // itself; same statement shape as salesApi.createInvoice's fallback).
      const params: unknown[] = [
        invoiceId, input.companyId, receiptNumber, walkInCustomerId, date,
        input.subtotal, input.discountAmount ?? 0, input.vatAmount ?? 0,
        input.totalAmount, paidAmount, currencyCode, 1,
        input.totalAmount, paidAmount, paymentType, input.cashBoxId,
        input.notes ?? null, safeUser, safeUser, input.shiftId,
      ];
      let sql = `WITH inv AS (INSERT INTO sales_invoices
        (id, company_id, invoice_number, customer_id, date, subtotal, discount_amount, vat_amount, total_amount, paid_amount, currency_code, exchange_rate, base_currency_amount, base_currency_paid, status, payment_type, cash_box_id, notes, created_by, updated_by, is_pos, shift_id)
        VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5::date, $6::numeric, $7::numeric, $8::numeric, $9::numeric, $10::numeric, $11::varchar, $12::numeric, $13::numeric, $14::numeric, 'draft', $15::varchar, $16::uuid, $17, $18::uuid, $19::uuid, true, $20::uuid)
        RETURNING id)`;
      const lineValues: string[] = [];
      for (const line of input.lines) {
        const off = params.length;
        const usnap = snapshotLineUnit(line);
        lineValues.push(`($${off + 1}::uuid, $${off + 2}::uuid, $${off + 3}::numeric, $${off + 4}::numeric, $${off + 5}::numeric, $${off + 6}::numeric, $${off + 7}::numeric, $${off + 8}::uuid, $${off + 9}::numeric, $${off + 10}::numeric, $${off + 11}::numeric)`);
        params.push(invoiceId, line.productId, line.quantity, line.unitPrice, line.discountPercent ?? 0, line.vatPercent ?? 0, line.lineTotal, usnap.unitId, usnap.unitFactor, usnap.baseQuantity ?? line.quantity, costByProduct.get(line.productId) || 0);
        // Phase 1: unit_cost appended LAST (append-at-end rule) — posting-time
        // cost basis frozen per base unit for exact return reversals later.
        const lineUnitCost = posUnitCosts.get(String(line.productId)) || 0;
        lineValues.push(`($${off + 1}::uuid, $${off + 2}::uuid, $${off + 3}::numeric, $${off + 4}::numeric, $${off + 5}::numeric, $${off + 6}::numeric, $${off + 7}::numeric, $${off + 8}::uuid, $${off + 9}::numeric, $${off + 10}::numeric, $${off + 11}::numeric)`);
        params.push(invoiceId, line.productId, line.quantity, line.unitPrice, line.discountPercent ?? 0, line.vatPercent ?? 0, line.lineTotal, usnap.unitId, usnap.unitFactor, usnap.baseQuantity ?? line.quantity, lineUnitCost);
      }
      sql += `, lines_ins AS (INSERT INTO sales_invoice_lines
        (invoice_id, product_id, quantity, unit_price, discount_percent, vat_percent, line_total, unit_id, unit_factor, base_quantity, unit_cost)
        SELECT v.invoice_id, v.product_id, v.quantity, v.unit_price, v.discount_percent, v.vat_percent, v.line_total, v.unit_id, v.unit_factor, v.base_quantity, v.unit_cost
        FROM inv JOIN (VALUES ${lineValues.join(',')}) v(invoice_id, product_id, quantity, unit_price, discount_percent, vat_percent, line_total, unit_id, unit_factor, base_quantity, unit_cost) ON true)`;
      sql += ' SELECT id FROM inv';

      // Guard TOCTOU: re-validate shift is still open INSIDE the atomic transaction
      // and lock it (FOR UPDATE) so a concurrent closeShift cannot race.
      // PGlite evaluates CASE branches eagerly, so `CASE WHEN EXISTS THEN 1 ELSE 1/0`
      // always throws — use a dynamic count check instead.
      const txQueries: TxStatement[] = [
        {
          sql: `WITH guard AS (SELECT id FROM pos_shifts WHERE id=$1::uuid AND company_id=$2::uuid AND status='open' FOR UPDATE) SELECT 1 / (SELECT COUNT(*) FROM guard) AS ok`,
          params: [input.shiftId, input.companyId],
        },
        { sql, params },
      ];

      // Statement B — POS payment legs (one row per method actually used).
      const payParams: unknown[] = [input.companyId, input.shiftId, invoiceId, input.cashBoxId, safeUser];
      const payValues: string[] = [];
      if (input.cashAmount > 0) {
        payValues.push(`($1::uuid, $2::uuid, $3::uuid, 'cash', $${payParams.length + 1}::numeric, $4::uuid, $5::uuid)`);
        payParams.push(input.cashAmount);
      }
      if (input.creditAmount > 0) {
        payValues.push(`($1::uuid, $2::uuid, $3::uuid, 'credit', $${payParams.length + 1}::numeric, $4::uuid, $5::uuid)`);
        payParams.push(input.creditAmount);
      }
      txQueries.push({
        sql: `INSERT INTO pos_payments (company_id, shift_id, invoice_id, method, amount, cash_box_id, created_by) VALUES ${payValues.join(', ')}`,
        params: payParams,
      });

      // Statement C — journal entry (mixed cash/credit + explicit discount + perpetual COGS).
      // Statement C — journal entry (mixed cash/credit) + COGS companion.
      txQueries.push(...buildPosSalePostingStatements(
        input.companyId,
        {
          invoiceNumber: receiptNumber,
          receiptNumber,
          date,
          subtotal: input.subtotal,
          vatAmount: input.vatAmount ?? 0,
          totalAmount: input.totalAmount,
          cashAmount: input.cashAmount,
          creditAmount: input.creditAmount,
          cashAccountId,
          cogsAmount,
          discountAmount,
          grossSubtotal,
        },
        { debtors: accounts.ids.default_debtors, sales: accounts.ids.default_sales, vat: accounts.ids.default_vat_output, cogs: accounts.ids.default_cogs, inventory: accounts.ids.default_inventory, discount: discountId },
        posCogsTotal > 0
          ? { total: posCogsTotal, inventoryAccount: accounts.ids.default_inventory, cogsAccount: accounts.ids.default_cogs }
          : undefined
      ));

      // FIFO layer consumption rides the same atomic batch.
      if (posFifo.length > 0) {
        txQueries.push(...buildFifoConsumeStatements(input.companyId, posFifo).map((s) => ({ sql: s.sql, params: (s.params ?? []) as unknown[] })));
      }

      // Statements D/E/F — stock (identical SQL to salesApi.postInvoice).
      // Phase 4: default source warehouse preferred (validated, may be null).
      const { resolveDefaultWarehouse: resolvePosWh } = await import('@/core/utils/stockPolicy');
      const posPreferredWh = await resolvePosWh(input.companyId, 'issue', adapter);
      txQueries.push(...buildEnsureStockStatements(invoiceId, input.companyId, posPreferredWh));
      txQueries.push(...buildStockOutStatements(invoiceId, input.companyId, `إيصال نقطة بيع ${receiptNumber}`, posPreferredWh));
      txQueries.push(...buildDecrementStockStatements(invoiceId, input.companyId, posPreferredWh));

      // Statement G — status flip (paid when nothing outstanding).
      const outstanding = input.totalAmount - input.cashAmount;
      if (outstanding <= 0.0001) {
        txQueries.push({
          sql: `UPDATE sales_invoices SET status = 'paid', updated_by = $3::uuid, updated_at = NOW() WHERE id = $1::uuid AND company_id = $2::uuid`,
          params: [invoiceId, input.companyId, safeUser],
        });
      } else {
        txQueries.push({
          sql: `UPDATE sales_invoices SET status = 'posted', updated_by = $3::uuid, updated_at = NOW() WHERE id = $1::uuid AND company_id = $2::uuid`,
          params: [invoiceId, input.companyId, safeUser],
        });
        // Credit part moves to the customer's balance (Dr Debtors is booked
        // by the JE; the ledger column must follow it).
        if (normalizedCustomerId) {
          txQueries.push({
            sql: `UPDATE customers SET balance = balance + $1, updated_by = $4::uuid, updated_at = NOW() WHERE id = $2::uuid AND company_id = $3::uuid`,
            params: [outstanding, normalizedCustomerId, input.companyId, safeUser],
          });
        }
      }

      const txResult = await runTransaction(txQueries);
      if (!txResult.success) {
        const msg = String(txResult.error || '');
        if (msg.includes('division by zero') || msg.includes('1/0')) {
          return { success: false, error: 'Shift was closed during checkout — please open a new shift and retry.' };
        }
        return { success: false, error: txResult.error };
      }
      return {
        success: true,
        invoiceId,
        receiptNumber,
        change: 0, // change display is computed client-side before submit
      };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },
};
