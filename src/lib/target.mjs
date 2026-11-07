// Keeps tracking the same person when several are in shot, so a crowd behind the walker does not take
// over the measurements. The first lock prefers someone large and central. After that it follows
// whoever stays closest to the previous position, and only looks again after a second of no match.
import { LM } from './landmarks.mjs';

const REACQUIRE_AFTER_SECONDS = 1;

function describe(landmarks, W, H) {
  const pick = [LM.L_SHOULDER, LM.R_SHOULDER, LM.L_HIP, LM.R_HIP].map((i) => landmarks[i]);
  const cx = (pick.reduce((sum, p) => sum + p.x, 0) / 4) * W;
  const cy = (pick.reduce((sum, p) => sum + p.y, 0) / 4) * H;
  const torso = Math.hypot(
    ((pick[0].x + pick[1].x) / 2 - (pick[2].x + pick[3].x) / 2) * W,
    ((pick[0].y + pick[1].y) / 2 - (pick[2].y + pick[3].y) / 2) * H,
  );
  return { cx, cy, torso };
}

export class TargetLock {
  constructor() {
    this.reset();
  }

  reset() {
    this.last = null;
    this.lastSeen = null;
  }

  /** @returns the chosen person's landmarks, or null if the locked person is not in this frame. */
  update(poses, t, W, H) {
    if (!poses || poses.length === 0) return null;
    const people = poses.map((landmarks) => ({ landmarks, ...describe(landmarks, W, H) }));

    if (this.last && t - this.lastSeen > REACQUIRE_AFTER_SECONDS) this.last = null;

    let chosen = null;
    if (this.last) {
      // Far enough to allow fast walking between samples, near enough to refuse a person across the room.
      const reach = Math.max(this.last.torso * 1.5, W * 0.1);
      let best = Infinity;
      for (const person of people) {
        const gap = Math.hypot(person.cx - this.last.cx, person.cy - this.last.cy);
        if (gap <= reach && gap < best) {
          best = gap;
          chosen = person;
        }
      }
    } else {
      let best = -Infinity;
      for (const person of people) {
        const centred = 1 - Math.abs(person.cx - W / 2) / (W / 2);
        const score = person.torso * (0.4 + 0.6 * centred);
        if (score > best) {
          best = score;
          chosen = person;
        }
      }
    }

    if (!chosen) return null;
    this.last = chosen;
    this.lastSeen = t;
    return chosen.landmarks;
  }
}
