/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Run the Workable reader's contract through the package test gate: a feed in the shape the board sends, read through the pull's own one-source path into real SQLite, with nothing leaving the machine.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('a Workable board is read with each job once, in its place, and a stored job takes its place on the next pull', () => {
  const run = spawnSync(process.env.JOBHUNTER_PYTHON || 'python3',
    [fileURLToPath(new URL('./career-workable-feed-contract.py', import.meta.url))],
    {encoding:'utf8', timeout:60000});
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}\n${run.error || ''}`);
  assert.match(run.stderr, /Ran 6 tests/);
});
