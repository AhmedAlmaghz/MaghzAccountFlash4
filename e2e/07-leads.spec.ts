import { test, expect } from './fixtures/auth';
import { loginAs } from './fixtures/auth';

test.describe('Leads', () => {
  test('leads page loads with table and create button', async ({ page }) => {
    await loginAs(page);
    await page.goto('/crm/leads');
    await expect(page.getByText(/فرص|Leads/i).first()).toBeVisible({ timeout: 15_000 });

    const tableRows = page.locator('table tbody tr');
    await expect.poll(async () => tableRows.count(), { timeout: 20_000 }).toBeGreaterThan(0);
  });
});
