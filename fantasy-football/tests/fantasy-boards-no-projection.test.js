/**
 * Guards for what the Season, Waivers and Trades boards say when there is no projection for the week.
 *
 * Live on 2026-10-11 ESPN's projection feed answered no players on the native kernel (the egress refused the
 * x-fantasy-filter header the paged feed needs). The Lineup board already said so; the other three priced the
 * season from the empty feed and showed it as advice: "SEASON VALUE 0.0", "Nobody on the wire improves your
 * starting lineup over the weeks that remain", and "Weeks 5 priced from their own weekly projection". With no
 * projection the routes now answer projectionFeed {ok:false, reason} and no numbers, and the page says the feed is
 * unavailable and why.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial: /season, /waivers and /trades answer the feed's reason and no numbers when the feed refuses, and still price a league when it answers; the page renders the feed failure on all three boards with no zero value, no "nobody improves" line and no "priced from their own weekly projection" claim.
 */

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { drive, loadRouter, memPool } = require('./fantasy-routes-harness.js');
const { SEASON, manualLeague, publicOnlyEspn } = require('./fantasy-manual-fixture.js');

const BOARDS = ['GET /season', 'GET /waivers', 'GET /trades'];

/** Public ESPN for a hand-typed league whose player feed refuses with HTTP 400 (never retried). */
function feedRefused(currentWeek) {
  const upstream = publicOnlyEspn(currentWeek, []);
  return async (url, init) => (String(url).includes('/players?')
    ? { ok: false, status: 400, json: async () => ({}), text: async () => '' }
    : upstream(url, init));
}

/** A hand-typed league for owner-a, and the router that serves it. */
async function league() {
  const { router } = loadRouter({ sub: 'owner-a', secret: null }, memPool());
  const created = await drive(router, 'POST /manual-leagues', { body: manualLeague() });
  assert.equal(created.code, 201, JSON.stringify(created.body));
  return { router, query: { manualId: String(created.body.id), season: String(SEASON) } };
}

test('NO PROJECTIONS: season, waivers and trades answer the feed\'s reason and no numbers', async () => {
  const { router, query } = await league();
  for (const key of BOARDS) {
    const res = await drive(router, key, { query }, feedRefused(4));
    assert.equal(res.code, 200, `${key} ${JSON.stringify(res.body)}`);
    assert.equal(res.body.projectionFeed.ok, false, key);
    assert.match(res.body.projectionFeed.reason, /HTTP 400/, `${key} carries the client's own reason`);
    assert.equal(res.body.projectionsAvailable, 0, key);
    for (const field of ['total', 'byWeek', 'drop', 'rows', 'streaming', 'proposals', 'weeks']) {
      assert.equal(res.body[field], undefined, `${key} prices nothing from an empty feed (${field})`);
    }
    assert.equal(res.body.team.teamId, 1, `${key} still names the team`);
  }
});

test('with projections the boards still price the league and say where the feed came from', async () => {
  const { router, query } = await league();
  const answers = {};
  for (const key of BOARDS) {
    const res = await drive(router, key, { query }, publicOnlyEspn(4, []));
    assert.equal(res.code, 200, `${key} ${JSON.stringify(res.body)}`);
    assert.equal(res.body.projectionFeed.ok, true, key);
    answers[key] = res.body;
  }
  assert.ok(answers['GET /season'].total > 0);
  assert.ok(answers['GET /waivers'].rows.length > 0);
  assert.ok(Array.isArray(answers['GET /trades'].proposals));
});

/** The page's inline scripts in a DOM double that records element HTML. */
function pageSandbox() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'tools', 'fantasy-football.html'), 'utf8');
  const src = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
  const nodes = {};
  const node = (id) => (nodes[id] = nodes[id] || { innerHTML: '', textContent: '', style: {}, hidden: false, addEventListener() {}, querySelectorAll: () => [], setAttribute() {}, classList: { add() {}, remove() {}, toggle() {} } });
  const sandbox = {
    document: { getElementById: node, querySelectorAll: () => [], addEventListener() {} },
    fetch: () => new Promise(() => {}),
    console: { log() {}, warn() {}, error() {} },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'fantasy-football.html' });
  return { sandbox, nodes };
}

test('the page says the projection feed is unavailable on Season, Waivers and Trades instead of zero advice', () => {
  const { sandbox, nodes } = pageSandbox();
  const reason = "ESPN's player projection feed is unavailable on this installation";
  const body = { team: { name: 'Mine' }, league: { week: 5 }, projectionFeed: { ok: false, source: 'none', reason }, projectionsAvailable: 0 };
  for (const [render, what] of [['renderSeason', 'rest of season'], ['renderWaivers', 'waiver board'], ['renderTrades', 'trade finder']]) {
    sandbox[render](body);
    const shown = nodes.lineupBody.innerHTML;
    assert.match(shown, /The ESPN projection feed is unavailable/, render);
    assert.ok(shown.includes(what), `${render} names its board`);
    assert.ok(shown.includes('player projection feed is unavailable on this installation'), `${render} shows the feed's reason`);
    assert.doesNotMatch(shown, /0\.0|Nobody on the wire|No trade was found|priced from their own weekly projection/, `${render} shows no zero advice`);
  }
});
