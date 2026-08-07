-- Migration 0020: Add cash_box_id and bank_account_id to invoice/return tables
-- These link invoices/returns to the cash box or bank used for cash transactions
-- (For credit transactions, leave these NULL - they are recorded on the customer/supplier account)

DO $$ BEGIN
    ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS cash_box_id uuid REFERENCES cash_boxes(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS bank_account_id uuid REFERENCES banks(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE quotations ADD COLUMN IF NOT EXISTS cash_box_id uuid REFERENCES cash_boxes(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE quotations ADD COLUMN IF NOT EXISTS bank_account_id uuid REFERENCES banks(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE sales_returns ADD COLUMN IF NOT EXISTS cash_box_id uuid REFERENCES cash_boxes(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE sales_returns ADD COLUMN IF NOT EXISTS bank_account_id uuid REFERENCES banks(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS cash_box_id uuid REFERENCES cash_boxes(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS bank_account_id uuid REFERENCES banks(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS cash_box_id uuid REFERENCES cash_boxes(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS bank_account_id uuid REFERENCES banks(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE purchase_returns ADD COLUMN IF NOT EXISTS cash_box_id uuid REFERENCES cash_boxes(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE purchase_returns ADD COLUMN IF NOT EXISTS bank_account_id uuid REFERENCES banks(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_sales_invoices_cash_box ON sales_invoices (company_id, cash_box_id) WHERE cash_box_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_invoices_bank ON sales_invoices (company_id, bank_account_id) WHERE bank_account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_invoices_cash_box ON purchase_invoices (company_id, cash_box_id) WHERE cash_box_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_invoices_bank ON purchase_invoices (company_id, bank_account_id) WHERE bank_account_id IS NOT NULL;
