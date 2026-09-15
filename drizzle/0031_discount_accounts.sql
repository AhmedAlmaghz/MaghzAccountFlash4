-- 0031: Dedicated discount accounts (explicit discount legs, gross method)
-- IFRS / Odoo / QuickBooks best practice: discounts post through dedicated
-- accounts instead of being netted invisibly into sales/purchases:
--   412     Sales Discounts (contra-revenue group under 41)
--   41201   Sales Discounts Allowed (debit nature — deducted from gross sales)
--   42      Other Income (group under 4)
--   421     Discounts Earned (group under 42)
--   42101   Purchase Discounts Earned (credit nature — other income)
-- Also rewires default_discount_allowed / default_discount_received from their
-- legacy aliases (41101 product sales / 21101 trade creditors) to the new
-- dedicated accounts. Idempotent: every statement guarded by WHERE NOT EXISTS.
-- NOTE: legacy DBs are reset periodically in this pre-production stage, so no
-- backfill/re-posting of old journal entries is performed — new postings only.

-- 1. Group accounts (parents resolve to NULL on minimal charts — same as 0012).
INSERT INTO accounts (id, company_id, code, name_ar, name_en, type, nature, is_group, parent_id, balance, is_active, created_at)
SELECT
  gen_random_uuid(),
  c.id,
  v.code,
  v.name_ar,
  v.name_en,
  v.type,
  v.nature,
  TRUE,
  (SELECT a.id FROM accounts a WHERE a.company_id = c.id AND a.code = v.parent_code LIMIT 1),
  0,
  TRUE,
  NOW()
FROM companies c
JOIN (VALUES
  ('412', 'خصومات المبيعات', 'Sales Discounts', 'revenue', 'debit',  '41'),
  ('42',  'إيرادات أخرى',    'Other Income',    'revenue', 'credit', '4'),
  ('421', 'خصومات مكتسبة',   'Discounts Earned','revenue', 'credit', '42')
) AS v(code, name_ar, name_en, type, nature, parent_code) ON TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM accounts a
   WHERE a.company_id = c.id AND a.code = v.code
);

-- 2. Leaf accounts.
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
  ('41201', 'خصم مسموح به', 'Sales Discounts Allowed',    'revenue', 'debit',  '412'),
  ('42101', 'خصم مكتسب',    'Purchase Discounts Earned',  'revenue', 'credit', '421')
) AS v(code, name_ar, name_en, type, nature, parent_code) ON TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM accounts a
   WHERE a.company_id = c.id AND a.code = v.code
);

-- 3. Seed the two default_accounts rows for companies that lack them.
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
  ('default_discount_allowed',  '41201', 'حساب الخصم المسموح به (contra-revenue)'),
  ('default_discount_received', '42101', 'حساب الخصم المكتسب (other income)')
) AS v(function_key, account_code, description) ON TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM default_accounts da
   WHERE da.company_id = c.id AND da.function_key = v.function_key
);

-- 4. Rewire legacy aliases (41101 / 21101) to the dedicated accounts.
UPDATE default_accounts da
   SET account_id = a.id
  FROM accounts a
 WHERE a.company_id = da.company_id
   AND da.function_key = 'default_discount_allowed'
   AND a.code = '41201';

UPDATE default_accounts da
   SET account_id = a.id
  FROM accounts a
 WHERE a.company_id = da.company_id
   AND da.function_key = 'default_discount_received'
   AND a.code = '42101';
