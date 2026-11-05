// CHANGE LOG
// 1 | maintainer@emeraldcoastsystemsgroup.com | Run the stopped-pull contract: real processes really killed inside a pull over real temporary SQLite.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('a stopped pull continues from the last employer it finished', () => {
  const result = spawnSync(process.env.JOBHUNTER_PYTHON || 'python3', [
    fileURLToPath(new URL('./career-pull-checkpoint.py', import.meta.url)),
  ], { encoding: 'utf8', timeout: 240000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  assert.equal(result.status, 0, result.stderr || result.error?.message || result.stdout);
});
