/**
 * Canonical backup plan — the single source of truth for which tables are
 * backed up, how each is scoped to the company, and the FK-safe delete /
 * insert order.
 *
 * Mirrored in electron/dbHandler.js (BACKUP_PLAN) because the main process
 * cannot import renderer TS. A parity test in backupTables.test.ts keeps the
 * two copies in sync — update both together.
 *
 * Retired tables are NEVER listed: `banks` (dropped in 0002), `calls` and
 * `crm_activities` (dropped in 0015).
 */

export type TableScope =
  | { type: 'company' }
  | { type: 'single'; idColumn: string }
  | { type: 'children'; parent: string; fk: string };

export interface PlannedTable {
  table: string;
  scope: TableScope;
}

const C = (table: string): PlannedTable => ({ table, scope: { type: 'company' } });
const CHILD = (table: string, parent: string, fk: string): PlannedTable => ({
  table,
  scope: { type: 'children', parent, fk },
});

/** Detail tables without company_id — scoped through their parent. */
export const CHILD_TABLES: PlannedTable[] = [
  CHILD('product_product_categories', 'products', 'product_id'),
  CHILD('warehouse_transfer_lines', 'warehouse_transfers', 'transfer_id'),
  CHILD('quotation_lines', 'quotations', 'quotation_id'),
  CHILD('sales_invoice_lines', 'sales_invoices', 'invoice_id'),
  CHILD('sales_return_lines', 'sales_returns', 'return_id'),
  CHILD('purchase_invoice_lines', 'purchase_invoices', 'invoice_id'),
  CHILD('purchase_order_lines', 'purchase_orders', 'order_id'),
  CHILD('purchase_return_lines', 'purchase_returns', 'return_id'),
  CHILD('bom_lines', 'boms', 'bom_id'),
  CHILD('work_order_consumptions', 'work_orders', 'work_order_id'),
  CHILD('payroll_lines', 'payroll_runs', 'payroll_run_id'),
];

/**
 * FK-safe DELETE order: children → documents/operations → masters →
 * `companies` last. INSERT order is derived (companies first, then the
 * exact reverse), so a valid delete order guarantees a valid insert order.
 */
export const DELETE_ORDER: PlannedTable[] = [
  ...CHILD_TABLES,
  // product_units is company-scoped but FK-bound to products + units —
  // delete before both masters (units is RESTRICT-referenced).
  C('product_units'),
  // documents & operations (children of masters)
  C('pos_payments'),
  C('pos_shifts'),
  C('sales_returns'),
  C('sales_invoices'),
  C('quotations'),
  C('purchase_returns'),
  C('purchase_invoices'),
  C('purchase_orders'),
  C('receipt_vouchers'),
  C('payment_vouchers'),
  C('journal_entries'),
  C('transactions'),
  // Phase 5: fiscal periods + fixed-asset register (company-scoped, FK only
  // to companies — delete with the operations, before the company row).
  C('accounting_periods'),
  C('fixed_assets'),
  C('stock_movements'),
  // FIFO layers reference products (CASCADE) + warehouses (SET NULL) —
  // delete with the other stock operations, before both masters.
  C('inventory_layers'),
  C('stock_adjustments'),
  C('warehouse_transfers'),
  C('attendance'),
  C('leaves'),
  C('end_of_service'),
  C('payroll_runs'),
  C('tasks'),
  C('activities'),
  C('leads'),
  C('opportunities'),
  C('ai_chat_messages'),
  C('ai_chat_sessions'),
  C('ai_job_items'),
  C('ai_job_batches'),
  C('audit_logs'),
  C('stock'),
  // masters (referenced by the documents above)
  C('customers'),
  C('suppliers'),
  C('work_orders'),
  C('boms'),
  C('products'),
  C('product_categories'),
  C('product_types'),
  C('employees'),
  C('departments'),
  C('payroll_components'),
  C('warehouses'),
  C('branches'),
  C('cash_boxes'),
  C('cost_centers'),
  // default_accounts.account_id → accounts is NO ACTION: must go first.
  C('default_accounts'),
  C('accounts'),
  C('currencies'),
  C('units'),
  C('vat_settings'),
  C('document_sequences'),
  C('users'),
  C('roles'),
  C('settings'),
  // Tax periods reference only the company — delete with the masters.
  C('tax_periods'),
  // the company row itself — deleted last, inserted first
  { table: 'companies', scope: { type: 'single', idColumn: 'id' } },
];

/**
 * FK-safe INSERT order — explicit (NOT the reverse of deletes: SET NULL
 * relations such as opportunities→leads allow any delete order but still
 * enforce existence on insert). Every referenced row is inserted before
 * the rows that point at it; detail tables go last.
 */
const INSERT_TABLES = [
  'companies',
  'currencies',
  'units',
  'branches',
  'roles',
  'users',
  'departments',
  'accounts',
  'cash_boxes',
  'cost_centers',
  'vat_settings',
  'default_accounts',
  'document_sequences',
  'settings',
  'tax_periods',
  'payroll_components',
  'product_types',
  'product_categories',
  'warehouses',
  'products',
  'product_units',
  'boms',
  'employees',
  'work_orders',
  'customers',
  'suppliers',
  'leads',
  'opportunities',
  'tasks',
  'activities',
  'pos_shifts',
  'quotations',
  'sales_invoices',
  'pos_payments',
  'sales_returns',
  'purchase_orders',
  'purchase_invoices',
  'purchase_returns',
  'receipt_vouchers',
  'payment_vouchers',
  'transactions',
  'journal_entries',
  'accounting_periods',
  'fixed_assets',
  'stock',
  'stock_movements',
  'inventory_layers',
  'stock_adjustments',
  'warehouse_transfers',
  'attendance',
  'leaves',
  'payroll_runs',
  'end_of_service',
  'ai_chat_sessions',
  'ai_chat_messages',
  'ai_job_batches',
  'ai_job_items',
  'audit_logs',
  'product_product_categories',
  'warehouse_transfer_lines',
  'quotation_lines',
  'sales_invoice_lines',
  'sales_return_lines',
  'purchase_invoice_lines',
  'purchase_order_lines',
  'purchase_return_lines',
  'bom_lines',
  'work_order_consumptions',
  'payroll_lines',
];

export const INSERT_ORDER: PlannedTable[] = (() => {
  const byTable = new Map(DELETE_ORDER.map((p) => [p.table, p]));
  return INSERT_TABLES.map((table) => {
    const plan = byTable.get(table);
    if (!plan) throw new Error(`INSERT_ORDER references unplanned table: ${table}`);
    return plan;
  });
})();

/** Every table the backup touches, in canonical order. */
export const ALL_PLANNED_TABLES: string[] = DELETE_ORDER.map((p) => p.table);

/** Tables that must never appear (dropped by old migrations). */
export const RETIRED_TABLES = ['banks', 'calls', 'crm_activities'];

/**
 * Secret columns stripped from the envelope unless it is encrypted. A restored
 * user with NULL password_hash cannot log in until an admin resets the
 * password — documented in the restore dialog.
 */
export const SECRET_COLUMNS: Record<string, string[]> = {
  users: ['password_hash'],
};

/**
 * Tables excluded from RESTORE (still captured in the backup for reference).
 *
 * `users` is identity/security data: restoring it would resurrect old
 * passwords, revert role changes made after the backup, and delete the
 * logged-in account mid-session (users.company_id → companies CASCADE). The
 * existing users of the target database are always preserved.
 */
export const RESTORE_SKIP_TABLES: readonly string[] = ['users'];

/**
 * Tables restored by UPSERT instead of delete+insert.
 *
 * `companies` must never be DELETEd during restore: `users.company_id →
 * companies ON DELETE CASCADE` would wipe every user account. The company row
 * is upserted (INSERT … ON CONFLICT (id) DO UPDATE) instead.
 */
export const RESTORE_UPSERT_TABLES: readonly string[] = ['companies'];

/**
 * Columns that reference `users` (per the live FK graph in
 * drizzle/0000_init.sql). Users are never restored, so any reference to a user
 * missing from the target database must be resolved before insert or the FK
 * kills the whole restore (e.g. `currencies_created_by_users_fk` — currencies
 * are inserted BEFORE users in INSERT_ORDER and carry created_by).
 *
 * Mirrored in electron/dbHandler.js (RESTORE_USER_REF_COLUMNS) — a parity test
 * keeps the two copies in sync.
 */
export const USER_REF_COLUMNS: Record<string, string[]> = {
  accounts: ['created_by', 'updated_by'],
  activities: ['assigned_to', 'created_by', 'updated_by'],
  ai_chat_sessions: ['user_id'],
  ai_job_batches: ['user_id'],
  attendance: ['created_by', 'updated_by'],
  audit_logs: ['user_id'],
  boms: ['created_by', 'updated_by'],
  branches: ['created_by', 'updated_by'],
  cash_boxes: ['created_by', 'updated_by'],
  companies: ['created_by', 'updated_by'],
  currencies: ['created_by', 'updated_by'],
  customers: ['created_by', 'updated_by'],
  departments: ['created_by', 'updated_by'],
  document_sequences: ['updated_by'],
  employees: ['created_by', 'updated_by'],
  end_of_service: ['created_by', 'updated_by'],
  fixed_assets: ['created_by', 'updated_by'],
  journal_entries: ['created_by', 'updated_by'],
  leads: ['assigned_to', 'created_by', 'updated_by'],
  leaves: ['approved_by', 'created_by', 'updated_by'],
  opportunities: ['assigned_to', 'created_by', 'updated_by'],
  payment_vouchers: ['created_by', 'updated_by'],
  payroll_components: ['created_by', 'updated_by'],
  payroll_runs: ['created_by', 'updated_by'],
  pos_payments: ['created_by', 'updated_by'],
  pos_shifts: ['user_id', 'created_by', 'updated_by'],
  product_types: ['created_by', 'updated_by'],
  products: ['created_by', 'updated_by'],
  purchase_invoices: ['created_by', 'updated_by'],
  purchase_orders: ['created_by', 'updated_by'],
  purchase_returns: ['created_by', 'updated_by'],
  quotations: ['created_by', 'updated_by'],
  receipt_vouchers: ['created_by', 'updated_by'],
  sales_invoices: ['created_by', 'updated_by'],
  sales_returns: ['created_by', 'updated_by'],
  stock_adjustments: ['approved_by', 'created_by', 'updated_by'],
  stock_movements: ['created_by', 'updated_by'],
  suppliers: ['created_by', 'updated_by'],
  tasks: ['assigned_to', 'created_by', 'updated_by'],
  transactions: ['created_by', 'updated_by'],
  warehouse_transfers: ['created_by', 'updated_by'],
  warehouses: ['created_by', 'updated_by'],
  work_orders: ['created_by', 'updated_by'],
};

/** SQL identifier guard — backup files are untrusted input. */
export function isSafeIdentifier(name: string): boolean {
  return /^[a-z][a-z0-9_]{0,63}$/.test(name);
}

/** Envelope file extension + MIME for downloads and pickers. */
export const BACKUP_FILE_EXTENSION = '.mab';
export const BACKUP_MIME_TYPE = 'application/x-maghz-backup+json';

export function buildBackupFileName(companyName: string, when: Date = new Date()): string {
  const safe = companyName
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'company';
  const stamp = when.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `maghz-backup_${safe}_${stamp}${BACKUP_FILE_EXTENSION}`;
}
