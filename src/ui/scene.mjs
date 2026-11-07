// The picture at the top of the home page: a lit runway, seen through the same kind of pinhole camera the tracker
// assumes, with the made-up figure from sampleWalk.mjs walking it in metres. Nothing here came from a person, and
// the page says so. The floor, the lights, the figure and its reflection all use one projection, so they agree.
import { walkTimeline } from '../lib/sampleWalk.mjs';
import { BONES, LM } from '../lib/landmarks.mjs';

const NEAR = 4.4;
const FAR = 14;
const RUNWAY_HALF_WIDTH = 0.92;
const END_WALL = FAR + 0.8;
const CAMERA_HEIGHT = 0.72;
const LOOP_GAP_SECONDS = 1.4;

const LIMBS = [
  [LM.L_SHOULDER, LM.L_ELBOW, 0.046], [LM.L_ELBOW, LM.L_WRIST, 0.036],
  [LM.R_SHOULDER, LM.R_ELBOW, 0.046], [LM.R_ELBOW, LM.R_WRIST, 0.036],
  [LM.L_HIP, LM.L_KNEE, 0.078], [LM.L_KNEE, LM.L_ANKLE, 0.054],
  [LM.R_HIP, LM.R_KNEE, 0.078], [LM.R_KNEE, LM.R_ANKLE, 0.054],
  [LM.L_ANKLE, LM.L_FOOT, 0.038], [LM.R_ANKLE, LM.R_FOOT, 0.038],
];

// Dots on the main joints only. Every point on a foot would merge into one white blob.
const JOINTS = [LM.L_SHOULDER, LM.R_SHOULDER, LM.L_ELBOW, LM.R_ELBOW, LM.L_WRIST, LM.R_WRIST, LM.L_HIP, LM.R_HIP, LM.L_KNEE, LM.R_KNEE, LM.L_ANKLE, LM.R_ANKLE, LM.NECK, LM.HEAD_TOP];

/** A small repeatable random source, so the audience sits in the same seats every time. */
function seeded(seed) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/** Where everything lands on this canvas. A narrow screen puts the runway on top and the words below it. */
function viewFor(W, H, dpr) {
  const narrow = W / H < 1;
  return narrow
    ? { W, H, dpr, narrow, vx: W * 0.5, hy: H * 0.44, f: H * 1.3 }
    : { W, H, dpr, narrow, vx: W * 0.64, hy: H * 0.44, f: H * 1.42 };
}

const project = (view, x, y, d) => [view.vx + (view.f * x) / d, view.hy - (view.f * (y - CAMERA_HEIGHT)) / d];

/** Everything that stays still, painted once for each canvas size. */
function paintStage(view) {
  const { W, H, vx, hy, f } = view;
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d');

  const sky = ctx.createLinearGradient(0, 0, 0, hy);
  sky.addColorStop(0, '#0B1428');
  sky.addColorStop(1, '#1B2C50');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, hy + 1);
  const floor = ctx.createLinearGradient(0, hy, 0, H);
  floor.addColorStop(0, '#16264A');
  floor.addColorStop(1, '#0B1428');
  ctx.fillStyle = floor;
  ctx.fillRect(0, hy, W, H - hy);

  // A wash of light on the end wall, behind where the walker comes from.
  const wash = ctx.createRadialGradient(vx, hy - H * 0.04, 0, vx, hy - H * 0.04, Math.max(W, H) * 0.55);
  wash.addColorStop(0, 'rgba(242, 195, 139, 0.34)');
  wash.addColorStop(0.35, 'rgba(214, 160, 104, 0.12)');
  wash.addColorStop(1, 'rgba(214, 160, 104, 0)');
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, W, H);

  // The audience: one dark mass on each side of the runway, with a row of heads along its top edge. Its shape comes
  // from the same projection, so its edges run to the same vanishing point as the runway's.
  const random = seeded(7);
  const crowdNear = 1.4;
  for (const side of [-1, 1]) {
    const inner = side * (RUNWAY_HALF_WIDTH + 0.55);
    const outer = side * 9;
    const shoulderHeight = 1.02;
    ctx.fillStyle = '#09111F';
    ctx.beginPath();
    // The rows of seats rise as they go back, at the same slope as the rows of heads below.
    const backHeight = shoulderHeight + Math.abs(outer - inner) * (0.22 / 0.62);
    const corners = [[inner, 0, END_WALL], [inner, shoulderHeight, END_WALL], [outer, backHeight, END_WALL], [outer, backHeight, crowdNear], [inner, shoulderHeight, crowdNear], [inner, 0, crowdNear]];
    corners.forEach(([x, y, d], i) => {
      const [px, py] = project(view, x, y, d);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.fill();
    for (let row = 3; row >= 0; row--) {
      const x = side * (RUNWAY_HALF_WIDTH + 0.75 + row * 0.62);
      for (let d = END_WALL - 0.2; d > 3; d -= 0.5) {
        if (random() < 0.12) continue;
        const [px, py] = project(view, x + (random() - 0.5) * 0.16, shoulderHeight + row * 0.22 + 0.12 + random() * 0.05, d);
        ctx.fillStyle = '#09111F';
        ctx.beginPath();
        ctx.arc(px, py, (f / d) * 0.1, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // The way out: a tall doorway of light at the far end.
  const [doorLeft, doorTop] = project(view, -RUNWAY_HALF_WIDTH * 0.95, 3.1, END_WALL);
  const [doorRight, doorBottom] = project(view, RUNWAY_HALF_WIDTH * 0.95, 0, END_WALL);
  ctx.save();
  ctx.shadowColor = 'rgba(242, 195, 139, 0.95)';
  ctx.shadowBlur = H * 0.09;
  const door = ctx.createLinearGradient(0, doorTop, 0, doorBottom);
  door.addColorStop(0, '#F2C38B');
  door.addColorStop(0.7, '#FBEBD3');
  door.addColorStop(1, '#FFFFFF');
  ctx.fillStyle = door;
  ctx.fillRect(doorLeft, doorTop, doorRight - doorLeft, doorBottom - doorTop);
  ctx.restore();

  // The runway itself, polished enough to hold a reflection.
  const nearest = 1.2;
  const [nearLeft, nearY] = project(view, -RUNWAY_HALF_WIDTH, 0, nearest);
  const [nearRight] = project(view, RUNWAY_HALF_WIDTH, 0, nearest);
  const [farLeft, farY] = project(view, -RUNWAY_HALF_WIDTH, 0, END_WALL);
  const [farRight] = project(view, RUNWAY_HALF_WIDTH, 0, END_WALL);
  const deck = ctx.createLinearGradient(0, farY, 0, Math.min(nearY, H));
  deck.addColorStop(0, '#C9A27A');
  deck.addColorStop(0.09, '#4A4F63');
  deck.addColorStop(0.4, '#1E2D4E');
  deck.addColorStop(1, '#111D36');
  ctx.fillStyle = deck;
  ctx.beginPath();
  ctx.moveTo(farLeft, farY);
  ctx.lineTo(farRight, farY);
  ctx.lineTo(nearRight, nearY);
  ctx.lineTo(nearLeft, nearY);
  ctx.closePath();
  ctx.fill();
  ctx.save();
  ctx.clip();

  // The doorway's reflection, running down the polished floor toward us.
  ctx.globalCompositeOperation = 'lighter';
  const sheen = ctx.createLinearGradient(0, farY, 0, H);
  sheen.addColorStop(0, 'rgba(251, 232, 204, 0.55)');
  sheen.addColorStop(0.5, 'rgba(242, 195, 139, 0.1)');
  sheen.addColorStop(1, 'rgba(242, 195, 139, 0)');
  ctx.fillStyle = sheen;
  ctx.beginPath();
  ctx.moveTo(doorLeft, farY);
  ctx.lineTo(doorRight, farY);
  ctx.lineTo(vx + (doorRight - vx) * 2.1 * (END_WALL / nearest) * 0.16, H);
  ctx.lineTo(vx + (doorLeft - vx) * 2.1 * (END_WALL / nearest) * 0.16, H);
  ctx.closePath();
  ctx.fill();

  // Pools of light under each rig.
  for (let d = END_WALL - 1.6; d > 2.6; d -= 2.6) {
    const [px, py] = project(view, 0, 0, d);
    const scale = f / d;
    ctx.save();
    ctx.translate(px, py);
    ctx.scale(1, Math.max(0.05, (f * CAMERA_HEIGHT) / d / d / scale) * 1.4);
    const pool = ctx.createRadialGradient(0, 0, 0, 0, 0, scale * 1.15);
    pool.addColorStop(0, 'rgba(251, 232, 204, 0.2)');
    pool.addColorStop(1, 'rgba(251, 232, 204, 0)');
    ctx.fillStyle = pool;
    ctx.beginPath();
    ctx.arc(0, 0, scale * 1.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();

  // The line to walk, down the middle.
  ctx.save();
  ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(251, 232, 204, 0.34)';
  for (let d = END_WALL; d > nearest + 0.5; d -= 0.9) {
    const [x0, y0] = project(view, 0, 0, d);
    const [x1, y1] = project(view, 0, 0, Math.max(nearest, d - 0.42));
    ctx.lineWidth = Math.max(0.6, (f / d) * 0.012);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }
  ctx.restore();

  // Lights along both edges.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const side of [-1, 1]) {
    const [x0, y0] = project(view, side * RUNWAY_HALF_WIDTH, 0, END_WALL);
    const [x1, y1] = project(view, side * RUNWAY_HALF_WIDTH, 0, nearest);
    const edge = ctx.createLinearGradient(x0, y0, x1, y1);
    edge.addColorStop(0, 'rgba(251, 232, 204, 0.85)');
    edge.addColorStop(1, 'rgba(242, 195, 139, 0.18)');
    ctx.strokeStyle = edge;
    ctx.lineWidth = Math.max(1, H * 0.0016);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    for (let d = END_WALL; d > nearest + 0.4; d -= 0.62) {
      const [px, py] = project(view, side * RUNWAY_HALF_WIDTH, 0, d);
      const r = Math.min(H * 0.0045, Math.max(1, (f / d) * 0.02));
      const glow = ctx.createRadialGradient(px, py, 0, px, py, r * 5);
      glow.addColorStop(0, 'rgba(255, 250, 240, 0.95)');
      glow.addColorStop(0.25, 'rgba(251, 232, 204, 0.4)');
      glow.addColorStop(1, 'rgba(242, 195, 139, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(px, py, r * 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // The lighting rigs overhead, each with a soft beam down to the floor. On a narrow screen the nearest ones would
  // run behind the header.
  for (let d = END_WALL - 1.6; d > (view.narrow ? 9 : 2.6); d -= 2.6) {
    const [x0, y0] = project(view, -1.25, 3.5, d);
    const [x1] = project(view, 1.25, 3.5, d);
    const [fx0, fy] = project(view, -1.05, 0, d);
    const [fx1] = project(view, 1.05, 0, d);
    const beam = ctx.createLinearGradient(0, y0, 0, fy);
    beam.addColorStop(0, 'rgba(251, 232, 204, 0.075)');
    beam.addColorStop(1, 'rgba(251, 232, 204, 0)');
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y0);
    ctx.lineTo(fx1, fy);
    ctx.lineTo(fx0, fy);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 252, 245, 0.92)';
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1.2, (f / d) * 0.022);
    ctx.shadowColor = 'rgba(251, 232, 204, 0.9)';
    ctx.shadowBlur = H * 0.018;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y0);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
  ctx.restore();
  return canvas;
}

/** Draw the figure from its pose in metres. With `mirror`, it is drawn as its reflection in the floor. */
function paintFigure(ctx, view, pose, depthOf, mirror = false) {
  const at = (i) => {
    const p = pose[i];
    if (!p) return null;
    const d = depthOf(p);
    const [x, y] = project(view, p.x, mirror ? -p.y : p.y, d);
    return { x, y, scale: view.f / d };
  };
  const line = (a, b, width) => {
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  };
  const limbs = LIMBS.map(([a, b, r]) => [at(a), at(b), r]).filter(([a, b]) => a && b);
  const [ls, rs, lh, rh] = [at(LM.L_SHOULDER), at(LM.R_SHOULDER), at(LM.L_HIP), at(LM.R_HIP)];
  const [le, re, top] = [at(LM.L_EAR), at(LM.R_EAR), at(LM.HEAD_TOP)];
  const neck = at(LM.NECK);
  const headX = (le.x + re.x) / 2;
  const headY = (le.y + re.y) / 2;
  const headRadius = le.scale * 0.104;
  const torsoShape = () => {
    ctx.beginPath();
    ctx.moveTo(ls.x, ls.y);
    ctx.lineTo(rs.x, rs.y);
    ctx.lineTo(rh.x, rh.y);
    ctx.lineTo(lh.x, lh.y);
    ctx.closePath();
  };
  const headShape = () => {
    ctx.beginPath();
    ctx.ellipse(headX, headY, headRadius, headRadius * 1.22, 0, 0, Math.PI * 2);
  };

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // A deep violet body, so the figure stands in front of the lights rather than floating on them.
  const body = ctx.createLinearGradient(0, top.y, 0, Math.max(lh.y, rh.y) + (lh.scale * 0.9));
  body.addColorStop(0, '#2C3D66');
  body.addColorStop(1, '#16233F');
  ctx.fillStyle = body;
  ctx.strokeStyle = body;
  for (const [a, b, r] of limbs) line(a, b, a.scale * r * 2);
  ctx.lineWidth = ls.scale * 0.08;
  torsoShape();
  ctx.fill();
  ctx.stroke();
  line(neck, { x: headX, y: headY }, ls.scale * 0.1);
  headShape();
  ctx.fill();

  // A thin edge of light around the head, the one part with no bones to show it.
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = 'rgba(242, 195, 139, 0.55)';
  ctx.lineWidth = Math.max(1, ls.scale * 0.007);
  headShape();
  ctx.stroke();

  // The skeleton: the same bones the tracker draws on a real walk.
  const bright = Math.max(0.9, ls.scale * 0.0095);
  ctx.strokeStyle = 'rgba(242, 195, 139, 0.42)';
  for (const [a, b] of BONES) {
    const [from, to] = [at(a), at(b)];
    if (from && to) line(from, to, bright * 3.4);
  }
  ctx.strokeStyle = '#F4EDE0';
  for (const [a, b] of BONES) {
    const [from, to] = [at(a), at(b)];
    if (from && to) line(from, to, bright);
  }
  ctx.fillStyle = '#FFFFFF';
  for (const i of JOINTS) {
    const p = at(i);
    if (!p) continue;
    ctx.beginPath();
    ctx.arc(p.x, p.y, bright * 1.75, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Where each kind of callout attaches to the body: the joint on the right-hand side of the picture. */
function anchorsFor(view, pose, depthOf) {
  const point = (p) => project(view, p.x, p.y, depthOf(p));
  const right = (a, b) => {
    const [pa, pb] = [point(pose[a]), point(pose[b])];
    return pa[0] > pb[0] ? pa : pb;
  };
  return {
    shoulders: () => right(LM.L_SHOULDER, LM.R_SHOULDER),
    head: () => right(LM.L_EAR, LM.R_EAR),
    hips: () => right(LM.L_HIP, LM.R_HIP),
    feet: () => right(LM.L_ANKLE, LM.R_ANKLE),
  };
}

/** Labels beside the figure, each with a line to the part of the body it describes. */
function paintCallouts(ctx, view, pose, depthOf, callouts, strength) {
  if (!callouts.length || strength <= 0) return;
  const anchors = anchorsFor(view, pose, depthOf);
  const size = Math.max(14, Math.min(17, (view.W / view.dpr) * 0.0115)) * view.dpr;
  const labelX = Math.min(view.W - size * 13, view.vx + view.W * 0.095);
  ctx.save();
  ctx.globalAlpha = strength;
  ctx.textBaseline = 'middle';
  for (const callout of callouts) {
    const [x, y] = anchors[callout.at]();
    const left = Math.max(labelX, x + size * 2);
    ctx.strokeStyle = 'rgba(251, 232, 204, 0.55)';
    ctx.lineWidth = view.dpr;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(left - 8 * view.dpr, y);
    ctx.stroke();
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(x, y, 3 * view.dpr, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `600 ${size}px "Be Vietnam Pro", system-ui, sans-serif`;
    ctx.fillStyle = '#F4EDE0';
    ctx.fillText(callout.value, left, y - size * 0.62);
    ctx.font = `400 ${size * 0.86}px "Be Vietnam Pro", system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(251, 232, 204, 0.78)';
    ctx.fillText(callout.label, left, y + size * 0.62);
  }
  ctx.restore();
}

/**
 * Thin leader lines from each joint to its readout in the page beside the picture. The words live in the page, so
 * they stay sharp and readable; the canvas only draws the line and the dot on the joint.
 * @param readout { x, ys } in CSS pixels relative to the canvas: the column's left edge and each item's middle.
 */
function paintLeaders(ctx, view, pose, depthOf, callouts, readout, strength) {
  if (!callouts.length || !readout || strength <= 0) return;
  const anchors = anchorsFor(view, pose, depthOf);
  const { dpr } = view;
  const endX = (readout.x - 14) * dpr;
  ctx.save();
  ctx.globalAlpha = strength;
  ctx.lineWidth = dpr;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(251, 232, 204, 0.35)';
  ctx.fillStyle = '#FFFFFF';
  for (const callout of callouts) {
    const ty = readout.ys?.[callout.at];
    if (ty === undefined) continue;
    const [x, y] = anchors[callout.at]();
    const gap = endX - x;
    if (gap < 24 * dpr) continue;
    // Out from the joint, one angled run, then level into the readout: a calm, drawn-by-hand line.
    const bend = x + Math.min(gap * 0.4, 56 * dpr);
    const settle = Math.max(bend + 4 * dpr, endX - 20 * dpr);
    ctx.beginPath();
    ctx.moveTo(x + 4 * dpr, y);
    ctx.lineTo(bend, y);
    ctx.lineTo(settle, ty * dpr);
    ctx.lineTo(endX, ty * dpr);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 2.25 * dpr, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(endX, ty * dpr, 1.5 * dpr, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * @param canvas The canvas to draw on. It fills whatever its CSS gives it.
 * @param options.callouts Labels to show, each { at: 'head'|'shoulders'|'hips'|'feet', value, label }.
 * @param options.labels false to paint no words on the canvas, only leader lines to readouts placed by the page
 *   (see setReadoutX). The joint dots stay either way.
 * @returns start, stop, setCallouts and setReadoutX.
 */
export function createRunwayScene(canvas, { callouts = [], labels: paintLabels = true } = {}) {
  const ctx = canvas.getContext('2d');
  const timeline = walkTimeline('catwalk', { near: NEAR, far: FAR });
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  // Begin part way along, so the first thing anyone sees is someone already walking toward them.
  const firstMoment = timeline.approachSeconds * 0.62;
  const loop = timeline.duration + LOOP_GAP_SECONDS;
  let labels = callouts;
  let readout = null;
  let stage = null;
  let view = null;
  let reflection = null;
  let frame = 0;
  let running = false;
  let startedAt = 0;
  let onScreen = true;
  let flashes = [];
  let lastT = 0;
  const flashRandom = seeded(99);

  function fit() {
    const box = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.max(1, Math.round(box.width * dpr));
    const H = Math.max(1, Math.round(box.height * dpr));
    if (canvas.width === W && canvas.height === H && stage) return;
    canvas.width = W;
    canvas.height = H;
    view = viewFor(W, H, dpr);
    stage = paintStage(view);
    reflection = new OffscreenCanvas(W, H);
  }

  function draw(t) {
    fit();
    const { W, H } = view;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(stage, 0, 0);

    // Now and then, a camera flash in the crowd.
    if (!still && flashRandom() < 0.03) {
      const side = flashRandom() < 0.5 ? -1 : 1;
      flashes.push({ x: side * (RUNWAY_HALF_WIDTH + 0.75 + flashRandom() * 1.8), y: 1.3 + flashRandom() * 0.6, d: 5 + flashRandom() * 9, born: t });
    }
    if (t < lastT) flashes = [];
    lastT = t;
    flashes = flashes.filter((f) => t - f.born < 0.22);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const f of flashes) {
      const [px, py] = project(view, f.x, f.y, f.d);
      const r = (view.f / f.d) * 0.32;
      const flash = ctx.createRadialGradient(px, py, 0, px, py, r);
      flash.addColorStop(0, `rgba(255, 255, 255, ${0.9 * (1 - (t - f.born) / 0.22)})`);
      flash.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = flash;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    const moment = t % loop;
    if (moment <= timeline.duration) {
      const pose = timeline.poseAt(moment);
      const depthOf = (p) => -p.z;
      const hips = depthOf(pose[LM.L_HIP]);
      // They appear out of the doorway's light, and fade back into it.
      const presence = Math.min(1, (FAR - hips + 0.12) / 1.4);

      // The reflection, fading out with distance from the floor.
      const r = reflection.getContext('2d');
      r.globalCompositeOperation = 'source-over';
      r.clearRect(0, 0, W, H);
      paintFigure(r, view, pose, depthOf, true);
      const [, floorY] = project(view, 0, 0, hips);
      const reach = (view.f / hips) * 1.45;
      const fade = r.createLinearGradient(0, floorY, 0, floorY + reach);
      fade.addColorStop(0, 'rgba(0, 0, 0, 0.44)');
      fade.addColorStop(1, 'rgba(0, 0, 0, 0)');
      r.globalCompositeOperation = 'destination-in';
      r.fillStyle = fade;
      r.fillRect(0, 0, W, H);
      ctx.globalAlpha = presence;
      ctx.drawImage(reflection, 0, 0);

      paintFigure(ctx, view, pose, depthOf);
      ctx.globalAlpha = 1;
      const strength = Math.min(1, (9 - hips) / 1.6);
      if (paintLabels && !view.narrow) paintCallouts(ctx, view, pose, depthOf, labels, strength);
      if (!paintLabels) paintLeaders(ctx, view, pose, depthOf, labels, readout, strength);
    }
  }

  function tick(now) {
    if (!running) return;
    draw((now - startedAt) / 1000);
    frame = requestAnimationFrame(tick);
  }

  function play() {
    if (running || still || !onScreen) return;
    running = true;
    frame = requestAnimationFrame(tick);
  }

  function pause() {
    running = false;
    cancelAnimationFrame(frame);
  }

  const watcher = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => {
      onScreen = entries.at(-1).isIntersecting;
      if (onScreen) play();
      else pause();
    })
    : null;
  const resized = new ResizeObserver(() => {
    if (still) draw(timeline.approachSeconds * 0.86);
    else if (!running) draw((performance.now() - startedAt) / 1000);
  });

  return {
    start() {
      startedAt = performance.now() - firstMoment * 1000;
      watcher?.observe(canvas);
      resized.observe(canvas);
      draw(still ? timeline.approachSeconds * 0.86 : firstMoment);
      play();
    },
    stop() {
      pause();
      watcher?.disconnect();
      resized.disconnect();
    },
    setCallouts(next) {
      labels = next;
      if (still) draw(timeline.approachSeconds * 0.86);
    },
    /**
     * Where the page's readout column starts, so leaders can run to it. Pass null to draw no leaders.
     * @param x The column's left edge in CSS pixels from the canvas's left edge.
     * @param ys Each readout's vertical middle in CSS pixels from the canvas's top, keyed by 'head', 'shoulders',
     *   'hips' and 'feet'.
     */
    setReadoutX(x, ys = {}) {
      readout = Number.isFinite(x) ? { x, ys } : null;
      if (still) draw(timeline.approachSeconds * 0.86);
    },
  };
}
