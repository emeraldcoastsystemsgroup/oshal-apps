/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Backlog #33: the seven package-audit controls the reproducible runner executes against one package extracted at an exact commit. Each control reuses the store's existing gates (catalog parity, route/write inventory, forced RLS, dependency edges, connector allow-lists, secret fallbacks, the surface auditor) or the core installer CLI, scoped to the one package, and returns named checks with their problems and no timings, so re-running it over the same source reproduces the same evidence bytes. Controls the runner cannot yet prove (migration replay against disposable PostgreSQL, third-party advisory scans, framework-importing surfaces) FAIL with a stated reason rather than pass silently.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | Supply the documented OSHAL_ROOT compiler path to isolated package tests without inheriting ambient credentials.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Audit declared experience contexts through the real loader and reviewed isolated roles; require all three variants and awaited cleanup.
 */

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { catalogProblems } from '../check-catalog.mjs';
import { forcedRlsProblems } from '../check-forced-rls.mjs';
import { undeclaredEdges } from '../app-dependency-declarations.mjs';
import { readManifestDependencies } from '../manifest-dependencies.mjs';
import { connectorDeclarationProblems } from '../check-connector-declarations.mjs';
import { findPublicSecretFallbacks } from '../check-no-public-secret-fallback.mjs';
import { routeInventory } from './check-store-security.mjs';
import { UNAUDITED_SOURCE_SHA, PACKAGE_AUDIT_CONTROLS } from './validate-package-audits.mjs';
import { startExperienceSurfaceHost } from './experience-surface-host.mjs';

/** Environment keys a control's child process may inherit; no token, key or session material. */
const CHILD_ENV_KEYS = [
  'PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'windir', 'WINDIR', 'ComSpec', 'TEMP', 'TMP', 'TMPDIR',
  'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA', 'ProgramData', 'PLAYWRIGHT_BROWSERS_PATH', 'LANG',
];
const ANSI = /\u001b\[[0-9;]*m/g;

/**
 * @description Build one named check with sorted, de-duplicated problems and extra detail.
 * @param {string} name - Check name.
 * @param {string[]} problems - Problems found; empty means passed.
 * @param {object} detail - Deterministic detail recorded beside the result.
 * @returns {{name:string,result:'passed'|'failed',problems:string[]}} The check.
 */
export function check(name, problems, detail = {}) {
  const unique = [...new Set(problems.map(String))].sort();
  return { name, result: unique.length ? 'failed' : 'passed', problems: unique, ...detail };
}

/** @description The least-privilege environment for a control's child process. */
export function childEnv(extra = {}, parent = process.env) {
  const env = {};
  for (const key of CHILD_ENV_KEYS) if (parent[key] !== undefined) env[key] = parent[key];
  return { ...env, GIT_TERMINAL_PROMPT: '0', NO_COLOR: '1', ...extra };
}

/** @description Replace run-specific absolute paths so evidence text is identical on every run. */
export function relativize(text, ctx) {
  let out = String(text).replace(ANSI, '');
  for (const [path, label] of [[ctx.tree, '<source>'], [ctx.tmp, '<run>'], [ctx.framework, '<framework>']]) {
    if (!path) continue;
    for (const variant of new Set([path, path.split(sep).join('/'), path.split('/').join('\\')])) {
      out = out.split(variant).join(label);
    }
  }
  return out;
}

/** @description Run node synchronously with a sanitized environment. */
function runNode(args, options) {
  const result = spawnSync(process.execPath, args, {
    encoding: 'utf8', env: childEnv(options.env), cwd: options.cwd, timeout: options.timeout ?? 180_000, maxBuffer: 16 * 1024 * 1024,
  });
  return { status: result.status, output: `${result.stdout ?? ''}\n${result.stderr ?? ''}`, error: result.error };
}

/**
 * @description Parse node:test TAP into named outcomes, ignoring durations. Nested tests keep their
 * parent's name as a prefix so identical subtest names stay distinct.
 * @param {string} tap - TAP text from `node --test --test-reporter=tap`.
 * @returns {Array<{name:string,result:'passed'|'failed'|'skipped'}>} Outcomes in report order.
 */
export function parseTapOutcomes(tap) {
  const outcomes = [];
  const stack = [];
  for (const line of String(tap).split(/\r?\n/)) {
    const subtest = /^(\s*)# Subtest: (.*)$/.exec(line);
    if (subtest) { stack[subtest[1].length / 4] = subtest[2].trim(); continue; }
    const match = /^(\s*)(not ok|ok) \d+ - (.*?)(?:\s+#\s+(SKIP|TODO)\b.*)?$/.exec(line);
    if (!match) continue;
    const depth = match[1].length / 4;
    const name = [...stack.slice(0, depth), match[3].trim()].join(' > ');
    const result = match[4] ? 'skipped' : match[2] === 'ok' ? 'passed' : 'failed';
    outcomes.push({ name, result });
    stack.length = depth;
  }
  return outcomes;
}

/** @description Run node:test files in the package directory and grade them as one check. */
function nodeTestCheck(ctx, name, files, timeout) {
  const run = runNode(['--test', '--test-reporter=tap', ...files], {
    cwd: ctx.pkgDir, timeout, env: { OSHAL_CORE_DIR: ctx.framework, OSHAL_FRAMEWORK_ROOT: ctx.framework, OSHAL_ROOT: ctx.framework },
  });
  const tests = parseTapOutcomes(run.output);
  const problems = [];
  if (run.error) problems.push(`node --test could not complete: ${run.error.code ?? run.error.message}`);
  if (!tests.length) problems.push('node --test reported no tests');
  for (const test of tests) if (test.result !== 'passed') problems.push(`${test.result}: ${test.name}`);
  if (run.status !== 0 && !problems.length) problems.push(`node --test exited ${run.status}`);
  return check(name, problems.map((problem) => relativize(problem, ctx)), { files, tests });
}

/** @description Memoized store route/write inventory for the extracted tree. */
function inventoryOf(ctx) {
  if (!ctx.memo.inventory) {
    try { ctx.memo.inventory = { lines: routeInventory(ctx.tree) }; }
    catch (error) { ctx.memo.inventory = { error: relativize(error.message, ctx).split('\n')[0] }; }
  }
  return ctx.memo.inventory;
}

/** @description Problems a whole-store checker reports that concern this package or the whole store. */
function concernsPackage(problem, ctx) {
  const text = String(problem);
  return [`${ctx.dir}:`, `${ctx.dir}/`, `${ctx.dir} (`, `audits/${ctx.app}.json`, `${ctx.app}:`].some((prefix) => text.startsWith(prefix))
    || text.includes(JSON.stringify(ctx.app)) || /^(marketplace\.json|README\.md)/.test(text);
}

/** @description manifest: core package validation, catalog parity, and compiled-route peers. */
export async function manifestControl(ctx) {
  const validate = runNode([join(ctx.framework, 'scripts', 'oshal-app.js'), 'validate', ctx.pkgDir], { cwd: ctx.tmp });
  const lines = relativize(validate.output, ctx).split(/\r?\n/);
  const errors = lines.map((line) => /^\s*error\s+(.*)$/.exec(line)?.[1]).filter(Boolean);
  const warnings = lines.map((line) => /^\s*warn\s+(.*)$/.exec(line)?.[1]).filter(Boolean).sort();
  if (validate.status !== 0 && !errors.length) errors.push(`oshal-app validate exited ${validate.status}`);
  let catalog;
  try { catalog = catalogProblems(ctx.tree).filter((problem) => concernsPackage(problem, ctx)); }
  catch (error) { catalog = [`catalog could not be read: ${error.message}`]; }
  const inventory = inventoryOf(ctx);
  return [
    check('core-validate', errors, { warnings }),
    check('catalog-parity', catalog.map((problem) => relativize(problem, ctx))),
    check('compiled-route-peers', inventory.error ? [inventory.error] : []),
  ];
}

/** @description Package test files that exercise authorization or isolation. */
function authorizationTests(ctx) {
  const directory = join(ctx.pkgDir, 'tests');
  if (!existsSync(directory)) return [];
  return readdirSync(directory).filter((file) => /\.test\.(?:js|cjs|mjs)$/.test(file) && /(authz|authoriz|isolation|owner|rls)/i.test(file))
    .sort().map((file) => `tests/${file}`);
}

/** @description authz: the package's routes equal the reviewed ledger; writes need an authorization test. */
export async function authzControl(ctx) {
  const inventory = inventoryOf(ctx);
  const ledgerPath = join(ctx.tree, 'scripts', 'security', 'store-route-inventory.json');
  const reviewed = existsSync(ledgerPath) ? (JSON.parse(readFileSync(ledgerPath, 'utf8')).routes ?? []) : null;
  const mine = (lines) => lines.filter((line) => line.startsWith(`${ctx.dir}|`)).sort();
  const discovered = inventory.error ? [] : mine(inventory.lines);
  const problems = [];
  if (inventory.error) problems.push(inventory.error);
  if (!reviewed) problems.push('scripts/security/store-route-inventory.json is missing');
  else {
    for (const line of discovered) if (!reviewed.includes(line)) problems.push(`unreviewed route ${line}`);
    for (const line of mine(reviewed)) if (!discovered.includes(line)) problems.push(`reviewed route no longer present ${line}`);
  }
  const checks = [check('route-ledger', problems, { routes: discovered })];
  const writes = discovered.filter((line) => line.endsWith('|machine-write'));
  if (!writes.length) return [...checks, check('write-route-authorization', [], { writeRoutes: [] })];
  const files = authorizationTests(ctx);
  if (!files.length) return [...checks, check('write-route-authorization', ['machine-write routes have no runnable authorization/isolation test'], { writeRoutes: writes })];
  return [...checks, nodeTestCheck(ctx, 'write-route-authorization', files, 300_000)];
}

/** @description rls: forced row security for this package's migrations; replay proof when it has any. */
export async function rlsControl(ctx) {
  const migrationsDir = join(ctx.pkgDir, 'migrations');
  const migrations = existsSync(migrationsDir) ? readdirSync(migrationsDir).filter((file) => file.endsWith('.sql')).sort() : [];
  const forced = forcedRlsProblems(ctx.tree).filter((problem) => problem.startsWith(`${ctx.dir}/migrations/`));
  const replay = migrations.length
    ? [`${migrations.length} migration(s) need the disposable PostgreSQL replay and two-owner isolation proof, which this runner does not implement yet`]
    : [];
  return [check('forced-row-security', forced), check('migration-replay', replay, { migrations })];
}

/** @description Files that declare third-party dependencies an advisory scan would have to cover. */
function thirdPartyManifests(ctx) {
  const found = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = join(directory, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      const rel = relative(ctx.pkgDir, full).split(sep).join('/');
      if (entry.name === 'package.json') {
        const json = JSON.parse(readFileSync(full, 'utf8'));
        if (Object.keys({ ...json.dependencies, ...json.optionalDependencies }).length) found.push(rel);
      } else if (/^requirements.*\.txt$|^pyproject\.toml$/.test(entry.name)) found.push(rel);
    }
  };
  walk(ctx.pkgDir);
  return found.sort();
}

/** @description dependencies: declared app edges, connector allow-list, secret fallbacks, third-party scan. */
export async function dependenciesControl(ctx) {
  const edges = undeclaredEdges(ctx.tree, readManifestDependencies).filter((row) => row.pkg === ctx.app)
    .flatMap((row) => row.proofs.map((proof) => `${row.pkg} -> ${row.other}: ${proof.shape} ${proof.file}:${proof.line}`));
  const connectors = connectorDeclarationProblems(ctx.tree).filter((problem) => problem.startsWith(`${ctx.app}:`));
  const fallbacks = findPublicSecretFallbacks(ctx.tree)
    .filter((finding) => finding.file.split(sep).join('/').startsWith(`${ctx.dir}/`))
    .map((finding) => `${finding.file.split(sep).join('/')}:${finding.line} [${finding.kind}]`);
  const thirdParty = thirdPartyManifests(ctx);
  return [
    check('declared-app-edges', edges),
    check('connector-allow-list', connectors),
    check('public-secret-fallback', fallbacks),
    check('third-party-advisories', thirdParty.length
      ? [`third-party dependencies need an advisory scan this offline runner does not perform: ${thirdParty.join(', ')}`] : [], { manifests: thirdParty }),
  ];
}

/** @description Every file under a directory with its SHA-256, excluding the installer's provenance stamp. */
export function treeDigest(root) {
  const files = {};
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name !== '.oshal-install.json') {
        files[relative(root, full).split(sep).join('/')] = createHash('sha256').update(readFileSync(full)).digest('hex');
      }
    }
  };
  if (existsSync(root)) walk(root);
  return files;
}

/** @description A throwaway single-commit store of the audited tree whose audit record is neutral. */
function lifecycleStore(ctx) {
  const store = join(ctx.tmp, 'lifecycle-store');
  mkdirSync(store, { recursive: true });
  const archive = spawnSync('git', ['-C', ctx.root, 'archive', '--format=tar', ctx.sha], { maxBuffer: 1024 * 1024 * 1024 });
  const tar = spawnSync('tar', ['-xf', '-'], { cwd: store, input: archive.stdout, maxBuffer: 64 * 1024 * 1024 });
  if (archive.status !== 0 || tar.status !== 0) throw new Error('could not stage the lifecycle store');
  const catalogPath = join(store, 'marketplace.json');
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
  for (const app of catalog.apps) if (app.name === ctx.app) app.audit = { record: `audits/${ctx.app}.json`, sourceSha: UNAUDITED_SOURCE_SHA };
  writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
  writeFileSync(join(store, 'audits', `${ctx.app}.json`), `${JSON.stringify({
    profileVersion: 1, app: ctx.app, version: ctx.entry.version, sourceSha: UNAUDITED_SOURCE_SHA, status: 'pending', auditedAt: null,
    controls: Object.fromEntries(PACKAGE_AUDIT_CONTROLS.map((name) => [name, 'pending'])), evidence: [],
  }, null, 2)}\n`);
  for (const args of [['init', '-q', '-b', 'main'], ['add', '-A'], ['-c', 'user.name=oshal package audit', '-c', 'user.email=maintainer@emeraldcoastsystemsgroup.com', 'commit', '-q', '-m', 'lifecycle store']]) {
    const result = spawnSync('git', ['-C', store, '-c', 'core.autocrlf=false', ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    if (result.status !== 0) throw new Error(`lifecycle store git ${args[0]} failed`);
  }
  return pathToFileURL(store).href;
}

/** @description One installer CLI step graded against the expected on-disk outcome. */
function lifecycleStep(ctx, name, args, expectInstalled) {
  const run = runNode([join(ctx.framework, 'scripts', 'oshal-app.js'), ...args], { cwd: ctx.tmp, timeout: 300_000 });
  const target = join(ctx.tmp, 'lifecycle-dest', ctx.app);
  const problems = [];
  if (run.status !== 0) problems.push(`${args[0]} exited ${run.status}: ${relativize(run.output, ctx).split('\n').find((line) => /error|failed|refusing/i.test(line))?.trim() ?? 'no error line'}`);
  if (expectInstalled) {
    const installed = treeDigest(target);
    const source = treeDigest(ctx.pkgDir);
    if (JSON.stringify(installed) !== JSON.stringify(source)) problems.push('installed files differ from the audited package tree');
    const stamp = join(target, '.oshal-install.json');
    const provenance = existsSync(stamp) ? JSON.parse(readFileSync(stamp, 'utf8')) : null;
    if (provenance?.name !== ctx.app || provenance?.audit?.verified !== false) problems.push('provenance stamp is missing or claims a verification the store did not give');
  } else if (existsSync(target)) problems.push('package directory remains after uninstall');
  return check(name, problems);
}

/** @description installLifecycle: install, update, uninstall and reinstall through the core installer CLI. */
export async function installLifecycleControl(ctx) {
  let repo;
  try { repo = lifecycleStore(ctx); } catch (error) { return [check('lifecycle-store', [error.message])]; }
  const dest = join(ctx.tmp, 'lifecycle-dest');
  const install = ['install', ctx.app, '--repo', repo, '--ref', 'main', '--dest', dest, '--audit-mode', 'compatible'];
  return [
    lifecycleStep(ctx, 'install', install, true),
    lifecycleStep(ctx, 'update', install, true),
    lifecycleStep(ctx, 'uninstall', ['uninstall', ctx.app, '--dest', dest, '--yes'], false),
    lifecycleStep(ctx, 'reinstall', install, true),
  ];
}

/** @description The package route that serves a surface: the longest mount path prefixing it. */
function surfaceRoute(manifest, surfacePath) {
  const path = surfacePath.split('?')[0];
  return (manifest.routes ?? [])
    .filter((route) => path === route.mountPath || path.startsWith(`${route.mountPath}/`))
    .sort((a, b) => b.mountPath.length - a.mountPath.length)[0] ?? null;
}

/** @description Why a route cannot be mounted on the audit host, or null when it can. */
function unmountableReason(ctx, route) {
  if (!route) return 'no package route serves it';
  const modulePath = resolve(ctx.pkgDir, route.module);
  if (!modulePath.startsWith(resolve(ctx.pkgDir) + sep) || !existsSync(modulePath)) return `route module ${route.module} is missing`;
  if (route.requiresContext) return `route ${route.mountPath} requires the application context; the audit host cannot supply it yet`;
  return null;
}

/** @description Start a loopback host that serves the shared UI assets and the package's surface routes. */
async function startSurfaceHost(ctx, routes) {
  const frameworkRequire = createRequire(join(ctx.framework, 'package.json'));
  const express = frameworkRequire('express');
  const packageRequire = createRequire(join(ctx.pkgDir, 'oshal-app.yaml'));
  const app = express();
  app.use('/shared', express.static(join(ctx.framework, 'src', 'shared')));
  app.use('/cockpit', express.static(join(ctx.framework, 'src', 'pages', 'cockpit')));
  const blocked = [];
  for (const route of routes) {
    // A route that reaches the framework (@/ imports) needs the real host: say so instead of guessing.
    try { app.use(route.mountPath, packageRequire(resolve(ctx.pkgDir, route.module))[route.factory](undefined)); }
    catch (error) { blocked.push(`route ${route.mountPath} cannot be mounted on the audit host: ${relativize(error.message, ctx).split('\n')[0]}`); }
  }
  if (blocked.length) return { blocked };
  const server = await new Promise((done, fail) => { const s = app.listen(0, '127.0.0.1', () => done(s)); s.once('error', fail); });
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}`, blocked };
}

/** @description Run the store's surface auditor against the host and collect its per-surface verdicts. */
async function auditSurfaces(ctx, baseUrl) {
  const outputDir = join(ctx.tmp, 'surface-audit');
  const env = childEnv({
    OSHAL_CORE_DIR: ctx.framework, OSHAL_SURFACE_BASE_URL: baseUrl, OSHAL_SURFACE_AUDIT_DIR: outputDir, OSHAL_SURFACE_APPS: ctx.app,
    OSHAL_SURFACE_EMBEDDED: '0', OSHAL_GUEST_COOKIE: 'package-audit', OSHAL_SURFACE_SCREENSHOTS: '0', OSHAL_SURFACE_CONCURRENCY: '1',
  });
  const code = await new Promise((done) => {
    const child = spawn(process.execPath, [join(ctx.tree, 'scripts', 'audit-live-surfaces.mjs')], { cwd: ctx.tmp, env, stdio: 'ignore' });
    const timer = setTimeout(() => child.kill(), 300_000);
    child.on('exit', (status) => { clearTimeout(timer); done(status); });
    child.on('error', () => { clearTimeout(timer); done(-1); });
  });
  const reportPath = join(outputDir, 'report.json');
  if (!existsSync(reportPath)) return { problems: [`surface auditor exited ${code} without a report`], summaries: [] };
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  const summaries = report.summaries.map((summary) => ({ path: summary.path, failures: [...summary.failures].sort(), warnings: [...summary.warnings].sort(),
    variants: (summary.variants ?? []).map(variant => variant.variant).sort() }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const problems = summaries.flatMap((summary) => summary.failures.map((failure) => `${summary.path}: ${failure}`));
  if (code !== 0) problems.push(`surface auditor exited ${code}`);
  return { problems, summaries };
}

/** @description Context-backed experience audit with complete declared-surface and variant coverage. */
async function auditExperienceSurfaces(ctx, surfaces) {
  let host;
  const problems = [];
  let summaries = [];
  try {
    host = await startExperienceSurfaceHost(ctx, childEnv({ NODE_PATH: join(ctx.framework, 'node_modules'), NODE_OPTIONS: '--max-old-space-size=384' }));
    const audited = await auditSurfaces(ctx, host.baseUrl); problems.push(...audited.problems); summaries = audited.summaries;
    problems.push(...surfaceCoverageProblems(surfaces, summaries));
  } catch (error) { problems.push(relativize(error.message, ctx)); }
  finally { if (host) { try { await host.close(); } catch (error) { problems.push(relativize(error.message, ctx)); } } }
  return [check('rendered-experience-surfaces', problems, { surfaces: summaries, isolation: 'real-package-policy-with-synthetic-member-apis' })];
}

/**
 * @description Refuse missing declared surfaces, unexpected surfaces and missing audit variants.
 * @param {string[]} surfaces - Declared package entries.
 * @param {object[]} summaries - Actual browser reports.
 * @returns {string[]} Coverage failures.
 */
export function surfaceCoverageProblems(surfaces, summaries) {
  const variants = ['desktop-daylight', 'desktop-ocean', 'mobile-ocean'];
  const problems = [];
  for (const path of surfaces) {
    const matches = summaries.filter(summary => summary.path === path);
    if (matches.length !== 1) { problems.push(`${path}: expected exactly one surface report`); continue; }
    if (JSON.stringify(matches[0].variants) !== JSON.stringify(variants)) problems.push(`${path}: desktop, mobile and second-theme coverage is incomplete`);
  }
  for (const summary of summaries) if (!surfaces.includes(summary.path)) problems.push(`${summary.path}: undeclared surface report`);
  return problems;
}

/** @description surface: every declared surface renders on desktop, mobile and a second theme. */
export async function surfaceControl(ctx) {
  const manifest = ctx.parseYaml(readFileSync(join(ctx.pkgDir, 'oshal-app.yaml'), 'utf8')) ?? {};
  const surfaces = (manifest.ui?.static ?? []).filter((surface) => surface?.iframeUrl).map((surface) => surface.iframeUrl).sort();
  if (!surfaces.length) return [check('declared-surfaces', [], { surfaces })];
  if (manifest.experience?.version === 1) return auditExperienceSurfaces(ctx, surfaces);
  const routes = new Map();
  const blocked = [];
  for (const surface of surfaces) {
    const route = surfaceRoute(manifest, surface);
    const reason = unmountableReason(ctx, route);
    if (reason) blocked.push(`${surface}: ${reason}`);
    else routes.set(route.mountPath, route);
  }
  if (blocked.length) return [check('declared-surfaces', blocked, { surfaces })];
  const { server, baseUrl, blocked: unmountable } = await startSurfaceHost(ctx, [...routes.values()]);
  if (unmountable.length) return [check('declared-surfaces', unmountable, { surfaces })];
  try {
    const audited = await auditSurfaces(ctx, baseUrl);
    return [check('rendered-surfaces', audited.problems, { surfaces: audited.summaries })];
  } finally {
    await new Promise((done) => server.close(done));
  }
}

/** @description goldenPath: every offline node-test case the package's Test Lab catalog declares. */
export async function goldenPathControl(ctx) {
  const catalogPath = join(ctx.pkgDir, 'tests', 'test-lab.yaml');
  if (!existsSync(catalogPath)) return [check('declared-golden-path', ['tests/test-lab.yaml is missing'])];
  const cases = (ctx.parseYaml(readFileSync(catalogPath, 'utf8'))?.cases ?? []);
  const offline = cases.filter((item) => item?.runner?.kind === 'node-test' && (item.runner.scope ?? 'package') === 'package'
    && Array.isArray(item.runner.files) && (item.prerequisites ?? []).every((need) => need === 'runner:node-test'));
  const notRun = cases.filter((item) => !offline.includes(item)).map((item) => String(item?.id)).sort();
  if (!offline.length) return [check('declared-golden-path', ['tests/test-lab.yaml declares no offline node-test case'], { notRun })];
  return offline.map((item) => {
    const files = item.runner.files.map(String);
    const escaped = files.filter((file) => { const full = resolve(ctx.pkgDir, file); return !full.startsWith(resolve(ctx.pkgDir) + sep) || !existsSync(full) || !statSync(full).isFile(); });
    if (escaped.length) return check(`case:${item.id}`, [`case files are missing or escape the package: ${escaped.join(', ')}`], { files });
    return nodeTestCheck(ctx, `case:${item.id}`, files, Math.min(Number(item.limits?.timeoutMs) || 120_000, 600_000));
  }).concat(check('offline-cases', [], { notRun }));
}

/** The controls in evidence order; goldenPath's result also gates the authz control. */
export const PACKAGE_AUDIT_CONTROL_RUNNERS = Object.freeze({
  manifest: manifestControl,
  authz: authzControl,
  rls: rlsControl,
  dependencies: dependenciesControl,
  installLifecycle: installLifecycleControl,
  surface: surfaceControl,
  goldenPath: goldenPathControl,
});

/** @description Remove a run directory created by the runner (never follows links out of it). */
export function removeRunDirectory(directory) {
  if (directory && existsSync(directory)) rmSync(directory, { recursive: true, force: true });
}
