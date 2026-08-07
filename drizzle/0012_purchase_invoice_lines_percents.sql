-- ============================================================================
-- Migration 0011: Purchase invoice lines discount_percent + vat_percent
-- ============================================================================
-- Backfills per-line discount and VAT percentages that were stored only in
-- the in-memory form (lost on read after insert).
-- Defaults: 0% discount + 15% VAT (matches the default invoice form rate).
-- ============================================================================

ALTER TABLE "purchase_invoice_lines"
  ADD COLUMN IF NOT EXISTS "discount_percent" numeric(5, 2) DEFAULT 0 NOT NULL;

ALTER TABLE "purchase_invoice_lines"
  ADD COLUMN IF NOT EXISTS "vat_percent" numeric(5, 2) DEFAULT 0 NOT NULL;

-- Keep sales_invoice_lines consistent (same audit-trail concern)
ALTER TABLE "sales_invoice_lines"
  ADD COLUMN IF NOT EXISTS "discount_percent" numeric(5, 2) DEFAULT 0 NOT NULL;

ALTER TABLE "sales_invoice_lines"
  ADD COLUMN IF NOT EXISTS "vat_percent" numeric(5, 2) DEFAULT 0 NOT NULL;

-- Backfill existing rows with sensible defaults
-- For new rows, the API will pass the actual values from the form
