import { test as base, expect, type Page } from '@playwright/test';

export const ADMIN_USER = { username: 'admin', password: 'admin1234' };

const ONBOARDING_STORAGE = {
  state: {
    completed: true,
    currentStep: 4,
    companyConfig: {
      name: 'شركة المغزى للتجارة والصناعة',
      nameEn: 'Maghz Trading & Industry Co.',
      currency: 'YER',
      taxNumber: '3100123456',
      address: 'صنعاء - شارع الستين - عمارة التجارة الدولية',
      phone: '+96714444888',
      email: 'info@maghzaccount.com',
    },
    seedOption: 'demo',
    isProcessing: false,
    processingMessage: '',
    error: null,
  },
  version: 0,
};

export function addOnboardingBypass(context: { addInitScript: (fn: () => void) => Promise<void> }) {
  return context.addInitScript((payload) => {
    try {
      window.localStorage.setItem('maghzaccount-onboarding', JSON.stringify(payload));
    } catch {
      // ignore
    }
  }, ONBOARDING_STORAGE);
}

export async function loginAs(page: Page, credentials = ADMIN_USER): Promise<void> {
  await page.goto('/login');
  await page.waitForSelector('input[required]', { timeout: 20_000 });
  const inputs = page.locator('input[required]');
  await inputs.nth(0).fill(credentials.username);
  await inputs.nth(1).fill(credentials.password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 20_000 });
  await expect(page.locator('text=لوحة التحكم').first()).toBeVisible({ timeout: 15_000 });
}

export async function logout(page: Page): Promise<void> {
  // Logout lives inside the avatar dropdown since the header redesign.
  const menuBtn = page.getByRole('button', { name: 'قائمة المستخدم' });
  await menuBtn.waitFor({ state: 'visible', timeout: 5_000 });
  await menuBtn.click();
  const logoutItem = page.getByRole('menuitem', { name: 'تسجيل الخروج' });
  await logoutItem.waitFor({ state: 'visible', timeout: 5_000 });
  await logoutItem.click();
  await page.waitForURL(/login/);
}

export const test = base.extend({
  context: async ({ context }, fixture) => {
    await addOnboardingBypass(context);
    await fixture(context);
  },
});

export { expect };
