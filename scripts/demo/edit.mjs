// Turns a recording from scripts/demo/record.mjs into the demo video: a 1920×1080, 60 fps product film with the
// site in a browser window, eased zooms, a drawn cursor, short captions, speed-ups over the waits, and music.
//
//   node scripts/demo/edit.mjs [--in reels/.demo] [--out reels/runwaylab-demo.mp4] [--preview]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openHeadless } from '../headless.mjs';
import { lineUp } from '../showreel/music.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const IN = path.resolve(opt('--in', path.join(ROOT, 'reels', '.demo')));
const OUT = path.resolve(opt('--out', path.join(ROOT, 'reels', 'runwaylab-demo.mp4')));
const PREVIEW = args.includes('--preview');
const MUSIC = path.join(ROOT, 'vendor/music/lets-bring-this-house-down.mp3');
const MUSIC_CREDIT = 'Music: "Lets Bring This House Down" by Antti Luode, CC BY 3.0';

const FPS = 60;
const OW = 1920;
const OH = 1080;
const log = JSON.parse(fs.readFileSync(path.join(IN, 'log.json'), 'utf8'));
const CSS_W = log.W;
const CSS_H = log.H;
const TITLE_H = 40;
const WIN = { x: (OW - CSS_W) / 2, y: (OH - (CSS_H + TITLE_H)) / 2, w: CSS_W };
const toScene = (x, y) => ({ x: WIN.x + x, y: WIN.y + TITLE_H + y });

const M = Object.fromEntries(log.marks.map((m) => [m.name, m.t]));
const need = (name) => {
  if (!(name in M)) throw new Error(`The recording has no "${name}" moment. Record again.`);
  return M[name];
};

// ── the cut: source spans and how fast each plays ──
const INTRO = 3.0;
const OUTRO = 4.8;
const spans = [
  [need('home') + 0.3, need('studio'), 2.4],
  [need('studio'), need('camera') + 0.8, 1.4],
  [need('camera') + 0.8, need('distance') - 0.2, 3],
  [need('distance') - 0.2, need('start'), 1.15],
  [need('start'), need('recording'), 1.5],
  [need('recording'), need('take'), 2.3],
  [need('take'), need('analysis') + 1.2, 1.2],
  [need('analysis') + 1.2, need('result') - 0.3, 7],
  [need('result') - 0.3, need('judging') + 2.2, 1.2],
  [need('judging') + 2.2, need('verdict') - 1.2, 16],
  [need('verdict') - 1.2, need('wall'), 1.8],
  [need('wall'), need('open-walk'), 1.9],
  [need('open-walk'), need('end') - 1.6, 1.05],
];
let at = INTRO;
const timeline = spans.map(([from, to, speed]) => {
  const span = { from, to, speed, start: at, end: at + (to - from) / speed };
  at = span.end;
  return span;
});
const BODY_END = at;
const TOTAL = BODY_END + OUTRO;

const srcAt = (t) => {
  if (t <= INTRO) return timeline[0].from;
  for (const s of timeline) if (t < s.end) return s.from + (t - s.start) * s.speed;
  const last = timeline.at(-1);
  return last.to;
};
const outAt = (src) => {
  for (const s of timeline) if (src >= s.from && src <= s.to) return s.start + (src - s.from) / s.speed;
  if (src < timeline[0].from) return INTRO;
  // In a skipped gap: the start of the next span.
  const next = timeline.find((s) => s.from > src);
  return next ? next.start : BODY_END;
};
const speedAt = (t) => timeline.find((s) => t >= s.start && t < s.end)?.speed ?? 1;

// ── source frames ──
const frames = log.frames;
function frameIndexAt(src) {
  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (frames[mid].t <= src) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// ── the cursor, smoothed a little ──
const mouse = log.mouse;
function mouseAt(src) {
  if (!mouse.length || src < mouse[0].t) return mouse.length ? { x: mouse[0].x, y: mouse[0].y } : null;
  let lo = 0;
  let hi = mouse.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (mouse[mid].t <= src) lo = mid;
    else hi = mid - 1;
  }
  const a = mouse[lo];
  const b = mouse[Math.min(lo + 1, mouse.length - 1)];
  const u = b.t > a.t ? Math.min(1, (src - a.t) / (b.t - a.t)) : 0;
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
}

// ── the camera: one target per focus event, eased in output time ──
const ease = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);
const WHOLE = { z: 1, cx: OW / 2, cy: OH / 2 };
function targetFor(f) {
  if (!f.rect) return WHOLE;
  const tl = toScene(f.rect.x, f.rect.y);
  const fit = Math.min(OW / f.rect.w, OH / f.rect.h) * 0.92;
  const z = Math.min(Math.max(f.zoom ?? fit, 1), 2.4);
  return { z, cx: tl.x + f.rect.w / 2, cy: tl.y + f.rect.h / 2 };
}
const clampCam = ({ z, cx, cy }) => {
  const hw = OW / 2 / z;
  const hh = OH / 2 / z;
  return { z, cx: Math.min(Math.max(cx, hw), OW - hw), cy: Math.min(Math.max(cy, hh), OH - hh) };
};
const keys = log.focus.map((f) => ({ t: outAt(f.t), target: clampCam(targetFor(f)) })).sort((a, b) => a.t - b.t);
const MOVE = 1.1;
const lerpCam = (a, b, u) => ({ z: Math.exp(Math.log(a.z) + (Math.log(b.z) - Math.log(a.z)) * u), cx: a.cx + (b.cx - a.cx) * u, cy: a.cy + (b.cy - a.cy) * u });
// Where the camera is when each key begins.
const before = [];
for (let i = 0; i < keys.length; i++) {
  if (i === 0) before.push(WHOLE);
  else before.push(lerpCam(before[i - 1], keys[i - 1].target, ease((keys[i].t - keys[i - 1].t) / MOVE)));
}
function camAt(t) {
  let i = -1;
  for (let k = 0; k < keys.length; k++) if (keys[k].t <= t) i = k;
  if (i < 0) return WHOLE;
  return lerpCam(before[i], keys[i].target, ease((t - keys[i].t) / MOVE));
}

// ── captions ──
const captions = [
  [outAt(need('camera')) + 0.6, 2.6, 'Point any camera at the runway'],
  [outAt(need('distance')) + 0.2, 3.0, 'Live start and turn marks keep the whole body in frame'],
  [outAt(need('recording')) + 1.6, 3.4, '26 body points, tracked live in the browser'],
  [outAt(need('analysis') + 1.2), 2.6, '70 points measured from the movement itself'],
  [outAt(need('judging')) + 0.5, 3.4, 'Gemini judges presence and style for the last 30'],
  [outAt(need('wall')) + 1.6, 3.2, 'Every walk goes on the wall, stored in Tiger Data'],
  [outAt(need('open-walk')) + 1.2, 3.2, 'And every walker gets an edit'],
];
function captionAt(t) {
  for (const [start, life, text] of captions) if (t >= start && t < start + life) return { text, age: t - start, life };
  return null;
}

function stateAt(f) {
  const t = f / FPS;
  const src = srcAt(Math.min(t, BODY_END - 1e-3));
  const cam = camAt(t);
  const winIn = Math.min(1, Math.max(0, (t - (INTRO - 0.5)) / 0.7));
  const winOut = 1 - Math.min(1, Math.max(0, (t - BODY_END) / 0.6));
  const windowAlpha = Math.min(winIn, winOut);
  const m = mouseAt(src);
  // Gently follow the cursor while zoomed in, like a camera operator would.
  let view = cam;
  if (m && cam.z > 1.05) {
    const p = toScene(m.x, m.y);
    const pull = Math.min(0.22, (cam.z - 1) * 0.25);
    view = clampCam({ z: cam.z, cx: cam.cx + (p.x - cam.cx) * pull, cy: cam.cy + (p.y - cam.cy) * pull });
  }
  const click = [...log.clicks].reverse().find((k) => k.t <= src && src - k.t < 0.6);
  const speed = speedAt(t);
  return {
    t,
    src: frameIndexAt(src),
    cam: view,
    windowAlpha,
    lift: (1 - ease(winIn)) * 40,
    cursor: m && t > INTRO ? toScene(m.x, m.y) : null,
    press: click ? Math.max(0, 1 - (src - click.t) / 0.25) : 0,
    click: click ? { ...toScene(click.x, click.y), age: (src - click.t) / Math.max(1, speed) } : null,
    chip: speed >= 4 ? `${Math.round(speed)}× faster` : null,
    caption: captionAt(t),
    intro: t < INTRO ? 1 - ease((t - (INTRO - 0.6)) / 0.6) : 0,
    outro: t > BODY_END - 0.2 ? ease((t - (BODY_END - 0.2)) / 0.7) : 0,
    outroT: t - (BODY_END - 0.2),
  };
}

async function main() {
  const total = Math.round(TOTAL * FPS);
  // Only the source frames the cut uses are served to the renderer.
  const used = new Set();
  for (let f = 0; f < total; f++) used.add(stateAt(f).src);
  const order = [...used].sort((a, b) => a - b);
  const remap = new Map(order.map((src, i) => [src, i]));
  console.log(`Cut: ${TOTAL.toFixed(1)} s from ${(log.end - log.start).toFixed(0)} s of recording, ${order.length} source frames.`);

  const music = lineUp(MUSIC, 114.5, 113);
  // The drop lands as the walk starts.
  const musicStart = music.drop - outAt(need('recording'));
  console.log(`Music drop at ${outAt(need('recording')).toFixed(1)} s into the film.`);

  const chrome = await openHeadless(order.map((i) => path.join(IN, 'frames', frames[i].file)), { port: 4795 });
  try {
    await chrome.evaluate(`window.DEMO = ${JSON.stringify({ OW, OH, WIN, CSS_W, CSS_H, TITLE_H })}; true`);
    await chrome.evaluate(`Promise.all(['700 100px "Be Vietnam Pro"', '600 100px "Be Vietnam Pro"', '500 100px "Be Vietnam Pro"'].map((f) => document.fonts.load(f))).then(() => true)`);
    await chrome.evaluate(`${fs.readFileSync(path.join(HERE, 'page.js'), 'utf8')}; true`);
    await chrome.evaluate('loadFox()');
    const draw = async (f) => {
      const s = stateAt(f);
      s.src = remap.get(s.src);
      return Buffer.from(await chrome.evaluate(`renderFrame(${JSON.stringify(s)})`), 'base64');
    };
    if (PREVIEW) {
      const dir = OUT.replace(/\.mp4$/, '-preview');
      fs.mkdirSync(dir, { recursive: true });
      for (let i = 0; i < 24; i++) {
        const f = Math.round(((i + 0.5) / 24) * total);
        fs.writeFileSync(path.join(dir, `${String(i).padStart(2, '0')}-${(f / FPS).toFixed(1)}s.jpg`), await draw(f));
      }
      console.log(`Preview stills: ${dir}`);
      return;
    }
    const ff = spawn('ffmpeg', ['-y', '-v', 'error', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(FPS), '-i', '-',
      '-ss', musicStart.toFixed(3), '-i', MUSIC, '-map', '0:v', '-map', '1:a', '-t', TOTAL.toFixed(3),
      '-af', `afade=t=in:st=0:d=0.8,afade=t=out:st=${(TOTAL - 2).toFixed(3)}:d=2`,
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', OUT],
    { stdio: ['pipe', 'inherit', 'inherit'] });
    const started = Date.now();
    for (let f = 0; f < total; f++) {
      const jpg = await draw(f);
      if (!ff.stdin.write(jpg)) await new Promise((r) => ff.stdin.once('drain', r));
      if (f % 120 === 0) process.stdout.write(`\rDrawing frame ${f} of ${total}`);
    }
    ff.stdin.end();
    if (await new Promise((r) => ff.on('close', r)) !== 0) throw new Error('ffmpeg could not write the video.');
    process.stdout.write(`\rDrew ${total} frames in ${((Date.now() - started) / 1000).toFixed(0)} s.        \n`);
    console.log(`Demo: ${OUT}\n${MUSIC_CREDIT}`);
  } finally {
    chrome.close();
  }
}

main().then(() => process.exit(0), (err) => {
  console.error(err.message);
  process.exit(1);
});
