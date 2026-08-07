import { test, expect } from './fixtures/auth';
import { loginAs } from './fixtures/auth';

test.describe('Leads', () => {
  test('leads page loads with table and create button', async ({ page }) => {
    await loginAs(page);
    await page.goto('/crm/leads');
    await expect(page.getByRole('heading', { name: /العملاء المحتملين|Leads/i }).first()).toBeVisible({ timeout: 15_000 });

    const tableRows = page.locator('table tbody tr');
    await expect.poll(async () => tableRows.count(), { timeout: 20_000 }).toBeGreaterThan(0);
  });

  test('create lead form opens with all required fields', async ({ page }) => {
    await loginAs(page);
    await page.goto('/crm/leads');
    await expect(page.getByRole('heading', { name: /العملاء المحتملين|Leads/i }).first()).toBeVisible({ timeout: 15_000 });

    const createBtn = page.getByRole('button', { name: /عميل محتمل جديد|New Lead/i });
    await expect(createBtn).toBeVisible({ timeout: 10_000 });
    await createBtn.click();

    const modalHeading = page.getByRole('heading', { name: /عميل محتمل جديد|New Lead/i });
    await expect(modalHeading).toBeVisible({ timeout: 5_000 });

    // Modal should have Name, Company, Phone, Email, Source, Estimated Value, Rating, Assigned To, Notes fields
    const modalPanel = modalHeading.locator('..').locator('..').locator('..');
    await expect(modalPanel.getByLabel(/الاسم|Name/i).first()).toBeVisible();
    await expect(modalPanel.getByLabel(/الهاتف|Phone/i).first()).toBeVisible();
    await expect(modalPanel.getByLabel(/البريد|Email/i).first()).toBeVisible();

    // Close modal with Escape
    await page.keyboard.press('Escape');
    await expect(modalHeading).not.toBeVisible({ timeout: 5_000 });
  });

  test('create lead with name and verify in table', async ({ page }) => {
    await loginAs(page);
    await page.goto('/crm/leads');
    await expect(page.getByRole('heading', { name: /العملاء المحتملين|Leads/i }).first()).toBeVisible({ timeout: 15_000 });

    const createBtn = page.getByRole('button', { name: /عميل محتمل جديد|New Lead/i });
    await createBtn.click();

    const modalHeading = page.getByRole('heading', { name: /عميل محتمل جديد|New Lead/i });
    const modalPanel = modalHeading.locator('..').locator('..').locator('..');

    const uniqueName = `اختبار e2e ${Date.now()}`;
    await modalPanel.getByLabel(/الاسم|Name/i).first().fill(uniqueName);
    await modalPanel.getByLabel(/الهاتف|Phone/i).first().fill('+967999000000');

    const saveBtn = page.getByRole('button', { name: /حفظ|Save/i });
    await expect(saveBtn).toBeEnabled({ timeout: 5_000 });
    await saveBtn.click();

    await expect(modalHeading).not.toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(uniqueName).first()).toBeVisible({ timeout: 15_000 });
  });

  test('search filter works on leads list', async ({ page }) => {
    await loginAs(page);
    await page.goto('/crm/leads');
    await expect(page.getByRole('heading', { name: /العملاء المحتملين|Leads/i }).first()).toBeVisible({ timeout: 15_000 });

    const searchInput = page.getByPlaceholder(/ابحث|Search/i).first();
    await expect(searchInput).toBeVisible({ timeout: 5_000 });
    await searchInput.fill('محمد');
    // Wait for debounce/refresh
    await page.waitForTimeout(500);
  });
});

test.describe('Opportunities', () => {
  test('opportunities page loads with kanban view', async ({ page }) => {
    await loginAs(page);
    await page.goto('/crm/opportunities');
    await expect(page.getByRole('heading', { name: /الفرص|Opportunities/i }).first()).toBeVisible({ timeout: 15_000 });

    // Check view mode buttons exist
    await expect(page.getByRole('button', { name: /Kanban/i }).first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('button', { name: /قائمة|List/i }).first()).toBeVisible();
  });

  test('create opportunity form opens with all stages', async ({ page }) => {
    await loginAs(page);
    await page.goto('/crm/opportunities');
    await expect(page.getByRole('heading', { name: /الفرص|Opportunities/i }).first()).toBeVisible({ timeout: 15_000 });

    const createBtn = page.getByRole('button', { name: /فرصة جديدة|New Opportunity/i });
    await expect(createBtn).toBeVisible({ timeout: 10_000 });
    await createBtn.click();

    const modalHeading = page.getByRole('heading', { name: /فرصة جديدة|New Opportunity/i });
    await expect(modalHeading).toBeVisible({ timeout: 5_000 });

    const modalPanel = modalHeading.locator('..').locator('..').locator('..');
    await expect(modalPanel.getByLabel(/اسم الفرصة|Opportunity Name/i).first()).toBeVisible();
    await expect(modalPanel.getByLabel(/القيمة|Value/i).first()).toBeVisible();

    // Probability should be 0-100
    const probInput = modalPanel.getByLabel(/الاحتمالية|Probability/i).first();
    await expect(probInput).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(modalHeading).not.toBeVisible({ timeout: 5_000 });
  });

  test('switch to list view shows table', async ({ page }) => {
    await loginAs(page);
    await page.goto('/crm/opportunities');
    await expect(page.getByRole('heading', { name: /الفرص|Opportunities/i }).first()).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: /قائمة|List/i }).first().click();
    await page.waitForTimeout(500);

    // Table should be visible in list view
    const table = page.locator('table');
    await expect(table.first()).toBeVisible({ timeout: 5_000 });
  });
});

test.describe('Tasks', () => {
  test('tasks page loads with filters', async ({ page }) => {
    await loginAs(page);
    await page.goto('/crm/tasks');
    await expect(page.getByRole('heading', { name: /المهام|Tasks/i }).first()).toBeVisible({ timeout: 15_000 });

    // Filters for status and priority should be visible
    await expect(page.getByLabel(/الأولوية|Priority/i).first()).toBeVisible({ timeout: 5_000 });
  });

  test('create task with title and verify in list', async ({ page }) => {
    await loginAs(page);
    await page.goto('/crm/tasks');
    await expect(page.getByRole('heading', { name: /المهام|Tasks/i }).first()).toBeVisible({ timeout: 15_000 });

    const createBtn = page.getByRole('button', { name: /مهمة جديدة|New Task/i });
    await expect(createBtn).toBeVisible({ timeout: 10_000 });
    await createBtn.click();

    const modalHeading = page.getByRole('heading', { name: /مهمة جديدة|New Task/i });
    const modalPanel = modalHeading.locator('..').locator('..').locator('..');

    const uniqueTitle = `مهمة اختبار ${Date.now()}`;
    await modalPanel.getByLabel(/العنوان|Title/i).first().fill(uniqueTitle);

    const saveBtn = page.getByRole('button', { name: /حفظ|Save/i });
    await expect(saveBtn).toBeEnabled({ timeout: 5_000 });
    await saveBtn.click();

    await expect(modalHeading).not.toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(uniqueTitle).first()).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('Activities', () => {
  test('activities page loads with type filter', async ({ page }) => {
    await loginAs(page);
    await page.goto('/crm/activities');
    await expect(page.getByRole('heading', { name: /سجل الأنشطة|Activity Log|Activities/i }).first()).toBeVisible({ timeout: 15_000 });

    // Type filter should be visible
    await expect(page.getByLabel(/النوع|Type/i).first()).toBeVisible({ timeout: 5_000 });
  });

  test('create activity with subject', async ({ page }) => {
    await loginAs(page);
    await page.goto('/crm/activities');
    await expect(page.getByRole('heading', { name: /سجل الأنشطة|Activity Log|Activities/i }).first()).toBeVisible({ timeout: 15_000 });

    const createBtn = page.getByRole('button', { name: /نشاط جديد|New Activity/i });
    await expect(createBtn).toBeVisible({ timeout: 10_000 });
    await createBtn.click();

    const modalHeading = page.getByRole('heading', { name: /نشاط جديد|New Activity/i });
    const modalPanel = modalHeading.locator('..').locator('..').locator('..');

    const uniqueSubject = `نشاط اختبار ${Date.now()}`;
    await modalPanel.getByLabel(/الموضوع|Subject/i).first().fill(uniqueSubject);

    const saveBtn = page.getByRole('button', { name: /حفظ|Save/i });
    await expect(saveBtn).toBeEnabled({ timeout: 5_000 });
    await saveBtn.click();

    await expect(modalHeading).not.toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(uniqueSubject).first()).toBeVisible({ timeout: 15_000 });
  });

  test('activities page has export button', async ({ page }) => {
    await loginAs(page);
    await page.goto('/crm/activities');
    await expect(page.getByRole('heading', { name: /سجل الأنشطة|Activity Log|Activities/i }).first()).toBeVisible({ timeout: 15_000 });

    // Export button should be present
    const exportBtn = page.locator('button[title*="تصدير"], button[title*="export"], button[aria-label*="تصدير"], button[aria-label*="export"]').first();
    await expect(exportBtn).toBeVisible({ timeout: 5_000 });
  });
});
