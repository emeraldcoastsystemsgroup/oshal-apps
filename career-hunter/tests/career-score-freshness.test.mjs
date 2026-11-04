// CHANGE LOG
// 1 | maintainer@emeraldcoastsystemsgroup.com | Run the focused private scoring freshness contract with fixture-only inference.
// 2 | maintainer@emeraldcoastsystemsgroup.com | Count the contract's new saved-copy and refused-job cases.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('changed evidence refreshes private scores within the existing model budget', () => {
  const result = spawnSync(process.env.CAREER_PYTHON || 'python3', [
    fileURLToPath(new URL('./career-score-freshness-contract.py', import.meta.url)),
  ], { encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(result.stdout.trim()), { checks: 28, failed: [] });
});
