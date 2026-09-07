-- 0023: AI chat message attachments (مرفقات رسائل الوكيل الذكي)
--
-- User messages may carry file attachments (invoice photo, PDF statement,
-- Excel price list, audio note). The BINARY payload never lands here — it
-- lives in the renderer's in-memory registry (+ OPFS), because chat saves
-- rewrite every message and base64 would bloat the table and every save.
-- What persists is the metadata + locally extracted text (pdf/xlsx drafts),
-- so the conversation stays meaningful after reloads even though the binary
-- itself expires with the renderer session.
-- Idempotent: every statement guards with IF NOT EXISTS.

ALTER TABLE ai_chat_messages ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;
