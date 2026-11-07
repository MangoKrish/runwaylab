// Everything that touches the camera directly. Any webcam the browser exposes works. An iPhone appears as an
// ordinary device through Continuity Camera, and an iPhone 17 Pro offers up to 1920 by 1440 at 60 frames a
// second. That 4:3 shape is taller than widescreen, so it fits a whole person in frame from closer.

export class CameraError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

function explain(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return new CameraError('denied', 'Camera access is blocked. Allow the camera for this site in your browser settings, then try again.');
    case 'NotFoundError':
    case 'OverconstrainedError':
      return new CameraError('none', 'No camera was found. Connect one and try again, or upload a clip instead.');
    case 'NotReadableError':
    case 'AbortError':
      return new CameraError('busy', 'The camera is in use by another app, or would not start. Close other video apps and try again.');
    default:
      return new CameraError('other', `The camera could not start (${err?.name || 'unknown error'}${err?.message ? `: ${err.message}` : ''}).`);
  }
}

/**
 * First choice: at least 50 frames a second, at up to 1080p. Smooth frames time each step more precisely and blur
 * the feet less, and the tracker only needs about 256 pixels of the body, so speed beats resolution here. Asked as
 * "ideal", a camera that cannot do both picks resolution and drops to 24 or 30, so the minimum is what makes it count.
 */
export const SMOOTH_VIDEO = { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { min: 50, ideal: 60 } };
/** Fallback for cameras with no 50 fps mode. These are preferences, so a lesser camera still works. */
export const BEST_VIDEO = { width: { ideal: 1920 }, height: { ideal: 1440 }, frameRate: { ideal: 60 } };

export async function openCamera(deviceId) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new CameraError('unsupported', 'This browser cannot use a camera on this page. Cameras need https or localhost, and a recent browser.');
  }
  const ask = (format) => navigator.mediaDevices.getUserMedia({ audio: false, video: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), ...format } });
  // Fastest first, then the best picture, then whatever the camera gives. Phones and Safari often refuse the
  // 50 fps minimum, and do not always say which constraint failed, so any refused format moves on to the next.
  const formats = isPhone() ? [BEST_VIDEO, {}] : [SMOOTH_VIDEO, BEST_VIDEO, {}];
  let last = null;
  for (const [i, format] of formats.entries()) {
    try {
      // A camera can sit silent on a mode it cannot do instead of refusing it. Every format but the last gets
      // 10 seconds (Continuity Camera needs a few to wake the iPhone), and a stream that turns up late is stopped.
      return i === formats.length - 1 ? await ask(format) : await withTimeout(ask(format), 10_000);
    } catch (err) {
      last = err;
      // A refused permission or a missing camera is a real answer. A camera that would not start in one mode (the
      // iPhone through Continuity Camera can do this) gets the next, gentler format.
      if (!['OverconstrainedError', 'ConstraintNotSatisfiedError', 'TypeError', 'NotReadableError', 'AbortError'].includes(err?.name)) break;
    }
  }
  throw explain(last);
}

function withTimeout(asking, ms) {
  let timer;
  const late = new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('The camera did not answer.'), { name: 'AbortError' })), ms); });
  return Promise.race([asking, late]).then((stream) => { clearTimeout(timer); return stream; }, (err) => {
    clearTimeout(timer);
    if (err?.name === 'AbortError' && err.message === 'The camera did not answer.') asking.then(stopStream, () => {});
    throw err;
  });
}

/** A phone or tablet: their browsers handle frame-rate minimums badly, so they skip straight to preferences. */
export const isPhone = () => /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));

/** Device names are only available after permission is granted, so call this after openCamera. */
export async function listCameras() {
  const all = await navigator.mediaDevices.enumerateDevices();
  return usableCameras(all.filter((d) => d.kind === 'videoinput').map((d, i) => ({ id: d.deviceId, label: d.label || `Camera ${i + 1}` })));
}

/** Desk View looks down at a desk through a warped picture, which is no use for measuring a person. */
export const usableCameras = (cameras) => cameras.filter((c) => !/desk view/i.test(c.label));

export const isIphone = (camera) => /iphone/i.test(camera?.label || '');

/**
 * An iPhone whenever one is connected (the last one chosen, if there are several), since it films sharper and
 * smoother than a laptop camera. Otherwise the last camera chosen here, or whatever is first. A laptop camera
 * picked once is not remembered over an iPhone that turns up later; it can still be picked for one session.
 */
export function preferredCamera(cameras, savedId) {
  const saved = cameras.find((c) => c.id === savedId);
  const iphones = cameras.filter(isIphone);
  if (iphones.length) return iphones.find((c) => c.id === savedId) || iphones[0];
  return saved || cameras[0] || null;
}

export function stopStream(stream) {
  stream?.getTracks().forEach((track) => track.stop());
}

/** What the device says it is doing. Often differs from what actually arrives, so show both. */
export function streamFormat(stream) {
  const settings = stream?.getVideoTracks()[0]?.getSettings() ?? {};
  return { width: settings.width ?? null, height: settings.height ?? null, frameRate: settings.frameRate ?? null };
}

/** Frames that actually reached the page, measured over a rolling second. */
export class FpsMeter {
  constructor() {
    this.windowStart = null;
    this.count = 0;
    this.value = null;
  }

  tick(nowMs) {
    if (this.windowStart === null) this.windowStart = nowMs;
    this.count++;
    const elapsed = nowMs - this.windowStart;
    if (elapsed >= 1000) {
      this.value = (this.count * 1000) / elapsed;
      this.windowStart = nowMs;
      this.count = 0;
    }
    return this.value;
  }
}

// High-profile H.264 first, because 1920 by 1440 at 60 frames a second is beyond what simpler profiles allow.
const RECORDING_TYPES = ['video/mp4;codecs=avc1.640033', 'video/mp4;codecs=avc3.640033', 'video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];

export function pickRecordingType() {
  if (typeof MediaRecorder === 'undefined') return null;
  return RECORDING_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? null;
}

/** Enough bits to keep fast movement sharp at this size and speed. */
export function recordingBitrate({ width, height, frameRate }) {
  const pixelsPerSecond = (width || 1280) * (height || 720) * (frameRate || 30);
  return Math.round(Math.min(24_000_000, Math.max(4_000_000, pixelsPerSecond * 0.09)));
}

/** Start recording a stream. stop() resolves with the finished Blob. */
export function startRecording(stream) {
  if (typeof MediaRecorder === 'undefined') throw new CameraError('codec', 'This browser cannot record video. Record elsewhere and upload the clip instead.');
  const bitrate = recordingBitrate(streamFormat(stream));
  let recorder = null;
  let mimeType = null;
  for (const type of RECORDING_TYPES) {
    if (!MediaRecorder.isTypeSupported(type)) continue;
    try {
      recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: bitrate });
      mimeType = type;
      break;
    } catch {
      // A browser can claim to support a format and still refuse it. Try the next one.
    }
  }
  if (!recorder) throw new CameraError('codec', 'This browser cannot record video. Record elsewhere and upload the clip instead.');
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
  const finished = new Promise((resolve, reject) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType.split(';')[0] }));
    recorder.onerror = (e) => reject(e.error || new Error('Recording failed.'));
  });
  recorder.start(1000);
  return {
    mimeType,
    bitrate,
    stop() {
      if (recorder.state !== 'inactive') recorder.stop();
      return finished;
    },
    discard() {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
      if (recorder.state !== 'inactive') recorder.stop();
    },
  };
}
