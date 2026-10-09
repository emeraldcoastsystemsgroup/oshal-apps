/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | 0.7.0 (the scene-studio 0.2.0 harness, adapted): the package-tool conversion across the REAL core boundary. The framework's own manifest reader, package-tool contract and catalog loader accept the package, and the kernel's resolveOperationPermissions agrees with the bare binding mirror (catalog.fixture.cjs) for every mounted route, tool, the operator bot and the photo intake. Activation through ApplicationAuthorizationRuntime, PackageToolRegistry and ManifestRouteMounterImpl (in-memory policy store, the shared fixture's SQL-dispatching pool) publishes the five handlers and the `scan` resource adapter, and exactly the four read tools are auto-proposable. A maker granted through the real preview and apply runs the tools through ToolExecutorService as the owner of what they touch; no role, a permit without print.send, an explicit deny and another maker are refused; the HTTP guard admits the maker to the app, its routes and the print service and refuses the rest and any unbound path; an unmounted tool is unavailable with no fallback. In isolation, adopting the catalog over an @app-admin grant is refused as a breaking migration until an administrator approves the review, and the next start removes @app-admin so the former admin needs the maker role.
 *
 * FRAMEWORK-COUPLED: needs a core checkout (its node_modules, and src/ through the core's tsx hook
 * or a built dist/). Not part of the store-CI wildcard (no hyphen in the name); run:
 * OSHAL_CORE_DIR=<oshal checkout> node --test tests/kernel.core.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { randomUUID } = require('node:crypto');

const CORE = process.env.OSHAL_CORE_ROOT || process.env.OSHAL_CORE_DIR;
if (!CORE) throw new Error('Set OSHAL_CORE_ROOT (the Test Lab sets /app) or OSHAL_CORE_DIR to a framework checkout');
assert.ok(fs.existsSync(path.join(CORE, 'node_modules', 'express')), `OSHAL_CORE_ROOT (or OSHAL_CORE_DIR) must point at a framework checkout with node_modules (got ${CORE})`);
const PKG = path.resolve(__dirname, '..');
const APP = 'scan-to-print';
const ISSUER = 'https://identity.example.test';
const ACTORS = Object.freeze({
  admin: { sub: 'swarm-admin', issuer: ISSUER, isActive: true, isSwarmAdmin: true },
  alice: { sub: 'alice-maker', issuer: ISSUER, isActive: true, isSwarmAdmin: false },
  bob: { sub: 'bob-other', issuer: ISSUER, isActive: true, isSwarmAdmin: false },
  carol: { sub: 'carol-no-role', issuer: ISSUER, isActive: true, isSwarmAdmin: false },
  dana: { sub: 'dana-former-admin', issuer: ISSUER, isActive: true, isSwarmAdmin: false },
});
const READ_ONLY_TOOLS = ['print-service-jobs', 'print-service-printer-status', 'print-service-printers', 'scan-to-print-capabilities'];
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-kernel-core-'));
Object.assign(process.env, { APP_PACKAGE_DYNAMIC_ROUTES: 'true', OSHAL_APPLICATION_AUTHORIZATION_MODE: 'enforce', SCAN_TO_PRINT_DATA_DIR: dataRoot, SCAN_TO_PRINT_SLICER_CMD: '' });

const { fakePool } = require('./routes-core.fixture.js');
const { readCatalog, mountedRoutes, relativeToMount, matchBindings } = require('./catalog.fixture.cjs');
let core, seam, pool, manifest, server, base;

/** @description Resolve a bare require made from a package file from the framework checkout, as /app/node_modules serves the installed package. */
function redirectPackageRequires(coreRequire) {
  const originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    const fromPackage = String(parent?.filename || '').startsWith(PKG + path.sep);
    const bare = !request.startsWith('.') && !request.startsWith('@/') && !path.isAbsolute(request) && !request.startsWith('node:') && !Module.builtinModules.includes(request);
    return originalLoad.call(this, fromPackage && bare ? coreRequire.resolve(request) : request, parent, isMain);
  };
}

/** @description The core seam modules, from dist/ when the checkout is built, otherwise src/ through the core's tsx hook. */
function loadCore() {
  const coreRequire = Module.createRequire(path.join(CORE, 'package.json'));
  redirectPackageRequires(coreRequire);
  const compiled = fs.existsSync(path.join(CORE, 'dist', 'app', 'composition', 'manifest-route-mounter.js'));
  if (!compiled) { process.env.TSX_TSCONFIG_PATH = path.join(CORE, 'tsconfig.json'); coreRequire('tsx/cjs'); }
  const load = (relative) => coreRequire(path.join(CORE, compiled ? 'dist' : 'src', `${relative}.${compiled ? 'js' : 'ts'}`));
  return {
    express: coreRequire('express'),
    authorization: load('features/application-authorization/index'),
    shared: load('shared/application-authorization/index'),
    context: load('shared/application-authorization-context/index'),
    runtime: load('app/composition/application-authorization-runtime'),
    mounter: load('app/composition/manifest-route-mounter'),
    loader: load('features/swarm-apps/services/swarm-app-loader'),
    toolRegistry: load('features/tool-registry/index'),
    executor: load('features/chat-orchestration/services/tool-executor-service'),
    packageTools: load('shared/package-tools/index'),
    executionPolicy: load('shared/application-authorization-execution/index'),
  };
}

async function resolveActor(req) {
  const actor = ACTORS[req.get('x-fixture-user') || ''];
  if (!actor) throw Object.assign(new Error('fixture_identity_required'), { status: 401 });
  return structuredClone(actor);
}

/** @description The oidc posture's requiresAuth: the fixture identity becomes the session the package's routes read. */
function requiresAuth(req, res, next) {
  const actor = ACTORS[req.get('x-fixture-user') || ''];
  if (!actor) { res.status(401).json({ error: 'fixture_identity_required' }); return; }
  req.oidc = { user: { sub: actor.sub }, isAuthenticated: () => true };
  next();
}

/** @description Compose the real policy, runtime, registry, executor and mounter as the framework does. */
function composeSeam(ctx) {
  const store = new core.authorization.MemoryAuthorizationStore();
  const policy = new core.authorization.ApplicationAuthorizationService(store, { refreshActor: async (actor) => actor });
  const runtime = new core.runtime.ApplicationAuthorizationRuntime(policy, resolveActor);
  const registry = new core.packageTools.PackageToolRegistry(runtime, { reservedNames: [] });
  const descriptors = new core.toolRegistry.DynamicToolExecutorRegistry();
  const executor = new core.executor.ToolExecutorService({ streamManager: { broadcastToolExecution() {} }, dynamicToolExecutorRegistry: descriptors });
  const app = core.express();
  app.use(core.express.json({ limit: '100kb' }));
  const mounter = new core.mounter.ManifestRouteMounterImpl(app, requiresAuth, ctx, undefined, runtime, undefined, registry);
  core.packageTools.configurePackageToolRegistry(registry);
  core.executionPolicy.configureApplicationExecutionPolicy(runtime);
  return { store, policy, runtime, registry, descriptors, executor, app, mounter };
}

/** @description Activate the package from its own manifest through the framework reader, runtime and mounter. */
async function mountPackage(s) {
  const manifestPath = path.join(PKG, 'oshal-app.yaml');
  const loaded = core.loader.readManifest(manifestPath);
  const record = { name: loaded.name, displayName: loaded.displayName, manifest: loaded, manifestPath };
  await s.runtime.prepare(loaded, manifestPath);
  await s.runtime.start(record);
  try { await s.mounter.mount(loaded.name, PKG, loaded.routes ?? []); s.runtime.complete(record); }
  catch (error) { s.runtime.unregister(loaded.name); s.mounter.unmount(loaded.name); throw error; }
  for (const tool of loaded.tools ?? []) s.descriptors.register({ toolName: tool.name, executorType: 'builtin', builtinKey: 'package', runtimeRegistered: true, registeredAt: new Date().toISOString() });
  return loaded;
}

/** @description One audited change through the real preview and apply, by the swarm administrator. */
async function change(s, target, input) {
  const preview = await s.policy.previewChange(ACTORS.admin, { app: APP, targetSub: target.sub, targetIssuer: target.issuer,
    reason: 'Scan to Print package-tool proof', expectedRevision: (await s.store.read()).revision, ...input });
  return s.policy.applyChange(ACTORS.admin, { previewId: preview.previewId, idempotencyKey: randomUUID() });
}

const run = (actor, name, input) => core.context.runWithApplicationAuthorizationActor(actor,
  async () => JSON.parse(await seam.executor.executeTool('scan-kernel-core', name, input, undefined, actor.sub)));
async function refused(promise) {
  try { await promise; } catch (error) { return error; }
  return assert.fail('the call was not refused');
}
const call = (route, { user = 'alice', method = 'GET', body } = {}) => fetch(base + route, { method,
  headers: { 'x-fixture-user': user, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });

test.before(async () => {
  core = loadCore();
  pool = fakePool({});
  seam = composeSeam({ pool });
  manifest = await mountPackage(seam);
  server = await new Promise((resolve) => { const listening = seam.app.listen(0, '127.0.0.1', () => resolve(listening)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  seam.mounter.unmount(APP); seam.runtime.unregister(APP);
  core.packageTools.configurePackageToolRegistry(undefined); core.executionPolicy.configureApplicationExecutionPolicy(undefined);
  server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

test('the framework accepts 0.7.0, and the bare binding mirror agrees with the kernel matcher everywhere', () => {
  assert.equal(manifest.version, '0.7.0');
  const declarations = core.packageTools.validatePackageTools(manifest);
  assert.deepEqual(declarations.map((d) => [d.name, d.enabled, d.authMode]), [
    ['scan-to-print-capabilities', true, 'auto'], ['print-service-jobs', true, 'auto'], ['print-service-printers', true, 'auto'],
    ['print-service-printer-status', true, 'auto'], ['print-to-3d-printer', true, 'ask']]);
  const catalog = core.shared.loadApplicationAuthorization(PKG, manifest);
  const registration = { catalog, mountPaths: manifest.routes.map((route) => route.mountPath) };
  const mirror = readCatalog();
  const routes = mountedRoutes();
  assert.equal(routes.length, 36);
  for (const row of routes) {
    const relative = relativeToMount(row.request, registration.mountPaths);
    const bare = matchBindings(mirror.http, row.method, relative);
    assert.equal(bare.length, 1, `${row.method} ${row.request}`);
    assert.deepEqual(core.shared.resolveOperationPermissions(registration, { app: APP, kind: 'http', method: row.method, path: relative }), bare[0].allOf, `${row.method} ${row.request}`);
  }
  for (const [kind, rows] of [['tools', mirror.tools], ['bots', mirror.bots], ['artifactActions', mirror.artifactActions]]) {
    for (const binding of rows) assert.deepEqual(core.shared.resolveOperationPermissions(registration, { app: APP, kind, operation: binding.id }), binding.allOf, `${kind} ${binding.id}`);
  }
  assert.equal(core.shared.resolveOperationPermissions(registration, { app: APP, kind: 'http', method: 'GET', path: '/unbound' }), null);
});

test('activation publishes the five handlers and the scan adapter; only the four read tools are auto-proposable', async () => {
  const names = manifest.tools.map((tool) => tool.name);
  assert.deepEqual(names.filter((name) => seam.registry.requires(name) && seam.registry.inspect(name)), names);
  assert.deepEqual(names.filter((name) => seam.registry.inspect(name).mode === 'auto').sort(), READ_ONLY_TOOLS);
  assert.equal(seam.registry.inspect('print-to-3d-printer').mode, 'ask');
  const unassigned = await seam.runtime.authorize(ACTORS.alice, { app: APP, kind: 'tools', operation: 'print-service-jobs' });
  assert.equal(unassigned.allowed, false);
  await change(seam, ACTORS.alice, { action: 'grant', role: 'maker' });
  const granted = await seam.runtime.authorize(ACTORS.alice, { app: APP, kind: 'tools', operation: 'print-service-jobs' });
  assert.equal(granted.allowed, true, 'only a registered `scan` adapter can admit a bound operation');
  assert.deepEqual(granted.grants.map((grant) => [grant.permission, grant.scope]), [['scan.read', 'own']]);
});

test('a maker runs the tools through the server executor, as the owner of what they touch', async () => {
  const made = await call('/api/scan-to-print/jobs', { method: 'POST', body: { title: 'Kernel bracket' } });
  assert.equal(made.status, 201);
  const jobId = (await made.json()).job.job_id;
  const caps = await run(ACTORS.alice, 'scan-to-print-capabilities', {});
  assert.equal(caps.app, 'scan-to-print');
  assert.deepEqual((await run(ACTORS.alice, 'print-service-jobs', {})).jobs.map((j) => [j.jobId, j.title, j.printable]), [[jobId, 'Kernel bracket', false]],
    'the app and the tools share one owner key');
  assert.deepEqual((await run(ACTORS.alice, 'print-service-printers', {})).printers, []);
  assert.match((await refused(run(ACTORS.alice, 'print-service-printer-status', { printerId: randomUUID() }))).message, /printer_not_found/);
  const stale = await run(ACTORS.alice, 'print-to-3d-printer', { jobId });
  assert.deepEqual([stale.ok, stale.status, stale.error], [false, 409, 'output_stale'], 'an unbuilt model is refused before any printer is chosen');
  assert.deepEqual([...new Set(pool.tables.scan_print_job.map((row) => row.owner_sub))], [ACTORS.alice.sub]);
});

test('no role, a permit without print.send, an explicit deny and another maker are each refused', async () => {
  const unassigned = await refused(run(ACTORS.carol, 'print-service-jobs', {}));
  assert.deepEqual([unassigned.status, unassigned.message], [403, 'authorization_tier_denied']);
  const direct = await refused(core.context.runWithApplicationAuthorizationActor(ACTORS.carol, () => seam.registry.execute('print-service-jobs', {}, ACTORS.carol.sub)));
  assert.equal(direct.message, 'package_tool_permission_denied');
  const permit = { ...ACTORS.alice, allowedPermissions: ['scan-to-print:app.open', 'scan-to-print:scan.read'] };
  assert.equal((await run(permit, 'print-service-jobs', {})).jobs.length, 1, 'reads stay inside the permit');
  const jobId = (await run(permit, 'print-service-jobs', {})).jobs[0].jobId;
  assert.equal((await refused(run(permit, 'print-to-3d-printer', { jobId }))).message, 'authorization_executor_scope_denied');
  await change(seam, ACTORS.alice, { action: 'deny', permission: 'print.send' });
  assert.equal((await refused(run(ACTORS.alice, 'print-to-3d-printer', { jobId }))).message, 'authorization_explicit_deny');
  assert.equal((await run(ACTORS.alice, 'print-service-jobs', {})).jobs.length, 1, 'reads survive the deny');
  await change(seam, ACTORS.alice, { action: 'clear-deny', permission: 'print.send' });
  assert.equal((await run(ACTORS.alice, 'print-to-3d-printer', { jobId })).error, 'output_stale', 'the print is admitted again');
  await change(seam, ACTORS.bob, { action: 'grant', role: 'maker' });
  assert.deepEqual((await run(ACTORS.bob, 'print-service-jobs', {})).jobs, []);
  assert.deepEqual((await run(ACTORS.bob, 'print-to-3d-printer', { jobId })).error, 'job_not_found', 'another maker cannot print this owner\'s job');
});

test('the HTTP guard admits a maker to the app, its routes and the print service, and refuses no role and unbound paths', async () => {
  const page = await call('/api/scan-to-print/app');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<title>Scan to Print<\/title>/);
  assert.equal((await call('/api/scan-to-print/assets/scan-to-print.js')).status, 200);
  assert.equal((await call('/api/scan-to-print/capabilities')).status, 200);
  assert.equal((await call('/api/scan-to-print/home-summary')).status, 200);
  assert.equal((await call('/api/scan-to-print/printers')).status, 200);
  assert.equal((await call('/api/scan-to-print/service/printers')).status, 200, 'a signed-in maker reaches the print service with their session');
  for (const [route, method] of [['/api/scan-to-print/app', 'GET'], ['/api/scan-to-print/jobs', 'POST'], ['/api/scan-to-print/service/jobs', 'GET']]) {
    assert.equal((await call(route, { user: 'carol', method, body: method === 'POST' ? { title: 'x' } : undefined })).status, 403, route);
  }
  const unbound = await call('/api/scan-to-print/unbound-path');
  assert.deepEqual([unbound.status, (await unbound.json()).error], [403, 'authorization_operation_unbound']);
});

test('after unmount a tool is unavailable and never falls back to a replacement transport', async () => {
  seam.mounter.unmount(APP);
  seam.descriptors.register({ toolName: 'print-service-jobs', executorType: 'api', apiEndpoint: 'http://127.0.0.1:1/forbidden', runtimeRegistered: true, registeredAt: '' });
  for (const name of ['print-service-jobs', 'print-to-3d-printer']) {
    assert.equal((await refused(run(ACTORS.alice, name, {}))).message, 'package_tool_unavailable', name);
  }
  assert.ok(seam.registry.requires('print-service-jobs'), 'a retired name keeps refusing generic execution');
});

test('adopting the catalog over an @app-admin grant is a reviewed breaking migration that removes @app-admin', async () => {
  const { registerScanToPrintAuthorization } = require(path.join(PKG, 'routes', 'scan-authorization.js'));
  const s = { store: new core.authorization.MemoryAuthorizationStore() };
  s.policy = new core.authorization.ApplicationAuthorizationService(s.store, { refreshActor: async (actor) => actor });
  const runtime = new core.runtime.ApplicationAuthorizationRuntime(s.policy, resolveActor);
  const manifestPath = path.join(PKG, 'oshal-app.yaml');
  const legacy = { ...manifest, version: '0.6.1', uses: ['memory', 'test-catalog', 'app-dependencies'], authorization: undefined, tools: [] };
  await runtime.prepare(legacy, manifestPath);
  await runtime.start({ name: APP, manifest: legacy, manifestPath }); runtime.complete({ name: APP, manifest: legacy, manifestPath });
  await change(s, ACTORS.dana, { action: 'grant', role: '@app-admin' });
  const read = { app: APP, kind: 'http', method: 'GET', path: '/jobs' };
  assert.equal((await runtime.authorize(ACTORS.dana, read)).allowed, true, '0.6.1 admits its @app-admin');
  const refusal = await refused(runtime.prepare(manifest, manifestPath));
  const [pending] = (await s.policy.catalogMigrations(ACTORS.admin, { app: APP })).migrations;
  assert.match(refusal.message, /^authorization_catalog_migration_required: breaking catalog change for scan-to-print awaits review /);
  assert.ok(refusal.message.includes(pending.previewId));
  assert.deepEqual([pending.status, pending.classification, pending.affectedAssignments], ['pending', 'breaking', 1]);
  await s.policy.applyCatalogMigration(ACTORS.admin, { previewId: pending.previewId, idempotencyKey: randomUUID() });
  await runtime.prepare(manifest, manifestPath);
  const record = { name: APP, manifest, manifestPath };
  await runtime.start(record);
  registerScanToPrintAuthorization({ authorization: runtime.forPackage(APP) });
  runtime.complete(record);
  assert.deepEqual((await s.store.read()).assignments.filter((row) => row.app === APP && row.role === '@app-admin'), []);
  assert.equal((await s.policy.catalogMigrations(ACTORS.admin, { app: APP })).migrations[0].status, 'applied');
  assert.equal((await runtime.authorize(ACTORS.dana, read)).allowed, false, 'the former admin holds nothing under the catalog');
  await change(s, ACTORS.dana, { action: 'grant', role: 'maker' });
  assert.equal((await runtime.authorize(ACTORS.dana, read)).allowed, true);
  runtime.unregister(APP);
});
