/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Run the state lookup's contract through the package test gate: the state a job's location is filed under, for places the published job list held.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('a location is filed under the state it states: the capital, West Virginia, and a city or street named after another state', () => {
  const run = spawnSync(process.env.JOBHUNTER_PYTHON || 'python3',
    [fileURLToPath(new URL('./career-place-state-contract.py', import.meta.url))],
    {encoding:'utf8', timeout:60000});
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}\n${run.error || ''}`);
  assert.match(run.stderr, /Ran 10 tests/);
});
