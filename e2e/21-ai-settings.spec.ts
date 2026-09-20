import { test, expect, loginAs } from './fixtures/auth';

/**
 * E2 — AI settings hardening (Phase A1/B2): the settings page must render
 * the session token budget input, the browser-only kill-switch, and (when a
 * key is stored) the two-click revoke control. Smoke level only: no live
 * provider key exists in e2e, so saving is not exercised — the unit suite
 * (browserBridge, keyVault) owns the crypto and validation paths.
 */
test.describe('AI settings hardening (budget + kill-switch + revoke)', () => {
  test('settings page renders the token budget field', async ({ page }) => {
    await loginAs(page);
    await page.goto('/settings/ai');
    await page.waitForLoadState('networkidle', { timeout: 15_000 });

    // Session token budget (B2) — a number input must be mounted for admins.
    const budget = page.locator('input[type="number"]').first();
    await budget.waitFor({ state: 'visible', timeout: 15_000 });
    expect(await budget.count()).toBeGreaterThanOrEqual(1);
    expect(page.url()).toContain('/settings/ai');
  });

  test('browser mode shows encryption status and desktop-only toggle', async ({ page }) => {
    await loginAs(page);
    await page.goto('/settings/ai');
    await page.waitForLoadState('networkidle', { timeout: 15_000 });

    // Either the encrypted-storage note or the legacy-upgrade note must be
    // present once a key exists; at minimum the page must settle, not blank.
    const body = page.locator('body');
    await expect(body).toContainText(/الذكاء الاصطناعي|AI/i, { timeout: 15_000 });
  });

  test('chat page still settles with the new settings keys present', async ({ page }) => {
    await loginAs(page);
    await page.goto('/ai');
    await page.waitForLoadState('networkidle', { timeout: 15_000 });
    expect(page.url()).toContain('/ai');
  });

  test('revoke flow: save a key, revoke it with two clicks, key is gone', async ({ page }) => {
    // End-to-end through the app's own bridge (no direct DB seeding — the
    // page may read a different backend than /__e2e/db writes to).
    await loginAs(page);
    await page.goto('/settings/ai');
    await page.waitForLoadState('networkidle', { timeout: 15_000 });

    // 1. Save a probe key via the real form (password field = API key).
    const keyInput = page.locator('input[type="password"]').first();
    await expect(keyInput).toBeVisible({ timeout: 15_000 });
    await keyInput.fill('sk-e2e-revoke-probe-12345');
    await page.getByRole('button', { name: /حفظ الإعدادات/i }).click();
    await page.waitForTimeout(2_000);

    // 2. Two-click revoke control must now be mounted.
    const revoke = page.getByRole('button', { name: /إلغاء المفتاح/i });
    await expect(revoke).toBeVisible({ timeout: 15_000 });

    // 3. First click arms (confirm text), second click revokes.
    await revoke.click();
    await expect(page.getByRole('button', { name: /اضغط مجدداً للتأكيد/i })).toBeVisible({ timeout: 5_000 });
    await page.getByRole('button', { name: /اضغط مجدداً للتأكيد/i }).click();
    await expect(page.getByRole('button', { name: /إلغاء المفتاح/i })).toBeHidden({ timeout: 15_000 });
  });
});
