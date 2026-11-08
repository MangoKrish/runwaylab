// Turns a recording from scripts/demo/record.mjs into the demo video: a 1920×1080, 60 fps product film with the
// site in a browser window, eased zooms, a drawn cursor, short captions, speed-ups over the waits, and music.
//
//   node scripts/demo/edit.mjs [--in reels/.demo] [--out reels/runwaylab-demo.mp4] [--music track.mp3] [--preview]
//
// With --music, the cut is fitted to that track instead of the music fitted to the cut: the film is as long as the
// track, the walk starts on its first beat, a break in the music becomes a title card, and the wall arrives on the
// beat that ends the break. Camera moves and captions land on the beat grid.
import { spawn, execFileSync } from 'node:child_process';
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
const OWN_MUSIC = args.includes('--music');
const MUSIC = OWN_MUSIC ? path.resolve(opt('--music')) : path.join(ROOT, 'vendor/music/lets-bring-this-house-down.mp3');
const MUSIC_CREDIT = OWN_MUSIC ? `Music: ${path.basename(MUSIC, path.extname(MUSIC))}` : 'Music: "Lets Bring This House Down" by Antti Luode, CC BY 3.0';

/**
 * The shape of a track: its length, the first sustained rise (where the beat comes in), and the first break after
 * it (a second or more well under the track's loud level), from loudness in 50 ms steps.
 */
function trackShape(file) {
  const rate = 4000;
  const buf = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(rate), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  const x = new Float32Array(buf.buffer, buf.byteOffset, buf.length >> 2);
  const step = 0.05;
  const n = Math.round(step * rate);
  const db = [];
  for (let a = 0; a + n <= x.length; a += n) {
    let e = 0;
    for (let i = a; i < a + n; i++) e += x[i] * x[i];
    // Floored at -80 dB: true digital silence (an encoder's first frames) would otherwise look like a huge rise.
    db.push(Math.max(-80, 10 * Math.log10(e / n + 1e-12)));
  }
  const avg = (a, b) => {
    let s = 0;
    for (let i = a; i < b; i++) s += db[i];
    return s / Math.max(1, b - a);
  };
  // The track's full level: its 90th percentile. The hit is the first moment, from 4 s in so the film has room for
  // its title, that the track reaches that level and stays there for two seconds. A swell into the beat does not.
  const loud = [...db].sort((a, b) => a - b)[Math.floor(db.length * 0.9)];
  let hit = 80;
  for (let i = 80; i < db.length - 40; i++) if (db[i] > loud - 6 && avg(i, i + 40) > loud - 6) { hit = i; break; }
  let brk = null;
  for (let i = hit + 40, run = 0; i < db.length; i++) {
    if (db[i] < loud - 15) {
      run++;
      if (run === 20 && !brk) brk = { from: (i - run + 1) * step };
    } else {
      if (brk) { brk.to = i * step; break; }
      run = 0;
    }
  }
  return { length: x.length / rate, hit: hit * step, brk: brk?.to ? brk : null };
}

const SYNC = OWN_MUSIC ? (() => {
  const shape = trackShape(MUSIC);
  const { beat } = lineUp(MUSIC, shape.hit);
  return { length: shape.length, walk: shape.hit, beat, breakFrom: shape.brk?.from ?? null, wall: shape.brk?.to ?? null };
})() : null;

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

/**
 * When the wall is on screen. "wall" is logged at the click, and the page takes a moment to change; newer recordings
 * log "wall-shown". For older ones: the recorder waits 1.2 s after the wall loads before it zooms to the stats.
 */
function wallShown() {
  if ('wall-shown' in M) return M['wall-shown'];
  const stats = log.focus.find((f) => f.t > need('wall') && f.rect);
  return stats ? Math.max(need('wall'), stats.t - 1.3) : need('wall');
}

// ── the cut: source spans and how fast each plays ──
const INTRO = SYNC ? 3.4 : 3.0;
const OUTRO = SYNC ? 4.4 : 4.8;
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
  [wallShown(), need('open-walk'), 1.9],
  [need('open-walk'), need('end') - 1.6, 1.05],
];
// Fitted to a track: three sections (setup, walk to verdict, the wall), each sped up or slowed down evenly to end
// where the music says. The break between the second and third is left empty for the title card.
if (SYNC) {
  const WALK_AT = 5;
  const WALL_AT = 11;
  const secondEnd = SYNC.breakFrom ?? null;
  const sections = secondEnd
    ? [[0, WALK_AT, INTRO, SYNC.walk], [WALK_AT, WALL_AT, SYNC.walk, secondEnd], [WALL_AT, spans.length, SYNC.wall, SYNC.length - OUTRO]]
    : [[0, WALK_AT, INTRO, SYNC.walk], [WALK_AT, spans.length, SYNC.walk, SYNC.length - OUTRO]];
  // The two waits (the analysis bar and Gemini thinking) get a fixed time on screen, however long they really took,
  // so a slow API call does not speed up the walk. Everything else in the section shares what is left.
  const WAITS = new Map([[7, 2.0], [9, 2.4]]);
  for (const [i, secs] of WAITS) spans[i][2] = (spans[i][1] - spans[i][0]) / secs;
  for (const [a, b, from, to] of sections) {
    const free = [];
    let fixed = 0;
    for (let i = a; i < b; i++) {
      if (WAITS.has(i)) fixed += WAITS.get(i);
      else free.push(i);
    }
    const natural = free.reduce((sum, i) => sum + (spans[i][1] - spans[i][0]) / spans[i][2], 0);
    const k = natural / (to - from - fixed);
    for (const i of free) spans[i][2] *= k;
  }
}
const sectionStart = (i) => (SYNC?.wall && i === 11 ? SYNC.wall : null);

let at = INTRO;
const timeline = spans.map(([from, to, speed], i) => {
  at = sectionStart(i) ?? at;
  const span = { from, to, speed, start: at, end: at + (to - from) / speed };
  at = span.end;
  return span;
});
const BODY_END = at;
const TOTAL = SYNC ? SYNC.length : BODY_END + OUTRO;
const BREAK = SYNC?.wall ? { from: timeline[10].end, to: SYNC.wall } : null;

const srcAt = (t) => {
  if (t <= INTRO) return timeline[0].from;
  let prev = timeline[0].from;
  for (const s of timeline) {
    if (t < s.start) return prev; // the break: hold the last frame under the card
    if (t < s.end) return s.from + (t - s.start) * s.speed;
    prev = s.to;
  }
  return timeline.at(-1).to;
};
const outAt = (src) => {
  // A moment on the line between two spans belongs to the later one, so the wall starts after the break.
  for (const s of timeline) if (src >= s.from && src < s.to) return s.start + (src - s.from) / s.speed;
  for (const s of timeline) if (src === s.to) return s.end;
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
// On the beat grid when there is one: a move or a caption that starts on a beat feels cut to the music.
const onBeat = (t) => (SYNC && t > INTRO ? SYNC.walk + Math.round((t - SYNC.walk) / SYNC.beat) * SYNC.beat : t);
const keys = log.focus.map((f) => ({ t: onBeat(outAt(f.t)), target: clampCam(targetFor(f)) })).sort((a, b) => a.t - b.t);
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
  [outAt(wallShown()) + 1.6, 3.2, BREAK ? 'Stored in Tiger Data, live for everyone' : 'Every walk goes on the wall, stored in Tiger Data'],
  [outAt(need('open-walk')) + 1.2, 3.2, 'And every walker gets an edit'],
].map(([start, life, text]) => [onBeat(start), life, text]);
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
  // A small push-in on the hits: the beat coming in, and the music coming back after the break.
  const hits = SYNC ? [SYNC.walk, SYNC.wall].filter((h) => h !== null) : [];
  const punch = hits.reduce((p, h) => (t >= h && t < h + 0.7 ? Math.max(p, 0.045 * Math.exp(-(t - h) * 6)) : p), 0);
  const inBreak = BREAK && t >= BREAK.from && t < BREAK.to;
  return {
    t,
    src: frameIndexAt(src),
    cam: view,
    windowAlpha,
    lift: (1 - ease(winIn)) * 40,
    cursor: m && t > INTRO ? toScene(m.x, m.y) : null,
    press: click ? Math.max(0, 1 - (src - click.t) / 0.25) : 0,
    click: click ? { ...toScene(click.x, click.y), age: (src - click.t) / Math.max(1, speed) } : null,
    chip: speed >= 4 && !inBreak ? `${Math.round(speed)}× faster` : null,
    caption: inBreak ? null : captionAt(t),
    punch,
    brk: inBreak ? { age: t - BREAK.from, life: BREAK.to - BREAK.from } : null,
    serif: !!SYNC,
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

  let musicStart = 0;
  if (SYNC) {
    console.log(`Fitted to the track: ${SYNC.length.toFixed(1)} s, beat ${(60 / SYNC.beat).toFixed(0)} BPM, walk on ${SYNC.walk.toFixed(2)} s${BREAK ? `, break ${BREAK.from.toFixed(2)} to ${BREAK.to.toFixed(2)} s, wall on the beat after it` : ''}.`);
    console.log(`Speeds: ${timeline.map((s) => s.speed.toFixed(2)).join(' ')}`);
  } else {
    const music = lineUp(MUSIC, 114.5, 113);
    // The drop lands as the walk starts.
    musicStart = music.drop - outAt(need('recording'));
    console.log(`Music drop at ${outAt(need('recording')).toFixed(1)} s into the film.`);
  }

  const chrome = await openHeadless(order.map((i) => path.join(IN, 'frames', frames[i].file)), { port: 4795 });
  try {
    await chrome.evaluate(`window.DEMO = ${JSON.stringify({ OW, OH, WIN, CSS_W, CSS_H, TITLE_H })}; true`);
    await chrome.evaluate(`Promise.all(['700 100px "Be Vietnam Pro"', '600 100px "Be Vietnam Pro"', '500 100px "Be Vietnam Pro"', '600 100px "Bodoni Moda"', 'italic 400 100px "Bodoni Moda"', 'italic 600 100px "Bodoni Moda"'].map((f) => document.fonts.load(f))).then(() => true)`);
    await chrome.evaluate(`${fs.readFileSync(path.join(HERE, 'page.js'), 'utf8')}; true`);
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
      // A track brought in from outside can be mixed quiet: bring it to streaming loudness, then fade the last bar.
      '-af', SYNC ? `loudnorm=I=-14:TP=-1.5:LRA=11,afade=t=out:st=${(TOTAL - 1.2).toFixed(3)}:d=1.2` :`afade=t=in:st=0:d=0.8,afade=t=out:st=${(TOTAL - 2).toFixed(3)}:d=2`,
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
