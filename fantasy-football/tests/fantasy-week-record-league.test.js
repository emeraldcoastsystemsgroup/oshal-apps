/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Sweep 8: the 'Week by week' record under a hand-typed league made a
 *                     |                             | minute earlier listed four week-5 rows of other leagues ('WEEKS
 *                     |                             | GRADED 0 / 4'), and a deleted league's rows stayed in every later
 *                     |                             | league's record. Through the COMPILED router over the owner-keyed
 *                     |                             | ledger double: GET /record?leagueKey reads that league's weeks only,
 *                     |                             | deleting a hand-typed league deletes its own weeks (never another
 *                     |                             | owner's or another league's), and the page asks for the shown league.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Round 8 review: the graded record and the call list under a league
 *                     |                             | are that league's own too, and deleting a hand-typed league deletes
 *                     |                             | its start/sit calls (ff_calls) with its weeks.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { drive, loadRouter, memPool } = require('./fantasy-routes-harness.js');
const { manualLeague } = require('./fantasy-manual-fixture.js');

/** One week-ledger row as recordWeek stores it. */
function week(userSub, leagueKey, wk) {
  return { user_sub: userSub, season: 2026, league_key: leagueKey, week: wk, source: leagueKey.startsWith('manual:') ? 'manual' : 'espn',
    advised: [], mean_lineup: [], started: [], swaps: [], win_probability: null, mean_win_probability: null,
    projected_advised: 0, projected_started: 0, graded: false };
}

async function seeded() {
  const pool = memPool();
  const { router } = loadRouter({ sub: 'owner-a', secret: null }, pool);
  const first = (await drive(router, 'POST /manual-leagues', { body: manualLeague({ name: 'Old league' }) })).body.id;
  const second = (await drive(router, 'POST /manual-leagues', { body: manualLeague({ name: 'New league' }) })).body.id;
  for (const row of [week('owner-a', `manual:${first}`, 5), week('owner-a', `manual:${first}`, 4), week('owner-a', '777', 5),
    week('owner-a', `manual:${second}`, 5), week('owner-b', `manual:${first}`, 5)]) {
    pool.tables.weeks.set(`${row.user_sub}:${row.season}:${row.league_key}:${row.week}`, row);
  }
  for (const [user, key, settled, gain] of [['owner-a', `manual:${first}`, true, 3], ['owner-a', '777', true, -2],
    ['owner-a', `manual:${second}`, true, 5], ['owner-a', `manual:${second}`, false, null], ['owner-b', `manual:${first}`, true, 9]]) {
    pool.tables.calls.push(call(user, key, settled, gain, pool.tables.calls.length + 1));
  }
  return { pool, router, first, second };
}

/** One start/sit call row as recordCalls stores it. */
function call(userSub, leagueKey, settled, gain, id) {
  return { key: `${userSub}:${leagueKey}:${id}`, id, user_sub: userSub, season: 2026, league_id: leagueKey, week: 5, startId: id, startName: `S${id}`,
    sitId: id + 100, sitName: `B${id}`, projected_gain: 4, settled, actual_gain: gain };
}

test('the record under a league lists that league\'s weeks only', async () => {
  const { router, second } = await seeded();
  const res = await drive(router, 'GET /record', { query: { limit: '50', leagueKey: `manual:${second}` } });
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.equal(res.body.weeks.weeks, 1);
  assert.deepEqual(res.body.weeks.rows.map((r) => r.league_key), [`manual:${second}`]);
  const all = await drive(router, 'GET /record', { query: { limit: '50' } });
  assert.equal(all.body.weeks.weeks, 4, 'with no league the caller\'s whole ledger, and never another owner\'s rows');
});

test('the record and the call list under a league are that league\'s own', async () => {
  const { router, second } = await seeded();
  const res = await drive(router, 'GET /record', { query: { limit: '50', leagueKey: `manual:${second}` } });
  assert.deepEqual(res.body.calls.map((c) => c.league_id), [`manual:${second}`, `manual:${second}`]);
  assert.deepEqual([res.body.record.graded, res.body.record.actualPoints], [1, 5]);
  const all = await drive(router, 'GET /record', { query: { limit: '50' } });
  assert.equal(all.body.calls.length, 4, 'with no league every one of the caller\'s calls, never another owner\'s');
  assert.deepEqual([all.body.record.graded, all.body.record.actualPoints], [3, 6]);
});

test('deleting a hand-typed league deletes its own weeks and calls only', async () => {
  const { pool, router, first, second } = await seeded();
  const res = await drive(router, 'DELETE /manual-leagues/:id', { params: { id: String(first) } });
  assert.equal(res.body.removed, 1);
  const left = [...pool.tables.weeks.values()].map((w) => `${w.user_sub}|${w.league_key}`).sort();
  assert.deepEqual(left, ['owner-a|777', `owner-a|manual:${second}`, `owner-b|manual:${first}`].sort());
  const calls = pool.tables.calls.map((c) => `${c.user_sub}|${c.league_id}`).sort();
  assert.deepEqual(calls, ['owner-a|777', `owner-a|manual:${second}`, `owner-a|manual:${second}`, `owner-b|manual:${first}`].sort(),
    'its own calls go with it; another league\'s and another owner\'s stay');
});

test('the page asks for the record of the league on screen', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'tools', 'fantasy-football.html'), 'utf8');
  assert.match(html, /shownBoard\.source === 'manual' \? 'manual:' \+ shownBoard\.id : shownBoard\.id/);
  assert.match(html, /'\/record\?limit=50' \+ \(key \? '&leagueKey=' \+ encodeURIComponent\(key\) : ''\)/);
});
