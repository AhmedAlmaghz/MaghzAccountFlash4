import { test, expect } from './fixtures/auth';
import { loginAs } from './fixtures/auth';

test.describe('Manufacturing', () => {
  test('manufacturing page loads with tabs', async ({ page }) => {
    await loginAs(page);
    await page.goto('/manufacturing');

    await expect(page.locator('text=التصنيع').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('text=أوامر التشغيل').first()).toBeVisible();
    await expect(page.locator('text=فاتير المواد').first()).toBeVisible();
    await expect(page.locator('text=تحليل التكاليف').first()).toBeVisible();
  });

  test('work orders page loads with table', async ({ page }) => {
    await loginAs(page);
    await page.goto('/manufacturing/work-orders');

    await expect(page.locator('h1:has-text("أوامر التشغيل")')).toBeVisible({ timeout: 10_000 });
    await expect.poll(async () => {
      const rows = page.locator('table tbody tr');
      return rows.count();
    }, { timeout: 20_000 }).toBeGreaterThan(0);
  });

  test('production cost report loads', async ({ page }) => {
    await loginAs(page);
    await page.goto('/manufacturing/cost-report');

    await expect(page.locator('h1:has-text("تحليل تكاليف الإنتاج")')).toBeVisible({ timeout: 10_000 });
  });

  test('sidebar shows manufacturing submenu after expanding', async ({ page }) => {
    await loginAs(page);

    await page.locator('nav >> text=التصنيع').first().click();
    await expect(page.locator('text=أوامر التشغيل').first()).toBeVisible();
    await expect(page.locator('text=فاتير المواد').first()).toBeVisible();
  });
});
