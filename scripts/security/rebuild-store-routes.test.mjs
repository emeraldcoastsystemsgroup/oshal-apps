/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Mutation-resistant behavioral contract for the one-pass store route rebuild, relative module mapping, factory enforcement, rollback, and transient cleanup.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Check-only mode compiles but preserves compiled and legacy routes without factory/output reconciliation.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Pin compare-only parity: it fails and names the file when a committed route stops matching its source, when the committed module is absent, and when a hand-written manifest route stops exporting its factory; it still writes nothing on any of those paths. Entry 2 pinned the opposite - a fixture whose committed bytes and manifest factory both disagreed with the source was asserted to PASS - which is the contract that let a compiled route body be replaced by a throw for exit 0. Zero-comparison runs are refused at each layer that could produce one, and the stale sweep is pinned on both sides: a hand-written module the manifest mounts survives, an unsourced module no manifest names does not.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Pin the staged file set. A package source may import a committed JSON data row beside it, and until this landed the stager copied only .ts, so the WHOLE-store pass exited 2 with TS2307 before it reached any package and every lane read a failure that had nothing to do with its own change. The fake compiler now refuses an unresolved relative import the way tsc does, so a stager that drops a sibling asset fails here the way it failed the store; the staged inventory is asserted exactly, so the same case also proves a package's compiled routes/*.js, its ambient shim and its standalone compiler configuration never enter the shared program.
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
if (fs.existsSync(path.join(framework, 'emit-nothing'))) process.exit(0);
function walk(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const candidate = path.join(root, entry.name);
    return entry.isDirectory() ? walk(candidate) : [candidate];
  });
}
const sourceRoot = path.join(framework, 'src');
const staged = walk(sourceRoot).map((file) => path.relative(sourceRoot, file).split(path.sep).join('/')).sort();
fs.writeFileSync(path.join(framework, 'staged-inventory.json'), JSON.stringify(staged, null, 2));
for (const source of walk(sourceRoot)) {
  if (!source.endsWith('.ts') || source.endsWith('.d.ts')) continue;
  const body = fs.readFileSync(source, 'utf8');
  for (const match of body.matchAll(/\bfrom\s*['"](\.[^'"]+)['"]/g)) {
    const request = match[1];
    const target = path.resolve(path.dirname(source), request);
    const candidates = path.extname(request) ? [target] : [target + '.ts', path.join(target, 'index.ts')];
    if (candidates.some((candidate) => fs.existsSync(candidate))) continue;
    const where = path.relative(framework, source).split(path.sep).join('/');
    const line = body.slice(0, match.index).split('\n').length;
    process.stderr.write(where + '(' + line + ',1): error TS2307: Cannot find module \'' + request + '\' or its corresponding type declarations.\n');
    process.exit(2);
  }
  const relative = path.relative(sourceRoot, source).replace(/\.ts$/, '.js');
  const destination = path.join(outputRoot, relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, body.replace(/\r?\n$/, '') + '\n//# sourceMappingURL=' + path.basename(destination) + '.map');
}
`;

const MAIN_SOURCE = 'exports.createLegacyRoutes = function createLegacyRoutes() {};\n';
const LEGACY_ONLY = 'exports.createLegacyOnlyRoutes = function createLegacyOnlyRoutes() {};\n';

/**
 * @description Reproduce the bytes the fake canonical compiler emits for one staged source.
 * @param {string} sourceBody - Exact TypeScript fixture body that will be staged and compiled.
 * @param {string} outputName - Emitted file name, which the compiler names in its map comment.
 * @returns {string} The only committed content compare-only mode may accept for that source.
 */
function canonicalOutput(sourceBody, outputName) {
  return `${sourceBody.replace(/\r?\n$/, '')}\n//# sourceMappingURL=${outputName}.map`;
}

/** @description Build the one store shape compare-only mode must accept, legacy route included. */
function createComparableStore(root) {
  const framework = createFramework(root);
  const store = join(root, 'store');
  mkdirSync(store);
  const pkg = createPackage(store, 'legacy', 'createLegacyRoutes', MAIN_SOURCE, [
    { module: 'routes/legacy-only.js', factory: 'createLegacyOnlyRoutes' },
  ]);
  writeFixture(join(pkg, 'routes', 'main-routes.js'), canonicalOutput(MAIN_SOURCE, 'main-routes.js'));
  writeFixture(join(pkg, 'routes', 'legacy-only.js'), LEGACY_ONLY);
  return { framework, store, pkg };
}

test('compare-only accepts committed bytes that match the source and names the module no source emits', () => {
  const root = mkdtempSync(join(tmpdir(), 'store-parity-check-'));
  try {
    const { framework, store, pkg } = createComparableStore(root);
    const result = rebuildStoreRoutes({ storeRoot: store, frameworkRoot: framework, checkOnly: true });
    assert.equal(result.sources, 1);
    assert.equal(result.comparedOutputs, 1);
    assert.deepEqual(result.unsourcedModules, ['legacy/routes/legacy-only.js (mounted by the manifest; kept)']);
    assert.equal(readFileSync(join(framework, 'compiler-invocations.log'), 'utf8'), 'compile\n');
    assert.equal(readFileSync(join(pkg, 'routes', 'main-routes.js'), 'utf8'), canonicalOutput(MAIN_SOURCE, 'main-routes.js'));
    assert.equal(readFileSync(join(pkg, 'routes', 'legacy-only.js'), 'utf8'), LEGACY_ONLY);
    assert.deepEqual(compilerStages(framework), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('compare-only names the committed route whose body stopped matching its source, and writes nothing', () => {
  const root = mkdtempSync(join(tmpdir(), 'store-parity-drift-'));
  try {
    const { framework, store, pkg } = createComparableStore(root);
    const mutated = 'throw new Error("this compiled route no longer matches its source");\n';
    writeFixture(join(pkg, 'routes', 'main-routes.js'), mutated);

    assert.throws(
      () => rebuildStoreRoutes({ storeRoot: store, frameworkRoot: framework, checkOnly: true }),
      /legacy\/routes\/main-routes\.js: line 1 differs: committed "throw new Error[\s\S]*source emits "exports\.createLegacyRoutes/,
    );
    assert.equal(readFileSync(join(pkg, 'routes', 'main-routes.js'), 'utf8'), mutated);
    assert.deepEqual(compilerStages(framework), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('compare-only refuses a source whose committed module the repository does not carry', () => {
  const root = mkdtempSync(join(tmpdir(), 'store-parity-absent-'));
  try {
    const { framework, store, pkg } = createComparableStore(root);
    rmSync(join(pkg, 'routes', 'main-routes.js'));

    assert.throws(
      () => rebuildStoreRoutes({ storeRoot: store, frameworkRoot: framework, checkOnly: true }),
      /legacy\/routes\/main-routes\.js: this source emits a module the repository does not carry/,
    );
    assert.equal(existsSync(join(pkg, 'routes', 'main-routes.js')), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a hand-written manifest route is checked for its factory rather than waved through', () => {
  const root = mkdtempSync(join(tmpdir(), 'store-parity-legacy-factory-'));
  try {
    const { framework, store, pkg } = createComparableStore(root);
    writeFixture(join(pkg, 'routes', 'legacy-only.js'), 'exports.createSomethingElse = function() {};\n');

    assert.throws(
      () => rebuildStoreRoutes({ storeRoot: store, frameworkRoot: framework, checkOnly: true }),
      /legacy\/legacy-only\.js: compiled module does not export createLegacyOnlyRoutes/,
    );
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a manifest route with neither a source nor a committed module is refused, not excluded', () => {
  const root = mkdtempSync(join(tmpdir(), 'store-parity-phantom-'));
  try {
    const { framework, store, pkg } = createComparableStore(root);
    rmSync(join(pkg, 'routes', 'legacy-only.js'));

    assert.throws(
      () => rebuildStoreRoutes({ storeRoot: store, frameworkRoot: framework, checkOnly: true }),
      /manifest route routes\/legacy-only\.js has neither a canonical source nor a committed module/,
    );
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('no compare-only run can report a pass having compared nothing', () => {
  const root = mkdtempSync(join(tmpdir(), 'store-parity-vacuous-'));
  try {
    const framework = createFramework(root);
    const emptyStore = join(root, 'empty-store');
    mkdirSync(emptyStore);
    assert.throws(
      () => rebuildStoreRoutes({ storeRoot: emptyStore, frameworkRoot: framework, checkOnly: true }),
      /No source-bearing store packages discovered/,
    );

    const declarationsOnly = join(root, 'declarations-store');
    mkdirSync(declarationsOnly);
    const shim = join(declarationsOnly, 'shim');
    writeFixture(join(shim, 'oshal-app.yaml'), 'name: shim\nroutes: []\n');
    writeFixture(join(shim, 'src-routes', 'core-modules.d.ts'), 'declare module "@/shared" {}\n');
    assert.throws(
      () => rebuildStoreRoutes({ storeRoot: declarationsOnly, frameworkRoot: framework, checkOnly: true }),
      /shim: src-routes has no emitting TypeScript source/,
    );

    const silentStore = join(root, 'silent-store');
    mkdirSync(silentStore);
    const silent = createPackage(silentStore, 'silent', 'createLegacyRoutes', MAIN_SOURCE);
    writeFixture(join(silent, 'routes', 'main-routes.js'), canonicalOutput(MAIN_SOURCE, 'main-routes.js'));
    writeFixture(join(framework, 'emit-nothing'), 'yes\n');
    assert.throws(
      () => rebuildStoreRoutes({ storeRoot: silentStore, frameworkRoot: framework, checkOnly: true }),
      /silent: compiler output mismatch; missing=\["main-routes\.js"\]/,
    );
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the stale sweep keeps a hand-written module the manifest mounts and removes one it does not', () => {
  const root = mkdtempSync(join(tmpdir(), 'store-parity-sweep-'));
  try {
    const { framework, store, pkg } = createComparableStore(root);
    writeFixture(join(pkg, 'routes', 'orphan.js'), 'exports.orphan = true;\n');

    const summary = rebuildStoreRoutes({ storeRoot: store, frameworkRoot: framework });

    assert.deepEqual(summary, { packages: 1, sources: 1, removedStale: 1 });
    assert.equal(readFileSync(join(pkg, 'routes', 'legacy-only.js'), 'utf8'), LEGACY_ONLY);
    assert.equal(existsSync(join(pkg, 'routes', 'orphan.js')), false);
    assert.equal(readFileSync(join(store, 'legacy', 'routes', 'main-routes.js'), 'utf8'),
      canonicalOutput(MAIN_SOURCE, 'main-routes.js'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

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

/**
 * @description Create one source-bearing store package and its explicit manifest routes.
 * @param {string} store - Store root the package directory is created beneath.
 * @param {string} name - Package directory and manifest name.
 * @param {string} factory - Factory the manifest declares for the compiled main route.
 * @param {string} sourceBody - TypeScript body written to src-routes/main-routes.ts.
 * @param {Array<{module: string, factory: string}>} [extraRoutes] - Further manifest routes, used to
 *   declare a hand-written module no TypeScript source emits.
 * @returns {string} Absolute package root.
 */
function createPackage(store, name, factory, sourceBody, extraRoutes = []) {
  const packageRoot = join(store, name);
  const manifest = [
    `name: ${name}`,
    'routes:',
    '  - module: routes/main-routes.js',
    `    factory: ${factory}`,
    `    mountPath: /api/${name}`,
    '    auth: oidc',
    ...extraRoutes.flatMap((route, index) => [
      `  - module: ${route.module}`,
      `    factory: ${route.factory}`,
      `    mountPath: /api/${name}/extra-${index}`,
      '    auth: oidc',
    ]),
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

test('a package JSON asset reaches the shared compile while its build output, shim and compiler config never do', () => {
  const root = mkdtempSync(join(tmpdir(), 'store-parity-assets-'));
  const beforeTemps = parityTempDirs();
  try {
    const framework = createFramework(root);
    const store = join(root, 'store');
    mkdirSync(store);
    const pkg = createPackage(store, 'assets', 'createAssetsRoutes',
      "import table from './data/table.json';\nexports.createAssetsRoutes = function createAssetsRoutes() { return table; };\n");
    writeFixture(join(pkg, 'src-routes', 'data', 'table.json'), '{"medium":"seawater"}\n');
    writeFixture(join(pkg, 'src-routes', 'tsconfig.json'), '{"compilerOptions":{"sourceMap":false}}\n');
    writeFixture(join(pkg, 'src-routes', 'package.json'), '{"type":"module"}\n');
    writeFixture(join(pkg, 'src-routes', 'core-modules.d.ts'), 'declare module "@/shared" {}\n');
    writeFixture(join(pkg, 'routes', 'main-routes.js'), 'exports.superseded = true;\n');
    writeFixture(join(pkg, 'routes', 'data', 'table.json'), '{"medium":"seawater"}\n');

    const summary = rebuildStoreRoutes({ storeRoot: store, frameworkRoot: framework });

    assert.deepEqual(summary, { packages: 1, sources: 1, removedStale: 0 });
    assert.deepEqual(stagedPackageFiles(framework), ['data/table.json', 'main-routes.ts']);
    const compiled = readFileSync(join(pkg, 'routes', 'main-routes.js'), 'utf8');
    assert.match(compiled, /from '\.\/data\/table\.json'/);
    assert.doesNotMatch(compiled, /sourceMappingURL/);
    assert.equal(readFileSync(join(pkg, 'routes', 'data', 'table.json'), 'utf8'), '{"medium":"seawater"}\n');
    assert.deepEqual(compilerStages(framework), []);
    assertNoNewTempDirs(beforeTemps);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * @description List what the stager actually placed in the compiler's program, package-relative.
 * @param {string} framework - Framework checkout whose fake compiler recorded the staged tree.
 * @returns {string[]} Sorted staged paths beneath the single staged package, framework sources excluded.
 */
function stagedPackageFiles(framework) {
  const staged = JSON.parse(readFileSync(join(framework, 'staged-inventory.json'), 'utf8'));
  return staged
    .filter((name) => name.startsWith('__oshal_store_parity_'))
    .map((name) => name.split('/').slice(2).join('/'));
}
