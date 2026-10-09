/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove configured framework precedence and refusal of missing renderer/dependency bytes without restoring a machine-specific fallback.
 */
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import test from 'node:test';
import assert from 'node:assert/strict';
import {frameworkFixture} from './framework-fixture.mjs';

test('the declared framework wins and unavailable fixtures refuse explicitly', () => {
  const root = mkdtempSync(join(tmpdir(), 'presentations-framework-fixture-'));
  try {
    assert.throws(() => frameworkFixture({}), /explicit OSHAL_FRAMEWORK/);
    assert.throws(() => frameworkFixture({OSHAL_ROOT: root}), /missing src\/features/);
    for (const file of ['src/features/presentation-generation/index.ts', 'node_modules/typescript/package.json', 'node_modules/playwright/package.json']) {
      const filename = join(root, file);
      mkdirSync(join(filename, '..'), {recursive: true});
      writeFileSync(filename, file.endsWith('.json') ? '{}' : '// fixture source');
    }
    assert.equal(frameworkFixture({OSHAL_ROOT: root}), root);
    assert.throws(() => frameworkFixture({OSHAL_FRAMEWORK: join(root, 'absent'), OSHAL_ROOT: root}), /missing src\/features/);
  } finally {rmSync(root, {recursive: true, force: true});}
});
