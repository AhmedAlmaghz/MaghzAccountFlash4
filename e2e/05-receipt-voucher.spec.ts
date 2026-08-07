import { test, expect } from './fixtures/auth';
import { loginAs } from './fixtures/auth';

test.describe('Receipt Voucher', () => {
  test('create modal opens and closes', async ({ page }) => {
    await loginAs(page);
    await page.goto('/accounting/receipt-vouchers');
    await expect(page.getByRole('heading', { name: /سندات القبض/i }).first()).toBeVisible({ timeout: 15_000 });

    const createBtn = page.getByRole('button', { name: /سند قبض جديد/i });
    await expect(createBtn).toBeVisible({ timeout: 10_000 });
    await createBtn.click();

    const modalHeading = page.getByRole('heading', { name: /سند قبض جديد/i, exact: false });
    await expect(modalHeading).toBeVisible({ timeout: 10_000 });

    await page.keyboard.press('Escape');
    await expect(modalHeading).not.toBeVisible({ timeout: 5_000 });
  });
});
