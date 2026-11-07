// One real call to the real Gemini API, to prove the request shape works. Run from the project folder,
// after putting your key in .env.local:
//   node test/gemini-smoke.mjs [path/to/image.jpg]
//
// With no image it sends a plain grey picture that it makes itself, so no footage of anyone leaves
// this machine. Either a judgment or "could not see a person walking" means the request works.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.join(HERE, '..', '.env.local');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
if (!process.env.GEMINI_API_KEY) {
  console.log('No key found. Put GEMINI_API_KEY=... in .env.local (see .env.example).');
  process.exit(1);
}

let image = process.argv[2];
if (!image) {
  image = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'runway-smoke-')), 'grey.jpg');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=gray:s=320x480', '-frames:v', '1', image]);
}

const { GET, POST } = await import('../api/judge.mjs');
const status = await (await GET()).json();
console.log(`Model: ${status.model}. Data terms set to: ${status.paidTier ? 'paid tier' : 'free tier'}.`);

const started = Date.now();
const res = await POST(new Request('http://localhost/api/judge', {
  method: 'POST',
  headers: { 'content-type': 'application/json', host: 'localhost' },
  body: JSON.stringify({
    stills: [{ t: 0, jpeg: fs.readFileSync(image).toString('base64') }],
    measurements: { shoulderLineDeg: 1.2, torsoSpreadShoulderWidths: 0.6, headMovementShoulderWidths: 0.2, trunkTiltDeg: 1.5, measuredPoints: 40 },
  }),
}));
const body = await res.json();
console.log(`HTTP ${res.status} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
console.log(JSON.stringify(body, null, 2));

const works = res.status === 200 || body.code === 'not_judgeable';
console.log(works ? '\nPASS: the real API accepted this request and returned usable JSON.' : `\nFAIL: ${body.code}: ${body.message}`);
process.exit(works ? 0 : 1);
