-- 0029 — User management hardening: unique constraints, FKs, indexes, NOT NULL
-- Fixes P0: duplicate usernames/roles, orphan companies, missing FKs and indexes.

-- ── Clean orphan rows (nullable company_id) ────────────────────────────────
DELETE FROM users WHERE company_id IS NULL;
DELETE FROM roles WHERE company_id IS NULL;
DELETE FROM branches WHERE company_id IS NULL;

-- ── Clean duplicate usernames (keep earliest) ──────────────────────────────
DELETE FROM users a USING users b
WHERE a.id > b.id
  AND a.company_id = b.company_id
  AND lower(a.username) = lower(b.username);

-- ── Clean duplicate role names (keep earliest) ─────────────────────────────
DELETE FROM roles a USING roles b
WHERE a.id > b.id
  AND a.company_id = b.company_id
  AND lower(a.name) = lower(b.name);

-- ── Users ───────────────────────────────────────────────────────────────────
-- Ensure password_hash is not null for existing rows (seed should have it)
UPDATE users SET password_hash = 'pbkdf2:100000:00000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000' WHERE password_hash IS NULL;

-- Add FK for branch_id (was plain uuid)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_branch_id_fkey') THEN
    ALTER TABLE users ADD CONSTRAINT users_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Indexes for users
CREATE INDEX IF NOT EXISTS idx_users_company_id ON users(company_id);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_company_username ON users(company_id, lower(username));

-- Enforce NOT NULL where it was wrongly nullable (after cleaning)
ALTER TABLE users ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE users ALTER COLUMN password_hash SET NOT NULL;

-- ── Roles ───────────────────────────────────────────────────────────────────
UPDATE roles SET is_system = false WHERE is_system IS NULL;
ALTER TABLE roles ALTER COLUMN is_system SET NOT NULL;
ALTER TABLE roles ALTER COLUMN is_system SET DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_roles_company_id ON roles(company_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_roles_company_name ON roles(company_id, lower(name));

ALTER TABLE roles ALTER COLUMN company_id SET NOT NULL;

-- ── Branches ────────────────────────────────────────────────────────────────
-- Add missing updated_at (Drizzle expects it, SQL was missing)
ALTER TABLE branches ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_branches_company_active ON branches(company_id, is_active);
CREATE UNIQUE INDEX IF NOT EXISTS uq_branches_company_code ON branches(company_id, code) WHERE code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_branches_company_name ON branches(company_id, lower(name));

ALTER TABLE branches ALTER COLUMN company_id SET NOT NULL;
