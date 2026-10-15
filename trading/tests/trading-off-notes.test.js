/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Sweep 14: the Earnings rules panel showed "⚠ TRADING_EVENT_PLANS is off on this server — the
 *   trading-events leg does not act ...", an environment-variable name. The SHIPPED compiled watcherPosture (the note every
 *   earnings-rule response carries, which the panel shows) is run with the platform imports stood in, for the leg off and the
 *   watcher off: each note says in words what is off and that an administrator turns it on, with no variable name. The
 *   event-plan route's armed-plan note is held to the same rule.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const ROUTES = path.join(__dirname, '..', 'routes');
const silent = { info() {}, warn() {}, error() {}, debug() {}, child() { return silent; } };
/** An environment-variable name as a person would see it: two or more upper-case words joined by underscores. */
const ENV_NAME = /\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+\b/;

/** Load the shipped earnings-rule module with the platform imports stood in and the two gates as given. */
function shippedPosture(legOn, watcherOn) {
  const stands = {
    '@/shared/logger': { createChildLogger: () => silent },
    '@/app/trading-event-plans': { eventPlansEnabled: () => legOn },
    '@/app/trading-earnings-rules': { earningsRulesEnabled: () => watcherOn },
  };
  const proxy = (request) => new Proxy(stands[request] || {}, { get: (t, k) => (k in t ? t[k] : k === '__esModule' ? true : () => undefined) });
  const original = Module._load;
  Module._load = function load(request, ...rest) {
    if (request.startsWith('@/') || request === './trading-manual-order-routes') return proxy(request);
    return original.call(this, request, ...rest);
  };
  try {
    const file = path.join(ROUTES, 'trading-earnings-rule-routes.js');
    delete require.cache[file];
    return require(file).watcherPosture();
  } finally {
    Module._load = original;
  }
}

test('the earnings watcher notes say in words what is off, never a variable name', () => {
  const leg = shippedPosture(false, true);
  assert.equal(leg.enabled, false);
  assert.equal(leg.note, 'Event trading is switched off on this installation, so the earnings watcher never runs. An administrator turns event trading on.');
  const watcher = shippedPosture(true, false);
  assert.equal(watcher.note, 'Earnings rules are switched off on this installation: the rule is saved and armed, but nothing reads SEC filings for it until an administrator turns earnings rules on.');
  for (const note of [leg.note, watcher.note]) assert.doesNotMatch(note, ENV_NAME);
  assert.deepEqual(shippedPosture(true, true), { enabled: true, note: null });
});

test('the armed event-plan note names no variable either', () => {
  const route = fs.readFileSync(path.join(ROUTES, 'trading-event-plan-routes.js'), 'utf8');
  const note = route.match(/const EXECUTOR_OFF_NOTE = '([^']*)'/);
  assert.ok(note, 'the shipped route declares its armed-plan note');
  assert.doesNotMatch(note[1], ENV_NAME);
  assert.match(note[1], /^Event trading is switched off on this installation/);
});
