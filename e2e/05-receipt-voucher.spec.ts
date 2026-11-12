import { test, expect } from './fixtures/auth';
import { loginAs } from './fixtures/auth';

/**
 * The receipt voucher editor is a FULL PAGE (phase 104) — there is no
 * create modal and nothing to close with Escape any more.
 */
test.describe('Receipt Voucher', () => {
  test('create button navigates to the full-page editor', async ({ page }) => {
    await loginAs(page);
    await page.goto('/accounting/receipt-vouchers');
    await expect(page.getByRole('heading', { name: /سندات القبض/i }).first()).toBeVisible({ timeout: 15_000 });

    const createBtn = page.getByRole('button', { name: /سند قبض جديد/i }).first();
    await expect(createBtn).toBeVisible({ timeout: 10_000 });
    await createBtn.click();

    await page.waitForURL(/\/accounting\/receipt-vouchers\/new/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: /سند قبض جديد/i }).first()).toBeVisible({ timeout: 15_000 });
  });

  test('the editor shows the amount field and the save actions', async ({ page }) => {
    await loginAs(page);
    await page.goto('/accounting/receipt-vouchers/new');
    await page.waitForLoadState('networkidle', { timeout: 15_000 });

    await expect(page.getByRole('heading', { name: /سند قبض جديد/i }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('text=/المبلغ|Amount/i').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: /حفظ|ترحيل|save|post/i }).first()).toBeVisible();
  });
});
