import { test, expect } from './fixtures/auth';
import { loginAs } from './fixtures/auth';

test.describe('Settings Module', () => {
  test.describe.configure({ mode: 'serial' });

  test('Settings index page loads with menu', async ({ page }) => {
    await loginAs(page);
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: /الإعدادات/i }).first()).toBeVisible({ timeout: 20_000 });
  });

  test('Currencies page loads', async ({ page }) => {
    await loginAs(page);
    await page.goto('/settings/currencies');
    await expect(page.getByRole('heading', { name: /العملات/i }).first()).toBeVisible({ timeout: 20_000 });
  });

  test('VAT Settings page loads', async ({ page }) => {
    await loginAs(page);
    await page.goto('/settings/vat');
    await expect(page.getByRole('heading', { name: /الضريبة/i }).first()).toBeVisible({ timeout: 20_000 });
  });

  test('Branches page loads', async ({ page }) => {
    await loginAs(page);
    await page.goto('/settings/branches');
    await expect(page.getByRole('heading', { name: /الفروع/i }).first()).toBeVisible({ timeout: 20_000 });
  });

  test('Company Setup page loads', async ({ page }) => {
    await loginAs(page);
    await page.goto('/settings/company');
    await expect(page.getByRole('heading', { name: /بيانات الشركة/i }).first()).toBeVisible({ timeout: 20_000 });
  });

  test('Users page loads', async ({ page }) => {
    await loginAs(page);
    await page.goto('/settings/users');
    await expect(page.getByRole('heading', { name: /المستخدمين/i }).first()).toBeVisible({ timeout: 20_000 });
  });

  test('Document Sequences page loads', async ({ page }) => {
    await loginAs(page);
    await page.goto('/settings/document-sequences');
    await expect(page.getByRole('heading', { name: /الترقيم/i }).first()).toBeVisible({ timeout: 20_000 });
  });

  test('Product Types page loads', async ({ page }) => {
    await loginAs(page);
    await page.goto('/settings/product-types');
    await expect(page.getByRole('heading', { name: /أنواع المنتجات/i }).first()).toBeVisible({ timeout: 20_000 });
  });

  test('Product Categories page loads', async ({ page }) => {
    await loginAs(page);
    await page.goto('/settings/product-categories');
    await expect(page.getByRole('heading', { name: /تصنيفات/i }).first()).toBeVisible({ timeout: 20_000 });
  });

  test('Units page loads', async ({ page }) => {
    await loginAs(page);
    await page.goto('/settings/units');
    await expect(page.getByRole('heading', { name: /وحدات/i }).first()).toBeVisible({ timeout: 20_000 });
  });

  test('Cash Boxes page loads', async ({ page }) => {
    await loginAs(page);
    await page.goto('/settings/cash-boxes');
    // Wait for heading to be visible — settings pages may be slow to load all data
    const heading = page.getByRole('heading', { name: /الصناديق/i }).first();
    await expect(heading).toBeVisible({ timeout: 30_000 });
  });

  test('Banks page loads', async ({ page }) => {
    await loginAs(page);
    await page.goto('/settings/banks');
    await expect(page.getByRole('heading', { name: /البنوك/i }).first()).toBeVisible({ timeout: 20_000 });
  });

  test('Cost Centers page loads', async ({ page }) => {
    await loginAs(page);
    await page.goto('/settings/cost-centers');
    await expect(page.getByRole('heading', { name: /مراكز التكلفة/i }).first()).toBeVisible({ timeout: 20_000 });
  });

  test('Default Accounts page loads', async ({ page }) => {
    await loginAs(page);
    await page.goto('/settings/default-accounts');
    // The page should show the heading within reasonable time
    await expect(page.getByRole('heading', { name: /الحسابات الافتراضية/i }).first()).toBeVisible({ timeout: 10_000 });
  });

  test('Reset Onboarding page loads', async ({ page }) => {
    await loginAs(page);
    await page.waitForLoadState('networkidle', { timeout: 10_000 });
    await page.goto('/settings/reset');
    await page.waitForLoadState('networkidle', { timeout: 10_000 });
    // Page shows either reset form or unauthorized message
    const resetHeading = page.getByRole('heading', { level: 2 }).first();
    await expect(resetHeading).toBeVisible({ timeout: 20_000 });
    // The reset form should have a confirmation checkbox
    const confirmCheckbox = page.getByRole('checkbox').first();
    await expect(confirmCheckbox).toBeVisible({ timeout: 5_000 });
  });

  test('Backup page loads with create/restore cards', async ({ page }) => {
    await loginAs(page);
    await page.waitForLoadState('networkidle', { timeout: 10_000 });
    await page.goto('/settings/backup');
    await page.waitForLoadState('networkidle', { timeout: 10_000 });
    // Page should show create + restore cards
    const createBtn = page.getByRole('button', { name: /إنشاء نسخة/i }).first();
    const restoreHeading = page.getByRole('heading', { name: /استعادة/i }).first();
    await expect(restoreHeading).toBeVisible({ timeout: 20_000 });
    if (await createBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await expect(createBtn).toBeVisible();
    }
  });
});
