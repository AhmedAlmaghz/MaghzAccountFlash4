// Which SQL statements does the dashboard issue, and how often each one?
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  const shapes = new Map();
  const timings = [];
  page.on('request', (r) => {
    if (!r.url().includes('/__e2e/db')) return;
    let sql = '';
    try { sql = JSON.parse(r.postData() || '{}').sql || ''; } catch { /* ignore */ }
    const shape = sql.replace(/\s+/g, ' ').slice(0, 80);
    shapes.set(shape, (shapes.get(shape) || 0) + 1);
    const started = Date.now();
    timings.push({ shape, started });
  });

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

  await page.goto('http://127.0.0.1:5173/login', { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForSelector('input[required]', { timeout: 90_000 });
  const inputs = page.locator('input[required]');
  await inputs.nth(0).fill('admin', { timeout: 60_000 });
  await inputs.nth(1).fill('admin1234', { timeout: 60_000 });
  await page.locator('button[type="submit"]').click({ timeout: 60_000 });
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 60_000 });

  shapes.clear();
  timings.length = 0;
  const t = Date.now();
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForSelector('h2:has-text("العملاء")', { timeout: 120_000 });
  const elapsed = Date.now() - t;

  const total = [...shapes.values()].reduce((a, b) => a + b, 0);
  console.log(`dashboard: ${elapsed}ms, ${total} bridge requests, ${shapes.size} distinct shapes\n`);
  for (const [shape, n] of [...shapes].sort((a, b) => b[1] - a[1]).slice(0, 18)) {
    console.log(`  ${String(n).padStart(3)}x  ${shape}`);
  }

  // the timeline: when did the requests fire?
  const buckets = new Map();
  for (const { started } of timings) {
    const s = Math.floor((started - t) / 1000);
    buckets.set(s, (buckets.get(s) || 0) + 1);
  }
  console.log('\nrequests per second after the navigation:');
  for (const [s, n] of [...buckets].sort((a, b) => a[0] - b[0])) console.log(`  ${s}s: ${n}`);

  await browser.close();
})().catch((e) => { console.log('ERR', e.message.slice(0, 300)); process.exit(1); });
