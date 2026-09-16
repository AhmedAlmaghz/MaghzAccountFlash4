// Onboarding driver: click a button by text, dump the resulting step
const { ensureBrowser, ROOT } = require('./browser.cjs');

const CLICK_TEXT = process.argv[2] || '';
const WAIT = parseInt(process.argv[3] || '3000', 10);

(async () => {
  const browser = await ensureBrowser();
  const context = browser.contexts()[0];
  const page = context.pages()[0] || (await context.newPage());
  await page.setViewportSize({ width: 1440, height: 900 });
  console.log('current URL:', page.url());

  if (CLICK_TEXT) {
    const btn = page.locator(`button:has-text("${CLICK_TEXT}")`).first();
    const cnt = await btn.count();
    console.log(`button "${CLICK_TEXT}" count:`, cnt);
    if (cnt === 0) {
      const vis = await page.evaluate((t) => {
        const els = [...document.querySelectorAll('button, [role="button"], a')];
        return els.filter((e) => e.textContent && e.textContent.includes(t)).map((e) => e.textContent.trim().slice(0, 50));
      }, CLICK_TEXT);
      console.log('no button; similar:', JSON.stringify(vis));
      process.exit(2);
    }
    await btn.click({ timeout: 8000 });
    console.log('clicked');
    await page.waitForTimeout(WAIT);
  }

  console.log('URL now:', page.url());
  const text = await page.evaluate(() => document.body.innerText);
  console.log('--- BODY TEXT ---');
  console.log(text.slice(0, 1500));
  const inputs = await page.evaluate(() =>
    [...document.querySelectorAll('input, select, textarea')].map((e) => ({
      tag: e.tagName, type: e.type, ph: e.placeholder || '', name: e.name || '', val: e.value || '', checked: e.checked,
    }))
  );
  console.log('--- INPUTS ---');
  console.log(JSON.stringify(inputs, null, 1));
  const buttons = await page.evaluate(() =>
    [...document.querySelectorAll('button')].map((e) => e.textContent.trim().slice(0, 40)).filter(Boolean)
  );
  console.log('--- BUTTONS ---', JSON.stringify(buttons));
  await page.screenshot({ path: ROOT + '/.capture/out/wizard-state.png' });
  process.exit(0);
})().catch((e) => { console.error('FATAL:', e); process.exit(1); });
