-- Migration 0016: AI chat persistence
-- Two tables: ai_chat_sessions (header) + ai_chat_messages (lines).
-- Both carry company_id NOT NULL (defense-in-depth multi-tenancy).

CREATE TABLE IF NOT EXISTS "ai_chat_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "title" varchar(200),
  "message_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ai_chat_sessions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE cascade,
  CONSTRAINT "ai_chat_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade
);

CREATE TABLE IF NOT EXISTS "ai_chat_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL,
  "session_id" uuid NOT NULL,
  "role" varchar(20) NOT NULL,
  "kind" varchar(20) NOT NULL,
  "content" text,
  "tool_call" jsonb,
  "sort_order" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ai_chat_messages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE cascade,
  CONSTRAINT "ai_chat_messages_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "ai_chat_sessions"("id") ON DELETE cascade
);

CREATE INDEX IF NOT EXISTS "idx_ai_chat_sessions_company_user" ON "ai_chat_sessions"("company_id", "user_id");
CREATE INDEX IF NOT EXISTS "idx_ai_chat_sessions_company_updated" ON "ai_chat_sessions"("company_id", "updated_at");
CREATE INDEX IF NOT EXISTS "idx_ai_chat_messages_session" ON "ai_chat_messages"("session_id", "sort_order");
CREATE INDEX IF NOT EXISTS "idx_ai_chat_messages_company" ON "ai_chat_messages"("company_id");
