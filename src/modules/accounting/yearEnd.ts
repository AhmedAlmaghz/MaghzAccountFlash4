import { getDbAdapter } from '@/core/database/adapters';
import type { DbAdapter } from '@/core/database/adapters/types';
import { validateInput, companyIdSchema, idCompanySchema } from '@/core/utils/validation';

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

export type AccountingPeriodType = 'annual' | 'half' | 'quarterly' | 'monthly' | 'custom';
export type AccountingPeriodStatus = 'open' | 'soft_closed' | 'closed';

export interface AccountingPeriod {
  id: string;
  companyId: string;
  year: number;
  periodType: AccountingPeriodType;
  startDate: string;
  endDate: string;
  status: AccountingPeriodStatus;
  closedAt: string | null;
}

type GateResult = { open: true } | { open: false; period: AccountingPeriod; error?: string };

function blockedPeriod(companyId: string, day: string, error: string): GateResult {
  return {
    open: false,
    period: {
      id: '',
      companyId,
      year: 0,
      periodType: 'custom',
      startDate: day,
      endDate: day,
      status: 'closed',
      closedAt: null,
    },
    error,
  };
}

function mapPeriodRow(r: Record<string, unknown>): AccountingPeriod {
  const pt = String(r.period_type || 'annual');
  const periodType: AccountingPeriodType =
    pt === 'half' || pt === 'quarterly' || pt === 'monthly' || pt === 'custom' ? pt : 'annual';
  const st = String(r.status);
  return {
    id: String(r.id),
    companyId: String(r.company_id),
    year: Number(r.year),
    periodType,
    startDate: toDateString(r.start_date) || '',
    endDate: toDateString(r.end_date) || '',
    status: st === 'closed' ? 'closed' : st === 'soft_closed' ? 'soft_closed' : 'open',
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
 *
 * Soft-closed periods reject too, unless the caller explicitly opts into
 * adjustment postings ({ allowSoft: true }) — the only callers that may do
 * so are manual journal adjustments, never operational documents.
 */
export async function assertAccountingPeriodOpen(
  companyId: string,
  date: string,
  adapter?: Queryable,
  opts?: { allowSoft?: boolean }
): Promise<GateResult> {
  try {
    const db = adapter || (await getDbAdapter());
    const day = String(date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return blockedPeriod(companyId, day, 'Posting date is required');
    const res = await db.query(
      `SELECT id, company_id, year, period_type, start_date, end_date, status, closed_at
         FROM accounting_periods
        WHERE company_id = $1::uuid AND start_date <= $2::date AND end_date >= $2::date
        ORDER BY (end_date - start_date) ASC, end_date DESC LIMIT 1`,
      [companyId, day]
    );
    if (!res.success) return blockedPeriod(companyId, day, 'Accounting period lookup failed');
    const row = (res.rows || [])[0] as Record<string, unknown> | undefined;
    if (!row || String(row.status) === 'open') return { open: true };
    if (String(row.status) === 'soft_closed' && opts?.allowSoft) return { open: true };
    const p = mapPeriodRow(row);
    const label = p.status === 'soft_closed' ? 'مغلقة مؤقتاً (مراجعة)' : 'مقفلة';
    return {
      open: false,
      period: p,
      error: `الفترة ${label} — لا يمكن الترحيل بتاريخ داخلها`,
    };
  } catch (error) {
    return blockedPeriod(companyId, String(date || '').slice(0, 10), error instanceof Error ? error.message : 'Accounting period lookup failed');
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
      `SELECT id, company_id, year, period_type, start_date, end_date, status, closed_at
         FROM accounting_periods WHERE company_id = $1::uuid ORDER BY end_date DESC, year DESC`,
      [companyId]
    );
    if (!res.success) return { success: false, error: res.error };
    return { success: true, data: (res.rows || []).map((r) => mapPeriodRow(r as Record<string, unknown>)) };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/** Create (or fetch) the OPEN annual period row for a year. */
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
      `INSERT INTO accounting_periods (company_id, year, period_type, start_date, end_date, status)
       VALUES ($1::uuid, $2, 'annual', $3::date, $4::date, 'open')
       ON CONFLICT (company_id, start_date, end_date) DO UPDATE SET updated_at = NOW()
       RETURNING id, company_id, year, period_type, start_date, end_date, status, closed_at`,
      [companyId, year, startDate, endDate]
    );
    if (!res.success || !res.rows?.[0]) return { success: false, error: res.error || 'Could not open period' };
    return { success: true, data: mapPeriodRow(res.rows[0] as Record<string, unknown>) };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

export type SubPeriodGranularity = 'monthly' | 'quarterly' | 'half';

/**
 * Generate the OPEN sub-period rows of a fiscal year (IFRS practice: the year
 * is worked in months/quarters, each closable on its own). Idempotent —
 * existing rows survive via the range unique. Ranges honor the company's
 * fiscal_year_start, so off-calendar years split correctly.
 */
export async function generateSubPeriods(
  companyId: string,
  year: number,
  granularity: SubPeriodGranularity
): Promise<{ success: boolean; data?: AccountingPeriod[]; error?: string }> {
  try {
    const v = validateInput(companyIdSchema, companyId);
    if (!v.success) return { success: false, error: v.error };
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      return { success: false, error: 'Invalid fiscal year' };
    }
    const adapter = await getDbAdapter();
    const { startDate, endDate } = await getFiscalYearBounds(companyId, year, adapter);
    const step = granularity === 'monthly' ? 1 : granularity === 'quarterly' ? 3 : 6;
    const periodType: AccountingPeriodType = granularity === 'monthly' ? 'monthly' : granularity === 'quarterly' ? 'quarterly' : 'half';
    const [sy, sm, sd] = startDate.split('-').map(Number);
    const [ey, em, ed] = endDate.split('-').map(Number);
    const ranges: Array<{ start: string; end: string }> = [];
    // Month-boundary spans from the FY start, contiguous and gapless, capped
    // at the FY end. `new Date(y, m, 0)` (day zero) can never overflow, so
    // short months need no special-casing.
    let cursor = new Date(sy, sm - 1, sd);
    const fyEnd = new Date(ey, em - 1, ed);
    const pad = (n: number) => String(n).padStart(2, '0');
    const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    let guard = 0;
    while (cursor <= fyEnd && guard++ < 36) {
      const spanEnd = new Date(cursor.getFullYear(), cursor.getMonth() + step, 0);
      const end = spanEnd > fyEnd ? fyEnd : spanEnd;
      ranges.push({ start: fmt(cursor), end: fmt(end) });
      cursor = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1);
    }
    const out: AccountingPeriod[] = [];
    for (const r of ranges) {
      const res = await adapter.query(
        `INSERT INTO accounting_periods (company_id, year, period_type, start_date, end_date, status)
         VALUES ($1::uuid, $2, $3, $4::date, $5::date, 'open')
         ON CONFLICT (company_id, start_date, end_date) DO UPDATE SET updated_at = NOW()
         RETURNING id, company_id, year, period_type, start_date, end_date, status, closed_at`,
        [companyId, year, periodType, r.start, r.end]
      );
      if (!res.success) return { success: false, error: res.error };
      if (res.rows?.[0]) out.push(mapPeriodRow(res.rows[0] as Record<string, unknown>));
    }
    return { success: true, data: out };
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
                              AND t.reference NOT LIKE 'CLS-%'
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
    // Sequential guard: no earlier OPEN year may remain — closes run oldest-first.
    const earlier = await adapter.query(
      `SELECT year FROM accounting_periods
        WHERE company_id = $1::uuid AND year < $2 AND status <> 'closed' ORDER BY year ASC LIMIT 1`,
      [companyId, year]
    );
    if (!earlier.success) return { success: false, error: earlier.error };
    if (earlier.rows?.length) {
      return { success: false, error: `Cannot close ${year} — fiscal year ${String((earlier.rows[0] as Record<string, unknown>).year)} is still open. Close years oldest-first` };
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
    // Serialize concurrent closers of the same year: ensure the row exists,
    // then lock it — a second closer blocks here until the first commits,
    // then sees the flipped status via the already-closed check above on
    // retry. (The pre-transaction check alone races.)
    statements.push({
      sql: `INSERT INTO accounting_periods (company_id, year, start_date, end_date, status)
            VALUES ($1::uuid, $2, $3::date, $4::date, 'open')
            ON CONFLICT (company_id, year) DO NOTHING`,
      params: [companyId, year, startDate, endDate],
    });
    statements.push({
      sql: `SELECT id FROM accounting_periods WHERE company_id = $1::uuid AND year = $2 FOR UPDATE`,
      params: [companyId, year],
    });
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
        sql: `INSERT INTO accounting_periods (company_id, year, period_type, start_date, end_date, status, closed_at)
              VALUES ($1::uuid, $2, 'annual', $3::date, $4::date, 'closed', NOW())
              ON CONFLICT (company_id, start_date, end_date) DO UPDATE SET status = 'closed', closed_at = NOW(), updated_at = NOW()`,
        params: [companyId, year, startDate, endDate],
      });
    } else {
      // Zero-activity year: flip without a JE.
      statements.push({
        sql: `INSERT INTO accounting_periods (company_id, year, period_type, start_date, end_date, status, closed_at)
              VALUES ($1::uuid, $2, 'annual', $3::date, $4::date, 'closed', NOW())
              ON CONFLICT (company_id, start_date, end_date) DO UPDATE SET status = 'closed', closed_at = NOW(), updated_at = NOW()`,
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

/**
 * Reopen a closed fiscal year (audited, terminal reversal of closeFiscalYear).
 * The CLS-YYYY journal entry is NOT deleted — it stays in the ledger as the
 * audit trail; postings dated inside the year become allowed again. Reopening
 * a year while a LATER year is closed is refused (would silently unbalance
 * retained-earnings sequencing).
 */
export async function reopenAccountingPeriod(
  companyId: string,
  year: number,
  userId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const v = validateInput(companyIdSchema, companyId);
    if (!v.success) return { success: false, error: v.error };
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      return { success: false, error: 'Invalid fiscal year' };
    }
    const adapter = await getDbAdapter();
    const { startDate, endDate } = await getFiscalYearBounds(companyId, year, adapter);
    const row = await adapter.query(
      `SELECT id FROM accounting_periods
        WHERE company_id = $1::uuid AND start_date = $2::date AND end_date = $3::date AND status = 'closed'`,
      [companyId, startDate, endDate]
    );
    if (!row.success) return { success: false, error: row.error };
    const id = (row.rows?.[0] as Record<string, unknown> | undefined)?.id;
    if (!id) return { success: false, error: `Fiscal year ${year} is not closed` };
    return reopenAccountingPeriodById(companyId, String(id), userId);
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/**
 * Close one sub-period (monthly / quarterly / half) — soft or final.
 * Annual + final delegates to closeFiscalYear (the CLS journal path).
 * Sequential both ways: no earlier OPEN period may remain, and reopening
 * refuses while a LATER period is closed (newest-first).
 */
export async function closeAccountingPeriod(
  companyId: string,
  periodId: string,
  userId: string,
  mode: 'soft' | 'final' = 'final'
): Promise<{ success: boolean; error?: string }> {
  try {
    const idv = validateInput(idCompanySchema, { id: periodId, companyId });
    if (!idv.success) return { success: false, error: idv.error };
    const adapter = await getDbAdapter();
    const cur = await adapter.query(
      `SELECT id, year, period_type, start_date, end_date, status
         FROM accounting_periods WHERE id = $1::uuid AND company_id = $2::uuid`,
      [periodId, companyId]
    );
    if (!cur.success) return { success: false, error: cur.error };
    const row = (cur.rows?.[0] as Record<string, unknown> | undefined);
    if (!row) return { success: false, error: 'Accounting period not found' };
    const target: AccountingPeriodStatus = mode === 'soft' ? 'soft_closed' : 'closed';
    if (String(row.status) === target) return { success: true };
    if (String(row.status) === 'closed') return { success: false, error: 'Period is already finally closed' };
    if (String(row.period_type || 'annual') === 'annual' && mode === 'final') {
      return closeFiscalYear(companyId, Number(row.year), userId);
    }
    const end = toDateString(row.end_date) || '';
    const earlier = await adapter.query(
      `SELECT end_date FROM accounting_periods
        WHERE company_id = $1::uuid AND end_date < $2::date AND status = 'open' LIMIT 1`,
      [companyId, end]
    );
    if (!earlier.success) return { success: false, error: earlier.error };
    if (earlier.rows?.length) {
      return { success: false, error: 'Cannot close — an earlier period is still open. Close oldest-first' };
    }
    const res = await adapter.query(
      `UPDATE accounting_periods SET status = $1, closed_at = NOW(), updated_at = NOW()
        WHERE id = $2::uuid AND company_id = $3::uuid AND status = 'open'`,
      [target, periodId, companyId]
    );
    if (!res.success) return { success: false, error: res.error };
    await logAudit({
      companyId,
      userId: safeUserId(userId) || 'system',
      action: 'post',
      tableName: 'accounting_periods',
      recordId: periodId,
      newValues: { periodId, status: target, mode },
    });
    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/**
 * Reopen one period by id (soft or final). Newest-first: a LATER closed
 * period blocks the reopen. The closing journal (if any) is never deleted.
 */
export async function reopenAccountingPeriodById(
  companyId: string,
  periodId: string,
  userId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const idv = validateInput(idCompanySchema, { id: periodId, companyId });
    if (!idv.success) return { success: false, error: idv.error };
    const adapter = await getDbAdapter();
    const cur = await adapter.query(
      `SELECT end_date, status FROM accounting_periods WHERE id = $1::uuid AND company_id = $2::uuid`,
      [periodId, companyId]
    );
    if (!cur.success) return { success: false, error: cur.error };
    const row = (cur.rows?.[0] as Record<string, unknown> | undefined);
    if (!row) return { success: false, error: 'Accounting period not found' };
    if (String(row.status) === 'open') return { success: true };
    const end = toDateString(row.end_date) || '';
    const wasFinal = String(row.status) === 'closed';
    const later = await adapter.query(
      `SELECT end_date FROM accounting_periods
        WHERE company_id = $1::uuid AND end_date > $2::date AND status = 'closed' LIMIT 1`,
      [companyId, end]
    );
    if (!later.success) return { success: false, error: later.error };
    if (later.rows?.length) {
      return { success: false, error: 'Cannot reopen — a later period is closed. Reopen newest-first' };
    }
    const res = await adapter.query(
      `UPDATE accounting_periods SET status = 'open', closed_at = NULL, updated_at = NOW()
        WHERE id = $1::uuid AND company_id = $2::uuid AND status <> 'open'`,
      [periodId, companyId]
    );
    if (!res.success) return { success: false, error: res.error };
    await logAudit({
      companyId,
      userId: safeUserId(userId) || 'system',
      action: 'update',
      tableName: 'accounting_periods',
      recordId: periodId,
      newValues: { periodId, status: 'open', reopened: true, wasFinal },
    });
    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}
