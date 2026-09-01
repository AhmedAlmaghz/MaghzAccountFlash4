import { pgTable, uuid, varchar, text, timestamp, numeric, date, integer } from 'drizzle-orm/pg-core';
import { companies, users } from './core';

// ─── Leads ────────────────────────────────────────────────────────────────────
export const leads = pgTable('leads', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  phone: varchar('phone', { length: 50 }),
  email: varchar('email', { length: 255 }),
  company: varchar('company', { length: 255 }),
  source: varchar('source', { length: 100 }), // website, referral, social, etc.
  status: varchar('status', { length: 20 }).default('new').notNull(), // new, contacted, qualified, converted, lost
  rating: varchar('rating', { length: 20 }).default('warm').notNull(), // hot, warm, cold
  estimatedValue: numeric('estimated_value', { precision: 18, scale: 4 }),
  assignedTo: uuid('assigned_to').references(() => users.id),
  notes: text('notes'),
  lastContactedAt: timestamp('last_contacted_at', { withTimezone: true }),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// ─── Opportunities ────────────────────────────────────────────────────────────
export const opportunities = pgTable('opportunities', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  leadId: uuid('lead_id'),
  customerId: uuid('customer_id'),
  name: varchar('name', { length: 255 }).notNull(),
  value: numeric('value', { precision: 18, scale: 4 }).notNull(),
  stage: varchar('stage', { length: 50 }).default('new').notNull(), // new, qualified, proposal, negotiation, won, lost
  probability: integer('probability').default(50), // 0-100
  expectedCloseDate: date('expected_close_date'),
  closeDate: date('close_date'), // stamped when stage becomes won/lost (final)
  assignedTo: uuid('assigned_to').references(() => users.id),
  notes: text('notes'),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// ─── Tasks ────────────────────────────────────────────────────────────────────
export const tasks = pgTable('tasks', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  opportunityId: uuid('opportunity_id'),
  leadId: uuid('lead_id'),
  customerId: uuid('customer_id'),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  dueDate: date('due_date').notNull(),
  priority: varchar('priority', { length: 20 }).default('medium').notNull(),
  status: varchar('status', { length: 20 }).default('pending').notNull(),
  assignedTo: uuid('assigned_to').references(() => users.id),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// ─── Activities ───────────────────────────────────────────────────────────────
export const activities = pgTable('activities', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  leadId: uuid('lead_id'),
  opportunityId: uuid('opportunity_id'),
  customerId: uuid('customer_id'),
  type: varchar('type', { length: 50 }).notNull(),
  subject: varchar('subject', { length: 255 }).notNull(),
  description: text('description'),
  activityDate: timestamp('activity_date', { withTimezone: true }).notNull(),
  durationMinutes: integer('duration_minutes'),
  assignedTo: uuid('assigned_to').references(() => users.id),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});
