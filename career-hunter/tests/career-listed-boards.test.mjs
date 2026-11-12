/**
 * CHANGE LOG
 * 5 | maintainer@emeraldcoastsystemsgroup.com | The contract is given 120 seconds again, the limit its Test Lab case states. Entry 4 had raised it to 240 with no reason; the 30 cases run in about a second.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | The contract must run every case it defines: the count is read from the contract's own source and no longer written here, where each added case made it stale. A contract with fewer cases than the 17 it had when this was written fails.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | The contract also holds the place a SuccessFactors tile list shows beside a job, so it runs 17 tests.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The contract also holds the Talentsoft reader, so it runs 14 tests.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Run the listed-board readers' contract through the package test gate: Randstad USA's and Motion Recruitment's listing pages, answered in the shapes the boards serve, read through the pull's own one-source path into real SQLite, with nothing leaving the machine.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

test('a board that lists its jobs in its own pages is read to the count it states, each job under the id its link carries', () => {
  const contract = fileURLToPath(new URL('./career-listed-boards-contract.py', import.meta.url));
  const cases = (readFileSync(contract, 'utf8').match(/^ {4}def test_/gm) || []).length;
  assert.ok(cases >= 17, `the contract defines ${cases} cases`);
  const run = spawnSync(process.env.JOBHUNTER_PYTHON || 'python3', [contract], {encoding:'utf8', timeout:120000});
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}\n${run.error || ''}`);
  assert.match(run.stderr, new RegExp(`Ran ${cases} tests`));
});
