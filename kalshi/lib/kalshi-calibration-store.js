/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The calibration rebuild's storage and one turn of it (migrations/077-kalshi-calibration.sql). A turn reads where the walk stands, walks Kalshi's tape until its time is spent (lib/kalshi-calibration-walk.js), and writes once at its end: the turn's samples in one statement and the cursor in another, because a statement on the native kernel reads the person's whole table. A finished walk builds the table from its samples in the order they were found, keeps it, and drops the samples of older walks. Readers take the newest rebuilt table, else the table the package ships. Guard: tests/kalshi-calibration-walk.test.js.
 */
'use strict';

const { randomUUID } = require('node:crypto');
const { HORIZONS } = require('./kalshi-calibration-build');
const { freshCursor, walkTurn, rebuildDue, tableOf } = require('./kalshi-calibration-walk');

/** Samples written per statement: eight values a row stays far inside PostgreSQL's parameter limit. */
const SAMPLE_ROWS_PER_STATEMENT = 500;

// Statements follow what the native kernel does well with a person's own tables (measured 2026-11-11): reads by
// equality, no ORDER BY, ON CONFLICT or DISTINCT on a growing table, never more than 10,000 rows in one answer, and the
// newest row of a small table picked here rather than by the database.

/** The newest of rows by an ISO or Date column. */
function newest(rows, column) {
  return rows.reduce((best, row) => (!best || Date.parse(row[column]) > Date.parse(best[column]) ? row : best), null);
}

/**
 * @description The newest rebuilt table, or null when none has been built.
 * @param {{query: Function}} pool The package's pool.
 * @returns {Promise<{table: object, generatedAt: string, markets: number, samples: number}|null>} The table.
 */
async function latestTable(pool) {
  const { rows } = await pool.query('SELECT walk_id, table_json, generated_at, markets, samples FROM kalshi_calibration_tables');
  const row = newest(rows, 'generated_at');
  if (!row) return null;
  const table = typeof row.table_json === 'string' ? JSON.parse(row.table_json) : row.table_json;
  return { table, generatedAt: new Date(row.generated_at).toISOString(), markets: Number(row.markets), samples: Number(row.samples) };
}

/**
 * @description The walk in progress, or null.
 * @param {{query: Function}} pool The package's pool.
 * @returns {Promise<object|null>} The walk: id, cursor, counters, when it started.
 */
async function openWalk(pool) {
  const { rows } = await pool.query(
    'SELECT id, cursor, markets, requests, skipped, samples, started_at FROM kalshi_calibration_walks WHERE finished_at IS NULL');
  const row = newest(rows, 'started_at');
  if (!row) return null;
  return { id: row.id, cursor: typeof row.cursor === 'string' ? JSON.parse(row.cursor) : row.cursor, markets: Number(row.markets),
    requests: Number(row.requests), skipped: Number(row.skipped), samples: Number(row.samples), startedAt: new Date(row.started_at).toISOString() };
}

/**
 * @description Insert a turn's samples in statements of SAMPLE_ROWS_PER_STATEMENT rows, numbered on from the walk's
 * count so the order they were found is kept.
 * @param {{query: Function}} pool The package's pool. @param {string} walkId The walk. @param {number} from The walk's
 * sample count before this turn. @param {object[]} samples The turn's samples.
 * @returns {Promise<void>} Written.
 */
async function addSamples(pool, walkId, from, samples) {
  for (let at = 0; at < samples.length; at += SAMPLE_ROWS_PER_STATEMENT) {
    const chunk = samples.slice(at, at + SAMPLE_ROWS_PER_STATEMENT), values = [], params = [];
    chunk.forEach((s, i) => {
      const o = i * 8, seq = from + at + i;
      values.push(`($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}, $${o + 5}, $${o + 6}, $${o + 7}, $${o + 8})`);
      params.push(`${walkId}:${seq}`, seq, walkId, s.ticker, s.category, s.horizonHours, s.price, s.settledYes);
    });
    await pool.query('INSERT INTO kalshi_calibration_samples (id, seq, walk_id, ticker, category, horizon_hours, price, settled_yes) VALUES '
      + values.join(', '), params);
  }
}

/**
 * @description Every sample of a walk, in the order the walk found them: read one horizon at a time (no answer over the
 * kernel's 10,000 rows) and put in order here.
 * @param {{query: Function}} pool The package's pool. @param {string} walkId The walk.
 * @returns {Promise<object[]>} The samples.
 */
async function walkSamples(pool, walkId) {
  const rows = [];
  for (const h of HORIZONS) {
    const answer = await pool.query('SELECT seq, ticker, category, horizon_hours, price, settled_yes FROM kalshi_calibration_samples WHERE walk_id = $1 AND horizon_hours = $2', [walkId, h]);
    rows.push(...answer.rows);
  }
  rows.sort((a, b) => Number(a.seq) - Number(b.seq));
  return rows.map((r) => ({ ticker: r.ticker, category: r.category, horizonHours: Number(r.horizon_hours), price: Number(r.price), settledYes: Boolean(r.settled_yes) }));
}

/** Build, keep and close out a finished walk. */
async function finishWalk(pool, walk, nowMs) {
  const samples = await walkSamples(pool, walk.id), table = tableOf(samples, new Date(nowMs));
  const older = (await pool.query('SELECT walk_id FROM kalshi_calibration_tables')).rows.map((r) => r.walk_id);
  await pool.query('INSERT INTO kalshi_calibration_tables (walk_id, generated_at, markets, samples, table_json) VALUES ($1, $2, $3, $4, $5)',
    [walk.id, table.generatedAt, walk.markets, samples.length, JSON.stringify(table)]);
  await pool.query('UPDATE kalshi_calibration_walks SET cursor = $2, markets = $3, requests = $4, skipped = $5, samples = $6, finished_at = $7, last_error = NULL, updated_at = $7 WHERE id = $1',
    [walk.id, JSON.stringify(walk.cursor), walk.markets, walk.requests, walk.skipped, walk.samples, table.generatedAt]);
  // The new table is kept; the tables and samples of earlier walks go, by their own key.
  for (const id of older) {
    await pool.query('DELETE FROM kalshi_calibration_tables WHERE walk_id = $1', [id]);
    await pool.query('DELETE FROM kalshi_calibration_samples WHERE walk_id = $1', [id]);
  }
  return { generatedAt: table.generatedAt, samples: samples.length };
}

/**
 * @description One turn of the rebuild: carry on the walk in progress, or start one when the newest table is due, or do
 * nothing. Writes once at the end of the turn.
 * @param {{query: Function}} pool The package's pool (the person's own tables).
 * @param {object} io The reads (lib/kalshi-calibration-walk.js walkStep).
 * @param {{budgetMs: number, nowMs?: number, now?: () => number}} options Time to spend; the clock for tests.
 * @returns {Promise<object>} What the turn did: `ran` false with `reason` 'fresh' when nothing is due; else the walk's id,
 * the turn's counts, the walk's totals, `done`, the new table's time when it finished, and `error` when a read stopped it.
 */
async function rebuildTurn(pool, io, options) {
  const nowMs = options.nowMs ?? Date.now();
  let walk = await openWalk(pool);
  if (!walk) {
    const latest = await latestTable(pool);
    if (!rebuildDue(latest ? latest.generatedAt : null, nowMs)) return { ran: false, reason: 'fresh', builtAt: latest.generatedAt };
    walk = { id: randomUUID(), cursor: freshCursor(), markets: 0, requests: 0, skipped: 0, samples: 0, startedAt: new Date(nowMs).toISOString() };
    await pool.query('INSERT INTO kalshi_calibration_walks (id, cursor, started_at, updated_at) VALUES ($1, $2, $3, $3)',
      [walk.id, JSON.stringify(walk.cursor), walk.startedAt]);
  }
  const turn = await walkTurn(walk.cursor, io, { budgetMs: options.budgetMs, now: options.now });
  await addSamples(pool, walk.id, walk.samples, turn.samples);
  walk.markets += turn.markets; walk.requests += turn.requests; walk.skipped += turn.skipped; walk.samples += turn.samples.length;
  const result = { ran: true, walkId: walk.id, requests: turn.requests, markets: turn.markets, samples: turn.samples.length,
    skipped: turn.skipped, failures: turn.failures, totalMarkets: walk.markets, queued: walk.cursor.queue.length, category: walk.cursor.ci, done: turn.done };
  if (turn.done) return { ...result, ...(await finishWalk(pool, walk, nowMs)) };
  await pool.query('UPDATE kalshi_calibration_walks SET cursor = $2, markets = $3, requests = $4, skipped = $5, samples = $6, last_error = $7, updated_at = $8 WHERE id = $1',
    [walk.id, JSON.stringify(walk.cursor), walk.markets, walk.requests, walk.skipped, walk.samples, turn.error || null, new Date(nowMs).toISOString()]);
  return turn.error ? { ...result, error: turn.error } : result;
}

/**
 * @description The table the scan reads: the newest rebuilt one, else the table the package ships (`fallback`). A
 * failed read of the rebuilt table is reported to `onError` and the shipped table is used.
 * @param {{query: Function}} pool The package's pool.
 * @param {() => {table: object|null, mtime: string|null}} fallback The shipped table's reader.
 * @param {(error: Error) => void} [onError] Told when the rebuilt table could not be read.
 * @returns {Promise<{table: object|null, mtime: string|null, source: 'rebuilt'|'shipped'|null}>} The table, its time and
 * where it came from.
 */
async function calibrationTableFor(pool, fallback, onError) {
  let latest = null;
  try { latest = pool ? await latestTable(pool) : null; } catch (error) { latest = null; if (onError) onError(error); }
  if (latest) return { table: latest.table, mtime: latest.generatedAt, source: 'rebuilt' };
  const shipped = fallback();
  return { table: shipped.table, mtime: shipped.mtime, source: shipped.table ? 'shipped' : null };
}

module.exports = { latestTable, openWalk, addSamples, walkSamples, rebuildTurn, calibrationTableFor, SAMPLE_ROWS_PER_STATEMENT };
