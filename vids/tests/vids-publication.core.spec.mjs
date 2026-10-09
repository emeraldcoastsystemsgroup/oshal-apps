/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Run Vids publication acceptance through the locked framework Vitest binary with disposable database and Chromium prerequisites.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const framework = resolve(process.env.OSHAL_FRAMEWORK_ROOT || process.env.OSHAL_CORE_DIR || join(pkg, '../../oshal'));

test('Vids finished artifact publication and revocation', { timeout: 180000 }, () => {
  const env = { ...process.env, OSHAL_FRAMEWORK_ROOT: framework, LOG_LEVEL: 'silent' };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, [join(framework, 'node_modules/vitest/vitest.mjs'), 'run',
    '--config', 'tests/publication.config.mjs', 'tests/vids-publication.spec.ts'], {
    cwd: pkg, env, encoding: 'utf8', timeout: 170000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /5 passed/);
});
