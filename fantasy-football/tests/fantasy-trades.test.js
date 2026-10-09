/**
 * Guards for the two-sided trade finder (spec 2.2.8).
 *
 * THE RULE THAT MATTERS: no proposal surfaces unless the other manager gains too. A finder that ranks
 * by your gain alone surfaces the trades nobody accepts, and they look exactly like good advice. So
 * the property test does not trust the finder's own arithmetic: it re-derives the other side's gain
 * with the season value for every surfaced proposal, and it proves the fixture is capable of the
 * failure — the same rosters DO contain candidates good for you and bad for them — so the guard
 * cannot pass by never meeting the case it forbids.
 *
 * Run from the package root: node --test "tests/*-*.test.js"
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — the slot-pressure trade (their surplus receiver for your running-back hole) surfaces with both gains shown; a trade good only for you never surfaces; a property test over 150 seeded leagues re-derives Δ_them for every surfaced proposal and proves the rosters contain the one-sided candidates it forbids; a 2-for-1 prices the receiving side's forced drop.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | findTrades yields to the event loop between teams and is awaited; every assertion is unchanged.
 */

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { TRADE_THRESHOLD, findTrades, sideAfter } = require('../routes/fantasy-trades.js');
const { seasonValue } = require('../routes/fantasy-season.js');

const ONE = [{ statId: 1, points: 1 }];
const POS = { RB: [2, [2, 23]], WR: [3, [4, 23]] };
const SLOTS = [{ slotId: 2, count: 2 }, { slotId: 4, count: 3 }];

/** A plan over `weeks` identical weeks from a player table. */
function planOf(players, weeks = 4) {
  return {
    weeks: Array.from({ length: weeks }, (_, i) => ({ week: i + 1, weight: 1 })), slots: SLOTS, scoring: ONE,
    playerFor: (id) => players[id] || null,
  };
}

/** A player. */
function p(id, kind, points) {
  return { playerId: id, name: `${kind} ${id}`, defaultPositionId: POS[kind][0], eligibleSlots: POS[kind][1], projectedStats: { 1: points } };
}

test('THE SLOT-PRESSURE TRADE SURFACES WITH BOTH GAINS — their surplus receiver for your running-back hole', async () => {
  // You: one good back and a hole (RB2 projects 3), four receivers for three slots.
  // Them: four good backs for two slots, and a weak third receiver.
  const players = {};
  const add = (x) => { players[x.playerId] = x; return x.playerId; };
  const mine = { teamId: 1, name: 'Mine', rosterIds: [add(p(1, 'RB', 18)), add(p(2, 'RB', 3)), add(p(3, 'WR', 15)), add(p(4, 'WR', 14)), add(p(5, 'WR', 13)), add(p(6, 'WR', 12))] };
  const theirs = { teamId: 2, name: 'Theirs', rosterIds: [add(p(11, 'RB', 20)), add(p(12, 'RB', 19)), add(p(13, 'RB', 16)), add(p(14, 'RB', 15)), add(p(15, 'WR', 10)), add(p(16, 'WR', 9)), add(p(17, 'WR', 4))] };
  const proposals = await findTrades(mine, [theirs], planOf(players), TRADE_THRESHOLD, 500);
  const deal = proposals.find((t) => t.give.length === 1 && t.give[0] === 6 && t.get[0] === 13);
  assert.ok(deal, `expected WR 6 for RB 13, got ${JSON.stringify(proposals.slice(0, 3))}`);
  assert.equal(deal.youGain, 4 * (16 - 3), 'their third back replaces your 3-point RB2 every week');
  assert.equal(deal.themGain, 4 * (12 - 4), 'your fourth receiver replaces their 4-point WR3 every week');
  for (const t of proposals) assert.ok(t.youGain > TRADE_THRESHOLD && t.themGain > TRADE_THRESHOLD);
});

test('A TRADE GOOD ONLY FOR YOU NEVER SURFACES', async () => {
  // Their best back for your worst receiver: great for you, ruinous for them.
  const players = {};
  const add = (x) => { players[x.playerId] = x; return x.playerId; };
  const mine = { teamId: 1, name: 'Mine', rosterIds: [add(p(1, 'RB', 18)), add(p(2, 'RB', 3)), add(p(3, 'WR', 15)), add(p(4, 'WR', 14)), add(p(5, 'WR', 2))] };
  const theirs = { teamId: 2, name: 'Theirs', rosterIds: [add(p(11, 'RB', 25)), add(p(12, 'RB', 19)), add(p(13, 'WR', 16)), add(p(14, 'WR', 15)), add(p(15, 'WR', 14))] };
  const plan = planOf(players);
  const oneSided = sideAfter(theirs.rosterIds, [11], [5], plan).value - seasonValue(theirs.rosterIds, plan).total;
  assert.ok(oneSided < 0, 'the candidate really is bad for them');
  assert.equal((await findTrades(mine, [theirs], plan)).some((t) => t.get.includes(11) && t.give.includes(5)), false);
});

/** A seeded generator. */
function seeded(seed) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
}

test('NO SURFACED PROPOSAL HAS Δ_them ≤ 0 — re-derived independently over 150 seeded leagues', async () => {
  let oneSidedCandidates = 0;
  let surfaced = 0;
  for (let n = 0; n < 150; n += 1) {
    const r = seeded(n + 11);
    const players = {};
    const team = (teamId, size) => {
      const ids = [];
      for (let i = 0; i < size; i += 1) {
        const id = teamId * 100 + i;
        players[id] = p(id, r() < 0.5 ? 'RB' : 'WR', Math.round(r() * 2500) / 100);
        ids.push(id);
      }
      return { teamId, name: `T${teamId}`, rosterIds: ids };
    };
    const mine = team(1, 7);
    const others = [team(2, 7), team(3, 7)];
    const plan = planOf(players, 2);
    for (const t of await findTrades(mine, others, plan)) {
      surfaced += 1;
      const them = others.find((o) => o.teamId === t.teamId);
      const derived = sideAfter(them.rosterIds, t.get, t.give, plan).value - seasonValue(them.rosterIds, plan).total;
      assert.ok(derived > TRADE_THRESHOLD, `case ${n}: surfaced a trade with Δ_them ${derived}`);
      assert.ok(Math.abs(derived - t.themGain) < 0.02, 'the shown gain is the real one');
    }
    // The fixture must contain the failure the guard forbids: 1-for-1 swaps good for you, bad for them.
    for (const o of others) {
      for (const g of mine.rosterIds) {
        for (const h of o.rosterIds) {
          const you = sideAfter(mine.rosterIds, [g], [h], plan).value - seasonValue(mine.rosterIds, plan).total;
          const them = sideAfter(o.rosterIds, [h], [g], plan).value - seasonValue(o.rosterIds, plan).total;
          if (you > TRADE_THRESHOLD && them <= 0) oneSidedCandidates += 1;
        }
      }
    }
  }
  assert.ok(surfaced > 20, `the property needs proposals to judge; saw ${surfaced}`);
  assert.ok(oneSidedCandidates > 100, `the rosters must contain one-sided candidates for the guard to mean anything; saw ${oneSidedCandidates}`);
});

test('a 2-for-1 prices the receiving side\'s forced drop', () => {
  const players = {};
  const add = (x) => { players[x.playerId] = x; return x.playerId; };
  const roster = [add(p(1, 'RB', 20)), add(p(2, 'RB', 10)), add(p(3, 'WR', 9)), add(p(4, 'WR', 8)), add(p(5, 'WR', 7))];
  const plan = planOf({ ...players, [add(p(40, 'WR', 6))]: players[40], [add(p(41, 'RB', 1))]: players[41] });
  const receiving = sideAfter(roster, [5], [40, 41], plan);
  assert.ok(receiving.drop !== null && ![40, 41].includes(receiving.drop), 'a player just received is never the one cut');
});
