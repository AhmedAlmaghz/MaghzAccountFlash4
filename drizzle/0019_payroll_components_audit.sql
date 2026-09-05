-- Migration 0019: payroll_components audit columns
-- The create/update/deactivate APIs write created_by/updated_by, but the
-- columns never existed in the schema, so every write failed with:
--   column "created_by" of relation "payroll_components" does not exist
-- Nullable plain uuid (repo convention — no FK, matches sibling tables).
ALTER TABLE payroll_components ADD COLUMN IF NOT EXISTS created_by uuid;
--> statement-breakpoint
ALTER TABLE payroll_components ADD COLUMN IF NOT EXISTS updated_by uuid;
--> statement-breakpoint
