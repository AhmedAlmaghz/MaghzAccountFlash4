import { describe, it, expect, beforeEach, vi } from 'vitest';
import { manufacturingApi } from './api';
import { getDbAdapter } from '@/core/database/adapters';

vi.mock('@/core/database/adapters', () => ({
  getDbAdapter: vi.fn(),
  isElectronPg: vi.fn(() => false),
}));

const COMPANY_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const BOM_ID = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22';
const WO_ID = 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33';
const USER_ID = 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44';
const PRODUCT_ID = 'e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a55';

function makeMockAdapter(queryImpl: (sql: string, params: unknown[]) => Promise<{ success: boolean; rows?: unknown[]; error?: string }>) {
  return {
    query: vi.fn().mockImplementation(queryImpl),
    transaction: vi.fn().mockImplementation(async (queries: { sql: string; params: unknown[] }[]) => {
      const results: unknown[][] = [];
      for (const q of queries) {
        const r = await queryImpl(q.sql, q.params);
        results.push(r.rows || []);
      }
      return { success: true, results };
    }),
  };
}

describe('manufacturingApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getBoms', () => {
    it('returns BOMs list scoped to company', async () => {
      const adapter = makeMockAdapter(async (sql, params) => {
        if (sql.includes('FROM boms') && sql.includes('SELECT') && !sql.includes('COUNT')) {
          expect(sql).toContain('WHERE b.company_id = $1');
          expect(params[0]).toBe(COMPANY_ID);
          return {
            success: true,
            rows: [
              { id: BOM_ID, company_id: COMPANY_ID, product_id: PRODUCT_ID, product_name: 'منتج', version: '1.0', is_active: true, total_cost: '5000', notes: 'ملاحظة' },
            ],
          };
        }
        return { success: true, rows: [] };
      });
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

      const res = await manufacturingApi.getBoms(COMPANY_ID);
      if (!res.success) console.log('getBoms error:', res.error);
      expect(res.success).toBe(true);
      expect(res.data).toHaveLength(1);
      expect(res.data![0].id).toBe(BOM_ID);
      expect(res.data![0].productName).toBe('منتج');
      expect(res.data![0].isActive).toBe(true);
      expect(res.data![0].totalCost).toBe(5000);
    });

    it('returns validation error for invalid companyId', async () => {
      const res = await manufacturingApi.getBoms('not-a-uuid');
      expect(res.success).toBe(false);
      expect(res.error).toBeDefined();
    });
  });

  describe('getBomsPaginated', () => {
    it('returns paginated BOMs with total count', async () => {
      const adapter = makeMockAdapter(async (sql) => {
        if (sql.startsWith('SELECT COUNT')) {
          return { success: true, rows: [{ total: 5 }] };
        }
        return {
          success: true,
          rows: [
            { id: BOM_ID, company_id: COMPANY_ID, product_id: PRODUCT_ID, product_name: 'منتج', version: '1.0', is_active: true, total_cost: '5000', lines_count: 3 },
          ],
        };
      });
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

      const res = await manufacturingApi.getBomsPaginated(COMPANY_ID, 1, 25);
      expect(res.success).toBe(true);
      expect(res.data?.items).toHaveLength(1);
      expect(res.data?.total).toBe(5);
      expect(res.data?.items[0].linesCount).toBe(3);
    });

    it('filters by isActive when provided', async () => {
      const adapter = makeMockAdapter(async (sql, params) => {
        if (sql.startsWith('SELECT COUNT')) {
          expect(sql).toContain('b.is_active = $');
          expect(params).toContain(true);
          return { success: true, rows: [{ total: 1 }] };
        }
        return { success: true, rows: [{ id: BOM_ID, company_id: COMPANY_ID, product_id: PRODUCT_ID, product_name: 'منتج', version: '1.0', is_active: true, total_cost: '5000' }] };
      });
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

      const res = await manufacturingApi.getBomsPaginated(COMPANY_ID, 1, 25, { isActive: true });
      expect(res.success).toBe(true);
    });

    it('filters by search term', async () => {
      const adapter = makeMockAdapter(async (sql, params) => {
        if (sql.startsWith('SELECT COUNT')) {
          expect(sql).toContain('ILIKE');
          expect(params[1]).toBe('%بحث%');
          return { success: true, rows: [{ total: 1 }] };
        }
        return { success: true, rows: [] };
      });
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

      const res = await manufacturingApi.getBomsPaginated(COMPANY_ID, 1, 25, { search: 'بحث' });
      expect(res.success).toBe(true);
    });
  });

  describe('getBomById', () => {
    it('returns bom with its lines', async () => {
      const adapter = makeMockAdapter(async (sql) => {
        if (sql.includes('FROM boms') && sql.includes('LIMIT 1')) {
          return {
            success: true,
            rows: [{ id: BOM_ID, company_id: COMPANY_ID, product_id: PRODUCT_ID, version: '1.0', is_active: true, total_cost: '5000', notes: 'ملاحظة' }],
          };
        }
        if (sql.includes('FROM bom_lines')) {
          return {
            success: true,
            rows: [
              { id: 'line-1', bom_id: BOM_ID, material_id: PRODUCT_ID, material_name: 'مادة', quantity: '2', unit_cost: '100', total_cost: '200' },
            ],
          };
        }
        return { success: true, rows: [] };
      });
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

      const res = await manufacturingApi.getBomById(BOM_ID, COMPANY_ID);
      expect(res.success).toBe(true);
      expect(res.data?.bom.id).toBe(BOM_ID);
      expect(res.data?.bom.notes).toBe('ملاحظة');
      expect(res.data?.lines).toHaveLength(1);
      expect(res.data?.lines[0].materialName).toBe('مادة');
    });

    it('returns error when bom not found', async () => {
      const adapter = makeMockAdapter(async () => ({ success: true, rows: [] }));
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

      const res = await manufacturingApi.getBomById(BOM_ID, COMPANY_ID);
      expect(res.success).toBe(false);
    });
  });

  describe('createBom', () => {
    it('inserts bom with lines and returns id', async () => {
      const adapter = makeMockAdapter(async (sql, params) => {
        if (sql.includes('INSERT INTO boms')) {
          expect(sql).toContain('total_cost');
          expect(sql).toContain('notes');
          expect(params[0]).toBe(COMPANY_ID);
          return { success: true, rows: [{ id: BOM_ID }] };
        }
        if (sql.includes('INSERT INTO bom_lines')) {
          expect(sql).toContain('total_cost');
          return { success: true, rows: [] };
        }
        return { success: true, rows: [] };
      });
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

      const res = await manufacturingApi.createBom({
        companyId: COMPANY_ID,
        productId: PRODUCT_ID,
        version: '1.0',
        isActive: true,
        totalCost: 5000,
        notes: 'ملاحظة',
        lines: [{ materialId: PRODUCT_ID, quantity: 2, unitCost: 100 }],
      });
      expect(res.success).toBe(true);
      expect(res.id).toBe(BOM_ID);
    });
  });

  describe('getWorkOrders', () => {
    it('returns work orders scoped to company', async () => {
      const adapter = makeMockAdapter(async (sql, params) => {
        if (sql.includes('FROM work_orders') && sql.includes('product_name')) {
          expect(sql).toContain('WHERE w.company_id = $1');
          expect(params[0]).toBe(COMPANY_ID);
          return {
            success: true,
            rows: [
              { id: WO_ID, company_id: COMPANY_ID, order_number: 'WO-0001', product_id: PRODUCT_ID, product_name: 'منتج', quantity: '10', status: 'planned', total_cost: '5000' },
            ],
          };
        }
        return { success: true, rows: [] };
      });
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

      const res = await manufacturingApi.getWorkOrders(COMPANY_ID);
      expect(res.success).toBe(true);
      expect(res.data).toHaveLength(1);
      expect(res.data![0].orderNumber).toBe('WO-0001');
      expect(res.data![0].status).toBe('planned');
    });
  });

  describe('getWorkOrdersPaginated', () => {
    it('returns paginated work orders with status filter', async () => {
      const adapter = makeMockAdapter(async (sql, params) => {
        if (sql.includes('COUNT(*)')) {
          expect(sql).toContain('w.status = $2');
          expect(params[1]).toBe('in_progress');
          return { success: true, rows: [{ total: 3 }] };
        }
        return {
          success: true,
          rows: [
            { id: WO_ID, company_id: COMPANY_ID, order_number: 'WO-0001', product_id: PRODUCT_ID, product_name: 'منتج', quantity: '10', status: 'in_progress', total_cost: '5000' },
          ],
        };
      });
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

      const res = await manufacturingApi.getWorkOrdersPaginated(COMPANY_ID, 1, 25, { status: 'in_progress' });
      expect(res.success).toBe(true);
      expect(res.data?.items).toHaveLength(1);
      expect(res.data?.total).toBe(3);
    });
  });

  describe('getWorkOrderById', () => {
    it('returns work order with its consumption lines', async () => {
      const adapter = makeMockAdapter(async (sql) => {
        if (sql.includes('FROM work_orders') && sql.includes('LIMIT 1')) {
          return {
            success: true,
            rows: [{ id: WO_ID, company_id: COMPANY_ID, order_number: 'WO-0001', product_id: PRODUCT_ID, product_name: 'منتج', quantity: '10', status: 'in_progress', total_cost: '5000' }],
          };
        }
        if (sql.includes('FROM work_order_consumptions')) {
          return {
            success: true,
            rows: [
              { id: 'cons-1', work_order_id: WO_ID, material_id: PRODUCT_ID, material_name: 'مادة', planned_quantity: '5', actual_quantity: '4.5', unit_cost: '100', actual_unit_cost: '110' },
            ],
          };
        }
        return { success: true, rows: [] };
      });
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

      const res = await manufacturingApi.getWorkOrderById(WO_ID, COMPANY_ID);
      expect(res.success).toBe(true);
      expect(res.data?.workOrder.id).toBe(WO_ID);
      expect(res.data?.lines).toHaveLength(1);
      expect(res.data?.lines[0].actualUnitCost).toBe(110);
    });
  });

  describe('createWorkOrder', () => {
    it('inserts work order with consumptions and returns id', async () => {
      const adapter = makeMockAdapter(async (sql, params) => {
        if (sql.includes('INSERT INTO work_orders')) {
          expect(sql).toContain('total_cost');
          expect(sql).toContain('notes');
          expect(params[0]).toBe(COMPANY_ID);
          return { success: true, rows: [{ id: WO_ID }] };
        }
        if (sql.includes('INSERT INTO work_order_consumptions')) {
          return { success: true, rows: [] };
        }
        return { success: true, rows: [] };
      });
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

      const res = await manufacturingApi.createWorkOrder({
        companyId: COMPANY_ID,
        orderNumber: 'WO-0001',
        productId: PRODUCT_ID,
        quantity: 10,
        status: 'planned',
        totalCost: 5000,
        lines: [{ materialId: PRODUCT_ID, plannedQuantity: 5, unitCost: 100 }],
      });
      expect(res.success).toBe(true);
      expect(res.id).toBe(WO_ID);
    });
  });

  describe('updateWorkOrderStatus — unified production flow', () => {
    const baseAdapter = () => makeMockAdapter(async (sql) => {
      if (sql.includes('FROM work_orders') && sql.includes('LIMIT 1')) {
        return { success: true, rows: [{ status: 'planned', output_warehouse_id: null }] };
      }
      if (sql.includes('FROM work_order_consumptions c')) {
        return {
          success: true,
          rows: [{ material_id: PRODUCT_ID, planned_quantity: '5', actual_quantity: '6', unit_cost: '100', actual_unit_cost: '110', available: '10' }],
        };
      }
      if (sql.includes('FROM stock st')) {
        return { success: true, rows: [{ warehouse_id: 'wh-1' }] };
      }
      if (sql.includes('FROM warehouses')) {
        return { success: true, rows: [{ id: 'wh-1' }] };
      }
      return { success: true, rows: [] };
    });

    it('START issues raw materials atomically then flips to in_progress', async () => {
      const adapter = baseAdapter();
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

      const res = await manufacturingApi.updateWorkOrderStatus(WO_ID, COMPANY_ID, 'in_progress', USER_ID);
      expect(res.success).toBe(true);

      const txSqls = adapter.transaction.mock.calls[0][0].map((q: { sql: string }) => q.sql);
      expect(txSqls.some((s: string) => s.includes("'out'"))).toBe(true);
      expect(txSqls.some((s: string) => s.includes('quantity = quantity - '))).toBe(true);
      expect(txSqls.some((s: string) => s.includes("status = 'in_progress'"))).toBe(true);
    });

    it('START refuses when stock is insufficient', async () => {
      const adapter = makeMockAdapter(async (sql) => {
        if (sql.includes('FROM work_orders') && sql.includes('LIMIT 1')) {
          return { success: true, rows: [{ status: 'planned', output_warehouse_id: null }] };
        }
        if (sql.includes('FROM work_order_consumptions c')) {
          return { success: true, rows: [{ material_id: PRODUCT_ID, planned_quantity: '5', available: '2' }] };
        }
        return { success: true, rows: [] };
      });
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

      const res = await manufacturingApi.startWorkOrder(WO_ID, COMPANY_ID);
      expect(res.success).toBe(false);
      expect(String(res.error)).toContain('لا يكفي');
    });

    it('COMPLETE posts consumption delta + FG receipt + cost rollup', async () => {
      const adapter = makeMockAdapter(async (sql) => {
        if (sql.includes('FROM work_orders') && sql.includes('LIMIT 1')) {
          return { success: true, rows: [{ status: 'in_progress', quantity: '10', produced_quantity: '0', output_warehouse_id: null, product_id: PRODUCT_ID, order_number: 'WO-001', production_costs: [] }] };
        }
        if (sql.includes('FROM work_order_consumptions c')) {
          return {
            success: true,
            rows: [{ material_id: PRODUCT_ID, planned_quantity: '5', actual_quantity: '6', unit_cost: '100', actual_unit_cost: '110' }],
          };
        }
        if (sql.includes('FROM warehouses')) {
          return { success: true, rows: [{ id: 'wh-out' }] };
        }
        if (sql.includes('FROM stock st')) {
          return { success: true, rows: [{ warehouse_id: 'wh-1' }] };
        }
        if (sql.includes('product_types pt')) {
          return { success: true, rows: [{ default_inventory_account_id: 'inv-acc-1' }] };
        }
        return { success: true, rows: [] };
      });
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

      const res = await manufacturingApi.completeWorkOrder(WO_ID, COMPANY_ID, { producedQuantity: 10, userId: USER_ID });
      expect(res.success).toBe(true);
      expect(res.data?.totalCost).toBe(660); // 6 × 110

      const txQs = adapter.transaction.mock.calls[0][0] as Array<{ sql: string; params?: unknown[] }>;
      const extraIssue = txQs.find((q) => q.sql.includes("'out'"));
      expect(extraIssue?.params?.[3]).toBe(1); // actual 6 − issued 5
      const fgReceipt = txQs.find((q) => q.sql.includes("'in'") && String(q.params?.[5]).includes('تام'));
      expect(fgReceipt?.params?.[3]).toBe(10);
      expect(txQs.some((q) => q.sql.includes("status = 'completed'"))).toBe(true);
      // GL journal entry: DR inventory 660 / CR inventory 660 (materials only, no production costs)
      const je = txQs.find((q) => q.sql.includes('INSERT INTO transactions'));
      expect(je).toBeTruthy();
      // product cost_price updated with unit cost (660 / 10 = 66)
      const costUpdate = txQs.find((q) => q.sql.includes('UPDATE products SET cost_price'));
      expect(costUpdate?.params?.[0]).toBe(66);
    });

    it('COMPLETE capitalizes production costs into product cost and GL', async () => {
      const adapter = makeMockAdapter(async (sql, params) => {
        if (sql.includes('FROM work_orders') && sql.includes('LIMIT 1')) {
          return {
            success: true,
            rows: [{
              status: 'in_progress', quantity: '10', produced_quantity: '0', output_warehouse_id: null,
              product_id: PRODUCT_ID, order_number: 'WO-002',
              production_costs: JSON.stringify([
                { category: 'labor', amount: 200 },
                { category: 'energy', amount: 100 },
                { category: 'packaging', description: 'كرتون', amount: 40 },
              ]),
            }],
          };
        }
        if (sql.includes('FROM work_order_consumptions c')) {
          return {
            success: true,
            rows: [{ material_id: PRODUCT_ID, planned_quantity: '5', actual_quantity: '5', unit_cost: '100', actual_unit_cost: '100' }],
          };
        }
        if (sql.includes('FROM warehouses')) {
          return { success: true, rows: [{ id: 'wh-out' }] };
        }
        if (sql.includes('product_types pt')) {
          return { success: true, rows: [{ default_inventory_account_id: 'inv-acc-1' }] };
        }
        if (sql.includes('FROM accounts') && sql.includes('code')) {
          const code = String(params?.[1] || '');
          if (code === '53101') return { success: true, rows: [{ id: 'labor-acc' }] };
          if (code === '53201') return { success: true, rows: [{ id: 'energy-acc' }] };
          if (code === '53301') return { success: true, rows: [{ id: 'pack-acc' }] };
          return { success: true, rows: [] };
        }
        return { success: true, rows: [] };
      });
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

      const res = await manufacturingApi.completeWorkOrder(WO_ID, COMPANY_ID, { producedQuantity: 10, userId: USER_ID });
      expect(res.success).toBe(true);
      // materials 5×100=500 + labor 200 + energy 100 + packaging 40 = 840
      expect(res.data?.totalCost).toBe(840);

      const txQs = adapter.transaction.mock.calls[0][0] as Array<{ sql: string; params?: unknown[] }>;
      const je = txQs.find((q) => q.sql.includes('INSERT INTO transactions'));
      expect(je).toBeTruthy();
      // JE params: [companyId, date, reference, description, totalAmount, companyId, ...lines]
      expect(je?.params?.[4]).toBe(840);
      // product cost_price = 840 / 10 = 84
      const costUpdate = txQs.find((q) => q.sql.includes('UPDATE products SET cost_price'));
      expect(costUpdate?.params?.[0]).toBe(84);
    });

    it('COMPLETE rejects orders that are not in_progress', async () => {
      const adapter = makeMockAdapter(async (sql) => {
        if (sql.includes('FROM work_orders') && sql.includes('LIMIT 1')) {
          return { success: true, rows: [{ status: 'planned', quantity: '10', produced_quantity: '0', product_id: PRODUCT_ID }] };
        }
        return { success: true, rows: [] };
      });
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

      const res = await manufacturingApi.completeWorkOrder(WO_ID, COMPANY_ID, {});
      expect(res.success).toBe(false);
      expect(String(res.error)).toContain('قيد التشغيل');
    });

    it('delegates updateWorkOrderStatus(completed) through completeWorkOrder', async () => {
      const spy = vi.spyOn(manufacturingApi, 'completeWorkOrder').mockResolvedValue({ success: true, data: { producedQuantity: 10, totalCost: 660, outputWarehouseId: 'wh-out' } });
      const adapter = baseAdapter();
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

      const res = await manufacturingApi.updateWorkOrderStatus(WO_ID, COMPANY_ID, 'completed', USER_ID, 10);
      expect(res.success).toBe(true);
      expect(spy).toHaveBeenCalledWith(WO_ID, COMPANY_ID, expect.objectContaining({ producedQuantity: 10, userId: USER_ID }));
      spy.mockRestore();
    });

  });

  describe('deleteWorkOrder', () => {
    it('deletes work order scoped to company', async () => {
      const adapter = makeMockAdapter(async (sql, params) => {
        if (sql.includes('DELETE FROM work_orders')) {
          expect(sql).toContain('AND company_id = $2');
          expect(params[1]).toBe(COMPANY_ID);
          return { success: true, rows: [] };
        }
        return { success: true, rows: [] };
      });
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

      const res = await manufacturingApi.deleteWorkOrder(WO_ID, COMPANY_ID);
      expect(res.success).toBe(true);
    });
  });

  describe('getManufacturingKpis', () => {
    it('returns aggregated KPIs scoped to company', async () => {
      const adapter = makeMockAdapter(async (sql, params) => {
        expect(sql).toContain('WHERE company_id = $1');
        expect(params[0]).toBe(COMPANY_ID);
        return {
          success: true,
          rows: [{ total: 10, active: 3, completed: 5, total_cost: '100000' }],
        };
      });
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

      const res = await manufacturingApi.getManufacturingKpis(COMPANY_ID);
      expect(res.success).toBe(true);
      expect(res.data?.totalWorkOrders).toBe(10);
      expect(res.data?.activeOrders).toBe(3);
      expect(res.data?.completedOrders).toBe(5);
      expect(res.data?.totalProductionCost).toBe(100000);
    });
  });

});
