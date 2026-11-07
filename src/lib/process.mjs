// One pipeline from raw landmarks to results, shared by real videos and the labeled sample.
// The overlay and the measurements both read `frames` from here, so what you see is what was measured.
import { classifyPose, rejectOutliers, smoothFrames, torsoSize } from './frames.mjs';
import { detectPhases, detectLaps } from './phases.mjs';
import { combineMetrics, computeMetrics, learnFromStillness } from './metrics.mjs';
import { measuredScore } from './score.mjs';
import { LANDMARK_COUNT } from './landmarks.mjs';

/**
 * From processed frames to phases, measurements and points. The wall's server runs this exact function on
 * posted frames, so a score on the wall cannot differ from what this code says it should be.
 */
export function summarizeFrames(frames, { W, H }) {
  const series = [];
  for (const f of frames) {
    const size = torsoSize(f.pts);
    if (size !== null) series.push({ t: f.t, size });
  }

  const laps = detectLaps(series);
  if (!laps.length) {
    // No complete walk up and back, so describe what is there and say why it cannot be scored.
    const phases = detectPhases(series);
    const metrics = computeMetrics(frames, phases, { W, H });
    return { phases, laps: [], stance: null, metrics, measured: measuredScore(metrics, phases) };
  }

  // Calibrate once, from the stillness before the first walk, then measure each lap by itself.
  const stance = learnFromStillness(frames, laps[0].approach[0]);
  const results = laps.map((lap) => {
    const metrics = computeMetrics(frames.filter((f) => f.t >= lap.start && f.t <= lap.end), lap, { W, H, stance });
    return { lap, metrics, measured: measuredScore(metrics, lap) };
  });

  // A lap that could not be measured is dropped, and the others carry the score.
  const usable = results.filter((r) => r.measured.ok);
  const metrics = combineMetrics((usable.length ? usable : results).map((r) => r.metrics));
  const phases = {
    shape: 'up-and-back',
    approach: laps[0].approach,
    turn: laps[0].turn,
    back: laps.at(-1).back,
    windows: laps.flatMap((lap) => lap.windows),
    rise: laps[0].rise,
    fall: laps[0].fall,
  };
  const measured = usable.length ? measuredScore(metrics, phases) : results[0].measured;
  if (measured.ok) {
    measured.laps = results.map((r, i) => ({ number: i + 1, points: r.measured.ok ? r.measured.points : null, reason: r.measured.ok ? null : r.measured.reason }));
    measured.lapsUsed = usable.length;
  }
  return {
    phases,
    laps: laps.map((lap) => ({ approach: lap.approach, turn: lap.turn, back: lap.back })),
    stance: stance ? { seconds: stance.seconds, heightRatio: stance.heightRatio, noise: stance.noise } : null,
    metrics,
    measured,
  };
}

/**
 * @param {{t:number, landmarks:object[]|null}[]} raw  One entry per sampled frame, for the tracked person.
 * @param {{W:number, H:number, duration:number}} size
 */
export function processFrames(raw, { W, H, duration }) {
  const classified = raw.map(({ t, landmarks }) => ({ t, ...classifyPose(landmarks, W, H) }));
  const frames = smoothFrames(rejectOutliers(classified), H);
  return { W, H, duration, frames, ...summarizeFrames(frames, { W, H }) };
}

function nearestIndex(frames, t) {
  let low = 0;
  let high = frames.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (frames[mid].t < t) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** The tracked frame nearest to time t, or null if nothing was sampled close enough to it. */
export function frameAt(frames, t, tolerance = 0.2) {
  if (!frames.length) return null;
  const low = nearestIndex(frames, t);
  const candidates = [frames[low], frames[low - 1]].filter(Boolean);
  const best = candidates.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a));
  return Math.abs(best.t - t) <= tolerance ? best : null;
}

/**
 * The skeleton to draw at time t. Video plays faster than it was sampled, so the skeleton glides between the
 * two nearest samples instead of stepping. A point is only drawn if both samples have it and they are close
 * in time, so this can never bridge a real tracking gap.
 */
export function poseAt(frames, t, maxGap = 0.12) {
  if (!frames.length) return null;
  const after = nearestIndex(frames, t);
  const next = frames[after];
  const previous = frames[after - 1];
  if (!previous || next.t < t || next.t - previous.t > maxGap || !previous.pts || !next.pts) {
    const nearest = frameAt(frames, t, maxGap);
    return nearest?.pts ?? null;
  }
  const mix = (t - previous.t) / (next.t - previous.t);
  const pts = new Array(LANDMARK_COUNT).fill(null);
  for (let i = 0; i < LANDMARK_COUNT; i++) {
    const a = previous.pts[i];
    const b = next.pts[i];
    if (a && b) pts[i] = [a[0] + (b[0] - a[0]) * mix, a[1] + (b[1] - a[1]) * mix];
  }
  return pts;
}
