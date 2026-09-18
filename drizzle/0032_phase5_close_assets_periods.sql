-- 0032: Phase 5 — year-end close + fixed assets + accounting periods
--   1. accounting_periods: fiscal lock per year (open/closed), like tax_periods.
--   2. fixed_assets: register for straight-line + declining-balance depreciation.
--   3. Chart groups + leaves: 12/121/12101 (cost), 12102 (accumulated, contra),
--      32/321/32101 (retained earnings), 52601 (depreciation expense).
--   4. default_accounts keys for the four leaves.
-- Idempotent: IF NOT EXISTS / WHERE NOT EXISTS throughout.

CREATE TABLE IF NOT EXISTS accounting_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  year integer NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'open',
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT accounting_periods_dates CHECK (end_date >= start_date),
  CONSTRAINT accounting_periods_status CHECK (status IN ('open', 'closed')),
  CONSTRAINT uq_accounting_periods_year UNIQUE (company_id, year)
);
CREATE INDEX IF NOT EXISTS idx_accounting_periods_company ON accounting_periods (company_id);
CREATE INDEX IF NOT EXISTS idx_accounting_periods_status ON accounting_periods (company_id, status);

CREATE TABLE IF NOT EXISTS fixed_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code varchar(50) NOT NULL,
  name_ar varchar(200) NOT NULL,
  name_en varchar(200),
  category varchar(100),
  purchase_date date NOT NULL,
  cost numeric(18, 4) NOT NULL DEFAULT 0,
  salvage_value numeric(18, 4) NOT NULL DEFAULT 0,
  useful_life_months integer NOT NULL DEFAULT 60,
  method varchar(20) NOT NULL DEFAULT 'straight_line',
  accumulated_depreciation numeric(18, 4) NOT NULL DEFAULT 0,
  status varchar(20) NOT NULL DEFAULT 'active',
  disposed_at date,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT fixed_assets_method CHECK (method IN ('straight_line', 'declining_balance')),
  CONSTRAINT fixed_assets_status CHECK (status IN ('active', 'disposed')),
  CONSTRAINT uq_fixed_assets_code UNIQUE (company_id, code)
);
CREATE INDEX IF NOT EXISTS idx_fixed_assets_company ON fixed_assets (company_id);
CREATE INDEX IF NOT EXISTS idx_fixed_assets_status ON fixed_assets (company_id, status);

-- Groups first (parents must exist before leaves reference them).
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
  ('12',  'الأصول الثابتة',               'Fixed Assets',                  'asset',  'debit',  '1'),
  ('121', 'الأصول الثابتة - التكلفة',      'Fixed Assets at Cost',          'asset',  'debit',  '12'),
  ('32',  'الأرباح المبقاة والاحتياطيات', 'Retained Earnings & Reserves',  'equity', 'credit', '3'),
  ('321', 'الأرباح المبقاة',               'Retained Earnings',             'equity', 'credit', '32')
) AS v(code, name_ar, name_en, type, nature, parent_code) ON TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM accounts a
   WHERE a.company_id = c.id AND a.code = v.code
);

-- Leaves (contra asset 12102 carries a credit nature under its asset group).
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
  ('12101', 'تكلفة الأصول الثابتة',       'Fixed Assets at Cost',        'asset',   'debit',  '121'),
  ('12102', 'مجمع إهلاك الأصول الثابتة',  'Accumulated Depreciation',    'asset',   'credit', '121'),
  ('32101', 'الأرباح المبقاة',            'Retained Earnings',           'equity',  'credit', '321'),
  ('52601', 'مصروف إهلاك الأصول الثابتة', 'Depreciation Expense',        'expense', 'debit',  '52')
) AS v(code, name_ar, name_en, type, nature, parent_code) ON TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM accounts a
   WHERE a.company_id = c.id AND a.code = v.code
);

-- Default-account keys for the four leaves.
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
  ('default_fixed_assets',            '12101', 'حساب تكلفة الأصول الثابتة'),
  ('default_accumulated_depreciation','12102', 'حساب مجمع الإهلاك'),
  ('default_depreciation_expense',    '52601', 'حساب مصروف الإهلاك'),
  ('default_retained_earnings',       '32101', 'حساب الأرباح المبقاة')
) AS v(function_key, account_code, description) ON TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM default_accounts da
   WHERE da.company_id = c.id AND da.function_key = v.function_key
);
