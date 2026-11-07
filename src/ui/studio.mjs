// The recording studio. Phases: off, asking, live, countdown, recording, stopping, take, problem.
// The picture is painted on one canvas, so it can be mirrored and turned the right way up, with the skeleton
// always in line. The recording itself stays exactly as the camera sent it.
import { h, add, button, clear, fmtTime, liveRegion } from './dom.mjs';
import { drawSkeleton } from './overlay.mjs';
import { createPlayer } from './player.mjs';
import { openCamera, listCameras, preferredCamera, stopStream, streamFormat, FpsMeter, startRecording, pickRecordingType } from '../capture/camera.mjs';
import { checkUpload } from '../capture/upload.mjs';
import { createTracker } from '../pose/tracker.mjs';
import { makeGrabber } from '../pose/video.mjs';
import { TargetLock } from '../lib/target.mjs';
import { classifyPose, framingAdvice, torsoSize } from '../lib/frames.mjs';
import { LapCounter } from '../lib/phases.mjs';
import { judgeStatus } from '../judge/client.mjs';
import { createMusic } from './music.mjs';

const MAX_SECONDS = 90;
const CALIBRATE_MS = 1500;
const SAVED_LAPS = 'rw-laps';
const READY_HOLD_SECONDS = 1;
const TRACK_EVERY_MS = 30;
const SAVED_CAMERA = 'rw-camera';
const SAVED_ROTATION = 'rw-rotation';

const remember = (key, value) => { try { localStorage.setItem(key, value); } catch { /* Private browsing. */ } };
const recall = (key) => { try { return localStorage.getItem(key); } catch { return null; } };

const WALK_MESSAGES = {
  start: 'Walk toward the camera',
  approach: 'Keep coming',
  turn: 'Now turn',
  back: 'Walk back to your mark',
  done: 'That is the walk',
};

export function studioScreen(root, app) {
  const s = {
    phase: 'off', stream: null, cameras: [], deviceId: '', tracker: null, trackerFailed: false,
    lock: new TargetLock(), laps: null, recording: null, startedAt: 0, ticker: null,
    fullSince: null, handsFree: true, consent: false, judge: null, take: null, takePlayer: null,
    meter: new FpsMeter(), lastMs: 0, alive: true, cameraLabel: '', generation: 0, frameHandle: null,
    rotation: Number(recall(SAVED_ROTATION)) || 0, lapsWanted: Number(recall(SAVED_LAPS)) || 3, calibrateUntil: 0, grabber: null, tracking: false, lastTrack: 0, frame: null,
    lastGoodPts: null, turnNow: false,
  };

  const music = createMusic(app.base);

  // ── stage ──
  const video = h('video', { class: 'rw-stage__video', playsinline: true, muted: true, autoplay: true, 'aria-hidden': 'true' });
  const canvas = h('canvas', { class: 'rw-stage__canvas', role: 'img', 'aria-label': 'Live camera view' });
  const ctx = canvas.getContext('2d', { alpha: false });
  const prompt = h('p', { class: 'rw-stage__prompt' }, 'Your camera is off');
  const count = h('p', { class: 'rw-stage__count', 'aria-hidden': 'true', hidden: true });
  const timer = h('p', { class: 'rw-stage__timer', hidden: true });
  const stage = h('div', { class: 'rw-stage' }, video, canvas, timer, count, prompt);
  const takeSlot = h('div', { class: 'rw-takeslot', hidden: true });
  const announce = liveRegion('rw-sr');
  // Where they are in the whole sequence, so nobody has to guess what happens after "hold still".
  const flow = h('ol', { class: 'rw-flow', 'aria-label': 'Your walk, step by step' });
  let flowKey = '';

  // ── controls ──
  const primary = h('div', { class: 'rw-actions rw-actions--center' });
  const problem = h('p', { class: 'rw-error', role: 'alert', hidden: true });
  const cameraSelect = h('select', { disabled: true, 'aria-label': 'Camera', onChange: (e) => switchCamera(e.target.value) });
  const fpsLine = h('dl', { class: 'rw-fps' });
  const modelLine = h('p', { class: 'rw-muted rw-small' });
  const consentBox = h('div');
  const lapSelect = h('select', { id: 'rw-laps', onChange: (e) => { s.lapsWanted = Number(e.target.value); remember(SAVED_LAPS, e.target.value); renderFlow('frame'); } },
    [3, 2].map((n) => h('option', { value: n, selected: n === s.lapsWanted }, `${n} walks`)));
  const handsFreeBox = h('input', { type: 'checkbox', checked: true, onChange: (e) => { s.handsFree = e.target.checked; s.fullSince = null; renderControls(); } });
  const rotateButton = button('Rotate picture', () => {
    s.rotation = (s.rotation + 90) % 360;
    remember(SAVED_ROTATION, String(s.rotation));
    fitStage();
  }, { kind: 'small' });
  const uploadInput = h('input', { type: 'file', accept: 'video/mp4,video/webm,video/quicktime,.mp4,.m4v,.mov,.webm', class: 'rw-upload__input', id: 'rw-upload', onChange: onUpload });
  const uploadStatus = h('p', { class: 'rw-muted rw-small', role: 'status' });

  root.append(
    h('h1', { class: 'rw-sr', tabindex: '-1' }, 'Walk studio'),
    h('div', { class: 'rw-studio' },
      stage,
      takeSlot,
      flow,
      announce,
      primary,
      problem,
      h('div', { class: 'rw-studio__options' },
        h('div', { class: 'rw-stack' },
          h('label', { class: 'rw-check' }, handsFreeBox, h('span', null, h('strong', null, 'Hands-free. '), 'Starts when a whole person is in frame, and stops after the last walk.')),
          h('label', { class: 'rw-field rw-field--inline' }, h('span', null, 'Score me on'), lapSelect),
          h('p', { class: 'rw-muted rw-small' }, 'You stand tall for a moment so we can calibrate to you, then walk up and back this many times. One stumble will not sink your score.')),
        consentBox),
      h('div', { class: 'rw-studio__panels' },
        h('section', { class: 'rw-panel' },
          h('h2', null, 'Set up the runway'),
          h('ol', { class: 'rw-checklist' },
            h('li', null, 'Put your iPhone on a stand, sideways (landscape), at about hip height. Sideways gives the widest view.'),
            h('li', null, 'Mark your turning spot about 2.5 m from the phone, then check your head and feet both fit when you stand there. Start as far back as you have room for.'),
            h('li', null, 'Light the walker from the front. A bright window behind them hides their pose.'),
            h('li', null, 'Turn off Center Stage (Mac menu bar, Video Effects). It moves the picture, which breaks the measurements.'),
            h('li', null, 'Keep everyone else out of the lane.'))),
        h('section', { class: 'rw-panel' },
          h('h2', null, 'Camera'),
          h('label', { class: 'rw-field' }, h('span', null, 'Which camera'), cameraSelect),
          fpsLine,
          modelLine,
          h('div', { class: 'rw-actions' }, rotateButton),
          h('p', { class: 'rw-muted rw-small' }, 'Picture sideways or upside down? Rotate it. Tracking and the recording follow.')),
        music.el,
        h('section', { class: 'rw-panel' },
          h('h2', null, 'Or upload a clip'),
          h('p', { class: 'rw-muted rw-small' }, 'An MP4, MOV or WebM of a walk toward the camera and back, up to 2 minutes and 500 MB. It stays on this device.'),
          h('label', { class: 'rw-btn', for: 'rw-upload' }, 'Choose a video'),
          uploadInput,
          uploadStatus))),
  );

  // ── phase and controls ──
  function setPhase(phase) {
    s.phase = phase;
    const showingTake = phase === 'take';
    stage.hidden = showingTake;
    takeSlot.hidden = !showingTake;
    timer.hidden = phase !== 'recording';
    count.hidden = phase !== 'countdown';
    stage.dataset.phase = phase;
    if (phase === 'countdown') renderFlow('still');
    else if (phase === 'stopping' || phase === 'take') renderFlow('done');
    else if (phase !== 'recording') renderFlow('frame');
    renderControls();
  }

  /** @param {string} current  frame, still, walk1 to walkN, or done. */
  function renderFlow(current, force = false) {
    const walks = s.phase === 'recording' && s.laps ? s.laps.target : s.lapsWanted;
    const key = `${current}/${walks}`;
    if (key === flowKey && !force) return;
    flowKey = key;
    const steps = [['frame', 'Get in frame'], ['still', 'Stand tall'], ...Array.from({ length: walks }, (_, i) => [`walk${i + 1}`, `Walk ${i + 1}`]), ['done', 'Your score']];
    const at = steps.findIndex(([k]) => k === current);
    clear(flow).append(...steps.map(([k, label], i) => h('li', {
      class: i < at ? 'is-done' : null,
      'aria-current': i === at ? 'step' : null,
    }, h('span', { class: 'rw-flow__dot', 'aria-hidden': 'true' }, i < at ? '✓' : String(i + 1)), h('span', null, label, i < at ? h('span', { class: 'rw-sr' }, ', done') : null))));
  }

  function renderControls() {
    clear(primary);
    switch (s.phase) {
      case 'off':
      case 'problem':
        primary.append(button(s.phase === 'off' ? 'Turn on camera' : 'Try the camera again', () => turnOn(), { kind: 'solid', class: 'rw-btn rw-btn--solid rw-btn--big' }));
        break;
      case 'live':
        if (!s.handsFree) primary.append(button('Start, with a 3 second countdown', () => beginCountdown(), { kind: 'solid', class: 'rw-btn rw-btn--solid rw-btn--big' }));
        else primary.append(h('p', { class: 'rw-muted' }, s.tracker ? 'Waiting for someone to stand in frame.' : s.trackerFailed ? 'Tracking is not running, so hands-free cannot start. Turn it off to record by hand.' : 'Loading the pose tracker.'));
        break;
      case 'countdown':
        primary.append(button('Cancel', cancelCountdown, { class: 'rw-btn rw-btn--big' }));
        break;
      case 'recording':
        primary.append(button('Stop recording', () => stopTake(false), { kind: 'solid', class: 'rw-btn rw-btn--solid rw-btn--big' }));
        break;
      case 'take':
        primary.append(
          button('Use this walk', useTake, { kind: 'solid', class: 'rw-btn rw-btn--solid rw-btn--big' }),
          button('Retake', retake, { class: 'rw-btn rw-btn--big' }));
        break;
      default:
    }
    renderConsent();
  }

  function renderConsent() {
    clear(consentBox);
    if (!s.judge) return;
    if (!s.judge.ready) {
      consentBox.append(h('p', { class: 'rw-muted rw-small' }, 'Gemini is not connected right now, so walks get their measured 70 points only.'));
      return;
    }
    consentBox.append(h('label', { class: 'rw-check' },
      h('input', { type: 'checkbox', checked: s.consent, onChange: (e) => { s.consent = e.target.checked; } }),
      h('span', null,
        h('strong', null, 'Judge my walk. '),
        'I am 18 or older, and I agree that about 12 cropped stills with my face pixelated go to Google\'s Gemini.',
        s.judge.paidTier ? '' : ' Google may use them to improve its products.')));
  }

  function setProblem(message) {
    problem.textContent = message || '';
    problem.hidden = !message;
  }

  function renderFps() {
    clear(fpsLine);
    const f = streamFormat(s.stream);
    fpsLine.append(
      h('div', null, h('dt', null, 'Picture'), h('dd', null, f.width ? `${f.width} × ${f.height}` : 'Not given')),
      h('div', null, h('dt', null, 'Camera reports'), h('dd', null, f.frameRate ? `${Math.round(f.frameRate * 10) / 10} fps` : 'Not given')),
      h('div', null, h('dt', null, 'Measured here'), h('dd', null, s.meter.value ? `${s.meter.value.toFixed(1)} fps` : 'Measuring')));
  }

  function fitStage() {
    if (!video.videoWidth) return;
    s.grabber = makeGrabber(video, s.rotation);
    canvas.width = s.grabber.W;
    canvas.height = s.grabber.H;
    stage.style.setProperty('--ar', String(s.grabber.W / s.grabber.H));
    stage.dataset.shape = s.grabber.H > s.grabber.W ? 'portrait' : 'landscape';
    s.lock.reset();
  }

  // ── camera ──
  function fillCameraList() {
    clear(cameraSelect).append(...s.cameras.map((cam) => h('option', { value: cam.id, selected: cam.id === s.deviceId }, cam.label)));
    cameraSelect.disabled = s.cameras.length < 2;
  }

  async function turnOn(deviceId) {
    const generation = ++s.generation;
    setProblem('');
    prompt.textContent = 'Waiting for camera permission';
    setPhase('asking');
    try {
      let stream = await openCamera(deviceId || recall(SAVED_CAMERA) || undefined).catch(async (err) => {
        // A remembered camera may be gone. Try any camera before giving up.
        if (!deviceId && recall(SAVED_CAMERA)) return openCamera();
        throw err;
      });
      if (!s.alive || generation !== s.generation) {
        stopStream(stream);
        return;
      }
      s.cameras = await listCameras();
      // Device names only appear after permission, so the iPhone can only be chosen now.
      if (!deviceId) {
        const best = preferredCamera(s.cameras, recall(SAVED_CAMERA));
        const using = stream.getVideoTracks()[0]?.getSettings().deviceId;
        if (best && best.id !== using) {
          stopStream(stream);
          stream = await openCamera(best.id);
          if (!s.alive || generation !== s.generation) {
            stopStream(stream);
            return;
          }
        }
      }
      s.stream = stream;
      video.srcObject = stream;
      await video.play().catch(() => {});
      s.meter = new FpsMeter();
      s.deviceId = stream.getVideoTracks()[0]?.getSettings().deviceId || deviceId || '';
      s.cameraLabel = stream.getVideoTracks()[0]?.label || '';
      fillCameraList();
      fitStage();
      stream.getVideoTracks()[0]?.addEventListener('ended', async () => {
        if (!s.alive || generation !== s.generation) return;
        // Keep whatever was recorded. Often enough walks are already in it.
        if (s.phase === 'recording') {
          setProblem('The camera disconnected, so the recording stopped. Your walk so far is kept below.');
          await stopTake(false);
          releaseCamera();
          return;
        }
        releaseCamera();
        prompt.textContent = 'Your camera is off';
        setProblem('The camera disconnected. Reconnect it and try again. An iPhone must stay nearby and locked.');
        setPhase('problem');
      });
      if (!pickRecordingType()) setProblem('This browser cannot record video. You can still upload a clip.');
      renderFps();
      prompt.textContent = 'Stand on your start mark';
      s.fullSince = null;
      setPhase('live');
      startFrameLoop();
      loadTracker();
    } catch (err) {
      if (!s.alive || generation !== s.generation) return;
      prompt.textContent = 'Your camera is off';
      setProblem(err.message);
      setPhase('problem');
    }
  }

  function releaseCamera() {
    if (s.frameHandle !== null && video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(s.frameHandle);
    s.frameHandle = null;
    stopStream(s.stream);
    s.stream = null;
    video.srcObject = null;
  }

  async function switchCamera(deviceId) {
    if (s.phase === 'recording') return;
    remember(SAVED_CAMERA, deviceId);
    s.generation++;
    clearInterval(s.ticker);
    releaseCamera();
    s.lock.reset();
    await turnOn(deviceId);
  }

  async function loadTracker() {
    if (s.tracker || s.trackerFailed) return;
    modelLine.textContent = 'Loading the pose tracker.';
    try {
      const tracker = await createTracker(app.base);
      if (!s.alive) {
        tracker.close();
        return;
      }
      s.tracker = tracker;
      modelLine.textContent = `Tracking with ${tracker.model} on the ${tracker.delegate}.`;
      renderControls();
    } catch (err) {
      console.error(err);
      s.trackerFailed = true;
      modelLine.textContent = 'Tracking could not start here. You can still record by hand.';
      renderControls();
    }
  }

  // ── the live frame loop ──
  function startFrameLoop() {
    const stream = s.stream;
    let lastFpsPaint = 0;
    const step = (nowMs) => {
      if (!s.alive || s.stream !== stream) return;
      s.meter.tick(nowMs);
      if (nowMs - lastFpsPaint > 1000) {
        renderFps();
        lastFpsPaint = nowMs;
      }
      if (s.phase !== 'take') {
        paint();
        track(nowMs);
      }
      schedule();
    };
    const schedule = () => {
      if (video.requestVideoFrameCallback) s.frameHandle = video.requestVideoFrameCallback((now) => step(now));
      else requestAnimationFrame(step);
    };
    schedule();
  }

  function paint() {
    if (!s.grabber || !video.videoWidth) return;
    const { W, H } = s.grabber;
    ctx.save();
    // A mirror feels natural to someone walking toward a screen. The recording is not mirrored.
    ctx.translate(W, 0);
    ctx.scale(-1, 1);
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate((s.rotation * Math.PI) / 180);
    ctx.drawImage(video, -video.videoWidth / 2, -video.videoHeight / 2);
    ctx.restore();
    if (s.frame?.pts) drawSkeleton(ctx, s.frame.pts, 1, { lineWidth: Math.max(3, W / 300) });
    ctx.restore();
  }

  function track(nowMs) {
    if (!s.tracker || !s.grabber || s.tracking || nowMs - s.lastTrack < TRACK_EVERY_MS) return;
    s.tracking = true;
    s.lastTrack = nowMs;
    const { W, H } = s.grabber;
    const ms = Math.max(s.lastMs + 1, Math.round(nowMs));
    s.lastMs = ms;
    const t = nowMs / 1000;
    const picture = s.grabber.grab();
    Promise.resolve(s.tracker.detect(picture, ms))
      .then((poses) => {
        if (!s.alive) return;
        s.frame = classifyPose(s.lock.update(poses, t, W, H), W, H);
        react(s.frame, t, H);
      })
      .catch((err) => console.error(err))
      .finally(() => { s.tracking = false; });
  }

  function react(frame, t, H) {
    const advice = framingAdvice(frame.pts, H);
    if (s.phase === 'live') {
      if (!frame.pts) {
        prompt.textContent = 'Stand on your start mark';
        s.fullSince = null;
      } else if (!frame.full) {
        prompt.textContent = 'Step back until your head and feet are in frame';
        s.fullSince = null;
      } else {
        if (s.fullSince === null) s.fullSince = t;
        prompt.textContent = s.handsFree ? 'Hold still' : 'You are in frame';
        if (s.handsFree && t - s.fullSince >= READY_HOLD_SECONDS) beginCountdown();
      }
    } else if (s.phase === 'recording') {
      const calibrating = performance.now() < s.calibrateUntil;
      const phase = s.laps.update(t, torsoSize(frame.pts));
      // Tell them to turn before the picture cuts them off, which is when tracking starts to suffer.
      const tooClose = !calibrating && (phase === 'approach' || phase === 'start') && (advice === 'near-limit' || advice === 'feet-out' || advice === 'head-out');
      let message;
      if (calibrating) message = 'Stand tall and hold still';
      else if (tooClose) message = 'Stop and turn here';
      else if (phase === 'done') message = WALK_MESSAGES.done;
      else message = `Walk ${s.laps.lap} of ${s.laps.target}: ${WALK_MESSAGES[phase].toLowerCase()}`;
      renderFlow(calibrating ? 'still' : phase === 'done' ? 'done' : `walk${Math.min(s.laps.lap, s.laps.target)}`);
      stage.dataset.urgent = tooClose ? 'true' : 'false';
      if (prompt.textContent !== message) {
        prompt.textContent = message;
        announce.textContent = message;
      }
      if (phase === 'done' && s.handsFree) stopTake(true);
    }
  }

  // ── recording ──
  function beginCountdown() {
    if (s.phase !== 'live' || !pickRecordingType()) return;
    let left = 3;
    count.textContent = String(left);
    prompt.textContent = 'Get ready';
    announce.textContent = 'Recording starts in 3 seconds';
    setPhase('countdown');
    clearInterval(s.ticker);
    s.ticker = setInterval(() => {
      left -= 1;
      if (left > 0) {
        count.textContent = String(left);
      } else {
        clearInterval(s.ticker);
        beginRecording();
      }
    }, 1000);
  }

  function cancelCountdown() {
    clearInterval(s.ticker);
    s.fullSince = null;
    // Stay out of hands-free's way until the person chooses it again.
    s.handsFree = false;
    handsFreeBox.checked = false;
    prompt.textContent = 'Stand on your start mark';
    setPhase('live');
  }

  function beginRecording() {
    try {
      s.recording = startRecording(s.stream);
    } catch (err) {
      setProblem(err.message);
      setPhase('live');
      return;
    }
    // It starts counting straight away, so a walker who sets off early is still followed.
    s.laps = new LapCounter(s.lapsWanted);
    s.startedAt = performance.now();
    s.calibrateUntil = s.startedAt + CALIBRATE_MS;
    prompt.textContent = 'Stand tall and hold still';
    music.play();
    timer.textContent = `0:00 / ${fmtTime(MAX_SECONDS)}`;
    setPhase('recording');
    s.ticker = setInterval(() => {
      const elapsed = (performance.now() - s.startedAt) / 1000;
      timer.textContent = `${fmtTime(elapsed)} / ${fmtTime(MAX_SECONDS)}`;
      if (elapsed >= MAX_SECONDS) stopTake(false);
    }, 200);
  }

  async function stopTake(automatic) {
    if (s.phase !== 'recording') return;
    clearInterval(s.ticker);
    const seconds = (performance.now() - s.startedAt) / 1000;
    const recording = s.recording;
    s.recording = null;
    music.fadeOut();
    s.phase = 'stopping';
    stage.dataset.phase = 'stopping';
    stage.dataset.urgent = 'false';
    prompt.textContent = 'Finishing the recording';
    try {
      const blob = await recording.stop();
      if (!s.alive) return;
      if (!blob.size) throw new Error('The recording came out empty. Try again.');
      const format = streamFormat(s.stream);
      s.take = { blob, seconds, measuredFps: s.meter.value, format, mimeType: recording.mimeType };
      if (automatic) {
        useTake();
        return;
      }
      s.takePlayer = createPlayer({ blob, rotation: s.rotation, label: 'Your take' });
      clear(takeSlot).append(s.takePlayer.el);
      setPhase('take');
    } catch (err) {
      if (!s.alive) return;
      setProblem(err.message);
      prompt.textContent = 'Stand on your start mark';
      setPhase('live');
    }
  }

  function discardTake() {
    s.takePlayer?.destroy();
    s.takePlayer = null;
    clear(takeSlot);
    s.take = null;
  }

  function retake() {
    discardTake();
    s.fullSince = null;
    s.lock.reset();
    prompt.textContent = 'Stand on your start mark';
    setPhase('live');
  }

  function useTake() {
    const { blob, seconds, measuredFps, format, mimeType } = s.take;
    const session = app.createSession({
      blob,
      mime: blob.type,
      source: 'camera',
      consent: s.consent,
      rotation: s.rotation,
      setup: { music: music.info(), camera: s.cameraLabel, width: format.width, height: format.height, reportedFps: format.frameRate, measuredFps, seconds: Math.round(seconds * 10) / 10, recordedAs: mimeType },
    });
    discardTake();
    app.go(`#/review/${session.id}`);
  }

  // ── upload ──
  async function onUpload(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    uploadStatus.textContent = 'Checking the video.';
    try {
      const { type } = await checkUpload(file);
      if (!s.alive) return;
      uploadStatus.textContent = '';
      const session = app.createSession({
        blob: file,
        mime: type,
        source: 'upload',
        consent: false,
        name: file.name.replace(/\.[^.]+$/, ''),
        setup: { file: file.name },
      });
      app.go(`#/review/${session.id}`);
    } catch (err) {
      if (s.alive) uploadStatus.textContent = err.message;
    }
  }

  // ── start and stop ──
  const onDeviceChange = async () => {
    if (!s.stream || !s.alive) return;
    s.cameras = await listCameras().catch(() => s.cameras);
    fillCameraList();
  };
  navigator.mediaDevices?.addEventListener('devicechange', onDeviceChange);

  judgeStatus().then((status) => {
    if (!s.alive) return;
    s.judge = status;
    renderConsent();
  });

  setPhase('off');
  // Skip the extra click if the browser has already granted the camera.
  navigator.permissions?.query({ name: 'camera' }).then((p) => { if (s.alive && p.state === 'granted' && s.phase === 'off') turnOn(); }).catch(() => {});

  return {
    cleanup() {
      s.alive = false;
      s.generation++;
      clearInterval(s.ticker);
      navigator.mediaDevices?.removeEventListener('devicechange', onDeviceChange);
      s.recording?.discard();
      releaseCamera();
      discardTake();
      music.destroy();
      s.tracker?.close();
      s.tracker = null;
    },
    guard() {
      if (s.phase === 'recording') return 'A recording is in progress. Leave and lose it?';
      if (s.phase === 'take') return 'You have a take you have not used. Leave and lose it?';
      return null;
    },
  };
}
