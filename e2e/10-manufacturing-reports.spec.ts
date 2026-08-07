import { test, expect } from './fixtures/auth';
import { loginAs } from './fixtures/auth';

test.describe('Manufacturing Reports', () => {
  test('variance analysis report loads', async ({ page }) => {
    await loginAs(page);
    await page.goto('/manufacturing/variance-report');

    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15_000 });
  });

  test('cost report loads with title', async ({ page }) => {
    await loginAs(page);
    await page.goto('/manufacturing/cost-report');

    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15_000 });
  });
});
