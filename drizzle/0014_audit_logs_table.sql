-- ============================================================================
-- Migration 0014: Audit logs table
-- ============================================================================
-- The Drizzle schema (`auditLogs` in src/core/database/schema/audit.ts) and
-- the application code (`auditLogger` in src/core/utils/auditLogger.ts) both
-- reference an `audit_logs` table, but no migration ever created it. As a
-- result every audit call silently no-ops, which means we lose the
-- create/update/delete trail for every business document.
--
-- This migration creates the missing table with the columns the application
-- actually reads/writes. It is fully idempotent so it is safe to re-apply.
-- ============================================================================

CREATE TABLE IF NOT EXISTS audit_logs (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	user_id uuid NOT NULL,
	action varchar(20) NOT NULL,
	table_name varchar(100) NOT NULL,
	record_id uuid NOT NULL,
	old_values jsonb,
	new_values jsonb,
	ip_address varchar(45),
	company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
	created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Helpful indexes for the main access patterns (per test contract)
CREATE INDEX IF NOT EXISTS "idx_audit_logs_company_created"
	ON "audit_logs" ("company_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_audit_logs_table"
	ON "audit_logs" ("table_name");
CREATE INDEX IF NOT EXISTS "idx_audit_logs_user"
	ON "audit_logs" ("user_id");
