// Draws one frame's skeleton. Only landmarks that survived filtering exist here, so a bone with a missing end
// is simply not drawn; the overlay can never show a point that was not measured.
import { BONES } from '../lib/landmarks.mjs';

const BONE_COLOUR = '#B3A1FF';
const JOINT_COLOUR = '#F7F3EC';

export function drawSkeleton(ctx, pts, scale, { lineWidth = 3 } = {}) {
  if (!pts) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = BONE_COLOUR;
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = lineWidth;
  for (const [a, b] of BONES) {
    if (!pts[a] || !pts[b]) continue;
    ctx.beginPath();
    ctx.moveTo(pts[a][0] * scale, pts[a][1] * scale);
    ctx.lineTo(pts[b][0] * scale, pts[b][1] * scale);
    ctx.stroke();
  }
  ctx.fillStyle = JOINT_COLOUR;
  ctx.shadowBlur = 0;
  for (const i of new Set(BONES.flat())) {
    if (!pts[i]) continue;
    ctx.beginPath();
    ctx.arc(pts[i][0] * scale, pts[i][1] * scale, lineWidth * 0.85, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

const NOT_FRAMED = [0xE8, 0xB3, 0x5A];
const FRAMED = [0xB3, 0xA1, 0xFF];

/**
 * The framing guides on the live stage: where the head and the feet should sit. Two dashed lines across the
 * middle of the picture, amber until the whole body fits, violet once it does.
 * @param mix 0 (not framed) to 1 (framed); the studio eases it so the colour change fades.
 */
export function drawFraming(ctx, W, H, mix) {
  const m = Math.min(1, Math.max(0, mix));
  const [r, g, b] = NOT_FRAMED.map((c, i) => Math.round(c + (FRAMED[i] - c) * m));
  const colour = `rgb(${r}, ${g}, ${b})`;
  const lineWidth = Math.max(2, Math.round(W / 480));
  const x0 = W * 0.2;
  const x1 = W * 0.8;
  const tick = Math.max(8, H * 0.025);
  ctx.save();
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.strokeStyle = colour;
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = lineWidth * 2;
  for (const [y, dir] of [[H * 0.06, 1], [H * 0.94, -1]]) {
    ctx.setLineDash([lineWidth * 5, lineWidth * 4]);
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();
    // Solid end ticks, pointing into the picture, so the guide reads as a bracket rather than a stray line.
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(x0, y + dir * tick);
    ctx.lineTo(x0, y);
    ctx.moveTo(x1, y + dir * tick);
    ctx.lineTo(x1, y);
    ctx.stroke();
  }
  ctx.restore();
}
