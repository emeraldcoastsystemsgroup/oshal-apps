/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — the engine pins stay buildable on arm64 (0.2.4).
 *                     |                             | cadquery-ocp publishes linux/aarch64 wheels only from
 *                     |                             | 7.9.3 on, and CadQuery 2.8.0 is the first release that
 *                     |                             | accepts that kernel. With 2.5.2 / 7.7.2 pip refused the
 *                     |                             | arm64 build outright (ResolutionImpossible), so the
 *                     |                             | engine could not be installed on the DGX Spark. This
 *                     |                             | goes red if the lock or the requirement drifts back.
 *                     |                             | The resolution itself is proven by install-engine.sh's
 *                     |                             | self-test on an arm64 box; this guards the pins.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const ENGINE = path.resolve(__dirname, '..', 'engine');

/** @description Parse `name==version` lines (comments and blanks ignored) into a lowercase-keyed map. */
function pins(file) {
  const out = new Map();
  for (const raw of fs.readFileSync(path.join(ENGINE, file), 'utf8').split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = /^([A-Za-z0-9_.-]+)==([0-9][0-9A-Za-z.]*)$/.exec(line);
    if (m) out.set(m[1].toLowerCase(), m[2]);
  }
  return out;
}

/** @description Compare dotted numeric versions; a missing part counts as 0. */
function atLeast(version, floor) {
  const a = version.split('.').map(Number);
  const b = floor.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return true;
}

test('the locked OCCT kernel publishes linux/aarch64 wheels (cadquery-ocp >= 7.9.3)', () => {
  const ocp = pins('requirements-lock.txt').get('cadquery-ocp');
  assert.ok(ocp, 'requirements-lock.txt must pin cadquery-ocp');
  assert.ok(atLeast(ocp, '7.9.3'), `cadquery-ocp ${ocp} has no linux/aarch64 wheel; the arm64 engine build would fail`);
});

test('CadQuery accepts that kernel (>= 2.8.0) and the requirement and the lock name the same release', () => {
  const required = pins('requirements.txt').get('cadquery');
  const locked = pins('requirements-lock.txt').get('cadquery');
  assert.ok(required && locked, 'both requirements.txt and requirements-lock.txt must pin cadquery');
  assert.equal(required, locked);
  assert.ok(atLeast(locked, '2.8.0'), `cadquery ${locked} requires cadquery-ocp < 7.8, which has no linux/aarch64 wheel`);
});
