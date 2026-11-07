// Post a recorded walk to the wall, with its edit, from this computer. For walkers who agreed to be shown.
//   node scripts/wall-post.mjs ~/Downloads/walk.mp4 --name "Danny" --edit reels/showreel-danny.mp4
// Options: --name (required, up to 30 characters), --edit <reel.mp4> (shown on the wall), --at <ISO time>
// (defaults to the time in the clip's file name, else now).
//
// The score is worked out exactly as the wall's server does it, from the real tracker's skeleton, so a walk
// posted this way can never carry a number the site would not give. The edit is copied at web size into
// media/walks/, which Vercel serves and git ignores (*.mp4). Remove a post with: node scripts/wall-db.mjs delete <id>
import { execFileSync } from 'node:child_process';
import crypto, { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(ROOT, '.env.local');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

const { openHeadless } = await import('./headless.mjs');
const { processFrames, summarizeFrames } = await import('../src/lib/process.mjs');
const { totalScore } = await import('../src/lib/score.mjs');
const { cleanFrames, buildDetail } = await import('../api/wall.mjs');
const { ownerHash, secret } = await import('../api/_common.mjs');
const { getStore, closePool } = await import('../api/_wallstore.mjs');

const CACHE = path.join(ROOT, 'reels', '.cache');
const MEDIA = path.join(ROOT, 'media', 'walks');
/** Posts made from this computer belong to the organiser, not to a browser token. */
export const ORGANISER = 'organiser:runwaylab';

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--name') o.name = argv[++i];
    else if (a === '--edit') o.edit = path.resolve(argv[++i]);
    else if (a === '--at') o.at = argv[++i];
    else o.clip = path.resolve(a);
  }
  return o;
}

// Same cache key as npm run showreel, so a walk already tracked for its edit is not tracked again.
const hashOf = (file) => crypto.createHash('sha1').update(`${file}:${fs.statSync(file).size}:${fs.statSync(file).mtimeMs}`).digest('hex').slice(0, 16);

async function track(clip) {
  const cached = path.join(CACHE, `walk-${hashOf(clip)}.json`);
  if (fs.existsSync(cached)) return JSON.parse(fs.readFileSync(cached, 'utf8'));
  console.log('Tracking the walk with the real tracker.');
  const chrome = await openHeadless([clip], { port: 4794 });
  try {
    const raw = await chrome.analyze(0, 60, 0);
    const an = processFrames(raw.raw, { W: raw.W, H: raw.H, duration: raw.duration });
    return { W: raw.W, H: raw.H, duration: raw.duration, frames: an.frames.map((f) => ({ t: f.t, status: f.status, pts: f.pts })) };
  } finally {
    chrome.close();
  }
}

/** 2026-11-07_1402_... → that local time; otherwise null. */
function timeFromName(clip) {
  const m = path.basename(clip).match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).toISOString() : null;
}

function webCopy(edit, slug) {
  fs.mkdirSync(MEDIA, { recursive: true });
  const video = path.join(MEDIA, `${slug}.mp4`);
  const poster = path.join(MEDIA, `${slug}.jpg`);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', edit, '-vf', 'scale=720:-2', '-c:v', 'libx264', '-preset', 'slow', '-crf', '25',
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', video]);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-ss', '4', '-i', edit, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '4', poster]);
  return { src: `media/walks/${slug}.mp4`, poster: `media/walks/${slug}.jpg` };
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (!o.clip || !fs.existsSync(o.clip)) throw new Error('Pass the walk recording: node scripts/wall-post.mjs walk.mp4 --name "Name"');
  const name = String(o.name ?? '').trim().slice(0, 30);
  if (!name) throw new Error('Give a name to show: --name "Danny"');
  if (o.edit && !fs.existsSync(o.edit)) throw new Error(`No edit at ${o.edit}`);
  if (!secret()) throw new Error('No WALL_SECRET in .env.local.');
  const store = getStore();
  if (!store) throw new Error('No DATABASE_URL in .env.local.');

  const an = await track(o.clip);
  const { W, H } = an;
  // The server refuses points outside the picture; the tracker can place a hidden heel a few pixels past the edge.
  const clamp = (v, max) => Math.min(Math.max(v, 0), max);
  const posted = an.frames.map((f) => ({ t: f.t, s: f.status, p: f.pts ? f.pts.map((q) => (q ? [clamp(q[0], W), clamp(q[1], H)] : null)) : null }));
  const frames = cleanFrames(posted, W, H);
  if (!frames) throw new Error('The tracking data did not pass the wall\'s checks.');

  const summary = summarizeFrames(frames, { W, H });
  if (!summary.measured.ok) throw new Error(`The wall would not score this walk: ${summary.measured.reason}`);
  const duration = Math.min(an.duration, frames.at(-1).t + 0.5);

  const id = randomUUID();
  const detail = buildDetail(summary, null, frames, duration);
  if (o.edit) detail.video = webCopy(o.edit, id);
  const walk = {
    id,
    postedAt: o.at ? new Date(o.at).toISOString() : timeFromName(o.clip) ?? new Date().toISOString(),
    name,
    ownerHash: ownerHash(ORGANISER),
    width: W,
    height: H,
    duration,
    total: totalScore(summary.measured, null),
    measured: summary.measured.points,
    detail,
  };
  await store.create(walk, frames);
  console.log(`Posted ${name}: ${walk.measured}/70 measured, ${frames.length} frames${o.edit ? ', with the edit' : ''}. Id ${id}`);
  await closePool();
}

main().then(() => process.exit(0), (err) => {
  console.error(err.message);
  process.exit(1);
});
