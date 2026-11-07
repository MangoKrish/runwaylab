// Tests the wall and sign-in functions with the local file store and a fake Auth0.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.join(HERE, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'runway-wall-test-'));
process.env.RUNWAYLAB_DEV = '1';
process.env.WALL_DEV_FILE = path.join(TMP, 'wall.json');
delete process.env.DATABASE_URL;

const api = (name) => import(pathToFileURL(path.join(SITE, 'api', name)).href);
const wall = await api('wall.mjs');
const auth = await api('auth.mjs');
const callback = await api('auth-callback.mjs');
const common = await api('_common.mjs');
const authHelpers = await api('_auth.mjs');
const { generateSampleRaw } = await import(pathToFileURL(path.join(SITE, 'src/lib/sampleWalk.mjs')).href);
const { processFrames } = await import(pathToFileURL(path.join(SITE, 'src/lib/process.mjs')).href);

const { raw, W, H, duration } = generateSampleRaw();
const analysis = processFrames(raw, { W, H, duration });

// What the browser sends: landmarks without their visibility values.
const posted = () => ({
  name: 'Test walker',
  W,
  H,
  duration,
  frames: analysis.frames.map((f) => ({ t: f.t, s: f.status, p: f.pts ? f.pts.map((q) => (q ? [q[0], q[1]] : null)) : null })),
});

const URLS = 'http://x.test/api/wall';
const request = (method, query = '', { body, headers = {} } = {}) => new Request(`${URLS}${query}`, {
  method,
  headers: { host: 'x.test', 'content-type': 'application/json', ...headers },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const post = (body, headers) => wall.POST(request('POST', '', { body, headers }));

function freshWall() {
  fs.rmSync(process.env.WALL_DEV_FILE, { force: true });
}

function genuineJudge(overrides = {}) {
  const judge = {
    presence: { score: 12, why: 'Steady.' },
    style: { score: 10, why: 'Bold.' },
    match: { id: 'kloss', name: 'Karlie Kloss', tag: 'The Panther', why: 'Hips lead.' },
    verdict: 'You own that hallway.',
    tip: 'Look up.',
    moments: [{ t: 2, still: 1, note: 'Nice turn.' }],
    model: 'gemini-test',
    ...overrides,
  };
  return { ...judge, sig: common.signJudge(judge) };
}

test('info: a local preview reports the local test wall', async () => {
  const info = await (await wall.GET(request('GET', '?action=info'))).json();
  assert.equal(info.ready, true);
  assert.equal(info.store, 'local');
  assert.equal(info.auth, false);
});

test('production with no database says the wall is not connected', async () => {
  delete process.env.RUNWAYLAB_DEV;
  process.env.WALL_SECRET = 'x';
  try {
    const info = await (await wall.GET(request('GET', '?action=info'))).json();
    assert.equal(info.ready, false);
    assert.equal((await post(posted())).status, 503);
  } finally {
    process.env.RUNWAYLAB_DEV = '1';
    delete process.env.WALL_SECRET;
  }
});

test('production with no secret refuses, rather than signing with a guessable value', async () => {
  delete process.env.RUNWAYLAB_DEV;
  process.env.DATABASE_URL = 'postgres://not-used.invalid/x';
  try {
    const info = await (await wall.GET(request('GET', '?action=info'))).json();
    assert.equal(info.ready, false);
    assert.equal(common.secret(), null);
  } finally {
    process.env.RUNWAYLAB_DEV = '1';
    delete process.env.DATABASE_URL;
  }
});

test('a post is stored, and its score matches what the browser computed', async () => {
  freshWall();
  const res = await post(posted());
  assert.equal(res.status, 201);
  const out = await res.json();
  assert.equal(out.measured, analysis.measured.points, 'server recomputes to the same points');
  assert.equal(out.total, null, 'no judge, so no total');
  assert.equal(out.judged, false);
  assert.ok(out.token, 'an owner token comes back once');
  const one = await (await wall.GET(request('GET', `?id=${out.id}`))).json();
  assert.equal(one.walk.name, 'Test walker');
  assert.equal(one.walk.frames.length, analysis.frames.length);
  assert.deepEqual(one.walk.detail.parts, analysis.measured.parts);
  assert.equal(one.walk.detail.metrics.footLine.value, analysis.metrics.footLine.value);
  assert.ok(one.walk.detail.pose, 'a pose for the wall card');
});

test('the owner hash and token never come back in a list or a walk', async () => {
  freshWall();
  const { id, token } = await (await post(posted())).json();
  const texts = [await (await wall.GET(request('GET'))).text(), await (await wall.GET(request('GET', `?id=${id}`))).text()];
  for (const text of texts) {
    assert.ok(!text.includes('ownerHash') && !text.includes('owner_hash'));
    assert.ok(!text.includes(token));
  }
});

test('scores sent by the browser are ignored', async () => {
  freshWall();
  const out = await (await post({ ...posted(), total: 100, measured: 50, score: 100 })).json();
  assert.equal(out.total, null);
  assert.equal(out.measured, analysis.measured.points);
});

test('standing still cannot be posted, however it is labeled', async () => {
  freshWall();
  const frames = posted().frames.map((f, i) => ({ ...f, p: posted().frames[10].p, t: i / 12 }));
  const res = await post({ ...posted(), frames });
  assert.equal(res.status, 422);
  assert.equal((await res.json()).code, 'no_walk');
});

test('a genuine judge result counts, and the total is the plain sum', async () => {
  freshWall();
  const out = await (await post({ ...posted(), judge: genuineJudge() })).json();
  assert.equal(out.judged, true);
  assert.equal(out.total, analysis.measured.points + 12 + 10);
  const one = await (await wall.GET(request('GET', `?id=${out.id}`))).json();
  assert.equal(one.walk.detail.judge.match.name, 'Karlie Kloss');
  assert.equal(one.walk.detail.judge.sig, undefined, 'the signature is not republished');
});

for (const [what, change] of [
  ['changed score', (j) => { j.presence.score = 3; }],
  ['changed tip', (j) => { j.tip = 'Something rude.'; }],
  ['changed verdict', (j) => { j.verdict = 'Something rude.'; }],
  ['changed note', (j) => { j.moments[0].note = 'Something rude.'; }],
  ['removed signature', (j) => { delete j.sig; }],
  ['made-up signature', (j) => { j.sig = 'AAAA'; }],
]) {
  test(`a tampered judge result is dropped: ${what}`, async () => {
    freshWall();
    const judge = genuineJudge();
    change(judge);
    const out = await (await post({ ...posted(), judge })).json();
    assert.equal(out.judged, false);
    assert.equal(out.total, null);
    const one = await (await wall.GET(request('GET', `?id=${out.id}`))).json();
    assert.equal(one.walk.detail.judge, null);
  });
}

test('the judge function signs what it returns', async () => {
  const judge = genuineJudge();
  assert.equal(common.judgeIsGenuine(judge), true);
  assert.equal(common.judgeIsGenuine({ sig: 'x' }), false, 'a malformed result does not throw');
});

const bad = [
  ['no name', (b) => { b.name = '   '; }, 'bad_name'],
  ['bad size', (b) => { b.W = -1; }, 'bad_request'],
  ['bad length', (b) => { b.duration = 9999; }, 'bad_request'],
  ['no frames', (b) => { b.frames = []; }, 'bad_request'],
  ['frames not a list', (b) => { b.frames = 'x'; }, 'bad_request'],
  ['time goes backward', (b) => { b.frames[5].t = 0; }, 'bad_request'],
  ['unknown status', (b) => { b.frames[5].s = 'great'; }, 'bad_request'],
  ['wrong landmark count', (b) => { b.frames[5].p = [[1, 1]]; }, 'bad_request'],
  ['point outside picture', (b) => { b.frames[5].p[11] = [99999, 1]; }, 'bad_request'],
  ['point is not a number', (b) => { b.frames[5].p[11] = ['a', 1]; }, 'bad_request'],
  ['too many frames', (b) => { b.frames = Array.from({ length: 3701 }, (_, i) => ({ t: i / 100, s: 'no-person', p: null })); }, 'bad_request'],
];
for (const [what, change, code] of bad) {
  test(`a bad post is refused: ${what}`, async () => {
    freshWall();
    const body = posted();
    change(body);
    const res = await post(body);
    assert.equal(res.status, 400);
    assert.equal((await res.json()).code, code);
    assert.equal((await (await wall.GET(request('GET'))).json()).walks.length, 0, 'nothing stored');
  });
}

test('a very large post gets a clear refusal', async () => {
  const res = await post({ ...posted(), padding: 'x'.repeat(4_000_001) });
  assert.equal(res.status, 413);
});

test('names lose control characters and are capped', async () => {
  freshWall();
  const { id } = await (await post({ ...posted(), name: ` A\nB\t${'c'.repeat(50)} ` })).json();
  const { walk } = await (await wall.GET(request('GET', `?id=${id}`))).json();
  assert.ok(!/[\n\t]/.test(walk.name));
  assert.ok(walk.name.length <= 30);
});

test('another site cannot post, clap or delete', async () => {
  freshWall();
  const headers = { origin: 'https://evil.example' };
  assert.equal((await post(posted(), headers)).status, 403);
  const { id, token } = await (await post(posted())).json();
  assert.equal((await wall.POST(request('POST', `?action=clap&id=${id}`, { headers }))).status, 403);
  assert.equal((await wall.DELETE(request('DELETE', `?id=${id}`, { headers: { ...headers, 'x-wall-token': token } }))).status, 403);
});

test('sorting, paging and stats', async () => {
  freshWall();
  const a = await (await post({ ...posted(), name: 'High', judge: genuineJudge({ presence: { score: 15, why: '' }, style: { score: 15, why: '' } }) })).json();
  await new Promise((r) => setTimeout(r, 5));
  const b = await (await post({ ...posted(), name: 'Low', judge: genuineJudge({ presence: { score: 1, why: '' }, style: { score: 1, why: '' } }) })).json();
  await new Promise((r) => setTimeout(r, 5));
  await post({ ...posted(), name: 'Unjudged' });

  const top = (await (await wall.GET(request('GET', '?sort=top'))).json()).walks.map((w) => w.name);
  assert.deepEqual(top, ['High', 'Low', 'Unjudged']);
  const latest = (await (await wall.GET(request('GET', '?sort=new'))).json()).walks.map((w) => w.name);
  assert.deepEqual(latest, ['Unjudged', 'Low', 'High']);

  const stats = await (await wall.GET(request('GET', '?action=stats'))).json();
  assert.equal(stats.walks, 3);
  assert.equal(stats.lastHour, 3);
  assert.equal(stats.top, a.total);
  assert.equal(stats.average, Math.round((a.total + b.total) / 2), 'unjudged walks do not drag the average');

  for (let i = 0; i < 24; i++) await post({ ...posted(), name: `W${i}` });
  const first = await (await wall.GET(request('GET'))).json();
  assert.equal(first.walks.length, 24);
  assert.equal(first.more, true);
  const second = await (await wall.GET(request('GET', '?offset=24'))).json();
  assert.equal(second.walks.length, 3);
  assert.equal(second.more, false);
});

test('claps count up; an unknown or malformed walk is a clean 404', async () => {
  freshWall();
  const { id } = await (await post(posted())).json();
  assert.equal((await (await wall.POST(request('POST', `?action=clap&id=${id}`))).json()).claps, 1);
  assert.equal((await (await wall.POST(request('POST', `?action=clap&id=${id}`))).json()).claps, 2);
  const missing = '00000000-0000-4000-8000-000000000000';
  assert.equal((await wall.POST(request('POST', `?action=clap&id=${missing}`))).status, 404);
  assert.equal((await wall.POST(request('POST', "?action=clap&id=' OR 1=1 --"))).status, 404);
  assert.equal((await wall.GET(request('GET', "?id=' OR 1=1 --"))).status, 404);
});

test('only the owner can delete, and delete removes the walk and its frames', async () => {
  freshWall();
  const { id, token } = await (await post(posted())).json();
  assert.equal((await wall.DELETE(request('DELETE', `?id=${id}`))).status, 403, 'no proof');
  assert.equal((await wall.DELETE(request('DELETE', `?id=${id}`, { headers: { 'x-wall-token': 'wrong' } }))).status, 403);
  assert.equal((await (await wall.GET(request('GET', `?id=${id}`))).json()).walk.id, id, 'still there');
  assert.equal((await wall.DELETE(request('DELETE', `?id=${id}`, { headers: { 'x-wall-token': token } }))).status, 200);
  assert.equal((await wall.GET(request('GET', `?id=${id}`))).status, 404);
  const stored = JSON.parse(fs.readFileSync(process.env.WALL_DEV_FILE, 'utf8'));
  assert.equal(stored.frames[id], undefined);
  assert.equal((await wall.DELETE(request('DELETE', `?id=${id}`, { headers: { 'x-wall-token': token } }))).status, 404);
});

// ── sign-in, with a fake Auth0 ──
const CLIENT = 'test-client';
const issued = { nonce: null, claims: {}, fail: false };
const fakeAuth0 = http.createServer((req, res) => {
  if (req.url === '/oauth/token') {
    const encode = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
    const base = `http://127.0.0.1:${fakeAuth0.address().port}`;
    const claims = { iss: `${base}/`, aud: CLIENT, exp: Date.now() / 1000 + 60, nonce: issued.nonce, sub: 'auth0|person-1', given_name: 'Sam', ...issued.claims };
    res.writeHead(issued.fail ? 401 : 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id_token: `${encode({ alg: 'none' })}.${encode(claims)}.sig` }));
    return;
  }
  res.writeHead(404);
  res.end();
});
await new Promise((r) => fakeAuth0.listen(0, '127.0.0.1', r));
test.after(() => {
  fakeAuth0.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

function withAuth0() {
  process.env.AUTH0_BASE_URL = `http://127.0.0.1:${fakeAuth0.address().port}`;
  process.env.AUTH0_CLIENT_ID = CLIENT;
  process.env.AUTH0_CLIENT_SECRET = 'test-secret';
  issued.claims = {};
  issued.fail = false;
}
function withoutAuth0() {
  for (const k of ['AUTH0_BASE_URL', 'AUTH0_CLIENT_ID', 'AUTH0_CLIENT_SECRET']) delete process.env[k];
}

const authRequest = (name, query = '', headers = {}) => new Request(`http://x.test/api/${name}${query}`, { headers: { host: 'x.test', ...headers } });

async function startLogin() {
  const res = await auth.GET(authRequest('auth', '?action=login'));
  const location = new URL(res.headers.get('location'));
  const flowCookie = res.headers.getSetCookie()[0].split(';')[0];
  issued.nonce = location.searchParams.get('nonce');
  return { res, location, flowCookie, state: location.searchParams.get('state') };
}

async function signIn() {
  const { flowCookie, state } = await startLogin();
  const res = await callback.GET(authRequest('auth-callback', `?code=abc&state=${state}`, { cookie: flowCookie }));
  assert.equal(res.status, 200);
  return res.headers.getSetCookie().find((c) => c.startsWith(authHelpers.SESSION_COOKIE) && !c.includes('Max-Age=0')).split(';')[0];
}

test('sign-in start: forces a login prompt, asks for no email, and uses state and nonce', async () => {
  withAuth0();
  try {
    const { res, location } = await startLogin();
    assert.equal(res.status, 302);
    assert.equal(location.pathname, '/authorize');
    assert.equal(location.searchParams.get('prompt'), 'login');
    assert.equal(location.searchParams.get('scope'), 'openid profile');
    assert.ok(!location.searchParams.get('scope').includes('email'));
    assert.ok(location.searchParams.get('state') && location.searchParams.get('nonce'));
    assert.equal(location.searchParams.get('redirect_uri'), 'http://x.test/api/auth-callback');
    assert.ok(!location.href.includes('test-secret'), 'the secret never goes through the browser');
    assert.match(res.headers.getSetCookie()[0], /HttpOnly; SameSite=Lax/);
  } finally {
    withoutAuth0();
  }
});

test('sign-in finish: sets a short, http-only session and reports the name', async () => {
  withAuth0();
  try {
    const session = await signIn();
    const me = await (await auth.GET(authRequest('auth', '?action=me', { cookie: session }))).json();
    assert.deepEqual(me, { enabled: true, signedIn: true, name: 'Sam' });
    const { flowCookie, state } = await startLogin();
    const res = await callback.GET(authRequest('auth-callback', `?code=abc&state=${state}`, { cookie: flowCookie }));
    const header = res.headers.getSetCookie().find((c) => c.startsWith(authHelpers.SESSION_COOKIE));
    assert.match(header, /HttpOnly/);
    assert.match(header, new RegExp(`Max-Age=${authHelpers.SESSION_SECONDS}`));
  } finally {
    withoutAuth0();
  }
});

for (const [what, setup] of [
  ['wrong audience', () => { issued.claims = { aud: 'someone-else' }; }],
  ['wrong issuer', () => { issued.claims = { iss: 'https://evil.example/' }; }],
  ['expired token', () => { issued.claims = { exp: 1 }; }],
  ['wrong nonce', () => { issued.claims = { nonce: 'other' }; }],
  ['no subject', () => { issued.claims = { sub: '' }; }],
  ['Auth0 refuses the code', () => { issued.fail = true; }],
]) {
  test(`sign-in is refused: ${what}`, async () => {
    withAuth0();
    try {
      const { flowCookie, state } = await startLogin();
      setup();
      const res = await callback.GET(authRequest('auth-callback', `?code=abc&state=${state}`, { cookie: flowCookie }));
      assert.equal(res.status, 400);
      assert.ok(!res.headers.getSetCookie().some((c) => c.startsWith(authHelpers.SESSION_COOKIE)));
    } finally {
      withoutAuth0();
    }
  });
}

test('sign-in is refused when the state does not match, or there is no flow cookie', async () => {
  withAuth0();
  try {
    const { flowCookie } = await startLogin();
    assert.equal((await callback.GET(authRequest('auth-callback', '?code=abc&state=forged', { cookie: flowCookie }))).status, 400);
    const { state } = await startLogin();
    assert.equal((await callback.GET(authRequest('auth-callback', `?code=abc&state=${state}`))).status, 400);
    assert.equal((await callback.GET(authRequest('auth-callback', `?error=access_denied&state=${state}`, { cookie: flowCookie }))).status, 400);
  } finally {
    withoutAuth0();
  }
});

test('nothing from the address bar is written into the callback page', async () => {
  withAuth0();
  try {
    const res = await callback.GET(authRequest('auth-callback', '?error=<script>alert(1)</script>&error_description=<b>x</b>'));
    const html = await res.text();
    assert.ok(!html.includes('alert(1)') && !html.includes('<b>x</b>'));
    assert.match(res.headers.get('content-security-policy'), /default-src 'none'/);
  } finally {
    withoutAuth0();
  }
});

test('a forged or expired session cookie is not accepted', async () => {
  withAuth0();
  try {
    const session = await signIn();
    const forged = `${session.slice(0, -3)}abc`;
    assert.equal((await (await auth.GET(authRequest('auth', '?action=me', { cookie: forged }))).json()).signedIn, false);
    const expired = `${authHelpers.SESSION_COOKIE}=${common.seal({ sub: 'x', exp: 1 })}`;
    assert.equal((await (await auth.GET(authRequest('auth', '?action=me', { cookie: expired }))).json()).signedIn, false);
  } finally {
    withoutAuth0();
  }
});

test('with sign-in on: posting needs an account, the account owns the post, and others cannot delete it', async () => {
  freshWall();
  withAuth0();
  try {
    assert.equal((await post(posted())).status, 401);
    const session = await signIn();
    const out = await (await post(posted(), { cookie: session })).json();
    assert.equal(out.token, null, 'no token is issued when an account owns the post');

    const mine = await (await wall.GET(request('GET', `?id=${out.id}`, { headers: { cookie: session } }))).json();
    assert.equal(mine.mine, true);
    const anon = await (await wall.GET(request('GET', `?id=${out.id}`))).json();
    assert.equal(anon.mine, false);

    assert.equal((await wall.DELETE(request('DELETE', `?id=${out.id}`))).status, 401);
    const other = `${authHelpers.SESSION_COOKIE}=${authHelpers.makeSession('auth0|person-2', 'Other')}`;
    assert.equal((await wall.DELETE(request('DELETE', `?id=${out.id}`, { headers: { cookie: other } }))).status, 403);
    assert.equal((await wall.DELETE(request('DELETE', `?id=${out.id}`, { headers: { cookie: session } }))).status, 200);
  } finally {
    withoutAuth0();
  }
});

test('the account ID is never stored as is', async () => {
  freshWall();
  withAuth0();
  try {
    const session = await signIn();
    await post(posted(), { cookie: session });
    assert.ok(!fs.readFileSync(process.env.WALL_DEV_FILE, 'utf8').includes('auth0|person-1'));
  } finally {
    withoutAuth0();
  }
});

test('sign out clears the session', async () => {
  const res = await auth.POST(new Request('http://x.test/api/auth?action=logout', { method: 'POST', headers: { host: 'x.test' } }));
  assert.equal(res.status, 200);
  assert.match(res.headers.getSetCookie()[0], new RegExp(`^${authHelpers.SESSION_COOKIE}=; .*Max-Age=0`));
});

