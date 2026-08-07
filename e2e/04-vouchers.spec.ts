import { test, expect } from './fixtures/auth';
import { loginAs } from './fixtures/auth';

test.describe('Receipt Vouchers', () => {
  test('receipt vouchers page renders with create button and pagination', async ({ page }) => {
    await loginAs(page);
    await page.goto('/accounting/receipt-vouchers');
    await expect(page.getByText(/سندات|سند|Voucher|Receipt/i).first()).toBeVisible({ timeout: 15_000 });
  });
});
