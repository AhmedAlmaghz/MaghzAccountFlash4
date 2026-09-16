// Fill admin password, choose Demo data, start seeding
const { ensureBrowser, ROOT } = require('./browser.cjs');

(async () => {
  const browser = await ensureBrowser();
  const context = browser.contexts()[0];
  const page = context.pages()[0];
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.locator('input[type="password"]').fill('Admin@12345');
  console.log('password filled');
  await page.locator('button:has-text("البيانات الوهمية")').first().click();
  console.log('demo option selected');
  await page.waitForTimeout(500);
  await page.locator('button:has-text("بذر البيانات والتالي")').first().click();
  console.log('seeding started...');

  // poll for completion (up to 3 min)
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(3000);
    const text = await page.evaluate(() => document.body.innerText);
    const busy = /جارٍ|جاري|البذر|يرجى الانتظار|%.+%\s*$/.test(text);
    console.log(`poll ${i}: busy=${busy} len=${text.length}`);
    if (text.includes('الإنجاز') && (text.includes('اكتمل') || text.includes('تم') || !busy)) {
      if (i > 2) break;
    }
  }
  console.log('--- BODY TEXT ---');
  console.log((await page.evaluate(() => document.body.innerText)).slice(0, 1200));
  await page.screenshot({ path: ROOT + '/.capture/out/wizard-final.png' });
  process.exit(0);
})().catch((e) => { console.error('FATAL:', e); process.exit(1); });
