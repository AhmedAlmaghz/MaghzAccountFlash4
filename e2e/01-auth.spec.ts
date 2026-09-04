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

  test('header shows brand, home, AI shortcuts and the avatar menu', async ({ page }) => {
    await loginAs(page);

    // AppBrand (name + dynamic version) lives only atop the sidebar — the
    // version badge is the stable marker, independent of the brand wording.
    const header = page.locator('header');
    const sidebar = page.locator('aside');
    await expect(sidebar.getByText(/^v\d+\.\d+\.\d+/).first()).toBeVisible();
    await expect(header.getByText(/^v\d+\.\d+\.\d+/)).toHaveCount(0);

    // Home + AI assistant shortcuts in the header (sidebar has its own AI link)
    await expect(header.getByRole('link', { name: 'الصفحة الرئيسية' })).toHaveAttribute('href', '/');
    await expect(header.getByRole('link', { name: 'المساعد الذكي' })).toHaveAttribute('href', '/ai');

    // Avatar menu: name + sections
    await page.getByRole('button', { name: 'قائمة المستخدم' }).click();
    const menu = page.getByRole('menu');
    await expect(menu.getByText('admin').first()).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'الملف الشخصي' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'تغيير كلمة السر' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'الإعدادات' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'تسجيل الخروج' })).toBeVisible();

    // Change-password modal opens from the menu
    await menu.getByRole('menuitem', { name: 'تغيير كلمة السر' }).click();
    await expect(page.locator('text=تغيير كلمة السر').last()).toBeVisible();
  });
});
