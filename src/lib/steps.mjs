// Finds footsteps from the front. A foot closer to the camera appears lower in the picture, so the height
// difference between the ankles swings one way, then the other, with every step. Each swing's extreme is when
// the feet are furthest apart front to back, which is a footfall. Dividing by torso length cancels distance.
//
// This needs a good sampling rate: at 30 samples a second, a half-second step spans 15 samples.
//
// Foot placement comes from two footfalls in a row, one with each foot in front. A foot closer to the camera looks
// further from the centre of the picture, so someone walking 30 cm off-centre appears to have feet about 4% of
// their height further apart than they are, and so does an angled path or a camera that is not level. That error
// points the same way whichever foot is closer, while left minus right changes sign, so averaging the signed
// separation over two footfalls cancels it. Foot position is the ankle and heel only, as in published step width:
// toes that point outward are not feet that land further apart.
import { LM, midpoint, distance } from './landmarks.mjs';

const MIN_STEP_SECONDS = 0.25;
const MAX_STEP_SECONDS = 1.3;
const MIN_SWING = 0.1; // Between one extreme and the next, in torso lengths. Smaller is noise, not a step.
const MAX_GAP_SECONDS = 0.25;

const NEAR_FOOTFALL_SECONDS = 0.05; // Feet barely move sideways this close to a footfall, so average to steady it.
const HEEL_TO_TOES = 12; // Heel to the toe joints, as a share of height, for turning toe position into an angle.

/** Mean x of the points the tracker has, or null if it has none of them. */
function meanX(pts, points) {
  const present = points.map((i) => pts[i]).filter(Boolean);
  return present.length ? present.reduce((sum, p) => sum + p[0], 0) / present.length : null;
}

/**
 * How far the toes point outward, in degrees. Perspective moves both feet the same way on screen, so the
 * difference between the feet cancels it. @returns null if the toes or heels are not visible.
 */
function toesOutward(p, torso, k) {
  const leftToes = meanX(p, [LM.L_FOOT, LM.L_SMALL_TOE]);
  const rightToes = meanX(p, [LM.R_FOOT, LM.R_SMALL_TOE]);
  if (leftToes === null || rightToes === null || !p[LM.L_HEEL] || !p[LM.R_HEEL] || !p[LM.L_SMALL_TOE] || !p[LM.R_SMALL_TOE]) return null;
  // The person's left is on the right of the picture when they face the camera, and the reverse walking away.
  const facing = p[LM.L_HIP][0] >= p[LM.R_HIP][0] ? 1 : -1;
  const outward = ((((leftToes - p[LM.L_HEEL][0]) - (rightToes - p[LM.R_HEEL][0])) / 2) * facing * 100) / torso / k;
  return (Math.asin(Math.max(-1, Math.min(1, outward / HEEL_TO_TOES))) * 180) / Math.PI;
}

function runsOf(frames, k) {
  const runs = [];
  let run = [];
  for (const f of frames) {
    const p = f.pts;
    const ok = f.status === 'valid' && p && p[LM.L_ANKLE] && p[LM.R_ANKLE];
    if (!ok || (run.length && f.t - run.at(-1).t > MAX_GAP_SECONDS)) {
      if (run.length >= 8) runs.push(run);
      run = [];
    }
    if (!ok) continue;
    const torso = distance(midpoint(p[LM.L_SHOULDER], p[LM.R_SHOULDER]), midpoint(p[LM.L_HIP], p[LM.R_HIP]));
    run.push({
      t: f.t,
      swing: (p[LM.L_ANKLE][1] - p[LM.R_ANKLE][1]) / torso,
      gap: ((meanX(p, [LM.L_ANKLE, LM.L_HEEL]) - meanX(p, [LM.R_ANKLE, LM.R_HEEL])) / torso / k) * 100,
      toes: toesOutward(p, torso, k),
    });
  }
  if (run.length >= 8) runs.push(run);
  return runs;
}

/** Moving average over about a tenth of a second, to steady the signal without moving its peaks. */
function steady(run, seconds = 0.1) {
  return run.map(({ t }, i) => {
    let sum = 0;
    let n = 0;
    for (let j = i; j >= 0 && t - run[j].t <= seconds; j--) { sum += run[j].swing; n++; }
    for (let j = i + 1; j < run.length && run[j].t - t <= seconds; j++) { sum += run[j].swing; n++; }
    return sum / n;
  });
}

/** Alternating highs and lows in the swing signal, big enough and far enough apart to be real steps. */
function extremes(run) {
  const values = steady(run);
  const found = [];
  let direction = 0;
  let pivot = 0;
  for (let i = 1; i < values.length; i++) {
    if (direction >= 0 && values[i] > values[pivot]) {
      pivot = i;
      direction = 1;
    } else if (direction <= 0 && values[i] < values[pivot]) {
      pivot = i;
      direction = -1;
    } else if (Math.abs(values[i] - values[pivot]) >= MIN_SWING && Math.sign(values[pivot] - values[i]) === (direction || Math.sign(values[pivot] - values[i]))) {
      // The signal has turned back by a real amount, so the pivot was an extreme.
      const last = found.at(-1);
      if (!last || run[pivot].t - run[last].t >= MIN_STEP_SECONDS) found.push(pivot);
      direction = -(direction || Math.sign(values[pivot] - values[i]));
      pivot = i;
    }
  }
  return found;
}

/** Fit a parabola through the peak and its neighbors, to place it between samples. */
function refineTime(run, values, i) {
  if (i <= 0 || i >= run.length - 1) return run[i].t;
  const [a, b, c] = [values[i - 1], values[i], values[i + 1]];
  const bend = a - 2 * b + c;
  if (bend === 0) return run[i].t;
  const shift = Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / bend));
  return run[i].t + shift * (shift > 0 ? run[i + 1].t - run[i].t : run[i].t - run[i - 1].t);
}

/** The mean of one value over the samples close to a footfall, ignoring any that are missing. */
function nearFootfall(run, index, key) {
  const near = [];
  const t = run[index].t;
  for (let j = index; j >= 0 && t - run[j].t <= NEAR_FOOTFALL_SECONDS; j--) if (run[j][key] !== null) near.push(run[j][key]);
  for (let j = index + 1; j < run.length && run[j].t - t <= NEAR_FOOTFALL_SECONDS; j++) if (run[j][key] !== null) near.push(run[j][key]);
  return near.length ? near.reduce((sum, v) => sum + v, 0) / near.length : null;
}

/**
 * @param frames Smoothed frames during walking only.
 * @param options.k Height as a multiple of torso length, so foot separation is a share of height.
 * @returns footfall times, the time between consecutive steps, side-to-side foot placement for each pair of
 *          footfalls as a share of height, and how far the toes pointed outward in degrees.
 */
export function detectSteps(frames, { k = 3.45 } = {}) {
  const events = [];
  const intervals = [];
  const widths = [];
  const toes = [];
  for (const run of runsOf(frames, k)) {
    const found = extremes(run);
    const values = steady(run);
    const timeOf = (index) => refineTime(run, values, index);
    let lastGap = null;
    found.forEach((index, n) => {
      const gap = nearFootfall(run, index, 'gap');
      const toe = nearFootfall(run, index, 'toes');
      events.push({ t: timeOf(index), gap });
      if (toe !== null) toes.push(toe);
      if (lastGap !== null) widths.push(Math.abs(gap + lastGap) / 2);
      lastGap = gap;
      if (n === 0) return;
      const between = timeOf(index) - timeOf(found[n - 1]);
      if (between >= MIN_STEP_SECONDS && between <= MAX_STEP_SECONDS) intervals.push(between);
    });
  }
  return { events, intervals, widths, toes };
}
