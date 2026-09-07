-- 0024: AI job item labels (شارة العنصر — الاتجاه البشري)
--
-- Human note per batch item (e.g. direction badge "معكوس ← مشتريات").
-- Display-only: never executed, never trusted by the worker. The model
-- composes it (usually from ai.classify_document) and the approval card
-- shows it next to each item so the user approves SUBSTANCE with direction.
-- Idempotent: guards with IF NOT EXISTS.

ALTER TABLE ai_job_items ADD COLUMN IF NOT EXISTS label varchar(200);
