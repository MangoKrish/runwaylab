// Stepping through a recorded video frame by frame, shared by the analyzer and the stills maker.

export class VideoReadError extends Error {}

export function abortError() {
  return new DOMException('Cancelled', 'AbortError');
}

/** A hidden video on the page. It must be attached, or some browsers never decode its frames. */
export async function openVideo(blob, signal) {
  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.setAttribute('aria-hidden', 'true');
  video.style.cssText = 'position:fixed;left:-9999px;top:0;width:4px;height:4px;opacity:0;pointer-events:none';
  document.body.append(video);

  const close = () => {
    video.removeAttribute('src');
    video.load();
    video.remove();
    URL.revokeObjectURL(url);
  };

  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new VideoReadError('The video took too long to open.')), 15000);
      const stop = () => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); };
      const onAbort = () => { stop(); reject(abortError()); };
      signal?.addEventListener('abort', onAbort);
      video.onloadeddata = () => { stop(); resolve(); };
      video.onerror = () => { stop(); reject(new VideoReadError('This video could not be decoded.')); };
      video.src = url;
    });
    if (!video.videoWidth || !video.videoHeight) throw new VideoReadError('This file has no video picture.');
    const duration = await realDuration(video);
    return { video, duration, width: video.videoWidth, height: video.videoHeight, close };
  } catch (err) {
    close();
    throw err;
  }
}

/** Browser-recorded WebM often reports an infinite length until you seek past its end. */
async function realDuration(video) {
  if (Number.isFinite(video.duration) && video.duration > 0) return video.duration;
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 4000);
    video.ondurationchange = () => {
      if (Number.isFinite(video.duration)) {
        clearTimeout(timer);
        video.ondurationchange = null;
        resolve();
      }
    };
    video.currentTime = 1e7;
  });
  const duration = video.duration;
  if (!Number.isFinite(duration) || duration <= 0) throw new VideoReadError('The length of this video could not be read.');
  await seekTo(video, 0);
  return duration;
}

/** Seek and wait for the frame. Resolves with that frame's real media time when the browser gives it. */
export function seekTo(video, t, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(limit);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      signal?.removeEventListener('abort', onAbort);
      fn(value);
    };
    const onAbort = () => finish(reject, abortError());
    const onError = () => finish(reject, new VideoReadError('This video could not be decoded.'));
    const onSeeked = () => {
      if (video.requestVideoFrameCallback) {
        // A hidden or background page may never deliver this callback, so do not wait long for it.
        const fallback = setTimeout(() => finish(resolve, video.currentTime), 60);
        video.requestVideoFrameCallback((_, meta) => {
          clearTimeout(fallback);
          finish(resolve, meta.mediaTime);
        });
      } else {
        finish(resolve, video.currentTime);
      }
    };
    const limit = setTimeout(() => finish(reject, new VideoReadError('The video stopped responding while being read.')), 10000);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);
    signal?.addEventListener('abort', onAbort);
    video.currentTime = t;
  });
}

/**
 * Copies the current frame to an upright canvas. Tracking reads this instead of the video, so a sideways clip
 * or a sideways camera is analyzed the right way up, and the picture cannot change while it is being read.
 * @param {number} rotation  Clockwise degrees to turn the picture: 0, 90, 180 or 270.
 */
export function makeGrabber(video, rotation = 0) {
  const sideways = rotation === 90 || rotation === 270;
  const W = sideways ? video.videoHeight : video.videoWidth;
  const H = sideways ? video.videoWidth : video.videoHeight;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { alpha: false });
  return {
    W,
    H,
    canvas,
    grab() {
      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.rotate((rotation * Math.PI) / 180);
      ctx.drawImage(video, -video.videoWidth / 2, -video.videoHeight / 2);
      ctx.restore();
      return canvas;
    },
    /** The same for a decoded frame, which also needs the turn the file asks for: a video element does that itself. */
    grabFrame(frame, fileRotation = 0) {
      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.rotate(((rotation + fileRotation) * Math.PI) / 180);
      ctx.drawImage(frame, -frame.displayWidth / 2, -frame.displayHeight / 2);
      ctx.restore();
      return canvas;
    },
  };
}
