/**
 * Guard for the hand-typed league form on the served surface, tools/fantasy-football.html.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Sweep 7: the league was one unlabelled text box of raw JSON (the concierge could only call it
 *                     |                             | 'an unlabelled text box'). The page's own script, run in a sandbox: every field has a label, the
 *                     |                             | form round-trips the template and an edited league into the document the route validates, a line
 *                     |                             | it cannot read is named before anything is sent, and adding a team keeps what was typed.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Review: Add a team / Remove team redrew the form from the PARSED league, so a scoring line or
 *                     |                             | roster id it could not read, and FAAB spent with a blank budget, vanished without a word; a new
 *                     |                             | team took count+1 as its id, so remove-then-add duplicated an id. Unreadable input now survives
 *                     |                             | both buttons and is named; a new team takes the highest id + 1; spent without a budget is named.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Sweep 9: the template's scoring was the line "0 = 0", which read as clean and saved a league
 *                     |                             | that projected every player 0.0. The template's scoring is empty and names that it needs the
 *                     |                             | league's rules; a table of only 0-point rules is named too. Clean input here types a real rule.
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

/** The page's script in a sandbox; setting mForm's innerHTML materialises its fields as nodes the way a browser would. */
function page() {
  const nodes = {};
  const listeners = {};
  const node = (id) => (nodes[id] = nodes[id] || {
    id, value: '', checked: false, textContent: '', style: {}, getAttribute: () => null, setAttribute() {},
    addEventListener(type, fn) { listeners[id] = fn; }, querySelectorAll: () => [],
    _html: '',
    get innerHTML() { return this._html; },
    set innerHTML(html) { this._html = html; if (id === 'mForm') materialise(html); },
  });
  function materialise(html) {
    for (const m of html.matchAll(/<input id="([^"]+)" type="([^"]+)" value="([^"]*)"/g)) node(m[1]).value = unescape(m[3]);
    for (const m of html.matchAll(/<input type="radio" name="mMine" id="([^"]+)"( checked)?>/g)) node(m[1]).checked = !!m[2];
    for (const m of html.matchAll(/<textarea id="([^"]+)" rows="\d+">([\s\S]*?)<\/textarea>/g)) node(m[1]).value = unescape(m[2]);
    node('mForm').querySelectorAll = () => [...html.matchAll(/data-team-drop="(\d+)"/g)].map((m) => ({
      getAttribute: () => m[1], addEventListener(type, fn) { listeners['drop' + m[1]] = fn; } }));
  }
  const sandbox = {
    document: { getElementById: node, querySelectorAll: () => [], addEventListener() {} },
    console: { log() {}, warn() {}, error() {} },
    fetch: () => new Promise(() => {}),
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(inline(), sandbox, { filename: 'fantasy-football.html' });
  return { sandbox, nodes, listeners };
}
const plain = (v) => JSON.parse(JSON.stringify(v));

test('every field of the league form has its own label, and no raw JSON box is left', () => {
  const p = page();
  p.sandbox.renderManualForm(p.sandbox.MANUAL_TEMPLATE, '');
  const html = p.nodes.mForm.innerHTML;
  const ids = [...html.matchAll(/<(?:input|textarea)[^>]*\sid="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(ids.length >= 16, 'name, season, weeks, FAAB, four lists and two teams of five fields');
  for (const id of ids) assert.match(html, new RegExp(`<label class="mf[^"]*" for="${id}">`), `${id} is labelled`);
  assert.match(html, /Scoring: one rule per line, ESPN stat id = points/);
  assert.match(html, /This is my team/);
  assert.doesNotMatch(HTML, /id="mDoc"|JSON\.stringify\(MANUAL_TEMPLATE/, 'the raw-JSON text box is gone');
});

test('the template and an edited league read back as the document the route validates', () => {
  const p = page();
  p.sandbox.renderManualForm(p.sandbox.MANUAL_TEMPLATE, '');
  const read = p.sandbox.readManualForm();
  assert.deepEqual(plain(read.problems), ['Scoring: enter your league\u2019s scoring, one rule per line as stat id = points (for example 53 = 1).'],
    'a new league starts with no scoring rule and says it needs the league\'s own');
  assert.equal(p.nodes.mScoring.value, '', 'no "0 = 0" placeholder rule');
  const template = plain(p.sandbox.MANUAL_TEMPLATE);
  template.teams.forEach((t) => { t.mine = t.mine === true; });
  assert.deepEqual(plain(read.league), template);
  const league = { name: 'Office "A" league', season: 2026, scoring: [{ statId: 53, points: 1 }, { statId: 3, points: 0.04 }, { statId: 20, points: -2 }],
    slots: [{ slotId: 0, count: 1 }], teams: [{ teamId: 7, name: 'Mine', mine: true, roster: [11, 12], starting: [11] }, { teamId: 9, name: 'Theirs', mine: false, roster: [13], starting: [] }],
    schedule: [{ week: 5, home: 7, away: 9 }, { week: 6, home: 9, away: null }], byes: { 12: 9 }, faab: null, lastWeek: 14, playoffStart: null };
  p.sandbox.renderManualForm(league, 42);
  assert.equal(p.sandbox.manualEditId, '42');
  const back = p.sandbox.readManualForm();
  assert.deepEqual(plain(back.problems), []);
  assert.deepEqual(plain(back.league), plain(league));
});

test('a line the form cannot read is named and nothing is sent', () => {
  const p = page();
  p.sandbox.renderManualForm(p.sandbox.MANUAL_TEMPLATE, '');
  p.nodes.mScoring.value = '53 = 1\npassing yards';
  p.nodes.mRoster0.value = '11, abc';
  const read = p.sandbox.readManualForm();
  assert.deepEqual(plain(read.problems).sort(), ['Scoring line 2 "passing yards" is not written as "stat id = points".',
    'Team 1 roster: "abc" is not an ESPN player id (a whole number).']);
});

test('adding a team keeps what was already typed', () => {
  const p = page();
  p.sandbox.renderManualForm(p.sandbox.MANUAL_TEMPLATE, '');
  p.nodes.mName.value = 'Typed name';
  p.nodes.mRoster0.value = '5, 6';
  p.listeners.mAddTeam();
  const read = p.sandbox.readManualForm();
  assert.equal(read.league.name, 'Typed name');
  assert.deepEqual(plain(read.league.teams[0].roster), [5, 6]);
  assert.equal(read.league.teams.length, 3);
  p.listeners.drop2();
  assert.equal(p.sandbox.readManualForm().league.teams.length, 2);
});

test('adding a team keeps a line the form cannot read, and names it instead of dropping it', () => {
  const p = page();
  p.sandbox.renderManualForm(p.sandbox.MANUAL_TEMPLATE, '');
  p.nodes.mScoring.value = '53 = 1\n42 = 0.04 pts\n0 = -2';
  p.nodes.mRoster0.value = '3139477, 4241389, Mahomes';
  p.nodes.mFaabBudget.value = '';
  p.nodes.mFaabSpent.value = '35';
  p.listeners.mAddTeam();
  assert.equal(p.nodes.mScoring.value, '53 = 1\n42 = 0.04 pts\n0 = -2', 'the unreadable scoring rule is still there');
  assert.equal(p.nodes.mRoster0.value, '3139477, 4241389, Mahomes', 'the unreadable roster id is still there');
  assert.equal(p.nodes.mFaabSpent.value, '35', 'FAAB spent is still there');
  assert.equal(p.nodes.mRoster2.value, '', 'the new team starts empty');
  const note = p.nodes.mNote.textContent;
  assert.match(note, /Scoring line 2 "42 = 0\.04 pts"/);
  assert.match(note, /"Mahomes" is not an ESPN player id/);
  assert.match(note, /FAAB spent/);
  const read = p.sandbox.readManualForm();
  assert.ok(read.problems.some((x) => /FAAB spent/.test(x)), 'Save refuses spent without a budget instead of dropping it');
  p.listeners.drop1();
  assert.equal(p.nodes.mScoring.value, '53 = 1\n42 = 0.04 pts\n0 = -2', 'removing a team keeps it too');
  assert.equal(p.nodes.mRoster0.value, '3139477, 4241389, Mahomes');
});

test('removing a team and adding one gives the new team an id no other team has', () => {
  const p = page();
  p.sandbox.renderManualForm(p.sandbox.MANUAL_TEMPLATE, '');
  p.nodes.mScoring.value = '53 = 1';
  p.listeners.mAddTeam();
  assert.deepEqual(plain(p.sandbox.readManualForm().league.teams.map((t) => t.teamId)), [1, 2, 3]);
  p.listeners.drop1();
  p.listeners.mAddTeam();
  const ids = plain(p.sandbox.readManualForm().league.teams.map((t) => t.teamId));
  assert.deepEqual(ids, [1, 3, 4]);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(p.nodes.mNote.textContent, '', 'clean input names no problem');
});

test('a scoring table of only 0-point rules is named before anything is sent', () => {
  const p = page();
  p.sandbox.renderManualForm(p.sandbox.MANUAL_TEMPLATE, '');
  p.nodes.mScoring.value = '0 = 0\n53 = 0';
  const read = p.sandbox.readManualForm();
  assert.deepEqual(plain(read.problems), ['Scoring: every rule is worth 0 points, so every player would project 0.0. Enter your league\u2019s scoring as stat id = points.']);
  p.nodes.mScoring.value = '0 = 0\n53 = 0.5';
  assert.deepEqual(plain(p.sandbox.readManualForm().problems), [], 'one rule worth points is a scoring table');
});
