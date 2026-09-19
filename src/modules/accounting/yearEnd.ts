import { getDbAdapter } from '@/core/database/adapters';
import type { DbAdapter } from '@/core/database/adapters/types';
import { validateInput, companyIdSchema } from '@/core/utils/validation';

type Queryable = Pick<DbAdapter, 'query'>;
import { getDefaultAccountId } from '@/core/utils/journalEntryGenerator';
import { buildJournalEntryStatement, runTransaction } from '@/core/database/tx';
import { toDateString } from '@/core/utils/mapPgRow';
import { safeUserId } from '@/core/utils/userIdValidator';
import { logAudit } from '@/core/utils/auditLogger';

export interface FiscalYearBounds {
  year: number;
  startDate: string;
  endDate: string;
}

export interface AccountingPeriod {
  id: string;
  companyId: string;
  year: number;
  startDate: string;
  endDate: string;
  status: 'open' | 'closed';
  closedAt: string | null;
}

type GateResult = { open: true } | { open: false; period: AccountingPeriod };

function mapPeriodRow(r: Record<string, unknown>): AccountingPeriod {
  return {
    id: String(r.id),
    companyId: String(r.company_id),
    year: Number(r.year),
    startDate: toDateString(r.start_date) || '',
    endDate: toDateString(r.end_date) || '',
    status: String(r.status) === 'closed' ? 'closed' : 'open',
    closedAt: r.closed_at ? String(r.closed_at) : null,
  };
}

/**
 * Fiscal-year bounds for a calendar year, honoring the company's
 * fiscal_year_start month/day (defaults to Jan 1 – Dec 31).
 */
export async function getFiscalYearBounds(
  companyId: string,
  year: number,
  adapter?: Queryable
): Promise<FiscalYearBounds> {
  const db = adapter || (await getDbAdapter());
  let md = '01-01';
  try {
    const res = await db.query(
      `SELECT fiscal_year_start FROM companies WHERE id = $1::uuid`,
      [companyId]
    );
    const raw = res.success ? toDateString((res.rows?.[0] as Record<string, unknown> | undefined)?.fiscal_year_start) : null;
    if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) md = raw.slice(5);
  } catch {
    // fall through to calendar year
  }
  const startDate = `${year}-${md}`;
  const [m, d] = md.split('-').map(Number);
  // End = day before next year's start (handles leap years via Date math).
  const end = new Date(year + 1, m - 1, d);
  end.setDate(end.getDate() - 1);
  const endDate = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
  return { year, startDate, endDate };
}

/**
 * Fiscal-lock guard: rejects postings dated inside a CLOSED accounting
 * period. Open-ended when no covering row exists (legacy data posts
 * freely) — mirrors the tax-period guard contract.
 */
export async function assertAccountingPeriodOpen(
  companyId: string,
  date: string,
  adapter?: Queryable
): Promise<GateResult> {
  try {
    const db = adapter || (await getDbAdapter());
    const day = String(date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { open: true };
    const res = await db.query(
      `SELECT id, company_id, year, start_date, end_date, status, closed_at
         FROM accounting_periods
        WHERE company_id = $1::uuid AND start_date <= $2::date AND end_date >= $2::date
        ORDER BY end_date DESC LIMIT 1`,
      [companyId, day]
    );
    if (!res.success) return { open: true };
    const row = (res.rows || [])[0] as Record<string, unknown> | undefined;
    if (!row || String(row.status) !== 'closed') return { open: true };
    return { open: false, period: mapPeriodRow(row) };
  } catch {
    return { open: true };
  }
}

export async function getAccountingPeriods(
  companyId: string
): Promise<{ success: boolean; data?: AccountingPeriod[]; error?: string }> {
  try {
    const v = validateInput(companyIdSchema, companyId);
    if (!v.success) return { success: false, error: v.error };
    const adapter = await getDbAdapter();
    const res = await adapter.query(
      `SELECT id, company_id, year, start_date, end_date, status, closed_at
         FROM accounting_periods WHERE company_id = $1::uuid ORDER BY year DESC`,
      [companyId]
    );
    if (!res.success) return { success: false, error: res.error };
    return { success: true, data: (res.rows || []).map((r) => mapPeriodRow(r as Record<string, unknown>)) };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/** Create (or fetch) the OPEN period row for a year. */
export async function openAccountingPeriod(
  companyId: string,
  year: number
): Promise<{ success: boolean; data?: AccountingPeriod; error?: string }> {
  try {
    const v = validateInput(companyIdSchema, companyId);
    if (!v.success) return { success: false, error: v.error };
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      return { success: false, error: 'Invalid fiscal year' };
    }
    const adapter = await getDbAdapter();
    const { startDate, endDate } = await getFiscalYearBounds(companyId, year, adapter);
    const res = await adapter.query(
      `INSERT INTO accounting_periods (company_id, year, start_date, end_date, status)
       VALUES ($1::uuid, $2, $3::date, $4::date, 'open')
       ON CONFLICT (company_id, year) DO UPDATE SET updated_at = NOW()
       RETURNING id, company_id, year, start_date, end_date, status, closed_at`,
      [companyId, year, startDate, endDate]
    );
    if (!res.success || !res.rows?.[0]) return { success: false, error: res.error || 'Could not open period' };
    return { success: true, data: mapPeriodRow(res.rows[0] as Record<string, unknown>) };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

export interface ClosePreviewLine {
  accountId: string;
  code: string;
  name: string;
  debit: number;
  credit: number;
}

export interface ClosePreview {
  year: number;
  startDate: string;
  endDate: string;
  revenue: number;
  expense: number;
  net: number;
  lines: ClosePreviewLine[];
  retainedAccountId: string | null;
}

/** P&L movement per revenue/expense account inside the fiscal year. */
export async function previewFiscalClose(
  companyId: string,
  year: number
): Promise<{ success: boolean; data?: ClosePreview; error?: string }> {
  try {
    const v = validateInput(companyIdSchema, companyId);
    if (!v.success) return { success: false, error: v.error };
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      return { success: false, error: 'Invalid fiscal year' };
    }
    const adapter = await getDbAdapter();
    const { startDate, endDate } = await getFiscalYearBounds(companyId, year, adapter);
    const res = await adapter.query(
      `SELECT a.id AS account_id, a.code, a.name_ar AS name, a.type,
              COALESCE(SUM(je.credit - je.debit), 0) AS rev_net,
              COALESCE(SUM(je.debit - je.credit), 0) AS exp_net
         FROM accounts a
         JOIN journal_entries je ON je.account_id = a.id AND je.company_id = $1::uuid
         JOIN transactions t ON t.id = je.transaction_id AND t.status = 'posted'
                              AND t.date >= $2::date AND t.date < ($3::date + INTERVAL '1 day')
        WHERE a.company_id = $1::uuid AND a.type IN ('revenue', 'expense')
        GROUP BY a.id, a.code, a.name_ar, a.type
       HAVING ABS(COALESCE(SUM(je.credit - je.debit), 0)) >= 0.005
           OR ABS(COALESCE(SUM(je.debit - je.credit), 0)) >= 0.005
        ORDER BY a.code`,
      [companyId, startDate, endDate]
    );
    if (!res.success) return { success: false, error: res.error };
    const lines: ClosePreviewLine[] = [];
    let revenue = 0;
    let expense = 0;
    for (const r of res.rows || []) {
      const row = r as Record<string, unknown>;
      const isRevenue = String(row.type) === 'revenue';
      // Revenue closes Dr revenue / Cr retained; expense closes Dr retained / Cr expense.
      const amount = isRevenue ? Number(row.rev_net) || 0 : Number(row.exp_net) || 0;
      if (Math.abs(amount) < 0.005) continue;
      if (isRevenue) revenue += amount;
      else expense += amount;
      lines.push({
        accountId: String(row.account_id),
        code: String(row.code),
        name: String(row.name || ''),
        debit: isRevenue ? Math.round(amount * 100) / 100 : 0,
        credit: isRevenue ? 0 : Math.round(amount * 100) / 100,
      });
    }
    revenue = Math.round(revenue * 100) / 100;
    expense = Math.round(expense * 100) / 100;
    const retainedAccountId = await getDefaultAccountId(companyId, 'default_retained_earnings');
    return {
      success: true,
      data: { year, startDate, endDate, revenue, expense, net: Math.round((revenue - expense) * 100) / 100, lines, retainedAccountId },
    };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/**
 * Close a fiscal year: post the CLS-YYYY closing JE (revenue/expense →
 * retained earnings) and flip the period to closed — atomically.
 * Idempotent-ish: an existing CLS reference heals an open period; a
 * closed period refuses a second close.
 */
export async function closeFiscalYear(
  companyId: string,
  year: number,
  userId: string
): Promise<{ success: boolean; data?: { reference: string; net: number }; error?: string }> {
  try {
    const v = validateInput(companyIdSchema, companyId);
    if (!v.success) return { success: false, error: v.error };
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      return { success: false, error: 'Invalid fiscal year' };
    }
    const adapter = await getDbAdapter();
    const { startDate, endDate } = await getFiscalYearBounds(companyId, year, adapter);
    const today = toDateString(new Date()) || '';
    if (endDate > today) {
      return { success: false, error: 'Cannot close a fiscal year that has not ended yet' };
    }
    // Out-of-order guard: no later closed year may exist.
    const later = await adapter.query(
      `SELECT year FROM accounting_periods
        WHERE company_id = $1::uuid AND year > $2 AND status = 'closed' LIMIT 1`,
      [companyId, year]
    );
    if (!later.success) return { success: false, error: later.error };
    if (later.rows?.length) {
      return { success: false, error: `Cannot close ${year} — fiscal year ${String((later.rows[0] as Record<string, unknown>).year)} is already closed` };
    }
    const reference = `CLS-${year}`;
    const existing = await adapter.query(
      `SELECT id FROM transactions WHERE company_id = $1::uuid AND reference = $2 LIMIT 1`,
      [companyId, reference]
    );
    if (!existing.success) return { success: false, error: existing.error };
    const preview = await previewFiscalClose(companyId, year);
    if (!preview.success || !preview.data) return { success: false, error: preview.error };
    const { revenue, expense, net, lines, retainedAccountId } = preview.data;
    if (!retainedAccountId) {
      return { success: false, error: 'Retained-earnings account is not configured (default_retained_earnings)' };
    }
    const statements: Array<{ sql: string; params?: unknown[] }> = [];
    if (existing.rows?.length) {
      // Heal: the closing JE exists but the period never flipped.
      statements.push({
        sql: `UPDATE accounting_periods SET status = 'closed', closed_at = NOW(), updated_at = NOW()
              WHERE company_id = $1::uuid AND year = $2 AND status = 'open'`,
        params: [companyId, year],
      });
    } else if (lines.length > 0) {
      const entries = [
        ...lines.map((l) => ({
          accountId: l.accountId,
          debit: l.debit,
          credit: l.credit,
          memo: `إقفال ${year} - ${l.code}`,
        })),
        // Retained leg = the plug that balances the entry (Cr on profit).
        // Skipped when net is exactly zero (revenue == expense balances alone).
        ...(net !== 0
          ? [{
              accountId: retainedAccountId,
              debit: net < 0 ? Math.abs(net) : 0,
              credit: net > 0 ? net : 0,
              memo: `صافي نتيجة ${year}`,
            }]
          : []),
      ];
      // Debits total == credits total == max(revenue, expense) by construction.
      const total = Math.max(revenue, expense);
      statements.push(
        buildJournalEntryStatement(companyId, {
          reference,
          description: `قيد إقفال السنة المالية ${year}`,
          date: endDate,
          totalAmount: total,
          entries,
        })
      );
      statements.push({
        sql: `INSERT INTO accounting_periods (company_id, year, start_date, end_date, status, closed_at)
              VALUES ($1::uuid, $2, $3::date, $4::date, 'closed', NOW())
              ON CONFLICT (company_id, year) DO UPDATE SET status = 'closed', closed_at = NOW(), updated_at = NOW()`,
        params: [companyId, year, startDate, endDate],
      });
    } else {
      // Zero-activity year: flip without a JE.
      statements.push({
        sql: `INSERT INTO accounting_periods (company_id, year, start_date, end_date, status, closed_at)
              VALUES ($1::uuid, $2, $3::date, $4::date, 'closed', NOW())
              ON CONFLICT (company_id, year) DO UPDATE SET status = 'closed', closed_at = NOW(), updated_at = NOW()`,
        params: [companyId, year, startDate, endDate],
      });
    }
    // Already closed with its JE → refuse a second close.
    const period = await adapter.query(
      `SELECT status FROM accounting_periods WHERE company_id = $1::uuid AND year = $2`,
      [companyId, year]
    );
    if (period.success && period.rows?.[0] && String((period.rows[0] as Record<string, unknown>).status) === 'closed' && existing.rows?.length) {
      return { success: false, error: `Fiscal year ${year} is already closed` };
    }
    const result = await runTransaction(statements);
    if (!result.success) return { success: false, error: result.error };
    await logAudit({
      companyId,
      userId: safeUserId(userId) || 'system',
      action: 'post',
      tableName: 'accounting_periods',
      recordId: `${year}`,
      newValues: { year, reference, net },
    });
    return { success: true, data: { reference, net } };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}
