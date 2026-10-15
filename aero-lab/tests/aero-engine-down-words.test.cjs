/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Demo sweep 1: with no engine the page showed the person the host's install command. The shipped page's engineMissing/errText run over the routes' no-engine answers: one plain sentence, never an address, setting or install command; a module mid-upgrade is still the engine's own sentence.
 * -----------------------------------------------------------------------------
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const script = fs.readFileSync(path.join(__dirname, '..', 'tools', 'aero-lab.js'), 'utf8');
const HINT = 'on the kernel host run aero-lab/engine/install-engine.sh and pin the engine in OSHAL_PACKAGE_ENGINES';
const DOWN = 'the kernel could not reach the engine container (unavailable: no engine is configured for this application)';

/** The page's ENGINE_DOWN, engineMissing and errText, sliced from the shipped script. */
function surface() {
  const from = script.indexOf('  const ENGINE_DOWN');
  const to = script.indexOf('    if (err.status === 400)', from);
  assert.ok(from > 0 && to > from, 'the page has the engine-down words and errText');
  return new Function(script.slice(from, to) + '  return b; }\n  return { ENGINE_DOWN, engineMissing, errText };')();
}

test('a missing engine is one plain sentence, never the install command', () => {
  const { ENGINE_DOWN, errText } = surface();
  const shown = errText({ status: 503, body: { code: 'capability_unavailable', error: DOWN, reason: `${DOWN} — install or rebuild it: ${HINT}` } });
  assert.equal(shown, ENGINE_DOWN);
  assert.match(shown, /^Aero Lab's engine is not answering on this installation/);
  assert.doesNotMatch(shown, /install-engine|OSHAL_|kernel host|container|README/);
});

test('a module mid-upgrade is still the engine\'s own sentence', () => {
  const { errText } = surface();
  const reason = 'hybrid module not importable in the engine tree (in-flight upgrade) - set buoyancy_fraction to 0';
  assert.equal(errText({ status: 503, body: { code: 'capability_unavailable', error: reason, reason } }), 'Engine module not available yet: ' + reason);
});
