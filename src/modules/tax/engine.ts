/**
 * Country-neutral tax engine (Phase 3). All country specifics live in the
 * profile files; this module only orchestrates: context loading, VAT math,
 * period guards, return computation.
 */
import { getDbAdapter, isElectronPg } from '@/core/database/adapters';
import type { DbAdapter } from '@/core/database/adapters/types';
import { toDateString } from '@/core/utils/mapPgRow';
import { getCountryProfile, DEFAULT_COUNTRY_CODE } from './registry';
import type { CountryTaxProfile, FilingFrequency, TaxPeriod, VatReturn } from './types';

type Queryable = Pick<DbAdapter, 'query'>;

/**
 * Typed RPC envelope. On desktop the SQL lives in the main process, where the
 * company id comes from the session; the PGlite/e2e fallback below runs the
 * same statements. `db` injection wins over both so the engine tests keep
 * driving the fallback deterministically.
 */
type RpcEnvelope = { success: boolean; rows?: Record<string, unknown>[]; error?: string };

function taxRpc(): NonNullable<NonNullable<Window['electronDB']>['tax']> | null {
  return (typeof window !== 'undefined' && window.electronDB?.tax) || null;
}

function rpcPath(provided?: Queryable): boolean {
  return !provided && isElectronPg() && taxRpc() !== null;
}

export const TAX_COUNTRY_KEY = 'tax.country_code';
export const TAX_TIMEZONE_KEY = 'tax.timezone';

export interface CompanyTaxContext {
  companyId: string;
  countryCode: string;
  timezone: string;
  profile: CountryTaxProfile;
}

/** Load the company's tax context (settings keys; safe YE fallback). */
export async function getCompanyTaxContext(companyId: string, db?: Queryable): Promise<CompanyTaxContext> {
  let countryCode = DEFAULT_COUNTRY_CODE;
  let timezone = '';
  try {
    let rows: Record<string, unknown>[] = [];
    if (rpcPath(db)) {
      const res = (await taxRpc()!.getContext({ keys: [TAX_COUNTRY_KEY, TAX_TIMEZONE_KEY] })) as RpcEnvelope;
      if (res.success) rows = res.rows || [];
    } else {
      const adapter = db || ((await getDbAdapter()) as Queryable);
      const res = await adapter.query<{ key: string; value: string }>(
        `SELECT key, value FROM settings WHERE company_id = $1 AND key IN ($2, $3)`,
        [companyId, TAX_COUNTRY_KEY, TAX_TIMEZONE_KEY]
      );
      if (res.success) rows = (res.rows || []) as Record<string, unknown>[];
    }
    for (const r of rows) {
      if (String(r.key) === TAX_COUNTRY_KEY && String(r.value || '').trim()) {
        countryCode = String(r.value).trim().toUpperCase();
      }
      if (String(r.key) === TAX_TIMEZONE_KEY && String(r.value || '').trim()) {
        timezone = String(r.value).trim();
      }
    }
  } catch {
    /* settings read must never crash posting */
  }
  const profile = getCountryProfile(countryCode);
  return { companyId, countryCode: profile.countryCode, timezone: timezone || profile.timezone, profile };
}

/** Persist country + timezone (settings upsert). */
export async function setCompanyTaxContext(
  companyId: string,
  countryCode: string,
  timezone: string,
  db?: Queryable
): Promise<{ success: boolean; error?: string }> {
  const profile = getCountryProfile(countryCode);
  try {
    const entries = [
      { key: TAX_COUNTRY_KEY, value: profile.countryCode },
      { key: TAX_TIMEZONE_KEY, value: timezone || profile.timezone },
    ];
    if (rpcPath(db)) {
      const res = (await taxRpc()!.setContext({ entries })) as RpcEnvelope;
      if (!res.success) return { success: false, error: res.error };
      return { success: true };
    }
    const adapter = db || ((await getDbAdapter()) as Queryable);
    for (const { key, value } of entries) {
      const res = await adapter.query(
        `INSERT INTO settings (company_id, key, value, category)
         VALUES ($1::uuid, $2, $3, 'tax')
         ON CONFLICT (company_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [companyId, key, value]
      );
      if (!res.success) return { success: false, error: res.error };
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/** VAT on a net amount at the profile standard rate (2-decimal money). */
export function computeVat(net: number, profile: CountryTaxProfile): number {
  return Math.round((Number(net) || 0) * profile.vat.standard * 100) / 100;
}

/**
 * Period guard: rejects postings dated inside a CLOSED/FILED tax period.
 * Open-ended when the tax_periods table has no covering row (legacy data
 * posts freely). Returns { open: true } or { open: false, period }.
 */
export async function assertPeriodOpen(
  companyId: string,
  date: string,
  db?: Queryable
): Promise<{ open: true } | { open: false; period: TaxPeriod; error?: string }> {
  const day = String(date || '').slice(0, 10);
  const blocked = (error: string) => ({
    open: false as const,
    period: {
      id: '',
      companyId,
      countryCode: '',
      periodType: '',
      startDate: day,
      endDate: day,
      status: 'closed' as const,
      filedAt: null,
    },
    error,
  });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return blocked('Posting date is required');
  try {
    let rows: Record<string, unknown>[] = [];
    let failure: string | undefined;
    if (rpcPath(db)) {
      const res = (await taxRpc()!.findPeriod({ date: day })) as RpcEnvelope;
      if (!res.success) failure = res.error;
      else rows = res.rows || [];
    } else {
      const adapter = db || ((await getDbAdapter()) as Queryable);
      const res = await adapter.query(
        `SELECT id, company_id, country_code, period_type, start_date, end_date, status, filed_at
           FROM tax_periods
          WHERE company_id = $1::uuid AND start_date <= $2::date AND end_date >= $2::date
          ORDER BY end_date DESC LIMIT 1`,
        [companyId, day]
      );
      if (!res.success) failure = res.error;
      else rows = (res.rows || []) as Record<string, unknown>[];
    }
    if (failure) return blocked(failure || 'Tax period lookup failed');
    const row = rows[0];
    if (!row) return { open: true };
    if (row.company_id !== undefined && String(row.company_id) !== String(companyId)) return blocked('Tax period tenant mismatch');
    if (row.status === undefined || row.status === null || row.status === '') return blocked('Tax period status is missing');
    const status = String(row.status);
    if (status === 'closed' || status === 'filed') {
      return {
        open: false,
        period: {
          id: String(row.id),
          companyId: String(row.company_id),
          countryCode: String(row.country_code || ''),
          periodType: String(row.period_type || ''),
          startDate: toDateString(row.start_date) || '',
          endDate: toDateString(row.end_date) || '',
          status,
          filedAt: row.filed_at ? String(row.filed_at) : null,
        },
      };
    }
    if (status !== 'open') return blocked('Unknown tax period status');
    return { open: true };
  } catch (error) {
    return blocked(error instanceof Error ? error.message : 'Tax period lookup failed');
  }
}

export interface TaxPeriodInput {
  countryCode: string;
  periodType: string;
  startDate: string;
  endDate: string;
}

/** Legal tax-period transitions (filed is terminal — same machine as the RPC). */
export function isValidTaxTransition(from: string, to: string): boolean {
  if (from === to) return true; // idempotent re-set
  if (from === 'open' && to === 'closed') return true;
  if (from === 'closed' && (to === 'open' || to === 'filed')) return true;
  return false;
}

/** Open a tax period (idempotent per company+range; overlapping ranges refuse). */
export async function openTaxPeriod(
  companyId: string,
  input: TaxPeriodInput,
  db?: Queryable
): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    const start = String(input.startDate || '').slice(0, 10);
    const end = String(input.endDate || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
      return { success: false, error: 'startDate and endDate must be YYYY-MM-DD' };
    }
    if (end < start) return { success: false, error: 'endDate must be on or after startDate' };
    let id: string | undefined;
    if (rpcPath(db)) {
      const res = (await taxRpc()!.openPeriod({
        countryCode: input.countryCode,
        periodType: input.periodType,
        startDate: start,
        endDate: end,
      })) as RpcEnvelope;
      if (!res.success) return { success: false, error: res.error };
      id = res.rows?.[0] ? String(res.rows[0].id) : undefined;
    } else {
      const adapter = db || ((await getDbAdapter()) as Queryable);
      const overlap = await adapter.query(
        `SELECT id FROM tax_periods
          WHERE company_id = $1::uuid AND start_date <= $2::date AND end_date >= $3::date LIMIT 1`,
        [companyId, end, start]
      );
      if (!overlap.success) return { success: false, error: overlap.error };
      if (overlap.rows?.length) return { success: false, error: 'Tax period overlaps an existing period' };
      const res = await adapter.query<{ id: string }>(
        `INSERT INTO tax_periods (company_id, country_code, period_type, start_date, end_date, status)
         VALUES ($1::uuid, $2, $3, $4::date, $5::date, 'open')
         ON CONFLICT (company_id, start_date, end_date) DO UPDATE SET updated_at = NOW()
         RETURNING id`,
        [companyId, input.countryCode, input.periodType, start, end]
      );
      if (!res.success) return { success: false, error: res.error };
      id = res.rows?.[0] ? String((res.rows[0] as { id: unknown }).id) : undefined;
    }
    return { success: true, id };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/** Close / reopen / mark-filed a tax period (state machine enforced). */
export async function setTaxPeriodStatus(
  companyId: string,
  periodId: string,
  status: 'open' | 'closed' | 'filed',
  db?: Queryable
): Promise<{ success: boolean; error?: string }> {
  try {
    if (rpcPath(db)) {
      const res = (await taxRpc()!.setPeriodStatus({ periodId, status })) as RpcEnvelope;
      if (!res.success) return { success: false, error: res.error };
      return { success: true };
    }
    const adapter = db || ((await getDbAdapter()) as Queryable);
    const cur = await adapter.query(
      `SELECT status FROM tax_periods WHERE id = $1::uuid AND company_id = $2::uuid`,
      [periodId, companyId]
    );
    if (!cur.success) return { success: false, error: cur.error };
    const row = (cur.rows || [])[0] as Record<string, unknown> | undefined;
    if (!row) return { success: false, error: 'Tax period not found' };
    if (!isValidTaxTransition(String(row.status), status)) {
      return { success: false, error: 'Illegal tax-period transition (open → closed → filed; filed is terminal)' };
    }
    if (String(row.status) === status) return { success: true };
    const res = await adapter.query(
      `UPDATE tax_periods SET status = $1::varchar, filed_at = CASE WHEN $1::varchar = 'filed' THEN NOW() ELSE filed_at END, updated_at = NOW()
        WHERE id = $2::uuid AND company_id = $3::uuid`,
      [status, periodId, companyId]
    );
    if (!res.success) return { success: false, error: res.error };
    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/** List tax periods (newest first). */
export async function listTaxPeriods(companyId: string, db?: Queryable): Promise<TaxPeriod[]> {
  try {
    let rows: Record<string, unknown>[] = [];
    if (rpcPath(db)) {
      const res = (await taxRpc()!.listPeriods({})) as RpcEnvelope;
      if (!res.success) return [];
      rows = res.rows || [];
    } else {
      const adapter = db || ((await getDbAdapter()) as Queryable);
      const res = await adapter.query(
        `SELECT id, company_id, country_code, period_type, start_date, end_date, status, filed_at
           FROM tax_periods WHERE company_id = $1::uuid ORDER BY end_date DESC`,
        [companyId]
      );
      if (!res.success) return [];
      rows = (res.rows || []) as Record<string, unknown>[];
    }
    return rows.map((r) => ({
      id: String(r.id),
      companyId: String(r.company_id),
      countryCode: String(r.country_code || ''),
      periodType: String(r.period_type || ''),
      startDate: toDateString(r.start_date) || '',
      endDate: toDateString(r.end_date) || '',
      status: String(r.status || 'open') as TaxPeriod['status'],
      filedAt: r.filed_at ? String(r.filed_at) : null,
    }));
  } catch {
    return [];
  }
}

/**
 * VAT return for a CLOSED-or-open period, sourced from POSTED journal legs
 * (single source of truth — never from document headers):
 *   output VAT = Σ Cr on the output account in range
 *   input VAT  = Σ Dr on the input account in range
 * Returns reduce output (contra-revenue debits carry their VAT legs too),
 * because every return leg above was posted against the same two accounts.
 */
export async function computeVatReturn(
  companyId: string,
  period: TaxPeriod,
  db?: Queryable
): Promise<{ success: boolean; data?: VatReturn; error?: string }> {
  try {
    const { getDefaultAccountId } = await import('@/core/utils/journalEntryGenerator');
    const [outId, inId] = await Promise.all([
      getDefaultAccountId(companyId, 'default_vat_output'),
      getDefaultAccountId(companyId, 'default_vat_input'),
    ]);
    if (!outId || !inId) {
      return { success: false, error: 'VAT accounts not configured (default_vat_output / default_vat_input)' };
    }
    // Output VAT net of return reversals: returns debit the same account.
    // Both accounts in one grouped statement — the fallback issued two.
    let legRows: Record<string, unknown>[] = [];
    if (rpcPath(db)) {
      const res = (await taxRpc()!.vatLegs({
        outputAccountId: outId,
        inputAccountId: inId,
        startDate: period.startDate,
        endDate: period.endDate,
      })) as RpcEnvelope;
      if (!res.success) throw new Error(res.error || 'VAT return query failed');
      legRows = res.rows || [];
    } else {
      const adapter = db || ((await getDbAdapter()) as Queryable);
      const res = await adapter.query(
        `SELECT je.account_id, COALESCE(SUM(je.credit), 0) AS cr, COALESCE(SUM(je.debit), 0) AS dr
           FROM journal_entries je
           JOIN transactions t ON t.id = je.transaction_id
          WHERE je.company_id = $1::uuid AND je.account_id IN ($2::uuid, $3::uuid)
            AND t.status = 'posted' AND t.date >= $4::date AND t.date <= $5::date
          GROUP BY je.account_id`,
        [companyId, outId, inId, period.startDate, period.endDate]
      );
      if (!res.success) throw new Error(res.error || 'VAT return query failed');
      legRows = (res.rows || []) as Record<string, unknown>[];
    }
    const legOf = (accountId: string) =>
      legRows.find((r) => String(r.account_id) === String(accountId)) || {};
    const outRow = legOf(outId);
    const inRow = legOf(inId);
    const outputVat = Math.round(((Number(outRow.cr) || 0) - (Number(outRow.dr) || 0)) * 100) / 100;
    const inputVat = Math.round(((Number(inRow.dr) || 0) - (Number(inRow.cr) || 0)) * 100) / 100;
    const net = Math.round((outputVat - inputVat) * 100) / 100;
    // The context is only read for the currency label, and it resolves its own
    // transport — passing the adapter here would force the raw path back on.
    const ctx = await getCompanyTaxContext(companyId, db);
    return {
      success: true,
      data: {
        period,
        outputVat,
        inputVat,
        netPayable: net,
        payable: net >= 0,
        lines: [
          { label: 'output', amount: outputVat },
          { label: 'input', amount: inputVat },
          { label: net >= 0 ? 'net-payable' : 'net-refundable', amount: Math.abs(net) },
        ],
        currencyCode: ctx.profile.registration.currency,
      },
    };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

export type { FilingFrequency };
