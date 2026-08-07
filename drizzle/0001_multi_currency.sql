-- =============================================================
-- Migration 0001: Multi-currency support
-- =============================================================
-- Adds currency_code, exchange_rate, and base_currency_amount columns
-- to transactional tables. Defaults to YER (Yemeni Rial) for backward
-- compatibility.
-- =============================================================

-- sales_invoices
ALTER TABLE "sales_invoices" ADD COLUMN IF NOT EXISTS "currency_code" varchar(3) DEFAULT 'YER' NOT NULL;
ALTER TABLE "sales_invoices" ADD COLUMN IF NOT EXISTS "exchange_rate" numeric(18, 6) DEFAULT '1' NOT NULL;
ALTER TABLE "sales_invoices" ADD COLUMN IF NOT EXISTS "base_currency_amount" numeric(18, 4) DEFAULT '0' NOT NULL;
ALTER TABLE "sales_invoices" ADD COLUMN IF NOT EXISTS "base_currency_paid" numeric(18, 4) DEFAULT '0' NOT NULL;

-- sales_invoice_lines
ALTER TABLE "sales_invoice_lines" ADD COLUMN IF NOT EXISTS "currency_code" varchar(3) DEFAULT 'YER' NOT NULL;
ALTER TABLE "sales_invoice_lines" ADD COLUMN IF NOT EXISTS "exchange_rate" numeric(18, 6) DEFAULT '1' NOT NULL;
ALTER TABLE "sales_invoice_lines" ADD COLUMN IF NOT EXISTS "base_currency_line_total" numeric(18, 4) DEFAULT '0' NOT NULL;

-- purchase_invoices
ALTER TABLE "purchase_invoices" ADD COLUMN IF NOT EXISTS "currency_code" varchar(3) DEFAULT 'YER' NOT NULL;
ALTER TABLE "purchase_invoices" ADD COLUMN IF NOT EXISTS "exchange_rate" numeric(18, 6) DEFAULT '1' NOT NULL;
ALTER TABLE "purchase_invoices" ADD COLUMN IF NOT EXISTS "base_currency_amount" numeric(18, 4) DEFAULT '0' NOT NULL;
ALTER TABLE "purchase_invoices" ADD COLUMN IF NOT EXISTS "base_currency_paid" numeric(18, 4) DEFAULT '0' NOT NULL;

-- purchase_invoice_lines
ALTER TABLE "purchase_invoice_lines" ADD COLUMN IF NOT EXISTS "currency_code" varchar(3) DEFAULT 'YER' NOT NULL;
ALTER TABLE "purchase_invoice_lines" ADD COLUMN IF NOT EXISTS "exchange_rate" numeric(18, 6) DEFAULT '1' NOT NULL;
ALTER TABLE "purchase_invoice_lines" ADD COLUMN IF NOT EXISTS "base_currency_line_total" numeric(18, 4) DEFAULT '0' NOT NULL;

-- receipt_vouchers
ALTER TABLE "receipt_vouchers" ADD COLUMN IF NOT EXISTS "currency_code" varchar(3) DEFAULT 'YER' NOT NULL;
ALTER TABLE "receipt_vouchers" ADD COLUMN IF NOT EXISTS "exchange_rate" numeric(18, 6) DEFAULT '1' NOT NULL;
ALTER TABLE "receipt_vouchers" ADD COLUMN IF NOT EXISTS "base_currency_amount" numeric(18, 4) DEFAULT '0' NOT NULL;

-- payment_vouchers
ALTER TABLE "payment_vouchers" ADD COLUMN IF NOT EXISTS "currency_code" varchar(3) DEFAULT 'YER' NOT NULL;
ALTER TABLE "payment_vouchers" ADD COLUMN IF NOT EXISTS "exchange_rate" numeric(18, 6) DEFAULT '1' NOT NULL;
ALTER TABLE "payment_vouchers" ADD COLUMN IF NOT EXISTS "base_currency_amount" numeric(18, 4) DEFAULT '0' NOT NULL;

-- Index for aggregation by currency (per company, per currency)
CREATE INDEX IF NOT EXISTS "idx_sales_invoices_company_currency" ON "sales_invoices" ("company_id", "currency_code");
CREATE INDEX IF NOT EXISTS "idx_purchase_invoices_company_currency" ON "purchase_invoices" ("company_id", "currency_code");
CREATE INDEX IF NOT EXISTS "idx_receipt_vouchers_company_currency" ON "receipt_vouchers" ("company_id", "currency_code");
CREATE INDEX IF NOT EXISTS "idx_payment_vouchers_company_currency" ON "payment_vouchers" ("company_id", "currency_code");
