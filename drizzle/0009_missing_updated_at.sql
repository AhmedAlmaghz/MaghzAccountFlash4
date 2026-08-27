-- 0009: missing updated_at columns (same drift class as 0008).
-- UPDATE statements in core/api.ts, modules/core/api.ts and electron/dbHandler.js
-- write updated_at = NOW() on these tables, but the baseline never created it.

ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now();
ALTER TABLE "currencies" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now();
ALTER TABLE "payroll_components" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now();
