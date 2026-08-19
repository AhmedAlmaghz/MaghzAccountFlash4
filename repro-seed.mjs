import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:4173';
const timeoutMs = 240000;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[console:${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => logs.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));
page.on('response', (r) => {
  if (r.status() >= 400) logs.push(`[http ${r.status()}] ${r.url()}`);
});

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.evaluate(async () => {
    localStorage.clear();
    const dbs = await indexedDB.databases?.() || [];
    const deletes = dbs.filter(d => d.name).map(d => new Promise((resolve) => {
      const req = indexedDB.deleteDatabase(d.name);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    }));
    await Promise.all(deletes);
  });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });

  await page.getByRole('button', { name: /ابدأ/i }).first().waitFor({ timeout: 20000 });
  await page.getByRole('button', { name: /ابدأ/i }).first().click();
  await page.getByText(/اختبار الاتصال/i).first().waitFor({ timeout: 15000 });

  // Test connection with PGlite (should succeed now with wasm-unsafe-eval)
  await page.getByRole('button', { name: /اختبار الاتصال/i }).first().click();
  const testStart = Date.now();
  try {
    await page.locator('span.text-emerald-600, .text-emerald-600 span').first().waitFor({ timeout: timeoutMs });
    console.log(`TEST CONNECTION SUCCESS after ${Date.now() - testStart}ms`);
  } catch {
    console.log('TEST CONNECTION FAILED/STUCK');
    console.log('LOGS:\n' + logs.join('\n'));
    await browser.close();
    process.exit(2);
  }

  await page.getByRole('button', { name: /التالي/i }).first().click();
  const nameInput = page.getByLabel(/اسم الشركة/i).first();
  await nameInput.waitFor({ timeout: 10000 });
  await nameInput.fill('شركة الاختبار');
  await page.getByRole('button', { name: /التالي/i }).first().click();

  await page.locator('input#seed-admin-password').waitFor({ timeout: 10000 });
  await page.locator('input#seed-admin-password').fill('admin1234');
  const seedCard = page.locator('button', { hasText: /البيانات الافتراضية/i }).first();
  await seedCard.click();
  await page.getByRole('button', { name: /البذر والمتابعة|بذر/i }).first().click();

  const seedStart = Date.now();
  await page.getByText(/جاهز|اكتمل/i).first().waitFor({ timeout: timeoutMs });
  console.log(`SEED COMPLETED after ${Date.now() - seedStart}ms`);

  await page.getByRole('button', { name: /الدخول إلى النظام/i }).first().click();
  await page.waitForURL('**/login', { timeout: 30000 }).catch(() => {});
  console.log('At login page:', page.url());

  // Login as seeded admin
  const userInput = page.locator('input[type="text"], input:not([type=password]):not([type=checkbox])').first();
  await userInput.waitFor({ timeout: 10000 });
  await userInput.fill('admin');
  await page.locator('input[type="password"]').first().fill('admin1234');
  await page.getByRole('button', { name: /تسجيل الدخول/i }).first().click();

  const loginStart = Date.now();
  try {
    await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: timeoutMs });
    console.log(`LOGIN SUCCESS after ${Date.now() - loginStart}ms -> ${page.url()}`);
  } catch {
    console.log('LOGIN FAILED/STUCK');
    const body = await page.locator('body').innerText().catch(() => '');
    console.log('BODY:', body.slice(0, 300).replace(/\n+/g, ' | '));
    console.log('LOGS:\n' + logs.join('\n'));
    await browser.close();
    process.exit(4);
  }

  // Warm reload should be fast (IndexedDB persisted)
  await page.waitForTimeout(3000);
  const bodyText = await page.locator('body').innerText().catch(() => '');
  console.log('DASHBOARD HEAD:', bodyText.slice(0, 200).replace(/\n+/g, ' | '));
  const wasmErrs = logs.filter(l => l.includes('WebAssembly') || l.includes('CSP') || l.includes('fonts.googleapis'));
  console.log('WASM/CSP/FONT ERRORS:', wasmErrs.length ? wasmErrs.join('\n') : 'NONE');
  console.log('LOGS:\n' + logs.join('\n'));
} catch (err) {
  console.log('SCRIPT ERROR:', err.message);
  console.log('LOGS:\n' + logs.join('\n'));
} finally {
  await browser.close();
}