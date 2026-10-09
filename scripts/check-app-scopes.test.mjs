/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Mutation-prove the package scope gate against the framework's REAL contract (OSHAL_FRAMEWORK, never a copy of its vocabulary): every known scope and an absent one pass; `scope: deployment` (the dev-workspace-index 0.2.0 value the kernel database refused on 2026-09-28), a capitalised scope and an empty `scope:` are each named with the app; the CLI exits non-zero on a refused scope; this store's own packages all pass; a missing framework, a framework without the contract and a store with no package are each red. A missing framework fails the suite, it never skips it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFrameworkScope, main, packageScopeResult, storeScopeResults } from './check-app-scopes.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(HERE, '..');
const GATE = path.join(HERE, 'check-app-scopes.mjs');
const FIXTURE_PREFIX = 'check-app-scopes-';

let loaded;
/**
 * @description The framework's contract, loaded once. OSHAL_FRAMEWORK missing is a FAILURE of every
 *   case here, never a skip: a skipped guard is a guard that does not exist.
 * @returns {object} The loaded contract.
 */
function framework() {
  loaded ??= loadFrameworkScope(process.env.OSHAL_FRAMEWORK);
  return loaded;
}

/**
 * @description Build a disposable store: one directory per package holding only its manifest.
 * @param {Record<string, string|null>} packages Package name to its `scope:` line (null writes none).
 * @returns {string} The fixture store root.
 */
function makeStore(packages) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), FIXTURE_PREFIX));
  for (const [name, scopeLine] of Object.entries(packages)) {
    fs.mkdirSync(path.join(root, name), { recursive: true });
    fs.writeFileSync(path.join(root, name, 'oshal-app.yaml'), `name: ${name}\ndisplayName: ${name}\n${scopeLine === null ? '' : `${scopeLine}\n`}`);
  }
  return root;
}

/** @description Remove a fixture store, refusing any path that is not one of this suite's own. */
function removeStore(root) {
  const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(root));
  if (!relative.startsWith(FIXTURE_PREFIX) || relative.includes(path.sep)) throw new Error(`Unsafe fixture cleanup: ${root}`);
  fs.rmSync(root, { recursive: true, force: true });
}

test('every known scope and an absent one pass the framework contract', () => {
  const scopes = framework().scope.APP_SCOPES;
  assert.ok(scopes.includes('operator') && !scopes.includes('deployment'), `framework vocabulary: ${scopes.join(', ')}`);
  const root = makeStore({ none: null, ...Object.fromEntries(scopes.map((scope) => [`pkg-${scope}`, `scope: ${scope}`])) });
  try {
    const results = storeScopeResults(root, framework());
    assert.equal(results.length, scopes.length + 1);
    assert.deepEqual(results.flatMap((result) => result.problems), []);
    assert.equal(results.find((result) => result.app === 'none').scope, undefined);
  } finally { removeStore(root); }
});

test('an unknown, mis-cased or empty scope is refused with the app named', () => {
  const root = makeStore({ 'dev-index': 'scope: deployment', cased: 'scope: Operator', empty: 'scope:' });
  try {
    const byApp = Object.fromEntries(storeScopeResults(root, framework()).map((result) => [result.app, result.problems]));
    assert.match(byApp['dev-index'][0], /^dev-index \(dev-index\/oshal-app\.yaml\): scope is not a known app scope: "deployment" \(unknown_app_scope\)/);
    assert.match(byApp.cased[0], /"Operator" \(unknown_app_scope\)/);
    assert.match(byApp.empty[0], /scope is not a known app scope: null/);
    const cli = spawnSync(process.execPath, [GATE, root], { encoding: 'utf8', env: { ...process.env, OSHAL_FRAMEWORK: framework().root } });
    assert.equal(cli.status, 1, cli.stdout + cli.stderr);
    assert.match(cli.stderr, /Package scopes the kernel would refuse \(3\)/);
  } finally { removeStore(root); }
});

test('every package in this store declares a scope the kernel accepts', () => {
  const results = storeScopeResults(REPOSITORY_ROOT, framework());
  assert.ok(results.length > 10, `only ${results.length} packages found`);
  assert.deepEqual(results.flatMap((result) => result.problems), []);
  assert.equal(results.find((result) => result.app === 'dev-workspace-index').scope, 'operator');
  const cli = spawnSync(process.execPath, [GATE], { encoding: 'utf8', env: { ...process.env, OSHAL_FRAMEWORK: framework().root } });
  assert.equal(cli.status, 0, cli.stdout + cli.stderr);
  assert.match(cli.stdout, /^Package scopes passed the framework's contract: \d+ packages/);
});

test('no framework, a framework without the contract, and a store with no package are each red', () => {
  assert.throws(() => loadFrameworkScope(undefined), /No framework checkout/);
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), FIXTURE_PREFIX));
  try {
    assert.throws(() => loadFrameworkScope(bare), /carries no app-scope contract/);
  } finally { removeStore(bare); }
  const empty = makeStore({});
  const previous = process.exitCode;
  try {
    main(empty, framework().root);
    assert.equal(process.exitCode, 1);
  } finally { process.exitCode = previous; removeStore(empty); }
  assert.deepEqual(packageScopeResult(path.join(REPOSITORY_ROOT, 'dev-workspace-index'), framework()).problems, []);
});
