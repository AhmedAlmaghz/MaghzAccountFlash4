-- 0033: Phase 5 (IAS 19) — unused-leave provision subledger account.
-- 21504 Leave Provision (liability, credit nature) under 215 + its
-- default_accounts key. The year-end provision run true-ups against THIS
-- account's signed balance, so payroll clearing (21501) never mixes in.
-- Idempotent: WHERE NOT EXISTS throughout.

INSERT INTO accounts (id, company_id, code, name_ar, name_en, type, nature, is_group, parent_id, balance, is_active, created_at)
SELECT
  gen_random_uuid(),
  c.id,
  '21504',
  'مخصص الإجازات',
  'Leave Provision',
  'liability',
  'credit',
  FALSE,
  (SELECT a.id FROM accounts a WHERE a.company_id = c.id AND a.code = '215' LIMIT 1),
  0,
  TRUE,
  NOW()
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM accounts a
   WHERE a.company_id = c.id AND a.code = '21504'
);

INSERT INTO default_accounts (id, company_id, function_key, account_id, is_required, description, created_at)
SELECT
  gen_random_uuid(),
  c.id,
  'default_leave_provision',
  (SELECT a.id FROM accounts a WHERE a.company_id = c.id AND a.code = '21504' LIMIT 1),
  FALSE,
  'حساب مخصص الإجازات غير المستخدمة',
  NOW()
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM default_accounts da
   WHERE da.company_id = c.id AND da.function_key = 'default_leave_provision'
);
