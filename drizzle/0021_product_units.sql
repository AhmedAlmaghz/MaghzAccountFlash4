-- 0021: Multi-unit products (تعدد وحدات المنتج)
--
-- 1. New `product_units` table: per-product units linked to the global `units`
--    catalog. Each row carries its own conversion factor (base units per one
--    of this unit), sale/purchase prices, optional per-unit barcode, and
--    base/default flags. Exactly one base unit per product (partial unique
--    index); exactly one default sale and one default purchase unit.
-- 2. Snapshot columns on all 6 document line tables: `unit_id` (the chosen
--    unit at document time, no FK — history must survive unit deletion),
--    `unit_factor` (frozen conversion factor), `base_quantity`
--    (quantity expressed in the product base unit — the ONLY value stock
--    postings consume).
-- 3. Backfill: (a) ensure a matching `units` row exists for every distinct
--    `products.unit` label, (b) one base `product_units` row per product
--    (factor 1, prices from the product card).
-- Idempotent: every statement guards with IF NOT EXISTS / WHERE NOT EXISTS.

-- ─── 1) product_units table ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
  factor numeric(18, 6) NOT NULL DEFAULT 1 CHECK (factor > 0),
  sale_price numeric(18, 4) NOT NULL DEFAULT 0,
  purchase_price numeric(18, 4) NOT NULL DEFAULT 0,
  barcode varchar(100),
  is_base boolean NOT NULL DEFAULT false,
  is_default_sale boolean NOT NULL DEFAULT false,
  is_default_purchase boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz DEFAULT NOW(),
  UNIQUE (product_id, unit_id)
);

CREATE INDEX IF NOT EXISTS idx_product_units_company_product ON product_units (company_id, product_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_units_base ON product_units (product_id) WHERE is_base;
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_units_default_sale ON product_units (product_id) WHERE is_default_sale;
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_units_default_purchase ON product_units (product_id) WHERE is_default_purchase;

-- ─── 2) Snapshot columns on document line tables ────────────────────────
ALTER TABLE sales_invoice_lines ADD COLUMN IF NOT EXISTS unit_id uuid;
ALTER TABLE sales_invoice_lines ADD COLUMN IF NOT EXISTS unit_factor numeric(18, 6) NOT NULL DEFAULT 1;
ALTER TABLE sales_invoice_lines ADD COLUMN IF NOT EXISTS base_quantity numeric(18, 4) NOT NULL DEFAULT 0;

ALTER TABLE quotation_lines ADD COLUMN IF NOT EXISTS unit_id uuid;
ALTER TABLE quotation_lines ADD COLUMN IF NOT EXISTS unit_factor numeric(18, 6) NOT NULL DEFAULT 1;
ALTER TABLE quotation_lines ADD COLUMN IF NOT EXISTS base_quantity numeric(18, 4) NOT NULL DEFAULT 0;

ALTER TABLE sales_return_lines ADD COLUMN IF NOT EXISTS unit_id uuid;
ALTER TABLE sales_return_lines ADD COLUMN IF NOT EXISTS unit_factor numeric(18, 6) NOT NULL DEFAULT 1;
ALTER TABLE sales_return_lines ADD COLUMN IF NOT EXISTS base_quantity numeric(18, 4) NOT NULL DEFAULT 0;

ALTER TABLE purchase_invoice_lines ADD COLUMN IF NOT EXISTS unit_id uuid;
ALTER TABLE purchase_invoice_lines ADD COLUMN IF NOT EXISTS unit_factor numeric(18, 6) NOT NULL DEFAULT 1;
ALTER TABLE purchase_invoice_lines ADD COLUMN IF NOT EXISTS base_quantity numeric(18, 4) NOT NULL DEFAULT 0;

ALTER TABLE purchase_order_lines ADD COLUMN IF NOT EXISTS unit_id uuid;
ALTER TABLE purchase_order_lines ADD COLUMN IF NOT EXISTS unit_factor numeric(18, 6) NOT NULL DEFAULT 1;
ALTER TABLE purchase_order_lines ADD COLUMN IF NOT EXISTS base_quantity numeric(18, 4) NOT NULL DEFAULT 0;

ALTER TABLE purchase_return_lines ADD COLUMN IF NOT EXISTS unit_id uuid;
ALTER TABLE purchase_return_lines ADD COLUMN IF NOT EXISTS unit_factor numeric(18, 6) NOT NULL DEFAULT 1;
ALTER TABLE purchase_return_lines ADD COLUMN IF NOT EXISTS base_quantity numeric(18, 4) NOT NULL DEFAULT 0;

-- ─── 3a) Backfill missing units rows for legacy product.unit labels ─────
INSERT INTO units (company_id, name_ar, conversion_factor, is_active)
SELECT DISTINCT p.company_id, p.unit, 1, true
  FROM products p
 WHERE p.unit IS NOT NULL AND p.unit <> ''
   AND NOT EXISTS (
     SELECT 1 FROM units u
      WHERE u.company_id = p.company_id
        AND (u.name_ar = p.unit OR u.code = p.unit)
   );

-- ─── 3b) One base product_units row per product ─────────────────────────
INSERT INTO product_units (company_id, product_id, unit_id, factor, sale_price, purchase_price, is_base, is_default_sale, is_default_purchase)
SELECT p.company_id, p.id, u.id, 1,
       COALESCE(p.sale_price, 0), COALESCE(p.cost_price, 0),
       true, true, true
  FROM products p
  JOIN units u ON u.company_id = p.company_id
             AND (u.name_ar = p.unit OR u.code = p.unit)
 WHERE NOT EXISTS (SELECT 1 FROM product_units pu WHERE pu.product_id = p.id);

-- ─── 3c) Existing lines: base_quantity = quantity (factor 1 legacy) ─────
UPDATE sales_invoice_lines SET base_quantity = quantity WHERE base_quantity = 0;
UPDATE quotation_lines SET base_quantity = quantity WHERE base_quantity = 0;
UPDATE sales_return_lines SET base_quantity = quantity WHERE base_quantity = 0;
UPDATE purchase_invoice_lines SET base_quantity = quantity WHERE base_quantity = 0;
UPDATE purchase_order_lines SET base_quantity = quantity WHERE base_quantity = 0;
UPDATE purchase_return_lines SET base_quantity = quantity WHERE base_quantity = 0;
