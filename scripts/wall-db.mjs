// Run the wall's database from the command line. From the project folder, with DATABASE_URL in .env.local:
//   node scripts/wall-db.mjs setup        create tables and turn on the TimescaleDB features
//   node scripts/wall-db.mjs status       show what exists, sizes and compression
//   node scripts/wall-db.mjs compress     compress frames now, to see the saving
//   node scripts/wall-db.mjs list         list posts
//   node scripts/wall-db.mjs delete <id>  remove a post: moderation, for walks that should not be up
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { SCHEMA, pgConfig } from '../api/_wallstore.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.join(HERE, '..', '.env.local');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
if (!process.env.DATABASE_URL) {
  console.log('No DATABASE_URL found. Put it in .env.local (see .env.example).');
  process.exit(1);
}

const [command, argument] = process.argv.slice(2);
const db = new pg.Client(await pgConfig(process.env.DATABASE_URL));
await db.connect();

async function hasTimescale() {
  const { rows } = await db.query("SELECT extversion FROM pg_extension WHERE extname = 'timescaledb'");
  return rows[0]?.extversion ?? null;
}
const size = (bytes) => (bytes === null || bytes === undefined ? 'none' : `${(Number(bytes) / 1024).toFixed(0)} KB`);

async function setup() {
  await db.query('CREATE EXTENSION IF NOT EXISTS timescaledb').catch((err) => console.log(`TimescaleDB could not be enabled: ${err.message}`));
  for (const statement of SCHEMA.tables) await db.query(statement);
  const version = await hasTimescale();
  if (version) {
    for (const statement of SCHEMA.timescale) await db.query(statement);
    console.log(`Done: tables, hypertables, compression policy and continuous aggregate, on TimescaleDB ${version}.`);
  } else {
    for (const statement of SCHEMA.plain) await db.query(statement);
    console.log('Done on plain Postgres: tables and a stats view. No TimescaleDB, so no hypertables or compression.');
  }
}

async function status() {
  const version = await hasTimescale();
  const walks = await db.query('SELECT count(*)::int AS n FROM walks');
  const frames = await db.query('SELECT count(*)::int AS n FROM walk_frames');
  console.log(`TimescaleDB: ${version ?? 'not installed'}\nWalks: ${walks.rows[0].n}\nFrames: ${frames.rows[0].n}`);
  if (!version) return;
  const tables = await db.query('SELECT hypertable_name FROM timescaledb_information.hypertables ORDER BY 1');
  console.log(`Hypertables: ${tables.rows.map((r) => r.hypertable_name).join(', ')}`);
  const views = await db.query('SELECT view_name, materialized_only FROM timescaledb_information.continuous_aggregates');
  console.log(`Continuous aggregates: ${views.rows.map((r) => `${r.view_name} (${r.materialized_only ? 'materialized only' : 'real time'})`).join(', ') || 'none'}`);
  const { rows } = await db.query("SELECT total_chunks, number_compressed_chunks, before_compression_total_bytes AS before, after_compression_total_bytes AS after FROM hypertable_compression_stats('walk_frames')");
  const c = rows[0];
  console.log(`Frame chunks: ${c?.total_chunks ?? 0}, compressed: ${c?.number_compressed_chunks ?? 0}`);
  if (c?.before) console.log(`Frame storage: ${size(c.before)} before, ${size(c.after)} after (${Math.round((1 - c.after / c.before) * 100)}% smaller)`);
}

async function compress() {
  const { rows } = await db.query("SELECT compress_chunk(c, if_not_compressed => TRUE) AS chunk FROM show_chunks('walk_frames') AS c");
  console.log(`Compressed ${rows.length} chunk(s).`);
  await status();
}

async function list() {
  const { rows } = await db.query('SELECT id, posted_at, name, total, measured, claps FROM walks ORDER BY posted_at DESC LIMIT 100');
  for (const r of rows) console.log(`${r.id}  ${new Date(r.posted_at).toLocaleString()}  ${r.total ?? `${r.measured}/50`}  claps ${r.claps}  ${r.name}`);
  if (!rows.length) console.log('The wall is empty.');
}

async function remove(id) {
  if (!id) {
    console.log('Say which walk: wall-db.mjs delete <id>. The list command shows the IDs.');
    process.exitCode = 1;
    return;
  }
  await db.query('BEGIN');
  const walks = await db.query('DELETE FROM walks WHERE id = $1', [id]);
  const frames = await db.query('DELETE FROM walk_frames WHERE walk_id = $1', [id]);
  await db.query('COMMIT');
  console.log(`Removed ${walks.rowCount} walk and ${frames.rowCount} frames.`);
}

try {
  if (command === 'setup') await setup();
  else if (command === 'status') await status();
  else if (command === 'compress') await compress();
  else if (command === 'list') await list();
  else if (command === 'delete') await remove(argument);
  else console.log('Commands: setup, status, compress, list, delete <id>');
} catch (err) {
  console.error(`Failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await db.end();
}
