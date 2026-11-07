// A made-up figure walking toward a made-up camera and back. Nothing here came from a person or a tracker, and
// the app says so on screen. It has two jobs: the labeled sample, so the review works with no camera, and tests,
// because each style's true geometry is known. The styles are our own assumptions about walking, so passing
// tests prove the scoring logic can tell them apart, not that the thresholds suit real people.
import { LM, LANDMARK_COUNT } from './landmarks.mjs';

const W = 1920;
const H = 1440;
const FPS = 30;
const CAMERA_HEIGHT = 0.95;
const FOCAL = H / 2 / Math.tan((54 / 2) * (Math.PI / 180)); // About an iPhone main camera in 4:3.
const NEAR = 2.3;
const FAR = 6.2;

export const WALK_STYLES = {
  // Feet on one line, even steps, steady speed, quiet shoulders, tall and level.
  catwalk: { footGap: 0.04, tilt: 0.7, lean: 0.4, bob: 0.009, neck: 0.21, chinDown: 0.015, headSway: 0.006, drift: 0.05, cadence: 1.95, stepJitter: 0.02, paceWobble: 0.03, armSwing: 0.2, armLazy: 1, turn: 1.3, turnWander: 0.01 },
  // An ordinary walk: feet apart, more rocking, a little uneven.
  casual: { footGap: 0.13, tilt: 3.2, lean: 1.8, bob: 0.02, neck: 0.17, chinDown: 0.05, headSway: 0.025, drift: 0.22, cadence: 1.8, stepJitter: 0.13, paceWobble: 0.22, armSwing: 0.24, armLazy: 0.7, turn: 2.6, turnWander: 0.1 },
  // Slouched, shuffling, looking down, wandering.
  sloppy: { footGap: 0.2, tilt: 5.5, lean: 3.6, bob: 0.035, neck: 0.11, chinDown: 0.09, headSway: 0.05, drift: 0.5, cadence: 1.55, stepJitter: 0.28, paceWobble: 0.5, armSwing: 0.1, armLazy: 0.3, turn: 4.5, turnWander: 0.3 },
};

function noiseSource(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32 - 0.5;
  };
}

const smoothstep = (x) => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};

/** Step timing with some wobble, computed in advance so the figure's phase is continuous. */
function stepClock(style, duration, noise, fps = FPS) {
  const dt = 1 / fps;
  const phases = [0];
  let phase = 0;
  let rate = style.cadence;
  let nextChange = 1 / style.cadence;
  for (let t = dt; t <= duration + dt; t += dt) {
    if (t >= nextChange) {
      rate = style.cadence * (1 + noise() * 2 * style.stepJitter);
      nextChange = t + 1 / rate;
    }
    phase += dt * rate * Math.PI;
    phases.push(phase);
  }
  return phases;
}

/** Walking distance over one leg of the walk, with some speed wobble that still finishes on time. */
function leg(progress, style, seed) {
  const wobble = style.paceWobble * 0.12 * (Math.sin(progress * 9 + seed) - Math.sin(seed) * (1 - progress) - Math.sin(9 + seed) * progress);
  return Math.min(1, Math.max(0, progress + wobble));
}

/** Pose in metres at time t: x to image right, y up, z toward the camera. Yaw 0 faces the camera. */
function bodyAt(t, style, phase, timing, build = {}) {
  const { scale = 1, shoulders: shoulderScale = 1, torso: torsoScale = 1, offset = 0, angle = 0 } = build;
  const { walkIn, turnEnd, walkOut, near = NEAR, far = FAR } = timing;
  let distance;
  let yaw;
  if (t < walkIn) {
    distance = far - (far - near) * leg(t / walkIn, style, 1);
    yaw = 0;
  } else if (t < turnEnd) {
    distance = near;
    yaw = Math.PI * smoothstep((t - walkIn) / (turnEnd - walkIn));
  } else {
    distance = near + (far - near) * leg(Math.min(1, (t - turnEnd) / (walkOut - turnEnd)), style, 2);
    yaw = Math.PI;
  }
  const walking = t < walkIn || (t >= turnEnd && t < walkOut);
  const stride = walking ? Math.sin(phase) : 0;
  const liftA = walking ? Math.max(0, Math.cos(phase)) : 0;
  const liftB = walking ? Math.max(0, -Math.cos(phase)) : 0;
  const every = walking ? Math.sin(phase * 2) : 0;

  const turning = t >= walkIn && t < turnEnd;
  // `offset` is walking to one side of the camera, in metres. `angle` is a path that is not straight at it, in degrees.
  const sideways = offset + (far - distance) * Math.tan((angle * Math.PI) / 180) + style.drift * Math.sin(t * 0.55) + (walking ? 0.012 * Math.sin(phase) : 0) + (turning ? style.turnWander * Math.sin((t - walkIn) * 4) : 0);
  const shoulderTilt = (walking ? style.tilt * Math.sin(phase) + 0.6 : 0.4) * (Math.PI / 180);
  const trunkTilt = (walking ? style.lean * Math.sin(phase + 0.7) + 0.3 : 0.2) * (Math.PI / 180);
  const headSway = walking ? style.headSway * Math.sin(phase + 0.4) : 0;
  const bob = walking ? style.bob * every : 0;

  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const hipY = 0.95 + bob;
  const shoulderY = 0.95 + 0.47 * torsoScale + bob;
  const lean = (shoulderY - hipY) * Math.tan(trunkTilt);
  const earY = shoulderY + style.neck;

  // Side-to-side offset (a) and front-to-back offset (b) in the body's own frame become world x and z.
  const place = (a, y, b = 0) => ({ x: sideways + a * c + b * s, y, z: -distance - a * s + b * c });
  const pts = {};
  const halfShoulders = 0.19 * shoulderScale;
  const tilt = halfShoulders * Math.tan(shoulderTilt);
  const swing = style.armSwing;
  const armA = swing * stride * style.armLazy;

  // The person's left is on the image right when they face the camera.
  pts[LM.L_SHOULDER] = place(halfShoulders + lean, shoulderY + tilt);
  pts[LM.R_SHOULDER] = place(-halfShoulders + lean, shoulderY - tilt);
  pts[LM.L_HIP] = place(0.14, hipY);
  pts[LM.R_HIP] = place(-0.14, hipY);
  pts[LM.L_ELBOW] = place(0.24 * shoulderScale + lean, 1.13 + bob + Math.abs(armA) * 0.1, -armA * 0.5);
  pts[LM.R_ELBOW] = place(-0.24 * shoulderScale + lean, 1.13 + bob + Math.abs(swing * stride) * 0.1, swing * stride * 0.5);
  pts[LM.L_WRIST] = place(0.25 * shoulderScale + lean, 0.86 + bob + Math.abs(armA) * 0.35, -armA);
  pts[LM.R_WRIST] = place(-0.25 * shoulderScale + lean, 0.86 + bob + Math.abs(swing * stride) * 0.35, swing * stride);
  const footX = style.footGap / 2;
  pts[LM.L_KNEE] = place(0.08 + footX / 2, 0.5 + 0.09 * liftA, 0.2 * stride);
  pts[LM.R_KNEE] = place(-0.08 - footX / 2, 0.5 + 0.09 * liftB, -0.2 * stride);
  pts[LM.L_ANKLE] = place(footX, 0.08 + 0.1 * liftA, 0.32 * stride);
  pts[LM.R_ANKLE] = place(-footX, 0.08 + 0.1 * liftB, -0.32 * stride);
  pts[LM.L_HEEL] = place(footX, 0.05 + 0.1 * liftA, 0.28 * stride);
  pts[LM.R_HEEL] = place(-footX, 0.05 + 0.1 * liftB, -0.32 * stride);
  pts[LM.L_FOOT] = place(footX + 0.01, 0.03 + 0.08 * liftA, 0.2 + 0.28 * stride);
  pts[LM.R_FOOT] = place(-footX - 0.01, 0.03 + 0.08 * liftB, 0.2 - 0.32 * stride);
  pts[LM.L_SMALL_TOE] = place(footX + 0.05, 0.03 + 0.08 * liftA, 0.16 + 0.28 * stride);
  pts[LM.R_SMALL_TOE] = place(-footX - 0.05, 0.03 + 0.08 * liftB, 0.16 - 0.32 * stride);
  const earLevel = earY;
  pts[LM.NOSE] = place(lean + headSway, earLevel - style.chinDown, 0.1);
  pts[LM.L_EYE] = place(0.03 + lean + headSway, earLevel + 0.02 - style.chinDown * 0.7, 0.09);
  pts[LM.R_EYE] = place(-0.03 + lean + headSway, earLevel + 0.02 - style.chinDown * 0.7, 0.09);
  pts[LM.L_EAR] = place(0.075 + lean + headSway, earLevel, 0);
  pts[LM.R_EAR] = place(-0.075 + lean + headSway, earLevel, 0);
  pts[LM.HEAD_TOP] = place(lean + headSway, earLevel + 0.12, 0);
  pts[LM.NECK] = place(lean, shoulderY + 0.03, 0);
  pts[LM.HIP_CENTER] = place(0, hipY, 0);
  if (scale !== 1) {
    // A taller or shorter person, doing the same walk at the same place relative to the camera.
    for (const p of Object.values(pts)) {
      p.x = sideways + (p.x - sideways) * scale;
      p.y *= scale;
      p.z = -distance + (p.z + distance) * scale;
    }
  }
  return pts;
}

/** Through a pinhole camera, onto the picture. `roll` is a camera that is not level, in degrees. */
function photograph(body, noise, noisePx, roll) {
  const c = Math.cos((roll * Math.PI) / 180);
  const s = Math.sin((roll * Math.PI) / 180);
  const landmarks = [];
  for (let j = 0; j < LANDMARK_COUNT; j++) {
    const p = body[j];
    if (!p) {
      landmarks.push({ x: 0, y: 0, z: 0, visibility: 0 });
      continue;
    }
    const depth = -p.z;
    const dx = (FOCAL * p.x) / depth;
    const dy = -(FOCAL * (p.y - CAMERA_HEIGHT)) / depth;
    landmarks.push({
      x: (W / 2 + dx * c - dy * s + noise() * noisePx) / W,
      y: (H / 2 + dx * s + dy * c + noise() * noisePx) / H,
      z: 0,
      visibility: 0.97,
    });
  }
  return landmarks;
}

/** A synthetic walk in the same form the analyzer produces: normalized 0-1 landmarks over time. */
export function generateWalk(styleName = 'catwalk', { seed = 20261107, noisePx = 2.4, build = {}, fps = FPS, roll = 0 } = {}) {
  const style = WALK_STYLES[styleName];
  const noise = noiseSource(seed);
  const legSeconds = (FAR - NEAR) / (style.cadence * 0.62);
  const timing = { walkIn: legSeconds, turnEnd: legSeconds + style.turn, walkOut: legSeconds * 2 + style.turn };
  const duration = timing.walkOut + 0.5;
  const clock = stepClock(style, duration, noise, fps);
  const raw = [];
  for (let i = 0; i <= duration * fps; i++) {
    const t = i / fps;
    const body = bodyAt(t, style, clock[i] ?? clock.at(-1), timing, build);
    raw.push({ t: Math.round(t * 1000) / 1000, landmarks: photograph(body, noise, noisePx, roll) });
  }
  return { raw, W, H, duration: Math.round(duration * 100) / 100 };
}

/** The same figure in metres, for drawing it in a scene: its pose at any moment of one walk there and back. */
export function walkTimeline(styleName = 'catwalk', { seed = 20261107, near = NEAR, far = FAR } = {}) {
  const style = WALK_STYLES[styleName];
  const legSeconds = (far - near) / (style.cadence * 0.62);
  const timing = { walkIn: legSeconds, turnEnd: legSeconds + style.turn, walkOut: legSeconds * 2 + style.turn, near, far };
  const clock = stepClock(style, timing.walkOut + 0.5, noiseSource(seed));
  const phaseAt = (t) => {
    const at = Math.min(clock.length - 1.001, t * FPS);
    const i = Math.floor(at);
    return clock[i] + (clock[i + 1] - clock[i]) * (at - i);
  };
  return {
    duration: timing.walkOut,
    approachSeconds: legSeconds,
    poseAt: (t) => bodyAt(t, style, phaseAt(t), timing),
  };
}

/**
 * A full round: standing still to calibrate, then several walks in one go, as the studio records it.
 * When told to stand tall, everyone does, so every style has the same standing posture here.
 */
export function generateRound(styleName = 'catwalk', { laps = 3, standSeconds = 1.5, seed = 20261107, noisePx = 2.4, build = {}, fps = FPS, roll = 0 } = {}) {
  const style = WALK_STYLES[styleName];
  const noise = noiseSource(seed + 1);
  const raw = [];
  const standing = { ...style, neck: WALK_STYLES.catwalk.neck, chinDown: WALK_STYLES.catwalk.chinDown, tilt: 0, lean: 0, headSway: 0, bob: 0 };
  const timing = { walkIn: 100, turnEnd: 101, walkOut: 102 };
  for (let i = 0; i < standSeconds * fps; i++) {
    const body = bodyAt(0, standing, 0, timing, build);
    raw.push({ t: Math.round((i / fps) * 1000) / 1000, landmarks: photograph(body, noise, noisePx, roll) });
  }
  let offset = standSeconds;
  for (let lap = 0; lap < laps; lap++) {
    const walk = generateWalk(styleName, { seed: seed + lap * 7, noisePx, build, fps, roll });
    for (const frame of walk.raw) raw.push({ t: Math.round((frame.t + offset) * 1000) / 1000, landmarks: frame.landmarks });
    offset += walk.duration + 1 / fps;
  }
  return { raw, W, H, duration: Math.round(offset * 100) / 100 };
}

export const generateSampleRaw = () => generateRound('catwalk', { laps: 2 });

// Hand-written so the result screen can be shown without calling Gemini. Labeled as such in the app.
export const SAMPLE_JUDGE = {
  ok: true,
  sample: true,
  presence: { score: 15, why: 'Sample text, written by hand: the figure holds its line all the way in and does not rush the return.' },
  style: { score: 12, why: 'Sample text, written by hand: there is no outfit on a stick figure, so this only shows where a style score appears.' },
  match: { id: 'tougaard', name: 'Mona Tougaard', tag: 'The Cool Glide', why: 'Sample text, written by hand: an even, unhurried pace reads closest to a glide.' },
  verdict: 'Sample verdict, written by hand. A real walk gets its verdict from Gemini.',
  tip: 'Sample tip, written by hand: a real walk gets one specific thing to try next.',
  moments: [
    { t: 2.2, note: 'Sample note, written by hand: this is where a comment about the approach would sit.' },
    { t: 4.6, note: 'Sample note, written by hand: this is where a comment about the turn would sit.' },
  ],
};
