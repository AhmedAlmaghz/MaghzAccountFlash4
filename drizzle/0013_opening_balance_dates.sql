-- 0013_opening_balance_dates.sql
-- Opening-balance integration (world practice: every statement/balance must
-- include the opening balance). Adds an explicit opening date to customers and
-- suppliers so statements can order the opening row chronologically and aging
-- can bucket it accurately, plus a safeguard index on the seed account.

ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "opening_date" date;
--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "opening_date" date;
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "opening_date" date;
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "opening_date" date;
