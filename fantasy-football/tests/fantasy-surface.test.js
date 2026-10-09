/**
 * Guards for the served surface, tools/fantasy-football.html.
 *
 * The surface is one inline classic <script> in a served HTML file. No compiler parses it and no
 * console reports it, so a syntax error ships green and the page simply never loads; this parses the
 * real script with classic-script grammar. The second half guards the contract between the page and
 * the router: every endpoint the page calls must be one the compiled router actually registers — a
 * page calling a route nobody mounted is a blank panel with a 404 behind it, which looks exactly like
 * "no data".
 *
 * Run from the package root: node --test "tests/*-*.test.js"
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — the fantasy half of sports-edge's surface guards, moved with the page (ADR-146 D1): inline-script parse, LF only, every endpoint the page calls is registered by the compiled router, the credential warning (including that a shared connection is never used), no credential payload built by the page, and the league's own scoring stated.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | 0.2.0: the page's own renderers, run on route-shaped bodies, show a bid and a drop on every waiver row, the streaming lane as this week only, both gains on every trade, and which weeks were priced from a rate; with no ESPN connection the page offers the hand-typed league instead of stopping at the connect card.
 */

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadRouter, memPool } = require('./fantasy-routes-harness.js');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'tools', 'fantasy-football.html'), 'utf8');

/** Every inline (non-src) script in the page, concatenated. */
function inlineScript() {
  return [...HTML.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
}

test('THE INLINE SCRIPT PARSES — no compiler checks it, so this is the only thing that does', () => {
  const src = inlineScript();
  assert.ok(src.length > 2000, 'the page should actually carry its script');
  assert.doesNotThrow(() => new vm.Script(src, { filename: 'fantasy-football.html' }));
});

test('the surface has no CRLF, which the repo stores as LF', () => {
  assert.equal(HTML.includes('\r'), false);
});

test('EVERY ENDPOINT THE PAGE CALLS IS ONE THE ROUTER REGISTERS', () => {
  const { router } = loadRouter({ sub: 'owner-a', secret: null }, memPool());
  const registered = [...router.routes.keys()].map((k) => k.split(' ')[1].split('/').filter(Boolean)[0] || '');
  const called = new Set();
  for (const m of inlineScript().matchAll(/API \+ '\/([a-z0-9_-]+)/gi)) called.add(m[1]);
  assert.ok(called.size >= 4, `expected the page to call several endpoints, saw ${[...called].join(', ')}`);
  for (const seg of called) assert.ok(registered.includes(seg), `the surface calls /${seg} but the router registers no such route`);
});

test('the page WARNS about the credential before anyone pastes an account cookie', () => {
  assert.match(HTML, /account session cookies/i);
  assert.match(HTML, /no OAuth for fantasy/i);
  assert.match(HTML, /sign out of ESPN everywhere/i);
  assert.match(HTML, /shared with your household is never used/i, 'and says a shared connection is not used');
});

test('the surface never asks for a credential itself — pasting happens on the connectors page', () => {
  const src = inlineScript();
  assert.equal(/espn_s2['"]?\s*:/.test(src), false, 'the page must not build a credential payload');
  assert.equal(src.includes('/api/connect/'), false, 'and must not post one either');
});

test('it states that points come from the league\'s own scoring, not a built-in table', () => {
  assert.match(HTML, /your own league rules/i);
});

/** Runs the page's own inline script in a sandbox so its real render functions can be called. */
function pageSandbox() {
  const nodes = {};
  const node = (id) => (nodes[id] = nodes[id] || {
    addEventListener() {}, setAttribute() {}, getAttribute: () => null, querySelectorAll: () => [],
    innerHTML: '', textContent: '', value: '', hidden: false, style: {},
  });
  const sandbox = {
    document: { getElementById: node, querySelectorAll: () => [], addEventListener() {} },
    fetch: () => new Promise(() => {}),
    console: { log() {}, warn() {}, error() {} },
  };
  // The page runs in a browser, where `window` is the global: the head block and the start gate read window.AppView (ADR-164 D6).
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(inlineScript(), sandbox, { filename: 'fantasy-football.html' });
  return { sandbox, nodes };
}

test('THE BOARDS RENDER WHAT THE ROUTES SEND — a bid and a drop per waiver row, both gains per trade, the provenance', () => {
  const { sandbox, nodes } = pageSandbox();
  const head = { team: { name: 'Mine' }, weeks: { fromFeed: [4], fromRate: [5, 6], playoffStart: 6 }, byesKnown: false };
  sandbox.renderWaivers({ ...head, mode: 'faab', budget: 90, cap: 88,
    rows: [{ add: { name: 'Wire Back' }, drop: { name: 'Mine Back Two' }, gain: 36, weeksStarting: 3, scarcity: true, bid: 40 }],
    streaming: [{ add: { name: 'Wire Defence' }, drop: { name: 'Mine Defence' }, gain: 4 }] });
  const waivers = nodes.lineupBody.innerHTML;
  assert.match(waivers, /Wire Back/);
  assert.match(waivers, /Mine Back Two/);
  assert.match(waivers, /\$40/);
  assert.match(waivers, /replacement-level/);
  assert.match(waivers, /this week only/i);
  assert.match(waivers, /weeks 5, 6 from this week.s projection used as a rate, with bye weeks not known/);
  sandbox.renderTrades({ ...head, proposals: [{ teamName: 'Theirs', give: [{ name: 'Mine Receiver' }], get: [{ name: 'Theirs Back Three' }], youGain: 52, themGain: 32 }] });
  const trades = nodes.lineupBody.innerHTML;
  assert.match(trades, /\+52\.0/);
  assert.match(trades, /\+32\.0/, 'their gain is shown — it is the argument that gets a trade accepted');
  sandbox.renderSeason({ ...head, total: 120.5, byWeek: [{}, {}, {}], drop: { name: 'Mine Bench', cost: 0 } });
  assert.match(nodes.lineupBody.innerHTML, /120\.5/);
});

test('with no ESPN connection the page still offers the hand-typed league, not a dead end', () => {
  const { sandbox, nodes } = pageSandbox();
  sandbox.renderFantasyHome({ connected: false, connectHint: 'Connect, or type your league in by hand.', leagues: [], season: 2026 });
  assert.match(nodes.fantasyBody.innerHTML, /id="manualBody"/);
  assert.match(nodes.fantasyBody.innerHTML, /id="lineupBody"/);
});
