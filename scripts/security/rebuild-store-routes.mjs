#!/usr/bin/env node
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Rebuild every source-bearing store package with one canonical framework compiler pass, verify exact source/output and manifest-factory parity, and clean transient state on every outcome.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Exclude package-only ambient declaration shims from the framework program so they cannot globally replace the canonical core module types.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Preserve the framework source-map emit setting so canonical rebuilding does not create repository-wide generated-comment churn.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Honor package-local source-map formatting while retaining one shared type-check/emit program.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Avoid rewriting byte-different but Git-equivalent CRLF outputs on Windows while still replacing meaningful generated drift.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Add compile-only compatibility mode; preserve legacy JavaScript routes and never synchronize outputs in this mode.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | Expose the unchanged package compiler-output policy so readiness contracts compare exact expected bytes without duplicating formatting rules.
 * 8 | maintainer@emeraldcoastsystemsgroup.com | Stage the JSON a package's TypeScript imports, not only the TypeScript. A source may sit beside a committed data row (embodied/src-routes/engine/medium/medium-properties.json), and staging only .ts left that import unresolvable, so the shared program exited 2 with TS2307 before reaching any package: every lane got a whole-store failure unrelated to its own change and went back to compiling package-scoped copies by hand. JSON is the only non-TypeScript module a stock framework program resolves (resolveJsonModule), so the stager copies by that closed extension rather than mirroring the package directory - a mirror would carry the package's own compiled routes/*.js into the program and let build output shadow the sources this pass exists to verify.
 * 9 | maintainer@emeraldcoastsystemsgroup.com | Compare the committed route bytes with the canonical rebuild in compare-only mode, and stop refusing a package that keeps a hand-written manifest route. Until this landed --check-only proved only that the store type-checks in one shared program: a compiled route whose entire body was replaced by a throw, and a renamed manifest factory export, both exited 0, and only full write mode rewrote the file. Write mode could not be that gate either - it refused the whole store at the first package whose manifest names a module no TypeScript source emits (dnd, game-show and hello-oshal each keep one), so those three packages had never been regenerated and carried seven modules that did not match their sources. Such a module is live, not orphaned: its factory is now verified against the committed file and the stale sweep keeps it, while an unsourced module no manifest names is still removed. The comparison adds no normalization of its own - it applies exactly what write mode applies, the package-local sourceMappingURL policy in normalizeCompilerOutput on the expected side and the Git-equivalent CRLF fold in generatedTextMatches on both - so a tree this mode calls clean is a tree write mode would not rewrite. Every committed module no source emits is named in the run output rather than silently skipped, and a run that compared nothing fails instead of reporting a vacuous pass.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, posix, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseManifestRoutes } from './check-store-security.mjs';

const STAGE_PREFIX = '__oshal_store_parity_';
const TYPESCRIPT_SOURCE = /\.(?:ts|tsx)$/;
const DECLARATION_SOURCE = /\.d\.ts$/;
// The only non-TypeScript module a stock framework program resolves is JSON (resolveJsonModule).
// Staging by this closed extension - never by mirroring the package directory - is what keeps a
// package's own compiled routes/*.js out of the program, where it could shadow its own sources.
const STAGED_ASSET_SOURCE = /\.json$/i;
// ...except the JSON that tooling reads and no module imports. tsconfig/jsconfig configure a
// package's standalone compiler and mean nothing to the shared program; a package.json staged
// beneath framework/src would redefine the module system (Node16 resolution reads the nearest
// package.json "type") for every file staged under it.
const PACKAGE_TOOLING_CONFIG = /^(?:package|(?:ts|js)config(?:\.[^.]+)*)\.json$/i;

/** @description Return a stable recursively sorted file list and refuse symlinks at the source boundary. */
function filesRecursively(root, predicate = () => true) {
  if (!existsSync(root)) return [];
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const candidate = join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symbolic links are not allowed in canonical route sources: ${candidate}`);
    if (entry.isDirectory()) files.push(...filesRecursively(candidate, predicate));
    else if (entry.isFile() && predicate(candidate)) files.push(candidate);
  }
  return files.sort();
}

/** @description Convert a source-relative TypeScript path to its canonical compiled JavaScript path. */
function outputRelative(sourceRoot, source) {
  return relative(sourceRoot, source).split(sep).join('/').replace(/\.(?:ts|tsx)$/, '.js');
}

/** @description Discover packages using the same top-level manifest boundary as the store loader. */
function discoverPackages(storeRoot) {
  const packages = [];
  for (const entry of readdirSync(storeRoot, { withFileTypes: true })) {
    const packageDir = join(storeRoot, entry.name);
    const sourceRoot = join(packageDir, 'src-routes');
    if (!entry.isDirectory() || !existsSync(join(packageDir, 'oshal-app.yaml')) || !existsSync(sourceRoot)) continue;
    const allFiles = filesRecursively(sourceRoot);
    const emittingSources = allFiles.filter((file) => TYPESCRIPT_SOURCE.test(file) && !DECLARATION_SOURCE.test(file));
    if (emittingSources.length === 0) throw new Error(`${entry.name}: src-routes has no emitting TypeScript source`);
    const assetSources = allFiles.filter((file) =>
      STAGED_ASSET_SOURCE.test(file) && !PACKAGE_TOOLING_CONFIG.test(basename(file)));
    packages.push({ name: entry.name, packageDir, sourceRoot, emittingSources, assetSources });
  }
  return packages.sort((left, right) => left.name.localeCompare(right.name));
}

/** @description Build an exact source-to-output map and reject two sources targeting one file. */
function expectedOutputs(pkg) {
  const expected = new Map();
  for (const source of pkg.emittingSources) {
    const output = outputRelative(pkg.sourceRoot, source);
    if (expected.has(output)) throw new Error(`${pkg.name}: multiple sources emit ${output}`);
    expected.set(output, source);
  }
  return expected;
}

/** @description Copy emitting sources and their imported JSON beneath a collision-free root, omitting standalone ambient shims. */
function stagePackage(pkg, stageRoot) {
  const packageStage = join(stageRoot, pkg.name);
  // Package-local core-modules.d.ts files support standalone package compilers. In the canonical
  // framework program they would be global module augmentations and could weaken/replace core types.
  for (const source of [...pkg.emittingSources, ...pkg.assetSources]) {
    const rel = relative(pkg.sourceRoot, source);
    const destination = join(packageStage, rel);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(source, destination);
  }
}

/** @description Invoke the locked framework compiler exactly once for every staged package. */
function compileOnce(frameworkRoot, outputRoot) {
  const compiler = join(frameworkRoot, 'node_modules', 'typescript', 'bin', 'tsc');
  const args = [compiler, '-p', 'tsconfig.json', '--outDir', outputRoot,
    '--declaration', 'false', '--declarationMap', 'false', '--pretty', 'false'];
  const result = spawnSync(process.execPath, args, {
    cwd: frameworkRoot,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`Canonical TypeScript compilation failed with exit ${result.status}${detail ? `\n${detail}` : ''}`);
  }
}

/** @description Resolve a compiled relative require to a package-local emitted module. */
function resolveRelativeRequire(fromOutput, request, available) {
  const resolved = posix.normalize(posix.join(posix.dirname(fromOutput), request));
  if (posix.isAbsolute(resolved) || resolved === '..' || resolved.startsWith('../')) return null;
  const candidates = posix.extname(resolved) ? [resolved] : [`${resolved}.js`, `${resolved}/index.js`];
  return candidates.find((candidate) => available.has(candidate)) ?? null;
}

/** @description Resolve a non-generated relative require to an existing contained package file. */
function resolvePackageRuntimeRequire(pkg, fromOutput, request) {
  const outputFile = join(pkg.packageDir, 'routes', ...fromOutput.split('/'));
  const requested = resolve(dirname(outputFile), request);
  const rel = relative(pkg.packageDir, requested);
  if (rel === '..' || rel.startsWith(`..${sep}`)) return null;
  const candidates = posix.extname(request) ? [requested] : [
    requested,
    `${requested}.js`,
    `${requested}.json`,
    join(requested, 'index.js'),
    join(requested, 'index.json'),
  ];
  for (const candidate of candidates) {
    if (!existsSync(candidate) || !statSync(candidate).isFile()) continue;
    const real = realpathSync(candidate);
    const realRel = relative(realpathSync(pkg.packageDir), real);
    if (realRel !== '..' && !realRel.startsWith(`..${sep}`)) return candidate;
  }
  return null;
}

/** @description Prove every runtime relative require still resolves inside the same package output. */
function verifyRelativeRequires(pkg, outputs) {
  const available = new Set(outputs.keys());
  const expression = /require\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g;
  for (const [output, body] of outputs) {
    for (const match of body.toString('utf8').matchAll(expression)) {
      const generated = resolveRelativeRequire(output, match[1], available);
      const packaged = resolvePackageRuntimeRequire(pkg, output, match[1]);
      if (!generated && !packaged) {
        throw new Error(`${pkg.name}/${output}: relative require ${match[1]} has no contained runtime target`);
      }
    }
  }
}

/** @description Normalize and contain a manifest module beneath the package routes directory. */
function manifestOutput(modulePath, pkg) {
  if (typeof modulePath !== 'string' || !modulePath.startsWith('routes/')) {
    throw new Error(`${pkg.name}: manifest route module must start with routes/: ${modulePath}`);
  }
  const output = posix.normalize(modulePath.slice('routes/'.length));
  if (!output || output === '..' || output.startsWith('../') || posix.isAbsolute(output)) {
    throw new Error(`${pkg.name}: manifest route module escapes routes/: ${modulePath}`);
  }
  return output;
}

/**
 * @description Prove every manifest route exports the factory the manifest declares.
 * @param {{name: string, packageDir: string}} pkg - Discovered store package.
 * @param {Map<string, Buffer>} outputs - Canonical rebuild output for this package, keyed routes-relative.
 * @returns {string[]} Manifest route modules no TypeScript source emits, verified against the
 *   committed file instead. They are live modules the manifest mounts, so the stale sweep keeps
 *   them; an unsourced module no manifest names stays stale and is removed.
 */
function verifyManifestFactories(pkg, outputs) {
  const manifestPath = join(pkg.packageDir, 'oshal-app.yaml');
  const routes = parseManifestRoutes(readFileSync(manifestPath, 'utf8'), manifestPath);
  const unsourced = [];
  for (const route of routes) {
    const output = manifestOutput(route.module, pkg);
    let body = outputs.get(output)?.toString('utf8');
    if (!body) {
      const committed = join(pkg.packageDir, 'routes', ...output.split('/'));
      if (!existsSync(committed)) {
        throw new Error(`${pkg.name}: manifest route ${route.module} has neither a canonical source nor a committed module`);
      }
      body = readFileSync(committed, 'utf8');
      unsourced.push(output);
    }
    if (!/^[A-Za-z_$][\w$]*$/.test(route.factory)) throw new Error(`${pkg.name}: invalid factory name ${route.factory}`);
    const factory = route.factory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const exported = new RegExp(`(?:\\bexports\\.${factory}\\s*=|Object\\.defineProperty\\(exports,\\s*["']${factory}["'])`);
    if (!exported.test(body)) throw new Error(`${pkg.name}/${output}: compiled module does not export ${route.factory}`);
  }
  return unsourced;
}

/** @description Apply the package-local source-map comment policy to shared-program output bytes. */
export function normalizeCompilerOutput(pkg, contents) {
  const packageConfig = join(pkg.sourceRoot, 'tsconfig.json');
  if (!existsSync(packageConfig)) return contents;
  let config;
  try {
    config = JSON.parse(readFileSync(packageConfig, 'utf8'));
  } catch (error) {
    throw new Error(`${pkg.name}: package route tsconfig is invalid JSON`, { cause: error });
  }
  if (config.compilerOptions?.sourceMap === true) return contents;
  const body = contents.toString('utf8').replace(/(\r?\n)\/\/# sourceMappingURL=[^\r\n]+(?:\r?\n)?$/, '$1');
  return Buffer.from(body, 'utf8');
}

/** @description List committed generated-route modules that no canonical TypeScript source emits. */
function unsourcedCommittedModules(pkg, outputs) {
  const routesRoot = join(pkg.packageDir, 'routes');
  return filesRecursively(routesRoot, (file) => file.endsWith('.js'))
    .map((file) => relative(routesRoot, file).split(sep).join('/'))
    .filter((output) => !outputs.has(output));
}

/** @description Load and verify the exact compiler output set for one package. */
function collectVerifiedOutputs(pkg, compilerPackageRoot) {
  const expected = expectedOutputs(pkg);
  const emittedFiles = filesRecursively(compilerPackageRoot, (file) => file.endsWith('.js'));
  const emitted = new Map(emittedFiles.map((file) => [relative(compilerPackageRoot, file).split(sep).join('/'), file]));
  const missing = [...expected.keys()].filter((output) => !emitted.has(output));
  const unexpected = [...emitted.keys()].filter((output) => !expected.has(output));
  if (missing.length || unexpected.length) {
    throw new Error(`${pkg.name}: compiler output mismatch; missing=${JSON.stringify(missing)}, unexpected=${JSON.stringify(unexpected)}`);
  }
  const outputs = new Map([...emitted].map(([output, file]) => [
    output,
    normalizeCompilerOutput(pkg, readFileSync(file)),
  ]));
  verifyRelativeRequires(pkg, outputs);
  const manifestUnsourced = new Set(verifyManifestFactories(pkg, outputs));
  const unsourced = unsourcedCommittedModules(pkg, outputs)
    .map((output) => ({ output, mountedByManifest: manifestUnsourced.has(output) }));
  return { outputs, unsourced };
}

/** @description Snapshot every generated target so a filesystem failure can roll back the store tree. */
function snapshotTargets(plans) {
  const snapshots = new Map();
  for (const plan of plans) {
    const routesRoot = join(plan.pkg.packageDir, 'routes');
    const targets = new Set([
      ...[...plan.outputs.keys()].map((output) => join(routesRoot, ...output.split('/'))),
      ...filesRecursively(routesRoot, (file) => file.endsWith('.js')),
    ]);
    for (const target of targets) snapshots.set(target, existsSync(target) ? readFileSync(target) : null);
  }
  return snapshots;
}

/** @description Restore all generated targets after a failed store sync. */
function restoreSnapshots(snapshots) {
  for (const [target, contents] of snapshots) {
    if (contents === null) rmSync(target, { force: true });
    else {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, contents);
    }
  }
}

/** @description Compare generated text independent of checkout-specific line endings. */
function generatedTextMatches(existing, generated) {
  if (existing.equals(generated)) return true;
  const normalize = (contents) => contents.toString('utf8').replace(/\r\n/g, '\n');
  return normalize(existing) === normalize(generated);
}

/** @description Say how a committed generated module differs from its canonical rebuild. */
function describeDifference(existing, generated) {
  const lines = (contents) => contents.toString('utf8').replace(/\r\n/g, '\n').split('\n');
  const committed = lines(existing);
  const rebuilt = lines(generated);
  const excerpt = (line) => (line === undefined
    ? '<past end of file>'
    : JSON.stringify(line.length > 120 ? `${line.slice(0, 120)}...` : line));
  for (let index = 0; index < Math.max(committed.length, rebuilt.length); index += 1) {
    if (committed[index] === rebuilt[index]) continue;
    return `line ${index + 1} differs: committed ${excerpt(committed[index])} but source emits ${excerpt(rebuilt[index])}`;
  }
  return `no line differs yet the bytes do (committed ${existing.length}, source emits ${generated.length})`;
}

/**
 * @description Compare every canonically rebuilt module with the bytes committed beside it.
 * @param {Array<{pkg: object, outputs: Map<string, Buffer>}>} plans - Verified per-package rebuild output.
 * @returns {{compared: number, differences: string[]}} How many modules were compared, and how each mismatch differs.
 */
function compareCommittedOutputs(plans) {
  const differences = [];
  let compared = 0;
  for (const plan of plans) {
    const routesRoot = join(plan.pkg.packageDir, 'routes');
    for (const [output, contents] of plan.outputs) {
      const destination = join(routesRoot, ...output.split('/'));
      compared += 1;
      if (!existsSync(destination)) {
        differences.push(`${plan.pkg.name}/routes/${output}: this source emits a module the repository does not carry`);
        continue;
      }
      const existing = readFileSync(destination);
      if (generatedTextMatches(existing, contents)) continue;
      differences.push(`${plan.pkg.name}/routes/${output}: ${describeDifference(existing, contents)}`);
    }
  }
  return { compared, differences };
}

/** @description Transactionally replace generated JavaScript and remove stale generated modules. */
function syncOutputs(plans) {
  const snapshots = snapshotTargets(plans);
  let removed = 0;
  try {
    for (const plan of plans) {
      const routesRoot = join(plan.pkg.packageDir, 'routes');
      // A hand-written module the manifest mounts is live, not orphaned: sweeping it would delete
      // the route the package serves. Anything else without a source stays stale and is removed.
      const kept = plan.unsourced.filter((entry) => entry.mountedByManifest).map((entry) => entry.output);
      const expected = new Set([...plan.outputs.keys(), ...kept]
        .map((output) => join(routesRoot, ...output.split('/'))));
      for (const existing of filesRecursively(routesRoot, (file) => file.endsWith('.js'))) {
        if (!expected.has(existing)) { rmSync(existing); removed += 1; }
      }
      for (const [output, contents] of plan.outputs) {
        const destination = join(routesRoot, ...output.split('/'));
        if (existsSync(destination) && generatedTextMatches(readFileSync(destination), contents)) continue;
        mkdirSync(dirname(destination), { recursive: true });
        writeFileSync(destination, contents);
      }
    }
  } catch (error) {
    restoreSnapshots(snapshots);
    throw error;
  }
  return removed;
}

/**
 * @description Canonically rebuild every source-bearing store package with one TypeScript invocation.
 * @param {{storeRoot?: string, frameworkRoot: string, checkOnly?: boolean}} options - Store and locked
 *   framework checkout roots; checkOnly compares the committed output instead of rewriting it and
 *   never touches the store tree.
 * @returns {{packages: number, sources: number, removedStale: number, comparedOutputs?: number, unsourcedModules?: string[]}}
 *   Deterministic rebuild counts. checkOnly additionally reports how many committed modules were
 *   byte-compared and which committed route modules no TypeScript source emits.
 */
export function rebuildStoreRoutes({ storeRoot = process.cwd(), frameworkRoot, checkOnly = false }) {
  const store = resolve(storeRoot);
  const framework = resolve(frameworkRoot ?? '');
  const compiler = join(framework, 'node_modules', 'typescript', 'bin', 'tsc');
  if (!existsSync(join(framework, 'tsconfig.json')) || !existsSync(compiler) || !existsSync(join(framework, 'src'))) {
    throw new Error(`Framework checkout is missing tsconfig, src, or locked TypeScript compiler: ${framework}`);
  }
  const packages = discoverPackages(store);
  if (packages.length === 0) throw new Error(`No source-bearing store packages discovered in ${store}`);
  let stageRoot;
  let compilerOutput;
  try {
    stageRoot = mkdtempSync(join(framework, 'src', STAGE_PREFIX));
    compilerOutput = mkdtempSync(join(tmpdir(), 'oshal-store-parity-'));
    for (const pkg of packages) stagePackage(pkg, stageRoot);
    compileOnce(framework, compilerOutput);
    const stageName = relative(join(framework, 'src'), stageRoot);
    const plans = packages.map((pkg) => ({
      pkg,
      ...collectVerifiedOutputs(pkg, join(compilerOutput, stageName, pkg.name)),
    }));
    const sources = packages.reduce((sum, pkg) => sum + pkg.emittingSources.length, 0);
    if (checkOnly) {
      const { compared, differences } = compareCommittedOutputs(plans);
      // A run that compares nothing and prints a pass is how this class of gate dies.
      if (compared !== sources || compared === 0) {
        throw new Error(`Canonical parity compared ${compared} committed modules for ${sources} sources; refusing to report a pass`);
      }
      if (differences.length > 0) {
        throw new Error(`Committed route output does not match its TypeScript source (${differences.length} of ${compared} compared modules):\n  ${differences.join('\n  ')}`);
      }
      const unsourcedModules = plans.flatMap((plan) => plan.unsourced.map((entry) =>
        `${plan.pkg.name}/routes/${entry.output}${entry.mountedByManifest ? ' (mounted by the manifest; kept)' : ' (no manifest route; a rebuild removes it as stale)'}`));
      return { packages: packages.length, sources, removedStale: 0, comparedOutputs: compared, unsourcedModules };
    }
    const removedStale = syncOutputs(plans);
    return { packages: packages.length, sources, removedStale };
  } finally {
    if (stageRoot) rmSync(stageRoot, { recursive: true, force: true });
    if (compilerOutput) rmSync(compilerOutput, { recursive: true, force: true });
  }
}

/** @description Parse the intentionally small command-line surface without accepting ambiguous arguments. */
function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--check-only' && !values.checkOnly) { values.checkOnly = true; continue; }
    if (!['--store', '--framework'].includes(flag) || !argv[index + 1] || argv[index + 1].startsWith('--')) {
      throw new Error(`Usage: rebuild-store-routes.mjs --store <store> --framework <framework> [--check-only]`);
    }
    values[flag.slice(2)] = argv[index + 1];
    index += 1;
  }
  if (!values.framework) throw new Error('Missing required --framework checkout');
  return { storeRoot: values.store ?? process.cwd(), frameworkRoot: values.framework, checkOnly: values.checkOnly === true };
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const summary = rebuildStoreRoutes(options);
    if (!options.checkOnly) {
      console.log(`Canonical store rebuild passed: ${summary.sources} sources across ${summary.packages} packages; removed ${summary.removedStale} stale modules`);
    } else {
      // The leading sentence is a cross-repo contract: the core release check
      // (scripts/check-store-compatibility.mjs) greps this run log for it.
      console.log(`Canonical store compatibility passed: ${summary.sources} sources across ${summary.packages} packages; ${summary.comparedOutputs} committed route modules match the source that emits them, byte for byte`);
      // Name every exclusion. A gate whose holes nobody can see is a gate nobody maintains.
      console.log(summary.unsourcedModules.length === 0
        ? 'Not byte-compared: none - every committed routes/*.js is emitted by a TypeScript source'
        : `Not byte-compared - ${summary.unsourcedModules.length} committed route module(s) no TypeScript source emits (a manifest-declared one is still checked for its factory export):\n  ${summary.unsourcedModules.join('\n  ')}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
