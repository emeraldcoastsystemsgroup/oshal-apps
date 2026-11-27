/** CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | A résumé read "2 years" beside "Java / J2EE (11 years)" with the notice "The résumé claimed 11 years; your records support about 2", for a person who states Java 11 years. Run the Python contract that proves the claims check leaves a years figure the person stated as written, takes one they have not stated out of its sentence, never writes a number of its own, and says so in true words; refuse any failed check, and a run that lost cases.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PYTHON = process.env.CAREER_PYTHON || 'python3';

test('the claims check keeps a years figure the person stated, takes out one they did not, and writes no number of its own (Python contract)', () => {
  const run = spawnSync(PYTHON, [fileURLToPath(new URL('./career-claims-years-contract.py', import.meta.url))], {
    encoding: 'utf8',
    timeout: 120000,
  });
  assert.equal(run.status, 0, run.stderr + run.stdout);
  const summary = JSON.parse(run.stdout.trim().split('\n').pop());
  assert.deepEqual(summary.failed, [], JSON.stringify(summary));
  assert.ok(summary.checks >= 61, `expected >= 61 checks, got ${summary.checks}`);
});
