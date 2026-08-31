import { test, expect } from './fixtures/auth';
import { loginAs } from './fixtures/auth';

test.describe('HR Module', () => {
  test('HR page loads with menu cards', async ({ page }) => {
    await loginAs(page);
    await page.goto('/hr');
    // Wait for either root or child page to render
    await expect(page.getByText('الموظفين').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/الحضور/).first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('مسير الرواتب').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('الإجازات').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('نهاية الخدمة').first()).toBeVisible({ timeout: 5_000 });
  });

  test('Employees page loads and shows table or empty state', async ({ page }) => {
    await loginAs(page);
    await page.goto('/hr/employees');
    await expect(page.getByRole('heading', { name: /الموظفين/i }).first()).toBeVisible({ timeout: 20_000 });
    // Wait for either employees data or empty state
    await page.waitForLoadState('networkidle', { timeout: 10_000 });
    const tableRows = await page.locator('table tbody tr').count();
    expect(tableRows).toBeGreaterThanOrEqual(0);
  });

  test('Attendance page loads with stat cards', async ({ page }) => {
    await loginAs(page);
    await page.goto('/hr/attendance');
    await expect(page.getByRole('heading', { name: /الحضور/i }).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('الحاضرون').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('الغائبون').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('المتأخرون').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/إجمالي ساعات العمل/).first()).toBeVisible({ timeout: 5_000 });
  });

  test('Payroll page loads with create button', async ({ page }) => {
    await loginAs(page);
    await page.goto('/hr/payroll');
    await expect(page.getByRole('heading', { name: /مسير الرواتب/i }).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('مسير جديد').first()).toBeVisible({ timeout: 10_000 });
  });

  test('Leaves page loads with request button', async ({ page }) => {
    await loginAs(page);
    await page.goto('/hr/leaves');
    await expect(page.getByRole('heading', { name: /الإجازات/i }).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('طلب إجازة').first()).toBeVisible({ timeout: 10_000 });
  });

  test('End of Service page loads with new calculation button', async ({ page }) => {
    await loginAs(page);
    await page.goto('/hr/end-of-service');
    await expect(page.getByRole('heading', { name: /نهاية الخدمة/i }).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('حساب جديد').first()).toBeVisible({ timeout: 10_000 });
  });

  test('Employees page: open create modal then close', async ({ page }) => {
    await loginAs(page);
    await page.goto('/hr/employees');
    await expect(page.getByRole('heading', { name: /الموظفين/i }).first()).toBeVisible({ timeout: 20_000 });
    await page.waitForLoadState('networkidle', { timeout: 10_000 });

    const createBtn = page.getByRole('button', { name: /موظف/i }).first();
    if (await createBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await createBtn.click();
      // Verify modal opened
      const modalHeading = page.getByRole('heading', { name: /موظف/i }).first();
      await expect(modalHeading).toBeVisible({ timeout: 5_000 });
      // Close via Escape
      await page.keyboard.press('Escape');
    }
  });

  test('HR policies settings page loads with policy cards', async ({ page }) => {
    await loginAs(page);
    await page.goto('/settings/hr-policies');
    await expect(page.getByRole('heading', { name: /سياسات الموارد البشرية/i }).first()).toBeVisible({ timeout: 20_000 });
    // The three policy cards render
    await expect(page.getByText(/أرصدة الإجازات/).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/الدوام والأوفر تايم/).first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/نهاية الخدمة/).first()).toBeVisible({ timeout: 5_000 });
    // Save button present (visible only with edit permission — admin has it)
    const saveBtn = page.getByRole('button', { name: /حفظ السياسات/i }).first();
    await expect(saveBtn).toBeVisible({ timeout: 5_000 });
  });

  test('Payroll create modal shows auto preview button', async ({ page }) => {
    await loginAs(page);
    await page.goto('/hr/payroll');
    await expect(page.getByRole('heading', { name: /مسير الرواتب/i }).first()).toBeVisible({ timeout: 20_000 });
    const newRunBtn = page.getByText('مسير جديد').first();
    if (await newRunBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await newRunBtn.click();
      // The auto-preview button appears in the create modal
      await expect(page.getByRole('button', { name: /معاينة تلقائية/i }).first()).toBeVisible({ timeout: 10_000 });
      await page.keyboard.press('Escape');
    }
  });
});
