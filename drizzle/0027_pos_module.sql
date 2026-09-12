-- 0027: POS module (وحدة نقاط البيع)
--
-- 1. `pos_shifts`: one cashier shift per (company, user). A user may hold at
--    most ONE open shift at a time — enforced by a partial unique index on
--    (company_id, user_id) WHERE status = 'open'. Opening float, counted
--    close, expected amount and the resulting cash difference are stored on
--    the row; the Z-report is derived from pos_payments + sales_invoices.
-- 2. `pos_payments`: one row per payment applied to a POS invoice. Cash
--    payments are attributed to the shift so closeShift can compute
--    expected cash = opening_amount + SUM(cash payments) without scanning
--    invoices. Credit rows carry the outstanding part moved to Debtors.
-- 3. sales_invoices: `is_pos` flag (separates POS receipts from regular
--    invoices in every list/report) and `shift_id` link (SET NULL — a
--    deleted shift must never cascade-delete sales history).
-- Idempotent: every statement guards with IF NOT EXISTS / IF NOT EXISTS.

-- ─── 1) pos_shifts table ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pos_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  cash_box_id uuid NOT NULL REFERENCES cash_boxes(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  opening_amount numeric(18, 4) NOT NULL DEFAULT 0 CHECK (opening_amount >= 0),
  closing_amount numeric(18, 4),
  expected_amount numeric(18, 4),
  difference numeric(18, 4),
  status varchar(20) NOT NULL DEFAULT 'open',
  opened_at timestamptz NOT NULL DEFAULT NOW(),
  closed_at timestamptz,
  notes text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz DEFAULT NOW(),
  CONSTRAINT pos_shifts_status_check CHECK (status IN ('open', 'closed'))
);

-- One open shift per cashier per company.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_shifts_open_per_user
  ON pos_shifts (company_id, user_id) WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_pos_shifts_company_status ON pos_shifts (company_id, status);
CREATE INDEX IF NOT EXISTS idx_pos_shifts_box ON pos_shifts (cash_box_id);
--> statement-breakpoint

-- ─── 2) pos_payments table ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pos_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  shift_id uuid REFERENCES pos_shifts(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES sales_invoices(id) ON DELETE CASCADE,
  method varchar(20) NOT NULL DEFAULT 'cash',
  amount numeric(18, 4) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  cash_box_id uuid REFERENCES cash_boxes(id) ON DELETE RESTRICT,
  reference text,
  notes text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz DEFAULT NOW(),
  CONSTRAINT pos_payments_method_check CHECK (method IN ('cash', 'credit'))
);

CREATE INDEX IF NOT EXISTS idx_pos_payments_company_shift ON pos_payments (company_id, shift_id);
CREATE INDEX IF NOT EXISTS idx_pos_payments_invoice ON pos_payments (invoice_id);
--> statement-breakpoint

-- ─── 3) sales_invoices POS columns ─────────────────────────────────────
-- is_pos separates POS receipts from regular invoices in every list and
-- report without a separate table. shift_id SET NULL keeps sales history
-- intact if a shift row is ever removed.
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS is_pos boolean NOT NULL DEFAULT false;
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS shift_id uuid REFERENCES pos_shifts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sales_invoices_pos ON sales_invoices (company_id) WHERE is_pos;
