// Music for the showreel: finds the drops in local tracks, lines each up on the beat, and remembers which ones were
// used so every edit gets a different song or section. Long mixes hold many songs, so they hold many drops.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { detectBeat } from '../reel.mjs';

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const CACHE = path.join(ROOT, 'reels', '.cache');
const HISTORY = path.join(ROOT, 'reels', '.showreel-history.json');
const AUDIO = /\.(mp3|m4a|wav|flac|aac)$/i;
// Only music meant for edits: the folder ~/Music/RunwayLab (drop any track there), the app's own tracks, and the
// phonk mixes already on this Mac. Never the whole Music or Downloads folder, which hold personal recordings.
export const LIBRARY_DIRS = [path.join(os.homedir(), 'Music/RunwayLab'), path.join(ROOT, 'vendor/music')];
const MIX_DIRS = [path.join(os.homedir(), 'Downloads/Audio'), path.join(os.homedir(), 'Music/Music/Media.localized/Music')];
const MIX = /phonk|funk/i;

const duration = (file) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString()) || 0;

function walkDir(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith('.') || /whatsapp|voice|memo/i.test(name)) continue;
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walkDir(full, out);
    else if (AUDIO.test(name)) out.push(full);
  }
  return out;
}

/** Every usable track: music files a minute or longer. */
export function library() {
  const mixes = MIX_DIRS.flatMap((d) => walkDir(d)).filter((f) => MIX.test(path.basename(f)));
  const seen = new Set();
  // The same file can sit in two folders: keep one copy of each name.
  return [...LIBRARY_DIRS.flatMap((d) => walkDir(d)), ...mixes].filter((f) => {
    const name = path.basename(f).toLowerCase();
    if (seen.has(name)) return false;
    seen.add(name);
    return duration(f) >= 60;
  });
}

const pcm = (file, rate, from = 0, length = null) => {
  const args = ['-v', 'error', ...(from ? ['-ss', String(from)] : []), ...(length ? ['-t', String(length)] : []), '-i', file, '-ac', '1', '-ar', String(rate), '-f', 'f32le', '-'];
  const buf = execFileSync('ffmpeg', args, { maxBuffer: 1 << 30 });
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4));
};

/**
 * Where the music jumps from quiet to loud and stays loud: the drops. Returns them strongest first, at least 20 s
 * apart, each with its time and how big the jump is. Cached per file, since a one-hour mix takes a while to read.
 */
export function findDrops(file) {
  const key = crypto.createHash('sha1').update(`${file}:${fs.statSync(file).size}:${fs.statSync(file).mtimeMs}`).digest('hex').slice(0, 16);
  const cached = path.join(CACHE, `drops-${key}.json`);
  if (fs.existsSync(cached)) return JSON.parse(fs.readFileSync(cached, 'utf8'));
  const rate = 4000;
  const x = pcm(file, rate);
  const step = 0.5;
  const loud = [];
  for (let s = 0; s * rate < x.length; s += step) {
    const a = Math.floor(s * rate), z = Math.min(x.length, a + rate * step);
    let e = 0;
    for (let i = a; i < z; i++) e += x[i] * x[i];
    loud.push(10 * Math.log10(e / Math.max(1, z - a) + 1e-12));
  }
  const mean = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;
  const peak = Math.max(...loud);
  const candidates = [];
  // From 10 s in: the jump from silence at the very start of a track is not a drop.
  for (let i = 20; i < loud.length - 32; i++) {
    const before = mean(loud.slice(i - 8, i)), after = loud.slice(i, i + 32);
    const level = mean(after);
    // Loud for the next 16 s, with no long gap, and clearly louder than the 4 s before.
    if (level > peak - 4 && Math.min(...after) > peak - 14 && level - before > 4) candidates.push({ t: i * step, jump: level - before });
  }
  candidates.sort((a, b) => b.jump - a.jump);
  const drops = [];
  for (const c of candidates) if (drops.every((d) => Math.abs(d.t - c.t) > 20)) drops.push({ t: c.t, jump: Math.round(c.jump * 10) / 10 });
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(cached, JSON.stringify(drops));
  return drops;
}

/**
 * Pins a drop to the beat grid. Returns the tempo and `start`, three beats before the drop, where the edit begins,
 * so the intro's three words land on the three beats before the music hits.
 */
export function lineUp(file, roughDrop, knownBpm = null) {
  const rate = 11025;
  const from = Math.max(0, roughDrop - 8);
  const x = pcm(file, rate, from, 30);
  const beat = detectBeat(x, rate, knownBpm);
  // Of the beat-grid points near the rough drop, the drop is where the music turns dense: the most of the next four
  // beats is loud and the least of the previous four. A lone hit before the drop does not count as the drop.
  const bin = Math.round(rate * 0.05);
  const levels = [];
  for (let a = 0; a + bin < x.length; a += bin) {
    let e = 0;
    for (let i = a; i < a + bin; i++) e += x[i] * x[i];
    levels.push(10 * Math.log10(e / bin + 1e-12));
  }
  const loudLine = Math.max(...levels) - 12;
  const loudShare = (t0, t1) => {
    const a = Math.max(0, Math.floor((t0 - from) / 0.05)), z = Math.min(levels.length, Math.floor((t1 - from) / 0.05));
    let n = 0;
    for (let i = a; i < z; i++) if (levels[i] > loudLine) n++;
    return z > a ? n / (z - a) : 0;
  };
  let best = null;
  for (let k = 0; k < 64; k++) {
    const t = from + beat.firstBeat + k * beat.beat;
    if (Math.abs(t - roughDrop) > 2.5) continue;
    const rise = loudShare(t, t + 4 * beat.beat) - loudShare(t - 4 * beat.beat, t);
    if (!best || rise > best.rise) best = { t, rise };
  }
  const drop = best ? best.t : roughDrop;
  return { bpm: beat.bpm, beat: beat.beat, drop, start: drop - 3 * beat.beat };
}

export function readHistory() {
  try {
    return JSON.parse(fs.readFileSync(HISTORY, 'utf8'));
  } catch {
    return [];
  }
}

export function remember(entry) {
  const list = readHistory();
  list.push({ ...entry, at: new Date().toISOString() });
  fs.mkdirSync(path.dirname(HISTORY), { recursive: true });
  fs.writeFileSync(HISTORY, JSON.stringify(list, null, 2));
}

/** The strongest drop not used before, preferring a track used least, so edits do not repeat songs. */
export function pickMusic({ file = null, start = null, avoid = readHistory() } = {}) {
  const tracks = file ? [file] : library();
  if (!tracks.length) throw new Error('No music found. Put tracks in ~/Downloads/Audio or pass --music.');
  if (file && Number.isFinite(start)) return { file, roughDrop: start + 0.01, fixedStart: start };
  const used = (f, t) => avoid.some((h) => h.music === f && Math.abs(h.drop - t) < 20);
  const uses = (f) => avoid.filter((h) => h.music === f).length;
  const options = [];
  for (const f of tracks) for (const d of findDrops(f)) if (!used(f, d.t)) options.push({ file: f, roughDrop: d.t, jump: d.jump, uses: uses(f) });
  if (!options.length) throw new Error('Every drop in the library has been used. Add music, or pass --music and --start.');
  options.sort((a, b) => a.uses - b.uses || b.jump - a.jump);
  return options[0];
}
