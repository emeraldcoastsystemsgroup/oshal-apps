/**
 * Per-person ownership, as far as a plain-node suite can see it (ADR-146 Q2, operator decision
 * 2026-09-27: "only i can control my team.. no one else can see my team and connection").
 *
 * WHAT THIS SUITE PROVES AND WHAT IT DOES NOT. It reads the migration and the store's own statements
 * and drives the router with the connection lookup doubled, so it can say: every table this package
 * creates is walled (forced, exact owner, no operator arm), the self-heal DDL creates the same wall,
 * every statement names its owner, and a household-shared ESPN connection is never spent. It CANNOT
 * say the database enforces any of that — tests/fantasy-isolation.spec.ts proves that on a disposable
 * PostgreSQL with a NOBYPASSRLS role, the real broker and the real routes over HTTP.
 *
 * Run from the package root: node --test "tests/*-*.test.js"
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — every migrated table is in OWNED_TABLES, forced, with an exact-owner policy and no operator arm (migration and self-heal both); every store statement names its owner; the router spends only the caller's own ESPN connection and never a household-shared one.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | 0.2.0: the owner-first statement guard covers the hand-typed league store, the week ledger and the new call and feed reads (23 statements), and the migrations it reads now include 002 (ff_manual_leagues, ff_weeks).
 */

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const store = require('../routes/fantasy-store.js');
const manual = require('../routes/fantasy-manual.js');
const grading = require('../routes/fantasy-grading.js');
const { drive, loadRouter, memPool } = require('./fantasy-routes-harness.js');

const MIGRATIONS = path.resolve(__dirname, '..', 'migrations');
/** Every migration, in order, as one text with comments removed. */
const SQL = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()
  .map((f) => fs.readFileSync(path.join(MIGRATIONS, f), 'utf8')).join('\n')
  .replace(/--[^\n]*/g, '');

test('EVERY TABLE THE MIGRATIONS CREATE IS WALLED — none can be added without its owner policy', () => {
  const created = [...SQL.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]).sort();
  assert.deepEqual(created, [...store.OWNED_TABLES].sort(), 'a table the migrations create is missing from OWNED_TABLES');
  for (const table of created) {
    assert.match(SQL, new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([^;]*user_sub\\s+TEXT NOT NULL`), `${table} must carry its owner`);
    assert.match(SQL, new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`), `${table} must enable row security`);
    assert.match(SQL, new RegExp(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`), `${table} must FORCE it — the api owns the table`);
  }
});

test('THE POLICY IS EXACT OWNER WITH NO OPERATOR ARM — in the migration and in the self-heal', () => {
  assert.equal(/is_operator/.test(SQL), false, 'no role — operator included — reads another person\'s team');
  assert.match(SQL, /USING \(user_sub = nullif\(current_setting\(''oshal\.current_sub'', true\), ''''\)\)/);
  assert.match(SQL, /WITH CHECK \(user_sub = nullif\(current_setting\(''oshal\.current_sub'', true\), ''''\)\)/);
  assert.match(SQL, /RAISE EXCEPTION 'fantasy-football: row security is not forced/, 'the migration reads the catalog back');
  for (const table of store.OWNED_TABLES) {
    const stmts = store.ownerPolicyStatements(table).join('\n');
    assert.match(stmts, new RegExp(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`));
    assert.match(stmts, /USING \(user_sub = nullif\(current_setting\('oshal\.current_sub', true\), ''\)\) WITH CHECK/);
    assert.equal(/is_operator/.test(stmts), false, `${table}: the self-heal must not open an operator arm either`);
  }
});

/** A pool that records every statement and answers empty. */
function recordingPool() {
  const calls = [];
  return { calls, query: async (text, params) => {
    calls.push({ text: String(text), params });
    return { rows: /RETURNING id/.test(String(text)) ? [{ id: 1 }] : [], rowCount: 0 };
  } };
}

test('EVERY STORE STATEMENT NAMES ITS OWNER — a query that forgets is refused twice, not once', async () => {
  const pool = recordingPool();
  const sub = 'owner-a';
  const call = { start: { playerId: 1, name: 'A', points: 9 }, sit: { playerId: 2, name: 'B', points: 3 }, slotId: 2, gain: 6, reason: 'r' };
  await store.linkLeague(pool, sub, { season: 2026, leagueId: '1', leagueName: 'L', teamId: 1, teamName: 'T' });
  await store.unlinkLeague(pool, sub, 2026, '1');
  await store.listLeagues(pool, sub);
  await store.readProjections(pool, sub, 2026, 3);
  await store.writeProjections(pool, sub, 2026, 3, { 1: { playerId: 1 } }, 5);
  await store.writePlayerWeeks(pool, sub, 2026, [{ playerId: 1, week: 1, stats: { 0: 1 } }]);
  await store.readPlayerWeeks(pool, sub, 2026, 3, [1]);
  await store.recordCalls(pool, sub, 2026, '1', 3, [call]);
  await store.openCalls(pool, sub, 2026, 3);
  await store.gradeCall(pool, sub, 7, 10, 2);
  await store.fantasyRecord(pool, sub);
  await store.listCalls(pool, sub, 10);
  await store.openCallsForWeek(pool, sub, 2026, '1', 3);
  await store.readProjectionWeeks(pool, sub, 2026, 1, 17);
  const league = { name: 'L', season: 2026, scoring: [], slots: [], teams: [], schedule: [], byes: {}, faab: null, lastWeek: 17, playoffStart: null };
  await manual.saveManualLeague(pool, sub, league, null);
  await manual.saveManualLeague(pool, sub, league, 9);
  await manual.readManualLeague(pool, sub, 9);
  await manual.listManualLeagues(pool, sub);
  await manual.deleteManualLeague(pool, sub, 9);
  await grading.recordWeek(pool, sub, { season: 2026, leagueKey: '1', week: 3, source: 'espn', advised: [], meanLineup: [], started: [], swaps: [], winProbability: null, meanWinProbability: null, projectedAdvised: 0, projectedStarted: 0 });
  await grading.openWeeks(pool, sub, 2026, 4);
  await grading.weekActuals(pool, sub, 2026, 3, []);
  await grading.weekRecord(pool, sub);
  assert.equal(pool.calls.length, 23);
  for (const { text, params } of pool.calls) {
    assert.equal(params[0], sub, `the owner must be the first parameter: ${text.slice(0, 60)}`);
    assert.ok(/user_sub = \$1/.test(text) || /INSERT INTO ff_\w+\s*\(\s*user_sub/.test(text.replace(/\s+/g, ' ')),
      `the statement must name its owner: ${text.slice(0, 80)}`);
  }
});

test('ONLY THE CALLER\'S OWN ESPN CONNECTION IS SPENT — a household-shared one is refused, not used', async () => {
  const shared = loadRouter({ sub: 'owner-b', secret: null, shared: true, sharedSecret: '{SWID-OTHER}:someone-elses-s2' }, memPool());
  const res = await drive(shared.router, 'GET /status', {});
  assert.equal(res.code, 200);
  assert.equal(res.body.connected, false, 'someone else\'s account session is not this caller\'s connection');
  assert.match(res.body.connectHint, /your own/i);
  assert.equal(shared.broker.calls.length, 0, 'the shared secret was never even decrypted');

  const both = loadRouter({ sub: 'owner-a', secret: '{SWID-MINE}:my-s2', shared: true, sharedSecret: '{SWID-OTHER}:x' }, memPool());
  const mine = await drive(both.router, 'GET /status', {});
  assert.equal(mine.body.connected, true);
  assert.equal(mine.body.swid, '{SWID-MINE}');
  assert.deepEqual(both.broker.calls.map((c) => c.opts), [{ connectionId: 'own-1' }],
    'the broker is asked for the caller\'s personal row by id, even though a shared one sorts first');
});

test('the espn_s2 half of the credential is never returned', async () => {
  const { router } = loadRouter({ sub: 'owner-a', secret: '{SWID-MINE}:my-secret-s2-value' }, memPool());
  const res = await drive(router, 'GET /status', {});
  assert.equal(JSON.stringify(res.body).includes('my-secret-s2-value'), false);
});

test('every data route answers 401 with no caller, before touching the store or ESPN', async () => {
  const pool = memPool();
  const { router } = loadRouter({ sub: null, secret: null }, pool);
  for (const key of ['GET /status', 'POST /link', 'DELETE /leagues/:season/:leagueId', 'GET /lineup', 'GET /record', 'POST /grade']) {
    const res = await drive(router, key, {}, async () => { throw new Error(`${key} reached ESPN`); });
    assert.equal(res.code, 401, key);
  }
  assert.equal(pool.statements.filter((s) => !/CREATE|ALTER|DO \$\$/.test(s.text)).length, 0, 'no data statement ran');
});
