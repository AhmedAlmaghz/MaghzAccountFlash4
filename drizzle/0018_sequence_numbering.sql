-- Migration 0018: Add numbering columns for document sequence coverage
-- Adds missing auto-numbering columns to tables that participate in document_sequences
-- Fixes: payroll_run → run_number, stock_adjustment → adjustment_number, inventory_transfer → transfer_number

-- 1. payroll_runs.run_number — was missing despite being mapped in core/api.ts
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS run_number varchar(50);

-- 2. stock_adjustments.adjustment_number — needed for stock_adjustment sequence
ALTER TABLE stock_adjustments ADD COLUMN IF NOT EXISTS adjustment_number varchar(50);

-- 3. warehouse_transfers.transfer_number — needed for inventory_transfer sequence
ALTER TABLE warehouse_transfers ADD COLUMN IF NOT EXISTS transfer_number varchar(50);

-- Indexes for fast uniqueness collision checks in getNextDocumentNumber
CREATE INDEX IF NOT EXISTS idx_payroll_runs_company_run_number
  ON payroll_runs(company_id, run_number)
  WHERE run_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_stock_adjustments_company_adjustment_number
  ON stock_adjustments(company_id, adjustment_number)
  WHERE adjustment_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_warehouse_transfers_company_transfer_number
  ON warehouse_transfers(company_id, transfer_number)
  WHERE transfer_number IS NOT NULL;
