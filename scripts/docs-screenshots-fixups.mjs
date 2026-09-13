// Fix-up captures: journal entry editor + POS terminal (needs loaded content)
import { chromium } from 'playwright';
import path from 'node:path';
import os from 'node:os';

const BASE_URL = 'http://localhost:5173';
const OUT = path.resolve('Docs2/en/assets');
const PROFILE = path.join(os.tmpdir(), 'maghz-docs-en-profile');

async function waitBodyText(page, substrings, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const text = await page.evaluate(() => document.body.innerText).catch(() => '');
    if (substrings.some(s => text.includes(s))) return text;
    await page.waitForTimeout(700);
  }
  return '';
}

async function main() {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    locale: 'en-US',
  });
  await ctx.addInitScript(() => {
    const app = JSON.parse(localStorage.getItem('maghzaccount-app') || '{"state":{},"version":0}');
    app.state.language = 'en';
    app.state.theme = 'light';
    localStorage.setItem('maghzaccount-app', JSON.stringify(app));
  });
  const page = await ctx.newPage();

  // login if needed
  await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);
  let text = await page.evaluate(() => document.body.innerText);
  if (!text.includes('Dashboard') && (page.url().includes('login') || text.includes('Login'))) {
    await page.getByRole('textbox', { name: /Username/ }).fill('admin');
    await page.getByRole('textbox', { name: /Password/ }).fill('admin1234');
    await page.getByRole('button', { name: 'Login' }).click();
    await page.waitForURL(u => !u.pathname.includes('login'), { timeout: 60000 });
    console.log('✓ logged in');
  }

  // ── journal entry editor ──
  await page.goto(BASE_URL + '/accounting/journal', { waitUntil: 'domcontentloaded' });
  await waitBodyText(page, ['Journal']);
  await page.waitForTimeout(2500);
  const newBtn = page.getByRole('button', { name: /New Journal Entry/ }).first();
  console.log('new entry buttons:', await newBtn.count());
  if ((await newBtn.count()) > 0) {
    await newBtn.click();
    await waitBodyText(page, ['Lines', 'Account', 'Debit']);
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(OUT, 'accounting/journal-entry-editor.png') });
    console.log('✓ accounting/journal-entry-editor.png');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
  } else {
    console.log('✗ no New Journal Entry button found');
  }

  // ── POS terminal ──
  await page.goto(BASE_URL + '/pos', { waitUntil: 'domcontentloaded' });
  text = await waitBodyText(page, ['Walk-in', 'Cart', 'No open shift', 'Open Shift'], 90000);
  console.log('pos text sample:', JSON.stringify(text.slice(0, 120)));
  if (text.includes('No open shift') || text.includes('Open Shift')) {
    const openBtn = page.getByRole('button', { name: 'Open Shift' }).first();
    await openBtn.click();
    await page.waitForTimeout(1500);
    const amount = page.locator('input[type="number"]').first();
    if ((await amount.count()) > 0) await amount.fill('50000');
    // confirm inside the modal (last Open Shift button)
    await page.getByRole('button', { name: 'Open Shift' }).last().click();
    await page.waitForTimeout(4000);
  }
  // wait until the terminal actually rendered (cart panel + product grid)
  const okText = await waitBodyText(page, ['Walk-in', 'Cart'], 90000);
  const skeletonCount = await page.evaluate(() => document.querySelectorAll('[class*="animate-pulse"]').length);
  console.log('terminal ready:', okText.length > 0, 'skeletons:', skeletonCount);
  await page.waitForTimeout(5000);
  await page.screenshot({ path: path.join(OUT, 'pos/terminal.png') });
  console.log('✓ pos/terminal.png');

  await ctx.close();
  console.log('DONE');
}

main().catch(e => { console.error(e); process.exit(1); });
