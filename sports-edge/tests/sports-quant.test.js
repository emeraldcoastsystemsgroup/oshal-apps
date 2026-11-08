/**
 * Sports Quant concierge and outlier-trimmed robustness suite (F22).
 *
 * Verifies:
 *   1. Outlier-trimmed robustness (`WINNERS_REMOVED = 0.2`) catches a lucky longshot carrying a
 *      mediocre ledger (`PROMISING_OUTLIER_DEPENDENT`) while clearing a genuinely consistent,
 *      positive-CLV, lower-Brier ledger (`HOLDS_UP`).
 *   2. Read-only `GET /quant/tonight`, `GET /quant/roi`, and `GET /quant/game` return numeric vig,
 *      de-vigged market vs model probabilities, edge %, quarter-Kelly sizing, line movement, and
 *      outlier-trimmed ROI with zero SQL write statements under native reader admission.
 *   3. `oshal-app.yaml`, `personas/sports-quant.yaml`, and `/concierge.{js,css}` bind `sports-quant`
 *      and gate `sports_edge_record_pick` behind `defaultAuthMode: ask` and `requiresApproval: true`.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — outlier-trimmed ledger robustness, read-only quant HTTP endpoints, and Sports Quant manifest/persona/approval-gate assertions.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

function fakeRouter() {
  const routes = [];
  const add = (method) => (route, ...handlers) => {
    routes.push({ method, route, handler: handlers[handlers.length - 1] });
  };
  return { routes, get: add('get'), post: add('post'), put: add('put'), patch: add('patch'), delete: add('delete'), use: add('use') };
}

const quiet = { debug() {}, info() {}, warn() {}, error() {} };
const STUBS = {
  '@/shared/logger': { createChildLogger: () => quiet },
  '@/features/world-data': { createWorldIntelligenceService: () => null, ingestFeeds: async () => ({ newItems: 0 }) },
  '@/app/routes/trading-routes-helpers': {
    callerSub: (req) => (req.oidc && req.oidc.user && req.oidc.user.sub) || null,
    servePage: () => () => {},
  },
  '@/shared/middleware/authz': { isOperator: (req) => Boolean(req && req.operator) },
  express: { Router: fakeRouter },
};
const origLoad = Module._load;
Module._load = function stubbed(request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  return origLoad.call(this, request, ...rest);
};

const routes = require('../routes/sports-routes.js');
const quant = require('../routes/sports-quant.js');

const WRITE_SQL = /^\s*(INSERT|UPDATE|DELETE|UPSERT|MERGE)\b|\bON CONFLICT\b/i;
const PKG_DIR = path.join(__dirname, '..');
const PERSON = { oidc: { user: { sub: 'person-quant-1' } } };

function makeSettledRows(winsSpec, lossCount) {
  const out = [];
  for (const w of winsSpec) {
    out.push({
      strategy: 'ensemble', won: true,
      brier: w.brier ?? 0.16, marketBrier: w.marketBrier ?? 0.22,
      clv: w.clv ?? 0.03, pnlUnits: w.pnl,
    });
  }
  for (let i = 0; i < lossCount; i += 1) {
    out.push({
      strategy: 'ensemble', won: false,
      brier: 0.24, marketBrier: 0.25, clv: 0.01, pnlUnits: -1,
    });
  }
  return out;
}

function storedFixturePreview() {
  const kickIso = new Date(Date.now() + 5 * 3600000).toISOString();
  return {
    eventId: '401888101',
    league: 'nfl',
    date: kickIso,
    homeTeam: 'KC',
    awayTeam: 'BUF',
    carriedOver: false,
    quote: {
      book: 'DraftKings', homeSpread: -3.5, homeSpreadOdds: -110, awaySpreadOdds: -110,
      homeMoneyline: -175, awayMoneyline: 148, total: 48.5,
    },
    line: {
      projectedMargin: 6.1, homeWinProbability: 0.675,
      signals: [{ name: 'elo', margin: 5.8 }], adjustments: [], availability: { homeMissingShare: 0, awayMissingShare: 0.04 },
    },
    ratings: { games: 140 },
    context: { espnHomeWinPct: 64.2 },
    edges: [{
      market: 'spread', side: 'home', selection: 'KC -3.5',
      price: -110, modelProbability: 0.585, marketProbability: 0.5238,
      edge: 0.0612, expectedValue: 0.1168, kelly: 0.032,
    }],
  };
}

function quantReaderPool(preview, settledRows) {
  const sql = [];
  const generatedAt = new Date(Date.now() - 1800000).toISOString();
  const obsOpen = new Date(Date.now() - 24 * 3600000).toISOString();
  const obsNow = new Date(Date.now() - 1800000).toISOString();
  const query = async (text) => {
    const q = String(text);
    sql.push(q);
    if (WRITE_SQL.test(q)) throw new Error('refused: SQL mutation requires original writer admission');
    if (/FROM sports_followed_teams/.test(q)) {
      return { rows: [{ league: 'nfl', team: 'KC', team_id: '12', display_name: 'Kansas City Chiefs' }], rowCount: 1 };
    }
    if (/FROM sports_settings/.test(q)) return { rows: [{ settings: { minEdgePoints: 2.5 } }], rowCount: 1 };
    if (/FROM sports_previews/.test(q)) return { rows: [{ payload: preview, generated_at: generatedAt }], rowCount: 1 };
    if (/FROM sports_line_history/.test(q)) {
      return {
        rows: [
          { event_id: preview.eventId, league: 'nfl', book: 'DraftKings', home_spread: -2.5, home_spread_odds: -110, away_spread_odds: -110, home_moneyline: -145, away_moneyline: 124, total: 47.5, first_seen: obsOpen, last_seen: obsOpen, observations: 2 },
          { event_id: preview.eventId, league: 'nfl', book: 'DraftKings', home_spread: -3.5, home_spread_odds: -110, away_spread_odds: -110, home_moneyline: -175, away_moneyline: 148, total: 48.5, first_seen: obsNow, last_seen: obsNow, observations: 3 },
        ],
        rowCount: 2,
      };
    }
    if (/FROM sports_predictions[\s\S]*WHERE settled = TRUE/.test(q)) {
      return {
        rows: settledRows.map((r) => ({
          strategy: r.strategy, won: r.won, brier: r.brier, market_brier: r.marketBrier, clv: r.clv, pnl_units: r.pnlUnits,
        })),
        rowCount: settledRows.length,
      };
    }
    if (/FROM sports_predictions/.test(q)) {
      return {
        rows: [{
          strategy: 'ensemble', league: 'nfl', event_id: preview.eventId, game_date: preview.date,
          home_team: 'KC', away_team: 'BUF', market: 'spread', side: 'home', selection: 'KC -3.5',
          model_prob: 0.585, market_prob: 0.5238, edge: 0.0612, price_at_pick: -110, spread_at_pick: -3.5,
          stake_fraction: 0, settled: false, won: null, brier: null, market_brier: null, clv: null, pnl_units: null,
        }],
        rowCount: 1,
      };
    }
    return { rows: [], rowCount: 0 };
  };
  return { sql, query };
}

function resDouble() {
  const res = { code: 200, body: null, sentFile: null };
  res.status = (c) => { res.code = c; return res; };
  res.setHeader = () => res;
  res.json = (b) => { res.body = b; return res; };
  res.sendFile = (p) => { res.sentFile = p; return res; };
  return res;
}

function getHandler(router, method, route) {
  const hit = router.routes.find((r) => r.method === method && r.route === route);
  assert.ok(hit, `${method.toUpperCase()} ${route} must be mounted`);
  return hit.handler;
}

test('outlier-trimmed robustness separates lucky longshots from durable positive-CLV edge', () => {
  assert.equal(quant.WINNERS_REMOVED, 0.2);

  const small = quant.evaluateLedgerRobustness(makeSettledRows([{ pnl: 1 }, { pnl: 1 }], 3));
  assert.equal(small.verdict, 'TOO_LITTLE_HISTORY');
  assert.equal(small.holdsUp, false);
  assert.equal(small.stakeAllowed, false);

  const luckyWins = [{ pnl: 18, clv: 0.08, brier: 0.06 }, ...Array.from({ length: 9 }, () => ({ pnl: 0.91, clv: 0.02, brier: 0.18 }))];
  const outlierReport = quant.evaluateLedgerRobustness(makeSettledRows(luckyWins, 24));
  assert.ok(outlierReport.full.netUnits > 0, 'full sample looks profitable');
  assert.ok(outlierReport.withoutTopWinners.netUnits < 0, 'removing top 20% winners exposes negative core return');
  assert.equal(outlierReport.removedTopWinners, 2);
  assert.equal(outlierReport.verdict, 'PROMISING_OUTLIER_DEPENDENT');
  assert.equal(outlierReport.holdsUp, false);
  assert.equal(outlierReport.stakeAllowed, false);

  const durableWins = Array.from({ length: 24 }, () => ({ pnl: 0.95, clv: 0.03, brier: 0.17, marketBrier: 0.23 }));
  const durableReport = quant.evaluateLedgerRobustness(makeSettledRows(durableWins, 12));
  assert.equal(durableReport.verdict, 'HOLDS_UP');
  assert.equal(durableReport.holdsUp, true);
  assert.equal(durableReport.stakeAllowed, true);
  assert.ok(durableReport.withoutTopWinners.netUnits > 0);
  assert.ok(durableReport.withoutTopWinners.meanClvPct > 0);
});

test('GET /quant/tonight, /quant/roi, and /quant/game answer numeric quant metrics with zero SQL writes', async () => {
  const preview = storedFixturePreview();
  const settled = makeSettledRows(Array.from({ length: 24 }, () => ({ pnl: 0.95, clv: 0.03, brier: 0.17, marketBrier: 0.23 })), 12);
  const pool = quantReaderPool(preview, settled);
  const router = routes.createSportsEdgeRoutes({ pool, appPackageDir: PKG_DIR });

  const tonightRes = resDouble();
  await getHandler(router, 'get', '/quant/tonight')({ ...PERSON, query: { storedOnly: '1' } }, tonightRes);
  assert.equal(tonightRes.code, 200);
  assert.equal(tonightRes.body.gamesWithEdgeCount, 1);
  assert.equal(tonightRes.body.scorecardGate.verdict, 'HOLDS_UP');
  const g = tonightRes.body.games[0];
  assert.equal(g.matchup, 'BUF @ KC');
  assert.ok(g.bookQuote.moneylineVigPct > 0 && g.bookQuote.spreadVigPct > 0);
  assert.equal(g.topEdge.deVigMarketProbPct, 52.38);
  assert.equal(g.topEdge.modelProbPct, 58.5);
  assert.equal(g.topEdge.edgePct, 6.12);
  assert.equal(g.topEdge.quarterKellyPct, 3.2);
  assert.equal(g.lineMovement.netSpreadMove, 1);

  const roiRes = resDouble();
  await getHandler(router, 'get', '/quant/roi')({ ...PERSON, query: {} }, roiRes);
  assert.equal(roiRes.code, 200);
  assert.equal(roiRes.body.robustness.verdict, 'HOLDS_UP');
  assert.equal(roiRes.body.robustness.winnersRemovedFraction, 0.2);
  assert.equal(roiRes.body.recentPicks.length, 1);

  const gameRes = resDouble();
  await getHandler(router, 'get', '/quant/game')({ ...PERSON, query: { team: 'KC' } }, gameRes);
  assert.equal(gameRes.code, 200);
  assert.equal(gameRes.body.eventId, preview.eventId);
  assert.equal(gameRes.body.registeredCalls.length, 1);

  const cssRes = resDouble();
  const jsRes = resDouble();
  getHandler(router, 'get', '/concierge.css')({}, cssRes);
  getHandler(router, 'get', '/concierge.js')({}, jsRes);
  assert.ok(cssRes.sentFile.endsWith(path.join('tools', 'concierge.css')));
  assert.ok(jsRes.sentFile.endsWith(path.join('tools', 'concierge.js')));
  assert.equal(pool.sql.some((q) => WRITE_SQL.test(q)), false, 'no quant GET may issue a SQL write');
});

test('manifest and persona bind sports-quant and require approval before recording picks', () => {
  const manifest = fs.readFileSync(path.join(PKG_DIR, 'oshal-app.yaml'), 'utf8');
  const persona = fs.readFileSync(path.join(PKG_DIR, 'personas', 'sports-quant.yaml'), 'utf8');
  const html = fs.readFileSync(path.join(PKG_DIR, 'tools', 'sports-edge.html'), 'utf8');
  assert.match(manifest, /^chatBot:\s*sports-quant$/m);
  assert.match(manifest, /name:\s*sports_edge_record_pick[\s\S]*?defaultAuthMode:\s*ask[\s\S]*?requiresApproval:\s*true/);
  assert.match(manifest, /name:\s*sports_edge_tonight[\s\S]*?defaultAuthMode:\s*auto[\s\S]*?requiresApproval:\s*false/);
  assert.match(persona, /^name:\s*sports-quant$/m);
  assert.match(persona, /sports_edge_tonight/);
  assert.match(html, /id="conciergeRail"/);
  assert.match(html, /Which games have edge tonight\?/);
});
