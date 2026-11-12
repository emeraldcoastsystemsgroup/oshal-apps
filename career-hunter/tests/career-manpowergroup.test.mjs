/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Run the ManpowerGroup reader's contract (Experis, Manpower) through the package test gate: the sites' own job search, answered in the shape it served on 2026-11-11, read by the reader and by the nightly pull's one-source read into a real SQLite store. Every case the contract defines must run.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

test('the ManpowerGroup sites are read from their own search to the total it states, and a short read closes nothing', () => {
  const contract = fileURLToPath(new URL('./career-manpowergroup-contract.py', import.meta.url));
  const cases = (readFileSync(contract, 'utf8').match(/^ {4}def test_/gm) || []).length;
  assert.ok(cases >= 8, `the contract defines ${cases} cases`);
  const run = spawnSync(process.env.JOBHUNTER_PYTHON || 'python3', [contract], {encoding:'utf8', timeout:120000});
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}\n${run.error || ''}`);
  assert.match(run.stderr, new RegExp(`Ran ${cases} tests`));
});
