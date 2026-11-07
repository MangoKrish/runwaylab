// Turns raw tracker output into frames this app can trust.
//
// Three rules hold throughout: a landmark the model is unsure of, or one outside the picture, becomes null
// and is never guessed; a landmark that jumps impossibly or makes a limb an impossible length is thrown out;
// and everything is converted to pixels before any geometry, because tracker x and y are each scaled 0 to 1
// by a different number (the width and the height).
import { LM, LANDMARK_COUNT, midpoint, distance } from './landmarks.mjs';
import { OneEuro } from './oneEuro.mjs';

export const VISIBILITY_MIN = 0.5;
export const MIN_TORSO_PX = 24;      // Below this a pixel of noise is a large share of the measurement.
export const MIN_TORSO_SHARE = 0.03; // Same idea, as a share of picture height.
export const SIDE_ON_RATIO = 0.35;   // Shoulder width / torso length. Below this they are turning or side-on.
export const MAX_GAP_SECONDS = 0.5;  // A longer gap resets smoothing, so it cannot bridge missing time.

const CORE = [LM.L_SHOULDER, LM.R_SHOULDER, LM.L_HIP, LM.R_HIP];
const inPicture = (p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;

/**
 * Decide whether one detected pose can be measured.
 * Status is one of: valid, no-person, low-confidence, clipped, too-small, side-on.
 * `pts` holds [x, y, visibility] in pixels, or null for a landmark we refuse to use.
 */
export function classifyPose(landmarks, W, H) {
  if (!landmarks) return { status: 'no-person', pts: null, full: false };

  // Every tracker ends up the same length. A slot this tracker does not fill is simply empty.
  const pts = Array.from({ length: LANDMARK_COUNT }, (_, i) => {
    const p = landmarks[i];
    return p && (p.visibility ?? 0) >= VISIBILITY_MIN && inPicture(p)
      ? [p.x * W, p.y * H, Math.round((p.visibility ?? 0) * 100) / 100]
      : null;
  });
  const full = [LM.NOSE, LM.L_ANKLE, LM.R_ANKLE].every((i) => pts[i]);

  if (CORE.some((i) => !inPicture(landmarks[i]))) return { status: 'clipped', pts, full };
  if (CORE.some((i) => !pts[i])) return { status: 'low-confidence', pts, full };

  const shoulders = midpoint(pts[LM.L_SHOULDER], pts[LM.R_SHOULDER]);
  const hips = midpoint(pts[LM.L_HIP], pts[LM.R_HIP]);
  const torso = distance(shoulders, hips);
  if (torso < MIN_TORSO_PX || torso < MIN_TORSO_SHARE * H) return { status: 'too-small', pts, full };

  const width = distance(pts[LM.L_SHOULDER], pts[LM.R_SHOULDER]);
  if (width / torso < SIDE_ON_RATIO) return { status: 'side-on', pts, full };

  return { status: 'valid', pts, full };
}

/** Torso length in pixels, the size signal for walk phases, or null if it cannot be seen. */
export function torsoSize(pts) {
  if (!pts || CORE.some((i) => !pts[i])) return null;
  return distance(midpoint(pts[LM.L_SHOULDER], pts[LM.R_SHOULDER]), midpoint(pts[LM.L_HIP], pts[LM.R_HIP]));
}

/**
 * What to tell a walker about their framing right now. Used live, so they turn before the picture cuts
 * them off, which is when any tracker starts to struggle.
 * @returns 'none' | 'feet-out' | 'head-out' | 'near-limit' | 'ok'
 */
export function framingAdvice(pts, H) {
  if (!pts || !pts[LM.L_HIP] || !pts[LM.R_HIP]) return 'none';
  const ankles = [pts[LM.L_ANKLE], pts[LM.R_ANKLE]].filter(Boolean);
  const head = pts[LM.NOSE] || pts[LM.L_EAR] || pts[LM.R_EAR];
  if (!head) return 'head-out';
  if (!ankles.length) return 'feet-out';
  const lowest = Math.max(...ankles.map((p) => p[1]));
  if (head[1] < H * 0.05) return 'near-limit';
  if (lowest > H * 0.95) return 'near-limit';
  return 'ok';
}

const LIMBS = [
  [LM.L_SHOULDER, LM.L_ELBOW], [LM.L_ELBOW, LM.L_WRIST], [LM.R_SHOULDER, LM.R_ELBOW], [LM.R_ELBOW, LM.R_WRIST],
  [LM.L_HIP, LM.L_KNEE], [LM.L_KNEE, LM.L_ANKLE], [LM.R_HIP, LM.R_KNEE], [LM.R_KNEE, LM.R_ANKLE],
];

const medianOf = (values) => {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/**
 * Throw out landmarks that cannot be right, before smoothing can spread their error to neighboring frames.
 * First, a point far from the median of its neighbors in time is a one-frame glitch. Second, a limb far from
 * its usual length, relative to the torso, means its far end was misplaced. Both become null.
 */
export function rejectOutliers(frames, { neighbors = 3, maxJump = 0.45, maxLimb = 1.7, minLimb = 0.3 } = {}) {
  const out = frames.map((f) => (f.pts ? { ...f, pts: f.pts.slice() } : { ...f }));

  // One-frame glitches. Compared against the raw frames, so one removal cannot affect the next decision.
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    if (!frame.pts) continue;
    const torso = torsoSize(frame.pts);
    if (torso === null) continue;
    for (let l = 0; l < LANDMARK_COUNT; l++) {
      const p = frame.pts[l];
      if (!p) continue;
      const xs = [];
      const ys = [];
      for (let j = i - neighbors; j <= i + neighbors; j++) {
        const q = frames[j]?.pts?.[l];
        if (j === i || !q || Math.abs(frames[j].t - frame.t) > 0.3) continue;
        xs.push(q[0]);
        ys.push(q[1]);
      }
      if (xs.length < 3) continue;
      if (Math.hypot(p[0] - medianOf(xs), p[1] - medianOf(ys)) > maxJump * torso) out[i].pts[l] = null;
    }
  }

  // Impossible limbs.
  const usual = LIMBS.map(([a, b]) => {
    const ratios = [];
    for (const f of out) {
      const torso = f.pts ? torsoSize(f.pts) : null;
      if (torso && f.pts[a] && f.pts[b]) ratios.push(distance(f.pts[a], f.pts[b]) / torso);
    }
    return ratios.length >= 10 ? medianOf(ratios) : null;
  });
  for (const f of out) {
    const torso = f.pts ? torsoSize(f.pts) : null;
    if (!torso) continue;
    LIMBS.forEach(([a, b], k) => {
      if (usual[k] === null || !f.pts[a] || !f.pts[b]) return;
      const ratio = distance(f.pts[a], f.pts[b]) / torso;
      if (ratio > usual[k] * maxLimb || ratio < usual[k] * minLimb) f.pts[b] = null;
    });
  }
  // A frame that lost part of its torso can no longer be measured.
  for (const f of out) {
    if (f.status === 'valid' && f.pts && CORE.some((i) => !f.pts[i])) f.status = 'low-confidence';
  }
  return out;
}

function smoothPass(frames, H, options, reversed) {
  const filters = Array.from({ length: LANDMARK_COUNT }, () => [new OneEuro(options), new OneEuro(options)]);
  const resetAll = () => filters.forEach(([fx, fy]) => { fx.reset(); fy.reset(); });
  const result = new Array(frames.length);
  const lastIndex = frames.length - 1;
  // Going backward, time runs negative, so the filter still sees it increasing.
  const clock = reversed ? (t) => -t : (t) => t;
  let lastT = null;
  for (let n = 0; n <= lastIndex; n++) {
    const i = reversed ? lastIndex - n : n;
    const frame = frames[i];
    if (!frame.pts) {
      resetAll();
      lastT = null;
      result[i] = null;
      continue;
    }
    const t = clock(frame.t);
    if (lastT !== null && t - lastT > MAX_GAP_SECONDS) resetAll();
    lastT = t;
    result[i] = frame.pts.map((p, l) => {
      if (!p) {
        filters[l][0].reset();
        filters[l][1].reset();
        return null;
      }
      return [filters[l][0].filter(p[0] / H, t) * H, filters[l][1].filter(p[1] / H, t) * H];
    });
  }
  return result;
}

/**
 * One Euro smoothing, run forward and backward over the finished clip and averaged. A live filter has to
 * lag behind the body, which is why an overlay can look late. With the whole clip available, the two passes
 * lag in opposite directions and cancel out. Coordinates are divided by picture height while filtering, so
 * the settings do not depend on camera resolution. Smoothing resets on any gap: a missing frame, a missing
 * landmark or a long time jump.
 */
export function smoothFrames(frames, H, options = { minCutoff: 2, beta: 5, dCutoff: 1 }) {
  const forward = smoothPass(frames, H, options, false);
  const backward = smoothPass(frames, H, options, true);
  return frames.map((frame, i) => {
    if (!frame.pts) return { ...frame };
    const pts = frame.pts.map((p, l) => {
      if (!p) return null;
      const a = forward[i][l];
      const b = backward[i][l];
      return [Math.round(((a[0] + b[0]) / 2) * 10) / 10, Math.round(((a[1] + b[1]) / 2) * 10) / 10, p[2]];
    });
    return { ...frame, pts };
  });
}
