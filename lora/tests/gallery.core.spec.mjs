/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Expose the real gallery browser/database proof through the package's standard Node browser harness; unavailable framework and engine prerequisites fail explicitly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const pkg = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const framework = resolve(process.env.OSHAL_FRAMEWORK_ROOT || process.env.OSHAL_CORE_DIR || join(pkg, '../../oshal'));
test('gallery pixels, ownership and expired/deleted run access', { timeout: 180000 }, () => {
  const result = spawnSync(process.execPath, [join(framework, 'node_modules/vitest/vitest.mjs'), 'run',
    '--config', 'tests/gallery.config.mjs', 'tests/lora-gallery-browser.spec.ts'], {
    cwd: pkg, env: { ...process.env, OSHAL_FRAMEWORK_ROOT: framework, LOG_LEVEL: 'silent' },
    encoding: 'utf8', timeout: 170000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /7 passed/);
});
