import { test, expect } from './fixtures/auth';
import { loginAs } from './fixtures/auth';

/**
 * The supplier editor is a FULL PAGE (phase 104) — there is no create
 * modal and nothing to close any more.
 */
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

    const createBtn = page.getByRole('button', { name: /مورد جديد/i }).first();
    await expect(createBtn).toBeVisible({ timeout: 10_000 });
    await createBtn.click();

    // The editor is a page at /purchases/suppliers/new.
    await page.waitForURL(/\/purchases\/suppliers\/new/, { timeout: 15_000 });
    const editorHeading = page.getByRole('heading', { name: /مورد جديد/i }).first();
    await expect(editorHeading).toBeVisible({ timeout: 15_000 });

    await page.getByLabel(/^الاسم/).first().fill('مورد اختبار e2e');
    await page.getByLabel(/^الهاتف/).first().fill('777000000');

    const saveBtn = page.getByRole('button', { name: /إنشاء|حفظ/ }).first();
    await expect(saveBtn).toBeEnabled({ timeout: 10_000 });
    await saveBtn.click();

    // Back on the list, the new supplier is in the table.
    await page.waitForURL(/\/purchases\/suppliers$/, { timeout: 15_000 });
    // Scope to the visible desktop table — mobile cards render first in DOM
    await expect(page.locator('table').getByText('مورد اختبار e2e').first()).toBeVisible({ timeout: 15_000 });
  });
});
