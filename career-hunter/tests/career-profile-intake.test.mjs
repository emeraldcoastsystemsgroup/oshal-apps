// CHANGE LOG
// 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise source-backed qualification intake and immutable refusals through the real Python profile module.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('resume and additive intake retain complete source-backed qualification statements', () => {
  const result = spawnSync(process.env.CAREER_TEST_PYTHON || 'python3', [
    fileURLToPath(new URL('./career-profile-intake-contract.py', import.meta.url)),
  ], { encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(result.stdout.trim()), { checks: 16, failed: [] });
});
