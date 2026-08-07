-- Migration 0005: Fix work_order status default + add updated_at
-- 1. Change default from 'pending' to 'planned'
-- 2. Update existing 'pending' rows to 'planned'
-- 3. Add updated_at columns to all 4 manufacturing tables

DO $$
BEGIN
  -- 1. Change default on work_orders.status
  ALTER TABLE work_orders ALTER COLUMN status SET DEFAULT 'planned';
  
  -- 2. Update existing 'pending' rows
  UPDATE work_orders SET status = 'planned' WHERE status = 'pending';
  
  -- 3. Add updated_at columns where missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'boms' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE boms ADD COLUMN updated_at timestamp with time zone DEFAULT now();
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bom_lines' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE bom_lines ADD COLUMN updated_at timestamp with time zone DEFAULT now();
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'work_orders' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE work_orders ADD COLUMN updated_at timestamp with time zone DEFAULT now();
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'work_order_consumptions' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE work_order_consumptions ADD COLUMN updated_at timestamp with time zone DEFAULT now();
  END IF;
END $$;
