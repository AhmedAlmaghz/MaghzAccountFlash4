import { getDbAdapter, isElectronPg } from '@/core/database/adapters';
import { safeUserId } from '@/core/utils/userIdValidator';
import { validateInput, companyIdSchema } from '@/core/utils/validation';
import type { Company, Currency, VatSetting, Branch, Setting } from './types';

// Typed RPC bridge for settings (Phase 4 slice 6). When the Electron IPC
// surface is available, the renderer sends a structured payload and the
// main process derives `company_id` + audit user id from the authenticated
// session — the renderer can never reference another company's row. The
// fallback path (PGlite / e2e) still uses `adapter.query` with an
// explicit `company_id = $N` filter.
type RpcEnvelope = { success: boolean; rows?: Record<string, unknown>[]; error?: string };

async function invokeCoreRpc<T = Record<string, unknown>>(method: string, payload: Record<string, unknown>): Promise<{ success: boolean; data?: T[]; id?: string; error?: string }> {
  const core = (typeof window !== 'undefined' && window.electronDB?.core) as
    | Record<string, ((p: Record<string, unknown>) => Promise<RpcEnvelope>) | undefined>
    | undefined;
  const fn = core?.[method];
  if (!fn) return { success: false, error: 'RPC unavailable' };
  const result = await fn(payload);
  if (!result.success) return { success: false, error: result.error };
  const rows = (result.rows || []) as T[];
  const firstRow = rows.length ? rows[0] : undefined;
  const id = firstRow && typeof firstRow === 'object' && firstRow !== null && 'id' in firstRow
    ? String((firstRow as Record<string, unknown>).id)
    : undefined;
  return { success: true, data: rows, id };
}

export const coreApi = {
  // ─── Company ───────────────────────────────────────────────────────────────
  async getCompany(): Promise<{ success: boolean; data?: Company; error?: string }> {
    const adapter = await getDbAdapter();
    return adapter.getCompany();
  },

  async updateCompany(data: Partial<Company>, _userId?: string): Promise<{ success: boolean; error?: string }> {
    if (!data.id) return { success: false, error: 'معرف الشركة مطلوب' };
    const adapter = await getDbAdapter();
    // Phase 4 slice 3: the adapter owns scoping. The Electron adapter maps
    // this to a session-scoped typed RPC (server derives companyId +
    // updatedBy), closing the cross-tenant `WHERE id = $N`-only gap.
    return adapter.updateCompany(data, safeUserId(_userId));
  },

  // ─── Currencies ────────────────────────────────────────────────────────────
  async getCurrencies(companyId: string): Promise<{ success: boolean; data?: Currency[]; error?: string }> {
    const cidValidation = validateInput(companyIdSchema, companyId);
    if (!cidValidation.success) return { success: false, error: cidValidation.error };
    if (isElectronPg()) {
      const result = await invokeCoreRpc<Currency>('getCurrencies', {});
      if (result.success) return { success: true, data: result.data };
      return { success: false, error: result.error };
    }
    const adapter = await getDbAdapter();
    const result = await adapter.query(
      'SELECT * FROM currencies WHERE company_id = $1 AND is_active = true ORDER BY is_default DESC, code',
      [companyId]
    );
    if (result.success) {
      return { success: true, data: result.rows as Currency[] };
    }
    return { success: false, error: result.error };
  },

  async createCurrency(data: Omit<Currency, 'id'>, _userId?: string): Promise<{ success: boolean; id?: string; error?: string }> {
    const cidValidation = validateInput(companyIdSchema, data.companyId);
    if (!cidValidation.success) return { success: false, error: cidValidation.error };
    if (isElectronPg()) {
      const result = await invokeCoreRpc<Currency>('createCurrency', {
        code: data.code,
        name: data.name,
        symbol: data.symbol,
        exchangeRate: data.exchangeRate,
        isDefault: data.isDefault,
      });
      if (result.success && result.id) return { success: true, id: result.id };
      return { success: false, error: result.error };
    }
    const adapter = await getDbAdapter();
    const result = await adapter.query<{ id: string }>(
      `INSERT INTO currencies (company_id, code, name, symbol, exchange_rate, is_default, is_active, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8) RETURNING id`,
      [data.companyId, data.code, data.name, data.symbol, data.exchangeRate, data.isDefault, safeUserId(_userId), safeUserId(_userId)]
    );
    if (result.success && result.rows?.[0]) {
      return { success: true, id: result.rows[0].id };
    }
    return { success: false, error: result.error };
  },

  async updateCurrency(companyId: string, id: string, data: Partial<Currency>, _userId?: string): Promise<{ success: boolean; error?: string }> {
    const cidValidation = validateInput(companyIdSchema, companyId);
    if (!cidValidation.success) return { success: false, error: cidValidation.error };
    if (isElectronPg()) {
      const result = await invokeCoreRpc<Currency>('updateCurrency', {
        id,
        code: data.code,
        name: data.name,
        symbol: data.symbol,
        exchangeRate: data.exchangeRate,
        isDefault: data.isDefault,
        isActive: data.isActive,
      });
      return result.success ? { success: true } : { success: false, error: result.error };
    }
    const adapter = await getDbAdapter();
    return adapter.query(
      `UPDATE currencies SET code = $1, name = $2, symbol = $3, exchange_rate = $4, is_default = $5, is_active = $6, updated_by = $7, updated_at = NOW() WHERE id = $8 AND company_id = $9`,
      [data.code, data.name, data.symbol, data.exchangeRate, data.isDefault, data.isActive, safeUserId(_userId), id, companyId]
    );
  },

  // ─── VAT Settings ──────────────────────────────────────────────────────────
  async getVatSettings(companyId: string): Promise<{ success: boolean; data?: VatSetting; error?: string }> {
    const cidValidation = validateInput(companyIdSchema, companyId);
    if (!cidValidation.success) return { success: false, error: cidValidation.error };
    if (isElectronPg()) {
      const result = await invokeCoreRpc<VatSetting>('getVatSettings', {});
      if (result.success && result.data && result.data.length > 0) return { success: true, data: result.data[0] };
      return { success: false, error: result.error || 'No VAT settings found' };
    }
    const adapter = await getDbAdapter();
    const result = await adapter.query(
      'SELECT * FROM vat_settings WHERE company_id = $1 LIMIT 1',
      [companyId]
    );
    if (result.success && result.rows?.[0]) {
      return { success: true, data: result.rows[0] as VatSetting };
    }
    return { success: false, error: result.error || 'No VAT settings found' };
  },

  async updateVatSettings(companyId: string, id: string, data: Partial<VatSetting>, _userId?: string): Promise<{ success: boolean; error?: string }> {
    const cidValidation = validateInput(companyIdSchema, companyId);
    if (!cidValidation.success) return { success: false, error: cidValidation.error };
    if (isElectronPg()) {
      const result = await invokeCoreRpc<VatSetting>('updateVatSettings', {
        id,
        vatRate: data.vatRate,
        vatNumber: data.vatNumber,
        isInclusive: data.isInclusive,
        isActive: data.isActive,
      });
      return result.success ? { success: true } : { success: false, error: result.error };
    }
    const adapter = await getDbAdapter();
    return adapter.query(
      `UPDATE vat_settings SET vat_rate = $1, vat_number = $2, is_inclusive = $3, is_active = $4, updated_by = $5, updated_at = NOW() WHERE id = $6 AND company_id = $7`,
      [data.vatRate, data.vatNumber, data.isInclusive, data.isActive, safeUserId(_userId), id, companyId]
    );
  },

  // ─── Branches ──────────────────────────────────────────────────────────────
  async getBranches(companyId: string): Promise<{ success: boolean; data?: Branch[]; error?: string }> {
    const cidValidation = validateInput(companyIdSchema, companyId);
    if (!cidValidation.success) return { success: false, error: cidValidation.error };
    if (isElectronPg()) {
      const result = await invokeCoreRpc<Branch>('getBranches', {});
      if (result.success) return { success: true, data: result.data };
      return { success: false, error: result.error };
    }
    const adapter = await getDbAdapter();
    const result = await adapter.query(
      'SELECT * FROM branches WHERE company_id = $1 AND is_active = true ORDER BY name',
      [companyId]
    );
    if (result.success) {
      return { success: true, data: result.rows as Branch[] };
    }
    return { success: false, error: result.error };
  },

  async createBranch(data: Omit<Branch, 'id'>, _userId?: string): Promise<{ success: boolean; id?: string; error?: string }> {
    const cidValidation = validateInput(companyIdSchema, data.companyId);
    if (!cidValidation.success) return { success: false, error: cidValidation.error };
    if (isElectronPg()) {
      const result = await invokeCoreRpc<Branch>('createBranch', {
        name: data.name,
        code: data.code,
        address: data.address,
      });
      if (result.success && result.id) return { success: true, id: result.id };
      return { success: false, error: result.error };
    }
    const adapter = await getDbAdapter();
    const result = await adapter.query<{ id: string }>(
      `INSERT INTO branches (company_id, name, code, address, is_active, created_by, updated_by)
       VALUES ($1, $2, $3, $4, true, $5, $6) RETURNING id`,
      [data.companyId, data.name, data.code, data.address, safeUserId(_userId), safeUserId(_userId)]
    );
    if (result.success && result.rows?.[0]) {
      return { success: true, id: result.rows[0].id };
    }
    return { success: false, error: result.error };
  },

  async updateBranch(companyId: string, id: string, data: Partial<Branch>, _userId?: string): Promise<{ success: boolean; error?: string }> {
    const cidValidation = validateInput(companyIdSchema, companyId);
    if (!cidValidation.success) return { success: false, error: cidValidation.error };
    if (isElectronPg()) {
      const result = await invokeCoreRpc<Branch>('updateBranch', {
        id,
        name: data.name,
        code: data.code,
        address: data.address,
        isActive: data.isActive,
      });
      return result.success ? { success: true } : { success: false, error: result.error };
    }
    const adapter = await getDbAdapter();
    return adapter.query(
      `UPDATE branches SET name = $1, code = $2, address = $3, is_active = $4, updated_by = $5, updated_at = NOW() WHERE id = $6 AND company_id = $7`,
      [data.name, data.code, data.address, data.isActive, safeUserId(_userId), id, companyId]
    );
  },

  // ─── Settings ──────────────────────────────────────────────────────────────
  async getSettings(companyId: string, category?: string): Promise<{ success: boolean; data?: Setting[]; error?: string }> {
    const cidValidation = validateInput(companyIdSchema, companyId);
    if (!cidValidation.success) return { success: false, error: cidValidation.error };
    if (isElectronPg()) {
      const result = await invokeCoreRpc<Setting>('getSettings', category ? { category } : {});
      if (result.success) return { success: true, data: result.data };
      return { success: false, error: result.error };
    }
    const adapter = await getDbAdapter();
    let sql = 'SELECT * FROM settings WHERE company_id = $1';
    const params: unknown[] = [companyId];
    if (category) {
      sql += ' AND category = $2';
      params.push(category);
    }
    sql += ' ORDER BY key';
    const result = await adapter.query(sql, params);
    if (result.success) {
      return { success: true, data: result.rows as Setting[] };
    }
    return { success: false, error: result.error };
  },

  async setSetting(data: Omit<Setting, 'id'>): Promise<{ success: boolean; error?: string }> {
    const cidValidation = validateInput(companyIdSchema, data.companyId);
    if (!cidValidation.success) return { success: false, error: cidValidation.error };
    if (isElectronPg()) {
      const result = await invokeCoreRpc<Setting>('setSetting', {
        key: data.key,
        value: data.value,
        category: data.category,
      });
      return result.success ? { success: true } : { success: false, error: result.error };
    }
    const adapter = await getDbAdapter();
    return adapter.query(
      `INSERT INTO settings (company_id, key, value, category)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (company_id, key) DO UPDATE SET value = $3, updated_at = NOW()`,
      [data.companyId, data.key, data.value, data.category]
    );
  },
};
