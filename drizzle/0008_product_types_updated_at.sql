-- 0008: product_types.updated_at — the update statement in core/api.ts has
-- always written updated_at = NOW(), but the column was never created in the
-- baseline schema (drift). Add it for audit consistency with other tables.

ALTER TABLE "product_types" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now();
