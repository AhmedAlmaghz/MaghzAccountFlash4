-- ============================================================================
-- Migration 0013: HR schema drift fix
-- ============================================================================
-- Syncs HR tables (employees) with the Drizzle schema. All changes are
-- idempotent (use IF NOT EXISTS) so this is safe to re-apply.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employees' AND column_name = 'photo_url'
  ) THEN
    ALTER TABLE employees ADD COLUMN photo_url text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employees' AND column_name = 'attachments'
  ) THEN
    ALTER TABLE employees ADD COLUMN attachments jsonb;
  END IF;
END $$;

-- Index for fast lookups of employees per department
CREATE INDEX IF NOT EXISTS idx_employees_department
  ON employees (company_id, department_id);
