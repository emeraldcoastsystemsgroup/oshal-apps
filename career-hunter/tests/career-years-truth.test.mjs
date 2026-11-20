/** CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.68.22: run the Python contract for the person's own years by skill (years_truth) and recorded-term fidelity (term_fidelity) and refuse any failed check.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PYTHON = process.env.CAREER_PYTHON || 'python3';

test('generated documents state the person\'s own years and keep recorded terms (Python contract)', () => {
  const run = spawnSync(PYTHON, [fileURLToPath(new URL('./career-years-truth-contract.py', import.meta.url))], {
    encoding: 'utf8',
    timeout: 120000,
  });
  assert.equal(run.status, 0, run.stderr + run.stdout);
  const summary = JSON.parse(run.stdout.trim().split('\n').pop());
  assert.deepEqual(summary.failed, [], JSON.stringify(summary));
  assert.ok(summary.checks >= 100, `expected >= 100 checks, got ${summary.checks}`);
});
