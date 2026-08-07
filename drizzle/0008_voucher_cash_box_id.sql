-- ============================================================================
-- § 0008: Add cash_box_id to receipt_vouchers and payment_vouchers
-- ============================================================================

ALTER TABLE IF EXISTS "receipt_vouchers"
  ADD COLUMN IF NOT EXISTS "cash_box_id" uuid REFERENCES "cash_boxes"("id") ON DELETE SET NULL;

ALTER TABLE IF EXISTS "payment_vouchers"
  ADD COLUMN IF NOT EXISTS "cash_box_id" uuid REFERENCES "cash_boxes"("id") ON DELETE SET NULL;
