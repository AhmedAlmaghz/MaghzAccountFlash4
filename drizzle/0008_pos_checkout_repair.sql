-- Repair for long-lived PGlite / older databases whose 0000_init snapshot
-- predates the POS and multi-currency columns. Every ADD is idempotent: on a
-- current database this migration is a no-op. POS checkout referenced these
-- columns and failed with SQLSTATE 42703 → the generic "خطأ في قاعدة البيانات".
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS currency_code varchar(3) DEFAULT 'YER' NOT NULL;
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS exchange_rate numeric(18,6) DEFAULT '1' NOT NULL;
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS base_currency_amount numeric(18,4) DEFAULT '0' NOT NULL;
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS base_currency_paid numeric(18,4) DEFAULT '0' NOT NULL;
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS discount_amount numeric(18,4) DEFAULT '0';
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS vat_amount numeric(18,4) DEFAULT '0';
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS paid_amount numeric(18,4) DEFAULT '0';
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS payment_type varchar(10) DEFAULT 'credit' NOT NULL;
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS cash_box_id uuid;
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS is_pos boolean DEFAULT false NOT NULL;
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS shift_id uuid;
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS last_reval_rate numeric(18,6);
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS attachments jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE sales_invoice_lines ADD COLUMN IF NOT EXISTS currency_code varchar(3) DEFAULT 'YER' NOT NULL;
ALTER TABLE sales_invoice_lines ADD COLUMN IF NOT EXISTS exchange_rate numeric(18,6) DEFAULT '1' NOT NULL;
ALTER TABLE sales_invoice_lines ADD COLUMN IF NOT EXISTS base_currency_line_total numeric(18,4) DEFAULT '0' NOT NULL;
ALTER TABLE sales_invoice_lines ADD COLUMN IF NOT EXISTS discount_percent numeric(5,2) DEFAULT '0';
ALTER TABLE sales_invoice_lines ADD COLUMN IF NOT EXISTS vat_percent numeric(5,2) DEFAULT '15';
ALTER TABLE sales_invoice_lines ADD COLUMN IF NOT EXISTS unit_id uuid;
ALTER TABLE sales_invoice_lines ADD COLUMN IF NOT EXISTS unit_factor numeric(18,6) DEFAULT 1 NOT NULL;
ALTER TABLE sales_invoice_lines ADD COLUMN IF NOT EXISTS base_quantity numeric(18,4) DEFAULT 0 NOT NULL;
ALTER TABLE sales_invoice_lines ADD COLUMN IF NOT EXISTS unit_cost numeric(18,4) DEFAULT 0 NOT NULL;
ALTER TABLE pos_payments ADD COLUMN IF NOT EXISTS cash_box_id uuid;
ALTER TABLE pos_payments ADD COLUMN IF NOT EXISTS method varchar(20) DEFAULT 'cash' NOT NULL;
ALTER TABLE pos_payments ADD COLUMN IF NOT EXISTS reference text;
ALTER TABLE pos_payments ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE pos_shifts ADD COLUMN IF NOT EXISTS cash_box_id uuid;
ALTER TABLE pos_shifts ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE pos_shifts ADD COLUMN IF NOT EXISTS opening_amount numeric(18,4) DEFAULT 0 NOT NULL;
ALTER TABLE pos_shifts ADD COLUMN IF NOT EXISTS status varchar(20) DEFAULT 'open' NOT NULL;
ALTER TABLE pos_shifts ADD COLUMN IF NOT EXISTS opened_at timestamp with time zone DEFAULT now();
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS reference text;
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS notes text;
