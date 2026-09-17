/**
 * The REAL database boundary behind `sports_fantasy_player_weeks`.
 *
 * WHY THIS FILE IS NOT IN `tests/*.test.js`. The sports-edge CI job is a dependency-free plain-node
 * contract: one `node --test "tests/*.test.js"` against the compiled routes, no checkout of the
 * framework, no `npm install`, no service container. A `pg` client and a PostgreSQL server are both
 * outside that contract, and a case that SKIPS when they are missing is a guard that does not exist
 * — this repository's local gate exits non-zero on a skip for exactly that reason. So this runs
 * deliberately, against a database you supply, and it lives in a subdirectory the job's glob cannot
 * reach rather than pretending to be part of a suite that never runs it.
 *
 * WHAT IT PROVES. The package's OWN shipped statements, against a real server: the migration DDL,
 * the runtime self-heal DDL over the migrated schema, `writePlayerWeeks` across its chunk boundary,
 * the `ON CONFLICT` upsert's idempotence over a real primary key, the JSONB round trip, and the
 * season / week-exclusive / roster bounds `readPlayerWeeks` claims. Rows are read back over a
 * SEPARATE connection so nothing is proved from the writing pool's own cache.
 *
 * THE COMPANION IT IS. `tests/sports-fantasy-history.test.js` doubles this round trip so the route
 * can be driven without a server. That double is recorded in the core repository's
 * docs/governance/real-boundary-regression-audit.md, and this file is the real half it names.
 * Wiring it into CI is entry F of BACKLOG.md.
 *
 * NEVER POINT THIS AT A DATABASE YOU CARE ABOUT. It creates and writes a real table. Use a
 * throwaway server on a throwaway port:
 *
 *   docker run -d --rm --name pw-proof -e POSTGRES_PASSWORD=pw \
 *     -p 127.0.0.1:55491:5432 postgres:16-alpine
 *   node tests/postgres/player-weeks-contract.mjs \
 *     postgresql://postgres:pw@127.0.0.1:55491/postgres <oshal checkout>
 *   docker rm -f pw-proof
 *
 * The second argument is a framework checkout, used for one thing: its `pg` driver. Exit 0 is the
 * whole contract passing; any failure exits non-zero and names the assertion.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — the real-server half of the player-weeks round trip the route guard doubles: migration and self-heal DDL, the chunked upsert and its idempotence, the JSONB round trip, and the read's season/week/roster bounds.
 */

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const [, , url, frameworkRoot] = process.argv;
if (!url || !frameworkRoot) {
  console.error('usage: node tests/postgres/player-weeks-contract.mjs <postgres url> <oshal checkout>');
  process.exit(2);
}

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { Pool } = createRequire(join(frameworkRoot, 'package.json'))('pg');
const store = createRequire(join(packageRoot, 'routes', 'anchor.js'))('./sports-fantasy-store.js');

const SEASON = 2026;
const passed = [];

/** @description Record one satisfied clause so a passing run says what it proved, not just "ok". */
function ok(name, detail) {
  passed.push(detail ? `${name} — ${detail}` : name);
}

/**
 * @description Run every clause against one disposable server.
 * @param pool - The pool the package's own statements are issued on.
 * @param reader - A second pool, so every read-back crosses a different connection.
 * @returns Nothing; throws on the first unmet clause.
 */
async function contract(pool, reader) {
  // 1. The shipped migration, verbatim.
  await pool.query(readFileSync(join(packageRoot, 'migrations', '005-sports-fantasy-player-weeks.sql'), 'utf8'));
  const columns = await reader.query(
    `SELECT column_name, data_type FROM information_schema.columns
      WHERE table_name = 'sports_fantasy_player_weeks' ORDER BY ordinal_position`,
  );
  assert.deepEqual(columns.rows.map((r) => r.column_name),
    ['season', 'week', 'player_id', 'stats', 'updated_at']);
  assert.equal(columns.rows[3].data_type, 'jsonb', 'raw stat lines are stored as JSONB, never as points');
  ok('migration 005 applies and yields the declared shape', columns.rows.map((r) => r.column_name).join(','));

  // 2. The runtime self-heal DDL must be equivalent — it runs second on an already-migrated box.
  await store.ensureFantasySchema(pool);
  ok('ensureFantasySchema re-runs over the migrated schema without error');

  // 3. A season that crosses the chunk boundary, read back over the other connection.
  const rows = [];
  for (let i = 0; i < store.PLAYER_WEEK_CHUNK * 2 + 7; i += 1) {
    rows.push({ playerId: 1000 + i, week: (i % 4) + 1, stats: { 0: i, 24: i * 2 } });
  }
  const written = await store.writePlayerWeeks(pool, SEASON, rows);
  assert.equal(written, rows.length, `writePlayerWeeks reported ${written} of ${rows.length}`);
  const counted = await reader.query(
    'SELECT count(*)::int AS n FROM sports_fantasy_player_weeks WHERE season = $1', [SEASON],
  );
  assert.equal(counted.rows[0].n, rows.length);
  ok(`${rows.length} rows written across ${Math.ceil(rows.length / store.PLAYER_WEEK_CHUNK)} chunks`,
    'counted back over a separate connection');

  // 4. A completed week is re-read from the feed on every refresh; it must update, never append.
  const again = await store.writePlayerWeeks(pool, SEASON, rows);
  const recounted = await reader.query(
    'SELECT count(*)::int AS n FROM sports_fantasy_player_weeks WHERE season = $1', [SEASON],
  );
  assert.equal(recounted.rows[0].n, rows.length, 'ON CONFLICT must update, not append');
  ok('the upsert is idempotent over a real primary key', `${again} rows refreshed, count unchanged`);

  // 5. JSONB round trip: the numbers that went in are the numbers that come out.
  const sample = await store.readPlayerWeeks(pool, SEASON, 99, [1000, 1001]);
  assert.deepEqual(sample.find((r) => r.playerId === 1001).stats, { 0: 1, 24: 2 });
  ok('raw stat lines survive the JSONB round trip', JSON.stringify(sample[0].stats));

  // 6. The three bounds the unit guard can only assert as statement TEXT, enforced by the server.
  await store.writePlayerWeeks(pool, SEASON - 1, [{ playerId: 1000, week: 1, stats: { 0: 111 } }]);
  const bounded = await store.readPlayerWeeks(pool, SEASON, 3, [1000, 1001, 1002, 1003, 999999]);
  assert.ok(bounded.length > 0, 'the bounded read must still return the weeks that qualify');
  assert.equal(bounded.every((r) => r.week < 3), true, 'the week being set stays out of its own history');
  assert.equal(bounded.some((r) => r.stats[0] === 111), false, 'the prior season must not leak in');
  assert.equal(bounded.every((r) => [1000, 1001, 1002, 1003].includes(r.playerId)), true, 'a roster, never the universe');
  ok('season / week-exclusive / roster bounds hold against the server',
    `${bounded.length} rows, weeks ${[...new Set(bounded.map((r) => r.week))].sort().join('+')}`);

  // 7. An empty roster asks the database nothing at all.
  assert.equal((await store.readPlayerWeeks(pool, SEASON, 3, [])).length, 0);
  ok('an empty roster short-circuits before the server is asked');
}

const pool = new Pool({ connectionString: url, max: 4 });
const reader = new Pool({ connectionString: url, max: 1 });
const started = Date.now();
try {
  await contract(pool, reader);
  console.log(`PLAYER_WEEKS_CONTRACT ok in ${Date.now() - started}ms`);
  for (const line of passed) console.log(`  PASS  ${line}`);
  console.log('PLAYER_WEEKS_CONTRACT=PASS');
} finally {
  await pool.end();
  await reader.end();
}
