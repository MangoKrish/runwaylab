// Works out the walk from one signal: how big the torso is on screen. A pinhole camera makes size
// inversely proportional to distance, so growing means walking toward the camera and shrinking means
// walking away. Torso length is used because it stays in shot when the feet leave the frame, and it
// barely changes when someone rotates, unlike shoulder width.

export const MIN_SIZE_CHANGE = 1.2; // The size must change by this ratio to count as walking.

const medianOf = (values) => {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/** Median filter over a time window, which ignores single-frame pose errors. */
function medianSmooth(series, windowSeconds = 0.6) {
  return series.map(({ t }, i) => {
    const near = [];
    for (let j = i; j >= 0 && t - series[j].t <= windowSeconds / 2; j--) near.push(series[j].size);
    for (let j = i + 1; j < series.length && series[j].t - t <= windowSeconds / 2; j++) near.push(series[j].size);
    return { t, size: medianOf(near) };
  });
}

/**
 * For a finished clip.
 * @param {{t:number,size:number}[]} series  Torso size over time, for frames where it can be seen.
 * @returns {{shape:string, approach:number[]|null, turn:number[]|null, back:number[]|null, windows:number[][], rise:number, fall:number}}
 *   shape is up-and-back, approach-only, away-only or none. `windows` lists the walking segments.
 */
export function detectPhases(series) {
  const none = { shape: 'none', approach: null, turn: null, back: null, windows: [], rise: 1, fall: 1 };
  if (series.length < 6) return none;

  const smooth = medianSmooth(series);
  let peak = 0;
  smooth.forEach((p, i) => { if (p.size > smooth[peak].size) peak = i; });
  const peakSize = smooth[peak].size;

  const before = smooth.slice(0, peak + 1);
  const after = smooth.slice(peak);
  const minBefore = Math.min(...before.map((p) => p.size));
  const minAfter = Math.min(...after.map((p) => p.size));
  const rise = peakSize / minBefore;
  const fall = peakSize / minAfter;
  const rose = rise >= MIN_SIZE_CHANGE;
  const fell = fall >= MIN_SIZE_CHANGE;

  // Trim standing around at either end: walking starts when they last left their smallest size,
  // and ends when they first get back to it.
  let startIndex = 0;
  before.forEach((p, i) => { if (p.size <= minBefore * 1.05) startIndex = i; });
  let endIndex = after.length - 1;
  for (let i = 0; i < after.length; i++) {
    if (after[i].size <= minAfter * 1.05) { endIndex = i; break; }
  }

  // The plateau around the peak is where they slow down and turn.
  let plateauStart = peak;
  while (plateauStart > 0 && smooth[plateauStart - 1].size >= peakSize * 0.93) plateauStart--;
  let plateauEnd = peak;
  while (plateauEnd < smooth.length - 1 && smooth[plateauEnd + 1].size >= peakSize * 0.93) plateauEnd++;

  const approach = rose ? [before[startIndex].t, smooth[plateauStart].t] : null;
  const back = fell ? [smooth[plateauEnd].t, after[endIndex].t] : null;
  const shape = rose && fell ? 'up-and-back' : rose ? 'approach-only' : fell ? 'away-only' : 'none';

  return {
    shape,
    approach,
    turn: rose && fell ? [smooth[plateauStart].t, smooth[plateauEnd].t] : null,
    back,
    windows: [approach, back].filter(Boolean),
    rise: Math.round(rise * 100) / 100,
    fall: Math.round(fall * 100) / 100,
  };
}

/**
 * Splits a clip into laps, for when someone walks up and back several times. It watches the size rise and fall,
 * and each low point between two peaks becomes a boundary. Each lap is then analyzed by itself with detectPhases.
 * @returns laps that are genuinely up and back, each with its start and end time.
 */
export function detectLaps(series) {
  if (series.length < 6) return [];
  const smooth = medianSmooth(series);
  const boundaries = [0];
  let low = 0;
  let high = 0;
  let rising = true;
  let lastLow = 0;
  for (let i = 1; i < smooth.length; i++) {
    const size = smooth[i].size;
    if (rising) {
      if (size > smooth[high].size) high = i;
      if (size < smooth[low].size) {
        low = i;
        high = i;
      }
      // Only a real fall from a real rise counts as the top of a lap.
      if (smooth[high].size >= smooth[low].size * MIN_SIZE_CHANGE && size <= smooth[high].size / MIN_SIZE_CHANGE) {
        rising = false;
        lastLow = i;
      }
    } else {
      if (size < smooth[lastLow].size) lastLow = i;
      if (size >= smooth[lastLow].size * MIN_SIZE_CHANGE) {
        boundaries.push(lastLow);
        rising = true;
        low = lastLow;
        high = i;
      }
    }
  }
  boundaries.push(smooth.length - 1);

  const laps = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const slice = series.slice(boundaries[i], boundaries[i + 1] + 1);
    const phases = detectPhases(slice);
    if (phases.shape === 'up-and-back') laps.push({ ...phases, start: slice[0].t, end: slice.at(-1).t });
  }
  return laps;
}

/**
 * The same idea live, frame by frame, for hands-free recording. Phases run:
 * start, approach, turn, back, done. It only ever sees the past, so it waits for a change to hold
 * for a moment before believing it.
 */
export class WalkDetector {
  constructor({ grow = 1.18, shrink = 0.9, hold = 0.35, turnAfter = 0.5, stopAfter = 1.2, lostAfter = 1.2 } = {}) {
    Object.assign(this, { grow, shrink, hold, turnAfter, stopAfter, lostAfter });
    this.phase = 'start';
    this.smooth = null;
    this.lastT = null;
    this.lastSeen = null;
    this.firstT = null;
    this.baseline = null;
    this.baselineSum = 0;
    this.baselineCount = 0;
    this.heldSince = null;
    this.peak = 0;
    this.peakT = 0;
    this.lowest = Infinity;
    this.lowestT = 0;
  }

  held(condition, t) {
    if (!condition) {
      this.heldSince = null;
      return false;
    }
    if (this.heldSince === null) this.heldSince = t;
    return t - this.heldSince >= this.hold;
  }

  /** @param {number} t seconds @param {number|null} size torso size, or null if not visible */
  update(t, size) {
    if (this.phase === 'done') return this.phase;

    if (size === null || size === undefined) {
      // Walking out of frame at the far end of the return is a normal way to finish.
      if (this.phase === 'back' && this.lastSeen !== null && t - this.lastSeen >= this.lostAfter) this.phase = 'done';
      return this.phase;
    }
    this.lastSeen = t;

    const dt = this.lastT === null ? 0 : t - this.lastT;
    this.lastT = t;
    const alpha = dt > 0 ? 1 - Math.exp(-dt / 0.25) : 1;
    this.smooth = this.smooth === null ? size : this.smooth + alpha * (size - this.smooth);
    const s = this.smooth;

    if (this.firstT === null) this.firstT = t;
    if (this.baseline === null) {
      this.baselineSum += size;
      this.baselineCount++;
      if (t - this.firstT >= 0.5) this.baseline = this.baselineSum / this.baselineCount;
      return this.phase;
    }

    if (this.phase === 'start') {
      // If recording starts with them close to the camera, they may walk away before coming toward it.
      // Follow the size down, so the starting point is the farthest they have been.
      if (s < this.baseline) this.baseline = s;
      if (this.held(s > this.baseline * this.grow, t)) {
        this.phase = 'approach';
        this.peak = s;
        this.peakT = t;
        this.heldSince = null;
      }
    } else if (this.phase === 'approach' || this.phase === 'turn') {
      if (s > this.peak) {
        // Only clearly growing again counts as still approaching; noise at the peak does not.
        if (this.phase === 'turn' && s > this.peak * 1.03) this.phase = 'approach';
        this.peak = s;
        this.peakT = t;
      }
      if (this.held(s < this.peak * this.shrink, t)) {
        this.phase = 'back';
        this.lowest = s;
        this.lowestT = t;
        this.heldSince = null;
      } else if (this.phase === 'approach' && t - this.peakT >= this.turnAfter) {
        this.phase = 'turn';
      }
    } else if (this.phase === 'back') {
      if (s < this.lowest * 0.99) {
        this.lowest = s;
        this.lowestT = t;
      }
      const backAtStart = s <= this.baseline * 1.12;
      const stopped = t - this.lowestT >= this.stopAfter;
      if (backAtStart || stopped) this.phase = 'done';
    }
    return this.phase;
  }
}

/** Counts laps live, so a walker can do several in one recording without touching anything. */
export class LapCounter {
  constructor(target = 3, options) {
    this.target = target;
    this.options = options;
    this.finished = 0;
    this.detector = new WalkDetector(options);
  }

  get lap() {
    return Math.min(this.finished + 1, this.target);
  }

  get done() {
    return this.finished >= this.target;
  }

  /** @returns the phase of the current lap: start, approach, turn, back, or done once all laps are finished. */
  update(t, size) {
    if (this.done) return 'done';
    const phase = this.detector.update(t, size);
    if (phase !== 'done') return phase;
    this.finished++;
    if (this.done) return 'done';
    this.detector = new WalkDetector(this.options);
    return 'start';
  }
}
