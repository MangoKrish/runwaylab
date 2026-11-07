// Runs real clips through the real tracker and measuring code, and prints every number behind the score.
// This is the tool for tuning the rules in src/lib/score.mjs against real walks. From the project folder:
//   node scripts/analyze-clip.mjs walk1.mov walk2.mov
// Add ROTATE=90 for a clip that was filmed sideways. Clips stay on this computer: nothing goes to Gemini.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startDevServer } from './dev.mjs';
import { processFrames } from '../src/lib/process.mjs';

const clips = process.argv.slice(2);
if (!clips.length) {
  console.log('Usage: node scripts/analyze-clip.mjs <clip> [<clip> ...]');
  process.exit(1);
}
const HZ = Number(process.env.HZ) || 60;
const ROTATE = Number(process.env.ROTATE) || 0;
const TRACKER = process.env.TRACKER || 'rtmpose';
const PORT = 4778;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const htmlFile = path.join(os.tmpdir(), `analyze-${process.pid}.html`);
fs.writeFileSync(htmlFile, `<!doctype html><meta charset="utf-8"><title>analyze</title><script type="module">
import { createTracker } from '/src/pose/tracker.mjs';
import { analyzeVideo } from '/src/pose/analyze.mjs';
window.analyze = async (clip, hz, rotation) => {
  const blob = await (await fetch(clip)).blob();
  const started = performance.now();
  const out = await analyzeVideo(blob, { base: location.origin + '/', hz, rotation, onProgress: () => {} });
  return { ...out, seconds: (performance.now() - started) / 1000 };
};
window.ready = true;
</script>`);
const extraFiles = { '/analyze.html': htmlFile };
clips.forEach((clip, i) => { extraFiles[`/clip${i}${path.extname(clip).toLowerCase()}`] = clip; });

process.env.RUNWAYLAB_NO_ENV_FILE = '1';
const server = await startDevServer({ port: PORT, quiet: true, extraFiles });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-chrome-'));
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=900,700', '--no-first-run', '--no-default-browser-check', '--enable-unsafe-webgpu', '--autoplay-policy=no-user-gesture-required'], { stdio: 'ignore' });
const portFile = path.join(profile, 'DevToolsActivePort');
for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) await sleep(100);
const debugPort = fs.readFileSync(portFile, 'utf8').split('\n')[0];
const target = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  } else if (msg.method === 'Runtime.exceptionThrown') {
    console.log('page error:', msg.params.exceptionDetails.exception?.description?.slice(0, 400));
  }
});
const send = (method, params = {}) => new Promise((resolve) => {
  const n = ++id;
  pending.set(n, resolve);
  ws.send(JSON.stringify({ id: n, method, params }));
});
const evaluate = async (expression) => {
  const { result } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
};

const show = (m) => (m?.ok ? m.value : 'n/a');
try {
  await send('Runtime.enable');
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/analyze.html` });
  for (let i = 0; i < 100 && !(await evaluate('window.ready === true').catch(() => false)); i++) await sleep(100);

  for (let i = 0; i < clips.length; i++) {
    const clipUrl = `/clip${i}${path.extname(clips[i]).toLowerCase()}`;
    const out = await evaluate(`analyze(${JSON.stringify(clipUrl)}, ${HZ}, ${ROTATE})`);
    const r = processFrames(out.raw, { W: out.W, H: out.H, duration: out.duration });
    const m = r.metrics;
    console.log(`\n=== ${path.basename(clips[i])}: ${out.W}x${out.H}, ${out.duration.toFixed(1)} s, ${out.raw.length} samples, analyzed in ${out.seconds.toFixed(1)} s by ${out.tracker} on ${out.delegate}, read by ${out.reader}`);
    console.log(`walk: ${r.phases.shape}, size change up ${r.phases.rise} and back ${r.phases.fall}; approach ${r.phases.approach}, turn ${r.phases.turn}, back ${r.phases.back}`);
    console.log(`coverage: ${Math.round(m.coverage.ratio * 100)}% of ${m.coverage.sampled} frames, ${m.coverage.validSeconds} s; ${JSON.stringify(m.coverage.counts)}`);
    console.log(`laps found: ${r.laps.length}; calibrated: ${r.stance ? `yes, ${r.stance.seconds} s, height ${r.stance.heightRatio} torso lengths, noise ${JSON.stringify(r.stance.noise)}` : 'no'}; steps ${m.stepCount}, cadence ${m.cadence}/min`);
    if (r.measured.laps) console.log(`lap scores: ${r.measured.laps.map((l) => l.points ?? 'unusable').join(', ')}`);
    console.log(`feet ${show(m.footLine)} | rhythm ${show(m.stepRhythm)} | pace ${show(m.pace)} | shoulder sway ${show(m.shoulderSway)} | trunk sway ${show(m.trunkSway)} | bounce ${show(m.bounce)}`);
    console.log(`neck ${show(m.neck)} (drop ${show(m.neckDrop)}) | chin ${show(m.gaze)} (drop ${show(m.gazeDrop)}) | line ${show(m.torsoSpread)} | head ${show(m.headMovement)} | arms ${show(m.armSwing)} balance ${show(m.armBalance)} | turn ${show(m.turnTime)} s wobble ${show(m.turnWobble)}`);
    if (r.measured.ok) {
      console.log(`SCORE ${r.measured.points}/${r.measured.max}: ${r.measured.parts.map((p) => `${p.label} ${p.points}/${p.max}`).join(', ')}`);
    } else {
      console.log(`NO SCORE: ${r.measured.reason}`);
    }
  }
} finally {
  ws.close();
  chrome.kill();
  server.close();
  server.closeAllConnections?.();
  fs.rmSync(htmlFile, { force: true });
}
process.exit(0);
