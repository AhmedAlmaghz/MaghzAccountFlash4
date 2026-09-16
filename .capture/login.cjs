// Complete wizard -> login -> dump sidebar routes
const { ensureBrowser, ROOT } = require('./browser.cjs');

(async () => {
  const browser = await ensureBrowser();
  const context = browser.contexts()[0];
  const page = context.pages()[0];
  await page.setViewportSize({ width: 1440, height: 900 });

  const btn = page.locator('button:has-text("الدخول إلى النظام")');
  if ((await btn.count()) > 0) {
    await btn.first().click();
    await page.waitForTimeout(3000);
    console.log('clicked enter; URL:', page.url());
  }

  if (page.url().includes('login')) {
    const inputs = page.locator('input');
    const n = await inputs.count();
    console.log('login inputs:', n);
    for (let i = 0; i < n; i++) {
      console.log(i, await inputs.nth(i).getAttribute('type'), await inputs.nth(i).inputValue());
    }
    await page.locator('input[type="text"], input:not([type="password"])').first().fill('admin');
    await page.locator('input[type="password"]').first().fill('Admin@12345');
    await page.locator('button:has-text("تسجيل الدخول")').first().click();
    await page.waitForTimeout(8000);
    console.log('after login URL:', page.url());
  }

  const text = await page.evaluate(() => document.body.innerText);
  console.log('--- BODY (400) ---');
  console.log(text.slice(0, 400));

  // dump sidebar links
  const links = await page.evaluate(() =>
    [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href') + ' | ' + (a.textContent || '').trim().slice(0, 30))
  );
  console.log('--- LINKS ---');
  console.log(links.join('\n'));
  await page.screenshot({ path: ROOT + '/.capture/out/after-login.png' });
  process.exit(0);
})().catch((e) => { console.error('FATAL:', e); process.exit(1); });
