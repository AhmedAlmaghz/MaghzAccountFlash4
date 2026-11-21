-- ===== 0006_audit_session_id =====
-- Phase 5 (multi-user): `audit_logs.session_id` — the sessions.token that
-- produced the audit entry (see plan 00-plan-multi-user.md Phase 5).
-- FK to sessions(token), ON DELETE SET NULL — deleting a session keeps the
-- audit trail readable (same as user_id).

ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS session_id uuid;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'audit_logs'::regclass AND conname = 'audit_logs_session_id_fk') THEN
    ALTER TABLE audit_logs
      ADD CONSTRAINT audit_logs_session_id_fk
      FOREIGN KEY (session_id) REFERENCES sessions(token) ON DELETE SET NULL;
  END IF;
END
$$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_audit_logs_session_id ON audit_logs(session_id) WHERE session_id IS NOT NULL;
