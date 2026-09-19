import { z } from 'zod';
import { getDbAdapter, isElectronPg } from '@/core/database/adapters';
import { mapRows, toDateString } from '@/core/utils/mapPgRow';
import { safeUserId, resolveExistingUserId } from '@/core/utils/userIdValidator';
import { validateInput, idCompanySchema, companyIdSchema, uuidSchema, createCustomerSchema, createInvoiceSchema, createQuotationSchema, createSalesReturnSchema } from '@/core/utils/validation';
import { clampPageArgs, paginatedResult, type PaginatedQueryResult } from '@/core/utils/pagination';
import { YER_CODE } from '@/core/utils/currencyConverter';
import { snapshotLineUnit } from '@/core/utils/unitConversion';
import { getNextDocumentNumber } from '@/core/api';
import { resolvePostingAccounts, getDefaultAccountId, buildSalesInvoicePostingStatements, buildSalesReturnPostingStatements, getCashBoxAccountId as getCashBoxGLAccountId } from '@/core/utils/journalEntryGenerator';
import type { Customer, SalesInvoice, SalesInvoiceLine, Quotation, QuotationLine, SalesReturn, SalesReturnLine, CustomerStatementRow, CustomerArAging, InvoiceAttachment } from './types';

// Typed RPC bridge for Sales (Phase 4 slice 10). In Electron the renderer
// sends a structured payload and the main process derives `company_id` +
// audit `user_id` from the authenticated session — the renderer can never
// touch another company's rows. The fallback path (PGlite / e2e) still
// uses `adapter.query` with explicit `company_id = $N` filters.
type RpcEnvelope = { success: boolean; rows?: Record<string, unknown>[]; error?: string };

async function invokeSalesRpc(method: string, payload: Record<string, unknown> = {}): Promise<RpcEnvelope> {
  const sales = (typeof window !== 'undefined' && window.electronDB?.sales) as
    | Record<string, ((p: Record<string, unknown>) => Promise<RpcEnvelope>) | undefined>
    | undefined;
  const fn = sales?.[method];
  if (!fn) return { success: false, error: 'RPC unavailable' };
  try {
    // `call(sales, ...)` preserves the surface object as `this` so the e2e
    // shim handlers (which call `this._cid()`) resolve the company id.
    return await fn.call(sales, payload);
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function firstId(rows?: Record<string, unknown>[]): string | undefined {
  const first = rows && rows.length > 0 ? rows[0] : undefined;
  return first && 'id' in first && first.id != null ? String(first.id) : undefined;
}

function parseJsonLines(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value as Record<string, unknown>[];
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function parseJsonAttachments(value: unknown): InvoiceAttachment[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is InvoiceAttachment => !!v && typeof v === 'object');
  }
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed)
        ? (parsed.filter((v): v is InvoiceAttachment => !!v && typeof v === 'object') as InvoiceAttachment[])
        : [];
    } catch {
      return [];
    }
  }
  return [];
}

function buildArAging(rows: Record<string, unknown>[]): CustomerArAging[] {
  const map = new Map<string, CustomerArAging>();
  const now = new Date();
  for (const r of rows) {
    const cid = String(r.customer_id);
    const cname = String(r.customer_name);
    const due = Number(r.due_amount) || 0;
    const date = new Date(String(r.aging_date));
    const days = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    const period = days <= 30 ? '0-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : '>90';
    if (!map.has(cid)) {
      map.set(cid, { customerId: cid, customerName: cname, totalDue: 0, buckets: [
        { period: '0-30', amount: 0, count: 0 },
        { period: '31-60', amount: 0, count: 0 },
        { period: '61-90', amount: 0, count: 0 },
        { period: '>90', amount: 0, count: 0 },
      ] });
    }
    const entry = map.get(cid)!;
    entry.totalDue += due;
    const b = entry.buckets.find(x => x.period === period);
    if (b) { b.amount += due; b.count += 1; }
  }
  return Array.from(map.values());
}

export const salesApi = {
  // ─── Customers ────────────────────────────────────────────────────────────
  async getCustomers(companyId: string): Promise<{ success: boolean; data?: Customer[]; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      if (isElectronPg()) {
        const result = await invokeSalesRpc('getCustomers');
        if (!result.success) return { success: false, error: result.error };
        const rows = (result.rows || []).map((r: Record<string, unknown>) => {
          const mapped = mapRows<Customer>([r])[0];
          if (r.computed_balance !== undefined) mapped.balance = Number(r.computed_balance) || 0;
          return mapped;
        });
        return { success: true, data: rows };
      }
      const adapter = await getDbAdapter();
      const result = await adapter.query(
        `SELECT c.*,
                (COALESCE(c.opening_balance,0)
                  + COALESCE((SELECT SUM(COALESCE(i.base_currency_amount, i.total_amount)) FROM sales_invoices i WHERE i.customer_id = c.id AND i.company_id = c.company_id AND i.status <> 'cancelled' AND COALESCE(i.payment_type, 'credit') <> 'cash'),0)
                  - COALESCE((SELECT SUM(COALESCE(rv.base_currency_amount, rv.amount)) FROM receipt_vouchers rv WHERE rv.customer_id = c.id AND rv.company_id = c.company_id AND rv.status = 'posted'),0)
                  - COALESCE((SELECT SUM(pp.amount) FROM pos_payments pp JOIN sales_invoices i ON i.id = pp.invoice_id AND COALESCE(i.payment_type, 'credit') <> 'cash' WHERE pp.company_id = c.company_id AND pp.method = 'cash' AND i.customer_id = c.id AND i.company_id = c.company_id),0)
                 - COALESCE((SELECT SUM(total_amount) FROM sales_returns sr WHERE sr.customer_id = c.id AND sr.company_id = c.company_id AND sr.status = 'posted'),0)
                ) AS computed_balance
         FROM customers c WHERE c.company_id = $1 ORDER BY c.name`,
        [companyId]
      );
      if (result.success) {
        const rows = (result.rows || []).map((r: Record<string, unknown>) => {
          const mapped = mapRows<Customer>([r])[0];
          if (r.computed_balance !== undefined) mapped.balance = Number(r.computed_balance) || 0;
          return mapped;
        });
        return { success: true, data: rows };
      }
      return { success: false, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async getCustomersPaginated(
    companyId: string,
    page: number,
    pageSize: number,
    filters?: { search?: string; isActive?: boolean }
  ): Promise<PaginatedQueryResult<Customer>> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      const { page: p, pageSize: ps, offset } = clampPageArgs(page, pageSize);
      if (isElectronPg()) {
        const result = await invokeSalesRpc('getCustomersPaginated', {
          page: p,
          pageSize: ps,
          search: filters?.search,
          isActive: filters?.isActive,
        });
        if (!result.success) return { success: false, error: result.error };
        const rows = result.rows || [];
        const total = Number(rows[0]?.total_count) || 0;
        const items = rows.map((r: Record<string, unknown>) => {
          const mapped = mapRows<Customer>([r])[0];
          if (r.computed_balance !== undefined) mapped.balance = Number(r.computed_balance) || 0;
          return mapped;
        });
        return { success: true, data: paginatedResult(items, total, p, ps) };
      }
      const adapter = await getDbAdapter();

      const conditions: string[] = ['c.company_id = $1'];
      const params: unknown[] = [companyId];
      if (filters?.isActive !== undefined) {
        params.push(filters.isActive);
        conditions.push(`c.is_active = $${params.length}`);
      }
      if (filters?.search) {
        params.push(`%${filters.search}%`);
        conditions.push(`(c.name ILIKE $${params.length} OR c.phone ILIKE $${params.length} OR c.code ILIKE $${params.length})`);
      }
      const where = conditions.join(' AND ');

      const countResult = await adapter.query(
        `SELECT COUNT(*)::int AS total FROM customers c WHERE ${where}`,
        params
      );
      const total = Number(countResult.rows?.[0]?.total || 0);

      params.push(ps);
      params.push(offset);
      const limitIdx = params.length - 1;
      const offsetIdx = params.length;

      const dataResult = await adapter.query(
        `SELECT c.*,
                (COALESCE(c.opening_balance,0)
                  + COALESCE((SELECT SUM(COALESCE(i.base_currency_amount, i.total_amount)) FROM sales_invoices i WHERE i.customer_id = c.id AND i.company_id = c.company_id AND i.status <> 'cancelled' AND COALESCE(i.payment_type, 'credit') <> 'cash'),0)
                  - COALESCE((SELECT SUM(COALESCE(rv.base_currency_amount, rv.amount)) FROM receipt_vouchers rv WHERE rv.customer_id = c.id AND rv.company_id = c.company_id AND rv.status = 'posted'),0)
                  - COALESCE((SELECT SUM(pp.amount) FROM pos_payments pp JOIN sales_invoices i ON i.id = pp.invoice_id AND COALESCE(i.payment_type, 'credit') <> 'cash' WHERE pp.company_id = c.company_id AND pp.method = 'cash' AND i.customer_id = c.id AND i.company_id = c.company_id),0)
                 - COALESCE((SELECT SUM(total_amount) FROM sales_returns sr WHERE sr.customer_id = c.id AND sr.company_id = c.company_id AND sr.status = 'posted'),0)
                ) AS computed_balance
         FROM customers c WHERE ${where} ORDER BY c.name ASC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        params
      );
      if (!dataResult.success) return { success: false, error: dataResult.error };

      const items = (dataResult.rows || []).map((r: Record<string, unknown>) => {
        const mapped = mapRows<Customer>([r])[0];
        if (r.computed_balance !== undefined) mapped.balance = Number(r.computed_balance) || 0;
        return mapped;
      });
      return { success: true, data: paginatedResult(items, total, p, ps) };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async getCustomerById(id: string, companyId: string): Promise<{ success: boolean; data?: Customer; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      if (isElectronPg()) {
        const result = await invokeSalesRpc('getCustomerById', { id });
        if (!result.success) return { success: false, error: result.error };
        if (!result.rows?.[0]) return { success: false, error: 'Not found' };
        const mapped = mapRows<Customer>(result.rows)[0];
        if ((result.rows[0] as Record<string, unknown>).computed_balance !== undefined) mapped.balance = Number((result.rows[0] as Record<string, unknown>).computed_balance) || 0;
        return { success: true, data: mapped };
      }
      const adapter = await getDbAdapter();
      const result = await adapter.query(
        `SELECT c.*,
                (COALESCE(c.opening_balance,0)
                  + COALESCE((SELECT SUM(COALESCE(i.base_currency_amount, i.total_amount)) FROM sales_invoices i WHERE i.customer_id = c.id AND i.company_id = c.company_id AND i.status <> 'cancelled' AND COALESCE(i.payment_type, 'credit') <> 'cash'),0)
                  - COALESCE((SELECT SUM(COALESCE(rv.base_currency_amount, rv.amount)) FROM receipt_vouchers rv WHERE rv.customer_id = c.id AND rv.company_id = c.company_id AND rv.status = 'posted'),0)
                  - COALESCE((SELECT SUM(pp.amount) FROM pos_payments pp JOIN sales_invoices i ON i.id = pp.invoice_id AND COALESCE(i.payment_type, 'credit') <> 'cash' WHERE pp.company_id = c.company_id AND pp.method = 'cash' AND i.customer_id = c.id AND i.company_id = c.company_id),0)
                 - COALESCE((SELECT SUM(total_amount) FROM sales_returns sr WHERE sr.customer_id = c.id AND sr.company_id = c.company_id AND sr.status = 'posted'),0)
                ) AS computed_balance
         FROM customers c WHERE c.id = $1::uuid AND c.company_id = $2::uuid LIMIT 1`, [id, companyId]);
      if (result.success && result.rows?.[0]) {
        const mapped = mapRows<Customer>([result.rows[0]])[0];
        if ((result.rows[0] as Record<string, unknown>).computed_balance !== undefined) mapped.balance = Number((result.rows[0] as Record<string, unknown>).computed_balance) || 0;
        return { success: true, data: mapped };
      }
      return { success: false, error: result.error || 'Not found' };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async createCustomer(data: Omit<Customer, 'id'>, _userId?: string): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      const validation = validateInput(createCustomerSchema, data);
      if (!validation.success) return { success: false, error: validation.error };

      // توليد رقم تلقائي إذا لم يتم تمريره
      let customerData = data;
      if (!data.code) {
        const seq = await getNextDocumentNumber(data.companyId, 'customer');
        if (seq.success && seq.number) {
          customerData = { ...data, code: seq.number };
        }
      }

      if (isElectronPg()) {
        const result = await invokeSalesRpc('createCustomer', { ...customerData });
        if (!result.success) return { success: false, error: result.error };
        const customerId = firstId(result.rows);
        // Opening balance: post a balanced JE (Dr AR / Cr Opening Equity)
        const opening = Number(customerData.openingBalance) || 0;
        if (customerId && opening > 0 && !customerData.openingBalancePosted) {
          const { postCustomerOpening } = await import('@/core/utils/openingBalance');
          await postCustomerOpening(data.companyId, { id: customerId, name: customerData.name, amount: opening, openingDate: customerData.openingDate });
        }
        return { success: true, id: customerId };
      }
      const adapter = await getDbAdapter();

      const result = await adapter.query(
        `INSERT INTO customers (company_id, code, name, phone, email, address, tax_number, credit_limit, balance, is_active, created_by, updated_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::uuid, $12::uuid) RETURNING id`,
        [customerData.companyId, customerData.code, customerData.name, customerData.phone, customerData.email, customerData.address, customerData.taxNumber, customerData.creditLimit, customerData.balance, customerData.isActive, safeUserId(_userId), safeUserId(_userId)]
      );
      if (result.success && result.rows?.[0]) {
        const customerId = String(result.rows[0].id);
        const opening = Number(customerData.openingBalance) || 0;
        if (opening > 0 && !customerData.openingBalancePosted) {
          const { postCustomerOpening } = await import('@/core/utils/openingBalance');
          await postCustomerOpening(data.companyId, { id: customerId, name: customerData.name, amount: opening, openingDate: customerData.openingDate });
        }
        return { success: true, id: customerId };
      }
      return { success: false, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async updateCustomer(id: string, companyId: string, data: Partial<Omit<Customer, 'id' | 'companyId'>>, _userId?: string): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      if (isElectronPg()) {
        const result = await invokeSalesRpc('updateCustomer', { id, ...data });
        return result.success ? { success: true } : { success: false, error: result.error };
      }
      const adapter = await getDbAdapter();
      const fields: string[] = [];
      const values: unknown[] = [];
      let idx = 1;
      if (data.name !== undefined) { fields.push(`name = $${idx++}`); values.push(data.name); }
      if (data.phone !== undefined) { fields.push(`phone = $${idx++}`); values.push(data.phone); }
      if (data.email !== undefined) { fields.push(`email = $${idx++}`); values.push(data.email); }
      if (data.address !== undefined) { fields.push(`address = $${idx++}`); values.push(data.address); }
      if (data.taxNumber !== undefined) { fields.push(`tax_number = $${idx++}`); values.push(data.taxNumber); }
      if (data.creditLimit !== undefined) { fields.push(`credit_limit = $${idx++}`); values.push(data.creditLimit); }
      if (data.balance !== undefined) { fields.push(`balance = $${idx++}`); values.push(data.balance); }
      if (data.isActive !== undefined) { fields.push(`is_active = $${idx++}`); values.push(data.isActive); }
      fields.push(`updated_by = $${idx++}::uuid`);
      values.push(safeUserId(_userId));
      fields.push(`updated_at = NOW()`);
      values.push(id);
      values.push(companyId);
      const result = await adapter.query(`UPDATE customers SET ${fields.join(', ')} WHERE id = $${idx}::uuid AND company_id = $${idx + 1}::uuid`, values);
      return { success: result.success, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async deleteCustomer(id: string, companyId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      if (isElectronPg()) {
        const result = await invokeSalesRpc('deleteCustomer', { id });
        if (result.success) return { success: true };
        const msg = result.error || '';
        if (msg.includes('foreign key') || msg.includes('violates')) {
          return { success: false, error: 'Cannot delete customer with existing invoices, quotations, or returns. Deactivate instead.' };
        }
        return { success: false, error: result.error };
      }
      const adapter = await getDbAdapter();
      const result = await adapter.query('DELETE FROM customers WHERE id = $1::uuid AND company_id = $2::uuid', [id, companyId]);
      if (!result.success) {
        const msg = result.error || '';
        if (msg.includes('foreign key') || msg.includes('violates')) {
          return { success: false, error: 'Cannot delete customer with existing invoices, quotations, or returns. Deactivate instead.' };
        }
        return { success: false, error: result.error };
      }
      return { success: true };
    } catch (e) {
      const msg = String(e);
      if (msg.includes('foreign key') || msg.includes('violates')) {
        return { success: false, error: 'Cannot delete customer with existing invoices, quotations, or returns. Deactivate instead.' };
      }
      return { success: false, error: msg };
    }
  },

  async getCustomerStatement(customerId: string, companyId: string): Promise<{ success: boolean; data?: CustomerStatementRow[]; error?: string }> {
    try {
      if (!companyId) return { success: false, error: 'companyId is required' };
      const idValidation = validateInput(z.object({ customerId: uuidSchema, companyId: companyIdSchema }), { customerId, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      if (isElectronPg()) {
        const result = await invokeSalesRpc('getCustomerStatement', { customerId });
        return result.success
          ? { success: true, data: mapRows<CustomerStatementRow>(result.rows || []) }
          : { success: false, error: result.error };
      }
      const adapter = await getDbAdapter();
      const result = await adapter.query(
        `WITH entries AS (
          SELECT COALESCE(c.opening_date, DATE '1900-01-01') AS date, 'رصيد افتتاحي'::varchar as document_type, 'OPENING'::varchar as document_number,
                 CASE WHEN c.opening_balance >= 0 THEN c.opening_balance ELSE 0 END AS debit,
                 CASE WHEN c.opening_balance < 0 THEN -c.opening_balance ELSE 0 END AS credit,
                 NULL::text AS notes, 0 AS sort_type
          FROM customers c
          WHERE c.id = $1::uuid AND c.company_id = $2::uuid AND c.opening_balance <> 0
          UNION ALL
          SELECT date, 'فاتورة'::varchar as document_type, invoice_number as document_number,
                 total_amount as debit, 0::numeric as credit, notes,
                 1 as sort_type
          FROM sales_invoices
          WHERE customer_id = $1::uuid AND company_id = $2::uuid AND status <> 'cancelled' AND COALESCE(payment_type, 'credit') <> 'cash'
          UNION ALL
          SELECT i.date, 'نقدية نقطة بيع'::varchar as document_type, i.invoice_number as document_number,
                 0::numeric as debit, pp.amount as credit, NULL::text as notes,
                 4 as sort_type
          FROM pos_payments pp
          JOIN sales_invoices i ON i.id = pp.invoice_id AND COALESCE(i.payment_type, 'credit') <> 'cash'
          WHERE pp.company_id = $2::uuid AND pp.method = 'cash' AND i.customer_id = $1::uuid AND i.company_id = $2::uuid
          UNION ALL
          SELECT date, 'مردود'::varchar as document_type, return_number as document_number,
                 0::numeric as debit, total_amount as credit, reason as notes,
                 2 as sort_type
          FROM sales_returns
          WHERE customer_id = $1::uuid AND company_id = $2::uuid AND status = 'posted'
          UNION ALL
          SELECT date, 'سند قبض'::varchar as document_type, voucher_number as document_number,
                 0::numeric as debit, amount as credit, notes,
                 3 as sort_type
          FROM receipt_vouchers
          WHERE customer_id = $1::uuid AND company_id = $2::uuid AND status = 'posted'
        )
        SELECT date, document_type, document_number, debit, credit,
               SUM(debit - credit) OVER (ORDER BY date, sort_type, document_number) as balance,
               notes
        FROM entries
        ORDER BY date, sort_type, document_number`,
        [customerId, companyId]
      );
      if (result.success) return { success: true, data: mapRows<CustomerStatementRow>(result.rows) };
      return { success: false, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async getCustomerArAging(companyId: string): Promise<{ success: boolean; data?: CustomerArAging[]; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      if (isElectronPg()) {
        const result = await invokeSalesRpc('getCustomerArAging');
        if (!result.success) return { success: false, error: result.error };
        return { success: true, data: buildArAging(result.rows || []) };
      }
      const adapter = await getDbAdapter();
      // Aging = opening + outstanding invoices - posted receipts - posted returns.
      // An undated opening is the OLDEST debt → >90 bucket.
      const result = await adapter.query(
        `SELECT c.id as customer_id, c.name as customer_name, (i.total_amount - COALESCE(i.paid_amount,0)) as due_amount, COALESCE(i.due_date, i.date) as aging_date
        FROM customers c
        JOIN sales_invoices i ON i.customer_id = c.id
        WHERE c.company_id = $1 AND i.company_id = $1 AND i.status IN ('posted', 'partially_paid') AND (i.total_amount - COALESCE(i.paid_amount,0)) > 0 AND COALESCE(i.payment_type, 'credit') <> 'cash'
        UNION ALL
        SELECT c.id as customer_id, c.name as customer_name, c.opening_balance as due_amount, COALESCE(c.opening_date, DATE '1900-01-01') as aging_date
        FROM customers c
        WHERE c.company_id = $1 AND c.opening_balance > 0
        UNION ALL
        SELECT c.id as customer_id, c.name as customer_name, -rv.amount as due_amount, rv.date as aging_date
        FROM customers c JOIN receipt_vouchers rv ON rv.customer_id = c.id
        WHERE c.company_id = $1 AND rv.company_id = $1 AND rv.status = 'posted'
        UNION ALL
        SELECT c.id as customer_id, c.name as customer_name, -sr.total_amount as due_amount, sr.date as aging_date
        FROM customers c JOIN sales_returns sr ON sr.customer_id = c.id
        WHERE c.company_id = $1 AND sr.company_id = $1 AND sr.status = 'posted'`,
        [companyId]
      );
      if (!result.success) return { success: false, error: result.error };
      return { success: true, data: buildArAging((result.rows || []) as Array<Record<string, unknown>>) };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  // ─── Sales Invoices ───────────────────────────────────────────────────────
  async getInvoices(companyId: string): Promise<{ success: boolean; data?: SalesInvoice[]; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      if (isElectronPg()) {
        const result = await invokeSalesRpc('getInvoices');
        return result.success
          ? { success: true, data: (result.rows || []).map((row: Record<string, unknown>) => mapInvoiceRow(row)) }
          : { success: false, error: result.error };
      }
      const adapter = await getDbAdapter();
      const result = await adapter.query(
        `SELECT i.*, c.name as customer_name, c.phone as customer_phone, c.email as customer_email, c.address as customer_address, c.tax_number as customer_tax_number, c.balance as customer_balance, c.is_active as customer_is_active
        FROM sales_invoices i
        LEFT JOIN customers c ON i.customer_id = c.id
        WHERE i.company_id = $1
        ORDER BY i.date DESC`,
        [companyId]
      );
      if (!result.success) return { success: false, error: result.error };
      const invoices = (result.rows || []).map((row: Record<string, unknown>) => mapInvoiceRow(row));
      return { success: true, data: invoices };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async getOutstandingInvoicesForCustomer(companyId: string, customerId: string): Promise<{ success: boolean; data?: SalesInvoice[]; error?: string }> {
    try {
      if (!companyId) {
        return { success: false, error: 'companyId is required' };
      }
      if (!customerId) {
        return { success: false, error: 'customerId is required' };
      }
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      const cuValidation = validateInput(uuidSchema, customerId);
      if (!cuValidation.success) return { success: false, error: cuValidation.error };
      if (isElectronPg()) {
        const result = await invokeSalesRpc('getOutstandingInvoicesForCustomer', { customerId });
        return result.success
          ? { success: true, data: (result.rows || []).map((row: Record<string, unknown>) => mapInvoiceRow(row)) }
          : { success: false, error: result.error };
      }
      const adapter = await getDbAdapter();
      const result = await adapter.query(
        `SELECT i.*, c.name as customer_name
         FROM sales_invoices i
         LEFT JOIN customers c ON i.customer_id = c.id
         WHERE i.company_id = $1::uuid
           AND i.customer_id = $2::uuid
           AND i.status IN ('posted', 'partially_paid')
           AND (i.total_amount - COALESCE(i.paid_amount, 0)) > 0
         ORDER BY i.date ASC`,
        [companyId, customerId]
      );
      if (!result.success) return { success: false, error: result.error };
      const items = (result.rows || []).map((row: Record<string, unknown>) => mapInvoiceRow(row));
      return { success: true, data: items };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async getPostedInvoicesWithLines(companyId: string): Promise<{ success: boolean; data?: SalesInvoice[]; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      if (isElectronPg()) {
        const result = await invokeSalesRpc('getPostedInvoicesWithLines');
        if (!result.success) return { success: false, error: result.error };
        const invoices = (result.rows || []).map((row: Record<string, unknown>) => {
          const inv = mapInvoiceRow(row);
          inv.lines = parseJsonLines(row.lines).map((r) => mapInvoiceLineRow(r));
          return inv;
        });
        return { success: true, data: invoices };
      }
      const adapter = await getDbAdapter();
      const headersRes = await adapter.query(
        `SELECT i.*, c.name as customer_name
         FROM sales_invoices i
         LEFT JOIN customers c ON i.customer_id = c.id
         WHERE i.company_id = $1 AND i.status IN ('posted', 'partially_paid', 'paid')
         ORDER BY i.date DESC`,
        [companyId]
      );
      if (!headersRes.success) return { success: false, error: headersRes.error };
      const linesRes = await adapter.query(
        `SELECT l.*, p.name_ar as product_name
         FROM sales_invoice_lines l
         LEFT JOIN products p ON l.product_id = p.id
         JOIN sales_invoices i ON l.invoice_id = i.id
         WHERE i.company_id = $1`,
        [companyId]
      );
      const linesByInvoice = new Map<string, SalesInvoiceLine[]>();
      for (const row of (linesRes.rows || []) as Record<string, unknown>[]) {
        const invId = String(row.invoice_id);
        const line = mapInvoiceLineRow(row);
        const list = linesByInvoice.get(invId) || [];
        list.push(line);
        linesByInvoice.set(invId, list);
      }
      const invoices = (headersRes.rows || []).map((row: Record<string, unknown>) => {
        const inv = mapInvoiceRow(row);
        inv.lines = linesByInvoice.get(inv.id) || [];
        return inv;
      });
      return { success: true, data: invoices };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async getInvoicesPaginated(
    companyId: string,
    page: number,
    pageSize: number,
    filters?: { status?: string; customerId?: string; createdBy?: string; invoiceNumber?: string }
  ): Promise<PaginatedQueryResult<SalesInvoice>> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      const { page: p, pageSize: ps, offset } = clampPageArgs(page, pageSize);
      if (isElectronPg()) {
        const result = await invokeSalesRpc('getInvoicesPaginated', {
          page: p,
          pageSize: ps,
          status: filters?.status,
          customerId: filters?.customerId,
          createdBy: filters?.createdBy,
          invoiceNumber: filters?.invoiceNumber,
        });
        if (!result.success) return { success: false, error: result.error };
        const rows = result.rows || [];
        const total = Number(rows[0]?.total_count) || 0;
        const items = rows.map((row: Record<string, unknown>) => mapInvoiceRow(row));
        return { success: true, data: paginatedResult(items, total, p, ps) };
      }
      const adapter = await getDbAdapter();

      const conditions: string[] = ['i.company_id = $1'];
      const params: unknown[] = [companyId];
      if (filters?.status) {
        params.push(filters.status);
        conditions.push(`i.status = $${params.length}`);
      }
      if (filters?.customerId) {
        params.push(filters.customerId);
        conditions.push(`i.customer_id = $${params.length}`);
      }
      if (filters?.createdBy) {
        params.push(filters.createdBy);
        conditions.push(`(i.created_by = $${params.length} OR i.created_by IS NULL)`);
      }
      // P2: server-side document-number search — invoice numbers are ASCII
      // codes (no Arabic-normalization trap), so ILIKE here is exact where
      // the client-side fuzzy window (newest 200) went blind beyond it.
      if (filters?.invoiceNumber) {
        params.push(filters.invoiceNumber);
        conditions.push(`i.invoice_number ILIKE '%' || $${params.length} || '%'`);
      }
      const where = conditions.join(' AND ');

      const countResult = await adapter.query(
        `SELECT COUNT(*)::int AS total FROM sales_invoices i WHERE ${where}`,
        params
      );
      const total = Number(countResult.rows?.[0]?.total || 0);

      params.push(ps);
      params.push(offset);
      const limitIdx = params.length - 1;
      const offsetIdx = params.length;

      const dataResult = await adapter.query(
        `SELECT i.*, c.name as customer_name, c.phone as customer_phone, c.email as customer_email, c.address as customer_address, c.tax_number as customer_tax_number, c.balance as customer_balance, c.is_active as customer_is_active
         FROM sales_invoices i
         LEFT JOIN customers c ON i.customer_id = c.id
         WHERE ${where}
         ORDER BY i.date DESC
         LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        params
      );
      if (!dataResult.success) return { success: false, error: dataResult.error };

      const items = (dataResult.rows || []).map((row: Record<string, unknown>) => mapInvoiceRow(row));
      return { success: true, data: paginatedResult(items, total, p, ps) };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async getInvoiceById(id: string, companyId: string): Promise<{ success: boolean; data?: SalesInvoice; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      if (isElectronPg()) {
        const result = await invokeSalesRpc('getInvoiceById', { id });
        if (!result.success) return { success: false, error: result.error };
        if (!result.rows?.[0]) return { success: false, error: 'Not found' };
        const row = result.rows[0];
        const invoice = mapInvoiceRow(row);
        invoice.lines = parseJsonLines(row.lines).map((r) => mapInvoiceLineRow(r));
        return { success: true, data: invoice };
      }
      const adapter = await getDbAdapter();
      const invResult = await adapter.query(
        `SELECT i.*, c.name as customer_name, c.phone as customer_phone, c.email as customer_email, c.address as customer_address, c.tax_number as customer_tax_number, c.balance as customer_balance, c.is_active as customer_is_active
        FROM sales_invoices i
        LEFT JOIN customers c ON i.customer_id = c.id
        WHERE i.id = $1 AND i.company_id = $2 LIMIT 1`, [id, companyId]
      );
      if (!invResult.success || !invResult.rows?.[0]) return { success: false, error: invResult.error || 'Not found' };
      const invoice = mapInvoiceRow(invResult.rows[0]);
      const linesResult = await adapter.query(
        `SELECT l.*, p.name_ar as product_name, p.code as product_code, p.barcode, p.sku, p.unit
         FROM sales_invoice_lines l
         LEFT JOIN products p ON l.product_id = p.id
         WHERE l.invoice_id = $1`, [id]
      );
      invoice.lines = (linesResult.rows || []).map((r: Record<string, unknown>) => mapInvoiceLineRow(r));
      return { success: true, data: invoice };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async createInvoice(data: Omit<SalesInvoice, 'id'>, _userId?: string): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      const validation = validateInput(createInvoiceSchema, data);
      if (!validation.success) return { success: false, error: validation.error };
      if ((data.paidAmount ?? 0) > data.totalAmount) {
        return { success: false, error: 'Paid amount cannot exceed total amount.' };
      }
      if (data.exchangeRate !== undefined && data.exchangeRate <= 0) {
        return { success: false, error: 'Exchange rate must be positive.' };
      }
      const invoiceCurrency = data.currencyCode || YER_CODE;
      const invoiceRate = data.exchangeRate ?? 1;
      if (isElectronPg()) {
        const result = await invokeSalesRpc('createInvoice', {
          ...data,
          currencyCode: invoiceCurrency,
          exchangeRate: invoiceRate,
          baseCurrencyAmount: data.baseCurrencyAmount ?? (data.totalAmount * invoiceRate),
          baseCurrencyPaid: data.baseCurrencyPaid ?? ((data.paidAmount ?? 0) * invoiceRate),
        });
        return result.success
          ? { success: true, id: firstId(result.rows) }
          : { success: false, error: result.error };
      }
      const adapter = await getDbAdapter();
      const invoiceId = crypto.randomUUID();
      const baseCurrencyAmount = data.baseCurrencyAmount ?? (data.totalAmount * invoiceRate);
      const baseCurrencyPaid = data.baseCurrencyPaid ?? ((data.paidAmount ?? 0) * invoiceRate);
      const params: unknown[] = [
        invoiceId,
        data.companyId,
        data.invoiceNumber,
        data.customerId,
        data.date,
        data.dueDate || null,
        data.subtotal,
        data.discountAmount,
        data.vatAmount,
        data.totalAmount,
        data.paidAmount,
        invoiceCurrency,
        invoiceRate,
        baseCurrencyAmount,
        baseCurrencyPaid,
        data.status,
        data.paymentType || 'credit',
        data.cashBoxId || null,
        data.notes,
        safeUserId(_userId),
        safeUserId(_userId),
        JSON.stringify(data.attachments ?? []),
      ];
      let sql = `WITH inv AS (INSERT INTO sales_invoices (id,company_id,invoice_number,customer_id,date,due_date,subtotal,discount_amount,vat_amount,total_amount,paid_amount,currency_code,exchange_rate,base_currency_amount,base_currency_paid,status,payment_type,cash_box_id,notes,created_by,updated_by,attachments) VALUES ($1::uuid,$2::uuid,$3,$4::uuid,$5::date,$6::date,$7::numeric,$8::numeric,$9::numeric,$10::numeric,$11::numeric,$12::varchar,$13::numeric,$14::numeric,$15::numeric,$16::varchar,$17,$18::uuid,$19,$20::uuid,$21::uuid,$22::jsonb) RETURNING id)`;
      if (data.lines?.length) {
        const lineValues: string[] = [];
        for (const line of data.lines) {
          const off = params.length;
          const usnap = snapshotLineUnit(line);
          lineValues.push(`($${off + 1}::uuid,$${off + 2}::uuid,$${off + 3}::numeric,$${off + 4}::numeric,$${off + 5}::numeric,$${off + 6}::numeric,$${off + 7}::numeric,$${off + 8}::varchar,$${off + 9}::numeric,$${off + 10}::numeric,$${off + 11}::uuid,$${off + 12}::numeric,$${off + 13}::numeric)`);
          const lineCurrencyCode = line.currencyCode || invoiceCurrency;
          const lineExchangeRate = line.exchangeRate ?? invoiceRate;
          const lineBaseTotal = line.baseCurrencyLineTotal ?? (line.lineTotal * lineExchangeRate);
          params.push(invoiceId, line.productId, line.quantity, line.unitPrice, line.discountPercent, line.vatPercent, line.lineTotal, lineCurrencyCode, lineExchangeRate, lineBaseTotal, usnap.unitId, usnap.unitFactor, usnap.baseQuantity);
        }
        // Sale-time cost snapshot (perpetual COGS, IAS 2): resolved live from
        // products inside the same statement — server-side truth, zero new
        // params, no placeholder renumbering. Zeros still backfill at post.
        sql += `,lines_ins AS (INSERT INTO sales_invoice_lines (invoice_id,product_id,quantity,unit_price,discount_percent,vat_percent,line_total,currency_code,exchange_rate,base_currency_line_total,unit_id,unit_factor,base_quantity,unit_cost) SELECT v.invoice_id,v.product_id,v.quantity,v.unit_price,v.discount_percent,v.vat_percent,v.line_total,v.currency_code,v.exchange_rate,v.base_currency_line_total,v.unit_id,v.unit_factor,v.base_quantity,COALESCE(p.cost_price,0) FROM inv JOIN (VALUES ${lineValues.join(',')}) v(invoice_id,product_id,quantity,unit_price,discount_percent,vat_percent,line_total,currency_code,exchange_rate,base_currency_line_total,unit_id,unit_factor,base_quantity) ON true LEFT JOIN products p ON p.id = v.product_id AND p.company_id = $2::uuid)`;
      }
      sql += ' SELECT id FROM inv';
      const result = await adapter.query(sql, params);
      if (result.success && result.rows?.[0]) {
        return { success: true, id: result.rows[0].id as string };
      }
      return { success: false, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async updateInvoice(id: string, companyId: string, data: Partial<Omit<SalesInvoice, 'id' | 'companyId' | 'lines'>> & { lines?: SalesInvoiceLine[] }, _userId?: string): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      if (isElectronPg()) {
        const result = await invokeSalesRpc('updateInvoice', { data: { id, ...data } });
        return result.success ? { success: true } : { success: false, error: result.error };
      }
      const adapter = await getDbAdapter();
      const check = await adapter.query(
        'SELECT status, paid_amount FROM sales_invoices WHERE id = $1::uuid AND company_id = $2::uuid',
        [id, companyId]
      );
      if (!check.success || !check.rows?.[0]) {
        return { success: false, error: 'Invoice not found' };
      }
      const inv = check.rows[0] as Record<string, unknown>;
      const status = String(inv.status);
      const paidAmount = Number(inv.paid_amount) || 0;
      if (status !== 'draft' && data.lines !== undefined) {
        return { success: false, error: 'Cannot modify lines of posted invoice. Cancel it first.' };
      }
      if (status !== 'draft' && data.paidAmount !== undefined && data.paidAmount < paidAmount) {
        return { success: false, error: 'Cannot reduce paid amount below current payments.' };
      }
      const fields: string[] = [];
      const values: unknown[] = [];
      let idx = 1;
      if (data.customerId !== undefined) { fields.push(`customer_id = $${idx++}`); values.push(data.customerId); }
      if (data.date !== undefined) { fields.push(`date = $${idx++}`); values.push(data.date); }
      if (data.dueDate !== undefined) { fields.push(`due_date = $${idx++}`); values.push(data.dueDate); }
      if (data.subtotal !== undefined) { fields.push(`subtotal = $${idx++}`); values.push(data.subtotal); }
      if (data.discountAmount !== undefined) { fields.push(`discount_amount = $${idx++}`); values.push(data.discountAmount); }
      if (data.vatAmount !== undefined) { fields.push(`vat_amount = $${idx++}`); values.push(data.vatAmount); }
      if (data.totalAmount !== undefined) { fields.push(`total_amount = $${idx++}`); values.push(data.totalAmount); }
      if (data.paidAmount !== undefined) { fields.push(`paid_amount = $${idx++}`); values.push(data.paidAmount); }
      if (data.currencyCode !== undefined) { fields.push(`currency_code = $${idx++}`); values.push(data.currencyCode); }
      if (data.exchangeRate !== undefined) { fields.push(`exchange_rate = $${idx++}`); values.push(data.exchangeRate); }
      if (data.baseCurrencyAmount !== undefined) { fields.push(`base_currency_amount = $${idx++}`); values.push(data.baseCurrencyAmount); }
      if (data.baseCurrencyPaid !== undefined) { fields.push(`base_currency_paid = $${idx++}`); values.push(data.baseCurrencyPaid); }
      if (data.status !== undefined) { fields.push(`status = $${idx++}`); values.push(data.status); }
      if (data.paymentType !== undefined) { fields.push(`payment_type = $${idx++}`); values.push(data.paymentType); }
      if (data.cashBoxId !== undefined) { fields.push(`cash_box_id = $${idx++}::uuid`); values.push(data.cashBoxId || null); }
      if (data.notes !== undefined) { fields.push(`notes = $${idx++}`); values.push(data.notes); }
      if (data.attachments !== undefined) { fields.push(`attachments = $${idx++}::jsonb`); values.push(JSON.stringify(data.attachments ?? [])); }
      fields.push(`updated_by = $${idx++}::uuid`);
      values.push(safeUserId(_userId));
      fields.push(`updated_at = NOW()`);
      if (fields.length > 0) {
        values.push(id);
        values.push(companyId);
        await adapter.query(`UPDATE sales_invoices SET ${fields.join(', ')} WHERE id = $${idx}::uuid AND company_id = $${idx + 1}::uuid`, values);
      }
      if (data.lines) {
        await adapter.query('DELETE FROM sales_invoice_lines WHERE invoice_id = $1 AND $2::uuid = (SELECT company_id FROM sales_invoices WHERE id = $1)', [id, companyId]);
        const lineValues = data.lines.map((_: typeof data.lines[0], i: number) => {
          const off = i * 13;
          return `($${off + 1}::uuid, $${off + 2}::uuid, $${off + 3}, $${off + 4}, $${off + 5}, $${off + 6}, $${off + 7}, $${off + 8}, $${off + 9}, $${off + 10}, $${off + 11}::uuid, $${off + 12}, $${off + 13})`;
        }).join(', ');
        const lineParams = data.lines.flatMap((line: typeof data.lines[0]) => {
          const lineCurrencyCode = line.currencyCode || data.currencyCode || YER_CODE;
          const lineExchangeRate = line.exchangeRate ?? data.exchangeRate ?? 1;
          const lineBaseTotal = line.baseCurrencyLineTotal ?? (line.lineTotal * lineExchangeRate);
          const usnap = snapshotLineUnit(line);
          return [id, line.productId, line.quantity, line.unitPrice, line.discountPercent, line.vatPercent, line.lineTotal, lineCurrencyCode, lineExchangeRate, lineBaseTotal, usnap.unitId, usnap.unitFactor, usnap.baseQuantity];
        });
        // Sale-time cost snapshot (same semantics as createInvoice): resolved
        // live from products — draft edits re-freeze the cost.
        lineParams.push(companyId);
        const costCidIdx = lineParams.length;
        await adapter.query(
          `INSERT INTO sales_invoice_lines (invoice_id, product_id, quantity, unit_price, discount_percent, vat_percent, line_total, currency_code, exchange_rate, base_currency_line_total, unit_id, unit_factor, base_quantity, unit_cost) SELECT v.*, COALESCE(p.cost_price, 0) FROM (VALUES ${lineValues}) v(invoice_id, product_id, quantity, unit_price, discount_percent, vat_percent, line_total, currency_code, exchange_rate, base_currency_line_total, unit_id, unit_factor, base_quantity) LEFT JOIN products p ON p.id = v.product_id AND p.company_id = $${costCidIdx}::uuid`,
          lineParams
        );
      }
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async deleteInvoice(id: string, companyId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      if (isElectronPg()) {
        const result = await invokeSalesRpc('deleteInvoice', { id });
        if (!result.success) return { success: false, error: result.error };
        const row = result.rows?.[0];
        if (!row) return { success: false, error: 'Invoice not found' };
        if (String(row.status) !== 'draft') {
          return { success: false, error: 'Cannot delete posted invoice. Cancel it first.' };
        }
        if (Number(row.paid_amount) > 0) {
          return { success: false, error: 'Cannot delete invoice with payments. Refund the payment first.' };
        }
        return { success: true };
      }
      const adapter = await getDbAdapter();
      const check = await adapter.query(
        'SELECT status, paid_amount FROM sales_invoices WHERE id = $1::uuid AND company_id = $2::uuid',
        [id, companyId]
      );
      if (!check.success || !check.rows?.[0]) {
        return { success: false, error: 'Invoice not found' };
      }
      const inv = check.rows[0] as Record<string, unknown>;
      if (inv.status !== 'draft') {
        return { success: false, error: 'Cannot delete posted invoice. Cancel it first.' };
      }
      if (Number(inv.paid_amount) > 0) {
        return { success: false, error: 'Cannot delete invoice with payments. Refund the payment first.' };
      }
      const result = await adapter.query('DELETE FROM sales_invoices WHERE id = $1::uuid AND company_id = $2::uuid', [id, companyId]);
      return { success: result.success, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async postInvoice(id: string, companyId: string, _userId?: string): Promise<{ success: boolean; error?: string; cogsAmount?: number; zeroCostLines?: number }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      const adapter = await getDbAdapter();

      // ── Unified atomic contract (single code path, no Electron/fallback split):
      // fetch draft → build JE statements → ONE transaction that commits the
      // journal entry, the status flip and the customer balance together.
        const check = await adapter.query(
         'SELECT customer_id, total_amount, paid_amount, subtotal, discount_amount, vat_amount, invoice_number, date, payment_type, cash_box_id, base_currency_amount, exchange_rate FROM sales_invoices WHERE id = $1::uuid AND company_id = $2::uuid AND status = $3',
          [id, companyId, 'draft']
        );
      if (!check.success || !check.rows?.[0]) {
        return { success: false, error: 'Invoice not found or not in draft status' };
      }
      const inv = check.rows[0] as Record<string, unknown>;
      // Phase 3: closed/filing tax periods are immutable — backdated posting
      // into them would silently rewrite a filed VAT return.
      const { assertPeriodOpen } = await import('@/modules/tax/engine');
      const periodGate = await assertPeriodOpen(companyId, toDateString(inv.date) || '', adapter);
      if (!periodGate.open) {
        return { success: false, error: `الفترة الضريبية مغلقة (${periodGate.period.startDate} – ${periodGate.period.endDate}) — لا يمكن الترحيل بتاريخ داخلها` };
      }
      // Phase 5: a closed fiscal year locks its dates for every posting path.
      const { assertAccountingPeriodOpen: assertFiscalOpen } = await import('@/modules/accounting/yearEnd');
      const fiscalGate = await assertFiscalOpen(companyId, toDateString(inv.date) || '', adapter);
      if (!fiscalGate.open) {
        return { success: false, error: `السنة المالية ${fiscalGate.period.year} مقفلة — لا يمكن الترحيل بتاريخ داخلها` };
      }
      const customerId = String(inv.customer_id);
      const totalAmount = Number(inv.total_amount) || 0;
      const paymentType = String(inv.payment_type || 'credit');
      const cashBoxId = inv.cash_box_id ? String(inv.cash_box_id) : null;
      // A CASH invoice is fully paid the moment it exists — the sale itself
      // IS the payment (Dr treasury / Cr sales). It must never touch the
      // customer balance nor linger as receivable.
      const paidAmount = paymentType === 'cash' ? totalAmount : (Number(inv.paid_amount) || 0);
      const outstanding = paymentType === 'cash' ? 0 : (totalAmount - paidAmount);
      // Verify the userId exists in the users table. A stale localStorage
      // session may reference a user that no longer exists (e.g., after a
      // db:reset) — passing it here would violate the FK constraint
      // `sales_invoices_updated_by_fkey`.
      const safeUserIdValue = await resolveExistingUserId(adapter, _userId, companyId);

      // Perpetual COGS (IAS 2): freeze any missing sale-time cost snapshots
      // from the live moving-average cost, then value what leaves stock.
      // One round trip: the UPDATE backfills, the SELECT aggregates.
      const cogsRes = await adapter.query(
        `WITH backfill AS (
           UPDATE sales_invoice_lines sil SET unit_cost = COALESCE(p.cost_price, 0)
             FROM products p
            WHERE sil.invoice_id = $1::uuid AND sil.unit_cost = 0
              AND p.id = sil.product_id AND p.company_id = $2::uuid
            RETURNING sil.id
         )
         SELECT COALESCE(SUM(COALESCE(NULLIF(sil.base_quantity, 0), sil.quantity) * sil.unit_cost), 0) AS cogs,
                COUNT(*) FILTER (WHERE sil.unit_cost = 0) AS zero_lines
           FROM sales_invoice_lines sil WHERE sil.invoice_id = $1::uuid`,
        [id, companyId]
      );
      if (!cogsRes.success) return { success: false, error: cogsRes.error };
      const cogsRow = (cogsRes.rows?.[0] || {}) as Record<string, unknown>;
      const cogsAmount = Math.round((Number(cogsRow.cogs) || 0) * 100) / 100;
      // Informational only (never blocking): lines with no cost are usually
      // services — but a stocked product with cost_price = 0 deserves review.
      const zeroCostLines = Number(cogsRow.zero_lines) || 0;

      // Explicit discount (gross method): discount_amount stores line +
      // header discounts while subtotal is net of lines only. The gross
      // sales figure is recovered from the lines — the invoice-level
      // discount alone cannot be derived from the header.
      const subtotal = Number(inv.subtotal) || 0;
      const discountAmount = Math.round((Number(inv.discount_amount) || 0) * 100) / 100;
      const lineDiscRes = await adapter.query(
        `SELECT COALESCE(SUM(quantity * unit_price * COALESCE(discount_percent, 0) / 100), 0) AS line_disc
           FROM sales_invoice_lines WHERE invoice_id = $1::uuid`,
        [id]
      );
      if (!lineDiscRes.success) return { success: false, error: lineDiscRes.error };
      const lineDiscRow = (lineDiscRes.rows?.[0] || {}) as Record<string, unknown>;
      const lineDiscount = Math.round((Number(lineDiscRow.line_disc) || 0) * 100) / 100;
      const grossSubtotal = Math.round((subtotal + lineDiscount) * 100) / 100;
      // ── Phase 1 (IAS 2): perpetual COGS. Resolve the posting-time unit
      // cost per base unit (method-aware), freeze it on the lines (returns
      // reverse the ORIGINAL cost), and book Dr COGS / Cr Inventory in the
      // same atomic batch as the revenue JE.
      const saleLinesRes = await adapter.query(
        `SELECT product_id, COALESCE(NULLIF(base_quantity, 0), quantity) AS bq
           FROM sales_invoice_lines WHERE invoice_id = $1`,
        [id]
      );
      if (!saleLinesRes.success) return { success: false, error: saleLinesRes.error };
      const saleItems = ((saleLinesRes.rows || []) as Record<string, unknown>[]).map((r) => ({
        productId: String(r.product_id),
        baseQty: Number(r.bq) || 0,
      })).filter((l) => l.baseQty > 0);
      // ── Phase 4: stock + credit guardrails (fail-closed company policy).
      const {
        getStockPolicies, checkStockSufficiency, formatShortages, auditOverride,
        resolveDefaultWarehouse,
      } = await import('@/core/utils/stockPolicy');
      const policies = await getStockPolicies(companyId, adapter);
      // Preferred source warehouse for auto-resolved outflows (validated).
      const preferredWh = await resolveDefaultWarehouse(companyId, 'issue', adapter);
      const stockGate = await checkStockSufficiency(companyId, saleItems, adapter);
      if (!stockGate.ok && !policies.allowNegativeSale) {
        return { success: false, error: `المخزون لا يكفي للبيع (${formatShortages(stockGate.shortages)})` };
      }
      if (!stockGate.ok && policies.allowNegativeSale) {
        await auditOverride({
          companyId, userId: safeUserIdValue, kind: 'negative-stock',
          recordId: id, label: `فاتورة مبيعات ${String(inv.invoice_number || '')}`,
          detail: { shortages: stockGate.shortages },
        });
      }
      // Phase 4: customer credit limit (credit sales only; 0/NULL = unlimited).
      if (paymentType !== 'cash' && outstanding > 0) {
        const custRes = await adapter.query(
          `SELECT COALESCE(balance, 0) AS balance, COALESCE(credit_limit, 0) AS credit_limit
             FROM customers WHERE id = $1::uuid AND company_id = $2::uuid`,
          [customerId, companyId]
        );
        if (custRes.success && custRes.rows?.[0]) {
          const crow = custRes.rows[0] as Record<string, unknown>;
          const limit = Number(crow.credit_limit) || 0;
          const wouldBe = (Number(crow.balance) || 0) + outstanding;
          if (limit > 0 && wouldBe > limit) {
            const msg = `تجاوز الحد الائتماني للعميل (الحد ${limit} — سيصبح ${wouldBe})`;
            if (policies.creditOverlimit === 'block') {
              return { success: false, error: msg };
            }
            await auditOverride({
              companyId, userId: safeUserIdValue, kind: 'credit-overlimit',
              recordId: id, label: `فاتورة مبيعات ${String(inv.invoice_number || '')}`,
              detail: { limit, current: Number(crow.balance) || 0, outstanding, mode: policies.creditOverlimit },
            });
          }
        }
      }
      const { resolveSaleUnitCosts, allocateFifoOutflow, buildFifoConsumeStatements, getValuationMethod, roundMoney, splitBaseTotal } =
        await import('@/core/utils/valuation');
      // Phase 2 (IAS 21): the LEDGER posts base amounts. Stored base total
      // wins; otherwise scale document amounts by the invoice rate; unknown
      // rate means base already (legacy rows default rate 1) — a zero JE is
      // never the right answer.
      const invRate = Number(inv.exchange_rate) || 1;
      const storedBase = Number(inv.base_currency_amount) || 0;
      const baseTriple = splitBaseTotal(
        storedBase > 0 ? storedBase : totalAmount * invRate,
        Number(inv.vat_amount) || 0,
        totalAmount
      );
      const method = await getValuationMethod(companyId, adapter);
      let lineUnitCosts = new Map<string, number>();
      let fifoConsumptions: Array<{ layerId: string; productId: string; qty: number; unitCost: number }> = [];
      if (method === 'fifo' && saleItems.length > 0) {
        const alloc = await allocateFifoOutflow(companyId, saleItems, adapter);
        if (!alloc.success) return { success: false, error: alloc.error };
        fifoConsumptions = alloc.consumptions;
        const perProduct = new Map<string, { qty: number; cost: number }>();
        for (const c of alloc.consumptions) {
          const cur = perProduct.get(c.productId) || { qty: 0, cost: 0 };
          cur.qty += c.qty;
          cur.cost += c.qty * c.unitCost;
          perProduct.set(c.productId, cur);
        }
        for (const [pid, v] of perProduct) {
          lineUnitCosts.set(pid, v.qty > 0 ? v.cost / v.qty : 0);
        }
      } else if (saleItems.length > 0) {
        const resolved = await resolveSaleUnitCosts(companyId, saleItems, adapter);
        if (!resolved.success) return { success: false, error: resolved.error };
        lineUnitCosts = resolved.costs;
      }
      let cogsTotal = 0;
      for (const it of saleItems) {
        cogsTotal = roundMoney(cogsTotal + it.baseQty * (lineUnitCosts.get(it.productId) || 0));
      }

      const accounts = await resolvePostingAccounts(companyId, ['default_debtors', 'default_sales', 'default_vat_output', 'default_cogs', 'default_inventory']);
      if (!accounts.success) {
        return { success: false, error: accounts.error };
      }
      // The discount account is required only when a discount exists —
      // zero-discount invoices keep posting on charts without 0031.
      let discountId: string | undefined;
      if (discountAmount > 0) {
        discountId = await getDefaultAccountId(companyId, 'default_discount_allowed') || undefined;
        if (!discountId) {
          return { success: false, error: 'حساب الخصم المسموح به غير مضبوط — اربطه في الإعدادات ← الحسابات الافتراضية' };
        }
      }
      // CASH invoice: the treasury account (selected cash box, or default
      // cash) replaces Debtors on the debit side — the customer owes nothing.
      const cashSubstitute = paymentType === 'cash' ? (await getCashBoxGLAccountId(companyId, cashBoxId)) : undefined;
      const postingStmts = buildSalesInvoicePostingStatements(companyId, {
        invoiceNumber: String(inv.invoice_number || ''),
        date: String(inv.date || new Date().toISOString().split('T')[0]),
        subtotal,
        vatAmount: Number(inv.vat_amount) || 0,
        totalAmount,
        paymentType,
        cashAccountSubstitute: cashSubstitute,
        cogsAmount,
        discountAmount,
        grossSubtotal,
      }, { debtors: accounts.ids.default_debtors, sales: accounts.ids.default_sales, vat: accounts.ids.default_vat_output, cogs: accounts.ids.default_cogs, inventory: accounts.ids.default_inventory, discount: discountId },
      cogsTotal > 0
        ? { total: cogsTotal, inventoryAccount: accounts.ids.default_inventory, cogsAccount: accounts.ids.default_cogs }
        : cogsAmount > 0
          ? { total: cogsAmount, inventoryAccount: accounts.ids.default_inventory, cogsAccount: accounts.ids.default_cogs }
          : undefined,
      { subtotal: baseTriple.sub, vatAmount: baseTriple.vat, totalAmount: baseTriple.total });

      const txQueries: { sql: string; params: unknown[] }[] = [
        ...postingStmts.map((s) => ({ sql: s.sql, params: (s.params ?? []) as unknown[] })),
        // Ensure stock rows exist for all products in the invoice (perpetual inventory)
        {
          sql: `INSERT INTO stock (company_id, product_id, warehouse_id, quantity)
                SELECT $2::uuid, sil.product_id, wh.warehouse_id, 0
                  FROM sales_invoices si
                  JOIN sales_invoice_lines sil ON sil.invoice_id = si.id
                  JOIN LATERAL (
                    SELECT COALESCE(
                      -- Phase 4: default source warehouse first (when it holds
                      -- the line qty), else richest, else first warehouse.
                      (SELECT s2.warehouse_id FROM stock s2 WHERE s2.product_id = sil.product_id AND s2.company_id = si.company_id AND s2.warehouse_id = $3::uuid AND s2.quantity >= COALESCE(NULLIF(sil.base_quantity, 0), sil.quantity) LIMIT 1),
                      (SELECT warehouse_id FROM stock WHERE product_id = sil.product_id AND company_id = si.company_id ORDER BY quantity DESC LIMIT 1),
                      (SELECT id FROM warehouses WHERE company_id = si.company_id ORDER BY created_at LIMIT 1)
                    ) AS warehouse_id
                  ) wh ON true
                  LEFT JOIN stock s ON s.company_id = si.company_id AND s.product_id = sil.product_id AND s.warehouse_id = wh.warehouse_id
                 WHERE si.id = $1::uuid AND si.company_id = $2::uuid AND wh.warehouse_id IS NOT NULL AND s.id IS NULL
                 GROUP BY si.company_id, sil.product_id, wh.warehouse_id`,
          params: [id, companyId, preferredWh],
        },
        // Stock movements (out) for each line
        {
          sql: `INSERT INTO stock_movements (company_id, product_id, warehouse_id, type, quantity, reference, notes, created_at)
                SELECT si.company_id, sil.product_id, wh.warehouse_id, 'out', COALESCE(NULLIF(sil.base_quantity, 0), sil.quantity), si.invoice_number, 'فاتورة مبيعات', NOW()
                  FROM sales_invoices si
                  JOIN sales_invoice_lines sil ON sil.invoice_id = si.id
                  JOIN LATERAL (
                    SELECT COALESCE(
                      -- Phase 4: default source warehouse first (when it holds
                      -- the line qty), else richest, else first warehouse.
                      (SELECT s2.warehouse_id FROM stock s2 WHERE s2.product_id = sil.product_id AND s2.company_id = si.company_id AND s2.warehouse_id = $3::uuid AND s2.quantity >= COALESCE(NULLIF(sil.base_quantity, 0), sil.quantity) LIMIT 1),
                      (SELECT warehouse_id FROM stock WHERE product_id = sil.product_id AND company_id = si.company_id ORDER BY quantity DESC LIMIT 1),
                      (SELECT id FROM warehouses WHERE company_id = si.company_id ORDER BY created_at LIMIT 1)
                    ) AS warehouse_id
                  ) wh ON true
                 WHERE si.id = $1::uuid AND si.company_id = $2::uuid AND wh.warehouse_id IS NOT NULL`,
          params: [id, companyId, preferredWh],
        },
        // Decrement stock quantities
        {
          sql: `UPDATE stock s SET quantity = s.quantity - sub.qty, updated_at = NOW()
                  FROM (
                    SELECT sil.product_id, wh.warehouse_id, SUM(COALESCE(NULLIF(sil.base_quantity, 0), sil.quantity)) AS qty
                      FROM sales_invoices si
                      JOIN sales_invoice_lines sil ON sil.invoice_id = si.id
                      JOIN LATERAL (
                        SELECT COALESCE(
                          (SELECT warehouse_id FROM stock WHERE product_id = sil.product_id AND company_id = si.company_id ORDER BY quantity DESC LIMIT 1),
                          (SELECT id FROM warehouses WHERE company_id = si.company_id ORDER BY created_at LIMIT 1)
                        ) AS warehouse_id
                      ) wh ON true
                     WHERE si.id = $1::uuid AND si.company_id = $2::uuid AND wh.warehouse_id IS NOT NULL
                     GROUP BY sil.product_id, wh.warehouse_id
                  ) sub
                 WHERE s.company_id = $2::uuid AND s.product_id = sub.product_id AND s.warehouse_id = sub.warehouse_id`,
          params: [id, companyId, preferredWh],
        },
        {
          sql: `UPDATE sales_invoices SET status = 'posted', updated_by = $3::uuid, updated_at = NOW() WHERE id = $1::uuid AND company_id = $2::uuid AND status = 'draft'`,
          params: [id, companyId, safeUserIdValue],
        },
      ];
      // Phase 1: freeze posting-time unit costs on the lines FIRST so the
      // return path reverses these exact costs; FIFO layer consumption rides
      // the same atomic batch as JE + stock.
      if (lineUnitCosts.size > 0) {
        const costRows: string[] = [];
        const costParams: unknown[] = [];
        let ci = 1;
        for (const [pid, cost] of lineUnitCosts) {
          costRows.push(`($${ci++}::uuid, $${ci++}::numeric)`);
          costParams.push(pid, cost);
        }
        costParams.push(id);
        txQueries.push({
          sql: `UPDATE sales_invoice_lines AS l SET unit_cost = v.cost FROM (VALUES ${costRows.join(', ')}) AS v(pid, cost) WHERE l.invoice_id = $${ci}::uuid AND l.product_id = v.pid::uuid`,
          params: costParams,
        });
      }
      if (fifoConsumptions.length > 0) {
        txQueries.push(...buildFifoConsumeStatements(companyId, fifoConsumptions).map((s) => ({ sql: s.sql, params: (s.params ?? []) as unknown[] })));
      }
      if (paymentType === 'cash') {
        // Cash invoice: record the sale as fully paid so every register and
        // the paid badge stay truthful (status flip + paid_amount together).
        txQueries.push({
          sql: `UPDATE sales_invoices SET paid_amount = total_amount, base_currency_paid = base_currency_amount, status = 'paid', updated_by = $3::uuid, updated_at = NOW() WHERE id = $1::uuid AND company_id = $2::uuid`,
          params: [id, companyId, safeUserIdValue],
        });
      }
      if (outstanding !== 0) {
        txQueries.push({
          sql: `UPDATE customers SET balance = balance + $1, updated_by = $4::uuid, updated_at = NOW() WHERE id = $2::uuid AND company_id = $3::uuid`,
          params: [outstanding, customerId, companyId, safeUserIdValue],
        });
      }
      const txResult = await adapter.transaction(txQueries);
      if (!txResult.success) {
        return { success: false, error: txResult.error };
      }
      return { success: true, cogsAmount, zeroCostLines };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  // ─── Quotations ───────────────────────────────────────────────────────────
  async getQuotations(companyId: string): Promise<{ success: boolean; data?: Quotation[]; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      if (isElectronPg()) {
        const result = await invokeSalesRpc('getQuotations');
        return result.success
          ? { success: true, data: (result.rows || []).map((r: Record<string, unknown>) => mapQuotationRow(r)) }
          : { success: false, error: result.error };
      }
      const adapter = await getDbAdapter();
      const result = await adapter.query(
        `SELECT q.*, c.name as customer_name FROM quotations q LEFT JOIN customers c ON q.customer_id = c.id WHERE q.company_id = $1 ORDER BY q.date DESC`,
        [companyId]
      );
      if (!result.success) return { success: false, error: result.error };
      const rows = (result.rows || []).map((r: Record<string, unknown>) => mapQuotationRow(r));
      return { success: true, data: rows };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async getQuotationsPaginated(
    companyId: string,
    page: number,
    pageSize: number,
    filters?: { status?: string; customerId?: string }
  ): Promise<PaginatedQueryResult<Quotation>> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      const { page: p, pageSize: ps, offset } = clampPageArgs(page, pageSize);
      if (isElectronPg()) {
        const result = await invokeSalesRpc('getQuotationsPaginated', {
          page: p,
          pageSize: ps,
          status: filters?.status,
          customerId: filters?.customerId,
        });
        if (!result.success) return { success: false, error: result.error };
        const rows = result.rows || [];
        const total = Number(rows[0]?.total_count) || 0;
        const items = rows.map((r: Record<string, unknown>) => mapQuotationRow(r));
        return { success: true, data: paginatedResult(items, total, p, ps) };
      }
      const adapter = await getDbAdapter();

      const conditions: string[] = ['q.company_id = $1'];
      const params: unknown[] = [companyId];
      if (filters?.status) {
        params.push(filters.status);
        conditions.push(`q.status = $${params.length}`);
      }
      if (filters?.customerId) {
        params.push(filters.customerId);
        conditions.push(`q.customer_id = $${params.length}`);
      }
      const where = conditions.join(' AND ');

      const countResult = await adapter.query(
        `SELECT COUNT(*)::int AS total FROM quotations q WHERE ${where}`,
        params
      );
      const total = Number(countResult.rows?.[0]?.total || 0);

      params.push(ps);
      params.push(offset);
      const limitIdx = params.length - 1;
      const offsetIdx = params.length;

      const dataResult = await adapter.query(
        `SELECT q.*, c.name as customer_name
         FROM quotations q LEFT JOIN customers c ON q.customer_id = c.id
         WHERE ${where}
         ORDER BY q.date DESC
         LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        params
      );
      if (!dataResult.success) return { success: false, error: dataResult.error };

      const items = (dataResult.rows || []).map((r: Record<string, unknown>) => mapQuotationRow(r));
      return { success: true, data: paginatedResult(items, total, p, ps) };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async getQuotationById(id: string, companyId: string): Promise<{ success: boolean; data?: Quotation; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      if (isElectronPg()) {
        const result = await invokeSalesRpc('getQuotationById', { id });
        if (!result.success) return { success: false, error: result.error };
        if (!result.rows?.[0]) return { success: false, error: 'Not found' };
        const row = result.rows[0];
        const q = mapQuotationRow(row);
        q.lines = parseJsonLines(row.lines).map((r) => mapQuotationLineRow(r));
        return { success: true, data: q };
      }
      const adapter = await getDbAdapter();
      const res = await adapter.query(`SELECT q.*, c.name as customer_name FROM quotations q LEFT JOIN customers c ON q.customer_id = c.id WHERE q.id = $1 AND q.company_id = $2 LIMIT 1`, [id, companyId]);
      if (!res.success || !res.rows?.[0]) return { success: false, error: res.error || 'Not found' };
      const q = mapQuotationRow(res.rows[0]);
      const linesRes = await adapter.query(`SELECT l.*, p.name_ar as product_name, p.code as product_code, p.barcode, p.sku, p.unit FROM quotation_lines l LEFT JOIN products p ON l.product_id = p.id WHERE l.quotation_id = $1`, [id]);
      q.lines = (linesRes.rows || []).map((r: Record<string, unknown>) => mapQuotationLineRow(r));
      return { success: true, data: q };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async createQuotation(data: Omit<Quotation, 'id'>, _userId?: string): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      const validation = validateInput(createQuotationSchema, data);
      if (!validation.success) return { success: false, error: validation.error };
      if (isElectronPg()) {
        const result = await invokeSalesRpc('createQuotation', { ...data });
        return result.success
          ? { success: true, id: firstId(result.rows) }
          : { success: false, error: result.error };
      }
      const adapter = await getDbAdapter();
      const quotationId = crypto.randomUUID();
      const params: unknown[] = [quotationId, data.companyId, data.quotationNumber, data.customerId, data.date, data.expiryDate, data.totalAmount, data.status, data.paymentType || 'credit', data.cashBoxId || null, data.notes, safeUserId(_userId), safeUserId(_userId)];
      let sql = `WITH quo AS (INSERT INTO quotations (id,company_id,quotation_number,customer_id,date,expiry_date,total_amount,status,payment_type,cash_box_id,notes,created_by,updated_by) VALUES ($1::uuid,$2::uuid,$3,$4::uuid,$5::date,$6::date,$7::numeric,$8::varchar,$9,$10::uuid,$11,$12::uuid,$13::uuid) RETURNING id)`;
      if (data.lines?.length) {
        const lineValues: string[] = [];
        for (const line of data.lines) {
          const off = params.length;
          const usnap = snapshotLineUnit(line);
          lineValues.push(`($${off + 1}::uuid,$${off + 2}::uuid,$${off + 3}::numeric,$${off + 4}::numeric,$${off + 5}::numeric,$${off + 6}::numeric,$${off + 7}::uuid,$${off + 8}::numeric,$${off + 9}::numeric)`);
          params.push(quotationId, line.productId, line.quantity, line.unitPrice, line.discountPercent, line.lineTotal, usnap.unitId, usnap.unitFactor, usnap.baseQuantity);
        }
        sql += `,lines_ins AS (INSERT INTO quotation_lines (quotation_id,product_id,quantity,unit_price,discount_percent,line_total,unit_id,unit_factor,base_quantity) SELECT v.quotation_id,v.product_id,v.quantity,v.unit_price,v.discount_percent,v.line_total,v.unit_id,v.unit_factor,v.base_quantity FROM quo JOIN (VALUES ${lineValues.join(',')}) v(quotation_id,product_id,quantity,unit_price,discount_percent,line_total,unit_id,unit_factor,base_quantity) ON true)`;
      }
      sql += ' SELECT id FROM quo';
      const result = await adapter.query(sql, params);
      if (result.success && result.rows?.[0]) {
        return { success: true, id: result.rows[0].id as string };
      }
      return { success: false, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async updateQuotation(id: string, companyId: string, data: Partial<Omit<Quotation, 'id' | 'companyId' | 'lines'>> & { lines?: QuotationLine[] }, _userId?: string): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      if (isElectronPg()) {
        const result = await invokeSalesRpc('updateQuotation', { data: { id, ...data } });
        return result.success ? { success: true } : { success: false, error: result.error };
      }
      const adapter = await getDbAdapter();
      const fields: string[] = [];
      const values: unknown[] = [];
      let idx = 1;
      if (data.customerId !== undefined) { fields.push(`customer_id = $${idx++}::uuid`); values.push(data.customerId); }
      if (data.date !== undefined) { fields.push(`date = $${idx++}::date`); values.push(data.date); }
      if (data.expiryDate !== undefined) { fields.push(`expiry_date = $${idx++}::date`); values.push(data.expiryDate); }
      if (data.totalAmount !== undefined) { fields.push(`total_amount = $${idx++}::numeric`); values.push(data.totalAmount); }
      if (data.status !== undefined) { fields.push(`status = $${idx++}::varchar`); values.push(data.status); }
      if (data.paymentType !== undefined) { fields.push(`payment_type = $${idx++}`); values.push(data.paymentType); }
      if (data.cashBoxId !== undefined) { fields.push(`cash_box_id = $${idx++}::uuid`); values.push(data.cashBoxId || null); }
      if (data.notes !== undefined) { fields.push(`notes = $${idx++}`); values.push(data.notes); }
      fields.push(`updated_by = $${idx++}::uuid`);
      values.push(safeUserId(_userId));
      fields.push(`updated_at = NOW()`);
      if (fields.length > 0) { values.push(id); values.push(companyId); await adapter.query(`UPDATE quotations SET ${fields.join(', ')} WHERE id = $${idx}::uuid AND company_id = $${idx + 1}::uuid`, values); }
      if (data.lines) {
        await adapter.query('DELETE FROM quotation_lines WHERE quotation_id = $1::uuid AND $2::uuid = (SELECT company_id FROM quotations WHERE id = $1)', [id, companyId]);
        const lineValues = data.lines.map((_: typeof data.lines[0], i: number) => {
          const off = i * 9;
          return `($${off + 1}::uuid, $${off + 2}::uuid, $${off + 3}, $${off + 4}, $${off + 5}, $${off + 6}, $${off + 7}::uuid, $${off + 8}, $${off + 9})`;
        }).join(', ');
        const lineParams = data.lines.flatMap((line: typeof data.lines[0]) => {
          const usnap = snapshotLineUnit(line);
          return [id, line.productId, line.quantity, line.unitPrice, line.discountPercent, line.lineTotal, usnap.unitId, usnap.unitFactor, usnap.baseQuantity];
        });
        await adapter.query(`INSERT INTO quotation_lines (quotation_id, product_id, quantity, unit_price, discount_percent, line_total, unit_id, unit_factor, base_quantity) VALUES ${lineValues}`, lineParams);
      }
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async deleteQuotation(id: string, companyId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      if (isElectronPg()) {
        const result = await invokeSalesRpc('deleteQuotation', { id });
        if (!result.success) return { success: false, error: result.error };
        const row = result.rows?.[0];
        if (!row) return { success: false, error: 'Quotation not found' };
        const status = String(row.status);
        if (status === 'converted' || status === 'accepted') {
          return { success: false, error: `Cannot delete ${status} quotation` };
        }
        return { success: true };
      }
      const adapter = await getDbAdapter();
      const check = await adapter.query(
        'SELECT status FROM quotations WHERE id = $1::uuid AND company_id = $2::uuid',
        [id, companyId]
      );
      if (!check.success || !check.rows?.[0]) {
        return { success: false, error: 'Quotation not found' };
      }
      const status = String((check.rows[0] as Record<string, unknown>).status);
      if (status === 'converted' || status === 'accepted') {
        return { success: false, error: `Cannot delete ${status} quotation` };
      }
      const result = await adapter.query('DELETE FROM quotations WHERE id = $1::uuid AND company_id = $2::uuid', [id, companyId]);
      return { success: result.success, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async convertQuotationToInvoice(id: string, companyId: string, invoiceData: Omit<SalesInvoice, 'id'>, _userId?: string): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      const createRes = await this.createInvoice(invoiceData, _userId);
      if (createRes.success) {
        if (isElectronPg()) {
          await invokeSalesRpc('updateQuotation', { data: { id, status: 'converted' } });
        } else {
          const adapter = await getDbAdapter();
          await adapter.query(`UPDATE quotations SET status = 'converted', updated_by = $3::uuid, updated_at = NOW() WHERE id = $1::uuid AND company_id = $2::uuid`, [id, companyId, safeUserId(_userId)]);
        }
      }
      return createRes;
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  // ─── Sales Returns ────────────────────────────────────────────────────────
  async getReturns(companyId: string): Promise<{ success: boolean; data?: SalesReturn[]; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      if (isElectronPg()) {
        const result = await invokeSalesRpc('getReturns');
        return result.success
          ? { success: true, data: (result.rows || []).map((r: Record<string, unknown>) => mapReturnRow(r)) }
          : { success: false, error: result.error };
      }
      const adapter = await getDbAdapter();
      const result = await adapter.query(
        `SELECT r.*, c.name as customer_name, i.invoice_number as invoice_number_ref FROM sales_returns r LEFT JOIN customers c ON r.customer_id = c.id LEFT JOIN sales_invoices i ON r.invoice_id = i.id WHERE r.company_id = $1 ORDER BY r.date DESC`,
        [companyId]
      );
      if (!result.success) return { success: false, error: result.error };
      const rows = (result.rows || []).map((r: Record<string, unknown>) => mapReturnRow(r));
      return { success: true, data: rows };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async getReturnsPaginated(
    companyId: string,
    page: number,
    pageSize: number,
    filters?: { status?: string; customerId?: string }
  ): Promise<PaginatedQueryResult<SalesReturn>> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      const { page: p, pageSize: ps, offset } = clampPageArgs(page, pageSize);
      if (isElectronPg()) {
        const result = await invokeSalesRpc('getReturnsPaginated', {
          page: p,
          pageSize: ps,
          status: filters?.status,
          customerId: filters?.customerId,
        });
        if (!result.success) return { success: false, error: result.error };
        const rows = result.rows || [];
        const total = Number(rows[0]?.total_count) || 0;
        const items = rows.map((r: Record<string, unknown>) => mapReturnRow(r));
        return { success: true, data: paginatedResult(items, total, p, ps) };
      }
      const adapter = await getDbAdapter();

      const conditions: string[] = ['r.company_id = $1'];
      const params: unknown[] = [companyId];
      if (filters?.status) {
        params.push(filters.status);
        conditions.push(`r.status = $${params.length}`);
      }
      if (filters?.customerId) {
        params.push(filters.customerId);
        conditions.push(`r.customer_id = $${params.length}`);
      }
      const where = conditions.join(' AND ');

      const countResult = await adapter.query(
        `SELECT COUNT(*)::int AS total FROM sales_returns r WHERE ${where}`,
        params
      );
      const total = Number(countResult.rows?.[0]?.total || 0);

      params.push(ps);
      params.push(offset);
      const limitIdx = params.length - 1;
      const offsetIdx = params.length;

      const dataResult = await adapter.query(
        `SELECT r.*, c.name as customer_name, i.invoice_number as invoice_number_ref
         FROM sales_returns r
         LEFT JOIN customers c ON r.customer_id = c.id
         LEFT JOIN sales_invoices i ON r.invoice_id = i.id
         WHERE ${where}
         ORDER BY r.date DESC
         LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        params
      );
      if (!dataResult.success) return { success: false, error: dataResult.error };

      const items = (dataResult.rows || []).map((r: Record<string, unknown>) => mapReturnRow(r));
      return { success: true, data: paginatedResult(items, total, p, ps) };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async getReturnById(id: string, companyId: string): Promise<{ success: boolean; data?: SalesReturn; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      if (isElectronPg()) {
        const result = await invokeSalesRpc('getReturnById', { id });
        if (!result.success) return { success: false, error: result.error };
        if (!result.rows?.[0]) return { success: false, error: 'Not found' };
        const row = result.rows[0];
        const ret = mapReturnRow(row);
        ret.lines = parseJsonLines(row.lines).map((r) => mapReturnLineRow(r));
        return { success: true, data: ret };
      }
      const adapter = await getDbAdapter();
      const res = await adapter.query(
        `SELECT r.*, c.name as customer_name, i.invoice_number as invoice_number_ref FROM sales_returns r LEFT JOIN customers c ON r.customer_id = c.id LEFT JOIN sales_invoices i ON r.invoice_id = i.id WHERE r.id = $1 AND r.company_id = $2 LIMIT 1`, [id, companyId]
      );
      if (!res.success || !res.rows?.[0]) return { success: false, error: res.error || 'Not found' };
      const ret = mapReturnRow(res.rows[0]);
      const linesRes = await adapter.query(`SELECT l.*, p.name_ar as product_name, p.code as product_code, p.barcode, p.sku, p.unit FROM sales_return_lines l LEFT JOIN products p ON l.product_id = p.id WHERE l.return_id = $1`, [id]);
      ret.lines = (linesRes.rows || []).map((r: Record<string, unknown>) => mapReturnLineRow(r));
      return { success: true, data: ret };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async createReturn(data: Omit<SalesReturn, 'id'>, _userId?: string): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      const validation = validateInput(createSalesReturnSchema, data);
      if (!validation.success) return { success: false, error: validation.error };
      if (isElectronPg()) {
        const result = await invokeSalesRpc('createReturn', { ...data });
        return result.success
          ? { success: true, id: firstId(result.rows) }
          : { success: false, error: result.error };
      }
      const adapter = await getDbAdapter();
      const returnId = crypto.randomUUID();
      // Phase 0 fix: `undefined` params break pg binding on the $4::uuid
      // placeholder — normalize a missing source invoice to NULL (the
      // Electron RPC path already does `p.invoiceId || null`).
      const params: unknown[] = [returnId, data.companyId, data.returnNumber, data.invoiceId || null, data.customerId, data.date, data.subtotal, data.vatAmount, data.totalAmount, data.reason, data.status, data.paymentType || 'credit', data.cashBoxId || null, data.notes, safeUserId(_userId), safeUserId(_userId)];
      let sql = `WITH ret AS (INSERT INTO sales_returns (id,company_id,return_number,invoice_id,customer_id,date,subtotal,vat_amount,total_amount,reason,status,payment_type,cash_box_id,notes,created_by,updated_by) VALUES ($1::uuid,$2::uuid,$3,$4::uuid,$5::uuid,$6::date,$7,$8,$9,$10,$11,$12,$13::uuid,$14,$15::uuid,$16::uuid) RETURNING id)`;
      if (data.lines?.length) {
        const lineValues: string[] = [];
        for (const line of data.lines) {
          const off = params.length;
          const usnap = snapshotLineUnit(line);
          lineValues.push(`($${off + 1}::uuid,$${off + 2}::uuid,$${off + 3}::numeric,$${off + 4}::numeric,$${off + 5}::numeric,$${off + 6}::uuid,$${off + 7}::numeric,$${off + 8}::numeric)`);
          params.push(returnId, line.productId, line.quantity, line.unitPrice, line.lineTotal, usnap.unitId, usnap.unitFactor, usnap.baseQuantity);
        }
        sql += `,lines_ins AS (INSERT INTO sales_return_lines (return_id,product_id,quantity,unit_price,line_total,unit_id,unit_factor,base_quantity) SELECT v.return_id,v.product_id,v.quantity,v.unit_price,v.line_total,v.unit_id,v.unit_factor,v.base_quantity FROM ret JOIN (VALUES ${lineValues.join(',')}) v(return_id,product_id,quantity,unit_price,line_total,unit_id,unit_factor,base_quantity) ON true)`;
      }
      sql += ' SELECT id FROM ret';
      const result = await adapter.query(sql, params);
      if (result.success && result.rows?.[0]) {
        return { success: true, id: result.rows[0].id as string };
      }
      return { success: false, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async updateReturn(id: string, companyId: string, data: Partial<Omit<SalesReturn, 'id' | 'companyId' | 'lines'>> & { lines?: SalesReturnLine[] }, _userId?: string): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      if (isElectronPg()) {
        const result = await invokeSalesRpc('updateReturn', { data: { id, ...data } });
        return result.success ? { success: true } : { success: false, error: result.error };
      }
      const adapter = await getDbAdapter();
      // P2 fix (mirrors the RPC guard): posted returns already moved stock +
      // JE + party balance — editing lines or flipping status corrupts all
      // three while they stand. Draft edits only (posting via postReturn).
      if (data.lines !== undefined || data.status !== undefined) {
        const cur = await adapter.query<{ status: string }>(
          `SELECT status FROM sales_returns WHERE id = $1::uuid AND company_id = $2::uuid`,
          [id, companyId]
        );
        if (!cur.success) return { success: false, error: cur.error };
        const curStatus = String(cur.rows?.[0]?.status ?? '');
        if (!curStatus) return { success: false, error: 'Return not found' };
        if (curStatus !== 'draft' && data.lines !== undefined) {
          return { success: false, error: 'Cannot modify lines of a posted return.' };
        }
        if (curStatus !== 'draft' && data.status !== undefined) {
          return { success: false, error: 'Cannot change status of a posted return.' };
        }
      }
      const fields: string[] = [];
      const values: unknown[] = [];
      let idx = 1;
      if (data.invoiceId !== undefined) { fields.push(`invoice_id = $${idx++}`); values.push(data.invoiceId); }
      if (data.customerId !== undefined) { fields.push(`customer_id = $${idx++}`); values.push(data.customerId); }
      if (data.date !== undefined) { fields.push(`date = $${idx++}`); values.push(data.date); }
      if (data.subtotal !== undefined) { fields.push(`subtotal = $${idx++}`); values.push(data.subtotal); }
      if (data.vatAmount !== undefined) { fields.push(`vat_amount = $${idx++}`); values.push(data.vatAmount); }
      if (data.totalAmount !== undefined) { fields.push(`total_amount = $${idx++}`); values.push(data.totalAmount); }
      if (data.reason !== undefined) { fields.push(`reason = $${idx++}`); values.push(data.reason); }
      if (data.status !== undefined) { fields.push(`status = $${idx++}`); values.push(data.status); }
      if (data.paymentType !== undefined) { fields.push(`payment_type = $${idx++}`); values.push(data.paymentType); }
      if (data.cashBoxId !== undefined) { fields.push(`cash_box_id = $${idx++}::uuid`); values.push(data.cashBoxId || null); }
      if (data.notes !== undefined) { fields.push(`notes = $${idx++}`); values.push(data.notes); }
      fields.push(`updated_by = $${idx++}::uuid`);
      values.push(safeUserId(_userId));
      fields.push(`updated_at = NOW()`);
      if (fields.length > 0) { values.push(id); values.push(companyId); await adapter.query(`UPDATE sales_returns SET ${fields.join(', ')} WHERE id = $${idx}::uuid AND company_id = $${idx + 1}::uuid`, values); }
      if (data.lines) {
        await adapter.query('DELETE FROM sales_return_lines WHERE return_id = $1::uuid AND $2::uuid = (SELECT company_id FROM sales_returns WHERE id = $1)', [id, companyId]);
        const lineValues = data.lines.map((_: typeof data.lines[0], i: number) => {
          const off = i * 8;
          return `($${off + 1}::uuid, $${off + 2}::uuid, $${off + 3}, $${off + 4}, $${off + 5}, $${off + 6}::uuid, $${off + 7}, $${off + 8})`;
        }).join(', ');
        const lineParams = data.lines.flatMap((line: typeof data.lines[0]) => {
          const usnap = snapshotLineUnit(line);
          return [id, line.productId, line.quantity, line.unitPrice, line.lineTotal, usnap.unitId, usnap.unitFactor, usnap.baseQuantity];
        });
        await adapter.query(`INSERT INTO sales_return_lines (return_id, product_id, quantity, unit_price, line_total, unit_id, unit_factor, base_quantity) VALUES ${lineValues}`, lineParams);
      }
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async deleteReturn(id: string, companyId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      if (isElectronPg()) {
        const result = await invokeSalesRpc('deleteReturn', { id });
        if (!result.success) return { success: false, error: result.error };
        const row = result.rows?.[0];
        if (!row) return { success: false, error: 'Return not found' };
        if (String(row.status) !== 'draft') {
          return { success: false, error: 'Cannot delete posted return. Cancel it first.' };
        }
        return { success: true };
      }
      const adapter = await getDbAdapter();
      const check = await adapter.query(
        'SELECT status FROM sales_returns WHERE id = $1::uuid AND company_id = $2::uuid',
        [id, companyId]
      );
      if (!check.success || !check.rows?.[0]) {
        return { success: false, error: 'Return not found' };
      }
      const status = String((check.rows[0] as Record<string, unknown>).status);
      if (status !== 'draft') {
        return { success: false, error: 'Cannot delete posted return. Cancel it first.' };
      }
      const result = await adapter.query('DELETE FROM sales_returns WHERE id = $1::uuid AND company_id = $2::uuid', [id, companyId]);
      return { success: result.success, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async postReturn(id: string, companyId: string, _userId?: string): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      const adapter = await getDbAdapter();

      // ── Unified atomic contract (single code path): JE + stock movements +
      // status flip + customer balance all commit together or not at all.
      const check = await adapter.query(
        'SELECT sr.customer_id, sr.total_amount, sr.subtotal, sr.vat_amount, sr.invoice_id, sr.return_number, sr.date, c.name as customer_name FROM sales_returns sr LEFT JOIN customers c ON sr.customer_id = c.id WHERE sr.id = $1::uuid AND sr.company_id = $2::uuid AND sr.status = $3',
        [id, companyId, 'draft']
      );
      if (!check.success || !check.rows?.[0]) {
        return { success: false, error: 'Return not found or not in draft status' };
      }
      const ret = check.rows[0] as Record<string, unknown>;
      const { assertPeriodOpen: assertReturnPeriod } = await import('@/modules/tax/engine');
      const retGate = await assertReturnPeriod(companyId, toDateString(ret.date) || '', adapter);
      if (!retGate.open) {
        return { success: false, error: `الفترة الضريبية مغلقة (${retGate.period.startDate} – ${retGate.period.endDate}) — لا يمكن الترحيل بتاريخ داخلها` };
      }
      // Phase 5: a closed fiscal year locks its dates for every posting path.
      const { assertAccountingPeriodOpen: assertFiscalReturnOpen } = await import('@/modules/accounting/yearEnd');
      const fiscalRetGate = await assertFiscalReturnOpen(companyId, toDateString(ret.date) || '', adapter);
      if (!fiscalRetGate.open) {
        return { success: false, error: `السنة المالية ${fiscalRetGate.period.year} مقفلة — لا يمكن الترحيل بتاريخ داخلها` };
      }
      const customerId = String(ret.customer_id);
      const totalAmount = Number(ret.total_amount) || 0;
      const retSubtotal = Number(ret.subtotal ?? totalAmount) || 0;
      const retVat = Number(ret.vat_amount ?? Math.max(0, totalAmount - retSubtotal)) || 0;
      const srcInvoiceId = ret.invoice_id ? String(ret.invoice_id) : null;
      const safeUserIdValue = await resolveExistingUserId(adapter, _userId, companyId);

      // Actual COGS reversal: what the ORIGINAL sale took out of stock for
      // these products (frozen unit_cost snapshots), falling back to the
      // live moving-average cost for pre-snapshot lines or standalone
      // returns. No ratio guessing — the cost that left is what returns.
      const revRes = await adapter.query(
        `SELECT COALESCE(SUM(COALESCE(NULLIF(srl.base_quantity, 0), srl.quantity) * COALESCE(
           (SELECT sil.unit_cost FROM sales_invoice_lines sil
             WHERE sil.invoice_id = sr.invoice_id AND sil.product_id = srl.product_id
               AND sil.unit_cost > 0 ORDER BY sil.id LIMIT 1),
           p.cost_price, 0)), 0) AS reversal
           FROM sales_returns sr
           JOIN sales_return_lines srl ON srl.return_id = sr.id
           LEFT JOIN products p ON p.id = srl.product_id AND p.company_id = $2::uuid
          WHERE sr.id = $1::uuid AND sr.company_id = $2::uuid`,
        [id, companyId]
      );
      if (!revRes.success) return { success: false, error: revRes.error };
      const revRow = (revRes.rows?.[0] || {}) as Record<string, unknown>;
      const cogsReversal = Math.round((Number(revRow.reversal) || 0) * 100) / 100;

      // NOTE: sales_returns stores net totals only (no discount_amount
      // column) — the return JE posts the balanced net pair. Explicit
      // discount legs are supported by the builder for future wiring.
      // ── Phase 1 (IAS 2): restore the ORIGINAL posting-time cost per line
      // (frozen unit_cost on the source invoice lines), NOT today's average
      // and never the retired 70% estimate.
      const {
        getValuationMethod, resolveSaleUnitCosts,
        buildFifoRestoreStatement, resolveRichestWarehouse, roundMoney, splitBaseTotal,
      } = await import('@/core/utils/valuation');
      // Phase 4: preferred source warehouse for the restored stock.
      const { resolveDefaultWarehouse: resolveRetWh } = await import('@/core/utils/stockPolicy');
      const preferredWh = await resolveRetWh(companyId, 'issue', adapter);
      // Phase 2 (IAS 21): revenue/VAT/debtor legs in base, converted at the
      // SOURCE invoice rate (the return inherits its currency from it).
      // Without a linked invoice the return is assumed base already.
      let retBase = { sub: retSubtotal, vat: retVat, total: retSubtotal + retVat };
      if (srcInvoiceId) {
        const srcHead = await adapter.query(
          `SELECT total_amount, exchange_rate, base_currency_amount FROM sales_invoices WHERE id = $1::uuid AND company_id = $2::uuid`,
          [srcInvoiceId, companyId]
        );
        if (srcHead.success && srcHead.rows?.[0]) {
          const sh = srcHead.rows[0] as Record<string, unknown>;
          const srcTotal = Number(sh.total_amount) || 0;
          const srcBase = Number(sh.base_currency_amount) || 0;
          // Unknown rate means base already (legacy rows default rate 1).
          const rate = srcTotal > 0 && srcBase > 0 ? srcBase / srcTotal : (Number(sh.exchange_rate) || 1);
          retBase = splitBaseTotal(
            roundMoney((retSubtotal + retVat) * rate),
            retVat,
            retSubtotal + retVat
          );
        }
      }
      const retLinesRes = await adapter.query(
        `SELECT product_id, COALESCE(NULLIF(base_quantity, 0), quantity) AS bq
           FROM sales_return_lines WHERE return_id = $1`,
        [id]
      );
      if (!retLinesRes.success) return { success: false, error: retLinesRes.error };
      const retItems = ((retLinesRes.rows || []) as Record<string, unknown>[]).map((r) => ({
        productId: String(r.product_id),
        baseQty: Number(r.bq) || 0,
      })).filter((l) => l.baseQty > 0);
      const srcCosts = new Map<string, number>();
      if (srcInvoiceId) {
        const srcRes = await adapter.query(
          `SELECT product_id, unit_cost FROM sales_invoice_lines WHERE invoice_id = $1`,
          [srcInvoiceId]
        );
        if (!srcRes.success) return { success: false, error: srcRes.error };
        for (const r of (srcRes.rows || []) as Record<string, unknown>[]) {
          if (r.unit_cost !== null && r.unit_cost !== undefined) {
            srcCosts.set(String(r.product_id), Number(r.unit_cost) || 0);
          }
        }
      }
      const method = await getValuationMethod(companyId, adapter);
      const fallback = retItems.length > 0
        ? await resolveSaleUnitCosts(companyId, retItems, adapter)
        : { success: true as const, method, costs: new Map<string, number>() };
      if (!fallback.success) return { success: false, error: (fallback as { error: string }).error };
      const fallbackCosts = (fallback as { costs: Map<string, number> }).costs;
      let returnCostTotal = 0;
      const fifoRestores: Array<{ sql: string; params: unknown[] }> = [];
      // toDateString (never String()): raw pg DATE values are Date objects
      // whose locale format PG rejects as ::date (Phase 45 trap).
      const retDate = toDateString(ret.date) || new Date().toISOString().split('T')[0];
      for (const it of retItems) {
        const unit = srcCosts.get(it.productId) ?? fallbackCosts.get(it.productId) ?? 0;
        returnCostTotal = roundMoney(returnCostTotal + it.baseQty * unit);
        // FIFO: the returned goods re-enter stock as a layer at ORIGINAL cost.
        if (method === 'fifo' && it.baseQty > 0) {
          const wh = await resolveRichestWarehouse(companyId, it.productId, adapter);
          const stmt = buildFifoRestoreStatement(companyId, {
            productId: it.productId,
            warehouseId: wh,
            qty: it.baseQty,
            unitCost: unit,
            receivedDate: retDate,
            sourceRef: String(ret.return_number || ''),
          });
          if (stmt) fifoRestores.push({ sql: stmt.sql, params: (stmt.params ?? []) as unknown[] });
        }
      }
      const posting = await buildSalesReturnPostingStatements(companyId, {
        id: id,
        returnNumber: String(ret.return_number || ''),
        date: retDate,
        customer: String(ret.customer_name || ''),
        amount: totalAmount,
        cogsReversal,
      }, {
        subtotal: retSubtotal,
        vatAmount: retVat,
        costTotal: returnCostTotal,
      }, {
        subtotal: retBase.sub,
        vatAmount: retBase.vat,
        totalAmount: retBase.total,
      }, preferredWh);
      if (!posting.success) {
        return { success: false, error: posting.error };
      }

      const txQueries: { sql: string; params: unknown[] }[] = [
        ...posting.statements.map((s) => ({ sql: s.sql, params: (s.params ?? []) as unknown[] })),
        // FIFO restoration layers ride the same atomic batch.
        ...fifoRestores,
        {
          sql: `UPDATE sales_returns SET status = 'posted', updated_by = $3::uuid, updated_at = NOW() WHERE id = $1::uuid AND company_id = $2::uuid AND status = 'draft'`,
          params: [id, companyId, safeUserIdValue],
        },
      ];
      if (totalAmount !== 0) {
        txQueries.push({
          sql: `UPDATE customers SET balance = balance - $1, updated_by = $4::uuid, updated_at = NOW() WHERE id = $2::uuid AND company_id = $3::uuid`,
          params: [totalAmount, customerId, companyId, safeUserIdValue],
        });
      }
      const txResult = await adapter.transaction(txQueries);
      if (!txResult.success) {
        return { success: false, error: txResult.error };
      }
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },
};

// ─── Row Mappers ────────────────────────────────────────────────────────────
function mapInvoiceRow(row: Record<string, unknown>): SalesInvoice {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    invoiceNumber: String(row.invoice_number),
    customerId: String(row.customer_id),
    customer: row.customer_name ? {
      id: String(row.customer_id),
      companyId: String(row.company_id),
      name: String(row.customer_name),
      phone: row.customer_phone ? String(row.customer_phone) : undefined,
      email: row.customer_email ? String(row.customer_email) : undefined,
      address: row.customer_address ? String(row.customer_address) : undefined,
      taxNumber: row.customer_tax_number ? String(row.customer_tax_number) : undefined,
      balance: Number(row.customer_balance) || 0,
      isActive: row.customer_is_active === true || row.customer_is_active === 'true',
    } : undefined,
    date: toDateString(row.date) ?? '',
    dueDate: row.due_date ? toDateString(row.due_date) ?? undefined : undefined,
    subtotal: Number(row.subtotal) || 0,
    discountAmount: Number(row.discount_amount) || 0,
    vatAmount: Number(row.vat_amount) || 0,
    totalAmount: Number(row.total_amount) || 0,
    paidAmount: Number(row.paid_amount) || 0,
    currencyCode: row.currency_code ? String(row.currency_code) : YER_CODE,
    exchangeRate: row.exchange_rate !== undefined ? Number(row.exchange_rate) : 1,
    baseCurrencyAmount: row.base_currency_amount !== undefined ? Number(row.base_currency_amount) : 0,
    baseCurrencyPaid: row.base_currency_paid !== undefined ? Number(row.base_currency_paid) : 0,
    paymentType: String(row.payment_type || 'credit'),
    cashBoxId: row.cash_box_id ? String(row.cash_box_id) : undefined,
    status: String(row.status) as SalesInvoice['status'],
    notes: row.notes ? String(row.notes) : undefined,
    attachments: parseJsonAttachments(row.attachments),
    lines: [],
  };
}

function mapInvoiceLineRow(row: Record<string, unknown>): SalesInvoiceLine {
  return {
    id: row.id ? String(row.id) : undefined,
    invoiceId: row.invoice_id ? String(row.invoice_id) : undefined,
    productId: String(row.product_id),
    productName: row.product_name ? String(row.product_name) : undefined,
    productCode: row.product_code ? String(row.product_code) : undefined,
    barcode: row.barcode ? String(row.barcode) : undefined,
    sku: row.sku ? String(row.sku) : undefined,
    unit: row.unit ? String(row.unit) : undefined,
    unitId: row.unit_id ? String(row.unit_id) : undefined,
    unitFactor: row.unit_factor !== undefined && row.unit_factor !== null ? Number(row.unit_factor) : 1,
    baseQuantity: row.base_quantity !== undefined && row.base_quantity !== null ? Number(row.base_quantity) : Number(row.quantity) || 0,
    unitName: row.unit_name ? String(row.unit_name) : undefined,
    quantity: Number(row.quantity) || 0,
    unitPrice: Number(row.unit_price) || 0,
    discountPercent: Number(row.discount_percent) || 0,
    vatPercent: Number(row.vat_percent) || 0,
    lineTotal: Number(row.line_total) || 0,
    unitCost: row.unit_cost !== undefined && row.unit_cost !== null ? Number(row.unit_cost) : 0,
    currencyCode: row.currency_code ? String(row.currency_code) : YER_CODE,
    exchangeRate: row.exchange_rate !== undefined ? Number(row.exchange_rate) : 1,
    baseCurrencyLineTotal: row.base_currency_line_total !== undefined ? Number(row.base_currency_line_total) : 0,
  };
}

function mapQuotationRow(row: Record<string, unknown>): Quotation {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    quotationNumber: String(row.quotation_number),
    customerId: String(row.customer_id),
    customer: row.customer_name ? { id: String(row.customer_id), companyId: String(row.company_id), name: String(row.customer_name), balance: 0, isActive: true } : undefined,
    date: toDateString(row.date) ?? '',
    expiryDate: row.expiry_date ? toDateString(row.expiry_date) ?? undefined : undefined,
    totalAmount: Number(row.total_amount) || 0,
    paymentType: String(row.payment_type || 'credit'),
    cashBoxId: row.cash_box_id ? String(row.cash_box_id) : undefined,
    status: String(row.status) as Quotation['status'],
    notes: row.notes ? String(row.notes) : undefined,
    lines: [],
  };
}

function mapQuotationLineRow(row: Record<string, unknown>): QuotationLine {
  return {
    id: row.id ? String(row.id) : undefined,
    quotationId: row.quotation_id ? String(row.quotation_id) : undefined,
    productId: String(row.product_id),
    productName: row.product_name ? String(row.product_name) : undefined,
    productCode: row.product_code ? String(row.product_code) : undefined,
    barcode: row.barcode ? String(row.barcode) : undefined,
    sku: row.sku ? String(row.sku) : undefined,
    unit: row.unit ? String(row.unit) : undefined,
    unitId: row.unit_id ? String(row.unit_id) : undefined,
    unitFactor: row.unit_factor !== undefined && row.unit_factor !== null ? Number(row.unit_factor) : 1,
    baseQuantity: row.base_quantity !== undefined && row.base_quantity !== null ? Number(row.base_quantity) : Number(row.quantity) || 0,
    unitName: row.unit_name ? String(row.unit_name) : undefined,
    quantity: Number(row.quantity) || 0,
    unitPrice: Number(row.unit_price) || 0,
    discountPercent: Number(row.discount_percent) || 0,
    lineTotal: Number(row.line_total) || 0,
  };
}

function mapReturnRow(row: Record<string, unknown>): SalesReturn {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    returnNumber: String(row.return_number),
    // Phase 0 fix: String(null) === "null" — a return without a source
    // invoice mapped its invoiceId to the literal string "null", breaking
    // downstream lookups/filters. NULL stays undefined (mirrors line 1591).
    invoiceId: row.invoice_id ? String(row.invoice_id) : undefined,
    invoice: row.invoice_number_ref ? { id: String(row.invoice_id), companyId: String(row.company_id), invoiceNumber: String(row.invoice_number_ref), customerId: '', date: '', subtotal: 0, discountAmount: 0, vatAmount: 0, totalAmount: 0, paidAmount: 0, status: 'posted', lines: [] } : undefined,
    customerId: String(row.customer_id),
    customer: row.customer_name ? { id: String(row.customer_id), companyId: String(row.company_id), name: String(row.customer_name), balance: 0, isActive: true } : undefined,
    date: toDateString(row.date) ?? '',
    subtotal: Number(row.subtotal) || 0,
    vatAmount: Number(row.vat_amount) || 0,
    totalAmount: Number(row.total_amount) || 0,
    reason: String(row.reason),
    paymentType: String(row.payment_type || 'credit'),
    cashBoxId: row.cash_box_id ? String(row.cash_box_id) : undefined,
    status: String(row.status) as SalesReturn['status'],
    notes: row.notes ? String(row.notes) : undefined,
    lines: [],
  };
}

function mapReturnLineRow(row: Record<string, unknown>): SalesReturnLine {
  return {
    id: row.id ? String(row.id) : undefined,
    returnId: row.return_id ? String(row.return_id) : undefined,
    productId: String(row.product_id),
    productName: row.product_name ? String(row.product_name) : undefined,
    productCode: row.product_code ? String(row.product_code) : undefined,
    barcode: row.barcode ? String(row.barcode) : undefined,
    sku: row.sku ? String(row.sku) : undefined,
    unit: row.unit ? String(row.unit) : undefined,
    unitId: row.unit_id ? String(row.unit_id) : undefined,
    unitFactor: row.unit_factor !== undefined && row.unit_factor !== null ? Number(row.unit_factor) : 1,
    baseQuantity: row.base_quantity !== undefined && row.base_quantity !== null ? Number(row.base_quantity) : Number(row.quantity) || 0,
    unitName: row.unit_name ? String(row.unit_name) : undefined,
    quantity: Number(row.quantity) || 0,
    unitPrice: Number(row.unit_price) || 0,
    lineTotal: Number(row.line_total) || 0,
  };
}
