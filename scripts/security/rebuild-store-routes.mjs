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
 * 10 | maintainer@emeraldcoastsystemsgroup.com | Verify the exact CommonJS shorthand exports used by reviewed hand-written routes, including a public callback verifier, without exempting those manifest factories from the compare-only gate. Preserve contained hand-written JavaScript transitively imported by a live route during the generated-output stale sweep, instead of deleting the Calling Assistant callback and service helpers.
 * 11 | maintainer@emeraldcoastsystemsgroup.com | Stop a killed run from leaking its stage into the framework checkout. The stage lives in <framework>/src (the framework's own tsconfig only compiles src/**) and was removed only by the finally block, which a timeout, a hang or a kill never reaches: a 584-file src/__oshal_store_parity_* copy sat in the shared core checkout for three days. Each stage now carries an owner record (pid, host, start time). A guardian process removes the stage and the compiler output when its run dies, because a kill on Windows runs no listener in the killed process at all (measured: a SIGTERM listener never ran). The run starts the guardian through a launcher it waits for, so the guardian's parent has already exited and the guardian is not in the run's process tree: a kill of the run, a Git Bash `timeout` and a `taskkill /T /F` of the run's tree all leave it running (measured on Windows; an IPC-connected guardian started directly by the run died with the last two). The guardian polls the run's pid, and exits as soon as the run has removed both directories itself. Every removal - the run's own, the guardian's and the sweep's - deletes the staged files before the owner record and the directory last, so a removal cut short still names its dead run and the next run sweeps the rest at once (a recursive rmSync took the record first, and an interrupted removal left an owner-less remainder the sweep kept for an hour). A kill that ends the guardian as well leaves the stage with its record, and the next run sweeps it at once. Every run first sweeps stages left by earlier runs - a same-host owner that is no longer running, an owner-less or foreign stage older than an hour, or a live pid past a twelve-hour ceiling (pid reuse) - and never touches a stage whose run is still running. The run prints where it staged so a killed run's log names the directory. All of it stays in this one file because core's store-compatibility fixture copies exactly this script and check-store-security.mjs.
 */

import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { basename, dirname, join, posix, relative, resolve, sep } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseManifestRoutes } from './check-store-security.mjs';

const STAGE_PREFIX = '__oshal_store_parity_';
const COMPILER_OUTPUT_PREFIX = 'oshal-store-parity-';
/**
 * @description Owner record written inside every stage. The framework program includes only .ts and
 *   .tsx files under src, so the record never enters the compile; it is what lets a later run tell a
 *   live stage from a leaked one.
 */
export const STAGE_OWNER_FILE = '.oshal-stage-owner.json';
/**
 * @description Age past which a stage with no owner record, or one written on another host whose pid
 *   cannot be checked here, is swept. Longer than the 45-minute CI job that runs this script and the
 *   20 minutes core's store-compatibility runner allows the compile, so a concurrent run of an older
 *   copy of this script (which writes no owner record) is not swept mid-compile.
 */
export const UNOWNED_STAGE_STALE_MS = 60 * 60 * 1000;
/**
 * @description Age up to which a same-host owner whose pid still answers keeps its stage; past it the
 *   pid has been reused by another process or the run is hung, and the stage is swept.
 */
export const OWNED_STAGE_CEILING_MS = 12 * 60 * 60 * 1000;
const GUARDIAN_FLAG = '--guard-stage';
const LAUNCHER_FLAG = '--launch-stage-guardian';
const GUARDIAN_LAUNCH_TIMEOUT_MS = 30 * 1000;
const GUARDIAN_POLL_MS = 500;
const GUARDIAN_REMOVAL_BUDGET_MS = 30 * 1000;
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

/** @description Recognize a named TypeScript export or an exact CommonJS shorthand export. */
function exportsNamedFactory(body, name) {
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const compiled = new RegExp(`(?:\\bexports\\.${escaped}\\s*=|Object\\.defineProperty\\(exports,\\s*["']${escaped}["'])`);
  if (compiled.test(body)) return true;
  return [...body.matchAll(/\bmodule\.exports\s*=\s*\{([^{}]*)\}/g)]
    .some(([, properties]) => properties.split(',').some((property) => property.trim() === name));
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
    if (!exportsNamedFactory(body, route.factory)) {
      throw new Error(`${pkg.name}/${output}: compiled module does not export ${route.factory}`);
    }
    if (route.callbackVerifier && !exportsNamedFactory(body, route.callbackVerifier)) {
      throw new Error(`${pkg.name}/${output}: compiled module does not export callback verifier ${route.callbackVerifier}`);
    }
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

/** @description Retain only hand-written JavaScript reachable through static package-relative imports. */
function retainedUnsourcedModules(pkg, outputs, manifestUnsourced) {
  const routesRoot = join(pkg.packageDir, 'routes');
  const generatedOutputs = new Set(outputs.keys());
  const retained = new Map([...manifestUnsourced].map((output) => [output, 'mounted by the manifest; kept']));
  const visited = new Set();
  const pending = [...outputs.keys(), ...manifestUnsourced];
  const expression = /require\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g;
  while (pending.length > 0) {
    const output = pending.pop();
    if (visited.has(output)) continue;
    visited.add(output);
    const body = outputs.get(output)?.toString('utf8')
      ?? readFileSync(join(routesRoot, ...output.split('/')), 'utf8');
    for (const match of body.matchAll(expression)) {
      const generated = resolveRelativeRequire(output, match[1], generatedOutputs);
      if (generated) continue;
      const packaged = resolvePackageRuntimeRequire(pkg, output, match[1]);
      if (!packaged) throw new Error(`${pkg.name}/${output}: relative require ${match[1]} has no contained runtime target`);
      const relativeTarget = relative(routesRoot, packaged).split(sep).join('/');
      if (relativeTarget === '..' || relativeTarget.startsWith('../') || !relativeTarget.endsWith('.js')) continue;
      if (!retained.has(relativeTarget)) retained.set(relativeTarget, 'imported by a live route; kept');
      pending.push(relativeTarget);
    }
  }
  return retained;
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
  const retained = retainedUnsourcedModules(pkg, outputs, manifestUnsourced);
  const unsourced = unsourcedCommittedModules(pkg, outputs)
    .map((output) => ({ output, retainedReason: retained.get(output) ?? null }));
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
      // A hand-written module mounted by or imported from a live route is not stale.
      const kept = plan.unsourced.filter((entry) => entry.retainedReason).map((entry) => entry.output);
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
 * @description Report whether a process id is running on this host.
 * @param {number} pid - Process id read from an owner record.
 * @returns {boolean} True when the pid answers (EPERM means it exists but belongs to someone else).
 */
function pidIsRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

/**
 * @description Read and validate the owner record a run writes into its stage.
 * @param {string} stage - Stage directory.
 * @returns {{pid: number, host: string, startedAtMs: number} | null} The owner, or null when the record
 *   is absent (a run that died between creating the directory and writing it) or not one this script wrote.
 */
function readStageOwner(stage) {
  const record = join(stage, STAGE_OWNER_FILE);
  if (!existsSync(record)) return null;
  let owner;
  try {
    owner = JSON.parse(readFileSync(record, 'utf8'));
  } catch (error) {
    console.error(`Ignoring unreadable stage owner record ${record}: ${error.message}`);
    return null;
  }
  const startedAtMs = Date.parse(owner?.startedAt);
  if (!Number.isSafeInteger(owner?.pid) || owner.pid <= 0 || typeof owner?.host !== 'string'
    || !Number.isFinite(startedAtMs)) return null;
  return { pid: owner.pid, host: owner.host, startedAtMs };
}

/** @description Render an age in whole minutes for sweep reasons. */
function minutes(ms) {
  return `${Math.floor(ms / 60000)} min`;
}

/**
 * @description Decide whether one prefixed stage directory is a leak or a run still in flight.
 * @param {string} stage - Stage directory beneath the framework src.
 * @param {{now: number, host: string, unownedStaleMs: number, ownedCeilingMs: number}} policy - Clock, this
 *   host's name and the two age bounds.
 * @returns {{sweep: boolean, reason: string}} The decision and the reason printed beside it.
 */
function stageSweepDecision(stage, { now, host, unownedStaleMs, ownedCeilingMs }) {
  const owner = readStageOwner(stage);
  if (owner && owner.host === host) {
    const age = Math.max(0, now - owner.startedAtMs);
    if (!pidIsRunning(owner.pid)) return { sweep: true, reason: `its run (pid ${owner.pid}) is no longer running` };
    if (age <= ownedCeilingMs) return { sweep: false, reason: `its run (pid ${owner.pid}) is still running` };
    return { sweep: true, reason: `pid ${owner.pid} answers but the stage is ${minutes(age)} old, past the ${minutes(ownedCeilingMs)} ceiling for a live run` };
  }
  const stat = owner ? null : statSync(stage, { throwIfNoEntry: false });
  if (!owner && !stat) return { sweep: false, reason: 'already removed by another run' };
  const age = Math.max(0, now - (owner ? owner.startedAtMs : stat.mtimeMs));
  const who = owner ? `owner on another host (${owner.host})` : 'no owner record';
  if (age <= unownedStaleMs) return { sweep: false, reason: `${who}, ${minutes(age)} old, inside the ${minutes(unownedStaleMs)} bound` };
  return { sweep: true, reason: `${who}, ${minutes(age)} old, past the ${minutes(unownedStaleMs)} bound` };
}

/**
 * @description Remove a stage or compiler output directory so that an interruption at any point still
 *   leaves the stage's owner record: everything else first, then the record, then the empty directory.
 *   A recursive rmSync takes the record first (it sorts first), so a removal killed part way left an
 *   owner-less remainder the sweep keeps for the whole owner-less bound; this order leaves a remainder
 *   that still names its dead run, which the next run sweeps at once. A link is never followed.
 * @param {string} directory - Stage or compiler output directory.
 * @returns {void}
 */
function removeTransient(directory) {
  if (!lstatSync(directory, { throwIfNoEntry: false })?.isDirectory()) return;
  for (const entry of readdirSync(directory)) {
    if (entry !== STAGE_OWNER_FILE) rmSync(join(directory, entry), { recursive: true, force: true, maxRetries: 3 });
  }
  rmSync(join(directory, STAGE_OWNER_FILE), { force: true, maxRetries: 3 });
  rmSync(directory, { recursive: true, force: true, maxRetries: 3 });
}

/**
 * @description Remove stage directories earlier runs left in the framework src, keeping any whose run
 *   is still in flight. Only real directories named with this script's prefix are considered; a link
 *   is never followed or removed.
 * @param {string} frameworkSrc - The framework checkout's src directory.
 * @param {{now?: number, host?: string, unownedStaleMs?: number, ownedCeilingMs?: number, log?: (line: string) => void}} [options] -
 *   Clock, host name, age bounds and line sink; the defaults are the production policy.
 * @returns {{swept: Array<{name: string, reason: string}>, kept: Array<{name: string, reason: string}>}} What was
 *   removed and what was left in place, each with its reason.
 */
export function sweepStaleStages(frameworkSrc, {
  now = Date.now(), host = hostname(), unownedStaleMs = UNOWNED_STAGE_STALE_MS,
  ownedCeilingMs = OWNED_STAGE_CEILING_MS, log = console.log,
} = {}) {
  const swept = [];
  const kept = [];
  if (!existsSync(frameworkSrc)) return { swept, kept };
  for (const entry of readdirSync(frameworkSrc, { withFileTypes: true })) {
    if (!entry.name.startsWith(STAGE_PREFIX)) continue;
    const stage = join(frameworkSrc, entry.name);
    const decision = entry.isDirectory() && !entry.isSymbolicLink()
      ? stageSweepDecision(stage, { now, host, unownedStaleMs, ownedCeilingMs })
      : { sweep: false, reason: 'not a real directory; never followed or removed' };
    if (!decision.sweep) {
      kept.push({ name: entry.name, reason: decision.reason });
      log(`Left store parity stage ${stage} in place: ${decision.reason}`);
      continue;
    }
    try {
      removeTransient(stage);
      swept.push({ name: entry.name, reason: decision.reason });
      log(`Swept stale store parity stage ${stage}: ${decision.reason}`);
    } catch (error) {
      kept.push({ name: entry.name, reason: `removal failed: ${error.message}` });
      console.error(`Could not sweep stale store parity stage ${stage}: ${error.message}`);
    }
  }
  return { swept, kept };
}

/**
 * @description Start the process that removes this run's stage and compiler output if the run dies
 *   before its finally block. The run waits for a short-lived launcher that starts the guardian and
 *   prints its pid, so the guardian's parent has already exited when the compile begins: a tree kill of
 *   the run (taskkill /T, a Git Bash timeout) walks parent pids from the run and does not reach it, and
 *   it is detached, so on POSIX it leads its own session and a signal to the run's process group misses
 *   it too. It holds no stdio, so it can never keep a caller's output pipe open. Both processes run in
 *   the OS temp root, never the caller's directory, because on Windows a live process's working
 *   directory cannot be deleted and callers delete the checkout they ran this in (core's
 *   store-compatibility runner removes its exported framework as soon as the run returns).
 * @param {string} stageRoot - This run's stage directory (its owner record is already written).
 * @param {string} compilerOutput - This run's compiler output directory.
 * @returns {number | null} The guardian's pid, or null when it could not start.
 */
function startStageGuardian(stageRoot, compilerOutput) {
  const result = spawnSync(process.execPath,
    [fileURLToPath(import.meta.url), LAUNCHER_FLAG, String(process.pid), stageRoot, compilerOutput], {
      cwd: tmpdir(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: GUARDIAN_LAUNCH_TIMEOUT_MS, windowsHide: true,
    });
  const pid = Number(result.stdout?.trim());
  if (result.error || result.status !== 0 || !Number.isSafeInteger(pid) || pid <= 0) {
    const detail = result.error?.message ?? `launcher exit ${result.status}: ${result.stderr?.trim() || 'no guardian pid'}`;
    console.error(`Stage guardian could not start: ${detail}`);
    return null;
  }
  return pid;
}

/**
 * @description Launcher process body: start the guardian detached from every caller, print its pid and
 *   exit, so the guardian outlives a kill of the run's whole process tree.
 * @param {string[]} args - Watched pid, stage directory and compiler output directory, passed through.
 * @returns {void}
 */
function launchStageGuardian(args) {
  const guardian = spawn(process.execPath, [fileURLToPath(import.meta.url), GUARDIAN_FLAG, ...args], {
    cwd: tmpdir(), detached: true, stdio: 'ignore', windowsHide: true,
  });
  guardian.on('error', (error) => {
    console.error(`Stage guardian failed to start: ${error.message}`);
    process.exitCode = 1;
  });
  if (!guardian.pid) return;
  guardian.unref();
  process.stdout.write(`${guardian.pid}\n`);
}

/**
 * @description Create this run's stage, owner record, compiler output and guardian, and say where.
 * @param {string} framework - Framework checkout root.
 * @param {{stageRoot?: string, compilerOutput?: string, guardianPid?: number | null}} transient - Filled in
 *   step by step so the caller's finally removes whatever was created even if a later step throws.
 * @param {(line: string) => void} log - Line sink.
 * @returns {void}
 */
function openStage(framework, transient, log) {
  transient.stageRoot = mkdtempSync(join(framework, 'src', STAGE_PREFIX));
  writeFileSync(join(transient.stageRoot, STAGE_OWNER_FILE), `${JSON.stringify({
    tool: 'rebuild-store-routes', pid: process.pid, host: hostname(), startedAt: new Date().toISOString(),
  })}\n`);
  transient.compilerOutput = mkdtempSync(join(tmpdir(), COMPILER_OUTPUT_PREFIX));
  transient.guardianPid = startStageGuardian(transient.stageRoot, transient.compilerOutput);
  const cleanup = transient.guardianPid
    ? `removed when this run ends, or by guardian pid ${transient.guardianPid} if the run is killed`
    : 'no guardian started, so a killed run leaves it for the next run to sweep';
  log(`Staged store route sources in ${transient.stageRoot} (compiler output ${transient.compilerOutput}; ${cleanup})`);
}

/**
 * @description Remove this run's transient directories. The guardian sees both gone and exits.
 * @param {{stageRoot?: string, compilerOutput?: string}} transient - What openStage created.
 * @returns {void}
 */
function closeStage({ stageRoot, compilerOutput }) {
  if (stageRoot) removeTransient(stageRoot);
  if (compilerOutput) removeTransient(compilerOutput);
}

/**
 * @description Name the exact paths a guardian may remove: the stage only when it is a prefixed directory
 *   directly under a src directory whose owner record names the watched pid on this host, and the
 *   compiler output only when it is a prefixed directory directly under the OS temp directory.
 * @param {number} ownerPid - The run being watched.
 * @param {string} stageRoot - Claimed stage directory.
 * @param {string} compilerOutput - Claimed compiler output directory.
 * @returns {string[]} The subset of the two paths that passed, so a hand-typed invocation cannot delete anything else.
 */
function guardedTargets(ownerPid, stageRoot, compilerOutput) {
  const targets = [];
  const stage = resolve(stageRoot);
  const owner = readStageOwner(stage);
  if (basename(stage).startsWith(STAGE_PREFIX) && basename(dirname(stage)) === 'src'
    && owner?.pid === ownerPid && owner.host === hostname()) targets.push(stage);
  const output = resolve(compilerOutput);
  if (basename(output).startsWith(COMPILER_OUTPUT_PREFIX) && dirname(output) === resolve(tmpdir())) targets.push(output);
  return targets;
}

/**
 * @description Remove one directory tree, retrying while Windows still holds a handle in it: the
 *   killed run's compiler is torn down by the same kill and can hold a staged file for a moment.
 * @param {string} target - Directory to remove.
 * @param {number} deadline - Epoch milliseconds after which the removal is abandoned.
 * @returns {boolean} Whether the tree is gone.
 */
function removeUntil(target, deadline) {
  for (;;) {
    try {
      removeTransient(target);
      return true;
    } catch {
      // No caller can see this process's output; the retry, then the exit code, is the report.
      if (Date.now() >= deadline) return false;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    }
  }
}

/**
 * @description Guardian process body: poll the watched run, exit once the run has removed both
 *   directories itself, and remove what is left once the run's pid has gone. It is not the run's child
 *   (see startStageGuardian), so no IPC channel or exit event reaches it; the pid is the signal.
 *   Its stdio is detached from every caller on purpose, so the exit code is its only report; a
 *   removal it could not finish still carries the owner record and is swept, and named, by the next run.
 * @param {string[]} args - Watched pid, stage directory and compiler output directory.
 * @returns {void}
 */
function runStageGuardian(args) {
  const ownerPid = Number(args[0]);
  if (args.length !== 3 || !Number.isSafeInteger(ownerPid) || ownerPid <= 0) {
    process.exitCode = 2;
    return;
  }
  const targets = guardedTargets(ownerPid, args[1], args[2]);
  const watch = () => {
    if (targets.every((target) => !existsSync(target))) process.exit(0);
    if (pidIsRunning(ownerPid)) return;
    const deadline = Date.now() + GUARDIAN_REMOVAL_BUDGET_MS;
    const failures = targets.filter((target) => !removeUntil(target, deadline));
    process.exit(failures.length === 0 ? 0 : 1);
  };
  watch();
  setInterval(watch, GUARDIAN_POLL_MS);
  // Never outlive the live-run ceiling: past it the sweep owns the decision.
  setTimeout(() => process.exit(0), OWNED_STAGE_CEILING_MS);
}

/**
 * @description Assemble the compare-only result, refusing a vacuous or drifted comparison.
 * @param {Array<{pkg: object, outputs: Map<string, Buffer>, unsourced: object[]}>} plans - Verified rebuild output.
 * @param {number} sources - Emitting TypeScript sources across every package.
 * @returns {{packages: number, sources: number, removedStale: number, comparedOutputs: number, unsourcedModules: string[]}} The check-only summary.
 */
function checkOnlySummary(plans, sources) {
  const { compared, differences } = compareCommittedOutputs(plans);
  // A run that compares nothing and prints a pass is how this class of gate dies.
  if (compared !== sources || compared === 0) {
    throw new Error(`Canonical parity compared ${compared} committed modules for ${sources} sources; refusing to report a pass`);
  }
  if (differences.length > 0) {
    throw new Error(`Committed route output does not match its TypeScript source (${differences.length} of ${compared} compared modules):\n  ${differences.join('\n  ')}`);
  }
  const unsourcedModules = plans.flatMap((plan) => plan.unsourced.map((entry) =>
    `${plan.pkg.name}/routes/${entry.output} (${entry.retainedReason ?? 'no live route import; a rebuild removes it as stale'})`));
  return { packages: plans.length, sources, removedStale: 0, comparedOutputs: compared, unsourcedModules };
}

/**
 * @description Canonically rebuild every source-bearing store package with one TypeScript invocation.
 * @param {{storeRoot?: string, frameworkRoot: string, checkOnly?: boolean, log?: (line: string) => void}} options - Store and
 *   locked framework checkout roots; checkOnly compares the committed output instead of rewriting it and
 *   never touches the store tree; log receives the stage and sweep lines (default stdout).
 * @returns {{packages: number, sources: number, removedStale: number, comparedOutputs?: number, unsourcedModules?: string[]}}
 *   Deterministic rebuild counts. checkOnly additionally reports how many committed modules were
 *   byte-compared and which committed route modules no TypeScript source emits.
 */
export function rebuildStoreRoutes({ storeRoot = process.cwd(), frameworkRoot, checkOnly = false, log = console.log }) {
  const store = resolve(storeRoot);
  const framework = resolve(frameworkRoot ?? '');
  const compiler = join(framework, 'node_modules', 'typescript', 'bin', 'tsc');
  if (!existsSync(join(framework, 'tsconfig.json')) || !existsSync(compiler) || !existsSync(join(framework, 'src'))) {
    throw new Error(`Framework checkout is missing tsconfig, src, or locked TypeScript compiler: ${framework}`);
  }
  sweepStaleStages(join(framework, 'src'), { log });
  const packages = discoverPackages(store);
  if (packages.length === 0) throw new Error(`No source-bearing store packages discovered in ${store}`);
  const transient = { stageRoot: undefined, compilerOutput: undefined, guardianPid: null };
  try {
    openStage(framework, transient, log);
    for (const pkg of packages) stagePackage(pkg, transient.stageRoot);
    compileOnce(framework, transient.compilerOutput);
    const stageName = relative(join(framework, 'src'), transient.stageRoot);
    const plans = packages.map((pkg) => ({
      pkg,
      ...collectVerifiedOutputs(pkg, join(transient.compilerOutput, stageName, pkg.name)),
    }));
    const sources = packages.reduce((sum, pkg) => sum + pkg.emittingSources.length, 0);
    if (checkOnly) return checkOnlySummary(plans, sources);
    const removedStale = syncOutputs(plans);
    return { packages: packages.length, sources, removedStale };
  } finally {
    closeStage(transient);
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

const invokedDirectly = resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url);
if (invokedDirectly && process.argv[2] === GUARDIAN_FLAG) {
  runStageGuardian(process.argv.slice(3));
} else if (invokedDirectly && process.argv[2] === LAUNCHER_FLAG) {
  launchStageGuardian(process.argv.slice(3));
} else if (invokedDirectly) {
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
