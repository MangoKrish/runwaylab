// The One Euro filter (Casiez, Roussel and Vogel, CHI 2012): a low-pass filter whose cutoff rises with
// speed. Slow movement gets heavy smoothing, which removes jitter. Fast movement gets light smoothing,
// which avoids lag. It uses real time gaps, so uneven sampling is handled correctly.
const smoothingFactor = (dt, cutoff) => {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
};

export class OneEuro {
  /**
   * @param {object} o
   * @param {number} o.minCutoff  Hz. Lower means less jitter and more lag at low speed.
   * @param {number} o.beta       How quickly the cutoff rises with speed.
   * @param {number} o.dCutoff    Hz. Cutoff for the speed estimate itself.
   */
  constructor({ minCutoff = 1.5, beta = 5, dCutoff = 1 } = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.reset();
  }

  /** Forget everything. The next value passes through unchanged, so nothing bridges a gap. */
  reset() {
    this.lastT = null;
    this.lastX = 0;
    this.lastDx = 0;
  }

  filter(x, t) {
    if (this.lastT === null || t <= this.lastT) {
      this.lastT = t;
      this.lastX = x;
      this.lastDx = 0;
      return x;
    }
    const dt = t - this.lastT;
    const dx = (x - this.lastX) / dt;
    const smoothDx = this.lastDx + smoothingFactor(dt, this.dCutoff) * (dx - this.lastDx);
    const cutoff = this.minCutoff + this.beta * Math.abs(smoothDx);
    const out = this.lastX + smoothingFactor(dt, cutoff) * (x - this.lastX);
    this.lastT = t;
    this.lastX = out;
    this.lastDx = smoothDx;
    return out;
  }
}
