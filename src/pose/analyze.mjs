// Real pose detection over a finished recording. It works from the recording rather than the live camera, so
// uploads and camera takes go through exactly the same path, at the same sample rate.
//
// It has three ways to read the video, tried in this order. Decoding gives every frame, with its exact time. Playing
// works on any format, but the display limits how many frames it can see. Seeking is slower still, because each seek
// decodes from the last keyframe, but it works even when the page cannot paint.
import { createTracker } from './tracker.mjs';
import { decodeFrames } from './decode.mjs';
import { openVideo, seekTo, abortError, makeGrabber } from './video.mjs';
import { TargetLock } from '../lib/target.mjs';

// Every frame of a 60 fps recording: it halves the error in step timing. Slower footage is simply used in full.
export const SAMPLE_HZ = 60;
// Playing and seeking cannot keep up with 60, and a computer too slow to track at 60 should not make someone wait.
export const FALLBACK_HZ = 30;
export const MAX_SAMPLES = 3600;
const START_RATE = 0.6;
const FASTEST_RATE = 2;
const SLOWEST_RATE = 0.25;
const LEARN_FRAMES = 24;
const STEER_EVERY = 10;

/** Keep what later steps need, at a precision well below one pixel. */
const compact = (landmarks) => landmarks.map((p) => ({
  x: Math.round(p.x * 1e5) / 1e5,
  y: Math.round(p.y * 1e5) / 1e5,
  visibility: Math.round((p.visibility ?? 0) * 100) / 100,
}));

async function bySeeking(opened, step, each, signal) {
  const total = Math.max(1, Math.floor(opened.duration / step));
  for (let i = 0; i < total; i++) {
    const shown = await seekTo(opened.video, Math.min(i * step, opened.duration - 0.001), signal);
    await each(shown, (i + 1) / total);
  }
}

/** The middle value of a list. */
const middle = (values) => [...values].sort((a, b) => a - b)[values.length >> 1];

/**
 * Play the video and analyze frames as they appear. The browser shows the newest frame and drops any it did not get
 * to, so speed has to follow what is really happening: it starts slowly to learn how far apart the frames are,
 * speeds up while none are being missed, and slows down when they are.
 * @returns false if frames stopped arriving (a hidden page, for example), so the caller can fall back to seeking.
 */
function byPlaying(opened, step, each, signal) {
  const { video, duration } = opened;
  return new Promise((resolve, reject) => {
    let rate = START_RATE;
    let finished = false;
    let lastTime = -Infinity;
    let lastFrame = -Infinity;
    let lastFrameAt = performance.now();
    let frameGap = null;
    const learning = [];
    let gaps = 0;
    let gapTotal = 0;
    const finish = (fn, value) => {
      if (finished) return;
      finished = true;
      clearInterval(watchdog);
      signal?.removeEventListener('abort', onAbort);
      video.pause();
      video.onended = null;
      video.onerror = null;
      fn(value);
    };
    const onAbort = () => finish(reject, abortError());
    signal?.addEventListener('abort', onAbort);

    /** Every so often, compare how far apart the samples are with how far apart they could be. */
    const steer = (gap) => {
      gaps++;
      gapTotal += gap;
      if (gaps < STEER_EVERY || frameGap === null) return;
      const wanted = Math.max(step, frameGap);
      const typical = gapTotal / gaps;
      gaps = 0;
      gapTotal = 0;
      if (typical > wanted * 1.2) rate = Math.max(SLOWEST_RATE, rate * 0.82);
      else if (typical < wanted * 1.06) rate = Math.min(FASTEST_RATE, rate * 1.08);
      video.playbackRate = rate;
    };

    const onFrame = async (_, meta) => {
      if (finished) return;
      lastFrameAt = performance.now();
      const sincePrevious = meta.mediaTime - lastFrame;
      lastFrame = meta.mediaTime;
      if (frameGap === null && sincePrevious > 0 && Number.isFinite(sincePrevious)) {
        learning.push(sincePrevious);
        if (learning.length >= LEARN_FRAMES) frameGap = middle(learning);
      }
      if (meta.mediaTime - lastTime >= step * 0.9) {
        const gap = meta.mediaTime - lastTime;
        lastTime = meta.mediaTime;
        try {
          await each(meta.mediaTime, Math.min(1, meta.mediaTime / duration));
        } catch (err) {
          finish(reject, err);
          return;
        }
        if (Number.isFinite(gap)) steer(gap);
      }
      video.requestVideoFrameCallback(onFrame);
    };

    const watchdog = setInterval(() => {
      if (performance.now() - lastFrameAt > 2500) finish(resolve, false);
    }, 500);
    video.onended = () => finish(resolve, true);
    video.onerror = () => finish(reject, new Error('This video could not be decoded.'));
    video.requestVideoFrameCallback(onFrame);
    video.currentTime = 0;
    video.playbackRate = rate;
    video.play().catch(() => finish(resolve, false));
  });
}

/**
 * Read every frame with the decoder, tracking up to 60 a second, or 30 if this computer cannot keep up.
 * @returns false if the frames are not the shape the video element reports, or this file cannot be decoded.
 */
async function byDecoding(blob, opened, firstStep, each, grabber, base, signal) {
  let step = firstStep;
  let typical = 0;
  let last = -Infinity;
  let matches = null;
  const finished = await decodeFrames(blob, { base, signal }, async (frame, time, fileRotation) => {
    if (matches === null) {
      const sideways = fileRotation === 90 || fileRotation === 270;
      const [width, height] = sideways ? [frame.displayHeight, frame.displayWidth] : [frame.displayWidth, frame.displayHeight];
      matches = width === opened.video.videoWidth && height === opened.video.videoHeight;
    }
    if (!matches || time - last < step * 0.9) return;
    last = time;
    const started = performance.now();
    await each(time, Math.min(1, time / opened.duration), grabber.grabFrame(frame, fileRotation));
    typical = typical ? typical * 0.9 + ((performance.now() - started) / 1000) * 0.1 : (performance.now() - started) / 1000;
    if (typical > 1 / FALLBACK_HZ) step = Math.max(step, 1 / FALLBACK_HZ);
  });
  return finished && matches === true;
}

/**
 * @returns raw samples for processFrames. Always releases the model and the video, even if cancelled.
 * The caller's copy of the recording is never touched, so a failure here loses nothing.
 */
export async function analyzeVideo(blob, { base, signal, onProgress = () => {}, hz = SAMPLE_HZ, rotation = 0, mode = 'decode' }) {
  let opened = null;
  let tracker = null;
  try {
    onProgress({ stage: 'Opening the video', done: 0 });
    opened = await openVideo(blob, signal);
    const grabber = makeGrabber(opened.video, rotation);
    const { W, H } = grabber;

    onProgress({ stage: 'Loading the pose tracker', done: 0 });
    tracker = await createTracker(base);
    if (signal?.aborted) throw abortError();

    const step = Math.max(1 / hz, opened.duration / MAX_SAMPLES);
    let lock = new TargetLock();
    let raw = [];
    let lastMs = -1;
    const each = async (time, done, source = grabber.grab()) => {
      if (signal?.aborted) throw abortError();
      // Imprecise seeks can land on the same frame twice; measuring it twice would double-count it.
      if (raw.length && time <= raw.at(-1).t) return;
      const ms = Math.max(lastMs + 1, Math.round(time * 1000));
      lastMs = ms;
      const person = lock.update(await tracker.detect(source, ms), time, W, H);
      raw.push({ t: Math.round(time * 1000) / 1000, landmarks: person ? compact(person) : null });
      onProgress({ stage: 'Tracking the walk', done });
    };
    const startOver = () => {
      lock = new TargetLock();
      raw = [];
    };

    // The first frame also compiles the model on the GPU, which is far slower than any other. It should not count.
    await tracker.detect(grabber.grab(), ++lastMs);
    if (signal?.aborted) throw abortError();

    const slower = Math.max(step, 1 / Math.min(hz, FALLBACK_HZ));
    let reader = null;
    if (mode === 'decode') {
      try {
        if (await byDecoding(blob, opened, step, each, grabber, base, signal)) reader = 'decoded';
      } catch (err) {
        if (err?.name === 'AbortError') throw err;
      }
      if (!reader) startOver();
    }
    if (!reader && mode !== 'seek' && opened.video.requestVideoFrameCallback) {
      if (await byPlaying(opened, slower, each, signal)) reader = 'played';
      else startOver();
    }
    if (!reader) {
      await bySeeking(opened, slower, each, signal);
      reader = 'seeked';
    }
    return { raw, W, H, duration: opened.duration, delegate: tracker.delegate, tracker: tracker.model, reader };
  } finally {
    tracker?.close();
    opened?.close();
  }
}
