-- Migration 0001: Add UNIQUE constraint on settings(company_id, key)
-- Required by ON CONFLICT (company_id, key) DO UPDATE in:
--   electron/aiHandler.js (upsertAiSetting)
--   src/modules/core/api.ts (setSetting)
--
-- This migration is idempotent: it checks existence before creating.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'settings_company_id_key_unique'
      AND conrelid = 'settings'::regclass
  ) THEN
    ALTER TABLE "settings"
      ADD CONSTRAINT "settings_company_id_key_unique"
      UNIQUE ("company_id", "key");
  END IF;
END $$;
