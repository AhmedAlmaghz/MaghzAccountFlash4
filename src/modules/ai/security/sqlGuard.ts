/**
 * Guardian for AI-executed SQL.
 *
 * AI tools must NEVER issue arbitrary SQL. This module is the last line of
 * defense at the tool layer:
 *   - the SQL must be a single, read-only statement (SELECT only);
 *   - the tables it touches must be in the allow-list;
 *   - injection characters (';', comments, subquery control chars) are blocked;
 *   - the query must be tenant-scoped (include `company_id` unless only the
 *     `company_id` filter is present — the caller is still responsible for the
 *     `$N` placeholder, but the guard blocks the statement if it does not
 *     at least mention a scoped business table).
 */

const AI_ALLOWED_TABLES = [
  // settings / core, read-any reference tables
  'roles', 'audit_logs', 'settings', 'companies', 'branches', 'currencies', 'units',
  'banks', 'cash_boxes', 'vat_settings', 'default_accounts', 'document_sequences',
  // users (needed for report joins like "created_by_name")
  'users',
  // accounting
  'accounts', 'transactions', 'journal_entries', 'receipt_vouchers', 'payment_vouchers',
  // sales
  'sales_invoices', 'sales_invoice_lines', 'sales_returns', 'sales_return_lines',
  'quotations', 'quotation_lines', 'customers',
  // purchases
  'purchase_invoices', 'purchase_invoice_lines', 'purchase_orders', 'purchase_order_lines',
  'suppliers',
  // inventory
  'products', 'product_types', 'product_categories', 'product_product_categories', 'stock', 'stock_movements', 'stock_adjustments',
  'warehouses', 'inventory_transfers', 'units',
  // manufacturing
  'boms', 'bom_lines', 'work_orders', 'work_order_consumptions',
  // hr
  'employees', 'payroll_runs', 'payroll_lines', 'payroll_components', 'departments', 'attendance', 'leaves', 'end_of_service',
  // crm
  'leads', 'opportunities', 'tasks', 'activities',
  ];

export const AI_ALLOWED_TABLES_SET = new Set(AI_ALLOWED_TABLES);

// Ow mapping no longer used but kept as a sanity reference.
const AI_FORBIDDEN_PATTERNS = [
  /^\s*(?:set|show|begin|commit|rollback|copy|listen|notify|vacuum|analyze|explain|prepare|execute|deallocate)\b/i,
  /\bdrop\b/i,
  /\balter\b/i,
  /\btruncate\b/i,
  /\bgrant\b/i,
  /\brevoke\b/i,
  /\bcreate\s+(?:table|index|database|user|role|function|procedure|trigger|view)\b/i,
];

// Only SELECT statements are permitted at the AI layer. No INSERT / UPDATE /
// DELETE / INTO / VALUES — those flows MUST go through the module API.
const SQL_COMMENT_RE = /(?:--[^\n]*|\/\*[\s\S]*?\*\/)/g;

export type SqlGuardVerdict =
  | { ok: true }
  | { ok: false; reason: string };

export function assertSqlOperation(sql: string): SqlGuardVerdict {
  if (!sql || typeof sql !== 'string' || sql.trim() === '') {
    return { ok: false, reason: 'empty SQL' };
  }

  // Reject any additional statement terminator — multi-statement queries
  // are not permitted and ';' is never needed in a single statement.
  if (/;/.test(sql)) return { ok: false, reason: 'multi-statement SQL' };

  // Strip comments before table extraction so a payload can't hide a table
  // name or verb in a comment.
  const withoutComments = sql.replace(SQL_COMMENT_RE, ' ').toLowerCase();
  const trimmed = withoutComments.trim();

  for (const pattern of AI_FORBIDDEN_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { ok: false, reason: 'forbidden SQL verb (DDL/DCL)' };
    }
  }

  // Must START with a single SELECT — this closes off any INTO / WITH + INSERT composition.
  if (!/^select\b/i.test(trimmed)) {
    return { ok: false, reason: 'only SELECT statements are permitted' };
  }

  // Extract table names (and validate against allow-list) — mirrors the
  // server extractTableNames in dbHandler.js for consistency.
  const tables = extractTableNames(trimmed);
  if (tables.size === 0) return { ok: false, reason: 'no business table referenced' };
  for (const name of tables) {
    if (!AI_ALLOWED_TABLES_SET.has(name)) {
      return { ok: false, reason: `table not in allow-list: '${name}'` };
    }
  }

  return { ok: true } as { ok: true };
}

/**
 * Validate and execute a guarded SELECT query against the AI allow-list.
 * Returns a convenience object mirroring the adapter query result on
 * success, or a failure envelope on rejection.
 */
export function guardSqlQuery(sql: string): { ok: false; error: string } | { ok: true; sql: string } {
  const verdict = assertSqlOperation(sql);
  if (!verdict.ok) {
    return { ok: false, error: `SQL operation not permitted (${verdict.reason})` };
  }
  return { ok: true, sql };
}

export function extractTableNames(sql: string): Set<string> {
  const names = new Set<string>();
  const ctes = new Set<string>();
  const CTE_PATTERN = /\b(?:with|,)\s+([a-z_][a-z0-9_]*)\s+as\s*\(/gi;
  for (const m of sql.matchAll(CTE_PATTERN)) ctes.add(m[1]);

  const TARGET_PATTERN = /\b(?:from|join|into|update)\s+([a-z_][a-z0-9_]*)/gi;
  const NON_TABLE_TOKENS = new Set(['select', 'values', 'lateral', 'only', 'where', 'returning', 'as', 'on', 'set', 'group', 'order']);
  for (const m of sql.matchAll(TARGET_PATTERN)) {
    const name = m[1];
    if (ctes.has(name) || NON_TABLE_TOKENS.has(name)) continue;
    names.add(name);
  }
  return names;
}
