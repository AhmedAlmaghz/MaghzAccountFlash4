-- 0028: AI job-item claim leases (worker liveness for batchRecover)
--
-- Problem: `ai:batch-recover` unconditionally failed EVERY 'running' item at
-- worker start. A second renderer window (same user — the claim gate allows
-- any session of the same user) running runBatch passed its own empty
-- `activeBatches` check, called recover, and failed the items window A was
-- CURRENTLY executing. Window A's committed writes were then recorded
-- `failed`/`INTERRUPTED`, and the loop spun on empty claims forever.
--
-- Fix: claim leases. The claim CTE stamps each claimed row with
-- `claimed_by` (renderer worker id) + `claim_expires_at` (claim time +
-- 10 minutes). Recover only fails rows whose lease EXPIRED (genuinely dead
-- workers) — never a live worker's in-flight items. The runner refreshes
-- its own leases every claim round, so a healthy worker never expires.
-- Pre-migration rows (NULL lease) are treated as expired — fail-safe.
--
-- Idempotent: every statement guards with IF NOT EXISTS / DO-block.

ALTER TABLE ai_job_items ADD COLUMN IF NOT EXISTS claimed_by varchar(64);
ALTER TABLE ai_job_items ADD COLUMN IF NOT EXISTS claim_expires_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_ai_job_items_lease
  ON ai_job_items (batch_id, status, claim_expires_at)
  WHERE status = 'running';
