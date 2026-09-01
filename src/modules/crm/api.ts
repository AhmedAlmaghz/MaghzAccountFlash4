import { getDbAdapter, isElectronPg } from '@/core/database/adapters';
import {
  validateInput,
  idCompanySchema,
  companyIdSchema,
  createLeadSchema,
  updateLeadSchema,
  createOpportunitySchema,
  updateOpportunitySchema,
  createTaskSchema,
  updateTaskSchema,
  createActivitySchema,
  updateActivitySchema,
} from '@/core/utils/validation';
import { clampPageArgs, paginatedResult, type PaginatedQueryResult } from '@/core/utils/pagination';
import { toDateString } from '@/core/utils/mapPgRow';
import { getNextDocumentNumber } from '@/core/api';
import { logAudit } from '@/core/utils/auditLogger';
import { normalizeArabic } from '@/core/utils/normalizeArabic';
import { useAuthStore } from '@/modules/auth/store';
import type {
  Lead,
  Opportunity,
  Task,
  Activity,
  ConvertLeadOptions,
  OpportunityStage,
} from './types';
import { isValidStageTransition, stageTransitionError } from './types';

// Typed RPC bridge for CRM (Phase 4 slice 7). In Electron the renderer sends
// a structured payload and the main process derives `company_id` + audit
// `user_id` from the authenticated session — the renderer can never touch
// another company's rows. The fallback path (PGlite / e2e) still uses
// `adapter.query` with explicit `company_id = $N` filters.
type RpcEnvelope = { success: boolean; rows?: Record<string, unknown>[]; error?: string };

async function invokeCrmRpc(method: string, payload: Record<string, unknown> = {}): Promise<RpcEnvelope> {
  const crm = (typeof window !== 'undefined' && window.electronDB?.crm) as
    | Record<string, ((p: Record<string, unknown>) => Promise<RpcEnvelope>) | undefined>
    | undefined;
  const fn = crm?.[method];
  if (!fn) return { success: false, error: 'RPC unavailable' };
  try {
    // `call(crm, ...)` preserves the surface object as `this` so the e2e
    // shim handlers (which call `this._cid()`) resolve the company id.
    return await fn.call(crm, payload);
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function firstId(rows?: Record<string, unknown>[]): string | undefined {
  const first = rows && rows.length > 0 ? rows[0] : undefined;
  return first && 'id' in first && first.id != null ? String(first.id) : undefined;
}

/**
 * Best-effort audit identity for the API layer. The Electron RPC path derives
 * user/company from the session inside the main process, so this is only used
 * by the fallback (PGlite / e2e) audit trail.
 */
function auditContext(): { userId: string; username?: string } {
  const user = useAuthStore.getState().user;
  return { userId: user?.id || 'system', username: user?.username };
}

/** Fire-and-forget audit — never blocks the business operation. */
function audit(
  action: 'create' | 'update' | 'delete' | 'convert',
  tableName: string,
  recordId: string,
  companyId: string,
  recordLabel?: string,
  newValues?: Record<string, unknown>,
): void {
  const ctx = auditContext();
  void logAudit({
    userId: ctx.userId,
    username: ctx.username,
    action: action === 'convert' ? 'update' : action,
    tableName,
    recordId,
    recordLabel,
    newValues: newValues ? { action, ...newValues } : { action },
    companyId,
  });
}

// ─── Duplicate guard (API layer — single source of truth) ────────────────────

/**
 * Exact-duplicate guard for leads: normalized name OR phone already exists in
 * the company. The UI additionally warns on near matches; the API hard-blocks
 * exact ones so the AI agent (and any future caller) inherits the protection.
 */
async function findExactLeadDuplicate(
  companyId: string,
  name: string,
  phone?: string,
): Promise<{ id: string; name: string } | null> {
  const adapter = await getDbAdapter();
  const result = await adapter.query<{ id: string; name: string }>(
    `SELECT id, name FROM leads
      WHERE company_id = $1::uuid
        AND (LOWER(name) = LOWER($2) OR ($3::text IS NOT NULL AND phone = $3))
        AND status <> 'converted'
      LIMIT 1`,
    [companyId, normalizeArabic(name), phone || null]
  );
  const row = result.rows?.[0];
  return row ? { id: String(row.id), name: String(row.name) } : null;
}

export const crmApi = {
  // ─── Leads ────────────────────────────────────────────────────────────────
  async getLeads(companyId: string): Promise<{ success: boolean; data?: Lead[]; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      if (isElectronPg()) {
        const result = await invokeCrmRpc('getLeads');
        return result.success
          ? { success: true, data: (result.rows || []).map(mapLeadRow) }
          : { success: false, error: result.error };
      }
      const adapter = await getDbAdapter();
      const result = await adapter.query<Record<string, unknown>>(
        `SELECT l.*, u.full_name as assigned_name FROM leads l LEFT JOIN users u ON l.assigned_to = u.id WHERE l.company_id = $1::uuid ORDER BY l.created_at DESC`,
        [companyId]
      );
      if (result.success) {
        const rows = (result.rows || []).map((r) => mapLeadRow(r));
        return { success: true, data: rows };
      }
      return { success: false, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async getLeadsPaginated(
    companyId: string,
    page: number,
    pageSize: number,
    filters?: { status?: string; assignedTo?: string; search?: string }
  ): Promise<PaginatedQueryResult<Lead>> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      const { page: p, pageSize: ps, offset } = clampPageArgs(page, pageSize);
      if (isElectronPg()) {
        const result = await invokeCrmRpc('getLeadsPaginated', {
          page: p,
          pageSize: ps,
          status: filters?.status || null,
          assignedTo: filters?.assignedTo || null,
          search: filters?.search || null,
        });
        if (!result.success) return { success: false, error: result.error };
        const items = (result.rows || []).map((r) => mapLeadRow(r));
        const total = items.length > 0 && 'total_count' in (result.rows || [])[0]
          ? Number((result.rows || [])[0].total_count)
          : 0;
        return { success: true, data: paginatedResult(items, total, p, ps) };
      }
      const adapter = await getDbAdapter();

      const conditions: string[] = ['l.company_id = $1'];
      const params: unknown[] = [companyId];
      if (filters?.status) {
        params.push(filters.status);
        conditions.push(`l.status = $${params.length}`);
      }
      if (filters?.assignedTo) {
        params.push(filters.assignedTo);
        conditions.push(`l.assigned_to = $${params.length}`);
      }
      if (filters?.search) {
        params.push(`%${filters.search}%`);
        conditions.push(`(l.name ILIKE $${params.length} OR l.email ILIKE $${params.length} OR l.phone ILIKE $${params.length})`);
      }
      const where = conditions.join(' AND ');

      const countResult = await adapter.query(
        `SELECT COUNT(*)::int AS total FROM leads l WHERE ${where}`,
        params
      );
      const total = Number(countResult.rows?.[0]?.total || 0);

      const dataParams = [...params, ps, offset];
      const limitIdx = dataParams.length - 1;
      const offsetIdx = dataParams.length;

      const dataResult = await adapter.query(
        `SELECT l.*, u.full_name as assigned_name
         FROM leads l LEFT JOIN users u ON l.assigned_to = u.id
         WHERE ${where}
         ORDER BY l.created_at DESC
         LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        dataParams
      );
      if (!dataResult.success) return { success: false, error: dataResult.error };

      const items = (dataResult.rows || []).map((r) => mapLeadRow(r as Record<string, unknown>));
      return { success: true, data: paginatedResult(items, total, p, ps) };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async getLeadById(id: string, companyId: string): Promise<{ success: boolean; data?: Lead; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      if (isElectronPg()) {
        const result = await invokeCrmRpc('getLeadById', { id });
        if (result.success && result.rows?.length) return { success: true, data: mapLeadRow(result.rows[0]) };
        return { success: false, error: result.error || 'Not found' };
      }
      const adapter = await getDbAdapter();
      const result = await adapter.query<Record<string, unknown>>(
        'SELECT * FROM leads WHERE id = $1::uuid AND company_id = $2::uuid LIMIT 1',
        [id, companyId]
      );
      if (result.success && result.rows?.[0]) return { success: true, data: mapLeadRow(result.rows[0]) };
      return { success: false, error: result.error || 'Not found' };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async createLead(
    data: Omit<Lead, 'id' | 'createdAt'>,
    _userId?: string,
    options?: { allowDuplicate?: boolean }
  ): Promise<{ success: boolean; id?: string; error?: string; duplicate?: { id: string; name: string } }> {
    try {
      const validation = validateInput(createLeadSchema, data);
      if (!validation.success) return { success: false, error: validation.error };

      // Exact-duplicate guard (API layer) — normalized name or phone already
      // exists as a non-converted lead. The UI warns on near matches; the API
      // blocks exact ones so the AI agent inherits the same protection.
      if (!options?.allowDuplicate) {
        const dup = await findExactLeadDuplicate(data.companyId, data.name, data.phone);
        if (dup) {
          return {
            success: false,
            error: `يوجد عميل محتمل بنفس الاسم أو الهاتف: "${dup.name}" — لا يمكن إنشاء نسخة مكررة.`,
            duplicate: dup,
          };
        }
      }

      if (isElectronPg()) {
        const result = await invokeCrmRpc('createLead', {
          name: data.name,
          phone: data.phone || null,
          email: data.email || null,
          company: data.company || null,
          source: data.source || null,
          status: data.status,
          rating: data.rating,
          estimatedValue: data.estimatedValue ?? null,
          assignedTo: data.assignedTo || null,
          notes: data.notes || null,
        });
        if (result.success) {
          const newId = firstId(result.rows);
          if (newId) audit('create', 'leads', newId, data.companyId, data.name, { name: data.name, phone: data.phone });
          return { success: true, id: newId };
        }
        return { success: false, error: result.error };
      }
      const { safeUserId } = await import('@/core/utils/userIdValidator');
      const adapter = await getDbAdapter();
      const result = await adapter.query<{ id: string }>(
        `INSERT INTO leads (company_id, name, phone, email, company, source, status, rating, estimated_value, assigned_to, notes, created_at, created_by, updated_by) VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10::uuid,$11,$12,$13::uuid,$14::uuid) RETURNING id`,
        [data.companyId, data.name, data.phone || null, data.email || null, data.company || null, data.source || null, data.status, data.rating, data.estimatedValue || null, data.assignedTo || null, data.notes || null, new Date().toISOString(), safeUserId(_userId), safeUserId(_userId)]
      );
      if (result.success && result.rows?.[0]) {
        audit('create', 'leads', result.rows[0].id, data.companyId, data.name, { name: data.name, phone: data.phone });
        return { success: true, id: result.rows[0].id };
      }
      return { success: false, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async updateLead(id: string, companyId: string, data: Partial<Omit<Lead, 'id' | 'companyId'>>, _userId?: string): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      const dataValidation = validateInput(updateLeadSchema, data);
      if (!dataValidation.success) return { success: false, error: dataValidation.error };
      if (isElectronPg()) {
        const payload: Record<string, unknown> = { id };
        for (const key of ['name', 'phone', 'email', 'company', 'source', 'status', 'rating', 'estimatedValue', 'assignedTo', 'notes'] as const) {
          if (data[key] !== undefined) payload[key] = data[key];
        }
        const result = await invokeCrmRpc('updateLead', payload);
        if (result.success) audit('update', 'leads', id, companyId, data.name || id);
        return { success: result.success, error: result.error };
      }
      const { safeUserId } = await import('@/core/utils/userIdValidator');
      const adapter = await getDbAdapter();
      const fields: string[] = [];
      const values: unknown[] = [];
      let idx = 1;
      if (data.name !== undefined) { fields.push(`name = $${idx++}`); values.push(data.name); }
      if (data.phone !== undefined) { fields.push(`phone = $${idx++}`); values.push(data.phone); }
      if (data.email !== undefined) { fields.push(`email = $${idx++}`); values.push(data.email); }
      if (data.company !== undefined) { fields.push(`company = $${idx++}`); values.push(data.company); }
      if (data.source !== undefined) { fields.push(`source = $${idx++}`); values.push(data.source); }
      if (data.status !== undefined) { fields.push(`status = $${idx++}`); values.push(data.status); }
      if (data.rating !== undefined) { fields.push(`rating = $${idx++}`); values.push(data.rating); }
      if (data.estimatedValue !== undefined) { fields.push(`estimated_value = $${idx++}`); values.push(data.estimatedValue); }
      if (data.assignedTo !== undefined) { fields.push(`assigned_to = $${idx++}`); values.push(data.assignedTo); }
      if (data.notes !== undefined) { fields.push(`notes = $${idx++}`); values.push(data.notes); }
      if (fields.length === 0) return { success: true };
      // `updated_by` is ALWAYS stamped — parity with the RPC path (Phase A2).
      fields.push(`updated_by = $${idx++}::uuid`);
      values.push(safeUserId(_userId));
      fields.push('updated_at = NOW()');
      values.push(id);
      values.push(companyId);
      const result = await adapter.query(`UPDATE leads SET ${fields.join(', ')} WHERE id = $${idx}::uuid AND company_id = $${idx + 1}::uuid`, values);
      if (result.success) audit('update', 'leads', id, companyId, data.name || id);
      return { success: result.success, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  /**
   * Delete a lead — protected: rejects when the lead still has opportunities,
   * tasks or activities referencing it. Deleting the references first (or
   * letting the FKs sever them via SET NULL) is the caller's choice; this
   * guard prevents accidental history loss from the UI/AI.
   */
  async deleteLead(id: string, companyId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      if (isElectronPg()) {
        const result = await invokeCrmRpc('deleteLead', { id });
        if (result.success) audit('delete', 'leads', id, companyId);
        return { success: result.success, error: result.error };
      }
      const adapter = await getDbAdapter();
      const refCheck = await adapter.query<{ opps: number; tasks: number; acts: number }>(
        `SELECT
           (SELECT COUNT(*)::int FROM opportunities WHERE lead_id = $1::uuid AND company_id = $2::uuid) AS opps,
           (SELECT COUNT(*)::int FROM tasks WHERE lead_id = $1::uuid AND company_id = $2::uuid) AS tasks,
           (SELECT COUNT(*)::int FROM activities WHERE lead_id = $1::uuid AND company_id = $2::uuid) AS acts`,
        [id, companyId]
      );
      const refs = refCheck.rows?.[0];
      if (refs && (Number(refs.opps) > 0 || Number(refs.tasks) > 0 || Number(refs.acts) > 0)) {
        return {
          success: false,
          error: `لا يمكن حذف العميل المحتمل: لديه ${refs.opps} فرصة و ${refs.tasks} مهمة و ${refs.acts} نشاط مرتبطة. احذف المراجع أولاً.`,
        };
      }
      const result = await adapter.query('DELETE FROM leads WHERE id = $1::uuid AND company_id = $2::uuid', [id, companyId]);
      if (result.success) audit('delete', 'leads', id, companyId);
      return { success: result.success, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  /**
   * Convert a lead to a customer — ONE atomic CTE in every execution path.
   * The customer code comes from document_sequences (single generation
   * mechanism shared by UI, AI, and every caller). Optionally creates a
   * first opportunity for the new customer in the SAME statement.
   */
  async convertLeadToCustomer(
    id: string,
    companyId: string,
    options: ConvertLeadOptions = {},
    _userId?: string
  ): Promise<{ success: boolean; id?: string; code?: string; opportunityId?: string; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };

      // Unified code generation — document_sequences is the single source for
      // customer codes across UI and AI (Phase A4).
      let code = options.code?.trim() || null;
      if (!code) {
        const seq = await getNextDocumentNumber(companyId, 'customer');
        if (!seq.success || !seq.number) return { success: false, error: seq.error || 'تعذر توليد كود العميل' };
        code = seq.number;
      }

      // Pre-flight: load the lead (also validates existence + non-converted).
      const leadInfo = await this.getLeadById(id, companyId);
      if (!leadInfo.success || !leadInfo.data) return { success: false, error: leadInfo.error || 'العميل المحتمل غير موجود' };
      const lead = leadInfo.data;
      if (lead.status === 'converted') {
        return { success: false, error: 'هذا العميل المحتمل محوَّل بالفعل إلى عميل.' };
      }

      const phone = options.phone || lead.phone || null;
      const email = options.email || lead.email || null;
      const createOpportunity = options.createOpportunity === true;

      if (isElectronPg()) {
        const result = await invokeCrmRpc('convertLeadToCustomer', {
          id,
          name: lead.name,
          phone,
          email,
          customerCode: code,
          address: options.address || null,
          taxNumber: options.taxNumber || null,
          creditLimit: options.creditLimit ?? 0,
          createOpportunity,
        });
        if (result.success) {
          const customerId = firstId(result.rows);
          const row = result.rows?.[0] || {};
          const opportunityId = row.opportunity_id != null ? String(row.opportunity_id) : undefined;
          audit('convert', 'leads', id, companyId, lead.name, { customerId, customerCode: code, opportunityId });
          return { success: true, id: customerId, code, opportunityId };
        }
        return { success: false, error: result.error };
      }

      const { safeUserId } = await import('@/core/utils/userIdValidator');
      const adapter = await getDbAdapter();
      // Single atomic statement: customer INSERT + lead status UPDATE +
      // (optional) first opportunity INSERT — all or nothing.
      const result = await adapter.query(
        `WITH lead_check AS (
            SELECT id, name, phone, email, estimated_value, assigned_to
              FROM leads
             WHERE id = $1::uuid AND company_id = $2::uuid AND status <> 'converted'
             LIMIT 1
         ),
         new_customer AS (
            INSERT INTO customers (company_id, code, name, phone, email, address, tax_number, credit_limit, balance, is_active, created_by, updated_by)
            SELECT $2::uuid, $3, $4, $5, $6, $7, $8, $9, 0, true, $10::uuid, $10::uuid
              FROM lead_check
            RETURNING id
         ),
         updated_lead AS (
            UPDATE leads SET status = 'converted', updated_by = $10::uuid, updated_at = NOW()
             WHERE id = $1::uuid AND company_id = $2::uuid
               AND EXISTS (SELECT 1 FROM lead_check)
            RETURNING id
         ),
         new_opportunity AS (
            INSERT INTO opportunities (company_id, lead_id, customer_id, name, value, stage, probability, assigned_to, created_at, created_by, updated_by)
            SELECT $2::uuid, $1::uuid, nc.id,
                   'فرصة ' || lc.name,
                   COALESCE(lc.estimated_value, 0),
                   'new', 50, lc.assigned_to, NOW(), $10::uuid, $10::uuid
              FROM lead_check lc CROSS JOIN new_customer nc
             WHERE $11::boolean
            RETURNING id
         )
         SELECT nc.id, (SELECT id FROM new_opportunity) AS opportunity_id
           FROM new_customer nc, updated_lead`,
        [
          id,
          companyId,
          code,
          lead.name,
          phone,
          email,
          options.address || null,
          options.taxNumber || null,
          options.creditLimit ?? 0,
          safeUserId(_userId),
          createOpportunity,
        ]
      );
      if (result.success && result.rows?.[0]) {
        const customerId = String(result.rows[0].id);
        const opportunityId = result.rows[0].opportunity_id != null ? String(result.rows[0].opportunity_id) : undefined;
        audit('convert', 'leads', id, companyId, lead.name, { customerId, customerCode: code, opportunityId });
        return { success: true, id: customerId, code, opportunityId };
      }
      return { success: false, error: result.error || 'تعذر تحويل العميل المحتمل — قد يكون محوَّلاً بالفعل.' };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  // ─── Opportunities ────────────────────────────────────────────────────────
  async getOpportunities(companyId: string): Promise<{ success: boolean; data?: Opportunity[]; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      if (isElectronPg()) {
        const result = await invokeCrmRpc('getOpportunities');
        return result.success
          ? { success: true, data: (result.rows || []).map(mapOpportunityRow) }
          : { success: false, error: result.error };
      }
      const adapter = await getDbAdapter();
      const result = await adapter.query(
        `SELECT o.*, u.full_name as assigned_name FROM opportunities o LEFT JOIN users u ON o.assigned_to = u.id WHERE o.company_id = $1::uuid ORDER BY o.created_at DESC`,
        [companyId]
      );
      if (result.success) {
        const rows = (result.rows || []).map((r: Record<string, unknown>) => mapOpportunityRow(r));
        return { success: true, data: rows };
      }
      return { success: false, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async getOpportunitiesPaginated(
    companyId: string,
    page: number,
    pageSize: number,
    filters?: { stage?: string; assignedTo?: string; search?: string }
  ): Promise<PaginatedQueryResult<Opportunity>> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      const { page: p, pageSize: ps, offset } = clampPageArgs(page, pageSize);
      if (isElectronPg()) {
        const result = await invokeCrmRpc('getOpportunitiesPaginated', {
          page: p,
          pageSize: ps,
          stage: filters?.stage || null,
          assignedTo: filters?.assignedTo || null,
          search: filters?.search || null,
        });
        if (!result.success) return { success: false, error: result.error };
        const items = (result.rows || []).map(mapOpportunityRow);
        const total = items.length > 0 && 'total_count' in (result.rows || [])[0]
          ? Number((result.rows || [])[0].total_count)
          : 0;
        return { success: true, data: paginatedResult(items, total, p, ps) };
      }
      const adapter = await getDbAdapter();

      const conditions: string[] = ['o.company_id = $1'];
      const params: unknown[] = [companyId];
      if (filters?.stage) {
        params.push(filters.stage);
        conditions.push(`o.stage = $${params.length}`);
      }
      if (filters?.assignedTo) {
        params.push(filters.assignedTo);
        conditions.push(`o.assigned_to = $${params.length}`);
      }
      if (filters?.search) {
        params.push(`%${filters.search}%`);
        conditions.push(`o.name ILIKE $${params.length}`);
      }
      const where = conditions.join(' AND ');

      const countResult = await adapter.query(
        `SELECT COUNT(*)::int AS total FROM opportunities o WHERE ${where}`,
        params
      );
      const total = Number(countResult.rows?.[0]?.total || 0);

      const dataParams = [...params, ps, offset];
      const limitIdx = dataParams.length - 1;
      const offsetIdx = dataParams.length;

      const dataResult = await adapter.query(
        `SELECT o.*, u.full_name as assigned_name
         FROM opportunities o LEFT JOIN users u ON o.assigned_to = u.id
         WHERE ${where}
         ORDER BY o.created_at DESC
         LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        dataParams
      );
      if (!dataResult.success) return { success: false, error: dataResult.error };

      const items = (dataResult.rows || []).map((r: Record<string, unknown>) => mapOpportunityRow(r));
      return { success: true, data: paginatedResult(items, total, p, ps) };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async createOpportunity(data: Omit<Opportunity, 'id' | 'createdAt'>, _userId?: string): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      const validation = validateInput(createOpportunitySchema, data);
      if (!validation.success) return { success: false, error: validation.error };
      if (isElectronPg()) {
        const result = await invokeCrmRpc('createOpportunity', {
          name: data.name,
          leadId: data.leadId || null,
          customerId: data.customerId || null,
          value: data.value,
          stage: data.stage,
          probability: data.probability ?? null,
          expectedCloseDate: data.expectedCloseDate || null,
          assignedTo: data.assignedTo || null,
          notes: data.notes || null,
        });
        if (result.success) {
          const newId = firstId(result.rows);
          if (newId) audit('create', 'opportunities', newId, data.companyId, data.name, { value: data.value });
          return { success: true, id: newId };
        }
        return { success: false, error: result.error };
      }
      const { safeUserId } = await import('@/core/utils/userIdValidator');
      const adapter = await getDbAdapter();
      const result = await adapter.query(
        `INSERT INTO opportunities (company_id, lead_id, customer_id, name, value, stage, probability, expected_close_date, assigned_to, notes, created_at, created_by, updated_by) VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,$9::uuid,$10,$11,$12::uuid,$13::uuid) RETURNING id`,
        [data.companyId, data.leadId || null, data.customerId || null, data.name, data.value, data.stage, data.probability ?? null, data.expectedCloseDate || null, data.assignedTo || null, data.notes || null, new Date().toISOString(), safeUserId(_userId), safeUserId(_userId)]
      );
      if (result.success && result.rows?.[0]) {
        audit('create', 'opportunities', result.rows[0].id, data.companyId, data.name, { value: data.value });
        return { success: true, id: result.rows[0].id };
      }
      return { success: false, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  /**
   * Update an opportunity — the stage machine guard lives HERE (API layer).
   * Forward-only among open stages; won/lost are terminal; reaching won/lost
   * stamps close_date and auto-sets probability to 100/0.
   */
  async updateOpportunity(
    id: string,
    companyId: string,
    data: Partial<Omit<Opportunity, 'id' | 'companyId'>>,
    _userId?: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      const dataValidation = validateInput(updateOpportunitySchema, data);
      if (!dataValidation.success) return { success: false, error: dataValidation.error };

      // Load current state for the stage-machine guard (all 3 paths enforce
      // the same rule — the API is the single source of truth).
      const current = await this.getOpportunityById(id, companyId);
      if (!current.success || !current.data) return { success: false, error: current.error || 'الفرصة غير موجودة' };
      const currentStage = current.data.stage;

      if (data.stage !== undefined && data.stage !== currentStage) {
        if (!isValidStageTransition(currentStage, data.stage)) {
          return { success: false, error: stageTransitionError(currentStage, data.stage) };
        }
      }

      // Auto-stamp close_date + probability on reaching a final stage.
      let effectiveProbability = data.probability;
      if (data.stage === 'won') effectiveProbability = 100;
      if (data.stage === 'lost') effectiveProbability = 0;

      if (isElectronPg()) {
        const payload: Record<string, unknown> = { id };
        for (const key of ['name', 'value', 'stage', 'probability', 'expectedCloseDate', 'leadId', 'customerId', 'assignedTo', 'notes'] as const) {
          if (key === 'probability' && effectiveProbability !== undefined) { payload[key] = effectiveProbability; continue; }
          if (data[key] !== undefined) payload[key] = data[key];
        }
        const result = await invokeCrmRpc('updateOpportunity', payload);
        if (result.success) audit('update', 'opportunities', id, companyId, data.name || current.data.name, { stage: data.stage });
        return { success: result.success, error: result.error };
      }
      const { safeUserId } = await import('@/core/utils/userIdValidator');
      const adapter = await getDbAdapter();
      const fields: string[] = [];
      const values: unknown[] = [];
      let idx = 1;
      if (data.name !== undefined) { fields.push(`name = $${idx++}`); values.push(data.name); }
      if (data.value !== undefined) { fields.push(`value = $${idx++}`); values.push(data.value); }
      if (data.stage !== undefined) {
        fields.push(`stage = $${idx++}`);
        values.push(data.stage);
        if (data.stage === 'won' || data.stage === 'lost') {
          // The final transition stamps close_date (idempotent — re-entering
          // the same final stage does not re-stamp; transition guard already
          // blocks changing it afterwards).
          fields.push('close_date = CURRENT_DATE');
          if (data.stage === 'won') { fields.push(`probability = $${idx++}`); values.push(100); }
          if (data.stage === 'lost') { fields.push(`probability = $${idx++}`); values.push(0); }
        }
      } else if (effectiveProbability !== undefined) {
        fields.push(`probability = $${idx++}`); values.push(effectiveProbability);
      } else if (data.probability !== undefined) {
        fields.push(`probability = $${idx++}`); values.push(data.probability);
      }
      if (data.expectedCloseDate !== undefined) { fields.push(`expected_close_date = $${idx++}`); values.push(data.expectedCloseDate); }
      if (data.leadId !== undefined) { fields.push(`lead_id = $${idx++}`); values.push(data.leadId); }
      if (data.customerId !== undefined) { fields.push(`customer_id = $${idx++}`); values.push(data.customerId); }
      if (data.assignedTo !== undefined) { fields.push(`assigned_to = $${idx++}`); values.push(data.assignedTo); }
      if (data.notes !== undefined) { fields.push(`notes = $${idx++}`); values.push(data.notes); }
      if (fields.length === 0) return { success: true };
      fields.push(`updated_by = $${idx++}::uuid`);
      values.push(safeUserId(_userId));
      fields.push('updated_at = NOW()');
      values.push(id);
      values.push(companyId);
      const result = await adapter.query(`UPDATE opportunities SET ${fields.join(', ')} WHERE id = $${idx}::uuid AND company_id = $${idx + 1}::uuid`, values);
      if (result.success) audit('update', 'opportunities', id, companyId, data.name || current.data.name, { stage: data.stage });
      return { success: result.success, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  /** Read a single opportunity — used by the stage machine + AI tools. */
  async getOpportunityById(id: string, companyId: string): Promise<{ success: boolean; data?: Opportunity; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      if (isElectronPg()) {
        const result = await invokeCrmRpc('getOpportunityById', { id });
        if (result.success && result.rows?.length) return { success: true, data: mapOpportunityRow(result.rows[0]) };
        return { success: false, error: result.error || 'Not found' };
      }
      const adapter = await getDbAdapter();
      const result = await adapter.query<Record<string, unknown>>(
        `SELECT o.*, u.full_name as assigned_name
           FROM opportunities o LEFT JOIN users u ON o.assigned_to = u.id
          WHERE o.id = $1::uuid AND o.company_id = $2::uuid LIMIT 1`,
        [id, companyId]
      );
      if (result.success && result.rows?.[0]) return { success: true, data: mapOpportunityRow(result.rows[0]) };
      return { success: false, error: result.error || 'Not found' };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async deleteOpportunity(id: string, companyId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      if (isElectronPg()) {
        const result = await invokeCrmRpc('deleteOpportunity', { id });
        if (result.success) audit('delete', 'opportunities', id, companyId);
        return { success: result.success, error: result.error };
      }
      const adapter = await getDbAdapter();
      const result = await adapter.query('DELETE FROM opportunities WHERE id = $1::uuid AND company_id = $2::uuid', [id, companyId]);
      if (result.success) audit('delete', 'opportunities', id, companyId);
      return { success: result.success, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  // ─── Tasks ────────────────────────────────────────────────────────────────
  async getTasks(companyId: string): Promise<{ success: boolean; data?: Task[]; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      if (isElectronPg()) {
        const result = await invokeCrmRpc('getTasks');
        return result.success
          ? { success: true, data: (result.rows || []).map(mapTaskRow) }
          : { success: false, error: result.error };
      }
      const adapter = await getDbAdapter();
      const result = await adapter.query(
        `SELECT t.*, u.full_name as assigned_name FROM tasks t LEFT JOIN users u ON t.assigned_to = u.id WHERE t.company_id = $1::uuid ORDER BY t.due_date ASC`,
        [companyId]
      );
      if (result.success) {
        const rows = (result.rows || []).map((r: Record<string, unknown>) => mapTaskRow(r));
        return { success: true, data: rows };
      }
      return { success: false, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async createTask(data: Omit<Task, 'id' | 'createdAt'>, _userId?: string): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      const validation = validateInput(createTaskSchema, data);
      if (!validation.success) return { success: false, error: validation.error };
      if (isElectronPg()) {
        const result = await invokeCrmRpc('createTask', {
          title: data.title,
          description: data.description || null,
          dueDate: data.dueDate || null,
          priority: data.priority,
          status: data.status,
          opportunityId: data.opportunityId || null,
          leadId: data.leadId || null,
          customerId: data.customerId || null,
          assignedTo: data.assignedTo || null,
        });
        if (result.success) {
          const newId = firstId(result.rows);
          if (newId) audit('create', 'tasks', newId, data.companyId, data.title, { dueDate: data.dueDate });
          return { success: true, id: newId };
        }
        return { success: false, error: result.error };
      }
      const { safeUserId } = await import('@/core/utils/userIdValidator');
      const adapter = await getDbAdapter();
      const result = await adapter.query(
        `INSERT INTO tasks (company_id, opportunity_id, lead_id, customer_id, title, description, due_date, priority, status, assigned_to, created_at, created_by, updated_by) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7::date,$8,$9,$10::uuid,$11,$12::uuid,$13::uuid) RETURNING id`,
        [data.companyId, data.opportunityId || null, data.leadId || null, data.customerId || null, data.title, data.description || null, data.dueDate || null, data.priority, data.status, data.assignedTo || null, new Date().toISOString(), safeUserId(_userId), safeUserId(_userId)]
      );
      if (result.success && result.rows?.[0]) {
        audit('create', 'tasks', result.rows[0].id, data.companyId, data.title, { dueDate: data.dueDate });
        return { success: true, id: result.rows[0].id };
      }
      return { success: false, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async updateTask(id: string, companyId: string, data: Partial<Omit<Task, 'id' | 'companyId'>>, _userId?: string): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      const dataValidation = validateInput(updateTaskSchema, data);
      if (!dataValidation.success) return { success: false, error: dataValidation.error };
      if (isElectronPg()) {
        const payload: Record<string, unknown> = { id };
        for (const key of ['title', 'description', 'dueDate', 'priority', 'status', 'opportunityId', 'leadId', 'customerId', 'assignedTo'] as const) {
          if (data[key] !== undefined) payload[key] = data[key];
        }
        const result = await invokeCrmRpc('updateTask', payload);
        if (result.success) audit('update', 'tasks', id, companyId, data.title || id, { status: data.status });
        return { success: result.success, error: result.error };
      }
      const { safeUserId } = await import('@/core/utils/userIdValidator');
      const adapter = await getDbAdapter();
      const fields: string[] = [];
      const values: unknown[] = [];
      let idx = 1;
      if (data.title !== undefined) { fields.push(`title = $${idx++}`); values.push(data.title); }
      if (data.description !== undefined) { fields.push(`description = $${idx++}`); values.push(data.description); }
      if (data.dueDate !== undefined) { fields.push(`due_date = $${idx++}`); values.push(data.dueDate); }
      if (data.priority !== undefined) { fields.push(`priority = $${idx++}`); values.push(data.priority); }
      if (data.status !== undefined) { fields.push(`status = $${idx++}`); values.push(data.status); }
      if (data.opportunityId !== undefined) { fields.push(`opportunity_id = $${idx++}`); values.push(data.opportunityId); }
      if (data.leadId !== undefined) { fields.push(`lead_id = $${idx++}`); values.push(data.leadId); }
      if (data.customerId !== undefined) { fields.push(`customer_id = $${idx++}`); values.push(data.customerId); }
      if (data.assignedTo !== undefined) { fields.push(`assigned_to = $${idx++}`); values.push(data.assignedTo); }
      if (fields.length === 0) return { success: true };
      fields.push(`updated_by = $${idx++}::uuid`);
      values.push(safeUserId(_userId));
      fields.push('updated_at = NOW()');
      values.push(id);
      values.push(companyId);
      const result = await adapter.query(`UPDATE tasks SET ${fields.join(', ')} WHERE id = $${idx}::uuid AND company_id = $${idx + 1}::uuid`, values);
      if (result.success) audit('update', 'tasks', id, companyId, data.title || id, { status: data.status });
      return { success: result.success, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async deleteTask(id: string, companyId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      if (isElectronPg()) {
        const result = await invokeCrmRpc('deleteTask', { id });
        if (result.success) audit('delete', 'tasks', id, companyId);
        return { success: result.success, error: result.error };
      }
      const adapter = await getDbAdapter();
      const result = await adapter.query('DELETE FROM tasks WHERE id = $1::uuid AND company_id = $2::uuid', [id, companyId]);
      if (result.success) audit('delete', 'tasks', id, companyId);
      return { success: result.success, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async getTasksPaginated(
    companyId: string,
    page: number,
    pageSize: number,
    filters?: { status?: string; priority?: string; search?: string }
  ): Promise<PaginatedQueryResult<Task>> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      const { page: p, pageSize: ps, offset } = clampPageArgs(page, pageSize);
      if (isElectronPg()) {
        const result = await invokeCrmRpc('getTasksPaginated', {
          page: p,
          pageSize: ps,
          status: filters?.status || null,
          priority: filters?.priority || null,
          search: filters?.search || null,
        });
        if (!result.success) return { success: false, error: result.error };
        const items = (result.rows || []).map(mapTaskRow);
        const total = items.length > 0 && 'total_count' in (result.rows || [])[0]
          ? Number((result.rows || [])[0].total_count)
          : 0;
        return { success: true, data: paginatedResult(items, total, p, ps) };
      }
      const adapter = await getDbAdapter();

      const conditions: string[] = ['t.company_id = $1'];
      const params: unknown[] = [companyId];
      if (filters?.status) {
        params.push(filters.status);
        conditions.push(`t.status = $${params.length}`);
      }
      if (filters?.priority) {
        params.push(filters.priority);
        conditions.push(`t.priority = $${params.length}`);
      }
      if (filters?.search) {
        params.push(`%${filters.search}%`);
        conditions.push(`(t.title ILIKE $${params.length} OR t.description ILIKE $${params.length})`);
      }
      const where = conditions.join(' AND ');

      const countResult = await adapter.query(
        `SELECT COUNT(*)::int AS total FROM tasks t WHERE ${where}`,
        params
      );
      const total = Number(countResult.rows?.[0]?.total || 0);

      const dataParams = [...params, ps, offset];
      const limitIdx = dataParams.length - 1;
      const offsetIdx = dataParams.length;

      const dataResult = await adapter.query(
        `SELECT t.*, u.full_name as assigned_name
         FROM tasks t LEFT JOIN users u ON t.assigned_to = u.id
         WHERE ${where}
         ORDER BY t.due_date ASC
         LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        dataParams
      );
      if (!dataResult.success) return { success: false, error: dataResult.error };

      const items = (dataResult.rows || []).map((r: Record<string, unknown>) => mapTaskRow(r));
      return { success: true, data: paginatedResult(items, total, p, ps) };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  // ─── Activities ───────────────────────────────────────────────────────────
  async getActivities(companyId: string): Promise<{ success: boolean; data?: Activity[]; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      if (isElectronPg()) {
        const result = await invokeCrmRpc('getActivities');
        return result.success
          ? { success: true, data: (result.rows || []).map(mapActivityRow) }
          : { success: false, error: result.error };
      }
      const adapter = await getDbAdapter();
      const result = await adapter.query(
        `SELECT a.*, u.full_name as assigned_name FROM activities a LEFT JOIN users u ON a.assigned_to = u.id WHERE a.company_id = $1::uuid ORDER BY a.activity_date DESC`,
        [companyId]
      );
      if (result.success) {
        const rows = (result.rows || []).map((r: Record<string, unknown>) => mapActivityRow(r));
        return { success: true, data: rows };
      }
      return { success: false, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  /**
   * Log an activity. When the activity is linked to a lead, the lead's
   * last_contacted_at is auto-stamped in the same atomic statement — the
   * follow-up tools read it directly, no second round-trip.
   */
  async createActivity(data: Omit<Activity, 'id' | 'createdAt'>, _userId?: string): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      const validation = validateInput(createActivitySchema, data);
      if (!validation.success) return { success: false, error: validation.error };
      if (isElectronPg()) {
        const result = await invokeCrmRpc('createActivity', {
          type: data.type,
          subject: data.subject,
          description: data.description || null,
          activityDate: data.activityDate,
          durationMinutes: data.durationMinutes ?? null,
          leadId: data.leadId || null,
          opportunityId: data.opportunityId || null,
          customerId: data.customerId || null,
          assignedTo: data.assignedTo || null,
        });
        if (result.success) {
          const newId = firstId(result.rows);
          if (newId) audit('create', 'activities', newId, data.companyId, data.subject, { type: data.type, leadId: data.leadId });
          return { success: true, id: newId };
        }
        return { success: false, error: result.error };
      }
      const { safeUserId } = await import('@/core/utils/userIdValidator');
      const adapter = await getDbAdapter();
      // Atomic: INSERT activity + (when lead-linked) stamp last_contacted_at.
      const result = await adapter.query(
        `WITH new_activity AS (
            INSERT INTO activities (company_id, lead_id, opportunity_id, customer_id, type, subject, description, activity_date, duration_minutes, assigned_to, created_at, created_by, updated_by)
            VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8,$9,$10::uuid,$11,$12::uuid,$13::uuid)
            RETURNING id
         ),
         touched_lead AS (
            UPDATE leads SET last_contacted_at = $8, updated_at = NOW()
             WHERE id = $2::uuid AND company_id = $1::uuid
            RETURNING id
         )
         SELECT id FROM new_activity`,
        [data.companyId, data.leadId || null, data.opportunityId || null, data.customerId || null, data.type, data.subject, data.description || null, data.activityDate, data.durationMinutes ?? null, data.assignedTo || null, new Date().toISOString(), safeUserId(_userId), safeUserId(_userId)]
      );
      if (result.success && result.rows?.[0]) {
        audit('create', 'activities', result.rows[0].id, data.companyId, data.subject, { type: data.type, leadId: data.leadId });
        return { success: true, id: String(result.rows[0].id) };
      }
      return { success: false, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async updateActivity(id: string, companyId: string, data: Partial<Omit<Activity, 'id' | 'companyId'>>, _userId?: string): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      const dataValidation = validateInput(updateActivitySchema, data);
      if (!dataValidation.success) return { success: false, error: dataValidation.error };
      if (isElectronPg()) {
        const payload: Record<string, unknown> = { id };
        for (const key of ['type', 'subject', 'description', 'activityDate', 'durationMinutes', 'leadId', 'opportunityId', 'customerId', 'assignedTo'] as const) {
          if (data[key] !== undefined) payload[key] = data[key];
        }
        const result = await invokeCrmRpc('updateActivity', payload);
        if (result.success) audit('update', 'activities', id, companyId, data.subject || id);
        return { success: result.success, error: result.error };
      }
      const { safeUserId } = await import('@/core/utils/userIdValidator');
      const adapter = await getDbAdapter();
      const fields: string[] = [];
      const values: unknown[] = [];
      let idx = 1;
      if (data.type !== undefined) { fields.push(`type = $${idx++}`); values.push(data.type); }
      if (data.subject !== undefined) { fields.push(`subject = $${idx++}`); values.push(data.subject); }
      if (data.description !== undefined) { fields.push(`description = $${idx++}`); values.push(data.description); }
      if (data.activityDate !== undefined) { fields.push(`activity_date = $${idx++}`); values.push(data.activityDate); }
      if (data.durationMinutes !== undefined) { fields.push(`duration_minutes = $${idx++}`); values.push(data.durationMinutes); }
      if (data.leadId !== undefined) { fields.push(`lead_id = $${idx++}`); values.push(data.leadId); }
      if (data.opportunityId !== undefined) { fields.push(`opportunity_id = $${idx++}`); values.push(data.opportunityId); }
      if (data.customerId !== undefined) { fields.push(`customer_id = $${idx++}`); values.push(data.customerId); }
      if (data.assignedTo !== undefined) { fields.push(`assigned_to = $${idx++}`); values.push(data.assignedTo); }
      if (fields.length === 0) return { success: true };
      fields.push(`updated_by = $${idx++}::uuid`);
      values.push(safeUserId(_userId));
      fields.push('updated_at = NOW()');
      values.push(id);
      values.push(companyId);
      const result = await adapter.query(`UPDATE activities SET ${fields.join(', ')} WHERE id = $${idx}::uuid AND company_id = $${idx + 1}::uuid`, values);
      if (result.success) audit('update', 'activities', id, companyId, data.subject || id);
      return { success: result.success, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async deleteActivity(id: string, companyId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      if (isElectronPg()) {
        const result = await invokeCrmRpc('deleteActivity', { id });
        if (result.success) audit('delete', 'activities', id, companyId);
        return { success: result.success, error: result.error };
      }
      const adapter = await getDbAdapter();
      const result = await adapter.query('DELETE FROM activities WHERE id = $1::uuid AND company_id = $2::uuid', [id, companyId]);
      if (result.success) audit('delete', 'activities', id, companyId);
      return { success: result.success, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async getActivitiesPaginated(
    companyId: string,
    page: number,
    pageSize: number,
    filters?: { type?: string; assignedTo?: string; search?: string }
  ): Promise<PaginatedQueryResult<Activity>> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      const { page: p, pageSize: ps, offset } = clampPageArgs(page, pageSize);
      if (isElectronPg()) {
        const result = await invokeCrmRpc('getActivitiesPaginated', {
          page: p,
          pageSize: ps,
          type: filters?.type || null,
          assignedTo: filters?.assignedTo || null,
          search: filters?.search || null,
        });
        if (!result.success) return { success: false, error: result.error };
        const items = (result.rows || []).map(mapActivityRow);
        const total = items.length > 0 && 'total_count' in (result.rows || [])[0]
          ? Number((result.rows || [])[0].total_count)
          : 0;
        return { success: true, data: paginatedResult(items, total, p, ps) };
      }
      const adapter = await getDbAdapter();

      const conditions: string[] = ['a.company_id = $1'];
      const params: unknown[] = [companyId];
      if (filters?.type) {
        params.push(filters.type);
        conditions.push(`a.type = $${params.length}`);
      }
      if (filters?.assignedTo) {
        params.push(filters.assignedTo);
        conditions.push(`a.assigned_to = $${params.length}`);
      }
      // Search parity across the 3 paths (Phase A5 — the RPC already had it).
      if (filters?.search) {
        params.push(`%${filters.search}%`);
        conditions.push(`a.subject ILIKE $${params.length}`);
      }
      const where = conditions.join(' AND ');

      const countResult = await adapter.query(
        `SELECT COUNT(*)::int AS total FROM activities a WHERE ${where}`,
        params
      );
      const total = Number(countResult.rows?.[0]?.total || 0);

      const dataParams = [...params, ps, offset];
      const limitIdx = dataParams.length - 1;
      const offsetIdx = dataParams.length;

      const dataResult = await adapter.query(
        `SELECT a.*, u.full_name as assigned_name
         FROM activities a LEFT JOIN users u ON a.assigned_to = u.id
         WHERE ${where}
         ORDER BY a.activity_date DESC
         LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        dataParams
      );
      if (!dataResult.success) return { success: false, error: dataResult.error };

      const items = (dataResult.rows || []).map((r: Record<string, unknown>) => mapActivityRow(r));
      return { success: true, data: paginatedResult(items, total, p, ps) };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  // ─── SQL-computed KPIs (full dataset, not the current page) ───────────────
  /**
   * KPIs aggregated in SQL over the WHOLE company dataset. The pages used to
   * reduce over the current page items — wrong the moment a page holds < the
   * total row count (Phase A5).
   */
  async getLeadKpis(companyId: string): Promise<{ success: boolean; data?: Record<string, number>; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      const adapter = await getDbAdapter();
      const result = await adapter.query<Record<string, unknown>>(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status = 'new')::int AS new_leads,
                COUNT(*) FILTER (WHERE status = 'contacted')::int AS contacted,
                COUNT(*) FILTER (WHERE status = 'qualified')::int AS qualified,
                COUNT(*) FILTER (WHERE status = 'converted')::int AS converted,
                COUNT(*) FILTER (WHERE status = 'lost')::int AS lost,
                COALESCE(SUM(estimated_value) FILTER (WHERE status <> 'converted' AND status <> 'lost'), 0)::float8 AS pipeline_value
           FROM leads WHERE company_id = $1::uuid`,
        [companyId]
      );
      if (!result.success || !result.rows?.[0]) return { success: false, error: result.error || 'no data' };
      const r = result.rows[0];
      return {
        success: true,
        data: {
          total: Number(r.total),
          new: Number(r.new_leads),
          contacted: Number(r.contacted),
          qualified: Number(r.qualified),
          converted: Number(r.converted),
          lost: Number(r.lost),
          pipelineValue: Number(r.pipeline_value),
        },
      };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async getOpportunityKpis(companyId: string): Promise<{ success: boolean; data?: Record<string, number>; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      const adapter = await getDbAdapter();
      const result = await adapter.query<Record<string, unknown>>(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE stage NOT IN ('won', 'lost'))::int AS open_count,
                COUNT(*) FILTER (WHERE stage = 'won')::int AS won,
                COUNT(*) FILTER (WHERE stage = 'lost')::int AS lost,
                COALESCE(SUM(value) FILTER (WHERE stage NOT IN ('won', 'lost')), 0)::float8 AS pipeline_value,
                COALESCE(SUM(value * probability / 100.0) FILTER (WHERE stage NOT IN ('won', 'lost')), 0)::float8 AS weighted_value,
                COALESCE(SUM(value) FILTER (WHERE stage = 'won'), 0)::float8 AS won_value
           FROM opportunities WHERE company_id = $1::uuid`,
        [companyId]
      );
      if (!result.success || !result.rows?.[0]) return { success: false, error: result.error || 'no data' };
      const r = result.rows[0];
      return {
        success: true,
        data: {
          total: Number(r.total),
          open: Number(r.open_count),
          won: Number(r.won),
          lost: Number(r.lost),
          pipelineValue: Number(r.pipeline_value),
          weightedValue: Number(r.weighted_value),
          wonValue: Number(r.won_value),
        },
      };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async getTaskKpis(companyId: string): Promise<{ success: boolean; data?: Record<string, number>; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      const adapter = await getDbAdapter();
      const result = await adapter.query<Record<string, unknown>>(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
                COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
                COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
                COUNT(*) FILTER (WHERE status = 'pending' AND due_date < CURRENT_DATE)::int AS overdue
           FROM tasks WHERE company_id = $1::uuid`,
        [companyId]
      );
      if (!result.success || !result.rows?.[0]) return { success: false, error: result.error || 'no data' };
      const r = result.rows[0];
      return {
        success: true,
        data: {
          total: Number(r.total),
          pending: Number(r.pending),
          completed: Number(r.completed),
          cancelled: Number(r.cancelled),
          overdue: Number(r.overdue),
        },
      };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async getActivityKpis(companyId: string): Promise<{ success: boolean; data?: Record<string, number>; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      const adapter = await getDbAdapter();
      const result = await adapter.query<Record<string, unknown>>(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE type = 'call')::int AS calls,
                COUNT(*) FILTER (WHERE type = 'meeting')::int AS meetings,
                COALESCE(SUM(duration_minutes), 0)::int AS total_minutes
           FROM activities WHERE company_id = $1::uuid`,
        [companyId]
      );
      if (!result.success || !result.rows?.[0]) return { success: false, error: result.error || 'no data' };
      const r = result.rows[0];
      return {
        success: true,
        data: {
          total: Number(r.total),
          calls: Number(r.calls),
          meetings: Number(r.meetings),
          totalMinutes: Number(r.total_minutes),
        },
      };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  // ─── Aggregates for reports & dashboard (SQL single source) ───────────────
  async getLeadConversionStats(companyId: string, fromDate?: string, toDate?: string): Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      const adapter = await getDbAdapter();
      const conditions = ['company_id = $1::uuid'];
      const params: unknown[] = [companyId];
      if (fromDate) { params.push(fromDate); conditions.push(`created_at >= $${params.length}::date`); }
      if (toDate) { params.push(toDate); conditions.push(`created_at < ($${params.length}::date + INTERVAL '1 day')`); }
      const result = await adapter.query<Record<string, unknown>>(
        `SELECT status, source, COUNT(*)::int AS count
           FROM leads
          WHERE ${conditions.join(' AND ')}
          GROUP BY status, source`,
        params
      );
      if (!result.success) return { success: false, error: result.error };
      return { success: true, data: { rows: result.rows || [] } };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async getPipelineStats(companyId: string): Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      const adapter = await getDbAdapter();
      const result = await adapter.query<Record<string, unknown>>(
        `SELECT o.stage, o.probability, o.value, c.name AS customer_name, u.full_name AS assigned_name
           FROM opportunities o
           LEFT JOIN customers c ON o.customer_id = c.id
           LEFT JOIN users u ON o.assigned_to = u.id
          WHERE o.company_id = $1::uuid AND o.stage NOT IN ('won', 'lost')`,
        [companyId]
      );
      if (!result.success) return { success: false, error: result.error };
      return { success: true, data: { rows: result.rows || [] } };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async getCrmDashboardKpis(companyId: string): Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      const adapter = await getDbAdapter();
      const result = await adapter.query<Record<string, unknown>>(
        `SELECT
           (SELECT COUNT(*)::int FROM leads WHERE company_id = $1::uuid) AS leads_total,
           (SELECT COUNT(*)::int FROM leads WHERE company_id = $1::uuid AND status = 'converted') AS leads_converted,
           (SELECT COUNT(*)::int FROM opportunities WHERE company_id = $1::uuid AND stage NOT IN ('won','lost')) AS open_opportunities,
           (SELECT COALESCE(AVG(probability), 0)::float8 FROM opportunities WHERE company_id = $1::uuid AND stage NOT IN ('won','lost')) AS avg_probability,
           (SELECT COALESCE(SUM(value), 0)::float8 FROM opportunities WHERE company_id = $1::uuid AND stage NOT IN ('won','lost')) AS pipeline_value,
           (SELECT COUNT(*)::int FROM opportunities WHERE company_id = $1::uuid AND stage = 'won') AS won_count,
           (SELECT COUNT(*)::int FROM opportunities WHERE company_id = $1::uuid AND stage = 'lost') AS lost_count,
           (SELECT COALESCE(AVG(value), 0)::float8 FROM opportunities WHERE company_id = $1::uuid AND stage = 'won') AS avg_won_value,
           (SELECT COUNT(*)::int FROM tasks WHERE company_id = $1::uuid AND status = 'pending' AND due_date < CURRENT_DATE) AS overdue_tasks`,
        [companyId]
      );
      if (!result.success || !result.rows?.[0]) return { success: false, error: result.error || 'no data' };
      return { success: true, data: result.rows[0] };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async getOpportunityStageBreakdown(companyId: string): Promise<{ success: boolean; data?: Record<string, unknown>[]; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      const adapter = await getDbAdapter();
      const result = await adapter.query<Record<string, unknown>>(
        `SELECT stage, COALESCE(SUM(value), 0) AS value, COUNT(*)::int AS cnt
           FROM opportunities
          WHERE company_id = $1::uuid
          GROUP BY stage
          ORDER BY MIN(CASE stage WHEN 'new' THEN 1 WHEN 'qualified' THEN 2 WHEN 'proposal' THEN 3 WHEN 'negotiation' THEN 4 WHEN 'won' THEN 5 WHEN 'lost' THEN 6 ELSE 7 END)`,
        [companyId]
      );
      if (!result.success) return { success: false, error: result.error };
      return { success: true, data: result.rows as Record<string, unknown>[] };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },
};

// ─── Row mappers (Phase 45/73 fix: never `String(date)` on raw pg rows) ──────

function mapLeadRow(r: Record<string, unknown>): Lead {
  return {
    id: String(r.id),
    companyId: String(r.company_id),
    name: String(r.name),
    phone: r.phone ? String(r.phone) : undefined,
    email: r.email ? String(r.email) : undefined,
    company: r.company ? String(r.company) : undefined,
    source: r.source ? String(r.source) : undefined,
    status: String(r.status || 'new') as Lead['status'],
    rating: String(r.rating || 'warm') as Lead['rating'],
    estimatedValue: r.estimated_value ? Number(r.estimated_value) : undefined,
    assignedTo: r.assigned_to ? String(r.assigned_to) : undefined,
    assignedName: r.assigned_name ? String(r.assigned_name) : undefined,
    notes: r.notes ? String(r.notes) : undefined,
    lastContactedAt: r.last_contacted_at ? (toDateString(r.last_contacted_at) ?? undefined) : undefined,
    createdAt: r.created_at ? (toDateString(r.created_at) ?? undefined) : undefined,
  };
}

function mapOpportunityRow(r: Record<string, unknown>): Opportunity {
  return {
    id: String(r.id),
    companyId: String(r.company_id),
    leadId: r.lead_id ? String(r.lead_id) : undefined,
    customerId: r.customer_id ? String(r.customer_id) : undefined,
    name: String(r.name),
    value: Number(r.value) || 0,
    stage: String(r.stage || 'new') as OpportunityStage,
    probability: r.probability != null ? Number(r.probability) : undefined,
    expectedCloseDate: r.expected_close_date ? (toDateString(r.expected_close_date) ?? undefined) : undefined,
    closeDate: r.close_date ? (toDateString(r.close_date) ?? undefined) : undefined,
    assignedTo: r.assigned_to ? String(r.assigned_to) : undefined,
    assignedName: r.assigned_name ? String(r.assigned_name) : undefined,
    notes: r.notes ? String(r.notes) : undefined,
    createdAt: r.created_at ? (toDateString(r.created_at) ?? undefined) : undefined,
  };
}

function mapTaskRow(r: Record<string, unknown>): Task {
  return {
    id: String(r.id),
    companyId: String(r.company_id),
    opportunityId: r.opportunity_id ? String(r.opportunity_id) : undefined,
    leadId: r.lead_id ? String(r.lead_id) : undefined,
    customerId: r.customer_id ? String(r.customer_id) : undefined,
    title: String(r.title),
    description: r.description ? String(r.description) : undefined,
    dueDate: r.due_date ? (toDateString(r.due_date) ?? undefined) : undefined,
    priority: String(r.priority || 'medium') as Task['priority'],
    status: String(r.status || 'pending') as Task['status'],
    assignedTo: r.assigned_to ? String(r.assigned_to) : undefined,
    assignedName: r.assigned_name ? String(r.assigned_name) : undefined,
    createdAt: r.created_at ? (toDateString(r.created_at) ?? undefined) : undefined,
  };
}

function mapActivityRow(r: Record<string, unknown>): Activity {
  return {
    id: String(r.id),
    companyId: String(r.company_id),
    leadId: r.lead_id ? String(r.lead_id) : undefined,
    opportunityId: r.opportunity_id ? String(r.opportunity_id) : undefined,
    customerId: r.customer_id ? String(r.customer_id) : undefined,
    type: String(r.type) as Activity['type'],
    subject: String(r.subject),
    description: r.description ? String(r.description) : undefined,
    activityDate: r.activity_date ? (toDateString(r.activity_date) ?? new Date().toISOString()) : new Date().toISOString(),
    durationMinutes: r.duration_minutes != null ? Number(r.duration_minutes) : undefined,
    assignedTo: r.assigned_to ? String(r.assigned_to) : undefined,
    assignedName: r.assigned_name ? String(r.assigned_name) : undefined,
    createdAt: r.created_at ? (toDateString(r.created_at) ?? undefined) : undefined,
  };
}
