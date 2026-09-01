import { pgTable, uuid, varchar, text, timestamp, numeric, boolean, date, integer, jsonb } from 'drizzle-orm/pg-core';
import { companies } from './core';

// ─── Departments ──────────────────────────────────────────────────────────────
export const departments = pgTable('departments', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  managerId: uuid('manager_id'),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ─── Employees ────────────────────────────────────────────────────────────────
export const employees = pgTable('employees', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  employeeNumber: varchar('employee_number', { length: 50 }).notNull(),
  fullName: varchar('full_name', { length: 255 }).notNull(),
  nationalId: varchar('national_id', { length: 50 }),
  phone: varchar('phone', { length: 50 }),
  email: varchar('email', { length: 255 }),
  address: text('address'),
  departmentId: uuid('department_id'),
  position: varchar('position', { length: 100 }),
  grade: varchar('grade', { length: 50 }),
  hireDate: date('hire_date').notNull(),
  terminationDate: date('termination_date'),
  baseSalary: numeric('base_salary', { precision: 18, scale: 4 }).notNull(),
  openingBalance: numeric('opening_balance', { precision: 18, scale: 4 }).notNull().default('0'),
  openingBalancePosted: boolean('opening_balance_posted').notNull().default(false),
  openingDate: date('opening_date'),
  isActive: boolean('is_active').default(true).notNull(),
  photoUrl: text('photo_url'),
  attachments: jsonb('attachments'),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// ─── Attendance ───────────────────────────────────────────────────────────────
export const attendance = pgTable('attendance', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  employeeId: uuid('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  date: date('date').notNull(),
  // Nullable since 0016 — absent/on_leave days carry no check-in punch.
  checkIn: timestamp('check_in'),
  checkOut: timestamp('check_out'),
  overtimeHours: numeric('overtime_hours', { precision: 5, scale: 2 }).default('0'),
  status: varchar('status', { length: 20 }).default('present').notNull(),
  notes: text('notes'),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ─── Leaves ───────────────────────────────────────────────────────────────────
export const leaves = pgTable('leaves', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  employeeId: uuid('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  type: varchar('type', { length: 50 }).notNull(), // annual, sick, emergency, unpaid
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  days: numeric('days', { precision: 5, scale: 2 }).notNull(),
  status: varchar('status', { length: 20 }).default('pending').notNull(), // pending, approved, rejected
  reason: text('reason'),
  approvedBy: uuid('approved_by'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ─── Payroll Runs ─────────────────────────────────────────────────────────────
export const payrollRuns = pgTable('payroll_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  runNumber: varchar('run_number', { length: 50 }),
  month: integer('month').notNull(),
  year: integer('year').notNull(),
  totalAmount: numeric('total_amount', { precision: 18, scale: 4 }).notNull().default('0'),
  status: varchar('status', { length: 20 }).default('draft').notNull(),
  notes: text('notes'),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const payrollLines = pgTable('payroll_lines', {
  id: uuid('id').defaultRandom().primaryKey(),
  payrollRunId: uuid('payroll_run_id').notNull().references(() => payrollRuns.id, { onDelete: 'cascade' }),
  employeeId: uuid('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  baseSalary: numeric('base_salary', { precision: 18, scale: 4 }).notNull(),
  allowances: numeric('allowances', { precision: 18, scale: 4 }).default('0'),
  deductions: numeric('deductions', { precision: 18, scale: 4 }).default('0'),
  overtime: numeric('overtime', { precision: 18, scale: 4 }).default('0'),
  netSalary: numeric('net_salary', { precision: 18, scale: 4 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ─── End of Service ───────────────────────────────────────────────────────────
export const endOfService = pgTable('end_of_service', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  employeeId: uuid('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  terminationDate: date('termination_date').notNull(),
  serviceYears: numeric('service_years', { precision: 5, scale: 2 }).notNull(),
  lastSalary: numeric('last_salary', { precision: 18, scale: 4 }).notNull(),
  eosAmount: numeric('eos_amount', { precision: 18, scale: 4 }).notNull(),
  reason: varchar('reason', { length: 50 }).notNull(), // resignation, termination, contract_end, retirement
  status: varchar('status', { length: 20 }).notNull().default('draft'), // draft, approved, paid
  cashBoxId: uuid('cash_box_id'),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  notes: text('notes'),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});
