// The whole app in real Chrome, with the real tracker. Run from the project folder:
//   node test/e2e.mjs [--clip path/to/real-walk.mp4] [--shots folder]
//
// What is real here: Chrome, the pose tracker, IndexedDB, MediaRecorder and the local server. What is not: the
// camera is Chrome's fake device playing a file, and Gemini and Auth0 are fakes on localhost, so this proves
// nothing about those services. Without --clip, the "person" is a still photo scaled up and down to mimic
// walking. It tests the plumbing, not whether the scoring suits real walks.
// It never reads .env.local, so it cannot reach a real key or a real wall.
import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argOf = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const realClip = argOf('--clip');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'runway-e2e-'));
const SHOTS = argOf('--shots') || path.join(WORK, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 4677;
const PAGE = `http://127.0.0.1:${PORT}/`;

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  return ok;
};
const section = (name) => console.log(`\n${name}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── fixtures ──
function ff(...args) {
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });
}
async function makeFixtures() {
  const fx = {
    noPerson: path.join(WORK, 'no-person.mp4'),
    corrupt: path.join(WORK, 'corrupt.mp4'),
    notVideo: path.join(WORK, 'notes.txt'),
    person: path.join(WORK, 'person.mp4'),
    sideways: path.join(WORK, 'sideways.mp4'),
    camera: path.join(WORK, 'camera.mjpeg'),
    image: path.join(WORK, 'pose.jpg'),
  };
  ff('-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30:d=6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', fx.noPerson);
  fs.writeFileSync(fx.corrupt, Buffer.alloc(200000, 7));
  fs.writeFileSync(fx.notVideo, 'not a video');

  const res = await fetch('https://storage.googleapis.com/mediapipe-assets/pose.jpg');
  fs.writeFileSync(fx.image, Buffer.from(await res.arrayBuffer()));
  // Small, grows, holds, shrinks: the size signal a walk up and back produces.
  const scale = "trunc(1067*if(lt(t,4.5),0.45+0.55*t/4.5,if(lt(t,5.5),1,1-0.55*(t-5.5)/4.5))/2)*2";
  ff('-loop', '1', '-t', '10', '-r', '30', '-i', fx.image, '-f', 'lavfi', '-i', 'color=c=0x444444:s=1280x720:r=30:d=10',
    '-filter_complex', `[0:v]scale=w='${scale}':h=-2:eval=frame[s];[1:v][s]overlay=x='(W-w)/2':y='(H-h)/2':eval=frame:shortest=1,format=yuv420p`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', fx.person);
  ff('-i', fx.person, '-vf', 'transpose=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', fx.sideways);
  // For the fake camera: stand still for a while, then the same walk, looping.
  ff('-loop', '1', '-t', '5', '-r', '30', '-i', fx.image, '-f', 'lavfi', '-i', 'color=c=0x444444:s=1280x720:r=30:d=5',
    '-filter_complex', '[0:v]scale=480:-2[s];[1:v][s]overlay=x=(W-w)/2:y=(H-h)/2:shortest=1,format=yuv420p', '-c:v', 'libx264', path.join(WORK, 'still.mp4'));
  fs.writeFileSync(path.join(WORK, 'list.txt'), `file '${path.join(WORK, 'still.mp4')}'\nfile '${fx.person}'\n`);
  ff('-f', 'concat', '-safe', '0', '-i', path.join(WORK, 'list.txt'), '-q:v', '6', '-r', '30', fx.camera);
  return fx;
}

// ── a fake Gemini, so no footage goes anywhere ──
const FAKE_ANSWER = { judgeable: true, presence: 15, presenceWhy: 'Fake: steady intent.', style: 13, styleWhy: 'Fake: bold choice.', match: 'tougaard', matchWhy: 'Fake: an even glide.', verdict: 'Fake verdict from the test server.', tip: 'Fake tip.', moments: [{ still: 2, note: 'Fake note.' }] };
const gemini = { requests: [], reply: null };
const fakeGemini = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (d) => chunks.push(d));
  req.on('end', () => {
    gemini.requests.push({ url: req.url, body: JSON.parse(Buffer.concat(chunks).toString()) });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(gemini.reply ?? FAKE_ANSWER) }] }, finishReason: 'STOP' }] }));
  });
});

// ── a fake Auth0: signs everyone in as one test person ──
const auth0Log = { authorize: 0, token: 0, lastQuery: null, nonce: null };
const fakeAuth0 = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/authorize') {
    auth0Log.authorize++;
    auth0Log.lastQuery = url.searchParams;
    auth0Log.nonce = url.searchParams.get('nonce');
    const back = new URL(url.searchParams.get('redirect_uri'));
    back.searchParams.set('code', 'fake-code');
    back.searchParams.set('state', url.searchParams.get('state'));
    res.writeHead(302, { Location: back.href });
    res.end();
    return;
  }
  if (url.pathname === '/oauth/token') {
    auth0Log.token++;
    const encode = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
    const claims = { iss: `http://127.0.0.1:${fakeAuth0.address().port}/`, aud: 'e2e-client', exp: Date.now() / 1000 + 300, nonce: auth0Log.nonce, sub: 'auth0|e2e-person', given_name: 'Sam' };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id_token: `${encode({ alg: 'none' })}.${encode(claims)}.sig` }));
    return;
  }
  res.writeHead(404);
  res.end();
});

// ── a minimal Chrome DevTools client ──
const BONE_PIXELS = `(() => { const c = document.querySelector('.rw-player__canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - 242) < 14 && Math.abs(d[i + 1] - 195) < 14 && Math.abs(d[i + 2] - 139) < 14) n++; return n; })()`;

class Tab {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.dialogAccept = true;
    this.dialogs = [];
    this.errors = [];
    this.external = [];
    this.attempts = [];
    ws.addEventListener('message', (e) => this.onMessage(JSON.parse(e.data)));
  }

  onMessage(msg) {
    if (msg.id) {
      const p = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result);
    } else if (msg.method === 'Page.javascriptDialogOpening') {
      this.dialogs.push(msg.params.message);
      this.send('Page.handleJavaScriptDialog', { accept: this.dialogAccept }).catch(() => {});
    } else if (msg.method === 'Runtime.exceptionThrown') {
      this.errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    } else if (msg.method === 'Network.requestWillBeSent') {
      const u = new URL(msg.params.request.url);
      if (!['127.0.0.1', 'localhost'].includes(u.hostname) && !['data:', 'blob:'].includes(u.protocol)) this.attempts.push(u.href);
    } else if (msg.method === 'Network.responseReceived') {
      // A response means the request really left. Requests the page's policy blocks never get here.
      const u = new URL(msg.params.response.url);
      if (!['127.0.0.1', 'localhost'].includes(u.hostname) && !['data:', 'blob:'].includes(u.protocol)) this.external.push(u.href);
    }
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async js(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }

  async until(expression, what, timeout = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (await this.js(expression).catch(() => false)) return true;
      await sleep(150);
    }
    console.log(`        timed out waiting for: ${what}`);
    return false;
  }

  text() { return this.js('document.querySelector("#rw-root").innerText'); }
  /** Includes folded-away details, which innerText leaves out. */
  fullText() { return this.js('document.querySelector("#rw-root").textContent'); }
  hasText(t) { return `document.querySelector("#rw-root").innerText.toLowerCase().includes(${JSON.stringify(t.toLowerCase())})`; }

  clickButton(label) {
    return this.js(`(() => { const b = [...document.querySelectorAll('#rw-root button, #rw-root a')].find((x) => x.textContent.trim() === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true; })()`);
  }

  async upload(selector, file) {
    const { result } = await this.send('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(selector)})` });
    await this.send('DOM.setFileInputFiles', { objectId: result.objectId, files: [file] });
  }

  async go(hash) {
    await this.js(`location.hash = ${JSON.stringify(hash)}`);
    await sleep(150);
  }

  /** Waits for the new page, so the old page's text cannot satisfy the next check. */
  async reload() {
    await this.js('window.__stale = true');
    await this.send('Page.reload');
    await this.until('!window.__stale && document.readyState === "complete"', 'page reload', 15000);
  }

  async shot(name, fullPage = false) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: fullPage });
    fs.writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(data, 'base64'));
  }
}

// ── the run ──
async function main() {
  console.log(`Fixtures and screenshots: ${WORK}`);
  const fx = await makeFixtures();
  await new Promise((r) => fakeGemini.listen(0, '127.0.0.1', r));
  process.env.GEMINI_BASE_URL = `http://127.0.0.1:${fakeGemini.address().port}`;
  delete process.env.GEMINI_API_KEY;
  process.env.RUNWAYLAB_NO_ENV_FILE = '1';
  process.env.WALL_DEV_FILE = path.join(WORK, 'wall.json');
  // Set DATABASE_URL to run the wall section on a real, empty database instead of the local file.
  const usingDb = !!process.env.DATABASE_URL;

  const { startDevServer } = await import(path.join(HERE, '..', 'scripts', 'dev.mjs'));
  const server = await startDevServer({ port: PORT, quiet: true });

  const profile = path.join(WORK, 'profile');
  const chrome = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1440,1000',
    '--no-first-run', '--no-default-browser-check', '--enable-unsafe-webgpu', '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${fx.camera}`,
  ], { stdio: 'ignore' });

  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) await sleep(100);
  const debugPort = fs.readFileSync(portFile, 'utf8').split('\n')[0];
  const target = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  const tab = new Tab(ws);
  for (const domain of ['Page', 'Runtime', 'Network', 'DOM']) await tab.send(`${domain}.enable`);
  await tab.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });

  const stillsFolder = path.join(WORK, 'stills');
  const analysisDone = `!document.querySelector('.rw-progress') && !!document.querySelector('.rw-coverage')`;
  const openWalk = async (file = realClip || fx.person) => {
    await tab.go('#/studio');
    await tab.until('!!document.querySelector("#rw-upload")', 'upload input');
    await sleep(300);
    await tab.upload('#rw-upload', file);
    await tab.until(`location.hash.startsWith('#/review/')`, 'review page', 15000);
    await sleep(200);
    return tab.until(analysisDone, 'analysis', 180000);
  };
  const fillPost = (name, consent = true) => tab.js(`(() => { const i = document.querySelector('#rw-post-name'); i.value = ${JSON.stringify(name)}; const c = i.closest('section').querySelector('input[type=checkbox]'); c.checked = ${consent}; })()`);
  // The two halves' sums, and whether the measured one matches its bars. A part that was not seen has no points, and
  // then the rest are scaled up to 70, which the page says in words.
  const barTotal = () => tab.js(`[...document.querySelectorAll('.rw-breakdown__sum')].reduce((sum, el) => sum + parseInt(el.textContent), 0)`);
  const measuredBarsAgree = () => tab.js(`(() => {
    const group = document.querySelector('.rw-breakdown__group');
    const sum = parseInt(group.querySelector('.rw-breakdown__sum').textContent);
    const bars = [...group.querySelectorAll('.rw-bar__num')].map((el) => el.textContent);
    const seen = bars.filter((t) => t !== 'Not seen').map((t) => t.split('/').map(Number));
    const earned = seen.reduce((total, [points]) => total + points, 0);
    const max = seen.reduce((total, [, top]) => total + top, 0);
    const scaledNote = group.textContent.includes('left out rather than marked down');
    return Math.round((earned * 70) / max) === sum && scaledNote === (max < 70);
  })()`);

  try {
    // ── home ──
    section('Home');
    await tab.send('Page.navigate', { url: PAGE });
    check('app starts', await tab.until(tab.hasText('Get judged'), 'home heading'));
    check('empty state for saved walks', await tab.until(tab.hasText('The runway is empty'), 'empty state'));
    check('uses Be Vietnam Pro everywhere', await tab.js(`document.fonts.ready.then(() => getComputedStyle(document.body).fontFamily.includes('Be Vietnam Pro') && [...document.fonts].some((f) => f.family.includes('Be Vietnam Pro') && f.status === 'loaded'))`));
    await tab.shot('home');

    // ── sample ──
    section('Sample walk, no camera');
    await tab.go('#/review/sample');
    check('opens', await tab.until(tab.hasText('This is a sample'), 'sample banner'));
    await tab.until('!!document.querySelector(".rw-score__num")', 'score', 5000);
    let text = await tab.text();
    check('labeled as synthetic', text.includes('Synthetic figure') && text.includes('Sample: synthetic data'));
    check('judge text labeled as hand-written', text.includes('written by hand'));
    check('shows a sample score', /Sample score, from synthetic data\s*\d+/i.test(text));
    check('offers no save', !text.includes('Save to this device'));
    check('says how many walks it used', text.includes('Based on 2 of 2 walks'));
    const before = await tab.js('document.querySelector("#rw-root input[type=range]").value');
    await sleep(600);
    const after = await tab.js('document.querySelector("#rw-root input[type=range]").value');
    check('playback advances', Number(after) !== Number(before), `${before} to ${after}`);
    await tab.js(`document.querySelectorAll('.rw-moments button')[1].click()`);
    await sleep(120);
    const seeked = await tab.js('document.querySelector("#rw-root input[type=range]").value');
    check('a moment seeks playback', Math.abs(Number(seeked) - 4.6) < 0.05, seeked);
    const skeletonOn = await tab.js(BONE_PIXELS);
    await tab.js(`document.querySelector('.rw-check--plain input').click()`);
    await sleep(120);
    const skeletonOff = await tab.js(BONE_PIXELS);
    check('skeleton toggle works', skeletonOn > 50 && skeletonOff === 0, `${skeletonOn} then ${skeletonOff}`);
    await tab.js(`document.querySelector('.rw-check--plain input').click()`);
    check('no stray "null" or "undefined"', !/\b(null|undefined)\b/.test(await tab.text()));
    await tab.shot('sample');
    await tab.shot('sample-full', true);

    // ── upload refusals ──
    section('Upload checks');
    await tab.go('#/studio');
    await tab.until('!!document.querySelector("#rw-upload")', 'upload input');
    await tab.upload('#rw-upload', fx.notVideo);
    check('refuses a non-video', await tab.until(tab.hasText('Please choose an MP4, MOV or WebM'), 'type refusal', 5000));
    await tab.upload('#rw-upload', fx.corrupt);
    check('refuses a corrupt file', await tab.until(`/damaged|cannot play/.test(document.querySelector("#rw-root").innerText)`, 'corrupt refusal', 15000));
    await tab.go('#/');

    // ── no person ──
    section('A clip with no person in it, real tracker');
    await tab.go('#/studio');
    await tab.until('!!document.querySelector("#rw-upload")', 'upload input');
    await tab.upload('#rw-upload', fx.noPerson);
    check('every recording is kept without asking', await tab.until(tab.hasText('Saved on this device'), 'saved pill', 15000));
    check('honest no-score result', await tab.until(tab.hasText('We could not score this one'), 'no-score result', 120000));
    text = await tab.text();
    check('says no person was found', text.includes('could not find a person'));
    check('no invented measurements', (text.match(/Not enough data/g) || []).length >= 8, `${(text.match(/Not enough data/g) || []).length} cards`);
    await tab.shot('no-person');
    tab.dialogs.length = 0;
    await tab.js(`location.hash = '#/history'`);
    check('leaving a kept walk needs no warning', await tab.until(`location.hash === '#/history'`, 'history route', 3000) && !tab.dialogs.some((d) => d.includes('not saved')));
    await sleep(300);

    // ── cancel ──
    section('Cancel and retry');
    await tab.go('#/studio');
    await tab.until('!!document.querySelector("#rw-upload")', 'upload input');
    await tab.upload('#rw-upload', realClip || fx.person);
    await tab.until(`!!document.querySelector('.rw-progress')`, 'progress', 15000);
    check('progress and cancel appear', await tab.clickButton('Cancel'));
    check('cancel leaves the recording alone', await tab.until(tab.hasText('Your recording is untouched'), 'cancelled state', 15000));
    check('video still present after cancel', await tab.js(`!!document.querySelector('.rw-player__video').currentSrc`));

    // ── full analysis ──
    section(`Upload to analysis, real tracker on ${realClip ? 'the real clip' : 'a scaled still photo'}`);
    const analyzeStarted = Date.now();
    await tab.clickButton('Run the analysis again');
    check('analysis finishes', await tab.until(analysisDone, 'analysis result', 180000), `${((Date.now() - analyzeStarted) / 1000).toFixed(1)} s for a 10 s clip`);
    const full = await tab.fullText();
    const coverage = full.match(/(\d+)% of the sampled walking frames/);
    check('reports coverage', !!coverage, coverage?.[0]);
    const measured = /Measured so far|Your score/i.test(await tab.text());
    console.log(`        tracker: ${(full.match(/Tracked with ([^.]+)\./) || [])[1]}`);
    console.log(`        values: ${(await tab.js(`[...document.querySelectorAll('.rw-metric')].map((m) => m.querySelector('h3').textContent + ': ' + m.querySelector('p').textContent).join(' | ')`))}`);
    check('the walk was found', await tab.js(`document.querySelectorAll('.rw-ribbon__seg').length === 3`));
    await tab.js(`(async () => { const v = document.querySelector('.rw-player__video'); v.currentTime = 2.5; await new Promise((r) => v.addEventListener('seeked', r, { once: true })); })()`);
    await sleep(300);
    check('overlay draws real landmarks on the video', (await tab.js(BONE_PIXELS)) > 50);
    check('the criteria explain themselves', (await tab.js(`document.querySelectorAll('.rw-breakdown .rw-bar').length`)) === 7 && (await tab.js(`document.querySelectorAll('.rw-why').length`)) === 7);
    check('no stray "null" or "undefined"', !/\b(null|undefined)\b/.test(await tab.text()));
    await tab.shot('analyzed');
    await tab.shot('analyzed-full', true);

    if (!measured) {
      check('measured half available for judging', false);
    } else {
      section('Judge with no API key');
      check('explains that Gemini is not connected', await tab.until(tab.hasText('not connected to this server'), 'no key message', 5000));

      section('Save, reopen, and judge with a fake Gemini on localhost');
      process.env.GEMINI_API_KEY = 'fake-key-for-tests';
      const name = 'E2E walk';
      await tab.js(`(() => { const i = document.querySelector('.rw-name'); i.value = ${JSON.stringify(name)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await tab.clickButton('Save changes');
      check('save is acknowledged only after commit', await tab.until(tab.hasText('Saved on this device'), 'saved pill', 15000));
      const id = (await tab.js('location.hash')).split('/')[2];
      await tab.reload();
      check('reopens after a refresh', await tab.until(tab.hasText('Saved on this device'), 'saved pill after reload', 20000));
      check('no re-analysis on reopen', await tab.js(`!document.querySelector('.rw-progress')`));
      check('saved name survived', await tab.js(`document.querySelector('.rw-name').value === ${JSON.stringify(name)}`));
      await tab.until(tab.hasText('I agree, judge my walk'), 'consent button', 8000);
      gemini.requests.length = 0;
      await tab.clickButton('I agree, judge my walk');
      check('a judged walk shows a total', await tab.until(tab.hasText('Your score'), 'total score', 60000));
      await sleep(1100);
      text = await tab.text();
      const shownTotal = Number(await tab.js(`document.querySelector('.rw-score__num').textContent`));
      const summed = await barTotal();
      check('the total is the sum of the two halves', shownTotal === summed, `${summed} = ${shownTotal}`);
      check('the measured half matches its criteria, and says so when scaled', await measuredBarsAgree());
      check('the judge awards up to 30', (await tab.js(`document.querySelectorAll('.rw-breakdown__group').length`)) === 2 && text.includes('28/30'));
      check('a grade and a next step', /Front row silence|Runway ready|Has a walk|Warming up|Just passing through/.test(text) && text.includes('The judge suggests'));
      check('walk match shown without a percentage', text.includes('Mona Tougaard') && !/\d+\s*%\s*(match|similar)/i.test(text));
      check('measured and judge halves are labeled apart', text.includes('Measured from your movement') && text.includes("Gemini's opinion"));
      const sent = gemini.requests[0]?.body;
      const images = sent?.contents[0].parts.filter((p) => p.inline_data) ?? [];
      check('only stills and text left the browser', !!sent && images.length > 0 && images.length <= 12 && images.every((p) => p.inline_data.mime_type === 'image/jpeg'), `${images.length} stills, ${Math.round(JSON.stringify(sent ?? '').length / 1024)} KB`);
      fs.mkdirSync(stillsFolder, { recursive: true });
      images.forEach((p, i) => fs.writeFileSync(path.join(stillsFolder, `${String(i).padStart(2, '0')}.jpg`), Buffer.from(p.inline_data.data, 'base64')));
      check('stills strip shown to the walker', (await tab.js(`document.querySelectorAll('.rw-still').length`)) === images.length);
      const moment = await tab.js(`(async () => { const b = document.querySelector('.rw-moments button'); b.click(); await new Promise((r) => setTimeout(r, 300)); return document.querySelector('.rw-player__video').currentTime; })()`);
      check('a moment seeks the video', moment > 0, `${moment.toFixed(2)} s`);
      check('the judgment is saved without asking', await tab.until(tab.hasText('All changes saved'), 'all saved', 15000));
      await tab.shot('judged');
      await tab.shot('judged-full', true);
      await tab.go('#/history');
      check('history lists it', await tab.until(tab.hasText(name), 'history row', 8000));
      text = await tab.text();
      check('history shows score and status', text.includes(String(shownTotal)) && text.includes('Judged'));
      await tab.js(`(() => { const s = document.querySelector('select'); s.value = 'judged'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      check('filter narrows the list', await tab.until(`/^1 of [2-9]\\d* saved walks/.test(document.querySelector('[role=status]').textContent)`, 'filter result', 3000));
      await tab.shot('history');

      section('Delete');
      await tab.go(`#/review/${id}`);
      await tab.until(tab.hasText('Saved on this device'), 'reopened', 10000);
      await tab.clickButton('Delete');
      check('delete goes home', await tab.until(`location.hash === '#/'`, 'home route', 8000));
      const left = await tab.js(`new Promise((resolve) => { const r = indexedDB.open('runwaylab', 1); r.onsuccess = () => { const db = r.result; const tx = db.transaction(['summaries', 'details', 'videos']); const counts = ['summaries', 'details', 'videos'].map((n) => tx.objectStore(n).count(${JSON.stringify(id)})); tx.oncomplete = () => resolve(counts.map((c) => c.result)); }; })`);
      check('video, analysis and summary are all gone', left.every((n) => n === 0), left.join(','));
      await tab.go(`#/review/${id}`);
      check('old link explains itself', await tab.until(tab.hasText('This walk is not here'), 'missing walk', 8000));
    }

    // ── orientation ──
    section('A sideways clip');
    delete process.env.GEMINI_API_KEY;
    await openWalk(fx.sideways);
    const sidewaysBefore = await tab.js(`getComputedStyle(document.querySelector('.rw-playerbox')).getPropertyValue('--ar')`);
    await tab.clickButton('Rotate video and analyze again');
    await sleep(300);
    check('rotates and analyzes again', await tab.until(analysisDone, 'analysis after rotating', 180000));
    await sleep(200);
    const sidewaysAfter = await tab.js(`getComputedStyle(document.querySelector('.rw-playerbox')).getPropertyValue('--ar')`);
    check('the picture changes shape', Number(sidewaysBefore) < 1 && Number(sidewaysAfter) > 1, `${Number(sidewaysBefore).toFixed(2)} to ${Number(sidewaysAfter).toFixed(2)}`);
    await tab.js(`(() => { const v = document.querySelector('.rw-player__video'); v.currentTime = 2.5; })()`);
    await sleep(400);
    await tab.shot('rotated');
    check('tracking works once upright', (await tab.js(BONE_PIXELS)) > 50);

    // ── the wall ──
    section(`The wall, on ${usingDb ? 'a real database' : 'the local test store'}`);
    process.env.GEMINI_API_KEY = 'fake-key-for-tests';
    tab.dialogAccept = true;
    await tab.js(`location.hash = '#/wall'`);
    check('empty wall says so', await tab.until(tab.hasText('The wall is empty'), 'empty wall', 8000));
    if (!usingDb) check('the local wall is labeled', await tab.until(tab.hasText('Local test wall'), 'local label', 3000));

    gemini.reply = { ...FAKE_ANSWER, moments: [], verdict: 'Fake, with no moments.' };
    await openWalk();
    await tab.until(tab.hasText('I agree, judge my walk'), 'judge button', 8000);
    await tab.clickButton('I agree, judge my walk');
    await tab.until(tab.hasText('Your score'), 'score', 60000);
    check('a judgment with no moments shows no stray text', !/\b(null|undefined)\b/.test(await tab.text()));
    gemini.reply = null;
    await tab.js(`location.hash = '#/studio'`);
    await openWalk();
    await tab.until(tab.hasText('I agree, judge my walk'), 'judge button', 8000);
    await tab.clickButton('I agree, judge my walk');
    await tab.until(tab.hasText('Your score'), 'score', 60000);
    await tab.until('!!document.querySelector("#rw-post-name")', 'post form', 8000);
    await sleep(1100);
    const reviewTotal = Number(await tab.js(`document.querySelector('.rw-score__num').textContent`));

    await tab.clickButton('Post to the wall');
    check('a name is required', await tab.until(tab.hasText('Enter a name'), 'name message', 2000));
    await fillPost('E2E Walker', false);
    await tab.clickButton('Post to the wall');
    check('consent is required', await tab.until(tab.hasText('Tick the box'), 'consent message', 2000));
    check('no stray "null" or "undefined" on the post form', !/\b(null|undefined)\b/.test(await tab.text()));
    await tab.js(`document.querySelector('#rw-post-name').closest('section').scrollIntoView({ block: 'center' })`);
    await sleep(150);
    await tab.shot('post-card');
    await fillPost('E2E Walker');
    await tab.clickButton('Post to the wall');
    check('post succeeds', await tab.until(tab.hasText('This walk is on the wall'), 'posted', 15000));
    if (!usingDb) {
      const stored = fs.readFileSync(process.env.WALL_DEV_FILE, 'utf8');
      check('a post holds no image or video', !/data:image|jpeg|blob:|video\/|webm/i.test(stored), `${Math.round(stored.length / 1024)} KB`);
      check('a post holds no raw model output', !/visibility/.test(stored));
    }

    await tab.js(`location.hash = '#/wall'`);
    check('the leaderboard shows the post', await tab.until(tab.hasText('E2E Walker'), 'wall row', 10000));
    text = await tab.text();
    check('with the same score as the review', text.includes(String(reviewTotal)), String(reviewTotal));
    check('and the judge\'s words', text.includes('Fake verdict from the test server') && text.includes('Mona Tougaard'));
    check('stats show it', await tab.until(`/Walks posted\\s*1/i.test(document.querySelector('.rw-stats').innerText) && document.querySelector('.rw-stats').innerText.includes(${JSON.stringify(String(reviewTotal))})`, 'stat tiles', 5000), (await tab.js(`document.querySelector('.rw-stats').innerText.replace(/\\n/g, ' ')`)));
    check('the card draws a real pose', await tab.js(`document.querySelectorAll('.rw-thumb line').length >= 8`));
    await tab.shot('wall');
    check('no sideways scroll on the wall', await tab.js(`document.documentElement.scrollWidth <= window.innerWidth + 1`));

    await tab.js(`document.querySelector('.rw-wallcard__link').click()`);
    check('replay page opens', await tab.until(tab.hasText('Skeleton replay. No video is stored'), 'replay', 10000));
    check('no video element on the replay page', await tab.js(`!document.querySelector('video')`));
    check('replay draws the skeleton', await tab.until(`${BONE_PIXELS} > 50`, 'skeleton on canvas', 5000));
    const wallUrl = await tab.js('location.hash');
    await tab.clickButton('Clap · 0');
    check('a clap counts', await tab.until(tab.hasText('Clapped · 1'), 'clap', 5000));
    await tab.reload();
    check('a clap survives a refresh, once per browser', await tab.until(`(() => { const b = [...document.querySelectorAll('#rw-root button')].find((x) => x.textContent.includes('Clapped')); return b && b.disabled && b.textContent.includes('1'); })()`, 'clap after reload', 10000));
    check('moments work on the replay', await tab.js(`(() => { const b = document.querySelector('.rw-moments button'); if (!b) return false; b.click(); return true; })()`));
    await tab.shot('wall-replay');

    await tab.js(`localStorage.setItem('rw-wall-tokens-backup', localStorage.getItem('rw-wall-tokens'))`);
    await tab.js(`localStorage.removeItem('rw-wall-tokens')`);
    await tab.reload();
    await tab.until(tab.hasText('Skeleton replay'), 'replay after reload', 10000);
    check('another browser gets no remove button', !(await tab.text()).includes('Remove from the wall'));
    await tab.js(`localStorage.setItem('rw-wall-tokens', localStorage.getItem('rw-wall-tokens-backup'))`);
    await tab.reload();
    await tab.until(tab.hasText('Remove from the wall'), 'remove button', 10000);
    await tab.clickButton('Remove from the wall');
    check('remove goes back to the wall', await tab.until(`location.hash === '#/wall'`, 'wall route', 8000));
    check('and the wall is empty again', await tab.until(tab.hasText('The wall is empty'), 'empty wall', 8000));
    await tab.js(`location.hash = ${JSON.stringify(wallUrl)}`);
    check('the old link explains itself', await tab.until(tab.hasText('This walk is not on the wall'), 'missing post', 8000));

    // ── sign-in ──
    section('Posting with sign-in, with a fake Auth0 on localhost');
    await new Promise((r) => fakeAuth0.listen(0, '127.0.0.1', r));
    process.env.AUTH0_BASE_URL = `http://127.0.0.1:${fakeAuth0.address().port}`;
    process.env.AUTH0_CLIENT_ID = 'e2e-client';
    process.env.AUTH0_CLIENT_SECRET = 'e2e-secret';
    delete process.env.GEMINI_API_KEY;
    await openWalk();
    check('asks for sign-in before posting', await tab.until(tab.hasText('Sign in and post'), 'sign-in button', 8000));
    await fillPost('Signed In Walker');
    await tab.clickButton('Sign in and post');
    check('signs in through a popup and posts, keeping the temporary walk', await tab.until(tab.hasText('This walk is on the wall'), 'posted after sign-in', 25000), `${auth0Log.authorize} authorize, ${auth0Log.token} token calls`);
    check('login was forced and asked for no email', auth0Log.lastQuery?.get('prompt') === 'login' && !auth0Log.lastQuery?.get('scope').includes('email'));
    check('signs out after posting, for the next walker', await tab.until(tab.hasText('You have been signed out'), 'signed out note', 8000));
    check('the session really is gone', (await tab.js(`fetch('api/auth?action=me').then((r) => r.json())`)).signedIn === false);
    const signedPost = await tab.js(`document.querySelector('a[href^="#/wall/"].rw-btn').getAttribute('href')`);
    await tab.js(`location.hash = ${JSON.stringify(signedPost)}`);
    await tab.until(tab.hasText('Skeleton replay'), 'signed post replay', 10000);
    await tab.clickButton('Remove from the wall');
    check('removing needs the same account, then works', await tab.until(`location.hash === '#/wall'`, 'wall route after remove', 25000), `${auth0Log.authorize} authorize calls`);
    for (const k of ['AUTH0_BASE_URL', 'AUTH0_CLIENT_ID', 'AUTH0_CLIENT_SECRET']) delete process.env[k];

    // ── fake camera ──
    section('Studio with Chrome\'s fake camera device: calibrate, then 2 walks');
    await tab.go('#/');
    await tab.js(`(() => { const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); window.__streams = []; window.__asked = []; navigator.mediaDevices.getUserMedia = async (c) => { window.__asked.push(c); const s = await original(c); window.__streams.push(s); return s; }; })()`);
    await tab.go('#/studio');
    await sleep(200);
    await tab.js(`(() => { const s = document.querySelector('#rw-laps'); s.value = '2'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    // Chrome may already have granted the camera, in which case the studio turns it on by itself.
    await sleep(600);
    await tab.clickButton('Turn on camera');
    check('camera opens', await tab.until(`window.__streams?.length > 0 && document.querySelector('.rw-stage__video').videoWidth > 0`, 'live video', 15000));
    const asked = await tab.js('window.__asked[0].video');
    check('music is offered, with a credit and your own option', await tab.js(`document.querySelectorAll('#rw-music option').length >= 4`) && (await tab.text()).includes('Kevin MacLeod') && (await tab.js(`fetch('vendor/music/aitech.mp3', { method: 'HEAD' }).then((r) => r.ok)`)));
    check('asks for 50+ fps first', asked.frameRate.min === 50 && asked.frameRate.ideal === 60 && asked.height.ideal === 1080);
    const fallback = await tab.js('window.__asked[1]?.video ?? null');
    check('a 30 fps camera falls back to the best picture', !!fallback && fallback.height.ideal === 1440 && fallback.frameRate.min === undefined);
    check('shows device fps and measured fps apart', await tab.until(`/Camera reports[\\s\\S]*fps/.test(document.querySelector('.rw-fps').innerText) && /Measured here\\s*[\\d.]+ fps/.test(document.querySelector('.rw-fps').innerText)`, 'fps values', 10000), (await tab.js(`document.querySelector('.rw-fps').innerText.replace(/\\n/g, ' ')`)));
    check('tracking starts on live video', await tab.until(`/Tracking with/.test(document.querySelector('#rw-root').innerText)`, 'tracker loaded', 60000), (await tab.fullText()).match(/Tracking with [^.]+/)?.[0]);
    await tab.shot('studio-live');
    await tab.shot('studio-full', true);
    check('says when the person is in frame', await tab.until(`/in frame\. Press Start/.test(document.querySelector('.rw-stage__prompt')?.textContent || '')`, 'in frame', 45000));
    await sleep(3000);
    check('never starts recording by itself', (await tab.js(`document.querySelector('.rw-stage').dataset.phase`)) === 'live');
    await tab.until(`/in frame\. Press Start/.test(document.querySelector('.rw-stage__prompt')?.textContent || '')`, 'in frame again', 45000);
    await tab.clickButton('Start, with a 3 second countdown');
    check('Start begins the countdown', await tab.until(`['countdown', 'recording'].includes(document.querySelector('.rw-stage').dataset.phase)`, 'countdown', 5000));
    check('recording starts after the countdown', await tab.until(`document.querySelector('.rw-stage').dataset.phase === 'recording'`, 'recording', 10000));
    const prompts = new Set();
    let shotRecording = false;
    const sawEnd = await (async () => {
      const startAt = Date.now();
      while (Date.now() - startAt < 110000) {
        const state = await tab.js(`({ route: location.hash, phase: document.querySelector('.rw-stage')?.dataset.phase, prompt: document.querySelector('.rw-stage__prompt')?.textContent })`).catch(() => ({}));
        if (state.prompt) prompts.add(state.prompt);
        if (!shotRecording && /keep coming/i.test(state.prompt || '')) {
          await tab.shot('studio-recording');
          shotRecording = true;
        }
        if (state.route?.startsWith('#/review/') || state.phase === 'take') return state;
        await sleep(200);
      }
      return null;
    })();
    console.log(`        prompts seen: ${[...prompts].join(' > ')}`);
    check('it calibrates first', prompts.has('Stand tall and hold still'));
    check('it counts both walks', [...prompts].some((p) => p.startsWith('Walk 1 of 2')) && [...prompts].some((p) => p.startsWith('Walk 2 of 2')));
    check('the take ends by itself', !!sawEnd, sawEnd?.route?.slice(0, 12));
    if (sawEnd?.phase === 'take') {
      await tab.clickButton('Use this walk');
      await tab.until(`location.hash.startsWith('#/review/')`, 'review route', 5000);
    }
    const takeStarted = Date.now();
    await sleep(500);
    check('the camera take goes through the same analysis', await tab.until(analysisDone, 'analysis of the take', 180000), `${((Date.now() - takeStarted) / 1000).toFixed(1)} s`);
    console.log(`        take: ${await tab.js(`document.querySelector('.rw-coverage p').textContent`)}`);
    check('a real recording is read frame by frame, not by playing it', await tab.js(`document.querySelector('.rw-details').textContent.includes('Every frame was read directly from the file')`));
    console.log(`        walks: ${(await tab.text()).match(/Based on[^\n]*\n[^\n]*/)?.[0]?.replace(/\n/g, ': ') ?? 'one walk only'}`);
    const seekable = await tab.js(`(async () => { const v = document.querySelector('.rw-player__video'); return { duration: v.duration }; })()`);
    check('the recording has a real length', Number.isFinite(seekable.duration) && seekable.duration > 0, `${seekable.duration?.toFixed?.(1)} s`);
    check('the camera tracks stop on leaving the studio', await tab.js(`window.__streams.flatMap((s) => s.getTracks()).every((t) => t.readyState === 'ended')`));
    await tab.shot('camera-take');

    // ── phone width ──
    section('Layout at phone width');
    await tab.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    tab.dialogAccept = true;
    await tab.js(`location.hash = '#/review/sample'`);
    await tab.until(tab.hasText('This is a sample'), 'sample', 8000);
    await sleep(400);
    check('no sideways scrolling', await tab.js(`document.documentElement.scrollWidth <= 391`), String(await tab.js('document.documentElement.scrollWidth')));
    await tab.shot('mobile-sample');
    await tab.go('#/');
    await sleep(300);
    check('home has no sideways scrolling', await tab.js(`document.documentElement.scrollWidth <= 391`));
    await tab.shot('mobile-home');
    await tab.send('Emulation.clearDeviceMetricsOverride');
    await tab.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    await tab.go('#/review/sample');
    await sleep(600);
    await tab.shot('dark-sample');

    section('Privacy and errors');
    check('nothing reached any other host', tab.external.length === 0, tab.external.slice(0, 3).join(' '));
    check('the page\'s policy is in force', await tab.js(`!!document.querySelector('meta[http-equiv="Content-Security-Policy"]')`));
    check('a request to another host is refused', await tab.js(`fetch('https://odml.pa.googleapis.com/v1/log', { method: 'POST' }).then(() => false, () => true)`));
    check('no uncaught page errors', tab.errors.length === 0, tab.errors.slice(0, 3).join(' | ').slice(0, 300));
  } catch (err) {
    check(`run stopped early: ${err.message}`, false);
    await tab.shot('crash').catch(() => {});
  } finally {
    ws.close();
    chrome.kill();
    fakeGemini.close();
    fakeAuth0.close();
    server.close();
    server.closeAllConnections?.();
  }

  console.log(`\nScreenshots: ${SHOTS}`);
  if (fs.existsSync(stillsFolder)) console.log(`Stills sent: ${stillsFolder}`);
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
