/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The surface parse guard (the world 1.0.1 lesson: a served script no compiler ever parses): the tile's script parses as a classic script, every element id the script reads exists in the page, the page loads the script from the package's asset route, and the script builds nodes with textContent only (no innerHTML / insertAdjacentHTML with API data).
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const TOOLS = path.resolve(__dirname, '..', 'tools');
const html = fs.readFileSync(path.join(TOOLS, 'drone-relay.html'), 'utf8');
const js = fs.readFileSync(path.join(TOOLS, 'drone-relay.js'), 'utf8');

test('the surface script parses as a classic script and the page loads it from the asset route', () => {
  assert.doesNotThrow(() => new vm.Script(js, { filename: 'drone-relay.js' }));
  assert.ok(html.includes('<script src="/api/drone-relay/assets/drone-relay.js"></script>'));
  assert.ok(html.includes('<title>Drone Relay</title>'));
});

test('every element id the script reads exists in the page', () => {
  const ids = new Set([...js.matchAll(/\$\('([a-z0-9-]+)'\)/g)].map((m) => m[1]));
  assert.ok(ids.size > 30, `found ${ids.size} ids`);
  const missing = [...ids].filter((id) => !html.includes(`id="${id}"`));
  assert.deepEqual(missing, []);
});

test('nothing from the API is interpolated into markup', () => {
  assert.doesNotMatch(js, /innerHTML|insertAdjacentHTML|outerHTML|document\.write/);
  assert.ok(js.includes('textContent'));
});
