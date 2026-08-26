-- 0002: Unify cash handling — remove banks, keep cash boxes as the single
--       "النقدية والخزائن" (Cash & Treasuries) concept.
--
-- 1) Backfill: vouchers paid via bank transfer keep a location — point them
--    at the company's first active cash box so no voucher loses its treasury.
-- 2) Drop the now-dead bank_account_id columns everywhere.
-- 3) Drop the banks table itself.

UPDATE receipt_vouchers rv
SET cash_box_id = COALESCE(
      rv.cash_box_id,
      (SELECT cb.id FROM cash_boxes cb WHERE cb.company_id = rv.company_id AND cb.is_active
       ORDER BY cb.created_at LIMIT 1)
    )
WHERE rv.bank_account_id IS NOT NULL AND rv.payment_method = 'bank';

UPDATE payment_vouchers pv
SET cash_box_id = COALESCE(
      pv.cash_box_id,
      (SELECT cb.id FROM cash_boxes cb WHERE cb.company_id = pv.company_id AND cb.is_active
       ORDER BY cb.created_at LIMIT 1)
    )
WHERE pv.bank_account_id IS NOT NULL AND pv.payment_method = 'bank';

ALTER TABLE "receipt_vouchers" DROP COLUMN IF EXISTS "bank_account_id";
ALTER TABLE "payment_vouchers" DROP COLUMN IF EXISTS "bank_account_id";

ALTER TABLE "sales_invoices" DROP COLUMN IF EXISTS "bank_account_id";
ALTER TABLE "quotations" DROP COLUMN IF EXISTS "bank_account_id";
ALTER TABLE "sales_returns" DROP COLUMN IF EXISTS "bank_account_id";
ALTER TABLE "purchase_invoices" DROP COLUMN IF EXISTS "bank_account_id";
ALTER TABLE "purchase_orders" DROP COLUMN IF EXISTS "bank_account_id";
ALTER TABLE "purchase_returns" DROP COLUMN IF EXISTS "bank_account_id";

DROP TABLE IF EXISTS "banks";
