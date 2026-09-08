import { pgTable, uuid, varchar, integer, text, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { companies, users } from './core';

// ─── AI Chat Persistence (محادثات المساعد الذكي) ─────────────────────────────
// Sessions group chat messages per user per company.
// tool_call stores the full PendingToolCall payload as JSONB (nullable).
export const aiChatSessions = pgTable('ai_chat_sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 200 }),
  messageCount: integer('message_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
});

export const aiChatMessages = pgTable('ai_chat_messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  sessionId: uuid('session_id').notNull().references(() => aiChatSessions.id, { onDelete: 'cascade' }),
  role: varchar('role', { length: 20 }).notNull(),
  kind: varchar('kind', { length: 20 }).notNull(),
  content: text('content'),
  toolCall: jsonb('tool_call'),
  // Attachment metadata + extracted text only — binaries live in the
  // renderer's registry/OPFS (see modules/ai/attachments). Persisted so the
  // conversation stays meaningful after the binary expires.
  attachments: jsonb('attachments').notNull().default([]),
  sortOrder: integer('sort_order').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
});

// ─── AI Job Queue (طوابير عمليات الوكيل الذكي) ─────────────────────────────
// A batch groups many tool calls under ONE user approval. Items carry an
// optional afterSeq link to an earlier item of the same batch (DAG —
// validated in the engine before writing, so no FK here).
export const aiJobBatches = pgTable('ai_job_batches', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  sessionId: uuid('session_id').references(() => aiChatSessions.id, { onDelete: 'set null' }),
  kind: varchar('kind', { length: 40 }).notNull().default('mixed'),
  title: varchar('title', { length: 200 }),
  totalCount: integer('total_count').notNull().default(0),
  doneCount: integer('done_count').notNull().default(0),
  failedCount: integer('failed_count').notNull().default(0),
  skippedCount: integer('skipped_count').notNull().default(0),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
});

export const aiJobItems = pgTable('ai_job_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  batchId: uuid('batch_id').notNull().references(() => aiJobBatches.id, { onDelete: 'cascade' }),
  seq: integer('seq').notNull(),
  toolName: varchar('tool_name', { length: 120 }).notNull(),
  args: jsonb('args').notNull().default({}),
  afterSeq: integer('after_seq'),
  idempotencyKey: varchar('idempotency_key', { length: 200 }).notNull(),
  label: varchar('label', { length: 200 }),
  ref: varchar('ref', { length: 100 }),
  resultData: jsonb('result_data'),
  status: varchar('status', { length: 20 }).notNull().default('queued'),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  errorCode: varchar('error_code', { length: 40 }),
  resultRef: varchar('result_ref', { length: 200 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
});
