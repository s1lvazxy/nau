// Clip 1 — the dashboard
const R = require('./reclib.cjs');
(async () => {
  const s = await R.open();
  const p = s.page;
  const P = {
    brief: await R.pt(s, p.getByText('Sales this week', { exact: false }), 150, 4),
    b1: await R.pt(s, p.getByText('is out of stock', { exact: false }), -60, 0),
    b2: await R.pt(s, p.getByText('lots expire', { exact: false }), -20, 0),
    b3: await R.pt(s, p.getByText('sits in items', { exact: false }), 40, 0),
    compass: await R.pt(s, p.getByText('Stock compass'), 150, 112),
    waiting: await R.pt(s, p.getByText('Reorder from Quinta das Pedras'), 30, 8),
    wait2: await R.pt(s, p.getByText('Reorder from Distribuidora', { exact: false }), 40, 8),
    chart: await R.pt(s, p.getByText('Sales · 30 days'), 0, 120),
  };
  await R.start(s, '01-dashboard');
  await R.sleep(1000);
  await R.caption(s, 'The week, in one sentence.');
  await R.shot(s, 1.55, [500, 330], P.brief, 1.5);
  await R.sleep(500);
  await R.go(s, P.b1, 500); await R.sleep(250);
  await R.go(s, P.b2, 450); await R.sleep(250);
  await R.go(s, P.b3, 450); await R.sleep(450);
  await R.caption(s, 'Stock health, at a glance.');
  await R.shot(s, 1.75, [P.compass[0], 330], P.compass, 1.4);
  await R.sleep(1500);
  await R.caption(s, 'What is waiting for your yes.');
  await R.shot(s, 1.6, [1290, 330], P.waiting, 1.4);
  await R.sleep(500);
  await R.go(s, P.wait2, 700);
  await R.sleep(900);
  await R.caption(s, 'Ninety days of sales behind every number.');
  await R.shot(s, 1.4, [640, 660], [P.chart[0] + 60, P.chart[1]], 1.5);
  await R.go(s, [P.chart[0] + 620, P.chart[1] - 6], 2200);
  await R.sleep(400);
  await R.caption(s, null);
  await R.shot(s, 1, [720, 405], [1010, 520], 1.5);
  await R.sleep(1300);
  await R.stop(s, '01-dashboard');
  await s.browser.close();
})();
