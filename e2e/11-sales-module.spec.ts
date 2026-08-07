import { test, expect } from './fixtures/auth';
import { loginAs } from './fixtures/auth';

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

  test('invoice create modal contains customer/date/currency fields', async ({ page }) => {
    await page.goto('/sales/invoices');
    await expect(page.locator('text=فواتير المبيعات').first()).toBeVisible({ timeout: 15_000 });
    const createBtn = page.locator('button:has-text("فاتورة جديدة")').first();
    await expect(createBtn).toBeVisible({ timeout: 10_000 });
    await createBtn.click();
    const modalTitle = page.locator('text=فاتورة مبيعات جديدة').first();
    await expect(modalTitle).toBeVisible({ timeout: 10_000 });
    const hasCustomer = await page.locator('text=العميل').count();
    const hasDate = await page.locator('text=التاريخ').count();
    expect(hasCustomer).toBeGreaterThan(0);
    expect(hasDate).toBeGreaterThan(0);
    await page.keyboard.press('Escape');
  });

  test('customers page create modal opens', async ({ page }) => {
    await page.goto('/sales/customers');
    await expect(page.locator('text=العملاء').first()).toBeVisible({ timeout: 15_000 });
    const createBtn = page.locator('button:has-text("عميل جديد")').first();
    await expect(createBtn).toBeVisible({ timeout: 10_000 });
    await createBtn.click();
    const modalTitle = page.locator('h3:has-text("عميل جديد")').first();
    await expect(modalTitle).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('Escape');
  });

  test('quotations create modal opens', async ({ page }) => {
    await page.goto('/sales/quotations');
    await expect(page.locator('text=عروض الأسعار').first()).toBeVisible({ timeout: 15_000 });
    const createBtn = page.locator('button:has-text("عرض جديد")').first();
    await expect(createBtn).toBeVisible({ timeout: 10_000 });
    await createBtn.click();
    const modalTitle = page.locator('h3:has-text("عرض سعر جديد")').first();
    await expect(modalTitle).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('Escape');
  });
});
