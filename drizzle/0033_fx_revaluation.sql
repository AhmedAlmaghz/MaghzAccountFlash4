-- 00330: Foreign-exchange differences (Phase 2 — FIN track, IAS 21)
--   1. 52902 exchange gain/loss account (P&L, netted: losses Dr, gains Cr)
--      + default_exchange_difference key, seeded per company (0012 pattern).
--      Lives under 52 with its 52901 shortage sibling; code matches parent
--      (code-prefix rollups stay coherent) and type matches (expense).
--   2. last_reval_rate on sales/purchase invoices: the rate at which the
--      outstanding was LAST revalued. Revaluation books only the INCREMENTAL
--      move vs this rate (then stamps it), so repeated runs never double-book.
--      NULL = never revalued → the run measures vs the invoice's own rate.
-- Idempotent: IF NOT EXISTS + WHERE NOT EXISTS throughout.

-- ─── 1. Exchange differences account ─────────────────────────────────────────
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
  ('52902', 'فروق أسعار الصرف', 'Exchange Gain/Loss', 'expense', 'debit', '52')
) AS v(code, name_ar, name_en, type, nature, parent_code) ON TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM accounts a
   WHERE a.company_id = c.id AND a.code = v.code
);

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
  ('default_exchange_difference', '52902', 'حساب فروق أسعار الصرف (محققة وغير محققة)')
) AS v(function_key, account_code, description) ON TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM default_accounts da
   WHERE da.company_id = c.id AND da.function_key = v.function_key
);

-- ─── 2. Last-revaluation rate (incremental revaluation anchor) ───────────────
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS last_reval_rate numeric(18, 6);
ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS last_reval_rate numeric(18, 6);
