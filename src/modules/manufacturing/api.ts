import { z } from 'zod';
import { getDbAdapter, isElectronPg } from '@/core/database/adapters';
import { runTransaction, buildJournalEntryStatement } from '@/core/database/tx';
import { validateInput, idCompanySchema, companyIdSchema, uuidSchema, createBomSchema, createWorkOrderSchema } from '@/core/utils/validation';
import { clampPageArgs, paginatedResult, type PaginatedQueryResult } from '@/core/utils/pagination';
import { safeUserId } from '@/core/utils/userIdValidator';
import type { BOM, BOMLine, WorkOrder, WorkOrderLine, ProductionCost } from './types';

const workOrderStatusSchema = z.enum(['planned', 'in_progress', 'completed', 'cancelled']);

// Typed RPC bridge for Manufacturing (Phase 4 slice 8). In Electron the
// renderer sends a structured payload and the main process derives
// `company_id` + audit `user_id` from the authenticated session. The
// fallback path (PGlite / e2e) still uses `adapter.query` with explicit
// `company_id = $N` filters.
type RpcEnvelope = { success: boolean; rows?: Record<string, unknown>[]; error?: string };

async function invokeMfgRpc(method: string, payload: Record<string, unknown> = {}): Promise<RpcEnvelope> {
  const mfg = (typeof window !== 'undefined' && window.electronDB?.manufacturing) as
    | Record<string, ((p: Record<string, unknown>) => Promise<RpcEnvelope>) | undefined>
    | undefined;
  const fn = mfg?.[method];
  if (!fn) return { success: false, error: 'RPC unavailable' };
  try {
    // `call(mfg, ...)` preserves the surface object as `this` so the e2e
    // shim handlers (which call `this._cid()`) resolve the company id.
    return await fn.call(mfg, payload);
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function mapBomRow(r: Record<string, unknown>, withLinesCount = false): BOM {
  const bom: BOM = {
    id: String(r.id),
    companyId: String(r.company_id),
    productId: String(r.product_id),
    productName: r.product_name ? String(r.product_name) : undefined,
    version: String(r.version),
    isActive: r.is_active === true || r.is_active === 'true',
    outputQuantity: r.output_quantity != null && r.output_quantity !== '' ? Number(r.output_quantity) : 1,
    totalCost: r.total_cost != null && r.total_cost !== '' ? Number(r.total_cost) : undefined,
    notes: r.notes ? String(r.notes) : undefined,
    createdBy: r.created_by ? String(r.created_by) : undefined,
    updatedBy: r.updated_by ? String(r.updated_by) : undefined,
    updatedAt: r.updated_at ? String(r.updated_at) : undefined,
  };
  if (withLinesCount) bom.linesCount = r.lines_count != null ? Number(r.lines_count) : 0;
  return bom;
}

function mapBomLineRow(r: Record<string, unknown>): BOMLine {
  return {
    id: String(r.id),
    bomId: String(r.bom_id),
    materialId: String(r.material_id),
    materialName: r.material_name ? String(r.material_name) : undefined,
    quantity: Number(r.quantity) || 0,
    unitCost: r.unit_cost != null && r.unit_cost !== '' ? Number(r.unit_cost) : undefined,
    totalCost: r.total_cost != null && r.total_cost !== '' ? Number(r.total_cost) : undefined,
  };
}

function mapWorkOrderRow(r: Record<string, unknown>): WorkOrder {
  return {
    id: String(r.id),
    companyId: String(r.company_id),
    orderNumber: String(r.order_number),
    productId: String(r.product_id),
    productName: r.product_name ? String(r.product_name) : undefined,
    bomId: r.bom_id ? String(r.bom_id) : undefined,
    quantity: Number(r.quantity) || 0,
    producedQuantity: r.produced_quantity != null && r.produced_quantity !== '' ? Number(r.produced_quantity) : undefined,
    status: String(r.status) as WorkOrder['status'],
    plannedStartDate: r.planned_start_date ? String(r.planned_start_date) : undefined,
    plannedEndDate: r.planned_end_date ? String(r.planned_end_date) : undefined,
    actualStartDate: r.actual_start_date ? String(r.actual_start_date) : undefined,
    actualEndDate: r.actual_end_date ? String(r.actual_end_date) : undefined,
    totalCost: r.total_cost != null && r.total_cost !== '' ? Number(r.total_cost) : undefined,
    outputWarehouseId: r.output_warehouse_id ? String(r.output_warehouse_id) : undefined,
    batchNumber: r.batch_number ? String(r.batch_number) : undefined,
    supervisorId: r.supervisor_id ? String(r.supervisor_id) : undefined,
    supervisorName: r.supervisor_name ? String(r.supervisor_name) : undefined,
    productionCosts: parseProductionCosts(r.production_costs),
    notes: r.notes ? String(r.notes) : undefined,
    createdBy: r.created_by ? String(r.created_by) : undefined,
    updatedBy: r.updated_by ? String(r.updated_by) : undefined,
    updatedAt: r.updated_at ? String(r.updated_at) : undefined,
  };
}

function mapWorkOrderLineRow(r: Record<string, unknown>): WorkOrderLine {
  return {
    id: String(r.id),
    workOrderId: String(r.work_order_id),
    materialId: String(r.material_id),
    materialName: r.material_name ? String(r.material_name) : undefined,
    plannedQuantity: Number(r.planned_quantity) || 0,
    actualQuantity: r.actual_quantity != null && r.actual_quantity !== '' ? Number(r.actual_quantity) : undefined,
    unitCost: Number(r.unit_cost) || 0,
    actualUnitCost: r.actual_unit_cost != null && r.actual_unit_cost !== '' ? Number(r.actual_unit_cost) : undefined,
  };
}

function parseJsonLines(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value as Record<string, unknown>[];
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

const PRODUCTION_COST_CATEGORIES = ['labor', 'energy', 'packaging', 'other'] as const;

function parseProductionCosts(value: unknown): ProductionCost[] {
  const rows = parseJsonLines(value);
  const out: ProductionCost[] = [];
  for (const row of rows) {
    const category = String(row.category ?? '');
    if (!(PRODUCTION_COST_CATEGORIES as readonly string[]).includes(category)) continue;
    const amount = Number(row.amount) || 0;
    if (amount <= 0) continue;
    out.push({
      category: category as ProductionCost['category'],
      description: row.description ? String(row.description) : undefined,
      amount,
    });
  }
  return out;
}

/** GL account codes for each production-cost category (chart of accounts). */
const PRODUCTION_COST_ACCOUNT_CODES: Record<ProductionCost['category'], string> = {
  labor: '53101',
  energy: '53201',
  packaging: '53301',
  other: '53401',
};

async function findAccountByCodeLocal(companyId: string, code: string): Promise<string | null> {
  const adapter = await getDbAdapter();
  const res = await adapter.query<{ id: string }>(
    `SELECT id FROM accounts WHERE company_id = $1 AND code = $2 LIMIT 1`,
    [companyId, code]
  );
  return res.rows?.[0]?.id ? String(res.rows[0].id) : null;
}

/**
 * Resolve the inventory GL account for a product:
 * product-type default → default_accounts(default_inventory) → code 11301.
 */
async function resolveInventoryAccountId(companyId: string, productId: string): Promise<string | null> {
  const adapter = await getDbAdapter();
  const ptRes = await adapter.query<{ default_inventory_account_id: string | null }>(
    `SELECT pt.default_inventory_account_id
       FROM products p
       LEFT JOIN product_types pt ON pt.id = p.product_type_id
      WHERE p.id = $1::uuid AND p.company_id = $2::uuid LIMIT 1`,
    [productId, companyId]
  );
  if (ptRes.rows?.[0]?.default_inventory_account_id) return String(ptRes.rows[0].default_inventory_account_id);
  const daRes = await adapter.query<{ account_id: string }>(
    `SELECT account_id FROM default_accounts WHERE company_id = $1 AND function_key = 'default_inventory'`,
    [companyId]
  );
  if (daRes.rows?.[0]?.account_id) return String(daRes.rows[0].account_id);
  return findAccountByCodeLocal(companyId, '11301');
}

/** WIP account code — raw-material value parked here between START and COMPLETE. */
const WIP_ACCOUNT_CODE = '11302';
/** Expense account for materials consumed by a CANCELLED work order (no return). */
const PRODUCTION_LOSS_ACCOUNT_CODE = '53501';

/**
 * Resolve the Work-in-Progress GL account:
 * default_accounts(default_wip) → code 11302.
 */
async function resolveWipAccountId(companyId: string): Promise<string | null> {
  const adapter = await getDbAdapter();
  const daRes = await adapter.query<{ account_id: string }>(
    `SELECT account_id FROM default_accounts WHERE company_id = $1 AND function_key = 'default_wip'`,
    [companyId]
  );
  if (daRes.rows?.[0]?.account_id) return String(daRes.rows[0].account_id);
  return findAccountByCodeLocal(companyId, WIP_ACCOUNT_CODE);
}

export const manufacturingApi = {
  // ─── BOM ──────────────────────────────────────────────────────────────────
  async getBoms(companyId: string, ownedByUserId?: string): Promise<{ success: boolean; data?: BOM[]; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      if (ownedByUserId) {
        const uidValidation = validateInput(uuidSchema, ownedByUserId);
        if (!uidValidation.success) return { success: false, error: uidValidation.error };
      }
      if (isElectronPg()) {
        const result = await invokeMfgRpc('getBoms', { ownedByUserId: ownedByUserId || null });
        return result.success
          ? { success: true, data: (result.rows || []).map((r) => mapBomRow(r)) }
          : { success: false, error: result.error };
      }
      const adapter = await getDbAdapter();
      let sql = `SELECT b.*, p.name_ar as product_name FROM boms b LEFT JOIN products p ON b.product_id = p.id WHERE b.company_id = $1`;
      const params: unknown[] = [companyId];
      if (ownedByUserId) {
        sql += ' AND (b.created_by = $2 OR b.created_by IS NULL)';
        params.push(ownedByUserId);
      }
      sql += ' ORDER BY b.version DESC';
      const result = await adapter.query(sql, params);
      if (result.success) {
        const rows = (result.rows || []).map((r: Record<string, unknown>) => mapBomRow(r));
        return { success: true, data: rows };
      }
      return { success: false, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async getBomById(id: string, companyId: string): Promise<{ success: boolean; data?: { bom: BOM; lines: BOMLine[] }; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      if (isElectronPg()) {
        const result = await invokeMfgRpc('getBomById', { id });
        if (!result.success) return { success: false, error: result.error };
        const row = result.rows?.[0];
        if (!row) return { success: false, error: 'Not found' };
        const bom = mapBomRow(row);
        const lines = parseJsonLines(row.lines).map(mapBomLineRow);
        return { success: true, data: { bom, lines } };
      }
      const adapter = await getDbAdapter();
      const bomRes = await adapter.query('SELECT * FROM boms WHERE id = $1 AND company_id = $2 LIMIT 1', [id, companyId]);
      if (!bomRes.success || !bomRes.rows?.[0]) return { success: false, error: bomRes.error || 'Not found' };
      const bom = mapBomRow(bomRes.rows[0] as Record<string, unknown>);
      const linesRes = await adapter.query('SELECT l.*, p.name_ar as material_name FROM bom_lines l LEFT JOIN products p ON l.material_id = p.id WHERE l.bom_id = $1', [id]);
      const lines = (linesRes.rows || []).map((r: Record<string, unknown>) => mapBomLineRow(r));
      return { success: true, data: { bom, lines } };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async createBom(data: Omit<BOM, 'id'> & { lines: Omit<BOMLine, 'id' | 'bomId'>[] }, _userId?: string): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      const validation = validateInput(createBomSchema, data);
      if (!validation.success) return { success: false, error: validation.error };
      if (isElectronPg()) {
        const result = await invokeMfgRpc('createBom', {
          productId: data.productId,
          version: data.version,
          isActive: data.isActive,
          outputQuantity: data.outputQuantity ?? 1,
          totalCost: data.totalCost,
          notes: data.notes,
          lines: (data.lines || []).map((l) => ({ materialId: l.materialId, quantity: l.quantity, unitCost: l.unitCost })),
        });
        if (!result.success) return { success: false, error: result.error };
        const first = result.rows?.[0];
        return first?.id ? { success: true, id: String(first.id) } : { success: false, error: 'Insert failed' };
      }
      // Single atomic CTE (same shape as the Electron RPC handler): header +
      // lines insert together, so a failed lines insert can never leave an
      // orphaned BOM header. Also avoids the `adapter.transaction` result
      // shape mismatch (`results[0]` is `{rows, rowCount}`, not a row array).
      const adapter = await getDbAdapter();
      const params: unknown[] = [data.companyId, data.productId, data.version, data.isActive, data.outputQuantity ?? 1, data.totalCost, data.notes, safeUserId(_userId)];
      const rowValues: string[] = [];
      let idx = 9;
      for (const l of data.lines) {
        rowValues.push(`($${idx}::uuid, $${idx + 1}::numeric, $${idx + 2}::numeric, $${idx + 3}::numeric)`);
        params.push(l.materialId, l.quantity, l.unitCost ?? 0, (l.quantity || 0) * (l.unitCost || 0));
        idx += 4;
      }
      const result = await adapter.query<{ id: string }>(`WITH bom AS (
        INSERT INTO boms (company_id, product_id, version, is_active, output_quantity, total_cost, notes, created_by)
        VALUES ($1::uuid, $2::uuid, $3, $4, $5::numeric, $6::numeric, $7, $8::uuid) RETURNING id
      ), lines AS (
        INSERT INTO bom_lines (bom_id, material_id, quantity, unit_cost, total_cost)
        SELECT bom.id, v.material_id, v.quantity, v.unit_cost, v.total_cost
        FROM bom JOIN (VALUES ${rowValues.join(', ')}) v(material_id, quantity, unit_cost, total_cost) ON true
      ) SELECT id FROM bom`, params);
      const first = result.rows?.[0];
      return first?.id ? { success: true, id: String(first.id) } : { success: false, error: result.error || 'Insert failed' };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async updateBom(id: string, companyId: string, _userId?: string, data: Partial<Omit<BOM, 'id' | 'companyId'>> & { lines?: Partial<BOMLine>[] } = {}): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      if (isElectronPg()) {
        const result = await invokeMfgRpc('updateBom', {
          data: {
            id,
            productId: data.productId ?? undefined,
            version: data.version ?? undefined,
            isActive: data.isActive ?? undefined,
            outputQuantity: data.outputQuantity ?? undefined,
            totalCost: data.totalCost ?? undefined,
            notes: data.notes ?? undefined,
            lines: data.lines === undefined ? undefined : data.lines.map((l) => ({ materialId: l.materialId, quantity: l.quantity, unitCost: l.unitCost })),
          },
        });
        return { success: result.success, error: result.error };
      }
      const adapter = await getDbAdapter();
      const fields: string[] = [];
      const values: unknown[] = [];
      let idx = 1;
      if (data.productId !== undefined) { fields.push(`product_id = $${idx++}`); values.push(data.productId); }
      if (data.version !== undefined) { fields.push(`version = $${idx++}`); values.push(data.version); }
      if (data.isActive !== undefined) { fields.push(`is_active = $${idx++}`); values.push(data.isActive); }
      if (data.outputQuantity !== undefined) { fields.push(`output_quantity = $${idx++}`); values.push(data.outputQuantity); }
      if (data.totalCost !== undefined) { fields.push(`total_cost = $${idx++}`); values.push(data.totalCost); }
      if (data.notes !== undefined) { fields.push(`notes = $${idx++}`); values.push(data.notes); }

      fields.push(`updated_at = NOW()`);
      fields.push(`updated_by = $${idx++}`);
      values.push(_userId ?? null);

      if (fields.length > 0) { values.push(id); values.push(companyId); await adapter.query(`UPDATE boms SET ${fields.join(', ')} WHERE id = $${idx} AND company_id = $${idx + 1}`, values); }
      if (data.lines) {
        await adapter.query('DELETE FROM bom_lines WHERE bom_id = $1 AND $2 = (SELECT company_id FROM boms WHERE id = $1)', [id, companyId]);
        await batchInsertLines(adapter, 'bom_lines', ['bom_id', 'material_id', 'quantity', 'unit_cost', 'total_cost'],
          data.lines.map(l => [id, l.materialId, l.quantity, l.unitCost, (l.quantity || 0) * (l.unitCost || 0)])
        );
      }
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async deleteBom(id: string, companyId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      if (isElectronPg()) {
        const result = await invokeMfgRpc('deleteBom', { id });
        return { success: result.success, error: result.error };
      }
      const adapter = await getDbAdapter();
      await adapter.query('DELETE FROM bom_lines WHERE bom_id = $1 AND $2 = (SELECT company_id FROM boms WHERE id = $1)', [id, companyId]);
      const result = await adapter.query('DELETE FROM boms WHERE id = $1 AND company_id = $2', [id, companyId]);
      return { success: result.success, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  // ─── Work Orders ──────────────────────────────────────────────────────────
  async getWorkOrders(companyId: string, ownedByUserId?: string): Promise<{ success: boolean; data?: WorkOrder[]; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      if (ownedByUserId) {
        const uidValidation = validateInput(uuidSchema, ownedByUserId);
        if (!uidValidation.success) return { success: false, error: uidValidation.error };
      }
      if (isElectronPg()) {
        const result = await invokeMfgRpc('getWorkOrders', { ownedByUserId: ownedByUserId || null });
        return result.success
          ? { success: true, data: (result.rows || []).map((r) => mapWorkOrderRow(r)) }
          : { success: false, error: result.error };
      }
      const adapter = await getDbAdapter();
      let sql = `SELECT w.*, p.name_ar as product_name, e.full_name as supervisor_name FROM work_orders w LEFT JOIN products p ON w.product_id = p.id LEFT JOIN employees e ON w.supervisor_id = e.id WHERE w.company_id = $1`;
      const params: unknown[] = [companyId];
      if (ownedByUserId) {
        sql += ' AND (w.created_by = $2 OR w.created_by IS NULL)';
        params.push(ownedByUserId);
      }
      sql += ' ORDER BY w.order_number DESC';
      const result = await adapter.query(sql, params);
      if (result.success) {
        const rows = (result.rows || []).map((r: Record<string, unknown>) => mapWorkOrderRow(r));
        return { success: true, data: rows };
      }
      return { success: false, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async getWorkOrderById(id: string, companyId: string): Promise<{ success: boolean; data?: { workOrder: WorkOrder; lines: WorkOrderLine[] }; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      if (isElectronPg()) {
        const result = await invokeMfgRpc('getWorkOrderById', { id });
        if (!result.success) return { success: false, error: result.error };
        const row = result.rows?.[0];
        if (!row) return { success: false, error: 'Not found' };
        const workOrder = mapWorkOrderRow(row);
        const lines = parseJsonLines(row.lines).map(mapWorkOrderLineRow);
        return { success: true, data: { workOrder, lines } };
      }
      const adapter = await getDbAdapter();
      const sql = 'SELECT w.*, p.name_ar as product_name, e.full_name as supervisor_name FROM work_orders w LEFT JOIN products p ON w.product_id = p.id LEFT JOIN employees e ON w.supervisor_id = e.id WHERE w.id = $1 AND w.company_id = $2 LIMIT 1';
      const res = await adapter.query(sql, [id, companyId]);
      if (!res.success || !res.rows?.[0]) return { success: false, error: res.error || 'Not found' };
      const workOrder = mapWorkOrderRow(res.rows[0] as Record<string, unknown>);
      const linesRes = await adapter.query('SELECT l.*, p.name_ar as material_name FROM work_order_consumptions l LEFT JOIN products p ON l.material_id = p.id WHERE l.work_order_id = $1', [id]);
      const lines = (linesRes.rows || []).map((r: Record<string, unknown>) => mapWorkOrderLineRow(r));
      return { success: true, data: { workOrder, lines } };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async createWorkOrder(data: Omit<WorkOrder, 'id'> & { lines: Omit<WorkOrderLine, 'id' | 'workOrderId'>[] }, _userId?: string): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      const validation = validateInput(createWorkOrderSchema, data);
      if (!validation.success) return { success: false, error: validation.error };
      // Lot number is generated here (API layer) so the normal screens and the
      // AI agent share one implementation. Format: YYYYMMDD-NNN.
      const batchNumber = data.batchNumber && String(data.batchNumber).trim() !== ''
        ? String(data.batchNumber).trim()
        : await generateBatchNumber(data.companyId);
      if (isElectronPg()) {
        const result = await invokeMfgRpc('createWorkOrder', {
          orderNumber: data.orderNumber,
          productId: data.productId,
          bomId: data.bomId ?? null,
          quantity: data.quantity,
          status: data.status || 'planned',
          plannedStartDate: data.plannedStartDate ?? null,
          plannedEndDate: data.plannedEndDate ?? null,
          totalCost: data.totalCost ?? null,
          batchNumber,
          supervisorId: data.supervisorId ?? null,
          productionCosts: data.productionCosts ?? [],
          notes: data.notes ?? null,
          lines: (data.lines || []).map((l) => ({ materialId: l.materialId, plannedQuantity: l.plannedQuantity, unitCost: l.unitCost })),
        });
        if (!result.success) return { success: false, error: result.error };
        const first = result.rows?.[0];
        return first?.id ? { success: true, id: String(first.id) } : { success: false, error: 'Insert failed' };
      }
      // Single atomic CTE (same shape as the Electron RPC handler): header +
      // consumption lines insert together; avoids the `adapter.transaction`
      // result shape mismatch (`results[0]` is `{rows, rowCount}`, not rows).
      const adapter = await getDbAdapter();
      const params: unknown[] = [data.companyId, data.orderNumber, data.productId, data.bomId ?? null, data.quantity, data.status, data.plannedStartDate ?? null, data.plannedEndDate ?? null, data.totalCost ?? null, batchNumber, safeUserId(data.supervisorId), JSON.stringify(data.productionCosts ?? []), data.notes ?? null, safeUserId(_userId)];
      let sql = `WITH wo AS (
        INSERT INTO work_orders (company_id, order_number, product_id, bom_id, quantity, status, planned_start_date, planned_end_date, total_cost, batch_number, supervisor_id, production_costs, notes, created_by)
        VALUES ($1::uuid, $2, $3::uuid, $4::uuid, $5::numeric, $6, $7::date, $8::date, $9::numeric, $10, $11::uuid, $12::jsonb, $13, $14::uuid) RETURNING id
      )`;
      const woLines = data.lines || [];
      if (woLines.length > 0) {
        const rowValues: string[] = [];
        let idx = 15;
        for (const l of woLines) {
          rowValues.push(`($${idx}::uuid, $${idx + 1}::numeric, $${idx + 2}::numeric)`);
          params.push(l.materialId, l.plannedQuantity, l.unitCost ?? 0);
          idx += 3;
        }
        sql += `, cons AS (
          INSERT INTO work_order_consumptions (work_order_id, material_id, planned_quantity, unit_cost)
          SELECT wo.id, v.material_id, v.planned_quantity, v.unit_cost
          FROM wo JOIN (VALUES ${rowValues.join(', ')}) v(material_id, planned_quantity, unit_cost) ON true
        )`;
      }
      sql += ' SELECT id FROM wo';
      const result = await adapter.query<{ id: string }>(sql, params);
      const first = result.rows?.[0];
      return first?.id ? { success: true, id: String(first.id) } : { success: false, error: result.error || 'Insert failed' };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  /**
   * Preview the next auto-generated batch/lot number (YYYYMMDD-NNN) without
   * creating anything. Used by the form to show the number before saving;
   * the API regenerates it on create when batchNumber is left empty.
   */
  async getNextBatchNumber(companyId: string): Promise<{ success: boolean; number?: string; error?: string }> {
    try {
      const validation = validateInput(companyIdSchema, companyId);
      if (!validation.success) return { success: false, error: validation.error };
      return { success: true, number: await generateBatchNumber(companyId) };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async updateWorkOrder(id: string, companyId: string, _userId?: string, data: Partial<Omit<WorkOrder, 'id' | 'companyId'>> & { lines?: Partial<WorkOrderLine>[] } = {}): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      // Document immutability (best practice): consumption lines are frozen
      // once the order leaves "planned" — stock movements and the WIP posting
      // already reference them. The edit form always sends the lines back, so
      // only an ACTUAL modification is rejected (identical lines pass).
      if (data.lines !== undefined) {
        const adapter = await getDbAdapter();
        const stRes = await adapter.query(
          `SELECT status FROM work_orders WHERE id = $1::uuid AND company_id = $2::uuid LIMIT 1`,
          [id, companyId]
        );
        const st = stRes.rows?.[0]?.status ? String(stRes.rows[0].status) : '';
        if (st && st !== 'planned') {
          const curRes = await adapter.query(
            `SELECT material_id, planned_quantity, unit_cost FROM work_order_consumptions WHERE work_order_id = $1::uuid`,
            [id]
          );
          const fmt = (mid: unknown, qty: unknown, uc: unknown) => `${String(mid)}:${Number(qty) || 0}:${Number(uc) || 0}`;
          const current = ((curRes.rows || []) as Record<string, unknown>[])
            .map((r) => fmt(r.material_id, r.planned_quantity, r.unit_cost)).sort();
          const incoming = data.lines
            .filter((l) => l.materialId && Number(l.plannedQuantity) > 0)
            .map((l) => fmt(l.materialId, l.plannedQuantity, l.unitCost)).sort();
          if (JSON.stringify(current) !== JSON.stringify(incoming)) {
            return { success: false, error: 'لا يمكن تعديل مواد أمر التشغيل بعد البدء — عدّل الكميات الفعلية عند الإكمال' };
          }
        }
      }
      if (isElectronPg()) {
        const result = await invokeMfgRpc('updateWorkOrder', {
          data: {
            id,
            orderNumber: data.orderNumber ?? undefined,
            productId: data.productId ?? undefined,
            bomId: data.bomId ?? undefined,
            quantity: data.quantity ?? undefined,
            producedQuantity: data.producedQuantity ?? undefined,
            status: data.status ?? undefined,
            plannedStartDate: data.plannedStartDate ?? undefined,
            plannedEndDate: data.plannedEndDate ?? undefined,
            actualStartDate: data.actualStartDate ?? undefined,
            actualEndDate: data.actualEndDate ?? undefined,
            totalCost: data.totalCost ?? undefined,
            batchNumber: data.batchNumber ?? undefined,
            supervisorId: data.supervisorId ?? undefined,
            productionCosts: data.productionCosts ?? undefined,
            notes: data.notes ?? undefined,
            lines: data.lines === undefined ? undefined : data.lines.map((l) => ({
              materialId: l.materialId,
              plannedQuantity: l.plannedQuantity,
              actualQuantity: l.actualQuantity,
              unitCost: l.unitCost,
              actualUnitCost: l.actualUnitCost,
            })),
          },
        });
        return { success: result.success, error: result.error };
      }
      const adapter = await getDbAdapter();
      const fields: string[] = [];
      const values: unknown[] = [];
      let idx = 1;
      if (data.orderNumber !== undefined) { fields.push(`order_number = $${idx++}`); values.push(data.orderNumber); }
      if (data.productId !== undefined) { fields.push(`product_id = $${idx++}`); values.push(data.productId); }
      if (data.bomId !== undefined) { fields.push(`bom_id = $${idx++}`); values.push(data.bomId); }
      if (data.quantity !== undefined) { fields.push(`quantity = $${idx++}`); values.push(data.quantity); }
      if (data.producedQuantity !== undefined) { fields.push(`produced_quantity = $${idx++}`); values.push(data.producedQuantity); }
      if (data.status !== undefined) { fields.push(`status = $${idx++}`); values.push(data.status); }
      if (data.plannedStartDate !== undefined) { fields.push(`planned_start_date = $${idx++}`); values.push(data.plannedStartDate); }
      if (data.plannedEndDate !== undefined) { fields.push(`planned_end_date = $${idx++}`); values.push(data.plannedEndDate); }
      if (data.actualStartDate !== undefined) { fields.push(`actual_start_date = $${idx++}`); values.push(data.actualStartDate); }
      if (data.actualEndDate !== undefined) { fields.push(`actual_end_date = $${idx++}`); values.push(data.actualEndDate); }
      if (data.totalCost !== undefined) { fields.push(`total_cost = $${idx++}`); values.push(data.totalCost); }
      if (data.batchNumber !== undefined) { fields.push(`batch_number = $${idx++}`); values.push(data.batchNumber || null); }
      if (data.supervisorId !== undefined) { fields.push(`supervisor_id = $${idx++}`); values.push(safeUserId(data.supervisorId)); }
      if (data.productionCosts !== undefined) { fields.push(`production_costs = $${idx++}::jsonb`); values.push(JSON.stringify(data.productionCosts ?? [])); }
      if (data.notes !== undefined) { fields.push(`notes = $${idx++}`); values.push(data.notes); }

      fields.push(`updated_at = NOW()`);
      fields.push(`updated_by = $${idx++}`);
      values.push(_userId ?? null);

      if (fields.length > 0) { values.push(id); values.push(companyId); await adapter.query(`UPDATE work_orders SET ${fields.join(', ')} WHERE id = $${idx} AND company_id = $${idx + 1}`, values); }
      if (data.lines) {
        await adapter.query('DELETE FROM work_order_consumptions WHERE work_order_id = $1 AND $2 = (SELECT company_id FROM work_orders WHERE id = $1)', [id, companyId]);
        await batchInsertLines(adapter, 'work_order_consumptions', ['work_order_id', 'material_id', 'planned_quantity', 'actual_quantity', 'unit_cost', 'actual_unit_cost'],
          data.lines.map(l => [id, l.materialId, l.plannedQuantity, l.actualQuantity, l.unitCost, l.actualUnitCost])
        );
      }
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async deleteWorkOrder(id: string, companyId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      if (isElectronPg()) {
        const result = await invokeMfgRpc('deleteWorkOrder', { id });
        return { success: result.success, error: result.error };
      }
      const adapter = await getDbAdapter();
      await adapter.query('DELETE FROM work_order_consumptions WHERE work_order_id = $1 AND $2 = (SELECT company_id FROM work_orders WHERE id = $1)', [id, companyId]);
      const result = await adapter.query('DELETE FROM work_orders WHERE id = $1 AND company_id = $2', [id, companyId]);
      return { success: result.success, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  // ─── Production Flow (MRP-lite) ───────────────────────────────────────────
  //
  // Best-practice shop-floor lifecycle:
  //   planned ──start──▶ in_progress ──complete──▶ completed
  //  · start    ISSUES raw materials to the floor (stock 'out', atomic) after
  //             verifying availability — fails with a per-material shortage
  //             report instead of silently going negative.
  //  · complete RECEIVES finished goods into the chosen output warehouse and
  //            posts consumption DELTAS (actual vs issued), rolling total_cost
  //            from actual quantities × actual unit costs.
  // Both run through runTransaction so they work on Electron (guarded
  // db:internal-transaction) AND PGlite without extra RPC handlers.

  async getBomAvailability(
    companyId: string,
    bomId: string,
    quantity: number,
  ): Promise<{
    success: boolean;
    error?: string;
    data?: {
      lines: Array<{ materialId: string; materialName?: string; required: number; available: number; sufficient: boolean }>;
      maxProducible: number | null;
      maxBatches: number | null;
      outputQuantity: number;
      fullyAvailable: boolean;
    };
  }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id: bomId, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      // `quantity` = number of BOM batches requested (work-order semantics).
      const batches = Math.max(0, Number(quantity) || 0);

      const adapter = await getDbAdapter();
      const bomRes = await adapter.query(
        `SELECT output_quantity FROM boms WHERE id = $1::uuid AND company_id = $2::uuid LIMIT 1`,
        [bomId, companyId]
      );
      if (!bomRes.success || !bomRes.rows?.[0]) return { success: false, error: 'التركيبة غير موجودة' };
      const outputQuantity = Math.max(Number(bomRes.rows[0].output_quantity) || 1, 0.0001);

      const res = await adapter.query(
        `SELECT l.material_id,
                p.name_ar AS material_name,
                l.quantity AS per_batch,
                l.quantity * $3::numeric AS required,
                COALESCE(SUM(s.quantity), 0) AS available
           FROM bom_lines l
           LEFT JOIN products p ON p.id = l.material_id
           LEFT JOIN stock s ON s.product_id = l.material_id AND s.company_id = $1::uuid
          WHERE l.bom_id = $2::uuid
          GROUP BY l.material_id, p.name_ar, l.quantity`,
        [companyId, bomId, batches]
      );
      if (!res.success) return { success: false, error: res.error };

      const lines = (res.rows || []).map((r: Record<string, unknown>) => {
        const required = Number(r.required) || 0;
        const available = Number(r.available) || 0;
        return {
          materialId: String(r.material_id),
          materialName: r.material_name ? String(r.material_name) : undefined,
          required,
          available,
          sufficient: available >= required,
        };
      });
      // Max whole batches producible (floor per material), then in units.
      const batchRatios = (res.rows || [])
        .map((r: Record<string, unknown>) => ({ perBatch: Number(r.per_batch) || 0, available: Number(r.available) || 0 }))
        .filter((l) => l.perBatch > 0)
        .map((l) => Math.floor(l.available / l.perBatch));
      const maxBatches = batchRatios.length === 0 ? null : Math.min(...batchRatios);
      const maxProducible = maxBatches == null ? null : Math.floor(maxBatches * outputQuantity * 10000) / 10000;
      const fullyAvailable = lines.every((l) => l.sufficient);

      return { success: true, data: { lines, maxProducible, maxBatches, outputQuantity, fullyAvailable } };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async startWorkOrder(id: string, companyId: string, userId?: string): Promise<{ success: boolean; error?: string; data?: { warehouseId: string | null; issuedLines: number } }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };

      const adapter = await getDbAdapter();

      // Guard: only planned orders can start (idempotency by state machine).
      const woRes = await adapter.query(
        `SELECT w.status, w.output_warehouse_id, w.order_number FROM work_orders w WHERE w.id = $1::uuid AND w.company_id = $2::uuid LIMIT 1`,
        [id, companyId]
      );
      if (!woRes.success || !woRes.rows?.[0]) return { success: false, error: 'أمر التشغيل غير موجود' };
      if (String(woRes.rows[0].status) !== 'planned') {
        return { success: false, error: 'لا يمكن بدء أمر غير مخطط — حالته الحالية ليست "مخطط"' };
      }
      const orderNumber = woRes.rows[0].order_number ? String(woRes.rows[0].order_number) : '';

      const consRes = await adapter.query(
        `SELECT c.material_id, c.planned_quantity, c.unit_cost,
                COALESCE(SUM(s.quantity), 0) AS available
           FROM work_order_consumptions c
            LEFT JOIN stock s ON s.product_id = c.material_id AND s.company_id = $2::uuid
          WHERE c.work_order_id = $1::uuid
          GROUP BY c.material_id, c.planned_quantity, c.unit_cost`,
        [id, companyId]
      );
      if (!consRes.success) return { success: false, error: consRes.error };
      const consRows = (consRes.rows || []) as Record<string, unknown>[];

      // Availability gate AGGREGATED per material — a material may appear on
      // several consumption lines; the TOTAL requirement must fit the stock.
      const reqByMaterial = new Map<string, number>();
      const availByMaterial = new Map<string, number>();
      for (const r of consRows) {
        const mid = String(r.material_id);
        reqByMaterial.set(mid, (reqByMaterial.get(mid) || 0) + (Number(r.planned_quantity) || 0));
        if (!availByMaterial.has(mid)) availByMaterial.set(mid, Number(r.available) || 0);
      }
      const shortages = [...reqByMaterial.entries()]
        .map(([material, req]) => ({ material, req, avail: availByMaterial.get(material) || 0 }))
        .filter((x) => x.avail < x.req);
      if (shortages.length > 0) {
        const detail = shortages.map((s) => `${s.material.slice(0, 8)}… مطلوب ${s.req} / متاح ${s.avail}`).join('، ');
        return { success: false, error: `المخزون لا يكفي لصرف الخامات (${detail})` };
      }

      // Issued-material cost per GL inventory account (for the WIP journal
      // entry): planned qty × unit cost, credited to each material's own
      // inventory account, debited in total to WIP (11302).
      let issuedCostTotal = 0;
      const issueCostByAccount = new Map<string, number>();
      for (const r of consRows) {
        const qty = Number(r.planned_quantity) || 0;
        const uc = Number(r.unit_cost) || 0;
        const cost = qty * uc;
        if (cost <= 0) continue;
        issuedCostTotal += cost;
        const accId = await resolveInventoryAccountId(companyId, String(r.material_id));
        if (!accId) {
          return { success: false, error: 'حساب المخزون غير موجود — قم بتهيئة الحسابات الافتراضية في الإعدادات' };
        }
        issueCostByAccount.set(accId, (issueCostByAccount.get(accId) || 0) + cost);
      }
      issuedCostTotal = Math.round(issuedCostTotal * 100) / 100;

      // Issue from the richest warehouse of each material (same one the
      // availability check read) — first active warehouse for FG is NOT used
      // here because raw materials live wherever stock rows say they are.
      const statements: Array<{ sql: string; params?: unknown[] }> = [];
      const whRes = await adapter.query('SELECT id FROM warehouses WHERE company_id = $1 ORDER BY created_at ASC LIMIT 1', [companyId]);
      const defaultWh = whRes.success && whRes.rows?.[0]?.id ? String(whRes.rows[0].id) : null;
      const issuedLines = consRows.length;

      for (const r of consRows) {
        const materialId = String(r.material_id);
        const qty = Number(r.planned_quantity) || 0;
        if (qty <= 0) continue;
        const whRes2 = await adapter.query(
          `SELECT st.warehouse_id FROM stock st WHERE st.company_id = $1::uuid AND st.product_id = $2::uuid ORDER BY st.quantity DESC LIMIT 1`,
          [companyId, materialId]
        );
        const whId = whRes2.success && whRes2.rows?.[0]?.warehouse_id ? String(whRes2.rows[0].warehouse_id) : defaultWh;
        if (!whId) continue;

        statements.push({
          sql: `INSERT INTO stock (company_id, product_id, warehouse_id, quantity) SELECT $1::uuid, $2::uuid, $3::uuid, 0 WHERE NOT EXISTS (SELECT 1 FROM stock WHERE company_id = $1::uuid AND product_id = $2::uuid AND warehouse_id = $3::uuid)`,
          params: [companyId, materialId, whId],
        });
        statements.push({
          sql: `INSERT INTO stock_movements (company_id, product_id, warehouse_id, type, quantity, reference, notes, created_by) VALUES ($1::uuid, $2::uuid, $3::uuid, 'out', $4::numeric, $5, $6, $7)`,
          params: [companyId, materialId, whId, qty, id, 'صرف خامات لأمر تشغيل', userId ?? null],
        });
        statements.push({
          sql: `UPDATE stock SET quantity = quantity - $1::numeric, updated_at = NOW() WHERE company_id = $2::uuid AND product_id = $3::uuid AND warehouse_id = $4::uuid`,
          params: [qty, companyId, materialId, whId],
        });
      }

      // WIP journal entry (best practice — IAS 2): raw-material value leaves
      // inventory NOW (at issue) and parks in WIP until completion.
      //   DR 11302 WIP            — issued material cost (total)
      //   CR inventory account(s) — per material's own account
      if (issuedCostTotal > 0) {
        const wipAccountId = await resolveWipAccountId(companyId);
        if (!wipAccountId) {
          return { success: false, error: `حساب بضاعة تحت التشغيل (${WIP_ACCOUNT_CODE}) غير موجود في شجرة الحسابات` };
        }
        const entries: Array<{ accountId: string; debit: number; credit: number; memo?: string }> = [
          { accountId: wipAccountId, debit: issuedCostTotal, credit: 0, memo: `صرف خامات - ${orderNumber || id}` },
        ];
        for (const [accId, amount] of issueCostByAccount) {
          entries.push({ accountId: accId, debit: 0, credit: Math.round(amount * 100) / 100, memo: 'مواد خام مصروفة لأمر تشغيل' });
        }
        statements.push(buildJournalEntryStatement(companyId, {
          reference: orderNumber || String(id),
          description: `صرف خامات أمر التشغيل ${orderNumber}`.trim(),
          date: new Date().toISOString().split('T')[0],
          totalAmount: issuedCostTotal,
          entries,
        }));
      }

      statements.push({
        sql: `UPDATE work_orders SET status = 'in_progress', actual_start_date = CURRENT_DATE, wip_materials_cost = $3::numeric${userId ? ', updated_by = $4::uuid' : ''} WHERE id = $1::uuid AND company_id = $2::uuid`,
        params: userId ? [id, companyId, issuedCostTotal, userId] : [id, companyId, issuedCostTotal],
      });

      const result = await runTransaction(statements);
      if (!result.success) return { success: false, error: result.error };
      return { success: true, data: { warehouseId: defaultWh, issuedLines } };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async completeWorkOrder(
    id: string,
    companyId: string,
    opts: { producedQuantity?: number; outputWarehouseId?: string | null; userId?: string } = {},
  ): Promise<{ success: boolean; error?: string; data?: { producedQuantity: number; totalCost: number; unitCost: number; outputWarehouseId: string | null } }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };

      const adapter = await getDbAdapter();
      const woRes = await adapter.query(
        `SELECT w.status, w.quantity, w.produced_quantity, w.output_warehouse_id, w.bom_id, w.product_id,
                w.order_number, w.production_costs, w.wip_materials_cost,
                COALESCE(b.output_quantity, 1) AS bom_output_quantity
           FROM work_orders w
            LEFT JOIN boms b ON b.id = w.bom_id
          WHERE w.id = $1::uuid AND w.company_id = $2::uuid LIMIT 1`,
        [id, companyId]
      );
      if (!woRes.success || !woRes.rows?.[0]) return { success: false, error: 'أمر التشغيل غير موجود' };
      const wo = woRes.rows[0];
      if (String(wo.status) !== 'in_progress') {
        return { success: false, error: 'الإكمال متاح فقط لأوامر قيد التشغيل — ابدأ الأمر أولاُ ليُصرف خاماته' };
      }
      const productionCosts = parseProductionCosts(wo.production_costs);
      const productionCostsTotal = Math.round(productionCosts.reduce((s, c) => s + c.amount, 0) * 100) / 100;

      // Expected output = number of batches × BOM output quantity per batch.
      const bomOutputQty = Math.max(Number(wo.bom_output_quantity) || 1, 0);
      const expectedOutput = Math.round((Number(wo.quantity) || 0) * bomOutputQty * 10000) / 10000;
      const producedQty = Math.max(0, Number(opts.producedQuantity ?? expectedOutput) || 0);
      const whRes = await adapter.query('SELECT id FROM warehouses WHERE company_id = $1 ORDER BY created_at ASC LIMIT 1', [companyId]);
      const fallbackWh = whRes.success && whRes.rows?.[0]?.id ? String(whRes.rows[0].id) : null;
      const outputWh = opts.outputWarehouseId || (wo.output_warehouse_id ? String(wo.output_warehouse_id) : fallbackWh);

      const consRes = await adapter.query(
        `SELECT c.material_id, c.planned_quantity, c.actual_quantity, c.unit_cost, c.actual_unit_cost
           FROM work_order_consumptions c WHERE c.work_order_id = $1::uuid`,
        [id]
      );
      if (!consRes.success) return { success: false, error: consRes.error };
      const consRows = (consRes.rows || []) as Record<string, unknown>[];

      // Consumption DELTA vs what START already issued (planned quantities):
      //   delta > 0 → extra issue (out); delta < 0 → return surplus (in).
      // Material cost rolls up from ACTUAL qty × ACTUAL unit cost (fallback unit_cost);
      // production costs (labor/energy/packaging/other) are added on top.
      const statements: Array<{ sql: string; params?: unknown[] }> = [];
      let materialsCost = 0;

      for (const r of consRows) {
        const materialId = String(r.material_id);
        const planned = Number(r.planned_quantity) || 0;
        const actual = Number(r.actual_quantity) || planned;
        const unitCost = Number(r.actual_unit_cost ?? r.unit_cost) || 0;
        materialsCost += actual * unitCost;
        const delta = Math.round((actual - planned) * 10000) / 10000;
        if (delta === 0) continue;

        const whRes2 = await adapter.query(
          `SELECT st.warehouse_id FROM stock st WHERE st.company_id = $1::uuid AND st.product_id = $2::uuid ORDER BY st.quantity DESC LIMIT 1`,
          [companyId, materialId]
        );
        const whId = whRes2.success && whRes2.rows?.[0]?.warehouse_id ? String(whRes2.rows[0].warehouse_id) : fallbackWh;
        if (!whId) continue;

        statements.push({
          sql: `INSERT INTO stock (company_id, product_id, warehouse_id, quantity) SELECT $1::uuid, $2::uuid, $3::uuid, 0 WHERE NOT EXISTS (SELECT 1 FROM stock WHERE company_id = $1::uuid AND product_id = $2::uuid AND warehouse_id = $3::uuid)`,
          params: [companyId, materialId, whId],
        });
        if (delta > 0) {
          statements.push({
            sql: `INSERT INTO stock_movements (company_id, product_id, warehouse_id, type, quantity, reference, notes, created_by) VALUES ($1::uuid, $2::uuid, $3::uuid, 'out', $4::numeric, $5, $6, $7)`,
            params: [companyId, materialId, whId, delta, id, 'استهلاك فعلي إضافي', opts.userId ?? null],
          });
          statements.push({
            sql: `UPDATE stock SET quantity = quantity - $1::numeric, updated_at = NOW() WHERE company_id = $2::uuid AND product_id = $3::uuid AND warehouse_id = $4::uuid`,
            params: [delta, companyId, materialId, whId],
          });
        } else {
          statements.push({
            sql: `INSERT INTO stock_movements (company_id, product_id, warehouse_id, type, quantity, reference, notes, created_by) VALUES ($1::uuid, $2::uuid, $3::uuid, 'in', $4::numeric, $5, $6, $7)`,
            params: [companyId, materialId, whId, -delta, id, 'إرجاع فائض خامات', opts.userId ?? null],
          });
          statements.push({
            sql: `UPDATE stock SET quantity = quantity + $1::numeric, updated_at = NOW() WHERE company_id = $2::uuid AND product_id = $3::uuid AND warehouse_id = $4::uuid`,
            params: [-delta, companyId, materialId, whId],
          });
        }
      }

      if (outputWh && producedQty > 0) {
        statements.push({
          sql: `INSERT INTO stock (company_id, product_id, warehouse_id, quantity) SELECT $1::uuid, $2::uuid, $3::uuid, 0 WHERE NOT EXISTS (SELECT 1 FROM stock WHERE company_id = $1::uuid AND product_id = $2::uuid AND warehouse_id = $3::uuid)`,
          params: [companyId, String(wo.product_id ?? ''), outputWh],
        });
        statements.push({
          sql: `INSERT INTO stock_movements (company_id, product_id, warehouse_id, type, quantity, reference, notes, created_by) VALUES ($1::uuid, $2::uuid, $3::uuid, 'in', $4::numeric, $5, $6, $7)`,
          params: [companyId, String(wo.product_id ?? ''), outputWh, producedQty, id, 'توريد منتج تام الإنتاج', opts.userId ?? null],
        });
        statements.push({
          sql: `UPDATE stock SET quantity = quantity + $1::numeric, updated_at = NOW() WHERE company_id = $2::uuid AND product_id = $3::uuid AND warehouse_id = $4::uuid`,
          params: [producedQty, companyId, String(wo.product_id ?? ''), outputWh],
        });
      }

      // Total production cost = materials + labor/energy/packaging/other.
      const materialsCostRounded = Math.round(materialsCost * 100) / 100;
      const totalCost = Math.round((materialsCost + productionCostsTotal) * 100) / 100;
      const wipPosted = Math.round((Number(wo.wip_materials_cost) || 0) * 100) / 100;

      // Unit cost = total production cost ÷ actual produced quantity.
      const unitCostNew = producedQty > 0 && totalCost > 0
        ? Math.round((totalCost / producedQty) * 10000) / 10000
        : 0;

      // Update the product cost with the MOVING WEIGHTED AVERAGE method
      // (IAS 2): blend the existing on-hand stock value with the new
      // production value instead of overwriting it. Stock is read BEFORE the
      // receipt statements execute (same transaction), so existingQty
      // excludes the quantity being received now.
      if (producedQty > 0 && totalCost > 0) {
        const prodId = String(wo.product_id ?? '');
        const stockRes = await adapter.query(
          `SELECT COALESCE(SUM(quantity), 0) AS q FROM stock WHERE company_id = $1::uuid AND product_id = $2::uuid`,
          [companyId, prodId]
        );
        const prodRes = await adapter.query(
          `SELECT cost_price FROM products WHERE id = $1::uuid AND company_id = $2::uuid`,
          [prodId, companyId]
        );
        const existingQty = Math.max(0, Number(stockRes.rows?.[0]?.q) || 0);
        const oldCost = Math.max(0, Number(prodRes.rows?.[0]?.cost_price) || 0);
        const blended = existingQty + producedQty;
        const newCostPrice = blended > 0
          ? Math.round(((existingQty * oldCost + producedQty * unitCostNew) / blended) * 10000) / 10000
          : unitCostNew;
        statements.push({
          sql: `UPDATE products SET cost_price = $1::numeric, updated_at = NOW() WHERE id = $2::uuid AND company_id = $3::uuid`,
          params: [newCostPrice, prodId, companyId],
        });
      }

      // GL posting (same atomic transaction as stock movements).
      // WIP flow (orders started after migration 0007 — wipPosted > 0):
      //   DR finished-goods inventory — total production cost
      //   CR WIP (11302)              — material cost issued at START
      //   CR inventory                — extra consumption beyond issued (Δ>0)
      //   DR inventory                — surplus returned to stock    (Δ<0)
      //   CR 53xxx                    — labor/energy/packaging/other
      // Legacy flow (wipPosted = 0): materials credited straight to inventory.
      if (totalCost > 0) {
        const inventoryAccountId = await resolveInventoryAccountId(companyId, String(wo.product_id ?? ''));
        if (!inventoryAccountId) {
          return { success: false, error: 'حساب المخزون غير موجود — قم بتهيئة الحسابات الافتراضية في الإعدادات' };
        }
        const entries: Array<{ accountId: string; debit: number; credit: number; memo?: string }> = [
          { accountId: inventoryAccountId, debit: totalCost, credit: 0, memo: `إنتاج تام - ${String(wo.order_number ?? '')}` },
        ];
        if (wipPosted > 0) {
          const wipAccountId = await resolveWipAccountId(companyId);
          if (!wipAccountId) {
            return { success: false, error: `حساب بضاعة تحت التشغيل (${WIP_ACCOUNT_CODE}) غير موجود في شجرة الحسابات` };
          }
          entries.push({ accountId: wipAccountId, debit: 0, credit: wipPosted, memo: 'مواد خام مصروفة عند البدء' });
          const delta = Math.round((materialsCostRounded - wipPosted) * 100) / 100;
          if (delta > 0) {
            entries.push({ accountId: inventoryAccountId, debit: 0, credit: delta, memo: 'استهلاك فعلي إضافي' });
          } else if (delta < 0) {
            entries.push({ accountId: inventoryAccountId, debit: -delta, credit: 0, memo: 'إرجاع فائض خامات' });
          }
        } else if (materialsCostRounded > 0) {
          entries.push({ accountId: inventoryAccountId, debit: 0, credit: materialsCostRounded, memo: 'مواد خام مستهلكة' });
        }
        for (const pc of productionCosts) {
          const accId = await findAccountByCodeLocal(companyId, PRODUCTION_COST_ACCOUNT_CODES[pc.category]);
          if (!accId) {
            return { success: false, error: `حساب تكاليف الإنتاج (${PRODUCTION_COST_ACCOUNT_CODES[pc.category]}) غير موجود في شجرة الحسابات` };
          }
          entries.push({ accountId: accId, debit: 0, credit: pc.amount, memo: pc.description || undefined });
        }
        statements.push(buildJournalEntryStatement(companyId, {
          reference: String(wo.order_number ?? id),
          description: `تكاليف إنتاج أمر التشغيل ${String(wo.order_number ?? '')}`,
          date: new Date().toISOString().split('T')[0],
          totalAmount: totalCost,
          entries,
        }));
      }

      statements.push({
        sql: `UPDATE work_orders SET status = 'completed', actual_end_date = CURRENT_DATE, produced_quantity = $3::numeric, total_cost = $4::numeric, output_warehouse_id = COALESCE($5::uuid, output_warehouse_id), updated_at = NOW()${opts.userId ? ', updated_by = $6::uuid' : ''} WHERE id = $1::uuid AND company_id = $2::uuid`,
        params: opts.userId
          ? [id, companyId, producedQty, totalCost, outputWh, opts.userId]
          : [id, companyId, producedQty, totalCost, outputWh],
      });

      const result = await runTransaction(statements);
      if (!result.success) return { success: false, error: result.error };
      return {
        success: true,
        data: { producedQuantity: producedQty, totalCost, unitCost: unitCostNew, outputWarehouseId: outputWh },
      };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  /**
   * Cancel a work order — an action separate from the production flow.
   * Allowed from planned / in_progress only (completed orders cannot be
   * cancelled). When cancelling an in_progress order with `returnMaterials`
   * (default true), the quantities issued at START are returned to stock
   * atomically in the same transaction as the status change.
   */
  async cancelWorkOrder(
    id: string,
    companyId: string,
    opts: { returnMaterials?: boolean; userId?: string } = {},
  ): Promise<{ success: boolean; error?: string; data?: { returnedLines: number } }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };

      const adapter = await getDbAdapter();
      const woRes = await adapter.query(
        `SELECT w.status, w.wip_materials_cost, w.order_number FROM work_orders w WHERE w.id = $1::uuid AND w.company_id = $2::uuid LIMIT 1`,
        [id, companyId]
      );
      if (!woRes.success || !woRes.rows?.[0]) return { success: false, error: 'أمر التشغيل غير موجود' };
      const status = String(woRes.rows[0].status);
      const wipPosted = Math.round((Number(woRes.rows[0].wip_materials_cost) || 0) * 100) / 100;
      const orderNumber = woRes.rows[0].order_number ? String(woRes.rows[0].order_number) : '';
      if (status === 'completed') {
        return { success: false, error: 'لا يمكن إلغاء أمر مكتمل — الإنتاج تم توريده للمخزون' };
      }
      if (status === 'cancelled') {
        return { success: false, error: 'الأمر ملغي بالفعل' };
      }

      const returnMaterials = opts.returnMaterials !== false && status === 'in_progress';
      const statements: Array<{ sql: string; params?: unknown[] }> = [];
      let returnedLines = 0;
      // Per-account material cost for the WIP reversal journal entry.
      const returnCostByAccount = new Map<string, number>();
      let returnCostRawTotal = 0;

      if (returnMaterials) {
        // START issued each consumption's planned_quantity — return exactly that.
        const consRes = await adapter.query(
          `SELECT c.material_id, c.planned_quantity, c.unit_cost
              FROM work_order_consumptions c WHERE c.work_order_id = $1::uuid`,
          [id]
        );
        if (!consRes.success) return { success: false, error: consRes.error };
        const whRes = await adapter.query('SELECT id FROM warehouses WHERE company_id = $1 ORDER BY created_at ASC LIMIT 1', [companyId]);
        const fallbackWh = whRes.success && whRes.rows?.[0]?.id ? String(whRes.rows[0].id) : null;

        for (const r of (consRes.rows || []) as Record<string, unknown>[]) {
          const materialId = String(r.material_id);
          const qty = Number(r.planned_quantity) || 0;
          if (qty <= 0) continue;
          const whRes2 = await adapter.query(
            `SELECT st.warehouse_id FROM stock st WHERE st.company_id = $1::uuid AND st.product_id = $2::uuid ORDER BY st.quantity DESC LIMIT 1`,
            [companyId, materialId]
          );
          const whId = whRes2.success && whRes2.rows?.[0]?.warehouse_id ? String(whRes2.rows[0].warehouse_id) : fallbackWh;
          if (!whId) continue;
          statements.push({
            sql: `INSERT INTO stock (company_id, product_id, warehouse_id, quantity) SELECT $1::uuid, $2::uuid, $3::uuid, 0 WHERE NOT EXISTS (SELECT 1 FROM stock WHERE company_id = $1::uuid AND product_id = $2::uuid AND warehouse_id = $3::uuid)`,
            params: [companyId, materialId, whId],
          });
          statements.push({
            sql: `INSERT INTO stock_movements (company_id, product_id, warehouse_id, type, quantity, reference, notes, created_by) VALUES ($1::uuid, $2::uuid, $3::uuid, 'in', $4::numeric, $5, $6, $7)`,
            params: [companyId, materialId, whId, qty, id, 'إلغاء أمر تشغيل — إرجاع خامات', opts.userId ?? null],
          });
          statements.push({
            sql: `UPDATE stock SET quantity = quantity + $1::numeric, updated_at = NOW() WHERE company_id = $2::uuid AND product_id = $3::uuid AND warehouse_id = $4::uuid`,
            params: [qty, companyId, materialId, whId],
          });
          returnedLines++;
          // Mirror of the START journal entry: cost returns to each
          // material's own inventory account.
          const cost = qty * (Number(r.unit_cost) || 0);
          if (cost > 0 && wipPosted > 0) {
            const accId = await resolveInventoryAccountId(companyId, materialId);
            if (accId) {
              returnCostByAccount.set(accId, (returnCostByAccount.get(accId) || 0) + cost);
              returnCostRawTotal += cost;
            }
          }
        }
      }

      // WIP settlement:
      //  - materials RETURNED  → DR inventory account(s), CR WIP (reversal)
      //  - materials NOT returned → DR 53501 production losses, CR WIP
      //    (consumed value is expensed — abnormal loss per IAS 2)
      if (wipPosted > 0 && status === 'in_progress') {
        const wipAccountId = await resolveWipAccountId(companyId);
        if (!wipAccountId) {
          return { success: false, error: `حساب بضاعة تحت التشغيل (${WIP_ACCOUNT_CODE}) غير موجود في شجرة الحسابات` };
        }
        const entries: Array<{ accountId: string; debit: number; credit: number; memo?: string }> = [];
        if (returnMaterials && returnCostByAccount.size > 0) {
          const creditTotal = Math.round(returnCostRawTotal * 100) / 100;
          let debitTotal = 0;
          for (const [accId, amount] of returnCostByAccount) {
            const rounded = Math.round(amount * 100) / 100;
            entries.push({ accountId: accId, debit: rounded, credit: 0, memo: 'إرجاع خامات أمر تشغيل ملغي' });
            debitTotal += rounded;
          }
          // Absorb rounding difference on the first entry so DR ≡ CR exactly.
          const diff = Math.round((creditTotal - debitTotal) * 100) / 100;
          if (diff !== 0 && entries.length > 0) entries[0].debit = Math.round((entries[0].debit + diff) * 100) / 100;
          entries.push({ accountId: wipAccountId, debit: 0, credit: creditTotal, memo: `عكس قيد خامات - ${orderNumber || id}` });
        } else {
          const lossAccountId = await findAccountByCodeLocal(companyId, PRODUCTION_LOSS_ACCOUNT_CODE);
          if (!lossAccountId) {
            return { success: false, error: `حساب خسائر أوامر التشغيل (${PRODUCTION_LOSS_ACCOUNT_CODE}) غير موجود في شجرة الحسابات` };
          }
          entries.push({ accountId: lossAccountId, debit: wipPosted, credit: 0, memo: `خامات مستهلكة لأمر ملغي - ${orderNumber || id}` });
          entries.push({ accountId: wipAccountId, debit: 0, credit: wipPosted, memo: `عكس قيد خامات - ${orderNumber || id}` });
        }
        statements.push(buildJournalEntryStatement(companyId, {
          reference: orderNumber || String(id),
          description: `إلغاء أمر التشغيل ${orderNumber} — تسوية بضاعة تحت التشغيل`.trim(),
          date: new Date().toISOString().split('T')[0],
          totalAmount: wipPosted,
          entries,
        }));
      }

      statements.push({
        sql: `UPDATE work_orders SET status = 'cancelled', wip_materials_cost = 0, updated_at = NOW()${opts.userId ? ', updated_by = $3::uuid' : ''} WHERE id = $1::uuid AND company_id = $2::uuid`,
        params: opts.userId ? [id, companyId, opts.userId] : [id, companyId],
      });

      const result = await runTransaction(statements);
      if (!result.success) return { success: false, error: result.error };
      return { success: true, data: { returnedLines } };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async updateWorkOrderStatus(id: string, companyId: string, status: WorkOrder['status'], _userId?: string, producedQuantity?: number, outputWarehouseId?: string, opts: { returnMaterials?: boolean } = {}): Promise<{ success: boolean; error?: string; data?: { producedQuantity?: number; totalCost?: number; unitCost?: number; outputWarehouseId?: string | null } }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      const statusValidation = validateInput(workOrderStatusSchema, status);
      if (!statusValidation.success) return { success: false, error: statusValidation.error };
      if (_userId) {
        const uidValidation = validateInput(uuidSchema, _userId);
        if (!uidValidation.success) return { success: false, error: uidValidation.error };
      }
      // Unified flow for BOTH environments (Electron + PGlite):
      //   in_progress → startWorkOrder   (issues raw materials atomically)
      //   completed   → completeWorkOrder (FG receipt = batches × BOM output
      //                 + consumption deltas vs issued + cost rollup)
      //   cancelled   → cancelWorkOrder  (separate action; optional return of
      //                 issued materials atomically)
      // Only planned (reopen) stays as a plain update.
      if (status === 'in_progress') {
        const r = await manufacturingApi.startWorkOrder(id, companyId, _userId || undefined);
        return { success: r.success, error: r.error };
      }
      if (status === 'completed') {
        const r = await manufacturingApi.completeWorkOrder(id, companyId, {
          producedQuantity,
          outputWarehouseId: outputWarehouseId || null,
          userId: _userId || undefined,
        });
        return { success: r.success, error: r.error, data: r.data };
      }
      if (status === 'cancelled') {
        const r = await manufacturingApi.cancelWorkOrder(id, companyId, {
          returnMaterials: opts.returnMaterials,
          userId: _userId || undefined,
        });
        return { success: r.success, error: r.error };
      }

      {
        const adapter = await getDbAdapter();
        const result = await adapter.query(
          `UPDATE work_orders SET status = $1, updated_at = NOW()${_userId ? ', updated_by = $2' : ''} WHERE id = $${_userId ? 3 : 2} AND company_id = $${_userId ? 4 : 3}`,
          _userId ? [status, _userId, id, companyId] : [status, id, companyId]
        );
        return { success: result.success, error: result.error };
      }
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async batchUpdateConsumptions(consumptions: { id: string; actualQuantity: number; actualUnitCost: number; unitCost: number }[], companyId: string): Promise<{ success: boolean; error?: string }> {
    try {
      if (isElectronPg()) {
        const result = await invokeMfgRpc('batchUpdateConsumptions', { consumptions });
        return { success: result.success, error: result.error };
      }
      const adapter = await getDbAdapter();
      const queries: { sql: string; params: unknown[] }[] = [];
      for (const c of consumptions) {
        queries.push({
          sql: `UPDATE work_order_consumptions SET actual_quantity = $1, actual_unit_cost = $2 WHERE id = $3 AND work_order_id IN (SELECT id FROM work_orders WHERE company_id = $4)`,
          params: [c.actualQuantity, c.actualUnitCost, c.id, companyId],
        });
      }
      const result = await adapter.transaction(queries);
      return { success: result.success, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async updateConsumption(consumptionId: string, data: { actualQuantity?: number; actualUnitCost?: number }, companyId: string): Promise<{ success: boolean; error?: string }> {
    try {
      if (!companyId) return { success: false, error: 'companyId is required' };
      if (isElectronPg()) {
        const result = await invokeMfgRpc('updateConsumption', {
          id: consumptionId,
          actualQuantity: data.actualQuantity,
          actualUnitCost: data.actualUnitCost,
        });
        return { success: result.success, error: result.error };
      }
      const adapter = await getDbAdapter();
      const fields: string[] = [];
      const values: unknown[] = [];
      let idx = 1;
      if (data.actualQuantity !== undefined) { fields.push(`actual_quantity = $${idx++}`); values.push(data.actualQuantity); }
      if (data.actualUnitCost !== undefined) { fields.push(`actual_unit_cost = $${idx++}`); values.push(data.actualUnitCost); }
      if (fields.length === 0) return { success: true };
      values.push(consumptionId, companyId);
      const sql = `UPDATE work_order_consumptions SET ${fields.join(', ')} WHERE id = $${idx} AND work_order_id IN (SELECT id FROM work_orders WHERE company_id = $${idx + 1})`;
      const result = await adapter.query(sql, values);
      return { success: result.success, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async getManufacturingKpis(companyId: string): Promise<{ success: boolean; data?: { totalWorkOrders: number; activeOrders: number; completedOrders: number; totalProductionCost: number }; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      const sql = `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status = 'in_progress' OR status = 'planned')::int AS active,
                COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
                COALESCE(SUM(total_cost) FILTER (WHERE status = 'completed'), 0) AS total_cost
           FROM work_orders WHERE company_id = $1`;
      if (isElectronPg()) {
        const result = await invokeMfgRpc('getManufacturingKpis');
        if (!result.success) return { success: false, error: result.error };
        const row = result.rows?.[0];
        return {
          success: true,
          data: {
            totalWorkOrders: Number(row?.total || 0),
            activeOrders: Number(row?.active || 0),
            completedOrders: Number(row?.completed || 0),
            totalProductionCost: Number(row?.total_cost || 0),
          },
        };
      }
      const adapter = await getDbAdapter();
      const result = await adapter.query(sql, [companyId]);
      const row = result.rows?.[0];
      return {
        success: true,
        data: {
          totalWorkOrders: Number(row?.total || 0),
          activeOrders: Number(row?.active || 0),
          completedOrders: Number(row?.completed || 0),
          totalProductionCost: Number(row?.total_cost || 0),
        },
      };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  // ─── Paginated ────────────────────────────────────────────────────────────
  async getBomsPaginated(
    companyId: string,
    page: number,
    pageSize: number,
    filters?: { search?: string; isActive?: boolean }
  ): Promise<PaginatedQueryResult<BOM>> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      const { page: p, pageSize: ps, offset } = clampPageArgs(page, pageSize);
      if (isElectronPg()) {
        const result = await invokeMfgRpc('getBomsPaginated', {
          page: p,
          pageSize: ps,
          search: filters?.search || null,
          isActive: filters?.isActive,
        });
        if (!result.success) return { success: false, error: result.error };
        const rows = result.rows || [];
        const items = rows.map((r) => mapBomRow(r, true));
        const total = rows.length > 0 ? Number(rows[0].total_count) : 0;
        return { success: true, data: paginatedResult(items, total, p, ps) };
      }
      const adapter = await getDbAdapter();

      const conditions: string[] = ['b.company_id = $1'];
      const params: unknown[] = [companyId];
      if (filters?.search) {
        params.push(`%${filters.search}%`);
        conditions.push(`(p.name_ar ILIKE $${params.length} OR b.version ILIKE $${params.length})`);
      }
      if (filters?.isActive !== undefined) {
        params.push(filters.isActive);
        conditions.push(`b.is_active = $${params.length}`);
      }
      const where = conditions.join(' AND ');

      const countResult = await adapter.query(
        `SELECT COUNT(*)::int AS total FROM boms b LEFT JOIN products p ON b.product_id = p.id WHERE ${where}`,
        params
      );
      const total = Number(countResult.rows?.[0]?.total || 0);

      params.push(ps);
      params.push(offset);
      const dataResult = await adapter.query(
        `SELECT b.*, p.name_ar as product_name,
                (SELECT COUNT(*)::int FROM bom_lines bl WHERE bl.bom_id = b.id) AS lines_count
           FROM boms b LEFT JOIN products p ON b.product_id = p.id WHERE ${where} ORDER BY b.version DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      );
      const rows = (dataResult.rows || []).map((r: Record<string, unknown>) => mapBomRow(r, true));
      return { success: true, data: paginatedResult(rows, total, p, ps) };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async getWorkOrdersPaginated(
    companyId: string,
    page: number,
    pageSize: number,
    filters?: { status?: string }
  ): Promise<PaginatedQueryResult<WorkOrder>> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      const { page: p, pageSize: ps, offset } = clampPageArgs(page, pageSize);
      if (isElectronPg()) {
        const result = await invokeMfgRpc('getWorkOrdersPaginated', {
          page: p,
          pageSize: ps,
          status: filters?.status || null,
        });
        if (!result.success) return { success: false, error: result.error };
        const rows = result.rows || [];
        const items = rows.map((r) => mapWorkOrderRow(r));
        const total = rows.length > 0 ? Number(rows[0].total_count) : 0;
        return { success: true, data: paginatedResult(items, total, p, ps) };
      }
      const adapter = await getDbAdapter();

      const conditions: string[] = ['w.company_id = $1'];
      const params: unknown[] = [companyId];
      if (filters?.status) {
        params.push(filters.status);
        conditions.push(`w.status = $${params.length}`);
      }
      const where = conditions.join(' AND ');

      const countResult = await adapter.query(
        `SELECT COUNT(*)::int AS total FROM work_orders w WHERE ${where}`,
        params
      );
      const total = Number(countResult.rows?.[0]?.total || 0);

      params.push(ps);
      params.push(offset);
      const dataResult = await adapter.query(
        `SELECT w.*, p.name_ar as product_name, e.full_name as supervisor_name FROM work_orders w LEFT JOIN products p ON w.product_id = p.id LEFT JOIN employees e ON w.supervisor_id = e.id WHERE ${where} ORDER BY w.order_number DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      );
      const rows = (dataResult.rows || []).map((r: Record<string, unknown>) => mapWorkOrderRow(r));
      return { success: true, data: paginatedResult(rows, total, p, ps) };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },
};

async function batchInsertLines(adapter: Awaited<ReturnType<typeof getDbAdapter>>, table: string, columns: string[], rows: unknown[][]): Promise<void> {
  if (rows.length === 0) return;
  const colCount = columns.length;
  const placeholders = rows.map((_, ri) => {
    const base = ri * colCount;
    return `(${Array.from({ length: colCount }, (_, ci) => `$${base + ci + 1}`).join(',')})`;
  }).join(',');
  const values = rows.flat();
  await adapter.query(`INSERT INTO ${table} (${columns.join(',')}) VALUES ${placeholders}`, values);
}

/**
 * Lot/batch number: today's local date + daily sequential suffix,
 * e.g. 20260827-001. Collision-safe via existence check + retry.
 */
async function generateBatchNumber(companyId: string): Promise<string> {
  const adapter = await getDbAdapter();
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const countRes = await adapter.query(
    `SELECT COUNT(*)::int AS n FROM work_orders WHERE company_id = $1::uuid AND batch_number LIKE $2`,
    [companyId, `${ymd}%`]
  );
  const seq = Number(countRes.rows?.[0]?.n ?? 0) + 1;
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = `${ymd}-${String(seq + attempt).padStart(3, '0')}`;
    const exists = await adapter.query(
      `SELECT 1 FROM work_orders WHERE company_id = $1::uuid AND batch_number = $2 LIMIT 1`,
      [companyId, candidate]
    );
    if (!exists.rows?.length) return candidate;
  }
  return `${ymd}-${String(Date.now()).slice(-6)}`;
}
