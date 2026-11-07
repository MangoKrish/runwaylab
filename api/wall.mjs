// The walk wall. GET lists posts or returns one, POST adds one, DELETE removes one's own.
//
// The browser's numbers are never trusted: the measured half is recomputed here from the posted landmarks
// using the same code the browser ran, and Gemini's half counts only with this server's own signature.
import { randomBytes, randomUUID } from 'node:crypto';
import { json, refuse, sameSite, secret, judgeIsGenuine, ownerHash } from './_common.mjs';
import { authEnabled, currentUser } from './_auth.mjs';
import { getStore } from './_wallstore.mjs';
// The app's own measuring code, so the server and the browser can never disagree about how a walk is scored.
import { summarizeFrames } from '../src/lib/process.mjs';
import { totalScore } from '../src/lib/score.mjs';
import { LANDMARK_COUNT } from '../src/lib/landmarks.mjs';
import { METRIC_KEYS } from '../src/lib/metrics.mjs';

const MAX_BODY_CHARS = 4_000_000; // Under Vercel's 4.5 MB limit, so the failure is a clear message.
const MAX_FRAMES = 3700;
const MAX_SECONDS = 130;
const MAX_SIZE = 8192;
const MAX_WALKS = 5000; // A ceiling, so a flood of posts cannot fill a free database.
const PAGE_SIZE = 24;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUSES = new Set(['valid', 'no-person', 'low-confidence', 'clipped', 'too-small', 'side-on']);

const unavailable = () => refuse(503, 'not_connected', 'The wall is not connected on this server.');
const cleanText = (text, max) => String(text ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

/** Strict shape check. Anything odd is refused rather than repaired. @returns frames, or null. */
export function cleanFrames(input, W, H) {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_FRAMES) return null;
  const frames = [];
  let last = -Infinity;
  for (const f of input) {
    if (!Number.isFinite(f?.t) || f.t < 0 || f.t > MAX_SECONDS || f.t <= last || !STATUSES.has(f.s)) return null;
    last = f.t;
    let pts = null;
    if (f.p !== null) {
      if (!Array.isArray(f.p) || f.p.length !== LANDMARK_COUNT) return null;
      pts = [];
      for (const q of f.p) {
        if (q === null) {
          pts.push(null);
          continue;
        }
        if (!Array.isArray(q) || q.length !== 2 || !Number.isFinite(q[0]) || !Number.isFinite(q[1])) return null;
        if (q[0] < 0 || q[0] > W || q[1] < 0 || q[1] > H) return null;
        pts.push([Math.round(q[0] * 10) / 10, Math.round(q[1] * 10) / 10]);
      }
    }
    frames.push({ t: Math.round(f.t * 1000) / 1000, status: f.s, pts });
  }
  return frames;
}

/** The numbers shown on the wall, all taken from the server's own recomputation. */
export function buildDetail(summary, judge, frames, duration) {
  const { metrics, measured, phases } = summary;
  const shown = {};
  for (const key of METRIC_KEYS) {
    const m = metrics[key];
    shown[key] = { ok: m.ok, value: m.value, unit: m.unit };
  }
  // A still for the wall card: the last usable frame of the approach, when they are largest and facing front.
  const end = phases.approach?.[1] ?? 0;
  const usable = frames.filter((f) => f.status === 'valid' && f.pts);
  const pose = usable.reduce((best, f) => (best === null || Math.abs(f.t - end) < Math.abs(best.t - end) ? f : best), null);
  return {
    version: metrics.version,
    rules: measured.rules,
    parts: measured.parts,
    focus: measured.focus,
    laps: measured.laps ?? [],
    calibrated: !!summary.stance,
    heightMeasured: metrics.heightMeasured,
    stepCount: metrics.stepCount,
    cadence: metrics.cadence,
    metrics: shown,
    coverage: { ratio: metrics.coverage.ratio, validSeconds: metrics.coverage.validSeconds },
    phases: { approach: phases.approach, turn: phases.turn, back: phases.back },
    pose: pose?.pts ?? null,
    judge: judge ? {
      presence: judge.presence,
      style: judge.style,
      match: judge.match,
      verdict: judge.verdict,
      tip: judge.tip ?? null,
      model: cleanText(judge.model, 40) || null,
      moments: (judge.moments || []).map((m) => ({ t: Math.min(Math.max(Number(m.t) || 0, 0), duration), note: m.note })),
    } : null,
  };
}

const publicWalk = ({ ownerHash: _hidden, ...walk }) => walk;

function failed(err) {
  if (err?.code === '42P01') return refuse(503, 'not_set_up', 'The wall\'s database tables are not set up yet.');
  console.error('wall:', err?.code || err?.message);
  return refuse(503, 'db_error', 'The wall could not reach its database. Try again.');
}

export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const store = secret() ? getStore() : null;
  const user = currentUser(request);

  if (params.get('action') === 'info') {
    return json(200, { ready: !!store, store: store?.kind ?? null, auth: authEnabled(), signedIn: !!user, name: user?.name ?? null });
  }
  if (!store) return unavailable();

  try {
    if (params.get('action') === 'stats') return json(200, { ok: true, ...(await store.stats()) });

    const id = params.get('id');
    if (id) {
      if (!UUID.test(id)) return refuse(404, 'not_found', 'That walk is not on the wall.');
      const walk = await store.get(id);
      if (!walk) return refuse(404, 'not_found', 'That walk is not on the wall.');
      return json(200, { ok: true, walk: publicWalk(walk), mine: !!user && ownerHash(user.sub) === walk.ownerHash });
    }

    const sort = params.get('sort') === 'new' ? 'new' : 'top';
    const offset = Math.min(Math.max(Number.parseInt(params.get('offset'), 10) || 0, 0), MAX_WALKS);
    const rows = await store.list({ sort, limit: PAGE_SIZE + 1, offset });
    return json(200, { ok: true, walks: rows.slice(0, PAGE_SIZE).map(publicWalk), more: rows.length > PAGE_SIZE });
  } catch (err) {
    return failed(err);
  }
}

export async function POST(request) {
  if (!sameSite(request)) return refuse(403, 'forbidden', 'This wall only answers its own site.');
  const store = secret() ? getStore() : null;
  if (!store) return unavailable();

  const params = new URL(request.url).searchParams;
  try {
    if (params.get('action') === 'clap') {
      const id = params.get('id');
      if (!UUID.test(id || '')) return refuse(404, 'not_found', 'That walk is not on the wall.');
      const claps = await store.clap(id);
      return claps === null ? refuse(404, 'not_found', 'That walk is not on the wall.') : json(200, { ok: true, claps });
    }

    const user = currentUser(request);
    if (authEnabled() && !user) return refuse(401, 'sign_in', 'Sign in to post to the wall.');

    const text = await request.text();
    if (text.length > MAX_BODY_CHARS) return refuse(413, 'too_big', 'That walk is too long to post.');
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return refuse(400, 'bad_request', 'That post could not be read.');
    }

    const name = cleanText(body?.name, 30);
    if (!name) return refuse(400, 'bad_name', 'Please enter a name to show on the wall.');
    const W = body?.W;
    const H = body?.H;
    if (!Number.isInteger(W) || !Number.isInteger(H) || W < 16 || H < 16 || W > MAX_SIZE || H > MAX_SIZE) return refuse(400, 'bad_request', 'That post has an invalid picture size.');
    const duration = Number(body?.duration);
    if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_SECONDS) return refuse(400, 'bad_request', 'That post has an invalid length.');
    const frames = cleanFrames(body?.frames, W, H);
    if (!frames) return refuse(400, 'bad_request', 'That post has invalid tracking data.');

    // Recompute. Any score sent by the browser is ignored.
    const summary = summarizeFrames(frames, { W, H });
    if (!summary.measured.ok) return refuse(422, 'no_walk', summary.measured.reason);

    const judge = judgeIsGenuine(body.judge) ? body.judge : null;
    const total = totalScore(summary.measured, judge ? { ...judge, ok: true } : null);

    if (await store.count() >= MAX_WALKS) return refuse(507, 'full', 'The wall is full.');

    // With sign-in on, the account owns the post. Otherwise a private token, returned only this once, does.
    const token = user ? null : randomBytes(24).toString('base64url');
    const walk = {
      id: randomUUID(),
      postedAt: new Date().toISOString(),
      name,
      ownerHash: ownerHash(user ? user.sub : token),
      width: W,
      height: H,
      duration,
      total,
      measured: summary.measured.points,
      detail: buildDetail(summary, judge, frames, duration),
    };
    await store.create(walk, frames);
    return json(201, { ok: true, id: walk.id, token, total, measured: walk.measured, judged: !!judge });
  } catch (err) {
    return failed(err);
  }
}

export async function DELETE(request) {
  if (!sameSite(request)) return refuse(403, 'forbidden', 'This wall only answers its own site.');
  const store = secret() ? getStore() : null;
  if (!store) return unavailable();

  const id = new URL(request.url).searchParams.get('id');
  if (!UUID.test(id || '')) return refuse(404, 'not_found', 'That walk is not on the wall.');

  const user = currentUser(request);
  if (authEnabled() && !user) return refuse(401, 'sign_in', 'Sign in to remove your walk.');
  const proof = user ? user.sub : request.headers.get('x-wall-token');
  if (!proof) return refuse(403, 'not_owner', 'Only the person who posted this walk can remove it.');

  try {
    const result = await store.remove(id, ownerHash(proof));
    if (result === 'not-found') return refuse(404, 'not_found', 'That walk is not on the wall.');
    if (result === 'not-owner') return refuse(403, 'not_owner', 'Only the person who posted this walk can remove it.');
    return json(200, { ok: true });
  } catch (err) {
    return failed(err);
  }
}
