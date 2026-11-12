import { test, expect } from './fixtures/auth';
import { loginAs } from './fixtures/auth';

/**
 * Multi-currency on the sales invoice editor.
 *
 * The editor is a FULL PAGE now (phase 104) — the create modal is gone, so
 * this spec drives the real route instead of a dialog.
 */
test.describe('Multi-Currency Form', () => {
  test('invoice editor opens with currency field', async ({ page }) => {
    await loginAs(page);
    await page.goto('/sales/invoices/new');
    await page.waitForLoadState('networkidle', { timeout: 15_000 });

    // The editor heading — a page, not a dialog.
    // NOTE: the app shell also renders an <h1> (the brand), so the editor
    // heading must be awaited EXPLICITLY before touching the fields —
    // otherwise the assertions below run against a half-rendered page.
    await expect(page.getByRole('heading', { name: /فاتورة مبيعات/ }).first()).toBeVisible({ timeout: 30_000 });

    // The exchange-rate field is labelled.
    await expect(page.getByText(/سعر الصرف/).first()).toBeVisible({ timeout: 30_000 });

    // The currency picker shows the SELECTED currency (its name/code), not
    // the word "العملة" — the placeholder is replaced once the list loads.
    await expect(page.getByText(/YER|الريال/).first()).toBeVisible({ timeout: 30_000 });

    // The totals panel is on the page (it shows the base equivalent only
    // when the document currency differs from the company base currency).
    await expect(page.getByText(/الإجمالي/).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/المجموع الفرعي/).first()).toBeVisible({ timeout: 30_000 });
  });

  test('the list page links to the editor route', async ({ page }) => {
    await loginAs(page);
    await page.goto('/sales/invoices');
    await page.waitForLoadState('networkidle', { timeout: 15_000 });

    const createBtn = page.locator('button:has-text("فاتورة جديدة")').first();
    await expect(createBtn).toBeVisible({ timeout: 10_000 });
    await createBtn.click();
    await page.waitForURL(/\/sales\/invoices\/new/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: /فاتورة مبيعات/ }).first()).toBeVisible();
  });
});
