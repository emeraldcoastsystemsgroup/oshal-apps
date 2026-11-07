/**
 * Guard for the UX audit's P0 SPLIT of tools/fantasy-football.html (2026-11-06): "This week" is the home and the
 * league setup is its own view.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | UX audit P0 (fantasy-football--fantasy-football, grade D): the 900px setup
 *                     |                             | form stayed open on the main screen and pushed the Lineup, Waivers and
 *                     |                             | Trades boards below y=1,280. The page's own script in a sandbox: with a
 *                     |                             | saved league it opens This week on that league's Lineup with setup hidden;
 *                     |                             | with none it opens League setup with the walkthrough; the walkthrough
 *                     |                             | shows one group per step with Back/Continue and keeps what was typed;
 *                     |                             | roster slots read as positions; the ESPN cookie steps are withheld where
 *                     |                             | they can never work; the in-page title and tagline are gone.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Trial walk: after Save league This week stayed empty (the saved league
 *                     |                             | already matched the board on record, so no board was built). Saving now
 *                     |                             | opens that league's Lineup; a slow board answering after another board
 *                     |                             | was chosen no longer replaces it.
 */

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'tools', 'fantasy-football.html'), 'utf8');
const inline = () => [...HTML.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
const unescape = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const tick = () => new Promise((r) => setImmediate(r));

/** The page in a sandbox: innerHTML materialises ids, `hidden` attributes and field values the way a browser would. */
function page({ manual = [] } = {}) {
  const nodes = {};
  const listeners = {};
  const calls = [];
  const node = (id) => (nodes[id] = nodes[id] || {
    id, value: '', checked: false, textContent: '', hidden: false, style: {}, disabled: false,
    getAttribute: () => null, setAttribute() {}, querySelectorAll: () => [],
    addEventListener(type, fn) { listeners[id] = fn; },
    _html: '',
    get innerHTML() { return this._html; },
    set innerHTML(html) { this._html = html; materialise(html); },
  });
  function materialise(html) {
    for (const m of html.matchAll(/<(\w+) [^>]*?id="([^"]+)"([^>]*)>/g)) {
      const n = node(m[2]);
      n.hidden = /\shidden(\s|$|>)/.test(m[0]);
    }
    for (const m of html.matchAll(/<input id="([^"]+)" type="([^"]+)" value="([^"]*)"/g)) node(m[1]).value = unescape(m[3]);
    for (const m of html.matchAll(/<input type="radio" name="mMine" id="([^"]+)"( checked)?>/g)) node(m[1]).checked = !!m[2];
    for (const m of html.matchAll(/<textarea id="([^"]+)" rows="\d+">([\s\S]*?)<\/textarea>/g)) node(m[1]).value = unescape(m[2]);
  }
  const sandbox = {
    document: { getElementById: node, querySelectorAll: () => [], addEventListener() {} },
    console: { log() {}, warn() {}, error() {} },
    fetch: (url, init = {}) => {
      calls.push({ url, method: init.method || 'GET' });
      if (/\/manual-leagues$/.test(url) && (init.method || 'GET') === 'GET') {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ leagues: manual }) });
      }
      return new Promise(() => {});
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(inline(), sandbox, { filename: 'fantasy-football.html' });
  return { sandbox, nodes, listeners, calls };
}

test('with a saved league the page opens on This week, that league\'s Lineup, with setup out of the way', async () => {
  const p = page({ manual: [{ id: 'L7', name: 'Office league', season: 2026 }] });
  p.sandbox.renderFantasyHome({ connected: false, credentialSupported: false, leagues: [], season: 2026 });
  await tick(); await tick();
  assert.equal(p.nodes.weekView.hidden, false, 'This week is shown');
  assert.equal(p.nodes.setupView.hidden, true, 'League setup is its own view, hidden');
  assert.equal(p.nodes.mFormWrap.hidden, true, 'the setup form is closed once a league exists');
  assert.match(p.nodes.fLeagueSel.innerHTML, /<option value="manual\|2026\|L7">2026 · Office league \(typed in\)<\/option>/);
  assert.ok(p.calls.some((c) => c.method === 'POST' && /\/lineup\/record$/.test(c.url)), 'the Lineup board is built at once');
  assert.equal(p.sandbox.shownKind, 'lineup');
  const week = p.nodes.fantasyBody.innerHTML.split('<section id="setupView"')[0];
  for (const k of ['Lineup', 'Season', 'Waivers', 'Trades']) assert.match(week, new RegExp(`data-kind="${k.toLowerCase()}" aria-pressed="(true|false)">${k}<`));
  assert.match(week, /id="lineupBody"[\s\S]*Advice only: nothing is changed on ESPN for you\./, 'one meta line under the board');
  assert.match(week, /id="fToSetup">League setup</);
});

test('with no league the page opens League setup with the walkthrough on its first step', async () => {
  const p = page();
  p.sandbox.renderFantasyHome({ connected: false, credentialSupported: false, leagues: [], season: 2026 });
  await tick(); await tick();
  assert.equal(p.nodes.setupView.hidden, false);
  assert.equal(p.nodes.weekView.hidden, true);
  assert.equal(p.nodes.mFormWrap.hidden, false, 'first run: the walkthrough is open');
  assert.match(p.nodes.mForm.innerHTML, /Step 1 of 5 &middot; League/);
  assert.ok(!p.calls.some((c) => /\/lineup/.test(c.url)), 'no board is built for a league that does not exist');
});

test('the walkthrough shows one group per step, keeps what was typed, and saves only on the last step', () => {
  const p = page();
  p.sandbox.renderManualForm(p.sandbox.MANUAL_TEMPLATE, '');
  const shown = () => [...p.nodes.mForm.innerHTML.matchAll(/<section class="mstep" data-step="(\d)" aria-label="([^"]+)"( hidden)?>/g)]
    .filter((m) => !m[3]).map((m) => m[2]);
  assert.deepEqual(shown(), ['League']);
  assert.match(p.nodes.mForm.innerHTML, /id="mNext">Continue</);
  assert.doesNotMatch(p.nodes.mForm.innerHTML, /id="mSave"/);
  p.nodes.mName.value = 'Typed name';
  p.listeners.mNext();
  assert.deepEqual(shown(), ['Scoring']);
  assert.match(p.nodes.mForm.innerHTML, /id="mBack">Back</);
  p.nodes.mScoring.value = '53 = 1';
  p.listeners.mNext(); p.listeners.mNext(); p.listeners.mNext();
  assert.deepEqual(shown(), ['Teams']);
  assert.match(p.nodes.mForm.innerHTML, /id="mSave">Save league</);
  assert.doesNotMatch(p.nodes.mForm.innerHTML, /id="mNext"/);
  p.listeners.mBack();
  assert.deepEqual(shown(), ['Schedule']);
  const read = p.sandbox.readManualForm();
  assert.equal(read.league.name, 'Typed name', 'a value typed on step 1 survives the steps');
  assert.deepEqual(JSON.parse(JSON.stringify(read.league.scoring)), [{ statId: 53, points: 1 }]);
  assert.match(p.nodes.mForm.innerHTML, /class="mbar"/, 'Back and Continue sit in the bottom bar');
});

test('roster slots read as positions and are stored as ESPN slot ids', () => {
  const p = page();
  p.sandbox.renderManualForm(p.sandbox.MANUAL_TEMPLATE, '');
  assert.equal(p.nodes.mSlots.value, 'QB x 1\nRB x 2\nWR x 2\nFLEX x 1');
  assert.deepEqual(JSON.parse(JSON.stringify(p.sandbox.readManualForm().league.slots)),
    [{ slotId: 0, count: 1 }, { slotId: 2, count: 2 }, { slotId: 4, count: 2 }, { slotId: 23, count: 1 }]);
  p.nodes.mSlots.value = 'te x 1\nDST x 1\nK x 1\n20 x 6\nXYZ x 1';
  const read = p.sandbox.readManualForm();
  assert.deepEqual(JSON.parse(JSON.stringify(read.league.slots)), [{ slotId: 6, count: 1 }, { slotId: 16, count: 1 }, { slotId: 17, count: 1 }, { slotId: 20, count: 6 }]);
  assert.ok(read.problems.includes('Starting slots: "XYZ" is not a position (QB, RB, WR, TE, FLEX, D/ST, K, ...).'));
});

test('the ESPN cookie steps are withheld where this installation cannot send them, and kept where it can', () => {
  const p = page();
  assert.equal(p.sandbox.connectCard({ credentialSupported: false, connectHint: 'cannot send cookies' }), '');
  assert.match(p.sandbox.connectCard({ credentialSupported: true }), /account session cookies/);
});

test('the in-page title and tagline are gone (the shell names the app)', () => {
  assert.doesNotMatch(HTML, /<h1>Fantasy Football<\/h1>/);
  assert.doesNotMatch(HTML, /advice, never an automatic change/);
});

test('saving a league opens This week on that league\'s Lineup (the board used to stay empty after Save)', async () => {
  const p = page({ manual: [{ id: 'L1', name: 'Old league', season: 2026 }, { id: 'L9', name: 'New league', season: 2026 }] });
  p.sandbox.renderFantasyHome({ connected: false, credentialSupported: false, leagues: [], season: 2026 });
  await tick(); await tick();
  p.calls.length = 0;
  p.sandbox.loadManual({ source: 'manual', id: 'L9' });
  await tick(); await tick();
  assert.equal(p.nodes.fLeagueSel.value, 'manual|2026|L9', 'the saved league is the one selected');
  assert.ok(p.calls.some((c) => c.method === 'POST' && /\/lineup\/record$/.test(c.url)), 'its Lineup board is built');
  assert.equal(p.nodes.weekView.hidden, false);
});

test('a slow board that answers after another board was chosen does not replace it', async () => {
  const p = page();
  const pending = [];
  p.sandbox.fetch = (url, init = {}) => new Promise((resolve) => pending.push({ url, resolve }));
  p.sandbox.loadBoard('manual', '2026', 'L1', 'lineup');
  p.sandbox.loadBoard('manual', '2026', 'L1', 'waivers');
  const reply = (body) => ({ ok: true, status: 200, json: async () => body });
  const head = { team: { name: 'Mine' }, weeks: { fromFeed: [9], fromRate: [] }, byesKnown: true };
  pending[1].resolve(reply({ ...head, mode: 'priority', rows: [], streaming: [] }));
  await tick(); await tick();
  assert.match(p.nodes.lineupBody.innerHTML, /Waiver board/);
  pending[0].resolve(reply({ ...head, scoring: { ok: false, reason: 'late lineup' } }));
  await tick(); await tick();
  assert.match(p.nodes.lineupBody.innerHTML, /Waiver board/, 'the late Lineup answer is dropped');
});
