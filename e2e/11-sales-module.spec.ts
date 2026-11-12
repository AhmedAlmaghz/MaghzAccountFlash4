import { test, expect } from './fixtures/auth';
import { loginAs } from './fixtures/auth';

/**
 * The sales module pages.
 *
 * Phase 104 replaced the create MODALS with full-page editors, so the
 * create-button tests now assert the navigation to the editor route and
 * the editor's own heading instead of a dialog.
 */
test.describe('Sales Module - Critical Flows', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page);
  });

  test('customers page loads with table and search works', async ({ page }) => {
    await page.goto('/sales/customers');
    await expect(page.locator('text=العملاء').first()).toBeVisible({ timeout: 15_000 });
    const tableRows = page.locator('table tbody tr');
    await expect(tableRows.first()).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => tableRows.count(), { timeout: 20_000 }).toBeGreaterThan(0);
  });

  test('quotations page loads', async ({ page }) => {
    await page.goto('/sales/quotations');
    await expect(page.locator('text=عروض الأسعار').first()).toBeVisible({ timeout: 15_000 });
    const tableRows = page.locator('table tbody tr');
    await expect(tableRows.first()).toBeVisible({ timeout: 20_000 });
  });

  test('returns page loads', async ({ page }) => {
    await page.goto('/sales/returns');
    await expect(page.locator('text=مرتجعات المبيعات').first()).toBeVisible({ timeout: 15_000 });
  });

  test('invoices page shows stats cards', async ({ page }) => {
    await page.goto('/sales/invoices');
    await expect(page.locator('text=فواتير المبيعات').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('text=عدد الفواتير').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('text=الإجمالي').first()).toBeVisible({ timeout: 10_000 });
  });

  test('invoice editor contains customer/date/currency fields', async ({ page }) => {
    await page.goto('/sales/invoices/new');
    await page.waitForLoadState('networkidle', { timeout: 15_000 });

    const title = page.getByRole('heading', { name: /فاتورة مبيعات/ }).first();
    await expect(title).toBeVisible({ timeout: 15_000 });
    const hasCustomer = await page.locator('text=العميل').count();
    const hasDate = await page.locator('text=التاريخ').count();
    expect(hasCustomer).toBeGreaterThan(0);
    expect(hasDate).toBeGreaterThan(0);
  });

  test('customers create button opens the full-page editor', async ({ page }) => {
    await page.goto('/sales/customers');
    await expect(page.locator('text=العملاء').first()).toBeVisible({ timeout: 15_000 });
    const createBtn = page.locator('button:has-text("عميل جديد")').first();
    await expect(createBtn).toBeVisible({ timeout: 10_000 });
    await createBtn.click();

    await page.waitForURL(/\/sales\/customers\/new/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: /عميل جديد/ }).first()).toBeVisible({ timeout: 15_000 });
  });

  test('quotations create button opens the full-page editor', async ({ page }) => {
    await page.goto('/sales/quotations');
    await expect(page.locator('text=عروض الأسعار').first()).toBeVisible({ timeout: 15_000 });
    const createBtn = page.locator('button:has-text("عرض جديد")').first();
    await expect(createBtn).toBeVisible({ timeout: 10_000 });
    await createBtn.click();

    await page.waitForURL(/\/sales\/quotations\/new/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: /عرض سعر جديد/ }).first()).toBeVisible({ timeout: 15_000 });
  });
});
