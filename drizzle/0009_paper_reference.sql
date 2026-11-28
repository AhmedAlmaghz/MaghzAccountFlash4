-- Paper-document reference number (invoice/voucher printed number).
-- Optional, tenant-scoped parent tables only. Idempotent for existing DBs.
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS reference varchar(100);
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS reference varchar(100);
ALTER TABLE sales_returns ADD COLUMN IF NOT EXISTS reference varchar(100);
ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS reference varchar(100);
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS reference varchar(100);
ALTER TABLE purchase_returns ADD COLUMN IF NOT EXISTS reference varchar(100);
ALTER TABLE receipt_vouchers ADD COLUMN IF NOT EXISTS reference varchar(100);
ALTER TABLE payment_vouchers ADD COLUMN IF NOT EXISTS reference varchar(100);
CREATE INDEX IF NOT EXISTS idx_sales_invoices_reference ON sales_invoices (company_id, reference) WHERE reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_invoices_reference ON purchase_invoices (company_id, reference) WHERE reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_receipt_vouchers_reference ON receipt_vouchers (company_id, reference) WHERE reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payment_vouchers_reference ON payment_vouchers (company_id, reference) WHERE reference IS NOT NULL;
