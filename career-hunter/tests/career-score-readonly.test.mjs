import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('real SQLite scoring saves private fits with a read-only corpus and preserves writable enrichment', () => {
  const result = spawnSync(process.env.CAREER_PYTHON || 'python3', [
    fileURLToPath(new URL('./career-score-readonly-contract.py', import.meta.url)),
  ], { encoding: 'utf8', timeout: 20000 });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()), { checks: 4, failed: [] });
});
