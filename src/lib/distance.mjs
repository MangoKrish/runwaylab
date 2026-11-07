// How far the walker is from the camera, and where to put the start and turn marks so the picture never cuts
// them off. A pinhole camera makes size in the picture inversely proportional to distance, so one look at someone
// standing in frame says where every other distance lands on screen. The metres assume an average adult and a
// typical lens, so they are "about" figures; the marks relative to where you stand are exact for a level camera.
import { LM } from './landmarks.mjs';

/** Head top to ankle, in metres, for an average adult of about 1.70 m. */
export const BODY_SPAN_M = 1.6;
/** Farther than this and the body gets too few pixels for the tracker to time steps well. */
export const START_FILL = 0.32;
/** Head and feet stay this far inside the picture's edges, as a share of the half height. */
export const EDGE_ROOM = 0.9;

/**
 * Vertical field of view, in degrees, from the picture's shape. iPhones through Continuity Camera and most
 * 4:3 webcams see about 53° top to bottom held sideways; a widescreen webcam about 44°; a portrait picture about 67°.
 */
export function verticalFov(W, H) {
  if (H > W) return 67;
  return H / W > 0.7 ? 53 : 44;
}

const focalPx = (H, fov) => H / 2 / Math.tan((fov * Math.PI) / 360);

/** The body's top and bottom in the picture, or null when the head or both ankles are missing. */
export function bodySpan(pts) {
  if (!pts) return null;
  const head = pts[LM.HEAD_TOP] || pts[LM.NOSE] || pts[LM.L_EAR] || pts[LM.R_EAR];
  const feet = [pts[LM.L_ANKLE], pts[LM.R_ANKLE], pts[LM.L_HEEL], pts[LM.R_HEEL]].filter(Boolean);
  if (!head || !feet.length) return null;
  const top = head[1];
  const bottom = Math.max(...feet.map((p) => p[1]));
  return bottom - top > 10 ? { top, bottom } : null;
}

/** About how many metres away someone is, from how tall they look. */
export function distanceFor(span, W, H) {
  if (!span) return null;
  return (BODY_SPAN_M * focalPx(H, verticalFov(W, H))) / (span.bottom - span.top);
}

/**
 * Where to start and where to turn, in metres from the camera.
 * Without a measurement, assumes a body centred in the picture. With one (someone standing in frame), uses where
 * their head and feet actually sit, which also covers a camera set too high or too low.
 * @returns { start, turn, now } where now is the walker's distance, or null.
 */
export function runwayMarks(W, H, span = null) {
  const f = focalPx(H, verticalFov(W, H));
  if (!span) {
    const turn = BODY_SPAN_M * f / (H * EDGE_ROOM);
    return { turn, start: BODY_SPAN_M * f / (H * START_FILL), now: null };
  }
  const now = distanceFor(span, W, H);
  const c = H / 2;
  const room = c * EDGE_ROOM;
  // Each edge moves away from the centre as they come closer, in proportion to 1 / distance. The turn mark is
  // where the first of head or feet reaches its edge.
  const reach = Math.max((c - span.top) / room, (span.bottom - c) / room);
  const turn = now * reach;
  const start = Math.max(turn + 1.5, BODY_SPAN_M * f / (H * START_FILL));
  return { turn, start, now };
}

/** Where someone is against the marks: 'close' (past the turn mark), 'far' (behind the start mark), or 'ok'. */
export function zoneFor(marks) {
  if (!marks?.now) return null;
  if (marks.now < marks.turn) return 'close';
  if (marks.now > marks.start + 0.5) return 'far';
  return 'ok';
}

/** 2.3 m, rounded to a tenth, or to half a metre past 10 m. */
export const metres = (m) => (m >= 10 ? `${Math.round(m * 2) / 2} m` : `${m.toFixed(1)} m`);
