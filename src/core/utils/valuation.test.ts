import { describe, it, expect } from 'vitest';
import {
  roundCost,
  roundMoney,
  computePurchaseAverages,
  allocateFifoOutflow,
  buildFifoConsumeStatements,
  buildFifoRestoreStatement,
  buildPurchaseLayerStatements,
  buildAverageUpdateStatements,
  getValuationMethod,
  setValuationMethod,
  resolveSaleUnitCosts,
  DEFAULT_VALUATION_METHOD,
} from './valuation';

// Minimal in-memory query stub — valuation functions only need { query }.
function stubDb(tables: {
  settings?: Array<{ value: string }>;
  products?: Array<{ id: string; cost_price: number; standard_cost: number | null; name_ar: string }>;
  stock?: Array<{ product_id: string; q: number }>;
  layers?: Array<{ id: string; product_id: string; qty_remaining: number; unit_cost: number }>;
}) {
  const log: string[] = [];
  return {
    log,
    query: async (sql: string) => {
      log.push(sql);
      if (sql.includes('FROM settings')) {
        return { success: true, rows: (tables.settings || []).map((s) => ({ value: s.value })) };
      }
      if (sql.includes('FROM products WHERE')) {
        return {
          success: true,
          rows: (tables.products || []).map((p) => ({
            id: p.id,
            cost_price: p.cost_price,
            standard_cost: p.standard_cost,
            name_ar: p.name_ar,
          })),
        };
      }
      if (sql.includes('FROM stock')) {
        return { success: true, rows: (tables.stock || []).map((s) => ({ product_id: s.product_id, q: s.q })) };
      }
      if (sql.includes('FROM inventory_layers')) {
        const rows = (tables.layers || [])
          .filter((l) => l.qty_remaining > 0)
          .map((l) => ({ id: l.id, product_id: l.product_id, qty_remaining: l.qty_remaining, unit_cost: l.unit_cost }));
        if (sql.includes('DISTINCT ON')) {
          const seen = new Map<string, (typeof rows)[0]>();
          for (const r of rows) if (!seen.has(r.product_id)) seen.set(r.product_id, r);
          return { success: true, rows: [...seen.values()] };
        }
        return { success: true, rows };
      }
      if (sql.startsWith('INSERT INTO settings')) return { success: true, rows: [] };
      if (sql.startsWith('INSERT INTO inventory_layers')) return { success: true, rows: [{ id: 'new-layer' }] };
      return { success: true, rows: [] };
    },
  };
}

describe('valuation money helpers', () => {
  it('rounds unit costs to 4 and totals to 2', () => {
    expect(roundCost(10 / 3)).toBe(3.3333);
    expect(roundMoney(10 / 3)).toBe(3.33);
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
  });
});

describe('getValuationMethod / setValuationMethod', () => {
  it('defaults to moving_average when unset', async () => {
    expect(await getValuationMethod('c1', stubDb({}) as never)).toBe(DEFAULT_VALUATION_METHOD);
  });

  it('accepts only known methods, case-insensitive whitespace tolerated', async () => {
    expect(await getValuationMethod('c1', stubDb({ settings: [{ value: ' FIFO ' }] }) as never)).toBe('fifo');
    expect(await getValuationMethod('c1', stubDb({ settings: [{ value: 'lifo' }] }) as never)).toBe(
      DEFAULT_VALUATION_METHOD
    );
  });

  it('persists via settings upsert', async () => {
    const db = stubDb({});
    const res = await setValuationMethod('c1', 'standard', db as never);
    expect(res.success).toBe(true);
    expect(db.log.some((q) => q.includes('INSERT INTO settings') && q.includes('ON CONFLICT'))).toBe(true);
  });

  it('rejects unknown methods without touching the DB', async () => {
    const db = stubDb({});
    const res = await setValuationMethod('c1', 'lifo' as never, db as never);
    expect(res.success).toBe(false);
    expect(db.log).toHaveLength(0);
  });
});

describe('resolveSaleUnitCosts', () => {
  const prods = [
    { id: 'p1', cost_price: 100, standard_cost: 90, name_ar: 'صنف' },
    { id: 'p2', cost_price: 50, standard_cost: null, name_ar: 'صنف2' },
  ];

  it('moving_average uses the live cost_price', async () => {
    const r = await resolveSaleUnitCosts('c1', [{ productId: 'p1', baseQty: 2 }], stubDb({ products: prods }) as never);
    expect(r.success).toBe(true);
    if (r.success) expect(r.costs.get('p1')).toBe(100);
  });

  it('standard uses the frozen cost, falling back to average when unset', async () => {
    const db = stubDb({ settings: [{ value: 'standard' }], products: prods });
    const r = await resolveSaleUnitCosts(
      'c1',
      [
        { productId: 'p1', baseQty: 1 },
        { productId: 'p2', baseQty: 1 },
      ],
      db as never
    );
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.costs.get('p1')).toBe(90);
      expect(r.costs.get('p2')).toBe(50);
    }
  });

  it('fifo peeks the oldest open layer', async () => {
    const db = stubDb({
      settings: [{ value: 'fifo' }],
      products: prods,
      layers: [
        { id: 'l-old', product_id: 'p1', qty_remaining: 5, unit_cost: 80 },
        { id: 'l-new', product_id: 'p1', qty_remaining: 5, unit_cost: 120 },
      ],
    });
    const r = await resolveSaleUnitCosts('c1', [{ productId: 'p1', baseQty: 1 }], db as never);
    expect(r.success).toBe(true);
    if (r.success) expect(r.costs.get('p1')).toBe(80);
  });
});

describe('allocateFifoOutflow', () => {
  it('consumes oldest-first across layers', async () => {
    const db = stubDb({
      layers: [
        { id: 'l1', product_id: 'p1', qty_remaining: 3, unit_cost: 10 },
        { id: 'l2', product_id: 'p1', qty_remaining: 5, unit_cost: 20 },
      ],
    });
    const r = await allocateFifoOutflow('c1', [{ productId: 'p1', baseQty: 6 }], db as never);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.consumptions).toHaveLength(2);
    expect(r.consumptions[0]).toMatchObject({ layerId: 'l1', qty: 3 });
    expect(r.consumptions[1]).toMatchObject({ layerId: 'l2', qty: 3 });
    expect(r.total).toBe(3 * 10 + 3 * 20);
  });

  it('fails honestly naming the product on shortage', async () => {
    const db = stubDb({ layers: [{ id: 'l1', product_id: 'p1', qty_remaining: 2, unit_cost: 10 }] });
    const r = await allocateFifoOutflow('c1', [{ productId: 'p1', baseQty: 5, name: 'أرز' }], db as never);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toMatch(/أرز/);
  });

  it('partial mode consumes what exists and reports the shortfall', async () => {
    const db = stubDb({ layers: [{ id: 'l1', product_id: 'p1', qty_remaining: 2, unit_cost: 10 }] });
    const r = await allocateFifoOutflow('c1', [{ productId: 'p1', baseQty: 5 }], db as never, { partial: true });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.consumptions).toHaveLength(1);
    expect(r.shortfall).toBe(3);
  });
});

describe('computePurchaseAverages', () => {
  it('blends on-hand value with receipts (weighted by base qty)', async () => {
    const db = stubDb({
      products: [{ id: 'p1', cost_price: 100, standard_cost: null, name_ar: 'x' }],
      stock: [{ product_id: 'p1', q: 10 }],
    });
    // 10 @ 100 on hand + 10 @ 120 received → 110 average
    const r = await computePurchaseAverages(
      'c1',
      [{ productId: 'p1', baseQty: 10, lineTotal: 1200 }],
      db as never
    );
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.updates).toHaveLength(1);
    expect(r.updates[0].newCost).toBe(110);
  });

  it('first receipt sets the average (no on-hand stock)', async () => {
    const db = stubDb({
      products: [{ id: 'p1', cost_price: 0, standard_cost: null, name_ar: 'x' }],
      stock: [],
    });
    const r = await computePurchaseAverages(
      'c1',
      [{ productId: 'p1', baseQty: 4, lineTotal: 500 }],
      db as never
    );
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.updates[0].newCost).toBe(125);
  });

  it('skips zero-quantity lines', async () => {
    const db = stubDb({ products: [], stock: [] });
    const r = await computePurchaseAverages('c1', [{ productId: 'p1', baseQty: 0, lineTotal: 0 }], db as never);
    expect(r.success).toBe(true);
    if (r.success) expect(r.updates).toHaveLength(0);
  });
});

describe('statement builders', () => {
  it('buildFifoConsumeStatements guards against negative layers', () => {
    const stmts = buildFifoConsumeStatements('c1', [{ layerId: 'l1', productId: 'p1', qty: 2, unitCost: 10 }]);
    expect(stmts).toHaveLength(1);
    expect(stmts[0].sql).toMatch(/qty_remaining >= \$1::numeric/);
    expect(stmts[0].params).toEqual([2, 'l1', 'c1']);
  });

  it('buildFifoRestoreStatement skips non-positive quantities', () => {
    expect(
      buildFifoRestoreStatement('c1', { productId: 'p1', warehouseId: 'w1', qty: 0, unitCost: 10, receivedDate: '2026-09-01', sourceRef: 'x' })
    ).toBeNull();
    const s = buildFifoRestoreStatement('c1', { productId: 'p1', warehouseId: 'w1', qty: 5, unitCost: 10, receivedDate: '2026-09-01', sourceRef: 'PINV-1' })!;
    expect(s.sql).toMatch(/INSERT INTO inventory_layers/);
    expect(s.params).toEqual(['c1', 'p1', 'w1', 5, 10, '2026-09-01', 'PINV-1']);
  });

  it('buildPurchaseLayerStatements prices per base unit', () => {
    const stmts = buildPurchaseLayerStatements('c1', [
      { productId: 'p1', warehouseId: 'w1', baseQty: 12, lineTotal: 1200, receivedDate: '2026-09-01', sourceRef: 'PINV-9' },
    ]);
    expect(stmts).toHaveLength(1);
    expect(stmts[0].params?.[4]).toBe(100); // 1200 / 12 per base unit
  });

  it('buildAverageUpdateStatements scopes by company', () => {
    const stmts = buildAverageUpdateStatements('c1', [{ productId: 'p1', newCost: 110 }]);
    expect(stmts).toHaveLength(1);
    expect(stmts[0].sql).toMatch(/WHERE id = \$2::uuid AND company_id = \$3::uuid/);
    expect(stmts[0].params).toEqual([110, 'p1', 'c1']);
  });
});
