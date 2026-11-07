// Turns walk recordings into a vertical, Instagram-style reel: cuts on the beat, punch-in zooms, the turn in slow
// motion, a skeleton hook and a score card. Everything runs on this computer: the real tracker in a headless
// Chrome finds the walk in each clip, and ffmpeg does the editing. From the project folder:
//
//   npm run reel                                  every clip in recordings/, with the app's house track
//   npm run reel -- ~/Downloads/walks --music song.mp3 --music-start 32 --out pitch.mp4
//
// Options: --music <file>, --bpm <n> (skip tempo detection), --music-start <seconds> (snapped to a beat, to start
// at the drop), --max <n> clips (default 4, best scores first), --title <text>, --out <file>, --keep (keep parts).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openHeadless } from './headless.mjs';
import { processFrames } from '../src/lib/process.mjs';
import { BONES } from '../src/lib/landmarks.mjs';
import { gradeFor } from '../src/lib/score.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const VIDEO = /\.(mp4|mov|m4v|webm)$/i;
const OUT_W = 1080;
const OUT_H = 1920;
const FPS = 30;
const ACCENT = '#a78bfa';
// The app's own tracks, with the tempo already known.
export const TRACKS = {
  'lets-bring-this-house-down.mp3': { bpm: 113, credit: 'Music: "Lets Bring This House Down" by Antti Luode, CC BY 3.0' },
  'rollin-at-5-electronic.mp3': { bpm: 105, credit: 'Music: "Rollin at 5" by Kevin MacLeod, CC BY 3.0' },
  'aitech.mp3': { bpm: 105, credit: 'Music: "Aitech" by Kevin MacLeod, CC BY 3.0' },
};

// ── options ──
function parseArgs(argv) {
  const opts = { inputs: [], music: path.join(ROOT, 'vendor/music/lets-bring-this-house-down.mp3'), max: 4, title: 'Can code judge a runway walk?', out: null, keep: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--music') opts.music = argv[++i];
    else if (a === '--bpm') opts.bpm = Number(argv[++i]);
    else if (a === '--music-start') opts.musicStart = Number(argv[++i]);
    else if (a === '--max') opts.max = Number(argv[++i]);
    else if (a === '--title') opts.title = argv[++i];
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '--keep') opts.keep = true;
    else opts.inputs.push(a);
  }
  if (!opts.inputs.length) opts.inputs.push(path.join(ROOT, 'recordings'));
  return opts;
}

function findClips(inputs) {
  const found = [];
  for (const input of inputs) {
    if (!fs.existsSync(input)) throw new Error(`Not found: ${input}`);
    if (fs.statSync(input).isDirectory()) {
      for (const f of fs.readdirSync(input).sort()) if (VIDEO.test(f)) found.push(path.join(input, f));
    } else if (VIDEO.test(input)) found.push(input);
  }
  return found;
}

// ── music ──
/**
 * Finds the tempo and where the first beat falls, from how sharply the loudness rises. Good for music with a clear
 * beat; for anything else pass --bpm. Returns seconds per beat and the first beat's time.
 */
export function detectBeat(samples, rate, knownBpm = null) {
  const hop = 128;
  const win = 512;
  const env = [];
  let prev = 0;
  for (let i = 1; i + win < samples.length; i += hop) {
    let energy = 0;
    for (let j = 0; j < win; j++) {
      const d = samples[i + j] - samples[i + j - 1]; // The difference favours drums over held notes.
      energy += d * d;
    }
    const level = Math.log(1e-9 + energy);
    env.push(Math.max(0, level - prev));
    prev = level;
  }
  const mean = env.reduce((s, v) => s + v, 0) / env.length;
  const e = env.map((v) => v - mean);
  const at = (t) => {
    const i = Math.floor(t);
    return i + 1 < e.length ? e[i] + (e[i + 1] - e[i]) * (t - i) : 0;
  };
  const framesPerSecond = rate / hop;
  // How well a tempo explains the onsets, checked a few beats ahead so small tempo errors add up and show.
  const fit = (candidate) => {
    const lag = (60 / candidate) * framesPerSecond;
    let score = 0;
    for (let i = 0; i + 8 * lag < e.length; i++) score += e[i] * (at(i + lag) + 0.5 * at(i + 2 * lag) + 0.5 * at(i + 4 * lag) + 0.5 * at(i + 8 * lag));
    return score;
  };
  let bpm = knownBpm;
  if (!bpm) {
    let best = -Infinity;
    for (let candidate = 80; candidate <= 160; candidate += 0.5) {
      const score = fit(candidate) * Math.exp(-0.5 * (Math.log2(candidate / 118) / 0.35) ** 2); // Prefer walking pace.
      if (score > best) {
        best = score;
        bpm = candidate;
      }
    }
    let fine = -Infinity;
    const coarse = bpm;
    for (let candidate = coarse - 1; candidate <= coarse + 1; candidate += 0.05) {
      const score = fit(candidate);
      if (score > fine) {
        fine = score;
        bpm = candidate;
      }
    }
    // Nearly all music is made at a whole number of beats a minute.
    bpm = Math.abs(bpm - Math.round(bpm)) <= 0.4 ? Math.round(bpm) : Math.round(bpm * 100) / 100;
  }
  const period = (60 / bpm) * framesPerSecond;
  let bestOffset = 0;
  let bestSum = -Infinity;
  for (let o = 0; o < period; o++) {
    let sum = 0;
    for (let t = o; t < env.length; t += period) sum += env[Math.round(t)] ?? 0;
    if (sum > bestSum) {
      bestSum = sum;
      bestOffset = o;
    }
  }
  // A rise is seen when the sound enters the analysis window, one window before it starts.
  return { bpm, beat: 60 / bpm, firstBeat: (bestOffset * hop + win) / rate };
}

function readMusic(file) {
  const rate = 11025;
  const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-t', '120', '-ac', '1', '-ar', String(rate), '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  return { samples: new Float32Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 4)), rate };
}

// ── where the walker is ──
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[s.length >> 1] : null;
};

function walkerBox(an, from, to) {
  const boxes = an.frames.filter((f) => f.pts && f.t >= from && f.t <= to && f.status !== 'no-person').map((f) => {
    const present = f.pts.filter(Boolean);
    const xs = present.map((p) => p[0]);
    const ys = present.map((p) => p[1]);
    return { cx: (Math.min(...xs) + Math.max(...xs)) / 2, cy: (Math.min(...ys) + Math.max(...ys)) / 2 };
  });
  if (!boxes.length) return null;
  return { cx: median(boxes.map((b) => b.cx)), cy: median(boxes.map((b) => b.cy)) };
}

const even = (n) => Math.max(2, Math.round(n / 2) * 2);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** A 9:16 window on the source, following the walker, tighter when zoom is above 1. */
function cropFor(an, from, to, zoom) {
  let ch = an.H;
  let cw = (an.H * 9) / 16;
  if (cw > an.W) {
    cw = an.W;
    ch = (an.W * 16) / 9;
  }
  cw = even(cw / zoom);
  ch = even(ch / zoom);
  const box = walkerBox(an, from, to);
  const cx = box?.cx ?? an.W / 2;
  const cy = zoom > 1 && box ? box.cy : an.H / 2;
  return { x: Math.round(clamp(cx - cw / 2, 0, an.W - cw)), y: Math.round(clamp(cy - ch / 2, 0, an.H - ch)), w: cw, h: ch };
}

// ── the edit ──
/** Lays out the reel in beats: a hook, then each walk toward the camera, the turn and the walk back, then the score. */
export function planReel(walks, beat) {
  const parts = [];
  const best = walks[0];
  const hookFrame = pickHookFrame(best.an);
  parts.push({ kind: 'hook', walk: best, beats: 4, at: hookFrame.t, frame: hookFrame });
  walks.forEach((walk, n) => {
    const { phases, duration } = walk.an;
    const approach = phases.approach ?? [0, duration * 0.45];
    const turn = phases.turn ?? null;
    const back = phases.back ?? null;
    const chunk = 2 * beat;
    const room = approach[1] - approach[0];
    const count = clamp(Math.floor(room / chunk), 1, walks.length > 2 ? 2 : 3);
    // Jump cuts forward through the walk, alternating wide and close, so each cut lands on a beat.
    for (let i = 0; i < count; i++) {
      const start = approach[0] + ((room - chunk) * i) / Math.max(1, count - 1);
      parts.push({ kind: 'clip', walk, start: Math.max(0, start), beats: 2, speed: 1, zoom: i % 2 ? 1.35 : 1, flash: i === 0, label: i === 0 ? n + 1 : null });
    }
    if (turn) {
      const mid = (turn[0] + turn[1]) / 2;
      const src = 4 * beat * 0.5;
      parts.push({ kind: 'clip', walk, start: Math.max(0, mid - src / 2), beats: 4, speed: 0.5, zoom: 1.15, flash: false });
    }
    if (back && back[1] - back[0] > 2 * beat * 1.5) {
      parts.push({ kind: 'clip', walk, start: back[0], beats: 2, speed: 1.5, zoom: 1, flash: false });
    }
  });
  parts.push({ kind: 'outro', walk: best, beats: 6, at: hookFrame.t, frame: hookFrame });
  return parts;
}

function pickHookFrame(an) {
  const [a0, a1] = an.phases.approach ?? [0, an.duration];
  const good = an.frames.filter((f) => f.pts && f.status === 'valid' && f.t >= a0 && f.t <= a1);
  const pool = good.length ? good : an.frames.filter((f) => f.pts);
  return pool[Math.floor(pool.length * 0.7)] ?? { t: an.duration / 2, pts: null };
}

// ── cards ──
const FONT = `font-family:'Be Vietnam Pro',system-ui,sans-serif;`;
const SHADOW = 'text-shadow:0 4px 30px rgba(0,0,0,.55),0 1px 3px rgba(0,0,0,.6);';
const card = (inner) => `<div style="position:relative;width:${OUT_W}px;height:${OUT_H}px;${FONT}color:#fff">${inner}</div>`;
const escape = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function titleCard(text) {
  return card(`<div style="position:absolute;left:80px;right:80px;top:260px;font-size:96px;font-weight:800;line-height:1.02;letter-spacing:-.03em;${SHADOW}">${escape(text)}</div>
  <div style="position:absolute;left:80px;bottom:200px;font-size:40px;font-weight:600;letter-spacing:.02em;color:${ACCENT};${SHADOW}">RunwayLab</div>`);
}

function labelCard(n, walk) {
  const score = walk.an.measured.ok ? `${walk.an.measured.points}/${walk.an.measured.max}` : 'not scored';
  return card(`<div style="position:absolute;left:64px;bottom:220px;display:flex;align-items:baseline;gap:22px;${SHADOW}">
    <span style="font-size:44px;font-weight:600;opacity:.85">Walk ${n}</span>
    <span style="font-size:88px;font-weight:800;letter-spacing:-.03em">${escape(score)}</span></div>`);
}

function outroCard(walk, credit) {
  const m = walk.an.measured;
  const grade = gradeFor(m.ok ? (m.points / m.max) * 100 : 0);
  return card(`<div style="position:absolute;left:0;right:0;top:560px;text-align:center;${SHADOW}">
      <div style="font-size:44px;font-weight:600;opacity:.85">Best walk</div>
      <div style="font-size:260px;font-weight:800;letter-spacing:-.05em;line-height:1">${m.ok ? m.points : '–'}<span style="font-size:110px;opacity:.7">/${m.max ?? 70}</span></div>
      <div style="font-size:64px;font-weight:700;color:${ACCENT};margin-top:10px">${escape(grade.label)}</div>
      <div style="font-size:38px;font-weight:500;opacity:.85;margin-top:28px">Measured from movement alone</div></div>
    <div style="position:absolute;left:0;right:0;bottom:250px;text-align:center;${SHADOW}">
      <div style="font-size:72px;font-weight:800;letter-spacing:-.02em">RunwayLab</div>
      <div style="font-size:38px;font-weight:500;opacity:.85;margin-top:8px">runwaylab-mu.vercel.app</div></div>
    ${credit ? `<div style="position:absolute;left:60px;right:60px;bottom:90px;text-align:center;font-size:24px;opacity:.7">${escape(credit)}</div>` : ''}`);
}

/** The tracked skeleton for one frame, drawn in the app's violet, placed where that frame sits in the crop. */
function skeletonCard(pts, crop) {
  if (!pts) return card('');
  const s = OUT_W / crop.w;
  const map = (p) => [(p[0] - crop.x) * s, (p[1] - crop.y) * s];
  const lines = BONES.filter(([a, b]) => pts[a] && pts[b]).map(([a, b]) => {
    const [x1, y1] = map(pts[a]);
    const [x2, y2] = map(pts[b]);
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  }).join('');
  const dots = pts.filter(Boolean).map((p) => {
    const [x, y] = map(p);
    return `<circle cx="${x}" cy="${y}" r="9"/>`;
  }).join('');
  return card(`<svg width="${OUT_W}" height="${OUT_H}" style="position:absolute;inset:0;filter:drop-shadow(0 0 14px ${ACCENT})">
    <g stroke="${ACCENT}" stroke-width="9" stroke-linecap="round">${lines}</g><g fill="#fff">${dots}</g></svg>`);
}

// ── ffmpeg ──
const LOOK = 'eq=contrast=1.08:saturation=1.12,vignette=PI/5,unsharp=5:5:0.4';
const ENCODE = ['-r', String(FPS), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-an'];

function ffmpeg(args) {
  execFileSync('ffmpeg', ['-y', '-v', 'error', ...args], { stdio: ['ignore', 'ignore', 'inherit'] });
}

function renderClip(part, frames, out, overlay) {
  const seconds = frames / FPS;
  const src = seconds * part.speed;
  const crop = cropFor(part.walk.an, part.start, part.start + src, part.zoom);
  const chain = [`crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}`, `scale=${OUT_W}:${OUT_H}`, `setpts=PTS/${part.speed}`, `fps=${FPS}`, LOOK];
  if (part.flash) chain.push('fade=t=in:st=0:d=0.15:color=white');
  const inputs = ['-ss', part.start.toFixed(3), '-t', (src + 0.2).toFixed(3), '-i', part.walk.file];
  if (overlay) {
    ffmpeg([...inputs, '-loop', '1', '-i', overlay, '-filter_complex', `[0:v]${chain.join(',')}[v];[v][1:v]overlay=0:0`, '-frames:v', String(frames), ...ENCODE, out]);
  } else {
    ffmpeg([...inputs, '-vf', chain.join(','), '-frames:v', String(frames), ...ENCODE, out]);
  }
}

function renderStill(part, frames, out, overlays, { blur = false } = {}) {
  const seconds = frames / FPS;
  const still = `${out}.png`;
  ffmpeg(['-ss', part.at.toFixed(3), '-i', part.walk.file, '-frames:v', '1', still]);
  const crop = cropFor(part.walk.an, part.at - 0.5, part.at + 0.5, 1);
  // A slow push in, so the frozen frame still feels alive.
  const base = [`crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}`, `scale=${OUT_W}:${OUT_H}`, `zoompan=z='min(1+0.0011*on,1.15)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${OUT_W}x${OUT_H}:fps=${FPS}`, LOOK];
  if (blur) base.push('gblur=sigma=26', 'eq=brightness=-0.18');
  let graph = `[0:v]${base.join(',')}[v0]`;
  overlays.forEach((file, i) => { graph += `;[v${i}][${i + 1}:v]overlay=0:0[v${i + 1}]`; });
  graph += `;[v${overlays.length}]fade=t=out:st=${(seconds - 0.12).toFixed(3)}:d=0.12:color=white[out]`;
  ffmpeg(['-loop', '1', '-framerate', String(FPS), '-t', seconds.toFixed(3), '-i', still, ...overlays.flatMap((f) => ['-loop', '1', '-i', f]), '-filter_complex', graph, '-map', '[out]', '-frames:v', String(frames), ...ENCODE, out]);
  return crop;
}

// ── main ──
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const clips = findClips(opts.inputs);
  if (!clips.length) {
    console.log(`No videos found in ${opts.inputs.join(', ')}. Pass a folder or files: npm run reel -- ~/Downloads/walks`);
    process.exit(1);
  }
  if (!fs.existsSync(opts.music)) throw new Error(`Music not found: ${opts.music}`);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'runway-reel-'));
  const out = path.resolve(opts.out ?? path.join(ROOT, 'reels', `reel-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.mp4`));
  fs.mkdirSync(path.dirname(out), { recursive: true });

  console.log(`Finding the walk in ${clips.length} ${clips.length === 1 ? 'clip' : 'clips'} with the real tracker.`);
  const chrome = await openHeadless(clips);
  try {
    const walks = [];
    for (let i = 0; i < clips.length; i++) {
      const raw = await chrome.analyze(i);
      const an = processFrames(raw.raw, { W: raw.W, H: raw.H, duration: raw.duration });
      const score = an.measured.ok ? an.measured.points : -1;
      console.log(`  ${path.basename(clips[i])}: ${an.phases.shape}, ${an.measured.ok ? `${an.measured.points}/${an.measured.max}` : 'no score'}`);
      if (an.frames.some((f) => f.pts)) walks.push({ file: clips[i], an: { ...an, W: raw.W, H: raw.H, duration: raw.duration }, score });
    }
    if (!walks.length) throw new Error('No clip had a person the tracker could follow.');
    walks.sort((a, b) => b.score - a.score);
    const chosen = walks.slice(0, Math.max(1, opts.max));

    const known = TRACKS[path.basename(opts.music)];
    const music = readMusic(opts.music);
    const beat = detectBeat(music.samples, music.rate, opts.bpm || known?.bpm);
    let musicStart = beat.firstBeat;
    if (Number.isFinite(opts.musicStart)) musicStart = beat.firstBeat + Math.round((opts.musicStart - beat.firstBeat) / beat.beat) * beat.beat;
    console.log(`Music: ${beat.bpm} beats a minute${opts.bpm || known ? '' : ' (detected; pass --bpm if the cuts feel off)'}, starting at ${musicStart.toFixed(2)} s.`);

    const parts = planReel(chosen, beat.beat);
    const files = [];
    let beatsSoFar = 0;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      // Frames counted from the running beat clock, so rounding never adds up and every cut stays on its beat.
      const frames = Math.round((beatsSoFar + part.beats) * beat.beat * FPS) - Math.round(beatsSoFar * beat.beat * FPS);
      beatsSoFar += part.beats;
      const file = path.join(work, `part${String(i).padStart(2, '0')}.mp4`);
      process.stdout.write(`\rEditing part ${i + 1} of ${parts.length}`);
      if (part.kind === 'hook') {
        const crop = cropFor(part.walk.an, part.at - 0.5, part.at + 0.5, 1);
        const skeleton = path.join(work, 'skeleton.png');
        const title = path.join(work, 'title.png');
        await chrome.png(skeletonCard(part.frame.pts, crop), OUT_W, OUT_H, skeleton);
        await chrome.png(titleCard(opts.title), OUT_W, OUT_H, title);
        renderStill(part, frames, file, [skeleton, title]);
      } else if (part.kind === 'outro') {
        const score = path.join(work, 'outro.png');
        await chrome.png(outroCard(part.walk, known?.credit), OUT_W, OUT_H, score);
        renderStill(part, frames, file, [score], { blur: true });
      } else {
        let overlay = null;
        if (part.label) {
          overlay = path.join(work, `label${part.label}.png`);
          await chrome.png(labelCard(part.label, part.walk), OUT_W, OUT_H, overlay);
        }
        renderClip(part, frames, file, overlay);
      }
      files.push(file);
    }
    process.stdout.write('\n');

    const list = path.join(work, 'list.txt');
    fs.writeFileSync(list, files.map((f) => `file '${f}'`).join('\n'));
    const silent = path.join(work, 'silent.mp4');
    ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', silent]);
    const total = parts.reduce((s, p) => s + p.beats, 0) * beat.beat;
    ffmpeg(['-i', silent, '-ss', musicStart.toFixed(3), '-i', opts.music, '-map', '0:v', '-map', '1:a', '-t', total.toFixed(3),
      '-af', `afade=t=in:st=0:d=0.05,afade=t=out:st=${(total - 1.5).toFixed(3)}:d=1.5`, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out]);

    console.log(`\nReel: ${out}\n${total.toFixed(1)} s, ${chosen.length} ${chosen.length === 1 ? 'walk' : 'walks'}, 1080 × 1920.`);
    if (known?.credit) console.log(`Put this in the caption too: ${known.credit}`);
  } finally {
    chrome.close();
    if (!opts.keep) fs.rmSync(work, { recursive: true, force: true });
    else console.log(`Parts kept in ${work}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then(() => process.exit(0), (err) => {
    console.error(`\n${err.message}`);
    process.exit(1);
  });
}
