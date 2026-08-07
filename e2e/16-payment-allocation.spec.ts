import { test, expect } from './fixtures/auth';
import { loginAs } from './fixtures/auth';

test.describe('Payment Allocation (Invoice ↔ Voucher)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page);
  });

  test('receipt voucher page loads with create button', async ({ page }) => {
    await page.goto('/accounting/receipt-vouchers');
    await expect(page.getByText(/سندات|سند|Voucher|Receipt/i).first()).toBeVisible({ timeout: 15_000 });
  });

  test('receipt voucher create modal opens', async ({ page }) => {
    await page.goto('/accounting/receipt-vouchers');
    await expect(page.getByText(/سندات|سند|Voucher|Receipt/i).first()).toBeVisible({ timeout: 15_000 });

    const createBtn = page.getByRole('button', { name: /سند قبض جديد|New Receipt/i });
    await expect(createBtn).toBeVisible({ timeout: 10_000 });
    await createBtn.click();

    const modalHeading = page.getByRole('heading', { name: /سند قبض جديد|New Receipt/i, exact: false });
    await expect(modalHeading).toBeVisible({ timeout: 10_000 });

    await page.keyboard.press('Escape');
    await expect(modalHeading).not.toBeVisible({ timeout: 5_000 });
  });

  test('payment voucher create modal opens', async ({ page }) => {
    await page.goto('/accounting/payment-vouchers');
    await expect(page.getByText(/سندات|سند|Voucher|Payment/i).first()).toBeVisible({ timeout: 15_000 });

    const createBtn = page.getByRole('button', { name: /سند صرف جديد|New Payment/i });
    await expect(createBtn).toBeVisible({ timeout: 10_000 });
    await createBtn.click();

    const modalHeading = page.getByRole('heading', { name: /سند صرف جديد|New Payment/i, exact: false });
    await expect(modalHeading).toBeVisible({ timeout: 10_000 });

    await page.keyboard.press('Escape');
    await expect(modalHeading).not.toBeVisible({ timeout: 5_000 });
  });
});
