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

    it('scopes the material join in the lines query to the company (defense in depth)', async () => {
      const captured: { sql: string; params: unknown[] }[] = [];
      const adapter = makeMockAdapter(async (sql, params) => {
        captured.push({ sql, params });
        if (sql.includes('FROM boms') && sql.includes('LIMIT 1')) {
          return {
            success: true,
            rows: [{ id: BOM_ID, company_id: COMPANY_ID, product_id: PRODUCT_ID, version: '1.0', is_active: true, total_cost: '5000', notes: 'ملاحظة' }],
          };
        }
        if (sql.includes('FROM bom_lines')) {
          return { success: true, rows: [] };
        }
        return { success: true, rows: [] };
      });
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

      await manufacturingApi.getBomById(BOM_ID, COMPANY_ID);
      const linesQuery = captured.find((c) => c.sql.includes('FROM bom_lines'))!;
      expect(linesQuery.sql).toContain('p.company_id = $2::uuid');
      expect(linesQuery.params).toEqual([BOM_ID, COMPANY_ID]);
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

    it('scopes the material join in the consumption query to the company (defense in depth)', async () => {
      const captured: { sql: string; params: unknown[] }[] = [];
      const adapter = makeMockAdapter(async (sql, params) => {
        captured.push({ sql, params });
        if (sql.includes('FROM work_orders') && sql.includes('LIMIT 1')) {
          return {
            success: true,
            rows: [{ id: WO_ID, company_id: COMPANY_ID, order_number: 'WO-0001', product_id: PRODUCT_ID, product_name: 'منتج', quantity: '10', status: 'in_progress', total_cost: '5000' }],
          };
        }
        if (sql.includes('FROM work_order_consumptions')) {
          return { success: true, rows: [] };
        }
        return { success: true, rows: [] };
      });
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

      await manufacturingApi.getWorkOrderById(WO_ID, COMPANY_ID);
      const linesQuery = captured.find((c) => c.sql.includes('FROM work_order_consumptions'))!;
      expect(linesQuery.sql).toContain('p.company_id = $2::uuid');
      expect(linesQuery.params).toEqual([WO_ID, COMPANY_ID]);
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
        return { success: true, rows: [{ status: 'planned', output_warehouse_id: null, order_number: 'WO-100' }] };
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
      if (sql.includes('product_types pt')) {
        return { success: true, rows: [{ default_inventory_account_id: 'inv-acc-1' }] };
      }
      if (sql.includes('FROM accounts') && sql.includes('code')) {
        return { success: true, rows: [{ id: 'wip-acc-1' }] };
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
      // GL journal entry: DR FG 660 / CR raw-material inventory 660
      // (materials only, no production costs; per-material relief, never
      // the FG account being debited — in this mock both resolve to the
      // same id, see the distinct-accounts tests below for the separation)
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

    it('COMPLETE falls back to the planned quantity when producedQuantity is 0/absent', async () => {
      // Transcript regression: num(undefined) → 0 froze produced_quantity at
      // zero with no FG receipt. 0/undefined now mean "use the plan".
      const adapter = makeMockAdapter(async (sql) => {
        if (sql.includes('FROM work_orders') && sql.includes('LIMIT 1')) {
          return { success: true, rows: [{ status: 'in_progress', quantity: '10', produced_quantity: '0', output_warehouse_id: null, product_id: PRODUCT_ID, order_number: 'WO-009', production_costs: [] }] };
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
        if (sql.includes('FROM stock st')) {
          return { success: true, rows: [{ warehouse_id: 'wh-1' }] };
        }
        if (sql.includes('product_types pt')) {
          return { success: true, rows: [{ default_inventory_account_id: 'inv-acc-1' }] };
        }
        return { success: true, rows: [] };
      });
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

      const res = await manufacturingApi.completeWorkOrder(WO_ID, COMPANY_ID, { producedQuantity: 0, userId: USER_ID });
      expect(res.success).toBe(true);
      expect(res.data?.producedQuantity).toBe(10);

      const txQs = adapter.transaction.mock.calls[0][0] as Array<{ sql: string; params?: unknown[] }>;
      const fgReceipt = txQs.find((q) => q.sql.includes("'in'") && String(q.params?.[5]).includes('تام'));
      expect(fgReceipt?.params?.[3]).toBe(10);
    });

    it('COMPLETE in standard mode never rewrites the frozen standard cost (Phase 1)', async () => {
      const adapter = makeMockAdapter(async (sql) => {
        if (sql.includes('FROM work_orders') && sql.includes('LIMIT 1')) {
          return { success: true, rows: [{ status: 'in_progress', quantity: '10', produced_quantity: '0', output_warehouse_id: null, product_id: PRODUCT_ID, order_number: 'WO-STD', production_costs: [] }] };
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
        if (sql.includes('FROM stock st')) {
          return { success: true, rows: [{ warehouse_id: 'wh-1' }] };
        }
        if (sql.includes('FROM settings')) {
          return { success: true, rows: [{ value: 'standard' }] };
        }
        if (sql.includes('product_types pt')) {
          return { success: true, rows: [{ default_inventory_account_id: 'inv-acc-1' }] };
        }
        return { success: true, rows: [] };
      });
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

      const res = await manufacturingApi.completeWorkOrder(WO_ID, COMPANY_ID, { producedQuantity: 10, userId: USER_ID });
      expect(res.success).toBe(true);
      const txQs = adapter.transaction.mock.calls[0][0] as Array<{ sql: string; params?: unknown[] }>;
      expect(txQs.some((q) => q.sql.includes('UPDATE products SET cost_price'))).toBe(false);
    });

    it('COMPLETE in fifo mode opens a finished-goods layer at run cost (Phase 1)', async () => {
      const adapter = makeMockAdapter(async (sql) => {
        if (sql.includes('FROM work_orders') && sql.includes('LIMIT 1')) {
          return { success: true, rows: [{ status: 'in_progress', quantity: '10', produced_quantity: '0', output_warehouse_id: null, product_id: PRODUCT_ID, order_number: 'WO-FIFO', production_costs: [] }] };
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
        if (sql.includes('FROM settings')) {
          return { success: true, rows: [{ value: 'fifo' }] };
        }
        if (sql.includes('product_types pt')) {
          return { success: true, rows: [{ default_inventory_account_id: 'inv-acc-1' }] };
        }
        return { success: true, rows: [] };
      });
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

      const res = await manufacturingApi.completeWorkOrder(WO_ID, COMPANY_ID, { producedQuantity: 10, userId: USER_ID });
      expect(res.success).toBe(true);
      const txQs = adapter.transaction.mock.calls[0][0] as Array<{ sql: string; params?: unknown[] }>;
      const layer = txQs.find((q) => q.sql.includes('INSERT INTO inventory_layers'));
      expect(layer).toBeDefined();
      // 10 units at run cost 50 (5×100 materials / 10 produced)
      expect(layer!.params?.[3]).toBe(10);
      expect(layer!.params?.[4]).toBe(50);
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
      const spy = vi.spyOn(manufacturingApi, 'completeWorkOrder').mockResolvedValue({ success: true, data: { producedQuantity: 10, totalCost: 660, unitCost: 66, outputWarehouseId: 'wh-out' } });
      const adapter = baseAdapter();
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

      const res = await manufacturingApi.updateWorkOrderStatus(WO_ID, COMPANY_ID, 'completed', USER_ID, 10);
      expect(res.success).toBe(true);
      expect(spy).toHaveBeenCalledWith(WO_ID, COMPANY_ID, expect.objectContaining({ producedQuantity: 10, userId: USER_ID }));
      spy.mockRestore();
    });

  });

  describe('work order lifecycle — WIP accounting (best practice)', () => {
    const WIP_ACC = 'wip-acc-1';
    const INV_ACC = 'inv-acc-1';

    const startAdapter = () => makeMockAdapter(async (sql) => {
      if (sql.includes('FROM work_orders') && sql.includes('LIMIT 1')) {
        return { success: true, rows: [{ status: 'planned', output_warehouse_id: null, order_number: 'WO-200' }] };
      }
      if (sql.includes('FROM work_order_consumptions c')) {
        return {
          success: true,
          rows: [
            { material_id: PRODUCT_ID, planned_quantity: '5', unit_cost: '100', available: '10' },
            { material_id: PRODUCT_ID, planned_quantity: '3', unit_cost: '50', available: '10' },
          ],
        };
      }
      if (sql.includes('FROM stock st')) return { success: true, rows: [{ warehouse_id: 'wh-1' }] };
      if (sql.includes('FROM warehouses')) return { success: true, rows: [{ id: 'wh-1' }] };
      if (sql.includes('product_types pt')) return { success: true, rows: [{ default_inventory_account_id: INV_ACC }] };
      if (sql.includes('FROM accounts') && sql.includes('code')) return { success: true, rows: [{ id: WIP_ACC }] };
      return { success: true, rows: [] };
    });

    it('START posts DR WIP / CR inventory for issued materials and stores wip_materials_cost', async () => {
      const adapter = startAdapter();
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

      const res = await manufacturingApi.startWorkOrder(WO_ID, COMPANY_ID, USER_ID);
      expect(res.success).toBe(true);

      const txQs = adapter.transaction.mock.calls[0][0] as Array<{ sql: string; params?: unknown[] }>;
      // WIP journal entry: 5×100 + 3×50 = 650
      const je = txQs.find((q) => q.sql.includes('INSERT INTO transactions'));
      expect(je).toBeTruthy();
      expect(je?.params?.[4]).toBe(650);
      // Status update stores the posted WIP amount.
      const statusUpd = txQs.find((q) => q.sql.includes("status = 'in_progress'"));
      expect(statusUpd?.sql).toContain('wip_materials_cost = $3::numeric');
      expect(statusUpd?.params?.[2]).toBe(650);
    });

    it('START availability gate aggregates multiple lines of the same material', async () => {
      const adapter = makeMockAdapter(async (sql) => {
        if (sql.includes('FROM work_orders') && sql.includes('LIMIT 1')) {
          return { success: true, rows: [{ status: 'planned', output_warehouse_id: null, order_number: 'WO-201' }] };
        }
        if (sql.includes('FROM work_order_consumptions c')) {
          return {
            success: true,
            rows: [
              { material_id: PRODUCT_ID, planned_quantity: '8', unit_cost: '10', available: '10' },
              { material_id: PRODUCT_ID, planned_quantity: '8', unit_cost: '12', available: '10' },
            ],
          };
        }
        return { success: true, rows: [] };
      });
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

      // 8 + 8 = 16 required but only 10 available — must refuse even though
      // each line individually sees "10 available".
      const res = await manufacturingApi.startWorkOrder(WO_ID, COMPANY_ID);
      expect(res.success).toBe(false);
      expect(String(res.error)).toContain('لا يكفي');
    });

    const completeAdapter = (wipPosted: number, actualQty: string) => makeMockAdapter(async (sql) => {
      if (sql.includes('FROM work_orders') && sql.includes('LIMIT 1')) {
        return {
          success: true,
          rows: [{
            status: 'in_progress', quantity: '10', produced_quantity: '0', output_warehouse_id: null,
            product_id: PRODUCT_ID, order_number: 'WO-202', production_costs: JSON.stringify([{ category: 'labor', amount: 340 }]),
            wip_materials_cost: String(wipPosted),
          }],
        };
      }
      if (sql.includes('FROM work_order_consumptions c')) {
        return { success: true, rows: [{ material_id: PRODUCT_ID, planned_quantity: '5', actual_quantity: actualQty, unit_cost: '100', actual_unit_cost: '100' }] };
      }
      if (sql.includes('FROM warehouses')) return { success: true, rows: [{ id: 'wh-out' }] };
      if (sql.includes('FROM stock st')) return { success: true, rows: [{ warehouse_id: 'wh-1' }] };
      if (sql.includes('COALESCE(SUM(quantity), 0) AS q FROM stock')) return { success: true, rows: [{ q: '10' }] };
      if (sql.includes('SELECT cost_price FROM products')) return { success: true, rows: [{ cost_price: '50' }] };
      if (sql.includes('product_types pt')) return { success: true, rows: [{ default_inventory_account_id: INV_ACC }] };
      if (sql.includes('default_accounts')) return { success: true, rows: [] };
      if (sql.includes('FROM accounts') && sql.includes('code')) {
        return { success: true, rows: [{ id: WIP_ACC }] };
      }
      return { success: true, rows: [] };
    });

    it('COMPLETE with WIP credits the WIP account and blends product cost (moving average)', async () => {
      const adapter = completeAdapter(500, '5');
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

      const res = await manufacturingApi.completeWorkOrder(WO_ID, COMPANY_ID, { producedQuantity: 10, userId: USER_ID });
      expect(res.success).toBe(true);
      // materials 5×100=500 + labor 340 = 840 → unit 84
      expect(res.data?.totalCost).toBe(840);
      expect(res.data?.unitCost).toBe(84);

      const txQs = adapter.transaction.mock.calls[0][0] as Array<{ sql: string; params?: unknown[] }>;
      const je = txQs.find((q) => q.sql.includes('INSERT INTO transactions'));
      expect(je).toBeTruthy();
      // Moving average: existing 10 units @ 50 + 10 new @ 84 → (500+840)/20 = 67
      const costUpdate = txQs.find((q) => q.sql.includes('UPDATE products SET cost_price'));
      expect(costUpdate?.params?.[0]).toBe(67);
    });

    it('COMPLETE with extra consumption beyond issued credits inventory for the delta', async () => {
      const adapter = completeAdapter(500, '7');
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

      const res = await manufacturingApi.completeWorkOrder(WO_ID, COMPANY_ID, { producedQuantity: 10, userId: USER_ID });
      expect(res.success).toBe(true);
      // materials 7×100=700 + labor 340 = 1040
      expect(res.data?.totalCost).toBe(1040);

      const txQs = adapter.transaction.mock.calls[0][0] as Array<{ sql: string; params?: unknown[] }>;
      // Extra issue movement: actual 7 − issued 5 = 2
      const extraIssue = txQs.find((q) => q.sql.includes("'out'"));
      expect(extraIssue?.params?.[3]).toBe(2);
      const je = txQs.find((q) => q.sql.includes('INSERT INTO transactions'));
      expect(je).toBeTruthy();
      expect(je?.params?.[4]).toBe(1040);
    });

    it('CANCEL with material return posts DR inventory / CR WIP reversal and resets WIP', async () => {
      const adapter = makeMockAdapter(async (sql) => {
        if (sql.includes('FROM work_orders') && sql.includes('LIMIT 1')) {
          return { success: true, rows: [{ status: 'in_progress', wip_materials_cost: '650', order_number: 'WO-203' }] };
        }
        if (sql.includes('FROM work_order_consumptions c')) {
          return { success: true, rows: [{ material_id: PRODUCT_ID, planned_quantity: '5', unit_cost: '130' }] };
        }
        if (sql.includes('FROM stock st')) return { success: true, rows: [{ warehouse_id: 'wh-1' }] };
        if (sql.includes('FROM warehouses')) return { success: true, rows: [{ id: 'wh-1' }] };
        if (sql.includes('product_types pt')) return { success: true, rows: [{ default_inventory_account_id: INV_ACC }] };
        if (sql.includes('default_accounts')) return { success: true, rows: [] };
        if (sql.includes('FROM accounts') && sql.includes('code')) return { success: true, rows: [{ id: WIP_ACC }] };
        return { success: true, rows: [] };
      });
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

      const res = await manufacturingApi.cancelWorkOrder(WO_ID, COMPANY_ID, { returnMaterials: true, userId: USER_ID });
      expect(res.success).toBe(true);
      expect(res.data?.returnedLines).toBe(1);

      const txQs = adapter.transaction.mock.calls[0][0] as Array<{ sql: string; params?: unknown[] }>;
      const je = txQs.find((q) => q.sql.includes('INSERT INTO transactions'));
      expect(je).toBeTruthy();
      expect(je?.params?.[4]).toBe(650); // 5 × 130 returned — mirrors the START posting
      const cancelUpd = txQs.find((q) => q.sql.includes("status = 'cancelled'"));
      expect(cancelUpd?.sql).toContain('wip_materials_cost = 0');
    });

    it('CANCEL without return expenses the WIP balance to production losses (53501)', async () => {
      const adapter = makeMockAdapter(async (sql, params) => {
        if (sql.includes('FROM work_orders') && sql.includes('LIMIT 1')) {
          return { success: true, rows: [{ status: 'in_progress', wip_materials_cost: '650', order_number: 'WO-204' }] };
        }
        if (sql.includes('default_accounts')) return { success: true, rows: [] };
        if (sql.includes('FROM accounts') && sql.includes('code')) {
          const code = String(params?.[1] || '');
          if (code === '53501') return { success: true, rows: [{ id: 'loss-acc' }] };
          return { success: true, rows: [{ id: WIP_ACC }] };
        }
        return { success: true, rows: [] };
      });
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

      const res = await manufacturingApi.cancelWorkOrder(WO_ID, COMPANY_ID, { returnMaterials: false, userId: USER_ID });
      expect(res.success).toBe(true);

      const txQs = adapter.transaction.mock.calls[0][0] as Array<{ sql: string; params?: unknown[] }>;
      const je = txQs.find((q) => q.sql.includes('INSERT INTO transactions'));
      expect(je).toBeTruthy();
      expect(je?.params?.[4]).toBe(650);
      // No stock movements — materials were not returned.
      expect(txQs.some((q) => q.sql.includes('INSERT INTO stock_movements'))).toBe(false);
    });

    it('updateWorkOrder rejects modified consumption lines after start', async () => {
      const adapter = makeMockAdapter(async (sql) => {
        if (sql.includes('SELECT status FROM work_orders')) {
          return { success: true, rows: [{ status: 'in_progress' }] };
        }
        if (sql.includes('SELECT material_id, planned_quantity, unit_cost FROM work_order_consumptions')) {
          return { success: true, rows: [{ material_id: PRODUCT_ID, planned_quantity: '5', unit_cost: '100' }] };
        }
        return { success: true, rows: [] };
      });
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

      const res = await manufacturingApi.updateWorkOrder(WO_ID, COMPANY_ID, USER_ID, {
        lines: [{ materialId: PRODUCT_ID, plannedQuantity: 9, unitCost: 100 }],
      });
      expect(res.success).toBe(false);
      expect(String(res.error)).toContain('بعد البدء');
    });

    it('updateWorkOrder allows identical lines to pass through (edit form re-sends them)', async () => {
      const adapter = makeMockAdapter(async (sql) => {
        if (sql.includes('SELECT status FROM work_orders')) {
          return { success: true, rows: [{ status: 'in_progress' }] };
        }
        if (sql.includes('SELECT material_id, planned_quantity, unit_cost FROM work_order_consumptions')) {
          return { success: true, rows: [{ material_id: PRODUCT_ID, planned_quantity: '5', unit_cost: '100' }] };
        }
        return { success: true, rows: [] };
      });
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

      const res = await manufacturingApi.updateWorkOrder(WO_ID, COMPANY_ID, USER_ID, {
        notes: 'تحديث ملاحظة',
        lines: [{ materialId: PRODUCT_ID, plannedQuantity: 5, unitCost: 100 }],
      });
      expect(res.success).toBe(true);
    });
  });

  describe('COMPLETE cost-variance fixes (price دلتا, legacy relief, WIP clear, zero-output guard)', () => {
    const FG_ACC = 'fg-acc-1';
    const WIP2_ACC = 'wip-acc-2';
    const MAT_ACC = 'mat-acc-1';

    // Distinct GL identities: FG (11303) ≠ WIP (11302) ≠ raw (11301).
    // default_accounts empty so every resolver falls to its chart code.
    const distinctAccounts = async (sql: string, params?: unknown[]) => {
      if (sql.includes('default_accounts')) return { success: true, rows: [] as unknown[] };
      if (sql.includes('product_types pt')) return { success: true, rows: [] as unknown[] };
      if (sql.includes('FROM accounts') && sql.includes('code')) {
        const code = String((params as unknown[] | undefined)?.[1] || '');
        if (code === '11303') return { success: true, rows: [{ id: FG_ACC }] };
        if (code === '11302') return { success: true, rows: [{ id: WIP2_ACC }] };
        return { success: true, rows: [{ id: MAT_ACC }] };
      }
      return null;
    };

    it('posts price-only variance (same qty, higher unit cost) instead of failing unbalanced', async () => {
      const adapter = makeMockAdapter(async (sql, params) => {
        if (sql.includes('FROM work_orders') && sql.includes('LIMIT 1')) {
          return {
            success: true,
            rows: [{
              status: 'in_progress', quantity: '10', produced_quantity: '0', output_warehouse_id: null,
              product_id: PRODUCT_ID, order_number: 'WO-PV', production_costs: [],
              wip_materials_cost: '500',
            }],
          };
        }
        if (sql.includes('FROM work_order_consumptions c')) {
          // Planned 5×100=500 issued at START; actual 5×110=550 → price variance 50, qty variance 0.
          return {
            success: true,
            rows: [{ material_id: PRODUCT_ID, planned_quantity: '5', actual_quantity: '5', unit_cost: '100', actual_unit_cost: '110' }],
          };
        }
        if (sql.includes('FROM warehouses')) return { success: true, rows: [{ id: 'wh-out' }] };
        const routed = await distinctAccounts(sql, params);
        if (routed) return routed;
        return { success: true, rows: [] };
      });
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

      const res = await manufacturingApi.completeWorkOrder(WO_ID, COMPANY_ID, { producedQuantity: 10, userId: USER_ID });
      expect(res.success, res.error || '').toBe(true);
      expect(res.data?.totalCost).toBe(550);

      const txQs = adapter.transaction.mock.calls[0][0] as Array<{ sql: string; params?: unknown[] }>;
      const je = txQs.find((q) => q.sql.includes('INSERT INTO transactions'));
      expect(je).toBeTruthy();
      expect(je?.params?.[4]).toBe(550);
      const ids = (je?.params || []) as unknown[];
      // Dr FG 550 / Cr WIP 500 / Cr raw-material 50 (price variance) — balanced.
      expect(ids.filter((p) => p === FG_ACC).length).toBe(1);
      expect(ids.filter((p) => p === WIP2_ACC).length).toBe(1);
      expect(ids.filter((p) => p === MAT_ACC).length).toBe(1);
      expect(ids).toContain(50);
      // WIP memo cleared on completion (keeps the WIP partial index truthful).
      const statusUpd = txQs.find((q) => q.sql.includes("status = 'completed'"));
      expect(statusUpd?.sql).toContain('wip_materials_cost = 0');
    });

    it('legacy flow (no WIP) relieves raw-material accounts, never the FG account', async () => {
      const adapter = makeMockAdapter(async (sql, params) => {
        if (sql.includes('FROM work_orders') && sql.includes('LIMIT 1')) {
          return {
            success: true,
            rows: [{
              status: 'in_progress', quantity: '10', produced_quantity: '0', output_warehouse_id: null,
              product_id: PRODUCT_ID, order_number: 'WO-LEG', production_costs: [],
              wip_materials_cost: '0',
            }],
          };
        }
        if (sql.includes('FROM work_order_consumptions c')) {
          return {
            success: true,
            rows: [{ material_id: PRODUCT_ID, planned_quantity: '5', actual_quantity: '6', unit_cost: '100', actual_unit_cost: '110' }],
          };
        }
        if (sql.includes('FROM warehouses')) return { success: true, rows: [{ id: 'wh-out' }] };
        const routed = await distinctAccounts(sql, params);
        if (routed) return routed;
        return { success: true, rows: [] };
      });
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

      const res = await manufacturingApi.completeWorkOrder(WO_ID, COMPANY_ID, { producedQuantity: 10, userId: USER_ID });
      expect(res.success, res.error || '').toBe(true);
      expect(res.data?.totalCost).toBe(660);

      const txQs = adapter.transaction.mock.calls[0][0] as Array<{ sql: string; params?: unknown[] }>;
      const je = txQs.find((q) => q.sql.includes('INSERT INTO transactions'));
      expect(je).toBeTruthy();
      expect(je?.params?.[4]).toBe(660);
      const ids = (je?.params || []) as unknown[];
      // Dr FG once, Cr raw-material once — the FG account must not fund itself.
      expect(ids.filter((p) => p === FG_ACC).length).toBe(1);
      expect(ids.filter((p) => p === MAT_ACC).length).toBe(1);
    });

    it('refuses completion with zero output when costs exist (no phantom FG value)', async () => {
      const adapter = makeMockAdapter(async (sql) => {
        if (sql.includes('FROM work_orders') && sql.includes('LIMIT 1')) {
          return {
            success: true,
            rows: [{
              status: 'in_progress', quantity: '0', produced_quantity: '0', output_warehouse_id: null,
              product_id: PRODUCT_ID, order_number: 'WO-ZERO', production_costs: [],
              wip_materials_cost: '0',
            }],
          };
        }
        if (sql.includes('FROM work_order_consumptions c')) {
          return {
            success: true,
            rows: [{ material_id: PRODUCT_ID, planned_quantity: '5', actual_quantity: '5', unit_cost: '100', actual_unit_cost: '100' }],
          };
        }
        return { success: true, rows: [] };
      });
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

      const res = await manufacturingApi.completeWorkOrder(WO_ID, COMPANY_ID, {});
      expect(res.success).toBe(false);
      expect(String(res.error)).toContain('صفر');
      expect(adapter.transaction).not.toHaveBeenCalled();
    });
  });

  describe('Phase 5 fiscal lock (closed year refuses postings)', () => {
    const today = new Date().toISOString().slice(0, 10);
    const year = Number(today.slice(0, 4));
    const closedYear = {
      success: true,
      rows: [{
        id: 'p1', company_id: COMPANY_ID, year,
        start_date: `${year}-01-01`, end_date: `${year}-12-31`,
        status: 'closed', closed_at: 'x',
      }],
    };

    it('startWorkOrder refuses inside a closed fiscal year', async () => {
      const adapter = makeMockAdapter(async (sql) => {
        if (sql.includes('FROM work_orders')) {
          return { success: true, rows: [{ status: 'planned', output_warehouse_id: null, order_number: 'WO-1' }] };
        }
        if (sql.includes('FROM accounting_periods')) return closedYear;
        return { success: true, rows: [] };
      });
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

      const res = await manufacturingApi.startWorkOrder(WO_ID, COMPANY_ID, USER_ID);
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/مقفلة/);
      expect(adapter.transaction).not.toHaveBeenCalled();
    });

    it('completeWorkOrder refuses inside a closed fiscal year', async () => {
      const adapter = makeMockAdapter(async (sql) => {
        if (sql.includes('FROM work_orders')) {
          return { success: true, rows: [{ status: 'in_progress', quantity: 10, produced_quantity: 0, output_warehouse_id: null, bom_id: BOM_ID, product_id: PRODUCT_ID, order_number: 'WO-1', production_costs: null, wip_materials_cost: 0, bom_output_quantity: 1 }] };
        }
        if (sql.includes('FROM accounting_periods')) return closedYear;
        return { success: true, rows: [] };
      });
      vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);

      const res = await manufacturingApi.completeWorkOrder(WO_ID, COMPANY_ID, { producedQuantity: 10, userId: USER_ID });
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/مقفلة/);
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
