/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Run the search-service readers' contract through the package test gate: a newer SuccessFactors site's search and a Dayforce board's search, answered in the shapes the sites send, read through the pull's own one-source path into real SQLite, with nothing leaving the machine.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('a SuccessFactors search and a Dayforce board are read to the count they state, and only a whole read closes a job', () => {
  const run = spawnSync(process.env.JOBHUNTER_PYTHON || 'python3',
    [fileURLToPath(new URL('./career-search-service-feeds-contract.py', import.meta.url))],
    {encoding:'utf8', timeout:60000});
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}\n${run.error || ''}`);
  assert.match(run.stderr, /Ran 10 tests/);
});
