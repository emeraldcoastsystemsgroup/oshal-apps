/**
 * Guards for an empty Games list.
 *
 * After following the Dolphins in their bye week the Games screen said only "No games on the
 * schedule for your teams inside the horizon" (the list covers 8 days; their next game was 13 days
 * out), which read as a broken schedule and was blamed on background refresh being off. The list is
 * read live from the schedule; refresh plays no part in it. GET /games now names its window and,
 * when the window is empty but the schedule read succeeded, the next game within 35 days.
 *
 * Plain node, no install: the framework aliases and express are stood in for at module load, and the
 * ESPN scoreboard is a stubbed global fetch.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial: an empty 8-day window answers horizonDays and the next game; a failed schedule read answers no next game; a game inside the window needs no look-ahead read; the page names the window and the next game.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');

/** A minimal Express Router stand-in that records what is mounted. */
function fakeRouter() {
  const routes = [];
  const add = (method) => (route, ...handlers) => { routes.push({ method, route, handler: handlers[handlers.length - 1] }); };
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
const load = Module._load;
Module._load = function stubbed(request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  return load.call(this, request, ...rest);
};
const routes = require('../routes/sports-routes.js');

/** A pool where the caller follows the Dolphins and no preview is stored. */
function followingPool() {
  return { query: async (text) => (/FROM sports_followed_teams/.test(String(text))
    ? { rows: [{ league: 'nfl', team: 'MIA', team_id: '15', display_name: 'Miami Dolphins' }], rowCount: 1 }
    : { rows: [], rowCount: 0 }) };
}

/** Call GET /games as a signed-in person with ESPN answering every month with `events`. */
async function games(events, { fail = false } = {}) {
  const router = routes.createSportsEdgeRoutes({ pool: followingPool(), appPackageDir: path.join(__dirname, '..') });
  const handler = router.routes.find((r) => r.method === 'get' && r.route === '/games').handler;
  const saved = global.fetch;
  let reads = 0;
  global.fetch = async () => {
    reads += 1;
    if (fail) return { ok: false, status: 503, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ events }) };
  };
  try {
    let body = null;
    const res = { statusCode: 200, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(b) { body = b; return this; } };
    await handler({ oidc: { isAuthenticated: () => true, user: { sub: 'fan' } }, query: {}, headers: {} }, res);
    return { status: res.statusCode, body, reads };
  } finally {
    global.fetch = saved;
  }
}

const at = (days) => new Date(Date.now() + days * 86400000).toISOString();
const event = (id, date, home, away) => ({ id, date, name: id, competitions: [{ competitors: [
  { homeAway: 'home', team: { id: '1', abbreviation: home } }, { homeAway: 'away', team: { id: '2', abbreviation: away } }] }] });

test('a bye week answers the window and the next game instead of a bare empty list', async () => {
  const { status, body } = await games([event('played', at(-1), 'MIA', 'CIN'), event('next', at(13), 'NYJ', 'MIA'), event('other', at(2), 'KC', 'LV')]);
  assert.equal(status, 200);
  assert.deepEqual(body.games, []);
  assert.equal(body.upstreamOk, true);
  assert.equal(body.horizonDays, 8);
  assert.equal(body.nextGameLookaheadDays, 35);
  assert.equal(body.nextGame && body.nextGame.eventId, 'next');
  assert.equal(body.nextGame.awayTeam, 'MIA');
});

test('a failed schedule read names no next game', async () => {
  const { body } = await games([], { fail: true });
  assert.equal(body.upstreamOk, false);
  assert.equal(body.nextGame, null);
});

test('a game inside the window is listed and needs no look-ahead read', async () => {
  const inside = await games([event('soon', at(3), 'MIA', 'BUF')]);
  assert.deepEqual(inside.body.games.map((g) => g.game.eventId), ['soon']);
  assert.equal(inside.body.nextGame, null);
  const empty = await games([]);
  assert.ok(inside.reads < empty.reads, `the look-ahead read only happens for an empty window (${inside.reads} vs ${empty.reads})`);
});

test('the page names the window and the next game', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'tools', 'sports-edge.html'), 'utf8');
  const start = html.indexOf('function emptyGamesText(');
  let depth = 0, end = -1;
  for (let i = html.indexOf('{', start); i < html.length; i += 1) {
    if (html[i] === '{') depth += 1;
    if (html[i] === '}' && --depth === 0) { end = i + 1; break; }
  }
  const ctx = {};
  vm.runInNewContext(`${html.slice(start, end)}; this.text = emptyGamesText;`, ctx);
  const next = ctx.text({ horizonDays: 8, nextGameLookaheadDays: 35, nextGame: { awayTeam: 'MIA', homeTeam: 'NYJ', date: '2026-10-25T17:00:00Z' } });
  assert.match(next, /^No games for your teams in the next 8 days\. Next: MIA @ NYJ, /);
  assert.equal(ctx.text({ horizonDays: 8, nextGameLookaheadDays: 35, nextGame: null }),
    'No games for your teams in the next 8 days. None is scheduled in the next 35 days either.');
  assert.doesNotMatch(html, /inside the horizon/);
});
