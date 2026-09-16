// Probe: launch persistent profile, open app, report state
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const ROOT = 'E:/MaghzAccountApp/MaghzAccountFlash35';
const PROFILE = path.join(ROOT, '.capture', 'profile');
const OUT = path.join(ROOT, '.capture', 'out');

function findChromium() {
  const base = path.join(process.env.LOCALAPPDATA, 'ms-playwright');
  for (const d of fs.readdirSync(base)) {
    if (d.startsWith('chromium-')) {
      for (const sub of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe']) {
        const p = path.join(base, d, sub);
        if (fs.existsSync(p)) return p;
      }
    }
  }
  throw new Error('chromium not found');
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launchPersistentContext(PROFILE, {
    headless: true,
    executablePath: findChromium(),
    args: ['--no-proxy-server'],
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = browser.pages()[0] || (await browser.newPage());
  page.setDefaultTimeout(15000);
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(4000);
  const url = page.url();
  const text = await page.evaluate(() => document.body.innerText.slice(0, 800));
  console.log('URL:', url);
  console.log('--- BODY TEXT ---');
  console.log(text);
  await page.screenshot({ path: path.join(OUT, 'probe.png') });
  await browser.close();
})().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
