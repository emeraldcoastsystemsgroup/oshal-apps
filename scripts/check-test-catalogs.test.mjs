/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Mutation-prove the package test-catalog gate against the framework's REAL loader (OSHAL_FRAMEWORK, never a copy of its rule). A real package's catalog - embodied's, the package the kernel refused on 2026-09-28 - is copied with exactly the files it references: at 500 characters an expected line loads, at 501 the gate names the app, the case ID and the field. Every failing case is named rather than the loader's first; a catalog the manifest does not declare is still judged; a missing referenced file, a duplicate ID, a store with no catalog and a missing framework checkout are each red; and the CLI exits non-zero on a refused catalog. A missing framework fails the suite, it never skips it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CONVENTIONAL_CATALOG, describeCatalogError, loadFrameworkCatalog, packageCatalogResult, storeCatalogResults,
} from './check-test-catalogs.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(HERE, '..');
const GATE = path.join(HERE, 'check-test-catalogs.mjs');
const FIXTURE_PREFIX = 'check-test-catalogs-';
const MANIFEST = ['name: sample', 'uses:', '  - test-catalog', 'testing:', '  version: 1', `  catalog: ${CONVENTIONAL_CATALOG}`, ''].join('\n');

let loaded;
/**
 * @description The framework's contract, loaded once. OSHAL_FRAMEWORK missing is a FAILURE of every
 *   case here, never a skip: a skipped guard is a guard that does not exist.
 * @returns {object} The loaded framework contract.
 */
function framework() {
  loaded ??= loadFrameworkCatalog(process.env.OSHAL_FRAMEWORK);
  return loaded;
}

/**
 * @description One valid case in the kernel's catalog vocabulary.
 * @param {string} id Case ID.
 * @param {string[]} expected Expected lines.
 * @returns {object} The case.
 */
function sampleCase(id, expected = ['The fixture suite passes.']) {
  return {
    id, name: `Case ${id}`, purpose: 'Prove the fixture package.', level: 'unit',
    runner: { kind: 'node-test', scope: 'package', files: ['tests/a.test.js'] },
    expected, prerequisites: ['runner:node-test'], sideEffects: 'none',
    isolation: { mode: 'none' }, limits: { timeoutMs: 1000 }, installation: 'never',
  };
}

/**
 * @description Build a disposable store of packages. JSON is written as the catalog because JSON is
 *   YAML under the kernel's JSON schema.
 * @param {Record<string, { manifest?: string, catalog?: object, files?: Record<string,string> }>} packages Package name to contents.
 * @returns {string} The fixture store root.
 */
function makeStore(packages) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), FIXTURE_PREFIX));
  for (const [name, contents] of Object.entries(packages)) {
    const write = (relative, text) => {
      fs.mkdirSync(path.dirname(path.join(root, name, relative)), { recursive: true });
      fs.writeFileSync(path.join(root, name, relative), text);
    };
    write('oshal-app.yaml', (contents.manifest ?? MANIFEST).replace('name: sample', `name: ${name}`));
    if (contents.catalog) write(CONVENTIONAL_CATALOG, JSON.stringify(contents.catalog, null, 2));
    for (const [relative, text] of Object.entries(contents.files ?? { 'tests/a.test.js': '' })) write(relative, text);
  }
  return root;
}

/** @description Remove a fixture store, refusing any path that is not one of this suite's own. */
function removeStore(root) {
  const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(root));
  if (!relative.startsWith(FIXTURE_PREFIX) || relative.includes(path.sep)) throw new Error(`Unsafe fixture cleanup: ${root}`);
  fs.rmSync(root, { recursive: true, force: true });
}

/**
 * @description Copy a real package's manifest, catalog and exactly the files its catalog references.
 * @param {string} name Package directory in this store.
 * @returns {{ root: string, dir: string, catalog: object }} The fixture root, the copied package and its parsed catalog.
 */
function copyRealPackage(name) {
  const source = path.join(REPOSITORY_ROOT, name);
  const catalog = framework().yaml.load(fs.readFileSync(path.join(source, CONVENTIONAL_CATALOG), 'utf8'), { schema: framework().yaml.JSON_SCHEMA });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), FIXTURE_PREFIX));
  const referenced = catalog.cases.flatMap((item) => [
    ...(item.runner.kind !== 'smoke' && item.runner.scope === 'package' ? item.runner.files : []), ...(item.isolation.fixtures ?? []),
  ]);
  for (const relative of new Set(['oshal-app.yaml', CONVENTIONAL_CATALOG, ...referenced])) {
    fs.mkdirSync(path.dirname(path.join(root, name, relative)), { recursive: true });
    fs.copyFileSync(path.join(source, relative), path.join(root, name, relative));
  }
  return { root, dir: path.join(root, name), catalog };
}

test('a real package catalog loads at the 500-character cap and is refused one character over it, naming app, case and field', () => {
  const { root, dir, catalog } = copyRealPackage('embodied');
  try {
    assert.deepEqual(packageCatalogResult(dir, framework()).problems, [], 'the committed embodied catalog must load through the kernel loader');
    const index = Math.max(0, catalog.cases.findIndex((item) => item.id === 'engine-plant-python'));
    const target = catalog.cases[index];
    const writeLine = (length) => {
      target.expected[0] = target.expected[0].slice(0, length).padEnd(length, '.');
      fs.writeFileSync(path.join(dir, CONVENTIONAL_CATALOG), JSON.stringify(catalog, null, 2));
    };
    writeLine(500);
    assert.deepEqual(packageCatalogResult(dir, framework()).problems, []);
    writeLine(501);
    assert.deepEqual(packageCatalogResult(dir, framework()).problems, [
      `embodied: case ${target.id} (cases[${index}]) field expected[0]: must be non-empty text of at most 500 characters (is 501 characters)`,
    ]);
  } finally {
    removeStore(root);
  }
});

test('every failing case is named, not only the first one the loader stops at', () => {
  const long = 'x'.repeat(575);
  const root = makeStore({ sample: { catalog: { version: 1, cases: [sampleCase('first', [long]), sampleCase('fine'), sampleCase('third', ['ok', 'y'.repeat(550)])] } } });
  try {
    assert.deepEqual(packageCatalogResult(path.join(root, 'sample'), framework()).problems, [
      'sample: case first (cases[0]) field expected[0]: must be non-empty text of at most 500 characters (is 575 characters)',
      'sample: case third (cases[2]) field expected[1]: must be non-empty text of at most 500 characters (is 550 characters)',
    ]);
  } finally {
    removeStore(root);
  }
});

test('a catalog the manifest does not declare is judged as if declared and reported as undeclared', () => {
  const manifest = ['name: sample', 'uses:', '  - app-dependencies', ''].join('\n');
  const root = makeStore({
    good: { manifest, catalog: { version: 1, cases: [sampleCase('fine')] } },
    bad: { manifest, catalog: { version: 1, cases: [sampleCase('broken', ['z'.repeat(501)])] } },
  });
  try {
    const [bad, good] = storeCatalogResults(root, framework());
    assert.equal(good.declared, false);
    assert.equal(good.catalog, CONVENTIONAL_CATALOG);
    assert.deepEqual(good.problems, []);
    assert.deepEqual(bad.problems, ['bad: case broken (cases[0]) field expected[0]: must be non-empty text of at most 500 characters (is 501 characters)']);
  } finally {
    removeStore(root);
  }
});

test('a missing referenced file and a duplicate case ID are refused by the loader and named', () => {
  const root = makeStore({
    missing: { catalog: { version: 1, cases: [sampleCase('fine')] }, files: {} },
    twice: { catalog: { version: 1, cases: [sampleCase('same'), { ...sampleCase('same'), name: 'Another case' }] } },
  });
  try {
    const [missing, twice] = storeCatalogResults(root, framework());
    assert.deepEqual(missing.problems, ['missing: cases.fine.files: file unavailable: tests/a.test.js']);
    assert.deepEqual(twice.problems, ['twice: case same (cases[1]) field id: duplicate case ID same']);
  } finally {
    removeStore(root);
  }
});

test('a package with no catalog is not a problem, but a store with no catalog at all is a refusal', () => {
  const root = makeStore({ plain: { manifest: 'name: sample\n' } });
  try {
    assert.deepEqual(storeCatalogResults(root, framework()), [{ app: 'plain', catalog: null, declared: false, cases: 0, problems: [] }]);
    const run = spawnSync(process.execPath, [GATE, root], { encoding: 'utf8', env: { ...process.env, OSHAL_FRAMEWORK: framework().root } });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /no package Test Lab catalog was found .* refusing a vacuous pass/);
  } finally {
    removeStore(root);
  }
});

test('the CLI exits non-zero naming the refused case, and zero on a store that loads', () => {
  const root = makeStore({ sample: { catalog: { version: 1, cases: [sampleCase('long', ['q'.repeat(501)])] } } });
  try {
    const env = { ...process.env, OSHAL_FRAMEWORK: framework().root };
    const red = spawnSync(process.execPath, [GATE, root], { encoding: 'utf8', env });
    assert.equal(red.status, 1);
    assert.match(red.stderr, /sample: case long \(cases\[0\]\) field expected\[0\]: must be non-empty text of at most 500 characters \(is 501 characters\)/);
    fs.writeFileSync(path.join(root, 'sample', CONVENTIONAL_CATALOG), JSON.stringify({ version: 1, cases: [sampleCase('long')] }));
    const green = spawnSync(process.execPath, [GATE, root], { encoding: 'utf8', env });
    assert.equal(green.status, 0, green.stderr);
    assert.match(green.stdout, /Package test catalogs passed the kernel loader: 1 catalogs, 1 cases, 1 packages/);
  } finally {
    removeStore(root);
  }
});

test('without a framework checkout the gate refuses rather than passing unchecked', () => {
  assert.throws(() => loadFrameworkCatalog(undefined), /No framework checkout: set OSHAL_FRAMEWORK/);
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), FIXTURE_PREFIX));
  try {
    assert.throws(() => loadFrameworkCatalog(empty), /is not a framework checkout/);
  } finally {
    removeStore(empty);
  }
  const { OSHAL_FRAMEWORK: _unset, ...env } = process.env;
  const run = spawnSync(process.execPath, [GATE, REPOSITORY_ROOT], { encoding: 'utf8', env });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /refusing rather than passing unchecked/);
});

test('a kernel message about a declaration, not a case, still names the app and the field', () => {
  assert.equal(describeCatalogError('Application sample testing.uses: declare uses: [test-catalog] so older cores refuse silently ignored catalogs', []),
    'sample: uses: declare uses: [test-catalog] so older cores refuse silently ignored catalogs');
});
