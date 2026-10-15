/**
 * Guards for a league whose scoring gives every stat 0 points.
 *
 * Sweep 9 (2026-10-12, phone 412x915): a hand-typed league saved with the form's default scoring line "0 = 0"
 * projected Mahomes, Chase and Lamb at 0.0, and the boards still advised on it: "Your lineup is already the best
 * legal one", "Nobody on the wire improves your starting lineup", "SCORING RULES USED 1". Such a table can rank
 * nobody. The route refuses to save it, and a league already saved that way (or an ESPN league whose scoring reads
 * as all zeros) gets the reason and no numbers on every board, before any projection feed is read. Nothing here
 * says what an ESPN stat id means; the check is only that the league's own table scores something.
 *
 * Real: the compiled router, handlers and the fantasy-leagues ESPN client (fantasy-routes-harness.js). Doubled: the
 * logger, the router, the caller, the broker and the database round trip (an in-memory reading of the store's SQL).
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial: an all-zero or empty scoring table is refused on save (create and replace); a league saved that way earlier answers scoring {ok:false, reason} with no numbers on the lineup, season, waiver and trade boards, records nothing and reads no feed; one rule worth points still prices the league; the page shows the reason on every board.
 */

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { drive, loadRouter, memPool } = require('./fantasy-routes-harness.js');
const { SEASON, manualLeague, publicOnlyEspn } = require('./fantasy-manual-fixture.js');

const ZERO = /scoring gives every stat 0 points \(2 rules\), so every player would project 0\.0/;

/** A router for owner-a with one valid hand-typed league, whose stored scoring the test may then rewrite. */
async function league(scoring) {
  const pool = memPool();
  const { router } = loadRouter({ sub: 'owner-a', secret: null }, pool);
  const created = await drive(router, 'POST /manual-leagues', { body: manualLeague() });
  assert.equal(created.code, 201, JSON.stringify(created.body));
  if (scoring) pool.tables.manual[0].doc.scoring = scoring; // saved before the save refused it
  return { router, pool, query: { manualId: String(created.body.id), season: String(SEASON) } };
}

test('a scoring table that scores nothing is refused on create and on replace, with the reason', async () => {
  const { router, query } = await league();
  const zero = await drive(router, 'POST /manual-leagues', { body: manualLeague({ scoring: [{ statId: 0, points: 0 }, { statId: 53, points: 0 }] }) });
  assert.equal(zero.code, 400, JSON.stringify(zero.body));
  assert.match(JSON.stringify(zero.body), ZERO);
  const replaced = await drive(router, 'PUT /manual-leagues/:id', { params: { id: query.manualId }, body: manualLeague({ scoring: [{ statId: 0, points: 0 }, { statId: 1, points: 0 }] }) });
  assert.equal(replaced.code, 400, JSON.stringify(replaced.body));
  assert.match(JSON.stringify(replaced.body), ZERO);
  const one = await drive(router, 'POST /manual-leagues', { body: manualLeague({ scoring: [{ statId: 0, points: 0 }, { statId: 53, points: 0.5 }] }) });
  assert.equal(one.code, 201, 'one rule worth points is a scoring table');
});

test('a league saved with all-zero scoring gets the reason and no numbers on every board, and nothing is read or recorded', async () => {
  const { router, pool, query } = await league([{ statId: 0, points: 0 }, { statId: 1, points: 0 }]);
  const seen = [];
  for (const key of ['GET /lineup', 'POST /lineup/record', 'GET /season', 'GET /waivers', 'GET /trades']) {
    const res = await drive(router, key, { query }, publicOnlyEspn(4, seen));
    assert.equal(res.code, 200, `${key} ${JSON.stringify(res.body)}`);
    assert.equal(res.body.scoring.ok, false, key);
    assert.match(res.body.scoring.reason, ZERO, key);
    assert.equal(res.body.projectionsAvailable, 0, key);
    assert.equal(res.body.optimal, null, `${key} has no lineup`);
    for (const field of ['total', 'byWeek', 'rows', 'proposals', 'currentTotal']) assert.equal(res.body[field], undefined, `${key} prices nothing (${field})`);
    assert.equal(res.body.team.teamId, 1, `${key} still names the team`);
    assert.equal(res.body.recorded, false, `${key} records nothing`);
  }
  assert.deepEqual(seen.filter((s) => /\/players\?/.test(s.url)), [], 'no projection feed is read for a league that can rank nobody');
  assert.equal(pool.tables.weeks.size, 0, 'no week decision is recorded');
  assert.equal(pool.tables.calls.length, 0, 'no start/sit call is recorded');
});

test('the same league with one rule worth points is priced as before', async () => {
  const { router, query } = await league();
  const res = await drive(router, 'GET /lineup', { query }, publicOnlyEspn(4, []));
  assert.equal(res.code, 200);
  assert.equal(res.body.scoring, undefined);
  assert.ok(res.body.optimal && res.body.optimal.total > 0, 'a real lineup with points');
});

test('the page shows the scoring reason on the lineup and on every board, with no numbers', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'tools', 'fantasy-football.html'), 'utf8');
  const fn = (name) => html.slice(html.indexOf(`function ${name}(`), html.indexOf('\n}\n', html.indexOf(`function ${name}(`)) + 2);
  const nodes = {};
  const el = (id) => (nodes[id] = nodes[id] || { innerHTML: '' });
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const run = new Function('el', 'esc', 'loadFantasyRecord', `${fn('scoringRefusedCard')}\n${fn('boardFeedFailure')}\n${fn('feedFailureCard')}\n`
    + 'return { scoringRefusedCard, boardFeedFailure };')(el, esc, () => {});
  const d = { team: { name: 'Mine' }, league: { week: 4 }, scoring: { ok: false, reason: "this league's scoring gives every stat 0 points (1 rule), so every player would project 0.0." } };
  assert.equal(run.boardFeedFailure(d, 'waiver board'), true);
  assert.match(nodes.lineupBody.innerHTML, /No waiver board can be advised<\/strong>: this league's scoring gives every stat 0 points/);
  assert.doesNotMatch(nodes.lineupBody.innerHTML, /0\.0 points|Nobody on the wire/);
  assert.match(html, /if \(d\.scoring && d\.scoring\.ok === false\) \{ el\('lineupBody'\)\.innerHTML = scoringRefusedCard\(d, 'lineup'\)/,
    'the lineup board takes the same card');
});
