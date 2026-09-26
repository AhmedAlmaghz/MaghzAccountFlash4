/**
 * Country-neutral tax engine (Phase 3). All country specifics live in the
 * profile files; this module only orchestrates: context loading, VAT math,
 * period guards, return computation.
 */
import { getDbAdapter } from '@/core/database/adapters';
import type { DbAdapter } from '@/core/database/adapters/types';
import { toDateString } from '@/core/utils/mapPgRow';
import { getCountryProfile, DEFAULT_COUNTRY_CODE } from './registry';
import type { CountryTaxProfile, FilingFrequency, TaxPeriod, VatReturn } from './types';

type Queryable = Pick<DbAdapter, 'query'>;

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
  const adapter = db || ((await getDbAdapter()) as Queryable);
  let countryCode = DEFAULT_COUNTRY_CODE;
  let timezone = '';
  try {
    const res = await adapter.query<{ key: string; value: string }>(
      `SELECT key, value FROM settings WHERE company_id = $1 AND key IN ($2, $3)`,
      [companyId, TAX_COUNTRY_KEY, TAX_TIMEZONE_KEY]
    );
    if (res.success) {
      for (const r of (res.rows || []) as Array<{ key: string; value: string }>) {
        if (String(r.key) === TAX_COUNTRY_KEY && String(r.value || '').trim()) {
          countryCode = String(r.value).trim().toUpperCase();
        }
        if (String(r.key) === TAX_TIMEZONE_KEY && String(r.value || '').trim()) {
          timezone = String(r.value).trim();
        }
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
    const adapter = db || ((await getDbAdapter()) as Queryable);
    for (const [key, value] of [
      [TAX_COUNTRY_KEY, profile.countryCode],
      [TAX_TIMEZONE_KEY, timezone || profile.timezone],
    ]) {
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
    const adapter = db || ((await getDbAdapter()) as Queryable);
    const res = await adapter.query(
      `SELECT id, company_id, country_code, period_type, start_date, end_date, status, filed_at
         FROM tax_periods
        WHERE company_id = $1::uuid AND start_date <= $2::date AND end_date >= $2::date
        ORDER BY end_date DESC LIMIT 1`,
      [companyId, day]
    );
    if (!res.success) return blocked(res.error || 'Tax period lookup failed');
    const row = (res.rows || [])[0] as Record<string, unknown> | undefined;
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

/** Open a tax period (idempotent per company+range). */
export async function openTaxPeriod(
  companyId: string,
  input: TaxPeriodInput,
  db?: Queryable
): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    const adapter = db || ((await getDbAdapter()) as Queryable);
    const res = await adapter.query<{ id: string }>(
      `INSERT INTO tax_periods (company_id, country_code, period_type, start_date, end_date, status)
       VALUES ($1::uuid, $2, $3, $4::date, $5::date, 'open')
       ON CONFLICT (company_id, start_date, end_date) DO UPDATE SET updated_at = NOW()
       RETURNING id`,
      [companyId, input.countryCode, input.periodType, input.startDate, input.endDate]
    );
    if (!res.success) return { success: false, error: res.error };
    return { success: true, id: res.rows?.[0] ? String((res.rows[0] as { id: unknown }).id) : undefined };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/** Close / reopen / mark-filed a tax period. */
export async function setTaxPeriodStatus(
  companyId: string,
  periodId: string,
  status: 'open' | 'closed' | 'filed',
  db?: Queryable
): Promise<{ success: boolean; error?: string }> {
  try {
    const adapter = db || ((await getDbAdapter()) as Queryable);
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
    const adapter = db || ((await getDbAdapter()) as Queryable);
    const res = await adapter.query(
      `SELECT id, company_id, country_code, period_type, start_date, end_date, status, filed_at
         FROM tax_periods WHERE company_id = $1::uuid ORDER BY end_date DESC`,
      [companyId]
    );
    if (!res.success) return [];
    return ((res.rows || []) as Record<string, unknown>[]).map((r) => ({
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
    const adapter = db || ((await getDbAdapter()) as Queryable);
    const { getDefaultAccountId } = await import('@/core/utils/journalEntryGenerator');
    const [outId, inId] = await Promise.all([
      getDefaultAccountId(companyId, 'default_vat_output'),
      getDefaultAccountId(companyId, 'default_vat_input'),
    ]);
    if (!outId || !inId) {
      return { success: false, error: 'VAT accounts not configured (default_vat_output / default_vat_input)' };
    }
    // Output VAT net of return reversals: returns debit the same account.
    const outRes = await adapter.query(
      `SELECT COALESCE(SUM(je.credit), 0) AS cr, COALESCE(SUM(je.debit), 0) AS dr
         FROM journal_entries je
         JOIN transactions t ON t.id = je.transaction_id
        WHERE je.company_id = $1::uuid AND je.account_id = $2::uuid
          AND t.status = 'posted' AND t.date >= $3::date AND t.date <= $4::date`,
      [companyId, outId, period.startDate, period.endDate]
    );
    if (!outRes.success) throw new Error(outRes.error || 'VAT return query failed');
    const outRow = (outRes.rows?.[0] || {}) as Record<string, unknown>;
    const inRes = await adapter.query(
      `SELECT COALESCE(SUM(je.debit), 0) AS dr, COALESCE(SUM(je.credit), 0) AS cr
         FROM journal_entries je
         JOIN transactions t ON t.id = je.transaction_id
        WHERE je.company_id = $1::uuid AND je.account_id = $2::uuid
          AND t.status = 'posted' AND t.date >= $3::date AND t.date <= $4::date`,
      [companyId, inId, period.startDate, period.endDate]
    );
    if (!inRes.success) throw new Error(inRes.error || 'VAT return query failed');
    const inRow = (inRes.rows?.[0] || {}) as Record<string, unknown>;
    const outputVat = Math.round(((Number(outRow.cr) || 0) - (Number(outRow.dr) || 0)) * 100) / 100;
    const inputVat = Math.round(((Number(inRow.dr) || 0) - (Number(inRow.cr) || 0)) * 100) / 100;
    const net = Math.round((outputVat - inputVat) * 100) / 100;
    const ctx = await getCompanyTaxContext(companyId, adapter);
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
