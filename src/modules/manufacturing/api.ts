import { z } from 'zod';
import { getDbAdapter } from '@/core/database/adapters';
import { validateInput, idCompanySchema, companyIdSchema, uuidSchema, createBomSchema, createWorkOrderSchema } from '@/core/utils/validation';
import { clampPageArgs, paginatedResult, type PaginatedQueryResult } from '@/core/utils/pagination';
import type { BOM, BOMLine, WorkOrder, WorkOrderLine } from './types';

const workOrderStatusSchema = z.enum(['planned', 'in_progress', 'completed', 'cancelled']);

export const manufacturingApi = {
  // ─── BOM ──────────────────────────────────────────────────────────────────
  async getBoms(companyId: string, ownedByUserId?: string): Promise<{ success: boolean; data?: BOM[]; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      const adapter = await getDbAdapter();
      let sql = `SELECT b.*, p.name_ar as product_name FROM boms b LEFT JOIN products p ON b.product_id = p.id WHERE b.company_id = $1`;
      const params: unknown[] = [companyId];
      if (ownedByUserId) {
        const uidValidation = validateInput(uuidSchema, ownedByUserId);
        if (!uidValidation.success) return { success: false, error: uidValidation.error };
        sql += ' AND (b.created_by = $2 OR b.created_by IS NULL)';
        params.push(ownedByUserId);
      }
      sql += ' ORDER BY b.version DESC';
      const result = await adapter.query(sql, params);
      if (result.success) {
        const rows = (result.rows || []).map((r: Record<string, unknown>) => ({
          id: String(r.id),
          companyId: String(r.company_id),
          productId: String(r.product_id),
          productName: r.product_name ? String(r.product_name) : undefined,
          version: String(r.version),
          isActive: r.is_active === true || r.is_active === 'true',
          totalCost: r.total_cost ? Number(r.total_cost) : undefined,
          notes: r.notes ? String(r.notes) : undefined,
          createdBy: r.created_by ? String(r.created_by) : undefined,
          updatedBy: r.updated_by ? String(r.updated_by) : undefined,
          updatedAt: r.updated_at ? String(r.updated_at) : undefined,
        }));
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
      const adapter = await getDbAdapter();
      const bomRes = await adapter.query('SELECT * FROM boms WHERE id = $1 AND company_id = $2 LIMIT 1', [id, companyId]);
      if (!bomRes.success || !bomRes.rows?.[0]) return { success: false, error: bomRes.error || 'Not found' };
      const row = bomRes.rows[0];
      const bom: BOM = {
        id: String(row.id),
        companyId: String(row.company_id),
        productId: String(row.product_id),
        version: String(row.version),
        isActive: row.is_active === true || row.is_active === 'true',
        totalCost: row.total_cost ? Number(row.total_cost) : undefined,
        notes: row.notes ? String(row.notes) : undefined,
        createdBy: row.created_by ? String(row.created_by) : undefined,
        updatedBy: row.updated_by ? String(row.updated_by) : undefined,
        updatedAt: row.updated_at ? String(row.updated_at) : undefined,
      };
      const linesRes = await adapter.query('SELECT l.*, p.name_ar as material_name FROM bom_lines l LEFT JOIN products p ON l.material_id = p.id WHERE l.bom_id = $1', [id]);
      const lines = (linesRes.rows || []).map((r: Record<string, unknown>) => ({
        id: String(r.id),
        bomId: String(r.bom_id),
        materialId: String(r.material_id),
        materialName: r.material_name ? String(r.material_name) : undefined,
        quantity: Number(r.quantity) || 0,
        unitCost: r.unit_cost ? Number(r.unit_cost) : undefined,
        totalCost: r.total_cost ? Number(r.total_cost) : undefined,
      }));
      return { success: true, data: { bom, lines } };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async createBom(data: Omit<BOM, 'id'> & { lines: Omit<BOMLine, 'id' | 'bomId'>[] }, _userId?: string): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      const validation = validateInput(createBomSchema, data);
      if (!validation.success) return { success: false, error: validation.error };
      const adapter = await getDbAdapter();
      const tx = await adapter.transaction([
        { sql: `INSERT INTO boms (company_id, product_id, version, is_active, total_cost, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, params: [data.companyId, data.productId, data.version, data.isActive, data.totalCost, data.notes, _userId ?? null] },
      ]);
      if (tx.success && tx.results?.[0]?.[0]) {
        const bomId = tx.results[0][0].id as string;
        await batchInsertLines(adapter, 'bom_lines', ['bom_id', 'material_id', 'quantity', 'unit_cost', 'total_cost'],
          data.lines.map(l => [bomId, l.materialId, l.quantity, l.unitCost, (l.quantity || 0) * (l.unitCost || 0)])
        );
        return { success: true, id: bomId };
      }
      return { success: false, error: tx.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async updateBom(id: string, companyId: string, _userId?: string, data: Partial<Omit<BOM, 'id' | 'companyId'>> & { lines?: Partial<BOMLine>[] } = {}): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      const adapter = await getDbAdapter();
      const fields: string[] = [];
      const values: unknown[] = [];
      let idx = 1;
      if (data.productId !== undefined) { fields.push(`product_id = $${idx++}`); values.push(data.productId); }
      if (data.version !== undefined) { fields.push(`version = $${idx++}`); values.push(data.version); }
      if (data.isActive !== undefined) { fields.push(`is_active = $${idx++}`); values.push(data.isActive); }
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
      const adapter = await getDbAdapter();
      let sql = `SELECT w.*, p.name_ar as product_name FROM work_orders w LEFT JOIN products p ON w.product_id = p.id WHERE w.company_id = $1`;
      const params: unknown[] = [companyId];
      if (ownedByUserId) {
        const uidValidation = validateInput(uuidSchema, ownedByUserId);
        if (!uidValidation.success) return { success: false, error: uidValidation.error };
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
      const adapter = await getDbAdapter();
      const sql = 'SELECT w.*, p.name_ar as product_name FROM work_orders w LEFT JOIN products p ON w.product_id = p.id WHERE w.id = $1 AND w.company_id = $2 LIMIT 1';
      const params = [id, companyId];
      const res = await adapter.query(sql, params);
      if (!res.success || !res.rows?.[0]) return { success: false, error: res.error || 'Not found' };
      const workOrder = mapWorkOrderRow(res.rows[0]);
      const linesRes = await adapter.query('SELECT l.*, p.name_ar as material_name FROM work_order_consumptions l LEFT JOIN products p ON l.material_id = p.id WHERE l.work_order_id = $1', [id]);
      const lines = (linesRes.rows || []).map((r: Record<string, unknown>) => ({
        id: String(r.id),
        workOrderId: String(r.work_order_id),
        materialId: String(r.material_id),
        materialName: r.material_name ? String(r.material_name) : undefined,
        plannedQuantity: Number(r.planned_quantity) || 0,
        actualQuantity: r.actual_quantity ? Number(r.actual_quantity) : undefined,
        unitCost: Number(r.unit_cost) || 0,
        actualUnitCost: r.actual_unit_cost ? Number(r.actual_unit_cost) : undefined,
      }));
      return { success: true, data: { workOrder, lines } };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async createWorkOrder(data: Omit<WorkOrder, 'id'> & { lines: Omit<WorkOrderLine, 'id' | 'workOrderId'>[] }, _userId?: string): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      const validation = validateInput(createWorkOrderSchema, data);
      if (!validation.success) return { success: false, error: validation.error };
      const adapter = await getDbAdapter();
      const tx = await adapter.transaction([
        { sql: `INSERT INTO work_orders (company_id, order_number, product_id, bom_id, quantity, status, planned_start_date, planned_end_date, total_cost, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`, params: [data.companyId, data.orderNumber, data.productId, data.bomId, data.quantity, data.status, data.plannedStartDate, data.plannedEndDate, data.totalCost, data.notes, _userId ?? null] },
      ]);
      if (tx.success && tx.results?.[0]?.[0]) {
        const woId = tx.results[0][0].id as string;
        await batchInsertLines(adapter, 'work_order_consumptions', ['work_order_id', 'material_id', 'planned_quantity', 'unit_cost'],
          data.lines.map(l => [woId, l.materialId, l.plannedQuantity, l.unitCost])
        );
        return { success: true, id: woId };
      }
      return { success: false, error: tx.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async updateWorkOrder(id: string, companyId: string, _userId?: string, data: Partial<Omit<WorkOrder, 'id' | 'companyId'>> & { lines?: Partial<WorkOrderLine>[] } = {}): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
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
      const adapter = await getDbAdapter();
      await adapter.query('DELETE FROM work_order_consumptions WHERE work_order_id = $1 AND $2 = (SELECT company_id FROM work_orders WHERE id = $1)', [id, companyId]);
      const result = await adapter.query('DELETE FROM work_orders WHERE id = $1 AND company_id = $2', [id, companyId]);
      return { success: result.success, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async updateWorkOrderStatus(id: string, companyId: string, status: WorkOrder['status'], _userId?: string, producedQuantity?: number): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      const statusValidation = validateInput(workOrderStatusSchema, status);
      if (!statusValidation.success) return { success: false, error: statusValidation.error };
      if (_userId) {
        const uidValidation = validateInput(uuidSchema, _userId);
        if (!uidValidation.success) return { success: false, error: uidValidation.error };
      }
      const adapter = await getDbAdapter();

      if (status === 'in_progress') {
        const result = await adapter.query(
          `UPDATE work_orders SET status = 'in_progress', actual_start_date = $1, updated_at = NOW()${_userId ? ', updated_by = $2' : ''} WHERE id = $${_userId ? 3 : 2} AND company_id = $${_userId ? 4 : 3}`,
          _userId ? [new Date().toISOString(), _userId, id, companyId] : [new Date().toISOString(), id, companyId]
        );
        return { success: result.success, error: result.error };
      }

      if (status === 'completed') {
        const woRes = await adapter.query('SELECT product_id, produced_quantity, quantity FROM work_orders WHERE id = $1 AND company_id = $2', [id, companyId]);
        if (!woRes.success || !woRes.rows?.[0]) return { success: false, error: 'Work order not found' };
        const wo = woRes.rows[0];
        const finalProducedQty = producedQuantity ?? (Number(wo.produced_quantity) || Number(wo.quantity));

        const consRes = await adapter.query('SELECT material_id, planned_quantity FROM work_order_consumptions WHERE work_order_id = $1', [id]);
        const consRows = consRes.success ? (consRes.rows || []) : [];

        const whRes = await adapter.query('SELECT id FROM warehouses WHERE company_id = $1 ORDER BY created_at ASC LIMIT 1', [companyId]);
        const warehouseId = whRes.success && whRes.rows?.[0]?.id ? String(whRes.rows[0].id) : null;

        if (warehouseId) {
          if (consRows.length > 0) {
            const consValues = consRows.map((_c: Record<string, unknown>, i: number) => {
              const off = i * 7;
              return `($${off + 1}, $${off + 2}, $${off + 3}, 'out', $${off + 4}, $${off + 5}, $${off + 6}, $${off + 7})`;
            }).join(', ');
            const consParams = consRows.flatMap((c: Record<string, unknown>) => [
              companyId, String(c.material_id), warehouseId, Number(c.planned_quantity), id, 'Production consumption', _userId ?? null
            ]);
            await adapter.query(
              `INSERT INTO stock_movements (company_id, product_id, warehouse_id, type, quantity, reference, notes, created_by) VALUES ${consValues}`,
              consParams
            );
          }
          await adapter.query(
            `INSERT INTO stock_movements (company_id, product_id, warehouse_id, type, quantity, reference, notes, created_by) VALUES ($1, $2, $3, 'in', $4, $5, $6, $7)`,
            [companyId, String(wo.product_id), warehouseId, finalProducedQty, id, 'Production output', _userId ?? null]
          );
        }

        const result = await adapter.query(
          `UPDATE work_orders SET status = 'completed', actual_end_date = $1, produced_quantity = $2, updated_at = NOW()${_userId ? ', updated_by = $3' : ''} WHERE id = $${_userId ? 4 : 3} AND company_id = $${_userId ? 5 : 4}`,
          _userId ? [new Date().toISOString(), finalProducedQty, _userId, id, companyId] : [new Date().toISOString(), finalProducedQty, id, companyId]
        );
        return { success: result.success, error: result.error };
      }

      {
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
      const adapter = await getDbAdapter();
      const result = await adapter.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status = 'in_progress' OR status = 'planned')::int AS active,
                COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
                COALESCE(SUM(total_cost) FILTER (WHERE status = 'completed'), 0) AS total_cost
           FROM work_orders WHERE company_id = $1`,
        [companyId],
      );
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
      const rows = (dataResult.rows || []).map((r: Record<string, unknown>) => ({
        id: String(r.id),
        companyId: String(r.company_id),
        productId: String(r.product_id),
        productName: r.product_name ? String(r.product_name) : undefined,
        version: String(r.version),
        isActive: r.is_active === true || r.is_active === 'true',
        totalCost: r.total_cost ? Number(r.total_cost) : undefined,
        notes: r.notes ? String(r.notes) : undefined,
        createdBy: r.created_by ? String(r.created_by) : undefined,
        updatedBy: r.updated_by ? String(r.updated_by) : undefined,
        updatedAt: r.updated_at ? String(r.updated_at) : undefined,
        linesCount: r.lines_count ? Number(r.lines_count) : 0,
      }));
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
        `SELECT w.*, p.name_ar as product_name FROM work_orders w LEFT JOIN products p ON w.product_id = p.id WHERE ${where} ORDER BY w.order_number DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      );
      const rows = (dataResult.rows || []).map((r: Record<string, unknown>) => mapWorkOrderRow(r));
      return { success: true, data: paginatedResult(rows, total, p, ps) };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },
};

function mapWorkOrderRow(r: Record<string, unknown>): WorkOrder {
  return {
    id: String(r.id),
    companyId: String(r.company_id),
    orderNumber: String(r.order_number),
    productId: String(r.product_id),
    productName: r.product_name ? String(r.product_name) : undefined,
    bomId: r.bom_id ? String(r.bom_id) : undefined,
    quantity: Number(r.quantity) || 0,
    producedQuantity: r.produced_quantity ? Number(r.produced_quantity) : undefined,
    status: String(r.status) as WorkOrder['status'],
    plannedStartDate: r.planned_start_date ? String(r.planned_start_date) : undefined,
    plannedEndDate: r.planned_end_date ? String(r.planned_end_date) : undefined,
    actualStartDate: r.actual_start_date ? String(r.actual_start_date) : undefined,
    actualEndDate: r.actual_end_date ? String(r.actual_end_date) : undefined,
    totalCost: r.total_cost ? Number(r.total_cost) : undefined,
    notes: r.notes ? String(r.notes) : undefined,
    createdBy: r.created_by ? String(r.created_by) : undefined,
    updatedBy: r.updated_by ? String(r.updated_by) : undefined,
    updatedAt: r.updated_at ? String(r.updated_at) : undefined,
  };
}

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
