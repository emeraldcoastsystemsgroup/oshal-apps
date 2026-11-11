/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Run the employer seed list's contract through the package test gate: every entry is one the nightly pull can read, on real SQLite and with every request refused.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('every seeded employer names a board its own reader asks for, and seeding lands it in the nightly pull list', () => {
  const run = spawnSync(process.env.JOBHUNTER_PYTHON || 'python3',
    [fileURLToPath(new URL('./career-seed-sources-contract.py', import.meta.url))],
    {encoding:'utf8', timeout:60000});
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}\n${run.error || ''}`);
  assert.match(run.stderr, /Ran 7 tests/);
});
