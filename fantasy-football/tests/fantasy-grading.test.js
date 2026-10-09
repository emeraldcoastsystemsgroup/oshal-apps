/**
 * Guards for the week ledger — every week's advice recorded before kickoff and graded, once the week
 * is complete, against the lineup actually started.
 *
 * The four failures this can have, each pinned: a week still in progress is graded; a week whose
 * actual lines have not arrived is graded with every player at zero; a week closes while start/sit
 * calls inside it are still ungraded; and the "lineup actually started" is the one recorded at
 * lineup time rather than the one the manager finally set on ESPN.
 *
 * Driven through the real compiled routes (tests/fantasy-routes-harness.js) with the store's own
 * statements read by an owner-keyed in-memory double; the same statements run against PostgreSQL in
 * tests/fantasy-isolation.spec.ts.
 *
 * Run from the package root: node --test "tests/*-*.test.js"
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — an in-progress week is not graded; a week whose lines are not in yet stays open rather than scoring zeros; a completed week is graded from stored actuals with its calls settled first; an ESPN week is graded against the lineup ESPN holds for that week; the record rolls the ledger up; a request naming no league reads the caller's own most recently linked league.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | The own-lineup PAT smoke, read from the manifest as declared (method, path, status, pointer), passes against the real lineup route for a linked league with no query: league name, the P(win) lineup, the mean-maximising lineup beside it and both win probabilities; the week lands in the caller's own ledger and a repeat run keeps one week row and the same calls.
 */

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { drive, espnFetch, loadRouter, memPool } = require('./fantasy-routes-harness.js');
const { SEASON, manualLeague, publicFeed, publicOnlyEspn } = require('./fantasy-manual-fixture.js');
const { gradeWeek } = require('../routes/fantasy-grading.js');

/** A hand-typed league, its week-4 lineup served, and the router to keep driving. */
async function servedWeek4() {
  const pool = memPool();
  const { router } = loadRouter({ sub: 'owner-a', secret: null }, pool);
  const created = await drive(router, 'POST /manual-leagues', { body: manualLeague() });
  const id = created.body.id;
  const q = { query: { manualId: String(id), season: String(SEASON) } };
  assert.equal((await drive(router, 'GET /lineup', q, publicOnlyEspn(4, []))).code, 200);
  return { pool, router, id, key: `owner-a:${SEASON}:manual:${id}:4`, q };
}

test('A WEEK STILL IN PROGRESS IS NOT GRADED', async () => {
  const { pool, router, key } = await servedWeek4();
  const res = await drive(router, 'POST /grade', { body: { season: SEASON } }, publicOnlyEspn(4, []));
  assert.deepEqual(res.body, { ok: true, graded: 0, incomplete: 0 });
  assert.equal(pool.tables.weeks.get(key).graded, false);
});

test('A WEEK WHOSE ACTUAL LINES ARE NOT IN YET STAYS OPEN — nobody is graded at zero', async () => {
  const { pool, router, key } = await servedWeek4();
  // Week 4 is over, but the store has not read a feed carrying week 4's lines yet.
  const res = await drive(router, 'POST /grade', { body: { season: SEASON } }, publicOnlyEspn(5, []));
  assert.deepEqual(res.body, { ok: true, graded: 0, incomplete: 1 });
  assert.equal(pool.tables.weeks.get(key).graded, false);
  assert.ok(pool.tables.calls.every((c) => !c.settled), 'no call settled against numbers that never arrived');
});

test('A COMPLETED WEEK IS GRADED FROM STORED ACTUALS AGAINST THE LINEUP STARTED — its calls first', async () => {
  const { pool, router, key, q } = await servedWeek4();
  // Week 5's lineup refreshes the feed, which carries week 4's actual lines; then grade.
  assert.equal((await drive(router, 'GET /lineup', q, publicOnlyEspn(5, []))).code, 200);
  const res = await drive(router, 'POST /grade', { body: { season: SEASON } }, publicOnlyEspn(5, []));
  assert.deepEqual(res.body, { ok: true, graded: 1, incomplete: 0 });
  const week = pool.tables.weeks.get(key);
  // Week 4 actuals are each player's projection + 4: advised 11,13,14 = 22+15+16; started 11,12,14 = 22+8+16.
  assert.equal(week.actual_advised, 53);
  assert.equal(week.actual_started, 46);
  assert.equal(week.actual_gain, 7);
  const call = pool.tables.calls.find((c) => c.week === 4 && c.startId === 13 && c.sitId === 12);
  assert.equal(call.settled, true, 'the week\'s call is settled before the week closes');
  assert.equal(call.actual_gain, 7);
  const record = await drive(router, 'GET /record', {});
  assert.equal(record.body.weeks.graded, 1);
  assert.equal(record.body.weeks.actualGain, 7);
});

test('A WEEK DOES NOT CLOSE WITH UNGRADED RECOMMENDATIONS', async () => {
  const pool = memPool();
  const sub = 'owner-a';
  pool.tables.calls.push({ key: 'k', id: 1, user_sub: sub, season: SEASON, league_id: 'manual:1', week: 4, startId: 13, sitId: 12, projected_gain: 7, settled: false, actual_gain: null });
  pool.tables.weeks.set(`${sub}:${SEASON}:manual:1:4`, { user_sub: sub, season: SEASON, league_key: 'manual:1', week: 4, advised: [13], started: [12], graded: false });
  for (const [id, pts] of [[12, 8], [13, 15]]) {
    pool.tables.playerWeeks.set(`${sub}:${SEASON}:4:${id}`, { sub, season: SEASON, week: 4, player_id: id, stats: { 1: pts } });
  }
  const open = { season: SEASON, leagueKey: 'manual:1', week: 4, source: 'manual', advised: [13], started: [12] };
  assert.equal(await gradeWeek(pool, sub, open, { scoring: [{ statId: 1, points: 1 }], startedIds: null }), 'graded');
  assert.equal(pool.tables.calls[0].settled, true);
  assert.equal(pool.tables.weeks.get(`${sub}:${SEASON}:manual:1:4`).actual_gain, 7);
});

/** An ESPN league whose week-4 lineup, as ESPN holds it, is `startedWeek4`. */
function espnLeague(currentWeek, startedWeek4, seen) {
  const entry = (id, slot) => ({ playerId: id, lineupSlotId: slot, playerPoolEntry: { player: { id, fullName: `P${id}` } } });
  const teams = (week) => ({ teams: [
    { id: 1, name: 'Mine', owners: ['{SWID-MINE}'], roster: { entries: [11, 12, 13, 14].map((id) => entry(id, (week === 4 ? startedWeek4 : [11, 12, 14]).includes(id) ? (id === 14 ? 4 : 2) : 20)) } },
    { id: 2, name: 'Theirs', owners: ['{SWID-OTHER}'], roster: { entries: [21, 22, 23, 24].map((id) => entry(id, id === 23 ? 20 : 2)) } },
  ] });
  return espnFetch([
    [`/seasons/${SEASON}/players?`, publicFeed(currentWeek)],
    ['view=mSettings', { scoringPeriodId: currentWeek, settings: { name: 'ESPN League', scoringSettings: { scoringItems: [{ statId: 1, points: 1 }] }, rosterSettings: { lineupSlotCounts: { 2: 2, 4: 1, 20: 4 } } } }],
    ['view=mMatchup', { schedule: [{ matchupPeriodId: 4, home: { teamId: 1 }, away: { teamId: 2 } }] }],
    ['scoringPeriodId=4&view=mRoster', teams(4)],
    ['view=mRoster', teams(currentWeek)],
    [`/seasons/${SEASON}`, { currentScoringPeriod: { id: currentWeek } }],
  ], seen);
}

test('AN ESPN WEEK IS GRADED AGAINST THE LINEUP ESPN HOLDS FOR THAT WEEK, not the one recorded at lineup time', async () => {
  const pool = memPool();
  const { router } = loadRouter({ sub: 'owner-a', secret: '{SWID-MINE}:my-s2' }, pool);
  const q = { query: { leagueId: '4242', season: String(SEASON), week: '4' } };
  assert.equal((await drive(router, 'GET /lineup', q, espnLeague(4, [11, 12, 14]))).code, 200);
  assert.deepEqual(pool.tables.weeks.get(`owner-a:${SEASON}:4242:4`).started, [11, 12, 14]);
  // After the advice the manager did follow it on ESPN: the bench back started instead of RB2.
  assert.equal((await drive(router, 'GET /lineup', { query: { leagueId: '4242', season: String(SEASON), week: '5' } }, espnLeague(5, [11, 13, 14]))).code, 200);
  const res = await drive(router, 'POST /grade', { body: { season: SEASON } }, espnLeague(5, [11, 13, 14]));
  assert.equal(res.body.graded, 1);
  const week = pool.tables.weeks.get(`owner-a:${SEASON}:4242:4`);
  assert.deepEqual(week.started, [11, 13, 14], 'graded against what ESPN says was started');
  assert.equal(week.actual_gain, 0, 'the advice was taken, so it gained nothing over what was started');
});

test('A REQUEST NAMING NO LEAGUE READS THE CALLER\'S OWN MOST RECENTLY LINKED ONE — never another person\'s', async () => {
  const pool = memPool();
  const { linkLeague } = require('../routes/fantasy-store.js');
  await linkLeague(pool, 'owner-a', { season: SEASON, leagueId: '1111', leagueName: 'Older', teamId: 1, teamName: 'Mine' });
  await linkLeague(pool, 'owner-a', { season: SEASON, leagueId: '4242', leagueName: 'Newer', teamId: 1, teamName: 'Mine' });
  await linkLeague(pool, 'owner-b', { season: SEASON, leagueId: '9999', leagueName: 'Theirs', teamId: 5, teamName: 'B' });
  const { router } = loadRouter({ sub: 'owner-a', secret: '{SWID-MINE}:my-s2' }, pool);
  const seen = [];
  const res = await drive(router, 'GET /season', { query: {} }, espnLeague(4, [11, 12, 14], seen));
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.equal(res.body.league.leagueId, '4242');
  assert.ok(seen.some((x) => x.url.includes('/leagues/4242')));
  assert.equal(seen.some((x) => /\/leagues\/(1111|9999)/.test(x.url)), false);
  const none = loadRouter({ sub: 'owner-c', secret: null }, pool);
  assert.equal((await drive(none.router, 'GET /waivers', { query: {} }, espnLeague(4, [11, 12, 14], []))).code, 400, 'no linked league, no league named: a 400, not someone else\'s');
});

/**
 * @description The own-lineup smoke exactly as the manifest declares it: method, path, status and the
 * one JSON pointer the smoke format holds.
 * @returns The declaration's fields.
 */
function declaredLineupSmoke() {
  const manifest = fs.readFileSync(path.join(__dirname, '..', 'oshal-app.yaml'), 'utf8');
  const block = /\n  - name: own-lineup(\n[\s\S]*?)(?=\n  - name: |\n\S)/.exec(manifest);
  assert.ok(block, 'the manifest declares the own-lineup smoke');
  const field = (name) => { const m = new RegExp(`\\n\\s+${name}: (\\S+)`).exec(block[1]); assert.ok(m, `own-lineup declares ${name}`); return m[1]; };
  return { method: field('method'), path: field('path'), status: Number(field('status')), pointer: field('jsonPointer'), auth: field('auth') };
}

/**
 * @description Resolve an RFC 6901 pointer, and apply the smoke's `empty` rejection.
 * @param doc - The response body.
 * @param pointer - The pointer.
 * @returns The value, and whether the smoke would reject it as empty.
 */
function atPointer(doc, pointer) {
  let value = doc;
  for (const raw of pointer.split('/').slice(1)) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (value === null || typeof value !== 'object' || !(key in value)) return { found: false };
    value = value[key];
  }
  const empty = value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)
    || (typeof value === 'object' && Object.keys(value).length === 0);
  return { found: true, value, empty };
}

test('THE own-lineup SMOKE, AS DECLARED, PASSES FOR A LINKED LEAGUE: P(win) lineup beside the mean-maximising one, one week row however often it runs', async () => {
  const smoke = declaredLineupSmoke();
  assert.equal(smoke.method, 'GET');
  assert.equal(smoke.auth, 'pat', 'read as the signed-in operator, never a service identity');
  assert.ok(smoke.path.startsWith('/api/fantasy-football/'), smoke.path);
  const key = `GET ${smoke.path.slice('/api/fantasy-football'.length)}`;
  const pool = memPool();
  const { linkLeague } = require('../routes/fantasy-store.js');
  await linkLeague(pool, 'owner-a', { season: SEASON, leagueId: '4242', leagueName: 'ESPN League', teamId: 1, teamName: 'Mine' });
  const { router } = loadRouter({ sub: 'owner-a', secret: '{SWID-MINE}:my-s2' }, pool);
  // The smoke sends no query at all: the league is the caller's most recently linked one.
  const res = await drive(router, key, { query: {} }, espnLeague(4, [11, 12, 14]));
  assert.equal(res.code, smoke.status, JSON.stringify(res.body));
  const selected = atPointer(res.body, smoke.pointer);
  assert.ok(selected.found && !selected.empty, `the smoke's pointer ${smoke.pointer} resolves non-empty`);
  assert.equal(res.body.league.name, 'ESPN League');
  assert.ok(res.body.optimal.starters.length > 0, 'the P(win) lineup');
  assert.ok(res.body.meanOptimal.starters.length > 0, 'the mean-maximising lineup beside it');
  assert.equal(typeof res.body.matchup.winProbability, 'number', 'the win probability the advice buys');
  assert.equal(typeof res.body.matchup.meanWinProbability, 'number', 'against the mean-maximising lineup\'s own');
  const weekKeys = () => [...pool.tables.weeks.keys()].filter((k) => k.startsWith('owner-a:'));
  assert.deepEqual(weekKeys(), [`owner-a:${SEASON}:4242:4`], 'the week is registered in the caller\'s own ledger');
  const calls = pool.tables.calls.length;
  assert.equal((await drive(router, key, { query: {} }, espnLeague(4, [11, 12, 14]))).code, smoke.status);
  assert.deepEqual(weekKeys(), [`owner-a:${SEASON}:4242:4`], 'a repeat run re-registers the same week, never a second one');
  assert.equal(pool.tables.calls.length, calls, 'and the same start/sit calls');
});
