-- 0011: CRM audit column drift (same drift class as 0008/0009).
-- crm.createActivity / crm.updateActivity write created_by / updated_by / updated_at
-- and crm.updateTask writes updated_at (Electron RPC in electron/dbHandler.js,
-- pglite fallback in src/modules/crm/api.ts, and the e2e shim), but the baseline
-- never created these columns on activities, and tasks is missing updated_at.

ALTER TABLE "activities" ADD COLUMN IF NOT EXISTS "created_by" uuid;
ALTER TABLE "activities" ADD COLUMN IF NOT EXISTS "updated_by" uuid;
ALTER TABLE "activities" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now();
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now();
