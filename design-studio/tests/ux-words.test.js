/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (design-studio--design-studio): a product page showed four primary buttons at once, offered 'Close the phase' on phases with no engine, and printed a raw route ('/api/embodied/physics/reports: the physics engine is unavailable') in a card. The shipped stages and screens modules in a sandbox: failures read in words with what to do and no route; a reasoned phase is closed with Mark done by hand; onePrimary keeps btn-primary only on the next open phase.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const TOOLS = path.join(__dirname, '..', 'tools');
function load(file, key) {
  const sandbox = { window: {}, document: { getElementById: () => null }, fetch: async () => ({}) };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(TOOLS, file), 'utf8'), sandbox, { filename: file });
  return sandbox.window[key];
}
const S = load('design-studio-stages.js', 'DesignStudioStages');
const V = load('design-studio-screens.js', 'DesignStudioScreens');

test('an absent or failed engine is said in words, never as a route path', () => {
  const absent = S.absence({ status: 404, url: '/api/embodied/physics/reports?x=1', error: 'not found' }, 'embodied');
  assert.equal(absent.kind, 'absent');
  assert.equal(absent.line, 'no engine on this swarm for this phase (embodied is not installed or not answering here)');
  const failed = S.absence({ status: 503, url: '/api/embodied/physics/reports', error: 'the physics engine is unavailable' }, 'embodied');
  assert.equal(failed.kind, 'failed');
  assert.match(failed.line, /^embodied is not working on this installation right now: the physics engine is unavailable\. Try again later/);
  for (const r of [absent, failed]) assert.doesNotMatch(r.line, /\/api\//);
});

test('a phase no engine measures is closed by hand, said as such', () => {
  const v = S.phaseView({ brief: {} }, { kind: 'mechanical', engine: 'reasoned' }, { reads: {} }, {}, [], { produces: 'a mechanical spec' });
  assert.equal(v.stage, 'reasoned');
  assert.equal(v.action.label, 'Mark done by hand');
  assert.equal(v.action.byHand, true);
});

test('one primary on a product page: the next open phase', () => {
  const button = (id, text) => { const cls = new Set(['btn', 'btn-primary']); return { id, textContent: text, classList: { remove: (c) => cls.delete(c), contains: (c) => cls.has(c) } }; };
  const buttons = [button('act-brief', 'Edit the brief'), button('act-design', 'Close the phase'), button('act-mechanical', 'Mark done by hand'), button('act-fabricate', 'Make the print set')];
  const host = { querySelectorAll: () => buttons };
  V.onePrimary(host, [
    { entry: { kind: 'brief' }, closure: { stale: false } },
    { entry: { kind: 'design' }, closure: null },
    { entry: { kind: 'mechanical' }, closure: null },
    { entry: { kind: 'fabricate' }, closure: null },
  ]);
  assert.deepEqual(buttons.filter((b) => b.classList.contains('btn-primary')).map((b) => b.id), ['act-design']);
});
