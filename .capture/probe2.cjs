// Probe app state via CDP-connected chromium
const { ensureBrowser, ROOT } = require('./browser.cjs');

(async () => {
  const browser = await ensureBrowser();
  const contexts = browser.contexts();
  const context = contexts[0];
  const pages = context.pages();
  const page = pages[0] || (await context.newPage());
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);
  console.log('URL:', page.url());
  console.log('--- BODY TEXT (first 600) ---');
  console.log((await page.evaluate(() => document.body.innerText)).slice(0, 600));
  await page.screenshot({ path: ROOT + '/.capture/out/probe.png' });
  console.log('screenshot saved');
  // keep browser alive for later cells
  process.exit(0);
})().catch((e) => { console.error('FATAL:', e); process.exit(1); });
