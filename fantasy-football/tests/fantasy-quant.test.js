/**
 * Fantasy Quant concierge and approval-card mutation guard suite (F22).
 *
 * Verifies:
 *   1. `GET /quant/start-sit`, `GET /quant/waivers`, and `GET /quant/matchup` answer real numeric
 *      projections, floor10/ceiling90 bounds, NFL team/bye/injury status, matchup posture, win
 *      probability swing (`deltaWinProbPts`), and FAAB waiver upgrades on a hand-typed league with
 *      zero SQL writes (`persist: false`, zero `ff_calls` / `ff_weeks` mutations on GET).
 *   2. `POST /quant/set-lineup` and `POST /quant/apply-waiver` update the caller's hand-typed
 *      league starters/roster/FAAB cleanly and refuse cross-owner or already-rostered mutations.
 *   3. `oshal-app.yaml`, `personas/fantasy-quant.yaml`, and `tools/fantasy-football.html` bind
 *      `fantasy-quant` and gate both mutation tools behind `defaultAuthMode: ask` and
 *      `requiresApproval: true`.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — read-only FLEX start-sit, waivers, matchup breakdown, hand-typed lineup/waiver mutations, and Fantasy Quant manifest/persona/approval-gate assertions.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { drive, loadRouter, memPool } = require('./fantasy-routes-harness.js');
const { SEASON, manualLeague, publicOnlyEspn } = require('./fantasy-manual-fixture.js');

const PKG_DIR = path.resolve(__dirname, '..');

function flexLeagueDoc() {
  return manualLeague({
    name: 'Quant Flex League',
    slots: [{ slotId: 2, count: 1 }, { slotId: 4, count: 1 }, { slotId: 23, count: 1 }],
    byes: { 6: 9 },
  });
}

async function seedManualLeague(router, doc = flexLeagueDoc()) {
  const res = await drive(router, 'POST /manual-leagues', { body: doc });
  assert.equal(res.code, 201, JSON.stringify(res.body));
  return res.body.id;
}

test('GET /quant/start-sit answers numeric FLEX candidates and P(win) swing with zero DB writes', async () => {
  const pool = memPool();
  const { router, broker } = loadRouter({ sub: 'owner-quant', secret: null }, pool);
  const manualId = await seedManualLeague(router);
  const startSit = await drive(
    router, 'GET /quant/start-sit',
    { query: { slot: 'FLEX', manualId: String(manualId), season: String(SEASON) } },
    publicOnlyEspn(4, []),
  );
  assert.equal(startSit.code, 200, JSON.stringify(startSit.body));
  assert.equal(startSit.body.slot, 'FLEX');
  assert.equal(startSit.body.league.name, 'Quant Flex League');
  assert.equal(startSit.body.matchup.opponentName, 'Theirs');
  assert.ok(['underdog', 'favourite', 'even'].includes(startSit.body.matchup.posture));
  assert.ok(typeof startSit.body.matchup.winProbabilityPct === 'number');
  const benchBack = startSit.body.candidates.find((c) => c.playerId === 13);
  const starterRb2 = startSit.body.candidates.find((c) => c.playerId === 12);
  assert.ok(benchBack && starterRb2);
  assert.equal(benchBack.projectedPoints, 11);
  assert.ok(benchBack.ceiling90 > benchBack.projectedPoints && benchBack.floor10 < benchBack.projectedPoints);
  assert.ok(typeof benchBack.proTeam === 'string' && benchBack.proTeam.length >= 2);
  assert.equal(benchBack.injuryStatus, 'ACTIVE');
  assert.equal(benchBack.recommendedSlot, 'FLEX');
  assert.ok(typeof benchBack.deltaWinProbPts === 'number');
  assert.equal(starterRb2.recommendedAction, 'BENCH');
  assert.equal(broker.lookups, 0);
  assert.equal(pool.tables.calls.length + pool.tables.weeks.size + pool.tables.projections.size, 0);
});

test('GET /quant/waivers and /quant/matchup answer FAAB bids and moment bands with zero DB writes', async () => {
  const pool = memPool();
  const { router, broker } = loadRouter({ sub: 'owner-quant', secret: null }, pool);
  const manualId = await seedManualLeague(router);
  const seen = [];
  const waivers = await drive(
    router, 'GET /quant/waivers',
    { query: { manualId: String(manualId), season: String(SEASON) } },
    publicOnlyEspn(4, seen),
  );
  assert.equal(waivers.code, 200, JSON.stringify(waivers.body));
  assert.equal(waivers.body.mode, 'faab');
  assert.equal(waivers.body.faabRemaining, 90);
  assert.ok(waivers.body.upgrades.length > 0);
  assert.equal(waivers.body.upgrades[0].add.playerId, 50);
  assert.ok(typeof waivers.body.upgrades[0].bid === 'number');

  const matchup = await drive(
    router, 'GET /quant/matchup',
    { query: { manualId: String(manualId), season: String(SEASON) } },
    publicOnlyEspn(4, seen),
  );
  assert.equal(matchup.code, 200, JSON.stringify(matchup.body));
  assert.ok(matchup.body.yourMoments.mean > 0 && matchup.body.opponentMoments.mean > 0);
  assert.equal(matchup.body.starters.length, 3);
  assert.ok(matchup.body.starters.some((s) => s.slotName === 'FLEX'));
  assert.equal(broker.lookups, 0);
  assert.equal(pool.tables.calls.length + pool.tables.weeks.size + pool.tables.projections.size, 0);
});

test('POST /quant/set-lineup and POST /quant/apply-waiver mutate only after explicit call and enforce ownership', async () => {
  const pool = memPool();
  const owner = loadRouter({ sub: 'owner-quant', secret: null }, pool);
  const stranger = loadRouter({ sub: 'stranger-quant', secret: null }, pool);
  const manualId = await seedManualLeague(owner.router);

  const denied = await drive(
    stranger.router, 'POST /quant/set-lineup',
    { body: { manualId, season: SEASON, startPlayerId: 13, sitPlayerId: 12 } },
    publicOnlyEspn(4, []),
  );
  assert.equal(denied.code, 404);

  const setRes = await drive(
    owner.router, 'POST /quant/set-lineup',
    { body: { manualId, season: SEASON, startPlayerId: 13, sitPlayerId: 12 } },
    publicOnlyEspn(4, []),
  );
  assert.equal(setRes.code, 200, JSON.stringify(setRes.body));
  assert.deepEqual(setRes.body.startingPlayerIds, [11, 14, 13]);
  assert.ok(pool.tables.weeks.has(`owner-quant:${SEASON}:manual:${manualId}:4`));

  const alreadyRostered = await drive(
    owner.router, 'POST /quant/apply-waiver',
    { body: { manualId, season: SEASON, addPlayerId: 21, dropPlayerId: 12, faabBid: 12 } },
    publicOnlyEspn(4, []),
  );
  assert.equal(alreadyRostered.code, 400);

  const waiverRes = await drive(
    owner.router, 'POST /quant/apply-waiver',
    { body: { manualId, season: SEASON, addPlayerId: 50, dropPlayerId: 12, faabBid: 15 } },
    publicOnlyEspn(4, []),
  );
  assert.equal(waiverRes.code, 200, JSON.stringify(waiverRes.body));
  assert.equal(waiverRes.body.addedPlayerId, 50);
  assert.equal(waiverRes.body.droppedPlayerId, 12);
  assert.equal(waiverRes.body.faab.spent, 25);

  const saved = await drive(owner.router, 'GET /manual-leagues/:id', { params: { id: String(manualId) } });
  const mine = saved.body.league.teams.find((t) => t.mine);
  assert.ok(mine.roster.includes(50) && !mine.roster.includes(12));
});

test('manifest and persona bind fantasy-quant and gate lineup and waiver mutations behind approval', () => {
  const manifest = fs.readFileSync(path.join(PKG_DIR, 'oshal-app.yaml'), 'utf8');
  const persona = fs.readFileSync(path.join(PKG_DIR, 'personas', 'fantasy-quant.yaml'), 'utf8');
  const html = fs.readFileSync(path.join(PKG_DIR, 'tools', 'fantasy-football.html'), 'utf8');
  assert.match(manifest, /^chatBot:\s*fantasy-quant$/m);
  assert.match(manifest, /name:\s*fantasy_quant_set_lineup[\s\S]*?defaultAuthMode:\s*ask[\s\S]*?requiresApproval:\s*true/);
  assert.match(manifest, /name:\s*fantasy_quant_apply_waiver[\s\S]*?defaultAuthMode:\s*ask[\s\S]*?requiresApproval:\s*true/);
  assert.match(manifest, /name:\s*fantasy_quant_start_sit[\s\S]*?defaultAuthMode:\s*auto[\s\S]*?requiresApproval:\s*false/);
  assert.match(persona, /^name:\s*fantasy-quant$/m);
  assert.match(persona, /fantasy_quant_start_sit/);
  assert.match(html, /id="conciergeRail"/);
  assert.match(html, /Who should I start at flex\?/);
});
