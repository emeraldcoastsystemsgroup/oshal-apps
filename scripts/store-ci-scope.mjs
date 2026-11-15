/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Decide what a store gate run has to run for one change (Roger, 2026-11-14: "we ran the full suite today, we dont need to do it every time"). Every push ran all of store-ci, about 140 checks, so a one-package change waited for every other package and failed on their unrelated timeouts. This module places every check as one that always runs (the publish wall and the structural rules) or one that belongs to a package, places every changed path in a package or says the gate itself changed, and follows the declared dependencies and the tests that read a sibling package to the packages a change reaches. Anything it cannot place makes the run a full one: it may run more than it had to, never less.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { readManifestDependencies } from './manifest-dependencies.mjs';

/**
 * The reviewed always set, by store-ci job id: the publish wall and the rules that read every manifest
 * or the whole tree. Every step these jobs run from the repository root runs in every scoped run. A job
 * that is not listed here has to be about a package (a step inside a package folder, or a root test step
 * naming only package folders); a job that is neither cannot be placed, and the whole suite runs until it
 * is listed. One id per line: scripts/store-ci-scope.test.mjs removes a line and expects a red case.
 */
export const ALWAYS_JOBS = [
  'attribution', // no model attribution and no house identifiers in tracked files
  'public-snapshot', // the public store cut clears its publish gates
  'test-discovery', // every package test command resolves to a non-empty file set
  'catalog-parity', // catalog, manifests, README, connector and concierge declarations, cross-package edges, group concierge, rating ledger
  'service-activations', // every scheduled service declares the principal it runs as
  'engine-container-pattern', // package-owned engine containers follow the documented pattern
  'forced-rls', // every walled package table is forced, not only enabled
  'medium-properties', // every lab's copy of a medium property agrees
  'adr160-contract', // every lab's vehicle record, stage and medium shape agree
  'test-catalogs', // every package's Test Lab catalog loads
  'app-scopes', // every package's scope and bot ownership is one the contract accepts
  'store-bots', // route-called bots, personas, connector copy, routing words, catalog descriptions
  'store-ci-local', // this gate's own contract tests, the revert guard and the search sweep
  'home-summary', // compiled Home summary boundaries across packages
];

/** The two jobs no passing run may leave out, a rerun after a failure included. */
export const PUBLISH_WALL = ['attribution', 'public-snapshot'];

/** Folders that are the gate itself: a change under one of them runs everything. */
export const GATE_FOLDERS = ['scripts', '.github', '.githooks'];

/** Variables that name a disposable service a suite needs; store-push starts only the ones a plan names. */
export const SERVICE_VARIABLES = ['OSHAL_TEST_POSTGRES', 'OSHAL_TEST_SEARCH', 'CAREER_TEST_POSTGRES_ADMIN_URL'];

const TEST_SOURCE = /[.](?:c|m)?js$|[.]ts$/;
// Files a suite's service variable can be read from: scripts, Python suites, shell fixtures, configuration.
const SERVICE_READER = /[.](?:c|m)?js$|[.](?:m|c)?ts$|[.]py$|[.]sh$|[.]ya?ml$/;

/**
 * @description Every package folder of a store checkout: a top-level folder holding oshal-app.yaml.
 * @param {string} root The store root.
 * @returns {string[]} Folder names, sorted.
 */
export function packageFolders(root) {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, 'oshal-app.yaml')))
    .map((entry) => entry.name)
    .sort();
}

/**
 * @description Place one planned check: it always runs, it belongs to packages, or it cannot be placed.
 * @param {{job:string,command:string,workingDirectory:string}} check A check from the runner's plan.
 * @param {string[]} packages The store's package folders.
 * @returns {{kind:'always'}|{kind:'package',packages:string[]}|{kind:'unplaced',reason:string}} Its place.
 */
export function placeCheck(check, packages) {
  if (check.workingDirectory) {
    const folder = check.workingDirectory.replaceAll('\\', '/').split('/')[0];
    if (packages.includes(folder)) return { kind: 'package', packages: [folder] };
    return { kind: 'unplaced', reason: `job ${check.job} runs a step in ${check.workingDirectory}, which is not a package folder` };
  }
  if (ALWAYS_JOBS.includes(check.job)) return { kind: 'always' };
  const paths = /^node\s+--test\s+/.test(check.command)
    ? [...check.command.replace(/^node\s+--test\s+/, '').matchAll(/"([^"]+)"|'([^']+)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3])
    : [];
  const folders = paths.map((path) => path.replaceAll('\\', '/').split('/')[0]);
  if (folders.length && folders.every((folder) => packages.includes(folder))) {
    return { kind: 'package', packages: [...new Set(folders)].sort() };
  }
  // A check under scripts/ reads whatever it likes of the tree, so it runs whatever changed.
  if (/^node\s+scripts\//.test(check.command) || folders.includes('scripts')) return { kind: 'always' };
  return { kind: 'unplaced', reason: `job ${check.job} runs "${check.command}" from the root, which names neither a package nor a scripts/ check` };
}

/**
 * @description Place every check, and every job by what its checks are about.
 * @param {object[]} checks The runner's plan, in workflow order.
 * @param {string[]} packages The store's package folders.
 * @returns {{places:object[],always:string[],packages:Record<string,string[]>,unplaced:string[]}} Each
 *   check's place; the listed always jobs this workflow declares; each other job's packages; and why a
 *   job could not be placed.
 */
export function placeJobs(checks, packages) {
  const places = checks.map((check) => placeCheck(check, packages));
  const jobs = [...new Set(checks.map((check) => check.job))];
  const byJob = {};
  const unplaced = places.filter((place) => place.kind === 'unplaced').map((place) => place.reason);
  for (const job of jobs.filter((id) => !ALWAYS_JOBS.includes(id))) {
    const owned = places.filter((place, index) => checks[index].job === job && place.kind === 'package').flatMap((place) => place.packages);
    if (owned.length) byJob[job] = [...new Set(owned)].sort();
    else if (!places.some((place, index) => checks[index].job === job && place.kind === 'unplaced')) {
      unplaced.push(`job ${job} is neither in the always set nor about a package: list it in ALWAYS_JOBS `
        + '(scripts/store-ci-scope.mjs) or run its steps inside the package they test');
    }
  }
  return { places, always: jobs.filter((id) => ALWAYS_JOBS.includes(id)), packages: byJob, unplaced: [...new Set(unplaced)] };
}

/**
 * @description Compare two versions of marketplace.json entry by entry, on what they say.
 * @param {string|null} baseText The catalog at the base commit, or null when it could not be read.
 * @param {string|null} headText The catalog in the working tree.
 * @param {string[]} packages The store's package folders.
 * @returns {{packages:string[],full:string}} Folders whose entry differs; or why everything must run.
 */
export function catalogChanges(baseText, headText, packages) {
  let base;
  let head;
  try {
    base = JSON.parse(baseText ?? '');
    head = JSON.parse(headText ?? '');
  } catch {
    return { packages: [], full: 'marketplace.json could not be read on both sides of the change' };
  }
  const rest = ({ apps: _apps, ...other }) => JSON.stringify(other);
  if (!Array.isArray(base?.apps) || !Array.isArray(head?.apps) || rest(base) !== rest(head)) {
    return { packages: [], full: 'marketplace.json changed outside its apps entries' };
  }
  const byName = (catalog) => new Map(catalog.apps.map((entry) => [entry?.name, entry]));
  const [before, after] = [byName(base), byName(head)];
  const changed = new Set();
  for (const name of new Set([...before.keys(), ...after.keys()])) {
    if (JSON.stringify(before.get(name)) === JSON.stringify(after.get(name))) continue;
    for (const entry of [before.get(name), after.get(name)].filter(Boolean)) {
      const folder = entry.source?.path;
      if (!packages.includes(folder)) {
        return { packages: [], full: `catalog entry ${name} points at ${folder}, which is not a package folder` };
      }
      changed.add(folder);
    }
  }
  return { packages: [...changed].sort(), full: '' };
}

/**
 * @description Place every changed path: in a package, as a root document, or as a reason to run everything.
 * @param {string[]} paths Changed paths, relative to the store root, forward slashes.
 * @param {{packages:string[],catalogDirs:Map<string,string>}} context Package folders; catalog name to folder.
 * @returns {{changed:string[],rootEntries:string[],full:string}} Changed packages, changed root entries
 *   (marketplace.json and root documents, which only the always set and a test that reads one can see),
 *   and the first reason the whole suite must run ('' when every path is placed).
 */
export function placePaths(paths, { packages, catalogDirs }) {
  const changed = new Set();
  const rootEntries = new Set();
  const done = (full) => ({ changed: [...changed].sort(), rootEntries: [...rootEntries].sort(), full });
  for (const path of paths) {
    const parts = path.split('/');
    if (parts.length === 1) {
      if (path !== 'marketplace.json' && !path.endsWith('.md')) return done(`${path} is a root file every package shares`);
      rootEntries.add(path);
    } else if (GATE_FOLDERS.includes(parts[0])) {
      return done(`${path} changed, and ${parts[0]}/ is part of the gate itself`);
    } else if (parts[0] === 'audits') {
      const name = parts[1] === 'evidence' && parts.length > 3 ? parts[2] : parts.length === 2 ? /^(.+)[.]json$/.exec(parts[1])?.[1] : '';
      const folder = catalogDirs.get(name);
      if (!folder || !packages.includes(folder)) return done(`${path} belongs to no catalog package`);
      changed.add(folder);
    } else if (packages.includes(parts[0])) {
      changed.add(parts[0]);
    } else {
      return done(`${path} is in a folder that is not a package (no ${parts[0]}/oshal-app.yaml)`);
    }
  }
  return done('');
}

/**
 * @description The packages that depend on each package, from every manifest and from the catalog's mirror.
 * @param {string} root The store root.
 * @param {string[]} packages The store's package folders.
 * @returns {{required:Map<string,Set<string>>,optional:Map<string,Set<string>>,catalogDirs:Map<string,string>,problems:string[]}}
 *   Dependants by tier, keyed by the folder depended on; catalog name to folder; unreadable declarations.
 */
export function dependencyGraph(root, packages) {
  const catalogDirs = new Map(packages.map((folder) => [folder, folder]));
  const problems = [];
  let catalog = { apps: [] };
  try {
    catalog = JSON.parse(readFileSync(join(root, 'marketplace.json'), 'utf8'));
  } catch (error) {
    problems.push(`marketplace.json could not be read (${error.message})`);
  }
  const entries = Array.isArray(catalog.apps) ? catalog.apps.filter((entry) => packages.includes(entry?.source?.path)) : [];
  for (const entry of entries) catalogDirs.set(entry.name, entry.source.path);
  const graph = { required: new Map(), optional: new Map(), catalogDirs, problems };
  const add = (tier, names, dependant) => {
    for (const name of names ?? []) {
      const folder = catalogDirs.get(name);
      if (!folder || folder === dependant) continue; // a package of another store, or itself
      if (!graph[tier].has(folder)) graph[tier].set(folder, new Set());
      graph[tier].get(folder).add(dependant);
    }
  };
  const addBlock = (block, dependant) => {
    if (!block) return;
    const tiered = block.required || block.optional;
    add('required', tiered ? block.required?.apps : block.apps, dependant);
    add('optional', block.optional?.apps, dependant);
  };
  for (const folder of packages) {
    const read = readManifestDependencies(readFileSync(join(root, folder, 'oshal-app.yaml'), 'utf8'), `${folder}/oshal-app.yaml`);
    problems.push(...read.problems);
    addBlock(read.dependencies, folder);
  }
  for (const entry of entries) addBlock(entry.dependencies, entry.source.path);
  return graph;
}

/** @description Every source file under a folder whose name the pattern matches, node_modules left out. */
function testSources(folder, found = [], pattern = TEST_SOURCE) {
  if (!existsSync(folder)) return found;
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(folder, entry.name);
    if (entry.isDirectory()) testSources(full, found, pattern);
    else if (pattern.test(entry.name)) found.push(full);
  }
  return found;
}

/**
 * @description Which packages' tests read something outside their own folder by a path written in the
 *   test: a quoted relative path, or '..' segments handed to a path join. A test that reads a sibling
 *   package's file can change its verdict when that package changes, whether or not a dependency is
 *   declared. Paths built from variables are not seen here; the scheduled full run covers those.
 * @param {string} root The store root.
 * @param {string[]} packages The store's package folders.
 * @returns {Map<string,Set<string>>} Top-level entry (a package folder or a root file) to the packages whose tests read it.
 */
export function testReads(root, packages) {
  const reads = new Map();
  for (const reader of packages) {
    for (const file of testSources(join(root, reader, 'tests'))) {
      const text = readFileSync(file, 'utf8');
      const targets = [...text.matchAll(/['"`]((?:\.\.\/)+[A-Za-z0-9_.@-][^'"`\n$]*)['"`]/g)].map((m) => resolve(dirname(file), m[1]));
      for (const m of text.matchAll(/((?:['"`]\.\.['"`]\s*,\s*)+)['"`]([A-Za-z0-9_.@-]+)['"`]/g)) {
        targets.push(resolve(dirname(file), ...Array((m[1].match(/\.\./g) ?? []).length).fill('..'), m[2]));
      }
      for (const target of targets) {
        const entry = relative(root, target).split(sep)[0];
        if (!entry || entry === '..' || entry === reader) continue;
        if (!reads.has(entry)) reads.set(entry, new Set());
        reads.get(entry).add(reader);
      }
    }
  }
  return reads;
}

/**
 * @description The packages a change reaches, each with the reason it is selected. A required dependant
 *   cannot work without what it requires, so required edges are followed through the whole chain. An
 *   optional dependant has a declared edge to the changed package and its tests can cross it, so it runs
 *   too, one hop out; so does a package whose tests read the changed package, or a changed root entry.
 * @param {string[]} changed Changed package folders.
 * @param {string[]} rootEntries Changed root entries (marketplace.json, root documents).
 * @param {{required:Map<string,Set<string>>,optional:Map<string,Set<string>>}} graph Dependants by tier.
 * @param {Map<string,Set<string>>} reads Entry to the packages whose tests read it.
 * @returns {Map<string,string>} Selected package to its reason, changed packages first.
 */
export function selectPackages(changed, rootEntries, graph, reads) {
  const selected = new Map(changed.map((folder) => [folder, 'changed']));
  const queue = [...changed];
  while (queue.length) {
    const folder = queue.shift();
    for (const dependant of graph.required.get(folder) ?? []) {
      if (selected.has(dependant)) continue;
      selected.set(dependant, `requires ${folder}`);
      queue.push(dependant);
    }
  }
  for (const folder of changed) {
    for (const dependant of graph.optional.get(folder) ?? []) {
      if (!selected.has(dependant)) selected.set(dependant, `optionally uses ${folder}`);
    }
  }
  for (const entry of [...changed, ...rootEntries]) {
    for (const reader of reads.get(entry) ?? []) {
      if (!selected.has(reader)) selected.set(reader, `its tests read ${entry}`);
    }
  }
  return selected;
}

/** @description Run git in the store with no inherited repository location; null when it fails. */
function git(root, args) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  const run = spawnSync('git', ['-C', root, ...args], { env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return run.status === 0 ? run.stdout : null;
}

/** @description Whether the store root is the top of its own git checkout. */
function isCheckoutTop(root) {
  const top = git(root, ['rev-parse', '--show-toplevel'])?.trim();
  return Boolean(top) && realpathSync(top) === realpathSync(root);
}

/**
 * @description A fingerprint of the tree a run saw: the head commit and every difference from it. A rerun
 *   of failed jobs is accepted only on the same fingerprint, so it cannot stand in for a different tree.
 * @param {string} root The store root.
 * @returns {string} A sha256, or '' when this is not a git checkout.
 */
export function treeFingerprint(root) {
  if (!isCheckoutTop(root)) return '';
  const head = git(root, ['rev-parse', 'HEAD']);
  const status = git(root, ['status', '--porcelain=v1', '--untracked-files=all', '-z']);
  const diff = git(root, ['diff', 'HEAD', '--binary', '--no-ext-diff']);
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard', '-z']);
  if ([head, status, diff, untracked].includes(null)) return '';
  const hash = createHash('sha256').update(head).update(status).update(diff);
  for (const file of untracked.split('\0').filter(Boolean)) hash.update(file).update(readFileSync(join(root, file)));
  return hash.digest('hex');
}

/**
 * @description Read what changed in a store checkout since the base: every tracked difference between the
 *   base commit and the working tree (the gate tests the working tree, so uncommitted edits count) and
 *   every untracked file.
 * @param {string} root The store root.
 * @param {string} baseRef A revision to measure from, or '' for the merge base with origin/main.
 * @returns {{base:string,paths:string[],baseCatalog:string|null,full:string}} The base commit, the changed
 *   paths, the catalog at the base, and why the change could not be read ('' when it could).
 */
export function readChange(root, baseRef = '') {
  const none = (full) => ({ base: '', paths: [], baseCatalog: null, full });
  if (!isCheckoutTop(root)) return none('this is not the top of a git checkout, so there is no change to measure');
  const base = (baseRef
    ? git(root, ['rev-parse', '--verify', '--quiet', `${baseRef}^{commit}`])
    : git(root, ['merge-base', 'origin/main', 'HEAD']))?.trim();
  if (!base) return none(baseRef ? `the base ${baseRef} is not a commit here` : 'no merge base with origin/main could be read here');
  const tracked = git(root, ['diff', '--name-only', '--no-renames', '-z', base]);
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard', '-z']);
  if (tracked === null || untracked === null) return none('git could not list what changed');
  const paths = [...new Set([...tracked.split('\0'), ...untracked.split('\0')].filter(Boolean))].sort();
  return { base, paths, baseCatalog: git(root, ['show', `${base}:marketplace.json`]), full: '' };
}

/**
 * @description The service variables a set of selected package steps needs: declared by a step, or named
 *   anywhere in a selected package's sources (its tests, its engine's tests, a fixture, a Python suite).
 *   store-push starts only these, so reading too widely costs a container and reading too narrowly fails
 *   a suite; it reads widely.
 */
function servicesNeeded(root, checks, selectedFolders) {
  const needed = new Set(checks.flatMap((check) => check.envKeys ?? []).filter((key) => SERVICE_VARIABLES.includes(key)));
  for (const folder of selectedFolders) {
    for (const file of testSources(join(root, folder), [], SERVICE_READER)) {
      const text = readFileSync(file, 'utf8');
      for (const key of SERVICE_VARIABLES) if (text.includes(key)) needed.add(key);
    }
  }
  return SERVICE_VARIABLES.filter((key) => needed.has(key));
}

/**
 * @description Decide what one run has to run.
 * @param {string} root The store root.
 * @param {object[]} checks The runner's plan, in workflow order (job, command, workingDirectory, envKeys).
 * @param {{full:boolean,base:string}} options Whether the whole suite was asked for; a base to measure from.
 * @returns {object} mode ('scoped' or 'full'), reason (why full), run (a boolean per check), base, paths,
 *   changed, selected (Map of folder to reason), placement, and the services the run needs.
 */
export function decideScope(root, checks, { full = false, base = '' } = {}) {
  const packages = packageFolders(root);
  const placement = placeJobs(checks, packages);
  const everything = (reason, extra = {}) => ({
    mode: 'full', reason, run: checks.map(() => true), base: '', paths: [], changed: [], selected: new Map(),
    placement, services: [...SERVICE_VARIABLES], ...extra,
  });
  if (full) return everything('asked for with --full');
  if (placement.unplaced.length) return everything(placement.unplaced[0]);
  const change = readChange(root, base);
  if (change.full) return everything(change.full);
  const seen = { base: change.base, paths: change.paths };
  const graph = dependencyGraph(root, packages);
  if (graph.problems.length) return everything(`a dependency declaration could not be read (${graph.problems[0]})`, seen);
  const placed = placePaths(change.paths, { packages, catalogDirs: graph.catalogDirs });
  if (placed.full) return everything(placed.full, seen);
  const changed = new Set(placed.changed);
  if (placed.rootEntries.includes('marketplace.json')) {
    const head = existsSync(join(root, 'marketplace.json')) ? readFileSync(join(root, 'marketplace.json'), 'utf8') : null;
    const catalog = catalogChanges(change.baseCatalog, head, packages);
    if (catalog.full) return everything(catalog.full, seen);
    for (const folder of catalog.packages) changed.add(folder);
  }
  const selected = selectPackages([...changed].sort(), placed.rootEntries, graph, testReads(root, packages));
  const run = placement.places.map((place) => place.kind === 'always' || place.packages.some((folder) => selected.has(folder)));
  const services = servicesNeeded(root, checks.filter((_check, index) => run[index]), [...selected.keys()]);
  return { mode: 'scoped', reason: '', run, ...seen, changed: [...changed].sort(), selected, placement, services };
}

/**
 * @description The commit the working tree is on.
 * @param {string} root The store root.
 * @returns {string} The full commit id, or '' outside a git checkout.
 */
export function headCommit(root) {
  return isCheckoutTop(root) ? git(root, ['rev-parse', 'HEAD'])?.trim() ?? '' : '';
}
