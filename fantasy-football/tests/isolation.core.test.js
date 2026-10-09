/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Run the fantasy-football cross-user denial spec (forced exact-owner RLS on a disposable PostgreSQL owned by a NOBYPASSRLS runtime role, the real kernel connection lookup and broker, the packaged routes over loopback HTTP) from node:test so the framework-coupled gate and the Test Lab can drive it; a run that executes fewer than its twelve cases fails.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | 0.2.0: the spec now also covers hand-typed leagues and the week ledger on the real store; a run that executes fewer than its fifteen cases fails.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { resolve, join } = require('node:path');

const pkg = resolve(__dirname, '..');
const framework = resolve(
  process.env.OSHAL_CORE_ROOT || process.env.OSHAL_CORE_DIR || process.env.OSHAL_FRAMEWORK_ROOT || join(pkg, '../../oshal'),
);

test('fantasy routes deny another user across forced RLS, the real broker and loopback HTTP', { timeout: 300000 }, () => {
  const env = { ...process.env, OSHAL_FRAMEWORK_ROOT: framework, LOG_LEVEL: 'silent' };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, [join(framework, 'node_modules/vitest/vitest.mjs'), 'run',
    '--config', 'tests/isolation.config.mjs', 'tests/fantasy-isolation.spec.ts'], {
    cwd: pkg, env, encoding: 'utf8', timeout: 290000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Tests\s+15 passed \(15\)/);
});
