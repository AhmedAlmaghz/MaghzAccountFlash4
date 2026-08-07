-- ============================================================================
-- § 11. MANUFACTURING SCHEMA FIX
-- ============================================================================
-- Sync SQL schema with Drizzle schema for manufacturing tables.
-- Idempotent: safe to re-run (uses IF NOT EXISTS / DO blocks).

-- boms: add missing columns (total_cost, notes, updated_by, updated_at)
ALTER TABLE boms ADD COLUMN IF NOT EXISTS total_cost numeric(18, 4) DEFAULT '0';
ALTER TABLE boms ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE boms ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE boms ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();

-- bom_lines: add missing columns (total_cost, updated_at)
ALTER TABLE bom_lines ADD COLUMN IF NOT EXISTS total_cost numeric(18, 4) DEFAULT '0';
ALTER TABLE bom_lines ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();

-- work_order_consumptions: add missing columns (actual_unit_cost, updated_at)
ALTER TABLE work_order_consumptions ADD COLUMN IF NOT EXISTS actual_unit_cost numeric(18, 4) DEFAULT '0';
ALTER TABLE work_order_consumptions ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();

-- work_orders.status: align default value with application code ('planned' vs 'pending')
-- Backfill: any rows with status='pending' are treated equivalent to 'planned' in the app
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='work_orders' AND column_name='status'
             AND column_default LIKE '%pending%') THEN
    -- Migrate existing 'pending' rows to 'planned' before changing default
    UPDATE work_orders SET status = 'planned' WHERE status = 'pending';
    -- Set default to 'planned' to match the application enum
    ALTER TABLE work_orders ALTER COLUMN status SET DEFAULT 'planned';
  END IF;
END $$;

-- Additional index for BOM lookups by product
CREATE INDEX IF NOT EXISTS idx_boms_product ON boms (company_id, product_id);
CREATE INDEX IF NOT EXISTS idx_work_order_consumptions_wo ON work_order_consumptions (work_order_id);
