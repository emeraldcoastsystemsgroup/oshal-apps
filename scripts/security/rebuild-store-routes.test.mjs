/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Mutation-resistant behavioral contract for the one-pass store route rebuild, relative module mapping, factory enforcement, rollback, and transient cleanup.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Check-only mode compiles but preserves compiled and legacy routes without factory/output reconciliation.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Pin compare-only parity: it fails and names the file when a committed route stops matching its source, when the committed module is absent, and when a hand-written manifest route stops exporting its factory; it still writes nothing on any of those paths. Entry 2 pinned the opposite - a fixture whose committed bytes and manifest factory both disagreed with the source was asserted to PASS - which is the contract that let a compiled route body be replaced by a throw for exit 0. Zero-comparison runs are refused at each layer that could produce one, and the stale sweep is pinned on both sides: a hand-written module the manifest mounts survives, an unsourced module no manifest names does not.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Pin the staged file set. A package source may import a committed JSON data row beside it, and until this landed the stager copied only .ts, so the WHOLE-store pass exited 2 with TS2307 before it reached any package and every lane read a failure that had nothing to do with its own change. The fake compiler now refuses an unresolved relative import the way tsc does, so a stager that drops a sibling asset fails here the way it failed the store; the staged inventory is asserted exactly, so the same case also proves a package's compiled routes/*.js, its ambient shim and its standalone compiler configuration never enter the shared program.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Accept exact CommonJS shorthand factories on hand-written manifest routes and refuse an undeclared callback-verifier export on public routes. Keep transitively imported hand-written runtime helpers during generated-output synchronization while removing a true orphan.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Pin the stage-leak fix. A run is killed mid-compile (SIGTERM and SIGINT, which on Windows are both a hard kill no listener survives) and its stage and compiler output must be gone within seconds, removed by the run's guardian; a run that finishes leaves no guardian process running and still prints the summary sentence core's compatibility runner reads; the guardian is held to the exact directories it was started for; the sweep's decision matrix is pinned case by case (a dead owner, an owner-less or foreign stage past the bound, a live pid past the ceiling are swept; a live owner, a fresh stage and a link are kept); a rebuild sweeps a leaked stage before staging and names what it kept; and every run prints where it staged. The fake compiler can now hang on request and copies the owner record it sees, and the staged-inventory helper separates the stage's owner record from the package files it pins.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | Pin the two ways a killed run still leaked. A tree kill of the run (taskkill /T /F, the kill core's store-compatibility spec uses; a process-group SIGKILL on POSIX) took the run's own child guardian down with it and left the whole stage: the guardian is now started outside the run's tree and must remove the stage after that kill. A removal killed part way took the owner record first and left an owner-less remainder the sweep kept for an hour: a real guardian, and separately a real run inside its own finally (the fake compiler can now hold until released, then fail), is killed after its first removed entry, the record must survive, and the next rebuild must sweep the remainder at once. A run killed together with its guardian must leave a stage that still names its dead run, which the next rebuild sweeps at once. A guardian must leave once an in-process rebuild has removed both directories, while the calling process is still alive. The kill tests share one hanging-run starter and one cleanup that also stops a surviving guardian and removes leaked compiler output.
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
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostname, tmpdir } from 'node:os';
import {
  OWNED_STAGE_CEILING_MS,
  STAGE_OWNER_FILE,
  UNOWNED_STAGE_STALE_MS,
  rebuildStoreRoutes,
  sweepStaleStages,
} from './rebuild-store-routes.mjs';

const REBUILD_SCRIPT = fileURLToPath(new URL('./rebuild-store-routes.mjs', import.meta.url));

const FAKE_COMPILER = String.raw`
const fs = require('node:fs');
const path = require('node:path');
const framework = process.cwd();
const args = process.argv.slice(2);
const outIndex = args.indexOf('--outDir');
if (outIndex < 0 || !args[outIndex + 1]) process.exit(31);
const outputRoot = path.resolve(args[outIndex + 1]);
fs.appendFileSync(path.join(framework, 'compiler-invocations.log'), 'compile\n');
if (fs.existsSync(path.join(framework, 'hold-compiler'))) {
  fs.writeFileSync(path.join(framework, 'compiler.pid'), String(process.pid));
  while (!fs.existsSync(path.join(framework, 'release-compiler'))) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  fs.rmSync(path.join(framework, 'compiler.pid'));
}
if (fs.existsSync(path.join(framework, 'fail-compiler'))) process.exit(9);
if (fs.existsSync(path.join(framework, 'emit-nothing'))) process.exit(0);
for (const name of fs.readdirSync(path.join(framework, 'src'))) {
  const record = path.join(framework, 'src', name, '.oshal-stage-owner.json');
  if (name.startsWith('__oshal_store_parity_') && fs.existsSync(record)) {
    fs.copyFileSync(record, path.join(framework, 'owner-record.json'));
  }
}
if (fs.existsSync(path.join(framework, 'hang-compiler'))) {
  fs.writeFileSync(path.join(framework, 'compiler.pid'), String(process.pid));
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000);
  process.exit(0);
}
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

test('a hand-written CommonJS route must export both its factory and public callback verifier', () => {
  const root = mkdtempSync(join(tmpdir(), 'store-parity-callback-factory-'));
  try {
    const framework = createFramework(root);
    const store = join(root, 'store');
    mkdirSync(store);
    const pkg = createPackage(store, 'legacy', 'createLegacyRoutes', MAIN_SOURCE, [
      { module: 'routes/legacy-only.js', factory: 'createLegacyOnlyRoutes', auth: 'public',
        callbackVerifier: 'verifyLegacyCallback' },
    ]);
    writeFixture(join(pkg, 'routes', 'main-routes.js'), canonicalOutput(MAIN_SOURCE, 'main-routes.js'));
    const handwritten = 'function createLegacyOnlyRoutes() {}\nfunction verifyLegacyCallback() {}\nmodule.exports = { createLegacyOnlyRoutes, verifyLegacyCallback };\n';
    writeFixture(join(pkg, 'routes', 'legacy-only.js'), handwritten);

    assert.equal(rebuildStoreRoutes({ storeRoot: store, frameworkRoot: framework, checkOnly: true }).comparedOutputs, 1);
    writeFixture(join(pkg, 'routes', 'legacy-only.js'), handwritten.replace('createLegacyOnlyRoutes, ', ''));
    assert.throws(() => rebuildStoreRoutes({ storeRoot: store, frameworkRoot: framework, checkOnly: true }),
      /legacy\/legacy-only\.js: compiled module does not export createLegacyOnlyRoutes/);
    writeFixture(join(pkg, 'routes', 'legacy-only.js'), handwritten.replace(', verifyLegacyCallback', ''));
    assert.throws(() => rebuildStoreRoutes({ storeRoot: store, frameworkRoot: framework, checkOnly: true }),
      /legacy\/legacy-only\.js: compiled module does not export callback verifier verifyLegacyCallback/);
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

test('the stale sweep keeps hand-written JavaScript transitively imported by a mounted route', () => {
  const root = mkdtempSync(join(tmpdir(), 'store-parity-imported-helper-'));
  try {
    const { framework, store, pkg } = createComparableStore(root);
    const mounted = `${LEGACY_ONLY}require('./helper');\n`;
    writeFixture(join(pkg, 'routes', 'legacy-only.js'), mounted);
    writeFixture(join(pkg, 'routes', 'helper.js'), "require('./nested');\n");
    writeFixture(join(pkg, 'routes', 'nested.js'), 'exports.live = true;\n');
    writeFixture(join(pkg, 'routes', 'orphan.js'), 'exports.stale = true;\n');

    const checked = rebuildStoreRoutes({ storeRoot: store, frameworkRoot: framework, checkOnly: true });
    assert.deepEqual(checked.unsourcedModules, [
      'legacy/routes/helper.js (imported by a live route; kept)',
      'legacy/routes/legacy-only.js (mounted by the manifest; kept)',
      'legacy/routes/nested.js (imported by a live route; kept)',
      'legacy/routes/orphan.js (no live route import; a rebuild removes it as stale)',
    ]);
    assert.equal(rebuildStoreRoutes({ storeRoot: store, frameworkRoot: framework }).removedStale, 1);
    assert.equal(readFileSync(join(pkg, 'routes', 'helper.js'), 'utf8'), "require('./nested');\n");
    assert.equal(readFileSync(join(pkg, 'routes', 'nested.js'), 'utf8'), 'exports.live = true;\n');
    assert.equal(existsSync(join(pkg, 'routes', 'orphan.js')), false);
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
 * @param {Array<{module: string, factory: string, auth?: string, callbackVerifier?: string}>} [extraRoutes] - Further manifest routes, used to
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
      `    auth: ${route.auth ?? 'oidc'}`,
      ...(route.callbackVerifier ? [`    callbackVerifier: ${route.callbackVerifier}`] : []),
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
    assert.deepEqual(stagedRootFiles(framework), [STAGE_OWNER_FILE]);
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
 * @description Read the staged tree the fake compiler recorded, as path segments beneath each stage.
 * @param {string} framework - Framework checkout whose fake compiler recorded the staged tree.
 * @returns {string[][]} Segments after the stage directory, framework sources excluded.
 */
function stagedEntries(framework) {
  const staged = JSON.parse(readFileSync(join(framework, 'staged-inventory.json'), 'utf8'));
  return staged
    .filter((name) => name.startsWith('__oshal_store_parity_'))
    .map((name) => name.split('/').slice(1));
}

/**
 * @description List what the stager actually placed in the compiler's program, package-relative.
 * @param {string} framework - Framework checkout whose fake compiler recorded the staged tree.
 * @returns {string[]} Sorted staged paths beneath the single staged package, framework sources excluded.
 */
function stagedPackageFiles(framework) {
  return stagedEntries(framework).filter((segments) => segments.length > 1)
    .map((segments) => segments.slice(1).join('/'));
}

/**
 * @description List the files staged directly in the stage directory rather than under a package.
 * @param {string} framework - Framework checkout whose fake compiler recorded the staged tree.
 * @returns {string[]} Stage-root file names; only the owner record belongs there.
 */
function stagedRootFiles(framework) {
  return stagedEntries(framework).filter((segments) => segments.length === 1).map(([name]) => name);
}

/** @description Resolve after a bounded number of milliseconds. */
function pause(ms) {
  return new Promise((resolveDelay) => { setTimeout(resolveDelay, ms); });
}

/**
 * @description Poll a condition until it holds or a deadline passes.
 * @param {() => boolean} condition - Checked every 100 ms.
 * @param {number} timeoutMs - Upper bound; the test fails on its own assertion after it.
 * @returns {Promise<boolean>} Whether the condition held before the deadline.
 */
async function waitFor(condition, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return true;
    await pause(100);
  }
  return Boolean(condition());
}

/** @description Return the pid of a node process that has already exited. */
function exitedPid() {
  return spawnSync(process.execPath, ['-e', ''], { windowsHide: true }).pid;
}

/** @description Start a node process that stays alive, standing in for a concurrent run. */
function liveProcess() {
  return spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)'], { stdio: 'ignore', windowsHide: true });
}

/** @description Stop a process by pid if it is still running. */
function stopPid(pid) {
  if (!pid) return;
  try { process.kill(pid); } catch (error) { if (error.code !== 'ESRCH') throw error; }
}

/** @description Report whether a pid is still running (signal 0 probes without delivering anything). */
function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

/**
 * @description Remove a fixture tree, retrying while Windows still holds a handle in it (a terminated
 *   process's working directory is released only once the process is gone).
 * @param {string} path - Fixture root.
 * @returns {Promise<void>} Resolves once removed; rejects if the tree is still held after ten seconds.
 */
async function removeTree(path) {
  const deadline = Date.now() + 10000;
  for (;;) {
    try {
      rmSync(path, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error.code) || Date.now() > deadline) throw error;
      await pause(200);
    }
  }
}

/**
 * @description Plant a prefixed stage directory with one staged file and an optional owner record.
 * @param {string} src - Framework src directory.
 * @param {string} name - Directory name, carrying the stage prefix.
 * @param {{pid: number, host: string, ageMs: number} | null} owner - Owner record to write, or none.
 * @param {number} [mtimeAgeMs] - Backdate the directory itself (used when there is no owner record).
 * @returns {string} Absolute stage path.
 */
function plantStage(src, name, owner, mtimeAgeMs = 0) {
  const stage = join(src, name);
  writeFixture(join(stage, 'pkg', 'main-routes.ts'), 'exports.leaked = true;\n');
  if (owner) {
    writeFixture(join(stage, STAGE_OWNER_FILE), JSON.stringify({
      tool: 'rebuild-store-routes', pid: owner.pid, host: owner.host,
      startedAt: new Date(Date.now() - owner.ageMs).toISOString(),
    }));
  }
  const when = (Date.now() - mtimeAgeMs) / 1000;
  utimesSync(stage, when, when);
  return stage;
}

test('the sweep removes stages left by dead, owner-less, foreign and pid-reused runs and keeps every live or fresh one', () => {
  const root = mkdtempSync(join(tmpdir(), 'store-parity-sweep-matrix-'));
  const live = liveProcess();
  try {
    const src = join(root, 'framework', 'src');
    const here = hostname();
    const hour = 60 * 60 * 1000;
    plantStage(src, '__oshal_store_parity_deadOwner', { pid: exitedPid(), host: here, ageMs: 1000 });
    plantStage(src, '__oshal_store_parity_oldNoOwner', null, UNOWNED_STAGE_STALE_MS + hour);
    plantStage(src, '__oshal_store_parity_oldForeign', { pid: live.pid, host: `${here}-elsewhere`, ageMs: UNOWNED_STAGE_STALE_MS + hour });
    plantStage(src, '__oshal_store_parity_pidReused', { pid: live.pid, host: here, ageMs: OWNED_STAGE_CEILING_MS + hour });
    plantStage(src, '__oshal_store_parity_liveFresh', { pid: live.pid, host: here, ageMs: 1000 });
    plantStage(src, '__oshal_store_parity_liveLong', { pid: live.pid, host: here, ageMs: UNOWNED_STAGE_STALE_MS + hour });
    plantStage(src, '__oshal_store_parity_freshNoOwner', null, 0);
    plantStage(src, '__oshal_store_parity_freshForeign', { pid: live.pid, host: `${here}-elsewhere`, ageMs: 1000 });
    writeFixture(join(root, 'outside', 'precious.ts'), 'exports.precious = true;\n');
    // Old enough that a sweep which followed the link would judge the target stale.
    const longAgo = (Date.now() - UNOWNED_STAGE_STALE_MS - hour) / 1000;
    utimesSync(join(root, 'outside'), longAgo, longAgo);
    symlinkSync(join(root, 'outside'), join(src, '__oshal_store_parity_link'), 'junction');
    writeFixture(join(src, 'unrelated', 'core.ts'), 'exports.core = true;\n');
    const lines = [];

    const result = sweepStaleStages(src, { log: (line) => lines.push(line) });

    const names = (entries) => entries.map((entry) => entry.name).sort();
    assert.deepEqual(names(result.swept), ['__oshal_store_parity_deadOwner', '__oshal_store_parity_oldForeign',
      '__oshal_store_parity_oldNoOwner', '__oshal_store_parity_pidReused']);
    assert.deepEqual(names(result.kept), ['__oshal_store_parity_freshForeign', '__oshal_store_parity_freshNoOwner',
      '__oshal_store_parity_link', '__oshal_store_parity_liveFresh', '__oshal_store_parity_liveLong']);
    assert.deepEqual(readdirSync(src).sort(), ['__oshal_store_parity_freshForeign', '__oshal_store_parity_freshNoOwner',
      '__oshal_store_parity_link', '__oshal_store_parity_liveFresh', '__oshal_store_parity_liveLong', 'unrelated']);
    assert.equal(readFileSync(join(root, 'outside', 'precious.ts'), 'utf8'), 'exports.precious = true;\n');
    assert.match(result.swept.find((entry) => entry.name.endsWith('deadOwner')).reason, /is no longer running/);
    assert.match(result.kept.find((entry) => entry.name.endsWith('liveLong')).reason, new RegExp(`pid ${live.pid}\\) is still running`));
    assert.match(result.swept.find((entry) => entry.name.endsWith('pidReused')).reason, /past the 720 min ceiling/);
    assert.equal(lines.length, 9);
    assert.ok(lines.some((line) => /^Swept stale store parity stage .*__oshal_store_parity_oldNoOwner: no owner record, \d+ min old, past the 60 min bound$/.test(line)));
  } finally {
    stopPid(live.pid);
    rmSync(root, { recursive: true, force: true });
  }
});

test('a rebuild sweeps a stage a killed run leaked, keeps a concurrent live run, and says where it staged', async () => {
  const root = mkdtempSync(join(tmpdir(), 'store-parity-sweep-run-'));
  const live = liveProcess();
  try {
    const { framework, store } = createComparableStore(root);
    const src = join(framework, 'src');
    const leaked = plantStage(src, '__oshal_store_parity_leaked', null, UNOWNED_STAGE_STALE_MS + 60000);
    const concurrent = plantStage(src, '__oshal_store_parity_concurrent', { pid: live.pid, host: hostname(), ageMs: 5000 });
    const lines = [];

    const result = rebuildStoreRoutes({ storeRoot: store, frameworkRoot: framework, checkOnly: true, log: (line) => lines.push(line) });

    assert.equal(result.comparedOutputs, 1);
    assert.equal(existsSync(leaked), false);
    assert.equal(existsSync(concurrent), true);
    assert.deepEqual(compilerStages(framework), ['__oshal_store_parity_concurrent']);
    const staged = lines
      .map((line) => /^Staged store route sources in (.+) \(compiler output (.+); removed when this run ends, or by guardian pid (\d+) if the run is killed\)$/.exec(line))
      .filter(Boolean);
    assert.equal(staged.length, 1);
    assert.equal(dirname(staged[0][1]), src);
    assert.match(basename(staged[0][1]), /^__oshal_store_parity_/);
    assert.equal(existsSync(staged[0][1]), false);
    assert.equal(existsSync(staged[0][2]), false);
    // This process is still alive, so the guardian must leave because the run removed both directories.
    assert.ok(await waitFor(() => !pidAlive(Number(staged[0][3])), 5000), `guardian ${staged[0][3]} outlived the rebuild that finished`);
    const owner = JSON.parse(readFileSync(join(framework, 'owner-record.json'), 'utf8'));
    assert.equal(owner.tool, 'rebuild-store-routes');
    assert.equal(owner.host, hostname());
    assert.ok([process.pid, live.pid].includes(owner.pid));
    assert.ok(lines.some((line) => line.startsWith(`Swept stale store parity stage ${leaked}: no owner record`)));
    assert.ok(lines.includes(`Left store parity stage ${concurrent} in place: its run (pid ${live.pid}) is still running`));
  } finally {
    stopPid(live.pid);
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * @description Start the rebuild CLI with a hanging compiler and wait until it is compiling.
 * @param {object} run - Filled in step by step (child, exited, framework, store, pidFile, stage, output,
 *   guardianPid, stageExistedBeforeKill) so stopHangingRun can clean up after a failed assertion here.
 * @param {string} root - Fixture root.
 * @param {{detached?: boolean, build?: (root: string) => {framework: string, store: string}, flags?: string[]}} [options] -
 *   detached makes the run lead its own process group, which the POSIX process-group kill needs; build
 *   creates the framework and store; flags are the fake-compiler switches written into the framework.
 * @returns {Promise<void>} Resolves once the stage exists and the compiler is hanging.
 */
async function startHangingRun(run, root, { detached = false, build = createComparableStore, flags = ['hang-compiler'] } = {}) {
  Object.assign(run, build(root), { stdout: '' });
  run.pidFile = join(run.framework, 'compiler.pid');
  for (const flag of flags) writeFixture(join(run.framework, flag), 'on\n');
  run.child = spawn(process.execPath, [REBUILD_SCRIPT, '--store', run.store, '--framework', run.framework, '--check-only'],
    { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached });
  run.child.stdout.on('data', (chunk) => { run.stdout += chunk; });
  run.child.stderr.on('data', (chunk) => { run.stdout += chunk; });
  run.exited = new Promise((resolveExit) => { run.child.on('exit', resolveExit); });
  const staged = () => /Staged store route sources in (.+) \(compiler output (.+?); .*guardian pid (\d+) if the run is killed/.exec(run.stdout);
  assert.ok(await waitFor(() => staged() && existsSync(run.pidFile), 20000), `run never reached its compile: ${run.stdout}`);
  const [, stage, output, guardian] = staged();
  Object.assign(run, { stage, output, guardianPid: Number(guardian) });
  run.stageExistedBeforeKill = existsSync(join(stage, STAGE_OWNER_FILE)) && existsSync(output);
}

/**
 * @description Stop whatever a hanging run left running, then remove its fixture. After a failed assertion
 *   the run, its hanging compiler (whose working directory is inside the fixture) and its guardian may
 *   still be alive, and a run killed with its guardian leaks its compiler output into the OS temp directory.
 * @param {object} run - What startHangingRun filled in, possibly only in part.
 * @param {string} root - Fixture root.
 * @returns {Promise<void>} Resolves once the fixture is removed.
 */
async function stopHangingRun(run, root) {
  if (run.child && run.child.exitCode === null && run.child.signalCode === null) {
    run.child.kill();
    await run.exited;
  }
  const compilerPid = run.pidFile && existsSync(run.pidFile) ? Number(readFileSync(run.pidFile, 'utf8')) : 0;
  stopPid(compilerPid);
  await waitFor(() => !compilerPid || !pidAlive(compilerPid), 10000);
  if (run.guardianPid && !(await waitFor(() => !pidAlive(run.guardianPid), 5000))) stopPid(run.guardianPid);
  if (run.output) rmSync(run.output, { recursive: true, force: true });
  await removeTree(root);
}

/**
 * @description Kill a process and every process descended from it, the way a tree killer does:
 *   taskkill /T /F on Windows (the kill core's store-compatibility spec uses), a SIGKILL to the whole
 *   process group elsewhere.
 * @param {number} pid - Root of the tree (a process-group leader on POSIX).
 * @returns {void}
 */
function killProcessTree(pid) {
  if (process.platform !== 'win32') {
    process.kill(-pid, 'SIGKILL');
    return;
  }
  const result = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  assert.equal(result.status, 0, `taskkill failed: ${result.stdout}${result.stderr}`);
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  test(`a run killed mid-compile with ${signal} leaves no stage and no compiler output behind`, async () => {
    const root = mkdtempSync(join(tmpdir(), 'store-parity-killed-'));
    const run = {};
    try {
      await startHangingRun(run, root);
      assert.equal(run.stageExistedBeforeKill, true, 'the kill must land while the stage exists, or the test proves nothing');
      run.child.kill(signal);
      await run.exited;
      assert.ok(await waitFor(() => !existsSync(run.stage) && !existsSync(run.output), 15000),
        `stage ${run.stage} or output ${run.output} survived the killed run`);
    } finally {
      await stopHangingRun(run, root);
    }
  });
}

test('a kill of the run\'s whole process tree does not reach its guardian, which still removes the stage', async () => {
  const root = mkdtempSync(join(tmpdir(), 'store-parity-tree-killed-'));
  const run = {};
  try {
    await startHangingRun(run, root, { detached: process.platform !== 'win32' });
    assert.equal(run.stageExistedBeforeKill, true, 'the kill must land while the stage exists, or the test proves nothing');
    killProcessTree(run.child.pid);
    await run.exited;
    assert.ok(await waitFor(() => !existsSync(run.stage) && !existsSync(run.output), 15000),
      `stage ${run.stage} or output ${run.output} survived a tree kill of its run`);
  } finally {
    await stopHangingRun(run, root);
  }
});

test('a run killed together with its guardian leaves a stage that names its dead run, and the next rebuild sweeps it at once', async () => {
  const root = mkdtempSync(join(tmpdir(), 'store-parity-both-killed-'));
  const run = {};
  try {
    await startHangingRun(run, root);
    process.kill(run.guardianPid, 'SIGKILL');
    assert.ok(await waitFor(() => !pidAlive(run.guardianPid), 10000), `guardian ${run.guardianPid} survived its kill`);
    run.child.kill('SIGKILL');
    await run.exited;
    await pause(1500);
    assert.equal(existsSync(join(run.stage, STAGE_OWNER_FILE)), true, 'with its guardian dead the stage must still be there, record and all');
    rmSync(join(run.framework, 'hang-compiler'));
    const lines = [];

    const result = rebuildStoreRoutes({ storeRoot: run.store, frameworkRoot: run.framework, checkOnly: true, log: (line) => lines.push(line) });

    assert.equal(result.comparedOutputs, 1);
    assert.equal(existsSync(run.stage), false, `the next rebuild left ${run.stage} in place`);
    assert.ok(lines.includes(`Swept stale store parity stage ${run.stage}: its run (pid ${run.child.pid}) is no longer running`),
      lines.join('\n'));
  } finally {
    await stopHangingRun(run, root);
  }
});

/** @description Count a directory's entries, or 0 once it is gone. */
function entryCount(directory) {
  try { return readdirSync(directory).length; } catch (error) { if (error.code === 'ENOENT') return 0; throw error; }
}

/**
 * @description Wait, without yielding, until a removal has taken its first entry from a directory, so the
 *   kill that follows lands part way through the removal rather than after the whole tree is gone.
 * @param {string} directory - Directory being removed by another process.
 * @param {number} planted - Its entry count before the removal started.
 * @returns {void}
 */
function spinUntilRemovalStarts(directory, planted) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline && entryCount(directory) === planted) { /* spin */ }
}

/**
 * @description Assert a removal was cut short with the owner record still in the stage, then that the next
 *   rebuild sweeps the remainder at once because the record names a run that is no longer running.
 * @param {{stage: string, planted: number, deadPid: number, framework: string, store: string}} evidence - The
 *   interrupted stage, its entry count before the removal, the dead run's pid and the fixture it lives in.
 * @returns {void}
 */
function assertInterruptedRemovalSwept({ stage, planted, deadPid, framework, store }) {
  const remaining = entryCount(stage);
  assert.ok(remaining > 1 && remaining < planted, `the kill must land part way through the removal (${remaining} of ${planted} entries left)`);
  assert.equal(existsSync(join(stage, STAGE_OWNER_FILE)), true, 'the interrupted removal took the owner record');
  const lines = [];
  rebuildStoreRoutes({ storeRoot: store, frameworkRoot: framework, log: (line) => lines.push(line) });
  assert.equal(existsSync(stage), false, `the next rebuild left ${stage} in place`);
  assert.ok(lines.includes(`Swept stale store parity stage ${stage}: its run (pid ${deadPid}) is no longer running`), lines.join('\n'));
}

test('a guardian killed part way through removing a stage leaves the owner record, so the next rebuild sweeps the rest at once', async () => {
  const root = mkdtempSync(join(tmpdir(), 'store-parity-interrupted-'));
  let guardian;
  try {
    const { framework, store } = createComparableStore(root);
    const deadPid = exitedPid();
    const stage = plantStage(join(framework, 'src'), '__oshal_store_parity_interrupted', { pid: deadPid, host: hostname(), ageMs: 1000 });
    for (let pkg = 0; pkg < 24; pkg += 1) {
      for (let file = 0; file < 100; file += 1) writeFixture(join(stage, `pkg${pkg}`, `route${file}.ts`), 'exports.leaked = true;\n');
    }
    const planted = entryCount(stage);
    guardian = spawn(process.execPath, [REBUILD_SCRIPT, '--guard-stage', String(deadPid), stage, join(root, 'not-an-output')],
      { stdio: 'ignore', windowsHide: true });
    const guardianExited = new Promise((resolveExit) => { guardian.on('exit', resolveExit); });
    spinUntilRemovalStarts(stage, planted);
    guardian.kill('SIGKILL');
    await guardianExited;
    assertInterruptedRemovalSwept({ stage, planted, deadPid, framework, store });
  } finally {
    if (guardian && guardian.exitCode === null && guardian.signalCode === null) guardian.kill();
    await removeTree(root);
  }
});

/** @description Build a store of 24 packages with 41 sources each, so removing its stage takes long enough to cut short. */
function createWideStore(root) {
  const framework = createFramework(root);
  const store = join(root, 'store');
  for (let pkg = 0; pkg < 24; pkg += 1) {
    const packageRoot = createPackage(store, `pkg${pkg}`, 'createLegacyRoutes', MAIN_SOURCE);
    for (let file = 0; file < 40; file += 1) writeFixture(join(packageRoot, 'src-routes', `helper${file}.ts`), 'exports.helper = true;\n');
  }
  return { framework, store };
}

test('a run killed part way through removing its own stage leaves the owner record, so the next rebuild sweeps the rest at once', async () => {
  const root = mkdtempSync(join(tmpdir(), 'store-parity-close-interrupted-'));
  const run = {};
  try {
    // The compiler holds until released, then fails, so the run's own finally removes the stage.
    await startHangingRun(run, root, { build: createWideStore, flags: ['hold-compiler', 'fail-compiler'] });
    process.kill(run.guardianPid, 'SIGKILL');
    assert.ok(await waitFor(() => !pidAlive(run.guardianPid), 10000), `guardian ${run.guardianPid} survived its kill`);
    const planted = entryCount(run.stage);
    writeFixture(join(run.framework, 'release-compiler'), 'go\n');
    spinUntilRemovalStarts(run.stage, planted);
    run.child.kill('SIGKILL');
    await run.exited;
    for (const flag of ['hold-compiler', 'fail-compiler', 'release-compiler']) rmSync(join(run.framework, flag));
    assertInterruptedRemovalSwept({ stage: run.stage, planted, deadPid: run.child.pid, framework: run.framework, store: run.store });
  } finally {
    await stopHangingRun(run, root);
  }
});

test('a finished run leaves neither its stage nor its guardian behind, and still prints the summary core reads', async () => {
  const root = mkdtempSync(join(tmpdir(), 'store-parity-finished-'));
  try {
    const { framework, store } = createComparableStore(root);
    const result = spawnSync(process.execPath, [REBUILD_SCRIPT, '--store', store, '--framework', framework, '--check-only'],
      { encoding: 'utf8', windowsHide: true, timeout: 60000 });
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    // core scripts/check-store-compatibility.mjs greps the run log for this sentence.
    assert.match(result.stdout, /^Canonical store compatibility passed: 1 sources across 1 packages/m);
    const guardian = Number(/by guardian pid (\d+) if the run is killed/.exec(result.stdout)?.[1]);
    assert.ok(guardian > 0, `no guardian was named: ${result.stdout}`);
    assert.ok(await waitFor(() => !pidAlive(guardian), 5000), `guardian ${guardian} outlived its finished run`);
    assert.deepEqual(compilerStages(framework), []);
  } finally {
    await removeTree(root);
  }
});

test('a guardian removes only the stage and compiler output its dead run owned', () => {
  const root = mkdtempSync(join(tmpdir(), 'store-parity-guardian-'));
  const decoyOutput = mkdtempSync(join(root, 'oshal-store-parity-'));
  const owned = mkdtempSync(join(tmpdir(), 'oshal-store-parity-'));
  const guard = (stage, output, pid) => spawnSync(process.execPath, [REBUILD_SCRIPT, '--guard-stage', pid, stage, output],
    { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  try {
    const src = join(root, 'framework', 'src');
    const dead = exitedPid();
    const other = plantStage(src, '__oshal_store_parity_otherOwner', { pid: dead + 1, host: hostname(), ageMs: 1000 });
    const unprefixed = plantStage(src, 'not_a_parity_stage', { pid: dead, host: hostname(), ageMs: 1000 });
    const stage = plantStage(src, '__oshal_store_parity_mine', { pid: dead, host: hostname(), ageMs: 1000 });

    assert.equal(guard(other, decoyOutput, String(dead)).status, 0);
    assert.equal(guard(unprefixed, decoyOutput, String(dead)).status, 0);
    assert.equal(existsSync(other), true, 'a stage whose owner record names another pid was removed');
    assert.equal(existsSync(unprefixed), true, 'a directory without the stage prefix was removed');
    assert.equal(existsSync(decoyOutput), true, 'an output directory outside the OS temp directory was removed');
    assert.equal(existsSync(owned), true);
    assert.equal(guard(stage, owned, 'not-a-pid').status, 2);
    assert.equal(existsSync(stage), true, 'a guardian with no valid pid removed something');

    assert.equal(guard(stage, owned, String(dead)).status, 0);
    assert.equal(existsSync(stage), false, 'the stage the dead run owned survived its guardian');
    assert.equal(existsSync(owned), false, 'the compiler output the dead run owned survived its guardian');
  } finally {
    rmSync(owned, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});
