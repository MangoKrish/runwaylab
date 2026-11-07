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
      return new CameraError('other', `The camera could not start${err?.message ? `: ${err.message}` : '.'}`);
  }
}

/** Ask for the best format a camera has. These are preferences, so a lesser camera still works. */
export const BEST_VIDEO = { width: { ideal: 1920 }, height: { ideal: 1440 }, frameRate: { ideal: 60 } };

export async function openCamera(deviceId) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new CameraError('unsupported', 'This browser cannot use a camera on this page. Cameras need https or localhost, and a recent browser.');
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), ...BEST_VIDEO },
    });
  } catch (err) {
    throw explain(err);
  }
}

/** Device names are only available after permission is granted, so call this after openCamera. */
export async function listCameras() {
  const all = await navigator.mediaDevices.enumerateDevices();
  return usableCameras(all.filter((d) => d.kind === 'videoinput').map((d, i) => ({ id: d.deviceId, label: d.label || `Camera ${i + 1}` })));
}

/** Desk View looks down at a desk through a warped picture, which is no use for measuring a person. */
export const usableCameras = (cameras) => cameras.filter((c) => !/desk view/i.test(c.label));

/** The last camera chosen here, or else an iPhone, or else whatever is first. */
export function preferredCamera(cameras, savedId) {
  return cameras.find((c) => c.id === savedId) || cameras.find((c) => /iphone/i.test(c.label)) || cameras[0] || null;
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
