-- 0012: Default-accounts expansion for manufacturing & inventory
-- Adds chart accounts referenced by default_accounts seeds:
--   11303 Finished Goods Inventory (IAS 2 separates FG from raw materials)
--   52301 Miscellaneous Expenses  (missing from 0000 seed; used by pglite + payment vouchers)
--   52401 Shipping & Freight      (postPaymentVoucher expense routing)
-- Idempotent: uses ON CONFLICT via the (company_id, code) unique key guarded by WHERE NOT EXISTS.

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
  ('11303', 'بضاعة تامة الصنع', 'Finished Goods Inventory', 'asset',  'debit',  '113'),
  ('52301', 'مصروفات متنوعة ونثريات', 'Miscellaneous Expenses', 'expense', 'debit', '52'),
  ('52401', 'مصروفات نقل وشحن', 'Shipping & Freight', 'expense', 'debit', '52')
) AS v(code, name_ar, name_en, type, nature, parent_code) ON TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM accounts a
   WHERE a.company_id = c.id AND a.code = v.code
);

-- Seed the new default_accounts rows (function keys) for every company.
-- account_id links to the codes inserted above when present, otherwise NULL
-- (the Settings screen lets the user link them manually).
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
  ('default_finished_goods',      '11303', 'حساب مخزون البضاعة التامة'),
  ('default_opening_balance',     '31201', 'حساب الأرصدة الافتتاحية'),
  ('default_shipping',            '52401', 'حساب مصروفات النقل والشحن'),
  ('default_rent',                '52201', 'حساب مصروفات الإيجار'),
  ('default_misc_expense',        '52301', 'حساب المصروفات المتنوعة'),
  ('default_production_labor',    '53101', 'حساب عمالة الإنتاج'),
  ('default_production_energy',   '53201', 'حساب طاقة الإنتاج'),
  ('default_production_packaging','53301', 'حساب تغليف الإنتاج'),
  ('default_production_other',    '53401', 'حساب أخرى الإنتاج'),
  ('default_production_loss',     '53501', 'حساب خسائر الإنتاج'),
  ('default_wip',                 '11302', 'حساب بضاعة تحت التشغيل')
) AS v(function_key, account_code, description) ON TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM default_accounts da
   WHERE da.company_id = c.id AND da.function_key = v.function_key
);
