// Prepares what Gemini sees: a dozen stills, each cropped to the walker with the head pixelated. A frame is only
// eligible when the tracker located the head in that exact frame, so a tracking miss means that frame is
// skipped rather than sent with the face showing.
import { LM } from '../lib/landmarks.mjs';
import { openVideo, seekTo, makeGrabber } from '../pose/video.mjs';

const MAX_SIDE = 512;
const HEAD_POINTS = [LM.NOSE, LM.L_EYE, LM.R_EYE, LM.L_EAR, LM.R_EAR];
const CORE = [LM.L_SHOULDER, LM.R_SHOULDER, LM.L_HIP, LM.R_HIP];

export function headCircle(pts) {
  const head = HEAD_POINTS.map((i) => pts[i]).filter(Boolean);
  if (head.length < 2 || CORE.some((i) => !pts[i])) return null;
  const cx = head.reduce((sum, p) => sum + p[0], 0) / head.length;
  const cy = head.reduce((sum, p) => sum + p[1], 0) / head.length;
  const torso = Math.hypot(
    (pts[LM.L_SHOULDER][0] + pts[LM.R_SHOULDER][0]) / 2 - (pts[LM.L_HIP][0] + pts[LM.R_HIP][0]) / 2,
    (pts[LM.L_SHOULDER][1] + pts[LM.R_SHOULDER][1]) / 2 - (pts[LM.L_HIP][1] + pts[LM.R_HIP][1]) / 2,
  );
  const shoulders = Math.hypot(pts[LM.L_SHOULDER][0] - pts[LM.R_SHOULDER][0], pts[LM.L_SHOULDER][1] - pts[LM.R_SHOULDER][1]);
  return { cx, cy, r: Math.max(torso * 0.45, shoulders * 0.55) };
}

/** Which frames to send: evenly spread over the walk, and only ones where the head was found. */
export function chooseStillFrames(analysis, count = 12) {
  const { frames, phases } = analysis;
  const start = phases.approach?.[0] ?? frames[0]?.t ?? 0;
  const end = phases.back?.[1] ?? frames.at(-1)?.t ?? 0;
  const eligible = frames.filter((f) => f.pts && f.t >= start && f.t <= end && (f.status === 'valid' || f.status === 'side-on') && headCircle(f.pts));
  if (eligible.length <= count) return eligible;
  return Array.from({ length: count }, (_, i) => eligible[Math.round((i * (eligible.length - 1)) / (count - 1))]);
}

function cropBox(pts, W, H) {
  const present = pts.filter(Boolean);
  const xs = present.map((p) => p[0]);
  const ys = present.map((p) => p[1]);
  const margin = (Math.max(...ys) - Math.min(...ys)) * 0.18;
  const x0 = Math.max(0, Math.min(...xs) - margin);
  const y0 = Math.max(0, Math.min(...ys) - margin);
  const x1 = Math.min(W, Math.max(...xs) + margin);
  const y1 = Math.min(H, Math.max(...ys) + margin);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function pixelate(ctx, cx, cy, r) {
  const x = Math.max(0, cx - r);
  const y = Math.max(0, cy - r);
  const size = r * 2;
  const tiny = document.createElement('canvas');
  tiny.width = 7;
  tiny.height = 7;
  tiny.getContext('2d').drawImage(ctx.canvas, x, y, size, size, 0, 0, 7, 7);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(tiny, 0, 0, 7, 7, x, y, size, size);
  ctx.restore();
}

/** @returns {Promise<{t:number, dataUrl:string}[]>} JPEG stills in time order. */
export async function makeStills(blob, analysis, { signal, count = 12, rotation = 0 } = {}) {
  const chosen = chooseStillFrames(analysis, count);
  if (!chosen.length) return [];
  const opened = await openVideo(blob, signal);
  try {
    const grabber = makeGrabber(opened.video, rotation);
    const stills = [];
    for (const frame of chosen) {
      await seekTo(opened.video, frame.t, signal);
      const upright = grabber.grab();
      const box = cropBox(frame.pts, analysis.W, analysis.H);
      const scale = Math.min(1, MAX_SIDE / Math.max(box.w, box.h));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(box.w * scale);
      canvas.height = Math.round(box.h * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(upright, box.x, box.y, box.w, box.h, 0, 0, canvas.width, canvas.height);
      const head = headCircle(frame.pts);
      pixelate(ctx, (head.cx - box.x) * scale, (head.cy - box.y) * scale, head.r * scale);
      stills.push({ t: frame.t, dataUrl: canvas.toDataURL('image/jpeg', 0.78) });
    }
    return stills;
  } finally {
    opened.close();
  }
}
