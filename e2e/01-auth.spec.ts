import { test, expect } from './fixtures/auth';
import { loginAs, logout } from './fixtures/auth';

test.describe('Authentication', () => {
  test('admin user can log in and reach the dashboard', async ({ page }) => {
    await loginAs(page);

    await expect(page.locator('aside')).toBeVisible();
    await expect(page.locator('aside span').first()).toBeVisible();
    await expect(page.locator('text=لوحة التحكم').first()).toBeVisible();
  });

  test('invalid credentials show an error', async ({ page }) => {
    await page.goto('/login');
    await page.waitForSelector('input[required]');
    const inputs = page.locator('input[required]');
    await inputs.nth(0).fill('admin');
    await inputs.nth(1).fill('wrong-password');
    await page.locator('button[type="submit"]').click();

    await expect(page.locator('text=/بيانات اعتماد|غير صحيحة|invalid|كلمة/i').first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page).toHaveURL(/login/);
  });

  test('logout returns the user to the login page', async ({ page }) => {
    await loginAs(page);
    await logout(page);
    await expect(page).toHaveURL(/login/);
  });
});
