/**
 * Guards for a lineup as set that leaves a starting slot empty.
 *
 * Sweep 13 (2026-10-13, phone 412x915): a hand-typed league saved with 2 starters (Mahomes, Chase) in a
 * 3-starter lineup showed "LINEUP AS SET 17.3 / RECOMMENDED LINEUP 35.7 / ON THE TABLE +18.4", and the Start / sit
 * card directly below said "Your lineup is already the best legal one". startSitCalls pairs a start with a sit,
 * so a recommended starter for an empty slot (nobody to sit) made no call, and the page read an empty call list
 * as "already the best". The route now names that starter (openSlots) and the page lists it; an empty list beside
 * a real gain no longer reads as "already the best".
 *
 * Real: the compiled scoring module, router, handlers and the fantasy-leagues ESPN client
 * (fantasy-routes-harness.js), and the page's own card functions. Doubled: the logger, the router, the caller,
 * the broker and the database round trip (an in-memory reading of the store's SQL).
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial: openSlotStarts names the starter for an empty slot; the lineup route carries it for a two-of-three lineup and records no call for it; the page lists it and never says "already the best" beside a positive gain.
 */

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { openSlotStarts, optimiseLineup, startSitCalls } = require('../routes/fantasy-scoring.js');
const { drive, loadRouter, memPool } = require('./fantasy-routes-harness.js');
const { SEASON, manualLeague, publicOnlyEspn } = require('./fantasy-manual-fixture.js');

const SIMPLE = [{ statId: 1, points: 1 }];
const player = (id, name, slots, pts) => ({ playerId: id, name, eligibleSlots: slots, projectedStats: { 1: pts }, injuryStatus: 'ACTIVE' });

test('a recommended starter for an empty slot is named, with his projection as the gain', () => {
  const roster = [player(1, 'QB', [0], 17.3), player(2, 'WR1', [4], 10), player(3, 'WR2', [4], 18.4)];
  const optimal = optimiseLineup(roster, [{ slotId: 0, count: 1 }, { slotId: 4, count: 2 }], SIMPLE);
  assert.deepEqual(startSitCalls([1, 2], optimal, SIMPLE, roster), [], 'nobody is sat, so no start/sit call');
  const fills = openSlotStarts([1, 2], optimal);
  assert.equal(fills.length, 1);
  assert.equal(fills[0].start.name, 'WR2');
  assert.equal(fills[0].gain, 18.4);
  assert.deepEqual(openSlotStarts([1, 2, 3], optimal), [], 'a full lineup has no open slot');
});

test('a swap and a fill together: the swap is the call, the fill is the open slot', () => {
  const roster = [player(1, 'RB1', [2], 20), player(2, 'RB2', [2], 3), player(3, 'RB3', [2], 12), player(4, 'RB4', [2], 9)];
  const optimal = optimiseLineup(roster, [{ slotId: 2, count: 3 }], SIMPLE);
  const calls = startSitCalls([1, 2], optimal, SIMPLE, roster);
  const fills = openSlotStarts([1, 2], optimal);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].sit.name, 'RB2');
  assert.equal(fills.length, 1);
  const named = [calls[0].start.name, fills[0].start.name].sort();
  assert.deepEqual(named, ['RB3', 'RB4']);
  assert.equal(Math.round((calls[0].gain + fills[0].gain) * 100) / 100, optimal.total - 23, 'the two add up to what is on the table');
});

test('the lineup route carries the open slot for a two-of-three lineup and records no call for it', async () => {
  const pool = memPool();
  const { router } = loadRouter({ sub: 'owner-a', secret: null }, pool);
  const body = manualLeague();
  body.teams[0].starting = [11, 14];
  const created = await drive(router, 'POST /manual-leagues', { body });
  assert.equal(created.code, 201, JSON.stringify(created.body));
  const query = { manualId: String(created.body.id), season: String(SEASON) };
  const res = await drive(router, 'POST /lineup/record', { query }, publicOnlyEspn(4, []));
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.ok(res.body.optimal.total > res.body.currentTotal, 'the recommended lineup projects more');
  assert.deepEqual(res.body.calls, []);
  assert.deepEqual(res.body.openSlots.map((f) => f.start.name), ['Mine Bench Back']);
  assert.equal(pool.tables.calls.length, 0, 'a fill is not a graded call');
});

/** The page's own card functions, run as the page runs them. */
function cards() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'tools', 'fantasy-football.html'), 'utf8');
  const fn = (name) => html.slice(html.indexOf(`function ${name}(`), html.indexOf('\n}\n', html.indexOf(`function ${name}(`)) + 2);
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return new Function('esc', `${fn('callsCard')}\n${fn('noCallsCard')}\nreturn { callsCard };`)(esc);
}

test('the Start / sit card lists the open-slot starter and never says "already the best" beside a gain', () => {
  const { callsCard } = cards();
  const base = { optimal: { total: 35.7 }, currentTotal: 17.3, calls: [] };
  const filled = callsCard({ ...base, openSlots: [{ start: { name: 'CeeDee Lamb', points: 18.4 }, slotId: 4, gain: 18.4 }] });
  assert.match(filled, /CeeDee Lamb<\/strong> \(18\.4\)/);
  assert.match(filled, /Empty slot/);
  assert.match(filled, /\+18\.4/);
  assert.doesNotMatch(filled, /already the best/);
  const none = callsCard({ ...base, openSlots: [] });
  assert.doesNotMatch(none, /already the best/, 'a +18.4 gain with no call is not the best lineup');
  assert.match(none, /projects \+18\.4 over your lineup as set/);
  assert.match(callsCard({ optimal: { total: 30 }, currentTotal: 30, calls: [], openSlots: [] }), /already the best legal one/,
    'an optimal lineup still gets the normal answer');
});
