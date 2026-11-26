/** CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.76.1: run the final-packet contract (one entry per job; review judged on the final résumé) and refuse any failed check.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.76.2: the contract also checks the letter date is the Central calendar day; at least 10 checks.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PYTHON = process.env.CAREER_PYTHON || 'python3';

test('the final packet prints each job once and its review names only what the sent résumé holds (Python contract)', () => {
  const run = spawnSync(PYTHON, [fileURLToPath(new URL('./career-final-packet-contract.py', import.meta.url))], {
    encoding: 'utf8',
    timeout: 120000,
  });
  assert.equal(run.status, 0, run.stderr + run.stdout);
  const summary = JSON.parse(run.stdout.trim().split('\n').pop());
  assert.deepEqual(summary.failed, [], JSON.stringify(summary));
  assert.ok(summary.checks >= 10, `expected >= 10 checks, got ${summary.checks}`);
});
