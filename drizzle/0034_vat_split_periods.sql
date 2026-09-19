-- 0034: VAT input/output split + tax periods (Phase 3 — FIN track, tax engine)
--   1. 21302 input-VAT account (recoverable asset-side balance) + remap of
--      default_vat_input to it — ONLY where it still points at 21301, so
--      custom company mappings are never overwritten. History stays on 21301
--      (from-fix-date principle); new postings split automatically because
--      every builder resolves the two keys independently.
--   2. tax_periods: open/closed/filed windows per company. Posting flows
--      refuse dates inside closed/filed periods (engine.assertPeriodOpen).
-- Idempotent: IF NOT EXISTS + WHERE NOT EXISTS throughout.

-- ─── 1. Input-VAT account ────────────────────────────────────────────────────
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
-- NOTE: contra-liability (debit nature inside the 21 group) — input VAT
-- offsets output VAT by construction, and code matches parent.
JOIN (VALUES
  ('21302', 'ضريبة القيمة المضافة على المدخلات', 'VAT Input Recoverable', 'liability', 'debit', '213')
) AS v(code, name_ar, name_en, type, nature, parent_code) ON TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM accounts a
   WHERE a.company_id = c.id AND a.code = v.code
);

-- Remap input VAT to 21302 only where it still points at the old mixed 21301.
UPDATE default_accounts da
   SET account_id = a.id
  FROM accounts a
 WHERE a.code = '21302'
   AND a.company_id = da.company_id
   AND da.function_key = 'default_vat_input'
   AND da.account_id IN (SELECT id FROM accounts WHERE code = '21301' AND company_id = da.company_id);

-- Backfill the key wherever it is missing entirely (customized companies keep theirs).
INSERT INTO default_accounts (id, company_id, function_key, account_id, is_required, description, created_at)
SELECT
  gen_random_uuid(),
  c.id,
  'default_vat_input',
  (SELECT a.id FROM accounts a WHERE a.company_id = c.id AND a.code = '21302' LIMIT 1),
  TRUE,
  'ضريبة القيمة المضافة على المشتريات',
  NOW()
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM default_accounts da
   WHERE da.company_id = c.id AND da.function_key = 'default_vat_input'
);

-- ─── 2. Tax periods ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tax_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  country_code varchar(2) NOT NULL DEFAULT 'YE',
  period_type varchar(20) NOT NULL DEFAULT 'manual',
  start_date date NOT NULL,
  end_date date NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'open',
  filed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT tax_periods_dates CHECK (end_date >= start_date),
  CONSTRAINT tax_periods_status CHECK (status IN ('open', 'closed', 'filed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tax_periods_company_range
  ON tax_periods (company_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_tax_periods_company_status
  ON tax_periods (company_id, status);
