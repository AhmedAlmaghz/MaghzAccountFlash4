-- 0023_activities_user_tracking_columns.sql
-- Completes user-tracking columns for the `activities` table.
-- Migration 0021 covered `tasks` but missed `activities`, while the Drizzle
-- schema and CRM API already reference `created_by`/`updated_by` here.
-- Nullable + no FK reference, mirroring the 0021 pattern, so deleting a user
-- never cascades into activity history.

ALTER TABLE activities ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS updated_by uuid;

CREATE INDEX IF NOT EXISTS idx_activities_company_updated ON activities (company_id, updated_by);
