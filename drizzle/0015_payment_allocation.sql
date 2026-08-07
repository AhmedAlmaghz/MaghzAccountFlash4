-- ============================================================================
-- 0015: Payment allocation columns (link vouchers to invoices)
-- ============================================================================
-- Adds invoice_id columns to receipt_vouchers and payment_vouchers to allow
-- automatic payment application against outstanding invoices. Without this
-- column, vouchers cannot be linked to specific invoices, which means:
--   1. sales_invoices.paid_amount never updates when receipts are posted
--   2. customers.balance never decreases when payments are received
--   3. AR Aging reports show incorrect outstanding amounts
--   4. customers.balance never increases when payments are made
--   5. AP Aging reports show incorrect outstanding amounts
--
-- The amount_applied column stores how much of the voucher was applied
-- to the linked invoice (0 if not yet applied). This allows partial
-- application of a single voucher to a single invoice.
--
-- Idempotent: safe to re-run (uses ADD COLUMN IF NOT EXISTS).
-- ============================================================================

-- receipt_vouchers: link to customer invoice
ALTER TABLE receipt_vouchers
  ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES sales_invoices(id) ON DELETE RESTRICT;
ALTER TABLE receipt_vouchers
  ADD COLUMN IF NOT EXISTS amount_applied numeric(18, 4) DEFAULT '0' NOT NULL;
ALTER TABLE receipt_vouchers
  ADD COLUMN IF NOT EXISTS base_currency_applied numeric(18, 4) DEFAULT '0' NOT NULL;

-- payment_vouchers: link to supplier invoice
ALTER TABLE payment_vouchers
  ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES purchase_invoices(id) ON DELETE RESTRICT;
ALTER TABLE payment_vouchers
  ADD COLUMN IF NOT EXISTS amount_applied numeric(18, 4) DEFAULT '0' NOT NULL;
ALTER TABLE payment_vouchers
  ADD COLUMN IF NOT EXISTS base_currency_applied numeric(18, 4) DEFAULT '0' NOT NULL;

-- ============================================================================
-- § 1. Indexes for fast payment application queries
-- ============================================================================
-- Without these, every "show me all vouchers for this invoice" query
-- does a sequential scan on the vouchers table.
CREATE INDEX IF NOT EXISTS idx_receipt_vouchers_invoice
  ON receipt_vouchers(company_id, invoice_id)
  WHERE invoice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payment_vouchers_invoice
  ON payment_vouchers(company_id, invoice_id)
  WHERE invoice_id IS NOT NULL;

-- ============================================================================
-- § 2. CHECK constraints for data integrity
-- ============================================================================
-- Amount applied must not exceed voucher amount, and must be non-negative.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'receipt_vouchers_amount_applied_check') THEN
    ALTER TABLE receipt_vouchers
      ADD CONSTRAINT receipt_vouchers_amount_applied_check
      CHECK (amount_applied >= 0 AND amount_applied <= amount);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_vouchers_amount_applied_check') THEN
    ALTER TABLE payment_vouchers
      ADD CONSTRAINT payment_vouchers_amount_applied_check
      CHECK (amount_applied >= 0 AND amount_applied <= amount);
  END IF;
END $$;
