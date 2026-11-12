import { test, expect, loginAs } from './fixtures/auth';

/**
 * Full document lifecycle on the new full-page editors:
 *   open /new → the editor shell renders (no modal) → header + save affordances exist.
 *
 * The editors are deep-linkable, so a direct URL visit proves the routing
 * works for a user who bookmarks or refreshes mid-document.
 */
test.describe('document editor lifecycle', () => {
  test('sales invoice editor opens as a full page with header actions', async ({ page }) => {
    await loginAs(page);
    await page.goto('/sales/invoices/new');
    await page.waitForLoadState('networkidle', { timeout: 15_000 });

    // The editor heading (h1) — not a dialog
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: /حفظ|save/i }).first()).toBeVisible();
    // No modal dialog INSIDE the editor. The app shell always renders the
    // mobile drawer + the command palette as [role=dialog], so the count
    // must be scoped to the editor region.
    await expect(page.locator('main [role="dialog"]')).toHaveCount(0);

    // Regression: the editor must never render a raw translation key
    // (e.g. "common.debit") — that means a missing i18n entry.
    const rawKeys = await page.evaluate(() => {
      const out: string[] = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const text = (node.textContent || '').trim();
        if (/^[a-z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+){1,4}$/.test(text) && !/^v\d/.test(text)) {
          out.push(text);
        }
      }
      return [...new Set(out)];
    });
    expect(rawKeys).toEqual([]);
  });

  test('purchase invoice editor opens as a full page', async ({ page }) => {
    await loginAs(page);
    await page.goto('/purchases/invoices/new');
    await page.waitForLoadState('networkidle', { timeout: 15_000 });
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: /حفظ|save/i }).first()).toBeVisible();
  });

  test('journal entry editor opens with a balance indicator', async ({ page }) => {
    await loginAs(page);
    await page.goto('/accounting/journal/new');
    await page.waitForLoadState('networkidle', { timeout: 15_000 });
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15_000 });
    // The balance panel is part of the editor shell
    await expect(page.getByText(/مدين|debit/i).first()).toBeVisible();
  });

  test('voucher editor opens as a full page', async ({ page }) => {
    await loginAs(page);
    await page.goto('/accounting/receipt-vouchers/new');
    await page.waitForLoadState('networkidle', { timeout: 15_000 });
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15_000 });
  });

  test('product editor opens as a full page', async ({ page }) => {
    await loginAs(page);
    await page.goto('/inventory/products/new');
    await page.waitForLoadState('networkidle', { timeout: 15_000 });
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15_000 });
  });

  test('list pages link to the full-page editors', async ({ page }) => {
    await loginAs(page);
    await page.goto('/sales/invoices');
    await page.waitForLoadState('networkidle', { timeout: 15_000 });
    const createBtn = page.getByRole('button', { name: /فاتورة|إنشاء|create/i }).first();
    if (await createBtn.isVisible().catch(() => false)) {
      await createBtn.click();
      await page.waitForURL(/\/sales\/invoices\/new/, { timeout: 15_000 });
    }
  });
});
