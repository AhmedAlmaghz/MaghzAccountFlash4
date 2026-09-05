-- Migration 0020: companies audit columns
-- The unified company API (typed RPC + PGlite) writes created_by/updated_by,
-- but the columns never existed in the schema, so every company save failed
-- with: column "updated_by" of relation "companies" does not exist.
-- Nullable plain uuid (repo convention — no FK, matches sibling tables).
ALTER TABLE companies ADD COLUMN IF NOT EXISTS created_by uuid;
--> statement-breakpoint
ALTER TABLE companies ADD COLUMN IF NOT EXISTS updated_by uuid;
--> statement-breakpoint
