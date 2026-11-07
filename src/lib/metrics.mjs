// The measurements. They describe what happens in the picture; score.mjs decides what that is worth.
// Bump METRICS_VERSION whenever a definition changes, so old and new results are never mixed.
//
// Lengths are given as a percentage of the person's own height, so a number means the same thing for everyone.
// Shoulder width would not do: it differs between bodies and shrinks when someone rotates.
//
// Height comes from the moment they stand still before walking, as a multiple of their torso length. During the
// walk, on-screen torso length then gives the scale in every frame, because with a pinhole camera every body
// part's on-screen size is proportional to 1/distance. That is what makes one number meaningful across a walk
// whose on-screen size doubles. A clip with no standing moment uses typical human proportions instead.
//
// Reliability from a fixed, front-facing camera:
//   Foot placement, steps:  good when feet are visible. A front view is the best angle for foot placement, and
//                           where someone walks in the picture does not change it: see steps.mjs.
//   Shoulder, trunk sway:   good. Measured as sway, so a camera that is not level does not affect it.
//   Torso position:         good, if the camera does not move.
//   Head carriage:          moderate. Compared with the person's own standing posture when it is known. Uses the
//                           ears, or the top of the head when hair or a head covering hides them.
//   Forward lean:           not measured. It points at the camera and cannot be seen from the front.
import { LM, midpoint, distance } from './landmarks.mjs';
import { detectSteps } from './steps.mjs';

export const METRICS_VERSION = 'rl-metrics-4';
export const MIN_VALID_SECONDS = 3;
export const MIN_COVERAGE = 0.5;
export const MIN_METRIC_SECONDS = 2;
export const MIN_STEPS = 4;
/** Height as a multiple of torso length (shoulder midpoint to hip midpoint), for a typical adult. */
export const TYPICAL_HEIGHT_RATIO = 3.45;
/** From the nose to the ankle is about this share of full height, for when the top of the head is unavailable. */
const NOSE_TO_ANKLE_SHARE = 0.89;
const UNIT = '% of height';

export const METRIC_KEYS = ['footLine', 'stepRhythm', 'pace', 'shoulderSway', 'shoulderLevel', 'trunkSway', 'hipSway', 'bounce', 'neck', 'gaze', 'neckDrop', 'gazeDrop', 'headTilt', 'torsoSpread', 'headMovement', 'armSwing', 'armBalance', 'turnTime', 'turnWobble', 'toeOut'];

const toDegrees = (rad) => (rad * 180) / Math.PI;
const round = (x, places = 2) => Math.round(x * 10 ** places) / 10 ** places;

export function percentile(values, p) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const at = (s.length - 1) * p;
  const low = Math.floor(at);
  const high = Math.ceil(at);
  return s[low] + (s[high] - s[low]) * (at - low);
}
export const median = (values) => percentile(values, 0.5);
const spread90 = (values) => percentile(values, 0.95) - percentile(values, 0.05);
const iqr = (values) => percentile(values, 0.75) - percentile(values, 0.25);
export function coefficientOfVariation(values) {
  if (values.length < 2) return null;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  if (mean === 0) return null;
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length) / Math.abs(mean);
}

/**
 * atan2(dy, dx) between two points, in pixels, folded into (-90, 90] degrees. Folding makes it the same line
 * whichever point is first, which matters because left and right swap on screen when someone walks away.
 */
export function lineTiltDeg(a, b) {
  let deg = toDegrees(Math.atan2(b[1] - a[1], b[0] - a[0]));
  if (deg > 90) deg -= 180;
  else if (deg <= -90) deg += 180;
  return deg;
}
export const shoulderLineDeg = lineTiltDeg;

/** atan2(shoulderMidX - hipMidX, hipMidY - shoulderMidY). 0 is upright; positive tilts toward image right. */
export function trunkInclinationDeg(shoulderMid, hipMid) {
  return toDegrees(Math.atan2(shoulderMid[0] - hipMid[0], hipMid[1] - shoulderMid[1]));
}

const hasTorso = (pts) => !!(pts && pts[LM.L_SHOULDER] && pts[LM.R_SHOULDER] && pts[LM.L_HIP] && pts[LM.R_HIP]);
export const torsoOf = (pts) => distance(midpoint(pts[LM.L_SHOULDER], pts[LM.R_SHOULDER]), midpoint(pts[LM.L_HIP], pts[LM.R_HIP]));

/** (torso centre x - image centre x) / torso length: sideways position, with distance cancelled. */
export function torsoOffset(pts, W) {
  const [ls, rs, lh, rh] = [pts[LM.L_SHOULDER], pts[LM.R_SHOULDER], pts[LM.L_HIP], pts[LM.R_HIP]];
  const cx = (ls[0] + rs[0] + lh[0] + rh[0]) / 4;
  return (cx - W / 2) / torsoOf(pts);
}

/** The head as one point. Hair or a head covering can hide the ears, so there are other ways to find it. */
const HEAD_POINTS = {
  ears: (pts) => (pts[LM.L_EAR] && pts[LM.R_EAR] ? midpoint(pts[LM.L_EAR], pts[LM.R_EAR]) : null),
  top: (pts) => pts[LM.HEAD_TOP] ?? null,
};

/** (head x - shoulder midpoint x) / torso length, from the given head point. Null if it is not visible. */
export function headOffset(pts, kind = 'ears') {
  const head = kind === 'nose' ? pts[LM.NOSE] : HEAD_POINTS[kind](pts);
  if (!head) return null;
  return (head[0] - (pts[LM.L_SHOULDER][0] + pts[LM.R_SHOULDER][0]) / 2) / torsoOf(pts);
}

/** How far the line from neck to top of head leans from upright, in degrees. Null if either is hidden. */
const headLean = (pts) => (pts[LM.HEAD_TOP] && pts[LM.NECK] ? trunkInclinationDeg(pts[LM.HEAD_TOP], pts[LM.NECK]) : null);

/**
 * How far each moment strays from the straight path that fits it best, so walking straight but not aimed at the
 * camera costs nothing. A straight path on the floor is a straight line of sideways position against distance,
 * and distance is proportional to 1 / torso size.
 */
function strayFromPath(points) {
  if (points.length < 3) return points.map(() => 0);
  const meanD = points.reduce((sum, p) => sum + p.d, 0) / points.length;
  const meanX = points.reduce((sum, p) => sum + p.x, 0) / points.length;
  const across = points.reduce((sum, p) => sum + (p.d - meanD) ** 2, 0);
  const slope = across > 0 ? points.reduce((sum, p) => sum + (p.d - meanD) * (p.x - meanX), 0) / across : 0;
  return points.map((p) => p.x - meanX - slope * (p.d - meanD));
}

/** Subtract a rolling median, leaving only the fast movement. Trends like walking closer drop out. */
function detrend(series, seconds = 1) {
  return series.map(({ t, v }, i) => {
    const near = [];
    for (let j = i; j >= 0 && t - series[j].t <= seconds / 2; j--) near.push(series[j].v);
    for (let j = i + 1; j < series.length && series[j].t - t <= seconds / 2; j++) near.push(series[j].v);
    return v - median(near);
  });
}

/**
 * How steady the walking speed is. Distance is proportional to 1/torso size, so its rate of change is
 * proportional to speed. The ends of each window are left out, because everyone speeds up and slows down there.
 */
function paceVariation(frames) {
  const series = frames.filter((f) => hasTorso(f.pts)).map((f) => ({ t: f.t, d: 1 / torsoOf(f.pts) }));
  if (series.length < 12) return null;
  const start = series[0].t;
  const span = series.at(-1).t - start;
  if (span < 1.5) return null;
  const speeds = [];
  const windowSeconds = 0.7;
  for (let i = 0; i < series.length; i += 3) {
    const t0 = series[i].t;
    if (t0 < start + span * 0.15 || t0 + windowSeconds > start + span * 0.85) continue;
    const chunk = series.filter((s) => s.t >= t0 && s.t <= t0 + windowSeconds);
    if (chunk.length < 5) continue;
    const meanT = chunk.reduce((s, c) => s + c.t, 0) / chunk.length;
    const meanD = chunk.reduce((s, c) => s + c.d, 0) / chunk.length;
    const top = chunk.reduce((s, c) => s + (c.t - meanT) * (c.d - meanD), 0);
    const bottom = chunk.reduce((s, c) => s + (c.t - meanT) ** 2, 0);
    if (bottom > 0) speeds.push(Math.abs(top / bottom));
  }
  return speeds.length >= 3 ? coefficientOfVariation(speeds) : null;
}

/** Standing height in pixels: top of head to heel if the tracker gives them, or worked out from nose to ankle. */
function standingHeight(pts) {
  const feet = [pts[LM.L_HEEL], pts[LM.R_HEEL]].filter(Boolean);
  if (pts[LM.HEAD_TOP] && feet.length) return Math.max(...feet.map((p) => p[1])) - pts[LM.HEAD_TOP][1];
  const ankles = [pts[LM.L_ANKLE], pts[LM.R_ANKLE]].filter(Boolean);
  if (pts[LM.NOSE] && ankles.length) return (Math.max(...ankles.map((p) => p[1])) - pts[LM.NOSE][1]) / NOSE_TO_ANKLE_SHARE;
  return null;
}

/**
 * Calibration, from the moments someone stands still before walking. It learns three things:
 *   Their height, in torso lengths, which is what makes every length a share of their own height.
 *   Their own carriage: how tall they hold their head and where their chin sits, so walking is compared with
 *   their own body rather than an average one.
 *   This setup's noise: how much measurements wobble when nothing is moving, which is the tracker and camera,
 *   not the walker. Walking measurements then have that amount taken off, and it is also the smallest movement
 *   this setup can honestly claim to see.
 * @returns null if there is not enough stillness to learn from, as with a clip that starts mid-stride.
 */
export function learnFromStillness(frames, walkStart) {
  if (walkStart === null || walkStart === undefined) return null;
  const still = frames.filter((f) => f.status === 'valid' && hasTorso(f.pts) && f.t >= walkStart - 3 && f.t <= walkStart - 0.15);
  if (still.length < 12) return null;
  const sizes = still.map((f) => torsoOf(f.pts));
  // If the size is changing they are already walking, and this is not a stance.
  if (Math.max(...sizes) / Math.min(...sizes) > 1.12) return null;

  const heights = [];
  for (const { pts } of still) {
    const height = standingHeight(pts);
    if (height !== null) heights.push(height / torsoOf(pts));
  }
  const measured = heights.length >= 8 ? median(heights) : null;
  // Outside this range the picture is not showing a whole, upright person, so fall back on typical proportions.
  const heightRatio = measured !== null && measured >= 2.7 && measured <= 4.4 ? measured : null;
  const k = heightRatio ?? TYPICAL_HEIGHT_RATIO;

  const shoulder = [];
  const trunk = [];
  const hips = [];
  const level = [];
  const lines = { ears: [], top: [] };
  const baseline = (values) => (values.length >= 8 ? median(values) : null);
  const heads = { ears: { neck: [], gaze: [], move: [] }, top: { neck: [], gaze: [], move: [] } };
  const noseMove = [];
  for (const { pts } of still) {
    const [ls, rs, lh, rh] = [pts[LM.L_SHOULDER], pts[LM.R_SHOULDER], pts[LM.L_HIP], pts[LM.R_HIP]];
    const size = torsoOf(pts);
    shoulder.push(lineTiltDeg(ls, rs));
    trunk.push(trunkInclinationDeg(midpoint(ls, rs), midpoint(lh, rh)));
    hips.push(lineTiltDeg(lh, rh));
    level.push((midpoint(ls, rs)[1] / size / k) * 100);
    if (pts[LM.L_EAR] && pts[LM.R_EAR]) lines.ears.push(lineTiltDeg(pts[LM.L_EAR], pts[LM.R_EAR]));
    if (headLean(pts) !== null) lines.top.push(headLean(pts));
    if (pts[LM.NOSE]) noseMove.push((headOffset(pts, 'nose') / k) * 100);
    for (const kind of ['ears', 'top']) {
      const head = HEAD_POINTS[kind](pts);
      if (!head) continue;
      heads[kind].neck.push(((midpoint(ls, rs)[1] - head[1]) / size / k) * 100);
      heads[kind].move.push((headOffset(pts, kind) / k) * 100);
      if (pts[LM.NOSE]) heads[kind].gaze.push(((pts[LM.NOSE][1] - head[1]) / size / k) * 100);
    }
  }
  const noiseOf = (values) => (values.length >= 8 ? round(spread90(values)) : 0);
  return {
    seconds: round(still.at(-1).t - still[0].t, 1),
    heightRatio,
    shoulderTilt: median(shoulder),
    head: {
      ears: { neck: baseline(heads.ears.neck), gaze: baseline(heads.ears.gaze), tilt: baseline(lines.ears) },
      top: { neck: baseline(heads.top.neck), gaze: baseline(heads.top.gaze), tilt: baseline(lines.top) },
    },
    noise: {
      shoulderSway: round(iqr(shoulder)),
      trunkSway: round(iqr(trunk)),
      hipSway: round(iqr(hips)),
      bounce: round(spread90(level)),
      headMovement: { ears: noiseOf(heads.ears.move), top: noiseOf(heads.top.move), nose: noiseOf(noseMove) },
    },
  };
}

/**
 * Measurements for several walks combined into one: the median of each. One stumble, or one stretch of bad
 * tracking, cannot move a median of three much. Counts are added up instead.
 */
export function combineMetrics(results) {
  if (results.length === 1) return { ...results[0], lapCount: 1 };
  const combined = { ...results[0], lapCount: results.length };
  for (const key of METRIC_KEYS) {
    const present = results.map((m) => m[key]).filter((m) => m?.ok);
    if (results[0][key] === undefined && !present.length) continue;
    combined[key] = present.length
      ? { ...present[0], value: round(median(present.map((m) => m.value))), n: present.reduce((sum, m) => sum + (m.n || 0), 0) }
      : results[0][key];
  }
  combined.stepCount = results.reduce((sum, m) => sum + m.stepCount, 0);
  const cadences = results.map((m) => m.cadence).filter((c) => c !== null);
  combined.cadence = cadences.length ? round(median(cadences), 0) : null;
  const counts = {};
  for (const m of results) for (const [k, v] of Object.entries(m.coverage.counts)) counts[k] = (counts[k] || 0) + v;
  const sampled = results.reduce((sum, m) => sum + m.coverage.sampled, 0);
  const valid = results.reduce((sum, m) => sum + m.coverage.valid, 0);
  combined.coverage = {
    sampled,
    valid,
    ratio: sampled ? round(valid / sampled) : 0,
    validSeconds: round(results.reduce((sum, m) => sum + m.coverage.validSeconds, 0), 1),
    counts,
  };
  return combined;
}

const REASONS = {
  'no-person': 'We could not find a person in most of this clip.',
  'low-confidence': 'The tracker was not confident about the shoulders and hips. More light on the walker usually fixes this.',
  clipped: 'The shoulders or hips were outside the frame for most of the clip. Turn further from the camera.',
  'too-small': 'The person was too small in the frame. Move the camera closer.',
  'side-on': 'The person was side-on for most of the clip. These measurements need them facing toward or away from the camera.',
};

function medianStep(frames) {
  const steps = [];
  for (let i = 1; i < frames.length; i++) steps.push(frames[i].t - frames[i - 1].t);
  return median(steps) ?? 0;
}

/**
 * @param frames  Smoothed frames, each with t, status and pts.
 * @param phases  Output of detectPhases. Only its walking windows are measured, because turning breaks these
 *                definitions. With no detected walk the whole clip is described instead.
 * @param stance  Output of learnFromStillness, or null.
 */
export function computeMetrics(frames, phases, { W, H, stance = null }) {
  const windows = phases.windows?.length ? phases.windows : frames.length ? [[frames[0].t, frames.at(-1).t]] : [];
  const inWindow = (t) => windows.some(([a, b]) => t >= a && t <= b);
  const walking = frames.filter((f) => inWindow(f.t));
  const valid = walking.filter((f) => f.status === 'valid' && hasTorso(f.pts));
  const step = medianStep(frames);
  const k = stance?.heightRatio ?? TYPICAL_HEIGHT_RATIO;
  const percentOfHeight = (x) => (x / k) * 100; // x is in torso lengths.

  const counts = {};
  for (const f of walking) counts[f.status] = (counts[f.status] || 0) + 1;

  const coverage = {
    sampled: walking.length,
    valid: valid.length,
    ratio: walking.length ? round(valid.length / walking.length) : 0,
    validSeconds: round(valid.length * step, 1),
    counts,
  };

  let gate = { ok: true, reason: null };
  if (!frames.length) {
    gate = { ok: false, reason: 'No frames could be read from this clip.' };
  } else if (coverage.validSeconds < MIN_VALID_SECONDS || coverage.ratio < MIN_COVERAGE) {
    const top = Object.entries(counts).filter(([key]) => key !== 'valid').sort((a, b) => b[1] - a[1])[0]?.[0];
    const usable = `Usable footage: ${coverage.validSeconds} s, ${Math.round(coverage.ratio * 100)}% of the walk. Measurements need ${MIN_VALID_SECONDS} s and ${Math.round(MIN_COVERAGE * 100)}%.`;
    gate = { ok: false, reason: `${REASONS[top] || 'Too little of this clip could be measured.'} ${usable}` };
  }

  const shoulder = [];
  const hipLine = [];
  const trunk = [];
  const heads = { ears: { neck: [], gaze: [], move: [], tilt: [] }, top: { neck: [], gaze: [], move: [], tilt: [] } };
  const noseMove = [];
  const approach = phases.approach;
  for (const { t, pts } of valid) {
    const [ls, rs, lh, rh] = [pts[LM.L_SHOULDER], pts[LM.R_SHOULDER], pts[LM.L_HIP], pts[LM.R_HIP]];
    const size = torsoOf(pts);
    shoulder.push(lineTiltDeg(ls, rs));
    hipLine.push(lineTiltDeg(lh, rh));
    trunk.push(trunkInclinationDeg(midpoint(ls, rs), midpoint(lh, rh)));
    if (pts[LM.NOSE]) noseMove.push(percentOfHeight(headOffset(pts, 'nose')));
    // Chin and tilt are judged walking toward the camera only. From behind the nose is hidden, and a head held
    // to one side leans the other way on screen, so it could not be compared with how they stood facing us.
    const towardUs = approach && t >= approach[0] && t <= approach[1];
    if (towardUs && pts[LM.L_EAR] && pts[LM.R_EAR]) heads.ears.tilt.push(lineTiltDeg(pts[LM.L_EAR], pts[LM.R_EAR]));
    if (towardUs && headLean(pts) !== null) heads.top.tilt.push(headLean(pts));
    for (const kind of ['ears', 'top']) {
      const point = HEAD_POINTS[kind](pts);
      if (!point) continue;
      heads[kind].neck.push(percentOfHeight((midpoint(ls, rs)[1] - point[1]) / size));
      heads[kind].move.push(percentOfHeight(headOffset(pts, kind)));
      if (towardUs && pts[LM.NOSE]) heads[kind].gaze.push(percentOfHeight((pts[LM.NOSE][1] - point[1]) / size));
    }
  }
  /** The ears if there are enough frames of them, otherwise the top of the head, so hair or a hat costs nothing. */
  const enough = (values) => values.length * step >= MIN_METRIC_SECONDS;
  const kindFor = (key) => (enough(heads.ears[key]) ? 'ears' : enough(heads.top[key]) ? 'top' : 'ears');
  const neckKind = kindFor('neck');
  const gazeKind = kindFor('gaze');
  const tiltKind = kindFor('tilt');
  const moveKind = enough(heads.ears.move) ? 'ears' : enough(heads.top.move) ? 'top' : 'nose';
  const moves = moveKind === 'nose' ? noseMove : heads[moveKind].move;

  // Vertical bounce and arm swing, one walking segment at a time, so the turn cannot look like movement.
  const stray = [];
  const bounce = [];
  const armLeft = [];
  const armRight = [];
  const paces = [];
  for (const [a, b] of windows) {
    const here = valid.filter((f) => f.t >= a && f.t <= b);
    stray.push(...strayFromPath(here.map((f) => ({ d: 1 / torsoOf(f.pts), x: percentOfHeight(torsoOffset(f.pts, W)) }))));
    // Height is measured from the picture's centre: on-screen height above the centre and torso size both
    // scale with 1/distance, so their ratio does not change just because someone walked closer.
    bounce.push(...detrend(here.map((f) => ({ t: f.t, v: percentOfHeight((midpoint(f.pts[LM.L_SHOULDER], f.pts[LM.R_SHOULDER])[1] - H / 2) / torsoOf(f.pts)) }))));
    const arm = (wrist, shoulderPoint) => detrend(here.filter((f) => f.pts[wrist]).map((f) => ({ t: f.t, v: percentOfHeight((f.pts[wrist][1] - f.pts[shoulderPoint][1]) / torsoOf(f.pts)) })));
    armLeft.push(...arm(LM.L_WRIST, LM.L_SHOULDER));
    armRight.push(...arm(LM.R_WRIST, LM.R_SHOULDER));
    const pace = paceVariation(frames.filter((f) => f.t >= a && f.t <= b));
    if (pace !== null) paces.push(pace);
  }

  const steps = detectSteps(walking, { k });
  const enoughSteps = steps.widths.length >= MIN_STEPS - 1;
  const noFeet = 'We could not follow your feet for enough steps. Keep your whole body in frame.';
  const armAmplitudes = armLeft.length * step >= MIN_METRIC_SECONDS && armRight.length * step >= MIN_METRIC_SECONDS
    ? [spread90(armLeft), spread90(armRight)]
    : null;

  // The turn, including frames where they are side-on, because that is what a turn is.
  let turnSeconds = null;
  let turnWobble = null;
  if (phases.turn) {
    turnSeconds = phases.turn[1] - phases.turn[0];
    const during = frames.filter((f) => hasTorso(f.pts) && f.t >= phases.turn[0] && f.t <= phases.turn[1]);
    if (during.length >= 3) turnWobble = spread90(during.map((f) => percentOfHeight(midpoint(f.pts[LM.L_HIP], f.pts[LM.R_HIP])[0] / torsoOf(f.pts))));
  }

  // Take off the wobble this setup has with nothing moving, when calibration measured it.
  const lessNoise = (value, key) => Math.max(0, value - (stance?.noise?.[key] ?? 0));
  const baseline = (kind, key) => stance?.head?.[kind]?.[key] ?? null;

  const blocked = (key, unit) => ({ key, unit, ok: false, value: null, n: 0, why: gate.reason });
  /** A measurement from a list of per-frame values, or an explanation of why there are too few. */
  const fromFrames = (key, unit, values, summarize) => {
    if (!gate.ok) return blocked(key, unit);
    const seconds = values.length * step;
    if (seconds < MIN_METRIC_SECONDS) {
      return { key, unit, ok: false, value: null, n: values.length, why: `Only ${seconds.toFixed(1)} s of usable frames. This needs at least ${MIN_METRIC_SECONDS} s.` };
    }
    return { key, unit, ok: true, n: values.length, why: null, value: round(summarize(values)) };
  };
  /** A single worked-out value, or an explanation of why there is none. */
  const single = (key, unit, value, n, why) => {
    if (!gate.ok) return blocked(key, unit);
    if (value === null || value === undefined || !Number.isFinite(value)) return { key, unit, ok: false, value: null, n, why: why || 'Not enough usable data for this one.' };
    return { key, unit, ok: true, value: round(value), n, why: null };
  };
  const noStance = (key, unit) => ({ key, unit, ok: false, value: null, n: 0, why: 'No standing calibration in this clip.' });

  return {
    version: METRICS_VERSION,
    gate,
    coverage,
    calibrated: !!stance,
    heightMeasured: !!stance?.heightRatio,
    lapCount: 1,
    stepCount: steps.events.length,
    cadence: gate.ok && steps.intervals.length >= 3 ? round(60 / median(steps.intervals), 0) : null,
    footLine: single('footLine', UNIT, enoughSteps ? median(steps.widths) : null, steps.widths.length, noFeet),
    toeOut: single('toeOut', '°', steps.toes.length >= MIN_STEPS ? median(steps.toes) : null, steps.toes.length, 'We could not follow your toes for enough steps.'),
    stepRhythm: single('stepRhythm', 'variation', steps.intervals.length >= MIN_STEPS - 1 ? coefficientOfVariation(steps.intervals) : null, steps.intervals.length, noFeet),
    pace: single('pace', 'variation', paces.length ? median(paces) : null, paces.length, 'We could not follow your pace for long enough.'),
    shoulderSway: fromFrames('shoulderSway', '°', shoulder, (v) => lessNoise(iqr(v), 'shoulderSway')),
    shoulderLevel: fromFrames('shoulderLevel', '°', shoulder, (v) => median(v.map((x) => Math.abs(x - (stance?.shoulderTilt ?? 0))))),
    trunkSway: fromFrames('trunkSway', '°', trunk, (v) => lessNoise(iqr(v), 'trunkSway')),
    hipSway: fromFrames('hipSway', '°', hipLine, (v) => lessNoise(iqr(v), 'hipSway')),
    bounce: fromFrames('bounce', UNIT, bounce, (v) => lessNoise(spread90(v), 'bounce')),
    // Without a standing moment there is nothing fair to compare the top of the head with, so only ears count here.
    neck: fromFrames('neck', UNIT, heads.ears.neck, median),
    gaze: fromFrames('gaze', UNIT, heads.ears.gaze, median),
    neckDrop: baseline(neckKind, 'neck') !== null ? fromFrames('neckDrop', UNIT, heads[neckKind].neck, (v) => Math.max(0, baseline(neckKind, 'neck') - median(v))) : noStance('neckDrop', UNIT),
    gazeDrop: baseline(gazeKind, 'gaze') !== null ? fromFrames('gazeDrop', UNIT, heads[gazeKind].gaze, (v) => Math.max(0, median(v) - baseline(gazeKind, 'gaze'))) : noStance('gazeDrop', UNIT),
    headTilt: baseline(tiltKind, 'tilt') !== null ? fromFrames('headTilt', '°', heads[tiltKind].tilt, (v) => median(v.map((x) => Math.abs(x - baseline(tiltKind, 'tilt'))))) : noStance('headTilt', '°'),
    torsoSpread: fromFrames('torsoSpread', UNIT, stray, spread90),
    headMovement: fromFrames('headMovement', UNIT, moves, (v) => Math.max(0, spread90(v) - (stance?.noise?.headMovement?.[moveKind] ?? 0))),
    armSwing: single('armSwing', UNIT, armAmplitudes ? median(armAmplitudes) : null, armLeft.length + armRight.length, 'We could not follow both arms for long enough.'),
    armBalance: single('armBalance', 'ratio', armAmplitudes && Math.max(...armAmplitudes) > 0 ? Math.min(...armAmplitudes) / Math.max(...armAmplitudes) : null, armLeft.length + armRight.length, 'We could not follow both arms for long enough.'),
    turnTime: single('turnTime', 's', turnSeconds, 1, 'We did not see a turn.'),
    turnWobble: single('turnWobble', UNIT, turnWobble, 1, 'We did not see a turn clearly.'),
  };
}

// Words for the details view, kept beside the formulas they describe.
export const METRIC_INFO = {
  footLine: { title: 'Foot placement', reads: 'How far apart your feet were side to side each time one landed.', formula: 'Median side-to-side distance between your heels and ankles, averaged over each pair of footfalls, as a share of your height. Averaging a pair cancels the shift from walking off-centre or at an angle.', limits: 'Needs your feet in frame. If long clothes hide them, this part is left out rather than marked down.' },
  toeOut: { title: 'Toe direction', reads: 'How far your toes pointed outward as your feet landed. Shown for interest: it earns no points either way.', formula: 'The sideways distance from heel to toes, as an angle, using a typical foot length.', limits: 'Approximate, because foot lengths differ. Needs a tracker that finds the toes.' },
  stepRhythm: { title: 'Step rhythm', reads: 'How much the time between your steps varied. Lower is more even.', formula: 'Standard deviation / mean of the time between footfalls.', limits: 'Footfalls are found from how the feet move in the picture, so a few may be missed or a little early.' },
  pace: { title: 'Pace', reads: 'How much your walking speed varied. Lower is steadier.', formula: 'Variation in how fast 1 / torso size changes, over the middle of each walking segment.', limits: 'The first and last parts of each segment are left out, because everyone speeds up and slows down there.' },
  shoulderSway: { title: 'Shoulder rock', reads: 'How much your shoulder line rocked as you walked.', formula: 'Interquartile range of the angle of the line between the shoulders, less this setup\'s standing noise.', limits: 'Measured as sway, so a camera that is not level does not change it.' },
  shoulderLevel: { title: 'Shoulder level', reads: 'How far your shoulder line sat from where it was when you stood tall.', formula: 'Median of |shoulder line angle - your standing angle|.', limits: 'With no standing moment, this is against level, so a tilted camera would affect it.' },
  trunkSway: { title: 'Trunk sway', reads: 'How much your upper body leaned side to side.', formula: 'Interquartile range of the angle from hips to shoulders, less this setup\'s standing noise.', limits: 'Sideways only. Forward lean points at the camera and cannot be seen from the front.' },
  hipSway: { title: 'Hip movement', reads: 'How much your hip line rocked. Shown for interest: some is part of a runway walk, so it earns no points either way.', formula: 'Interquartile range of the angle of the line between the hips, less this setup\'s standing noise.', limits: 'Loose clothing makes hips harder to place exactly.' },
  bounce: { title: 'Bounce', reads: 'How much your shoulders moved up and down with each step.', formula: '95th minus 5th percentile of shoulder height after removing slow changes, as a share of your height.', limits: 'Some bounce is normal.' },
  neck: { title: 'Head height', reads: 'How far your ears sat above your shoulders.', formula: 'Median of (shoulder y - ear y), as a share of your height.', limits: 'Used for scoring only when there is no standing moment to compare with.' },
  gaze: { title: 'Chin', reads: 'How far your nose sat below your ears walking toward the camera. Higher means looking down.', formula: 'Median of (nose y - ear y) on the approach, as a share of your height.', limits: 'Used for scoring only when there is no standing moment to compare with.' },
  neckDrop: { title: 'Head drop', reads: 'How much lower you carried your head walking than standing tall.', formula: 'Your standing head height minus your median walking head height, from your ears, or the top of your head if your ears are hidden.', limits: 'Compared with your own body, not an average one. Needs the standing moment before the walk.' },
  gazeDrop: { title: 'Chin drop', reads: 'How much further down you looked walking than standing.', formula: 'Your median walking chin position minus your standing chin position.', limits: 'Compared with your own stance. Needs the standing moment before the walk.' },
  headTilt: { title: 'Head tilt', reads: 'How far your head tipped to the side compared with your standing posture.', formula: 'Median of |head angle - your standing head angle|, from the line between your ears, or from your neck to the top of your head if your ears are hidden.', limits: 'Walking toward the camera only.' },
  torsoSpread: { title: 'Straight line', reads: 'How far you strayed from a straight path, whichever way that path was pointing.', formula: '95th minus 5th percentile of how far your torso sat from the straight line that best fits each walk, as a share of your height.', limits: 'The camera must not move. A real lens only approximates the ideal camera this assumes.' },
  headMovement: { title: 'Head steadiness', reads: 'How far your head moved sideways relative to your shoulders.', formula: '95th minus 5th percentile of (head x - shoulder x), as a share of your height, less this setup\'s standing noise. The head is your ears, or the top of your head or nose if they are hidden.', limits: 'A head turned on purpose counts as movement.' },
  armSwing: { title: 'Arm swing', reads: 'How much your wrists moved up and down as you walked.', formula: '95th minus 5th percentile of (wrist y - shoulder y), as a share of your height, median of both arms.', limits: 'From the front, most arm swing points at the camera, so this sees only part of it.' },
  armBalance: { title: 'Arm balance', reads: 'How evenly your two arms moved, where 1 is identical.', formula: 'Smaller arm swing / larger arm swing.', limits: 'A bag or phone in one hand will lower this.' },
  turnTime: { title: 'Turn time', reads: 'How long your turn took, from slowing down to walking away.', formula: 'Length of the plateau in torso size around its peak.', limits: 'A deliberate pause at the top counts as part of the turn.' },
  turnWobble: { title: 'Turn control', reads: 'How far your hips moved sideways during the turn.', formula: '95th minus 5th percentile of hip position during the turn, as a share of your height.', limits: 'Turning always moves the hips a little.' },
};
