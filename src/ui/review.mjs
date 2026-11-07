// The result. It reads top to bottom: your score and what it means, then why, then what to do with the walk,
// and finally the raw numbers for anyone who wants them, folded away. Measured points and Gemini's opinion are
// always labeled apart.
import { h, add, button, clear, fmtTime, reducedMotion, liveRegion } from './dom.mjs';
import { createPlayer } from './player.mjs';
import { breakdown, momentsList } from './parts.mjs';
import { analyzeVideo } from '../pose/analyze.mjs';
import { processFrames } from '../lib/process.mjs';
import { METRIC_INFO } from '../lib/metrics.mjs';
import { totalScore, gradeFor } from '../lib/score.mjs';
import { generateSampleRaw, SAMPLE_JUDGE } from '../lib/sampleWalk.mjs';
import { makeStills } from '../judge/stills.mjs';
import { judgeStatus, requestJudgement } from '../judge/client.mjs';
import { expectedSeconds, rememberSeconds, progressAt, timeLeftText } from '../judge/eta.mjs';
import { saveWalk, loadWalk, deleteWalk } from '../store/db.mjs';
import { copyToThisComputer, recordingName } from '../store/keep.mjs';
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
  const nameInput = h('input', { class: 'rw-name', type: 'text', maxlength: 80, 'aria-label': 'Name of this walk', onInput: (e) => {
    session.name = e.target.value;
    session.dirty = true;
    renderActions();
    renderStatus();
  } });
  const actions = h('div', { class: 'rw-actions rw-actions--top' });
  const playerSlot = h('div');
  const ribbon = h('div', { class: 'rw-ribbon' });
  // Names live in a key under the ribbon, so short segments never cut a word in half.
  const ribbonKey = h('p', { class: 'rw-ribbon__key', 'aria-hidden': 'true' },
    h('span', null, h('i', { class: 'rw-ribbon__swatch' }), 'Toward the camera'),
    h('span', null, h('i', { class: 'rw-ribbon__swatch rw-ribbon__swatch--turn' }), 'Turn'),
    h('span', null, h('i', { class: 'rw-ribbon__swatch rw-ribbon__swatch--back' }), 'Walking back'));
  const summary = h('div', { class: 'rw-result__summary' });
  const breakdownPanel = h('div', { class: 'rw-breakdown' });
  const momentsPanel = h('div');
  const wallPanel = h('section', { class: 'rw-block rw-wallpost', hidden: true });
  const detailsPanel = h('div');
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
      statusPill.className = 'rw-pill';
    } else {
      statusPill.textContent = 'Temporary: not saved anywhere';
      statusPill.className = 'rw-pill';
    }
  }

  function renderActions() {
    clear(actions);
    if (session.isSample) {
      actions.append(h('a', { class: 'rw-btn rw-btn--solid', href: '#/studio' }, 'Try it for real'));
      return;
    }
    const busy = analysisState.kind === 'running' || judgeState.kind === 'preparing' || judgeState.kind === 'sending';
    const canSave = !session.saved || session.dirty;
    add(actions,
      canSave
        ? button(saving ? 'Saving' : session.saved ? 'Save changes' : 'Save to this device', onSave, { kind: 'solid', disabled: saving || busy })
        : h('span', { class: 'rw-muted' }, 'All changes saved'),
      button(session.saved ? 'Walk again' : 'Discard and walk again', () => {
        app.discardCurrent = true;
        app.go('#/studio');
      }),
      button(session.saved ? 'Delete' : 'Discard', onDelete, { kind: 'quiet', disabled: saving }),
      saveError ? h('p', { class: 'rw-error', role: 'alert' }, saveError) : null);
  }

  async function onSave() {
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
      announce.textContent = 'Saved on this device';
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
          analysisState = { kind: 'running', ...p };
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

  function renderProgress() {
    const bar = summary.querySelector('progress');
    const label = summary.querySelector('.rw-progress__label');
    if (bar) bar.value = analysisState.done || 0;
    if (label) label.textContent = analysisState.stage;
  }

  // ── judging ──
  const canJudge = () => session.analysis?.measured?.ok && !session.judge?.ok && !session.isSample;

  function maybeAutoJudge() {
    if (canJudge() && session.consent && judgeInfo?.ready) runJudge();
    else renderAll();
  }

  // While judging, a timer moves the bar in place, so the rest of the page is not rebuilt every second.
  let judgeTicker = null;
  function tickJudge() {
    const bar = summary.querySelector('.rw-judging progress');
    const stage = summary.querySelector('.rw-judging__stage');
    const left = summary.querySelector('.rw-judging__left');
    if (!bar || !stage || !left) return;
    const s = judgeState;
    if (s.kind === 'preparing') {
      bar.value = 0.1 * (s.total ? s.done / s.total : 0);
      stage.textContent = 'Picking stills and pixelating faces';
      left.textContent = s.total ? `${s.done} of ${s.total} stills ready` : 'Reading the video';
    } else if (s.kind === 'sending') {
      const elapsed = (performance.now() - s.started) / 1000;
      bar.value = 0.1 + 0.9 * progressAt(elapsed, s.expected);
      stage.textContent = 'Gemini is looking at your walk';
      left.textContent = timeLeftText(elapsed, s.expected);
    }
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
      judgeState = { kind: 'sending', started: performance.now(), expected: expectedSeconds() };
      renderSummary();
      renderDetails();
      const answer = await requestJudgement({ stills: session.stills, analysis: session.analysis }, run.signal);
      if (run !== judgeRun || !alive) return;
      const took = (performance.now() - judgeState.started) / 1000;
      console.info(`[judge] ${answer.ok ? `answered by ${answer.model}` : `no answer (${answer.code})`} after ${took.toFixed(1)} s`);
      if (answer.ok) {
        rememberSeconds(took);
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
  function bigNumber(value, max) {
    const num = h('span', { class: 'rw-score__num' }, String(value));
    if (animateScore && !reducedMotion()) {
      const started = performance.now();
      const animate = (now) => {
        if (!alive) return;
        const p = Math.min(1, (now - started) / 900);
        num.textContent = String(Math.round(value * (1 - (1 - p) ** 3)));
        if (p < 1) requestAnimationFrame(animate);
      };
      num.textContent = '0';
      requestAnimationFrame(animate);
    }
    animateScore = false;
    return h('p', { class: 'rw-score' }, num, h('span', { class: 'rw-score__max' }, `/${max}`));
  }

  function judgePrompt() {
    switch (judgeState.kind) {
      case 'preparing':
      case 'sending': {
        const block = h('div', { class: 'rw-judging' },
          h('div', { class: 'rw-judging__head' },
            h('p', { class: 'rw-judging__stage rw-working' }),
            button('Cancel', cancelJudge, { kind: 'quiet' })),
          h('progress', { max: 1, value: 0, 'aria-label': 'Judging progress' }),
          h('p', { class: 'rw-judging__left rw-muted rw-small' }));
        queueMicrotask(tickJudge);
        return block;
      }
      case 'failed':
        return h('div', { class: 'rw-stack' },
          h('p', { class: 'rw-error', role: 'alert' }, `No judgment this time. ${judgeState.message}`),
          button('Ask the judge again', runJudge));
      default:
    }
    if (!judgeInfo) return h('p', { class: 'rw-working' }, 'Checking for the judge.');
    if (!judgeInfo.ready) {
      return h('p', { class: 'rw-muted' }, judgeInfo.offline
        ? 'The judge cannot be reached from here, so this walk has its measured 70 points only.'
        : 'Gemini is not connected to this server yet, so this walk has its measured 70 points only.');
    }
    return h('div', { class: 'rw-stack' },
      h('p', null, h('strong', null, 'Want the other 30 points? '), 'About 12 cropped stills with the face pixelated would go to Google\'s Gemini. You must be 18 or older.', judgeInfo.paidTier ? '' : ' Google may use them to improve its products.'),
      button('I agree, judge my walk', () => { session.consent = true; runJudge(); }, { kind: 'solid' }));
  }

  function renderSummary() {
    clear(summary);
    const a = session.analysis;

    if (analysisState.kind === 'running') {
      summary.append(h('div', { class: 'rw-progress' },
        h('p', { class: 'rw-progress__label' }, analysisState.stage),
        h('progress', { max: 1, value: analysisState.done || 0, 'aria-label': 'Analysis progress' }),
        h('p', { class: 'rw-muted' }, 'This runs on this device. Your video stays here.'),
        button('Cancel', () => analysisRun?.abort())));
      return;
    }
    if (analysisState.kind === 'cancelled' || analysisState.kind === 'failed') {
      add(summary, h('div', { class: 'rw-stack' },
        analysisState.kind === 'failed'
          ? h('p', { class: 'rw-error', role: 'alert' }, `The analysis failed. ${analysisState.message}`)
          : h('p', null, 'Analysis cancelled.'),
        h('p', { class: 'rw-muted' }, 'Your recording is untouched.'),
        button('Run the analysis again', runAnalysis, { kind: 'solid' })));
      return;
    }
    if (!a) return;

    if (!a.measured.ok) {
      summary.append(
        h('p', { class: 'rw-noscore' }, 'We could not score this one.'),
        h('p', null, a.measured.reason),
        h('div', { class: 'rw-actions' }, button('Walk again', () => { app.discardCurrent = true; app.go('#/studio'); }, { kind: 'solid' })));
      return;
    }

    const total = currentTotal();
    const judge = session.judge?.ok ? session.judge : null;
    const grade = gradeFor(total ?? (a.measured.points / a.measured.max) * 100);
    add(summary,
      h('p', { class: 'rw-label' }, session.isSample ? 'Sample score, from synthetic data' : total !== null ? 'Your score' : 'Measured so far'),
      total !== null ? bigNumber(total, 100) : bigNumber(a.measured.points, a.measured.max),
      h('p', { class: 'rw-grade' }, grade.label),
      h('p', { class: 'rw-muted' }, grade.line),
      judge ? h('blockquote', { class: 'rw-verdict' }, judge.verdict) : judgePrompt(),
      judge?.match ? h('div', { class: 'rw-match' },
        h('p', { class: 'rw-label' }, 'Closest walk'),
        h('p', { class: 'rw-match__name' }, judge.match.name),
        h('p', { class: 'rw-match__tag' }, judge.match.tag),
        judge.match.why ? h('p', { class: 'rw-small' }, judge.match.why) : null) : null,
      a.measured.laps?.length > 1 ? h('div', { class: 'rw-focus' },
        h('p', { class: 'rw-label' }, `Based on ${a.measured.lapsUsed} of ${a.measured.laps.length} walks`),
        h('p', null, a.measured.laps.map((l) => (l.points === null ? `Walk ${l.number}: not usable` : `Walk ${l.number}: ${l.points}/70`)).join(' · '))) : null,
      a.measured.strength ? h('div', { class: 'rw-focus' },
        h('p', { class: 'rw-label' }, `Your strongest part: ${a.measured.strength.label}, ${a.measured.strength.points} of ${a.measured.strength.max}`),
        h('p', null, a.measured.strength.note)) : null,
      a.measured.focus ? h('div', { class: 'rw-focus' },
        h('p', { class: 'rw-label' }, `Your biggest win: ${a.measured.focus.label}, up to ${a.measured.focus.gain} more points`),
        h('p', null, a.measured.focus.tip)) : null,
      judge?.tip ? h('div', { class: 'rw-focus' }, h('p', { class: 'rw-label' }, 'The judge suggests'), h('p', null, judge.tip)) : null,
    );
  }

  function renderBreakdown() {
    clear(breakdownPanel);
    const a = session.analysis;
    if (!a?.measured?.ok || analysisState.kind === 'running') return;
    add(breakdownPanel, breakdown(a.measured, session.judge?.ok ? session.judge : null, { sample: session.isSample, model: session.judge?.model, calibrated: a.metrics.calibrated }));
    clear(momentsPanel);
    add(momentsPanel, momentsList(session.judge?.moments, (t) => player?.seek(t)));
  }

  function renderRibbon() {
    clear(ribbon);
    const a = session.analysis;
    if (!a?.duration) {
      ribbon.hidden = true;
      ribbonKey.hidden = true;
      return;
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
    ribbon.hidden = !ribbon.children.length;
    ribbonKey.hidden = ribbon.hidden;
  }

  function metricCard(metric) {
    const info = METRIC_INFO[metric.key];
    return h('article', { class: 'rw-metric' },
      h('h3', null, info.title),
      metric.ok
        ? h('p', { class: 'rw-metric__value' }, String(metric.value), h('small', null, ` ${metric.unit}`))
        : h('p', { class: 'rw-metric__none' }, 'Not enough data'),
      h('p', { class: 'rw-small' }, metric.ok ? info.reads : metric.why),
      h('details', { class: 'rw-small' },
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
    const stills = session.stills?.length ? h('section', { class: 'rw-block' },
      h('h3', null, 'What Gemini saw'),
      h('p', { class: 'rw-muted' }, `These ${session.stills.length} stills are the only images that left this device. Each is cropped to the walker with the head pixelated. Other people caught inside the crop are not pixelated.`),
      h('div', { class: 'rw-stills' }, session.stills.map((s) => h('button', { type: 'button', class: 'rw-still', onClick: () => player?.seek(s.t), 'aria-label': `Go to ${fmtTime(s.t)}` },
        h('img', { src: s.dataUrl, alt: `Pixelated still at ${fmtTime(s.t)}` }),
        h('span', null, fmtTime(s.t)))))) : null;

    const canDownload = session.blob && !session.isSample;
    add(detailsPanel, h('details', { class: 'rw-details', open: !a.measured.ok },
      h('summary', null, 'The numbers behind this'),
      h('div', { class: 'rw-coverage' },
        h('h3', null, 'Tracking coverage'),
        h('p', null, h('strong', null, `${Math.round(coverage.ratio * 100)}%`), ` of the sampled walking frames were usable: ${coverage.valid} of ${coverage.sampled}, or ${coverage.validSeconds} s.`),
        a.metrics.stepCount ? h('p', null, `${a.metrics.stepCount} footsteps found${a.metrics.cadence ? `, at ${a.metrics.cadence} steps a minute` : ''}.`) : null,
        a.phases.shape === 'up-and-back' ? null : h('p', { class: 'rw-muted' }, a.phases.shape === 'none'
          ? 'No walk toward or away from the camera was detected, so the whole clip was described.'
          : `Only one direction of walking was detected (${a.phases.shape}).`),
        counts.length ? h('ul', { class: 'rw-counts' }, counts.map(([status, n]) => h('li', null, h('span', null, STATUS_WORDS[status] || status), h('span', { class: 'rw-bar__num' }, String(n))))) : null,
        a.tracker ? h('p', { class: 'rw-muted rw-small' }, `Tracked with ${a.tracker} on the ${a.delegate}${a.samplesPerSecond ? `, ${a.samplesPerSecond} samples a second` : ''}.${a.reader === 'decoded' ? ' Every frame was read directly from the file.' : a.reader ? ' This browser could not read the file directly, so some frames may have been missed.' : ''}`) : null,
        session.setup?.music ? h('p', { class: 'rw-muted rw-small' }, `Walked to "${session.setup.music.title}"${session.setup.music.bpm && a.metrics.cadence ? `, about ${session.setup.music.bpm} beats a minute. You took ${a.metrics.cadence} steps a minute.` : '.'}`) : null,
        session.setup?.width ? h('p', { class: 'rw-muted rw-small' }, `Recorded at ${session.setup.width} × ${session.setup.height}. The camera reported ${Math.round(session.setup.reportedFps ?? 0)} fps, and ${session.setup.measuredFps ? `${session.setup.measuredFps.toFixed(1)} fps` : 'an unknown rate'} reached the page.`) : null),
      h('p', { class: 'rw-muted' }, `These describe movement in the picture (${version}). Camera tilt, camera movement and lens perspective all affect them. The score is a game, and the rules that turn these numbers into points are ours, not a verdict on anyone's technique.`),
      a.stance?.noise ? h('p', { class: 'rw-muted' }, `The smallest movement this setup can honestly see: with you standing still, the tracker wobbled by ${a.stance.noise.shoulderSway}° at the shoulders and ${a.stance.noise.bounce}% of your height up and down. Anything smaller cannot be told apart from noise, so that much is taken off your sway and bounce.`) : null,
      h('div', { class: 'rw-metrics' }, Object.keys(METRIC_INFO).filter((key) => a.metrics[key] && (a.metrics[key].ok || !/Drop|headTilt/.test(key) || a.metrics.calibrated)).map((key) => metricCard({ ...a.metrics[key], key }))),
      stills,
      canDownload ? h('div', { class: 'rw-actions' },
        button('Save the video file', () => {
          const url = URL.createObjectURL(session.blob);
          const link = h('a', { href: url, download: recordingName(session) });
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 10_000);
        }),
        !session.wallPost ? button('Rotate video and analyze again', () => {
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
        }) : null) : null));
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
    wallPanel.append(h('h2', null, 'Post it to the wall'));
    const problem = wallState.kind === 'failed' ? h('p', { class: 'rw-error', role: 'alert' }, wallState.message) : null;

    if (session.wallPost) {
      add(wallPanel,
        h('p', null, 'This walk is on the wall.'),
        wallState.unverified ? h('p', { class: 'rw-muted rw-small' }, 'It shows the measured half only, because the server could not verify the judge\'s result.') : null,
        wallState.signedOut ? h('p', { class: 'rw-muted rw-small' }, 'You have been signed out, so the next walker starts fresh.') : null,
        problem,
        h('div', { class: 'rw-actions' },
          h('a', { class: 'rw-btn rw-btn--solid', href: `#/wall/${session.wallPost.id}` }, 'See it on the wall'),
          button(wallState.kind === 'posting' ? 'Removing' : 'Remove from the wall', onRemovePost, { kind: 'quiet', disabled: wallState.kind === 'posting' })));
      return;
    }
    if (!wallStatus) {
      wallPanel.append(h('p', { class: 'rw-muted' }, 'Checking for the wall.'));
      return;
    }
    if (!wallStatus.ready) {
      wallPanel.append(h('p', { class: 'rw-muted' }, 'The wall is not connected on this server. You can still save this walk on this device.'));
      return;
    }
    if (busy) {
      wallPanel.append(h('p', { class: 'rw-muted' }, 'You can post once judging has finished.'));
      return;
    }
    const posting = wallState.kind === 'posting';
    const needsSignIn = wallStatus.auth && !wallStatus.signedIn;
    if (!postName.value && wallStatus.name) postName.value = wallStatus.name;
    add(wallPanel,
      h('p', null, 'Everyone will see your name, score, the judge\'s words and your skeleton\'s movement. Never the video or any photo.'),
      wallStatus.store === 'local' ? h('p', { class: 'rw-muted rw-small' }, 'This is the local test wall, so posts stay on this computer for now.') : null,
      !session.judge?.ok ? h('p', { class: 'rw-muted rw-small' }, 'Not judged, so this posts the measured half only.') : null,
      h('label', { class: 'rw-field', for: 'rw-post-name' }, h('span', null, 'Name to show'), postName),
      h('p', { class: 'rw-muted rw-small' }, 'A first name or nickname is enough.'),
      h('label', { class: 'rw-check' }, postConsent, h('span', null, 'I am 18 or older, and I agree to this being public. I can remove it later.')),
      problem,
      h('div', { class: 'rw-actions' },
        button(posting ? 'Posting' : needsSignIn ? 'Sign in and post' : 'Post to the wall', onPost, { kind: 'solid', disabled: posting })),
      wallStatus.auth ? h('p', { class: 'rw-muted rw-small' }, 'Sign-in opens in a new window. It only asks for your name, not your email.') : null,
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

  // ── build ──
  function build() {
    nameInput.value = session.name;
    if (session.isSample) nameInput.readOnly = true;
    player = session.isSample
      ? createPlayer({ analysis: session.analysis, badge: 'Synthetic figure, not a recording', label: 'A synthetic stick figure walking toward the camera, turning and walking back' })
      : createPlayer({ blob: session.blob, analysis: session.analysis, rotation: session.rotation || 0, label: `Replay of ${session.name}` });
    playerSlot.append(player.el);

    clear(root);
    if (session.isSample) {
      root.append(h('p', { class: 'rw-banner' }, h('strong', null, 'This is a sample. '), 'The figure and its movement are generated by code, and the judge text is written by hand. No camera, tracker or Gemini was involved, and nobody was measured.'));
    }
    root.append(
      h('div', { class: 'rw-reviewhead' },
        h('div', { class: 'rw-reviewhead__name' },
          statusPill,
          h('h1', { class: 'rw-sr', tabindex: '-1' }, `Review: ${session.name}`),
          nameInput),
        actions),
      h('div', { class: 'rw-result' },
        h('div', { class: 'rw-result__media' }, playerSlot, ribbon, ribbonKey, announce),
        summary),
      breakdownPanel,
      momentsPanel,
      wallPanel,
      detailsPanel,
    );

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

    if (!session.saved) copyToThisComputer(session);
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
        if (alive) clear(root).append(h('p', { class: 'rw-error' }, `This walk could not be opened. ${err.message}`));
        return;
      }
    }
    if (!alive) return;
    if (!session) {
      clear(root).append(h('div', { class: 'rw-empty' },
        h('h1', { tabindex: '-1' }, 'This walk is not here'),
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
