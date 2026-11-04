// CHANGE LOG
// 1 | maintainer@emeraldcoastsystemsgroup.com | Run the nightly source review contract against real temporary SQLite with recorded employer replies.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('the nightly source review repairs on evidence, refuses the rest, and stays inside its budget', () => {
  const result = spawnSync(process.env.JOBHUNTER_PYTHON || 'python3', [
    fileURLToPath(new URL('./career-source-review.py', import.meta.url)),
  ], { encoding: 'utf8', timeout: 60000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  assert.equal(result.status, 0, result.stderr || result.error?.message || result.stdout);
});
