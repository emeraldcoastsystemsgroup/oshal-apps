/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Mutation-resistant contract for SEC-06 triggers, immutable actions, blocking gates, route parsing, and CodeQL exception expiry.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Require immutable action references in every store workflow, not only the dedicated security gate.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Lock source parity to one canonical rebuild invocation and reject the former per-package compiler loop.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Add fail-closed manifest, package-test discovery, CodeQL-ledger, and example-secret mutation contracts.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Prove the live owner-RLS runner is explicit opt-in, asserts both tenants/operator, and cleans temporary objects on failure.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Require a separate migration-100-only legacy upgrade fixture with backfill, constraint, FORCE-RLS, isolation, idempotence, and cleanup coverage.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | Require the compiled Vids mobile Chromium proof and validate its fail-closed surface selection and static extraction.
 * 8 | maintainer@emeraldcoastsystemsgroup.com | Require LoRA/Vids live owner-RLS execution in the disposable PostgreSQL security job instead of leaving the proof manual-only.
 * 9 | maintainer@emeraldcoastsystemsgroup.com | Require APP-02 package-audit validation in explicit compatible rollout mode and its enforce-policy mutation family.
 * 10 | maintainer@emeraldcoastsystemsgroup.com | Keep CORE-05 requiresAi readiness routes in the fail-closed store route parser and reject non-boolean declarations.
 * 11 | maintainer@emeraldcoastsystemsgroup.com | Lock all non-Pumpkin packages to the service-only, read-only CORE-05 readiness source/compiled pair and non-placeholder response assertion.
 * 12 | maintainer@emeraldcoastsystemsgroup.com | Ledger to the real 53-package store (was 48). ADR-141 `kind: group` manifests own no routes, so they cannot mount a readiness smoke: they are excluded only after the real route parser proves they declare none and ship no smoke source/compiled pair, so the exclusion can never hide a routed package.
 * 13 | maintainer@emeraldcoastsystemsgroup.com | Ledger to the real 54-package store: the Create launcher ships the canonical service-only readiness smoke pair like every routed package.
 * 14 | maintainer@emeraldcoastsystemsgroup.com | Ledger to the real 55-package store: Scan to Print ships the canonical service-only readiness smoke pair like every routed package.
 * 15 | maintainer@emeraldcoastsystemsgroup.com | Ledger to the real 56-package store: Embodied Swarm ships the canonical service-only readiness smoke pair like every routed package.
 * 16 | maintainer@emeraldcoastsystemsgroup.com | Retain both published Embodied and CAD Studio packages in the complete 57-package readiness ledger.
 * 17 | maintainer@emeraldcoastsystemsgroup.com | Enforce the operator's manual-only workflow and Portrait's reviewed user-bound readiness with mutation guards, preserving other service-only contracts.
 * 18 | maintainer@emeraldcoastsystemsgroup.com | Classify the known completed-task writer through actual route inventory fixtures while retaining read-only routes.
 * 19 | maintainer@emeraldcoastsystemsgroup.com | Ledger to the real 60-package store: Animatronics ships the canonical service-only readiness smoke pair like every routed package; the count also takes in Circuit Lab and Drone Relay, which landed their smoke pairs without bumping it.
 * 20 | maintainer@emeraldcoastsystemsgroup.com | Ledger to 61 with the Marketing group, and pin the write-class closure rule: a route that delegates its SQL to a package sibling is machine-write, transitively, while a file outside routes//src-routes is never read. Splitting marketing-routes.ts into modules had silently downgraded /api/marketing to no-sql-write, and the same shape was already under-reporting 19 routes across 14 packages.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { evaluateFindings, findingsFromSarif } from './check-codeql-sarif.mjs';
import { parseManifestRoutes, routeInventory } from './check-store-security.mjs';
import { assertStoreCiTestInventory, discoverStoreCiTests } from './check-store-test-discovery.mjs';
import {
  legacyOwnerUpgradeProofSql,
  ownerIsolationProofSql,
  parseLiveProofOptions,
  runLiveOwnerRlsProof,
} from './run-live-owner-rls-proof.mjs';
import { extractVidsSurface, parseMobileProofOptions } from './run-vids-mobile-browser.mjs';
import { normalizeCompilerOutput } from './rebuild-store-routes.mjs';

const workflow = readFileSync('.github/workflows/security.yml', 'utf8');
const gitleaksConfig = readFileSync('.gitleaks.toml', 'utf8');
const liveProofRunner = readFileSync('scripts/security/run-live-owner-rls-proof.mjs', 'utf8');

/**
 * Collect action references across every workflow. A manual package job is still a software-supply
 * chain boundary, so mutable tags are forbidden outside the dedicated security workflow too.
 */
function allWorkflowActions() {
  return readdirSync('.github/workflows')
    .filter((file) => /\.ya?ml$/.test(file))
    .flatMap((workflowName) => {
      const source = readFileSync(join('.github/workflows', workflowName), 'utf8');
      return [...source.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)]
        .map((match) => ({ workflowName, action: match[1] }));
    });
}

/** Require the reviewed trigger block, never re-enable billed automatic jobs to satisfy an old test. */
function assertManualSecurityWorkflow(source) {
  source = source.replaceAll('\r\n', '\n');
  assert.equal([...source.matchAll(/^(?:on|["']on["']):/gm)].length, 1, 'only one unambiguous trigger mapping is allowed');
  const triggers = /^on:[ \t]*\r?\n((?:[ \t]+[^\r\n]*\r?\n|[ \t]*\r?\n)*)/m.exec(source)?.[1];
  assert.ok(triggers, 'security workflow must declare its manual trigger block');
  assert.deepEqual([...triggers.matchAll(/^ {2}([a-z_]+):/gm)].map(match => match[1]), ['workflow_dispatch']);
  assert.match(triggers, /^ {2}workflow_dispatch:[ \t]*$/m);
  assert.doesNotMatch(triggers, /^[ \t]*(?:pull_request(?:_target)?|push|schedule):/m);
}

test('security workflow runs only by deliberate manual dispatch', () => {
  assertManualSecurityWorkflow(workflow);
});

test('manual security contract refuses automatic triggers and missing dispatch', () => {
  for (const event of ['pull_request', 'pull_request_target', 'push', 'schedule', 'workflow_call']) {
    const source = workflow.replace(/^( {2}workflow_dispatch:)/m, `  ${event}:\n$1`);
    assert.throws(() => assertManualSecurityWorkflow(source), undefined, event);
  }
  assert.throws(() => assertManualSecurityWorkflow(workflow.replace(/^ {2}workflow_dispatch:.*\r?\n/m, '')));
  assert.throws(() => assertManualSecurityWorkflow(workflow.replace(/^on:\r?\n {2}workflow_dispatch:/m, 'on: [push, workflow_dispatch]')));
  assert.throws(() => assertManualSecurityWorkflow(`${workflow}\non:\n  push:\n`));
});

test('every workflow pins actions and the security gate contains no advisory bypass', () => {
  const actions = allWorkflowActions();
  assert.ok(actions.length > 20, 'expected every workflow action to use an immutable commit');
  for (const { workflowName, action } of actions) {
    assert.match(action, /^[^@]+@[0-9a-f]{40}$/, `${workflowName} uses a mutable action reference`);
  }
  assert.doesNotMatch(workflow, /\|\|\s*true|continue-on-error\s*:\s*true/i);
  for (const required of [
    'security-extended',
    'check-codeql-sarif.mjs',
    'check-store-security.mjs',
    'check-store-test-discovery.mjs',
    'run-store-security-tests.mjs',
    'validate-package-audits.mjs',
    'run-framework-coupled-tests.mjs',
    'run-vids-mobile-browser.mjs',
    'pip_audit',
    '--log-opts="--all"',
    '--no-git',
    'format: cyclonedx',
    'SEC-06 required store security gate',
  ]) assert.ok(workflow.includes(required), `missing security gate: ${required}`);
});

test('package audits are structurally blocking while enforcement remains an explicit rollout', () => {
  const step = /- name: Validate package audit records and staged catalog bindings[\s\S]+?run: node scripts\/security\/validate-package-audits\.mjs/.exec(workflow)?.[0];
  assert.ok(step, 'package audit validation step is missing');
  assert.match(step, /OSHAL_PACKAGE_AUDIT_MODE: compatible/);
  assert.doesNotMatch(step, /continue-on-error|\|\|\s*true/);
  const runner = readFileSync('scripts/security/run-store-security-tests.mjs', 'utf8');
  assert.match(runner, /package-audit\.test\.mjs/);
});

test('source parity uses one canonical compiler pass instead of a package loop', () => {
  const parityJob = /  source-compiled-parity:[\s\S]+?\n  dependency-audit:/.exec(workflow)?.[0];
  assert.ok(parityJob, 'source-compiled-parity job is missing');
  assert.equal((parityJob.match(/rebuild-store-routes\.mjs/g) ?? []).length, 1);
  assert.match(parityJob, /--store store --framework framework/);
  assert.doesNotMatch(parityJob, /oshal-app\.js\s+build|for\s+manifest|for\s+package/);
  assert.match(parityJob, /playwright install --with-deps chromium/);
  assert.match(parityJob, /run-vids-mobile-browser\.mjs[\s\S]+--surface generated/);
});

test('mobile proof selects reviewed surfaces and rejects dynamic or incomplete HTML', () => {
  assert.deepEqual(parseMobileProofOptions([
    '--store', 'store', '--framework', 'framework',
  ]), { surface: 'generated', store: 'store', framework: 'framework' });
  assert.equal(parseMobileProofOptions([
    '--store', 'store', '--framework', 'framework', '--surface', 'source',
  ]).surface, 'source');
  assert.throws(() => parseMobileProofOptions([
    '--store', 'store', '--framework', 'framework', '--surface', '../arbitrary',
  ]), /generated\|source/);
  assert.equal(extractVidsSurface('const SURFACE_HTML = `<!doctype html><html></html>`;'), '<!doctype html><html></html>');
  assert.throws(() => extractVidsSurface('const SURFACE_HTML = `<html></html>`;'), /complete HTML/);
  assert.throws(() => extractVidsSurface('const SURFACE_HTML = `<!doctype html>${unsafe}</html>`;'), /static literal/);
});

test('every package command in store-ci resolves to a non-empty test set', () => {
  const discoveries = discoverStoreCiTests(process.cwd());
  assert.ok(discoveries.length > 0);
  assert.deepEqual(discoveries.filter((entry) => entry.count === 0), []);
  assert.doesNotThrow(() => assertStoreCiTestInventory(process.cwd(), discoveries));
  assert.throws(() => assertStoreCiTestInventory(process.cwd(), discoveries.slice(1)), /stale=/);
  assert.throws(() => assertStoreCiTestInventory(process.cwd(), [
    ...discoveries,
    { packageDir: 'unexpected', command: 'npm test', count: 1 },
  ]), /added=/);
});

test('secret scanning does not exempt test or example paths', () => {
  assert.doesNotMatch(gitleaksConfig, /\(\^\|\/\)tests\?\/\.\*/);
  assert.doesNotMatch(gitleaksConfig, /\.\*\\\.test\\\.\(cjs\|mjs\|js\|ts\)/);
  assert.doesNotMatch(gitleaksConfig, /\.\*\\\.env\\\.example\$/);
  assert.doesNotMatch(gitleaksConfig, /\.\*\\\.example\$/);
  assert.match(gitleaksConfig, /Tests and example files remain scanned/);
});

test('route parser inventories block and inline auth without an empty default', () => {
  const block = parseManifestRoutes(`routes:\n  - module: routes/a.js\n    factory: createA\n    mountPath: /api/a\n    auth: service-or-oidc\n`, 'block.yaml');
  assert.deepEqual(block, [{ module: 'routes/a.js', factory: 'createA', mountPath: '/api/a', auth: 'service-or-oidc' }]);
  const inline = parseManifestRoutes('routes:\n  - { module: routes/b.js, factory: createB, mountPath: /api/b, requiresAuth: true }\n', 'inline.yaml');
  assert.equal(inline[0].auth, 'oidc');
  assert.throws(() => parseManifestRoutes('routes:\n  - module: routes/c.js\n    factory: createC\n    mountPath: /api/c\n', 'missing.yaml'), /missing auth/);
});

/** Build complete isolated manifest/source/compiled peers without importing or executing route handlers. */
function writeInventoryFixture(t, sourceBody, compiledBody = sourceBody) {
  const root = mkdtempSync(join(tmpdir(), 'oshal-route-write-'));
  t.after(() => { assert.equal(dirname(root), tmpdir()); rmSync(root, { recursive: true, force: true }); });
  const packageRoot = join(root, 'fixture-app');
  mkdirSync(join(packageRoot, 'src-routes'), { recursive: true });
  mkdirSync(join(packageRoot, 'routes'));
  writeFileSync(join(packageRoot, 'oshal-app.yaml'), 'name: fixture-app\nroutes:\n  - { module: routes/test.js, factory: createFixture, mountPath: /api/fixture, auth: service }\n');
  writeFileSync(join(packageRoot, 'src-routes/test.ts'), sourceBody);
  writeFileSync(join(packageRoot, 'routes/test.js'), compiledBody);
  return routeInventory(root);
}

test('completed-task writer calls are machine-write in source or compiled route inventory', t => {
  const reader = 'function createFixture() { return taskStore.findJarvisTaskSessionId(context, owner, id); }';
  const writer = 'async function createFixture() { return await taskStore.saveCompletedBriefing(id, owner, session, title, result); }';
  const expected = ['fixture-app|routes/test.js|createFixture|/api/fixture|service|machine-write'];
  assert.deepEqual(writeInventoryFixture(t, writer), expected);
  assert.deepEqual(writeInventoryFixture(t, writer, reader), expected);
  assert.deepEqual(writeInventoryFixture(t, reader, writer), expected);
});

test('completed-task classification retains read-only routes and existing literal SQL writers', t => {
  const reader = 'function createFixture() { const label = "saveCompletedBriefing"; return taskStore.findJarvisTaskSessionId(context, owner, label); }';
  assert.deepEqual(writeInventoryFixture(t, reader), ['fixture-app|routes/test.js|createFixture|/api/fixture|service|no-sql-write']);
  const sql = 'function createFixture() { return pool.query("INSERT INTO fixture_tasks(id) VALUES($1)", [id]); }';
  assert.deepEqual(writeInventoryFixture(t, sql), ['fixture-app|routes/test.js|createFixture|/api/fixture|service|machine-write']);
});

/** Build a route module that delegates to sibling files, so the closure rule can be exercised. */
function writeDelegatingFixture(t, files, entryBody) {
  const root = mkdtempSync(join(tmpdir(), 'oshal-route-closure-'));
  t.after(() => { assert.equal(dirname(root), tmpdir()); rmSync(root, { recursive: true, force: true }); });
  const packageRoot = join(root, 'fixture-app');
  mkdirSync(join(packageRoot, 'src-routes'), { recursive: true });
  mkdirSync(join(packageRoot, 'routes'));
  writeFileSync(join(root, 'outside.js'), 'pool.query("INSERT INTO elsewhere(id) VALUES($1)");');
  writeFileSync(join(packageRoot, 'oshal-app.yaml'), 'name: fixture-app\nroutes:\n  - { module: routes/test.js, factory: createFixture, mountPath: /api/fixture, auth: service }\n');
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(packageRoot, 'src-routes', `${name}.ts`), body);
    writeFileSync(join(packageRoot, 'routes', `${name}.js`), body);
  }
  writeFileSync(join(packageRoot, 'src-routes/test.ts'), entryBody);
  writeFileSync(join(packageRoot, 'routes/test.js'), entryBody);
  return routeInventory(root);
}

test('a route that delegates its write to a package sibling is still machine-write', t => {
  const helper = 'export function save(pool, id) { return pool.query("INSERT INTO fixture_rows(id) VALUES($1)", [id]); }';
  const entry = 'const { save } = require("./helper");\nfunction createFixture() { return save; }';
  assert.deepEqual(writeDelegatingFixture(t, { helper }, entry),
    ['fixture-app|routes/test.js|createFixture|/api/fixture|service|machine-write']);

  const deep = 'const { save } = require("./middle");\nfunction createFixture() { return save; }';
  assert.deepEqual(
    writeDelegatingFixture(t, { helper, middle: 'const { save } = require("./helper");\nexport { save };' }, deep),
    ['fixture-app|routes/test.js|createFixture|/api/fixture|service|machine-write'],
    'the closure is transitive — one more hop must not hide the write',
  );
});

test('the closure stays inside the package and does not invent writes', t => {
  const readOnlyHelper = 'export function read(pool) { return pool.query("SELECT 1"); }';
  const entry = 'const { read } = require("./helper");\nfunction createFixture() { return read; }';
  assert.deepEqual(writeDelegatingFixture(t, { helper: readOnlyHelper }, entry),
    ['fixture-app|routes/test.js|createFixture|/api/fixture|service|no-sql-write']);

  const escaping = 'const outside = require("../../outside.js");\nfunction createFixture() { return outside; }';
  assert.deepEqual(writeDelegatingFixture(t, {}, escaping),
    ['fixture-app|routes/test.js|createFixture|/api/fixture|service|no-sql-write'],
    'a file outside routes//src-routes is not a package module and is never read');
});

test('route parser accepts only boolean requiresAi declarations', () => {
  const routes = parseManifestRoutes([
    'routes:',
    '  - module: routes/package-smoke.js',
    '    factory: createPackageSmokeRoutes',
    '    mountPath: /api/sample/_smoke',
    '    auth: service',
    '    requiresAi: false',
  ].join('\n'), 'smoke.yaml');
  assert.equal(routes[0].auth, 'service');
  assert.throws(() => parseManifestRoutes([
    'routes:',
    '  - module: routes/package-smoke.js',
    '    factory: createPackageSmokeRoutes',
    '    mountPath: /api/sample/_smoke',
    '    auth: service',
    '    requiresAi: no',
  ].join('\n'), 'smoke.yaml'), /requiresAi must be true or false/);
});

/** Read a module with normalized line endings and one trailing newline. */
const normalizedModule = (file) => `${readFileSync(file, 'utf8').replaceAll('\r\n', '\n').trimEnd()}\n`;

/**
 * An ADR-141 group borrows member surfaces and owns no routes, so it cannot mount a readiness
 * smoke. Returns true only after the real route parser proves the group declares no routes and
 * ships no smoke declaration or module — the exclusion can never hide a routed package.
 */
function assertRoutelessGroup(packageDir, manifest, smokePaths) {
  if (!/^kind:\s*group\s*$/m.test(manifest)) return false;
  assert.deepEqual(parseManifestRoutes(manifest, join(packageDir, 'oshal-app.yaml')), [], `${packageDir} is a group, so it must declare no routes`);
  assert.doesNotMatch(manifest, /^smoke:/m, `${packageDir} is a group, so it cannot declare a readiness smoke`);
  assert.equal(smokePaths.some((file) => existsSync(file)), false, `${packageDir} is a group and ships no smoke module`);
  return true;
}

/** Portrait deliberately requires an authenticated user and the imported view permission, even for metadata. */
function assertPortraitReadinessPermission(manifest, catalog) {
  assert.match(manifest, /^name: portrait-studio\s*$/m);
  const uses = /^uses:\r?\n((?: {2}- [^\r\n]*\r?\n)+)/m.exec(manifest)?.[1] || '';
  assert.match(uses, /^ {2}- application-authorization\s*$/m);
  assert.match(manifest, /^authorization:\r?\n {2}version: 1\r?\n {2}catalog: authorization\.yaml\s*$/m);
  assert.match(catalog, /^version: 1\s*$/m);
  assert.match(catalog, /^ {2}portrait\.view: \{ resource: portraits, effect: read, minimumTier: viewer \}\s*$/m);
  assert.match(catalog, /^ {4}- id: package-smoke\r?\n {6}method: GET\r?\n {6}path: \/\r?\n {6}allOf: \[portrait\.view\]\s*$/m);
}

/** Compare actual module bytes strictly against the canonical compiler's package-specific output policy. */
function assertReadinessModulePair(packageDir, source, compiled, canonical) {
  assert.equal(source, canonical.source, `${packageDir} smoke source drifted`);
  const expected = normalizeCompilerOutput({ sourceRoot: join(packageDir, 'src-routes') }, Buffer.from(canonical.compiled));
  assert.equal(compiled, expected.toString('utf8'), `${packageDir} compiled smoke drifted`);
}

/** Assert the explicit reviewed auth contract and the unchanged non-AI metadata-only module pair. */
function assertReadinessSmoke(packageDir, manifest, packageName, [sourcePath, compiledPath], canonical, catalog) {
  const userBound = packageDir === 'portrait-studio';
  if (userBound) assertPortraitReadinessPermission(manifest, catalog ?? readFileSync(join(packageDir, 'authorization.yaml'), 'utf8'));
  const escapedMount = `/api/${packageName}/_smoke`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.match(manifest, new RegExp([
    '  - module: routes/package-smoke\\.js',
    '    factory: createPackageSmokeRoutes',
    `    mountPath: ${escapedMount}`,
    `    auth: ${userBound ? 'oidc' : 'service'}`,
    '    requiresContext: true',
    '    requiresAi: false',
  ].join('\\r?\\n')), `${packageDir} readiness route must retain its reviewed authentication and remain non-AI`);
  assert.match(manifest, new RegExp([
    'smoke:',
    '  - name: package-readiness',
    '    method: GET',
    `    path: ${escapedMount}`,
    `    auth: ${userBound ? 'pat' : 'service'}`,
    ...(userBound ? ['    requiresUser: true'] : []),
    '    expect:',
    '      status: 200',
    '      jsonPointer: /package',
    '      rejectValues: \\[noop, stub, empty\\]',
    '    requiresAi: false',
  ].join('\\r?\\n')), `${packageDir} readiness expectation must reject placeholder identities`);
  assertReadinessModulePair(packageDir, normalizedModule(sourcePath), normalizedModule(compiledPath), canonical);
}

/** Classify one package: 'excluded' (Pumpkin), 'group' (route-less), or 'covered' (smoke asserted). */
function classifySmokePackage(packageDir, canonical) {
  const manifest = readFileSync(join(packageDir, 'oshal-app.yaml'), 'utf8');
  const packageName = /^name:\s*([a-z0-9][a-z0-9-]{0,63})\s*$/m.exec(manifest)?.[1];
  assert.ok(packageName, `${packageDir} must declare a simple package name`);
  const smokePaths = [join(packageDir, 'src-routes', 'package-smoke.ts'), join(packageDir, 'routes', 'package-smoke.js')];
  if (packageDir === 'pumpkin') {
    assert.equal(existsSync(smokePaths[0]), false, `${packageDir} is explicitly excluded from source edits`);
    assert.equal(existsSync(smokePaths[1]), false, `${packageDir} is explicitly excluded from compiled edits`);
    return 'excluded';
  }
  if (assertRoutelessGroup(packageDir, manifest, smokePaths)) return 'group';
  assertReadinessSmoke(packageDir, manifest, packageName, smokePaths, canonical);
  return 'covered';
}

test('every non-Pumpkin routed package owns its reviewed authenticated readiness smoke', () => {
  const packageDirs = readdirSync('.', { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(entry.name, 'oshal-app.yaml')))
    .map((entry) => entry.name)
    .sort();
  assert.equal(packageDirs.length, 61, 'the smoke audit must cover the complete store manifest set');

  const canonical = {
    source: normalizedModule('brand-graphics/src-routes/package-smoke.ts'),
    compiled: normalizedModule('brand-graphics/routes/package-smoke.js'),
  };
  const kinds = packageDirs.map((packageDir) => [packageDir, classifySmokePackage(packageDir, canonical)]);
  assert.deepEqual(kinds.filter(([, kind]) => kind === 'group').map(([packageDir]) => packageDir), ['intelligent-career', 'marketing-suite'],
    'the route-less groups are the career and marketing front doors');
  assert.equal(kinds.filter(([, kind]) => kind === 'covered').length, 58,
    'only Pumpkin and the two route-less groups are outside the 61-package rollout');

  const inventory = JSON.parse(readFileSync('scripts/security/store-route-inventory.json', 'utf8')).routes;
  const smokeRoutes = inventory.filter((entry) => entry.includes('|routes/package-smoke.js|'));
  assert.equal(smokeRoutes.length, 58);
  assert.deepEqual(smokeRoutes.filter(entry => entry.startsWith('portrait-studio|')), [
    'portrait-studio|routes/package-smoke.js|createPackageSmokeRoutes|/api/portrait-studio/_smoke|oidc|no-sql-write',
  ]);
  assert.ok(smokeRoutes.filter(entry => !entry.startsWith('portrait-studio|')).every(entry => entry.endsWith('|service|no-sql-write')));
});

test('Portrait user-bound readiness rejects auth, prerequisite and permission weakening without relaxing other packages', () => {
  const manifest = readFileSync('portrait-studio/oshal-app.yaml', 'utf8');
  const catalog = readFileSync('portrait-studio/authorization.yaml', 'utf8');
  const paths = ['portrait-studio/src-routes/package-smoke.ts', 'portrait-studio/routes/package-smoke.js'];
  const canonical = { source: normalizedModule('brand-graphics/src-routes/package-smoke.ts'),
    compiled: normalizedModule('brand-graphics/routes/package-smoke.js') };
  const check = (source, permissions = catalog) => assertReadinessSmoke('portrait-studio', source, 'portrait-studio', paths, canonical, permissions);
  check(manifest);
  for (const [from, to] of [
    ['auth: oidc', 'auth: service'], ['auth: oidc', 'auth: public'], ['auth: pat', 'auth: service'],
    ['requiresUser: true', 'requiresUser: false'], ['    requiresUser: true', ''],
    ['  - application-authorization', '  - test-catalog'], ['catalog: authorization.yaml', 'catalog: elsewhere.yaml'],
    ['requiresAi: false', 'requiresAi: true'],
  ]) {
    assert.ok(manifest.includes(from), from);
    assert.throws(() => check(manifest.replaceAll(from, to)), undefined, `${from} -> ${to}`);
  }
  for (const [from, to] of [
    ['allOf: [portrait.view]', 'allOf: []'], ['allOf: [portrait.view]', 'allOf: [portrait.read]'],
    ['id: package-smoke', 'id: another-route'], ['      path: /\n', '      path: /unbound\n'],
    ['portrait.view: { resource: portraits, effect: read, minimumTier: viewer }', 'portrait.view: { resource: portraits, effect: read, minimumTier: guest }'],
  ]) {
    const source = catalog.replaceAll('\r\n', '\n'); assert.ok(source.includes(from), from);
    assert.throws(() => check(manifest, source.replaceAll(from, to)), undefined, `${from} -> ${to}`);
  }
  const other = readFileSync('brand-graphics/oshal-app.yaml', 'utf8');
  assert.throws(() => assertReadinessSmoke('brand-graphics', other.replaceAll('auth: service', 'auth: oidc'), 'brand-graphics', paths, canonical));
  const source = normalizedModule(paths[0]), compiled = normalizedModule(paths[1]);
  assert.ok(compiled.includes('res.json('));
  assert.throws(() => assertReadinessModulePair('portrait-studio', source, compiled.replace('res.json(', 'res.status(201).json('), canonical));
  assert.throws(() => assertReadinessModulePair('portrait-studio', source.replace("router.get('/'", "router.post('/'"), compiled, canonical));
});

test('readiness uses canonical source-map policy and retains strict executable-byte comparisons', () => {
  const root = mkdtempSync(join(tmpdir(), 'readiness-format-'));
  assert.equal(dirname(root), tmpdir(), 'cleanup is restricted to the new direct temporary child');
  const sourceRoot = join(root, 'src-routes'); mkdirSync(sourceRoot);
  const config = join(sourceRoot, 'tsconfig.json');
  const body = 'exports.ready = true;\n', compiled = `${body}//# sourceMappingURL=package-smoke.js.map\n`;
  const canonical = { source: 'source unchanged', compiled };
  const check = actual => assertReadinessModulePair(root, canonical.source, actual, canonical);
  try {
    check(compiled); assert.throws(() => check(body), /compiled smoke drifted/);
    for (const compilerOptions of [{ sourceMap: false }, {}]) {
      writeFileSync(config, JSON.stringify({ compilerOptions }));
      check(body); assert.throws(() => check(compiled), /compiled smoke drifted/);
      assert.throws(() => check(body.replace('true', 'false')), /compiled smoke drifted/);
    }
    writeFileSync(config, JSON.stringify({ compilerOptions: { sourceMap: true } }));
    check(compiled); assert.throws(() => check(body), /compiled smoke drifted/);
    assert.throws(() => check(compiled.replace('package-smoke.js.map', 'other.js.map')), /compiled smoke drifted/);
    writeFileSync(config, '{invalid'); assert.throws(() => check(compiled), /invalid JSON/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('route parser follows valid YAML field order, alternate indentation, and comment-separated entries', () => {
  const routes = parseManifestRoutes([
    'name: mutation-fixture',
    'routes:',
    '    - factory: createFirst',
    '      auth: operator',
    '      mountPath: /api/first',
    '      module: routes/first.js',
    '',
    '# A comment at column zero does not end the YAML sequence.',
    '    - auth: public',
    '      module: routes/second.js',
    '      factory: createSecond',
    '      mountPath: /api/second',
    'migrations: []',
    '',
  ].join('\n'), 'mutated.yaml');
  assert.deepEqual(routes, [
    { module: 'routes/first.js', factory: 'createFirst', mountPath: '/api/first', auth: 'operator' },
    { module: 'routes/second.js', factory: 'createSecond', mountPath: '/api/second', auth: 'public' },
  ]);
});

test('route parser fails closed on empty, malformed, partial, or ambiguously indented manifests', () => {
  assert.throws(() => parseManifestRoutes('', 'empty.yaml'), /manifest is empty/);
  assert.throws(() => parseManifestRoutes('# comments only\n', 'empty.yaml'), /manifest is empty/);
  assert.throws(() => parseManifestRoutes('not a mapping\n', 'broken.yaml'), /top-level mapping/);
  assert.throws(() => parseManifestRoutes('name: broken\nroutes: [unterminated\n', 'broken.yaml'), /routes must be/);
  assert.throws(() => parseManifestRoutes('name: broken\nroutes:\nnext: true\n', 'broken.yaml'), /non-empty block sequence/);
  assert.throws(() => parseManifestRoutes('name: broken\nroutes:\n  - module routes/a.js\n', 'broken.yaml'), /begin with a field mapping/);
  assert.throws(() => parseManifestRoutes('name: broken\nroutes:\n  - module: routes/a.js\n    factory: createA\n    mountPath: /api/a\n', 'broken.yaml'), /missing auth/);
  assert.throws(() => parseManifestRoutes('name: broken\nroutes:\n  - module: routes/a.js\n    factory: createA\n    auth: oidc\n', 'broken.yaml'), /missing mountPath/);
  assert.throws(() => parseManifestRoutes([
    'name: broken',
    'routes:',
    '  - module: routes/a.js',
    '    factory: createA',
    '    mountPath: /api/a',
    '    auth: oidc',
    '    - module: routes/b.js',
    '      factory: createB',
    '      mountPath: /api/b',
    '      auth: oidc',
  ].join('\n'), 'broken.yaml'), /inconsistent indentation/);
});

test('store-ci discovery reads folded commands and rejects hidden or missing package tests', () => {
  const root = mkdtempSync(join(tmpdir(), 'store-ci-discovery-'));
  const write = (path, contents) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
  };
  const workflowPath = join(root, '.github', 'workflows', 'store-ci.yml');
  try {
    write(join(root, 'sample', 'oshal-app.yaml'), 'name: sample\n');
    write(join(root, 'sample', 'tests', 'sample.test.js'), '');
    write(workflowPath, [
      'jobs:',
      '  sample:',
      '    steps:',
      '      - name: Folded test',
      '        working-directory: sample',
      '        run: >-',
      '          node --test',
      '          "tests/*.test.js"',
      '',
    ].join('\n'));
    assert.equal(discoverStoreCiTests(root)[0].count, 1);

    write(workflowPath, [
      'jobs:',
      '  sample:',
      '    steps:',
      '      - name: Missing root test',
      '        run: node --test sample/tests/missing.test.js',
      '',
    ].join('\n'));
    assert.throws(() => discoverStoreCiTests(root), /root test step Missing root test names missing file/);

    write(join(root, 'sample', 'package.json'), JSON.stringify({ scripts: { test: 'node tests/missing.test.js' } }));
    write(workflowPath, [
      'jobs:',
      '  sample:',
      '    steps:',
      '      - name: Missing npm path',
      '        working-directory: sample',
      '        run: npm test',
      '',
    ].join('\n'));
    assert.throws(() => discoverStoreCiTests(root), /npm test names missing file/);

    write(workflowPath, [
      'jobs:',
      '  sample:',
      '    steps:',
      '      - name: Hidden runner',
      '        working-directory: sample',
      '        run: node custom-test-runner.js',
      '',
    ].join('\n'));
    assert.throws(() => discoverStoreCiTests(root), /unrecognized package command/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CodeQL high severity blocks and lower severity needs an exact unexpired exception', () => {
  const sarif = { runs: [{
    tool: { driver: { rules: [{ id: 'js/high', properties: { 'security-severity': '8.0' } }] } },
    results: [{ ruleId: 'js/high', ruleIndex: 0, level: 'warning', locations: [{
      physicalLocation: { artifactLocation: { uri: 'routes/a.js' } },
    }] }],
  }] };
  const high = findingsFromSarif(sarif);
  const today = new Date('2026-08-06T12:00:00.000Z');
  assert.equal(evaluateFindings(high, { schemaVersion: 1, exceptions: [] }, today)[0].reason, 'high-or-critical');

  const low = { ruleId: 'js/low', path: 'routes/b.js', level: 'warning', securityScore: 3.5 };
  const exceptions = [{
    ruleId: 'js/low',
    path: 'routes/b.js',
    owner: 'maintainer@emeraldcoastsystemsgroup.com',
    reason: 'Reviewed compensating control',
    expires: '2026-10-01',
  }];
  const ledger = { schemaVersion: 1, exceptions };
  assert.deepEqual(evaluateFindings([low], ledger, today), []);
  assert.equal(evaluateFindings([{ ...low, path: 'routes/other.js' }], ledger, today).length, 1);
  assert.throws(() => evaluateFindings([], {
    schemaVersion: 1,
    exceptions: [{ ...exceptions[0], expires: '2026-08-05' }],
  }, today), /expired/);
  assert.throws(() => evaluateFindings([], {
    schemaVersion: 1,
    exceptions: [{ ...exceptions[0], owner: 'somebody@example.com' }],
  }, today), /owner must be maintainer@emeraldcoastsystemsgroup\.com/);
  assert.throws(() => evaluateFindings([], {
    schemaVersion: 1,
    exceptions: [{ ...exceptions[0], expires: '2027-09-01' }],
  }, today), /review horizon/);
});

test('live owner-RLS proof is opt-in, required in ephemeral CI, complete, and cleans up on failure', () => {
  assert.throws(() => parseLiveProofOptions([], {}), /--confirm-live-owner-rls-proof/);
  assert.throws(() => parseLiveProofOptions([
    '--confirm-live-owner-rls-proof', '--container', 'pg', '--database-url', 'postgres://localhost/postgres',
  ], {}), /exactly one/);
  assert.match(
    workflow,
    /run-live-owner-rls-proof\.mjs[\s\S]*?--confirm-live-owner-rls-proof[\s\S]*?--container "\$\{\{ job\.services\.dnd_postgres\.id \}\}"/,
  );
  assert.equal((liveProofRunner.match(/100-lora-owner-rls\.sql/g) ?? []).length, 4);
  assert.equal((liveProofRunner.match(/100-vids-owner-rls\.sql/g) ?? []).length, 4);
  const legacyLoader = /function legacyMigrationSql[\s\S]+?\n}/.exec(liveProofRunner)?.[0];
  assert.ok(legacyLoader, 'legacy migration loader is missing');
  assert.doesNotMatch(legacyLoader, /058-lora-studio|059-vids-platform/);
  assert.equal((legacyLoader.match(/100-lora-owner-rls\.sql/g) ?? []).length, 2);
  assert.equal((legacyLoader.match(/100-vids-owner-rls\.sql/g) ?? []).length, 2);

  const sql = ownerIsolationProofSql('sec06_test_role');
  assert.match(sql, /sec06-shared-subject/);
  assert.match(sql, /SET oshal\.current_sub = 'sec06-owner-a'/);
  assert.match(sql, /SET oshal\.current_sub = 'sec06-owner-b'/);
  assert.match(sql, /SET oshal\.is_operator = 'on'/);
  assert.match(sql, /owner A changed owner B vids job/);
  assert.match(sql, /owner B changed owner A character/);

  const legacySql = legacyOwnerUpgradeProofSql('sec06_test_role');
  assert.match(legacySql, /SET search_path = legacy, pg_catalog/);
  assert.match(legacySql, /system:legacy:lora/);
  assert.match(legacySql, /system:legacy:vids/);
  assert.match(legacySql, /attnotnull/);
  assert.match(legacySql, /oshal_lora_characters_subject_key/);
  assert.match(legacySql, /relrowsecurity AND relforcerowsecurity/);
  assert.match(legacySql, /legacy owner A changed owner B Vids job/);
  assert.match(legacySql, /legacy operator character visibility failed/);

  const labels = [];
  assert.throws(() => runLiveOwnerRlsProof({ confirmed: true, adminDatabase: 'postgres' }, {
    names: { database: 'sec06_test_database', role: 'sec06_test_role' },
    migrationSql: () => '',
    executeSql: (_database, _sql, label) => {
      labels.push(label);
      if (label === 'run owner isolation proof') throw new Error('synthetic proof failure');
    },
  }), /synthetic proof failure/);
  assert.deepEqual(labels.slice(-4), [
    'terminate temporary database sessions',
    'drop temporary database',
    'drop temporary role',
    'verify temporary object cleanup',
  ]);

  const successfulLabels = [];
  assert.doesNotThrow(() => runLiveOwnerRlsProof({ confirmed: true, adminDatabase: 'postgres' }, {
    names: { database: 'sec06_success_database', role: 'sec06_success_role' },
    migrationSql: () => '',
    legacyMigrationSql: () => '',
    executeSql: (_database, _sql, label) => successfulLabels.push(label),
  }));
  assert.deepEqual(successfulLabels.slice(2, 6), [
    'apply base and idempotent owner migrations',
    'run owner isolation proof',
    'apply legacy fixture and repeated owner upgrades',
    'run legacy owner upgrade proof',
  ]);
});
