// Records a real run through the site for the demo video: home, a walk in the studio from a recorded clip used as
// the camera, the result with Gemini's judgment, and the wall. Frames come from Chrome's screencast; the cursor
// is not in them, so every move is logged and the editor draws it. So are the moments to zoom to.
//
//   node scripts/demo/record.mjs <walk clip> [--site http://localhost:4700] [--out reels/.demo]
//
// Uses the dev server you already run (npm run dev), so it uses .env.local: one real Gemini judgment.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const W = 1440;
const H = 900;
const DPR = 2;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now() / 1000;

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const clip = path.resolve(args.find((a) => !a.startsWith('--') && !Object.values({}).includes(a)) || '');
const SITE = opt('--site', 'http://localhost:4700');
const OUT = path.resolve(opt('--out', path.join(ROOT, 'reels', '.demo')));
if (!fs.existsSync(clip)) throw new Error('Pass the walk clip to use as the camera.');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'frames'), { recursive: true });

// The camera: the clip, with its first frame held for 12 s so the tracker loads and they stand still to calibrate.
const camera = path.join(OUT, 'camera.mjpeg');
console.log('Making the camera feed.');
execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', clip, '-vf', 'scale=1280:960,tpad=start_duration=12:start_mode=clone,fps=30', '-q:v', '3', '-an', '-f', 'mjpeg', camera]);

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'runway-demo-'));
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run',
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${camera}`,
  '--enable-unsafe-webgpu', '--hide-scrollbars', `--window-size=${W},${H}`, '--autoplay-policy=no-user-gesture-required', '--force-color-profile=srgb'], { stdio: 'ignore' });
const portFile = path.join(profile, 'DevToolsActivePort');
for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) await sleep(100);
const port = fs.readFileSync(portFile, 'utf8').split('\n')[0];
const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));

let id = 0;
const pending = new Map();
const frames = [];
const log = { W, H, DPR, mouse: [], focus: [], marks: [], clicks: [] };
let frameNo = 0;
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  } else if (m.method === 'Page.screencastFrame') {
    const name = `${String(frameNo++).padStart(6, '0')}.jpg`;
    fs.writeFile(path.join(OUT, 'frames', name), Buffer.from(m.params.data, 'base64'), () => {});
    frames.push({ t: m.params.metadata.timestamp, file: name });
    ws.send(JSON.stringify({ id: ++id, method: 'Page.screencastFrameAck', params: { sessionId: m.params.sessionId } }));
  } else if (m.method === 'Runtime.exceptionThrown') {
    console.log('page error:', m.params.exceptionDetails.exception?.description?.slice(0, 160));
  }
});
const send = (method, params = {}) => new Promise((res) => { pending.set(++id, res); ws.send(JSON.stringify({ id, method, params })); });
const js = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;

await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DPR, mobile: false });

// ── the cursor ──
let mx = W * 0.62;
let my = H * 0.7;
const ease = (u) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);
async function moveTo(x, y, ms = 700) {
  const x0 = mx;
  const y0 = my;
  const steps = Math.max(8, Math.round(ms / 16));
  // A slight arc, like a hand.
  const bow = Math.min(60, Math.hypot(x - x0, y - y0) * 0.12);
  for (let i = 1; i <= steps; i++) {
    const u = ease(i / steps);
    const px = x0 + (x - x0) * u - Math.sin(Math.PI * u) * bow * 0.4;
    const py = y0 + (y - y0) * u - Math.sin(Math.PI * u) * bow;
    mx = px;
    my = py;
    log.mouse.push({ t: now(), x: px, y: py });
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: px, y: py });
    await sleep(ms / steps);
  }
}
async function click() {
  log.clicks.push({ t: now(), x: mx, y: my });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: mx, y: my, button: 'left', clickCount: 1 });
  await sleep(70);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: mx, y: my, button: 'left', clickCount: 1 });
}
async function rectOf(selectorJs) {
  return js(`(() => { const el = ${selectorJs}; if (!el) return null; el.scrollIntoView({ block: 'nearest' }); const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
}
const byText = (text, sel = 'button, a, label') => `[...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.offsetParent && e.innerText.trim().includes(${JSON.stringify(text)}))`;
async function clickOn(selectorJs, ms = 800) {
  const r = await rectOf(selectorJs);
  if (!r) throw new Error(`Not on the page: ${selectorJs}`);
  await moveTo(r.x + r.w / 2, r.y + r.h / 2, ms);
  await sleep(180);
  await click();
  return r;
}
async function wheel(dy, ms = 1200) {
  const steps = Math.round(ms / 16);
  for (let i = 0; i < steps; i++) {
    const u0 = ease(i / steps);
    const u1 = ease((i + 1) / steps);
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: mx, y: my, deltaX: 0, deltaY: dy * (u1 - u0) });
    log.mouse.push({ t: now(), x: mx, y: my });
    await sleep(16);
  }
}
/** Ask the editor to frame this rectangle (CSS pixels) from now on; null goes back to the whole window. */
const focus = (rect, zoom = null) => log.focus.push({ t: now(), rect, zoom });
const mark = (name) => { log.marks.push({ t: now(), name }); console.log(`  ${name}`); };
async function until(expr, ms, label) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await js(expr).catch(() => false)) return true;
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${label}`);
}
const phase = () => js(`document.querySelector('.rw-stage')?.dataset.phase`);

// ── the run ──
await send('Page.navigate', { url: `${SITE}/#/` });
await until(`!!document.querySelector('.rw-hero')`, 15000, 'home');
await js(`document.fonts.ready.then(() => true)`);
await sleep(800);
await send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: W * DPR, maxHeight: H * DPR, everyNthFrame: 1 });
await sleep(400);
log.start = now();
mark('home');
focus(null);
await moveTo(W * 0.45, H * 0.55, 1200);
await sleep(900);
mark('scroll');
await wheel(700, 1800);
await sleep(1100);
await wheel(800, 1800);
await sleep(1100);
await wheel(-1500, 1400);
await sleep(500);

mark('studio');
await clickOn(byText('Start a walk', 'a'));
await until(`!!document.querySelector('.rw-stage')`, 10000, 'studio');
await sleep(900);
const judgeBox = await js(`(() => { const l = ${byText('Judge my walk', 'label')}; const i = l?.querySelector('input') || document.getElementById(l?.htmlFor); return i ? i.checked : null; })()`);
if (judgeBox === false) await clickOn(byText('Judge my walk', 'label'), 600);
if (await js(`!!(${byText('Turn on camera')})`)) await clickOn(byText('Turn on camera'));
mark('camera');
await until(`/Tracking with/.test(document.querySelector('#rw-root').innerText)`, 60000, 'tracker');
const stage = await rectOf(`document.querySelector('.rw-stage')`);
focus(stage, 1.35);
await moveTo(stage.x + stage.w * 0.7, stage.y + stage.h * 0.6, 900);
await sleep(1500);
const dist = await rectOf(`document.querySelector('.rw-distance')`);
if (dist) {
  mark('distance');
  focus({ x: dist.x - 60, y: dist.y - 40, w: dist.w + 120, h: dist.h + 200 }, 2.1);
  await moveTo(dist.x + dist.w * 0.5, dist.y + dist.h + 30, 900);
  await sleep(2200);
}
mark('start');
focus(stage, 1.2);
await clickOn(byText('Start, with a 3 second countdown'));
await until(`document.querySelector('.rw-stage').dataset.phase === 'recording'`, 15000, 'recording');
mark('recording');
await moveTo(stage.x + stage.w + 60, stage.y + stage.h * 0.4, 900);
focus(stage, 1.5);
const ended = Date.now() + 110000;
while (Date.now() < ended) {
  const state = await js(`({ route: location.hash, phase: document.querySelector('.rw-stage')?.dataset.phase })`).catch(() => ({}));
  if (state.route?.startsWith('#/review/') || state.phase === 'take') break;
  await sleep(200);
}
mark('take');
if (await phase() === 'take') {
  focus(null);
  await sleep(600);
  await clickOn(byText('Use this walk'));
}
await until(`location.hash.startsWith('#/review/')`, 15000, 'review');
mark('analysis');
focus(null);
await moveTo(W * 0.5, H * 0.45, 800);
await until(`!!document.querySelector('.rw-score__num, .rw-scoreblock') && !document.querySelector('.rw-progress, [aria-busy="true"]')`, 240000, 'analysis').catch(() => {});
await sleep(800);
mark('result');
const consent = await js(`!!(${byText('I agree, judge my walk')})`);
if (consent) {
  const r = await clickOn(byText('I agree, judge my walk'));
  focus({ x: r.x - 300, y: r.y - 250, w: r.w + 600, h: 500 }, 1.6);
}
// With "Judge my walk" ticked in the studio, the judge starts by itself. Frame its progress, then wait for it.
mark('judging');
const judging = await rectOf(`[...document.querySelectorAll('section, div')].reverse().find((e) => e.offsetParent && /is thinking about your walk/.test(e.innerText) && e.getBoundingClientRect().height < 260)`);
if (judging) {
  focus({ x: judging.x - 40, y: judging.y - 160, w: judging.w + 80, h: judging.h + 200 }, 1.7);
  await moveTo(judging.x + judging.w * 0.7, judging.y + judging.h + 24, 900);
}
await until(`!!document.querySelector('.rw-verdict') && !/is thinking about your walk/.test(document.querySelector('#rw-root').innerText)`, 180000, 'judge')
  .catch(() => console.log('  no verdict came back'));
focus(null);
mark('verdict');
await sleep(1200);
const score = await rectOf(`document.querySelector('.rw-scoreblock')`);
if (score) {
  focus({ x: score.x - 40, y: score.y - 40, w: Math.max(score.w, 520) + 80, h: score.h + 220 }, 1.8);
  await moveTo(score.x + score.w * 0.6, score.y + score.h * 0.8, 900);
  await sleep(2600);
}
mark('breakdown');
focus(null);
await wheel(650, 1600);
await sleep(2400);
await wheel(500, 1400);
await sleep(2000);

mark('wall');
await wheel(-3000, 900);
await clickOn(byText('The wall', 'a'));
await until(`document.querySelectorAll('.rw-wallcard').length > 3`, 20000, 'wall');
await sleep(1200);
const stats = await rectOf(`document.querySelector('.rw-stats')`);
if (stats) {
  focus({ x: stats.x - 30, y: stats.y - 30, w: stats.w + 60, h: stats.h + 60 }, 1.5);
  await moveTo(stats.x + stats.w * 0.8, stats.y + stats.h * 0.5, 900);
  await sleep(1600);
}
focus(null);
await wheel(520, 1400);
await sleep(1600);
mark('open-walk');
await clickOn(`document.querySelector('.rw-wallcard__link')`);
await until(`!!document.querySelector('.rw-walledit__video')`, 15000, 'walk page');
await sleep(600);
await js(`(() => { const v = document.querySelector('.rw-walledit__video'); v.muted = true; v.currentTime = 0; return v.play().then(() => true); })()`);
const vid = await rectOf(`document.querySelector('.rw-walledit__video')`);
focus({ x: vid.x - 40, y: vid.y - 20, w: vid.w + 80, h: vid.h + 40 }, 1.25);
mark('edit');
await moveTo(vid.x + vid.w + 120, vid.y + vid.h * 0.5, 900);
await sleep(9000);
focus(null);
await sleep(1500);
mark('end');
log.end = now();

await send('Page.stopScreencast');
await sleep(500);
log.frames = frames;
fs.writeFileSync(path.join(OUT, 'log.json'), JSON.stringify(log));
console.log(`Recorded ${frames.length} frames over ${(log.end - log.start).toFixed(1)} s into ${OUT}`);
chrome.kill();
process.exit(0);
