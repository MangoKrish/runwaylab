// Run with: npm test
// Tests for the measuring logic. No browser, no network, no footage of anyone.
import test from 'node:test';
import assert from 'node:assert/strict';

const LIB = '../src/lib';
const { LM, LANDMARK_COUNT } = await import(`${LIB}/landmarks.mjs`);
const { OneEuro } = await import(`${LIB}/oneEuro.mjs`);
const { classifyPose, smoothFrames, rejectOutliers, framingAdvice } = await import(`${LIB}/frames.mjs`);
const { TargetLock } = await import(`${LIB}/target.mjs`);
const { detectPhases, detectLaps, LapCounter, WalkDetector } = await import(`${LIB}/phases.mjs`);
const { detectSteps } = await import(`${LIB}/steps.mjs`);
const { shoulderLineDeg, trunkInclinationDeg, torsoOffset, headOffset, percentile, coefficientOfVariation, learnFromStillness, combineMetrics, METRICS_VERSION } = await import(`${LIB}/metrics.mjs`);
const { measuredScore, totalScore, ramp, gradeFor, armAmount, MEASURED_MAX } = await import(`${LIB}/score.mjs`);
const { processFrames, frameAt, poseAt } = await import(`${LIB}/process.mjs`);
const { generateWalk, generateRound, generateSampleRaw, WALK_STYLES } = await import(`${LIB}/sampleWalk.mjs`);

const close = (a, b, eps = 1e-6, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} expected ${b}, got ${a}`);

/** A front-on person, in normalized coordinates, with chosen shoulder positions. */
function person({ cx = 0.5, cy = 0.5, sw = 0.1, torso = 0.2, visibility = 0.95 } = {}) {
  const lm = Array.from({ length: LANDMARK_COUNT }, () => ({ x: cx, y: cy, z: 0, visibility }));
  lm[LM.L_SHOULDER] = { x: cx + sw / 2, y: cy - torso / 2, z: 0, visibility };
  lm[LM.R_SHOULDER] = { x: cx - sw / 2, y: cy - torso / 2, z: 0, visibility };
  lm[LM.L_HIP] = { x: cx + sw / 3, y: cy + torso / 2, z: 0, visibility };
  lm[LM.R_HIP] = { x: cx - sw / 3, y: cy + torso / 2, z: 0, visibility };
  return lm;
}

// ── formulas ──
test('shoulder line: level shoulders read 0 degrees', () => {
  close(shoulderLineDeg([100, 200], [300, 200]), 0);
});

test('shoulder line: folding works in both directions, as when left and right swap on the way back', () => {
  close(shoulderLineDeg([300, 200], [100, 240]), shoulderLineDeg([100, 240], [300, 200]));
  close(shoulderLineDeg([300, 200], [100, 240]), (Math.atan2(-40, 200) * 180) / Math.PI);
  close(shoulderLineDeg([300, 240], [100, 200]), (Math.atan2(40, 200) * 180) / Math.PI);
});

test('shoulder line: a known 45 degree slope', () => {
  close(shoulderLineDeg([0, 0], [100, 100]), 45);
});

test('pixel aspect ratio: geometry uses pixels, not normalized units', () => {
  const W = 1280;
  const H = 720;
  const a = { x: 0.4, y: 0.4 };
  const b = { x: 0.5, y: 0.5 };
  const inPixels = shoulderLineDeg([a.x * W, a.y * H], [b.x * W, b.y * H]);
  close(inPixels, (Math.atan2(72, 128) * 180) / Math.PI, 1e-9);
  assert.ok(Math.abs(inPixels - 45) > 15, 'would have read 45 degrees in normalized units');
  const f = classifyPose(person({ cx: 0.5, sw: 0.25, torso: 0.3 }), W, H);
  close(f.pts[LM.L_SHOULDER][0], (0.5 + 0.125) * W, 1e-6);
  close(f.pts[LM.L_SHOULDER][1], (0.5 - 0.15) * H, 1e-6);
});

test('trunk inclination: upright reads 0 and the sign follows the tilt', () => {
  close(trunkInclinationDeg([500, 100], [500, 300]), 0);
  assert.ok(trunkInclinationDeg([520, 100], [500, 300]) > 0);
  assert.ok(trunkInclinationDeg([480, 100], [500, 300]) < 0);
});

test('scale normalization: walking closer does not change the torso offset', () => {
  // A person 0.3 m to the side with a 0.5 m torso, at 6 m and at 3 m.
  const W = 1280;
  const f = 900;
  const at = (Z) => {
    const pts = [];
    const torso = (f * 0.5) / Z;
    const cx = W / 2 + (f * 0.3) / Z;
    pts[LM.L_SHOULDER] = [cx + 30, 100];
    pts[LM.R_SHOULDER] = [cx - 30, 100];
    pts[LM.L_HIP] = [cx + 30, 100 + torso];
    pts[LM.R_HIP] = [cx - 30, 100 + torso];
    return torsoOffset(pts, W);
  };
  close(at(6), 0.6, 1e-9);
  close(at(3), 0.6, 1e-9, 'offset should not depend on distance;');
});

test('head offset: needs both ears, and never fills one in', () => {
  const pts = [];
  pts[LM.L_SHOULDER] = [600, 100];
  pts[LM.R_SHOULDER] = [400, 100];
  pts[LM.L_HIP] = [600, 300];
  pts[LM.R_HIP] = [400, 300];
  pts[LM.L_EAR] = [530, 50];
  pts[LM.R_EAR] = [490, 50];
  close(headOffset(pts), 0.05, 1e-9);
  pts[LM.R_EAR] = null;
  assert.equal(headOffset(pts), null);
});

test('percentile and variation helpers', () => {
  close(percentile([0, 10], 0.5), 5);
  assert.equal(percentile([], 0.5), null);
  close(coefficientOfVariation([2, 2, 2]), 0);
  close(coefficientOfVariation([1, 3]), 0.5);
  assert.equal(coefficientOfVariation([1]), null);
});

// ── frame filtering ──
test('classify: no pose, low confidence, clipped, too small and side-on are all rejected', () => {
  const W = 1280;
  const H = 720;
  assert.equal(classifyPose(null, W, H).status, 'no-person');
  assert.equal(classifyPose(person(), W, H).status, 'valid');

  const low = person();
  low[LM.L_HIP].visibility = 0.1;
  const lowResult = classifyPose(low, W, H);
  assert.equal(lowResult.status, 'low-confidence');
  assert.equal(lowResult.pts[LM.L_HIP], null, 'an unsure landmark becomes null, not a guess');

  const clipped = person();
  clipped[LM.R_HIP].y = 1.2;
  assert.equal(classifyPose(clipped, W, H).status, 'clipped');

  assert.equal(classifyPose(person({ sw: 0.005, torso: 0.02 }), W, H).status, 'too-small');
  assert.equal(classifyPose(person({ sw: 0.02, torso: 0.3 }), W, H).status, 'side-on');
});

test('classify: an out-of-picture foot is dropped but does not reject the frame', () => {
  const lm = person();
  lm[LM.L_ANKLE] = { x: 0.5, y: 1.1, z: 0, visibility: 0.9 };
  const f = classifyPose(lm, 1280, 720);
  assert.equal(f.status, 'valid');
  assert.equal(f.pts[LM.L_ANKLE], null);
  assert.equal(f.full, false);
});

// ── close-range advice ──
function pointsWith(entries) {
  const pts = new Array(LANDMARK_COUNT).fill(null);
  for (const [k, v] of Object.entries(entries)) pts[k] = v;
  return pts;
}

test('framing: warns before the feet leave the picture, and when they have', () => {
  const H = 1000;
  const hips = { [LM.L_HIP]: [550, 600], [LM.R_HIP]: [450, 600] };
  assert.equal(framingAdvice(pointsWith({ ...hips, [LM.NOSE]: [500, 200], [LM.L_ANKLE]: [540, 900], [LM.R_ANKLE]: [460, 900] }), H), 'ok');
  assert.equal(framingAdvice(pointsWith({ ...hips, [LM.NOSE]: [500, 200], [LM.L_ANKLE]: [540, 980], [LM.R_ANKLE]: [460, 900] }), H), 'near-limit');
  assert.equal(framingAdvice(pointsWith({ ...hips, [LM.NOSE]: [500, 30], [LM.L_ANKLE]: [540, 900] }), H), 'near-limit');
  assert.equal(framingAdvice(pointsWith({ ...hips, [LM.NOSE]: [500, 200] }), H), 'feet-out');
  assert.equal(framingAdvice(pointsWith({ ...hips, [LM.L_ANKLE]: [540, 900] }), H), 'head-out');
  assert.equal(framingAdvice(null, H), 'none');
});

// ── outliers ──
function steadyFrames(count = 40, y = 500) {
  return Array.from({ length: count }, (_, i) => {
    const pts = new Array(LANDMARK_COUNT).fill(null);
    pts[LM.L_SHOULDER] = [600, 300, 0.9];
    pts[LM.R_SHOULDER] = [400, 300, 0.9];
    pts[LM.L_HIP] = [570, y, 0.9];
    pts[LM.R_HIP] = [430, y, 0.9];
    pts[LM.L_KNEE] = [570, y + 200, 0.9];
    pts[LM.L_ANKLE] = [570, y + 400, 0.9];
    return { t: i / 30, status: 'valid', pts };
  });
}

test('outliers: a one-frame glitch is removed, not smoothed in', () => {
  const frames = steadyFrames();
  frames[20].pts[LM.L_ANKLE] = [100, 200, 0.9];
  const out = rejectOutliers(frames);
  assert.equal(out[20].pts[LM.L_ANKLE], null);
  assert.deepEqual(out[19].pts[LM.L_ANKLE], [570, 900, 0.9], 'its neighbors are untouched');
});

test('outliers: steady fast movement is kept', () => {
  const frames = steadyFrames();
  frames.forEach((f, i) => { f.pts[LM.L_ANKLE] = [570 + i * 25, 900, 0.9]; });
  const out = rejectOutliers(frames, { maxLimb: 100, minLimb: 0 });
  assert.ok(out.every((f) => f.pts[LM.L_ANKLE]), 'a fast foot is not an error');
});

test('outliers: an impossible limb loses its far end, however steady', () => {
  const frames = steadyFrames(40);
  for (let i = 30; i < 40; i++) frames[i].pts[LM.L_ANKLE] = [570, 1500, 0.9];
  const out = rejectOutliers(frames, { maxJump: 100 });
  assert.equal(out[35].pts[LM.L_ANKLE], null, 'a shin 2.2 times normal length is not real');
  assert.ok(out[5].pts[LM.L_ANKLE]);
});

// ── smoothing ──
test('One Euro: first value passes through and a constant stays constant', () => {
  const f = new OneEuro();
  assert.equal(f.filter(5, 0), 5);
  close(f.filter(5, 0.1), 5);
});

test('One Euro: it reduces jitter', () => {
  const f = new OneEuro({ minCutoff: 1, beta: 0 });
  let rawSpread = 0;
  let outSpread = 0;
  for (let i = 0; i < 100; i++) {
    const raw = i % 2 ? 0.51 : 0.49;
    const out = f.filter(raw, i / 30);
    rawSpread = Math.max(rawSpread, Math.abs(raw - 0.5));
    if (i > 20) outSpread = Math.max(outSpread, Math.abs(out - 0.5));
  }
  assert.ok(outSpread < rawSpread / 2, `smoothed ${outSpread} vs raw ${rawSpread}`);
});

const flat = (y) => Array.from({ length: LANDMARK_COUNT }, () => [100, y, 0.9]);

test('smoothing: the overlay does not lag behind the body', () => {
  // A point moving at constant speed. A one-way filter trails behind it; two opposing passes should not.
  const H = 1000;
  const frames = Array.from({ length: 60 }, (_, i) => ({ t: i / 30, status: 'valid', pts: flat(100 + i * 10) }));
  const out = smoothFrames(frames, H);
  close(out[30].pts[0][1], 400, 1, 'no lag at mid-clip;');
});

test('smoothing: a tracking gap is never bridged', () => {
  const H = 720;
  const frames = [
    { t: 0, status: 'valid', pts: flat(100) },
    { t: 0.1, status: 'valid', pts: flat(100) },
    { t: 0.2, status: 'no-person', pts: null },
    { t: 0.3, status: 'valid', pts: flat(500) },
  ];
  const out = smoothFrames(frames, H);
  assert.equal(out[2].pts, null, 'the missing frame stays missing');
  close(out[3].pts[0][1], 500, 0.1, 'values after the gap are not pulled toward values before it;');
  close(out[1].pts[0][1], 100, 0.1, 'and the reverse;');
});

test('smoothing: without a gap the same jump is smoothed', () => {
  const out = smoothFrames([{ t: 0, status: 'valid', pts: flat(100) }, { t: 0.033, status: 'valid', pts: flat(500) }], 720);
  assert.ok(out[1].pts[0][1] < 499, `the jump should be damped, got ${out[1].pts[0][1]}`);
});

test('smoothing: a long time jump also resets', () => {
  const out = smoothFrames([{ t: 0, status: 'valid', pts: flat(100) }, { t: 2, status: 'valid', pts: flat(500) }], 720);
  close(out[1].pts[0][1], 500, 0.1);
});

test('smoothing: one lost landmark stays null and resets only itself', () => {
  const make = (y, nullFirst) => Array.from({ length: LANDMARK_COUNT }, (_, i) => (nullFirst && i === 0 ? null : [100, y, 0.9]));
  const out = smoothFrames([
    { t: 0, status: 'valid', pts: make(100, false) },
    { t: 0.033, status: 'valid', pts: make(100, true) },
    { t: 0.066, status: 'valid', pts: make(500, false) },
  ], 720);
  assert.equal(out[1].pts[0], null);
  close(out[2].pts[0][1], 500, 0.1, 'landmark 0 restarted;');
  assert.ok(out[2].pts[1][1] < 499, 'landmark 1 was still being smoothed');
});

// ── overlay interpolation ──
test('pose interpolation: glides between samples', () => {
  const frames = [{ t: 0, pts: flat(100) }, { t: 0.1, pts: flat(200) }];
  close(poseAt(frames, 0.05)[0][1], 150, 1e-9);
  close(poseAt(frames, 0.025)[0][1], 125, 1e-9);
});

test('pose interpolation: never invents a point across a gap or a missing landmark', () => {
  const frames = [{ t: 0, pts: flat(100) }, { t: 1, pts: flat(200) }];
  assert.equal(poseAt(frames, 0.5), null, 'too far from either sample');
  const partial = [{ t: 0, pts: flat(100) }, { t: 0.1, pts: flat(200) }];
  partial[1].pts[3] = null;
  assert.equal(poseAt(partial, 0.05)[3], null);
  assert.equal(poseAt([], 1), null);
  assert.equal(poseAt([{ t: 0, pts: null }, { t: 0.05, pts: flat(1) }], 0.02)?.[0]?.[1] ?? null, null);
});

// ── target lock ──
test('target lock: follows the walker when someone else is bigger', () => {
  const lock = new TargetLock();
  const walker = (cx) => person({ cx, sw: 0.1, torso: 0.2 });
  const bystander = person({ cx: 0.9, sw: 0.14, torso: 0.3 });
  assert.equal(lock.update([walker(0.5)], 0, 1280, 720)[LM.L_SHOULDER].x, walker(0.5)[LM.L_SHOULDER].x);
  const chosen = lock.update([bystander, walker(0.52)], 0.1, 1280, 720);
  close(chosen[LM.L_SHOULDER].x, walker(0.52)[LM.L_SHOULDER].x);
});

test('target lock: refuses a far-away person until the lock expires', () => {
  const lock = new TargetLock();
  lock.update([person({ cx: 0.5 })], 0, 1280, 720);
  assert.equal(lock.update([person({ cx: 0.95 })], 0.1, 1280, 720), null);
  assert.notEqual(lock.update([person({ cx: 0.95 })], 1.5, 1280, 720), null);
});

// ── walk phases ──
const sizeAt = (t) => (t < 4 ? 80 + (t / 4) * 120 : t < 5 ? 200 : 200 - ((t - 5) / 4) * 120);
const walkSeries = () => Array.from({ length: 109 }, (_, i) => ({ t: i / 12, size: sizeAt(i / 12) }));

test('phases: finds approach, turn and back', () => {
  const p = detectPhases(walkSeries());
  assert.equal(p.shape, 'up-and-back');
  assert.ok(p.approach[0] < 0.5 && p.approach[1] > 3 && p.approach[1] < 4.1);
  assert.ok(p.back[0] > 4.9 && p.back[1] > 8.5);
  assert.equal(p.windows.length, 2);
  assert.ok(p.turn[0] <= 4 && p.turn[1] >= 5);
});

test('phases: someone standing still is not a walk', () => {
  const series = Array.from({ length: 80 }, (_, i) => ({ t: i / 12, size: 150 + (i % 2) }));
  assert.equal(detectPhases(series).shape, 'none');
});

test('phases: one-way clips are named as such', () => {
  const up = Array.from({ length: 60 }, (_, i) => ({ t: i / 12, size: 80 + i * 2 }));
  assert.equal(detectPhases(up).shape, 'approach-only');
  const away = Array.from({ length: 60 }, (_, i) => ({ t: i / 12, size: 200 - i * 2 }));
  assert.equal(detectPhases(away).shape, 'away-only');
});

test('phases: a single bad frame does not fake a walk', () => {
  const series = Array.from({ length: 80 }, (_, i) => ({ t: i / 12, size: i === 40 ? 400 : 150 }));
  assert.equal(detectPhases(series).shape, 'none');
});

test('phases: too few frames gives none', () => {
  assert.equal(detectPhases([{ t: 0, size: 100 }]).shape, 'none');
  assert.equal(detectPhases([]).shape, 'none');
});

test('live detector: goes through every phase in order and finishes', () => {
  const d = new WalkDetector();
  const seen = [];
  for (let i = 0; i < 12 * 11; i++) {
    const t = i / 12;
    const phase = d.update(t, sizeAt(t));
    if (seen.at(-1) !== phase) seen.push(phase);
  }
  assert.deepEqual(seen, ['start', 'approach', 'turn', 'back', 'done']);
});

test('live detector: standing still never finishes', () => {
  const d = new WalkDetector();
  for (let i = 0; i < 300; i++) d.update(i / 12, 150 + (i % 2));
  assert.equal(d.phase, 'start');
});

test('live detector: walking out of frame on the way back finishes the walk', () => {
  const d = new WalkDetector();
  for (let i = 0; i < 12 * 7; i++) d.update(i / 12, sizeAt(i / 12));
  assert.equal(d.phase, 'back');
  for (let i = 12 * 7; i < 12 * 9; i++) d.update(i / 12, null);
  assert.equal(d.phase, 'done');
});

test('live detector: starting close to the camera and walking away first still finds the walk', () => {
  const d = new WalkDetector();
  const seen = [];
  for (let i = 0; i < 12 * 14; i++) {
    const t = i / 12;
    const size = t < 3 ? 200 - (t / 3) * 120 : sizeAt(t - 3);
    const phase = d.update(t, size);
    if (seen.at(-1) !== phase) seen.push(phase);
  }
  assert.deepEqual(seen, ['start', 'approach', 'turn', 'back', 'done']);
});

// ── footsteps ──
function stepFrames(cadence, { width = 0.2, seconds = 6, jitter = 0 } = {}) {
  // A person whose ankle heights alternate at a known rate, seen from the front.
  const frames = [];
  let phase = 0;
  let k = 0;
  for (let i = 0; i < seconds * 30; i++) {
    const t = i / 30;
    // Footfalls land at the swing's extremes, so change speed there to make the steps truly uneven.
    k = Math.floor((phase + Math.PI / 2) / Math.PI);
    const rate = cadence * (1 + (k % 2 ? jitter : -jitter));
    phase += (Math.PI * rate) / 30;
    const pts = new Array(LANDMARK_COUNT).fill(null);
    pts[LM.L_SHOULDER] = [600, 300];
    pts[LM.R_SHOULDER] = [400, 300];
    pts[LM.L_HIP] = [570, 600];
    pts[LM.R_HIP] = [430, 600];
    const swing = 40 * Math.sin(phase);
    pts[LM.L_ANKLE] = [500 + width * 100, 950 + swing];
    pts[LM.R_ANKLE] = [500 - width * 100, 950 - swing];
    frames.push({ t, status: 'valid', pts });
  }
  return frames;
}

test('steps: finds the right number of footfalls and their timing', () => {
  const { events, intervals } = detectSteps(stepFrames(2));
  assert.ok(events.length >= 10 && events.length <= 13, `found ${events.length} footfalls in 6 s at 2 per second`);
  close(intervals.reduce((a, b) => a + b, 0) / intervals.length, 0.5, 0.04, 'half a second per step;');
});

test('steps: measures foot separation as a share of height', () => {
  // Feet 40 px apart, torso 300 px, height 3 torso lengths: 40 / 900 = 4.44%.
  const { widths } = detectSteps(stepFrames(2, { width: 0.2 }), { k: 3 });
  close(widths[2], 4.44, 0.02);
  const wide = detectSteps(stepFrames(2, { width: 0.5 }), { k: 3 });
  close(wide.widths[2], 11.11, 0.02);
});

// ── accuracy: the same walk, however it happens to be filmed ──
const roundOf = (style, options) => {
  const { raw, W, H, duration } = generateRound(style, options);
  return processFrames(raw, { W, H, duration });
};

test('foot placement matches the known distance between the feet', () => {
  // Height in the synthetic figure is 1.70 m, from heel to top of head.
  for (const [style, gapPercent] of [['catwalk', 2.35], ['casual', 7.65], ['sloppy', 11.76]]) {
    close(roundOf(style).metrics.footLine.value, gapPercent, 0.5, `${style};`);
  }
});

test('foot placement does not change when someone walks off-centre, at an angle, or the camera is not level', () => {
  for (const style of ['catwalk', 'casual']) {
    const truth = roundOf(style).metrics.footLine.value;
    close(roundOf(style, { build: { offset: 0.6 } }).metrics.footLine.value, truth, 0.3, `${style}, 60 cm off-centre;`);
    close(roundOf(style, { build: { angle: 6 } }).metrics.footLine.value, truth, 0.3, `${style}, 6 degree path;`);
    close(roundOf(style, { roll: 3 }).metrics.footLine.value, truth, 0.3, `${style}, tilted camera;`);
  }
});

test('walking straight but not aimed at the camera costs nothing on the straight line', () => {
  const straight = roundOf('catwalk').metrics.torsoSpread.value;
  close(roundOf('catwalk', { build: { angle: 8 } }).metrics.torsoSpread.value, straight, 1, 'an angled path;');
  close(roundOf('catwalk', { build: { offset: 0.6 } }).metrics.torsoSpread.value, straight, 1, 'off-centre;');
  assert.ok(roundOf('sloppy').metrics.torsoSpread.value > straight * 2.5, 'really wandering still shows');
});

test('60 frames a second gives the same answers, with less noise in step timing', () => {
  for (const style of ['catwalk', 'casual']) {
    const at30 = roundOf(style);
    const at60 = roundOf(style, { fps: 60 });
    assert.equal(at60.laps.length, 3);
    assert.ok(Math.abs(at60.measured.points - at30.measured.points) <= 3, `${style}: ${at30.measured.points} at 30, ${at60.measured.points} at 60`);
    close(at60.metrics.footLine.value, at30.metrics.footLine.value, 0.3, `${style} feet;`);
    close(at60.metrics.shoulderSway.value, at30.metrics.shoulderSway.value, 0.5, `${style} shoulders;`);
  }
  WALK_STYLES.even = { ...WALK_STYLES.catwalk, stepJitter: 0 };
  const noise = (fps) => {
    const values = [11, 22, 33, 44].map((seed) => roundOf('even', { fps, seed }).metrics.stepRhythm.value);
    return values.reduce((a, b) => a + b) / values.length;
  };
  const [at30, at60] = [noise(30), noise(60)];
  delete WALK_STYLES.even;
  assert.ok(at60 < at30, `timing noise ${at60} at 60 Hz, ${at30} at 30 Hz`);
});

test('the toes: measured from heel to toes, on walks both ways', () => {
  const { value } = roundOf('catwalk').metrics.toeOut;
  assert.ok(value > 4 && value < 14, `the figure's toes point out a little: ${value} degrees`);
});

// ── fairness: what someone wears, or how their hair falls ──
const withoutPoints = (style, points) => {
  const { raw, W, H, duration } = generateRound(style);
  for (const frame of raw) for (const i of points) frame.landmarks[i].visibility = 0;
  return processFrames(raw, { W, H, duration });
};

test('hair or a head covering over the ears costs nothing', () => {
  for (const style of ['catwalk', 'casual']) {
    const usual = roundOf(style).measured;
    const covered = withoutPoints(style, [LM.L_EAR, LM.R_EAR]).measured;
    assert.ok(Math.abs(covered.points - usual.points) <= 2, `${style}: ${usual.points} with ears, ${covered.points} without`);
    assert.equal(covered.parts.find((p) => p.key === 'head').seen, true, 'the top of the head stands in');
    assert.equal(covered.scaled, null);
  }
});

test('with no head points at all, posture is judged on the rest rather than marked down', () => {
  const usual = roundOf('catwalk').measured;
  const hidden = withoutPoints('catwalk', [LM.L_EAR, LM.R_EAR, LM.HEAD_TOP, LM.NECK, LM.NOSE, LM.L_EYE, LM.R_EYE]).measured;
  const posture = (m) => m.parts.find((p) => p.key === 'posture').points;
  assert.ok(Math.abs(posture(hidden) - posture(usual)) <= 2, `${posture(usual)} with a head, ${posture(hidden)} without`);
  assert.deepEqual(hidden.scaled.unseen, ['Head steadiness']);
});

test('a long gown hiding the feet is left out rather than marked down, and the app can say so', () => {
  const usual = roundOf('catwalk').measured;
  const gown = withoutPoints('catwalk', [LM.L_ANKLE, LM.R_ANKLE, LM.L_HEEL, LM.R_HEEL, LM.L_FOOT, LM.R_FOOT, LM.L_SMALL_TOE, LM.R_SMALL_TOE]).measured;
  assert.equal(gown.ok, true);
  assert.deepEqual(gown.scaled.unseen, ['Foot placement']);
  assert.equal(gown.scaled.seenMax, 50);
  assert.ok(Math.abs(gown.points - usual.points) <= 6, `${usual.points} with feet, ${gown.points} in a gown`);
  assert.equal(gown.parts.find((p) => p.key === 'rhythm').seen, true, 'speed still counts toward rhythm');
});

test('too little in view is refused rather than scored', () => {
  const r = withoutPoints('catwalk', [LM.L_ANKLE, LM.R_ANKLE, LM.L_HEEL, LM.R_HEEL, LM.L_FOOT, LM.R_FOOT, LM.L_WRIST, LM.R_WRIST, LM.L_EAR, LM.R_EAR, LM.HEAD_TOP, LM.NOSE, LM.NECK]);
  // Feet, arms and head are gone, which leaves 40 of the 70: right at the line, and still fair.
  assert.equal(r.measured.ok, true);
  assert.equal(r.measured.scaled.seenMax, 40);
  const none = { ...r.metrics, footLine: { ok: false, why: 'x' }, stepRhythm: { ok: false, why: 'x' }, pace: { ok: false, why: 'x' }, cadence: null };
  const refused = measuredScore(none, { shape: 'up-and-back' });
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /too little/);
});

test('both trackers measure the same walk the same way, and MediaPipe has no toes to confuse with its eyes', () => {
  for (const style of ['catwalk', 'casual']) {
    const usual = roundOf(style);
    const fallback = withoutPoints(style, [LM.HEAD_TOP, LM.NECK, LM.HIP_CENTER, LM.L_SMALL_TOE, LM.R_SMALL_TOE]);
    close(fallback.metrics.footLine.value, usual.metrics.footLine.value, 0.2, `${style} feet;`);
    assert.ok(Math.abs(fallback.measured.points - usual.measured.points) <= 3, `${style}: ${usual.measured.points}, ${fallback.measured.points}`);
  }
  const slots = [LM.HEAD_TOP, LM.NECK, LM.HIP_CENTER, LM.L_SMALL_TOE, LM.R_SMALL_TOE];
  assert.ok(slots.every((slot) => slot >= 33 && slot < LANDMARK_COUNT), 'beyond the 33 slots MediaPipe fills');
});

test('steps: uneven steps give more variation than even ones', () => {
  const even = coefficientOfVariation(detectSteps(stepFrames(2)).intervals);
  const uneven = coefficientOfVariation(detectSteps(stepFrames(2, { jitter: 0.3 })).intervals);
  assert.ok(uneven > even + 0.03, `even ${even}, uneven ${uneven}`);
});

test('steps: standing still has no steps, and noise is not steps', () => {
  const still = stepFrames(2);
  still.forEach((f, i) => {
    f.pts[LM.L_ANKLE] = [520, 950 + (i % 3)];
    f.pts[LM.R_ANKLE] = [480, 950 - (i % 3)];
  });
  assert.equal(detectSteps(still).events.length, 0);
});

test('steps: frames with no ankles are skipped without inventing steps', () => {
  const frames = stepFrames(2);
  frames.forEach((f) => { f.pts[LM.L_ANKLE] = null; });
  assert.equal(detectSteps(frames).events.length, 0);
});

// ── gates ──
test('insufficient data: a clip with no person has no values and says why', () => {
  const raw = Array.from({ length: 100 }, (_, i) => ({ t: i / 12, landmarks: null }));
  const r = processFrames(raw, { W: 1280, H: 720, duration: 8 });
  assert.equal(r.metrics.gate.ok, false);
  assert.match(r.metrics.gate.reason, /could not find a person/);
  for (const key of ['footLine', 'stepRhythm', 'pace', 'shoulderSway', 'trunkSway', 'torsoSpread', 'headMovement', 'bounce']) {
    assert.equal(r.metrics[key].ok, false, key);
    assert.equal(r.metrics[key].value, null, `${key} must not invent a value`);
  }
  assert.equal(r.measured.ok, false);
  assert.equal(r.measured.points, null);
});

test('insufficient data: too short to measure', () => {
  const raw = Array.from({ length: 20 }, (_, i) => ({ t: i / 12, landmarks: person() }));
  const r = processFrames(raw, { W: 1280, H: 720, duration: 2 });
  assert.equal(r.metrics.gate.ok, false);
  assert.equal(r.measured.ok, false);
});

test('insufficient data: standing perfectly still earns no score', () => {
  const raw = Array.from({ length: 120 }, (_, i) => ({ t: i / 12, landmarks: person() }));
  const r = processFrames(raw, { W: 1280, H: 720, duration: 10 });
  assert.equal(r.metrics.gate.ok, true, 'the clip can still be described');
  assert.equal(r.metrics.shoulderSway.ok, true);
  assert.equal(r.measured.ok, false);
  assert.match(r.measured.reason, /did not see a walk/);
});

test('metrics carry a version', () => {
  const r = processFrames([], { W: 1280, H: 720, duration: 0 });
  assert.equal(r.metrics.version, METRICS_VERSION);
});

// ── score ──
test('ramp: works in both directions', () => {
  assert.equal(ramp(0, 1, 8), 1);
  assert.equal(ramp(8, 1, 8), 0);
  close(ramp(4.5, 1, 8), 0.5);
  assert.equal(ramp(0.6, 0.5, 0.3), 1);
  assert.equal(ramp(0.2, 0.5, 0.3), 0);
  close(ramp(0.4, 0.5, 0.3), 0.5);
});

test('arm swing: relaxed is best; stiff and flailing both lose', () => {
  assert.equal(armAmount(10), 1);
  // Professional models on a real runway swung 1.4 to 4.8% of their height, so a small swing is not stiff.
  assert.equal(armAmount(1.4), 1);
  assert.ok(armAmount(0.5) < 0.5);
  assert.ok(armAmount(32) < 0.5);
});

test('total exists only when both halves do, and is the plain sum', () => {
  const measured = { ok: true, points: 30 };
  const judge = { ok: true, presence: { score: 20 }, style: { score: 15 } };
  assert.equal(totalScore(measured, judge), 65);
  assert.equal(totalScore(measured, null), null);
  assert.equal(totalScore({ ok: false }, judge), null);
  assert.equal(totalScore(measured, { ok: false }), null);
});

test('grades cover the whole range', () => {
  assert.equal(gradeFor(100).label, 'Front row silence');
  assert.equal(gradeFor(50).label, 'Warming up');
  assert.equal(gradeFor(0).label, 'Just passing through');
});

// ── the point of the redesign: different walks must get different scores ──
const scoreOf = (style, seed) => {
  const { raw, W, H, duration } = generateWalk(style, seed ? { seed } : undefined);
  return processFrames(raw, { W, H, duration });
};

for (const style of ['catwalk', 'casual', 'sloppy']) {
  test(`synthetic ${style} walk: passes the gates and scores within the range`, () => {
    const r = scoreOf(style);
    assert.equal(r.phases.shape, 'up-and-back');
    assert.equal(r.metrics.gate.ok, true, r.metrics.gate.reason);
    assert.equal(r.measured.ok, true, r.measured.reason);
    assert.ok(r.measured.points >= 0 && r.measured.points <= MEASURED_MAX);
    assert.equal(r.measured.parts.reduce((s, p) => s + p.max, 0), MEASURED_MAX);
  });
}

test('scoring separates walks: catwalk is far above casual, and casual above sloppy', () => {
  const catwalk = scoreOf('catwalk').measured.points;
  const casual = scoreOf('casual').measured.points;
  const sloppy = scoreOf('sloppy').measured.points;
  assert.ok(catwalk >= casual + 15, `catwalk ${catwalk}, casual ${casual}`);
  assert.ok(casual >= sloppy + 8, `casual ${casual}, sloppy ${sloppy}`);
});

test('a casual walk does not get a high score', () => {
  for (const seed of [1, 22, 333, 4444]) {
    const { points } = scoreOf('casual', seed).measured;
    assert.ok(points <= 46, `seed ${seed}: casual scored ${points} of 70`);
  }
});

test('a sloppy walk scores low', () => {
  for (const seed of [1, 22, 333]) {
    const { points } = scoreOf('sloppy', seed).measured;
    assert.ok(points <= 25, `seed ${seed}: sloppy scored ${points} of 70`);
  }
});

test('a controlled walk can earn most of the measured points', () => {
  for (const seed of [1, 22, 333]) {
    const { points } = scoreOf('catwalk', seed).measured;
    assert.ok(points >= 55, `seed ${seed}: catwalk scored ${points} of 70`);
  }
});

test('foot placement alone moves the score', () => {
  const r = scoreOf('catwalk');
  const close1 = r.measured.parts.find((p) => p.key === 'footLine').points;
  const wide = scoreOf('casual').measured.parts.find((p) => p.key === 'footLine').points;
  assert.ok(close1 > wide + 5, `narrow ${close1}, wide ${wide}`);
});

test('every criterion explains itself, and the weakest one gets a tip', () => {
  const r = scoreOf('casual');
  for (const part of r.measured.parts) {
    assert.ok(part.note.length > 5 && part.tip.length > 5 && part.about.length > 5, part.key);
    assert.ok(!/undefined|NaN|null/.test(part.note), `${part.key}: ${part.note}`);
  }
  assert.ok(r.measured.focus?.tip);
});

test('the result names a strongest part that is not the biggest win, and a perfect walk still gets one', () => {
  const casual = scoreOf('casual').measured;
  if (casual.strength) assert.notEqual(casual.strength.label, casual.focus.label);
  const catwalk = scoreOf('catwalk').measured;
  assert.ok(catwalk.strength, 'a top walk still hears what it did best');
  assert.ok(catwalk.strength.points >= catwalk.strength.max / 2);
});

test('measurements with real-world reference values show them, and only those', () => {
  const r = scoreOf('casual');
  const lines = r.measured.parts.flatMap((p) => p.why);
  const foot = lines.find((w) => w.label === 'Distance between feet');
  assert.match(foot.ref, /Milan runway/);
  const turn = lines.find((w) => w.label === 'Turn time');
  assert.equal(turn.ref, null, 'no footage measured turns, so none is claimed');
});

test('feet out of frame leaves out the foot points and says why, rather than guessing', () => {
  const { raw, W, H, duration } = generateWalk('catwalk');
  for (const frame of raw) {
    frame.landmarks[LM.L_ANKLE].visibility = 0;
    frame.landmarks[LM.R_ANKLE].visibility = 0;
  }
  const r = processFrames(raw, { W, H, duration });
  assert.equal(r.measured.ok, true, 'the rest of the walk still counts');
  const foot = r.measured.parts.find((p) => p.key === 'footLine');
  assert.equal(foot.points, 0);
  assert.equal(foot.seen, false);
  assert.match(foot.note, /could not follow your feet/);
  assert.equal(r.measured.scaled.seenMax, 50);
  assert.ok(!r.measured.focus || r.measured.focus.label !== 'Foot placement', 'no coaching on what we could not see');
});

test('sample walk: is the same every time and matches its known shape', () => {
  assert.deepEqual(generateSampleRaw().raw[50], generateSampleRaw().raw[50]);
  const { raw, W, H, duration } = generateSampleRaw();
  const r = processFrames(raw, { W, H, duration });
  assert.ok(r.metrics.coverage.ratio > 0.9, `coverage ${r.metrics.coverage.ratio}`);
  assert.ok(r.metrics.stepCount >= 8, `steps ${r.metrics.stepCount}`);
  assert.equal(r.laps.length, 2);
  assert.ok(r.stance, 'it stands still first, so it calibrates');
});

test('metrics recover known geometry: a catwalk really has narrower feet than a casual walk', () => {
  const narrow = scoreOf('catwalk').metrics.footLine.value;
  const wide = scoreOf('casual').metrics.footLine.value;
  assert.ok(narrow < 4, `catwalk feet ${narrow}% of height`);
  assert.ok(wide > 5, `casual feet ${wide}% of height`);
});

test('frameAt: finds the nearest frame and refuses a far one', () => {
  const frames = [{ t: 0 }, { t: 1 }, { t: 2 }];
  assert.equal(frameAt(frames, 1.1).t, 1);
  assert.equal(frameAt(frames, 1.5, 0.2), null);
  assert.equal(frameAt([], 1), null);
});

// ── RTMPose helpers ──
const { chooseBox, cropFor, decodeSimcc, boxFromPoints, toLandmarks } = await import('../src/pose/rtmpose.mjs');

test('rtmpose crop: padded and shaped 3:4, centred on the box', () => {
  const crop = cropFor({ x0: 100, y0: 100, x1: 300, y1: 700 });
  close(crop.cx, 200);
  close(crop.cy, 400);
  close(crop.w / crop.h, 0.75, 1e-9);
  assert.ok(crop.h >= 600 * 1.25 - 1e-9);
  const wide = cropFor({ x0: 0, y0: 0, x1: 800, y1: 200 });
  close(wide.w / wide.h, 0.75, 1e-9);
  assert.ok(wide.w >= 800 * 1.25 - 1e-9);
});

test('rtmpose decode: maps the peak back to picture coordinates', () => {
  const keypoints = 2;
  const xs = new Float32Array(keypoints * 384);
  const ys = new Float32Array(keypoints * 512);
  xs[192] = 0.9; // Keypoint 0 peaks at the centre column.
  ys[256] = 0.8; // and the centre row.
  xs[384 + 0] = 0.5; // Keypoint 1 peaks at the left edge,
  ys[512 + 0] = 0.7; // and the top edge.
  const crop = { cx: 500, cy: 400, w: 300, h: 400 };
  const [a, b] = decodeSimcc(xs, ys, keypoints, crop);
  close(a.x, 500, 1e-6);
  close(a.y, 400, 1e-6);
  close(a.score, 0.8, 1e-6, 'score is the lower of the two peaks;');
  close(b.x, 350, 1e-6);
  close(b.y, 200, 1e-6);
});

test('rtmpose box: comes from confident points, and refuses when too little was found', () => {
  const points = Array.from({ length: 26 }, (_, i) => ({ x: 100 + i * 10, y: 200 + i * 10, score: 0.9 }));
  const box = boxFromPoints(points);
  assert.ok(box.x0 < 100 && box.x1 > 350 && box.y0 < 200 && box.y1 > 450);
  const poor = points.map((p) => ({ ...p, score: 0.1 }));
  assert.equal(boxFromPoints(poor), null);
});

test('rtmpose landmarks: fill the right slots, and leave the rest empty', () => {
  const points = Array.from({ length: 26 }, (_, i) => ({ x: i, y: i, score: 0.6 }));
  points[15] = { x: 500, y: 900, score: 0.15 };
  const lm = toLandmarks(points, 1000, 1000);
  assert.equal(lm.length, LANDMARK_COUNT);
  close(lm[LM.L_ANKLE].x, 0.5);
  close(lm[LM.L_ANKLE].visibility, 0.25, 1e-9, 'a weak point stays below the 0.5 usable line;');
  assert.equal(lm[LM.L_SHOULDER].visibility, 1);
  assert.equal(lm[10].visibility, 0, 'slots RTMPose has no point for stay empty');
  assert.ok(lm[LM.HEAD_TOP].visibility > 0 && lm[LM.NECK].visibility > 0 && lm[LM.L_SMALL_TOE].visibility > 0, 'all 26 points are used');
  assert.ok(lm[LM.L_HEEL].visibility > 0 && lm[LM.L_FOOT].visibility > 0, 'it does give feet');
});

test('rtmpose person choice: follows overlap, or starts with someone large and central', () => {
  const near = { x0: 400, y0: 100, x1: 600, y1: 700 };
  const edge = { x0: 0, y0: 50, x1: 300, y1: 800 };
  assert.equal(chooseBox([edge, near], null, 1000), near);
  const previous = { x0: 20, y0: 60, x1: 310, y1: 790 };
  assert.equal(chooseBox([near, edge], previous, 1000), edge);
  assert.equal(chooseBox([near], { x0: 800, y0: 800, x1: 900, y1: 900 }, 1000), null, 'someone else entirely is not followed');
  assert.equal(chooseBox([], null, 1000), null);
});

// ── camera choice ──
const { usableCameras, preferredCamera, recordingBitrate, BEST_VIDEO, SMOOTH_VIDEO } = await import('../src/capture/camera.mjs');

test('cameras: insists on 50+ fps first, and falls back to the best picture', () => {
  assert.deepEqual(SMOOTH_VIDEO.frameRate, { min: 50, ideal: 60 }, 'a minimum, so the camera cannot trade it away');
  assert.equal(SMOOTH_VIDEO.height.ideal, 1080);
  assert.deepEqual(BEST_VIDEO, { width: { ideal: 1920 }, height: { ideal: 1440 }, frameRate: { ideal: 60 } });
});

test('cameras: Desk View is left out, the iPhone is preferred, and a saved choice wins', () => {
  const cams = [{ id: 'a', label: 'MacBook Pro Camera' }, { id: 'b', label: 'K iPhone Camera' }, { id: 'c', label: 'K iPhone Desk View Camera' }, { id: 'd', label: 'MacBook Pro Desk View Camera' }];
  const usable = usableCameras(cams);
  assert.deepEqual(usable.map((c) => c.id), ['a', 'b']);
  assert.equal(preferredCamera(usable, null).id, 'b');
  assert.equal(preferredCamera(usable, 'a').id, 'a');
  assert.equal(preferredCamera(usable, 'gone').id, 'b');
  assert.equal(preferredCamera([{ id: 'x', label: 'Webcam' }], null).id, 'x');
  assert.equal(preferredCamera([], null), null);
});

test('cameras: the bitrate rises with size and speed, within limits', () => {
  const best = recordingBitrate({ width: 1920, height: 1440, frameRate: 60 });
  assert.ok(best >= 14_000_000 && best <= 24_000_000, `got ${best}`);
  assert.ok(recordingBitrate({ width: 640, height: 480, frameRate: 30 }) >= 4_000_000);
  assert.ok(recordingBitrate({}) >= 4_000_000);
});

// ── several walks ──
test('laps: finds three walks in one recording', () => {
  const { raw, W, H, duration } = generateRound('casual', { laps: 3 });
  const r = processFrames(raw, { W, H, duration });
  assert.equal(r.laps.length, 3);
  assert.equal(r.measured.laps.length, 3);
  assert.equal(r.measured.lapsUsed, 3);
  for (let i = 1; i < 3; i++) assert.ok(r.laps[i].approach[0] > r.laps[i - 1].back[0], 'in order');
});

test('laps: a single walk is one lap, and standing still is none', () => {
  const { raw, W, H, duration } = generateWalk('casual');
  assert.equal(processFrames(raw, { W, H, duration }).laps.length, 1);
  assert.equal(detectLaps(Array.from({ length: 200 }, (_, i) => ({ t: i / 30, size: 150 + (i % 3) }))).length, 0);
  assert.equal(detectLaps([]).length, 0);
});

test('laps: a bad frame in the middle of a walk does not split it', () => {
  const series = Array.from({ length: 300 }, (_, i) => {
    const t = i / 30;
    return { t, size: (i === 60 ? 40 : 100 + 100 * Math.sin((Math.PI * t) / 10)) };
  });
  assert.equal(detectLaps(series).length, 1);
});

test('lap counter: counts live, and only finishes after the last walk', () => {
  const counter = new LapCounter(2);
  const size = (t) => {
    const lap = t % 10;
    return lap < 4 ? 80 + (lap / 4) * 120 : lap < 5 ? 200 : 200 - ((lap - 5) / 4) * 120;
  };
  let doneAt = null;
  const laps = new Set();
  for (let i = 0; i < 30 * 30 && doneAt === null; i++) {
    const t = i / 30;
    laps.add(counter.lap);
    if (counter.update(t, size(t)) === 'done') doneAt = t;
  }
  assert.deepEqual([...laps], [1, 2]);
  assert.ok(doneAt > 15 && doneAt < 22, `finished at ${doneAt}`);
  assert.equal(counter.update(99, 100), 'done', 'and stays done');
});

test('median of walks: one terrible walk barely moves the score, but it would swing an average', () => {
  const good = generateRound('catwalk', { laps: 3 });
  const steady = processFrames(good.raw, { W: good.W, H: good.H, duration: good.duration }).measured.points;
  // Make the second walk a shambles by swapping in a sloppy lap of the same length.
  const a = generateRound('catwalk', { laps: 1, standSeconds: 1.5 });
  const b = generateWalk('sloppy', { seed: 5 });
  const c = generateWalk('catwalk', { seed: 9 });
  let offset = a.duration;
  const raw = [...a.raw];
  for (const walk of [b, c]) {
    for (const f of walk.raw) raw.push({ t: Math.round((f.t + offset) * 1000) / 1000, landmarks: f.landmarks });
    offset += walk.duration + 1 / 30;
  }
  const r = processFrames(raw, { W: a.W, H: a.H, duration: offset });
  const lapPoints = r.measured.laps.map((l) => l.points);
  assert.ok(lapPoints[1] < lapPoints[0] - 15, `the bad lap really is bad: ${lapPoints}`);
  assert.ok(Math.abs(r.measured.points - steady) <= 6, `median ${r.measured.points} against ${steady}`);
});

test('a lap that cannot be measured is dropped, and the others carry the score', () => {
  const { raw, W, H, duration } = generateRound('catwalk', { laps: 3 });
  const first = processFrames(raw, { W, H, duration });
  const [start, end] = [first.laps[1].approach[0], first.laps[1].back[1]];
  // Hide the person's core for most of the second walk, keeping just enough size signal to find the lap.
  for (const frame of raw) {
    if (frame.t > start + 0.4 && frame.t < end - 0.4) frame.landmarks.forEach((p, i) => { if (i !== LM.L_SHOULDER && i !== LM.R_SHOULDER && i !== LM.L_HIP && i !== LM.R_HIP) return; p.visibility = frame.t % 0.3 < 0.25 ? 0.1 : 0.97; });
  }
  const r = processFrames(raw, { W, H, duration });
  assert.equal(r.measured.ok, true, r.measured.reason);
  assert.ok(r.measured.points >= 45, `still scored on the good walks: ${r.measured.points}`);
});

// ── calibration ──
test('calibration: learns from standing still, and refuses a clip that starts mid-stride', () => {
  const { raw, W, H, duration } = generateRound('catwalk', { laps: 1 });
  const r = processFrames(raw, { W, H, duration });
  assert.ok(r.stance.seconds >= 1, `learned from ${r.stance.seconds} s`);
  assert.equal(r.metrics.calibrated, true);
  const walk = generateWalk('catwalk');
  const direct = processFrames(walk.raw, { W: walk.W, H: walk.H, duration: walk.duration });
  assert.equal(direct.stance, null);
  assert.equal(direct.metrics.calibrated, false);
  assert.equal(direct.measured.ok, true, 'a clip with no standing moment still gets a score');
  assert.equal(learnFromStillness([], 3), null);
  assert.equal(learnFromStillness([], null), null);
});

test('calibration: body build does not change the score, only how much the head drops', () => {
  // Two people with different neck proportions, both walking tall.
  const scoreWithNeckShift = (shift) => {
    const { raw, W, H, duration } = generateRound('catwalk', { laps: 1 });
    for (const frame of raw) {
      for (const i of [LM.NOSE, LM.L_EYE, LM.R_EYE, LM.L_EAR, LM.R_EAR]) frame.landmarks[i].y -= shift;
    }
    return processFrames(raw, { W, H, duration }).measured.points;
  };
  close(scoreWithNeckShift(0.0), scoreWithNeckShift(-0.012), 2, 'a shorter neck should not cost points;');
});

test('calibration: a head that drops while walking loses points against that person\'s own stance', () => {
  const round = (drop) => {
    const { raw, W, H, duration } = generateRound('catwalk', { laps: 1, standSeconds: 1.5 });
    for (const frame of raw) {
      if (frame.t < 1.5) continue;
      for (const i of [LM.NOSE, LM.L_EYE, LM.R_EYE, LM.L_EAR, LM.R_EAR]) frame.landmarks[i].y += drop;
    }
    return processFrames(raw, { W, H, duration }).measured.parts.find((p) => p.key === 'posture').points;
  };
  assert.ok(round(0.012) < round(0), `dropped ${round(0.012)}, tall ${round(0)}`);
});

test('calibration: wobble from the tracker is taken off, so a noisy setup is not punished for itself', () => {
  const quiet = generateRound('catwalk', { laps: 1, noisePx: 0.5 });
  const noisy = generateRound('catwalk', { laps: 1, noisePx: 6 });
  const score = (w) => processFrames(w.raw, { W: w.W, H: w.H, duration: w.duration }).measured.points;
  assert.ok(Math.abs(score(quiet) - score(noisy)) <= 9, `quiet ${score(quiet)}, noisy ${score(noisy)}`);
});

test('combining: takes medians and adds up counts', () => {
  const m = (v, steps, valid) => ({
    version: 'x', gate: { ok: true }, stepCount: steps, cadence: 100 + v,
    coverage: { sampled: 10, valid, ratio: valid / 10, validSeconds: valid / 10, counts: { valid } },
    footLine: { ok: true, value: v, n: 1 },
  });
  const c = combineMetrics([m(1, 4, 8), m(9, 6, 10), m(2, 5, 6)]);
  assert.equal(c.footLine.value, 2);
  assert.equal(c.stepCount, 15);
  assert.equal(c.cadence, 102);
  assert.equal(c.coverage.valid, 24);
  assert.equal(c.lapCount, 3);
});

// ── it must not break ──
function randomSource(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

test('never breaks: hundreds of corrupted walks do not crash, and never produce a bad number', () => {
  const base = generateRound('casual', { laps: 2 });
  for (let seed = 1; seed <= 300; seed++) {
    const random = randomSource(seed * 7919);
    const damage = random();
    const raw = base.raw.map((frame) => {
      const roll = random();
      if (roll < damage * 0.4) return { t: frame.t, landmarks: null };
      if (roll < damage * 0.5) return { t: frame.t, landmarks: frame.landmarks.map(() => ({ x: random() * 3 - 1, y: random() * 3 - 1, visibility: random() })) };
      const landmarks = frame.landmarks.map((p) => {
        const r = random();
        if (r < damage * 0.15) return { ...p, visibility: 0 };
        if (r < damage * 0.2) return { ...p, x: random() * 4 - 2, y: random() * 4 - 2 };
        return p;
      });
      return { t: frame.t, landmarks };
    });
    const r = processFrames(raw, { W: base.W, H: base.H, duration: base.duration });
    assert.ok(typeof r.measured.ok === 'boolean', `seed ${seed}`);
    if (r.measured.ok) {
      assert.ok(Number.isInteger(r.measured.points) && r.measured.points >= 0 && r.measured.points <= MEASURED_MAX, `seed ${seed}: ${r.measured.points}`);
      for (const part of r.measured.parts) {
        assert.ok(Number.isFinite(part.points) && part.points >= 0 && part.points <= part.max, `seed ${seed} ${part.key}: ${part.points}`);
        assert.ok(!/undefined|NaN/.test(part.note), `seed ${seed} ${part.key}: ${part.note}`);
      }
    } else {
      assert.ok(r.measured.reason.length > 5, `seed ${seed} must explain itself`);
    }
    for (const value of Object.values(r.metrics)) {
      if (value && typeof value === 'object' && 'value' in value && value.value !== null) assert.ok(Number.isFinite(value.value), `seed ${seed}: ${value.key} = ${value.value}`);
    }
  }
});

test('never breaks: edge cases', () => {
  const size = { W: 1280, H: 720, duration: 1 };
  assert.equal(processFrames([], size).measured.ok, false);
  assert.equal(processFrames([{ t: 0, landmarks: null }], size).measured.ok, false);
  assert.equal(processFrames([{ t: 0, landmarks: person() }], size).measured.ok, false);
  const allSame = Array.from({ length: 50 }, () => ({ t: 1, landmarks: person() }));
  assert.equal(processFrames(allSame, size).measured.ok, false, 'identical timestamps');
  const empty = Array.from({ length: 200 }, (_, i) => ({ t: i / 30, landmarks: Array.from({ length: LANDMARK_COUNT }, () => ({ x: 0, y: 0, visibility: 0 })) }));
  assert.equal(processFrames(empty, size).measured.ok, false, 'nothing visible');
  assert.equal(poseAt(processFrames([], size).frames, 3), null);
});

// ── fairness: the same walk must get the same score, whatever body does it ──
const roundScore = (build, style = 'casual') => {
  const { raw, W, H, duration } = generateRound(style, { laps: 3, build });
  return processFrames(raw, { W, H, duration }).measured.points;
};

for (const [name, build] of [
  ['narrow shoulders', { shoulders: 0.78 }],
  ['broad shoulders', { shoulders: 1.25 }],
  ['a short torso', { torso: 0.9 }],
  ['a long torso', { torso: 1.1 }],
  ['a short person', { scale: 0.88 }],
  ['a tall person', { scale: 1.12 }],
]) {
  test(`fairness: ${name} doing the same walk gets the same score`, () => {
    for (const style of ['catwalk', 'casual']) {
      const reference = roundScore({}, style);
      const score = roundScore(build, style);
      assert.ok(Math.abs(score - reference) <= 4, `${style}: ${score} against ${reference}`);
    }
  });
}

test('fairness: bodies do not change the order of walks', () => {
  for (const build of [{ shoulders: 1.25 }, { scale: 0.88 }, { torso: 1.1 }]) {
    assert.ok(roundScore(build, 'catwalk') > roundScore(build, 'casual') + 8);
    assert.ok(roundScore(build, 'casual') > roundScore(build, 'sloppy') + 8);
  }
});

test('fairness: standing height is measured, in torso lengths, for each person', () => {
  const measure = (build) => {
    const { raw, W, H, duration } = generateRound('catwalk', { laps: 1, build });
    return processFrames(raw, { W, H, duration }).stance.heightRatio;
  };
  const typical = measure({});
  assert.ok(typical > 3 && typical < 4, `measured ${typical}`);
  assert.ok(measure({ torso: 1.1 }) < typical, 'a longer torso is a smaller share of height');
});

test('reasoning: every criterion gives its measurements, its scale and its share of the marks', () => {
  const { raw, W, H, duration } = generateRound('casual', { laps: 2 });
  const { measured } = processFrames(raw, { W, H, duration });
  for (const part of measured.parts) {
    assert.ok(part.why.length >= 1, part.key);
    for (const line of part.why) {
      assert.ok(line.label && line.value && line.scale, `${part.key}: ${JSON.stringify(line)}`);
      assert.ok(line.share >= 0 && line.share <= 100, `${part.key} ${line.label}: ${line.share}`);
      assert.ok(!/undefined|NaN|null/.test(`${line.value} ${line.scale}`), `${part.key}: ${line.value} ${line.scale}`);
    }
    assert.ok(/Full marks|No data|Not enough/.test(part.why[0].scale) || part.why[0].value === 'No data', `${part.key}: ${part.why[0].scale}`);
  }
});

test('small movements: a slightly dropped head or shifted shoulders changes the measurement', () => {
  const measure = (change) => {
    const { raw, W, H, duration } = generateRound('catwalk', { laps: 1, noisePx: 0.5 });
    for (const frame of raw) if (frame.t >= 1.5) change(frame.landmarks);
    return processFrames(raw, { W, H, duration }).metrics;
  };
  const base = measure(() => {});
  const dropped = measure((lm) => { for (const i of [LM.NOSE, LM.L_EYE, LM.R_EYE, LM.L_EAR, LM.R_EAR]) lm[i].y += 0.004; });
  assert.ok(dropped.neckDrop.value > base.neckDrop.value + 0.2, `head drop ${base.neckDrop.value} to ${dropped.neckDrop.value}`);
  const tilted = measure((lm) => { lm[LM.L_SHOULDER].y -= 0.004; lm[LM.R_SHOULDER].y += 0.004; });
  assert.ok(tilted.shoulderLevel.value > base.shoulderLevel.value + 0.5, `shoulder level ${base.shoulderLevel.value} to ${tilted.shoulderLevel.value}`);
});

test('judging estimate: learns from this device, and never claims to be done early', async () => {
  const { expectedSeconds, progressAt, timeLeftText, DEFAULT_SECONDS } = await import('../src/judge/eta.mjs');
  assert.equal(expectedSeconds([]), DEFAULT_SECONDS);
  assert.equal(expectedSeconds([10, 30, 12]), 12, 'the median, so one slow answer does not dominate');
  assert.equal(expectedSeconds([200]), 60, 'capped');
  assert.equal(progressAt(5, 10), 0.45);
  assert.ok(progressAt(10, 10) <= 0.9 && progressAt(100, 10) < 0.99, 'never reaches the end before the answer');
  assert.ok(progressAt(20, 10) > progressAt(15, 10), 'still moving after the estimate');
  assert.equal(timeLeftText(3, 10), 'About 7 seconds left');
  assert.match(timeLeftText(30, 10), /Slower than usual \(30 s\)/);
});

test('reel: finds the tempo and first beat of a click track', async () => {
  const { detectBeat } = await import('../scripts/reel.mjs');
  const rate = 11025;
  const samples = new Float32Array(rate * 20);
  const period = 60 / 118;
  for (let i = 0; i < samples.length; i++) {
    const t = i / rate;
    const since = (t - 0.4) % period;
    samples[i] = t >= 0.4 ? 0.8 * Math.sin(2 * Math.PI * 60 * t) * Math.exp(-25 * since) : 0;
  }
  const beat = detectBeat(samples, rate);
  assert.equal(beat.bpm, 118);
  assert.ok(Math.abs(beat.firstBeat - 0.4) < 0.03, `first beat at ${beat.firstBeat}`);
  assert.equal(detectBeat(samples, rate, 120).bpm, 120, 'a known tempo is used as given');
});

test('reel: every part lasts whole beats, the turn is slowed and the best walk opens and closes', async () => {
  const { planReel } = await import('../scripts/reel.mjs');
  const frames = Array.from({ length: 300 }, (_, i) => ({ t: i / 30, status: 'valid', pts: [[100, 100], [120, 300]] }));
  const walk = (name) => ({ file: name, an: { frames, duration: 10, W: 1920, H: 1080, phases: { approach: [0.5, 4.5], turn: [4.5, 5.5], back: [5.5, 9.5] }, measured: { ok: true, points: 50, max: 70 } } });
  const best = walk('best');
  const parts = planReel([best, walk('second')], 60 / 120);
  assert.equal(parts[0].kind, 'hook');
  assert.equal(parts.at(-1).kind, 'outro');
  assert.equal(parts[0].walk, best);
  assert.ok(parts.every((p) => Number.isInteger(p.beats) && p.beats > 0));
  assert.ok(parts.some((p) => p.speed === 0.5), 'slow motion on the turn');
  assert.deepEqual(parts.filter((p) => p.label).map((p) => p.label), [1, 2]);
});

// ── showreel planner ──
const showreel = await import('../scripts/showreel/plan.mjs');
function fakeWalk() {
  // Toward the camera from 1 to 4 s and 10 to 13 s, walking away from 5 to 8 s.
  const frames = Array.from({ length: 450 }, (_, i) => {
    const t = i / 30;
    const away = t > 5 && t < 8;
    const pts = Array(38).fill(null);
    pts[11] = [away ? 900 : 1000, 400]; pts[12] = [away ? 1000 : 900, 400]; pts[23] = [930, 700]; pts[24] = [970, 700]; pts[27] = [930, 1100]; pts[28] = [970, 1100]; pts[0] = [950, 250];
    return { t, status: 'valid', pts };
  });
  return { W: 1920, H: 1440, duration: 15, frames, phases: { approach: [1, 4], turn: [4, 5], back: [5, 8], windows: [[1, 4], [5, 8], [10, 13]] },
    metrics: { shoulderSway: { ok: true, value: 1.54 }, headMovement: { ok: true, value: 0.221 }, footLine: { ok: true, value: 9.7 }, turnTime: { ok: true, value: 1.1 }, cadence: 96, stepCount: 26 },
    measured: { ok: true, points: 44, max: 70, parts: [{ label: 'Posture', points: 17, max: 18 }, { label: 'Arms', points: 4, max: 4 }] } };
}

test('showreel: windows are split by which way the shoulders face', () => {
  const { toward, away } = showreel.splitWindows(fakeWalk());
  assert.deepEqual(toward, [[1, 4], [10, 13]]);
  assert.deepEqual(away, [[5, 8]]);
});

test('showreel: about 15 s at any tempo, ending on the score, with real numbers', () => {
  for (const bpm of [105, 130, 150]) {
    const plan = showreel.planShowreel(fakeWalk(), { bpm, beat: 60 / bpm });
    assert.ok(plan.seconds > 12 && plan.seconds < 16.5, `${bpm} BPM gives ${plan.seconds.toFixed(1)} s`);
    assert.equal(plan.montage.at(-1).focus, 'whip', 'the montage always whips into the next section');
    assert.equal(plan.montage.length, plan.sections.chrono - plan.sections.montage);
  }
  const plan = showreel.planShowreel(fakeWalk(), { bpm: 130, beat: 60 / 130 });
  assert.equal(plan.values.shoulderRock, 1.5);
  assert.equal(plan.values.score, 44);
  assert.equal(plan.captions.chronoTitle, '26 STEPS');
  assert.ok(plan.drop.start >= 1 && plan.drop.start < 1.1, 'the drop opens on the first walk toward the camera');
});

test('showreel: captions differ from recent edits, and given ones win', () => {
  const history = showreel.CAPTIONS.intro.slice(0, -1).map((intro) => ({ captions: { intro } }));
  const plan = showreel.planShowreel(fakeWalk(), { bpm: 130, beat: 60 / 130 }, { seed: 5, history });
  assert.deepEqual(plan.captions.intro, showreel.CAPTIONS.intro.at(-1), 'the one set not used yet');
  const custom = showreel.planShowreel(fakeWalk(), { bpm: 130, beat: 60 / 130 }, { captions: { intro: ['A', 'B', 'C'], turn: 'SPIN' }, socials: 'sam.walks' });
  assert.deepEqual(custom.captions.intro, ['A', 'B', 'C']);
  assert.equal(custom.captions.turn, 'SPIN');
  assert.equal(custom.socials, '@sam.walks');
});

test('the camera falls back on any refused format, and phones skip the fps minimum', async () => {
  const { openCamera } = await import('../src/capture/camera.mjs');
  const real = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const fake = (ua, refuse) => {
    const asked = [];
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: ua, maxTouchPoints: 0, mediaDevices: { getUserMedia: async (c) => {
      asked.push(c.video);
      if (refuse(c.video)) throw Object.assign(new Error('refused'), { name: 'OverconstrainedError', constraint: '' });
      return { ok: true };
    } } } });
    return asked;
  };
  try {
    // Safari on a Mac: refuses the minimum without naming it.
    let asked = fake('Mozilla/5.0 (Macintosh) Safari', (v) => v.frameRate?.min);
    assert.deepEqual(await openCamera(), { ok: true });
    assert.equal(asked.length, 2);
    // An iPhone never gets the minimum, and a camera refusing every preference still opens with none.
    asked = fake('Mozilla/5.0 (iPhone) Safari', (v) => Object.keys(v).length > 0);
    assert.deepEqual(await openCamera(), { ok: true });
    assert.ok(asked.every((v) => !v.frameRate?.min));
    assert.deepEqual(asked.at(-1), {});
    // A refused permission is a real answer: no retries.
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'x', mediaDevices: { getUserMedia: async () => { throw Object.assign(new Error('no'), { name: 'NotAllowedError' }); } } } });
    await assert.rejects(openCamera(), (e) => e.kind === 'denied');
  } finally {
    if (real) Object.defineProperty(globalThis, 'navigator', real);
  }
});

test('distance and runway marks follow a pinhole camera', async () => {
  const { runwayMarks, distanceFor, zoneFor, verticalFov, metres } = await import('../src/lib/distance.mjs');
  assert.equal(verticalFov(1920, 1440), 53);
  assert.equal(verticalFov(1920, 1080), 44);
  assert.equal(verticalFov(1080, 1920), 67);
  // Half the size in the picture means twice as far.
  const near = distanceFor({ top: 200, bottom: 1200 }, 1920, 1440);
  const far = distanceFor({ top: 450, bottom: 950 }, 1920, 1440);
  assert.ok(Math.abs(far / near - 2) < 1e-9);
  // Without a measurement: the turn mark is about 1.8 m and the start about 5 m for an iPhone held sideways.
  const plain = runwayMarks(1920, 1440);
  assert.ok(plain.turn > 1.5 && plain.turn < 2.2, String(plain.turn));
  assert.ok(plain.start > 4.5 && plain.start < 5.5, String(plain.start));
  // Standing centred, the measured turn mark matches the plain one.
  const span = { top: 720 - 225, bottom: 720 + 225 };
  const centred = runwayMarks(1920, 1440, span);
  assert.ok(Math.abs(centred.turn - plain.turn) < 0.01);
  // Feet low in the picture (camera too high): the feet reach the edge first, so the turn mark moves back.
  const low = runwayMarks(1920, 1440, { top: 720 - 100, bottom: 720 + 350 });
  assert.ok(low.turn > centred.turn);
  assert.ok(low.start >= low.turn + 1.5);
  assert.equal(zoneFor({ ...centred, now: centred.turn - 0.2 }), 'close');
  assert.equal(zoneFor({ ...centred, now: centred.start + 1 }), 'far');
  assert.equal(zoneFor({ ...centred, now: (centred.turn + centred.start) / 2 }), 'ok');
  assert.equal(metres(2.345), '2.3 m');
  assert.equal(metres(12.3), '12.5 m');
});
