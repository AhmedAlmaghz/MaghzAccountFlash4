-- ===== 0005_document_number_uniques =====
-- Phase 3 (multi-user): hard-unique document numbers.
--
-- Problem (see plan 00-plan-multi-user.md, Phase 3): two concurrent creators
-- used to pass the "is this number free?" check and insert, both landing on
-- the same invoice_number / quotation_number / return_number / order_number /
-- voucher_number. The database now rejects duplicates itself:
--   1) Dedupe existing duplicates first (keep the lowest id per number).
--   2) Add UNIQUE (company_id, number_column) to the 12 document tables.
--   3) document_sequences gets UNIQUE (company_id, document_type) as well.
--
-- Idempotent: deletes are no-ops on re-run; constraints are guarded by
-- pg_constraint checks (PostgreSQL has no ADD CONSTRAINT IF NOT EXISTS).

-- 1) Deduplicates (safe to re-run: only exact duplicates beyond the first are deleted)

DELETE FROM sales_invoices WHERE id IN (
  SELECT d.id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY company_id, invoice_number ORDER BY id) AS rn
    FROM sales_invoices WHERE invoice_number IS NOT NULL
  ) d WHERE d.rn > 1
);
--> statement-breakpoint

DELETE FROM quotations WHERE id IN (
  SELECT d.id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY company_id, quotation_number ORDER BY id) AS rn
    FROM quotations WHERE quotation_number IS NOT NULL
  ) d WHERE d.rn > 1
);
--> statement-breakpoint

DELETE FROM sales_returns WHERE id IN (
  SELECT d.id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY company_id, return_number ORDER BY id) AS rn
    FROM sales_returns WHERE return_number IS NOT NULL
  ) d WHERE d.rn > 1
);
--> statement-breakpoint

DELETE FROM purchase_invoices WHERE id IN (
  SELECT d.id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY company_id, invoice_number ORDER BY id) AS rn
    FROM purchase_invoices WHERE invoice_number IS NOT NULL
  ) d WHERE d.rn > 1
);
--> statement-breakpoint

DELETE FROM purchase_orders WHERE id IN (
  SELECT d.id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY company_id, order_number ORDER BY id) AS rn
    FROM purchase_orders WHERE order_number IS NOT NULL
  ) d WHERE d.rn > 1
);
--> statement-breakpoint

DELETE FROM purchase_returns WHERE id IN (
  SELECT d.id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY company_id, return_number ORDER BY id) AS rn
    FROM purchase_returns WHERE return_number IS NOT NULL
  ) d WHERE d.rn > 1
);
--> statement-breakpoint

DELETE FROM work_orders WHERE id IN (
  SELECT d.id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY company_id, order_number ORDER BY id) AS rn
    FROM work_orders WHERE order_number IS NOT NULL
  ) d WHERE d.rn > 1
);
--> statement-breakpoint

DELETE FROM payroll_runs WHERE id IN (
  SELECT d.id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY company_id, run_number ORDER BY id) AS rn
    FROM payroll_runs WHERE run_number IS NOT NULL
  ) d WHERE d.rn > 1
);
--> statement-breakpoint

DELETE FROM receipt_vouchers WHERE id IN (
  SELECT d.id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY company_id, voucher_number ORDER BY id) AS rn
    FROM receipt_vouchers WHERE voucher_number IS NOT NULL
  ) d WHERE d.rn > 1
);
--> statement-breakpoint

DELETE FROM payment_vouchers WHERE id IN (
  SELECT d.id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY company_id, voucher_number ORDER BY id) AS rn
    FROM payment_vouchers WHERE voucher_number IS NOT NULL
  ) d WHERE d.rn > 1
);
--> statement-breakpoint

DELETE FROM customers WHERE id IN (
  SELECT d.id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY company_id, code ORDER BY id) AS rn
    FROM customers WHERE code IS NOT NULL
  ) d WHERE d.rn > 1
);
--> statement-breakpoint

DELETE FROM suppliers WHERE id IN (
  SELECT d.id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY company_id, code ORDER BY id) AS rn
    FROM suppliers WHERE code IS NOT NULL
  ) d WHERE d.rn > 1
);
--> statement-breakpoint

DELETE FROM document_sequences WHERE id IN (
  SELECT d.id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY company_id, document_type ORDER BY id) AS rn
    FROM document_sequences
  ) d WHERE d.rn > 1
);
--> statement-breakpoint

-- 2) UNIQUE constraints on the 12 document tables (PostgreSQL-side, idempotent).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'sales_invoices'::regclass AND conname = 'uq_sales_invoices_company_invoice_number') THEN
    ALTER TABLE sales_invoices ADD CONSTRAINT uq_sales_invoices_company_invoice_number UNIQUE (company_id, invoice_number);
  END IF;
END
$$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'quotations'::regclass AND conname = 'uq_quotations_company_quotation_number') THEN
    ALTER TABLE quotations ADD CONSTRAINT uq_quotations_company_quotation_number UNIQUE (company_id, quotation_number);
  END IF;
END
$$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'sales_returns'::regclass AND conname = 'uq_sales_returns_company_return_number') THEN
    ALTER TABLE sales_returns ADD CONSTRAINT uq_sales_returns_company_return_number UNIQUE (company_id, return_number);
  END IF;
END
$$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'purchase_invoices'::regclass AND conname = 'uq_purchase_invoices_company_invoice_number') THEN
    ALTER TABLE purchase_invoices ADD CONSTRAINT uq_purchase_invoices_company_invoice_number UNIQUE (company_id, invoice_number);
  END IF;
END
$$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'purchase_orders'::regclass AND conname = 'uq_purchase_orders_company_order_number') THEN
    ALTER TABLE purchase_orders ADD CONSTRAINT uq_purchase_orders_company_order_number UNIQUE (company_id, order_number);
  END IF;
END
$$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'purchase_returns'::regclass AND conname = 'uq_purchase_returns_company_return_number') THEN
    ALTER TABLE purchase_returns ADD CONSTRAINT uq_purchase_returns_company_return_number UNIQUE (company_id, return_number);
  END IF;
END
$$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'work_orders'::regclass AND conname = 'uq_work_orders_company_order_number') THEN
    ALTER TABLE work_orders ADD CONSTRAINT uq_work_orders_company_order_number UNIQUE (company_id, order_number);
  END IF;
END
$$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'payroll_runs'::regclass AND conname = 'uq_payroll_runs_company_run_number') THEN
    ALTER TABLE payroll_runs ADD CONSTRAINT uq_payroll_runs_company_run_number UNIQUE (company_id, run_number);
  END IF;
END
$$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'receipt_vouchers'::regclass AND conname = 'uq_receipt_vouchers_company_voucher_number') THEN
    ALTER TABLE receipt_vouchers ADD CONSTRAINT uq_receipt_vouchers_company_voucher_number UNIQUE (company_id, voucher_number);
  END IF;
END
$$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'payment_vouchers'::regclass AND conname = 'uq_payment_vouchers_company_voucher_number') THEN
    ALTER TABLE payment_vouchers ADD CONSTRAINT uq_payment_vouchers_company_voucher_number UNIQUE (company_id, voucher_number);
  END IF;
END
$$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'customers'::regclass AND conname = 'uq_customers_company_code') THEN
    ALTER TABLE customers ADD CONSTRAINT uq_customers_company_code UNIQUE (company_id, code);
  END IF;
END
$$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'suppliers'::regclass AND conname = 'uq_suppliers_company_code') THEN
    ALTER TABLE suppliers ADD CONSTRAINT uq_suppliers_company_code UNIQUE (company_id, code);
  END IF;
END
$$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'document_sequences'::regclass AND conname = 'uq_document_sequences_company_document_type') THEN
    ALTER TABLE document_sequences ADD CONSTRAINT uq_document_sequences_company_document_type UNIQUE (company_id, document_type);
  END IF;
END
$$;
