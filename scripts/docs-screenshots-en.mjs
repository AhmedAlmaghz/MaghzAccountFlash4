// English user-guide screenshots — Docs2/en/assets
// Run: node scripts/docs-screenshots-en.mjs [group]
// Requirements: dev server on 5173. Uses a persistent Chromium profile so the
// in-browser PGlite database (seeded once via the onboarding wizard) survives
// between runs. First run performs the wizard + demo seeding (~3-5 min).
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const BASE_URL = process.env.DOCS_BASE_URL || 'http://localhost:5173';
const OUT = path.resolve('Docs2/en/assets');
const PROFILE = process.env.DOCS_PROFILE || path.join(os.tmpdir(), 'maghz-docs-en-profile');

// [route, output file, ready marker in body text (optional)]
const SHOTS = {
  gettingStarted: [
    ['/login', 'getting-started/login.png', 'Login'],
  ],
  interface: [
    ['/', 'interface/sidebar.png', 'Dashboard'],
    ['/', 'interface/header.png', 'Dashboard'],
  ],
  accounting: [
    ['/accounting/chart', 'accounting/chart-of-accounts.png', 'Chart of Accounts'],
    ['/accounting/journal', 'accounting/journal-entries.png', 'Journal'],
    ['/accounting/trial', 'accounting/trial-balance.png', 'Trial Balance'],
    ['/accounting/balance', 'accounting/balance-sheet.png', 'Balance Sheet'],
    ['/accounting/profit', 'accounting/income-statement.png', 'Income Statement'],
    ['/accounting/cashflow', 'accounting/cash-flow.png', 'Cash Flow'],
    ['/accounting/receipt-vouchers', 'accounting/receipt-vouchers.png', 'Receipt Voucher'],
    ['/accounting/payment-vouchers', 'accounting/payment-vouchers.png', 'Payment Voucher'],
    ['/accounting/ledger', 'accounting/ledger.png', 'Ledger'],
  ],
  inventory: [
    ['/inventory/products', 'inventory/products.png', 'Products'],
    ['/inventory/warehouses', 'inventory/warehouses.png', 'Warehouses'],
    ['/inventory/stock', 'inventory/stock.png', 'Stock'],
    ['/inventory/adjustments', 'inventory/adjustments.png', 'Adjustment'],
  ],
  sales: [
    ['/sales', 'sales/hub.png', 'Sales'],
    ['/sales/customers', 'sales/customers.png', 'Customer'],
    ['/sales/invoices', 'sales/invoices.png', 'Invoice'],
    ['/sales/quotations', 'sales/quotations.png', 'Quotation'],
    ['/sales/returns', 'sales/returns.png', 'Return'],
  ],
  purchases: [
    ['/purchases', 'purchases/hub.png', 'Purchases'],
    ['/purchases/suppliers', 'purchases/suppliers.png', 'Supplier'],
    ['/purchases/invoices', 'purchases/invoices.png', 'Invoice'],
    ['/purchases/orders', 'purchases/orders.png', 'Purchase Order'],
    ['/purchases/returns', 'purchases/returns.png', 'Return'],
  ],
  manufacturing: [
    ['/manufacturing', 'manufacturing/hub.png', 'Manufacturing'],
    ['/manufacturing/bom', 'manufacturing/bom.png', 'Materials'],
    ['/manufacturing/work-orders', 'manufacturing/work-orders.png', 'Work Order'],
    ['/manufacturing/cost-report', 'manufacturing/cost-report.png', 'Cost'],
    ['/manufacturing/variance-report', 'manufacturing/variance-report.png', 'Variance'],
  ],
  hr: [
    ['/hr', 'hr/hub.png', 'Human'],
    ['/hr/employees', 'hr/employees.png', 'Employee'],
    ['/hr/attendance', 'hr/attendance.png', 'Attendance'],
    ['/hr/payroll', 'hr/payroll.png', 'Payroll'],
    ['/hr/end-of-service', 'hr/end-of-service.png', 'End of Service'],
  ],
  crm: [
    ['/crm', 'crm/hub.png', 'CRM'],
    ['/crm/leads', 'crm/leads.png', 'Lead'],
    ['/crm/opportunities', 'crm/opportunities.png', 'Opportunit'],
    ['/crm/tasks', 'crm/tasks.png', 'Task'],
    ['/crm/activities', 'crm/activities.png', 'Activit'],
  ],
  reports: [
    ['/', 'reports/dashboard.png', 'Monthly Sales'],
    ['/reports', 'reports/reports-hub.png', 'Reports'],
    ['/reports/sales-analysis', 'reports/sales-analysis.png', 'Sales Analysis'],
    ['/reports/customer-statement', 'reports/customer-statement.png', 'Statement'],
    ['/reports/profit-analysis', 'reports/profit-analysis.png', 'Profit'],
    ['/reports/custom-builder', 'reports/custom-builder.png', 'Builder'],
  ],
  ai: [
    ['/ai', 'ai/ai-chat.png', 'Maghz'],
    ['/settings/ai', 'ai/ai-settings.png', 'AI'],
  ],
  pos: [
    ['/pos/shifts', 'pos/shifts.png', 'Shift'],
    ['/pos/reports', 'pos/reports.png', 'Report'],
    ['/pos/settings', 'pos/settings.png', 'Settings'],
    ['/pos', 'pos/terminal.png', null],
  ],
  settings: [
    ['/settings/company', 'settings/company.png', 'Company'],
    ['/settings/themes', 'settings/themes.png', 'Theme'],
    ['/settings/currencies', 'settings/currencies.png', 'Currenc'],
    ['/settings/vat', 'settings/vat.png', 'VAT'],
    ['/settings/hr-policies', 'settings/hr-policies.png', 'HR'],
    ['/settings/payroll-components', 'settings/payroll-components.png', 'Payroll'],
    ['/settings/branches', 'settings/branches.png', 'Branch'],
    ['/settings/backup', 'settings/backup.png', 'Backup'],
    ['/settings/document-sequences', 'settings/document-sequences.png', 'Sequence'],
    ['/settings/product-types', 'settings/product-types.png', 'Type'],
    ['/settings/product-categories', 'settings/product-categories.png', 'Categor'],
    ['/settings/default-accounts', 'settings/default-accounts.png', 'Default'],
    ['/settings/units', 'settings/units.png', 'Unit'],
    ['/settings/cash-boxes', 'settings/cash-boxes.png', 'Cash Box'],
    ['/settings/cost-centers', 'settings/cost-centers.png', 'Cost Center'],
    ['/settings/database', 'settings/database.png', 'Database'],
  ],
  usersRoles: [
    ['/users', 'users-roles/users-list.png', 'User'],
    ['/roles', 'users-roles/roles-list.png', 'Role'],
    ['/audit-logs', 'users-roles/audit-log.png', 'Audit'],
  ],
};

async function waitContent(page, marker, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const [text, skeletons] = await page.evaluate(() => [
      document.body.innerText,
      document.querySelectorAll('[class*="animate-pulse"]').length,
    ]).catch(() => ['', 1]);
    const markerOk = marker ? text.includes(marker) : true;
    if (markerOk && skeletons === 0) return true;
    await page.waitForTimeout(500);
  }
  return false;
}

async function capture(page, file) {
  await mkdir(path.dirname(path.join(OUT, file)), { recursive: true });
  await page.waitForTimeout(4500); // settle animations & data fetches
  await page.screenshot({ path: path.join(OUT, file) });
  console.log('✓ ' + file);
}

// ── One-time setup: onboarding wizard + demo seeding ──
async function ensureSetup(page) {
  await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);
  const onboarding = await page.evaluate(() => localStorage.getItem('maghzaccount-onboarding'));
  if (onboarding && JSON.parse(onboarding).state?.completed) {
    console.log('✓ onboarding already completed');
    return false; // not freshly seeded
  }

  console.log('… running onboarding wizard (first run only)');
  await page.getByRole('button', { name: 'Start Setup' }).click();
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Next' }).click(); // PGlite pre-selected
  await page.waitForTimeout(800);

  // Company step — English identity
  await page.getByRole('textbox', { name: /Company Name/ }).fill('Maghz Trading & Industry Co.');
  await page.getByRole('textbox', { name: 'Address' }).fill("Sana'a - Sixty Street, International Trade Tower");
  await page.getByRole('button', { name: 'Next' }).click();
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: /Demo Data All of the above/ }).click();
  await page.locator('#seed-admin-password').fill('admin1234');
  await page.getByRole('button', { name: 'Seed Data & Continue' }).click();
  console.log('… seeding demo data (this can take several minutes)');
  await page.getByText('Ready to Go', { exact: false }).waitFor({ timeout: 600000 });
  console.log('✓ seeded');

  // capture the five wizard steps backwards? They are gone now — wizard steps
  // are captured in a dedicated first-run pass instead (see wizardShots below).
  await page.getByRole('button', { name: 'Enter the System' }).click();
  await page.waitForTimeout(6000);
  return true; // freshly seeded
}

async function loginIfNeeded(page) {
  if (page.url().includes('/login') || (await page.locator('text=Login').count()) > 0) {
    await page.goto(BASE_URL + '/login', { waitUntil: 'domcontentloaded' });
    await page.getByRole('textbox', { name: /Username/ }).fill('admin');
    await page.getByRole('textbox', { name: /Password/ }).fill('admin1234');
    await page.getByRole('button', { name: 'Login' }).click();
    await page.waitForURL(u => !u.pathname.includes('login'), { timeout: 60000 });
    console.log('✓ logged in');
  }
}

// Wizard step captures — reset onboarding flag only (keep DB), run through the
// wizard UI capturing each step, then re-complete it without re-seeding.
async function wizardShots(page) {
  const steps = [
    [null, 'getting-started/onboarding-01-welcome.png'],
    ['Start Setup', 'getting-started/onboarding-02-database.png'],
    ['Next', 'getting-started/onboarding-03-company.png'],
    [null, 'getting-started/onboarding-04-seed.png'],
    [null, 'getting-started/onboarding-05-complete.png'],
  ];
  await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  await page.evaluate(() => localStorage.removeItem('maghzaccount-onboarding'));
  await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  // step 1: welcome
  await capture(page, steps[0][1]);
  await page.getByRole('button', { name: 'Start Setup' }).click();
  await page.waitForTimeout(800);
  await capture(page, steps[1][1]); // database (PGlite pre-selected)
  await page.getByRole('button', { name: 'Next' }).click();
  await page.waitForTimeout(800);
  // keep the company identity English so all later header shots match
  await page.getByRole('textbox', { name: /Company Name/ }).fill('Maghz Trading & Industry Co.');
  await page.getByRole('textbox', { name: 'Address' }).fill("Sana'a - Sixty Street, International Trade Tower");
  await capture(page, steps[2][1]); // company (English identity)
  await page.getByRole('button', { name: 'Next' }).click();
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: /No Data Start with an empty company/ }).click();
  await page.locator('#seed-admin-password').fill('admin1234');
  await page.waitForTimeout(400);
  await capture(page, steps[3][1]); // seed
  await page.getByRole('button', { name: 'Skip' }).click();
  await page.getByText('Ready to Go', { exact: false }).waitFor({ timeout: 600000 });
  await page.waitForTimeout(1500);
  await capture(page, steps[4][1]); // complete
  await page.getByRole('button', { name: 'Enter the System' }).click();
  await page.waitForTimeout(6000);
  console.log('✓ wizard shots done');
}

async function main() {
  const groups = process.argv[2] ? process.argv[2].split(',') : Object.keys(SHOTS);
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    locale: 'en-US',
  });
  await ctx.addInitScript(() => {
    const app = JSON.parse(localStorage.getItem('maghzaccount-app') || '{"state":{},"version":0}');
    app.state.language = 'en';
    app.state.theme = 'light';
    localStorage.setItem('maghzaccount-app', JSON.stringify(app));
    localStorage.setItem('maghzaccount-db-mode', process.env.DOCS_DB_MODE || 'pglite');
  });
  const page = await ctx.newPage();

  if (process.argv[2] === 'wizard') {
    await wizardShots(page);
    await ctx.close();
    return;
  }

  const freshlySeeded = await ensureSetup(page);
  if (freshlySeeded) {
    // capture the login page right after wizard finish
    await capture(page, 'getting-started/login.png');
  }
  await loginIfNeeded(page);

  // interface: user-menu needs the menu open
  // gettingStarted: capture the login page while logged out
  for (const g of groups) {
    if (g === 'gettingStarted') {
      await page.evaluate(() => localStorage.removeItem('auth_user'));
      await page.goto(BASE_URL + '/login', { waitUntil: 'domcontentloaded' });
      await waitContent(page, 'Login');
      await capture(page, 'getting-started/login.png');
      await loginIfNeeded(page);
      continue;
    }
    for (const [route, file, marker] of SHOTS[g] || []) {
      await page.goto(BASE_URL + route, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      const ok = await waitContent(page, marker);
      await capture(page, file);
      console.log((ok ? ' ' : '?') + ' marker ' + (ok ? 'ok' : 'MISS') + ' for ' + file);
    }
  }

  // special: journal entry editor (open New Journal Entry modal)
  await page.goto(BASE_URL + '/accounting/journal', { waitUntil: 'domcontentloaded' });
  if (await waitContent(page, 'Journal')) {
    const btn = page.getByRole('button', { name: /New Journal Entry|New Entry/ }).first();
    if ((await btn.count()) > 0) {
      await btn.click();
      await page.waitForTimeout(2500);
      await capture(page, 'accounting/journal-entry-editor.png');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(800);
    }
  }

  // special: user modal
  await page.goto(BASE_URL + '/users', { waitUntil: 'domcontentloaded' });
  if (await waitContent(page, 'User')) {
    const btn = page.getByRole('button', { name: 'New User' }).first();
    if ((await btn.count()) > 0) {
      await btn.click();
      await page.waitForTimeout(2000);
      await capture(page, 'users-roles/user-modal.png');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(800);
    }
  }

  // special: user menu open
  await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' });
  if (await waitContent(page, 'Dashboard')) {
    const avatar = page.locator('header button').last();
    await avatar.click().catch(() => {});
    await page.waitForTimeout(1500);
    await capture(page, 'interface/user-menu.png');
    await page.keyboard.press('Escape');
  }

  // POS terminal — open a shift first if none is open
  await page.goto(BASE_URL + '/pos', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  const body = await page.evaluate(() => document.body.innerText);
  if (body.includes('No open shift')) {
    await page.getByRole('button', { name: 'Open Shift' }).first().click();
    await page.waitForTimeout(1200);
    const amount = page.locator('input[type="number"]').first();
    if ((await amount.count()) > 0) await amount.fill('50000');
    // cash box select: pick first available option if needed
    const modalBtn = page.getByRole('button', { name: 'Open Shift' }).last();
    await modalBtn.click();
    await page.waitForTimeout(3000);
  }
  await capture(page, 'pos/terminal.png');

  await ctx.close();
  console.log('DONE');
}

main().catch(e => { console.error(e); process.exit(1); });
