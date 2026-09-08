-- 0025: AI job item refs + outputs (مراجع العناصر ومخرجاتها)
--
-- Cross-item references: the model links items by semantic `ref`
-- ("sup_abo_elaz") and addresses their outputs as {{ref.id}} / @ref.
-- The worker substitutes these from persisted outputs before executing —
-- without this, dependent items receive literal "{{...}}" strings and die
-- on UUID/FK validation (the 2026-09-08 "database problem").
-- - `ref`: stable name of this item for later items (display-free, routing).
-- - `result_data`: whitelisted scalar outputs of a completed item
--   (id/numbers/codes, capped ~2KB) — the substitution source. Survives
--   restarts so resumed runs resolve refs too.
-- Idempotent: guards with IF NOT EXISTS.

ALTER TABLE ai_job_items ADD COLUMN IF NOT EXISTS ref varchar(100);
ALTER TABLE ai_job_items ADD COLUMN IF NOT EXISTS result_data jsonb;
