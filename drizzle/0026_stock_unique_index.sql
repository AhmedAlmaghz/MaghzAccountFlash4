-- 0026: Unique index on stock (company_id, product_id, warehouse_id)
--
-- The AI transfer wizard (inventory.transfer_stock) upserts destination
-- stock rows with
--   ON CONFLICT (company_id, product_id, warehouse_id) DO UPDATE
-- but NO migration ever created that unique constraint — a fresh database
-- makes every such upsert fail with "there is no unique or exclusion
-- constraint matching the ON CONFLICT specification".
--
-- Pre-existing duplicate rows (the same product per warehouse appearing
-- multiple times, possible from older code paths that plain-INSERTed) are
-- merged BEFORE the index is created: quantities summed into the survivor
-- row (lowest id per key), redundant rows deleted. Idempotent — on a
-- second run no group has COUNT(*) > 1 so both statements are no-ops.
--
-- NOTE: stock has NO created_at column (only updated_at) — upserts must
-- not reference it (see wizardTools.ts transfer_stock).

-- Step 1: fold each duplicate group's total quantity into its survivor row.
-- NOTE: MIN(uuid) does not exist in PostgreSQL, so compare via id::text
-- (lexicographically deterministic survivor per key).
UPDATE stock s
SET quantity = g.total,
    updated_at = NOW()
FROM (
  SELECT company_id, product_id, warehouse_id, SUM(quantity) AS total, MIN(id::text)::uuid AS keep_id
  FROM stock
  GROUP BY company_id, product_id, warehouse_id
  HAVING COUNT(*) > 1
) g
WHERE s.id = g.keep_id;
--> statement-breakpoint

-- Step 2: delete every non-survivor row of a duplicated key.
-- (Single-row groups: the row IS its group's MIN(id::text) → kept.)
DELETE FROM stock
WHERE id NOT IN (
  SELECT MIN(id::text)::uuid FROM stock GROUP BY company_id, product_id, warehouse_id
);
--> statement-breakpoint

-- Step 3: the unique index the ON CONFLICT clause targets.
CREATE UNIQUE INDEX IF NOT EXISTS "stock_company_product_warehouse_uidx"
  ON stock (company_id, product_id, warehouse_id);
