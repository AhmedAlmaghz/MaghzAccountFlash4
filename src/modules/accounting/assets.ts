import { getDbAdapter } from '@/core/database/adapters';
import {
  validateInput,
  companyIdSchema,
  idCompanySchema,
  createFixedAssetSchema,
  updateFixedAssetSchema,
  depreciationRunSchema,
  disposeFixedAssetSchema,
} from '@/core/utils/validation';
import { getDefaultAccountId, getCashBoxAccountId, resolvePostingAccounts } from '@/core/utils/journalEntryGenerator';

/** Resolve the GL accounts depreciation/disposal need (Phase-5 keys). */
export async function resolveDepreciationAccounts(companyId: string): Promise<{
  success: boolean;
  ids?: { fixedAssets: string; accumulated: string; expense: string };
  error?: string;
}> {
  const res = await resolvePostingAccounts(companyId, [
    'default_fixed_assets',
    'default_accumulated_depreciation',
    'default_depreciation_expense',
  ]);
  if (!res.success) return { success: false, error: res.error };
  return {
    success: true,
    ids: {
      fixedAssets: res.ids.default_fixed_assets,
      accumulated: res.ids.default_accumulated_depreciation,
      expense: res.ids.default_depreciation_expense,
    },
  };
}
import { buildJournalEntryStatement, runTransaction } from '@/core/database/tx';
import type { TxStatement } from '@/core/database/tx';
import { toDateString } from '@/core/utils/mapPgRow';
import { safeUserId } from '@/core/utils/userIdValidator';
import { logAudit } from '@/core/utils/auditLogger';
import { getNextDocumentNumber } from '@/core/api';

export type DepreciationMethod = 'straight_line' | 'declining_balance';

export interface FixedAsset {
  id: string;
  companyId: string;
  code: string;
  nameAr: string;
  nameEn?: string;
  category?: string;
  purchaseDate: string;
  cost: number;
  salvageValue: number;
  usefulLifeMonths: number;
  method: DepreciationMethod;
  accumulatedDepreciation: number;
  netBookValue: number;
  status: 'active' | 'disposed';
  disposedAt?: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Full months from purchaseDate to asOf (floor; 0 when asOf precedes purchase). */
export function monthsElapsed(purchaseDate: string, asOfDate: string): number {
  const [py, pm, pd] = purchaseDate.split('-').map(Number);
  const [ay, am, ad] = asOfDate.split('-').map(Number);
  if ([py, pm, pd, ay, am, ad].some((n) => !Number.isFinite(n))) return 0;
  const months = (ay - py) * 12 + (am - pm) + (ad >= pd ? 0 : -1);
  return Math.max(0, months);
}

export interface DepreciationBasis {
  cost: number;
  salvageValue: number;
  usefulLifeMonths: number;
  method: DepreciationMethod;
}

/**
 * Target accumulated depreciation as of a date (pure — the single source
 * of truth for both the monthly run and NBV displays).
 * - straight_line: (cost − salvage) / life per month, capped at cost − salvage.
 * - declining_balance: double-declining on NBV per month, never below
 *   salvage (monthly iteration, full precision, rounded once at the end).
 */
export function computeTargetAccumulated(basis: DepreciationBasis, purchaseDate: string, asOfDate: string): number {
  const cost = Math.max(0, Number(basis.cost) || 0);
  const salvage = Math.max(0, Math.min(Number(basis.salvageValue) || 0, cost));
  const life = Math.max(1, Math.floor(Number(basis.usefulLifeMonths) || 0));
  const elapsed = monthsElapsed(purchaseDate, asOfDate);
  if (elapsed <= 0 || cost <= salvage) return 0;
  if (basis.method === 'straight_line') {
    return round2(Math.min((elapsed * (cost - salvage)) / life, cost - salvage));
  }
  const years = life / 12;
  const annualRate = 2 / years;
  let nbv = cost;
  for (let m = 0; m < elapsed && nbv > salvage; m++) {
    nbv -= Math.min((nbv * annualRate) / 12, nbv - salvage);
  }
  return round2(Math.min(cost - nbv, cost - salvage));
}

/** This period's charge = target − already posted (never negative). */
export function periodDepreciation(
  asset: Pick<FixedAsset, 'cost' | 'salvageValue' | 'usefulLifeMonths' | 'method' | 'accumulatedDepreciation' | 'purchaseDate'>,
  asOfDate: string
): number {
  const target = computeTargetAccumulated(asset, asset.purchaseDate, asOfDate);
  return Math.max(0, round2(target - (Number(asset.accumulatedDepreciation) || 0)));
}

function mapAssetRow(r: Record<string, unknown>): FixedAsset {
  const cost = Number(r.cost) || 0;
  const acc = Number(r.accumulated_depreciation) || 0;
  return {
    id: String(r.id),
    companyId: String(r.company_id),
    code: String(r.code || ''),
    nameAr: String(r.name_ar || ''),
    nameEn: r.name_en ? String(r.name_en) : undefined,
    category: r.category ? String(r.category) : undefined,
    purchaseDate: toDateString(r.purchase_date) || '',
    cost,
    salvageValue: Number(r.salvage_value) || 0,
    usefulLifeMonths: Number(r.useful_life_months) || 0,
    method: String(r.method) === 'declining_balance' ? 'declining_balance' : 'straight_line',
    accumulatedDepreciation: acc,
    netBookValue: round2(cost - acc),
    status: String(r.status) === 'disposed' ? 'disposed' : 'active',
    disposedAt: r.disposed_at ? toDateString(r.disposed_at) || undefined : undefined,
  };
}

export const fixedAssetsApi = {
  async getFixedAssets(companyId: string): Promise<{ success: boolean; data?: FixedAsset[]; error?: string }> {
    try {
      const v = validateInput(companyIdSchema, companyId);
      if (!v.success) return { success: false, error: v.error };
      const adapter = await getDbAdapter();
      const res = await adapter.query(
        `SELECT * FROM fixed_assets WHERE company_id = $1::uuid ORDER BY code`,
        [companyId]
      );
      if (!res.success) return { success: false, error: res.error };
      return { success: true, data: (res.rows || []).map((r) => mapAssetRow(r as Record<string, unknown>)) };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async getFixedAssetById(id: string, companyId: string): Promise<{ success: boolean; data?: FixedAsset; error?: string }> {
    try {
      const v = validateInput(idCompanySchema, { id, companyId });
      if (!v.success) return { success: false, error: v.error };
      const adapter = await getDbAdapter();
      const res = await adapter.query(
        `SELECT * FROM fixed_assets WHERE id = $1::uuid AND company_id = $2::uuid`,
        [id, companyId]
      );
      if (!res.success) return { success: false, error: res.error };
      if (!res.rows?.[0]) return { success: false, error: 'Fixed asset not found' };
      return { success: true, data: mapAssetRow(res.rows[0] as Record<string, unknown>) };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  /**
   * Register an asset AND capitalize it (Dr 12101 / Cr treasury|payables|
   * opening-equity) — ONE atomic batch. The GL cost leg is what depreciation
   * and the balance sheet read; a register without its JE would understate
   * assets and hide capex from cash flow. Assets arriving via purchase
   * invoices live in inventory — transfer them with a manual JE instead.
   */
  async createFixedAsset(
    data: {
      companyId: string;
      code?: string;
      nameAr: string;
      nameEn?: string;
      category?: string;
      purchaseDate: string;
      cost: number;
      salvageValue?: number;
      usefulLifeMonths: number;
      method: DepreciationMethod;
      funding: { kind: 'cash' | 'payable' | 'opening'; cashBoxId?: string };
    },
    userId?: string
  ): Promise<{ success: boolean; id?: string; code?: string; error?: string }> {
    try {
      const v = validateInput(createFixedAssetSchema, data);
      if (!v.success) return { success: false, error: v.error };
      if ((v.data.salvageValue || 0) >= v.data.cost) {
        return { success: false, error: 'Salvage value must be below cost' };
      }
      if (v.data.funding.kind === 'cash' && !v.data.funding.cashBoxId) {
        return { success: false, error: 'Cash box is required for cash-funded acquisition' };
      }
      let code = (v.data.code || '').trim();
      if (!code) {
        const seq = await getNextDocumentNumber(v.data.companyId, 'fixed_asset', userId);
        code = (seq.success && seq.number) || `FA-${Date.now().toString(36).toUpperCase()}`;
      }
      const adapter = await getDbAdapter();
      const { assertAccountingPeriodOpen } = await import('@/modules/accounting/yearEnd');
      const gate = await assertAccountingPeriodOpen(v.data.companyId, v.data.purchaseDate, adapter);
      if (!gate.open) {
        return { success: false, error: `السنة المالية ${gate.period.year} مقفلة — لا يمكن الترحيل بتاريخ داخلها` };
      }
      const cost = round2(v.data.cost);
      const accs = await resolveDepreciationAccounts(v.data.companyId);
      if (!accs.success || !accs.ids) return { success: false, error: accs.error };
      let creditAccount: string | null = null;
      if (v.data.funding.kind === 'cash') {
        creditAccount = await getCashBoxAccountId(v.data.companyId, v.data.funding.cashBoxId || null);
        if (!creditAccount) return { success: false, error: 'Cash box has no GL account' };
      } else if (v.data.funding.kind === 'payable') {
        creditAccount = await getDefaultAccountId(v.data.companyId, 'default_creditors');
        if (!creditAccount) return { success: false, error: 'Creditors account not configured (21101)' };
      } else {
        creditAccount = await getDefaultAccountId(v.data.companyId, 'default_opening_balance');
        if (!creditAccount) return { success: false, error: 'Opening-balance account not configured (31201)' };
      }
      const assetId = crypto.randomUUID();
      const statements: TxStatement[] = [
        buildJournalEntryStatement(v.data.companyId, {
          reference: code,
          description: `رسملة أصل ثابت ${code} — ${v.data.nameAr}`,
          date: v.data.purchaseDate,
          totalAmount: cost,
          entries: [
            { accountId: accs.ids.fixedAssets, debit: cost, credit: 0, memo: `تكلفة ${code}` },
            { accountId: creditAccount, debit: 0, credit: cost, memo: `تمويل ${code}` },
          ],
        }),
        {
          sql: `INSERT INTO fixed_assets (id, company_id, code, name_ar, name_en, category, purchase_date, cost, salvage_value, useful_life_months, method, created_by, updated_by)
                VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::date, $8::numeric, $9::numeric, $10, $11, $12::uuid, $13::uuid)`,
          params: [
            assetId, v.data.companyId, code, v.data.nameAr, v.data.nameEn || null, v.data.category || null,
            v.data.purchaseDate, cost, v.data.salvageValue ?? 0, v.data.usefulLifeMonths,
            v.data.method, safeUserId(userId), safeUserId(userId),
          ],
        },
      ];
      const result = await runTransaction(statements);
      if (!result.success) {
        if (/duplicate|unique|uq_fixed_assets_code/i.test(result.error || '')) {
          return { success: false, error: 'Asset code already exists' };
        }
        return { success: false, error: result.error };
      }
      await logAudit({
        companyId: v.data.companyId,
        userId: safeUserId(userId) || 'system',
        action: 'create',
        tableName: 'fixed_assets',
        recordId: assetId,
        newValues: { code, cost },
      }).catch(() => undefined);
      return { success: true, id: assetId, code };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async updateFixedAsset(
    id: string,
    companyId: string,
    data: { nameAr?: string; nameEn?: string; category?: string; purchaseDate?: string; salvageValue?: number; usefulLifeMonths?: number; method?: DepreciationMethod },
    userId?: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const idv = validateInput(idCompanySchema, { id, companyId });
      if (!idv.success) return { success: false, error: idv.error };
      const v = validateInput(updateFixedAssetSchema, data);
      if (!v.success) return { success: false, error: v.error };
      const adapter = await getDbAdapter();
      const cur = await adapter.query(
        `SELECT status, accumulated_depreciation FROM fixed_assets WHERE id = $1::uuid AND company_id = $2::uuid`,
        [id, companyId]
      );
      if (!cur.success) return { success: false, error: cur.error };
      const row = cur.rows?.[0] as Record<string, unknown> | undefined;
      if (!row) return { success: false, error: 'Fixed asset not found' };
      if (String(row.status) !== 'active') return { success: false, error: 'Disposed assets are terminal' };
      // Anchors (cost, purchase date) are immutable once depreciation posted;
      // life/method/salvage are prospective re-estimates by design.
      if ((Number(row.accumulated_depreciation) || 0) > 0 && v.data.purchaseDate !== undefined) {
        return { success: false, error: 'Purchase date is locked once depreciation is posted' };
      }
      const fields: string[] = [];
      const values: unknown[] = [];
      let idx = 1;
      if (v.data.nameAr !== undefined) { fields.push(`name_ar = $${idx++}`); values.push(v.data.nameAr); }
      if (v.data.nameEn !== undefined) { fields.push(`name_en = $${idx++}`); values.push(v.data.nameEn || null); }
      if (v.data.category !== undefined) { fields.push(`category = $${idx++}`); values.push(v.data.category || null); }
      if (v.data.purchaseDate !== undefined) { fields.push(`purchase_date = $${idx++}::date`); values.push(v.data.purchaseDate); }
      if (v.data.salvageValue !== undefined) { fields.push(`salvage_value = $${idx++}::numeric`); values.push(v.data.salvageValue); }
      if (v.data.usefulLifeMonths !== undefined) { fields.push(`useful_life_months = $${idx++}`); values.push(v.data.usefulLifeMonths); }
      if (v.data.method !== undefined) { fields.push(`method = $${idx++}`); values.push(v.data.method); }
      if (!fields.length) return { success: true };
      fields.push(`updated_at = NOW()`);
      fields.push(`updated_by = $${idx++}::uuid`); values.push(safeUserId(userId));
      values.push(id, companyId);
      const res = await adapter.query(
        `UPDATE fixed_assets SET ${fields.join(', ')} WHERE id = $${idx++}::uuid AND company_id = $${idx++}::uuid`,
        values
      );
      if (!res.success) return { success: false, error: res.error };
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async deleteFixedAsset(id: string, companyId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const idv = validateInput(idCompanySchema, { id, companyId });
      if (!idv.success) return { success: false, error: idv.error };
      const adapter = await getDbAdapter();
      const cur = await adapter.query(
        `SELECT status, accumulated_depreciation FROM fixed_assets WHERE id = $1::uuid AND company_id = $2::uuid`,
        [id, companyId]
      );
      if (!cur.success) return { success: false, error: cur.error };
      const row = cur.rows?.[0] as Record<string, unknown> | undefined;
      if (!row) return { success: false, error: 'Fixed asset not found' };
      if (String(row.status) !== 'active' || (Number(row.accumulated_depreciation) || 0) > 0) {
        return { success: false, error: 'Only never-depreciated active assets can be deleted — dispose the rest' };
      }
      const res = await adapter.query(
        `DELETE FROM fixed_assets WHERE id = $1::uuid AND company_id = $2::uuid`,
        [id, companyId]
      );
      if (!res.success) return { success: false, error: res.error };
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  /**
   * Monthly depreciation run: per-asset JEs (Dr 52601 / Cr 12102,
   * reference DEP-YYYY-MM-<code>) + accumulated bumps — ONE transaction.
   * Idempotent per asset-month (existing reference skips). Refuses future
   * months and closed fiscal years.
   */
  async runDepreciation(
    companyId: string,
    year: number,
    month: number,
    userId?: string
  ): Promise<{ success: boolean; data?: { posted: number; skipped: number; total: number }; error?: string }> {
    try {
      const v = validateInput(depreciationRunSchema, { companyId, year, month });
      if (!v.success) return { success: false, error: v.error };
      const lastDay = new Date(year, month, 0);
      const asOf = `${lastDay.getFullYear()}-${String(lastDay.getMonth() + 1).padStart(2, '0')}-${String(lastDay.getDate()).padStart(2, '0')}`;
      if (asOf > todayStr()) return { success: false, error: 'Cannot depreciate a future month' };
      // Target as of the 1st of NEXT month: with floor month-counting this
      // credits the run month itself exactly once (Jan purchase + Jan run =
      // 1 month), while a mid-month purchase never over-accrues. The JE is
      // still dated the month-end above.
      const nextMonth = new Date(year, month, 1);
      const targetAsOf = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}-01`;
      const adapter = await getDbAdapter();
      const { assertAccountingPeriodOpen } = await import('@/modules/accounting/yearEnd');
      const gate = await assertAccountingPeriodOpen(companyId, asOf, adapter);
      if (!gate.open) {
        return { success: false, error: `السنة المالية ${gate.period.year} مقفلة — لا يمكن الترحيل بتاريخ داخلها` };
      }
      const accs = await resolveDepreciationAccounts(companyId);
      if (!accs.success || !accs.ids) return { success: false, error: accs.error };
      const list = await adapter.query(
        `SELECT * FROM fixed_assets WHERE company_id = $1::uuid AND status = 'active' AND purchase_date <= $2::date ORDER BY code`,
        [companyId, asOf]
      );
      if (!list.success) return { success: false, error: list.error };
      const statements: TxStatement[] = [];
      let posted = 0;
      let skipped = 0;
      let total = 0;
      const refOf = (code: string) => `DEP-${year}-${String(month).padStart(2, '0')}-${code}`;
      for (const r of (list.rows || []) as Record<string, unknown>[]) {
        const asset = mapAssetRow(r);
        const amount = periodDepreciation(asset, targetAsOf);
        if (amount < 0.005) { skipped++; continue; }
        const ref = refOf(asset.code);
        const dup = await adapter.query(
          `SELECT id FROM transactions WHERE company_id = $1::uuid AND reference = $2 LIMIT 1`,
          [companyId, ref]
        );
        if (!dup.success) return { success: false, error: dup.error };
        if (dup.rows?.length) { skipped++; continue; }
        statements.push(
          buildJournalEntryStatement(companyId, {
            reference: ref,
            description: `إهلاك ${asset.nameAr} — ${year}/${String(month).padStart(2, '0')}`,
            date: asOf,
            totalAmount: amount,
            entries: [
              { accountId: accs.ids.expense, debit: amount, credit: 0, memo: `إهلاك ${asset.code}` },
              { accountId: accs.ids.accumulated, debit: 0, credit: amount, memo: `مجمع إهلاك ${asset.code}` },
            ],
          })
        );
        statements.push({
          sql: `UPDATE fixed_assets SET accumulated_depreciation = COALESCE(accumulated_depreciation, 0) + $1::numeric, updated_by = $4::uuid, updated_at = NOW()
                WHERE id = $2::uuid AND company_id = $3::uuid AND status = 'active'`,
          params: [amount, asset.id, companyId, safeUserId(userId)],
        });
        posted++;
        total = round2(total + amount);
      }
      if (!statements.length) return { success: true, data: { posted: 0, skipped, total: 0 } };
      const result = await runTransaction(statements);
      if (!result.success) return { success: false, error: result.error };
      await logAudit({
        companyId,
        userId: safeUserId(userId) || 'system',
        action: 'post',
        tableName: 'fixed_assets',
        recordId: `${year}-${String(month).padStart(2, '0')}`,
        newValues: { posted, skipped, total },
      }).catch(() => undefined);
      return { success: true, data: { posted, skipped, total } };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  /**
   * Dispose an active asset: clear cost + accumulated, book proceeds to the
   * cash box, plug gain/loss — ONE atomic JE + terminal flip.
   * Gain → Cr 41901 (misc gains live there); loss → Dr 52301 misc expenses.
   */
  async disposeFixedAsset(
    companyId: string,
    id: string,
    input: { date?: string; proceeds?: number; cashBoxId?: string; reason: string },
    userId?: string
  ): Promise<{ success: boolean; data?: { reference: string; gain: number; loss: number }; error?: string }> {
    try {
      const v = validateInput(disposeFixedAssetSchema, { companyId, id, ...input });
      if (!v.success) return { success: false, error: v.error };
      const date = v.data.date || todayStr();
      const proceeds = round2(Number(v.data.proceeds) || 0);
      if (proceeds > 0 && !v.data.cashBoxId) {
        return { success: false, error: 'Cash box is required when disposal has proceeds' };
      }
      const adapter = await getDbAdapter();
      const cur = await adapter.query(
        `SELECT * FROM fixed_assets WHERE id = $1::uuid AND company_id = $2::uuid`,
        [id, companyId]
      );
      if (!cur.success) return { success: false, error: cur.error };
      const row = cur.rows?.[0] as Record<string, unknown> | undefined;
      if (!row) return { success: false, error: 'Fixed asset not found' };
      const asset = mapAssetRow(row);
      if (asset.status !== 'active') return { success: false, error: 'Asset already disposed' };
      const { assertAccountingPeriodOpen } = await import('@/modules/accounting/yearEnd');
      const gate = await assertAccountingPeriodOpen(companyId, date, adapter);
      if (!gate.open) {
        return { success: false, error: `السنة المالية ${gate.period.year} مقفلة — لا يمكن الترحيل بتاريخ داخلها` };
      }
      const nbv = round2(asset.cost - asset.accumulatedDepreciation);
      const diff = round2(proceeds - nbv);
      const gain = diff > 0 ? diff : 0;
      const loss = diff < 0 ? Math.abs(diff) : 0;
      const accs = await resolveDepreciationAccounts(companyId);
      if (!accs.success || !accs.ids) return { success: false, error: accs.error };
      let cashAcc: string | null = null;
      if (proceeds > 0) {
        cashAcc = await getCashBoxAccountId(companyId, v.data.cashBoxId || null);
        if (!cashAcc) return { success: false, error: 'Cash box has no GL account' };
      }
      const misc = await getDefaultAccountId(companyId, 'default_misc_expense');
      const surplus = await getDefaultAccountId(companyId, 'default_inventory_surplus');
      if (loss > 0 && !misc) return { success: false, error: 'Misc-expense account not configured (52301)' };
      if (gain > 0 && !surplus) return { success: false, error: 'Gains account not configured (41901)' };
      const reference = `DSP-${asset.code}`;
      const dup = await adapter.query(
        `SELECT id FROM transactions WHERE company_id = $1::uuid AND reference = $2 LIMIT 1`,
        [companyId, reference]
      );
      if (!dup.success) return { success: false, error: dup.error };
      if (dup.rows?.length) return { success: false, error: 'Asset already disposed' };
      const entries: Array<{ accountId: string; debit: number; credit: number; memo: string }> = [
        { accountId: accs.ids.accumulated, debit: asset.accumulatedDepreciation, credit: 0, memo: `تصفية مجمع إهلاك ${asset.code}` },
      ];
      if (proceeds > 0 && cashAcc) {
        entries.push({ accountId: cashAcc, debit: proceeds, credit: 0, memo: `متحصلات استبعاد ${asset.code}` });
      }
      if (loss > 0 && misc) {
        entries.push({ accountId: misc, debit: loss, credit: 0, memo: `خسائر استبعاد أصل — ${v.data.reason}` });
      }
      entries.push({ accountId: accs.ids.fixedAssets, debit: 0, credit: asset.cost, memo: `استبعاد تكلفة ${asset.code}` });
      if (gain > 0 && surplus) {
        entries.push({ accountId: surplus, debit: 0, credit: gain, memo: `أرباح استبعاد أصل — ${v.data.reason}` });
      }
      const dr = round2(entries.reduce((s, e) => s + e.debit, 0));
      const cr = round2(entries.reduce((s, e) => s + e.credit, 0));
      if (Math.abs(dr - cr) > 0.01) return { success: false, error: 'Disposal entry out of balance' };
      const statements: TxStatement[] = [
        buildJournalEntryStatement(companyId, {
          reference,
          description: `استبعاد أصل ثابت ${asset.code} — ${v.data.reason}`,
          date,
          totalAmount: dr,
          entries: entries.map((e) => ({ ...e, memo: e.memo })),
        }),
        {
          sql: `UPDATE fixed_assets SET status = 'disposed', disposed_at = $3::date, updated_by = $4::uuid, updated_at = NOW()
                WHERE id = $1::uuid AND company_id = $2::uuid AND status = 'active' RETURNING id`,
          params: [id, companyId, date, safeUserId(userId)],
        },
      ];
      const result = await runTransaction(statements);
      if (!result.success) return { success: false, error: result.error };
      await logAudit({
        companyId,
        userId: safeUserId(userId) || 'system',
        action: 'post',
        tableName: 'fixed_assets',
        recordId: id,
        newValues: { reference, gain, loss },
      }).catch(() => undefined);
      return { success: true, data: { reference, gain, loss } };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },
};

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
