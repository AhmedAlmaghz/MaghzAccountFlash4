-- 0003: Manufacturing flow — production order output warehouse.
-- The treasury of finished goods: where completed quantity is received.
-- (Material issuance uses each consumption line's stock warehouse.)

ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "output_warehouse_id" uuid;
