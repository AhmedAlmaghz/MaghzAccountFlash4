ALTER TABLE leads ADD COLUMN IF NOT EXISTS rating varchar(20) DEFAULT 'warm' NOT NULL;

ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS notes text;

ALTER TABLE attendance ADD COLUMN IF NOT EXISTS status varchar(20) DEFAULT 'present' NOT NULL;

ALTER TABLE leaves ADD COLUMN IF NOT EXISTS reason text;
ALTER TABLE leaves ADD COLUMN IF NOT EXISTS approved_by uuid;
ALTER TABLE leaves ADD COLUMN IF NOT EXISTS approved_at timestamp with time zone;

ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS purchase_order_id uuid;

ALTER TABLE purchase_order_lines ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE purchase_order_lines ADD COLUMN IF NOT EXISTS received_quantity numeric(18, 4) NOT NULL DEFAULT '0';

ALTER TABLE purchase_return_lines ADD COLUMN IF NOT EXISTS description text;

CREATE INDEX IF NOT EXISTS idx_leads_rating ON leads (company_id, rating);
CREATE INDEX IF NOT EXISTS idx_attendance_status ON attendance (company_id, status);
CREATE INDEX IF NOT EXISTS idx_purchase_invoices_purchase_order_id ON purchase_invoices (purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_purchase_order_lines_received ON purchase_order_lines (order_id, received_quantity);
