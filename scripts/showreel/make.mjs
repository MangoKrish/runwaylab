// npm run showreel: a 60 fps motion-graphics edit of one walk, cut to a music drop, with fresh captions each time.
// Everything stays on this computer: the real tracker runs in headless Chrome, and the frames are drawn there too.
//
//   npm run showreel -- ~/Downloads/2026-11-07_0827_5ee314ce.webm
//   npm run showreel -- walk.webm --music song.mp3 --drop 62.5 --palette ember --socials @name
//   npm run showreel -- walk.webm --intro "NO JUDGES.|JUST|MATH." --turn "PIVOT" --preview
//
// Options: --music <file> and --drop <seconds> (else the next unused drop in the library), --palette
// violet|ember|acid|ice, --seed <n>, --socials <handle> (else read from the clip's .json beside it),
// caption overrides --intro "A|B|C" --turn --posture --balance --sequence --chrono-title --chrono-sub,
// or --captions file.json with the same keys, --preview (12 stills instead of a video), --out <file>.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openHeadless } from '../headless.mjs';
import { processFrames } from '../../src/lib/process.mjs';
import { TRACKS } from '../reel.mjs';
import { planShowreel } from './plan.mjs';
import { pickMusic, lineUp, readHistory, remember, ROOT } from './music.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(ROOT, 'reels', '.cache');
const FPS = 60;

function parseArgs(argv) {
  const o = { clip: null, captions: {} };
  const keys = { '--intro': 'intro', '--turn': 'turn', '--posture': 'posture', '--balance': 'balance', '--sequence': 'sequence', '--chrono-title': 'chronoTitle', '--chrono-sub': 'chronoSub' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (keys[a]) o.captions[keys[a]] = a === '--intro' ? argv[++i].split('|').map((s) => s.trim()) : argv[++i];
    else if (a === '--captions') Object.assign(o.captions, JSON.parse(fs.readFileSync(argv[++i], 'utf8')));
    else if (a === '--music') o.music = path.resolve(argv[++i]);
    else if (a === '--drop') o.drop = Number(argv[++i]);
    else if (a === '--palette') o.palette = argv[++i];
    else if (a === '--seed') o.seed = Number(argv[++i]);
    else if (a === '--socials') o.socials = argv[++i];
    else if (a === '--out') o.out = path.resolve(argv[++i]);
    else if (a === '--preview') o.preview = true;
    else o.clip = path.resolve(a);
  }
  if (Number.isFinite(o.drop) && !o.music) throw new Error('--drop goes with --music: the drop is a time in that song.');
  if (o.captions.intro && o.captions.intro.length !== 3) throw new Error('--intro needs three parts, like "NO JUDGES.|JUST|MATH."');
  return o;
}

const hashOf = (file) => crypto.createHash('sha1').update(`${file}:${fs.statSync(file).size}:${fs.statSync(file).mtimeMs}`).digest('hex').slice(0, 16);

async function track(clip) {
  const cached = path.join(CACHE, `walk-${hashOf(clip)}.json`);
  if (fs.existsSync(cached)) return JSON.parse(fs.readFileSync(cached, 'utf8'));
  console.log('Tracking the walk with the real tracker.');
  const chrome = await openHeadless([clip], { port: 4792 });
  try {
    const raw = await chrome.analyze(0, 60, 0);
    const an = processFrames(raw.raw, { W: raw.W, H: raw.H, duration: raw.duration });
    const keep = {
      W: raw.W, H: raw.H, duration: raw.duration, phases: an.phases,
      frames: an.frames.map((f) => ({ t: f.t, status: f.status, pts: f.pts })),
      metrics: Object.fromEntries(Object.entries(an.metrics).map(([k, v]) => [k, v && typeof v === 'object' && 'value' in v ? { ok: v.ok, value: v.value } : v])),
      measured: { ok: an.measured.ok, points: an.measured.points, max: an.measured.max, parts: an.measured.parts?.map((p) => ({ label: p.label, points: p.points, max: p.max, seen: p.seen })) },
    };
    fs.mkdirSync(CACHE, { recursive: true });
    fs.writeFileSync(cached, JSON.stringify(keep));
    return keep;
  } finally {
    chrome.close();
  }
}

function socialsFor(clip, given) {
  if (given) return given;
  const side = clip.replace(/\.\w+$/, '.json');
  try {
    return JSON.parse(fs.readFileSync(side, 'utf8')).socials || '';
  } catch {
    return '';
  }
}

function sourceFps(clip) {
  const rate = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=avg_frame_rate', '-of', 'csv=p=0', clip]).toString().trim();
  const [n, d] = rate.split('/').map(Number);
  return d ? n / d : n || 30;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (!o.clip || !fs.existsSync(o.clip)) throw new Error('Pass a walk video: npm run showreel -- ~/Downloads/walk.webm');
  const an = await track(o.clip);
  if (!an.frames.some((f) => f.pts)) throw new Error('The tracker could not find a person in this clip.');

  const choice = pickMusic({ file: o.music ?? null, start: o.drop ?? null });
  const known = TRACKS[path.basename(choice.file)]?.bpm ?? null;
  const music = lineUp(choice.file, o.drop ?? choice.roughDrop, known);
  const history = readHistory();
  const seed = o.seed ?? (parseInt(hashOf(o.clip).slice(0, 8), 16) ^ Math.round(music.drop * 1000) ^ history.length);
  const plan = planShowreel(an, music, { seed, palette: o.palette ?? null, captions: o.captions, socials: socialsFor(o.clip, o.socials), history });

  const name = `showreel-${path.basename(o.clip).replace(/\.\w+$/, '')}-${plan.paletteName}-${history.length + 1}`;
  const out = o.out ?? path.join(ROOT, 'reels', `${name}.mp4`);
  console.log(`Music: ${path.basename(choice.file)}, drop at ${music.drop.toFixed(2)} s, ${music.bpm} BPM.`);
  console.log(`Palette: ${plan.paletteName}. Intro: ${plan.captions.intro.join(' / ')}. Turn: ${plan.captions.turn}. Length ${plan.seconds.toFixed(1)} s.`);
  if (plan.socials) console.log(`Tagging ${plan.socials}.`);

  // Every source frame as a JPEG, served to the renderer only.
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'runway-showreel-'));
  try {
    const fps = sourceFps(o.clip);
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', o.clip, '-vf', `fps=${fps}`, '-q:v', '3', '-start_number', '0', path.join(work, 'f%05d.jpg')]);
    const frames = fs.readdirSync(work).filter((f) => f.endsWith('.jpg')).sort().map((f) => path.join(work, f));
    const chrome = await openHeadless(frames, { port: 4793 });
    try {
      await chrome.evaluate(`window.WALK = ${JSON.stringify({ frames: an.frames })}; window.PLAN = ${JSON.stringify(plan)}; window.FRAME_COUNT = ${frames.length}; window.SRC_FPS = ${fps}; true`);
      await chrome.evaluate(`Promise.all(['700 100px "Be Vietnam Pro"', '600 100px "Be Vietnam Pro"'].map((f) => document.fonts.load(f))).then(() => true)`);
      await chrome.evaluate(`${fs.readFileSync(path.join(HERE, 'page.js'), 'utf8')}; true`);
      const total = Math.round(plan.seconds * FPS);
      if (o.preview) {
        const dir = out.replace(/\.mp4$/, '-preview');
        fs.mkdirSync(dir, { recursive: true });
        const at = Array.from({ length: 12 }, (_, i) => Math.round(((i + 0.5) / 12) * total));
        for (const f of at) fs.writeFileSync(path.join(dir, `${String(f).padStart(4, '0')}.jpg`), Buffer.from(await chrome.evaluate(`renderFrame(${f})`), 'base64'));
        console.log(`Preview stills: ${dir}`);
        return;
      }
      const ff = spawn('ffmpeg', ['-y', '-v', 'error', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(FPS), '-i', '-', '-ss', music.start.toFixed(3), '-i', choice.file,
        '-map', '0:v', '-map', '1:a', '-t', plan.seconds.toFixed(3), '-af', `afade=t=out:st=${(plan.seconds - 0.4).toFixed(3)}:d=0.4`,
        '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
      const started = Date.now();
      for (let f = 0; f < total; f++) {
        const jpg = Buffer.from(await chrome.evaluate(`renderFrame(${f})`), 'base64');
        if (!ff.stdin.write(jpg)) await new Promise((r) => ff.stdin.once('drain', r));
        if (f % 60 === 0) process.stdout.write(`\rDrawing frame ${f} of ${total}`);
      }
      ff.stdin.end();
      const code = await new Promise((r) => ff.on('close', r));
      if (code !== 0) throw new Error('ffmpeg could not write the video.');
      process.stdout.write(`\rDrew ${total} frames in ${((Date.now() - started) / 1000).toFixed(0)} s.        \n`);
    } finally {
      chrome.close();
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }

  remember({ clip: o.clip, music: choice.file, drop: music.drop, captions: plan.captions, palette: plan.paletteName, out });
  console.log(`Showreel: ${out}`);
  const credit = TRACKS[path.basename(choice.file)]?.credit;
  console.log(credit ? `Caption credit: ${credit}` : 'This music is not cleared for posting: Instagram may mute it. Add the song from Instagram\'s own library if so.');
}

main().then(() => process.exit(0), (err) => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
