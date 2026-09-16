// Shared launcher: starts chromium headless with CDP port (or reuses), returns playwright connection
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = 'E:/MaghzAccountApp/MaghzAccountFlash35';
const CAPTURE = path.join(ROOT, '.capture');
const PROFILE = path.join(CAPTURE, 'cdp-profile');
const PORT = 9222;

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

function cdpAlive() {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${PORT}/json/version`, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => resolve(b.includes('Browser')));
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1500, () => { req.destroy(); resolve(false); });
  });
}

async function ensureBrowser() {
  if (!(await cdpAlive())) {
    fs.rmSync(PROFILE, { recursive: true, force: true });
    fs.mkdirSync(PROFILE, { recursive: true });
    const exe = findChromium();
    const child = spawn(exe, [
      '--headless=new',
      '--remote-debugging-port=' + PORT,
      '--user-data-dir=' + PROFILE,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--window-size=1440,900',
      '--mute-audio',
      'about:blank',
    ], { stdio: 'ignore', detached: true });
    child.unref();
    let ok = false;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if (await cdpAlive()) { ok = true; break; }
    }
    if (!ok) throw new Error('CDP browser did not start');
  }
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`, { timeout: 15000 });
  return browser;
}

module.exports = { ensureBrowser, ROOT, CAPTURE, PORT };
