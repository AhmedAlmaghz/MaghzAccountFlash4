import { getDbAdapter } from '@/core/database/adapters';
import { runTransaction } from '@/core/database/tx';
import { buildReceiptVoucherStatements, buildPaymentVoucherStatements } from '@/core/utils/journalEntryGenerator';
import { mapRows, toDateString } from '@/core/utils/mapPgRow';
import { safeUserId } from '@/core/utils/userIdValidator';
import { validateInput, idCompanySchema, companyIdSchema, createTransactionSchema, createReceiptVoucherSchema, createPaymentVoucherSchema } from '@/core/utils/validation';
import { clampPageArgs, paginatedResult, type PaginatedQueryResult } from '@/core/utils/pagination';
import { YER_CODE } from '@/core/utils/currencyConverter';
import { accountingService } from './services';
import type { Account, Transaction, JournalEntry, TrialBalanceRow, LedgerRow, ReceiptVoucher, PaymentVoucher } from './types';

export const accountingApi = {
  // ─── Chart of Accounts ────────────────────────────────────────────────────
  async getAccounts(companyId: string, ownedByUserId?: string): Promise<{ success: boolean; data?: Account[]; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      const adapter = await getDbAdapter();
      const result = await adapter.getAccounts(companyId);

      if (result.success && result.data) {
        // mapRows/snakeToCamel auto-converts purely numeric strings to
        // numbers (for PG numeric columns) — but account codes are TEXT that
        // happens to look numeric ('11101'), and number codes crash string
        // methods (code.startsWith / code.includes). Coerce back to string.
        const withStringCode = (rows: Account[]) =>
          rows.map((a) => ({ ...a, code: String(a.code ?? '') }));
        let accounts = withStringCode(mapRows<Account>(result.data));

        if (ownedByUserId) {
          const filterResult = await adapter.query(
            `SELECT * FROM accounts WHERE company_id = $1 AND (created_by = $2 OR created_by IS NULL)`,
            [companyId, ownedByUserId]
          );
          if (filterResult.success && filterResult.rows) {
            accounts = withStringCode(mapRows<Account>(filterResult.rows));
          }
        }

        const accountMap = new Map<string, Account>();
        const rootAccounts: Account[] = [];

        accounts.forEach(acc => {
          accountMap.set(acc.id, { ...acc, children: [] });
        });

        accounts.forEach(acc => {
          const node = accountMap.get(acc.id)!;
          if (acc.parentId && accountMap.has(acc.parentId)) {
            const parent = accountMap.get(acc.parentId)!;
            if (!parent.children) parent.children = [];
            parent.children.push(node);
          } else {
            rootAccounts.push(node);
          }
        });

        return { success: true, data: rootAccounts };
      }

      return { success: false, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async createAccount(data: Omit<Account, 'id'>, userId: string): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, data.companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      const adapter = await getDbAdapter();
      // Never pass an unvalidated / stale userId straight into a uuid-typed FK
      // column. `safeUserId` returns null for empty strings, whitespace and
      // non-UUID values so the FK sees NULL (column is nullable, ON DELETE SET
      // NULL) instead of raising "invalid input syntax for type uuid".
      const userIdOrNull = safeUserId(userId);
      const accountId = crypto.randomUUID();
      const result = await adapter.query(
        // NOTE: nullable params get a single explicit cast ($N::uuid). A
        // "CASE WHEN $N IS NULL ..." wrapper makes PostgreSQL fail with
        // "could not determine data type of parameter $N" because the IS
        // NULL branch provides no type context.
        `INSERT INTO accounts (id, company_id, code, name_ar, name_en, parent_id, type, nature, is_group, balance, is_active, created_by, updated_by)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::uuid, $7, $8, $9, $10, $11, $12::uuid, $13::uuid)
         RETURNING id`,
        [
          accountId,
          data.companyId,
          data.code,
          data.nameAr,
          data.nameEn || null,
          data.parentId || null,
          data.type,
          data.nature,
          data.isGroup,
          data.balance ?? 0,
          data.isActive ?? true,
          userIdOrNull,
          userIdOrNull,
        ]
      );
      if (result.success) {
        const createdId = result.rows?.[0]?.id as string | undefined;
        // Opening balance: post a balanced JE through Opening Balance Equity
        const openingAmount = Number((data as Partial<Account> & { openingAmount?: number }).openingAmount) || 0;
        if (createdId && openingAmount > 0 && !(data as Partial<Account>).openingBalancePosted) {
          const { postAccountOpeningBalance } = await import('@/core/utils/openingBalance');
          await postAccountOpeningBalance(data.companyId, {
            accountId: createdId,
            accountCode: data.code,
            accountName: data.nameAr,
            direction: ((data as Partial<Account> & { openingDirection?: string }).openingDirection === 'credit' ? 'credit' : 'debit'),
            amount: openingAmount,
          });
        }
        return { success: true, id: createdId };
      }
      return { success: false, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async updateAccount(id: string, companyId: string, userId: string, data: Partial<Account>): Promise<{ success: boolean; error?: string }> {
    try {
      const cidValidation = validateInput(idCompanySchema, { id, companyId });
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      const adapter = await getDbAdapter();
      const userIdOrNull = userId && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(userId) ? userId : null;
      return await adapter.query(
        `UPDATE accounts SET name_ar = $1, name_en = $2, code = $3, parent_id = $4, type = $5, nature = $6, is_group = $7, is_active = $8, updated_at = NOW(), updated_by = $9::uuid WHERE id = $10 AND company_id = $11`,
        [data.nameAr, data.nameEn, data.code, data.parentId, data.type, data.nature, data.isGroup, data.isActive, userIdOrNull, id, companyId]
      );
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async deleteAccount(id: string, companyId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      const adapter = await getDbAdapter();
      const checkResult = await adapter.query<{ count: number }>(
        `SELECT COUNT(*) as count FROM journal_entries WHERE account_id = $1 AND company_id = $2`,
        [id, companyId]
      );
      const count = Number(checkResult.rows?.[0]?.count) || 0;
      if (count > 0) {
        return { success: false, error: 'لا يمكن حذف حساب له قيود يومية' };
      }
      return await adapter.query(`DELETE FROM accounts WHERE id = $1 AND company_id = $2`, [id, companyId]);
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async getAccountById(id: string, companyId: string): Promise<{ success: boolean; data?: Account; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      const adapter = await getDbAdapter();
      const result = await adapter.query(
        `SELECT * FROM accounts WHERE id = $1 AND company_id = $2`,
        [id, companyId]
      );
      if (result.success && result.rows && result.rows.length > 0) {
        return { success: true, data: mapRows<Account>([result.rows[0]])[0] };
      }
      return { success: false, error: 'Account not found' };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  // ─── Journal Entries ──────────────────────────────────────────────────────
  async getTransactions(companyId: string, ownedByUserId?: string): Promise<{ success: boolean; data?: Transaction[]; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      const adapter = await getDbAdapter();
      if (ownedByUserId) {
        const result = await adapter.query(
          `SELECT t.* FROM transactions t WHERE t.company_id = $1 AND (t.created_by = $2 OR t.created_by IS NULL) ORDER BY t.date DESC`,
          [companyId, ownedByUserId]
        );
        return { success: result.success, data: mapRows<Transaction>(result.rows), error: result.error };
      }
      const result = await adapter.getTransactions(companyId);
      return { success: result.success, data: mapRows<Transaction>(result.data), error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async getTransactionsPaginated(
    companyId: string,
    page: number,
    pageSize: number,
    filters?: { status?: string; createdBy?: string }
  ): Promise<PaginatedQueryResult<Transaction>> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      const { page: p, pageSize: ps, offset } = clampPageArgs(page, pageSize);
      const adapter = await getDbAdapter();

      const conditions: string[] = ['t.company_id = $1'];
      const params: unknown[] = [companyId];
      if (filters?.status) {
        params.push(filters.status);
        conditions.push(`t.status = $${params.length}`);
      }
      if (filters?.createdBy) {
        params.push(filters.createdBy);
        conditions.push(`(t.created_by = $${params.length} OR t.created_by IS NULL)`);
      }
      const where = conditions.join(' AND ');

      const countResult = await adapter.query(
        `SELECT COUNT(*)::int AS total FROM transactions t WHERE ${where}`,
        params
      );
      const total = Number(countResult.rows?.[0]?.total || 0);

      params.push(ps);
      params.push(offset);
      const limitIdx = params.length - 1;
      const offsetIdx = params.length;

      const dataResult = await adapter.query(
        `SELECT t.* FROM transactions t WHERE ${where} ORDER BY t.date DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        params
      );
      if (!dataResult.success) return { success: false, error: dataResult.error };

      const items = mapRows<Transaction>(dataResult.rows || []);
      return { success: true, data: paginatedResult(items, total, p, ps) };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async getTransactionById(id: string, companyId: string): Promise<{ success: boolean; data?: Transaction; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      const adapter = await getDbAdapter();
      const result = await adapter.query(
        `SELECT * FROM transactions WHERE id = $1 AND company_id = $2`,
        [id, companyId]
      );
      if (result.success && result.rows && result.rows.length > 0) {
        const tx = mapRows<Transaction>([result.rows[0]])[0];
        const entriesResult = await adapter.query(
          `SELECT je.*, a.name_ar as account_name, a.code as account_code
          FROM journal_entries je
          LEFT JOIN accounts a ON je.account_id = a.id
          WHERE je.transaction_id = $1 AND je.company_id = $2`,
          [id, companyId]
        );
        interface EntryRow {
          id: string;
          transaction_id: string;
          account_id: string;
          account_name: string;
          account_code: string;
          debit: number;
          credit: number;
          memo: string;
        }
        tx.entries = (entriesResult.rows as EntryRow[] || []).map((row) => ({
          id: row.id,
          transactionId: row.transaction_id,
          accountId: row.account_id,
          account: { id: row.account_id, nameAr: row.account_name, code: row.account_code } as Account,
          debit: Number(row.debit) || 0,
          credit: Number(row.credit) || 0,
          memo: row.memo,
        }));
        return { success: true, data: tx };
      }
      return { success: false, error: 'Transaction not found' };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async createTransaction(data: Omit<Transaction, 'id'>, _userId: string): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      const validation = validateInput(createTransactionSchema, data);
      if (!validation.success) return { success: false, error: validation.error };
      
      // Convert to service DTO format
      const entries = (data.entries as JournalEntry[]).map(entry => ({
        accountId: entry.accountId,
        debit: entry.debit,
        credit: entry.credit,
      }));
      
      const result = await accountingService.postTransaction({
        date: toDateString(data.date) || new Date().toISOString().split('T')[0],
        description: data.description || '',
        entries,
        reference: data.reference,
      });
      
      return result;
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async updateTransaction(id: string, companyId: string, userId: string, data: Partial<Transaction>): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      const adapter = await getDbAdapter();
      const txResult = await adapter.query(
        `UPDATE transactions SET date = $1::timestamptz, reference = $2, description = $3, total_amount = $4, status = $5, updated_at = NOW(), updated_by = $6 WHERE id = $7 AND company_id = $8`,
        [toDateString(data.date), data.reference, data.description, data.totalAmount, data.status, safeUserId(userId), id, companyId]
      );
      if (!txResult.success) return txResult;

      if (data.entries && data.entries.length > 0) {
        const deleteResult = await adapter.query(`DELETE FROM journal_entries WHERE transaction_id = $1 AND company_id = $2`, [id, companyId]);
        if (!deleteResult.success) return deleteResult;

        const entryQueries: { sql: string; params: unknown[] }[] = data.entries.map((entry) => ({
          sql: `INSERT INTO journal_entries (id, transaction_id, account_id, debit, credit, memo, company_id) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          params: [entry.id || crypto.randomUUID(), id, entry.accountId, entry.debit, entry.credit, entry.memo, companyId]
        }));
        const entryResult = await adapter.transaction(entryQueries);
        if (!entryResult.success) return { success: false, error: entryResult.error };
      }
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async postTransaction(id: string, companyId: string, userId?: string): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      const adapter = await getDbAdapter();
      const safeUpdatedBy = safeUserId(userId);
      if (safeUpdatedBy) {
        return await adapter.query(
          `UPDATE transactions SET status = 'posted', updated_at = NOW(), updated_by = $1 WHERE id = $2 AND company_id = $3`,
          [safeUpdatedBy, id, companyId]
        );
      }
      return await adapter.query(
        `UPDATE transactions SET status = 'posted', updated_at = NOW() WHERE id = $1 AND company_id = $2`,
        [id, companyId]
      );
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async deleteTransaction(id: string, companyId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      const adapter = await getDbAdapter();
      return await adapter.query(`DELETE FROM transactions WHERE id = $1 AND company_id = $2`, [id, companyId]);
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  // ─── Receipt Vouchers ─────────────────────────────────────────────────────
  async getReceiptVouchers(companyId: string, ownedByUserId?: string): Promise<{ success: boolean; data?: ReceiptVoucher[]; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      const adapter = await getDbAdapter();
      let sql = `
        SELECT rv.*, c.name as customer_name
        FROM receipt_vouchers rv
        LEFT JOIN customers c ON rv.customer_id = c.id
        WHERE rv.company_id = $1`;
      const params: unknown[] = [companyId];
      if (ownedByUserId) {
        sql += ` AND (rv.created_by = $${params.length + 1} OR rv.created_by IS NULL)`;
        params.push(ownedByUserId);
      }
      sql += ` ORDER BY rv.date DESC`;
      const result = await adapter.query(sql, params);
      if (result.success && result.rows) {
        return { success: true, data: mapRows<ReceiptVoucher>(result.rows) };
      }
      return { success: false, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async getReceiptVouchersPaginated(
    companyId: string,
    page: number,
    pageSize: number,
    filters?: { status?: string; search?: string; paymentMethod?: string }
  ): Promise<PaginatedQueryResult<ReceiptVoucher>> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      const { page: p, pageSize: ps, offset } = clampPageArgs(page, pageSize);
      const adapter = await getDbAdapter();

      const conditions: string[] = ['rv.company_id = $1'];
      const params: unknown[] = [companyId];
      if (filters?.status) {
        params.push(filters.status);
        conditions.push(`rv.status = $${params.length}`);
      }
      if (filters?.paymentMethod) {
        params.push(filters.paymentMethod);
        conditions.push(`rv.payment_method = $${params.length}`);
      }
      if (filters?.search) {
        params.push(`%${filters.search}%`);
        conditions.push(`(rv.voucher_number ILIKE $${params.length} OR c.name ILIKE $${params.length})`);
      }
      const where = conditions.join(' AND ');

      const countResult = await adapter.query(
        `SELECT COUNT(*)::int AS total FROM receipt_vouchers rv LEFT JOIN customers c ON rv.customer_id = c.id WHERE ${where}`,
        params
      );
      const total = Number(countResult.rows?.[0]?.total || 0);

      params.push(ps);
      params.push(offset);
      const limitIdx = params.length - 1;
      const offsetIdx = params.length;

      const dataResult = await adapter.query(
        `SELECT rv.*, c.name as customer_name
         FROM receipt_vouchers rv
         LEFT JOIN customers c ON rv.customer_id = c.id
         WHERE ${where}
         ORDER BY rv.date DESC
         LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        params
      );
      if (!dataResult.success) return { success: false, error: dataResult.error };

      const items = mapRows<ReceiptVoucher>(dataResult.rows || []);
      return { success: true, data: paginatedResult(items, total, p, ps) };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async createReceiptVoucher(data: Omit<ReceiptVoucher, 'id'>, userId: string): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      const validation = validateInput(createReceiptVoucherSchema, data);
      if (!validation.success) return { success: false, error: validation.error };
      if ((data.amountApplied ?? 0) > data.amount) {
        return { success: false, error: 'Amount applied cannot exceed voucher amount.' };
      }
      if (data.invoiceId && (data.amountApplied ?? 0) === 0) {
        return { success: false, error: 'Amount applied must be > 0 when invoice is specified.' };
      }
      if (!data.invoiceId && (data.amountApplied ?? 0) > 0) {
        return { success: false, error: 'Amount applied requires an invoice.' };
      }
      const id = crypto.randomUUID();
      const currencyCode = data.currencyCode || YER_CODE;
      const exchangeRate = data.exchangeRate ?? 1;
      const baseCurrencyAmount = data.baseCurrencyAmount ?? (data.amount * exchangeRate);
      const amountApplied = data.amountApplied ?? 0;
      const baseCurrencyApplied = data.baseCurrencyApplied ?? (amountApplied * exchangeRate);

      // Atomic batch: voucher INSERT (+ payment application) +, when created
      // directly as posted, the journal entry and customer balance adjustment
      // all commit together or roll back together.
      const statements: Array<{ sql: string; params?: unknown[] }> = [
        {
          sql: `INSERT INTO receipt_vouchers (id, company_id, voucher_number, date, customer_id, invoice_id, amount, amount_applied, currency_code, exchange_rate, base_currency_amount, base_currency_applied, payment_method, cash_box_id, check_number, check_date, notes, status, created_by, updated_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
          params: [id, data.companyId, data.voucherNumber, data.date, data.customerId, data.invoiceId || null, data.amount, amountApplied, currencyCode, exchangeRate, baseCurrencyAmount, baseCurrencyApplied, data.paymentMethod, data.cashBoxId || null, data.checkNumber || null, data.checkDate || null, data.notes, data.status, safeUserId(userId), safeUserId(userId)],
        },
      ];
      if (data.invoiceId && amountApplied > 0) {
        statements.push({
          sql: `WITH updated AS (
            UPDATE sales_invoices AS i
            SET
              paid_amount = COALESCE(i.paid_amount, 0) + $1,
              base_currency_paid = COALESCE(i.base_currency_paid, 0) + $2,
              status = CASE
                WHEN COALESCE(i.paid_amount, 0) + $1 >= i.total_amount
                  AND i.status NOT IN ('cancelled', 'paid')
                THEN 'paid'
                WHEN COALESCE(i.paid_amount, 0) + $1 > 0
                  AND i.status NOT IN ('cancelled', 'paid')
                THEN 'partially_paid'
                ELSE i.status
              END,
              updated_at = NOW()
            WHERE i.id = $3::uuid AND i.company_id = $4::uuid
            RETURNING i.customer_id
          )
          UPDATE customers SET balance = COALESCE(balance, 0) - $5::numeric, updated_at = NOW()
          WHERE id = (SELECT customer_id FROM updated) AND company_id = $4::uuid`,
          params: [amountApplied, baseCurrencyApplied, data.invoiceId, data.companyId, -amountApplied],
        });
      }
      // Created directly as posted → include JE + customer balance in the batch.
      if (data.status === 'posted' && amountApplied === 0 && !data.invoiceId) {
        const je = await buildReceiptVoucherStatements(data.companyId, {
          voucherNumber: data.voucherNumber,
          date: data.date,
          customerName: data.customerName || '',
          amount: data.amount,
          paymentMethod: data.paymentMethod || 'cash',
          customerId: data.customerId,
          cashBoxId: data.cashBoxId,
        });
        if (!je.success) return { success: false, error: je.error };
        statements.push(...je.statements);
      }
      const result = await runTransaction(statements);
      if (!result.success) {
        return { success: false, error: result.error };
      }
      return { success: true, id };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  /**
     * Post a draft receipt voucher: journal entry (Dr treasury / Cr debtors) +
   * customer balance decrement + status flip — one atomic transaction.
   * Single reference for both UI and AI harness.
   */
  async postVoucher(id: string, companyId: string, type: 'receipt' | 'payment', userId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      const adapter = await getDbAdapter();
      const table = type === 'receipt' ? 'receipt_vouchers' : 'payment_vouchers';
      const row = await adapter.query(
        `SELECT * FROM ${table} WHERE id = $1::uuid AND company_id = $2::uuid`,
        [id, companyId]
      );
      if (!row.success || !row.rows?.[0]) return { success: false, error: 'Voucher not found' };
      const v = row.rows[0] as Record<string, unknown>;
      if (String(v.status) !== 'draft') return { success: false, error: 'Voucher is not in draft status' };

      const amount = Number(v.amount) || 0;
      // v comes from a RAW pg row: the driver parses DATE columns as
      // new Date('YYYY-MM-DD') = UTC midnight, whose String() is
      // "Tue Aug 25 2026 03:00:00 GMT+0300 (...)" — unparseable by PG
      // timestamptz. Normalize through toDateString before any reuse.
      const common = {
        voucherNumber: String(v.voucher_number || ''),
        date: toDateString(v.date) || new Date().toISOString().split('T')[0],
        amount,
        paymentMethod: String(v.payment_method || 'cash'),
        cashBoxId: v.cash_box_id ? String(v.cash_box_id) : null,
      };

      const statements: Array<{ sql: string; params?: unknown[] }> = [];
      if (type === 'receipt') {
        const customerId = v.customer_id ? String(v.customer_id) : '';
        const je = await buildReceiptVoucherStatements(companyId, {
          ...common,
          customerName: '',
          customerId,
        });
        if (!je.success) return { success: false, error: je.error };
        statements.push(...je.statements);
        if (customerId && amount !== 0) {
          statements.push({
            sql: `UPDATE customers SET balance = COALESCE(balance,0) - $1::numeric, updated_at = NOW() WHERE id = $2::uuid AND company_id = $3::uuid`,
            params: [amount, customerId, companyId],
          });
        }
      } else {
        const supplierId = v.supplier_id ? String(v.supplier_id) : '';
        const expenseAccountId = v.expense_account_id ? String(v.expense_account_id) : undefined;
        const je = await buildPaymentVoucherStatements(companyId, {
          ...common,
          supplierName: '',
          supplierId,
          expenseAccountId,
        });
        if (!je.success) return { success: false, error: je.error };
        statements.push(...je.statements);
        if (supplierId && amount !== 0) {
          statements.push({
            sql: `UPDATE suppliers SET balance = COALESCE(balance,0) + $1::numeric, updated_at = NOW() WHERE id = $2::uuid AND company_id = $3::uuid`,
            params: [amount, supplierId, companyId],
          });
        }
      }
      statements.push({
        sql: `UPDATE ${table} SET status = 'posted', updated_by = $3::uuid, updated_at = NOW() WHERE id = $1::uuid AND company_id = $2::uuid AND status = 'draft'`,
        params: [id, companyId, safeUserId(userId)],
      });

      const result = await runTransaction(statements);
      if (!result.success) return { success: false, error: result.error };
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async updateReceiptVoucher(id: string, companyId: string, userId: string, data: Partial<ReceiptVoucher>): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      const adapter = await getDbAdapter();
      const current = await adapter.query(
        'SELECT status, amount_applied, base_currency_applied, invoice_id FROM receipt_vouchers WHERE id = $1::uuid AND company_id = $2::uuid',
        [id, companyId]
      );
      if (!current.success || !current.rows?.[0]) {
        return { success: false, error: 'Voucher not found' };
      }
      const cv = current.rows[0] as Record<string, unknown>;
      const currentStatus = String(cv.status);
      if (currentStatus === 'posted' && (data.invoiceId !== undefined || data.amountApplied !== undefined)) {
        return { success: false, error: 'Cannot modify invoice link or amount applied on a posted voucher.' };
      }
      const fields: string[] = [];
      const values: unknown[] = [];
      let idx = 1;
      if (data.date !== undefined) { fields.push(`date = $${idx++}::date`); values.push(toDateString(data.date)); }
      if (data.customerId !== undefined) { fields.push(`customer_id = $${idx++}`); values.push(data.customerId); }
      if (data.invoiceId !== undefined) { fields.push(`invoice_id = $${idx++}`); values.push(data.invoiceId || null); }
      if (data.amount !== undefined) { fields.push(`amount = $${idx++}`); values.push(data.amount); }
      if (data.amountApplied !== undefined) { fields.push(`amount_applied = $${idx++}`); values.push(data.amountApplied); }
      if (data.currencyCode !== undefined) { fields.push(`currency_code = $${idx++}`); values.push(data.currencyCode); }
      if (data.exchangeRate !== undefined) { fields.push(`exchange_rate = $${idx++}`); values.push(data.exchangeRate); }
      if (data.baseCurrencyAmount !== undefined) { fields.push(`base_currency_amount = $${idx++}`); values.push(data.baseCurrencyAmount); }
      if (data.baseCurrencyApplied !== undefined) { fields.push(`base_currency_applied = $${idx++}`); values.push(data.baseCurrencyApplied); }
      if (data.paymentMethod !== undefined) { fields.push(`payment_method = $${idx++}`); values.push(data.paymentMethod); }
      if (data.cashBoxId !== undefined) { fields.push(`cash_box_id = $${idx++}`); values.push(data.cashBoxId || null); }
      if (data.checkNumber !== undefined) { fields.push(`check_number = $${idx++}`); values.push(data.checkNumber || null); }
      if (data.checkDate !== undefined) { fields.push(`check_date = $${idx++}`); values.push(data.checkDate || null); }
      if (data.notes !== undefined) { fields.push(`notes = $${idx++}`); values.push(data.notes); }
      if (data.status !== undefined) { fields.push(`status = $${idx++}`); values.push(data.status); }
      fields.push(`updated_at = NOW()`);
      fields.push(`updated_by = $${idx++}`); values.push(safeUserId(userId));
      values.push(id);
      values.push(companyId);
      return await adapter.query(
        `UPDATE receipt_vouchers SET ${fields.join(', ')} WHERE id = $${idx}::uuid AND company_id = $${idx + 1}::uuid`,
        values
      );
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async deleteReceiptVoucher(id: string, companyId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      const adapter = await getDbAdapter();
      const check = await adapter.query(
        'SELECT invoice_id, amount_applied, base_currency_applied, status FROM receipt_vouchers WHERE id = $1::uuid AND company_id = $2::uuid',
        [id, companyId]
      );
      if (!check.success || !check.rows?.[0]) {
        return { success: false, error: 'Voucher not found' };
      }
      const v = check.rows[0] as Record<string, unknown>;
      const amountApplied = Number(v.amount_applied) || 0;
      if (amountApplied > 0) {
        return { success: false, error: 'Cannot delete voucher with applied payments. Reverse the payment first by creating a reversal voucher.' };
      }
      const result = await adapter.query(
        'DELETE FROM receipt_vouchers WHERE id = $1::uuid AND company_id = $2::uuid',
        [id, companyId]
      );
      if (result.success) return { success: true };
      const msg = result.error || '';
      if (msg.includes('foreign key') || msg.includes('violates')) {
        return { success: false, error: 'Cannot delete voucher with linked records. Cancel it instead.' };
      }
      return { success: false, error: result.error };
    } catch (e) {
      const msg = String(e);
      if (msg.includes('foreign key') || msg.includes('violates')) {
        return { success: false, error: 'Cannot delete voucher with linked records. Cancel it instead.' };
      }
      return { success: false, error: msg };
    }
  },

  // ─── Payment Vouchers ─────────────────────────────────────────────────────
  async getPaymentVouchers(companyId: string, ownedByUserId?: string): Promise<{ success: boolean; data?: PaymentVoucher[]; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      const adapter = await getDbAdapter();
      let sql = `
        SELECT pv.*, c.name as supplier_name, a.name_ar as expense_account_name
        FROM payment_vouchers pv
        LEFT JOIN suppliers c ON pv.supplier_id = c.id
        LEFT JOIN accounts a ON pv.expense_account_id = a.id
        WHERE pv.company_id = $1`;
      const params: unknown[] = [companyId];
      if (ownedByUserId) {
        sql += ` AND (pv.created_by = $${params.length + 1} OR pv.created_by IS NULL)`;
        params.push(ownedByUserId);
      }
      sql += ` ORDER BY pv.date DESC`;
      const result = await adapter.query(sql, params);
      if (result.success && result.rows) {
        return { success: true, data: mapRows<PaymentVoucher>(result.rows) };
      }
      return { success: false, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async getPaymentVouchersPaginated(
    companyId: string,
    page: number,
    pageSize: number,
    filters?: { status?: string; search?: string; paymentMethod?: string }
  ): Promise<PaginatedQueryResult<PaymentVoucher>> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      const { page: p, pageSize: ps, offset } = clampPageArgs(page, pageSize);
      const adapter = await getDbAdapter();

      const conditions: string[] = ['pv.company_id = $1'];
      const params: unknown[] = [companyId];
      if (filters?.status) {
        params.push(filters.status);
        conditions.push(`pv.status = $${params.length}`);
      }
      if (filters?.paymentMethod) {
        params.push(filters.paymentMethod);
        conditions.push(`pv.payment_method = $${params.length}`);
      }
      if (filters?.search) {
        params.push(`%${filters.search}%`);
        conditions.push(`(pv.voucher_number ILIKE $${params.length} OR c.name ILIKE $${params.length})`);
      }
      const where = conditions.join(' AND ');

      const countResult = await adapter.query(
        `SELECT COUNT(*)::int AS total FROM payment_vouchers pv LEFT JOIN suppliers c ON pv.supplier_id = c.id WHERE ${where}`,
        params
      );
      const total = Number(countResult.rows?.[0]?.total || 0);

      params.push(ps);
      params.push(offset);
      const limitIdx = params.length - 1;
      const offsetIdx = params.length;

      const dataResult = await adapter.query(
        `SELECT pv.*, c.name as supplier_name, a.name_ar as expense_account_name
         FROM payment_vouchers pv
         LEFT JOIN suppliers c ON pv.supplier_id = c.id
         LEFT JOIN accounts a ON pv.expense_account_id = a.id
         WHERE ${where}
         ORDER BY pv.date DESC
         LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        params
      );
      if (!dataResult.success) return { success: false, error: dataResult.error };

      const items = mapRows<PaymentVoucher>(dataResult.rows || []);
      return { success: true, data: paginatedResult(items, total, p, ps) };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async createPaymentVoucher(data: Omit<PaymentVoucher, 'id'>, userId: string): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      const validation = validateInput(createPaymentVoucherSchema, data);
      if (!validation.success) return { success: false, error: validation.error };
      if (!data.supplierId && !data.expenseAccountId) {
        return { success: false, error: 'Either supplier or expense account is required.' };
      }
      if ((data.amountApplied ?? 0) > data.amount) {
        return { success: false, error: 'Amount applied cannot exceed voucher amount.' };
      }
      if (data.invoiceId && (data.amountApplied ?? 0) === 0) {
        return { success: false, error: 'Amount applied must be > 0 when invoice is specified.' };
      }
      if (!data.invoiceId && (data.amountApplied ?? 0) > 0) {
        return { success: false, error: 'Amount applied requires an invoice.' };
      }
      const id = crypto.randomUUID();
      const currencyCode = data.currencyCode || YER_CODE;
      const exchangeRate = data.exchangeRate ?? 1;
      const baseCurrencyAmount = data.baseCurrencyAmount ?? (data.amount * exchangeRate);
      const amountApplied = data.amountApplied ?? 0;
      const baseCurrencyApplied = data.baseCurrencyApplied ?? (amountApplied * exchangeRate);

      // Atomic batch: voucher INSERT (+ application) +, when posted directly,
      // JE + supplier balance — all or nothing.
      const statements: Array<{ sql: string; params?: unknown[] }> = [
        {
          sql: `INSERT INTO payment_vouchers (id, company_id, voucher_number, date, supplier_id, invoice_id, expense_account_id, amount, amount_applied, currency_code, exchange_rate, base_currency_amount, base_currency_applied, payment_method, cash_box_id, check_number, check_date, notes, status, created_by, updated_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
          params: [id, data.companyId, data.voucherNumber, data.date, data.supplierId || null, data.invoiceId || null, data.expenseAccountId || null, data.amount, amountApplied, currencyCode, exchangeRate, baseCurrencyAmount, baseCurrencyApplied, data.paymentMethod, data.cashBoxId || null, data.checkNumber || null, data.checkDate || null, data.notes, data.status, safeUserId(userId), safeUserId(userId)],
        },
      ];
      if (data.invoiceId && amountApplied > 0) {
        statements.push({
          sql: `WITH updated AS (
            UPDATE purchase_invoices AS i
            SET
              paid_amount = COALESCE(i.paid_amount, 0) + $1,
              base_currency_paid = COALESCE(i.base_currency_paid, 0) + $2,
              status = CASE
                WHEN COALESCE(i.paid_amount, 0) + $1 >= i.total_amount
                  AND i.status NOT IN ('cancelled', 'paid')
                THEN 'paid'
                WHEN COALESCE(i.paid_amount, 0) + $1 > 0
                  AND i.status NOT IN ('cancelled', 'paid')
                THEN 'partially_paid'
                ELSE i.status
              END,
              updated_at = NOW()
            WHERE i.id = $3::uuid AND i.company_id = $4::uuid
            RETURNING i.supplier_id
          )
          UPDATE suppliers SET balance = COALESCE(balance, 0) + $5::numeric, updated_at = NOW()
          WHERE id = (SELECT supplier_id FROM updated) AND company_id = $4::uuid`,
          params: [amountApplied, baseCurrencyApplied, data.invoiceId, data.companyId, amountApplied],
        });
      }
      if (data.status === 'posted' && amountApplied === 0 && !data.invoiceId) {
        const je = await buildPaymentVoucherStatements(data.companyId, {
          voucherNumber: data.voucherNumber,
          date: data.date,
          supplierName: '',
          supplierId: data.supplierId || '',
          expenseAccountId: data.expenseAccountId,
          amount: data.amount,
          paymentMethod: data.paymentMethod || 'cash',
          cashBoxId: data.cashBoxId,
        });
        if (!je.success) return { success: false, error: je.error };
        statements.push(...je.statements);
        if (data.supplierId && data.amount !== 0) {
          statements.push({
            sql: `UPDATE suppliers SET balance = COALESCE(balance,0) + $1::numeric, updated_at = NOW() WHERE id = $2::uuid AND company_id = $3::uuid`,
            params: [data.amount, data.supplierId, data.companyId],
          });
        }
      }
      const result = await runTransaction(statements);
      if (!result.success) {
        return { success: false, error: result.error };
      }
      return { success: true, id };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async updatePaymentVoucher(id: string, companyId: string, userId: string, data: Partial<PaymentVoucher>): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      const adapter = await getDbAdapter();
      const current = await adapter.query(
        'SELECT status, amount_applied, base_currency_applied, invoice_id FROM payment_vouchers WHERE id = $1::uuid AND company_id = $2::uuid',
        [id, companyId]
      );
      if (!current.success || !current.rows?.[0]) {
        return { success: false, error: 'Voucher not found' };
      }
      const cv = current.rows[0] as Record<string, unknown>;
      const currentStatus = String(cv.status);
      if (currentStatus === 'posted' && (data.invoiceId !== undefined || data.amountApplied !== undefined)) {
        return { success: false, error: 'Cannot modify invoice link or amount applied on a posted voucher.' };
      }
      const fields: string[] = [];
      const values: unknown[] = [];
      let idx = 1;
      if (data.date !== undefined) { fields.push(`date = ${idx++}::date`); values.push(toDateString(data.date)); }
      if (data.supplierId !== undefined) { fields.push(`supplier_id = $${idx++}`); values.push(data.supplierId || null); }
      if (data.invoiceId !== undefined) { fields.push(`invoice_id = $${idx++}`); values.push(data.invoiceId || null); }
      if (data.expenseAccountId !== undefined) { fields.push(`expense_account_id = $${idx++}`); values.push(data.expenseAccountId || null); }
      if (data.amount !== undefined) { fields.push(`amount = $${idx++}`); values.push(data.amount); }
      if (data.amountApplied !== undefined) { fields.push(`amount_applied = $${idx++}`); values.push(data.amountApplied); }
      if (data.currencyCode !== undefined) { fields.push(`currency_code = $${idx++}`); values.push(data.currencyCode); }
      if (data.exchangeRate !== undefined) { fields.push(`exchange_rate = $${idx++}`); values.push(data.exchangeRate); }
      if (data.baseCurrencyAmount !== undefined) { fields.push(`base_currency_amount = $${idx++}`); values.push(data.baseCurrencyAmount); }
      if (data.baseCurrencyApplied !== undefined) { fields.push(`base_currency_applied = $${idx++}`); values.push(data.baseCurrencyApplied); }
      if (data.paymentMethod !== undefined) { fields.push(`payment_method = $${idx++}`); values.push(data.paymentMethod); }
      if (data.cashBoxId !== undefined) { fields.push(`cash_box_id = $${idx++}`); values.push(data.cashBoxId || null); }
      if (data.checkNumber !== undefined) { fields.push(`check_number = $${idx++}`); values.push(data.checkNumber || null); }
      if (data.checkDate !== undefined) { fields.push(`check_date = $${idx++}`); values.push(data.checkDate || null); }
      if (data.notes !== undefined) { fields.push(`notes = $${idx++}`); values.push(data.notes); }
      if (data.status !== undefined) { fields.push(`status = $${idx++}`); values.push(data.status); }
      fields.push(`updated_at = NOW()`);
      fields.push(`updated_by = $${idx++}`); values.push(safeUserId(userId));
      values.push(id);
      values.push(companyId);
      return await adapter.query(
        `UPDATE payment_vouchers SET ${fields.join(', ')} WHERE id = $${idx}::uuid AND company_id = $${idx + 1}::uuid`,
        values
      );
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async deletePaymentVoucher(id: string, companyId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      const adapter = await getDbAdapter();
      const check = await adapter.query(
        'SELECT invoice_id, amount_applied, base_currency_applied, status FROM payment_vouchers WHERE id = $1::uuid AND company_id = $2::uuid',
        [id, companyId]
      );
      if (!check.success || !check.rows?.[0]) {
        return { success: false, error: 'Voucher not found' };
      }
      const v = check.rows[0] as Record<string, unknown>;
      const amountApplied = Number(v.amount_applied) || 0;
      if (amountApplied > 0) {
        return { success: false, error: 'Cannot delete voucher with applied payments. Reverse the payment first by creating a reversal voucher.' };
      }
      const result = await adapter.query(
        'DELETE FROM payment_vouchers WHERE id = $1::uuid AND company_id = $2::uuid',
        [id, companyId]
      );
      if (result.success) return { success: true };
      const msg = result.error || '';
      if (msg.includes('foreign key') || msg.includes('violates')) {
        return { success: false, error: 'Cannot delete voucher with linked records. Cancel it instead.' };
      }
      return { success: false, error: result.error };
    } catch (e) {
      const msg = String(e);
      if (msg.includes('foreign key') || msg.includes('violates')) {
        return { success: false, error: 'Cannot delete voucher with linked records. Cancel it instead.' };
      }
      return { success: false, error: msg };
    }
  },

  // ─── Reports ──────────────────────────────────────────────────────────────
  async getTrialBalance(companyId: string, asOfDate?: string): Promise<{ success: boolean; data?: TrialBalanceRow[]; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      
      const result = await accountingService.getTrialBalance(asOfDate);
      
      if (!result.success || !result.data) {
        return { success: false, error: 'فشل جلب ميزان المراجعة' };
      }
      
      // Transform service output to API format
      const rows: TrialBalanceRow[] = result.data.map((r: Record<string, unknown>) => ({
        accountId: String(r.id),
        accountCode: String(r.code),
        accountName: String(r.account_name),
        debit: Number(r.debit) || 0,
        credit: Number(r.credit) || 0,
        balance: Number(r.balance) || 0,
      }));
      
      return { success: true, data: rows };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async getBalanceSheet(companyId: string, asOfDate?: string): Promise<{ success: boolean; data?: Account[]; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      
      const result = await accountingService.getBalanceSheet(asOfDate);
      
      if (!result.success || !result.data) {
        return { success: false, error: 'فشل جلب الميزانية' };
      }
      
      // Transform service output to API format
      const accounts: Account[] = result.data.map((r: Record<string, unknown>) => ({
        id: String(r.id),
        companyId,
        code: String(r.code),
        nameAr: String(r.name_ar),
        nameEn: String(r.name_en),
        type: r.type as Account['type'],
        nature: r.nature as Account['nature'],
        balance: Number(r.balance) || 0,
        isGroup: false,
        parentId: undefined,
        isActive: true,
        children: [],
      }));
      
      return { success: true, data: accounts };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async getProfitLoss(companyId: string, startDate?: string, endDate?: string): Promise<{ success: boolean; data?: Account[]; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      
      // Service requires both dates
      const effectiveStartDate = startDate || new Date().toISOString().split('T')[0];
      const effectiveEndDate = endDate || new Date().toISOString().split('T')[0];
      
      const result = await accountingService.getProfitLoss(effectiveStartDate, effectiveEndDate);
      
      if (!result.success || !result.data) {
        return { success: false, error: 'فشل جلب قائمة الدخل' };
      }
      
      // Transform service output to API format
      const accounts: Account[] = result.data.map((r: Record<string, unknown>) => ({
        id: String(r.id),
        companyId,
        code: String(r.code),
        nameAr: String(r.name_ar),
        nameEn: String(r.name_en),
        type: r.type as Account['type'],
        nature: r.nature as Account['nature'],
        balance: Number(r.balance) || 0,
        isGroup: false,
        parentId: undefined,
        isActive: true,
        children: [],
      }));
      
      return { success: true, data: accounts };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async getAccountLedger(accountId: string, companyId: string, startDate?: string, endDate?: string): Promise<{ success: boolean; data?: LedgerRow[]; error?: string }> {
    try {
      const cidValidation = validateInput(idCompanySchema, { companyId, id: accountId });
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      const adapter = await getDbAdapter();
      let sql = `
      SELECT
        t.id,
        t.date,
        t.reference,
        t.description,
        je.debit,
        je.credit
      FROM journal_entries je
      JOIN transactions t ON je.transaction_id = t.id
      WHERE je.account_id = $1 AND t.company_id = $2 AND t.status = 'posted'
      `;
      const params: unknown[] = [accountId, companyId];
      if (startDate) {
        sql += ` AND t.date >= $${params.length + 1}`;
        params.push(startDate);
      }
      if (endDate) {
        sql += ` AND t.date <= $${params.length + 1}`;
        params.push(endDate);
      }
      sql += ` ORDER BY t.date, t.created_at`;

      const result = await adapter.query(sql, params);
      if (result.success && result.rows) {
        interface LedgerQueryRow {
          id: string;
          date: string;
          reference: string;
          description: string;
          debit: number;
          credit: number;
        }
        let runningBalance = 0;
        const rows = (result.rows as LedgerQueryRow[]).map(row => {
          const debit = Number(row.debit) || 0;
          const credit = Number(row.credit) || 0;
          runningBalance += debit - credit;
          return {
            id: row.id,
            date: row.date,
            reference: row.reference,
            description: row.description,
            debit,
            credit,
            balance: runningBalance,
          } as LedgerRow;
        });
        return { success: true, data: rows };
      }
      return { success: false, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  /**
   * Apply a voucher (receipt or payment) to an invoice. Updates the invoice's
   * paid_amount + base_currency_paid and decrements customer/supplier balance.
   * Called automatically from createReceiptVoucher / createPaymentVoucher when
   * the voucher is created with an invoiceId + amountApplied > 0.
   */
  async applyPaymentToInvoice(
    voucherId: string,
    companyId: string,
    invoiceId: string,
    amountApplied: number,
    baseCurrencyApplied: number,
    voucherType: 'receipt' | 'payment',
    userId?: string | null
  ): Promise<{ success: boolean; error?: string }> {
    try {
      void voucherId;
      void userId;
      const table = voucherType === 'receipt' ? 'sales_invoices' : 'purchase_invoices';
      const partyTable = voucherType === 'receipt' ? 'customers' : 'suppliers';
      const partyIdColumn = voucherType === 'receipt' ? 'customer_id' : 'supplier_id';
      const balanceDelta = voucherType === 'receipt' ? -amountApplied : amountApplied;

      // Atomic batch: the invoice payment/status update and the party balance
      // adjustment commit together or roll back together.
      const result = await runTransaction([
        {
          sql: `WITH updated AS (
            UPDATE ${table} AS i
            SET
              paid_amount = COALESCE(i.paid_amount, 0) + $1,
              base_currency_paid = COALESCE(i.base_currency_paid, 0) + $2,
              status = CASE
                WHEN COALESCE(i.paid_amount, 0) + $1 >= i.total_amount
                  AND i.status NOT IN ('cancelled', 'paid')
                THEN 'paid'
                WHEN COALESCE(i.paid_amount, 0) + $1 > 0
                  AND i.status NOT IN ('cancelled', 'paid')
                THEN 'partially_paid'
                ELSE i.status
              END,
              updated_at = NOW()
            WHERE i.id = $3::uuid AND i.company_id = $4::uuid
            RETURNING i.${partyIdColumn}
          )
          UPDATE ${partyTable} SET balance = COALESCE(balance, 0) + $5::numeric, updated_at = NOW()
          WHERE id = (SELECT ${partyIdColumn} FROM updated) AND company_id = $4::uuid`,
          params: [amountApplied, baseCurrencyApplied, invoiceId, companyId, balanceDelta],
        },
      ]);
      if (!result.success) {
        return { success: false, error: result.error };
      }
      const rowCount = Number((result.results?.[0] as { rowCount?: number } | undefined)?.rowCount ?? 0);
      if (rowCount === 0) {
        return { success: false, error: 'Invoice not found' };
      }
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },
};
