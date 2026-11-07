// The result. It reads top to bottom: your score and what it means, then why, then what to do with the walk,
// and finally the raw numbers for anyone who wants them, folded away. Measured points and Gemini's opinion are
// always labeled apart.
import { h, add, button, clear, fmtTime, reducedMotion, liveRegion, icon, sectionHead, num, toast } from './dom.mjs';
import { createPlayer } from './player.mjs';
import { breakdown, momentsList, art } from './parts.mjs';
import { analyzeVideo } from '../pose/analyze.mjs';
import { processFrames } from '../lib/process.mjs';
import { METRIC_INFO } from '../lib/metrics.mjs';
import { totalScore, gradeFor } from '../lib/score.mjs';
import { generateSampleRaw, SAMPLE_JUDGE } from '../lib/sampleWalk.mjs';
import { makeStills } from '../judge/stills.mjs';
import { judgeStatus, requestJudgement } from '../judge/client.mjs';
import { expectedSeconds, rememberSeconds, progressAt, timeLeftText } from '../judge/eta.mjs';
import { saveWalk, loadWalk, deleteWalk } from '../store/db.mjs';
import { keepOnDevice, downloadFile, saveSocialsFile } from '../store/keep.mjs';
import { postToWall, removeFromWall, signIn, signOut, wallInfo } from '../wall/client.mjs';

const STATUS_WORDS = {
  valid: 'Usable',
  'no-person': 'No person found',
  'low-confidence': 'Tracker unsure',
  clipped: 'Outside the frame',
  'too-small': 'Too small in frame',
  'side-on': 'Side-on or turning',
};

function makeSampleSession() {
  const { raw, W, H, duration } = generateSampleRaw();
  return {
    id: 'sample', name: 'Sample walk', isSample: true, source: 'sample', createdAt: Date.now(), blob: null, rotation: 0,
    analysis: processFrames(raw, { W, H, duration }), judge: SAMPLE_JUDGE, stills: [], saved: false, dirty: false, setup: {},
  };
}

export function reviewScreen(root, app, id) {
  let session = null;
  let player = null;
  let alive = true;
  let analysisRun = null;
  let judgeRun = null;
  let analysisState = { kind: 'idle' };
  let judgeState = { kind: 'idle' };
  let judgeInfo = null;
  let saving = false;
  let saveError = '';
  let animateScore = true;

  // Stable parts, rebuilt in place so the name field keeps focus and the video keeps playing.
  const statusPill = h('span', { class: 'rw-pill' });
  const nameInput = h('input', { class: 'rw-name', type: 'text', maxlength: 80, placeholder: 'Name this walk', 'aria-label': 'Name of this walk', onInput: (e) => {
    session.name = e.target.value;
    session.dirty = true;
    renderActions();
    renderStatus();
  } });
  // Socials, so the walker can be tagged when this walk is used in a reel. Saved with the walk on this device.
  let socialsTimer = null;
  const socialsInput = h('input', { class: 'rw-input rw-input--handle rw-socials__input', type: 'text', maxlength: 80, id: 'rw-socials', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: '@yourhandle', onInput: (e) => {
    session.socials = e.target.value.trim();
    session.dirty = true;
    renderStatus();
    clearTimeout(socialsTimer);
    socialsTimer = setTimeout(() => { keepRecording(); saveSocialsFile(session); }, 700);
  } });
  const socialsField = h('div', { class: 'rw-field rw-socials' },
    h('label', { for: 'rw-socials', class: 'rw-field__label' }, 'Your socials, to be tagged'),
    h('span', { class: 'rw-input-wrap' }, icon('socials'), socialsInput),
    h('p', { class: 'rw-field__help' }, 'Optional. Instagram, TikTok or anything else. Kept with this walk on this device.'));
  // "Walk again" is one element: at the right of the head on a laptop, a bar along the bottom on a phone once the
  // score has scrolled away. The score chip beside it shows only in the bar.
  const nextScore = h('span', { class: 'rw-reviewhead__score', 'aria-hidden': 'true' });
  const next = h('div', { class: 'rw-reviewhead__next' });
  const keepActions = h('div', { class: 'rw-actions rw-keep__actions' });
  const keepStatus = h('div', { class: 'rw-keep__status' });
  const playerSlot = h('div', { class: 'rw-result__player' });
  const ribbon = h('div', { class: 'rw-ribbon' });
  const playhead = h('span', { class: 'rw-ribbon__playhead', 'aria-hidden': 'true' });
  const ticks = h('div', { class: 'rw-ribbon__ticks', 'aria-hidden': 'true' });
  const ribbonWrap = h('div', { class: 'rw-ribbon-wrap' }, ticks, ribbon, playhead);
  // Names live in a key under the ribbon, so short segments never cut a word in half.
  const ribbonKey = h('p', { class: 'rw-ribbon__key', 'aria-hidden': 'true' },
    h('span', null, h('i', { class: 'rw-ribbon__swatch' }), 'Toward the camera'),
    h('span', null, h('i', { class: 'rw-ribbon__swatch rw-ribbon__swatch--turn' }), 'Turn'),
    h('span', null, h('i', { class: 'rw-ribbon__swatch rw-ribbon__swatch--back' }), 'Walking back'));
  const summary = h('div', { class: 'rw-result__summary' });
  const breakdownPanel = h('div', { class: 'rw-breakdown' });
  const momentsPanel = h('div', { class: 'rw-analysis__moments' });
  const stillsPanel = h('div', { class: 'rw-analysis__stills' });
  const analysisAside = h('div', { class: 'rw-analysis__aside' }, momentsPanel, stillsPanel);
  const analysisGrid = h('div', { class: 'rw-analysis' }, breakdownPanel, analysisAside);
  const wallPanel = h('section', { class: 'rw-card rw-wallpost', hidden: true, 'aria-labelledby': 'rw-wallpost-title' });
  const deviceCard = h('section', { class: 'rw-card rw-keep__device', 'aria-labelledby': 'rw-keep-device-title' });
  const keepSection = h('section', { class: 'rw-keep', 'aria-labelledby': 'rw-keep-title' });
  const detailsPanel = h('div', { class: 'rw-result__details' });
  const announce = liveRegion('rw-sr');
  const postName = h('input', { class: 'rw-input', type: 'text', maxlength: 30, autocomplete: 'off', id: 'rw-post-name' });
  const postConsent = h('input', { type: 'checkbox' });
  let wallStatus = null;
  let wallState = { kind: 'idle' };

  // ── status and actions ──
  function renderStatus() {
    if (session.isSample) {
      statusPill.textContent = 'Sample: synthetic data';
      statusPill.className = 'rw-pill rw-pill--sample';
    } else if (session.saved && !session.dirty) {
      statusPill.textContent = 'Saved on this device';
      statusPill.className = 'rw-pill rw-pill--saved';
    } else if (session.saved) {
      statusPill.textContent = 'Saved, with unsaved changes';
      statusPill.className = 'rw-pill rw-pill--temp';
    } else {
      statusPill.textContent = 'Temporary: not saved anywhere';
      statusPill.className = 'rw-pill rw-pill--temp';
    }
  }

  function renderActions() {
    clear(next);
    if (session.isSample) {
      next.append(nextScore, h('a', { class: 'rw-btn rw-btn--solid', href: '#/studio' }, 'Try it for real'));
      return;
    }
    next.append(nextScore, button(session.saved ? 'Walk again' : 'Discard and walk again', () => {
      app.discardCurrent = true;
      app.go('#/studio');
    }, { kind: 'solid' }));

    clear(keepActions);
    clear(keepStatus);
    const busy = analysisState.kind === 'running' || judgeState.kind === 'preparing' || judgeState.kind === 'sending';
    const canSave = !session.saved || session.dirty;
    add(keepActions,
      canSave ? button(saving ? 'Saving' : session.saved ? 'Save changes' : 'Save to this device', onSave, { kind: 'solid', disabled: saving || busy }) : null,
      button(session.saved ? 'Delete' : 'Discard', onDelete, { kind: 'danger', disabled: saving }));
    add(keepStatus,
      canSave ? null : h('p', { class: 'rw-status rw-status--ok' }, 'All changes saved'),
      saveError ? h('p', { class: 'rw-error', role: 'alert' }, icon('alert'), h('span', null, saveError)) : null);
  }

  async function onSave(event) {
    const asked = !!event; // A press of the button, not one of the automatic saves.
    saving = true;
    saveError = '';
    renderActions();
    try {
      if (!session.name.trim()) session.name = 'Untitled walk';
      nameInput.value = session.name;
      await saveWalk(session, currentTotal());
      if (!alive) return;
      // Only now, after the transaction has committed, does the screen say it is saved.
      session.saved = true;
      session.dirty = false;
      if (asked) toast('Saved on this device');
      else announce.textContent = 'Saved on this device';
    } catch (err) {
      saveError = err.message;
    } finally {
      saving = false;
      if (alive) {
        renderActions();
        renderStatus();
        if (saveAgain && !saveError) {
          saveAgain = false;
          session.dirty = true;
          keepRecording();
        }
      }
    }
  }

  async function onDelete() {
    const message = session.saved
      ? `Delete "${session.name}"? This removes its video, measurements and judging for good.`
      : 'Discard this walk? It has not been saved, so it will be gone.';
    if (!confirm(message)) return;
    try {
      if (session.saved) await deleteWalk(session.id);
      app.discardCurrent = true;
      app.go('#/');
    } catch (err) {
      saveError = `It could not be deleted. ${err.message}`;
      renderActions();
    }
  }

  const currentTotal = () => totalScore(session.analysis?.measured, session.judge);

  /** Every recording is saved without asking: on arrival, after the analysis, and after judging. */
  let saveAgain = false;
  function keepRecording() {
    if (session.isSample || !session.blob || (session.saved && !session.dirty)) return;
    if (saving) saveAgain = true; // Something changed mid-save, so save once more when it finishes.
    else onSave();
  }

  // ── analysis ──
  async function runAnalysis() {
    analysisRun?.abort();
    const run = new AbortController();
    analysisRun = run;
    analysisState = { kind: 'running', stage: 'Getting started', done: 0 };
    renderSummary();
    renderActions();
    try {
      const out = await analyzeVideo(session.blob, {
        base: app.base,
        rotation: session.rotation,
        signal: run.signal,
        onProgress: (p) => {
          if (run !== analysisRun || !alive) return;
          const trackingSince = analysisState.trackingSince ?? (p.done > 0 ? performance.now() - 1 : null);
          analysisState = { kind: 'running', ...p, trackingSince };
          renderProgress();
        },
      });
      if (run !== analysisRun || !alive) return;
      // Attach results to their own fields only, so the name or anything else edited meanwhile stands.
      session.analysis = { ...processFrames(out.raw, { W: out.W, H: out.H, duration: out.duration }), delegate: out.delegate, tracker: out.tracker, reader: out.reader, samplesPerSecond: out.duration ? Math.round(out.raw.length / out.duration) : null };
      session.dirty = true;
      analysisState = { kind: 'done' };
      player.setAnalysis(session.analysis);
      announce.textContent = 'Analysis finished';
      renderAll();
      keepRecording();
      maybeAutoJudge();
    } catch (err) {
      if (run !== analysisRun || !alive) return;
      if (err?.name === 'AbortError') {
        analysisState = { kind: 'cancelled' };
      } else {
        console.error(err);
        analysisState = { kind: 'failed', message: err?.message || 'The analysis stopped unexpectedly.' };
      }
      renderAll();
    }
  }

  // Tracking reports how much of the video it has read, so the percentage and the time left are real.
  function renderProgress() {
    const host = player?.overlay;
    if (!host) return;
    const bar = host.querySelector('progress');
    const label = host.querySelector('.rw-progress__label');
    const pct = host.querySelector('.rw-progress__pct');
    const left = host.querySelector('.rw-progress__left');
    const done = analysisState.done || 0;
    if (bar) bar.value = done;
    if (label) label.textContent = analysisState.stage;
    if (pct) pct.textContent = `${Math.floor(done * 100)}%`;
    if (left) {
      if (done > 0.03 && analysisState.trackingSince) {
        const elapsed = (performance.now() - analysisState.trackingSince) / 1000;
        const remaining = Math.max(1, Math.round((elapsed / done) * (1 - done)));
        left.textContent = `About ${remaining} ${remaining === 1 ? 'second' : 'seconds'} left`;
      } else {
        left.textContent = done ? 'Working out how long this takes' : 'Getting ready';
      }
    }
  }

  // ── judging ──
  const canJudge = () => session.analysis?.measured?.ok && !session.judge?.ok && !session.isSample;

  function maybeAutoJudge() {
    if (canJudge() && session.consent && judgeInfo?.ready) runJudge();
    else renderAll();
  }

  // While judging, a timer moves the bar in place, so the rest of the page is not rebuilt every second.
  let judgeTicker = null;
  // Each step owns a slice of the bar. Every slice but thinking moves on real events: stills made, the server
  // receiving them, and the characters of Gemini's answer as it writes. Thinking sends nothing, so that slice is
  // an estimate, and it says so.
  const EXPECTED_ANSWER_CHARS = 900;
  const modelName = (id = '') => id.replace(/^gemini-/, 'Gemini ').replace(/-flash-lite$/, ' Flash-Lite').replace(/-flash$/, ' Flash').replace(/-pro$/, ' Pro');
  function judgePercent(s) {
    if (s.kind === 'preparing') return 15 * (s.total ? s.done / s.total : 0);
    if (s.phase === 'uploading') return 15;
    if (s.phase === 'writing') return 70 + 29 * Math.min(1, s.chars / EXPECTED_ANSWER_CHARS);
    if (!s.askedAt) return 20;
    return 20 + 50 * progressAt((performance.now() - s.askedAt) / 1000, s.expected);
  }
  function tickJudge() {
    const bar = summary.querySelector('.rw-judging progress');
    const stage = summary.querySelector('.rw-judging__stage');
    const left = summary.querySelector('.rw-judging__left');
    const pct = summary.querySelector('.rw-judging__pct');
    if (!bar || !stage || !left || !pct) return;
    const s = judgeState;
    if (s.kind !== 'preparing' && s.kind !== 'sending') return;
    // Never moves backwards, even when the server switches to another model.
    s.shown = Math.max(s.shown || 0, judgePercent(s));
    bar.value = s.shown / 100;
    pct.textContent = `${Math.floor(s.shown)}%`;
    if (s.kind === 'preparing') {
      stage.textContent = 'Picking stills and pixelating faces';
      left.textContent = s.total ? `${s.done} of ${s.total} stills ready, on this device` : 'Reading the video';
    } else if (s.phase === 'uploading') {
      stage.textContent = `Sending ${session.stills.length} stills to the judge`;
      left.textContent = 'Waiting for the server to receive them';
    } else if (s.phase === 'writing') {
      stage.textContent = `${modelName(s.model)} is writing its verdict`;
      left.textContent = `${s.chars} of about ${EXPECTED_ANSWER_CHARS} characters`;
    } else {
      stage.textContent = s.model ? `${modelName(s.model)} is thinking about your walk` : 'The server has your stills';
      const elapsed = s.askedAt ? (performance.now() - s.askedAt) / 1000 : 0;
      left.textContent = [s.note, s.askedAt ? `${timeLeftText(elapsed, s.expected)} (an estimate: Gemini says nothing until it starts writing)` : ''].filter(Boolean).join(' ');
    }
  }

  /** Progress events from the server, while the request is open. */
  function onJudgeProgress(event) {
    const s = judgeState;
    if (s.kind !== 'sending') return;
    if (event.stage === 'received') s.phase = 'received';
    if (event.stage === 'asking') {
      if (event.retry && s.model) s.note = `${modelName(s.model)} was busy or out of requests, so it moved on to ${modelName(event.model)}.`;
      s.model = event.model;
      s.phase = 'thinking';
      s.askedAt = performance.now();
      s.chars = 0;
    }
    if (event.stage === 'writing') {
      if (s.phase !== 'writing' && s.askedAt) s.thoughtFor = (performance.now() - s.askedAt) / 1000;
      s.phase = 'writing';
      s.chars = event.chars;
    }
    tickJudge();
  }
  function startTicker() {
    if (!judgeTicker) judgeTicker = setInterval(() => (alive && (judgeState.kind === 'preparing' || judgeState.kind === 'sending') ? tickJudge() : stopTicker()), 250);
  }
  function stopTicker() {
    clearInterval(judgeTicker);
    judgeTicker = null;
  }

  function cancelJudge() {
    judgeRun?.abort();
    judgeRun = null;
    stopTicker();
    judgeState = { kind: 'failed', message: 'You cancelled it. Your measured score stands.' };
    renderAll();
  }

  async function runJudge() {
    judgeRun?.abort();
    const run = new AbortController();
    judgeRun = run;
    const began = performance.now();
    judgeState = { kind: 'preparing', done: 0, total: 0 };
    renderSummary();
    renderActions();
    renderWall();
    startTicker();
    try {
      if (!session.stills?.length) {
        session.stills = await makeStills(session.blob, session.analysis, {
          signal: run.signal,
          rotation: session.rotation,
          onProgress: (done, total) => {
            if (run !== judgeRun) return;
            judgeState = { kind: 'preparing', done, total };
            tickJudge();
          },
        });
        if (run !== judgeRun || !alive) return;
        console.info(`[judge] ${session.stills.length} stills ready in ${((performance.now() - began) / 1000).toFixed(1)} s`);
      }
      if (!session.stills.length) {
        judgeState = { kind: 'failed', message: 'No frame had the head clearly located, so there were no safe stills to send.' };
        renderAll();
        return;
      }
      judgeState = { kind: 'sending', phase: 'uploading', started: performance.now(), expected: expectedSeconds(), shown: 15, chars: 0 };
      renderSummary();
      renderDetails();
      const answer = await requestJudgement({ stills: session.stills, analysis: session.analysis }, run.signal, onJudgeProgress);
      if (run !== judgeRun || !alive) return;
      const took = (performance.now() - judgeState.started) / 1000;
      const thoughtFor = judgeState.thoughtFor;
      console.info(`[judge] ${answer.ok ? `answered by ${answer.model}` : `no answer (${answer.code})`} after ${took.toFixed(1)} s`);
      if (answer.ok) {
        // The estimate covers only the silent thinking, since every other step moves on its own.
        rememberSeconds(thoughtFor ?? took);
        session.judge = answer;
        session.dirty = true;
        judgeState = { kind: 'done' };
        animateScore = true;
        announce.textContent = `Score: ${currentTotal()} out of 100`;
        renderAll();
        keepRecording();
        return;
      } else {
        judgeState = { kind: 'failed', message: answer.message };
      }
      renderAll();
    } catch (err) {
      if (run !== judgeRun || !alive || err?.name === 'AbortError') return;
      console.error(err);
      judgeState = { kind: 'failed', message: err?.message || 'The stills could not be prepared.' };
      renderAll();
    } finally {
      if (run === judgeRun && judgeState.kind !== 'preparing' && judgeState.kind !== 'sending') stopTicker();
    }
  }

  // ── rendering ──
  // Counts up once, over 1.1 s with a quartic ease, then the grade and verdict fade in after it (results.css).
  let counting = false;
  function bigNumber(value, max, pending) {
    const numEl = h('span', { class: 'rw-score__num' }, String(value));
    counting = false;
    if (animateScore && !reducedMotion()) {
      counting = true;
      const started = performance.now();
      const animate = (now) => {
        if (!alive) return;
        const p = Math.min(1, (now - started) / 1100);
        numEl.textContent = String(Math.round(value * (1 - (1 - p) ** 4)));
        if (p < 1) requestAnimationFrame(animate);
      };
      numEl.textContent = '0';
      requestAnimationFrame(animate);
    }
    animateScore = false;
    return h('p', { class: 'rw-score' }, numEl,
      h('span', { class: 'rw-score__max rw-unit' }, `/${max}`),
      pending ? h('span', { class: 'rw-chip rw-chip--ghost rw-score__more', title: 'Up to 30 more points from the judge' }, '+?') : null);
  }

  function judgePrompt() {
    switch (judgeState.kind) {
      case 'preparing':
      case 'sending': {
        const block = h('div', { class: 'rw-judging rw-card' },
          h('div', { class: 'rw-judging__top' },
            h('p', { class: 'rw-eyebrow rw-judging__eyebrow' }, icon('judge'), 'Gemini is judging'),
            button('Cancel', cancelJudge, { kind: 'small' })),
          h('div', { class: 'rw-judging__head' },
            h('p', { class: 'rw-judging__stage rw-working' }),
            h('span', { class: 'rw-judging__pct', 'aria-hidden': 'true' }, '0%')),
          h('progress', { max: 1, value: 0, 'aria-label': 'Judging progress' }),
          h('p', { class: 'rw-judging__left' }));
        queueMicrotask(tickJudge);
        return block;
      }
      case 'failed':
        return h('div', { class: 'rw-judgefail' },
          h('p', { class: 'rw-error', role: 'alert' }, icon('alert'), h('span', null, `No judgment this time. ${judgeState.message}`)),
          h('div', { class: 'rw-actions rw-actions--top' }, button('Ask the judge again', runJudge)));
      default:
    }
    if (!judgeInfo) return h('p', { class: 'rw-status rw-status--busy rw-working' }, 'Checking for the judge.');
    if (!judgeInfo.ready) {
      return h('p', { class: 'rw-status rw-judgeoff' }, judgeInfo.offline
        ? 'The judge cannot be reached from here, so this walk has its measured 70 points only.'
        : 'Gemini is not connected to this server yet, so this walk has its measured 70 points only.');
    }
    return h('div', { class: 'rw-card rw-judgeoffer' },
      h('div', { class: 'rw-card__head' }, icon('judge'), h('h2', null, '30 points still open')),
      h('p', null, h('strong', null, 'Want the other 30 points? '), 'About 12 cropped stills with the face pixelated would go to Google\'s Gemini. You must be 18 or older.', judgeInfo.paidTier ? '' : ' Google may use them to improve its products.'),
      h('div', { class: 'rw-actions rw-actions--top' }, button('I agree, judge my walk', () => { session.consent = true; runJudge(); }, { kind: 'solid' })));
  }

  // While the video is read, the progress sits over the replay itself; it is removed the moment the work ends.
  function renderOverlay() {
    const host = player?.overlay;
    if (!host) return;
    clear(host);
    if (analysisState.kind !== 'running') return;
    host.append(h('div', { class: 'rw-progress' },
      h('div', { class: 'rw-progress__head' },
        h('p', { class: 'rw-progress__label' }, analysisState.stage),
        h('span', { class: 'rw-progress__pct', 'aria-hidden': 'true' }, `${Math.floor((analysisState.done || 0) * 100)}%`)),
      h('progress', { max: 1, value: analysisState.done || 0, 'aria-label': 'Analysis progress' }),
      h('div', { class: 'rw-progress__foot' },
        h('p', { class: 'rw-progress__left' }, 'Getting ready'),
        button('Cancel', () => analysisRun?.abort(), { kind: 'small' }))));
  }

  const tile = (eyebrow, value, note, extra = null) => h('div', { class: 'rw-tile' },
    h('p', { class: 'rw-eyebrow' }, eyebrow),
    value ? h('p', { class: 'rw-tile__value' }, value) : null,
    extra,
    note ? h('p', { class: 'rw-tile__note' }, note) : null);

  function renderSummary() {
    clear(summary);
    renderOverlay();
    summary.dataset.state = analysisState.kind;
    const a = session.analysis;
    nextScore.replaceChildren();

    if (analysisState.kind === 'running') {
      summary.append(h('div', { class: 'rw-scoreblock rw-scoreblock--waiting' },
        h('p', { class: 'rw-eyebrow' }, 'Measuring your walk'),
        h('div', { class: 'rw-scoreblock__skel', 'aria-hidden': 'true' },
          h('span', { class: 'rw-skel rw-skel--score' }),
          h('span', { class: 'rw-skel rw-skel--line' }),
          h('span', { class: 'rw-skel rw-skel--line rw-skel--short' })),
        h('p', { class: 'rw-scoreblock__note' }, icon('device'), h('span', null, 'This runs on this device. Your video stays here.'))));
      return;
    }
    if (analysisState.kind === 'cancelled' || analysisState.kind === 'failed') {
      add(summary, h('div', { class: 'rw-card rw-analysisstop' },
        analysisState.kind === 'failed'
          ? h('p', { class: 'rw-error', role: 'alert' }, icon('alert'), h('span', null, `The analysis failed. ${analysisState.message}`))
          : h('h2', { class: 'rw-analysisstop__title' }, 'Analysis cancelled.'),
        h('p', { class: 'rw-muted' }, 'Your recording is untouched.'),
        h('div', { class: 'rw-actions rw-actions--top' }, button('Run the analysis again', runAnalysis, { kind: 'solid' }))));
      return;
    }
    if (!a) return;

    if (!a.measured.ok) {
      summary.append(h('div', { class: 'rw-card rw-noscorecard' },
        h('p', { class: 'rw-eyebrow' }, 'No score this time'),
        h('p', { class: 'rw-noscore' }, 'We could not score this one.'),
        h('p', { class: 'rw-muted' }, a.measured.reason),
        h('div', { class: 'rw-actions rw-actions--top' }, button('Walk again', () => { app.discardCurrent = true; app.go('#/studio'); }, { kind: 'solid' }))));
      return;
    }

    const total = currentTotal();
    const judge = session.judge?.ok ? session.judge : null;
    const grade = gradeFor(total ?? (a.measured.points / a.measured.max) * 100);
    const judgePending = !judge && !session.isSample && (judgeState.kind === 'preparing' || judgeState.kind === 'sending' || !!judgeInfo?.ready);
    const laps = a.measured.laps?.length > 1 ? a.measured.laps : null;
    const scoreEl = total !== null ? bigNumber(total, 100, false) : bigNumber(a.measured.points, a.measured.max, judgePending);
    nextScore.append(total !== null ? num(total, '/100') : num(a.measured.points, `/${a.measured.max}`));

    const block = h('div', { class: `rw-scoreblock${counting ? ' is-counting' : ''}` },
      h('p', { class: 'rw-eyebrow' }, session.isSample ? 'Sample score, from synthetic data' : total !== null ? 'Your score' : 'Measured so far'),
      scoreEl,
      h('div', { class: 'rw-scoreblock__grade' },
        h('p', { class: 'rw-grade' }, grade.label),
        h('p', { class: 'rw-grade__line' }, grade.line)),
      laps ? h('div', { class: 'rw-laps' },
        h('p', { class: 'rw-caption' }, `Based on ${a.measured.lapsUsed} of ${a.measured.laps.length} walks`),
        h('p', { class: 'rw-chips' }, laps.map((l) => h('span', { class: `rw-chip${l.points === null ? ' rw-chip--off' : ''}` },
          l.points === null ? `Walk ${l.number} · not usable` : `Walk ${l.number} · ${l.points}/70`)))) : null);

    const tiles = [
      judge?.match ? tile('Closest walk', null, judge.match.why || null, h('div', { class: 'rw-match' },
        h('p', { class: 'rw-match__name' }, judge.match.name),
        h('p', { class: 'rw-match__tag' }, judge.match.tag))) : null,
      a.measured.strength ? tile('Strongest part', h('span', null, a.measured.strength.label, ' ', h('span', { class: 'rw-tile__pts' }, `${a.measured.strength.points} of ${a.measured.strength.max}`)), a.measured.strength.note) : null,
      a.measured.focus ? tile('Biggest win', h('span', null, a.measured.focus.label, ' ', h('span', { class: 'rw-tile__pts rw-accent' }, `up to ${a.measured.focus.gain} more`)), a.measured.focus.tip) : null,
      judge?.tip ? tile('The judge suggests', null, judge.tip) : null,
    ].filter(Boolean);

    add(summary,
      block,
      judge ? h('blockquote', { class: 'rw-verdict' }, h('p', null, judge.verdict)) : judgePrompt(),
      tiles.length ? h('div', { class: 'rw-tiles rw-result__tiles' }, tiles) : null);
  }

  function renderBreakdown() {
    clear(breakdownPanel);
    clear(momentsPanel);
    clear(stillsPanel);
    const a = session.analysis;
    analysisGrid.hidden = !a?.measured?.ok || analysisState.kind === 'running';
    if (analysisGrid.hidden) return;
    const judged = !!session.judge?.ok;
    analysisGrid.classList.toggle('rw-analysis--judged', judged);
    add(breakdownPanel, breakdown(a.measured, judged ? session.judge : null, { sample: session.isSample, model: session.judge?.model, calibrated: a.metrics.calibrated }));
    add(momentsPanel, momentsList(session.judge?.moments, (t) => player?.seek(t)));
    // The stills sit beside the judge's words, because they are the only thing Gemini looked at.
    if (session.stills?.length) {
      add(stillsPanel, h('section', { class: 'rw-stillsblock' },
        h('h2', { class: 'rw-aside__title' }, 'What Gemini saw'),
        h('p', { class: 'rw-small rw-muted' }, `These ${session.stills.length} stills are the only images that left this device. Each is cropped to the walker with the head pixelated. Other people caught inside the crop are not pixelated.`),
        h('div', { class: 'rw-stills' }, session.stills.map((st) => h('button', { type: 'button', class: 'rw-still', onClick: () => player?.seek(st.t), 'aria-label': `Go to ${fmtTime(st.t)}` },
          h('img', { src: st.dataUrl, alt: `Pixelated still at ${fmtTime(st.t)}` }),
          h('span', null, fmtTime(st.t)))))));
    }
    analysisAside.hidden = !momentsPanel.children.length && !stillsPanel.children.length;
  }

  function renderRibbon() {
    clear(ribbon);
    clear(ticks);
    const a = session.analysis;
    if (!a?.duration) {
      ribbonWrap.hidden = true;
      ribbonKey.hidden = true;
      return;
    }
    // A short accent mark above the ribbon wherever the judge left a moment.
    for (const m of session.judge?.ok ? session.judge.moments || [] : []) {
      ticks.append(h('span', { class: 'rw-ribbon__tick', style: `left:${Math.min(100, (m.t / a.duration) * 100)}%` }));
    }
    const laps = a.laps?.length ? a.laps : [a.phases];
    const seg = (name, kind, range, lap) => range && h('button', {
      type: 'button',
      class: `rw-ribbon__seg rw-ribbon__seg--${kind}`,
      style: `left:${(range[0] / a.duration) * 100}%;width:${(Math.max(range[1] - range[0], 0.1) / a.duration) * 100}%`,
      onClick: () => player?.seek(range[0]),
      title: laps.length > 1 ? `Walk ${lap}: ${name}` : name,
      'aria-label': `Go to ${laps.length > 1 ? `walk ${lap}, ` : ''}${name.toLowerCase()}, at ${fmtTime(range[0])}`,
    });
    laps.forEach((lap, i) => {
      add(ribbon, seg('Toward the camera', 'approach', lap.approach, i + 1), seg('Turn', 'turn', lap.turn, i + 1), seg('Walking back', 'back', lap.back, i + 1));
    });
    ribbonWrap.hidden = !ribbon.children.length;
    ribbonKey.hidden = ribbonWrap.hidden;
  }

  // The playhead follows the replay without rebuilding the ribbon.
  let lastHead = -1;
  function movePlayhead(t, duration) {
    const total = session?.analysis?.duration || duration;
    if (!total) return;
    const pct = Math.max(0, Math.min(100, (t / total) * 100));
    if (Math.abs(pct - lastHead) < 0.05) return;
    lastHead = pct;
    playhead.style.left = `${pct}%`;
  }

  function metricCard(metric) {
    const info = METRIC_INFO[metric.key];
    return h('article', { class: 'rw-metric rw-card' },
      h('h3', null, info.title),
      metric.ok
        ? h('p', { class: 'rw-metric__value' }, String(metric.value), h('span', { class: 'rw-unit' }, ` ${metric.unit}`))
        : h('p', { class: 'rw-metric__none' }, 'Not enough data'),
      h('p', { class: 'rw-small rw-muted' }, metric.ok ? info.reads : metric.why),
      h('details', { class: 'rw-disclosure rw-small' },
        h('summary', null, 'How this is measured'),
        h('p', null, info.formula),
        h('p', { class: 'rw-muted' }, info.limits)));
  }

  function renderDetails() {
    clear(detailsPanel);
    const a = session.analysis;
    if (!a) return;
    const { coverage, version } = a.metrics;
    const counts = Object.entries(coverage.counts).sort((x, y) => y[1] - x[1]);

    const canDownload = session.blob && !session.isSample;
    add(detailsPanel, h('details', { class: 'rw-details', open: !a.measured.ok },
      h('summary', null, 'The numbers behind this'),
      h('div', { class: 'rw-coverage rw-note' },
        h('h3', null, 'Tracking coverage'),
        h('p', null, h('strong', null, `${Math.round(coverage.ratio * 100)}%`), ` of the sampled walking frames were usable: ${coverage.valid} of ${coverage.sampled}, or ${coverage.validSeconds} s.`),
        a.metrics.stepCount ? h('p', null, `${a.metrics.stepCount} footsteps found${a.metrics.cadence ? `, at ${a.metrics.cadence} steps a minute` : ''}.`) : null,
        a.phases.shape === 'up-and-back' ? null : h('p', { class: 'rw-muted' }, a.phases.shape === 'none'
          ? 'No walk toward or away from the camera was detected, so the whole clip was described.'
          : `Only one direction of walking was detected (${a.phases.shape}).`),
        counts.length ? h('ul', { class: 'rw-counts' }, counts.map(([status, n]) => h('li', null, h('span', null, STATUS_WORDS[status] || status), h('span', { class: 'rw-counts__n' }, String(n))))) : null,
        a.tracker ? h('p', { class: 'rw-muted rw-small' }, `Tracked with ${a.tracker} on the ${a.delegate}${a.samplesPerSecond ? `, ${a.samplesPerSecond} samples a second` : ''}.${a.reader === 'decoded' ? ' Every frame was read directly from the file.' : a.reader ? ' This browser could not read the file directly, so some frames may have been missed.' : ''}`) : null,
        session.setup?.music ? h('p', { class: 'rw-muted rw-small' }, `Walked to "${session.setup.music.title}"${session.setup.music.bpm && a.metrics.cadence ? `, about ${session.setup.music.bpm} beats a minute. You took ${a.metrics.cadence} steps a minute.` : '.'}`) : null,
        session.setup?.width ? h('p', { class: 'rw-muted rw-small' }, `Recorded at ${session.setup.width} × ${session.setup.height}. The camera reported ${Math.round(session.setup.reportedFps ?? 0)} fps, and ${session.setup.measuredFps ? `${session.setup.measuredFps.toFixed(1)} fps` : 'an unknown rate'} reached the page.`) : null),
      h('p', { class: 'rw-muted' }, `These describe movement in the picture (${version}). Camera tilt, camera movement and lens perspective all affect them. The score is a game, and the rules that turn these numbers into points are ours, not a verdict on anyone's technique.`),
      a.stance?.noise ? h('p', { class: 'rw-muted' }, `The smallest movement this setup can honestly see: with you standing still, the tracker wobbled by ${a.stance.noise.shoulderSway}° at the shoulders and ${a.stance.noise.bounce}% of your height up and down. Anything smaller cannot be told apart from noise, so that much is taken off your sway and bounce.`) : null,
      h('div', { class: 'rw-metrics' }, Object.keys(METRIC_INFO).filter((key) => a.metrics[key] && (a.metrics[key].ok || !/Drop|headTilt/.test(key) || a.metrics.calibrated)).map((key) => metricCard({ ...a.metrics[key], key }))),
      canDownload ? h('div', { class: 'rw-actions' },
        button([icon('download'), 'Save the video file'], () => downloadFile(session), { kind: 'small' }),
        !session.wallPost ? button([icon('turn'), 'Rotate video and analyze again'], () => {
          session.rotation = ((session.rotation || 0) + 90) % 360;
          session.analysis = null;
          session.judge = null;
          session.stills = [];
          session.dirty = true;
          player.setRotation(session.rotation);
          player.setAnalysis(null);
          judgeState = { kind: 'idle' };
          animateScore = true;
          renderAll();
          runAnalysis();
        }, { kind: 'small' }) : null) : null));
  }

  // ── the wall ──
  function onPost() {
    const name = postName.value.trim();
    if (!name) {
      wallState = { kind: 'failed', message: 'Enter a name to show on the wall.' };
      renderWall();
      postName.focus();
      return;
    }
    if (!postConsent.checked) {
      wallState = { kind: 'failed', message: 'Tick the box to agree before posting.' };
      renderWall();
      return;
    }
    // Sign-in must start here, directly from the click, or the browser blocks its window.
    const signing = wallStatus.auth && !wallStatus.signedIn ? signIn() : null;
    wallState = { kind: 'posting' };
    renderWall();
    finishPost(signing, name);
  }

  async function finishPost(signing, name) {
    if (signing) {
      const signed = await signing;
      if (!alive) return;
      if (!signed.ok) {
        wallState = { kind: 'failed', message: signed.message };
        renderWall();
        return;
      }
    }
    const result = await postToWall(session, name);
    if (!alive) return;
    if (!result.ok) {
      if (result.code === 'sign_in') wallStatus.signedIn = false;
      wallState = { kind: 'failed', message: result.message };
      renderWall();
      return;
    }
    session.wallPost = { id: result.id };
    session.dirty = true;
    wallState = { kind: 'posted', unverified: !!session.judge?.ok && !result.judged, signedOut: false };
    // On a shared kiosk the next walker must not inherit this account.
    if (wallStatus.auth) {
      await signOut();
      wallStatus.signedIn = false;
      wallState.signedOut = true;
    }
    if (!alive) return;
    announce.textContent = 'Posted to the wall';
    renderWall();
    renderActions();
    renderStatus();
  }

  function onRemovePost() {
    if (!confirm('Remove this walk from the wall? This deletes the post and its movement data there. Your copy here is not affected.')) return;
    const signing = wallStatus?.auth && !wallStatus.signedIn ? signIn() : null;
    wallState = { kind: 'posting' };
    renderWall();
    finishRemove(signing);
  }

  async function finishRemove(signing) {
    if (signing) {
      const signed = await signing;
      if (!alive) return;
      if (!signed.ok) {
        wallState = { kind: 'failed', message: signed.message };
        renderWall();
        return;
      }
    }
    const result = await removeFromWall(session.wallPost.id);
    if (wallStatus?.auth) {
      await signOut();
      wallStatus.signedIn = false;
    }
    if (!alive) return;
    if (result.ok || result.code === 'not_found') {
      session.wallPost = null;
      session.dirty = true;
      wallState = { kind: 'idle' };
    } else {
      wallState = { kind: 'failed', message: result.code === 'not_owner' ? 'That account did not post this walk.' : result.message };
    }
    renderWall();
    renderActions();
    renderStatus();
  }

  function renderWall() {
    clear(wallPanel);
    const busy = analysisState.kind === 'running' || judgeState.kind === 'preparing' || judgeState.kind === 'sending';
    if (session.isSample || !session.analysis?.measured?.ok) {
      wallPanel.hidden = true;
      return;
    }
    wallPanel.hidden = false;
    wallPanel.append(h('div', { class: 'rw-card__head' }, icon('wall'), h('h3', { id: 'rw-wallpost-title' }, 'Post it to the wall')));
    const problem = wallState.kind === 'failed' ? h('p', { class: 'rw-error', role: 'alert' }, icon('alert'), h('span', null, wallState.message)) : null;

    if (session.wallPost) {
      add(wallPanel,
        h('p', { class: 'rw-status rw-status--ok rw-wallpost__done' }, 'This walk is on the wall.'),
        wallState.unverified ? h('p', { class: 'rw-muted rw-small' }, 'It shows the measured half only, because the server could not verify the judge\'s result.') : null,
        wallState.signedOut ? h('p', { class: 'rw-muted rw-small' }, 'You have been signed out, so the next walker starts fresh.') : null,
        problem,
        h('div', { class: 'rw-actions' },
          h('a', { class: 'rw-btn rw-btn--solid', href: `#/wall/${session.wallPost.id}` }, 'See it on the wall'),
          button(wallState.kind === 'posting' ? 'Removing' : 'Remove from the wall', onRemovePost, { kind: 'danger', disabled: wallState.kind === 'posting' })));
      return;
    }
    if (!wallStatus) {
      wallPanel.append(h('p', { class: 'rw-status rw-status--busy' }, 'Checking for the wall.'));
      return;
    }
    if (!wallStatus.ready) {
      wallPanel.append(h('p', { class: 'rw-status' }, 'The wall is not connected on this server. You can still save this walk on this device.'));
      return;
    }
    if (busy) {
      wallPanel.append(h('p', { class: 'rw-status rw-status--busy' }, 'You can post once judging has finished.'));
      return;
    }
    const posting = wallState.kind === 'posting';
    const needsSignIn = wallStatus.auth && !wallStatus.signedIn;
    if (!postName.value && wallStatus.name) postName.value = wallStatus.name;
    add(wallPanel,
      h('p', { class: 'rw-small rw-muted' }, 'Everyone will see your name, score, the judge\'s words and your skeleton\'s movement. Never the video or any photo.'),
      wallStatus.store === 'local' ? h('p', { class: 'rw-muted rw-small' }, 'This is the local test wall, so posts stay on this computer for now.') : null,
      !session.judge?.ok ? h('p', { class: 'rw-muted rw-small' }, 'Not judged, so this posts the measured half only.') : null,
      h('div', { class: 'rw-field' },
        h('label', { class: 'rw-field__label', for: 'rw-post-name' }, 'Name to show'),
        postName,
        h('p', { class: 'rw-field__help' }, 'A first name or nickname is enough.')),
      h('label', { class: 'rw-check' }, postConsent, h('span', null, 'I am 18 or older, and I agree to this being public. I can remove it later.')),
      problem,
      h('div', { class: 'rw-actions' },
        button(posting ? 'Posting' : needsSignIn ? 'Sign in and post' : 'Post to the wall', onPost, { kind: 'solid', disabled: posting })),
      wallStatus.auth ? h('p', { class: 'rw-caption' }, 'Sign-in opens in a new window. It only asks for your name, not your email.') : null,
    );
  }

  function renderAll() {
    if (!alive) return;
    renderStatus();
    renderActions();
    renderSummary();
    renderBreakdown();
    renderRibbon();
    renderDetails();
    renderWall();
  }

  // ── keep it: save on this device, post to the wall ──
  function renderKeep() {
    clear(keepSection);
    keepSection.append(sectionHead({ eyebrow: 'Keep it', title: session.isSample ? 'Now walk it yourself' : 'Save it, post it, walk again', id: 'rw-keep-title' }));
    if (session.isSample) {
      keepSection.append(h('div', { class: 'rw-keep__grid rw-keep__grid--one' },
        h('section', { class: 'rw-card rw-keep__try', 'aria-labelledby': 'rw-keep-try-title' },
          h('div', { class: 'rw-card__head' }, icon('camera'), h('h3', { id: 'rw-keep-try-title' }, 'Try your own')),
          h('p', { class: 'rw-muted' }, 'Two minutes in front of a camera. The measuring happens on this device, and nothing is saved anywhere unless you choose.'),
          h('div', { class: 'rw-actions rw-actions--top' }, h('a', { class: 'rw-btn rw-btn--solid', href: '#/studio' }, 'Try it for real')))));
      return;
    }
    clear(deviceCard);
    deviceCard.append(
      h('div', { class: 'rw-card__head' }, icon('device'), h('h3', { id: 'rw-keep-device-title' }, 'On this device')),
      socialsField,
      keepActions,
      keepStatus,
      h('p', { class: 'rw-caption' }, 'Save keeps it in this browser. The video file itself is also kept on this device.'));
    keepSection.append(h('div', { class: 'rw-keep__grid' }, deviceCard, wallPanel));
  }

  // On a phone, "Walk again" rides along the bottom once the score has scrolled out of view.
  let stickyWatch = null;
  function watchScore() {
    if (!('IntersectionObserver' in window)) return;
    stickyWatch = new IntersectionObserver(([entry]) => {
      const gone = !entry.isIntersecting && entry.boundingClientRect.bottom < 0;
      next.classList.toggle('is-shown', gone);
      document.body.classList.toggle('has-sticky-bar', gone && matchMedia('(max-width: 760px)').matches);
    });
    stickyWatch.observe(summary);
  }

  // ── build ──
  function build() {
    nameInput.value = session.name;
    if (session.isSample) nameInput.readOnly = true;
    socialsInput.value = session.socials || '';
    player = session.isSample
      ? createPlayer({ analysis: session.analysis, badge: 'Synthetic figure, not a recording', label: 'A synthetic stick figure walking toward the camera, turning and walking back', onTime: movePlayhead })
      : createPlayer({ blob: session.blob, analysis: session.analysis, rotation: session.rotation || 0, label: `Replay of ${session.name}`, onTime: movePlayhead });
    playerSlot.append(player.el);

    clear(root);
    root.classList.add('rw-review');
    if (session.isSample) {
      root.append(h('p', { class: 'rw-banner' }, h('strong', null, 'This is a sample. '), 'The figure and its movement are generated by code, and the judge text is written by hand. No camera, tracker or Gemini was involved, and nobody was measured.'));
    }
    root.append(
      h('div', { class: 'rw-reviewhead' },
        h('div', { class: 'rw-reviewhead__name' },
          statusPill,
          h('h1', { class: 'rw-sr', tabindex: '-1' }, `Review: ${session.name}`),
          h('label', { class: 'rw-name-wrap' }, nameInput, session.isSample ? null : icon('pencil', { className: 'rw-icon rw-name-wrap__icon' }))),
        next),
      h('div', { class: 'rw-result' },
        h('div', { class: 'rw-result__media' }, playerSlot, ribbonWrap, ribbonKey, announce),
        summary),
      analysisGrid,
      keepSection,
      detailsPanel,
    );
    renderKeep();
    watchScore();

    judgeStatus().then((status) => {
      if (!alive) return;
      judgeInfo = status;
      renderAll();
      if (analysisState.kind !== 'running' && session.analysis) maybeAutoJudge();
    });
    if (!session.isSample) {
      wallInfo().then((info) => {
        if (!alive) return;
        wallStatus = info.ready ? info : { ready: false };
        renderWall();
      });
    }

    if (!session.saved) keepOnDevice(session);
    keepRecording();
    if (session.blob && !session.analysis) runAnalysis();
    else renderAll();
    root.querySelector('h1')?.focus({ preventScroll: true });
  }

  // ── load ──
  async function load() {
    if (id === 'sample') {
      session = makeSampleSession();
      build();
      return;
    }
    session = app.sessions.get(id) || null;
    if (!session) {
      try {
        session = await loadWalk(id);
      } catch (err) {
        if (alive) clear(root).append(h('p', { class: 'rw-error', role: 'alert' }, icon('alert'), h('span', null, `This walk could not be opened. ${err.message}`)));
        return;
      }
    }
    if (!alive) return;
    if (!session) {
      clear(root).append(h('div', { class: 'rw-empty rw-empty--missing' },
        art('figure.svg', 'rw-empty__figure'),
        h('h1', { class: 'rw-empty__title', tabindex: '-1' }, 'This walk is not here'),
        h('p', { class: 'rw-muted' }, 'Temporary walks disappear on refresh, and saved ones stay in the browser that saved them.'),
        h('div', { class: 'rw-actions rw-actions--center' },
          h('a', { class: 'rw-btn rw-btn--solid', href: '#/studio' }, 'Start a walk'),
          h('a', { class: 'rw-btn', href: '#/history' }, 'Saved walks'))));
      session = null;
      return;
    }
    build();
  }
  load();

  return {
    cleanup() {
      alive = false;
      stickyWatch?.disconnect();
      document.body.classList.remove('has-sticky-bar');
      root.classList.remove('rw-review');
      analysisRun?.abort();
      judgeRun?.abort();
      player?.destroy();
      if (session && !session.saved) app.sessions.delete(session.id);
    },
    guard() {
      if (!session || session.isSample) return null;
      if (!session.saved) return 'This walk is not saved. Leave and lose it?';
      if (session.dirty) return 'This walk has unsaved changes. Leave and lose them?';
      return null;
    },
  };
}
