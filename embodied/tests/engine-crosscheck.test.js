/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | BACKLOG B28: run the PX4 cross-check's own suite (engine/tests/test_px4_crosscheck.py, standard library only, its own runner) under the first python that actually starts, so the harness and its divergence are guarded wherever the package's engine-* suites run - store CI included - and not only in the engine image. The suite must report every case it discovered as passed; a runner that discovered none, or a count that shrank, is red.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SUITE = path.join(__dirname, '..', 'engine', 'tests', 'test_px4_crosscheck.py');

/** The interpreter to use: the first that starts (Windows ships a `python3` alias that only prints a store hint,
 * so a --version probe decides, not the name). */
function python() {
  const bin = ['python3', 'python'].find((b) => {
    const probe = spawnSync(b, ['--version'], { encoding: 'utf8', windowsHide: true });
    return !probe.error && probe.status === 0;
  });
  if (!bin) throw new Error('a python interpreter is required (python3 or python) to run the PX4 cross-check suite');
  return bin;
}

test('the PX4 cross-check suite passes every case it declares', () => {
  const declared = (fs.readFileSync(SUITE, 'utf8').match(/^def test_\w+\(/gm) || []).length;
  assert.ok(declared >= 14, `the suite declares ${declared} cases; it declared 14 when this guard was written`);
  const run = spawnSync(python(), [SUITE], { encoding: 'utf8', windowsHide: true, timeout: 600000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  assert.equal(run.error, undefined, `the suite did not start: ${run.error}`);
  assert.equal(run.status, 0, `the suite failed:\n${run.stdout}\n${run.stderr}`);
  const summary = /^(\d+) passed, (\d+) failed$/m.exec(run.stdout);
  assert.ok(summary, `no summary line in:\n${run.stdout}`);
  assert.equal(Number(summary[2]), 0);
  assert.equal(Number(summary[1]), declared, 'every declared case ran and passed');
});
