/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Expose console creation and actual transaction-race acceptance through the package browser harness with explicit isolated PostgreSQL and framework prerequisites.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Expect eleven cases: the browser suite adds the starter-on-request case (the studio's read saves nothing; the explicit action saves one owner-bound starter, once).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const pkg = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const framework = resolve(process.env.OSHAL_FRAMEWORK_ROOT || process.env.OSHAL_CORE_DIR || join(pkg, '../../oshal'));
test('console character configuration and concurrent creation', { timeout: 180000 }, () => {
  const env = { ...process.env, OSHAL_FRAMEWORK_ROOT: framework, LOG_LEVEL: 'silent' };
  delete env.NODE_TEST_CONTEXT;
  delete env.OSHAL_LORA_SCREENSHOT;
  const result = spawnSync(process.execPath, [join(framework, 'node_modules/vitest/vitest.mjs'), 'run',
    '--config', 'tests/gallery.config.mjs', 'tests/lora-character-browser.spec.ts'], {
    cwd: pkg, env, encoding: 'utf8', timeout: 170000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /\b11 passed/);
});
