import { test, expect } from './fixtures/auth';
import { loginAs } from './fixtures/auth';

test.describe('Multi-Currency Form', () => {
  test('invoice create form opens with currency field', async ({ page }) => {
    await loginAs(page);
    await page.goto('/sales/invoices');
    await expect(page.locator('text=فواتير المبيعات').first()).toBeVisible({ timeout: 15_000 });

    const createBtn = page.locator('button:has-text("فاتورة جديدة")').first();
    await expect(createBtn).toBeVisible({ timeout: 10_000 });
    await createBtn.click();

    const modalTitle = page.locator('text=فاتورة مبيعات جديدة').first();
    await expect(modalTitle).toBeVisible({ timeout: 10_000 });

    const hasCurrency = await page.locator('text=/العملة|سعر الصرف|Exchange|Currency/i').count();
    expect(hasCurrency).toBeGreaterThan(0);

    const hasBaseEquivalent = await page.locator('text=/المعادل بالأساسية|Base Equivalent/i').count();
    expect(hasBaseEquivalent).toBeGreaterThan(0);
  });
});
