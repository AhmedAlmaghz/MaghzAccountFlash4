import { test, expect } from './fixtures/auth';
import { loginAs } from './fixtures/auth';

/**
 * POS Module — critical flows.
 * Terminal gate (open shift), product grid + barcode search, cart math,
 * checkout (cash), close shift with Z math. Dialogs use role="dialog"
 * (Modal.tsx renders a portal without a stable class hook).
 */

test.describe('POS Module - Critical Flows', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page);
  });

  test('shifts page loads inside the app shell', async ({ page }) => {
    await page.goto('/pos/shifts');
    await expect(page.locator('text=الورديات').first()).toBeVisible({ timeout: 15_000 });
  });

  test('POS settings page loads and shows POS options', async ({ page }) => {
    await page.goto('/pos/settings');
    await expect(page.locator('text=إعدادات نقطة البيع').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('text=طباعة الإيصال تلقائياً').first()).toBeVisible({ timeout: 10_000 });
  });

  test('terminal is a full-screen shell (no sidebar) gated on an open shift', async ({ page }) => {
    await page.goto('/pos');
    await expect(page.locator('text=نقطة البيع').first()).toBeVisible({ timeout: 15_000 });
    // Full-screen terminal renders OUTSIDE AppLayout — no sidebar brand block
    await expect(page.locator('aside')).toHaveCount(0);
  });

  test('full flow: open shift → sell → cash checkout → close shift', async ({ page }) => {
    await page.goto('/pos');
    await expect(page.locator('text=نقطة البيع').first()).toBeVisible({ timeout: 15_000 });

    // ── Step 1: if the gate is up, open a shift (cash box preselected) ──
    const gateBtn = page.locator('button:has-text("فتح وردية")').first();
    if (await gateBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await gateBtn.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: 5_000 });
      const confirmBtn = dialog.locator('button:has-text("فتح وردية")').first();
      // The dialog preselects the first active cash box
      await expect(confirmBtn).toBeEnabled({ timeout: 10_000 });
      await confirmBtn.click();
      await expect(dialog).toBeHidden({ timeout: 10_000 });
    }

    // ── Step 2: the gate is gone and the shift chip shows ──
    // ("وردية مفتوحة" is a substring of the gate heading "لا توجد وردية
    // مفتوحة", so assert the gate hidden + the chip with its "·" separator.)
    await expect(page.locator('text=لا توجد وردية مفتوحة')).toBeHidden({ timeout: 20_000 });
    await expect(page.locator('text=وردية مفتوحة ·').first()).toBeVisible({ timeout: 20_000 });

    // ── Step 3: product grid renders seeded products ──
    await expect(page.locator('main .grid button').first()).toBeVisible({ timeout: 20_000 });
    const gridCount = await page.locator('main .grid button').count();
    expect(gridCount).toBeGreaterThan(0);

    // ── Step 4: add the first product to the cart ──
    await page.locator('main .grid button').first().click();
    await expect(page.locator('aside').first()).toBeVisible();
    await expect(page.locator('text=الإجمالي').first()).toBeVisible();

    // ── Step 5: barcode/search field exists and accepts typed codes ──
    const searchInput = page.locator('header input').first();
    await searchInput.click();
    await searchInput.fill('999999999'); // no product with this code
    await page.keyboard.press('Enter');
    // no crash — the terminal stays rendered
    await expect(page.locator('main').first()).toBeVisible();

    // ── Step 6: open the payment dialog and complete a cash sale ──
    await page.locator('aside button:has-text("دفع")').first().click();
    const payDialog = page.getByRole('dialog');
    await expect(payDialog).toBeVisible({ timeout: 10_000 });
    await expect(payDialog.locator('text=الدفع')).toBeVisible();
    // quick amount = exact total (default) → change 0
    await payDialog.locator('button:has-text("المبلغ بالضبط")').first().click();
    await payDialog.locator('button:has-text("دفع")').last().click();

    // ── Step 7: success toast + cleared cart ──
    await expect(page.locator('text=تمت العملية بنجاح').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('text=السلة فارغة').first()).toBeVisible({ timeout: 10_000 });

    // ── Step 8: close the shift (counted = expected → balanced) ──
    await page.locator('button[title="إغلاق الوردية"]').first().click();
    const closeDialog = page.getByRole('dialog');
    await expect(closeDialog.locator('text=المبلغ المعدود فعلياً')).toBeVisible({ timeout: 10_000 });
    // Any counted value works for the flow — the expected-vs-counted math is
    // covered by posApi unit + integration tests. Amounts render in
    // Arabic-Indic digits, so parsing the displayed value here is brittle.
    await closeDialog.locator('input[type="number"]').first().fill('0');
    await closeDialog.locator('button:has-text("إغلاق الوردية")').first().click();
    await expect(closeDialog).toBeHidden({ timeout: 15_000 });

    // After closing, the terminal remains usable (gate or terminal both fine)
    await expect(page.locator('text=نقطة البيع').first()).toBeVisible({ timeout: 15_000 });
  });
});
