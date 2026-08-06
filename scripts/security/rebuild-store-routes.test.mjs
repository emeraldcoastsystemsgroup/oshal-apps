/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Mutation-resistant behavioral contract for the one-pass store route rebuild, relative module mapping, factory enforcement, rollback, and transient cleanup.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rebuildStoreRoutes } from './rebuild-store-routes.mjs';

const FAKE_COMPILER = String.raw`
const fs = require('node:fs');
const path = require('node:path');
const framework = process.cwd();
const args = process.argv.slice(2);
const outIndex = args.indexOf('--outDir');
if (outIndex < 0 || !args[outIndex + 1]) process.exit(31);
const outputRoot = path.resolve(args[outIndex + 1]);
fs.appendFileSync(path.join(framework, 'compiler-invocations.log'), 'compile\n');
if (fs.existsSync(path.join(framework, 'fail-compiler'))) process.exit(9);
function walk(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const candidate = path.join(root, entry.name);
    return entry.isDirectory() ? walk(candidate) : [candidate];
  });
}
for (const source of walk(path.join(framework, 'src'))) {
  if (!source.endsWith('.ts') || source.endsWith('.d.ts')) continue;
  const relative = path.relative(path.join(framework, 'src'), source).replace(/\.ts$/, '.js');
  const destination = path.join(outputRoot, relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const body = fs.readFileSync(source, 'utf8').replace(/\r?\n$/, '');
  fs.writeFileSync(destination, body + '\n//# sourceMappingURL=' + path.basename(destination) + '.map');
}
`;

/** @description Write a fixture file while creating its parent directories. */
function writeFixture(path, contents) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, contents);
}

/** @description Create a minimal framework checkout with an observable fake canonical compiler. */
function createFramework(root) {
  const framework = join(root, 'framework');
  writeFixture(join(framework, 'tsconfig.json'), '{}\n');
  writeFixture(join(framework, 'src', 'core.ts'), 'exports.core = true;\n');
  writeFixture(join(framework, 'node_modules', 'typescript', 'bin', 'tsc'), FAKE_COMPILER);
  return framework;
}

/** @description Create one source-bearing store package and its explicit manifest route. */
function createPackage(store, name, factory, sourceBody) {
  const packageRoot = join(store, name);
  const manifest = [
    `name: ${name}`,
    'routes:',
    '  - module: routes/main-routes.js',
    `    factory: ${factory}`,
    `    mountPath: /api/${name}`,
    '    auth: oidc',
    '',
  ].join('\n');
  writeFixture(join(packageRoot, 'oshal-app.yaml'), manifest);
  writeFixture(join(packageRoot, 'src-routes', 'main-routes.ts'), sourceBody);
  return packageRoot;
}

/** @description List compiler staging directories that must never survive a rebuild. */
function compilerStages(framework) {
  return readdirSync(join(framework, 'src')).filter((name) => name.startsWith('__oshal_store_parity_'));
}

/** @description Snapshot OS temp parity directories so the test can detect leaked compiler output. */
function parityTempDirs() {
  return new Set(readdirSync(tmpdir()).filter((name) => name.startsWith('oshal-store-parity-')));
}

/** @description Assert the rebuild created no new transient output directory. */
function assertNoNewTempDirs(before) {
  const after = parityTempDirs();
  assert.deepEqual([...after].filter((name) => !before.has(name)), []);
}

test('canonical rebuild compiles once, keeps package-relative imports, and synchronizes exact outputs', () => {
  const root = mkdtempSync(join(tmpdir(), 'store-parity-contract-'));
  const beforeTemps = parityTempDirs();
  try {
    const framework = createFramework(root);
    const store = join(root, 'store');
    mkdirSync(store);
    const alphaSource = 'exports.createAlphaRoutes = function createAlphaRoutes() { require("../lib/runtime-helper"); return require("./nested/helper"); };\n';
    const alpha = createPackage(store, 'alpha', 'createAlphaRoutes', alphaSource);
    writeFixture(join(alpha, 'src-routes', 'nested', 'helper.ts'), 'exports.packageName = "alpha";\n');
    writeFixture(join(alpha, 'lib', 'runtime-helper.js'), 'exports.runtime = true;\n');
    const existingAlpha = `${alphaSource.trimEnd()}\r\n//# sourceMappingURL=main-routes.js.map`;
    writeFixture(join(alpha, 'routes', 'main-routes.js'), existingAlpha);
    writeFixture(join(alpha, 'routes', 'stale.js'), 'exports.stale = true;\n');
    writeFixture(join(alpha, 'routes', 'README.md'), 'preserve me\n');
    const beta = createPackage(store, 'beta', 'createBetaRoutes',
      'exports.createBetaRoutes = function createBetaRoutes() { return require("./nested/helper"); };\n');
    writeFixture(join(beta, 'src-routes', 'nested', 'helper.ts'), 'exports.packageName = "beta";\n');
    writeFixture(join(beta, 'src-routes', 'tsconfig.json'), '{"compilerOptions":{"sourceMap":false}}\n');

    const summary = rebuildStoreRoutes({ storeRoot: store, frameworkRoot: framework });

    assert.deepEqual(summary, { packages: 2, sources: 4, removedStale: 1 });
    assert.equal(readFileSync(join(framework, 'compiler-invocations.log'), 'utf8'), 'compile\n');
    assert.equal(readFileSync(join(alpha, 'routes', 'main-routes.js'), 'utf8'), existingAlpha);
    assert.match(readFileSync(join(alpha, 'routes', 'main-routes.js'), 'utf8'), /require\("\.\/nested\/helper"\)/);
    assert.match(readFileSync(join(alpha, 'routes', 'main-routes.js'), 'utf8'), /require\("\.\.\/lib\/runtime-helper"\)/);
    assert.match(readFileSync(join(alpha, 'routes', 'nested', 'helper.js'), 'utf8'), /"alpha"/);
    assert.match(readFileSync(join(beta, 'routes', 'nested', 'helper.js'), 'utf8'), /"beta"/);
    assert.match(readFileSync(join(alpha, 'routes', 'main-routes.js'), 'utf8'), /sourceMappingURL=main-routes\.js\.map$/);
    assert.doesNotMatch(readFileSync(join(beta, 'routes', 'main-routes.js'), 'utf8'), /sourceMappingURL/);
    assert.equal(existsSync(join(alpha, 'routes', 'stale.js')), false);
    assert.equal(readFileSync(join(alpha, 'routes', 'README.md'), 'utf8'), 'preserve me\n');
    assert.deepEqual(compilerStages(framework), []);
    assertNoNewTempDirs(beforeTemps);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('factory verification fails before output mutation and still cleans transient sources', () => {
  const root = mkdtempSync(join(tmpdir(), 'store-parity-factory-'));
  const beforeTemps = parityTempDirs();
  try {
    const framework = createFramework(root);
    const store = join(root, 'store');
    mkdirSync(store);
    const broken = createPackage(store, 'broken', 'createBrokenRoutes',
      'exports.createDifferentRoutes = function createDifferentRoutes() {};\n');
    writeFixture(join(broken, 'routes', 'main-routes.js'), 'exports.original = true;\n');

    assert.throws(
      () => rebuildStoreRoutes({ storeRoot: store, frameworkRoot: framework }),
      /compiled module does not export createBrokenRoutes/,
    );
    assert.equal(readFileSync(join(broken, 'routes', 'main-routes.js'), 'utf8'), 'exports.original = true;\n');
    assert.equal(readFileSync(join(framework, 'compiler-invocations.log'), 'utf8'), 'compile\n');
    assert.deepEqual(compilerStages(framework), []);
    assertNoNewTempDirs(beforeTemps);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('compiler failure leaves routes untouched and cleans staging on the error path', () => {
  const root = mkdtempSync(join(tmpdir(), 'store-parity-compiler-'));
  const beforeTemps = parityTempDirs();
  try {
    const framework = createFramework(root);
    writeFixture(join(framework, 'fail-compiler'), 'fail\n');
    const store = join(root, 'store');
    mkdirSync(store);
    const pkg = createPackage(store, 'compile-failure', 'createRoutes',
      'exports.createRoutes = function createRoutes() {};\n');
    writeFixture(join(pkg, 'routes', 'main-routes.js'), 'exports.original = true;\n');

    assert.throws(
      () => rebuildStoreRoutes({ storeRoot: store, frameworkRoot: framework }),
      /Canonical TypeScript compilation failed with exit 9/,
    );
    assert.equal(readFileSync(join(pkg, 'routes', 'main-routes.js'), 'utf8'), 'exports.original = true;\n');
    assert.deepEqual(compilerStages(framework), []);
    assertNoNewTempDirs(beforeTemps);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
