// Compares pose trackers on the same real clip in real Chrome. Run from the project folder:
//   node scripts/bench-trackers.mjs <out-folder> <clip> [<clip> ...]
// Clips and results stay on this computer.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startDevServer } from './dev.mjs';

const [outDir, ...clips] = process.argv.slice(2);
if (!outDir || !clips.length) {
  console.log('Usage: node scripts/bench-trackers.mjs <out-folder> <clip> [<clip> ...]');
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });
const TRACKERS = (process.env.TRACKERS || 'mediapipe-full,rtmpose-m').split(',');
const HZ = Number(process.env.BENCH_HZ) || 15;
const SECONDS = Number(process.env.BENCH_SECONDS) || 24;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 4777;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const extraFiles = {
  '/bench.html': null,
};
const htmlFile = path.join(os.tmpdir(), `bench-${process.pid}.html`);
fs.writeFileSync(htmlFile, '<!doctype html><meta charset="utf-8"><title>bench</title><script type="module" src="/scripts/bench/bench.mjs"></script>');
extraFiles['/bench.html'] = htmlFile;
if (process.env.RTMW_MODEL) extraFiles['/rtmw.onnx'] = process.env.RTMW_MODEL; // Too large for the repo.
clips.forEach((clip, i) => { extraFiles[`/clip${i}${path.extname(clip)}`] = clip; });

process.env.RUNWAYLAB_NO_ENV_FILE = '1';
const server = await startDevServer({ port: PORT, quiet: true, extraFiles });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-chrome-'));
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1200,900', '--no-first-run', '--no-default-browser-check', '--enable-unsafe-webgpu', '--autoplay-policy=no-user-gesture-required'], { stdio: 'ignore' });

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
    console.log('page error:', msg.params.exceptionDetails.exception?.description?.slice(0, 300));
  } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    console.log('console error:', String(msg.params.args[0]?.value).slice(0, 300));
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

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/bench.html` });
  for (let i = 0; i < 100 && !(await evaluate('window.benchReady === true').catch(() => false)); i++) await sleep(100);
  console.log('WebGPU adapter:', await evaluate('navigator.gpu ? navigator.gpu.requestAdapter().then((a) => a ? (a.info?.vendor + " " + a.info?.architecture) : "none") : "no navigator.gpu"'));

  for (let i = 0; i < clips.length; i++) {
    const name = path.basename(clips[i]).replace(/\.[^.]+$/, '');
    const times = (process.env.SHEET_TIMES || '1.5,5,7,9.5,12,15,18,21').split(',').map(Number);
    const out = await evaluate(`runBench(${JSON.stringify({ clip: `/clip${i}${path.extname(clips[i])}`, hz: HZ, seconds: SECONDS, trackers: TRACKERS, sheetTimes: times })})`);
    console.log(`\n${name} (${out.W}x${out.H}, ${HZ} Hz)`);
    console.table(out.results);
    for (const [tracker, url] of Object.entries(out.sheets)) {
      fs.writeFileSync(path.join(outDir, `${name}-${tracker}.jpg`), Buffer.from(url.split(',')[1], 'base64'));
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
