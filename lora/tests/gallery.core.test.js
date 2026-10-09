/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Run the bounded image-route guards through the standard package Node harness with an explicit framework prerequisite.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { resolve, join } = require('node:path');
const pkg = resolve(__dirname, '..');
const framework = resolve(process.env.OSHAL_FRAMEWORK_ROOT || process.env.OSHAL_CORE_DIR || join(pkg, '../../oshal'));
test('gallery callback attribution and route bounds', { timeout: 60000 }, () => {
  const result = spawnSync(process.execPath, [join(framework, 'node_modules/vitest/vitest.mjs'), 'run',
    '--config', 'tests/gallery.config.mjs', 'tests/lora-cell-images.spec.ts'], {
    cwd: pkg, env: { ...process.env, OSHAL_FRAMEWORK_ROOT: framework, LOG_LEVEL: 'silent' },
    encoding: 'utf8', timeout: 50000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /10 passed/);
});
