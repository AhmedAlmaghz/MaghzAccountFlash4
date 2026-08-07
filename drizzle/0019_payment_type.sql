-- Migration 0019: Add payment_type column to sales and purchase tables
-- payment_type: 'cash' for cash invoices, 'credit' for credit invoices

DO $$ BEGIN
    ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS payment_type varchar(10) NOT NULL DEFAULT 'credit';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE quotations ADD COLUMN IF NOT EXISTS payment_type varchar(10) NOT NULL DEFAULT 'credit';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE sales_returns ADD COLUMN IF NOT EXISTS payment_type varchar(10) NOT NULL DEFAULT 'credit';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS payment_type varchar(10) NOT NULL DEFAULT 'credit';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE purchase_returns ADD COLUMN IF NOT EXISTS payment_type varchar(10) NOT NULL DEFAULT 'credit';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS payment_type varchar(10) NOT NULL DEFAULT 'credit';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;