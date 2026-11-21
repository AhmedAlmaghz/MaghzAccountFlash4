-- ===== 0003_sessions =====
-- Multi-user sessions table: authoritative store for user sessions.
-- (Phase 1 — plan 00-plan-multi-user.md, Section 1, migration table)
CREATE TABLE IF NOT EXISTS sessions (
  token uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  fingerprint text,
  ip_address text,
  user_agent text,
  expires_at timestamptz NOT NULL DEFAULT NOW() + INTERVAL '30 minutes',
  absolute_expires_at timestamptz NOT NULL DEFAULT NOW() + INTERVAL '8 hours',
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  last_activity_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_sessions_active ON sessions(company_id, user_id, revoked_at) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
