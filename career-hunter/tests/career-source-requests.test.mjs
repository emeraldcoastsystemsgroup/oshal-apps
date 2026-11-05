// CHANGE LOG
// 1 | maintainer@emeraldcoastsystemsgroup.com | Run the saved source change contract: a pull applies it on real temporary SQLite, with a real process really killed inside a write.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('a saved source change is applied by the next pull, and says what became of it', () => {
  const result = spawnSync(process.env.JOBHUNTER_PYTHON || 'python3', [
    fileURLToPath(new URL('./career-source-requests.py', import.meta.url)),
  ], { encoding: 'utf8', timeout: 180000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  assert.equal(result.status, 0, result.stderr || result.error?.message || result.stdout);
});
