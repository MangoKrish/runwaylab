// Runs in the browser: every tracker on the same frames of one clip, with timing and quality numbers.
import { createPose } from '/src/pose/landmarker.mjs';
import { createRtmPose, WHOLE_BODY_SLOTS } from '/src/pose/rtmpose.mjs';
import { LM, BONES } from '/src/lib/landmarks.mjs';

const BASE = `${location.origin}/`;
const median = (v) => {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

const seek = (video, t) => new Promise((resolve) => {
  video.addEventListener('seeked', () => resolve(), { once: true });
  video.currentTime = t;
});

const makers = {
  'mediapipe-full': () => createPose(BASE, { model: 'full', numPoses: 1 }),
  'rtmpose-m': () => createRtmPose(BASE),
  'rtmw': () => createRtmPose(BASE, { modelUrl: '/rtmw.onnx', slots: WHOLE_BODY_SLOTS, name: 'RTMW' }),
};

const CORE = [LM.L_SHOULDER, LM.R_SHOULDER, LM.L_HIP, LM.R_HIP];
const TRACKED = [...CORE, LM.L_WRIST, LM.R_WRIST, LM.L_ANKLE, LM.R_ANKLE, LM.L_KNEE, LM.R_KNEE];
const usable = (p) => p && (p.visibility ?? 0) >= 0.5 && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;

function drawPose(ctx, pose, W, H, scale) {
  if (!pose) return;
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#7CFC00';
  ctx.fillStyle = '#ffffff';
  for (const [a, b] of BONES) {
    if (!usable(pose[a]) || !usable(pose[b])) continue;
    ctx.beginPath();
    ctx.moveTo(pose[a].x * W * scale, pose[a].y * H * scale);
    ctx.lineTo(pose[b].x * W * scale, pose[b].y * H * scale);
    ctx.stroke();
  }
}

window.runBench = async ({ clip, hz, seconds, trackers, sheetTimes }) => {
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  video.style.cssText = 'position:fixed;left:0;top:0;width:8px;height:8px;opacity:.01';
  document.body.append(video);
  video.src = clip;
  await new Promise((r, x) => { video.onloadeddata = r; video.onerror = () => x(new Error('video failed')); });
  const W = video.videoWidth;
  const H = video.videoHeight;
  const total = Math.min(seconds, video.duration);
  const out = { W, H, results: {}, sheets: {} };

  for (const name of trackers) {
    const started = performance.now();
    const tracker = await makers[name]();
    const loadMs = performance.now() - started;
    const frames = [];
    const times = [];
    let lastMs = 0;
    const count = Math.floor(total * hz);
    // Warm up on the first frame, so compile time does not count as running speed.
    await seek(video, 0);
    await tracker.detect(video, ++lastMs);
    for (let i = 0; i < count; i++) {
      const t = i / hz;
      await seek(video, t);
      const before = performance.now();
      lastMs = Math.max(lastMs + 1, Math.round(t * 1000) + 1000);
      const poses = await tracker.detect(video, lastMs);
      times.push(performance.now() - before);
      frames.push({ t, pose: poses[0] ? poses[0].map((p) => ({ x: p.x, y: p.y, visibility: p.visibility ?? 0 })) : null });
    }

    // Quality numbers.
    let core = 0;
    let ankleClaims = 0;
    let kneeClaims = 0;
    const accel = [];
    const legRatios = [];
    for (let i = 0; i < frames.length; i++) {
      const p = frames[i].pose;
      if (!p) continue;
      const hasCore = CORE.every((j) => usable(p[j]));
      if (hasCore) core++;
      if (usable(p[LM.L_ANKLE]) || usable(p[LM.R_ANKLE])) ankleClaims++;
      if (usable(p[LM.L_KNEE]) || usable(p[LM.R_KNEE])) kneeClaims++;
      if (!hasCore) continue;
      const torso = Math.hypot(((p[LM.L_SHOULDER].x + p[LM.R_SHOULDER].x) / 2 - (p[LM.L_HIP].x + p[LM.R_HIP].x) / 2) * W, ((p[LM.L_SHOULDER].y + p[LM.R_SHOULDER].y) / 2 - (p[LM.L_HIP].y + p[LM.R_HIP].y) / 2) * H);
      if (usable(p[LM.L_KNEE]) && usable(p[LM.L_HIP])) legRatios.push(Math.hypot((p[LM.L_KNEE].x - p[LM.L_HIP].x) * W, (p[LM.L_KNEE].y - p[LM.L_HIP].y) * H) / torso);
      const a = frames[i - 1]?.pose;
      const b = frames[i + 1]?.pose;
      if (a && b) {
        for (const j of TRACKED) {
          if (!usable(a[j]) || !usable(p[j]) || !usable(b[j])) continue;
          accel.push(Math.hypot((b[j].x - 2 * p[j].x + a[j].x) * W, (b[j].y - 2 * p[j].y + a[j].y) * H) / torso);
        }
      }
    }
    const sorted = [...times].sort((x, y) => x - y);
    out.results[name] = {
      loadSeconds: +(loadMs / 1000).toFixed(1),
      delegate: tracker.delegate,
      msMedian: +median(times).toFixed(1),
      msP95: +sorted[Math.floor(sorted.length * 0.95)].toFixed(1),
      frames: frames.length,
      coreCoverage: +(core / frames.length).toFixed(3),
      anklesClaimedInFrame: +(ankleClaims / frames.length).toFixed(3),
      kneesClaimedInFrame: +(kneeClaims / frames.length).toFixed(3),
      jitter: +(median(accel) ?? 0).toFixed(4),
      thighToTorsoCv: legRatios.length ? +(Math.sqrt(legRatios.reduce((s, r, _, all) => s + (r - median(all)) ** 2, 0) / legRatios.length) / median(legRatios)).toFixed(3) : null,
    };

    // A contact sheet, to judge by eye.
    const tileH = 420;
    const scale = tileH / H;
    const tileW = Math.round(W * scale);
    const sheet = document.createElement('canvas');
    sheet.width = tileW * sheetTimes.length;
    sheet.height = tileH;
    const ctx = sheet.getContext('2d');
    for (let s = 0; s < sheetTimes.length; s++) {
      const frame = frames.reduce((best, f) => (Math.abs(f.t - sheetTimes[s]) < Math.abs(best.t - sheetTimes[s]) ? f : best));
      await seek(video, frame.t);
      ctx.save();
      ctx.translate(s * tileW, 0);
      ctx.drawImage(video, 0, 0, tileW, tileH);
      drawPose(ctx, frame.pose, W, H, scale);
      ctx.restore();
    }
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 340, 34);
    ctx.fillStyle = '#fff';
    ctx.font = '24px sans-serif';
    ctx.fillText(name, 8, 26);
    out.sheets[name] = sheet.toDataURL('image/jpeg', 0.8);
    tracker.close();
  }
  video.remove();
  return out;
};
window.benchReady = true;
