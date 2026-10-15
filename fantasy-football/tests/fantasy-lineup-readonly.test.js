/**
 * Guards for where the lineup may write, and for what it says when there are no projections.
 *
 * The native kernel admits a package GET as a READER and refuses any SQL write it makes ("SQL
 * mutation requires original writer admission"). GET /lineup used to grade the due weeks, register
 * the start/sit calls and the week's decision, and refresh the projection cache, so every lineup
 * answered 502 "could not build the lineup" live on 2026-10-11, for typed-in and saved leagues alike.
 * GET now computes the advice and writes nothing; POST /lineup/record grades and records.
 *
 * The same day the projection feed answered no players (the client reported the failure through
 * onError and returned an empty feed), and the lineup was built from zero-point projections and shown
 * as real. With no projection the body now carries projectionFeed {ok:false, reason} and no numbers.
 *
 * The pool here is a reader double over the harness's in-memory store: once the league exists, every
 * write statement is refused exactly the way the kernel refuses it for a GET.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial: GET /lineup answers 200 under a pool that refuses writes and still weighs the completed weeks the feed carried; POST /lineup/record is mounted and records; an unavailable feed answers its reason with no lineup numbers and records nothing; the page posts the lineup board and renders the feed failure.
 */

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { drive, loadRouter, memPool } = require('./fantasy-routes-harness.js');
const { SEASON, manualLeague, publicOnlyEspn } = require('./fantasy-manual-fixture.js');

const WRITE = /^\s*(INSERT|UPDATE|DELETE)\b/i;

/** The harness store behind a switch: once `readOnly` is set, every write is refused as the kernel does. */
function switchablePool() {
  const inner = memPool();
  const pool = Object.create(inner);
  pool.readOnly = false;
  pool.refused = [];
  pool.query = async (text, params) => {
    if (pool.readOnly && WRITE.test(String(text))) {
      pool.refused.push(String(text));
      throw new Error('refused: SQL mutation requires original writer admission');
    }
    return inner.query(text, params);
  };
  return pool;
}

/** A hand-typed league for owner-a, created while the pool still accepts writes. */
async function leagueFor(pool) {
  const { router } = loadRouter({ sub: 'owner-a', secret: null }, pool);
  const created = await drive(router, 'POST /manual-leagues', { body: manualLeague() });
  assert.equal(created.code, 201, JSON.stringify(created.body));
  return { router, id: String(created.body.id) };
}

/** Public ESPN for a hand-typed league whose player feed refuses with HTTP 400 (never retried). */
function feedRefused(currentWeek) {
  const upstream = publicOnlyEspn(currentWeek, []);
  return async (url, init) => (String(url).includes('/players?')
    ? { ok: false, status: 400, json: async () => ({}), text: async () => '' }
    : upstream(url, init));
}

test('GET /lineup is a pure read: 200 under a pool that refuses every write, and nothing recorded', async () => {
  const pool = switchablePool();
  const { router, id } = await leagueFor(pool);
  pool.readOnly = true;
  const res = await drive(router, 'GET /lineup', { query: { manualId: id, season: String(SEASON) } }, publicOnlyEspn(5, []));
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.deepEqual(pool.refused, [], 'a GET issues no write at all');
  assert.equal(res.body.recorded, false);
  assert.equal(res.body.projectionFeed.ok, true);
  assert.ok(res.body.optimal.starters.length > 0);
  assert.ok(res.body.optimal.starters.some((s) => (s.player.pointsHistory || []).length > 0),
    'the completed weeks the feed carried are weighed in memory, not dropped for want of a write');
  assert.equal(pool.tables.weeks.size, 0);
  assert.equal(pool.tables.calls.length, 0);
});

test('POST /lineup/record grades and records the week and its calls', async () => {
  const pool = switchablePool();
  const { router, id } = await leagueFor(pool);
  const res = await drive(router, 'POST /lineup/record', { body: { manualId: id, season: SEASON } }, publicOnlyEspn(4, []));
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.equal(res.body.recorded, true);
  assert.ok(pool.tables.weeks.get(`owner-a:${SEASON}:manual:${id}:4`), 'the week is recorded');
  assert.ok(pool.tables.calls.length > 0, 'and its start/sit calls');
});

test('NO PROJECTIONS: the lineup answers the feed\'s reason and no numbers, and records nothing', async () => {
  const pool = switchablePool();
  const { router, id } = await leagueFor(pool);
  for (const [key, req] of [['GET /lineup', { query: { manualId: id, season: String(SEASON) } }],
    ['POST /lineup/record', { body: { manualId: id, season: SEASON } }]]) {
    const res = await drive(router, key, req, feedRefused(4));
    assert.equal(res.code, 200, `${key} ${JSON.stringify(res.body)}`);
    assert.equal(res.body.projectionFeed.ok, false, key);
    assert.match(res.body.projectionFeed.reason, /HTTP 400/, `${key} carries the client's own reason`);
    assert.equal(res.body.optimal, null, `${key} builds no lineup from zero-point projections`);
    assert.equal(res.body.projectionsAvailable, 0);
    assert.equal(res.body.recorded, false);
  }
  assert.equal(pool.tables.weeks.size, 0, 'a decision made without projections is never recorded');
  assert.equal(pool.tables.calls.length, 0);
});

/** The page's inline script in a DOM double that records element HTML and every fetch. */
function pageSandbox() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'tools', 'fantasy-football.html'), 'utf8');
  const src = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
  const nodes = {};
  const fetches = [];
  const node = (id) => (nodes[id] = nodes[id] || { innerHTML: '', textContent: '', style: {}, hidden: false, addEventListener() {}, querySelectorAll: () => [], setAttribute() {}, classList: { add() {}, remove() {}, toggle() {} } });
  const sandbox = {
    document: { getElementById: node, querySelectorAll: () => [], addEventListener() {} },
    fetch: (url, init) => { fetches.push({ url: String(url), method: (init && init.method) || 'GET', body: init && init.body }); return new Promise(() => {}); },
    console: { log() {}, warn() {}, error() {} },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'fantasy-football.html' });
  return { sandbox, nodes, fetches };
}

test('the page posts the lineup board to /lineup/record and renders a feed failure instead of numbers', () => {
  const { sandbox, nodes, fetches } = pageSandbox();
  fetches.length = 0;
  sandbox.loadBoard('manual', '2026', '7', 'lineup');
  const call = fetches.find((f) => /\/lineup/.test(f.url));
  assert.ok(call, 'the lineup board fetches');
  assert.equal(call.method, 'POST');
  assert.match(call.url, /\/lineup\/record$/);
  assert.deepEqual(JSON.parse(call.body), { manualId: '7', season: 2026 });
  sandbox.renderLineup({ team: { name: 'Mine' }, league: { week: 4 }, matchup: { opponentName: 'Theirs' }, optimal: null,
    projectionFeed: { ok: false, source: 'none', reason: 'package sandbox has no outbound network' }, projectionsAvailable: 0 });
  const shown = nodes.lineupBody.innerHTML;
  assert.match(shown, /Projections are unavailable/);
  assert.match(shown, /package sandbox has no outbound network/);
  assert.doesNotMatch(shown, /Recommended lineup|0\.0/, 'no zero-point lineup is shown');
});
