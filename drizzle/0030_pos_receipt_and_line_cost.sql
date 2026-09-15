-- 0030: POS receipt sequence backfill + sales line cost snapshot
--
-- Part A — pos_receipt sequence (fixes "Sequence not found" on POS Pay):
-- The pos_receipt document type existed only in demo-seed data, never in the
-- per-company seed (seedInitialData) nor in the PGlite SEQUENCES list. Any
-- company created via onboarding therefore had NO pos_receipt row, so
-- getNextDocumentNumber() failed at checkout time. This backfills one row
-- per existing company; the seed lists are updated alongside so new
-- companies get it from birth. Idempotent — WHERE NOT EXISTS guards all.
--
-- Part B — sales_invoice_lines.unit_cost (cost snapshot for perpetual COGS):
-- Posting a sales invoice must book Dr COGS / Cr Inventory at the cost
-- prevailing AT SALE TIME. products.cost_price is a moving average that
-- changes later (purchases, manufacturing receipts), so the sale-time cost
-- is frozen per line. Backfill inherits the current cost_price (best
-- available truth for historical lines).

-- Part A: one pos_receipt sequence per company that lacks it.
INSERT INTO document_sequences (company_id, document_type, prefix, suffix, starting_number, current_number, increment_step, padding_length, year_reset, is_active)
SELECT c.id, 'pos_receipt', 'POS-', '', 1, 0, 1, 6, FALSE, TRUE
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM document_sequences ds
  WHERE ds.company_id = c.id AND ds.document_type = 'pos_receipt'
);
--> statement-breakpoint

-- Part B1: cost snapshot column on sales invoice lines.
ALTER TABLE sales_invoice_lines ADD COLUMN IF NOT EXISTS unit_cost numeric(18, 4) NOT NULL DEFAULT 0;
--> statement-breakpoint

-- Part B2: backfill historical lines from the product's current cost.
-- (Base-unit cost × base_quantity is the COGS formula; cost_price is kept
-- in base units by the moving-average updates.)
UPDATE sales_invoice_lines sil
SET unit_cost = COALESCE(p.cost_price, 0)
FROM products p
WHERE sil.product_id = p.id AND sil.unit_cost = 0;
