/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Sweep 6, two surface defects, run against the shipped code:
 *                     |                             | adopt() (tools/animatronics.js) now keeps the rig list entry in
 *                     |                             | step with the rig it adopts, so a rename shows in the list; and
 *                     |                             | the build note's text reader (tools/animatronics.html) keeps the
 *                     |                             | power panel's lines apart ("... headroom 89 % — okall servos
 *                     |                             | stalled would draw 10.4 A" before) and reads the supply budget
 *                     |                             | grid as "label: value".
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const js = fs.readFileSync(path.join(__dirname, '..', 'tools', 'animatronics.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'tools', 'animatronics.html'), 'utf8');

/** The shipped adopt() over a given state. */
function loadAdopt(state) {
  const start = js.indexOf('  function adopt(res) {');
  const end = js.indexOf('\n  }\n', start);
  assert.ok(start > 0 && end > start, 'adopt() is in the surface');
  return new Function('state', js.slice(start, end + 4) + '\nreturn adopt;')(state);
}

/** The shipped build-note text reader over a stub document. */
function loadTxt(nodes) {
  const a = html.indexOf('/* build-note-text:start */');
  const b = html.indexOf('/* build-note-text:end */');
  assert.ok(a > 0 && b > a, 'the build note text reader is marked in the page');
  const document = { getElementById: (id) => nodes[id] || null };
  return new Function('document', html.slice(a, b) + '\nreturn txt;')(document);
}

const node = (tagName, textContent, children = []) => ({ tagName, textContent, children });
const parent = (tagName, children) => node(tagName, children.map((c) => c.textContent).join(''), children);

test('adopting a renamed rig updates its rig list entry and leaves the others', () => {
  const rig = (id, title) => ({ rig_id: id, title, armed: false, rig: { channels: [1, 2] }, updated_at: 't0' });
  const state = { rigs: [rig('a', 'Talking skull'), rig('b', 'Raven')], rig: rig('a', 'Talking skull'), frames: null, runs: [] };
  const adopt = loadAdopt(state);
  adopt({ rig: { ...rig('a', 'sweep6-skull'), updated_at: 't1', current_pose: {} } });
  assert.equal(state.rigs[0].title, 'sweep6-skull', 'the list shows the new title');
  assert.equal(state.rigs[1].title, 'Raven');
  assert.equal(state.rig.title, 'sweep6-skull');
  assert.equal(state.lastSeen, 't1');
});

test('adopting a rig the list does not hold adds nothing to the list', () => {
  const state = { rigs: [], rig: null, frames: null, runs: [] };
  loadAdopt(state)({ rig: { rig_id: 'x', title: 'New', updated_at: 't', current_pose: {} } });
  assert.deepEqual(state.rigs, []);
});

test('the build note keeps the power panel lines apart and reads the budget grid', () => {
  const power = parent('DIV', [
    parent('DIV', [node('B', 'Supply '), node('#text', '5 V / 3 A (bench) — idle 0.1 A, headroom 89 % — '), node('SPAN', 'ok')]),
    node('DIV', 'all servos stalled would draw 10.4 A'),
  ]);
  const budget = parent('DIV', [node('B', 'supply'), node('SPAN', '5 V / 3 A bench'), node('B', 'verdict'), node('SPAN', 'ok'), node('B', ''), node('SPAN', 'a note')]);
  // Element children only, as the DOM's .children gives (text nodes are not elements).
  power.children[0].children = power.children[0].children.filter((c) => c.tagName !== '#text');
  const txt = loadTxt({ power, budget, verdict: node('DIV', 'ok — 320 ms'), 'rig-title': { tagName: 'INPUT', value: '  Talking   skull ' } });
  assert.equal(txt('power'), 'Supply 5 V / 3 A (bench) — idle 0.1 A, headroom 89 % — ok; all servos stalled would draw 10.4 A');
  assert.equal(txt('budget'), 'supply: 5 V / 3 A bench; verdict: ok; a note');
  assert.equal(txt('verdict'), 'ok — 320 ms');
  assert.equal(txt('rig-title'), 'Talking skull');
  assert.equal(txt('missing'), '');
});
