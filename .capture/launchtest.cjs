// Try multiple launch configurations until one connects
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const ROOT = 'E:/MaghzAccountApp/MaghzAccountFlash35';

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
function findEdge() {
  const candidates = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error('Edge not found');
}

const configs = [
  { name: 'chromium + no-sandbox + single-process', exe: findChromium(), args: ['--no-proxy-server', '--no-sandbox', '--single-process'], headless: true },
  { name: 'chromium headed', exe: findChromium(), args: ['--no-proxy-server'], headless: false },
  { name: 'edge headed', exe: findEdge(), args: [], headless: false },
];

(async () => {
  for (const cfg of configs) {
    const profile = path.join(ROOT, '.capture', 'tmp-' + cfg.name.replace(/[^a-z]+/gi, '-'));
    let browser;
    try {
      browser = await chromium.launchPersistentContext(profile, {
        headless: cfg.headless,
        executablePath: cfg.exe,
        viewport: { width: 1440, height: 900 },
        args: cfg.args,
        timeout: 30000,
      });
      const page = browser.pages()[0] || (await browser.newPage());
      await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded', timeout: 12000 });
      console.log(`SUCCESS: ${cfg.name}`);
      console.log('URL:', page.url());
      await page.waitForTimeout(3000);
      console.log('TEXT:', (await page.evaluate(() => document.body.innerText)).slice(0, 300));
      await browser.close();
      console.log('WINNER:', cfg.name);
      return;
    } catch (e) {
      console.log(`fail: ${cfg.name} -> ${e.message.split('\n')[0]}`);
      try { await browser?.close(); } catch {}
    }
  }
  console.log('ALL CONFIGS FAILED');
})().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
