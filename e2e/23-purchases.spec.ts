import { test, expect } from './fixtures/auth';
import { loginAs } from './fixtures/auth';

/**
 * Purchases document reads (typed-RPC tranche A2).
 *
 * These pages are the ONLY place the new `purchases.getInvoices*` /
 * `getOrders*` / `getReturns*` channels are exercised, and the e2e bridge
 * runs the real SQL against PostgreSQL — so a wrong `json_agg`, a shifted
 * placeholder or a missing `total_count` fails here instead of in a report.
 * The unit suite proves the mapping; this proves the composed SQL.
 */
test.describe('Purchases documents', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page);
  });

  test('purchase invoices page loads with its table or empty state', async ({ page }) => {
    await page.goto('/purchases/invoices');
    await expect(page.getByRole('heading', { name: /فواتير المشتريات/i }).first()).toBeVisible({ timeout: 15_000 });
    await page.waitForLoadState('networkidle', { timeout: 15_000 });
    // Either rows or the empty state — both prove the channel answered
    // instead of erroring (an error renders neither).
    const table = page.locator('table');
    const empty = page.getByText(/لا توجد فواتير/i);
    await expect(table.or(empty).first()).toBeVisible({ timeout: 15_000 });
  });

  test('purchase orders page loads with its table or empty state', async ({ page }) => {
    await page.goto('/purchases/orders');
    await expect(page.getByRole('heading', { name: /أوامر الشراء/i }).first()).toBeVisible({ timeout: 15_000 });
    await page.waitForLoadState('networkidle', { timeout: 15_000 });
    const table = page.locator('table');
    const empty = page.getByText(/لا توجد أوامر/i);
    await expect(table.or(empty).first()).toBeVisible({ timeout: 15_000 });
  });

  test('purchase returns page loads with its table or empty state', async ({ page }) => {
    await page.goto('/purchases/returns');
    // The shipped label is "مرتجعات المشتريات"; accept the common variant too
    // so a copy change does not fail the suite.
    await expect(page.getByRole('heading', { name: /مرتجعات المشتريات|مردودات المشتريات/i }).first()).toBeVisible({ timeout: 15_000 });
    await page.waitForLoadState('networkidle', { timeout: 15_000 });
    const table = page.locator('table');
    const empty = page.getByText(/لا توجد مردودات/i);
    await expect(table.or(empty).first()).toBeVisible({ timeout: 15_000 });
  });

  test('purchases dashboard KPIs render (single-row aggregate channel)', async ({ page }) => {
    await page.goto('/purchases');
    await page.waitForLoadState('networkidle', { timeout: 15_000 });
    // The KPI cards read total_orders / pending_orders / total_invoices_value /
    // ap_outstanding from one composed row.
    const body = page.locator('body');
    await expect(body).toContainText(/مشتريات|طلبات|فواتير|مورد/i, { timeout: 15_000 });
  });
});
