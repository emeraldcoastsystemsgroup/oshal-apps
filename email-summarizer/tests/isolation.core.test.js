/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Run the mailbox cross-user denial spec (real kernel broker, forced-RLS disposable PostgreSQL, packaged routes over loopback) from node:test so the framework-coupled gate and the Test Lab can drive it; a run that executes fewer than its eleven cases fails.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The spec now also proves the Yahoo leg (15 cases); it needs a framework checkout that carries core's imap-mail-reader and tests/helpers/loopback-imap.ts.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 16 cases: message, draft and send with no provider stay 409 no_mail_connection for a caller with no mailbox (the Yahoo fallback is list/digest/summary only).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { resolve, join } = require('node:path');

const pkg = resolve(__dirname, '..');
const framework = resolve(
  process.env.OSHAL_CORE_ROOT || process.env.OSHAL_CORE_DIR || process.env.OSHAL_FRAMEWORK_ROOT || join(pkg, '../../oshal'),
);

test('mailbox routes deny another user across the real broker and forced-RLS store', { timeout: 300000 }, () => {
  const env = { ...process.env, OSHAL_FRAMEWORK_ROOT: framework, LOG_LEVEL: 'silent' };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, [join(framework, 'node_modules/vitest/vitest.mjs'), 'run',
    '--config', 'tests/mailbox.config.mjs', 'tests/email-mailbox-isolation.spec.ts'], {
    cwd: pkg, env, encoding: 'utf8', timeout: 290000,
  });
  assert.ifError(result.error);
  const cleanStdout = (result.stdout || '').replace(/\x1B\[[0-9;]*m/g, '');
  assert.match(cleanStdout, /Tests\s+16 passed \(16\)/);
});
