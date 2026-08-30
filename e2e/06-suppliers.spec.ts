import { test, expect } from './fixtures/auth';
import { loginAs } from './fixtures/auth';

test.describe('Supplier', () => {
  test('create supplier and verify in table', async ({ page }) => {
    await loginAs(page);

    // The duplicate guard (Phase 68) blocks re-creating a supplier that
    // already exists — clean up any residue from previous runs first so the
    // test stays repeatable against a shared dev database.
    await page.evaluate(async () => {
      await fetch('/__e2e/db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: 'DELETE FROM suppliers WHERE name = $1', params: ['مورد اختبار e2e'] }),
      });
    });

    await page.goto('/purchases/suppliers');
    await expect(page.getByRole('heading', { name: /الموردين/i }).first()).toBeVisible({ timeout: 15_000 });

    const createBtn = page.getByRole('button', { name: /مورد جديد/i });
    await expect(createBtn).toBeVisible({ timeout: 10_000 });
    await createBtn.click();

    const modalHeading = page.getByRole('heading', { name: /مورد جديد/i, exact: false });
    await expect(modalHeading).toBeVisible({ timeout: 10_000 });

    const modalPanel = page.getByRole('heading', { name: /مورد جديد/i }).locator('..').locator('..').locator('..');
    await modalPanel.getByLabel(/الاسم/i).first().fill('مورد اختبار e2e');
    await modalPanel.getByLabel(/الهاتف/i).first().fill('777000000');

    const saveBtn = page.getByRole('button', { name: /إنشاء/i });
    await expect(saveBtn).toBeEnabled({ timeout: 5_000 });
    await saveBtn.click();

    await expect(modalHeading).not.toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('مورد اختبار e2e').first()).toBeVisible({ timeout: 15_000 });
  });
});
