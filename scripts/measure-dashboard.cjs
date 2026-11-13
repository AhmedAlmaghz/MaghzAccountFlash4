// How long does the dashboard take to become interactive now, and how many
// bridge requests does it issue?
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  let requests = 0;
  page.on('request', (r) => { if (r.url().includes('/__e2e/db')) requests++; });

  await page.addInitScript(() => {
    localStorage.setItem('maghzaccount-db-mode', 'pg');
    localStorage.setItem('maghzaccount-onboarding', JSON.stringify({
      state: {
        completed: true, currentStep: 4, seedOption: 'demo', isProcessing: false,
        processingMessage: '', error: null,
        companyConfig: { name: 'شركة المغزى للتجارة والصناعة', currency: 'YER' },
        dbConfig: { host: 'localhost', port: 5432, database: 'MaghzAccountFlash35', user: 'maghz', ssl: false },
      },
      version: 0,
    }));
  });

  const t0 = Date.now();
  await page.goto('http://127.0.0.1:5173/login', { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForSelector('input[required]', { timeout: 90_000 });
  console.log('login page ready in', Date.now() - t0, 'ms');

  const inputs = page.locator('input[required]');
  await inputs.nth(0).fill('admin', { timeout: 60_000 });
  await inputs.nth(1).fill('admin1234', { timeout: 60_000 });
  await page.locator('button[type="submit"]').click({ timeout: 60_000 });
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 60_000 });
  console.log('logged in at', Date.now() - t0, 'ms');

  requests = 0;
  const t1 = Date.now();
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded', timeout: 120_000 });
  console.log('dashboard dom ready in', Date.now() - t1, 'ms');
  // the DASHBOARD heading (h2), not the sidebar link that carries the same text
  await page.waitForSelector('h2:has-text("لوحة التحكم")', { timeout: 120_000 });
  console.log('dashboard heading ready in', Date.now() - t1, 'ms');
  await page.waitForSelector('h2:has-text("العملاء")', { timeout: 120_000 });
  console.log('dashboard CRM section ready in', Date.now() - t1, 'ms');
  console.log('bridge requests:', requests);

  // second visit — the modules are transformed by now
  requests = 0;
  const t2 = Date.now();
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForSelector('h2:has-text("العملاء")', { timeout: 120_000 });
  console.log('SECOND dashboard content ready in', Date.now() - t2, 'ms');
  console.log('bridge requests (2nd visit):', requests);

  await browser.close();
})().catch((e) => { console.log('ERR', e.message.slice(0, 300)); process.exit(1); });
