const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
  await p.goto('file://' + __dirname + '/cards.html');
  await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(500);
  for (const i of [1, 2, 3, 4]) await p.locator('#c' + i).screenshot({ path: `c${i}.png` });
  await b.close();
})();
