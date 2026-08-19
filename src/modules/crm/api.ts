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
import type { Lead, Opportunity, Task, Activity } from './types';

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
        `SELECT l.*, u.full_name as assigned_name FROM leads l LEFT JOIN users u ON l.assigned_to = u.id WHERE l.company_id = $1 ORDER BY l.created_at DESC`,
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
      const result = await adapter.query<Record<string, unknown>>('SELECT * FROM leads WHERE id = $1 AND company_id = $2 LIMIT 1', [id, companyId]);
      if (result.success && result.rows?.[0]) return { success: true, data: mapLeadRow(result.rows[0]) };
      return { success: false, error: result.error || 'Not found' };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async createLead(data: Omit<Lead, 'id' | 'createdAt'>, _userId?: string): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      const validation = validateInput(createLeadSchema, data);
      if (!validation.success) return { success: false, error: validation.error };
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
        if (result.success) return { success: true, id: firstId(result.rows) };
        return { success: false, error: result.error };
      }
      const { safeUserId } = await import('@/core/utils/userIdValidator');
      const adapter = await getDbAdapter();
      const result = await adapter.query<{ id: string }>(
        `INSERT INTO leads (company_id, name, phone, email, company, source, status, rating, estimated_value, assigned_to, notes, created_at, created_by, updated_by) VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10::uuid,$11,$12,$13::uuid,$14::uuid) RETURNING id`,
        [data.companyId, data.name, data.phone || null, data.email || null, data.company || null, data.source || null, data.status, data.rating, data.estimatedValue || null, data.assignedTo || null, data.notes || null, new Date().toISOString(), safeUserId(_userId), safeUserId(_userId)]
      );
      if (result.success && result.rows?.[0]) return { success: true, id: result.rows[0].id };
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
      if (_userId !== undefined) {
        fields.push(`updated_by = $${idx++}`);
        values.push(safeUserId(_userId));
      }
      fields.push('updated_at = NOW()');
      values.push(id);
      values.push(companyId);
      const result = await adapter.query(`UPDATE leads SET ${fields.join(', ')} WHERE id = $${idx} AND company_id = $${idx + 1}`, values);
      return { success: result.success, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async deleteLead(id: string, companyId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      if (isElectronPg()) {
        const result = await invokeCrmRpc('deleteLead', { id });
        return { success: result.success, error: result.error };
      }
      const adapter = await getDbAdapter();
      const result = await adapter.query('DELETE FROM leads WHERE id = $1 AND company_id = $2', [id, companyId]);
      return { success: result.success, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async convertLeadToCustomer(id: string, companyId: string, customerData: Record<string, unknown>, _userId?: string): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      if (isElectronPg()) {
        const leadInfo = await this.getLeadById(id, companyId);
        if (!leadInfo.success || !leadInfo.data) return { success: false, error: leadInfo.error || 'Lead not found' };
        const lead = leadInfo.data;
        const result = await invokeCrmRpc('convertLeadToCustomer', {
          id,
          name: lead.name,
          phone: lead.phone || null,
          email: lead.email || null,
          customerCode: typeof customerData.code === 'string' && customerData.code.trim() ? customerData.code.trim() : null,
          address: (customerData.address as string) || null,
          taxNumber: (customerData.taxNumber as string) || null,
          creditLimit: (customerData.creditLimit as number) || 0,
        });
        if (result.success) return { success: true, id: firstId(result.rows) };
        return { success: false, error: result.error };
      }
      const { safeUserId } = await import('@/core/utils/userIdValidator');
      const adapter = await getDbAdapter();
      const leadRes = await adapter.query<Record<string, unknown>>('SELECT * FROM leads WHERE id = $1 AND company_id = $2 LIMIT 1', [id, companyId]);
      if (!leadRes.success || !leadRes.rows?.[0]) return { success: false, error: 'Lead not found' };
      const leadRow = leadRes.rows[0];
      const nextCodeResult = await adapter.query<{ next_code: number }>(
        `SELECT COALESCE(MAX(CAST(SUBSTRING(code FROM '^CUST-([0-9]+)$') AS integer)), 0) + 1 AS next_code
           FROM customers
          WHERE company_id = $1 AND code ~ '^CUST-[0-9]+$'`,
        [companyId]
      );
      const nextCode = Number(nextCodeResult.rows?.[0]?.next_code || 1);
      const customerCode = typeof customerData.code === 'string' && customerData.code.trim()
        ? customerData.code.trim()
        : `CUST-${String(nextCode).padStart(4, '0')}`;
      const custResult = await adapter.query(
        `INSERT INTO customers (company_id, code, name, phone, email, address, tax_number, credit_limit, balance, is_active, created_by, updated_by) VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::uuid,$12::uuid) RETURNING id`,
        [leadRow.company_id, customerCode, leadRow.name, leadRow.phone, leadRow.email, customerData.address || null, customerData.taxNumber || null, customerData.creditLimit || 0, 0, true, safeUserId(_userId), safeUserId(_userId)]
      );
      if (custResult.success && custResult.rows?.[0]) {
        await adapter.query("UPDATE leads SET status = 'converted', updated_by = $3::uuid, updated_at = NOW() WHERE id = $1 AND company_id = $2", [id, companyId, safeUserId(_userId)]);
        return { success: true, id: custResult.rows[0].id };
      }
      return { success: false, error: custResult.error };
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
        `SELECT o.*, u.full_name as assigned_name FROM opportunities o LEFT JOIN users u ON o.assigned_to = u.id WHERE o.company_id = $1 ORDER BY o.created_at DESC`,
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
        if (result.success) return { success: true, id: firstId(result.rows) };
        return { success: false, error: result.error };
      }
      const { safeUserId } = await import('@/core/utils/userIdValidator');
      const adapter = await getDbAdapter();
      const result = await adapter.query(
        `INSERT INTO opportunities (company_id, lead_id, customer_id, name, value, stage, probability, expected_close_date, assigned_to, notes, created_at, created_by, updated_by) VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,$9::uuid,$10,$11,$12::uuid,$13::uuid) RETURNING id`,
        [data.companyId, data.leadId || null, data.customerId || null, data.name, data.value, data.stage, data.probability ?? null, data.expectedCloseDate || null, data.assignedTo || null, data.notes || null, new Date().toISOString(), safeUserId(_userId), safeUserId(_userId)]
      );
      if (result.success && result.rows?.[0]) return { success: true, id: result.rows[0].id };
      return { success: false, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async updateOpportunity(id: string, companyId: string, data: Partial<Omit<Opportunity, 'id' | 'companyId'>>, _userId?: string): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      const dataValidation = validateInput(updateOpportunitySchema, data);
      if (!dataValidation.success) return { success: false, error: dataValidation.error };
      if (isElectronPg()) {
        const payload: Record<string, unknown> = { id };
        for (const key of ['name', 'value', 'stage', 'probability', 'expectedCloseDate', 'leadId', 'customerId', 'assignedTo', 'notes'] as const) {
          if (data[key] !== undefined) payload[key] = data[key];
        }
        const result = await invokeCrmRpc('updateOpportunity', payload);
        return { success: result.success, error: result.error };
      }
      const { safeUserId } = await import('@/core/utils/userIdValidator');
      const adapter = await getDbAdapter();
      const fields: string[] = [];
      const values: unknown[] = [];
      let idx = 1;
      if (data.name !== undefined) { fields.push(`name = $${idx++}`); values.push(data.name); }
      if (data.value !== undefined) { fields.push(`value = $${idx++}`); values.push(data.value); }
      if (data.stage !== undefined) { fields.push(`stage = $${idx++}`); values.push(data.stage); }
      if (data.probability !== undefined) { fields.push(`probability = $${idx++}`); values.push(data.probability); }
      if (data.expectedCloseDate !== undefined) { fields.push(`expected_close_date = $${idx++}`); values.push(data.expectedCloseDate); }
      if (data.leadId !== undefined) { fields.push(`lead_id = $${idx++}`); values.push(data.leadId); }
      if (data.customerId !== undefined) { fields.push(`customer_id = $${idx++}`); values.push(data.customerId); }
      if (data.assignedTo !== undefined) { fields.push(`assigned_to = $${idx++}`); values.push(data.assignedTo); }
      if (data.notes !== undefined) { fields.push(`notes = $${idx++}`); values.push(data.notes); }
      if (fields.length === 0) return { success: true };
      if (_userId !== undefined) {
        fields.push(`updated_by = $${idx++}`);
        values.push(safeUserId(_userId));
      }
      fields.push('updated_at = NOW()');
      values.push(id);
      values.push(companyId);
      const result = await adapter.query(`UPDATE opportunities SET ${fields.join(', ')} WHERE id = $${idx} AND company_id = $${idx + 1}`, values);
      return { success: result.success, error: result.error };
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
        return { success: result.success, error: result.error };
      }
      const adapter = await getDbAdapter();
      const result = await adapter.query('DELETE FROM opportunities WHERE id = $1 AND company_id = $2', [id, companyId]);
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
        `SELECT t.*, u.full_name as assigned_name FROM tasks t LEFT JOIN users u ON t.assigned_to = u.id WHERE t.company_id = $1 ORDER BY t.due_date ASC`,
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
        if (result.success) return { success: true, id: firstId(result.rows) };
        return { success: false, error: result.error };
      }
      const { safeUserId } = await import('@/core/utils/userIdValidator');
      const adapter = await getDbAdapter();
      const result = await adapter.query(
        `INSERT INTO tasks (company_id, opportunity_id, lead_id, customer_id, title, description, due_date, priority, status, assigned_to, created_at, created_by, updated_by) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7::date,$8,$9,$10::uuid,$11,$12::uuid,$13::uuid) RETURNING id`,
        [data.companyId, data.opportunityId || null, data.leadId || null, data.customerId || null, data.title, data.description || null, data.dueDate || null, data.priority, data.status, data.assignedTo || null, new Date().toISOString(), safeUserId(_userId), safeUserId(_userId)]
      );
      if (result.success && result.rows?.[0]) return { success: true, id: result.rows[0].id };
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
      if (_userId !== undefined) {
        fields.push(`updated_by = $${idx++}`);
        values.push(safeUserId(_userId));
      }
      fields.push('updated_at = NOW()');
      values.push(id);
      values.push(companyId);
      const result = await adapter.query(`UPDATE tasks SET ${fields.join(', ')} WHERE id = $${idx} AND company_id = $${idx + 1}`, values);
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
        return { success: result.success, error: result.error };
      }
      const adapter = await getDbAdapter();
      const result = await adapter.query('DELETE FROM tasks WHERE id = $1 AND company_id = $2', [id, companyId]);
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
        `SELECT a.*, u.full_name as assigned_name FROM activities a LEFT JOIN users u ON a.assigned_to = u.id WHERE a.company_id = $1 ORDER BY a.activity_date DESC`,
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
        if (result.success) return { success: true, id: firstId(result.rows) };
        return { success: false, error: result.error };
      }
      const { safeUserId } = await import('@/core/utils/userIdValidator');
      const adapter = await getDbAdapter();
      const result = await adapter.query(
        `INSERT INTO activities (company_id, lead_id, opportunity_id, customer_id, type, subject, description, activity_date, duration_minutes, assigned_to, created_at, created_by, updated_by) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8::date,$9,$10::uuid,$11,$12::uuid,$13::uuid) RETURNING id`,
        [data.companyId, data.leadId || null, data.opportunityId || null, data.customerId || null, data.type, data.subject, data.description || null, data.activityDate, data.durationMinutes ?? null, data.assignedTo || null, new Date().toISOString(), safeUserId(_userId), safeUserId(_userId)]
      );
      if (result.success && result.rows?.[0]) return { success: true, id: result.rows[0].id };
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
      if (_userId !== undefined) {
        fields.push(`updated_by = $${idx++}`);
        values.push(safeUserId(_userId));
      }
      fields.push('updated_at = NOW()');
      values.push(id);
      values.push(companyId);
      const result = await adapter.query(`UPDATE activities SET ${fields.join(', ')} WHERE id = $${idx} AND company_id = $${idx + 1}`, values);
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
        return { success: result.success, error: result.error };
      }
      const adapter = await getDbAdapter();
      const result = await adapter.query('DELETE FROM activities WHERE id = $1 AND company_id = $2', [id, companyId]);
      return { success: result.success, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async getActivitiesPaginated(
    companyId: string,
    page: number,
    pageSize: number,
    filters?: { type?: string; assignedTo?: string }
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
};

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
    createdAt: r.created_at ? String(r.created_at) : undefined,
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
    stage: String(r.stage || 'new') as Opportunity['stage'],
    probability: r.probability ? Number(r.probability) : undefined,
    expectedCloseDate: r.expected_close_date ? String(r.expected_close_date) : undefined,
    assignedTo: r.assigned_to ? String(r.assigned_to) : undefined,
    assignedName: r.assigned_name ? String(r.assigned_name) : undefined,
    notes: r.notes ? String(r.notes) : undefined,
    createdAt: r.created_at ? String(r.created_at) : undefined,
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
    dueDate: r.due_date ? String(r.due_date) : undefined,
    priority: String(r.priority || 'medium') as Task['priority'],
    status: String(r.status || 'pending') as Task['status'],
    assignedTo: r.assigned_to ? String(r.assigned_to) : undefined,
    assignedName: r.assigned_name ? String(r.assigned_name) : undefined,
    createdAt: r.created_at ? String(r.created_at) : undefined,
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
    activityDate: r.activity_date ? String(r.activity_date) : new Date().toISOString(),
    durationMinutes: r.duration_minutes ? Number(r.duration_minutes) : undefined,
    assignedTo: r.assigned_to ? String(r.assigned_to) : undefined,
    assignedName: r.assigned_name ? String(r.assigned_name) : undefined,
    createdAt: r.created_at ? String(r.created_at) : undefined,
  };
}
