/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Expose the dataset destination's real core relay, forced-RLS PostgreSQL and Chromium acceptance through the package's standard Node browser harness; unavailable framework and engine prerequisites fail explicitly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const pkg = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const framework = resolve(process.env.OSHAL_FRAMEWORK_ROOT || process.env.OSHAL_CORE_DIR || join(pkg, '../../oshal'));
test('dataset image redeemed as the caller, staged owner-scoped and imported from the studio', { timeout: 180000 }, () => {
  const env = { ...process.env, OSHAL_FRAMEWORK_ROOT: framework, LOG_LEVEL: 'silent' };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, [join(framework, 'node_modules/vitest/vitest.mjs'), 'run',
    '--config', 'tests/gallery.config.mjs', 'tests/lora-dataset-ingest.spec.ts', 'tests/lora-dataset-relay.spec.ts'], {
    cwd: pkg, env, encoding: 'utf8', timeout: 170000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /17 passed/);
});
