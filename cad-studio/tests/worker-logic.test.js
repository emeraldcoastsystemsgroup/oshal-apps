/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | The worker's own orchestration with the kernel stubbed out
 *                     |                             | (worker_logic_harness.py; python3 or python, no CadQuery), so
 *                     |                             | it runs in store CI: a feature past the per-feature budget is
 *                     |                             | refused `budget_exceeded` and its result discarded while the
 *                     |                             | next feature still runs; no budget / a generous one accepts
 *                     |                             | it; a disabled feature never runs; the budget parse; and every
 *                     |                             | revolve / sweep / loft refusal happens BEFORE the kernel is
 *                     |                             | called (the stub raises if it is — a valid loft is the
 *                     |                             | positive control that it does). Branch logic only: geometry
 *                     |                             | is the engine image's real-kernel suite.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ENGINE_DIR = path.resolve(__dirname, '..', 'engine');
const HARNESS = path.join(__dirname, 'worker_logic_harness.py');

/** Run the harness once with the first interpreter that actually starts (Windows ships a
 * `python3` alias that only prints a store hint, so a --version probe decides, not the name). */
function harness() {
  const bin = ['python3', 'python'].find((b) => { const probe = spawnSync(b, ['--version'], { encoding: 'utf8' }); return !probe.error && probe.status === 0; });
  if (!bin) throw new Error('a python interpreter is required (python3 or python)');
  const run = spawnSync(bin, [HARNESS, ENGINE_DIR], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  assert.equal(run.status, 0, `the harness failed:\n${run.stderr}`);
  return JSON.parse(run.stdout);
}
const out = harness();
const KERNEL_REACHED = /^kernel refused: KernelReached/;

test('a feature past its budget is refused budget_exceeded, its result discarded, and the next feature still runs', () => {
  const [slow, fast] = out.overBudgetFirst.features;
  assert.equal(slow.ok, false); assert.equal(slow.code, 'budget_exceeded');
  assert.ok(slow.ms > 150, `measured ${slow.ms} ms against the 150 ms budget`); assert.match(slow.error, /over the 150 ms per-feature budget; its result was discarded/);
  assert.equal(fast.ok, true); assert.equal(fast.code, undefined);
  assert.equal(out.overBudgetFirst.volume, 20, 'the fast feature ran on the kept shape');
  // Discarded means the previous solid stays: fast built 20, the slow feature's 10 was thrown away.
  assert.equal(out.overBudgetLast.features[1].code, 'budget_exceeded');
  assert.equal(out.overBudgetLast.volume, 20);
});

test('no budget or a generous one accepts the same feature; a disabled feature never runs', () => {
  for (const key of ['noBudget', 'generous']) {
    assert.equal(out[key].features[0].ok, true, key); assert.equal(out[key].features[0].code, undefined, key);
    assert.equal(out[key].volume, 10, key);
  }
  assert.deepEqual(out.disabledNeverRuns.features[0], { id: 's', index: 0, ok: true, skipped: true });
  assert.equal(out.disabledNeverRuns.volume, 100);
});

test('the budget parse accepts whole ms in range and refuses everything else by name', () => {
  assert.deepEqual(out.budgets.None, { ok: null });
  assert.deepEqual(out.budgets['1'], { ok: 1 });
  assert.deepEqual(out.budgets['600000'], { ok: 600000 });
  for (const bad of ['0', '600001', '2.5', "'60000'", 'True']) assert.match(out.budgets[bad].error, /featureBudgetMs must/, bad);
});

test('every revolve, sweep and loft refusal happens before the kernel is called', () => {
  const expected = {
    revolveAxisOffPlane: /axis must be one of \['x', 'z'\]/,
    revolveXYAxisZ: /axis must be one of \['x', 'y'\]/,
    revolveZeroDegrees: /degrees must be >= 1/,
    sweepOnePointPath: /path must be a list of 2\.\./,
    sweepBadPathPlane: /pathPlane must be one of/,
    loftOneSection: /sections must be a list of 2\.\.32/,
    loftRepeatedOffset: /sections\[1\]\.offset 5\.0 repeats an earlier section/,
    loftSectionNotObject: /sections\[1\] must be an object/,
    loftRuledNotBool: /ruled must be true or false/,
    loftTooManySections: /sections must be a list of 2\.\.32/,
  };
  assert.deepEqual(Object.keys(out.refusals).sort(), Object.keys(expected).sort());
  for (const [name, pattern] of Object.entries(expected)) {
    const status = out.refusals[name];
    assert.equal(status.ok, false, name);
    assert.doesNotMatch(status.error, KERNEL_REACHED, `${name} reached the kernel before refusing`);
    assert.match(status.error, pattern, name);
  }
  // Positive control: a valid loft does call the (stubbed) kernel, so the check above can fail.
  assert.match(out.validLoftReachesKernel.error, KERNEL_REACHED);
});
