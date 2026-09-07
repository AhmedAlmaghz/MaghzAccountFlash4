-- 0022: AI job queue (طوابير عمليات الوكيل الذكي)
--
-- Batches group many tool calls (20 / 50 / 100 / bulk) under ONE user
-- approval instead of one confirmation card per write. A renderer worker
-- claims queued items with FOR UPDATE SKIP LOCKED and executes each one
-- through the normal tool executor (RBAC + arg hygiene + audit inherited),
-- so batch execution carries exactly the same guards as single calls.
--
-- Design notes:
-- - `after_seq` links an item to an EARLIER item of the same batch
--   (supplier creation -> its invoices -> their vouchers). The engine
--   resolves semantic refs to seq numbers and rejects cycles (DAG check)
--   before anything is written — the column itself carries no FK.
-- - `idempotency_key` is UNIQUE per batch: re-uploading the same file or
--   re-sending the same enqueue never duplicates items.
-- - Counters on the batch header (done/failed/skipped) are maintained by
--   the worker; the batch status flips to done/partial when nothing
--   remains queued or running.
-- - Access goes ONLY through the ai:batch-* IPC channels (session-derived
--   identity, like the chat channels) — never through raw renderer SQL.
-- Idempotent: every statement guards with IF NOT EXISTS.

-- ─── Batch header ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_job_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id uuid REFERENCES ai_chat_sessions(id) ON DELETE SET NULL,
  kind varchar(40) NOT NULL DEFAULT 'mixed',
  title varchar(200),
  total_count integer NOT NULL DEFAULT 0 CHECK (total_count >= 0),
  done_count integer NOT NULL DEFAULT 0 CHECK (done_count >= 0),
  failed_count integer NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  skipped_count integer NOT NULL DEFAULT 0 CHECK (skipped_count >= 0),
  status varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'paused', 'done', 'partial', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

-- ─── Batch items (one tool call each) ────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_job_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL REFERENCES ai_job_batches(id) ON DELETE CASCADE,
  seq integer NOT NULL CHECK (seq >= 0),
  tool_name varchar(120) NOT NULL,
  args jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_seq integer NULL,
  idempotency_key varchar(200) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed', 'skipped')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error text,
  error_code varchar(40),
  result_ref varchar(200),
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (batch_id, seq),
  UNIQUE (batch_id, idempotency_key)
);

-- ─── Indexes ─────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_ai_job_batches_company_status ON ai_job_batches (company_id, status);
CREATE INDEX IF NOT EXISTS idx_ai_job_batches_user ON ai_job_batches (company_id, user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_ai_job_items_batch_status_seq ON ai_job_items (batch_id, status, seq);
CREATE INDEX IF NOT EXISTS idx_ai_job_items_queued ON ai_job_items (batch_id, seq) WHERE status = 'queued';
