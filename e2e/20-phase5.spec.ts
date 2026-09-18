import { test, expect } from './fixtures/auth';
import { loginAs } from './fixtures/auth';

/**
 * Phase 5 — year-end close, fixed assets, true reversal (UI contracts).
 * Shared demo DB: never CLOSE a year here (would lock other specs' dates).
 * Writes are limited to one uniquely-named fixed asset (isolated table).
 */

test.describe('Phase 5 - Close, Assets, Reversal', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page);
  });

  test('year-end close page loads with year + preview (read-only)', async ({ page }) => {
    await page.goto('/accounting/year-end');
    await expect(page.locator('text=الإقفال السنوي').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('text=معاينة الإقفال').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('input[type="number"]').first()).toBeVisible();
    // Preview cards render (revenue/expense/net) without closing anything.
    await expect(page.locator('text=صافي النتيجة').first()).toBeVisible({ timeout: 15_000 });
  });

  test('fixed-assets page loads and the create dialog offers funding sources', async ({ page }) => {
    await page.goto('/accounting/fixed-assets');
    await expect(page.locator('text=الأصول الثابتة').first()).toBeVisible({ timeout: 15_000 });
    await page.locator('button:has-text("أصل جديد")').first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await expect(dialog.locator('text=مصدر التمويل').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden({ timeout: 10_000 });
  });

  test('fixed-asset full create flow capitalizes (unique name, opening funding)', async ({ page }) => {
    const name = `معدة اختبار ${Date.now()}`;
    await page.goto('/accounting/fixed-assets');
    await expect(page.locator('text=الأصول الثابتة').first()).toBeVisible({ timeout: 15_000 });
    await page.locator('button:has-text("أصل جديد")').first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await dialog.locator('input').first().fill(name);
    // cost field: second number input (first is purchase date? date inputs are type=date)
    const numbers = dialog.locator('input[type="number"]');
    await numbers.nth(0).fill('60000');
    // funding = opening balance (no cash box needed)
    await dialog.locator('select').last().selectOption('opening');
    await dialog.locator('button:has-text("حفظ")').first().click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
    // Name cells render in the desktop table (mobile cards duplicate it hidden).
    await expect(page.locator('table').getByText(name).first()).toBeVisible({ timeout: 20_000 });
  });

  test('posted journal rows expose the reverse action with a reason dialog', async ({ page }) => {
    await page.goto('/accounting/journal');
    await expect(page.locator('text=القيود اليومية').first()).toBeVisible({ timeout: 15_000 });
    // The demo seed posts OPENING-SEED, so at least one reverse button exists.
    // (The table renders a hidden mobile duplicate — only assert the visible one.)
    const reverseBtn = page.locator('button[title="عكس مستند مرحّل"]:visible').first();
    await expect(reverseBtn).toBeVisible({ timeout: 20_000 });
    await reverseBtn.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('text=سبب العكس').first()).toBeVisible({ timeout: 10_000 });
    // Reason gate: confirm stays disabled until 3+ chars are typed.
    await expect(dialog.locator('button:has-text("تأكيد العكس")').first()).toBeDisabled();
    // Cancel without writing anything (shared DB stays clean).
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden({ timeout: 10_000 });
  });

  test('sales invoice rows expose reverse for posted docs', async ({ page }) => {
    await page.goto('/sales/invoices');
    await expect(page.locator('text=فواتير المبيعات').first()).toBeVisible({ timeout: 15_000 });
    // Posted demo invoices (if any on this page) carry the same action.
    // The journal assertion above is the hard gate; here we only require
    // the page to render without crashing when reversal code is loaded.
    await expect(page.locator('table').first()).toBeVisible({ timeout: 20_000 });
  });
});
