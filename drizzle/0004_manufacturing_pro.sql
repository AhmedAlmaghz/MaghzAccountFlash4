-- 0004: Manufacturing professionalization.
--  1) boms.output_quantity: how many finished-product units one BOM batch
--     (with its registered material quantities) yields. Work-order
--     quantity = number of batches; expected production = batches × output_quantity.
--  2) work_orders.batch_number: lot number (YYYYMMDD-NNN, generated in the API).
--  3) work_orders.supervisor_id: production supervisor (employee).
--  4) product_types.usage: semantic classification used to filter pickers —
--     'finished' (منتج نهائي / تام الإنتاج), 'raw' (مواد أولية / خام), 'other'.

ALTER TABLE "boms" ADD COLUMN IF NOT EXISTS "output_quantity" numeric(18, 4) NOT NULL DEFAULT 1;

ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "batch_number" varchar(50);
ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "supervisor_id" uuid REFERENCES "employees"("id") ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "idx_work_orders_company_batch" ON "work_orders" ("company_id", "batch_number") WHERE "batch_number" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_work_orders_supervisor" ON "work_orders" ("company_id", "supervisor_id");

ALTER TABLE "product_types" ADD COLUMN IF NOT EXISTS "usage" varchar(20) NOT NULL DEFAULT 'other';

-- Backfill usage from well-known codes/names (idempotent: only touches 'other').
UPDATE "product_types" SET "usage" = 'finished'
 WHERE "usage" = 'other'
   AND ("code" = 'FG'
        OR "name_ar" LIKE '%تام%'
        OR "name_ar" LIKE '%نهائي%'
        OR "name_en" ILIKE '%finished%'
        OR "name_en" ILIKE '%final%');

UPDATE "product_types" SET "usage" = 'raw'
 WHERE "usage" = 'other'
   AND ("code" = 'RAW'
        OR "name_ar" LIKE '%خام%'
        OR "name_ar" LIKE '%أولية%'
        OR "name_ar" LIKE '%اولية%'
        OR "name_en" ILIKE '%raw%');
