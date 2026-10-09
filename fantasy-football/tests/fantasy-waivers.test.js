/**
 * Guards for the waiver board (spec 2.2.7): every row carries a bid and a drop, rows are ranked by
 * rest-of-season swap value, no bid exceeds the cap, the leftover-running-back case earns its
 * scarcity premium, and the streaming lane never touches the rest-of-season budget.
 *
 * The fixture is the operator's roster shape: a good RB1 and an RB2 who is a replacement-level back
 * in every week, in a ten-team league deep enough that replacement level is a real number.
 *
 * Run from the package root: node --test "tests/*-*.test.js"
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — bid and drop on every row, ranked by Δ, capped, the leftover-RB scarcity premium, the isolated streaming lane (defence, kicker, and a superflex quarterback), a rolling-priority league with no bids, and a cap that binds.
 */

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { RESERVE_PER_WEEK, bidFor, waiverBoard } = require('../routes/fantasy-waivers.js');
const { buildSeasonPlan } = require('../routes/fantasy-plan.js');

const ONE = [{ statId: 1, points: 1 }];
const POS = { QB: [1, [0, 7]], RB: [2, [2, 3, 23, 7]], WR: [3, [4, 3, 23, 7]], TE: [4, [6, 23, 7]], DST: [16, [16]], K: [17, [17]] };
const SLOTS = [{ slotId: 0, count: 1 }, { slotId: 2, count: 2 }, { slotId: 4, count: 2 }, { slotId: 16, count: 1 }, { slotId: 17, count: 1 }];

/** A player of a position with a one-stat projection. */
function p(id, kind, points) {
  return { playerId: id, name: `${kind} ${id}`, defaultPositionId: POS[kind][0], eligibleSlots: POS[kind][1], projectedStats: { 1: points } };
}

/** My roster: the leftover-RB case — RB2 projects 4, well under replacement. */
const MINE = [p(1, 'QB', 20), p(2, 'RB', 14), p(3, 'RB', 4), p(4, 'WR', 12), p(5, 'WR', 11), p(6, 'WR', 5), p(7, 'DST', 6), p(8, 'K', 7), p(9, 'TE', 3)];
/** The wire: a real RB2, a small RB upgrade, a receiver who never starts, a defence and a kicker to stream. */
const WIRE = [p(50, 'RB', 11), p(51, 'RB', 6), p(52, 'WR', 9), p(53, 'DST', 10), p(54, 'K', 9)];
/** Nine other teams' running backs and receivers: what makes replacement level the league's own. */
const OTHERS = [...Array.from({ length: 40 }, (_, i) => p(1000 + i, 'RB', 30 - i * 0.55)), ...Array.from({ length: 40 }, (_, i) => p(2000 + i, 'WR', 28 - i * 0.5))];

/** The board for a pool and league shape. */
function board({ wire = WIRE, slots = SLOTS, budget = 80, weeks = [4, 7] } = {}) {
  const pool = Object.fromEntries([...MINE, ...wire, ...OTHERS].map((x) => [x.playerId, x]));
  const { plan } = buildSeasonPlan({ currentWeek: weeks[0], lastWeek: weeks[1], playoffStart: null, feeds: new Map([[weeks[0], pool]]), byes: {}, slots, scoring: ONE });
  return waiverBoard({
    plan, rosterIds: MINE.map((x) => x.playerId), rosteredIds: [...MINE, ...OTHERS].map((x) => x.playerId), pool, budget, teams: 10,
  });
}

test('EVERY ROW HAS A BID AND A DROP, ranked by rest-of-season swap value', () => {
  const b = board();
  assert.ok(b.rows.length >= 2, `expected the RB claims, saw ${b.rows.map((r) => r.add.name).join(', ')}`);
  for (const r of b.rows) {
    assert.equal(Number.isInteger(r.bid), true, `${r.add.name} needs a whole-dollar bid`);
    assert.ok(r.drop && Number.isInteger(r.drop.playerId), `${r.add.name} needs a drop`);
    assert.ok(r.gain > 0);
  }
  for (let i = 1; i < b.rows.length; i += 1) assert.ok(b.rows[i - 1].gain >= b.rows[i].gain, 'ordered by Δ');
  assert.equal(b.rows[0].add.playerId, 50, 'the real RB2 is the best claim');
  assert.equal(b.rows[0].gain, 28, '11 over 4, every one of the four weeks');
  assert.equal(b.rows.some((r) => r.add.playerId === 52), false, 'a receiver who would never start is worth nothing');
});

test('NO BID EXCEEDS THE CAP — the reserve keeps a dollar for every other remaining week', () => {
  const b = board();
  assert.equal(b.cap, 80 - RESERVE_PER_WEEK * 3);
  for (const r of b.rows) assert.ok(r.bid <= b.cap, `${r.add.name} bids ${r.bid} over the cap ${b.cap}`);
  const tight = board({ budget: 5 });
  assert.equal(tight.cap, 2);
  for (const r of tight.rows) assert.ok(r.bid <= 2);
});

test('THE LEFTOVER-RB CASE EARNS THE SCARCITY PREMIUM — the claim replaces a replacement-level starter', () => {
  const b = board();
  const rb2 = b.rows.find((r) => r.add.playerId === 50);
  assert.equal(rb2.scarcity, true, 'RB2 projects 4, under this league\'s replacement level for backs, in all four weeks');
  assert.ok(b.replacement[2] > 4, `replacement level for backs is ${b.replacement[2]}`);
  const plain = bidFor(rb2.gain, b.wireValue - rb2.gain, false, 80, b.cap);
  assert.ok(rb2.bid > plain, `the premium must raise the bid: ${rb2.bid} vs ${plain}`);
  assert.equal(rb2.bid, bidFor(rb2.gain, b.wireValue - rb2.gain, true, 80, b.cap));
});

test('THE STREAMING LANE IS ISOLATED — one week, no budget, and it never moves a rest-of-season bid', () => {
  const b = board();
  assert.deepEqual(b.streaming.map((s) => s.add.playerId).sort(), [53, 54], 'the defence and the kicker stream');
  for (const s of b.streaming) {
    assert.equal(s.bid, 0);
    assert.equal(s.horizon, 'this-week');
  }
  assert.equal(b.streaming.find((s) => s.add.playerId === 53).gain, 4, 'defence 10 over 6, this week only');
  assert.equal(b.rows.some((r) => [53, 54].includes(r.add.playerId)), false, 'streamers never enter the rest-of-season lane');
  const without = board({ wire: WIRE.filter((x) => ![53, 54].includes(x.playerId)) });
  assert.deepEqual(without.rows.map((r) => [r.add.playerId, r.bid]), b.rows.map((r) => [r.add.playerId, r.bid]), 'and removing them changes no bid');
  assert.equal(without.wireValue, b.wireValue);
});

test('a superflex league streams a second quarterback', () => {
  const b = board({ wire: [...WIRE, p(55, 'QB', 15)], slots: [...SLOTS, { slotId: 7, count: 1 }] });
  assert.ok(b.streaming.some((s) => s.add.playerId === 55));
  assert.equal(b.rows.some((r) => r.add.playerId === 55), false);
});

test('a rolling-priority league gets the ranking and the drop, and no invented bid', () => {
  const b = board({ budget: null });
  assert.equal(b.cap, null);
  assert.ok(b.rows.length);
  for (const r of b.rows) {
    assert.equal(r.bid, null);
    assert.ok(r.drop);
  }
});
