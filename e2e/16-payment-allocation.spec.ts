import { test, expect } from './fixtures/auth';
import { loginAs } from './fixtures/auth';

/**
 * Payment allocation (invoice ↔ voucher).
 *
 * The voucher editors are FULL PAGES (phase 104) — there is no create
 * modal and no Escape-to-close any more.
 */
test.describe('Payment Allocation (Invoice ↔ Voucher)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page);
  });

  test('receipt voucher page loads with create button', async ({ page }) => {
    await page.goto('/accounting/receipt-vouchers');
    await expect(page.getByText(/سندات|سند|Voucher|Receipt/i).first()).toBeVisible({ timeout: 15_000 });
  });

  test('receipt voucher create button opens the full-page editor', async ({ page }) => {
    await page.goto('/accounting/receipt-vouchers');
    await expect(page.getByText(/سندات|سند|Voucher|Receipt/i).first()).toBeVisible({ timeout: 15_000 });

    // two buttons share the label (header CTA + empty-state CTA) — use the first
    const createBtn = page.getByRole('button', { name: /سند قبض جديد|New Receipt/i }).first();
    await expect(createBtn).toBeVisible({ timeout: 10_000 });
    await createBtn.click();

    await page.waitForURL(/\/accounting\/receipt-vouchers\/new/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: /سند قبض جديد|New Receipt/i }).first()).toBeVisible({ timeout: 15_000 });
  });

  test('payment voucher create button opens the full-page editor', async ({ page }) => {
    await page.goto('/accounting/payment-vouchers');
    await expect(page.getByText(/سندات|سند|Voucher|Payment/i).first()).toBeVisible({ timeout: 15_000 });

    // two buttons share the label (header CTA + empty-state CTA) — use the first
    const createBtn = page.getByRole('button', { name: /سند صرف جديد|New Payment/i }).first();
    await expect(createBtn).toBeVisible({ timeout: 10_000 });
    await createBtn.click();

    await page.waitForURL(/\/accounting\/payment-vouchers\/new/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: /سند صرف جديد|New Payment/i }).first()).toBeVisible({ timeout: 15_000 });
  });
});
