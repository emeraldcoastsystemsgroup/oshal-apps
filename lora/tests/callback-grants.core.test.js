/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Register the per-dispatch callback grant proof (mint, env-only delivery, replay/expiry/revocation/scope refusals, forced RLS, and the framework Python and PowerShell signers against the verifier) with explicit disposable database, framework and interpreter prerequisites.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Expect the four added cases (issuer-less grant refused, no dispatch without a verified issuer, autonomous mode records the enabling issuer, migration 106 parity).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { resolve, join } = require('node:path');
const pkg = resolve(__dirname, '..');
const framework = resolve(process.env.OSHAL_FRAMEWORK_ROOT || process.env.OSHAL_CORE_DIR || join(pkg, '../../oshal'));
test('worker callbacks need a live, scoped, single-use grant signature', { timeout: 180000 }, () => {
  const env = { ...process.env, OSHAL_FRAMEWORK_ROOT: framework, LOG_LEVEL: 'silent' };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, [join(framework, 'node_modules/vitest/vitest.mjs'), 'run',
    '--config', 'tests/gallery.config.mjs', 'tests/lora-callback-grants.spec.ts'], {
    cwd: pkg, env, encoding: 'utf8', timeout: 170000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /15 passed/);
});
