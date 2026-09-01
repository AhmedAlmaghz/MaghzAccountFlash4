-- 0015: CRM professional upgrade — referential integrity + performance + stage machine support.
--
-- 1. Drop dead tables (no application code reads or writes them — the codebase
--    settled on `activities` for the event log and `tasks` for work items).
-- 2. Orphan cleanup: null out dangling lead_id / opportunity_id / customer_id
--    references BEFORE adding FK constraints (existing rows may point at
--    deleted records — the baseline had no FKs on these columns).
-- 3. FK constraints with ON DELETE SET NULL — deleting a lead/opportunity/
--    customer never cascades away CRM history; the link simply severs.
-- 4. Performance indexes — every CRM query filters by company_id; the baseline
--    had ZERO indexes on these tables (full table scans).
-- 5. New columns for the professional stage machine and follow-up tracking:
--    opportunities.close_date (stamped when stage becomes won/lost — final)
--    leads.last_contacted_at (auto-stamped when a linked activity is logged).

-- ─── 1. Drop dead tables ────────────────────────────────────────────────────
DROP TABLE IF EXISTS "crm_activities";
DROP TABLE IF EXISTS "calls";

-- ─── 2. Orphan cleanup (SET NULL any reference pointing at a missing row) ───
UPDATE "opportunities" o SET "lead_id" = NULL
  WHERE o."lead_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "leads" l WHERE l."id" = o."lead_id");
UPDATE "opportunities" o SET "customer_id" = NULL
  WHERE o."customer_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "customers" c WHERE c."id" = o."customer_id");
UPDATE "tasks" t SET "opportunity_id" = NULL
  WHERE t."opportunity_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "opportunities" o WHERE o."id" = t."opportunity_id");
UPDATE "tasks" t SET "lead_id" = NULL
  WHERE t."lead_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "leads" l WHERE l."id" = t."lead_id");
UPDATE "tasks" t SET "customer_id" = NULL
  WHERE t."customer_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "customers" c WHERE c."id" = t."customer_id");
UPDATE "activities" a SET "opportunity_id" = NULL
  WHERE a."opportunity_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "opportunities" o WHERE o."id" = a."opportunity_id");
UPDATE "activities" a SET "lead_id" = NULL
  WHERE a."lead_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "leads" l WHERE l."id" = a."lead_id");
UPDATE "activities" a SET "customer_id" = NULL
  WHERE a."customer_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "customers" c WHERE c."id" = a."customer_id");

-- ─── 3. Referential integrity (FK ON DELETE SET NULL) ───────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_opportunities_lead'
  ) THEN
    ALTER TABLE "opportunities" ADD CONSTRAINT "fk_opportunities_lead"
      FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_opportunities_customer'
  ) THEN
    ALTER TABLE "opportunities" ADD CONSTRAINT "fk_opportunities_customer"
      FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_tasks_opportunity'
  ) THEN
    ALTER TABLE "tasks" ADD CONSTRAINT "fk_tasks_opportunity"
      FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_tasks_lead'
  ) THEN
    ALTER TABLE "tasks" ADD CONSTRAINT "fk_tasks_lead"
      FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_tasks_customer'
  ) THEN
    ALTER TABLE "tasks" ADD CONSTRAINT "fk_tasks_customer"
      FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_activities_opportunity'
  ) THEN
    ALTER TABLE "activities" ADD CONSTRAINT "fk_activities_opportunity"
      FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_activities_lead'
  ) THEN
    ALTER TABLE "activities" ADD CONSTRAINT "fk_activities_lead"
      FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_activities_customer'
  ) THEN
    ALTER TABLE "activities" ADD CONSTRAINT "fk_activities_customer"
      FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL;
  END IF;
END $$;

-- ─── 4. Performance indexes ─────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "idx_leads_company_status" ON "leads" ("company_id", "status");
CREATE INDEX IF NOT EXISTS "idx_leads_company_created" ON "leads" ("company_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_opportunities_company_stage" ON "opportunities" ("company_id", "stage");
CREATE INDEX IF NOT EXISTS "idx_opportunities_company_close" ON "opportunities" ("company_id", "expected_close_date");
CREATE INDEX IF NOT EXISTS "idx_tasks_company_status_due" ON "tasks" ("company_id", "status", "due_date");
CREATE INDEX IF NOT EXISTS "idx_activities_company_date" ON "activities" ("company_id", "activity_date");

-- ─── 5. Stage machine + follow-up tracking columns ──────────────────────────
ALTER TABLE "opportunities" ADD COLUMN IF NOT EXISTS "close_date" date;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "last_contacted_at" timestamp with time zone;
