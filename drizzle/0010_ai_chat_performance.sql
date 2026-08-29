-- AI chat performance: session save/load were doing sequential scans on
-- ai_chat_messages (no index on session_id) and ai_chat_sessions lookups.
CREATE INDEX IF NOT EXISTS "idx_ai_chat_messages_session" ON "ai_chat_messages" ("session_id", "sort_order");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ai_chat_sessions_user" ON "ai_chat_sessions" ("company_id", "user_id", "updated_at");
