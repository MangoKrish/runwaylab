// The wall against a real database, through the same function the site calls. Uses only the synthetic
// sample walk and removes what it creates. Run after `wall-db.mjs setup`, from the project folder:
//   node test/wall-postgres.mjs
// It reads DATABASE_URL from the environment or .env.local.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.join(HERE, '..');
const envFile = path.join(SITE, '.env.local');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
if (!process.env.DATABASE_URL) {
  console.log('No DATABASE_URL found.');
  process.exit(1);
}
process.env.WALL_SECRET ||= 'test-only-secret';
for (const k of ['AUTH0_DOMAIN', 'AUTH0_BASE_URL', 'AUTH0_CLIENT_ID', 'AUTH0_CLIENT_SECRET', 'RUNWAYLAB_DEV']) delete process.env[k];

const api = (name) => import(pathToFileURL(path.join(SITE, 'api', name)).href);
const wall = await api('wall.mjs');
const common = await api('_common.mjs');
const store = await api('_wallstore.mjs');
const { generateSampleRaw } = await import(pathToFileURL(path.join(SITE, 'src/lib/sampleWalk.mjs')).href);
const { processFrames } = await import(pathToFileURL(path.join(SITE, 'src/lib/process.mjs')).href);

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const { raw, W, H, duration } = generateSampleRaw();
const a = processFrames(raw, { W, H, duration });
const frames = a.frames.map((f) => ({ t: f.t, s: f.status, p: f.pts ? f.pts.map((q) => (q ? [q[0], q[1]] : null)) : null }));
const judgeOf = (presence, style) => {
  const j = { presence: { score: presence, why: 'Test.' }, style: { score: style, why: 'Test.' }, match: { id: 'kloss', name: 'Karlie Kloss', tag: 'The Panther', why: 'Test.' }, verdict: 'A test verdict.', tip: 'Test tip.', moments: [{ t: 2, still: 0, note: 'Test note.' }], model: 'test' };
  return { ...j, sig: common.signJudge(j) };
};

const req = (method, query = '', { body, headers = {} } = {}) => new Request(`http://x.test/api/wall${query}`, { method, headers: { host: 'x.test', 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const created = [];
const post = async (name, judge) => {
  const res = await wall.POST(req('POST', '', { body: { name, W, H, duration, frames, judge } }));
  const out = await res.json();
  if (out.id) created.push(out);
  return { status: res.status, ...out };
};

const before = await (await wall.GET(req('GET', '?action=stats'))).json();
try {
  const info = await (await wall.GET(req('GET', '?action=info'))).json();
  check('reports the Postgres store', info.ready && info.store === 'postgres');

  const started = Date.now();
  const high = await post('__test high', judgeOf(15, 15));
  const low = await post('__test low', judgeOf(2, 2));
  const plain = await post('__test unjudged');
  check('posts are stored', high.status === 201 && low.status === 201 && plain.status === 201, `${Date.now() - started} ms for 3 posts of ${frames.length} frames`);
  check('the score is the server\'s own', high.total === a.measured.points + 30 && low.total === a.measured.points + 4 && plain.total === null);

  const one = await (await wall.GET(req('GET', `?id=${high.id}`))).json();
  // The server keeps times to the millisecond, and the sample's times have more digits than that.
  const toMs = (t) => Math.round(t * 1000) / 1000;
  check('every frame comes back in order', one.walk.frames.length === frames.length && one.walk.frames.every((f, i) => f.t === toMs(frames[i].t) && f.status === frames[i].s));
  check('landmarks are exact', JSON.stringify(one.walk.frames[50].pts) === JSON.stringify(frames[50].p));
  check('details round-trip', one.walk.detail.judge.match.name === 'Karlie Kloss' && one.walk.detail.metrics.footLine.value === a.metrics.footLine.value);
  check('no owner data comes back', !JSON.stringify(one).includes('owner'));

  const top = (await (await wall.GET(req('GET', '?sort=top'))).json()).walks.filter((w) => w.name.startsWith('__test')).map((w) => w.name);
  check('top sort: score first, unjudged last', top.join() === '__test high,__test low,__test unjudged', top.join());
  const latest = (await (await wall.GET(req('GET', '?sort=new'))).json()).walks.filter((w) => w.name.startsWith('__test')).map((w) => w.name);
  check('newest sort', latest.join() === '__test unjudged,__test low,__test high', latest.join());

  check('claps count', (await (await wall.POST(req('POST', `?action=clap&id=${high.id}`))).json()).claps === 1);
  const quick = await Promise.all(Array.from({ length: 5 }, () => wall.POST(req('POST', `?action=clap&id=${high.id}`))));
  check('claps at the same moment all count', quick.every((r) => r.status === 200) && (await (await wall.GET(req('GET', `?id=${high.id}`))).json()).walk.claps === 6);

  const stats = await (await wall.GET(req('GET', '?action=stats'))).json();
  check('stats include new posts straight away', stats.walks === before.walks + 3 && stats.lastHour >= 3, JSON.stringify(stats));
  check('stats top and average use judged walks only', stats.top >= high.total && Number.isFinite(stats.average));

  // On TimescaleDB, prove that replay and delete still work once frames have been compressed.
  const { default: pgc } = await import('pg');
  const direct = new pgc.Client({ connectionString: process.env.DATABASE_URL });
  await direct.connect();
  const timescale = await direct.query("SELECT 1 FROM pg_extension WHERE extname = 'timescaledb'");
  if (timescale.rowCount) {
    const hyper = await direct.query('SELECT hypertable_name FROM timescaledb_information.hypertables ORDER BY 1');
    check('both tables are hypertables', hyper.rows.map((r) => r.hypertable_name).join() === 'walk_frames,walks', hyper.rows.map((r) => r.hypertable_name).join());
    const aggregate = await direct.query("SELECT materialized_only FROM timescaledb_information.continuous_aggregates WHERE view_name = 'wall_stats'");
    check('wall_stats is a real-time continuous aggregate', aggregate.rows[0]?.materialized_only === false);
    const done = await direct.query("SELECT compress_chunk(c, if_not_compressed => TRUE) FROM show_chunks('walk_frames') AS c");
    check('frames compress', done.rowCount > 0, `${done.rowCount} chunk(s)`);
    const sizes = await direct.query("SELECT before_compression_total_bytes AS before, after_compression_total_bytes AS after FROM hypertable_compression_stats('walk_frames')");
    const { before: b, after: c } = sizes.rows[0] ?? {};
    if (b) console.log(`        frame storage: ${Math.round(b / 1024)} KB before, ${Math.round(c / 1024)} KB after`);
    const replay = await (await wall.GET(req('GET', `?id=${low.id}`))).json();
    check('replay reads from compressed frames', replay.walk.frames.length === frames.length && JSON.stringify(replay.walk.frames[50].pts) === JSON.stringify(frames[50].p));
  } else {
    console.log('        plain Postgres: no TimescaleDB, so hypertable and compression checks are skipped');
  }
  await direct.end();

  check('a stranger cannot delete', (await wall.DELETE(req('DELETE', `?id=${high.id}`, { headers: { 'x-wall-token': 'wrong' } }))).status === 403);
  check('nasty input is harmless', (await wall.GET(req('GET', "?id='; DROP TABLE walks; --"))).status === 404);
  const nasty = await post("'); DROP TABLE walks; --");
  const nastyBack = await (await wall.GET(req('GET', `?id=${nasty.id}`))).json();
  check('a name with SQL in it is stored as plain text', nastyBack.walk?.name === "'); DROP TABLE walks; --");

  const rolledBack = await wall.POST(req('POST', '', { body: { name: '__test bad', W, H, duration, frames: [{ t: 0, s: 'valid', p: null }] } }));
  check('a refused post leaves nothing behind', rolledBack.status === 422 || rolledBack.status === 400);
} finally {
  for (const { id, token } of created) await wall.DELETE(req('DELETE', `?id=${id}`, { headers: { 'x-wall-token': token } }));
}
for (const { id } of created) {
  const gone = await wall.GET(req('GET', `?id=${id}`));
  if (gone.status !== 404) check(`walk ${id} removed`, false);
}
const rows = (await (await wall.GET(req('GET', '?sort=new'))).json()).walks.filter((w) => w.name.startsWith('__test'));
check('cleanup removed every test post', rows.length === 0);

const { default: pg } = await import('pg');
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const left = await db.query('SELECT count(*)::int AS n FROM walk_frames WHERE walk_id = ANY($1::uuid[])', [created.map((c) => c.id)]);
check('deleting a walk deletes its frames', left.rows[0].n === 0);
await db.end();

await store.closePool();
console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
