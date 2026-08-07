-- 0021_user_tracking_columns.sql
-- Adds `created_by` and `updated_by` columns to tables that were missing them,
-- so every document in the system can be attributed to the user that created
-- or last modified it.
--
-- All new columns are nullable to remain backward-compatible with any
-- pre-existing rows. They reference `users(id)` with `ON DELETE SET NULL` so
-- deleting a user does not cascade-delete their historical records.

ALTER TABLE branches ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS updated_by uuid;

ALTER TABLE currencies ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE currencies ADD COLUMN IF NOT EXISTS updated_by uuid;

ALTER TABLE product_types ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE product_types ADD COLUMN IF NOT EXISTS updated_by uuid;

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS updated_by uuid;

ALTER TABLE cash_boxes ADD COLUMN IF NOT EXISTS updated_by uuid;

CREATE INDEX IF NOT EXISTS idx_branches_company_updated ON branches (company_id, updated_by);
CREATE INDEX IF NOT EXISTS idx_currencies_company_updated ON currencies (company_id, updated_by);
CREATE INDEX IF NOT EXISTS idx_product_types_company_updated ON product_types (company_id, updated_by);
CREATE INDEX IF NOT EXISTS idx_tasks_company_updated ON tasks (company_id, updated_by);
CREATE INDEX IF NOT EXISTS idx_cash_boxes_company_updated ON cash_boxes (company_id, updated_by);

