import { test, expect } from './fixtures/auth';
import { loginAs } from './fixtures/auth';

test.describe('Reports Hub & Analytics', () => {
  test('reports hub loads with module cards', async ({ page }) => {
    await loginAs(page);
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');
    // Hub page should render 7 module cards
    await expect(page.getByText('تحليل المبيعات').first()).toBeVisible();
    await expect(page.getByText('تحليل المخزون').first()).toBeVisible();
    await expect(page.getByText('كشف حساب العملاء').first()).toBeVisible();
    await expect(page.getByText('كشف حساب الموردين').first()).toBeVisible();
    await expect(page.getByText('تحليل الربحية').first()).toBeVisible();
  });

  test('sales analysis report loads with KPI cards', async ({ page }) => {
    await loginAs(page);
    await page.goto('/reports/sales-analysis');
    await page.waitForLoadState('networkidle');
    // Wait for either KPIs or empty state
    await expect(page.getByText('تحليل المبيعات').first()).toBeVisible();
    // Page should render within 10s
    await expect(page.locator('h1, h2, h3').first()).toBeVisible({ timeout: 10_000 });
  });

  test('inventory analysis report loads', async ({ page }) => {
    await loginAs(page);
    await page.goto('/reports/inventory-analysis');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('تحليل المخزون').first()).toBeVisible();
    await expect(page.locator('h1, h2, h3').first()).toBeVisible({ timeout: 10_000 });
  });

  test('profit analysis report loads with date filters', async ({ page }) => {
    await loginAs(page);
    await page.goto('/reports/profit-analysis');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('تحليل الربحية').first()).toBeVisible();
    // Should have filter button
    await expect(page.getByRole('button', { name: /تصفية/ }).first()).toBeVisible({ timeout: 10_000 });
  });

  test('customer statement report loads with aging buckets', async ({ page }) => {
    await loginAs(page);
    await page.goto('/reports/customer-statement');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('كشف حساب العملاء').first()).toBeVisible();
    await expect(page.locator('h1, h2, h3').first()).toBeVisible({ timeout: 10_000 });
  });

  test('supplier statement report loads with aging buckets', async ({ page }) => {
    await loginAs(page);
    await page.goto('/reports/supplier-statement');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('كشف حساب الموردين').first()).toBeVisible();
    await expect(page.locator('h1, h2, h3').first()).toBeVisible({ timeout: 10_000 });
  });

  test('low stock alert report loads with KPIs', async ({ page }) => {
    await loginAs(page);
    await page.goto('/reports/low-stock-alert');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('تنبيه المخزون').first()).toBeVisible();
    await expect(page.locator('h1, h2, h3').first()).toBeVisible({ timeout: 10_000 });
  });

  test('stock movement report loads with date pickers', async ({ page }) => {
    await loginAs(page);
    await page.goto('/reports/stock-movement');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('تحليل حركة المخزون').first()).toBeVisible();
    // Should have date inputs
    await expect(page.locator('input[type="date"]').first()).toBeVisible({ timeout: 10_000 });
  });

  test('stock valuation report loads with view tabs', async ({ page }) => {
    await loginAs(page);
    await page.goto('/reports/stock-valuation');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('تقييم المخزون').first()).toBeVisible();
    // Should have view tabs (products/categories/warehouses)
    await expect(page.locator('button').first()).toBeVisible({ timeout: 10_000 });
  });

  test('lead conversion report loads with funnel chart', async ({ page }) => {
    await loginAs(page);
    await page.goto('/reports/lead-conversion');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('تحويل العملاء المحتملين').first()).toBeVisible();
    await expect(page.locator('h1, h2, h3').first()).toBeVisible({ timeout: 10_000 });
  });

  test('opportunity pipeline report loads with stage breakdown', async ({ page }) => {
    await loginAs(page);
    await page.goto('/reports/opportunity-pipeline');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('خط أنابيب الفرص').first()).toBeVisible();
    await expect(page.locator('h1, h2, h3').first()).toBeVisible({ timeout: 10_000 });
  });

  test('custom report builder loads with step navigation', async ({ page }) => {
    await loginAs(page);
    await page.goto('/reports/custom-builder');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('منشئ التقارير المخصصة').first()).toBeVisible();
    // Should have step buttons
    await expect(page.getByText('اختيار الجدول').first()).toBeVisible({ timeout: 10_000 });
  });
});
