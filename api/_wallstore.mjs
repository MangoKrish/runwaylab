// Where wall posts live. Two back ends share one interface: Postgres in production (Tiger Data), and a
// labeled JSON file for local previews, so the wall can be tried with no account.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const STATS_BUCKET = '15 minutes';

/**
 * Database setup, run once by scripts/wall-db.mjs setup. Steps are separate because a continuous aggregate
 * cannot be created inside a transaction. The `timescale` steps run only where TimescaleDB is available;
 * on plain Postgres the wall still works, with an ordinary view in place of the aggregate.
 *
 * Tiger Data earns its place here in three ways:
 *   walk_frames: a hypertable of pose landmarks over time, one row per sampled frame, which is the
 *     "high-frequency metric stream" a time-series database is for.
 *   Compression: those frames are repetitive, so older chunks shrink a lot.
 *   wall_stats: a continuous aggregate, so the numbers at the top of the wall stay fast as posts grow.
 */
export const SCHEMA = {
  tables: [
    `CREATE TABLE IF NOT EXISTS walks (
      id uuid NOT NULL,
      posted_at timestamptz NOT NULL,
      name text NOT NULL,
      owner_hash text NOT NULL,
      width integer NOT NULL,
      height integer NOT NULL,
      duration real NOT NULL,
      total smallint,
      measured smallint NOT NULL,
      claps integer NOT NULL DEFAULT 0,
      detail jsonb NOT NULL,
      PRIMARY KEY (id, posted_at)
    )`,
    `CREATE TABLE IF NOT EXISTS walk_frames (
      time timestamptz NOT NULL,
      walk_id uuid NOT NULL,
      t real NOT NULL,
      status text NOT NULL,
      pts jsonb
    )`,
    'CREATE INDEX IF NOT EXISTS walk_frames_walk_idx ON walk_frames (walk_id, time)',
    'CREATE INDEX IF NOT EXISTS walks_rank_idx ON walks (total DESC NULLS LAST, measured DESC, posted_at DESC)',
    'CREATE INDEX IF NOT EXISTS walks_new_idx ON walks (posted_at DESC)',
    'CREATE INDEX IF NOT EXISTS walks_id_idx ON walks (id)',
  ],
  timescale: [
    "SELECT create_hypertable('walks', 'posted_at', chunk_time_interval => INTERVAL '7 days', if_not_exists => TRUE, migrate_data => TRUE)",
    "SELECT create_hypertable('walk_frames', 'time', chunk_time_interval => INTERVAL '1 day', if_not_exists => TRUE, migrate_data => TRUE)",
    "ALTER TABLE walk_frames SET (timescaledb.compress, timescaledb.compress_segmentby = 'walk_id', timescaledb.compress_orderby = 'time')",
    "SELECT add_compression_policy('walk_frames', INTERVAL '3 days', if_not_exists => TRUE)",
    `CREATE MATERIALIZED VIEW IF NOT EXISTS wall_stats
      WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
      SELECT time_bucket(INTERVAL '${STATS_BUCKET}', posted_at) AS bucket,
             count(*) AS walks, count(total) AS scored, sum(total) AS score_sum, max(total) AS top
      FROM walks GROUP BY bucket WITH NO DATA`,
    `SELECT add_continuous_aggregate_policy('wall_stats',
      start_offset => INTERVAL '3 days', end_offset => INTERVAL '${STATS_BUCKET}',
      schedule_interval => INTERVAL '5 minutes', if_not_exists => TRUE)`,
  ],
  plain: [
    `CREATE OR REPLACE VIEW wall_stats AS
      SELECT date_bin(INTERVAL '${STATS_BUCKET}', posted_at, TIMESTAMPTZ '2000-01-01') AS bucket,
             count(*) AS walks, count(total) AS scored, sum(total) AS score_sum, max(total) AS top
      FROM walks GROUP BY bucket`,
  ],
};

const fromRow = (row) => ({
  id: row.id,
  postedAt: new Date(row.posted_at).toISOString(),
  name: row.name,
  ownerHash: row.owner_hash,
  width: row.width,
  height: row.height,
  duration: row.duration,
  total: row.total,
  measured: row.measured,
  claps: row.claps,
  detail: row.detail,
});

const COLUMNS = 'id, posted_at, name, owner_hash, width, height, duration, total, measured, claps, detail';

// Tiger Data signs its servers with its own certificate authority, which Node does not trust by default.
// Trust exactly that one, kept beside this file, so the connection is still fully verified.
const TIGER_CA = new URL('./_tiger-ca.pem', import.meta.url);

/** Connection settings for pg. The URL's sslmode would replace the ssl option, so it is taken out here. */
export async function pgConfig(url) {
  const u = new URL(url);
  const mode = u.searchParams.get('sslmode');
  if (!mode || mode === 'disable') return { connectionString: url };
  u.searchParams.delete('sslmode');
  const tiger = /\.timescale\.com$|\.tigerdata\.com$/.test(u.hostname);
  const ca = tiger ? await fs.readFile(TIGER_CA, 'utf8') : undefined;
  return { connectionString: u.href, ssl: ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: true } };
}

// One pool per running function instance. Small, because serverless runs many instances.
let pool = null;
let poolUrl = null;
async function getPool(url) {
  if (pool && poolUrl === url) return pool;
  const { default: pg } = await import('pg');
  pool = new pg.Pool({ ...(await pgConfig(url)), max: 2, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 8_000 });
  pool.on('error', (err) => console.error('wall database:', err.code || err.message));
  poolUrl = url;
  return pool;
}

export async function closePool() {
  const closing = pool;
  pool = null;
  poolUrl = null;
  await closing?.end();
}

function postgresStore(url) {
  return {
    kind: 'postgres',
    async count() {
      const db = await getPool(url);
      const { rows } = await db.query('SELECT count(*)::int AS n FROM walks');
      return rows[0].n;
    },
    /** One transaction, so a walk can never exist without its frames. */
    async create(walk, frames) {
      const db = await getPool(url);
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO walks (id, posted_at, name, owner_hash, width, height, duration, total, measured, detail)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [walk.id, walk.postedAt, walk.name, walk.ownerHash, walk.width, walk.height, walk.duration, walk.total, walk.measured, JSON.stringify(walk.detail)],
        );
        // One statement for all frames: faster than one insert per frame, and it stays a single round trip.
        await client.query(
          `INSERT INTO walk_frames (time, walk_id, t, status, pts)
           SELECT $1::timestamptz + (f.t * INTERVAL '1 second'), $2::uuid, f.t, f.status, f.pts
           FROM jsonb_to_recordset($3::jsonb) AS f(t real, status text, pts jsonb)`,
          [walk.postedAt, walk.id, JSON.stringify(frames)],
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    async list({ sort, limit, offset }) {
      const db = await getPool(url);
      const order = sort === 'new' ? 'posted_at DESC' : 'total DESC NULLS LAST, measured DESC, posted_at DESC';
      const { rows } = await db.query(`SELECT ${COLUMNS} FROM walks ORDER BY ${order} LIMIT $1 OFFSET $2`, [limit, offset]);
      return rows.map(fromRow);
    },
    async get(id) {
      const db = await getPool(url);
      const { rows } = await db.query(`SELECT ${COLUMNS} FROM walks WHERE id = $1 LIMIT 1`, [id]);
      if (!rows.length) return null;
      const frames = await db.query('SELECT t, status, pts FROM walk_frames WHERE walk_id = $1 ORDER BY time', [id]);
      return { ...fromRow(rows[0]), frames: frames.rows.map((f) => ({ t: Math.round(f.t * 1000) / 1000, status: f.status, pts: f.pts })) };
    },
    async clap(id) {
      const db = await getPool(url);
      const { rows } = await db.query('UPDATE walks SET claps = LEAST(claps + 1, 99999) WHERE id = $1 RETURNING claps', [id]);
      return rows[0]?.claps ?? null;
    },
    /** @returns 'removed', 'not-found' or 'not-owner' */
    async remove(id, owner) {
      const db = await getPool(url);
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        const found = await client.query('SELECT owner_hash FROM walks WHERE id = $1 LIMIT 1', [id]);
        if (!found.rows.length) {
          await client.query('ROLLBACK');
          return 'not-found';
        }
        if (found.rows[0].owner_hash !== owner) {
          await client.query('ROLLBACK');
          return 'not-owner';
        }
        await client.query('DELETE FROM walks WHERE id = $1', [id]);
        await client.query('DELETE FROM walk_frames WHERE walk_id = $1', [id]);
        await client.query('COMMIT');
        return 'removed';
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    async stats() {
      const db = await getPool(url);
      const { rows } = await db.query(`
        SELECT coalesce(sum(walks), 0)::int AS walks,
               coalesce(sum(walks) FILTER (WHERE bucket > now() - INTERVAL '1 hour'), 0)::int AS last_hour,
               sum(score_sum)::float / nullif(sum(scored), 0) AS average,
               max(top)::int AS top
        FROM wall_stats`);
      const r = rows[0];
      return { walks: r.walks, lastHour: r.last_hour, average: r.average === null ? null : Math.round(r.average), top: r.top };
    },
  };
}

// ── the local test wall ──
const devFile = () => process.env.WALL_DEV_FILE || path.join(os.tmpdir(), 'runwaylab-local-wall.json');

async function readDev() {
  try {
    return JSON.parse(await fs.readFile(devFile(), 'utf8'));
  } catch {
    return { walks: [], frames: {} };
  }
}

// Writes queue up, so two quick posts cannot overwrite each other.
let devQueue = Promise.resolve();
function changeDev(change) {
  const run = devQueue.then(async () => {
    const data = await readDev();
    const out = await change(data);
    await fs.writeFile(devFile(), JSON.stringify(data));
    return out;
  });
  devQueue = run.catch(() => {});
  return run;
}

const devCompare = (sort) => (a, b) => {
  if (sort === 'new') return b.postedAt.localeCompare(a.postedAt);
  return (b.total ?? -1) - (a.total ?? -1) || b.measured - a.measured || b.postedAt.localeCompare(a.postedAt);
};

function fileStore() {
  return {
    kind: 'local',
    async count() {
      return (await readDev()).walks.length;
    },
    async create(walk, frames) {
      await changeDev((data) => {
        data.walks.push({ ...walk, claps: 0 });
        data.frames[walk.id] = frames;
      });
    },
    async list({ sort, limit, offset }) {
      const { walks } = await readDev();
      return [...walks].sort(devCompare(sort)).slice(offset, offset + limit);
    },
    async get(id) {
      const { walks, frames } = await readDev();
      const walk = walks.find((w) => w.id === id);
      return walk ? { ...walk, frames: frames[id] || [] } : null;
    },
    async clap(id) {
      return changeDev((data) => {
        const walk = data.walks.find((w) => w.id === id);
        if (!walk) return null;
        walk.claps = Math.min(walk.claps + 1, 99999);
        return walk.claps;
      });
    },
    async remove(id, owner) {
      return changeDev((data) => {
        const walk = data.walks.find((w) => w.id === id);
        if (!walk) return 'not-found';
        if (walk.ownerHash !== owner) return 'not-owner';
        data.walks = data.walks.filter((w) => w.id !== id);
        delete data.frames[id];
        return 'removed';
      });
    },
    async stats() {
      const { walks } = await readDev();
      const scored = walks.filter((w) => w.total !== null);
      const hourAgo = Date.now() - 3_600_000;
      return {
        walks: walks.length,
        lastHour: walks.filter((w) => Date.parse(w.postedAt) > hourAgo).length,
        average: scored.length ? Math.round(scored.reduce((sum, w) => sum + w.total, 0) / scored.length) : null,
        top: scored.length ? Math.max(...scored.map((w) => w.total)) : null,
      };
    },
  };
}

/** @returns the store to use, or null when the wall is not connected. */
export function getStore() {
  if (process.env.DATABASE_URL) return postgresStore(process.env.DATABASE_URL);
  if (process.env.RUNWAYLAB_DEV) return fileStore();
  return null;
}
