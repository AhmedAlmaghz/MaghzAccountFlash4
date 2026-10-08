/**
 * Relay SQL guard — the security core of the generic Postgres-over-HTTPS
 * relay (api/db.ts + dev twin in vite.config.ts).
 *
 * This is a faithful port of the renderer-SQL authorization subsystem in
 * electron/dbHandler.js (SQL_MODULE_TABLE_RULES, extractTableNames,
 * rawTenantScopeIsValid, rawChildScopeIsValid, assertSqlAuthorized and its
 * supporting tables). The relay speaks the same contract as the desktop
 * `_exec` channel: arbitrary parameterized DML is allowed only when every
 * touched table grants the caller's role, every tenant table is scoped to
 * the JWT company, and sensitive columns never cross.
 *
 * Differences from the main process (deliberate, documented):
 *  - No pool access here: assertCompanyReferences (used by RPC validates,
 *    never by the raw path) is intentionally absent.
 *  - DDL (CREATE/ALTER/DROP/DO/...) is always refused on the query path —
 *    schema setup travels the dedicated `migrate` action instead, exactly
 *    like the main process (migrationRunner, never _exec).
 *  - Session shape is the JWT session
 *    `{ user: { id, companyId, role }, permissions: string[] }`.
 *
 * PARITY: electron/dbIpcParity.test.js pins the rule tables and the
 * behavior contract between the two copies. Any rule added in one place
 * must be mirrored in the other or CI fails.
 */

import { normalizeIdempotent } from './dbCore.js';

const FALLBACK_PERMISSIONS = {
  manager: [
    'core.view', 'accounting.view', 'accounting.create', 'accounting.edit', 'accounting.post',
    'inventory.view', 'inventory.create', 'inventory.edit',
    'sales.view', 'sales.create', 'sales.edit', 'sales.post',
    'pos.view', 'pos.create', 'pos.edit', 'pos.post',
    'purchases.view', 'purchases.create', 'purchases.edit',
    'manufacturing.view', 'manufacturing.create', 'manufacturing.edit', 'manufacturing.post',
    'reports.view', 'reports.export',
    'settings.view',
    'ai.use',
  ],
  accountant: [
    'core.view',
    'accounting.view', 'accounting.create', 'accounting.edit', 'accounting.post',
    'inventory.view',
    'sales.view', 'sales.create', 'sales.edit',
    'purchases.view', 'purchases.create', 'purchases.edit',
    'manufacturing.view',
    'reports.view', 'reports.export',
    'ai.use',
  ],
  sales_rep: [
    'sales.own', 'sales.create', 'sales.edit',
    'pos.own', 'pos.create', 'pos.post',
    'inventory.own',
    'crm.own', 'crm.create', 'crm.edit',
    'reports.view',
    'ai.use',
  ],
  viewer: [
    'core.view', 'accounting.view', 'inventory.view', 'sales.view',
    'purchases.view', 'manufacturing.view', 'pos.view', 'reports.view',
  ],
};

function hasPermission(session, permission) {
  if (!session || !session.user) return false;
  if (session.user.role === 'super_admin') return true;
  if (session.user.role === 'admin') {
    const restricted = ['core.edit'];
    if (restricted.includes(permission)) return false;
    return true;
  }
  if (Array.isArray(session.permissions) && session.permissions.includes(permission)) return true;
  const fallback = FALLBACK_PERMISSIONS[session.user.role];
  return !!fallback && fallback.includes(permission);
}

function isOwnOnly(session, module) {
  return hasPermission(session, `${module}.own`) && !hasPermission(session, `${module}.view`);
}

function canAccessOwnedRow(session, module, ownerId) {
  return !isOwnOnly(session, module) || String(ownerId || '') === String(session.user.id);
}

const SQL_MODULE_TABLE_RULES = [
  { module: 'settings', tables: ['roles'] },
  { module: 'settings', tables: ['audit_logs'], writeAny: true },
  { module: 'settings', tables: ['settings', 'companies', 'branches', 'currencies', 'users', 'units', 'cash_boxes', 'vat_settings', 'default_accounts'], readAny: true, writePermissions: ['settings.create', 'settings.edit', 'settings.post'] },
  {
    module: 'settings',
    tables: ['document_sequences'],
    readAny: true,
    writePermissions: [
      'settings.edit', 'accounting.create', 'sales.create', 'purchases.create',
      'inventory.create', 'hr.create', 'manufacturing.create', 'crm.create',
      'pos.create',
    ],
  },
  { module: 'accounting', tables: ['accounts'], readAny: true },
  { module: 'accounting', tables: ['cost_centers', 'receipt_vouchers', 'payment_vouchers', 'fixed_assets', 'accounting_periods'] },
  {
    module: 'accounting',
    tables: ['tax_periods'],
    readAny: true,
    writePermissions: ['accounting.create', 'accounting.edit', 'accounting.post'],
  },
  {
    module: 'accounting',
    tables: ['transactions', 'journal_entries'],
    readPermissions: ['accounting.view', 'accounting.own', 'reports.view'],
    writePermissions: [
      'accounting.create', 'accounting.edit', 'accounting.post',
      'hr.create', 'hr.edit',
      'sales.create', 'sales.edit', 'sales.post',
      'purchases.create', 'purchases.edit', 'purchases.post',
      'inventory.create', 'inventory.edit', 'inventory.post',
      'manufacturing.create', 'manufacturing.edit', 'manufacturing.post',
      'pos.create', 'pos.post',
    ],
  },
  {
    module: 'inventory',
    tables: ['products', 'product_types', 'product_categories', 'product_product_categories', 'product_units'],
    readPermissions: ['inventory.view', 'inventory.own', 'pos.view', 'pos.own'],
  },
  { module: 'inventory', tables: ['stock', 'stock_adjustments', 'warehouse_transfers', 'warehouse_transfer_lines', 'inventory_layers'], writePermissions: ['inventory.create', 'inventory.edit', 'inventory.post', 'manufacturing.create', 'manufacturing.edit', 'manufacturing.post', 'pos.create', 'pos.post'] },
  { module: 'inventory', tables: ['warehouses'], readAny: true, writePermissions: ['inventory.create', 'inventory.edit', 'inventory.post', 'manufacturing.create', 'manufacturing.edit', 'manufacturing.post'] },
  { module: 'inventory', tables: ['stock', 'stock_movements', 'warehouses'], writePermissions: ['inventory.create', 'inventory.edit', 'inventory.post', 'manufacturing.create', 'manufacturing.edit', 'manufacturing.post', 'pos.create', 'pos.post'] },
  {
    module: 'sales',
    tables: ['sales_invoices', 'sales_invoice_lines'],
    readPermissions: ['sales.view', 'sales.own', 'pos.view', 'pos.own', 'reports.view'],
    writePermissions: ['sales.create', 'sales.edit', 'sales.post', 'pos.create', 'pos.post'],
  },
  { module: 'sales', tables: ['customers'], readPermissions: ['sales.view', 'sales.own', 'pos.view', 'pos.own'], writePermissions: ['sales.create', 'sales.edit', 'sales.post', 'pos.create', 'pos.post'] },
  { module: 'sales', tables: ['sales_returns', 'sales_return_lines', 'quotations', 'quotation_lines', 'customers'] },
  { module: 'pos', tables: ['pos_shifts', 'pos_payments'], readPermissions: ['pos.view', 'pos.own', 'reports.view'] },
  { module: 'purchases', tables: ['purchase_invoices', 'purchase_invoice_lines', 'purchase_orders', 'purchase_order_lines', 'purchase_returns', 'purchase_return_lines', 'suppliers'] },
  { module: 'hr', tables: ['employees', 'payroll_runs', 'payroll_lines', 'payroll_components', 'departments', 'attendance', 'leaves', 'end_of_service'] },
  { module: 'crm', tables: ['leads', 'opportunities', 'tasks', 'activities'] },
  { module: 'manufacturing', tables: ['boms', 'bom_lines', 'work_orders', 'work_order_consumptions'] },
  { module: 'ai', tables: ['ai_chat_sessions', 'ai_chat_messages'] },
];

const TABLE_TARGET_PATTERN = /\b(?:from|join|into|update)\s+([a-z_][a-z0-9_]*)/gi;
const WRITE_TARGET_PATTERN = /\b(?:insert\s+into|update|delete\s+from|merge\s+into)\s+([a-z_][a-z0-9_]*)/gi;
const CTE_NAME_PATTERN = /\b(?:with|,)\s+([a-z_][a-z0-9_]*)\s+as\s*\(/gi;
const SQL_NON_TABLE_TOKENS = new Set(['select', 'values', 'lateral', 'only', 'where', 'returning', 'set']);
const RAW_SQL_FORBIDDEN_TABLES = new Set();
const RAW_SQL_APPEND_ONLY_TABLES = new Set(['audit_logs']);
const RAW_SQL_CHILD_TABLES = new Set([
  'product_product_categories', 'warehouse_transfer_lines', 'quotation_lines',
  'sales_invoice_lines', 'sales_return_lines', 'purchase_invoice_lines',
  'purchase_order_lines', 'purchase_return_lines', 'bom_lines',
  'work_order_consumptions', 'payroll_lines',
]);
const RAW_SQL_TENANT_TABLES = new Set(
  SQL_MODULE_TABLE_RULES.flatMap((rule) => rule.tables).filter((table) => !RAW_SQL_CHILD_TABLES.has(table)),
);
const RAW_SQL_CHILD_PARENT_RULES = new Map([
  ['product_product_categories', { parentTable: 'products', foreignKey: 'product_id' }],
  ['warehouse_transfer_lines', { parentTable: 'warehouse_transfers', foreignKey: 'transfer_id' }],
  ['quotation_lines', { parentTable: 'quotations', foreignKey: 'quotation_id' }],
  ['sales_invoice_lines', { parentTable: 'sales_invoices', foreignKey: 'invoice_id' }],
  ['sales_return_lines', { parentTable: 'sales_returns', foreignKey: 'return_id' }],
  ['purchase_invoice_lines', { parentTable: 'purchase_invoices', foreignKey: 'invoice_id' }],
  ['purchase_order_lines', { parentTable: 'purchase_orders', foreignKey: 'order_id' }],
  ['purchase_return_lines', { parentTable: 'purchase_returns', foreignKey: 'return_id' }],
  ['bom_lines', { parentTable: 'boms', foreignKey: 'bom_id' }],
  ['work_order_consumptions', { parentTable: 'work_orders', foreignKey: 'work_order_id' }],
  ['payroll_lines', { parentTable: 'payroll_runs', foreignKey: 'payroll_run_id' }],
]);
const RAW_SQL_FORBIDDEN_COLUMN_PATTERN = /\b(?:password_hash|secret|private_key|api_key)\b/i;
const DELETE_AS_EDIT_TABLES = new Set([
  'sales_invoice_lines', 'quotation_lines', 'sales_return_lines',
  'purchase_invoice_lines', 'purchase_order_lines', 'purchase_return_lines',
  'bom_lines', 'work_order_consumptions', 'payroll_lines',
  'product_product_categories', 'warehouse_transfer_lines', 'pos_payments',
]);
const FINANCIAL_UPDATE_RULES = new Map([
  ['sales_invoices', { permission: 'sales.post', fields: /\b(?:status|paid_amount|base_currency_paid|payment_type|subtotal|discount_amount|vat_amount|total_amount)\b/ }],
  ['sales_invoice_lines', { permission: 'sales.post', fields: /\b(?:quantity|unit_price|line_total|base_currency_line_total|unit_cost)\b/ }],
  ['sales_returns', { permission: 'sales.post', fields: /\b(?:status|total_amount|vat_amount|payment_type)\b/ }],
  ['sales_return_lines', { permission: 'sales.post', fields: /\b(?:quantity|unit_price|line_total|base_quantity)\b/ }],
  ['receipt_vouchers', { permission: 'accounting.post', fields: /\b(?:status|amount|amount_applied|base_currency_applied)\b/ }],
  ['payment_vouchers', { permission: 'accounting.post', fields: /\b(?:status|amount|amount_applied|base_currency_applied)\b/ }],
  ['transactions', { permission: 'accounting.post', fields: /\b(?:status|total_amount)\b/ }],
  ['tax_periods', { permission: 'accounting.post', fields: /\bstatus\b/ }],
  ['accounting_periods', { permission: 'accounting.post', fields: /\bstatus\b/ }],
  ['pos_shifts', { permission: 'pos.post', fields: /\b(?:status|closing_amount|expected_amount|difference)\b/ }],
  ['work_orders', { permission: 'manufacturing.post', fields: /\b(?:status|produced_quantity|total_cost)\b/ }],
  ['stock_adjustments', { permission: 'inventory.post', fields: /\b(?:status|system_qty|actual_qty|difference)\b/ }],
]);
const FORBIDDEN_STATEMENT_PATTERN = /^\s*(set|show|begin|commit|rollback|copy|listen|notify|vacuum|analyze|explain|prepare|execute|deallocate|create|drop|alter|truncate|grant|revoke|merge|do|call|refresh|reindex|comment)\b/i;

function extractTableNames(sql) {
  const normalized = String(sql || '').toLowerCase();
  const ctes = new Set();
  for (const m of normalized.matchAll(CTE_NAME_PATTERN)) ctes.add(m[1]);
  const names = new Set();
  for (const m of normalized.matchAll(TABLE_TARGET_PATTERN)) {
    const name = m[1];
    if (ctes.has(name) || SQL_NON_TABLE_TOKENS.has(name)) continue;
    names.add(name);
  }
  return names;
}

function moduleWritePermissions(module) {
  return [`${module}.create`, `${module}.edit`, `${module}.post`];
}

function rawTenantScopeIsValid(sql, params, companyId, tenantTables) {
  if (tenantTables.length === 0) return true;
  if (!params.some((value) => String(value || '') === String(companyId))) return false;

  const normalized = String(sql || '').toLowerCase();
  const isMutation = /\bupdate\b|\bdelete\s+from\b/.test(normalized);
  const whereIndex = isMutation ? normalized.indexOf(' where ') : -1;
  const predicateSql = whereIndex >= 0 ? normalized.slice(whereIndex + 1) : normalized;
  if (isMutation && whereIndex < 0) return false;

  if (tenantTables.length === 1 && tenantTables[0] === 'companies') {
    const idPredicates = [...predicateSql.matchAll(/\b(?:companies\s*\.\s*)?id\s*=\s*\$(\d+)/gi)];
    return idPredicates.length > 0 && idPredicates.every((match) => String(params[Number(match[1]) - 1] || '') === String(companyId));
  }

  const subqueryScopes = [...normalized.matchAll(/\$(\d+)(?:\s*::\s*[a-z_][a-z0-9_]*(?:\[\])?)?\s*=\s*\(\s*select\s+company_id\s+from\s+([a-z_][a-z0-9_]*)/gi)];
  const subqueryTables = new Set(subqueryScopes.map((match) => match[2]));
  const subqueryParamsValid = subqueryScopes.length === 0 || subqueryScopes.every((match) => String(params[Number(match[1]) - 1] || '') === String(companyId));
  if (subqueryParamsValid && tenantTables.every((table) => subqueryTables.has(table))) return true;

  const companyPredicates = [
    ...predicateSql.matchAll(/\b(?:([a-z_][a-z0-9_]*)\s*\.\s*)?company_id\s*(?:=|\bin\s*\()\s*\$(\d+)/gi),
    ...predicateSql.matchAll(/\b(?:([a-z_][a-z0-9_]*)\s*\.\s*)?company_id\s*=\s*any\s*\(\s*\$(\d+)/gi),
  ];
  if (companyPredicates.length > 0) {
    const validParam = companyPredicates.every((match) => String(params[Number(match[2]) - 1] || '') === String(companyId));
    if (!validParam || companyPredicates.length === 0) return false;

    for (const table of tenantTables) {
      const escapedTable = table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const aliases = new Set([table]);
      for (const match of normalized.matchAll(new RegExp(`\\b${escapedTable}\\b\\s+(?:as\\s+)?([a-z_][a-z0-9_]*)`, 'g'))) {
        if (!['on', 'where', 'join', 'left', 'right', 'inner', 'outer', 'set', 'values', 'returning'].includes(match[1])) aliases.add(match[1]);
      }
      const scoped = companyPredicates.some((match) => {
        if (!match[1]) return tenantTables.length === 1;
        return aliases.has(match[1]);
      }) || (subqueryParamsValid && subqueryTables.has(table));
      if (!scoped) return false;
    }
    return true;
  }

  for (const table of tenantTables) {
    const escapedTable = table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const writeTarget = new RegExp(`\\b(?:insert\\s+into|update|delete\\s+from)\\s+${escapedTable}\\b`, 'i').test(normalized);
    if (!writeTarget) return false;
    const insertColumns = new RegExp(`\\binsert\\s+into\\s+${escapedTable}\\s*\\(([^)]*)\\)`, 'i').exec(normalized);
    if (!insertColumns) return false;
    const columns = insertColumns[1].split(',').map((column) => column.trim());
    const companyColumnIndex = columns.indexOf('company_id');
    if (companyColumnIndex < 0) return false;
    const values = /values\s*\(([^)]*)\)/i.exec(normalized.slice(insertColumns.index + insertColumns[0].length));
    if (!values) return false;
    const valuePlaceholders = values[1].split(',').map((value) => value.trim());
    const placeholder = valuePlaceholders[companyColumnIndex];
    const match = placeholder?.match(/\$(\d+)/);
    if (!match || String(params[Number(match[1]) - 1] || '') !== String(companyId)) return false;
  }
  return true;
}

function rawChildScopeIsValid(sql, params, companyId, childTables, scopedTables = []) {
  if (childTables.length === 0) return true;
  if (!params.some((value) => String(value || '') === String(companyId))) return false;

  const normalized = String(sql || '').toLowerCase();
  const alreadyScopedParents = new Set(scopedTables);
  for (const childTable of childTables) {
    const rule = RAW_SQL_CHILD_PARENT_RULES.get(childTable);
    if (!rule) return false;
    if (alreadyScopedParents.has(rule.parentTable)) continue;

    const escapedParent = rule.parentTable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!new RegExp(`\\b${escapedParent}\\b`, 'i').test(normalized)) return false;

    const aliases = new Set([rule.parentTable]);
    for (const match of normalized.matchAll(new RegExp(`\\b${escapedParent}\\b\\s+(?:as\\s+)?([a-z_][a-z0-9_]*)`, 'g'))) {
      if (!['on', 'where', 'join', 'left', 'right', 'inner', 'outer', 'set', 'values', 'returning'].includes(match[1])) {
        aliases.add(match[1]);
      }
    }

    const scopedByPredicate = [...normalized.matchAll(/\b(?:([a-z_][a-z0-9_]*)\s*\.\s*)?company_id\s*(?:=|\bin\b)\s*\$(\d+)/gi)]
      .some((match) => {
        const validParam = String(params[Number(match[2]) - 1] || '') === String(companyId);
        return validParam && (!match[1] || aliases.has(match[1]));
      });
    if (scopedByPredicate) continue;

    const parentSubquery = new RegExp(
      `\\$\\d+(?:\\s*::\\s*[a-z_][a-z0-9_]*(?:\\[\\])?)?\\s*=\\s*\\(\\s*select\\s+company_id\\s+from\\s+${escapedParent}\\b`,
      'i',
    );
    if (parentSubquery.test(normalized)) continue;
    return false;
  }
  return true;
}

/**
 * Authorize one renderer-composed statement for a JWT session.
 * Mirrors electron/dbHandler.js assertSqlAuthorized with rawSql semantics
 * (the relay IS the raw-SQL channel for web remotes — same posture).
 * Throws on the first violation with a stable, log-safe message.
 */
function assertRelaySql(session, sql, params, {
  readOnlyTables = [],
  allowFinancialUpdate = false,
} = {}) {
  const normalized = String(sql || '').toLowerCase();
  if (!normalized.trim() || /;|--|\/\*|\*\//.test(normalized)) throw new Error('SQL operation not permitted');
  if (FORBIDDEN_STATEMENT_PATTERN.test(normalized)) {
    throw new Error('SQL operation not permitted');
  }
  const write = /\b(insert|update|delete|merge)\b/.test(normalized);
  const isUpdate = /\bupdate\b/.test(normalized);
  const hasDelete = /\bdelete\s+from\b/.test(normalized);
  const locks = /\bfor\s+update\b/.test(normalized);
  const writeTargets = new Set([...normalized.matchAll(WRITE_TARGET_PATTERN)].map((match) => match[1]));
  const tables = extractTableNames(normalized);
  if (RAW_SQL_FORBIDDEN_COLUMN_PATTERN.test(normalized)) {
    throw new Error('Sensitive columns are not available through the relay SQL channel');
  }
  if ([...writeTargets].some((name) => RAW_SQL_FORBIDDEN_TABLES.has(name))) {
    throw new Error('SQL operation not permitted');
  }
  if ([...writeTargets].some((name) => RAW_SQL_APPEND_ONLY_TABLES.has(name))) {
    const auditInsertOnly = /^\s*insert\s+into\s+audit_logs\b/i.test(normalized)
      && !/\b(?:update|delete\s+from|merge)\b/i.test(normalized)
      && params.some((value) => String(value || '') === String(session.user.id));
    if (!auditInsertOnly) throw new Error('Audit log writes are append-only');
  }
  const tenantTables = [...tables].filter((name) => RAW_SQL_TENANT_TABLES.has(name));
  if (!rawTenantScopeIsValid(sql, params, session.user.companyId, tenantTables)) {
    throw new Error('Cross-company access denied');
  }
  const childWriteTables = [...writeTargets].filter((name) => RAW_SQL_CHILD_TABLES.has(name));
  if (write && !rawChildScopeIsValid(sql, params, session.user.companyId, childWriteTables, tenantTables)) {
    throw new Error('Cross-company access denied');
  }
  if (tables.size === 0) throw new Error('SQL operation not permitted');
  for (const name of tables) {
    if (name.startsWith('pg_') || name.startsWith('information_schema')) throw new Error('SQL operation not permitted');
    const rule = SQL_MODULE_TABLE_RULES.find((r) => r.tables.includes(name));
    if (!rule) throw new Error('SQL operation not permitted');
    const readOnly = !locks && !writeTargets.has(name) && (readOnlyTables.includes(name) || write);
    if (write && !readOnly) {
      if (rule.writeAny && !hasDelete) continue;
      const required = hasDelete
        ? [DELETE_AS_EDIT_TABLES.has(name) ? `${rule.module}.edit` : `${rule.module}.delete`]
        : (rule.writePermissions || moduleWritePermissions(rule.module));
      if (!required.some((p) => hasPermission(session, p))) throw new Error('Permission denied');
    } else if (!rule.readAny) {
      const readers = rule.readPermissions || [`${rule.module}.view`, `${rule.module}.own`];
      if (!readers.some((p) => hasPermission(session, p))) throw new Error('Permission denied');
    }
  }
  if (write && isUpdate && !hasDelete && !allowFinancialUpdate) {
    for (const [name, rule] of FINANCIAL_UPDATE_RULES) {
      if (writeTargets.has(name) && rule.fields.test(normalized) && !hasPermission(session, rule.permission)) {
        throw new Error('Permission denied');
      }
    }
  }
  if (normalized.includes('company_id') && !params.some((value) => String(value || '') === String(session.user.companyId))) {
    throw new Error('Cross-company access denied');
  }
}

// ─── SSRF target classification (pure) ──────────────────────────────────────
// The relay opens TCP to a user-supplied host. DNS is resolved by the caller
// (node:dns) and EVERY returned address is classified here: a single
// non-public address vetoes the target in production. Private targets are
// allowed only when explicitly enabled (local dev: ALLOW_PRIVATE_DB=1).

const IPV4_LOOPBACK = /^127\./;
const IPV4_PRIVATE = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
const IPV4_LINK_LOCAL = /^169\.254\./;
const IPV4_RESERVED = /^(0\.|224\.|240\.)/;

function ipv4ToInt(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return null;
  return ((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3];
}

function isPublicIpLiteral(ip) {
  const clean = String(ip || '').trim().replace(/^\[(.*)\]$/, '$1');
  if (!clean) return false;
  if (clean.includes(':')) {
    // IPv6: loopback (::1), link-local (fe80::/10), unique-local
    // (fc00::/7) and multicast (ff00::/8) are non-public. An IPv4-mapped
    // address (::ffff:a.b.c.d) is judged by its embedded IPv4 part.
    const low = clean.toLowerCase();
    if (low === '::1') return false;
    if (/^ff/i.test(low)) return false;
    if (/^f[cd]/i.test(low)) return false;
    const hex = low.replace(/:/g, '');
    if (/^fe[89ab]/i.test(hex)) return false;
    if (/^::ffff:/i.test(low)) {
      return isPublicIpLiteral(low.slice(7));
    }
    return true;
  }
  if (IPV4_LOOPBACK.test(clean) || IPV4_LINK_LOCAL.test(clean) || IPV4_RESERVED.test(clean)) return false;
  if (IPV4_PRIVATE.test(clean)) return false;
  return ipv4ToInt(clean) !== null;
}

/**
 * Classify a relay target. `addresses` are the DNS-resolved IPs (all of
 * them — DNS rebinding is defeated by checking every answer, not just the
 * first). Returns { ok: true } or { ok: false, reason }.
 */
function classifyRelayTarget(host, addresses, { allowPrivate = false } = {}) {
  const h = String(host || '').trim().toLowerCase();
  if (!h) return { ok: false, reason: 'empty host' };
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.invalid')) {
    return allowPrivate ? { ok: true } : { ok: false, reason: 'local targets are disabled on this relay' };
  }
  const list = Array.isArray(addresses) ? addresses : [];
  if (list.length === 0) return { ok: false, reason: 'unresolvable host' };
  for (const ip of list) {
    if (!isPublicIpLiteral(ip)) {
      if (!allowPrivate) return { ok: false, reason: 'non-public target address' };
    }
  }
  return { ok: true };
}

export {
  FALLBACK_PERMISSIONS,
  hasPermission,
  isOwnOnly,
  canAccessOwnedRow,
  SQL_MODULE_TABLE_RULES,
  extractTableNames,
  moduleWritePermissions,
  rawTenantScopeIsValid,
  rawChildScopeIsValid,
  assertRelaySql,
  isPublicIpLiteral,
  classifyRelayTarget,
  FORBIDDEN_STATEMENT_PATTERN,
  RAW_SQL_FORBIDDEN_COLUMN_PATTERN,
  FINANCIAL_UPDATE_RULES,
  DELETE_AS_EDIT_TABLES,
  normalizeIdempotent,
};
