import { getDbAdapter, isElectronPg } from '@/core/database/adapters';
import { runTransaction } from '@/core/database/tx';
import { buildReceiptVoucherStatements, buildPaymentVoucherStatements, buildFxDifferenceStatements, resolvePostingAccounts } from '@/core/utils/journalEntryGenerator';
import { mapRows, toDateString } from '@/core/utils/mapPgRow';
import { safeUserId } from '@/core/utils/userIdValidator';import { validateInput, idCompanySchema, companyIdSchema, createTransactionSchema, createReceiptVoucherSchema, createPaymentVoucherSchema } from '@/core/utils/validation';
import { clampPageArgs, paginatedResult, type PaginatedQueryResult } from '@/core/utils/pagination';
import { YER_CODE } from '@/core/utils/currencyConverter';
import { accountingService } from './services';
import type { Account, Transaction, JournalEntry, TrialBalanceRow, LedgerRow, ReceiptVoucher, PaymentVoucher, CashFlowStatement } from
'./types';

/** LOCAL calendar day — a UTC date is yesterday for GMT+3 between 00:00–03:00. */
const localToday = (): string => toDateString(new Date()) ?? '';

type AccountingRpcEnvelope = { success: boolean; rows?: Record<string, unknown>[]; error?: string };

async function invokePostTransactionRpc(id: string): Promise<AccountingRpcEnvelope | null> {
  if (!isElectronPg()) return null;
  const fn = typeof window !== 'undefined' ? window.electronDB?.accounting?.postTransaction : undefined;
  if (!fn) return { success: false, error: 'RPC unavailable' };
  try {
    return await fn({ id });
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

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
        // Financial balance comes from `running_balance` (SUM of ALL posted
        // JEs — opening included, see AGENTS.md Phase 72); `balance` stays as
        // the legacy display column for consumers that haven't migrated yet.
        const withStringCode = (rows: Account[]) =>
          rows.map((a) => ({
            ...a,
            code: String(a.code ?? ''),
            balance: (a as Account & { runningBalance?: number }).runningBalance !== undefined
              ? Number((a as Account & { runningBalance?: number }).runningBalance) || 0
              : Number(a.balance) || 0,
          }));
        let accounts = withStringCode(mapRows<Account>(result.data));

        if (ownedByUserId) {
          const filterResult = await adapter.query(
            `SELECT a.*, COALESCE((SELECT SUM(je.debit - je.credit)
               FROM journal_entries je JOIN transactions t ON je.transaction_id = t.id
               WHERE je.account_id = a.id AND t.company_id = a.company_id AND t.status = 'posted'), 0) AS running_balance
             FROM accounts a WHERE a.company_id = $1 AND (a.created_by = $2 OR a.created_by IS NULL)`,
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
      // P1 fix: dynamic-SET. The old full-column UPDATE wrote every omitted
      // field as NULL/undefined — toggling only isActive via the AI tool
      // (whose contract promises "empty fields won't be modified") nulled
      // nameAr/code/type. Only provided keys are SET; `balance` is never
      // writable here (ledger mirror, updated by posting flows only).
      const fields: string[] = [];
      const values: unknown[] = [];
      let n = 1;
      const push = (col: string, v: unknown, cast?: string) => {
        fields.push(`${col} = $${n}${cast ?? ''}`);
        values.push(v);
        n += 1;
      };
      if (data.nameAr !== undefined) push('name_ar', data.nameAr);
      if (data.nameEn !== undefined) push('name_en', data.nameEn);
      if (data.code !== undefined) push('code', data.code);
      if (data.parentId !== undefined) push('parent_id', data.parentId || null, '::uuid');
      if (data.type !== undefined) push('type', data.type);
      if (data.nature !== undefined) push('nature', data.nature);
      if (data.isGroup !== undefined) push('is_group', data.isGroup);
      if (data.isActive !== undefined) push('is_active', data.isActive);
      if (fields.length === 0) return { success: false, error: 'لا توجد حقول للتعديل' };
      fields.push('updated_at = NOW()');
      fields.push(`updated_by = $${n}::uuid`);
      values.push(userIdOrNull);
      values.push(id, companyId);
      return await adapter.query(
        `UPDATE accounts SET ${fields.join(', ')} WHERE id = $${n + 1} AND company_id = $${n + 2}`,
        values
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

      // Phase 2 (#5): the generic create path is DRAFT-ONLY. Posting is a
      // state transition with its own gates (row lock, period locks, balance
      // verification, session audit id), so it lives in exactly one place —
      // postTransaction / createAndPostTransaction. A caller that wants the
      // entry live in the books must compose, never overload `status`.
      if (data.status && data.status !== 'draft') {
        return {
          success: false,
          error: `A transaction can only be created as a draft (got "${data.status}"). Use createAndPostTransaction() to create and post in one step.`,
        };
      }

      // Convert to service DTO format
      const entries = (data.entries as JournalEntry[]).map(entry => ({
        accountId: entry.accountId,
        debit: entry.debit,
        credit: entry.credit,
        // memo must survive on the draft path: adapter.createTransaction
        // binds it as a param, and `undefined` params break pg binding —
        // normalize to null (the service path ignores memo by contract).
        memo: (entry as { memo?: unknown }).memo ?? null,
      }));
      const date = toDateString(data.date) || new Date().toISOString().split('T')[0];

      const adapter = await getDbAdapter();
      const draft = await adapter.createTransaction({
        companyId: data.companyId,
        date,
        reference: data.reference,
        description: data.description || '',
        totalAmount: data.totalAmount,
        status: 'draft',
        entries,
      });
      if (!draft.success) return { success: false, error: draft.error };
      return { success: true, id: draft.id };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  /**
   * The one sanctioned "create and post" flow: a draft first, then the
   * dedicated posting transition. Every caller that wants the entry live in
   * the books composes through here so the guards, the row lock and the audit
   * id can never be bypassed by a `status: 'posted'` payload.
   *
   * If posting fails the draft is NOT deleted — it stays as a reviewable
   * draft, exactly like a manual draft→post in the UI.
   */
  async createAndPostTransaction(data: Omit<Transaction, 'id'>, _userId: string): Promise<{ success: boolean; id?: string; error?: string }> {
    const draft = await accountingApi.createTransaction({ ...data, status: 'draft' } as Omit<Transaction, 'id'>, _userId);
    if (!draft.success || !draft.id) return { success: false, error: draft.error || 'Failed to create the draft entry' };
    const posted = await accountingApi.postTransaction(draft.id, data.companyId, _userId);
    if (!posted.success) return { success: false, error: posted.error || 'Entry created as draft but could not be posted' };
    return { success: true, id: draft.id };
  },

  async updateTransaction(id: string, companyId: string, userId: string, data: Partial<Transaction>): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      const adapter = await getDbAdapter();
      // Phase 0 fix: a POSTED transaction is immutable — editing it rewrites
      // SUM(journal_entries) retroactively while the books already report it.
      // Correct posted entries with a REVERSAL entry, never an UPDATE.
      // (Mirrors the draft-only guard on deleteTransaction below.)
      const cur = await adapter.query<{ status: string; date: string }>(
        `SELECT status, date FROM transactions WHERE id = $1 AND company_id = $2`,
        [id, companyId]
      );
      if (!cur.success) return { success: false, error: cur.error };
      const curRow = (cur.rows?.[0] || {}) as { status: string; date: string };
      const curStatus = String(curRow.status ?? '');
      if (!curStatus) return { success: false, error: 'Transaction not found' };
      if (curStatus !== 'draft') {
        return { success: false, error: 'لا يمكن تعديل قيد مرحّل — أنشئ قيداً عكسياً بدلاً من التعديل' };
      }
      // Status may only move draft → posted (validated, via postTransaction
      // semantics) or draft → cancelled. Anything else is rejected.
      const nextStatus = data.status;
      if (nextStatus !== undefined && nextStatus !== 'draft' && nextStatus !== 'posted' && nextStatus !== 'cancelled') {
        return { success: false, error: 'Invalid transaction status' };
      }
      // Phase 0 fix: replacement lines are validated server-side BEFORE the
      // old lines are deleted — the previous code trusted client totals, so
      // any AI/direct caller could post an unbalanced entry.
      if (data.entries && data.entries.length > 0) {
        const dr = data.entries.reduce((s, e) => s + (Number(e.debit) || 0), 0);
        const cr = data.entries.reduce((s, e) => s + (Number(e.credit) || 0), 0);
        if (Math.abs(dr - cr) > 0.01) {
          return { success: false, error: `Transaction not balanced: debit=${dr}, credit=${cr}` };
        }
        if (dr === 0) {
          return { success: false, error: 'Transaction amount cannot be zero' };
        }
      }
      if (nextStatus === 'posted') {
        // Phase 2 (#5): posting is a transition, not a field. A generic edit
        // must never be able to flip a draft into the books — it has no row
        // lock, no period re-check on the stored date and no audit identity
        // guarantee. Call postTransaction(id) instead: that path locks the row,
        // verifies the stored lines balance, honours the tax/fiscal period
        // gates and derives the audit user from the session.
        return {
          success: false,
          error: 'Posting is not a field update. Use postTransaction(id) so the row lock, balance and period gates apply.',
        };
      }
      // Dynamic SET: only provided fields are touched. The previous code
      // unconditionally overwrote date/reference/description/total with
      // possibly-undefined values (NULLing the header on partial updates).
      const headerFields: string[] = [];
      const headerValues: unknown[] = [];
      let hIdx = 1;
      if (data.date !== undefined) { headerFields.push(`date = $${hIdx++}::timestamptz`); headerValues.push(toDateString(data.date)); }
      if (data.reference !== undefined) { headerFields.push(`reference = $${hIdx++}`); headerValues.push(data.reference); }
      if (data.description !== undefined) { headerFields.push(`description = $${hIdx++}`); headerValues.push(data.description); }
      if (data.totalAmount !== undefined) { headerFields.push(`total_amount = $${hIdx++}`); headerValues.push(data.totalAmount); }
      if (nextStatus !== undefined && nextStatus !== curStatus) { headerFields.push(`status = $${hIdx++}`); headerValues.push(nextStatus); }
      headerFields.push(`updated_at = NOW()`);
      headerFields.push(`updated_by = $${hIdx++}`); headerValues.push(safeUserId(userId));
      headerValues.push(id);
      headerValues.push(companyId);
      const txResult = await adapter.query(
        `UPDATE transactions SET ${headerFields.join(', ')} WHERE id = $${hIdx} AND company_id = $${hIdx + 1} AND status = 'draft'`,
        headerValues
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
      const rpcResult = await invokePostTransactionRpc(id);
      if (rpcResult) return { success: rpcResult.success, error: rpcResult.error };
      const adapter = await getDbAdapter();
      // Phase 0 fix: posting is draft → posted ONLY, and only when the
      // stored lines balance. Previously ANY transaction (including an
      // already-posted one) was "posted" again with success, and unbalanced
      // drafts — creatable through the adapter path which never validates —
      // entered the books silently.
      const cur = await adapter.query<{ status: string; dr: number; cr: number; n: number; date: string }>(
        `SELECT t.status, t.date,
                COALESCE((SELECT SUM(je.debit) FROM journal_entries je WHERE je.transaction_id = t.id AND je.company_id = t.company_id), 0) AS dr,
                COALESCE((SELECT SUM(je.credit) FROM journal_entries je WHERE je.transaction_id = t.id AND je.company_id = t.company_id), 0) AS cr,
                (SELECT COUNT(*)::int FROM journal_entries je WHERE je.transaction_id = t.id AND je.company_id = t.company_id) AS n
           FROM transactions t WHERE t.id = $1 AND t.company_id = $2`,
        [id, companyId]
      );
      if (!cur.success) return { success: false, error: cur.error };
      const row = cur.rows?.[0] as { status: string; dr: number; cr: number; n: number; date: string } | undefined;
      if (!row) return { success: false, error: 'Transaction not found' };
      if (String(row.status) !== 'draft') {
        return { success: false, error: 'Transaction is not in draft status (already posted or cancelled)' };
      }
      // Phase 3: posting into a closed/filing tax period is rejected.
      const { assertPeriodOpen: assertPostPeriod } = await import('@/modules/tax/engine');
       const postGate = await assertPostPeriod(companyId, toDateString(row.date) || '', adapter);
      if (!postGate.open) {
        return { success: false, error: `الفترة الضريبية مغلقة (${postGate.period.startDate} – ${postGate.period.endDate}) — لا يمكن الترحيل بتاريخ داخلها` };
      }
      // Phase 5: a closed fiscal year locks its dates for every posting path.
      const { assertAccountingPeriodOpen: assertFiscalPost } = await import('@/modules/accounting/yearEnd');
       const fiscalPostGate = await assertFiscalPost(companyId, toDateString(row.date) || '', adapter);
      if (!fiscalPostGate.open) {
        return { success: false, error: `السنة المالية ${fiscalPostGate.period.year} مقفلة — لا يمكن الترحيل بتاريخ داخلها` };
      }
      const dr = Number(row.dr) || 0;
      const cr = Number(row.cr) || 0;
      if (Number(row.n) === 0 || Math.abs(dr - cr) > 0.01 || dr === 0) {
        return { success: false, error: `Cannot post unbalanced transaction: debit=${dr}, credit=${cr}` };
      }
      const safeUpdatedBy = safeUserId(userId);
      // RETURNING id makes the flip verifiable: zero rows = lost race /
      // already posted — reported honestly instead of silent success.
      const flip = safeUpdatedBy
        ? await adapter.query<{ id: string }>(
          `UPDATE transactions SET status = 'posted', updated_at = NOW(), updated_by = $1 WHERE id = $2 AND company_id = $3 AND status = 'draft' RETURNING id`,
          [safeUpdatedBy, id, companyId]
        )
        : await adapter.query<{ id: string }>(
          `UPDATE transactions SET status = 'posted', updated_at = NOW() WHERE id = $1 AND company_id = $2 AND status = 'draft' RETURNING id`,
          [id, companyId]
        );
      if (!flip.success) return { success: false, error: flip.error };
      if (!flip.rows || flip.rows.length === 0) {
        return { success: false, error: 'Transaction is not in draft status (already posted or cancelled)' };
      }
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async deleteTransaction(id: string, companyId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      const adapter = await getDbAdapter();
      // P1 fix: draft-only guard at the API layer. Deleting a POSTED
      // transaction cascades its journal_entries (FK CASCADE) and
      // retroactively changes SUM(journal_entries) — the declared single
      // source of truth — while the accounts.balance mirror keeps the stale
      // bump. The UI disables delete for posted rows; the API must too
      // (the AI tool is otherwise less safe than the UI). Posted entries
      // are corrected with a REVERSAL entry, never a DELETE.
      const cur = await adapter.query<{ status: string }>(
        `SELECT status FROM transactions WHERE id = $1 AND company_id = $2`,
        [id, companyId]
      );
      if (!cur.success) return { success: false, error: cur.error };
      const status = String(cur.rows?.[0]?.status ?? '');
      if (!status) return { success: false, error: 'القيد غير موجود' };
      if (status !== 'draft') {
        return { success: false, error: 'لا يمكن حذف قيد مرحّل — أنشئ قيداً عكسياً بدلاً من الحذف' };
      }
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
      // Posted vouchers: JE (base) + invoice allocation + customer balance +
      // realized FX difference — all atomic. Draft vouchers are inert.
      if (data.status === 'posted') {
        // Phase 5: direct-posted creates skip postVoucher, so the fiscal
        // lock is enforced here too (same dates, same message).
        const { assertAccountingPeriodOpen: assertFiscalDirect } = await import('@/modules/accounting/yearEnd');
        const fiscalDirectGate = await assertFiscalDirect(data.companyId, String(data.date || ''));
        if (!fiscalDirectGate.open) {
          return { success: false, error: `السنة المالية ${fiscalDirectGate.period.year} مقفلة — لا يمكن الترحيل بتاريخ داخلها` };
        }
        const je = await buildReceiptVoucherStatements(data.companyId, {
          voucherNumber: data.voucherNumber,
          date: data.date,
          customerName: data.customerName || '',
          amount: data.amount,
          paymentMethod: data.paymentMethod || 'cash',
          customerId: data.customerId,
          cashBoxId: data.cashBoxId,
          // Phase 2: the treasury moves base value, not document numbers.
          baseAmount: baseCurrencyAmount,
        });
        if (!je.success) return { success: false, error: je.error };
        statements.push(...je.statements);
        // Customer balance always drops by the full voucher amount (on-account
        // and allocated alike — statement nets the full receipt).
        statements.push({
          sql: `UPDATE customers SET balance = COALESCE(balance,0) - $1::numeric, updated_at = NOW() WHERE id = $2::uuid AND company_id = $3::uuid`,
          params: [data.amount, data.customerId, data.companyId],
        });
        // Allocated portion also bumps the invoice's paid amount.
        if (data.invoiceId && amountApplied > 0) {
          // Phase 2: read the invoice for the outstanding cap AND its rate.
          // The invoice accrues base at ITS rate; the voucher moved base at
          // the PAYMENT rate — the gap is a realized FX difference (IAS 21).
          const adapter = await getDbAdapter();
          const invRes = await adapter.query(
            `SELECT total_amount, COALESCE(paid_amount, 0) AS paid_amount, status,
                    COALESCE(currency_code, '') AS currency_code,
                    COALESCE(exchange_rate, 0) AS exchange_rate,
                    COALESCE(base_currency_amount, 0) AS base_currency_amount
               FROM sales_invoices WHERE id = $1::uuid AND company_id = $2::uuid`,
            [data.invoiceId, data.companyId]
          );
          if (!invRes.success) return { success: false, error: invRes.error };
          const invRow = invRes.rows?.[0] as Record<string, unknown> | undefined;
          if (!invRow) return { success: false, error: 'Linked invoice not found' };
          if (String(invRow.status) === 'cancelled') {
            return { success: false, error: 'Cannot link a voucher to a cancelled invoice' };
          }
          // Phase 2: application is only meaningful in the invoice currency —
          // cross-currency settlement needs an explicit FX voucher (Phase 3).
          if (String(invRow.currency_code || '') !== String(data.currencyCode || YER_CODE)) {
            return { success: false, error: `Voucher currency (${data.currencyCode || YER_CODE}) must match the invoice currency (${invRow.currency_code})` };
          }
          const invTotal = Number(invRow.total_amount) || 0;
          const invPaid = Number(invRow.paid_amount) || 0;
          if (amountApplied > invTotal - invPaid) {
            return { success: false, error: `Applied amount (${amountApplied}) exceeds the invoice outstanding (${invTotal - invPaid})` };
          }
          const invStoredBase = Number(invRow.base_currency_amount) || 0;
          const invRate = invTotal > 0 && invStoredBase > 0 ? invStoredBase / invTotal : (Number(invRow.exchange_rate) || 0);
          const invoiceBaseApplied = Math.round(amountApplied * (invRate > 0 ? invRate : exchangeRate) * 100) / 100;
          statements.push({
            sql: `UPDATE sales_invoices AS i
                  SET paid_amount = COALESCE(i.paid_amount, 0) + $1,
                      base_currency_paid = COALESCE(i.base_currency_paid, 0) + $2,
                      status = CASE
                        WHEN COALESCE(i.paid_amount, 0) + $1 >= i.total_amount AND i.status NOT IN ('cancelled', 'paid') THEN 'paid'
                        WHEN COALESCE(i.paid_amount, 0) + $1 > 0 AND i.status NOT IN ('cancelled', 'paid') THEN 'partially_paid'
                        ELSE i.status END,
                      updated_at = NOW()
                  WHERE i.id = $3::uuid AND i.company_id = $4::uuid`,
            params: [amountApplied, invoiceBaseApplied, data.invoiceId, data.companyId],
          });
          // Realized FX difference: booked (invoice rate) vs moved (voucher rate).
          const fxDiff = Math.round((invoiceBaseApplied - baseCurrencyApplied) * 100) / 100;
          if (Math.abs(fxDiff) >= 0.01) {
            const fxAccs = await resolvePostingAccounts(data.companyId, ['default_debtors', 'default_exchange_difference']);
            if (!fxAccs.success) return { success: false, error: fxAccs.error };
            statements.push(...buildFxDifferenceStatements(data.companyId, {
              reference: data.voucherNumber,
              date: data.date,
              memo: `فرق صرف محقق - سند ${data.voucherNumber}`,
              amount: Math.abs(fxDiff),
              // Received LESS base value than booked → loss (Dr FX / Cr debtors);
              // received MORE → gain (Dr debtors / Cr FX).
              debitAccount: fxDiff > 0 ? fxAccs.ids.default_exchange_difference : fxAccs.ids.default_debtors,
              creditAccount: fxDiff > 0 ? fxAccs.ids.default_debtors : fxAccs.ids.default_exchange_difference,
            }));
          }
        }
      } else if (data.invoiceId && amountApplied > 0) {
        // Draft but invoice-linked: validate linkage without touching balances.
        // No-op — invoice/balance moves happen only when posted.
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
      // Phase 3: posting into a closed/filing tax period is rejected.
      const { assertPeriodOpen: assertVoucherPeriod } = await import('@/modules/tax/engine');
      const voucherGate = await assertVoucherPeriod(companyId, String(toDateString(v.date) || ''), adapter);
      if (!voucherGate.open) {
        return { success: false, error: `الفترة الضريبية مغلقة (${voucherGate.period.startDate} – ${voucherGate.period.endDate}) — لا يمكن الترحيل بتاريخ داخلها` };
      }
      // Phase 5: a closed fiscal year locks its dates for every posting path.
      const { assertAccountingPeriodOpen: assertFiscalVoucher } = await import('@/modules/accounting/yearEnd');
      const fiscalVoucherGate = await assertFiscalVoucher(companyId, String(toDateString(v.date) || ''), adapter);
      if (!fiscalVoucherGate.open) {
        return { success: false, error: `السنة المالية ${fiscalVoucherGate.period.year} مقفلة — لا يمكن الترحيل بتاريخ داخلها` };
      }

      const amount = Number(v.amount) || 0;
      // v comes from a RAW pg row: the driver parses DATE columns as
      // new Date('YYYY-MM-DD') = UTC midnight, whose String() is
      // "Tue Aug 25 2026 03:00:00 GMT+0300 (...)" — unparseable by PG
      // timestamptz. Normalize through toDateString before any reuse.
      const common = {
        voucherNumber: String(v.voucher_number || ''),
        date: toDateString(v.date) || new Date().toISOString().split('T')[0],
        amount,
        // Phase 2: the treasury moves base value (stored base wins, else
        // document amount — base-only vouchers post unchanged).
        baseAmount: Number(v.base_currency_amount) || amount,
        paymentMethod: String(v.payment_method || 'cash'),
        cashBoxId: v.cash_box_id ? String(v.cash_box_id) : null,
      };

      const statements: Array<{ sql: string; params?: unknown[] }> = [];
      // Phase 0 fix: a draft voucher may carry an invoice link
      // (invoice_id + amount_applied). Posting MUST move the invoice's
      // paid_amount/status exactly like the direct-posted create path does —
      // otherwise the invoice stays "due" while the statement nets the
      // receipt, and AR/AP aging contradicts the ledger.
      const linkedInvoiceId = v.invoice_id ? String(v.invoice_id) : '';
      const linkedApplied = Number(v.amount_applied) || 0;
      const linkedBaseApplied = Number(v.base_currency_applied) || 0;
      const pushInvoiceApplication = async (invoiceTable: 'sales_invoices' | 'purchase_invoices'): Promise<{ success: boolean; error?: string }> => {
        if (!linkedInvoiceId || linkedApplied <= 0) return { success: true };
        const inv = await adapter.query(
          `SELECT total_amount, COALESCE(paid_amount, 0) AS paid_amount, status,
                  COALESCE(exchange_rate, 0) AS exchange_rate,
                  COALESCE(base_currency_amount, 0) AS base_currency_amount
             FROM ${invoiceTable} WHERE id = $1::uuid AND company_id = $2::uuid`,
          [linkedInvoiceId, companyId]
        );
        if (!inv.success) return { success: false, error: inv.error };
        const irow = inv.rows?.[0] as Record<string, unknown> | undefined;
        if (!irow) return { success: false, error: 'Linked invoice not found' };
        if (String(irow.status) === 'cancelled') {
          return { success: false, error: 'Cannot post a voucher linked to a cancelled invoice' };
        }
        const outstanding = (Number(irow.total_amount) || 0) - (Number(irow.paid_amount) || 0);
        if (linkedApplied > outstanding) {
          return { success: false, error: `Applied amount (${linkedApplied}) exceeds the invoice outstanding (${outstanding})` };
        }
        // Phase 2: the invoice accrues base at ITS rate; the voucher moved
        // base at the payment rate — the gap is realized FX (IAS 21).
        const invTotal = Number(irow.total_amount) || 0;
        const invStoredBase = Number(irow.base_currency_amount) || 0;
        const invRate = invTotal > 0 && invStoredBase > 0 ? invStoredBase / invTotal : (Number(irow.exchange_rate) || 0);
        const invoiceBaseApplied = Math.round(linkedApplied * (invRate > 0 ? invRate : 1) * 100) / 100;
        statements.push({
          sql: `UPDATE ${invoiceTable} AS i
                SET paid_amount = COALESCE(i.paid_amount, 0) + $1,
                    base_currency_paid = COALESCE(i.base_currency_paid, 0) + $2,
                    status = CASE
                      WHEN COALESCE(i.paid_amount, 0) + $1 >= i.total_amount AND i.status NOT IN ('cancelled', 'paid') THEN 'paid'
                      WHEN COALESCE(i.paid_amount, 0) + $1 > 0 AND i.status NOT IN ('cancelled', 'paid') THEN 'partially_paid'
                      ELSE i.status END,
                    updated_at = NOW()
                WHERE i.id = $3::uuid AND i.company_id = $4::uuid`,
          params: [linkedApplied, invoiceBaseApplied, linkedInvoiceId, companyId],
        });
        const fxDiff = Math.round((invoiceBaseApplied - linkedBaseApplied) * 100) / 100;
        if (Math.abs(fxDiff) >= 0.01) {
          const partyKey = type === 'receipt' ? 'default_debtors' : 'default_creditors';
          const fxAccs = await resolvePostingAccounts(companyId, [partyKey, 'default_exchange_difference']);
          if (!fxAccs.success) return { success: false, error: fxAccs.error };
          const partyAcc = fxAccs.ids[partyKey];
          const fxAcc = fxAccs.ids.default_exchange_difference;
          // Receipt: received less than booked → Dr FX / Cr debtors (and mirror).
          // Payment: relieved more than paid → Dr creditors / Cr FX (and mirror).
          const receipt = type === 'receipt';
          const debitAccount = receipt
            ? (fxDiff > 0 ? fxAcc : partyAcc)
            : (fxDiff > 0 ? partyAcc : fxAcc);
          const creditAccount = receipt
            ? (fxDiff > 0 ? partyAcc : fxAcc)
            : (fxDiff > 0 ? fxAcc : partyAcc);
          statements.push(...buildFxDifferenceStatements(companyId, {
            reference: String(v.voucher_number || ''),
            date: typeof common.date === 'string' ? common.date : new Date().toISOString().split('T')[0],
            memo: `فرق صرف محقق - سند ${String(v.voucher_number || '')}`,
            amount: Math.abs(fxDiff),
            debitAccount,
            creditAccount,
          }));
        }
        return { success: true };
      };
      if (type === 'receipt') {
        const customerId = v.customer_id ? String(v.customer_id) : '';
        const je = await buildReceiptVoucherStatements(companyId, {
          ...common,
          customerName: '',
          customerId,
          baseAmount: common.baseAmount,
        });
        if (!je.success) return { success: false, error: je.error };
        statements.push(...je.statements);
        if (customerId && amount !== 0) {
          statements.push({
            sql: `UPDATE customers SET balance = COALESCE(balance,0) - $1::numeric, updated_at = NOW() WHERE id = $2::uuid AND company_id = $3::uuid`,
            params: [amount, customerId, companyId],
          });
        }
        const applied = await pushInvoiceApplication('sales_invoices');
        if (!applied.success) return applied;
      } else {
        // Phase 4: same treasury floor as direct-posted payments.
        const {
          getStockPolicies: getPostPayPolicies, getCashBoxGlBalance: getPostPayBox, auditOverride: auditPostPay,
        } = await import('@/core/utils/stockPolicy');
        const postPayPolicies = await getPostPayPolicies(companyId, adapter);
        const postPayBalance = await getPostPayBox(companyId, common.cashBoxId, adapter);
        if (postPayBalance !== null && postPayBalance - common.baseAmount < 0) {
          const msg = `رصيد الخزينة لا يكفي للصرف (المتاح ${postPayBalance} — المطلوب ${common.baseAmount})`;
          if (!postPayPolicies.allowNegativeCashbox) {
            return { success: false, error: msg };
          }
          await auditPostPay({
            companyId, userId: safeUserId(userId), kind: 'negative-cashbox',
            recordId: id, label: `سند صرف ${common.voucherNumber}`,
            detail: { balance: postPayBalance, amount: common.baseAmount },
          });
        }
        const supplierId = v.supplier_id ? String(v.supplier_id) : '';
        const expenseAccountId = v.expense_account_id ? String(v.expense_account_id) : undefined;
        const je = await buildPaymentVoucherStatements(companyId, {
          ...common,
          supplierName: '',
          supplierId,
          expenseAccountId,
          baseAmount: common.baseAmount,
        });
        if (!je.success) return { success: false, error: je.error };
        statements.push(...je.statements);
        if (supplierId && amount !== 0) {
          statements.push({
            sql: `UPDATE suppliers SET balance = COALESCE(balance,0) - $1::numeric, updated_at = NOW() WHERE id = $2::uuid AND company_id = $3::uuid`,
            params: [amount, supplierId, companyId],
          });
        }
        const applied = await pushInvoiceApplication('purchase_invoices');
        if (!applied.success) return applied;
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
      // Phase 5: reversed vouchers are terminal — the mirror JE already
      // netted every effect. Only reverseVoucher may set this status.
      if (currentStatus === 'reversed') {
        return { success: false, error: 'Cannot modify a reversed voucher — it is terminal.' };
      }
      if (data.status === 'reversed') {
        return { success: false, error: 'Reversed status is set only by the reversal workflow.' };
      }
      // Phase 0 fix: a posted voucher already moved GL + party balance +
      // invoice paid_amount. Editing ANY financial term (amount, currency,
      // rate, party, treasury, method, date, link) without reversing those
      // effects corrupts all three. Posted vouchers are immutable except
      // for notes/check references/status — correct them with a reversal.
      if (currentStatus === 'posted' && (
        data.invoiceId !== undefined || data.amountApplied !== undefined ||
        data.amount !== undefined || data.currencyCode !== undefined ||
        data.exchangeRate !== undefined || data.baseCurrencyAmount !== undefined ||
        data.baseCurrencyApplied !== undefined || data.customerId !== undefined ||
        data.cashBoxId !== undefined || data.paymentMethod !== undefined ||
        data.date !== undefined
      )) {
        return { success: false, error: 'Cannot modify a posted voucher — reverse it with a reversal voucher instead.' };
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
      // Phase 0 fix: a posted voucher already moved GL + party balance
      // (+ invoice paid_amount when linked). Deleting it leaves an orphan JE
      // and a drifted balance — posted vouchers are reversed, never deleted.
      if (String(v.status) === 'posted') {
        return { success: false, error: 'Cannot delete a posted voucher — reverse it with a reversal voucher instead.' };
      }
      // Phase 5: reversed vouchers carry a mirror JE — deleting them
      // orphans it. Terminal means terminal.
      if (String(v.status) === 'reversed') {
        return { success: false, error: 'Cannot delete a reversed voucher — it is terminal.' };
      }
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
      // Posted vouchers: JE (base) + invoice allocation + supplier balance +
      // realized FX difference — all atomic. Draft vouchers are inert.
      if (data.status === 'posted') {
        // Phase 5: direct-posted creates skip postVoucher, so the fiscal
        // lock is enforced here too (same dates, same message).
        const { assertAccountingPeriodOpen: assertFiscalPayDirect } = await import('@/modules/accounting/yearEnd');
        const fiscalPayDirectGate = await assertFiscalPayDirect(data.companyId, String(data.date || ''));
        if (!fiscalPayDirectGate.open) {
          return { success: false, error: `السنة المالية ${fiscalPayDirectGate.period.year} مقفلة — لا يمكن الترحيل بتاريخ داخلها` };
        }
        // Phase 4: a payment voucher drains the treasury — refuse (or audit)
        // driving the cash-box GL balance below zero.
        const adapter = await getDbAdapter();
        const {
          getStockPolicies: getPayPolicies, getCashBoxGlBalance: getPayBoxBalance, auditOverride: auditPay,
        } = await import('@/core/utils/stockPolicy');
        const payPolicies = await getPayPolicies(data.companyId, adapter);
        const payBoxBalance = await getPayBoxBalance(data.companyId, data.cashBoxId, adapter);
        if (payBoxBalance !== null && payBoxBalance - baseCurrencyAmount < 0) {
          const msg = `رصيد الخزينة لا يكفي للصرف (المتاح ${payBoxBalance} — المطلوب ${baseCurrencyAmount})`;
          if (!payPolicies.allowNegativeCashbox) {
            return { success: false, error: msg };
          }
          await auditPay({
            companyId: data.companyId, userId: safeUserId(userId), kind: 'negative-cashbox',
            recordId: id, label: `سند صرف ${data.voucherNumber}`,
            detail: { balance: payBoxBalance, amount: baseCurrencyAmount },
          });
        }
        const je = await buildPaymentVoucherStatements(data.companyId, {
          voucherNumber: data.voucherNumber,
          date: data.date,
          supplierName: '',
          supplierId: data.supplierId || '',
          expenseAccountId: data.expenseAccountId,
          amount: data.amount,
          paymentMethod: data.paymentMethod || 'cash',
          cashBoxId: data.cashBoxId,
          // Phase 2: the treasury moves base value, not document numbers.
          baseAmount: baseCurrencyAmount,
        });
        if (!je.success) return { success: false, error: je.error };
        statements.push(...je.statements);
        // Supplier AP always drops by the full voucher amount when we pay.
        if (data.supplierId && data.amount !== 0) {
          statements.push({
            sql: `UPDATE suppliers SET balance = COALESCE(balance,0) - $1::numeric, updated_at = NOW() WHERE id = $2::uuid AND company_id = $3::uuid`,
            params: [data.amount, data.supplierId, data.companyId],
          });
        }
        if (data.invoiceId && amountApplied > 0) {
          // Phase 2: same invoice-rate accrual + outstanding cap + realized
          // FX difference as the receipt path (mirrored for payables).
          const adapter = await getDbAdapter();
          const invRes = await adapter.query(
            `SELECT total_amount, COALESCE(paid_amount, 0) AS paid_amount, status,
                    COALESCE(currency_code, '') AS currency_code,
                    COALESCE(exchange_rate, 0) AS exchange_rate,
                    COALESCE(base_currency_amount, 0) AS base_currency_amount
               FROM purchase_invoices WHERE id = $1::uuid AND company_id = $2::uuid`,
            [data.invoiceId, data.companyId]
          );
          if (!invRes.success) return { success: false, error: invRes.error };
          const invRow = invRes.rows?.[0] as Record<string, unknown> | undefined;
          if (!invRow) return { success: false, error: 'Linked invoice not found' };
          if (String(invRow.status) === 'cancelled') {
            return { success: false, error: 'Cannot link a voucher to a cancelled invoice' };
          }
          if (String(invRow.currency_code || '') !== String(data.currencyCode || YER_CODE)) {
            return { success: false, error: `Voucher currency (${data.currencyCode || YER_CODE}) must match the invoice currency (${invRow.currency_code})` };
          }
          const invTotal = Number(invRow.total_amount) || 0;
          const invPaid = Number(invRow.paid_amount) || 0;
          if (amountApplied > invTotal - invPaid) {
            return { success: false, error: `Applied amount (${amountApplied}) exceeds the invoice outstanding (${invTotal - invPaid})` };
          }
          const invStoredBase = Number(invRow.base_currency_amount) || 0;
          const invRate = invTotal > 0 && invStoredBase > 0 ? invStoredBase / invTotal : (Number(invRow.exchange_rate) || 0);
          const invoiceBaseApplied = Math.round(amountApplied * (invRate > 0 ? invRate : exchangeRate) * 100) / 100;
          statements.push({
            sql: `UPDATE purchase_invoices AS i
                  SET paid_amount = COALESCE(i.paid_amount, 0) + $1,
                      base_currency_paid = COALESCE(i.base_currency_paid, 0) + $2,
                      status = CASE
                        WHEN COALESCE(i.paid_amount, 0) + $1 >= i.total_amount AND i.status NOT IN ('cancelled', 'paid') THEN 'paid'
                        WHEN COALESCE(i.paid_amount, 0) + $1 > 0 AND i.status NOT IN ('cancelled', 'paid') THEN 'partially_paid'
                        ELSE i.status END,
                      updated_at = NOW()
                  WHERE i.id = $3::uuid AND i.company_id = $4::uuid`,
            params: [amountApplied, invoiceBaseApplied, data.invoiceId, data.companyId],
          });
          // Relieved MORE base value than paid → gain (Dr creditors / Cr FX);
          // paid MORE → loss (Dr FX / Cr creditors).
          const fxDiff = Math.round((invoiceBaseApplied - baseCurrencyApplied) * 100) / 100;
          if (Math.abs(fxDiff) >= 0.01) {
            const fxAccs = await resolvePostingAccounts(data.companyId, ['default_creditors', 'default_exchange_difference']);
            if (!fxAccs.success) return { success: false, error: fxAccs.error };
            statements.push(...buildFxDifferenceStatements(data.companyId, {
              reference: data.voucherNumber,
              date: data.date,
              memo: `فرق صرف محقق - سند ${data.voucherNumber}`,
              amount: Math.abs(fxDiff),
              debitAccount: fxDiff > 0 ? fxAccs.ids.default_creditors : fxAccs.ids.default_exchange_difference,
              creditAccount: fxDiff > 0 ? fxAccs.ids.default_exchange_difference : fxAccs.ids.default_creditors,
            }));
          }
        }
      } else if (data.invoiceId && amountApplied > 0) {
        // Draft but invoice-linked: no-op — invoice/balance moves happen only when posted.
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
      // Phase 5: reversed vouchers are terminal (see updateReceiptVoucher).
      if (currentStatus === 'reversed') {
        return { success: false, error: 'Cannot modify a reversed voucher — it is terminal.' };
      }
      if (data.status === 'reversed') {
        return { success: false, error: 'Reversed status is set only by the reversal workflow.' };
      }
      // Phase 0 fix: same posted-voucher immutability as receipts (see
      // updateReceiptVoucher) — financial terms need a reversal, not an edit.
      if (currentStatus === 'posted' && (
        data.invoiceId !== undefined || data.amountApplied !== undefined ||
        data.amount !== undefined || data.currencyCode !== undefined ||
        data.exchangeRate !== undefined || data.baseCurrencyAmount !== undefined ||
        data.baseCurrencyApplied !== undefined || data.supplierId !== undefined ||
        data.expenseAccountId !== undefined || data.cashBoxId !== undefined ||
        data.paymentMethod !== undefined || data.date !== undefined
      )) {
        return { success: false, error: 'Cannot modify a posted voucher — reverse it with a reversal voucher instead.' };
      }
      const fields: string[] = [];
      const values: unknown[] = [];
      let idx = 1;
      // Phase 0 fix: missing `$` before the placeholder injected the row
      // number as a date literal (e.g. `date = 1::date`) — every payment
      // voucher date edit failed (or worse). Now parameterized like receipts.
      if (data.date !== undefined) { fields.push(`date = $${idx++}::date`); values.push(toDateString(data.date)); }
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
      // Phase 0 fix: same posted-voucher protection as receipts — a posted
      // payment already moved GL + supplier balance (+ invoice paid_amount).
      if (String(v.status) === 'posted') {
        return { success: false, error: 'Cannot delete a posted voucher — reverse it with a reversal voucher instead.' };
      }
      // Phase 5: reversed vouchers carry a mirror JE — terminal, like receipts.
      if (String(v.status) === 'reversed') {
        return { success: false, error: 'Cannot delete a reversed voucher — it is terminal.' };
      }
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

  // ─── Foreign-exchange revaluation (Phase 2 — IAS 21) ──────────────────────
  /**
   * Revalue open foreign-currency invoices at CURRENT currency-table rates.
   * Books ONE aggregate JE (Dr/Cr debtors/creditors vs 52902) for the
   * INCREMENTAL move since each invoice's last revaluation (or its own rate
   * when never revalued), then stamps last_reval_rate — repeated runs never
   * double-book. Base-currency invoices are untouched by construction.
   */
  async revalueForeignBalances(
    companyId: string,
    _userId: string,
    date?: string
  ): Promise<{
    success: boolean;
    data?: { reference: string; lines: number; gain: number; loss: number; currencies: string[] };
    error?: string;
  }> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      const adapter = await getDbAdapter();
      const revalDate = toDateString(date) || new Date().toISOString().split('T')[0];
      // Phase 5: FX revaluation writes ONE JE, so it is a posting path like
      // any other — a closed fiscal year or a filed tax period must reject it
      // BEFORE any read, exactly as postVoucher/postTransaction do.
      const { assertPeriodOpen: assertRevalTaxPeriod } = await import('@/modules/tax/engine');
      const revalTaxGate = await assertRevalTaxPeriod(companyId, revalDate, adapter);
      if (!revalTaxGate.open) {
        return { success: false, error: `الفترة الضريبية مغلقة (${revalTaxGate.period.startDate} – ${revalTaxGate.period.endDate}) — لا يمكن إعادة التقييم بتاريخ داخلها` };
      }
      const { assertAccountingPeriodOpen: assertRevalFiscal } = await import('@/modules/accounting/yearEnd');
      const revalFiscalGate = await assertRevalFiscal(companyId, revalDate, adapter);
      if (!revalFiscalGate.open) {
        return { success: false, error: `السنة المالية ${revalFiscalGate.period.year} مقفلة — لا يمكن إعادة التقييم بتاريخ داخلها` };
      }

      // Current rates + base currency resolution.
      const curRes = await adapter.query<{ code: string; exchange_rate: number; is_default: boolean }>(
        `SELECT code, COALESCE(exchange_rate, 0) AS exchange_rate, COALESCE(is_default, false) AS is_default
           FROM currencies WHERE company_id = $1 AND COALESCE(is_active, true) = true`,
        [companyId]
      );
      if (!curRes.success) return { success: false, error: curRes.error };
      const currencies = (curRes.rows || []) as { code: string; exchange_rate: number; is_default: boolean }[];
      const baseRow = currencies.find((c) => c.is_default) || currencies.find((c) => String(c.code).toUpperCase() === YER_CODE);
      const baseCode = baseRow ? String(baseRow.code) : YER_CODE;
      const rates = new Map<string, number>();
      for (const c of currencies) {
        const code = String(c.code);
        const rate = Number(c.exchange_rate) || 0;
        if (code && code !== baseCode && rate > 0) rates.set(code, rate);
      }
      if (rates.size === 0) {
        return { success: true, data: { reference: '', lines: 0, gain: 0, loss: 0, currencies: [] } };
      }

      // Open foreign invoices on both sides.
      interface OpenInv {
        id: string;
        invoice_number: string;
        currency_code: string;
        out: number;
        total: number;
        rate: number;
        base: number;
        last: number | null;
      }
      const sides: Array<{ table: string; numberColumn: string; party: 'customer' | 'supplier' }> = [
        { table: 'sales_invoices', numberColumn: 'invoice_number', party: 'customer' },
        { table: 'purchase_invoices', numberColumn: 'invoice_number', party: 'supplier' },
      ];
      const open: Array<OpenInv & { side: 'sales' | 'purchase' }> = [];
      for (const s of sides) {
        const r = await adapter.query(
          `SELECT id, ${s.numberColumn} AS invoice_number, currency_code,
                  total_amount,
                  (total_amount - COALESCE(paid_amount, 0)) AS out,
                  COALESCE(exchange_rate, 0) AS exchange_rate,
                  COALESCE(base_currency_amount, 0) AS base_currency_amount,
                  last_reval_rate
             FROM ${s.table}
            WHERE company_id = $1::uuid AND status IN ('posted', 'partially_paid')
              AND currency_code <> $2
              AND (total_amount - COALESCE(paid_amount, 0)) > 0`,
          [companyId, baseCode]
        );
        if (!r.success) return { success: false, error: r.error };
        for (const row of (r.rows || []) as Record<string, unknown>[]) {
          open.push({
            id: String(row.id),
            invoice_number: String(row.invoice_number || ''),
            currency_code: String(row.currency_code || ''),
            out: Number(row.out) || 0,
            total: Number(row.total_amount) || 0,
            rate: Number(row.exchange_rate) || 0,
            base: Number(row.base_currency_amount) || 0,
            last: row.last_reval_rate === null || row.last_reval_rate === undefined ? null : Number(row.last_reval_rate),
            side: s.table === 'sales_invoices' ? 'sales' : 'purchase',
          });
        }
      }

      // Incremental differences vs anchor (last reval, else invoice rate).
      const moves: Array<{ inv: (typeof open)[0]; diff: number; current: number }> = [];
      const touchedCurrencies = new Set<string>();
      for (const inv of open) {
        const current = rates.get(inv.currency_code);
        if (!current) continue; // no current rate published — skip honestly
        // Anchor: last revaluation rate when present, else the invoice's own
        // rate — stored FULL base ÷ FULL total (never base ÷ outstanding,
        // which drifts after partial payments), else the header rate column.
        const anchorRate = inv.last !== null && inv.last > 0
          ? inv.last
          : (inv.base > 0 && inv.total > 0 ? inv.base / inv.total : inv.rate);
        if (!(anchorRate > 0)) continue;
        const diff = Math.round(inv.out * (current - anchorRate) * 100) / 100;
        if (Math.abs(diff) < 0.01) continue;
        moves.push({ inv, diff, current });
        touchedCurrencies.add(inv.currency_code);
      }
      if (moves.length === 0) {
        return { success: true, data: { reference: '', lines: 0, gain: 0, loss: 0, currencies: [] } };
      }

      const fxAccs = await resolvePostingAccounts(companyId, ['default_debtors', 'default_creditors', 'default_exchange_difference']);
      if (!fxAccs.success) return { success: false, error: fxAccs.error };
      const { buildJournalEntryStatement } = await import('@/core/database/tx');
      const entries: Array<{ accountId: string; debit: number; credit: number; memo?: string }> = [];
      let gain = 0;
      let loss = 0;
      const statements: Array<{ sql: string; params?: unknown[] }> = [];
      for (const m of moves) {
        const abs = Math.abs(m.diff);
        if (m.inv.side === 'sales') {
          // Receivable worth more → gain (Dr debtors / Cr FX); worth less → loss.
          if (m.diff > 0) {
            entries.push({ accountId: fxAccs.ids.default_debtors, debit: abs, credit: 0, memo: `إعادة تقييم ${m.inv.invoice_number}` });
            entries.push({ accountId: fxAccs.ids.default_exchange_difference, debit: 0, credit: abs, memo: `مكاسب صرف ${m.inv.invoice_number}` });
            gain = Math.round((gain + abs) * 100) / 100;
          } else {
            entries.push({ accountId: fxAccs.ids.default_exchange_difference, debit: abs, credit: 0, memo: `خسائر صرف ${m.inv.invoice_number}` });
            entries.push({ accountId: fxAccs.ids.default_debtors, debit: 0, credit: abs, memo: `إعادة تقييم ${m.inv.invoice_number}` });
            loss = Math.round((loss + abs) * 100) / 100;
          }
        } else {
          // Owe more → loss (Dr FX / Cr creditors); owe less → gain.
          if (m.diff > 0) {
            entries.push({ accountId: fxAccs.ids.default_exchange_difference, debit: abs, credit: 0, memo: `خسائر صرف ${m.inv.invoice_number}` });
            entries.push({ accountId: fxAccs.ids.default_creditors, debit: 0, credit: abs, memo: `إعادة تقييم ${m.inv.invoice_number}` });
            loss = Math.round((loss + abs) * 100) / 100;
          } else {
            entries.push({ accountId: fxAccs.ids.default_creditors, debit: abs, credit: 0, memo: `إعادة تقييم ${m.inv.invoice_number}` });
            entries.push({ accountId: fxAccs.ids.default_exchange_difference, debit: 0, credit: abs, memo: `مكاسب صرف ${m.inv.invoice_number}` });
            gain = Math.round((gain + abs) * 100) / 100;
          }
        }
        // Stamp the new anchor so the next run measures only the next move.
        statements.push({
          sql: `UPDATE ${m.inv.side === 'sales' ? 'sales_invoices' : 'purchase_invoices'} SET last_reval_rate = $1::numeric, updated_at = NOW() WHERE id = $2::uuid AND company_id = $3::uuid`,
          params: [m.current, m.inv.id, companyId],
        });
      }
      const total = Math.round(entries.reduce((s, e) => s + e.debit, 0) * 100) / 100;
      const reference = `FX-${revalDate}`;
      statements.unshift(
        buildJournalEntryStatement(companyId, {
          reference,
          description: `قيد تلقائي - إعادة تقييم أرصدة العملات ${revalDate}`,
          date: revalDate,
          totalAmount: total,
          entries,
        }) as { sql: string; params?: unknown[] }
      );
      const result = await runTransaction(statements);
      if (!result.success) return { success: false, error: result.error };
      return {
        success: true,
        data: { reference, lines: moves.length, gain, loss, currencies: [...touchedCurrencies] },
      };
    } catch (e) {
      return { success: false, error: String(e) };
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
      
      // Service requires both dates (LOCAL defaults — UTC "today" is
      // yesterday for GMT+3 between 00:00–03:00, which made the default P&L
      // cover a single wrong day instead of a sensible range).
      const effectiveStartDate = startDate || localToday();
      const effectiveEndDate = endDate || localToday();
      
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

  /**
   * IAS 7 indirect cash flow, derived entirely from posted journal entries
   * (Phase 5 rewrite — the old page mixed P&L movements with balance-sheet
   * snapshots and name/code heuristics):
   * - Operating: net profit (P&L movement) + depreciation add-back (JE
   *   movement on depreciation expense accounts) ± working-capital changes
   *   (begin-vs-end signed balances on 112/211/113/213/215).
   * - Investing: capex (Dr movement on 12101) vs disposal proceeds (treasury
   *   Dr legs inside DSP-* transactions).
    * - Financing: delta equity (3%) excluding non-cash CLS/OPENING refs.
    * - Reconciliation: computed net change vs actual delta treasury (111%).
    */
  async getCashFlow(companyId: string, fromDate: string, toDate: string): Promise<{ success: boolean; data?: CashFlowStatement; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      const dayRe = /^\d{4}-\d{2}-\d{2}$/;
      if (!dayRe.test(fromDate) || !dayRe.test(toDate) || fromDate > toDate) {
        return { success: false, error: 'Invalid date range' };
      }
      const adapter = await getDbAdapter();
      const num = (v: unknown) => Number(v) || 0;
      // Signed BS balance of code-prefix groups as of a date (inclusive).
      const bsAsOf = async (prefixes: string[], asOf: string, excludeRefs: string[] = []): Promise<number> => {
        const like = prefixes.map((_p, i) => `a.code LIKE $${i + 4}`).join(' OR ');
        const excl = excludeRefs.map((_r, i) => `AND t.reference NOT LIKE $${prefixes.length + 4 + i}`).join(' ');
        const res = await adapter.query(
          `SELECT COALESCE(SUM(je.debit - je.credit), 0) AS bal
             FROM journal_entries je
             JOIN transactions t ON t.id = je.transaction_id
             JOIN accounts a ON a.id = je.account_id
            WHERE je.company_id = $1::uuid AND t.status = 'posted'
              AND t.date < ($2::date + INTERVAL '1 day')
              AND (${like}) ${excl}`,
          [companyId, asOf, ...prefixes.map((p) => `${p}%`), ...excludeRefs.map((r) => `${r}%`)]
        );
        if (!res.success) throw new Error(res.error);
        return num((res.rows?.[0] as Record<string, unknown> | undefined)?.bal);
      };
      // Dr/Cr movement inside [from, to] for code-prefix groups.
      const movement = async (prefixes: string[], extraWhere = '', extraParams: unknown[] = []): Promise<{ dr: number; cr: number }> => {
        const like = prefixes.map((_p, i) => `a.code LIKE $${i + 4}`).join(' OR ');
        const res = await adapter.query(
          `SELECT COALESCE(SUM(je.debit), 0) AS dr, COALESCE(SUM(je.credit), 0) AS cr
             FROM journal_entries je
             JOIN transactions t ON t.id = je.transaction_id
             JOIN accounts a ON a.id = je.account_id
            WHERE je.company_id = $1::uuid AND t.status = 'posted'
              AND t.date >= $2::date AND t.date < ($3::date + INTERVAL '1 day')
              AND (${like}) ${extraWhere}`,
          [companyId, fromDate, toDate, ...prefixes.map((p) => `${p}%`), ...extraParams]
        );
        if (!res.success) throw new Error(res.error);
        const row = (res.rows?.[0] as Record<string, unknown> | undefined) || {};
        return { dr: num(row.dr), cr: num(row.cr) };
      };
      const line = (key: string, amount: number) => ({ key, amount: Math.round(amount * 100) / 100 });
      // Day before a date (local-time math — opening balances are cumulative
      // "everything before from", so begin = bsAsOf(day before from)).
      const prevDay = (day: string): string => {
        const d = new Date(`${day}T00:00:00`);
        d.setDate(d.getDate() - 1);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      };

      // ── Operating ──
      const rev = await movement(['4']);
      const exp = await movement(['5']);
      const netProfit = (rev.cr - rev.dr) - (exp.dr - exp.cr);
      // Depreciation add-back: configured account + legacy 526/527 codes.
      const depIds: string[] = [];
      const depKey = await adapter.query(
        `SELECT account_id FROM default_accounts WHERE company_id = $1::uuid AND function_key = 'default_depreciation_expense'`,
        [companyId]
      );
      if (!depKey.success) throw new Error(depKey.error);
      const depId = (depKey.rows?.[0] as Record<string, unknown> | undefined)?.account_id;
      if (depId) depIds.push(String(depId));
      const depMove = await movement(['526', '527']);
      let depAddBack = depMove.dr - depMove.cr;
      if (depId) {
        const one = await adapter.query(
          `SELECT COALESCE(SUM(je.debit - je.credit), 0) AS bal
             FROM journal_entries je JOIN transactions t ON t.id = je.transaction_id
            WHERE je.company_id = $1::uuid AND t.status = 'posted'
              AND t.date >= $2::date AND t.date < ($3::date + INTERVAL '1 day')
              AND je.account_id = $4::uuid`,
          [companyId, fromDate, toDate, depId]
        );
        if (!one.success) throw new Error(one.error);
        const only = num((one.rows?.[0] as Record<string, unknown> | undefined)?.bal);
        // The configured account may live outside 526/527 — take the union
        // without double-counting it.
        const overlap = await adapter.query(
          `SELECT COALESCE(SUM(je.debit - je.credit), 0) AS bal
             FROM journal_entries je JOIN transactions t ON t.id = je.transaction_id
             JOIN accounts a ON a.id = je.account_id
            WHERE je.company_id = $1::uuid AND t.status = 'posted'
              AND t.date >= $2::date AND t.date < ($3::date + INTERVAL '1 day')
              AND je.account_id = $4::uuid AND (a.code LIKE '526%' OR a.code LIKE '527%')`,
          [companyId, fromDate, toDate, depId]
        );
        if (!overlap.success) throw new Error(overlap.error);
        depAddBack = depAddBack + only - num((overlap.rows?.[0] as Record<string, unknown> | undefined)?.bal);
      }
      const arEnd = await bsAsOf(['112'], toDate);
      const arBegin = await bsAsOf(['112'], prevDay(fromDate));
      const apEnd = await bsAsOf(['211'], toDate);
      const apBegin = await bsAsOf(['211'], prevDay(fromDate));
      const invEnd = await bsAsOf(['113'], toDate);
      const invBegin = await bsAsOf(['113'], prevDay(fromDate));
      const vatEnd = await bsAsOf(['213'], toDate);
      const vatBegin = await bsAsOf(['213'], prevDay(fromDate));
      const payEnd = await bsAsOf(['215'], toDate);
      const payBegin = await bsAsOf(['215'], prevDay(fromDate));
      const operating = [
        line('netProfit', netProfit),
        line('depreciation', depAddBack),
        line('receivablesChange', -(arEnd - arBegin)),
        line('payablesChange', apEnd - apBegin),
        line('inventoryChange', -(invEnd - invBegin)),
        line('vatChange', vatEnd - vatBegin),
        line('payrollChange', payEnd - payBegin),
      ].filter((l) => Math.abs(l.amount) >= 0.005);
      const operatingTotal = Math.round(operating.reduce((s, l) => s + l.amount, 0) * 100) / 100;

      // ── Investing ──
      const capexMove = await movement(['12101']);
      const capex = capexMove.dr - capexMove.cr;
      const procRes = await adapter.query(
        `SELECT COALESCE(SUM(je.debit), 0) AS inflow
           FROM journal_entries je
           JOIN transactions t ON t.id = je.transaction_id
           JOIN accounts a ON a.id = je.account_id
          WHERE je.company_id = $1::uuid AND t.status = 'posted'
            AND t.date >= $2::date AND t.date < ($3::date + INTERVAL '1 day')
            AND t.reference LIKE 'DSP-%' AND a.code LIKE '111%'`,
        [companyId, fromDate, toDate]
      );
      if (!procRes.success) throw new Error(procRes.error);
      const proceeds = num((procRes.rows?.[0] as Record<string, unknown> | undefined)?.inflow);
      const investing = [
        line('capex', -capex),
        line('proceeds', proceeds),
      ].filter((l) => Math.abs(l.amount) >= 0.005);
      const investingTotal = Math.round(investing.reduce((s, l) => s + l.amount, 0) * 100) / 100;

      // ── Financing: Δ equity excluding non-cash allocations ──
      const eqEnd = await bsAsOf(['3'], toDate, ['CLS-', 'OPENING-']);
      const eqBegin = await bsAsOf(['3'], prevDay(fromDate), ['CLS-', 'OPENING-']);
      const financing = [line('equityChange', eqEnd - eqBegin)].filter((l) => Math.abs(l.amount) >= 0.005);
      const financingTotal = Math.round(financing.reduce((s, l) => s + l.amount, 0) * 100) / 100;

      const netChange = Math.round((operatingTotal + investingTotal + financingTotal) * 100) / 100;
      const cashEnd = await bsAsOf(['111'], toDate);
      const cashBegin = await bsAsOf(['111'], prevDay(fromDate));
      const cashChange = Math.round((cashEnd - cashBegin) * 100) / 100;
      return {
        success: true,
        data: {
          from: fromDate,
          to: toDate,
          operating,
          operatingTotal,
          investing,
          investingTotal,
          financing,
          financingTotal,
          netChange,
          cashBegin: Math.round(cashBegin * 100) / 100,
          cashEnd: Math.round(cashEnd * 100) / 100,
          cashChange,
          unexplained: Math.round((netChange - cashChange) * 100) / 100,
        },
      };
    } catch (e) {
      return { success: false, error: String(e instanceof Error ? e.message : e) };
    }
  },

  async getAccountLedger(accountId: string, companyId: string, startDate?: string, endDate?: string): Promise<{ success: boolean; data?: LedgerRow[]; error?: string }> {
    try {
      const cidValidation = validateInput(idCompanySchema, { companyId, id: accountId });
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      const adapter = await getDbAdapter();

      // Movement rows (posted JEs within the optional window).
      const params: unknown[] = [accountId, companyId];
      let movementWhere = 'je.account_id = $1 AND t.company_id = $2 AND t.status = \'posted\'';
      if (startDate) { params.push(startDate); movementWhere += ` AND t.date >= $${params.length}`; }
      if (endDate) { params.push(endDate); movementWhere += ` AND t.date <= $${params.length}`; }

      // Opening row: ONLY when a start date filters the window — it carries
      // the balance of everything posted BEFORE that date (real opening JEs
      // included), so the last row's balance still equals the FULL balance.
      // Without a start date the movement already shows every JE from zero,
      // and a separate opening row would display the opening twice.
      if (!startDate) {
        const result = await adapter.query(`
          SELECT t.id::text AS id, t.date, t.reference, t.description, je.debit, je.credit
          FROM journal_entries je
          JOIN transactions t ON je.transaction_id = t.id
          WHERE ${movementWhere}
          ORDER BY t.date, t.created_at`, params);
        if (!result.success) return { success: false, error: result.error };
        let runningBalance = 0;
        const rows: LedgerRow[] = (result.rows || []).map((row) => {
          const debit = Number(row.debit) || 0;
          const credit = Number(row.credit) || 0;
          runningBalance += debit - credit;
          return {
            id: String(row.id),
            date: row.date ? String(toDateString(row.date) ?? row.date) : '',
            reference: row.reference || undefined,
            description: row.description || undefined,
            debit,
            credit,
            balance: runningBalance,
          } as LedgerRow;
        });
        return { success: true, data: rows };
      }

      // prior: everything posted strictly BEFORE startDate.
      const priorParams: unknown[] = [accountId, companyId, startDate];
      const priorWhere = "je.account_id = $1 AND t.company_id = $2 AND t.status = 'posted' AND t.date < $3";

      const sql = `
      WITH movement AS (
        SELECT t.id, t.date, t.reference, t.description, je.debit, je.credit
        FROM journal_entries je
        JOIN transactions t ON je.transaction_id = t.id
        WHERE ${movementWhere}
      ),
      prior AS (
        SELECT COALESCE(SUM(je.debit - je.credit), 0) AS opening
        FROM journal_entries je
        JOIN transactions t ON je.transaction_id = t.id
        WHERE ${priorWhere.replace(/\$(\d+)/g, (_m, n) => `$${Number(n) + priorParams.length}`)}
      )
      SELECT id::text AS id, date, reference, description, debit, credit, opening, sort_type
      FROM (
        SELECT $${priorParams.length + 1} AS id, NULL::date AS date, NULL AS reference,
               'رصيد افتتاحي' AS description, 0 AS debit, 0 AS credit, 0 AS sort_type,
               (SELECT opening FROM prior) AS opening
        UNION ALL
        SELECT m.id::text, m.date, m.reference, m.description, m.debit, m.credit, 1 AS sort_type,
               NULL::numeric AS opening
        FROM movement m
      ) rows
      ORDER BY sort_type, date, id`;
      // Final param order: movement params ($1..) then the prior CTE's own
      // shifted copies ($5.. = accountId, companyId, startDate) then the
      // OPENING label — the prior WHERE references its own renumbered $N.
      const finalParams: unknown[] = [...params, ...priorParams, 'OPENING'];

      const result = await adapter.query(sql, finalParams);
      if (result.success && result.rows) {
        interface LedgerQueryRow {
          id: string;
          date: string | null;
          reference: string | null;
          description: string | null;
          debit: number;
          credit: number;
          opening: number | null;
          sort_type: number;
        }
        let runningBalance = 0;
        const rows: LedgerRow[] = (result.rows as LedgerQueryRow[]).map((row) => {
          if (row.sort_type === 0) {
            // Opening row: balance before the period (opening + prior JEs)
            runningBalance = Number(row.opening) || 0;
            return {
              id: 'OPENING',
              date: startDate,
              reference: 'OPENING',
              description: 'رصيد افتتاحي',
              debit: 0,
              credit: 0,
              balance: runningBalance,
            } as LedgerRow;
          }
          const debit = Number(row.debit) || 0;
          const credit = Number(row.credit) || 0;
          runningBalance += debit - credit;
          return {
            id: String(row.id),
            date: row.date ? String(toDateString(row.date) ?? row.date) : '',
            reference: row.reference || undefined,
            description: row.description || undefined,
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
      // Phase 0 fix: a payment REDUCES what we owe the supplier, exactly as
      // it reduces what the customer owes us. The old `+amountApplied` for
      // payments inverted AP (every live path decrements supplier balance).
      const balanceDelta = -amountApplied;
      // Phase 0 fix: cap the application at the invoice outstanding. Without
      // this a voucher could push paid_amount above total_amount and flip a
      // partially-paid invoice to "paid" while money is still due.
      const adapter = await getDbAdapter();
      const invCheck = await adapter.query(
        `SELECT total_amount, COALESCE(paid_amount, 0) AS paid_amount, status,
                COALESCE(exchange_rate, 0) AS exchange_rate,
                COALESCE(base_currency_amount, 0) AS base_currency_amount
           FROM ${table} WHERE id = $1::uuid AND company_id = $2::uuid`,
        [invoiceId, companyId]
      );
      if (!invCheck.success) return { success: false, error: invCheck.error };
      const invRow = invCheck.rows?.[0] as Record<string, unknown> | undefined;
      if (!invRow) return { success: false, error: 'Invoice not found' };
      if (String(invRow.status) === 'cancelled') {
        return { success: false, error: 'Cannot apply a payment to a cancelled invoice' };
      }
      const outstanding = (Number(invRow.total_amount) || 0) - (Number(invRow.paid_amount) || 0);
      if (amountApplied > outstanding) {
        return { success: false, error: `Applied amount (${amountApplied}) exceeds the invoice outstanding (${outstanding})` };
      }
      // Phase 2: accrue base at the INVOICE rate (the payment-rate base is
      // the caller's responsibility via a realized-FX voucher, as in the
      // create/post paths above).
      const invTotal = Number(invRow.total_amount) || 0;
      const invStoredBase = Number(invRow.base_currency_amount) || 0;
      const invRate = invTotal > 0 && invStoredBase > 0 ? invStoredBase / invTotal : (Number(invRow.exchange_rate) || 0);
      if (invRate > 0) {
        baseCurrencyApplied = Math.round(amountApplied * invRate * 100) / 100;
      }

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
