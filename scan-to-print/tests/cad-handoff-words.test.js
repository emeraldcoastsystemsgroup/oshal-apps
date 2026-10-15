/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Demo sweep 1: a failed Open in CAD Studio toasted the host's install command. The shipped page's cadRefusal runs over CAD Studio's no-engine answer and a modelling refusal: one plain sentence for a missing engine, never an address, setting or install command; CAD Studio's own sentence otherwise.
 * -----------------------------------------------------------------------------
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const script = fs.readFileSync(path.join(__dirname, '..', 'tools', 'scan-to-print.js'), 'utf8');
const HINT = 'on the kernel host run cad-studio/engine/install-engine.sh and pin the engine in OSHAL_PACKAGE_ENGINES';
const DOWN = 'the kernel could not reach the engine container (unavailable: no engine is configured for this application)';

/** The page's cadRefusal, sliced from the shipped script. */
function cadRefusal() {
  const from = script.indexOf('  function cadRefusal(out) {');
  assert.ok(from > 0, 'the page has cadRefusal');
  const to = script.indexOf('\n  }\n', from) + 4;
  return new Function(script.slice(from, to) + '\nreturn cadRefusal;')();
}

test('a CAD Studio with no engine is one plain sentence, never the install command', () => {
  const words = cadRefusal()({ build: { code: 'capability_unavailable', error: DOWN, reason: `${DOWN} — install or rebuild it: ${HINT}` } });
  assert.equal(words, "CAD Studio's engine is not answering on this installation, so the part cannot be made there right now.");
  assert.doesNotMatch(words, /install-engine|OSHAL_|kernel host|container/);
});

test('any other CAD Studio refusal is its own sentence', () => {
  assert.equal(cadRefusal()({ build: { code: 'refused', error: 'The outline is not closed.' } }), 'The outline is not closed.');
  assert.equal(cadRefusal()({ message: 'Too many parts.' }), 'Too many parts.');
});
