import { test, expect } from './fixtures/auth';
import { loginAs } from './fixtures/auth';

test.describe('Sales Invoices (server-side pagination)', () => {
  test('invoices page loads with table data', async ({ page }) => {
    await loginAs(page);

    await page.goto('/sales/invoices');
    await expect(page.locator('text=فواتير المبيعات').first()).toBeVisible({ timeout: 15_000 });

    const tableRows = page.locator('table tbody tr');
    await expect(tableRows.first()).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => tableRows.count(), { timeout: 20_000 }).toBeGreaterThan(0);
  });

  test('invoices page is accessible from sidebar', async ({ page }) => {
    await loginAs(page);
    const salesLink = page.locator('aside a:has-text("المبيعات")').first();
    await expect(salesLink).toBeVisible({ timeout: 15_000 });
    await salesLink.click();
    const invoicesLink = page.locator('a:has-text("فواتير المبيعات")').first();
    await expect(invoicesLink).toBeVisible({ timeout: 10_000 });
    await invoicesLink.click();
    await expect(page).toHaveURL(/\/sales\/invoices/);
  });
});
