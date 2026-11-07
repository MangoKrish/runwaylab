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
