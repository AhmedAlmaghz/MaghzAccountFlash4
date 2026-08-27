-- 0007: Work-in-Progress (WIP) accounting for work orders.
--
-- Best-practice manufacturing cost flow (IAS 2 / perpetual inventory):
--   START    : DR WIP (11302) / CR inventory — raw materials issued
--   COMPLETE : DR finished-goods inventory / CR WIP (+/- inventory deltas
--              for extra consumption or surplus returns) / CR 53xxx
--              production-cost accounts
--   CANCEL   : DR inventory (materials returned) or DR 53501 production
--              losses (materials consumed) / CR WIP
--
-- work_orders.wip_materials_cost stores the amount debited to WIP at START.
-- 0 = legacy order (started before this migration) or not yet started; the
-- completion posting falls back to the pre-WIP behavior for those.

ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "wip_materials_cost" numeric(18,4) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_work_orders_wip
  ON work_orders (company_id, status)
  WHERE wip_materials_cost > 0;

-- WIP account 11302 under group 113 (inventory), for every company. Idempotent.
INSERT INTO accounts (company_id, code, name_ar, name_en, parent_id, type, nature, is_group, balance, is_active)
SELECT c.id, '11302', 'بضاعة تحت التشغيل', 'Work in Progress', p.id, 'asset', 'debit', FALSE, 0, TRUE
FROM companies c
LEFT JOIN accounts p ON p.company_id = c.id AND p.code = '113'
WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.company_id = c.id AND a.code = '11302');

-- Production-loss account 53501 under group 53, for every company. Idempotent.
-- Used when a work order is cancelled WITHOUT returning issued materials.
INSERT INTO accounts (company_id, code, name_ar, name_en, parent_id, type, nature, is_group, balance, is_active)
SELECT c.id, '53501', 'خسائر أوامر التشغيل', 'Production Losses', p.id, 'expense', 'debit', FALSE, 0, TRUE
FROM companies c
LEFT JOIN accounts p ON p.company_id = c.id AND p.code = '53'
WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.company_id = c.id AND a.code = '53501');
