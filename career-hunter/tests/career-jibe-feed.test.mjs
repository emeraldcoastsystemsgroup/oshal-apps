/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Run the Jibe reader's contract through the package test gate: a listing in the shape a Jibe career site sends, asked on the employer's own host and read through the pull's own one-source path into real SQLite, with nothing leaving the machine.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('a Jibe career site on the employer\'s own host is read whole, placed by city and state, and closes only what left a whole listing', () => {
  const run = spawnSync(process.env.JOBHUNTER_PYTHON || 'python3',
    [fileURLToPath(new URL('./career-jibe-feed-contract.py', import.meta.url))],
    {encoding:'utf8', timeout:60000});
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}\n${run.error || ''}`);
  assert.match(run.stderr, /Ran 9 tests/);
});
