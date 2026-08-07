import { test, expect } from './fixtures/auth';
import { loginAs } from './fixtures/auth';

test.describe('Dashboard and CRM Reports', () => {
  test('dashboard loads with CRM KPI section', async ({ page }) => {
    await loginAs(page);
    await page.goto('/');

    await expect(page.locator('h1:has-text("لوحة التحكم")')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('h2:has-text("العملاء")')).toBeVisible({ timeout: 15_000 });
  });

  test('lead conversion report loads with charts', async ({ page }) => {
    await loginAs(page);
    await page.goto('/reports/lead-conversion');

    await expect(page.locator('h1:has-text("تحليل تحويل العملاء المحتملين")')).toBeVisible({ timeout: 15_000 });
  });

  test('opportunity pipeline report loads', async ({ page }) => {
    await loginAs(page);
    await page.goto('/reports/opportunity-pipeline');

    await expect(page.locator('h1:has-text("خط أنابيب الفرص")')).toBeVisible({ timeout: 15_000 });
  });
});
