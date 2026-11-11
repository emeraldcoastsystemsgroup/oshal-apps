// CHANGE LOG
// 1 | maintainer@emeraldcoastsystemsgroup.com | Run the source maintenance contract: real full pulls on real temporary SQLite with the real readers, resolver, source review and saved-change path over recorded employer replies.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('source maintenance raises decisions, writes repair briefs and connects job sites only on evidence, inside its time limits', () => {
  const result = spawnSync(process.env.JOBHUNTER_PYTHON || 'python3', [
    fileURLToPath(new URL('./career-source-maintenance.py', import.meta.url)),
  ], { encoding: 'utf8', timeout: 300000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  assert.equal(result.status, 0, result.stderr || result.error?.message || result.stdout);
});
