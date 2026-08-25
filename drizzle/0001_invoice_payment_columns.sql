-- 0001: Payment location columns (cash box / bank account) on invoices,
--       orders and returns. The sales & purchases API layers already write
--       these columns (payment_type = 'cash' flows), but the columns were
--       missing from the schema → "column cash_box_id does not exist" on
--       every invoice INSERT.
--
-- Plain uuid columns (no FK) — mirrors the existing receipt_vouchers /
-- payment_vouchers design so a deleted cash box never blocks invoice reads.

ALTER TABLE "sales_invoices" ADD COLUMN IF NOT EXISTS "cash_box_id" uuid;
ALTER TABLE "sales_invoices" ADD COLUMN IF NOT EXISTS "bank_account_id" uuid;

ALTER TABLE "quotations" ADD COLUMN IF NOT EXISTS "cash_box_id" uuid;
ALTER TABLE "quotations" ADD COLUMN IF NOT EXISTS "bank_account_id" uuid;

ALTER TABLE "sales_returns" ADD COLUMN IF NOT EXISTS "cash_box_id" uuid;
ALTER TABLE "sales_returns" ADD COLUMN IF NOT EXISTS "bank_account_id" uuid;

ALTER TABLE "purchase_invoices" ADD COLUMN IF NOT EXISTS "cash_box_id" uuid;
ALTER TABLE "purchase_invoices" ADD COLUMN IF NOT EXISTS "bank_account_id" uuid;

ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "cash_box_id" uuid;
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "bank_account_id" uuid;

ALTER TABLE "purchase_returns" ADD COLUMN IF NOT EXISTS "cash_box_id" uuid;
ALTER TABLE "purchase_returns" ADD COLUMN IF NOT EXISTS "bank_account_id" uuid;
