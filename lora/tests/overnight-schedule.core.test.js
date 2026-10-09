/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Register the nightly autonomous schedule proof (selection, not-ready, disabled, dedupe across nights, and the grant-signed morning-review handoff) with an explicit disposable database and framework boundary.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Expect the added case: an autonomous character enabled before owner issuers were recorded is skipped with nothing minted or sent.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { resolve, join } = require('node:path');
const pkg = resolve(__dirname, '..');
const framework = resolve(process.env.OSHAL_FRAMEWORK_ROOT || process.env.OSHAL_CORE_DIR || join(pkg, '../../oshal'));
test('nightly schedule dispatches only opted-in ready characters and hands off one morning review', { timeout: 180000 }, () => {
  const env = { ...process.env, OSHAL_FRAMEWORK_ROOT: framework, LOG_LEVEL: 'silent' };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, [join(framework, 'node_modules/vitest/vitest.mjs'), 'run',
    '--config', 'tests/gallery.config.mjs', 'tests/lora-overnight-schedule.spec.ts'], {
    cwd: pkg, env, encoding: 'utf8', timeout: 170000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /6 passed/);
});
