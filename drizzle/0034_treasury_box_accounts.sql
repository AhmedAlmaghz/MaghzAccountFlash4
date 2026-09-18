-- 0034: Phase 6 — treasury box GL accounts left behind by the bank
-- unification (Phase 62): seed boxes BNK-001/WLT-JEB point at 11102/11103,
-- which never existed as accounts, so those boxes carry account_id = NULL
-- and any cash-difference JE on their shifts fails honestly at close.
-- Creates the two leaf accounts per company and links null-account boxes
-- by their seed codes (restores seed intent; user-linked boxes untouched).
-- Idempotent: WHERE NOT EXISTS throughout.

INSERT INTO accounts (id, company_id, code, name_ar, name_en, type, nature, is_group, parent_id, balance, is_active, created_at)
SELECT
  gen_random_uuid(),
  c.id,
  v.code,
  v.name_ar,
  v.name_en,
  'asset',
  'debit',
  FALSE,
  (SELECT a.id FROM accounts a WHERE a.company_id = c.id AND a.code = '111' LIMIT 1),
  0,
  TRUE,
  NOW()
FROM companies c
JOIN (VALUES
  ('11102', 'البنك اليمني الدولي', 'Yemen International Bank'),
  ('11103', 'محفظة جيب', 'Jeeb Wallet')
) AS v(code, name_ar, name_en) ON TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM accounts a
   WHERE a.company_id = c.id AND a.code = v.code
);

UPDATE cash_boxes cb
   SET account_id = a.id
  FROM accounts a
 WHERE a.company_id = cb.company_id
   AND cb.account_id IS NULL
   AND ((cb.code = 'BNK-001' AND a.code = '11102')
     OR (cb.code = 'WLT-JEB' AND a.code = '11103'));
