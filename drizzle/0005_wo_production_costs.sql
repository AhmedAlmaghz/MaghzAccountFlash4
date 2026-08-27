-- 0005: Work-order production costs (labor, energy, packaging, other).
--  1) work_orders.production_costs: JSONB array of {category, description, amount}.
--     Capitalized into the finished product cost on completion and posted to
--     the GL together with the material cost in ONE atomic transaction.
--  2) Production-cost GL accounts (53*) for every existing company so the
--     completion journal entry has somewhere to post. Idempotent.

ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "production_costs" jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Group 53 "تكاليف الإنتاج" under group 5 (expenses).
INSERT INTO accounts (company_id, code, name_ar, name_en, parent_id, type, nature, is_group, balance, is_active)
SELECT c.id, '53', 'تكاليف الإنتاج', 'Production Costs', p.id, 'expense', 'debit', TRUE, 0, TRUE
FROM companies c
LEFT JOIN accounts p ON p.company_id = c.id AND p.code = '5'
WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.company_id = c.id AND a.code = '53');

-- Leaf accounts per cost category.
INSERT INTO accounts (company_id, code, name_ar, name_en, parent_id, type, nature, is_group, balance, is_active)
SELECT c.id, v.code, v.name_ar, v.name_en, p.id, 'expense', 'debit', FALSE, 0, TRUE
FROM companies c
CROSS JOIN (VALUES
  ('53101', 'تكاليف إنتاج - أجور', 'Production Costs - Labor'),
  ('53201', 'تكاليف إنتاج - طاقة', 'Production Costs - Energy'),
  ('53301', 'تكاليف إنتاج - تغليف', 'Production Costs - Packaging'),
  ('53401', 'تكاليف إنتاج - أخرى', 'Production Costs - Other')
) v(code, name_ar, name_en)
LEFT JOIN accounts p ON p.company_id = c.id AND p.code = '53'
WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.company_id = c.id AND a.code = v.code);
