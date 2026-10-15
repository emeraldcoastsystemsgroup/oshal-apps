/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Demo sweep 1: the engine-down banner and toasts showed a person the kernel's failure text three times with the host's install command. The shipped page's renderEngine/buildWords run in a VM over the capabilities and build answers the routes give when no engine is configured: the banner says once that the engine is not answering on this installation, never an address, setting or install command, and an engine's own refusal sentence is still shown.
 * -----------------------------------------------------------------------------
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PKG = path.resolve(__dirname, '..');
const script = fs.readFileSync(path.join(PKG, 'tools', 'cad-studio.js'), 'utf8');
const page = fs.readFileSync(path.join(PKG, 'tools', 'cad-studio.html'), 'utf8');
const HINT = 'on the kernel host run cad-studio/engine/install-engine.sh and pin the engine in OSHAL_PACKAGE_ENGINES';
const DOWN = 'the kernel could not reach the engine container (unavailable: no engine is configured for this application)';

/** The page's own constants, renderEngine and buildWords, sliced from the shipped script. */
function surface() {
  const nodes = {};
  const $ = (id) => (nodes[id] ||= { textContent: '', className: '', hidden: true });
  const pick = (from, to) => script.slice(script.indexOf(from), script.indexOf(to, script.indexOf(from)));
  const source = pick('  const ENGINE_DOWN', '\n', 0) + '\n' + pick('  const ENGINE_SHORT', '\n') + '\n'
    + pick('  function renderEngine(engine) {', '  function showBuild(build) {');
  const context = { $ };
  vm.createContext(context);
  vm.runInContext(source + '\nthis.renderEngine = renderEngine; this.buildWords = buildWords;', context);
  return { nodes, renderEngine: context.renderEngine, buildWords: context.buildWords };
}

test('an engine that is not answering is one plain sentence, never the install command', () => {
  const { nodes, renderEngine, buildWords } = surface();
  renderEngine({ connected: false, lastError: `${DOWN} — install or rebuild it: ${HINT}`, installHint: HINT });
  assert.equal(nodes['engine-banner'].hidden, false);
  const shown = nodes['engine-reason'].textContent;
  assert.match(shown, /^The CAD engine is not answering on this installation/);
  assert.doesNotMatch(shown + (nodes['engine-hint'] ? nodes['engine-hint'].textContent : ''), /install-engine|install or rebuild|OSHAL_|kernel host|container|unavailable:/);
  const toast = 'Rebuild failed: ' + buildWords({ code: 'capability_unavailable', error: DOWN, reason: `${DOWN} — install or rebuild it: ${HINT}` });
  assert.equal(toast, 'Rebuild failed: The CAD engine is not answering on this installation.');
  assert.equal(buildWords({ code: 'refused', reason: 'The part has no closed outline.' }), 'The part has no closed outline.');
});

test('the page no longer carries the install-command line', () => {
  assert.doesNotMatch(page, /Install or rebuild it from the host|id="engine-hint"/);
});
