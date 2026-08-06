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
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseManifestRoutes } from './check-store-security.mjs';

const STAGE_PREFIX = '__oshal_store_parity_';
const TYPESCRIPT_SOURCE = /\.(?:ts|tsx)$/;
const DECLARATION_SOURCE = /\.d\.ts$/;

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
    const allSources = filesRecursively(sourceRoot, (file) => TYPESCRIPT_SOURCE.test(file));
    const emittingSources = allSources.filter((file) => !DECLARATION_SOURCE.test(file));
    if (emittingSources.length === 0) throw new Error(`${entry.name}: src-routes has no emitting TypeScript source`);
    packages.push({ name: entry.name, packageDir, sourceRoot, emittingSources });
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

/** @description Copy emitting sources beneath a collision-free root, omitting standalone ambient shims. */
function stagePackage(pkg, stageRoot) {
  const packageStage = join(stageRoot, pkg.name);
  // Package-local core-modules.d.ts files support standalone package compilers. In the canonical
  // framework program they would be global module augmentations and could weaken/replace core types.
  for (const source of pkg.emittingSources) {
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

/** @description Prove each manifest route maps to source and its emitted module exports the declared factory. */
function verifyManifestFactories(pkg, outputs) {
  const manifestPath = join(pkg.packageDir, 'oshal-app.yaml');
  const routes = parseManifestRoutes(readFileSync(manifestPath, 'utf8'), manifestPath);
  for (const route of routes) {
    const output = manifestOutput(route.module, pkg);
    const body = outputs.get(output)?.toString('utf8');
    if (!body) throw new Error(`${pkg.name}: manifest route ${route.module} has no canonical source output`);
    if (!/^[A-Za-z_$][\w$]*$/.test(route.factory)) throw new Error(`${pkg.name}: invalid factory name ${route.factory}`);
    const factory = route.factory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const exported = new RegExp(`(?:\\bexports\\.${factory}\\s*=|Object\\.defineProperty\\(exports,\\s*["']${factory}["'])`);
    if (!exported.test(body)) throw new Error(`${pkg.name}/${output}: compiled module does not export ${route.factory}`);
  }
}

/** @description Apply the package-local source-map comment policy to shared-program output bytes. */
function normalizeCompilerOutput(pkg, contents) {
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
  verifyManifestFactories(pkg, outputs);
  return outputs;
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

/** @description Transactionally replace generated JavaScript and remove stale generated modules. */
function syncOutputs(plans) {
  const snapshots = snapshotTargets(plans);
  let removed = 0;
  try {
    for (const plan of plans) {
      const routesRoot = join(plan.pkg.packageDir, 'routes');
      const expected = new Set([...plan.outputs.keys()].map((output) => join(routesRoot, ...output.split('/'))));
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
 * @param {{storeRoot?: string, frameworkRoot: string}} options - Store and locked framework checkout roots.
 * @returns {{packages: number, sources: number, removedStale: number}} Deterministic rebuild counts.
 */
export function rebuildStoreRoutes({ storeRoot = process.cwd(), frameworkRoot }) {
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
      outputs: collectVerifiedOutputs(pkg, join(compilerOutput, stageName, pkg.name)),
    }));
    const removedStale = syncOutputs(plans);
    return { packages: packages.length, sources: packages.reduce((sum, pkg) => sum + pkg.emittingSources.length, 0), removedStale };
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
    if (!['--store', '--framework'].includes(flag) || !argv[index + 1] || argv[index + 1].startsWith('--')) {
      throw new Error(`Usage: rebuild-store-routes.mjs --store <store> --framework <framework>`);
    }
    values[flag.slice(2)] = argv[index + 1];
    index += 1;
  }
  if (!values.framework) throw new Error('Missing required --framework checkout');
  return { storeRoot: values.store ?? process.cwd(), frameworkRoot: values.framework };
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    const summary = rebuildStoreRoutes(parseArgs(process.argv.slice(2)));
    console.log(`Canonical store rebuild passed: ${summary.sources} sources across ${summary.packages} packages; removed ${summary.removedStale} stale modules`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
