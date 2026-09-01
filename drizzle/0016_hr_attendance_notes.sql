-- 0016: HR attendance & payroll-notes fixes
--
-- 1. attendance.check_in becomes NULLABLE — an absent/on_leave day has no
--    check-in punch; NOT NULL made the batch form send fake "08:00" values
--    (and crashed on genuinely empty punches).
-- 2. payroll_runs.notes — the PayrollRun type carried a `notes?` field that
--    never existed in the schema; wired end-to-end now (API + RPC + shim).
-- Idempotent: both steps guard with existence/nullability checks.

-- 1) check_in NOT NULL → NULLABLE (idempotent via is_nullable check)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'attendance' AND column_name = 'check_in' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE attendance ALTER COLUMN check_in DROP NOT NULL;
  END IF;
END $$;

-- 2) payroll_runs.notes
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS notes text;
