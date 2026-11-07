// RTMPose (Apache-2.0, from MMPose) running in the browser through ONNX Runtime Web.
//
// It works in two steps. RTMDet finds a box around the person, then RTMPose places 26 body points inside
// that box, including heels and toes. It keeps following the box from the last result, so it does not depend
// on finding a face, which matters when someone has their back to the camera or is very close.
//
// Results use the same layout as MediaPipe, plus five extra slots, so everything after this step is unchanged.
import { LANDMARK_COUNT } from '../lib/landmarks.mjs';

const POSE_WIDTH = 192;
const POSE_HEIGHT = 256;
const DETECT_SIZE = 320;
const BOX_PADDING = 1.25;
const POSE_MEAN = [123.675, 116.28, 103.53];
const POSE_STD = [58.395, 57.12, 57.375];
const DETECT_MEAN = [103.53, 116.28, 123.675]; // RTMDet was trained on blue-green-red input.
const DETECT_STD = [57.375, 57.12, 58.395];
const CHECK_EVERY_FRAMES = 30;
const CONFIDENT = 0.3;

// Which of RTMPose's 26 points goes in which slot. Others stay empty, never guessed.
const SLOTS = {
  0: 0, 1: 2, 2: 5, 3: 7, 4: 8, 5: 11, 6: 12, 7: 13, 8: 14, 9: 15, 10: 16,
  11: 23, 12: 24, 13: 25, 14: 26, 15: 27, 16: 28, 17: 33, 18: 34, 19: 35, 20: 31, 21: 32, 22: 36, 23: 37, 24: 29, 25: 30,
};
// The same idea for the 133-point whole-body model. It did no better on real footage, so it only appears in the
// tracker comparison: see scripts/bench-trackers.mjs.
export const WHOLE_BODY_SLOTS = {
  0: 0, 1: 2, 2: 5, 3: 7, 4: 8, 5: 11, 6: 12, 7: 13, 8: 14, 9: 15, 10: 16,
  11: 23, 12: 24, 13: 25, 14: 26, 15: 27, 16: 28, 17: 31, 18: 36, 19: 29, 20: 32, 21: 37, 22: 30,
};
const CORE = [5, 6, 11, 12];
const LANDMARKS = LANDMARK_COUNT;

// This build of ONNX Runtime keeps one stack for the whole page, so two calls under way at once corrupt it, even on
// different models. Leaving the studio can do that: its live tracker is mid-frame as it closes and the next one
// starts. So everything that touches the runtime takes its turn, across every tracker on the page.
let lastTurn = Promise.resolve();
function inTurn(work) {
  const result = lastTurn.then(work);
  lastTurn = result.catch(() => {});
  return result;
}

const iou = (a, b) => {
  const x0 = Math.max(a.x0, b.x0);
  const y0 = Math.max(a.y0, b.y0);
  const x1 = Math.min(a.x1, b.x1);
  const y1 = Math.min(a.y1, b.y1);
  const overlap = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const area = (r) => (r.x1 - r.x0) * (r.y1 - r.y0);
  return overlap / (area(a) + area(b) - overlap || 1);
};

/** The person to follow: whoever overlaps the last box most, or at first someone large and central. */
export function chooseBox(boxes, previous, W) {
  if (!boxes.length) return null;
  if (previous) {
    let best = null;
    let bestOverlap = 0.1;
    for (const box of boxes) {
      const overlap = iou(box, previous);
      if (overlap > bestOverlap) {
        best = box;
        bestOverlap = overlap;
      }
    }
    return best;
  }
  let best = null;
  let bestScore = -Infinity;
  for (const box of boxes) {
    const area = (box.x1 - box.x0) * (box.y1 - box.y0);
    const centred = 1 - Math.abs((box.x0 + box.x1) / 2 - W / 2) / (W / 2);
    const score = area * (0.3 + 0.7 * centred);
    if (score > bestScore) {
      best = box;
      bestScore = score;
    }
  }
  return best;
}

/** Turn a box into the padded crop RTMPose expects, keeping its 192 by 256 shape. */
export function cropFor(box) {
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  let w = (box.x1 - box.x0) * BOX_PADDING;
  let h = (box.y1 - box.y0) * BOX_PADDING;
  const aspect = POSE_WIDTH / POSE_HEIGHT;
  if (w > h * aspect) h = w / aspect;
  else w = h * aspect;
  return { cx, cy, w, h };
}

/** Read each point's most likely column and row from the model's two output grids. */
export function decodeSimcc(xs, ys, keypoints, crop) {
  const xBins = xs.length / keypoints;
  const yBins = ys.length / keypoints;
  const points = [];
  for (let k = 0; k < keypoints; k++) {
    let xBest = 0;
    let xValue = -Infinity;
    for (let i = 0; i < xBins; i++) {
      const v = xs[k * xBins + i];
      if (v > xValue) {
        xValue = v;
        xBest = i;
      }
    }
    let yBest = 0;
    let yValue = -Infinity;
    for (let i = 0; i < yBins; i++) {
      const v = ys[k * yBins + i];
      if (v > yValue) {
        yValue = v;
        yBest = i;
      }
    }
    points.push({
      x: crop.cx + (xBest / xBins - 0.5) * crop.w,
      y: crop.cy + (yBest / yBins - 0.5) * crop.h,
      score: Math.min(xValue, yValue),
    });
  }
  return points;
}

/** Fit a tight box to the confident points. @returns the box, or null if too little of the body was found. */
export function boxFromPoints(points) {
  const sure = points.filter((p) => p.score >= CONFIDENT);
  if (sure.length < 6 || CORE.filter((i) => points[i].score >= CONFIDENT).length < 3) return null;
  const xs = sure.map((p) => p.x);
  const ys = sure.map((p) => p.y);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const marginX = (x1 - x0) * 0.08;
  const marginY = (y1 - y0) * 0.08;
  return { x0: x0 - marginX, y0: y0 - marginY, x1: x1 + marginX, y1: y1 + marginY };
}

/** Convert to MediaPipe's layout. The model's score becomes "visibility", where 0.5 means confident enough. */
export function toLandmarks(points, W, H, slots = SLOTS) {
  const landmarks = Array.from({ length: LANDMARKS }, () => ({ x: 0, y: 0, visibility: 0 }));
  for (const [from, to] of Object.entries(slots)) {
    const p = points[from];
    landmarks[to] = { x: p.x / W, y: p.y / H, visibility: Math.min(1, Math.max(0, p.score) / (CONFIDENT * 2)) };
  }
  return landmarks;
}

/**
 * @param {string} base  URL of the site root, ending in a slash.
 * @returns the same interface as createPose in landmarker.mjs.
 */
export async function createRtmPose(base, { modelUrl = null, slots = SLOTS, name = 'RTMPose-m' } = {}) {
  const ort = await import(`${base}vendor/ort/ort.webgpu.min.mjs`);
  ort.env.wasm.wasmPaths = `${base}vendor/ort/`;
  ort.env.wasm.numThreads = 1; // More threads would need extra page headers, and the GPU does the heavy work.

  const canUseGpu = !!(await navigator.gpu?.requestAdapter?.().catch(() => null));
  const poser = await inTurn(() => ort.InferenceSession.create(modelUrl || `${base}vendor/models/rtmpose-m-halpe26.onnx`, {
    executionProviders: canUseGpu ? ['webgpu', 'wasm'] : ['wasm'],
  }));
  // The detector runs now and then, and it is small enough for the CPU.
  const detector = await inTurn(() => ort.InferenceSession.create(`${base}vendor/models/rtmdet-nano-person.onnx`, { executionProviders: ['wasm'] }));

  const poseCanvas = new OffscreenCanvas(POSE_WIDTH, POSE_HEIGHT);
  const poseCtx = poseCanvas.getContext('2d', { willReadFrequently: true });
  const detectCanvas = new OffscreenCanvas(DETECT_SIZE, DETECT_SIZE);
  const detectCtx = detectCanvas.getContext('2d', { willReadFrequently: true });
  const poseData = new Float32Array(3 * POSE_WIDTH * POSE_HEIGHT);
  const detectData = new Float32Array(3 * DETECT_SIZE * DETECT_SIZE);

  let box = null;
  let framesSinceCheck = 0;
  let closed = false;

  const sizeOf = (source) => ({ W: source.videoWidth || source.width, H: source.videoHeight || source.height });

  function fill(ctx, data, width, height, mean, std) {
    const { data: rgba } = ctx.getImageData(0, 0, width, height);
    const pixels = width * height;
    for (let i = 0; i < pixels; i++) {
      data[i] = (rgba[i * 4] - mean[0]) / std[0];
      data[pixels + i] = (rgba[i * 4 + 1] - mean[1]) / std[1];
      data[pixels * 2 + i] = (rgba[i * 4 + 2] - mean[2]) / std[2];
    }
  }

  function fillDetect(width, height) {
    const { data: rgba } = detectCtx.getImageData(0, 0, width, height);
    const pixels = width * height;
    for (let i = 0; i < pixels; i++) {
      detectData[i] = (rgba[i * 4 + 2] - DETECT_MEAN[0]) / DETECT_STD[0]; // Blue first.
      detectData[pixels + i] = (rgba[i * 4 + 1] - DETECT_MEAN[1]) / DETECT_STD[1];
      detectData[pixels * 2 + i] = (rgba[i * 4] - DETECT_MEAN[2]) / DETECT_STD[2];
    }
  }

  async function findPeople(source, W, H) {
    const scale = Math.min(DETECT_SIZE / W, DETECT_SIZE / H);
    detectCtx.fillStyle = 'rgb(114,114,114)';
    detectCtx.fillRect(0, 0, DETECT_SIZE, DETECT_SIZE);
    detectCtx.drawImage(source, 0, 0, W * scale, H * scale);
    fillDetect(DETECT_SIZE, DETECT_SIZE);
    const out = await detector.run({ [detector.inputNames[0]]: new ort.Tensor('float32', detectData, [1, 3, DETECT_SIZE, DETECT_SIZE]) });
    const dets = out[detector.outputNames[0]];
    const count = dets.dims[1];
    const people = [];
    for (let i = 0; i < count; i++) {
      const score = dets.data[i * 5 + 4];
      if (score < 0.4) continue;
      people.push({ x0: dets.data[i * 5] / scale, y0: dets.data[i * 5 + 1] / scale, x1: dets.data[i * 5 + 2] / scale, y1: dets.data[i * 5 + 3] / scale, score });
    }
    return people;
  }

  async function placePoints(source, target) {
    const crop = cropFor(target);
    poseCtx.fillStyle = 'black';
    poseCtx.fillRect(0, 0, POSE_WIDTH, POSE_HEIGHT);
    poseCtx.drawImage(source, crop.cx - crop.w / 2, crop.cy - crop.h / 2, crop.w, crop.h, 0, 0, POSE_WIDTH, POSE_HEIGHT);
    fill(poseCtx, poseData, POSE_WIDTH, POSE_HEIGHT, POSE_MEAN, POSE_STD);
    const out = await poser.run({ [poser.inputNames[0]]: new ort.Tensor('float32', poseData, [1, 3, POSE_HEIGHT, POSE_WIDTH]) });
    const xs = out[poser.outputNames[0]];
    const ys = out[poser.outputNames[1]];
    return decodeSimcc(xs.data, ys.data, xs.dims[1], crop);
  }

  return {
    delegate: canUseGpu ? 'GPU' : 'CPU',
    model: name,
    /** Asynchronous, unlike MediaPipe's: callers await it either way. */
    detect(source) {
      return inTurn(async () => {
        if (closed) return [];
        const { W, H } = sizeOf(source);
        framesSinceCheck++;
        if (!box || framesSinceCheck >= CHECK_EVERY_FRAMES) {
          const chosen = chooseBox(await findPeople(source, W, H), box, W);
          framesSinceCheck = 0;
          if (chosen) box = chosen;
          else if (!box) return [];
        }
        const points = await placePoints(source, box);
        const next = boxFromPoints(points);
        if (!next) {
          box = null;
          return [];
        }
        box = next;
        return [toLandmarks(points, W, H, slots)];
      });
    },
    /** Waits its turn too, so a frame still being tracked finishes first. */
    close() {
      closed = true;
      inTurn(async () => {
        await poser.release?.();
        await detector.release?.();
      }).catch(() => {});
    },
  };
}
