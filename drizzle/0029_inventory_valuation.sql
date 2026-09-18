-- 0029: Perpetual inventory valuation (Phase 1 — FIN track)
--   1. inventory_layers: FIFO cost layers (receipts add, sales/returns consume
--      oldest-first). Moving-average and standard-cost companies ignore it.
--   2. products.standard_cost: frozen standard cost (standard-cost method only;
--      NULL = not set → falls back to cost_price with no crash).
--   3. sales_invoice_lines.unit_cost: cost basis per BASE unit frozen at posting
--      time — sales returns reverse the ORIGINAL cost, not today's average.
--      NULL = pre-Phase-1 row → callers fall back to the current method cost.
--   4. Chart accounts + default keys for variance/shortage/surplus postings:
--      51901 purchase-price variance, 52901 inventory shortage, 41901 surplus.
-- Idempotent: IF NOT EXISTS + WHERE NOT EXISTS throughout (0012 pattern).

-- ─── 1. FIFO layers ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory_layers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  warehouse_id uuid REFERENCES warehouses(id) ON DELETE SET NULL,
  qty_remaining numeric(18, 4) NOT NULL DEFAULT 0,
  unit_cost numeric(18, 4) NOT NULL DEFAULT 0,
  received_date date NOT NULL DEFAULT NOW(),
  source_ref varchar(100),
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_layers_company_product
  ON inventory_layers (company_id, product_id);
CREATE INDEX IF NOT EXISTS idx_layers_fifo_order
  ON inventory_layers (company_id, product_id, received_date, created_at)
  WHERE qty_remaining > 0;

-- ─── 2. Standard cost ────────────────────────────────────────────────────────
ALTER TABLE products ADD COLUMN IF NOT EXISTS standard_cost numeric(18, 4);

-- ─── 3. Frozen posting-time cost on sales lines ──────────────────────────────
ALTER TABLE sales_invoice_lines ADD COLUMN IF NOT EXISTS unit_cost numeric(18, 4);

-- ─── 4. Chart accounts (per company, 0012 pattern) ───────────────────────────
INSERT INTO accounts (id, company_id, code, name_ar, name_en, type, nature, is_group, parent_id, balance, is_active, created_at)
SELECT
  gen_random_uuid(),
  c.id,
  v.code,
  v.name_ar,
  v.name_en,
  v.type,
  v.nature,
  FALSE,
  (SELECT a.id FROM accounts a WHERE a.company_id = c.id AND a.code = v.parent_code LIMIT 1),
  0,
  TRUE,
  NOW()
FROM companies c
JOIN (VALUES
  ('51901', 'فروق أسعار الشراء', 'Purchase Price Variance', 'expense', 'debit', '51'),
  ('52901', 'عجز المخزون', 'Inventory Shortage Loss', 'expense', 'debit', '52'),
  ('41901', 'فائض المخزون', 'Inventory Surplus Gain', 'revenue', 'credit', '41')
) AS v(code, name_ar, name_en, type, nature, parent_code) ON TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM accounts a
   WHERE a.company_id = c.id AND a.code = v.code
);

-- ─── 5. Default-account keys ─────────────────────────────────────────────────
INSERT INTO default_accounts (id, company_id, function_key, account_id, is_required, description, created_at)
SELECT
  gen_random_uuid(),
  c.id,
  v.function_key,
  (SELECT a.id FROM accounts a WHERE a.company_id = c.id AND a.code = v.account_code LIMIT 1),
  FALSE,
  v.description,
  NOW()
FROM companies c
JOIN (VALUES
  ('default_price_variance',     '51901', 'حساب فروق أسعار الشراء والتقييم'),
  ('default_inventory_shortage', '52901', 'حساب عجز المخزون (فاقد)'),
  ('default_inventory_surplus',  '41901', 'حساب فائض المخزون (عثور)')
) AS v(function_key, account_code, description) ON TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM default_accounts da
   WHERE da.company_id = c.id AND da.function_key = v.function_key
);
