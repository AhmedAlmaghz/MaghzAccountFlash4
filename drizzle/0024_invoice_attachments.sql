-- 0024_invoice_attachments.sql
-- Adds a JSONB `attachments` column to `sales_invoices` so the user
-- can attach files (metadata + base64-encoded content) to an invoice.

ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS attachments jsonb DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_sales_invoices_attachments ON sales_invoices ((attachments IS NOT NULL));

