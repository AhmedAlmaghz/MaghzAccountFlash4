import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('@/core/database/adapters', () => ({
  getDbAdapter: vi.fn(),
}));
vi.mock('@/core/utils/validation', () => {
  const mockSchema = () => ({});
  mockSchema.optional = () => mockSchema;
  mockSchema.min = () => mockSchema;
  mockSchema.uuid = () => mockSchema;
  return {
    validateInput: vi.fn(() => ({ success: true })),
    idCompanySchema: mockSchema,
    companyIdSchema: mockSchema,
    uuidSchema: mockSchema,
    createSupplierSchema: mockSchema,
    createPurchaseInvoiceSchema: mockSchema,
    createPurchaseOrderSchema: mockSchema,
    createPurchaseReturnSchema: mockSchema,
  };
});
vi.mock('@/core/utils/pagination', () => ({
  clampPageArgs: vi.fn((page: number, pageSize: number) => ({
    page,
    pageSize,
    offset: (page - 1) * pageSize,
  })),
  paginatedResult: vi.fn((items: unknown[], total: number, page: number, pageSize: number) => ({
    items,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  })),
}));
import { purchasesApi } from './api';
import { getDbAdapter } from '@/core/database/adapters';
function makeMockAdapter(queryImpl: (sql: string, params: unknown[]) => Promise<{ success: boolean; rows?: unknown[]; error?: string }>) {
  return { query: vi.fn(queryImpl) };
}
const COMPANY_ID = '00000000-0000-0000-0000-000000000001';
const SUPPLIER_ID = '00000000-0000-0000-0000-000000000010';
const ORDER_ID = '00000000-0000-0000-0000-000000000020';
const PRODUCT_ID = '00000000-0000-0000-0000-000000000030';
describe('purchasesApi.createOrder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it('inserts order with correct placeholder count and ::uuid casts', async () => {
    const captured: { sql: string; params: unknown[] }[] = [];
    const adapter = makeMockAdapter(async (sql, params) => {
      captured.push({ sql, params });
      if (sql.includes('RETURNING id')) {
        return { success: true, rows: [{ id: ORDER_ID }] };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);
    const result = await purchasesApi.createOrder({
      companyId: COMPANY_ID,
      orderNumber: 'PO-0001',
      supplierId: SUPPLIER_ID,
      date: '2026-07-13',
      expectedDate: '2026-07-20',
      totalAmount: 1000,
      status: 'draft',
      notes: 'Test order',
      lines: [
        { productId: PRODUCT_ID, quantity: 5, unitPrice: 200, lineTotal: 1000 },
      ],
    });
    expect(result.success).toBe(true);
    expect(captured).toHaveLength(1);
    const { sql, params } = captured[0];
    expect(sql).toContain('INSERT INTO purchase_orders');
    expect(sql).toContain('INSERT INTO purchase_order_lines');
    expect(sql).toContain('::uuid');
    expect(sql).toContain('::numeric');
    expect(sql).toContain('::date');
    expect(sql).toContain('::varchar');
    expect(sql).not.toMatch(/\$\d+(?!.*::)/);
    expect(params.length).toBe(18);
    expect(typeof params[0]).toBe('string');
    expect((params[0] as string).length).toBeGreaterThan(0);
    expect(params[1]).toBe(COMPANY_ID);
    expect(params[2]).toBe('PO-0001');
    expect(params[3]).toBe(SUPPLIER_ID);
    expect(params[4]).toBe('2026-07-13');
    expect(params[5]).toBe('2026-07-20');
    expect(params[6]).toBe(1000);
    expect(params[7]).toBe('draft');
    expect(params[8]).toBe('credit');
    expect(params[9]).toBeNull(); // cash box
    expect(params[10]).toBe('Test order');
    expect(params[11]).toBeNull(); // created_by
    expect(params[12]).toBeNull(); // updated_by
    expect(typeof params[13]).toBe('string'); // orderId for lines
    expect(params[14]).toBe(PRODUCT_ID);
    expect(params[15]).toBe(5);
    expect(params[16]).toBe(200);
    expect(params[17]).toBe(1000);
  });
  it('does not include non-existent description/received_quantity columns in line insert', async () => {
    const captured: { sql: string }[] = [];
    const adapter = makeMockAdapter(async (sql) => {
      captured.push({ sql });
      if (sql.includes('RETURNING id')) {
        return { success: true, rows: [{ id: ORDER_ID }] };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);
    await purchasesApi.createOrder({
      companyId: COMPANY_ID,
      orderNumber: 'PO-0002',
      supplierId: SUPPLIER_ID,
      date: '2026-07-13',
      totalAmount: 500,
      status: 'draft',
      notes: '',
      lines: [
        { productId: PRODUCT_ID, quantity: 2, unitPrice: 250, lineTotal: 500, description: 'should be ignored', receivedQuantity: 999 } as never,
      ],
    });
    const linesInsert = captured.find(c => c.sql.includes('INSERT INTO purchase_order_lines'));
    expect(linesInsert).toBeDefined();
    expect(linesInsert!.sql).toContain('INSERT INTO purchase_order_lines (order_id,product_id,quantity,unit_price,line_total)');
    expect(linesInsert!.sql).not.toContain('description');
    expect(linesInsert!.sql).not.toContain('received_quantity');
  });
});
describe('purchasesApi.getOrderById', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it('uses ::uuid cast on order_id and company_id in lookup queries', async () => {
    const captured: { sql: string }[] = [];
    const adapter = makeMockAdapter(async (sql) => {
      captured.push({ sql });
      if (sql.includes('FROM purchase_orders po')) {
        return { success: true, rows: [{ id: ORDER_ID, company_id: COMPANY_ID, order_number: 'PO-0001', supplier_id: SUPPLIER_ID, date: '2026-07-13', total_amount: '1000', status: 'draft', notes: '', created_by: null, updated_by: null, created_at: '2026-07-13', updated_at: '2026-07-13' }] };
      }
      if (sql.includes('FROM purchase_order_lines')) {
        return { success: true, rows: [] };
      }
      return { success: true, rows: [] };
    });
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as never);
    await purchasesApi.getOrderById(ORDER_ID, COMPANY_ID);
    const headerQuery = captured.find(c => c.sql.includes('FROM purchase_orders po'));
    const linesQuery = captured.find(c => c.sql.includes('FROM purchase_order_lines'));
    expect(headerQuery).toBeDefined();
    expect(headerQuery!.sql).toContain('po.id = $1::uuid');
    expect(headerQuery!.sql).toContain('po.company_id = $2::uuid');
    expect(linesQuery).toBeDefined();
    expect(linesQuery!.sql).toContain('l.order_id = $1::uuid');
  });
});