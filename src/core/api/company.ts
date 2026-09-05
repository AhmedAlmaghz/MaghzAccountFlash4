import { getDbAdapter } from '@/core/database/adapters';
import { toDateString } from '@/core/utils/mapPgRow';
import { safeUserId } from '@/core/utils/userIdValidator';
import { validateInput, updateCompanySchema } from '@/core/utils/validation';
import type { CompanyConfig } from '@/core/store/onboardingStore';
import type { Company } from '@/modules/core/types';

/**
 * Unified company profile API — the single source of truth for reading and
 * writing the company row. Used by:
 * - the company settings page (CompanySetupPage),
 * - the onboarding finish step (persisting the wizard's CompanyConfig),
 * - app startup (main.tsx refresh).
 *
 * Transport notes:
 * - In Electron, reads/writes go through the session-scoped typed RPC
 *   (`db:rpc:core.getCompany` / `db:rpc:core.updateCompany`); the renderer
 *   can never touch another company's row.
 * - In PGlite/web the same calls run as local SQL (single-tenant).
 */

// 2 MB cap for logo data-URLs (base64 inflates ~33%, kept in step with the
// HR photo-upload limit so one company logo cannot bloat the database).
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;

export interface CompanyUpdateInput {
  name: string;
  nameEn?: string;
  currency?: string;
  taxNumber?: string;
  address?: string;
  phone?: string;
  email?: string;
  logoUrl?: string;
  dateFormat?: string;
  decimalPlaces?: number;
  calendar?: 'gregorian' | 'hijri';
  fiscalYearStart?: string;
}

/** snake_case DB row → camelCase Company (single mapping point). */
export function mapCompanyRow(r: Record<string, unknown>): Company {
  return {
    id: String(r.id ?? ''),
    name: String(r.name ?? ''),
    nameEn: r.name_en ? String(r.name_en) : undefined,
    currency: String(r.currency ?? 'YER'),
    taxNumber: r.tax_number ? String(r.tax_number) : undefined,
    address: r.address ? String(r.address) : undefined,
    phone: r.phone ? String(r.phone) : undefined,
    email: r.email ? String(r.email) : undefined,
    logoUrl: r.logo_url ? String(r.logo_url) : undefined,
    fiscalYearStart: toDateString(r.fiscal_year_start) ?? undefined,
    dateFormat: r.date_format ? String(r.date_format) : 'yyyy-MM-dd',
    decimalPlaces: r.decimal_places != null && r.decimal_places !== '' ? Number(r.decimal_places) : 2,
    calendar: r.calendar === 'hijri' ? 'hijri' : 'gregorian',
    createdAt: r.created_at ? String(r.created_at) : undefined,
    updatedAt: r.updated_at ? String(r.updated_at) : undefined,
  };
}

function normalizeProfile(data: CompanyUpdateInput) {
  return {
    name: data.name.trim(),
    nameEn: data.nameEn?.trim() || null,
    currency: data.currency || 'YER',
    taxNumber: data.taxNumber?.trim() || null,
    address: data.address?.trim() || null,
    phone: data.phone?.trim() || null,
    email: data.email?.trim() || null,
    logoUrl: data.logoUrl || null,
    dateFormat: data.dateFormat || 'yyyy-MM-dd',
    decimalPlaces: data.decimalPlaces ?? 2,
    calendar: data.calendar || 'gregorian',
    fiscalYearStart: data.fiscalYearStart || null,
  };
}

export async function getCompany(): Promise<{ success: boolean; data?: Company; error?: string }> {
  try {
    const adapter = await getDbAdapter();
    const result = await adapter.getCompany();
    if (!result.success || !result.data) return { success: false, error: result.error || 'No company found' };
    return { success: true, data: mapCompanyRow(result.data as Record<string, unknown>) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function updateCompany(
  companyId: string,
  data: CompanyUpdateInput,
  userId?: string | null,
): Promise<{ success: boolean; error?: string }> {
  try {
    // Trim before validation: zod min(1) counts whitespace, so '   ' must
    // already be '' when the schema sees it.
    const v = validateInput(updateCompanySchema, { currency: 'YER', ...data, name: data.name.trim() });
    if (!v.success) return { success: false, error: v.error };
    const adapter = await getDbAdapter();
    const result = await adapter.updateCompany(
      { ...normalizeProfile({ ...data, name: v.data.name, currency: v.data.currency }), id: companyId },
      safeUserId(userId),
    );
    if (!result.success) return { success: false, error: result.error };
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function createCompany(
  data: CompanyUpdateInput,
): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    const v = validateInput(updateCompanySchema, { currency: 'YER', ...data, name: data.name.trim() });
    if (!v.success) return { success: false, error: v.error };
    const p = normalizeProfile({ ...data, name: v.data.name, currency: v.data.currency });
    const adapter = await getDbAdapter();
    const result = await adapter.query<{ id: string }>(
      `INSERT INTO companies (name, name_en, currency, tax_number, address, phone, email, logo_url, date_format, decimal_places, calendar, fiscal_year_start)
       VALUES ($1, $2, $3::varchar, $4, $5, $6, $7, $8, $9, $10::numeric, $11, $12::date) RETURNING id`,
      [p.name, p.nameEn, p.currency, p.taxNumber, p.address, p.phone, p.email, p.logoUrl, p.dateFormat, p.decimalPlaces, p.calendar, p.fiscalYearStart],
    );
    if (result.success && result.rows?.[0]) return { success: true, id: String(result.rows[0].id) };
    return { success: false, error: result.error };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Persists the onboarding wizard's CompanyConfig to the database:
 * updates the seeded company row when one exists, creates it otherwise
 * (the seed-'none' path). Never throws — callers fall back to store-only
 * state when the transport cannot write (e.g. sessionless Electron, where
 * the seed step has already persisted the profile).
 */
export async function applyOnboardingCompany(
  config: CompanyConfig,
): Promise<{ success: boolean; data?: Company; error?: string }> {
  try {
    const profile: CompanyUpdateInput = {
      name: config.name,
      nameEn: config.nameEn,
      currency: config.currency,
      taxNumber: config.taxNumber,
      address: config.address,
      phone: config.phone,
      email: config.email,
      dateFormat: config.dateFormat,
      decimalPlaces: config.decimalPlaces,
      calendar: config.calendar,
      fiscalYearStart: config.fiscalYearStart,
    };
    const existing = await getCompany();
    if (existing.success && existing.data?.id) {
      const upd = await updateCompany(existing.data.id, profile, null);
      if (!upd.success) return { success: false, error: upd.error };
      const fresh = await getCompany();
      return fresh.success && fresh.data ? fresh : { success: true, data: existing.data };
    }
    const created = await createCompany(profile);
    if (!created.success) return { success: false, error: created.error };
    const fresh = await getCompany();
    return fresh.success && fresh.data
      ? fresh
      : { success: true, data: { ...mapCompanyRow({}), id: created.id || '', name: profile.name, currency: profile.currency || 'YER' } };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}
