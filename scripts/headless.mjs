// A headless Chrome running this site's own code on a private local server. The analyzer uses it to run the real
// tracker on clips, and the reel maker also uses it to draw title cards and skeletons as transparent PNGs.
// Clips are served only to this Chrome, on this computer.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startDevServer } from './dev.mjs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGE = `<!doctype html><meta charset="utf-8"><title>headless</title>
<link rel="stylesheet" href="/src/fonts.css">
<style>html,body{margin:0;background:transparent}</style>
<body><script type="module">
import { analyzeVideo } from '/src/pose/analyze.mjs';
window.analyze = async (clip, hz, rotation) => {
  const blob = await (await fetch(clip)).blob();
  const started = performance.now();
  const out = await analyzeVideo(blob, { base: location.origin + '/', hz, rotation, onProgress: () => {} });
  return { ...out, seconds: (performance.now() - started) / 1000 };
};
window.ready = true;
</script></body>`;

/** @param {string[]} clips  Paths of the video files this Chrome may read, as /clip0.mp4, /clip1.mov and so on. */
export async function openHeadless(clips = [], { port = 4778 } = {}) {
  const htmlFile = path.join(os.tmpdir(), `headless-${process.pid}.html`);
  fs.writeFileSync(htmlFile, PAGE);
  const extraFiles = { '/headless.html': htmlFile };
  const clipUrls = clips.map((clip, i) => {
    const url = `/clip${i}${path.extname(clip).toLowerCase()}`;
    extraFiles[url] = clip;
    return url;
  });

  process.env.RUNWAYLAB_NO_ENV_FILE = '1';
  const server = await startDevServer({ port, quiet: true, extraFiles });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'headless-chrome-'));
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1080,1920', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--enable-unsafe-webgpu', '--autoplay-policy=no-user-gesture-required'], { stdio: 'ignore' });
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

  await send('Runtime.enable');
  await send('Page.navigate', { url: `http://127.0.0.1:${port}/headless.html` });
  for (let i = 0; i < 100 && !(await evaluate('window.ready === true').catch(() => false)); i++) await sleep(100);

  return {
    /** Runs the app's real tracker on clip number i. */
    analyze: (i, hz = 60, rotation = 0) => evaluate(`analyze(${JSON.stringify(clipUrls[i])}, ${hz}, ${rotation})`),

    /** Draws an HTML fragment at width x height and saves it as a PNG with a transparent background. */
    async png(html, width, height, file) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
      await evaluate(`(async () => { document.body.innerHTML = ${JSON.stringify(html)}; await document.fonts.ready; await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); })()`);
      const { result } = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width, height, scale: 1 } });
      fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
    },

    close() {
      ws.close();
      chrome.kill();
      server.close();
      server.closeAllConnections?.();
      fs.rmSync(htmlFile, { force: true });
      try {
        fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      } catch {
        // Chrome may still be writing as it exits. The system clears temporary folders anyway.
      }
    },
  };
}
