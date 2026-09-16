// Network isolation test for chromium
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const ROOT = 'E:/MaghzAccountApp/MaghzAccountFlash35';
const PROFILE = path.join(ROOT, '.capture', 'profile');

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

async function tryGoto(page, url, timeout = 10000) {
  const t0 = Date.now();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    console.log(`OK   ${url} (${Date.now() - t0}ms) title=`, await page.title().catch(() => '?'));
    return true;
  } catch (e) {
    console.log(`FAIL ${url} (${Date.now() - t0}ms) ${e.message.split('\n')[0]}`);
    return false;
  }
}

(async () => {
  const browser = await chromium.launchPersistentContext(PROFILE, {
    headless: true,
    executablePath: findChromium(),
    viewport: { width: 1440, height: 900 },
    args: ['--no-proxy-server'],
  });
  const page = browser.pages()[0] || (await browser.newPage());
  page.on('requestfailed', (r) => console.log('  [reqfailed]', r.url().slice(0, 80), r.failure()?.errorText));
  await tryGoto(page, 'about:blank');
  await tryGoto(page, 'https://example.com/');
  await tryGoto(page, 'http://192.168.1.2:5173/');
  await tryGoto(page, 'http://localhost:5173/');
  await browser.close();
})().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
