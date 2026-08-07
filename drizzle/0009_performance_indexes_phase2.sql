-- ============================================================================
-- Migration 0009: Missing FK + Status + Customer/Supplier Indexes
-- ============================================================================
-- This migration adds indexes that improve JOIN performance for detail
-- queries, pagination filtering by status, and customer/supplier lookups.
--
-- Performance impact:
--   - Line-item FK indexes: prevent sequential scans on detail tables
--     (sales_invoice_lines, purchase_invoice_lines, etc.)
--   - Status indexes: speed up paginated list queries that filter by status
--   - Customer/Supplier FK indexes: speed up JOINs in reports and statements
-- ============================================================================

-- ============================================================================
-- § 1. Line-item FK indexes (detail query performance)
-- Without these, every invoice/order/return detail query does a sequential scan
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_sales_invoice_lines_invoice
  ON sales_invoice_lines(invoice_id);
CREATE INDEX IF NOT EXISTS idx_purchase_invoice_lines_invoice
  ON purchase_invoice_lines(invoice_id);
CREATE INDEX IF NOT EXISTS idx_quotation_lines_quotation
  ON quotation_lines(quotation_id);
CREATE INDEX IF NOT EXISTS idx_sales_return_lines_return
  ON sales_return_lines(return_id);
CREATE INDEX IF NOT EXISTS idx_purchase_return_lines_return
  ON purchase_return_lines(return_id);
CREATE INDEX IF NOT EXISTS idx_purchase_order_lines_order
  ON purchase_order_lines(order_id);
CREATE INDEX IF NOT EXISTS idx_bom_lines_bom
  ON bom_lines(bom_id);
CREATE INDEX IF NOT EXISTS idx_work_order_consumptions_wo
  ON work_order_consumptions(work_order_id);
CREATE INDEX IF NOT EXISTS idx_payroll_lines_run
  ON payroll_lines(payroll_run_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_transfer_lines_transfer
  ON warehouse_transfer_lines(transfer_id);

-- ============================================================================
-- § 2. Journal entry FK indexes (account + transaction)
-- journal_entries is the most JOINed table in the system (reports, ledger)
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_journal_entries_account
  ON journal_entries(account_id, company_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_transaction
  ON journal_entries(transaction_id);

-- ============================================================================
-- § 3. Status filter indexes (pagination performance)
-- Every paginated page filters by status — these prevent sequential scans
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_sales_invoices_company_status
  ON sales_invoices(company_id, status);
CREATE INDEX IF NOT EXISTS idx_purchase_invoices_company_status
  ON purchase_invoices(company_id, status);
CREATE INDEX IF NOT EXISTS idx_sales_returns_company_status
  ON sales_returns(company_id, status);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_company_status
  ON purchase_returns(company_id, status);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_company_status
  ON purchase_orders(company_id, status);
CREATE INDEX IF NOT EXISTS idx_work_orders_company_status
  ON work_orders(company_id, status);
CREATE INDEX IF NOT EXISTS idx_transactions_company_status
  ON transactions(company_id, status);
CREATE INDEX IF NOT EXISTS idx_receipt_vouchers_company_status
  ON receipt_vouchers(company_id, status);
CREATE INDEX IF NOT EXISTS idx_payment_vouchers_company_status
  ON payment_vouchers(company_id, status);
CREATE INDEX IF NOT EXISTS idx_leads_company_status
  ON leads(company_id, status);
CREATE INDEX IF NOT EXISTS idx_leaves_company_status
  ON leaves(company_id, status);
CREATE INDEX IF NOT EXISTS idx_end_of_service_company_status
  ON end_of_service(company_id, status);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_company_status
  ON payroll_runs(company_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_company_status
  ON tasks(company_id, status);

-- ============================================================================
-- § 4. Customer/Supplier FK indexes (JOIN performance in reports)
-- Used in AR/AP aging, statements, filtered lists, KPIs
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_sales_invoices_company_customer
  ON sales_invoices(company_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_purchase_invoices_company_supplier
  ON purchase_invoices(company_id, supplier_id);
CREATE INDEX IF NOT EXISTS idx_quotations_company_customer
  ON quotations(company_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_company_supplier
  ON purchase_orders(company_id, supplier_id);
CREATE INDEX IF NOT EXISTS idx_sales_returns_company_customer
  ON sales_returns(company_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_company_supplier
  ON purchase_returns(company_id, supplier_id);
CREATE INDEX IF NOT EXISTS idx_receipt_vouchers_company_customer
  ON receipt_vouchers(company_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_payment_vouchers_company_supplier
  ON payment_vouchers(company_id, supplier_id);

-- ============================================================================
-- § 5. Stage/Type filter indexes (common UI filter patterns)
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_opportunities_company_stage
  ON opportunities(company_id, stage);
CREATE INDEX IF NOT EXISTS idx_products_company_active
  ON products(company_id, is_active);
CREATE INDEX IF NOT EXISTS idx_employees_company_active
  ON employees(company_id, is_active);
CREATE INDEX IF NOT EXISTS idx_employees_company_department
  ON employees(company_id, department_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_company_type
  ON stock_movements(company_id, type);

-- ============================================================================
-- § 6. Stock/product lookup indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_stock_product_warehouse
  ON stock(company_id, product_id, warehouse_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_product_warehouse
  ON stock_movements(company_id, product_id, warehouse_id);
CREATE INDEX IF NOT EXISTS idx_stock_adjustments_company_product
  ON stock_adjustments(company_id, product_id);

-- ============================================================================
-- § 7. User lookup for login performance
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_users_username_company
  ON users(username, company_id);

-- ============================================================================
-- § 8. Assigned-to indexes (CRM ownership filters)
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_leads_company_assigned
  ON leads(company_id, assigned_to);
CREATE INDEX IF NOT EXISTS idx_opportunities_company_assigned
  ON opportunities(company_id, assigned_to);
CREATE INDEX IF NOT EXISTS idx_tasks_company_assigned
  ON tasks(company_id, assigned_to);
CREATE INDEX IF NOT EXISTS idx_activities_company_assigned
  ON activities(company_id, assigned_to);

-- ============================================================================
-- § 9. CHECK constraints (data integrity)
-- ============================================================================
-- Note: PostgreSQL does not support ADD CONSTRAINT IF NOT EXISTS for CHECK
-- constraints. We use DO $$ blocks with pg_constraint lookup for idempotency.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'currencies_exchange_rate_check') THEN
    ALTER TABLE currencies ADD CONSTRAINT currencies_exchange_rate_check CHECK (exchange_rate > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payroll_lines_net_salary_check') THEN
    ALTER TABLE payroll_lines ADD CONSTRAINT payroll_lines_net_salary_check CHECK (net_salary >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_quantity_check') THEN
    ALTER TABLE stock ADD CONSTRAINT stock_quantity_check CHECK (quantity >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_invoices_total_amount_check') THEN
    ALTER TABLE sales_invoices ADD CONSTRAINT sales_invoices_total_amount_check CHECK (total_amount >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_invoices_total_amount_check') THEN
    ALTER TABLE purchase_invoices ADD CONSTRAINT purchase_invoices_total_amount_check CHECK (total_amount >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employees_base_salary_check') THEN
    ALTER TABLE employees ADD CONSTRAINT employees_base_salary_check CHECK (base_salary >= 0);
  END IF;
END $$;
