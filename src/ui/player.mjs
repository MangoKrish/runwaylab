// Playback, with the skeleton drawn into the same picture. Everything is painted on one canvas, so the
// skeleton can never slip out of line with the video, and a sideways recording can be shown upright.
// With no video, it plays the skeleton alone on a dark stage: the wall's replays and the labeled sample.
import { h, fmtTime, reducedMotion } from './dom.mjs';
import { drawSkeleton } from './overlay.mjs';
import { poseAt } from '../lib/process.mjs';

const STAGE = '#141210';
const FLOOR = '#26221F';
const MAX_CANVAS = 1600;

export function createPlayer({ blob = null, analysis = null, rotation = 0, badge = null, label = 'Walk replay' }) {
  const canvas = h('canvas', { class: 'rw-player__canvas', role: 'img', 'aria-label': label });
  const ctx = canvas.getContext('2d', { alpha: false });
  const video = blob ? h('video', { class: 'rw-player__video', playsinline: true, muted: true, preload: 'auto', 'aria-hidden': 'true', tabindex: '-1' }) : null;
  const url = blob ? URL.createObjectURL(blob) : null;
  if (video) video.src = url;

  const message = h('p', { class: 'rw-player__message', hidden: true });
  const stage = h('div', { class: 'rw-player' }, video, canvas, badge ? h('p', { class: 'rw-player__badge' }, badge) : null, message);

  const toggle = h('button', { type: 'button', class: 'rw-btn rw-btn--small', 'aria-label': 'Play' }, 'Play');
  const range = h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: 0, 'aria-label': 'Position in the walk' });
  const time = h('span', { class: 'rw-player__time' }, '0:00');
  const speed = h('button', { type: 'button', class: 'rw-btn rw-btn--small', 'aria-label': 'Playback speed' }, '1×');
  const skeletonBox = h('input', { type: 'checkbox', checked: true });
  const controls = h('div', { class: 'rw-player__controls' },
    toggle, range, time, speed,
    h('label', { class: 'rw-check rw-check--plain' }, skeletonBox, h('span', null, 'Skeleton')));
  const el = h('div', { class: 'rw-playerbox' }, stage, controls);

  let current = analysis;
  let turn = rotation;
  let showSkeleton = true;
  let alive = true;
  let virtualTime = 0;
  let virtualPlaying = false;
  let lastTick = null;
  let rate = 1;
  let dirty = true;

  const sideways = () => turn === 90 || turn === 270;
  const naturalSize = () => {
    if (video?.videoWidth) return sideways() ? [video.videoHeight, video.videoWidth] : [video.videoWidth, video.videoHeight];
    if (current) return [current.W, current.H];
    return [16, 9];
  };

  function fit() {
    const [w, h2] = naturalSize();
    const scale = Math.min(1, MAX_CANVAS / Math.max(w, h2));
    const width = Math.round(w * scale);
    const height = Math.round(h2 * scale);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    el.style.setProperty('--ar', String(w / h2));
    el.dataset.shape = h2 > w ? 'portrait' : 'landscape';
  }

  const duration = () => {
    if (video && Number.isFinite(video.duration) && video.duration > 0) return video.duration;
    return current?.duration ?? 0;
  };
  const now = () => (video ? video.currentTime : virtualTime);
  const isPlaying = () => (video ? !video.paused && !video.ended : virtualPlaying);

  function paint() {
    fit();
    const { width, height } = canvas;
    ctx.fillStyle = STAGE;
    ctx.fillRect(0, 0, width, height);
    if (video?.videoWidth) {
      ctx.save();
      ctx.translate(width / 2, height / 2);
      ctx.rotate((turn * Math.PI) / 180);
      const [w, h2] = sideways() ? [height, width] : [width, height];
      ctx.drawImage(video, -w / 2, -h2 / 2, w, h2);
      ctx.restore();
    } else if (!video) {
      // A vanishing runway, so a change in size reads as walking toward you.
      ctx.fillStyle = FLOOR;
      ctx.beginPath();
      ctx.moveTo(width * 0.46, height * 0.42);
      ctx.lineTo(width * 0.54, height * 0.42);
      ctx.lineTo(width * 0.92, height);
      ctx.lineTo(width * 0.08, height);
      ctx.fill();
    }
    if (showSkeleton && current) {
      const pts = poseAt(current.frames, now());
      if (pts) drawSkeleton(ctx, pts, width / current.W, { lineWidth: Math.max(3, width / 300) });
    }
    const total = duration();
    range.max = total || 1;
    if (document.activeElement !== range || isPlaying()) range.value = now();
    time.textContent = `${fmtTime(now())} / ${fmtTime(total)}`;
    const label2 = isPlaying() ? 'Pause' : 'Play';
    if (toggle.textContent !== label2) {
      toggle.textContent = label2;
      toggle.setAttribute('aria-label', label2);
    }
    dirty = false;
  }

  const tick = (nowMs) => {
    if (!alive) return;
    if (virtualPlaying && lastTick !== null) {
      virtualTime += ((nowMs - lastTick) / 1000) * rate;
      if (virtualTime >= duration()) virtualTime = 0;
    }
    lastTick = nowMs;
    if (dirty || isPlaying()) paint();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  const markDirty = () => { dirty = true; };
  toggle.addEventListener('click', () => {
    if (video) {
      if (video.paused) video.play().catch(() => {});
      else video.pause();
    } else {
      virtualPlaying = !virtualPlaying;
    }
    markDirty();
  });
  range.addEventListener('input', () => {
    const t = Number(range.value);
    if (video) video.currentTime = t;
    else virtualTime = t;
    markDirty();
  });
  speed.addEventListener('click', () => {
    rate = rate === 1 ? 0.5 : rate === 0.5 ? 0.25 : 1;
    speed.textContent = rate === 1 ? '1×' : rate === 0.5 ? '½×' : '¼×';
    if (video) video.playbackRate = rate;
  });
  skeletonBox.addEventListener('change', () => {
    showSkeleton = skeletonBox.checked;
    markDirty();
  });
  if (video) {
    for (const event of ['loadedmetadata', 'loadeddata', 'seeked', 'pause', 'play', 'ended', 'durationchange']) video.addEventListener(event, markDirty);
    video.addEventListener('error', () => {
      message.textContent = 'This browser could not play this video. Its measurements are still below.';
      message.hidden = false;
    });
  } else if (!reducedMotion()) {
    virtualPlaying = true;
  }

  return {
    el,
    seek(t) {
      if (video) {
        video.pause();
        video.currentTime = t;
      } else {
        virtualPlaying = false;
        virtualTime = t;
      }
      markDirty();
    },
    setAnalysis(a) {
      current = a;
      markDirty();
    },
    setRotation(degrees) {
      turn = degrees;
      markDirty();
    },
    destroy() {
      alive = false;
      if (video) {
        video.pause();
        video.removeAttribute('src');
        video.load();
        URL.revokeObjectURL(url);
      }
    },
  };
}
