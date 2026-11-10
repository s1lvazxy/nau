const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: 'en-GB' });
  await ctx.addCookies([{ name: 'nau-lang', value: 'en', url: 'http://localhost:3100' }]);
  const p = await ctx.newPage();
  await p.goto('http://localhost:3100/demo', { waitUntil: 'networkidle' });
  await p.waitForURL('**/app'); await p.waitForTimeout(3500);
  await p.screenshot({ path: 's-dash.png' });
  await p.getByText('Operator', { exact: true }).first().click();
  await p.waitForTimeout(1200);
  const box = p.getByLabel('Message Operator');
  await box.fill("What's running low?"); await box.press('Enter'); await p.waitForTimeout(5000);
  await p.screenshot({ path: 's-op1.png' });
  await box.fill('Draft the orders'); await box.press('Enter'); await p.waitForTimeout(7000);
  await p.screenshot({ path: 's-op2.png' });
  await b.close();
})();
