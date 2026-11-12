import { test, expect, loginAs } from './fixtures/auth';

/**
 * The profit analysis report must show REAL numbers on a freshly seeded
 * company.
 *
 * This guards the seed → report contract: the report reads revenue from
 * sales_invoices.base_currency_amount and COGS from
 * sales_invoice_lines.unit_cost, and both columns are written by the
 * seeder. A seeder that omits them makes the flagship report read
 * "no data" on every fresh install.
 */
test.describe('Profit Analysis Report', () => {
  test('shows revenue instead of the empty state', async ({ page }) => {
    await loginAs(page);
    await page.goto('/reports/profit-analysis');
    await page.waitForLoadState('networkidle', { timeout: 15_000 });

    // The seeded invoices must not be reported as "no data".
    await expect(page.locator('text=لا توجد بيانات للفترة المحددة')).toHaveCount(0, { timeout: 15_000 });

    // The page title renders (the empty state omits it).
    await expect(page.getByRole('heading', { name: /تحليل الربحية/ }).first()).toBeVisible({ timeout: 15_000 });

    // A revenue figure is on screen. The UI renders Arabic-Indic digits, so
    // accept both digit ranges.
    const bodyText = await page.locator('main').innerText();
    expect(bodyText).toMatch(/[٠-٩0-9][٠-٩0-9٬,.٫]*\s*ر\.ي/);
  });
});
