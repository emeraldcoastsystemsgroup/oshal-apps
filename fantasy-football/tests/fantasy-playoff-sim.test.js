/**
 * Guards for Backlog Item A2 — remaining-schedule P(playoffs) simulation (spec 2.2.5).
 *
 * Proves:
 *   1. Deterministic schedule simulation over remaining regular-season fixtures (from ESPN mSettings+mTeam
 *      standings or a hand-typed standings table) reports baseline P(playoffs), P(playoffs) with a claim
 *      or trade, and delta, breaking record ties by pointsFor.
 *   2. KEY BACKLOG GUARD: A team two games behind the playoff cutline prefers a higher-variance boom/bust
 *      claim or trade (even with lower expected points / SV) that a bubble team does not; the bubble team
 *      prefers the steadier option.
 *   3. Pure standings/tiebreaker variance guard with identical opponents and equal-mean options.
 *   4. Graceful degradation when standings or remaining fixtures are unavailable (reporting why and
 *      falling back cleanly to SV ranking).
 *   5. Full compiled route integration for GET /season, GET /waivers, GET /trades, GET /quant/waivers,
 *      and POST /manual-leagues (both hand-typed and ESPN-shaped leagues), plus UI rendering and
 *      manual-form round-trip in tools/fantasy-football.html.
 *
 * Run from the package root: node --test tests/fantasy-playoff-sim.test.js
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — deterministic P(playoffs) simulation guards, two-games-out vs bubble variance preference guards (waivers, trades, and pure standings/tiebreaker), graceful degradation, compiled route integration (manual and ESPN-shaped), and UI/form round-trip checks.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const { createPlayoffSimulator, extractEspnStandings } = require('../routes/fantasy-playoff-sim.js');
const { buildSeasonPlan } = require('../routes/fantasy-plan.js');
const { waiverBoard } = require('../routes/fantasy-waivers.js');
const { findTrades, TRADE_THRESHOLD } = require('../routes/fantasy-trades.js');

const PKG_DIR = path.resolve(__dirname, '..');
const ONE = [{ statId: 1, points: 1 }];
const SLOTS = [{ slotId: 2, count: 2 }, { slotId: 4, count: 2 }, { slotId: 23, count: 1 }];
const POS = { RB: [2, [2, 23]], WR: [3, [4, 23]] };

/** Build a player with optional historical weekly points for realistic spread shrinkage. */
function makePlayer(id, kind, points, pointsHistory) {
  return {
    playerId: id,
    name: `${kind} ${id}`,
    defaultPositionId: POS[kind][0],
    eligibleSlots: POS[kind][1],
    projectedStats: { 1: points },
    ...(pointsHistory ? { pointsHistory } : {}),
  };
}

/** Build an 8-team league with 3 remaining regular-season weeks (12, 13, 14) and top-4 playoffs. */
function buildEightTeamScenario({ myStandings, oppStrength, myCorePts = 22 }) {
  const players = {};
  const add = (p) => { players[p.playerId] = p; return p.playerId; };
  const steadyHist = [14.5, 14.3, 14.7, 14.4, 14.6, 14.5];
  const boomHist = [0, 34, 1, 33, 0, 32];
  const coreHist = [myCorePts, myCorePts - 1, myCorePts + 1, myCorePts, myCorePts];

  // Team 1 (Mine): four steady core starters + one weak FLEX starter (4 pts) + bench filler
  const mineRoster = [
    add(makePlayer(101, 'RB', myCorePts, coreHist)),
    add(makePlayer(102, 'RB', myCorePts, coreHist)),
    add(makePlayer(103, 'WR', myCorePts, coreHist)),
    add(makePlayer(104, 'WR', myCorePts, coreHist)),
    add(makePlayer(105, 'RB', 4, [4, 4, 4, 4])),
    add(makePlayer(106, 'WR', 2, [2, 2, 2, 2])),
  ];

  // Seven other teams
  const teams = [{ teamId: 1, name: 'Mine', rosterIds: mineRoster }];
  for (let t = 2; t <= 8; t += 1) {
    const pts = oppStrength(t);
    const h = [pts, pts - 2, pts + 2, pts - 1, pts + 1];
    const base = t * 100;
    teams.push({
      teamId: t,
      name: `Team ${t}`,
      rosterIds: [
        add(makePlayer(base + 1, 'RB', pts, h)),
        add(makePlayer(base + 2, 'RB', pts, h)),
        add(makePlayer(base + 3, 'WR', pts, h)),
        add(makePlayer(base + 4, 'WR', pts, h)),
        add(makePlayer(base + 5, 'WR', pts, h)),
      ],
    });
  }

  // Two wire options competing for Team 1's weak FLEX slot (4 pts):
  // Steady (901): higher mean (14.5 -> higher SV!), tiny variance from consistent weekly scores.
  // Boom/Bust (902): lower mean (13.8 -> lower SV!), high variance from boom/bust weekly scores.
  const steadyId = add(makePlayer(901, 'RB', 14.5, [14.5, 14.4, 14.6, 14.5, 14.4, 14.6, 14.5, 14.5]));
  const boomId = add(makePlayer(902, 'WR', 13.8, [0, 36, 0, 35, 1, 34, 0, 36]));

  // 3 remaining regular-season weeks: 12, 13, 14 (playoffs start week 15)
  const fixtures = [
    { week: 12, homeTeamId: 1, awayTeamId: 2 }, { week: 12, homeTeamId: 3, awayTeamId: 4 },
    { week: 12, homeTeamId: 5, awayTeamId: 6 }, { week: 12, homeTeamId: 7, awayTeamId: 8 },
    { week: 13, homeTeamId: 1, awayTeamId: 3 }, { week: 13, homeTeamId: 2, awayTeamId: 5 },
    { week: 13, homeTeamId: 4, awayTeamId: 7 }, { week: 13, homeTeamId: 6, awayTeamId: 8 },
    { week: 14, homeTeamId: 1, awayTeamId: 4 }, { week: 14, homeTeamId: 2, awayTeamId: 6 },
    { week: 14, homeTeamId: 3, awayTeamId: 8 }, { week: 14, homeTeamId: 5, awayTeamId: 7 },
  ];

  const standings = [
    myStandings,
    { teamId: 2, wins: 8, losses: 3, ties: 0, pointsFor: 1200 },
    { teamId: 3, wins: 7, losses: 4, ties: 0, pointsFor: 1150 },
    { teamId: 4, wins: 7, losses: 4, ties: 0, pointsFor: 1120 },
    { teamId: 5, wins: 6, losses: 5, ties: 0, pointsFor: 1080 },
    { teamId: 6, wins: 5, losses: 6, ties: 0, pointsFor: 1050 },
    { teamId: 7, wins: 4, losses: 7, ties: 0, pointsFor: 1010 },
    { teamId: 8, wins: 3, losses: 8, ties: 0, pointsFor: 940 },
  ];

  const { plan } = buildSeasonPlan({
    currentWeek: 12, lastWeek: 16, playoffStart: 15,
    feeds: new Map([[12, players]]), byes: {}, slots: SLOTS, scoring: ONE,
  });

  const sim = createPlayoffSimulator({
    plan, teams, targetTeamId: 1, standings, fixtures,
    currentWeek: 12, playoffStart: 15, playoffTeams: 4,
  });

  return { players, teams, plan, sim, steadyId, boomId, standings, fixtures };
}

test('deterministic schedule simulation reproduces identical P(playoffs), honours pointsFor tiebreaker, and parses ESPN standings', () => {
  const espnBody = {
    settings: { scheduleSettings: { playoffTeamCount: 4 } },
    teams: [
      { id: 1, record: { overall: { wins: 6, losses: 5, ties: 0, pointsFor: 1125.4 } } },
      { id: 2, record: { overall: { wins: 6, losses: 5, ties: 0, pointsFor: 1040.2 } } },
      { id: 3, record: { overall: { wins: 5, losses: 6, ties: 0, pointsFor: 990.0 } } },
      { id: 4, record: { overall: { wins: 4, losses: 7, ties: 0, pointsFor: 950.5 } } },
      { id: 5, record: { overall: { wins: 3, losses: 8, ties: 0, pointsFor: 910.0 } } },
      { id: 6, record: { overall: { wins: 8, losses: 3, ties: 0, pointsFor: 1220.0 } } },
    ],
  };
  const parsed = extractEspnStandings(espnBody);
  assert.equal(parsed.playoffTeams, 4);
  assert.equal(parsed.standings.length, 6);
  assert.deepEqual(parsed.standings[0], { teamId: 1, wins: 6, losses: 5, ties: 0, pointsFor: 1125.4 });
  assert.deepEqual(extractEspnStandings({ teams: [{ id: 1 }] }), { standings: [], playoffTeams: null });

  const s1 = buildEightTeamScenario({
    myStandings: { teamId: 1, wins: 6, losses: 5, ties: 0, pointsFor: 1130 },
    oppStrength: () => 20,
  });
  const s2 = buildEightTeamScenario({
    myStandings: { teamId: 1, wins: 6, losses: 5, ties: 0, pointsFor: 1130 },
    oppStrength: () => 20,
  });
  assert.equal(s1.sim.info.available, true);
  assert.deepEqual(s1.sim.info.remainingWeeks, [12, 13, 14]);
  assert.equal(s1.sim.info.fixturesSimulated, 12);
  assert.equal(s1.sim.info.baselineProb, s2.sim.info.baselineProb, 'identical seed produces exact same baseline P(playoffs)');

  const sLowPf = buildEightTeamScenario({
    myStandings: { teamId: 1, wins: 6, losses: 5, ties: 0, pointsFor: 960 },
    oppStrength: () => 20,
  });
  assert.ok(
    s1.sim.info.baselineProb > sLowPf.sim.info.baselineProb,
    `higher pointsFor tiebreaker must raise P(playoffs): ${s1.sim.info.baselineProb} vs ${sLowPf.sim.info.baselineProb}`,
  );
});

test('KEY BACKLOG GUARD (WAIVERS): a team two games out prefers the high-variance option that a bubble team does not', () => {
  // Scenario A: Two games out of the 4th-place cutline (4-7 vs 6-5), facing tough contenders (23 pts/slot -> 115 vs ~102)
  const trailing = buildEightTeamScenario({
    myStandings: { teamId: 1, wins: 4, losses: 7, ties: 0, pointsFor: 960 },
    oppStrength: (t) => (t <= 4 ? 23.5 : 21),
    myCorePts: 22,
  });
  const trailingBoard = waiverBoard({
    plan: trailing.plan,
    rosterIds: trailing.teams[0].rosterIds,
    rosteredIds: trailing.teams.flatMap((t) => t.rosterIds),
    pool: trailing.players,
    budget: 80,
    teams: trailing.teams.length,
    playoffSim: trailing.sim,
  });
  assert.equal(trailingBoard.objective, 'playoffs');
  const tSteady = trailingBoard.rows.find((r) => r.add.playerId === trailing.steadyId);
  const tBoom = trailingBoard.rows.find((r) => r.add.playerId === trailing.boomId);
  assert.ok(tSteady && tBoom, 'both wire options surface on the board');
  assert.ok(tSteady.gain > tBoom.gain, `SV strictly prefers Steady (${tSteady.gain}) over Boom/Bust (${tBoom.gain})`);
  assert.ok(
    tBoom.playoffDelta > tSteady.playoffDelta,
    `team 2 games out must gain MORE P(playoffs) from Boom/Bust (${tBoom.playoffDelta}) than Steady (${tSteady.playoffDelta})`,
  );
  assert.equal(trailingBoard.rows[0].add.playerId, trailing.boomId, 'two-games-out waiver board ranks Boom/Bust #1');

  // Scenario B: Bubble/contending team tied for the 4th playoff spot (6-5, strong PF), favoured in remaining games
  const bubble = buildEightTeamScenario({
    myStandings: { teamId: 1, wins: 6, losses: 5, ties: 0, pointsFor: 1110 },
    oppStrength: (t) => (t <= 4 ? 18.0 : 20),
    myCorePts: 22,
  });
  const bubbleBoard = waiverBoard({
    plan: bubble.plan,
    rosterIds: bubble.teams[0].rosterIds,
    rosteredIds: bubble.teams.flatMap((t) => t.rosterIds),
    pool: bubble.players,
    budget: 80,
    teams: bubble.teams.length,
    playoffSim: bubble.sim,
  });
  const bSteady = bubbleBoard.rows.find((r) => r.add.playerId === bubble.steadyId);
  const bBoom = bubbleBoard.rows.find((r) => r.add.playerId === bubble.boomId);
  assert.ok(bSteady && bBoom);
  assert.ok(
    bSteady.playoffDelta > bBoom.playoffDelta,
    `bubble team must gain MORE P(playoffs) from Steady (${bSteady.playoffDelta}) than Boom/Bust (${bBoom.playoffDelta})`,
  );
  assert.equal(bubbleBoard.rows[0].add.playerId, bubble.steadyId, 'bubble waiver board ranks Steady #1');

  // Explicit rankBy: 'sv' still ranks Steady #1 for the trailing team while retaining P(playoffs) fields
  const svRanked = waiverBoard({
    plan: trailing.plan,
    rosterIds: trailing.teams[0].rosterIds,
    rosteredIds: trailing.teams.flatMap((t) => t.rosterIds),
    pool: trailing.players,
    budget: 80,
    teams: trailing.teams.length,
    playoffSim: trailing.sim,
    rankBy: 'sv',
  });
  assert.equal(svRanked.objective, 'sv');
  assert.equal(svRanked.rows[0].add.playerId, trailing.steadyId);
  assert.equal(typeof svRanked.rows[0].playoffDelta, 'number');
});

test('KEY BACKLOG GUARD (TRADES): two-games-out team ranks volatile trade above higher-SV steady trade while bubble team does the reverse', async () => {
  function tradeScenario({ myStandings, oppStrength }) {
    const players = {};
    const add = (p) => { players[p.playerId] = p; return p.playerId; };
    const steadyHist = [14.5, 14.3, 14.7, 14.4, 14.6, 14.5];
    const boomHist = [0, 34, 1, 33, 0, 32];
    const coreHist = [22, 21, 23, 22, 22];

    // Mine: strong core (2 RB + 2 WR), weak FLEX (4 pts), plus a surplus WR (106 = 13 pts) who sits on bench!
    // Giving WR 106 (bench surplus for us) to Team 5 or Team 6 (who each have a weak WR = 4 pts) makes BOTH sides gain SV!
    const mine = {
      teamId: 1, name: 'Mine',
      rosterIds: [
        add(makePlayer(101, 'RB', 22, coreHist)), add(makePlayer(102, 'RB', 22, coreHist)),
        add(makePlayer(103, 'WR', 22, coreHist)), add(makePlayer(104, 'WR', 22, coreHist)),
        add(makePlayer(105, 'RB', 4, [4, 4, 4, 4])), add(makePlayer(106, 'WR', 13, [13, 13, 13, 13])),
      ],
    };

    const steadyTradeId = add(makePlayer(951, 'RB', 14.5, [14.5, 14.4, 14.6, 14.5, 14.4, 14.6, 14.5, 14.5]));
    const boomTradeId = add(makePlayer(961, 'RB', 13.8, [0, 36, 0, 35, 1, 34, 0, 36]));
    const makePartner = (teamId, name, surplusRbId, basePts) => {
      const b = teamId * 100;
      const h = [basePts, basePts - 1, basePts + 1, basePts];
      return {
        teamId, name,
        rosterIds: [
          add(makePlayer(b + 1, 'RB', basePts + 4, h)), add(makePlayer(b + 2, 'RB', basePts + 3, h)),
          add(makePlayer(b + 3, 'WR', basePts, h)), add(makePlayer(b + 4, 'WR', 4, [4, 4, 4, 4])),
          add(makePlayer(b + 5, 'RB', basePts + 2, h)), surplusRbId,
        ],
      };
    };

    const others = [];
    for (let t = 2; t <= 8; t += 1) {
      if (t === 5) { others.push(makePartner(5, 'Steady Partner', steadyTradeId, oppStrength(5))); continue; }
      if (t === 6) { others.push(makePartner(6, 'Boom Partner', boomTradeId, oppStrength(6))); continue; }
      const pts = oppStrength(t);
      const h = [pts, pts - 1, pts + 1, pts];
      const b = t * 100;
      others.push({
        teamId: t, name: `Team ${t}`,
        rosterIds: [
          add(makePlayer(b + 1, 'RB', pts, h)), add(makePlayer(b + 2, 'RB', pts, h)),
          add(makePlayer(b + 3, 'WR', pts, h)), add(makePlayer(b + 4, 'WR', pts, h)),
          add(makePlayer(b + 5, 'WR', pts, h)),
        ],
      });
    }

    const teams = [mine, ...others];
    const fixtures = [
      { week: 12, homeTeamId: 1, awayTeamId: 2 }, { week: 12, homeTeamId: 3, awayTeamId: 4 },
      { week: 12, homeTeamId: 5, awayTeamId: 6 }, { week: 12, homeTeamId: 7, awayTeamId: 8 },
      { week: 13, homeTeamId: 1, awayTeamId: 3 }, { week: 13, homeTeamId: 2, awayTeamId: 5 },
      { week: 13, homeTeamId: 4, awayTeamId: 7 }, { week: 13, homeTeamId: 6, awayTeamId: 8 },
      { week: 14, homeTeamId: 1, awayTeamId: 4 }, { week: 14, homeTeamId: 2, awayTeamId: 6 },
      { week: 14, homeTeamId: 3, awayTeamId: 8 }, { week: 14, homeTeamId: 5, awayTeamId: 7 },
    ];
    const standings = [
      myStandings,
      { teamId: 2, wins: 8, losses: 3, ties: 0, pointsFor: 1200 },
      { teamId: 3, wins: 7, losses: 4, ties: 0, pointsFor: 1150 },
      { teamId: 4, wins: 7, losses: 4, ties: 0, pointsFor: 1120 },
      { teamId: 5, wins: 5, losses: 6, ties: 0, pointsFor: 1050 },
      { teamId: 6, wins: 5, losses: 6, ties: 0, pointsFor: 1050 },
      { teamId: 7, wins: 4, losses: 7, ties: 0, pointsFor: 1010 },
      { teamId: 8, wins: 3, losses: 8, ties: 0, pointsFor: 940 },
    ];
    const { plan } = buildSeasonPlan({
      currentWeek: 12, lastWeek: 16, playoffStart: 15,
      feeds: new Map([[12, players]]), byes: {}, slots: SLOTS, scoring: ONE,
    });
    const sim = createPlayoffSimulator({
      plan, teams, targetTeamId: 1, standings, fixtures,
      currentWeek: 12, playoffStart: 15, playoffTeams: 4,
    });
    return { mine, others, plan, sim, steadyTradeId, boomTradeId };
  }

  const trailing = tradeScenario({
    myStandings: { teamId: 1, wins: 4, losses: 7, ties: 0, pointsFor: 960 },
    oppStrength: (t) => (t <= 4 ? 23.5 : 19),
  });
  const tProps = await findTrades(trailing.mine, trailing.others, trailing.plan, TRADE_THRESHOLD, 50, { playoffSim: trailing.sim });
  const tSteady = tProps.find((p) => p.give.length === 1 && p.give[0] === 106 && p.get[0] === trailing.steadyTradeId);
  const tBoom = tProps.find((p) => p.give.length === 1 && p.give[0] === 106 && p.get[0] === trailing.boomTradeId);
  assert.ok(tSteady && tBoom, 'both mutually beneficial 1-for-1 trades surface');
  assert.ok(tSteady.youGain > tBoom.youGain, 'steady trade has higher SV gain');
  assert.ok(
    tBoom.playoffDelta > tSteady.playoffDelta,
    `two-games-out team gains more P(playoffs) from boom trade (${tBoom.playoffDelta}) than steady trade (${tSteady.playoffDelta})`,
  );
  assert.ok(tProps.indexOf(tBoom) < tProps.indexOf(tSteady), 'boom trade ranks ahead of steady trade for two-games-out team');

  const bubble = tradeScenario({
    myStandings: { teamId: 1, wins: 6, losses: 5, ties: 0, pointsFor: 1110 },
    oppStrength: (t) => (t <= 4 ? 18.0 : 19),
  });
  const bProps = await findTrades(bubble.mine, bubble.others, bubble.plan, TRADE_THRESHOLD, 50, { playoffSim: bubble.sim });
  const bSteady = bProps.find((p) => p.give.length === 1 && p.give[0] === 106 && p.get[0] === bubble.steadyTradeId);
  const bBoom = bProps.find((p) => p.give.length === 1 && p.give[0] === 106 && p.get[0] === bubble.boomTradeId);
  assert.ok(bSteady && bBoom);
  assert.ok(
    bSteady.playoffDelta > bBoom.playoffDelta,
    `bubble team gains more P(playoffs) from steady trade (${bSteady.playoffDelta}) than boom trade (${bBoom.playoffDelta})`,
  );
  assert.ok(bProps.indexOf(bSteady) < bProps.indexOf(bBoom), 'steady trade ranks ahead of boom trade for bubble team');
});

test('pure standings + pointsFor tiebreaker variance effect: even with identical opponent strength and equal-mean options', () => {
  // Every opponent projects identically (20/slot = 100/wk). Mine projects 100/wk with either option (mean = 14.0).
  const players = {};
  const add = (p) => { players[p.playerId] = p; return p.playerId; };
  const teams = [];
  for (let t = 1; t <= 4; t += 1) {
    const b = t * 100;
    teams.push({
      teamId: t, name: `T${t}`,
      rosterIds: [
        add(makePlayer(b + 1, 'RB', 22)), add(makePlayer(b + 2, 'RB', 22)),
        add(makePlayer(b + 3, 'WR', 21)), add(makePlayer(b + 4, 'WR', 21)),
        add(makePlayer(b + 5, 'RB', 14)),
      ],
    });
  }
  const steadyOpt = add(makePlayer(901, 'RB', 14));
  const volatileOpt = add(makePlayer(902, 'WR', 14));
  const fixtures = [
    { week: 12, homeTeamId: 1, awayTeamId: 2 }, { week: 12, homeTeamId: 3, awayTeamId: 4 },
    { week: 13, homeTeamId: 1, awayTeamId: 3 }, { week: 13, homeTeamId: 2, awayTeamId: 4 },
    { week: 14, homeTeamId: 1, awayTeamId: 4 }, { week: 14, homeTeamId: 2, awayTeamId: 3 },
  ];
  const { plan } = buildSeasonPlan({
    currentWeek: 12, lastWeek: 15, playoffStart: 15,
    feeds: new Map([[12, players]]), byes: {}, slots: SLOTS, scoring: ONE,
  });
  const spreadOverride = (id) => (id === steadyOpt ? 2.0 : id === volatileOpt ? 26.0 : 4.0);

  // Two games behind cutline AND trailing by 60 PF -> needs to win out AND surge on PF tiebreaker!
  const behindSim = createPlayoffSimulator({
    plan, teams, targetTeamId: 1, fixtures, currentWeek: 12, playoffStart: 15, playoffTeams: 2, spreadOverride,
    standings: [
      { teamId: 1, wins: 4, losses: 7, ties: 0, pointsFor: 990 },
      { teamId: 2, wins: 7, losses: 4, ties: 0, pointsFor: 1120 },
      { teamId: 3, wins: 6, losses: 5, ties: 0, pointsFor: 1050 },
      { teamId: 4, wins: 5, losses: 6, ties: 0, pointsFor: 1030 },
    ],
  });
  const rBase = teams[0].rosterIds.slice(0, 4);
  const behindSteady = behindSim.evaluateRoster([...rBase, steadyOpt]);
  const behindVolatile = behindSim.evaluateRoster([...rBase, volatileOpt]);
  assert.ok(
    behindVolatile.playoffProbWith > behindSteady.playoffProbWith,
    `trailing PF tiebreaker needs variance: volatile ${behindVolatile.playoffProbWith} > steady ${behindSteady.playoffProbWith}`,
  );

  // On the bubble tied at 6-5 AND ahead by 60 PF -> protects PF tiebreaker with lower variance!
  const aheadSim = createPlayoffSimulator({
    plan, teams, targetTeamId: 1, fixtures, currentWeek: 12, playoffStart: 15, playoffTeams: 2, spreadOverride,
    standings: [
      { teamId: 1, wins: 6, losses: 5, ties: 0, pointsFor: 1110 },
      { teamId: 2, wins: 7, losses: 4, ties: 0, pointsFor: 1120 },
      { teamId: 3, wins: 6, losses: 5, ties: 0, pointsFor: 1050 },
      { teamId: 4, wins: 3, losses: 8, ties: 0, pointsFor: 920 },
    ],
  });
  const aheadSteady = aheadSim.evaluateRoster([...rBase, steadyOpt]);
  const aheadVolatile = aheadSim.evaluateRoster([...rBase, volatileOpt]);
  assert.ok(
    aheadSteady.playoffProbWith > aheadVolatile.playoffProbWith,
    `ahead on PF tiebreaker prefers steady: steady ${aheadSteady.playoffProbWith} > volatile ${aheadVolatile.playoffProbWith}`,
  );
});

test('graceful degradation when standings or remaining fixtures are missing, and week-1 default 0-0 standings', () => {
  const s = buildEightTeamScenario({
    myStandings: { teamId: 1, wins: 5, losses: 6, ties: 0, pointsFor: 1000 },
    oppStrength: () => 20,
  });
  const noStandings = createPlayoffSimulator({
    plan: s.plan, teams: s.teams, targetTeamId: 1, standings: [], fixtures: s.fixtures,
    currentWeek: 12, playoffStart: 15, playoffTeams: 4,
  });
  assert.equal(noStandings.info.available, false);
  assert.match(noStandings.info.reason, /standings/i);
  assert.equal(noStandings.evaluateRoster(s.teams[0].rosterIds), null);

  const noFixtures = createPlayoffSimulator({
    plan: s.plan, teams: s.teams, targetTeamId: 1, standings: s.standings, fixtures: [],
    currentWeek: 12, playoffStart: 15, playoffTeams: 4,
  });
  assert.equal(noFixtures.info.available, false);
  assert.match(noFixtures.info.reason, /fixtures/i);

  const week1Plan = buildSeasonPlan({
    currentWeek: 1, lastWeek: 4, playoffStart: 4,
    feeds: new Map([[1, s.players]]), byes: {}, slots: SLOTS, scoring: ONE,
  }).plan;
  const week1Fixtures = s.fixtures.map((f) => ({ ...f, week: f.week - 11 }));
  const week1Sim = createPlayoffSimulator({
    plan: week1Plan, teams: s.teams, targetTeamId: 1, standings: [], fixtures: week1Fixtures,
    currentWeek: 1, playoffStart: 4, playoffTeams: null,
  });
  assert.equal(week1Sim.info.available, true);
  assert.equal(week1Sim.info.playoffTeams, 4);
  assert.equal(week1Sim.info.playoffTeamsAssumed, true);
});

// ---- Compiled route integration (self-contained: no core checkout required) ----------------------

function loadCompiled(file, overrides, cache) {
  if (cache.has(file)) return cache.get(file).exports;
  const target = { exports: {} };
  cache.set(file, target);
  const nativeRequire = createRequire(file);
  const localRequire = (name) => {
    if (overrides[name]) return overrides[name];
    if (name.startsWith('@/')) throw new Error(`undoubled framework import ${name}`);
    if (name.startsWith('./')) return loadCompiled(path.join(path.dirname(file), `${name.slice(2)}.js`), overrides, cache);
    return nativeRequire(name);
  };
  new vm.Script(`(function(require,module,exports,__filename,__dirname){${fs.readFileSync(file, 'utf8')}\n})`, { filename: file })
    .runInThisContext()(localRequire, target, target.exports, file, path.dirname(file));
  return target.exports;
}

function makePool() {
  const manual = [];
  const projections = new Map();
  const playerWeeks = new Map();
  let writes = 0;
  return {
    get writes() { return writes; },
    async query(sql, p = []) {
      const text = String(sql);
      if (/^\s*(CREATE|ALTER|DO \$\$)/.test(text)) return { rows: [], rowCount: 0 };
      if (/INSERT INTO ff_manual_leagues/.test(text)) {
        writes += 1;
        const m = { id: manual.length + 1, user_sub: p[0], name: p[1], season: p[2], doc: JSON.parse(p[3]), updated_at: new Date().toISOString() };
        manual.push(m);
        return { rows: [{ id: m.id }], rowCount: 1 };
      }
      if (/FROM ff_manual_leagues WHERE user_sub = \$1 AND id = \$2/.test(text)) {
        return { rows: manual.filter((x) => x.user_sub === p[0] && x.id === p[1]) };
      }
      if (/FROM ff_manual_leagues WHERE user_sub = \$1 ORDER BY/.test(text)) {
        return { rows: manual.filter((x) => x.user_sub === p[0]) };
      }
      if (/INSERT INTO ff_projections/.test(text)) {
        writes += 1;
        projections.set(`${p[0]}:${p[1]}:${p[2]}`, { scoring_period: p[2], payload: JSON.parse(p[3]), generated_at: new Date().toISOString() });
        return { rows: [], rowCount: 1 };
      }
      if (/scoring_period BETWEEN \$3 AND \$4/.test(text)) {
        return {
          rows: [...projections.entries()].filter(([k]) => {
            const [sub, season, week] = k.split(':');
            return sub === p[0] && Number(season) === p[1] && Number(week) >= p[2] && Number(week) <= p[3];
          }).map(([, v]) => v),
        };
      }
      if (/FROM ff_projections/.test(text)) {
        const hit = projections.get(`${p[0]}:${p[1]}:${p[2]}`);
        return { rows: hit ? [hit] : [] };
      }
      if (/INSERT INTO ff_player_weeks/.test(text)) {
        writes += 1;
        for (let i = 2; i < p.length; i += 3) {
          playerWeeks.set(`${p[0]}:${p[1]}:${p[i]}:${p[i + 1]}`, { sub: p[0], season: p[1], week: p[i], player_id: p[i + 1], stats: JSON.parse(p[i + 2]) });
        }
        return { rows: [], rowCount: (p.length - 2) / 3 };
      }
      if (/FROM ff_player_weeks/.test(text)) {
        return {
          rows: [...playerWeeks.values()]
            .filter((r) => r.sub === p[0] && r.season === p[1] && r.week < p[2] && p[3].includes(r.player_id))
            .map((r) => ({ week: r.week, player_id: r.player_id, stats: r.stats })),
        };
      }
      if (/FROM ff_leagues/.test(text)) return { rows: [] };
      throw new Error(`unhandled SQL in playoff-sim route test: ${text.slice(0, 90)}`);
    },
  };
}

function buildRouteHarness(skill, pool, credSecret = null) {
  const routes = new Map();
  const add = (m) => (r, ...h) => { routes.set(`${m} ${r}`, h[h.length - 1]); };
  const quiet = { debug() {}, info() {}, warn() {}, error() {} };
  const overrides = {
    '@/shared/logger': { createChildLogger: () => quiet },
    '@/app/routes/trading-routes-helpers': { callerSub: () => 'owner-a', servePage: () => () => {} },
    '@/app/routes/connectors-routes': { getValidAccessToken: async () => credSecret },
    '@/app/routes/connector-tenancy': {
      accessibleConnections: async () => (credSecret ? [{ connection_id: 'own-1', tenant_id: null, user_sub: 'owner-a' }] : []),
    },
    '@/features/fantasy-leagues': skill,
    express: { Router: () => ({ get: add('GET'), post: add('POST'), put: add('PUT'), delete: add('DELETE'), use() {} }) },
  };
  const mod = loadCompiled(path.join(PKG_DIR, 'routes', 'fantasy-routes.js'), overrides, new Map());
  mod.createFantasyFootballRoutes({ pool, appPackageDir: PKG_DIR });
  return async (key, req = {}) => {
    const out = { code: 200, body: null };
    const res = { status(n) { out.code = n; return res; }, json(b) { out.body = b; return res; }, setHeader() {}, sendFile() {} };
    await routes.get(key)({ query: {}, params: {}, body: {}, headers: {}, ...req }, res);
    return out;
  };
}

test('route integration (hand-typed & ESPN-shaped): /season, /waivers, /trades and /quant/waivers report P(playoffs) before and after moves', async () => {
  const players = {
    11: makePlayer(11, 'RB', 20), 12: makePlayer(12, 'RB', 4), 13: makePlayer(13, 'WR', 15), 14: makePlayer(14, 'WR', 13),
    21: makePlayer(21, 'RB', 18), 22: makePlayer(22, 'RB', 16), 23: makePlayer(23, 'RB', 14), 24: makePlayer(24, 'WR', 4),
    31: makePlayer(31, 'RB', 15), 32: makePlayer(32, 'RB', 14), 33: makePlayer(33, 'WR', 14), 34: makePlayer(34, 'WR', 13),
    41: makePlayer(41, 'RB', 14), 42: makePlayer(42, 'RB', 13), 43: makePlayer(43, 'WR', 13), 44: makePlayer(44, 'WR', 12),
    50: makePlayer(50, 'RB', 15), 51: makePlayer(51, 'RB', 11),
  };
  const completedWeeks = [
    { playerId: 50, week: 1, stats: { 1: 15 } }, { playerId: 50, week: 2, stats: { 1: 15 } },
    { playerId: 51, week: 1, stats: { 1: 2 } }, { playerId: 51, week: 2, stats: { 1: 24 } },
  ];
  const espnTeams = [
    { teamId: 1, name: 'Mine', owners: ['{ME}'], entries: [11, 12, 13, 14].map((id) => ({ playerId: id, lineupSlotId: 0, player: {} })), rosterPlayerIds: [11, 12, 13, 14], startingPlayerIds: [11, 12, 13] },
    { teamId: 2, name: 'Theirs', owners: ['{T2}'], entries: [21, 22, 23, 24].map((id) => ({ playerId: id, lineupSlotId: 0, player: {} })), rosterPlayerIds: [21, 22, 23, 24], startingPlayerIds: [21, 22, 24] },
    { teamId: 3, name: 'Third', owners: ['{T3}'], entries: [31, 32, 33, 34].map((id) => ({ playerId: id, lineupSlotId: 0, player: {} })), rosterPlayerIds: [31, 32, 33, 34], startingPlayerIds: [31, 32, 33] },
    { teamId: 4, name: 'Fourth', owners: ['{T4}'], entries: [41, 42, 43, 44].map((id) => ({ playerId: id, lineupSlotId: 0, player: {} })), rosterPlayerIds: [41, 42, 43, 44], startingPlayerIds: [41, 42, 43] },
  ];
  const skill = {
    readCurrentScoringPeriod: async () => 12,
    fetchProjections: async () => ({ players, weeks: completedWeeks }),
    parseCredential: (s) => (s ? { swid: '{ME}', espnS2: 'tok' } : null),
    classifyFailure: (r) => ({ kind: 'refused', reason: r, status: 401 }),
    findOwnTeam: (ts) => ts.find((t) => t.teamId === 1) || null,
    readLeagueSettingsOutcome: async () => ({
      settings: { leagueId: '999', season: 2026, name: 'ESPN League', scoringPeriodId: 12, scoring: ONE, slots: [{ slotId: 2, count: 2 }, { slotId: 4, count: 1 }] },
      failure: null,
    }),
    readTeams: async () => espnTeams,
    readMatchupsOutcome: async () => ({
      matchups: [
        { matchupPeriodId: 12, homeTeamId: 1, awayTeamId: 2 }, { matchupPeriodId: 12, homeTeamId: 3, awayTeamId: 4 },
        { matchupPeriodId: 13, homeTeamId: 1, awayTeamId: 3 }, { matchupPeriodId: 13, homeTeamId: 2, awayTeamId: 4 },
        { matchupPeriodId: 14, homeTeamId: 1, awayTeamId: 4 }, { matchupPeriodId: 14, homeTeamId: 2, awayTeamId: 3 },
      ],
      failure: null,
    }),
    readLeague: async () => ({
      status: { finalScoringPeriod: 16 },
      settings: {
        acquisitionSettings: { isUsingAcquisitionBudget: true, acquisitionBudget: 100 },
        scheduleSettings: { matchupPeriodCount: 14, playoffTeamCount: 2 },
      },
      teams: [
        { id: 1, transactionCounter: { acquisitionBudgetSpent: 10 }, record: { overall: { wins: 5, losses: 6, ties: 0, pointsFor: 500 } } },
        { id: 2, transactionCounter: { acquisitionBudgetSpent: 0 }, record: { overall: { wins: 7, losses: 4, ties: 0, pointsFor: 560 } } },
        { id: 3, transactionCounter: { acquisitionBudgetSpent: 0 }, record: { overall: { wins: 6, losses: 5, ties: 0, pointsFor: 530 } } },
        { id: 4, transactionCounter: { acquisitionBudgetSpent: 0 }, record: { overall: { wins: 4, losses: 7, ties: 0, pointsFor: 470 } } },
      ],
    }),
  };

  // 1) Hand-typed league with standings + playoffTeams
  const pool = makePool();
  const drive = buildRouteHarness(skill, pool, '{ME}:tok');
  const manualBody = {
    name: 'Standings League', season: 2026, scoring: ONE,
    slots: [{ slotId: 2, count: 2 }, { slotId: 4, count: 1 }],
    teams: [
      { teamId: 1, name: 'Mine', mine: true, roster: [11, 12, 13, 14], starting: [11, 12, 13] },
      { teamId: 2, name: 'Theirs', roster: [21, 22, 23, 24], starting: [21, 22, 24] },
      { teamId: 3, name: 'Third', roster: [31, 32, 33, 34], starting: [31, 32, 33] },
      { teamId: 4, name: 'Fourth', roster: [41, 42, 43, 44], starting: [41, 42, 43] },
    ],
    schedule: [
      { week: 12, home: 1, away: 2 }, { week: 12, home: 3, away: 4 },
      { week: 13, home: 1, away: 3 }, { week: 13, home: 2, away: 4 },
      { week: 14, home: 1, away: 4 }, { week: 14, home: 2, away: 3 },
    ],
    standings: [
      { teamId: 1, wins: 5, losses: 6, ties: 0, pointsFor: 500 },
      { teamId: 2, wins: 7, losses: 4, ties: 0, pointsFor: 560 },
      { teamId: 3, wins: 6, losses: 5, ties: 0, pointsFor: 530 },
      { teamId: 4, wins: 4, losses: 7, ties: 0, pointsFor: 470 },
    ],
    playoffTeams: 2, byes: {}, faab: { budget: 100, spent: 10 }, lastWeek: 16, playoffStart: 15,
  };

  // Validation rejects out-of-range playoffTeams and unknown teamId in standings
  const bad = await drive('POST /manual-leagues', { body: { ...manualBody, playoffTeams: 4, standings: [{ teamId: 99, wins: 1, losses: 0, ties: 0, pointsFor: 10 }] } });
  assert.equal(bad.code, 400);
  assert.match(bad.body.problems.join(' | '), /playoffTeams/);
  assert.match(bad.body.problems.join(' | '), /standings/);

  const saved = await drive('POST /manual-leagues', { body: manualBody });
  assert.equal(saved.code, 201, JSON.stringify(saved.body));
  const q = { manualId: String(saved.body.id), season: '2026' };

  const writesBeforeQuant = pool.writes;
  const qWaivers = await drive('GET /quant/waivers', { query: q });
  assert.equal(qWaivers.code, 200, JSON.stringify(qWaivers.body));
  assert.equal(pool.writes, writesBeforeQuant, 'GET /quant/waivers remains strictly read-only');
  assert.equal(qWaivers.body.playoffs.available, true);
  assert.equal(qWaivers.body.objective, 'playoffs');
  assert.ok(qWaivers.body.upgrades.length > 0);
  assert.equal(typeof qWaivers.body.upgrades[0].playoffProb, 'number');
  assert.equal(typeof qWaivers.body.upgrades[0].playoffProbWith, 'number');
  assert.equal(typeof qWaivers.body.upgrades[0].playoffDelta, 'number');

  const season = await drive('GET /season', { query: q });
  assert.equal(season.code, 200);
  assert.equal(season.body.playoffs.available, true);
  assert.equal(season.body.playoffs.playoffTeams, 2);
  assert.equal(season.body.playoffs.playoffTeamsAssumed, false);

  const waivers = await drive('GET /waivers', { query: q });
  assert.equal(waivers.code, 200);
  assert.equal(waivers.body.objective, 'playoffs');
  assert.equal(waivers.body.playoffs.available, true);
  assert.ok(waivers.body.rows.length > 0);
  for (const r of waivers.body.rows) {
    assert.equal(r.playoffProb, waivers.body.playoffs.baselineProb);
    assert.ok(r.playoffProbWith >= 0 && r.playoffProbWith <= 1);
    assert.equal(r.playoffDelta, Math.round((r.playoffProbWith - r.playoffProb) * 10000) / 10000);
  }

  const trades = await drive('GET /trades', { query: q });
  assert.equal(trades.code, 200);
  assert.equal(trades.body.objective, 'playoffs');
  assert.equal(trades.body.playoffs.available, true);
  assert.ok(trades.body.proposals.length > 0, 'slot-pressure trade surfaces (WR 14 for RB 23)');
  for (const t of trades.body.proposals) {
    assert.equal(t.playoffProb, trades.body.playoffs.baselineProb);
    assert.ok(t.playoffProbWith >= 0 && t.playoffProbWith <= 1);
    assert.equal(t.playoffDelta, Math.round((t.playoffProbWith - t.playoffProb) * 10000) / 10000);
  }

  // 2) ESPN-shaped league uses standings & playoffTeamCount directly from mSettings+mTeam
  const espnWaivers = await drive('GET /waivers', { query: { leagueId: '999', season: '2026' } });
  assert.equal(espnWaivers.code, 200, JSON.stringify(espnWaivers.body));
  assert.equal(espnWaivers.body.source, 'espn');
  assert.equal(espnWaivers.body.playoffs.available, true);
  assert.equal(espnWaivers.body.playoffs.playoffTeams, 2);
  assert.equal(espnWaivers.body.playoffs.baselineProb, waivers.body.playoffs.baselineProb, 'ESPN and manual parity');
  assert.ok(espnWaivers.body.rows[0].playoffDelta > 0);

  const espnTrades = await drive('GET /trades', { query: { leagueId: '999', season: '2026' } });
  assert.equal(espnTrades.code, 200);
  assert.equal(espnTrades.body.playoffs.available, true);
  assert.ok(espnTrades.body.proposals.length > 0);
  assert.equal(typeof espnTrades.body.proposals[0].playoffDelta, 'number');
});

test('UI renders P(playoffs) on Season, Waivers and Trades and round-trips standings & playoffTeams in manual form', () => {
  const html = fs.readFileSync(path.join(PKG_DIR, 'tools', 'fantasy-football.html'), 'utf8');
  const src = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
  const unescape = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const nodes = {};
  const node = (id) => (nodes[id] = nodes[id] || {
    id, value: '', checked: false, textContent: '', style: {}, hidden: false,
    addEventListener() {}, setAttribute() {}, getAttribute: () => null, querySelectorAll: () => [],
    _html: '',
    get innerHTML() { return this._html; },
    set innerHTML(v) {
      this._html = v;
      if (id === 'mForm') {
        for (const m of v.matchAll(/<input id="([^"]+)" type="([^"]+)" value="([^"]*)"/g)) node(m[1]).value = unescape(m[3]);
        for (const m of v.matchAll(/<input type="radio" name="mMine" id="([^"]+)"( checked)?>/g)) node(m[1]).checked = !!m[2];
        for (const m of v.matchAll(/<textarea id="([^"]+)" rows="\d+">([\s\S]*?)<\/textarea>/g)) node(m[1]).value = unescape(m[2]);
      }
    },
  });
  const sandbox = {
    document: { getElementById: node, querySelectorAll: () => [], addEventListener() {} },
    fetch: () => new Promise(() => {}),
    console: { log() {}, warn() {}, error() {} },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'fantasy-football.html' });

  const playoffsOk = { available: true, reason: null, baselineProb: 0.425, playoffTeams: 4, playoffTeamsAssumed: false, remainingWeeks: [12, 13, 14], fixturesSimulated: 12, trials: 4000, seed: 1 };
  const head = { team: { name: 'Mine' }, weeks: { fromFeed: [12], fromRate: [13, 14], playoffStart: 15 }, byesKnown: true, playoffs: playoffsOk };

  sandbox.renderSeason({ ...head, total: 310.5, byWeek: [{}, {}, {}], drop: { name: 'Bench RB', cost: 0 } });
  assert.match(nodes.lineupBody.innerHTML, /Playoff chance/);
  assert.match(nodes.lineupBody.innerHTML, /42\.5%/);

  sandbox.renderWaivers({ ...head, mode: 'faab', budget: 90, cap: 88,
    rows: [{ add: { name: 'Boom WR' }, drop: { name: 'Weak RB' }, gain: 28.5, weeksStarting: 3, scarcity: true, bid: 35, playoffProb: 0.425, playoffProbWith: 0.512, playoffDelta: 0.087 }],
    streaming: [] });
  assert.match(nodes.lineupBody.innerHTML, /P\(playoffs\)/);
  assert.match(nodes.lineupBody.innerHTML, /51\.2% \(\+8\.7 pp\)/);

  sandbox.renderTrades({ ...head, proposals: [{ teamName: 'Rival', give: [{ name: 'WR A' }], get: [{ name: 'RB B' }], youGain: 24, themGain: 18, playoffProb: 0.425, playoffProbWith: 0.491, playoffDelta: 0.066 }] });
  assert.match(nodes.lineupBody.innerHTML, /49\.1% \(\+6\.6 pp\)/);

  // Unavailable degradation message renders clearly
  sandbox.renderWaivers({ ...head, playoffs: { available: false, reason: 'Current standings are needed.' }, mode: 'rolling', rows: [], streaming: [] });
  assert.match(nodes.lineupBody.innerHTML, /P\(playoffs\) not simulated: Current standings are needed\./);

  // Manual form round-trip with playoffTeams and standings
  const league = {
    name: 'Playoff Form League', season: 2026, scoring: [{ statId: 53, points: 1 }],
    slots: [{ slotId: 2, count: 2 }],
    teams: [
      { teamId: 1, name: 'Mine', mine: true, roster: [11, 12], starting: [11] },
      { teamId: 2, name: 'Theirs', mine: false, roster: [21, 22], starting: [21] },
    ],
    schedule: [{ week: 12, home: 1, away: 2 }], byes: {}, faab: null, lastWeek: 14, playoffStart: 14,
    playoffTeams: 1,
    standings: [
      { teamId: 1, wins: 5, losses: 6, ties: 0, pointsFor: 980.5 },
      { teamId: 2, wins: 7, losses: 4, ties: 1, pointsFor: 1120 },
    ],
  };
  sandbox.renderManualForm(league, 7);
  const back = JSON.parse(JSON.stringify(sandbox.readManualForm()));
  assert.deepEqual(back.problems, []);
  assert.deepEqual(back.league, league);
});
