-- 0022_audit_and_document_sequences_fix.sql
-- Fixes two runtime issues uncovered after enabling user-tracking audit columns:
--
--   1. `document_sequences` has no `updated_by` column, but `getNextDocumentNumber`
--      updates `updated_by = $N` whenever it increments a sequence. The UPDATE now
--      errors out, which means every document that auto-numbers (sales invoices,
--      purchase orders, etc.) fails its INSERT. This migration adds the column
--      so the audit column can be populated alongside `updated_at = NOW()`.
--
--   2. `audit_logs.record_id` was typed as `uuid NOT NULL`, but the AI tool
--      executor logs tool-name strings like "sales.create_customer" which are
--      not UUIDs. This caused every AI write tool call to fail with
--      "invalid input syntax for type uuid". The column is widened to
--      `varchar(100)` so it can hold both UUID record references (from regular
--      CRUD pages) and AI tool-name identifiers.
--
-- Both changes are backward-compatible: existing UUID values fit in varchar(100),
-- and the new `updated_by` column defaults to NULL.

ALTER TABLE document_sequences ADD COLUMN IF NOT EXISTS updated_by uuid;

ALTER TABLE audit_logs ALTER COLUMN record_id TYPE varchar(100) USING record_id::varchar(100);

CREATE INDEX IF NOT EXISTS idx_document_sequences_company ON document_sequences (company_id);
