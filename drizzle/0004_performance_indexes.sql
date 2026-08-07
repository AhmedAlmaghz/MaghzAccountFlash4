-- Migration 0004: Performance indexes for dashboard queries
-- Date range queries for sales/purchase invoices + journal entries

CREATE INDEX IF NOT EXISTS idx_sales_invoices_company_date
  ON "sales_invoices" ("company_id", "date");

CREATE INDEX IF NOT EXISTS idx_purchase_invoices_company_date
  ON "purchase_invoices" ("company_id", "date");

CREATE INDEX IF NOT EXISTS idx_journal_entries_company_created_at
  ON "journal_entries" ("company_id", "created_at");

CREATE INDEX IF NOT EXISTS idx_accounts_company_code
  ON "accounts" ("company_id", "code");
