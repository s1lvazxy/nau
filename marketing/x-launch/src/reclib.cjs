// Records the live Nau demo at 1920x1080: a visible cursor, camera moves and captions, captured over CDP.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const W = 1440, H = 810;
const SLOW = 3;
const rsleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sleep = (ms) => rsleep(ms * SLOW);
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

async function open(startPath = '/demo') {
  const browser = await chromium.launch({ args: ['--force-device-scale-factor=1.3333333', `--window-size=${W},${H}`, '--hide-scrollbars'] });
  const ctx = await browser.newContext({ viewport: null });
  await ctx.addCookies([{ name: 'nau-lang', value: 'en', url: 'http://localhost:3100' }]);
  await ctx.addInitScript((SLOW) => {
    const p0 = performance.now(), d0 = Date.now();
    const pnow = performance.now.bind(performance), dnow = Date.now.bind(Date);
    performance.now = () => p0 + (pnow() - p0) / SLOW;
    Date.now = () => Math.round(d0 + (dnow() - d0) / SLOW);
    const st = window.setTimeout, si = window.setInterval, raf = window.requestAnimationFrame;
    window.setTimeout = (fn, d = 0, ...a) => st(fn, d * SLOW, ...a);
    window.setInterval = (fn, d = 0, ...a) => si(fn, d * SLOW, ...a);
    window.requestAnimationFrame = (cb) => raf((t) => cb(p0 + (t - p0) / SLOW));
  }, SLOW);
  const page = await ctx.newPage();
  const anim = await ctx.newCDPSession(page);
  await anim.send('Animation.enable');
  await anim.send('Animation.setPlaybackRate', { playbackRate: 1 / SLOW });
  await page.goto('http://localhost:3100' + startPath, { waitUntil: 'networkidle' });
  await page.waitForURL('**/app');
  await page.waitForTimeout(2500 * SLOW);
  const s = { browser, ctx, page, mouse: [W * 0.62, H * 0.58], cam: { scale: 1, tx: 0, ty: 0 }, frames: [], cdp: null, dir: null };
  await inject(s);
  return s;
}

async function inject(s) {
  await s.page.evaluate(() => {
    if (document.getElementById('rec-layer')) return;
    const root = document.documentElement;
    root.style.background = '#08080a';
    const layer = document.createElement('div');
    layer.id = 'rec-layer';
    layer.innerHTML = `
      <style>
        #rec-layer { position: fixed; inset: 0; z-index: 2147483647; pointer-events: none; font-family: "Geist Variable", system-ui, sans-serif; }
        #rec-cursor { position: absolute; left: 0; top: 0; width: 26px; height: 26px; margin: -2px 0 0 -3px; filter: drop-shadow(0 3px 6px rgb(0 0 0 / .55)); will-change: transform; }
        #rec-ring { position: absolute; left: 0; top: 0; width: 44px; height: 44px; margin: -22px 0 0 -22px; border-radius: 50%; border: 2px solid rgb(255 180 138 / .95); opacity: 0; }
        #rec-ring.go { animation: rec-ring .55s ease-out; }
        @keyframes rec-ring { from { opacity: .95; scale: .3; } to { opacity: 0; scale: 1.25; } }
        #rec-cap { position: absolute; left: 50%; bottom: 40px; translate: -50% 14px; opacity: 0; transition: opacity .45s ease, translate .45s cubic-bezier(.2,.8,.2,1); display: flex; align-items: center; gap: 12px; height: 60px; padding: 0 30px 0 24px; border-radius: 999px; font-size: 24px; font-weight: 500; letter-spacing: -0.015em; color: #fff; white-space: nowrap;
          background: rgb(17 15 14 / .94); box-shadow: inset 0 0 0 1px rgb(255 255 255 / .14), inset 0 1px 0 rgb(255 255 255 / .16), 0 18px 50px -10px rgb(0 0 0 / .8), 0 0 60px -12px rgb(255 91 31 / .5); }
        #rec-cap.on { opacity: 1; translate: -50% 0; }
        #rec-cap i { width: 8px; height: 8px; border-radius: 50%; background: #ff5b1f; box-shadow: 0 0 14px 2px rgb(255 91 31 / .85); }
        #rec-vig { position: absolute; inset: 0; background: radial-gradient(125% 125% at 50% 50%, transparent 62%, rgb(0 0 0 / .42) 100%); }
      </style>
      <div id="rec-vig"></div>
      <div id="rec-cap"><i></i><span></span></div>
      <div id="rec-ring"></div>
      <svg id="rec-cursor" viewBox="0 0 26 26"><path d="M4 2.5 L4 20.5 L9 16 L12.2 23.2 L15.3 21.8 L12.2 14.8 L18.8 14.6 Z" fill="#fff" stroke="#0a0a0a" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
    root.appendChild(layer);
    const cur = layer.querySelector('#rec-cursor');
    const ring = layer.querySelector('#rec-ring');
    window.addEventListener('mousemove', (e) => { cur.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`; ring.style.translate = `${e.clientX}px ${e.clientY}px`; }, true);
    window.addEventListener('mousedown', () => { ring.classList.remove('go'); void ring.offsetWidth; ring.classList.add('go'); }, true);
    document.body.style.transformOrigin = '0 0';
    document.body.style.willChange = 'transform';
  });
  await s.page.mouse.move(s.mouse[0], s.mouse[1]);
}

async function start(s, name) {
  s.dir = path.join(process.cwd(), 'frames', name);
  fs.rmSync(s.dir, { recursive: true, force: true });
  fs.mkdirSync(s.dir, { recursive: true });
  s.frames = [];
  s.cdp = await s.ctx.newCDPSession(s.page);
  s.cdp.on('Page.screencastFrame', (f) => {
    const file = `f${String(s.frames.length).padStart(5, '0')}.jpg`;
    fs.writeFileSync(path.join(s.dir, file), Buffer.from(f.data, 'base64'));
    s.frames.push({ file, t: f.metadata.timestamp });
    s.cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await s.cdp.send('Page.startScreencast', { format: 'jpeg', quality: 95, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
  s.t0 = Date.now();
}

async function stop(s, name, tail = 0.4) {
  await s.cdp.send('Page.stopScreencast');
  await rsleep(200);
  const lines = [];
  for (let i = 0; i < s.frames.length; i++) {
    const d = i + 1 < s.frames.length ? (s.frames[i + 1].t - s.frames[i].t) / SLOW : tail;
    lines.push(`file '${s.frames[i].file}'`, `duration ${Math.max(d, 0.001).toFixed(4)}`);
  }
  lines.push(`file '${s.frames[s.frames.length - 1].file}'`);
  fs.writeFileSync(path.join(s.dir, 'list.txt'), lines.join('\n'));
  const out = path.join(process.cwd(), 'clips', name + '.mp4');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(s.dir, 'list.txt'), '-vf', 'fps=30,scale=1920:1080:flags=lanczos,format=yuv420p', '-c:v', 'libx264', '-crf', '16', '-preset', 'slow', out]);
  console.log(name, s.frames.length, 'frames', ((s.frames.at(-1).t - s.frames[0].t) / SLOW).toFixed(1) + 's');
  return out;
}

const camOf = (scale, x, y) => ({ scale, tx: Math.min(0, Math.max(W - scale * W, W / 2 - scale * x)), ty: Math.min(0, Math.max(H - scale * H, H / 2 - scale * y)) });
const toScreen = (c, [x, y]) => [c.tx + c.scale * x, c.ty + c.scale * y];

/** Page coordinates (as laid out, before the camera) of a locator's centre. Only call while the camera is at rest. */
async function pt(s, loc, dx = 0, dy = 0) {
  const b = await loc.first().boundingBox();
  if (!b) throw new Error('no box for locator');
  const c = s.cam;
  return [(b.x + b.width / 2 - c.tx) / c.scale + dx, (b.y + b.height / 2 - c.ty) / c.scale + dy];
}

/** Camera move to centre the page point `at` at `scale`; the pointer travels to `mouse` (page point) during the move. */
async function shot(s, scale, at, mouse, dur = 1.3) {
  const c = camOf(scale, at[0], at[1]);
  await s.page.evaluate(({ c, dur }) => {
    document.body.style.transition = `transform ${dur}s cubic-bezier(.62,.02,.26,1)`;
    document.body.style.transform = `translate(${c.tx}px, ${c.ty}px) scale(${c.scale})`;
  }, { c, dur });
  s.cam = c;
  const t0 = Date.now();
  if (mouse) await moveScreen(s, toScreen(c, mouse), dur * 1000 * 0.92);
  const left = (dur * 1000 + 80) * SLOW - (Date.now() - t0);
  if (left > 0) await rsleep(left);
}

async function moveScreen(s, [x, y], dur = 700) {
  const [x0, y0] = s.mouse;
  const bend = Math.min(36, Math.hypot(x - x0, y - y0) * 0.07);
  const t0 = Date.now();
  for (;;) {
    const k = Math.min(1, (Date.now() - t0) / (dur * SLOW));
    const e = ease(k);
    const arc = Math.sin(Math.PI * e) * bend;
    await s.page.mouse.move(x0 + (x - x0) * e + arc * 0.4, y0 + (y - y0) * e - arc);
    if (k >= 1) break;
    await rsleep(8);
  }
  s.mouse = [x, y];
}

/** Move the pointer to a page point with the camera at rest. */
const go = (s, p, dur = 700) => moveScreen(s, toScreen(s.cam, p), dur);

async function press(s) {
  await sleep(160);
  await s.page.mouse.down(); await sleep(80); await s.page.mouse.up();
}

async function type(s, loc, text, per = 46) {
  await loc.focus();
  for (const ch of text) { await s.page.keyboard.type(ch); await sleep(per + Math.random() * 40); }
}

async function caption(s, text) {
  await s.page.evaluate((text) => {
    const c = document.getElementById('rec-cap');
    if (!text) return c.classList.remove('on');
    if (c.classList.contains('on')) {
      c.classList.remove('on');
      setTimeout(() => { c.querySelector('span').textContent = text; c.classList.add('on'); }, 380);
    } else { c.querySelector('span').textContent = text; c.classList.add('on'); }
  }, text);
}

module.exports = { open, inject, start, stop, pt, shot, go, press, type, caption, sleep, W, H };
