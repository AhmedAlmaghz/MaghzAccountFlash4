-- ===== 0004_doc_version_columns =====
-- Optimistic concurrency (multi-user document locking): add `doc_version`
-- to all 13 document tables. Update paths pass the expected version
-- (`expectedVersion` in update payloads) — a mismatch rejects the save with
-- a conflict error ("документ изменился, перезагрузите форму").
--
-- Multi-user rules (B2):
--  - Client: load the document via getById (fresh doc_version) into
--    formData.docVersion; pass `expectedVersion: formData.docVersion` on save.
--  - Server: UPDATE ... SET doc_version = doc_version + 1 WHERE id = $1 AND
--    company_id = $2 AND doc_version = $expected AND status = 'draft' →
--    rowCount === 0 → 409-style conflict (no write).
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS doc_version integer NOT NULL DEFAULT 1;
ALTER TABLE sales_invoice_lines ADD COLUMN IF NOT EXISTS doc_version integer NOT NULL DEFAULT 1;
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS doc_version integer NOT NULL DEFAULT 1;
ALTER TABLE quotation_lines ADD COLUMN IF NOT EXISTS doc_version integer NOT NULL DEFAULT 1;
ALTER TABLE sales_returns ADD COLUMN IF NOT EXISTS doc_version integer NOT NULL DEFAULT 1;
ALTER TABLE sales_return_lines ADD COLUMN IF NOT EXISTS doc_version integer NOT NULL DEFAULT 1;
ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS doc_version integer NOT NULL DEFAULT 1;
ALTER TABLE purchase_invoice_lines ADD COLUMN IF NOT EXISTS doc_version integer NOT NULL DEFAULT 1;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS doc_version integer NOT NULL DEFAULT 1;
ALTER TABLE purchase_order_lines ADD COLUMN IF NOT EXISTS doc_version integer NOT NULL DEFAULT 1;
ALTER TABLE purchase_returns ADD COLUMN IF NOT EXISTS doc_version integer NOT NULL DEFAULT 1;
ALTER TABLE purchase_return_lines ADD COLUMN IF NOT EXISTS doc_version integer NOT NULL DEFAULT 1;
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS doc_version integer NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_sales_invoices_doc_version ON sales_invoices(company_id, doc_version);
CREATE INDEX IF NOT EXISTS idx_sales_invoice_lines_doc_version ON sales_invoice_lines(invoice_id, doc_version);
CREATE INDEX IF NOT EXISTS idx_quotations_doc_version ON quotations(company_id, doc_version);
CREATE INDEX IF NOT EXISTS idx_sales_returns_doc_version ON sales_returns(company_id, doc_version);
CREATE INDEX IF NOT EXISTS idx_purchase_invoices_doc_version ON purchase_invoices(company_id, doc_version);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_doc_version ON purchase_orders(company_id, doc_version);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_doc_version ON purchase_returns(company_id, doc_version);
CREATE INDEX IF NOT EXISTS idx_journal_entries_doc_version ON journal_entries(transaction_id, doc_version);
