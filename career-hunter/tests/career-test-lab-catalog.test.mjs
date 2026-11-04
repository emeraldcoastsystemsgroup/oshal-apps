/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The catalog parses and registers real suites. One unquoted purpose made the whole file invalid YAML, so the kernel listed and ran no Career case, and the store's framework-coupled catalog check does not run on a workstation.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const toolchain = [process.env.STORE_CI_TOOLCHAIN, resolve(root, '../scripts/toolchain/node_modules')]
  .filter(Boolean).find(directory => existsSync(resolve(directory, 'js-yaml/package.json')));
if (!toolchain) throw new Error('js-yaml requires scripts/toolchain dependencies or STORE_CI_TOOLCHAIN');
const yaml = createRequire(resolve(toolchain, 'js-yaml/package.json'))('./index.js');

test('the Test Lab catalog parses, its ids are unique and its node suites exist', () => {
  const catalog = yaml.load(readFileSync(resolve(root, 'tests/test-lab.yaml'), 'utf8'));
  assert.ok(Array.isArray(catalog.cases) && catalog.cases.length > 0);
  const ids = catalog.cases.map(testCase => testCase.id);
  assert.equal(new Set(ids).size, ids.length, 'case ids are unique');
  const missing = catalog.cases.filter(testCase => testCase.runner?.kind === 'node-test')
    .flatMap(testCase => (testCase.runner.files || []).filter(file => !existsSync(resolve(root, file))).map(file => `${testCase.id}: ${file}`));
  assert.deepEqual(missing, []);
});

test('the WAL case describes its own suite', () => {
  const catalog = yaml.load(readFileSync(resolve(root, 'tests/test-lab.yaml'), 'utf8'));
  const portable = catalog.cases.find(testCase => testCase.id === 'career-published-db-portable');
  assert.match(portable.purpose, /read-only/);
  assert.doesNotMatch(portable.purpose, /PYTHONPATH|JOBHUNTER_PYTHON/);
});
