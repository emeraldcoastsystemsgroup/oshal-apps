/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Run deterministic public education/community adapter contracts and production real SQLite ingestion through the package test gate.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('local public sources paginate conservatively and ingest real searchable SQLite records', () => {
  const run = spawnSync(process.env.JOBHUNTER_PYTHON || 'python3',
    [fileURLToPath(new URL('./career-local-sources-contract.py', import.meta.url))],
    {encoding:'utf8', timeout:30000});
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}\n${run.error || ''}`);
  assert.match(run.stderr, /Ran 9 tests/);
});
