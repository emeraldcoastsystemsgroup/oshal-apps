/**
 * THE MANUAL-ENTRY PARITY GUARD (spec 2.6): every weekly recommendation must be reachable from a
 * league typed in by hand, with no ESPN connection at all.
 *
 * WHY IT IS A GUARD AND NOT A FEATURE TEST. The connector moved onto the critical path the moment
 * managing replaced drafting (ADR-146 Amendment A), and the operator's ESPN team "is having some
 * issues". The failure this prevents is quiet: one route quietly starting with "resolve the caller's
 * ESPN credential, refuse if absent" works perfectly for everyone who is connected. So these cases
 * run the lineup, the season value, the waiver board and the trade finder for a caller with NO
 * connection, and fail if any route answers other than 200, if the connection lookup or the broker
 * is consulted at all, or if any ESPN request other than the two public reads is made.
 *
 * The rest pins the hand-typed league itself: strict validation that names every problem, and
 * ownership — another person can neither read, list, replace, delete nor build on your league.
 *
 * Run from the package root: node --test "tests/*-*.test.js"
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — lineup, season, waivers and trades all answer from a hand-typed league with no connection, no connection lookup, no broker call and no league read; validation names each problem; another person cannot read, list, replace, delete or build on the league; the lineup records the week and the calls under the league's own key.
 */

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { drive, loadRouter, memPool } = require('./fantasy-routes-harness.js');
const { SEASON, manualLeague, publicOnlyEspn } = require('./fantasy-manual-fixture.js');

/** A caller with no ESPN connection whatsoever, and their router. */
function unconnected(sub, pool) {
  return loadRouter({ sub, secret: null }, pool);
}

/** Create a hand-typed league as `sub` and return its id. */
async function create(router, body = manualLeague()) {
  const res = await drive(router, 'POST /manual-leagues', { body });
  assert.equal(res.code, 201, JSON.stringify(res.body));
  return res.body.id;
}

test('EVERY WEEKLY RECOMMENDATION ANSWERS FROM A HAND-TYPED LEAGUE, WITH NO CONNECTION CONSULTED', async () => {
  const pool = memPool();
  const { router, broker } = unconnected('owner-a', pool);
  const id = await create(router);
  const seen = [];
  const answers = {};
  for (const key of ['GET /lineup', 'GET /season', 'GET /waivers', 'GET /trades']) {
    const res = await drive(router, key, { query: { manualId: String(id), season: String(SEASON) } }, publicOnlyEspn(4, seen));
    assert.equal(res.code, 200, `${key}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.source, 'manual', key);
    answers[key] = res.body;
  }
  assert.equal(broker.lookups, 0, 'the connection lookup must never run for a hand-typed league');
  assert.deepEqual(broker.calls, [], 'the broker must never be asked for a credential');
  assert.deepEqual(seen.filter((s) => /\/leagues\//.test(s.url)), [], 'no ESPN league read');
  assert.ok(seen.every((s) => s.cookie === ''), 'no cookie on any request');
  // And the answers are real ones, not empty shells.
  assert.equal(answers['GET /lineup'].team.name, 'Mine');
  assert.equal(answers['GET /lineup'].matchup.opponentName, 'Theirs', 'the hand-typed schedule supplies the opponent');
  assert.ok(answers['GET /season'].total > 0);
  assert.ok(answers['GET /waivers'].rows.length > 0, 'the wire is the feed minus every hand-typed roster');
  assert.equal(answers['GET /waivers'].rows.some((r) => [21, 22, 23, 24, 31, 32, 33, 34].includes(r.add.playerId)), false,
    'a player on another hand-typed roster is not on the wire');
  assert.ok(Array.isArray(answers['GET /trades'].proposals));
});

test('the hand-typed lineup records the week and its calls under the league\'s own key', async () => {
  const pool = memPool();
  const { router } = unconnected('owner-a', pool);
  const id = await create(router);
  const res = await drive(router, 'GET /lineup', { query: { manualId: String(id), season: String(SEASON) } }, publicOnlyEspn(4, []));
  assert.equal(res.code, 200);
  const week = pool.tables.weeks.get(`owner-a:${SEASON}:manual:${id}:4`);
  assert.ok(week, 'the week\'s decision is recorded before kickoff');
  assert.equal(week.source, 'manual');
  assert.deepEqual(week.started, [11, 12, 14], 'the lineup actually set is the hand-typed one');
  assert.ok(week.advised.includes(13), 'the bench back (11) beats the 4-point RB2');
  assert.ok(pool.tables.calls.every((c) => c.league_id === `manual:${id}`));
  assert.ok(pool.tables.calls.some((c) => c.startId === 13 && c.sitId === 12));
});

test('VALIDATION NAMES EVERY PROBLEM — a league typed in wrong is refused, not half-used', async () => {
  const { router } = unconnected('owner-a', memPool());
  const bad = manualLeague({
    scoring: [{ statId: 'x', points: 1 }],
    teams: [
      { teamId: 1, name: 'A', roster: [1, 2], starting: [3] },
      { teamId: 2, name: 'B', roster: [4, 4], starting: [] },
    ],
  });
  const res = await drive(router, 'POST /manual-leagues', { body: bad });
  assert.equal(res.code, 400);
  const problems = res.body.problems.join(' | ');
  assert.match(problems, /integer statId/);
  assert.match(problems, /every starter must be on its roster/);
  assert.match(problems, /distinct ESPN player ids/);
  assert.match(problems, /exactly one team must be marked mine/);
});

test('ANOTHER PERSON CAN NEITHER READ, LIST, REPLACE, DELETE NOR BUILD ON YOUR HAND-TYPED LEAGUE', async () => {
  const pool = memPool();
  const a = unconnected('owner-a', pool);
  const b = unconnected('owner-b', pool);
  const id = await create(a.router);
  const q = { params: { id: String(id) } };
  assert.equal((await drive(b.router, 'GET /manual-leagues/:id', q)).code, 404);
  assert.deepEqual((await drive(b.router, 'GET /manual-leagues', {})).body.leagues, []);
  assert.equal((await drive(b.router, 'PUT /manual-leagues/:id', { ...q, body: manualLeague({ name: 'Taken' }) })).code, 404);
  assert.equal((await drive(b.router, 'DELETE /manual-leagues/:id', q)).body.removed, 0);
  for (const key of ['GET /lineup', 'GET /waivers', 'GET /trades', 'GET /season']) {
    const res = await drive(b.router, key, { query: { manualId: String(id), season: String(SEASON) } }, publicOnlyEspn(4, []));
    assert.equal(res.code, 404, key);
  }
  const mine = await drive(a.router, 'GET /manual-leagues/:id', q);
  assert.equal(mine.code, 200);
  assert.equal(mine.body.league.name, 'Hand-typed league', 'still the owner\'s, unchanged');
});

test('the owner can replace and delete their own hand-typed league', async () => {
  const { router } = unconnected('owner-a', memPool());
  const id = await create(router);
  const q = { params: { id: String(id) } };
  assert.equal((await drive(router, 'PUT /manual-leagues/:id', { ...q, body: manualLeague({ name: 'Renamed' }) })).code, 200);
  assert.equal((await drive(router, 'GET /manual-leagues/:id', q)).body.league.name, 'Renamed');
  assert.equal((await drive(router, 'DELETE /manual-leagues/:id', q)).body.removed, 1);
  assert.equal((await drive(router, 'GET /manual-leagues/:id', q)).code, 404);
});
