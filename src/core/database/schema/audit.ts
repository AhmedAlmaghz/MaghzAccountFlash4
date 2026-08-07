import { pgTable, uuid, varchar, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { companies } from './core';
import { sql } from 'drizzle-orm';

// ─── Audit Logs (سجل التدقيق) ────────────────────────────────────────────────
// Used by auditLogger to track all create/update/delete operations.
// `record_id` is varchar (not uuid) so it can hold both DB record UUIDs and
// AI tool-name identifiers like `sales.create_customer`.
export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull(),
  action: varchar('action', { length: 20 }).notNull(),
  tableName: varchar('table_name', { length: 100 }).notNull(),
  recordId: varchar('record_id', { length: 100 }).notNull(),
  oldValues: jsonb('old_values'),
  newValues: jsonb('new_values'),
  ipAddress: varchar('ip_address', { length: 45 }),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
});
