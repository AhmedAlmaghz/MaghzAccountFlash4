import { test, expect, loginAs } from './fixtures/auth';

/**
 * Smoke for the full-page document editors (DocumentPageShell).
 * Verifies each editor route loads without a blank screen and renders its
 * primary actions, without performing a full create/post cycle.
 *
 * The heading patterns mirror the REAL editor titles (sales.invoice.new,
 * manufacturing.bom.newBom, …). A title change must break this test
 * loudly — that is the point of the smoke.
 */
const EDITORS: Array<{ path: string; title: RegExp }> = [
  { path: '/sales/invoices/new', title: /فاتورة مبيعات|sales invoice/i },
  { path: '/purchases/invoices/new', title: /فاتورة مشتريات|purchase invoice/i },
  { path: '/inventory/products/new', title: /منتج جديد|new product/i },
  { path: '/accounting/journal/new', title: /قيد يومي|journal entry/i },
  { path: '/manufacturing/bom/new', title: /فاتورة مواد|bill of materials|\bBOM\b/i },
  { path: '/manufacturing/work-orders/new', title: /أمر تشغيل|work order/i },
];

test.describe('document editors smoke', () => {
  for (const { path, title } of EDITORS) {
    test(`editor ${path} loads`, async ({ page }) => {
      await loginAs(page);
      await page.goto(path);
      await page.waitForLoadState('networkidle', { timeout: 15_000 });
      await expect(page.getByRole('heading', { name: title }).first()).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole('button', { name: /حفظ|إنشاء|save|create/i }).first()).toBeVisible();
      expect(page.url()).toContain(path);
    });
  }
});
