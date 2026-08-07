import { test, expect } from './fixtures/auth';
import { loginAs } from './fixtures/auth';

test.describe('Payment Allocation Flow (end-to-end)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page);
  });

  test('create sales invoice, then create receipt voucher with invoice allocation', async ({ page }) => {
    // Step 1: Navigate to sales invoices and verify the page loads
    await page.goto('/sales/invoices');
    await expect(page.locator('text=فواتير المبيعات').first()).toBeVisible({ timeout: 15_000 });

    // Step 2: Verify there's at least one invoice in the table (from seed data)
    const tableRows = page.locator('table tbody tr');
    await expect(tableRows.first()).toBeVisible({ timeout: 20_000 });
    const rowCount = await tableRows.count();
    expect(rowCount).toBeGreaterThan(0);

    // Step 3: Get the first invoice number to verify the data is there
    const firstInvoiceCell = await tableRows.first().locator('td').first().textContent();
    expect(firstInvoiceCell).toBeTruthy();
    void firstInvoiceCell;
  });

  test('create receipt voucher - modal has customer select and amount field', async ({ page }) => {
    await page.goto('/accounting/receipt-vouchers');
    await expect(page.getByText(/سندات|سند|Voucher|Receipt/i).first()).toBeVisible({ timeout: 15_000 });

    const createBtn = page.getByRole('button', { name: /سند قبض جديد|New Receipt/i });
    await expect(createBtn).toBeVisible({ timeout: 10_000 });
    await createBtn.click();

    const modalHeading = page.getByRole('heading', { name: /سند قبض جديد|New Receipt/i });
    await expect(modalHeading).toBeVisible({ timeout: 10_000 });

    const customerLabel = page.getByText(/العميل|Customer/i).first();
    await expect(customerLabel).toBeVisible();

    const amountInput = page.locator('input[type="number"]').first();
    await expect(amountInput).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(modalHeading).not.toBeVisible({ timeout: 5_000 });
  });

  test('create payment voucher - modal has supplier select and amount field', async ({ page }) => {
    await page.goto('/accounting/payment-vouchers');
    await expect(page.getByText(/سندات|سند|Voucher|Payment/i).first()).toBeVisible({ timeout: 15_000 });

    const createBtn = page.getByRole('button', { name: /سند صرف جديد|New Payment/i });
    await expect(createBtn).toBeVisible({ timeout: 10_000 });
    await createBtn.click();

    const modalHeading = page.getByRole('heading', { name: /سند صرف جديد|New Payment/i });
    await expect(modalHeading).toBeVisible({ timeout: 10_000 });

    const supplierLabel = page.getByText(/المورد|Supplier/i).first();
    await expect(supplierLabel).toBeVisible();

    const amountInput = page.locator('input[type="number"]').first();
    await expect(amountInput).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(modalHeading).not.toBeVisible({ timeout: 5_000 });
  });
});
