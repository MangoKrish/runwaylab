// Tests the judge function against a fake Gemini on localhost. These prove this file's own logic:
// validation, error handling and refusing bad answers. They do NOT prove the real API accepts the
// request; test/gemini-smoke.mjs does that with the key in .env.local.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.RUNWAYLAB_JUDGE_LOG = '0';
const { GET, POST, checkAnswer } = await import('../api/judge.mjs');
const { checkUploadBasics, MAX_UPLOAD_BYTES } = await import('../src/capture/upload.mjs');

const GOOD = { judgeable: true, presence: 14, presenceWhy: 'Steady.', style: 11, styleWhy: 'Bold.', match: 'kloss', matchWhy: 'Hips lead.', verdict: 'You own that hallway.', tip: 'Look up.', moments: [{ still: 1, note: 'Nice turn.' }, { still: 99, note: 'Out of range.' }] };

let reply = null;
let lastRequest = null;
let requests = 0;
const fake = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (d) => chunks.push(d));
  req.on('end', () => {
    requests++;
    lastRequest = { url: req.url, headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString()) };
    const r = typeof reply === 'function' ? reply(lastRequest) : reply;
    if (r.hang) return;
    if (r.sse) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      return res.end(r.sse.map((c) => `data: ${JSON.stringify(c)}\r\n\r\n`).join(''));
    }
    res.writeHead(r.status ?? 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(r.body));
  });
});
await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve));
test.after(() => {
  fake.closeAllConnections();
  fake.close();
});

function setEnv(key = 'test-key') {
  process.env.GEMINI_BASE_URL = `http://127.0.0.1:${fake.address().port}`;
  if (key) process.env.GEMINI_API_KEY = key;
  else delete process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_MODEL;
}

const textReply = (obj) => ({ body: { candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] }, finishReason: 'STOP' }] } });
const call = (body, headers = { host: 'x.test' }) => POST(new Request('http://x.test/api/judge', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }));
const goodBody = { stills: [{ t: 1, jpeg: 'AAAA' }, { t: 2, jpeg: 'BBBB' }], measurements: { shoulderRockDegrees: 1.2, measuredPoints: 60, secret: 'dropped' } };

test('GET reports whether a judge is connected, never the key', async () => {
  setEnv();
  const text = await (await GET()).text();
  assert.equal(JSON.parse(text).ready, true);
  assert.ok(!text.includes('test-key'));
  setEnv(null);
  assert.equal((await (await GET()).json()).ready, false);
});

test('no key: a clear refusal and no outside call', async () => {
  setEnv(null);
  requests = 0;
  const res = await call(goodBody);
  assert.equal(res.status, 503);
  assert.equal((await res.json()).code, 'no_key');
  assert.equal(requests, 0);
});

test('a good answer is validated and shaped; bad moments are dropped', async () => {
  setEnv();
  reply = textReply(GOOD);
  const res = await call(goodBody);
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.equal(out.presence.score, 14);
  assert.equal(out.tip, 'Look up.');
  assert.equal(out.match.name, 'Karlie Kloss');
  assert.deepEqual(out.moments, [{ still: 1, note: 'Nice turn.' }]);
  assert.equal(out.total, undefined, 'the server does not state a total');
});

test('the request has images first, the key in a header, and only known measurements', async () => {
  setEnv();
  reply = textReply(GOOD);
  await call(goodBody);
  assert.match(lastRequest.url, /\/models\/gemini-3\.6-flash:generateContent$/);
  assert.equal(lastRequest.headers['x-goog-api-key'], 'test-key');
  assert.ok(!lastRequest.url.includes('test-key'), 'the key must not be in the URL');
  const { parts } = lastRequest.body.contents[0];
  assert.equal(parts[0].inline_data.mime_type, 'image/jpeg');
  assert.equal(parts[0].inline_data.data, 'AAAA');
  assert.ok(parts.at(-1).text.includes('shoulderRockDegrees'));
  assert.ok(!parts.at(-1).text.includes('measuredPoints'), 'the measured score is not shown to the judge, so it cannot lean on it');
  assert.ok(!parts.at(-1).text.includes('dropped'));
  assert.equal(lastRequest.body.generationConfig.responseFormat.text.mimeType, 'APPLICATION_JSON');
  assert.deepEqual(lastRequest.body.generationConfig.responseFormat.text.schema.properties.presence.maximum, 15);
  assert.equal(lastRequest.body.generationConfig.thinkingConfig.thinkingLevel, 'low', 'thinking is most of the wait');
  assert.equal(lastRequest.body.generationConfig.mediaResolution, 'MEDIA_RESOLUTION_MEDIUM');
  assert.equal(lastRequest.body.generationConfig.temperature, undefined, 'ignored by 3.6 Flash, refused by later models');
});

test('the prompt forbids judging bodies and identifying people', async () => {
  setEnv();
  reply = textReply(GOOD);
  await call(goodBody);
  const prompt = lastRequest.body.contents[0].parts.at(-1).text;
  assert.match(prompt, /Never mention, rate or infer body shape/);
  assert.match(prompt, /Do not try to work out who the person is/);
  assert.match(prompt, /This is where most people belong/, 'the scale is anchored, so ordinary walks do not score high');
});

test('falls back to the other schema field names once if the first form is rejected', async () => {
  setEnv();
  reply = (req) => (req.body.generationConfig.responseFormat ? { status: 400, body: {} } : textReply(GOOD));
  const res = await call(goodBody);
  assert.equal(res.status, 200);
  assert.equal(lastRequest.body.generationConfig.responseMimeType, 'application/json');
  assert.ok(lastRequest.body.generationConfig.responseJsonSchema);
});

test('if the speed settings are refused, it asks once more without them', async () => {
  setEnv();
  reply = (req) => (req.body.generationConfig.thinkingConfig ? { status: 400, body: {} } : textReply(GOOD));
  const res = await call(goodBody);
  assert.equal(res.status, 200);
  assert.equal(lastRequest.body.generationConfig.mediaResolution, undefined);
});

test('with progress on, the page hears each step and then the same result', async () => {
  setEnv();
  const answer = JSON.stringify(GOOD);
  reply = (req) => (req.url.includes(':streamGenerateContent?alt=sse')
    ? { sse: [
      { candidates: [{ content: { parts: [{ thought: true, text: 'Looking at posture.' }] } }] },
      { candidates: [{ content: { parts: [{ text: answer.slice(0, 60) }] } }] },
      { candidates: [{ content: { parts: [{ text: answer.slice(60) }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10, thoughtsTokenCount: 5, candidatesTokenCount: 50 } },
    ] }
    : { status: 500, body: {} });
  const res = await call(goodBody, { host: 'x.test', 'x-judge-progress': '1' });
  assert.match(res.headers.get('content-type'), /ndjson/);
  const events = (await res.text()).trim().split('\n').map((l) => JSON.parse(l));
  const stages = events.filter((e) => e.type === 'progress').map((e) => e.stage);
  assert.deepEqual([...new Set(stages)], ['received', 'asking', 'thinking', 'writing']);
  assert.equal(lastRequest.body.generationConfig.thinkingConfig.includeThoughts, true);
  const result = events.at(-1);
  assert.equal(result.type, 'result');
  assert.equal(result.status, 200);
  assert.equal(result.body.presence.score, 14);
  assert.ok(!JSON.stringify(events).includes('Looking at posture'), 'the model\'s thoughts never reach the page');
});

test('with progress on, a refusal still arrives as a result line', async () => {
  setEnv(null);
  const res = await call(goodBody, { host: 'x.test', 'x-judge-progress': '1' });
  const last = (await res.text()).trim().split('\n').map((l) => JSON.parse(l)).at(-1);
  assert.equal(last.status, 503);
  assert.equal(last.body.code, 'no_key');
});

const failures = [
  ['rate limit', { status: 429, body: {} }, 429, 'rate_limited'],
  ['bad key', { status: 403, body: {} }, 502, 'bad_key'],
  ['unknown model', { status: 404, body: {} }, 502, 'bad_model'],
  ['server error', { status: 500, body: {} }, 502, 'upstream'],
  ['prompt blocked', { body: { promptFeedback: { blockReason: 'SAFETY' } } }, 422, 'blocked'],
  ['answer blocked', { body: { candidates: [{ finishReason: 'SAFETY' }] } }, 422, 'blocked'],
  ['empty answer', { body: { candidates: [{ content: { parts: [] }, finishReason: 'STOP' }] } }, 502, 'bad_answer'],
  ['not JSON', { body: { candidates: [{ content: { parts: [{ text: 'hello' }] } }] } }, 502, 'bad_answer'],
];
for (const [name, r, status, code] of failures) {
  test(`failure: ${name}`, async () => {
    setEnv();
    reply = r;
    const res = await call(goodBody);
    assert.equal(res.status, status);
    assert.equal((await res.json()).code, code);
  });
}

test('a busy model is retried, and a later success counts', async () => {
  setEnv();
  process.env.GEMINI_RETRY_MS = '1';
  let calls = 0;
  reply = () => (++calls === 1 ? { status: 503, body: {} } : textReply(GOOD));
  const res = await call(goodBody);
  assert.equal(res.status, 200);
  assert.equal(calls, 2);
  assert.equal((await res.json()).model, 'gemini-3.6-flash');
});

test('a model that stays busy falls back to the second model, and says which answered', async () => {
  setEnv();
  process.env.GEMINI_RETRY_MS = '1';
  const urls = [];
  reply = (req) => {
    urls.push(req.url);
    return req.url.includes('gemini-3.8-flash') ? textReply(GOOD) : { status: 503, body: {} };
  };
  const res = await call(goodBody);
  assert.equal(res.status, 200);
  assert.equal(urls.length, 3);
  assert.equal((await res.json()).model, 'gemini-3.8-flash');
});

test('if everything is busy, a clear message and a bounded number of calls', async () => {
  setEnv();
  process.env.GEMINI_RETRY_MS = '1';
  requests = 0;
  reply = { status: 503, body: {} };
  const res = await call(goodBody);
  assert.equal(res.status, 503);
  assert.equal((await res.json()).code, 'busy');
  assert.equal(requests, 6, 'the main model twice, then the four others once each');
});

const DAILY_LIMIT = { error: { status: 'RESOURCE_EXHAUSTED', details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', quotaValue: '20' }] }] } };

test('a model out of quota is not retried, and the next model answers', async () => {
  setEnv();
  process.env.GEMINI_RETRY_MS = '1';
  const urls = [];
  reply = (req) => {
    urls.push(req.url);
    return req.url.includes('gemini-3.6-flash') ? { status: 429, body: DAILY_LIMIT } : textReply(GOOD);
  };
  const res = await call(goodBody);
  assert.equal(res.status, 200);
  assert.equal(urls.filter((u) => u.includes('gemini-3.6-flash')).length, 1, 'retrying the same model would only fail again');
  assert.equal((await res.json()).model, 'gemini-3.8-flash');
});

test('a model that hangs is given up on, and the next one answers', async () => {
  setEnv();
  process.env.GEMINI_RETRY_MS = '1';
  process.env.GEMINI_TIMEOUT_MS = '300';
  const urls = [];
  reply = (req) => {
    urls.push(req.url);
    return req.url.includes('gemini-3.6-flash') ? { hang: true } : textReply(GOOD);
  };
  const res = await call(goodBody);
  delete process.env.GEMINI_TIMEOUT_MS;
  assert.equal(res.status, 200);
  assert.equal(urls.filter((u) => u.includes('gemini-3.6-flash')).length, 1, 'not asked a second time');
  assert.equal((await res.json()).model, 'gemini-3.8-flash');
});

test('one model out of quota and another busy reports busy, because trying again can still work', async () => {
  setEnv();
  process.env.GEMINI_RETRY_MS = '1';
  reply = (req) => (req.url.includes('gemini-3.8-flash') ? { status: 503, body: {} } : { status: 429, body: DAILY_LIMIT });
  const res = await call(goodBody);
  assert.equal(res.status, 503);
  assert.equal((await res.json()).code, 'busy');
});

test('when every model has used its day, it says so rather than "wait a minute"', async () => {
  setEnv();
  process.env.GEMINI_RETRY_MS = '1';
  requests = 0;
  reply = { status: 429, body: DAILY_LIMIT };
  const res = await call(goodBody);
  assert.equal(res.status, 429);
  const body = await res.json();
  assert.equal(body.code, 'out_of_quota');
  assert.match(body.message, /keeps its measured score/);
  assert.equal(requests, 5, 'each model once');
});

test('errors that retrying cannot fix are not retried', async () => {
  setEnv();
  process.env.GEMINI_RETRY_MS = '1';
  requests = 0;
  reply = { status: 403, body: {} };
  assert.equal((await call(goodBody)).status, 502);
  assert.equal(requests, 1);
});

test('failure: Gemini says there is no walker', async () => {
  setEnv();
  reply = textReply({ ...GOOD, judgeable: false });
  const res = await call(goodBody);
  assert.equal(res.status, 422);
  assert.equal((await res.json()).code, 'not_judgeable');
});

test('out-of-range or made-up values are rejected, not clamped into a score', () => {
  assert.equal(checkAnswer({ ...GOOD, presence: 16 }, 2), null);
  assert.equal(checkAnswer({ ...GOOD, style: -1 }, 2), null);
  assert.equal(checkAnswer({ ...GOOD, style: 12.5 }, 2), null);
  assert.equal(checkAnswer({ ...GOOD, match: 'someone-else' }, 2), null);
  assert.equal(checkAnswer({ ...GOOD, verdict: '   ' }, 2), null);
  assert.equal(checkAnswer('nope', 2), null);
});

test('request checks: bad stills are refused before any outside call', async () => {
  setEnv();
  requests = 0;
  for (const stills of [[], null, Array(17).fill({ jpeg: 'AAAA' }), [{ jpeg: 'not base64!' }], [{ jpeg: 'A'.repeat(700_001) }]]) {
    assert.equal((await call({ stills })).status, 400);
  }
  assert.equal(requests, 0);
});

test('another site cannot use this endpoint', async () => {
  setEnv();
  requests = 0;
  const res = await call(goodBody, { host: 'x.test', origin: 'https://evil.example' });
  assert.equal(res.status, 403);
  assert.equal(requests, 0);
  reply = textReply(GOOD);
  assert.equal((await call(goodBody, { host: 'x.test', origin: 'https://x.test' })).status, 200);
});

test('upload basics: type, size and empty files', () => {
  const f = (name, type, size) => ({ name, type, size });
  assert.equal(checkUploadBasics(f('a.mp4', 'video/mp4', 10)), 'video/mp4');
  assert.equal(checkUploadBasics(f('a.webm', '', 10)), 'video/webm');
  assert.equal(checkUploadBasics(f('a.mov', 'video/quicktime', 10)), 'video/quicktime', 'iPhone clips are accepted');
  assert.throws(() => checkUploadBasics(f('a.avi', 'video/avi', 10)), /MP4, MOV or WebM/);
  assert.throws(() => checkUploadBasics(f('a.mp4', 'video/mp4', 0)), /empty/);
  assert.throws(() => checkUploadBasics(f('a.mp4', 'video/mp4', MAX_UPLOAD_BYTES + 1)), /limit/);
  assert.throws(() => checkUploadBasics(null), /No file/);
});
