/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | A scoring pass on a shared read-only corpus keeps the person's scores (the contract uses SQLite's real read-only attach).
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

test('scoring on a shared read-only corpus keeps the scores and skips only the corpus facts', () => {
  const result = spawnSync('python3', [new URL('./career-readonly-corpus-contract.py', import.meta.url).pathname], { encoding: 'utf8', timeout: 60000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  for (const [name, ok] of JSON.parse(result.stdout).checks) assert.ok(ok, name);
});
