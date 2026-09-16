// Network test using system Edge browser
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const ROOT = 'E:/MaghzAccountApp/MaghzAccountFlash35';
const PROFILE = path.join(ROOT, '.capture', 'profile-edge');

function findEdge() {
  const candidates = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error('Edge not found');
}

async function tryGoto(page, url, timeout = 10000) {
  const t0 = Date.now();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    console.log(`OK   ${url} (${Date.now() - t0}ms)`);
    return true;
  } catch (e) {
    console.log(`FAIL ${url} (${Date.now() - t0}ms) ${e.message.split('\n')[0]}`);
    return false;
  }
}

(async () => {
  const browser = await chromium.launchPersistentContext(PROFILE, {
    headless: true,
    executablePath: findEdge(),
    viewport: { width: 1440, height: 900 },
  });
  const page = browser.pages()[0] || (await browser.newPage());
  await tryGoto(page, 'https://example.com/');
  await tryGoto(page, 'http://127.0.0.1:5173/');
  if (page.url().includes('5173')) {
    await page.waitForTimeout(4000);
    console.log('URL now:', page.url());
    console.log('TEXT:', (await page.evaluate(() => document.body.innerText)).slice(0, 500));
  }
  await browser.close();
})().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
