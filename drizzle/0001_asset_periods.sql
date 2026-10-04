-- 0001_asset_periods: fixed-asset operational fields, sub-period accounting
-- locks (monthly / quarterly / half-yearly), soft-close state, and the
-- asset-disposal gains account (41902) for existing companies.
--
-- Conventions: every statement is breakpoint-terminated (the Electron runner
-- and PGlite split on the marker) and idempotent (IF NOT EXISTS / guarded
-- DO blocks / WHERE NOT EXISTS), so replaying is always safe.

ALTER TABLE "fixed_assets" ADD COLUMN IF NOT EXISTS "location" varchar(150);
--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD COLUMN IF NOT EXISTS "custodian" varchar(200);
--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD COLUMN IF NOT EXISTS "serial_number" varchar(100);
--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD COLUMN IF NOT EXISTS "warranty_expiry" date;
--> statement-breakpoint
ALTER TABLE "fixed_assets" ADD COLUMN IF NOT EXISTS "notes" text;
--> statement-breakpoint
ALTER TABLE "accounting_periods" ADD COLUMN IF NOT EXISTS "period_type" varchar(20) DEFAULT 'annual' NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_accounting_periods_year') THEN
    ALTER TABLE "accounting_periods" DROP CONSTRAINT "uq_accounting_periods_year";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_accounting_periods_range') THEN
    ALTER TABLE "accounting_periods" ADD CONSTRAINT "uq_accounting_periods_range" UNIQUE("company_id","start_date","end_date");
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounting_periods_status') THEN
    ALTER TABLE "accounting_periods" DROP CONSTRAINT "accounting_periods_status";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'accounting_periods_status') THEN
    ALTER TABLE "accounting_periods" ADD CONSTRAINT "accounting_periods_status" CHECK ("status" IN ('open','soft_closed','closed'));
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO accounts (company_id, code, name_ar, name_en, parent_id, type, nature, is_group, balance)
SELECT c.id, '41902', 'أرباح استبعاد الأصول الثابتة', 'Fixed Asset Disposal Gains',
       (SELECT id FROM accounts WHERE company_id = c.id AND code = '41' LIMIT 1),
       'revenue', 'credit', FALSE, 0
FROM companies c
WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE company_id = c.id AND code = '41902');
--> statement-breakpoint
INSERT INTO default_accounts (company_id, function_key, account_id, is_required, description)
SELECT a.company_id, 'default_asset_disposal_gain', a.id, false, 'حساب أرباح استبعاد الأصول الثابتة'
FROM accounts a
WHERE a.code = '41902'
  AND NOT EXISTS (SELECT 1 FROM default_accounts WHERE company_id = a.company_id AND function_key = 'default_asset_disposal_gain');
--> statement-breakpoint
