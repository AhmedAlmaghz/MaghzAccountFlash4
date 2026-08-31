-- 0014: HR professional module — payroll/EOS/leave/attendance foundations
--
-- Single source of truth for ALL financial calculations moves to the API layer.
-- This migration adds:
--   1. Chart accounts for payroll & end-of-service posting (gross-up pattern):
--        215    Employee Benefits (liability group)
--        21501  Salaries Payable            (credit = net payroll)
--        21502  Payroll Deductions Payable  (credit = deductions)
--        21503  End-of-Service Gratuity Payable
--        52501  End-of-Service Expense
--   2. default_accounts keys: default_salaries_payable / default_payroll_deductions
--      / default_eos_payable / default_eos_expense (+ existing default_salaries 52101).
--   3. end_of_service payment columns (cash_box_id, paid_at) and
--      payroll_lines.overtime_hours for attendance→payroll traceability.
--   4. Unique constraints:
--        uq_attendance(company_id, employee_id, date)  — one row per employee/day
--        uq_payroll_runs_period(company_id, month, year) WHERE draft|posted
--   5. HR policy settings seeds (leave balances, work hours, late grace,
--      overtime rate, EOS multipliers) per company.
-- Idempotent: every step guards with IF NOT EXISTS / WHERE NOT EXISTS / DO block,
-- and the attendance dedupe step keeps only the newest row per (employee, date).

-- ─── 1. Chart accounts (215 group + 52501) ─────────────────────────────────
INSERT INTO accounts (id, company_id, code, name_ar, name_en, type, nature, is_group, parent_id, balance, is_active, created_at)
SELECT
  gen_random_uuid(),
  c.id,
  v.code,
  v.name_ar,
  v.name_en,
  v.type,
  v.nature,
  FALSE,
  (SELECT a.id FROM accounts a WHERE a.company_id = c.id AND a.code = v.parent_code LIMIT 1),
  0,
  TRUE,
  NOW()
FROM companies c
JOIN (VALUES
  ('21501', 'رواتب مستحقة الدفع', 'Salaries Payable', 'liability', 'credit', '215'),
  ('21502', 'استقطاعات مستحقة', 'Payroll Deductions Payable', 'liability', 'credit', '215'),
  ('21503', 'مستحقات نهاية الخدمة', 'End-of-Service Gratuity Payable', 'liability', 'credit', '215'),
  ('52501', 'مصروف نهاية الخدمة', 'End-of-Service Expense', 'expense', 'debit', '52')
) AS v(code, name_ar, name_en, type, nature, parent_code) ON TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM accounts a
   WHERE a.company_id = c.id AND a.code = v.code
);

-- The 215 group header itself (needed once children exist)
INSERT INTO accounts (id, company_id, code, name_ar, name_en, type, nature, is_group, parent_id, balance, is_active, created_at)
SELECT
  gen_random_uuid(),
  c.id,
  '215',
  'مستحقات الموظفين',
  'Employee Benefits',
  'liability',
  'credit',
  TRUE,
  (SELECT a.id FROM accounts a WHERE a.company_id = c.id AND a.code = '21' LIMIT 1),
  0,
  TRUE,
  NOW()
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM accounts a
   WHERE a.company_id = c.id AND a.code = '215'
);

-- ─── 2. default_accounts keys ───────────────────────────────────────────────
INSERT INTO default_accounts (id, company_id, function_key, account_id, is_required, description, created_at)
SELECT
  gen_random_uuid(),
  c.id,
  v.function_key,
  (SELECT a.id FROM accounts a WHERE a.company_id = c.id AND a.code = v.account_code LIMIT 1),
  FALSE,
  v.description,
  NOW()
FROM companies c
JOIN (VALUES
  ('default_salaries_payable',    '21501', 'حساب الرواتب المستحقة الدفع (قيد ترحيل المسير)'),
  ('default_payroll_deductions',  '21502', 'حساب الاستقطاعات المستحقة (قيد ترحيل المسير)'),
  ('default_eos_payable',         '21503', 'حساب مستحقات نهاية الخدمة (قيد الاستحقاق)'),
  ('default_eos_expense',         '52501', 'حساب مصروف نهاية الخدمة (قيد الاستحقاق)')
) AS v(function_key, account_code, description) ON TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM default_accounts da
   WHERE da.company_id = c.id AND da.function_key = v.function_key
);

-- ─── 3. New columns ─────────────────────────────────────────────────────────
ALTER TABLE end_of_service ADD COLUMN IF NOT EXISTS cash_box_id uuid;
ALTER TABLE end_of_service ADD COLUMN IF NOT EXISTS paid_at timestamptz;
ALTER TABLE payroll_lines ADD COLUMN IF NOT EXISTS overtime_hours numeric(5,2) DEFAULT 0;

-- ─── 4. Unique constraints ──────────────────────────────────────────────────
-- 4a. Dedupe attendance before adding the unique index (keep newest row per
--     employee/day — previously the app-level upsert could leave duplicates).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'attendance') THEN
    DELETE FROM attendance a
      USING attendance b
      WHERE a.employee_id = b.employee_id
        AND a.company_id = b.company_id
        AND a.date = b.date
        AND a.created_at < b.created_at;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_attendance_emp_date'
  ) THEN
    ALTER TABLE attendance ADD CONSTRAINT uq_attendance_emp_date
      UNIQUE (company_id, employee_id, date);
  END IF;
END $$;

-- 4b. One active payroll run per period (draft + posted both block duplicates;
--      cancelled runs free the period for a fresh run). Implemented as a
--      PARTIAL UNIQUE INDEX (constraint form cannot carry a WHERE clause).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'uq_payroll_runs_period'
  ) THEN
    -- Guard against pre-existing duplicates: keep newest, cancel the rest.
    UPDATE payroll_runs pr
       SET status = 'cancelled'
      FROM (
        SELECT id, ROW_NUMBER() OVER (
          PARTITION BY company_id, month, year
          ORDER BY created_at DESC, id
        ) AS rn
        FROM payroll_runs
        WHERE status IN ('draft', 'posted')
      ) d
      WHERE d.id = pr.id AND d.rn > 1;

    CREATE UNIQUE INDEX uq_payroll_runs_period
      ON payroll_runs (company_id, month, year)
      WHERE status IN ('draft', 'posted');
  END IF;
END $$;

-- ─── 5. HR policy settings seeds ────────────────────────────────────────────
INSERT INTO settings (id, company_id, key, value, updated_at)
SELECT
  gen_random_uuid(),
  c.id,
  v.key,
  v.value,
  NOW()
FROM companies c
JOIN (VALUES
  ('hr.leave.annualDays',            '21'),
  ('hr.leave.sickDays',              '30'),
  ('hr.leave.emergencyDays',         '30'),
  ('hr.overtimeRate',                '1.5'),
  ('hr.standardWorkHours',           '8'),
  ('hr.lateGraceMinutes',            '15'),
  ('hr.eos.firstYearsMultiplier',    '0.5'),
  ('hr.eos.beyondYearsMultiplier',   '1'),
  ('hr.payroll.grossUpPosting',      'true')
) AS v(key, value) ON TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM settings s
   WHERE s.company_id = c.id AND s.key = v.key
);
