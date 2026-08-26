/**
 * resetDatabase.js — full database lifecycle utility
 *
 *   1. Drops and recreates the target database (irreversible)
 *   2. Runs all Drizzle migrations to recreate the schema
 *   3. Seeds a demo company with a full chart of accounts, master data
 *      and transactional documents for all 11 modules
 *
 * Usage:
 *   node electron/resetDatabase.js              # interactive (asks confirmation)
 *   node electron/resetDatabase.js --yes        # skip confirmation
 *   node electron/resetDatabase.js --dry-run    # show what would happen
 *   node electron/resetDatabase.js --admin-password PW   # choose seed admin password
 *
 * Admin password:
 *   - Pass --admin-password PW or set DEMO_ADMIN_PASSWORD env var to choose
 *     the seed admin password.
 *   - If neither is set, a strong random password is generated and printed
 *     once at the end of seeding (never a hardcoded default).
 *
 * Safety:
 *   - Refuses to run against production-looking hostnames unless --force is set
 *   - Always terminates existing connections before drop
 *   - Uses a single client/connection per phase to avoid leaks
 */

import dotenv from 'dotenv';
import { Client } from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';
import { runDrizzleMigrations } from './migrationRunner.js';
import { seedComprehensiveDemoData } from './seedDemoData.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const ARGS = new Set(process.argv.slice(2));
const SKIP_CONFIRM = ARGS.has('--yes') || ARGS.has('-y');
const DRY_RUN = ARGS.has('--dry-run');
const FORCE = ARGS.has('--force');
const SKIP_SEED = ARGS.has('--skip-seed');

// --admin-password PW takes precedence over DEMO_ADMIN_PASSWORD env var.
const pwIdx = process.argv.indexOf('--admin-password');
const ADMIN_PASSWORD = pwIdx >= 0 ? process.argv[pwIdx + 1] : process.env.DEMO_ADMIN_PASSWORD;

const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

function log(level, msg) {
  const color = { info: BLUE, warn: YELLOW, error: RED, success: GREEN }[level] || '';
  console.log(`${color}[${level.toUpperCase()}]${RESET} ${msg}`);
}

function getEnvVar(name, { optional = false } = {}) {
  const v = process.env[name];
  if (!v && !optional) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

function banner(title) {
  const line = '═'.repeat(70);
  console.log(`\n${BOLD}${line}${RESET}`);
  console.log(`${BOLD}  ${title}${RESET}`);
  console.log(`${BOLD}${line}${RESET}\n`);
}

function checkSafety() {
  const host = process.env.DB_HOST || '';
  const dbName = process.env.DB_NAME || '';
  const dangerousHosts = ['prod', 'production', 'live'];
  const dangerousNames = ['prod', 'production', 'live'];

  const isDangerous =
    dangerousHosts.some((h) => host.toLowerCase().includes(h)) ||
    dangerousNames.some((n) => dbName.toLowerCase().includes(n));

  if (isDangerous && !FORCE) {
    log('error', `Refusing to reset database that looks like a production instance:`);
    log('error', `  DB_HOST = ${host}`);
    log('error', `  DB_NAME = ${dbName}`);
    log('error', `Use --force to override.`);
    process.exit(2);
  }
}

async function confirmPrompt() {
  if (SKIP_CONFIRM) return true;
  if (!process.stdin.isTTY) {
    log('warn', 'No TTY available — pass --yes to confirm non-interactively.');
    return false;
  }
  const readline = await import('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${YELLOW}?${RESET} This will DROP and recreate the database. Continue? [y/N] `, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

async function dropAndCreateDatabase() {
  const host = getEnvVar('DB_HOST');
  const port = parseInt(getEnvVar('DB_PORT'), 10);
  const user = getEnvVar('DB_USER');
  const password = getEnvVar('DB_PASSWORD');
  const dbName = getEnvVar('DB_NAME');

  log('info', `Target: ${user}@${host}:${port}/${dbName}`);

  if (DRY_RUN) {
    log('warn', '[DRY-RUN] Would drop and recreate database.');
    return;
  }

  const adminClient = new Client({ host, port, database: 'postgres', user, password });
  await adminClient.connect();
  try {
    log('info', 'Terminating existing connections…');
    await adminClient.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid();`,
      [dbName]
    );

    log('info', `Dropping database "${dbName}" (if exists)…`);
    await adminClient.query(`DROP DATABASE IF EXISTS "${dbName}"`);

    log('info', `Creating database "${dbName}"…`);
    await adminClient.query(`CREATE DATABASE "${dbName}"`);

    log('success', `Database "${dbName}" recreated.`);
  } finally {
    await adminClient.end();
  }
}

async function runMigrations() {
  if (DRY_RUN) {
    log('warn', '[DRY-RUN] Would run Drizzle migrations.');
    return;
  }
  log('info', 'Running Drizzle migrations…');
  await runDrizzleMigrations();
  log('success', 'Migrations applied.');
}

async function seedDatabase() {
  if (SKIP_SEED) {
    log('warn', '[SKIP-SEED] Demo data seeding skipped (--skip-seed).');
    return;
  }
  if (DRY_RUN) {
    log('warn', '[DRY-RUN] Would seed demo data.');
    return;
  }
  const host = getEnvVar('DB_HOST');
  const port = parseInt(getEnvVar('DB_PORT'), 10);
  const user = getEnvVar('DB_USER');
  const password = getEnvVar('DB_PASSWORD');
  const dbName = getEnvVar('DB_NAME');
  const companyName = process.env.DEMO_COMPANY_NAME || 'Demo Company';

  const client = new Client({ host, port, database: dbName, user, password });
  await client.connect();
  log('info', `Connected to "${dbName}" for seeding.`);
  try {
    // Resolve company id
    let sel = await client.query(`SELECT id FROM companies WHERE name = $1 LIMIT 1`, [companyName]);
    let companyId = sel.rows[0]?.id || null;
    if (!companyId) {
      const ins = await client.query(
        `INSERT INTO companies (name, name_en, currency, tax_number, address, phone, email, date_format, decimal_places, calendar, fiscal_year_start)
         VALUES ($1, $2, 'YER', $3, $4, $5, $6, 'yyyy-MM-dd', 2, 'gregorian', $7) RETURNING id;`,
        [companyName, companyName, process.env.DEMO_TAX || '', process.env.DEMO_ADDRESS || '', process.env.DEMO_PHONE || '', process.env.DEMO_EMAIL || 'demo@example.com', `${new Date().toISOString().split('T')[0].slice(0, 4)}-01-01`]
      );
      companyId = ins.rows[0]?.id;
    }
    if (!companyId) throw new Error('Could not resolve demo company id');

    log('info', `Demo company: ${companyName} (${companyId})`);
    log('info', 'Seeding master data and transactions…');
    const t0 = Date.now();
    const result = await seedComprehensiveDemoData(client, companyId, ADMIN_PASSWORD);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
    log('success', `Seeding completed in ${elapsed}s.`);
    if (result?.adminPassword) {
      console.log(`${BOLD}${YELLOW}\n  ⚠  Admin account created — username: ${RESET}admin  ${BOLD}${YELLOW}password: ${RESET}${BOLD}${result.adminPassword}${RESET}\n`);
      console.log(`${YELLOW}  Save this password now. It is shown only once.${RESET}\n`);
    } else if (ADMIN_PASSWORD) {
      log('info', `Admin account: admin / ${ADMIN_PASSWORD} (from --admin-password / DEMO_ADMIN_PASSWORD)`);
    }
    return result;
  } finally {
    await client.end();
  }
}

async function verify() {
  if (DRY_RUN) return;
  const host = getEnvVar('DB_HOST');
  const port = parseInt(getEnvVar('DB_PORT'), 10);
  const user = getEnvVar('DB_USER');
  const password = getEnvVar('DB_PASSWORD');
  const dbName = getEnvVar('DB_NAME');
  const client = new Client({ host, port, database: dbName, user, password });
  await client.connect();
  try {
    log('info', 'Verifying seed data integrity…');
    const counts = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM companies)               AS companies,
        (SELECT COUNT(*) FROM users)                  AS users,
        (SELECT COUNT(*) FROM accounts)                AS accounts,
        (SELECT COUNT(*) FROM customers)               AS customers,
        (SELECT COUNT(*) FROM suppliers)               AS suppliers,
        (SELECT COUNT(*) FROM products)                AS products,
        (SELECT COUNT(*) FROM product_types)           AS product_types,
        (SELECT COUNT(*) FROM product_categories)      AS product_categories,
        (SELECT COUNT(*) FROM warehouses)              AS warehouses,
        (SELECT COUNT(*) FROM stock)                   AS stock_rows,
        (SELECT COUNT(*) FROM sales_invoices)          AS sales_invoices,
        (SELECT COUNT(*) FROM sales_invoice_lines)     AS sales_invoice_lines,
        (SELECT COUNT(*) FROM purchase_invoices)       AS purchase_invoices,
        (SELECT COUNT(*) FROM purchase_orders)         AS purchase_orders,
        (SELECT COUNT(*) FROM quotations)              AS quotations,
        (SELECT COUNT(*) FROM employees)               AS employees,
        (SELECT COUNT(*) FROM payroll_runs)            AS payroll_runs,
        (SELECT COUNT(*) FROM payroll_lines)           AS payroll_lines,
        (SELECT COUNT(*) FROM leads)                   AS leads,
        (SELECT COUNT(*) FROM opportunities)           AS opportunities,
        (SELECT COUNT(*) FROM crm_activities)          AS crm_activities,
        (SELECT COUNT(*) FROM boms)                    AS boms,
        (SELECT COUNT(*) FROM work_orders)             AS work_orders,
        (SELECT COUNT(*) FROM currencies)              AS currencies,
        (SELECT COUNT(*) FROM cost_centers)            AS cost_centers,
        (SELECT COUNT(*) FROM default_accounts)        AS default_accounts,
        (SELECT COUNT(*) FROM document_sequences)      AS document_sequences
    `);
    const c = counts.rows[0];
    console.log('\n  Table                          Count');
    console.log('  ─────────────────────────────────────');
    for (const [k, v] of Object.entries(c)) {
      console.log(`  ${k.padEnd(32)}${String(v).padStart(8)}`);
    }
    console.log('');

    // Integrity checks
    const issues = [];
    if (parseInt(c.accounts) === 0) issues.push('accounts: empty (will break journal entries)');
    if (parseInt(c.customers) === 0) issues.push('customers: empty');
    if (parseInt(c.products) === 0) issues.push('products: empty');
    if (parseInt(c.sales_invoices) > 0 && parseInt(c.sales_invoice_lines) === 0) issues.push('sales_invoices have no lines');
    if (issues.length > 0) {
      log('warn', 'Integrity issues:');
      for (const issue of issues) log('warn', `  • ${issue}`);
    } else {
      log('success', 'All integrity checks passed.');
    }
  } finally {
    await client.end();
  }
}

async function main() {
  banner('Database Reset Utility');
  console.log(`${BOLD}Target:${RESET} ${process.env.DB_USER}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`);
  console.log(`${BOLD}Mode:${RESET}   ${DRY_RUN ? 'DRY-RUN (no changes)' : 'LIVE'}`);
  if (DRY_RUN) {
    log('warn', 'DRY-RUN — no changes will be made.');
  }

  try {
    checkSafety();

    if (!SKIP_CONFIRM) {
      const ok = await confirmPrompt();
      if (!ok) {
        log('warn', 'Aborted by user.');
        process.exit(0);
      }
    }

    const t0 = Date.now();
    banner('Phase 1 / 3 — Recreate database');
    await dropAndCreateDatabase();

    banner('Phase 2 / 3 — Apply migrations');
    await runMigrations();

    banner(`Phase 3 / 3 — ${SKIP_SEED ? 'Skip seed' : 'Seed demo data'}`);
    await seedDatabase();

    banner('Verification');
    await verify();

    const total = ((Date.now() - t0) / 1000).toFixed(2);
    log('success', `Reset completed in ${total}s.`);
    process.exit(0);
  } catch (err) {
    log('error', `Reset failed: ${err.message}`);
    if (process.env.DEBUG) console.error(err);
    process.exit(1);
  }
}

main();
