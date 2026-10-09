/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | 0.2.0: the package-tool conversion across the REAL core boundary. The framework's own manifest reader, package-tool contract and catalog loader accept the package, and the kernel's resolveOperationPermissions agrees with the bare binding mirror (catalog.fixture.cjs) for every mounted route, tool and the director. Activation through ApplicationAuthorizationRuntime, PackageToolRegistry and ManifestRouteMounterImpl (in-memory policy store, the fake engine bridge answering with this package's real engine build hash, the in-memory pool) publishes the 22 handlers and the `scene` resource adapter, and exactly the 8 read tools are auto-proposable. A creator granted through the real preview and apply runs all 22 through ToolExecutorService; no role, a permit without scene.edit, an explicit deny and another owner are refused; the HTTP guard admits the creator and refuses the rest and any unbound path; an unmounted tool is unavailable with no fallback. In isolation, adopting the catalog over an @app-admin grant is refused as a breaking migration until an administrator approves the review without an approval reference, and the next start removes @app-admin so the former admin needs the creator role.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | 0.2.1: the director declares no container or port (core's shared concierge node serves it for CLI-brain callers), so the bot row is [id, undefined, undefined, undefined]; the version pin follows.
 *
 * FRAMEWORK-COUPLED: needs a core checkout (its node_modules, and src/ through the core's tsx hook
 * or a built dist/). Not part of the store-CI wildcard (no hyphen in the name); run:
 * OSHAL_CORE_DIR=<oshal checkout> node --test tests/tools.core.test.js
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
const APP = 'scene-studio';
const ISSUER = 'https://identity.example.test';
const ACTORS = Object.freeze({
  admin: { sub: 'swarm-admin', issuer: ISSUER, isActive: true, isSwarmAdmin: true },
  alice: { sub: 'alice-creator', issuer: ISSUER, isActive: true, isSwarmAdmin: false },
  bob: { sub: 'bob-other', issuer: ISSUER, isActive: true, isSwarmAdmin: false },
  carol: { sub: 'carol-no-role', issuer: ISSUER, isActive: true, isSwarmAdmin: false },
  dana: { sub: 'dana-former-admin', issuer: ISSUER, isActive: true, isSwarmAdmin: false },
});
const READ_ONLY_TOOLS = ['blender-docs', 'blender-file-summary', 'godot-get-uid', 'godot-project-info', 'scene-capabilities', 'scene-get-project', 'scene-list-projects', 'scene-read-file'];
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scene-tools-core-'));
Object.assign(process.env, { APP_PACKAGE_DYNAMIC_ROUTES: 'true', OSHAL_APPLICATION_AUTHORIZATION_MODE: 'enforce', SCENE_STUDIO_DATA_DIR: dataRoot });

const { fakePool, fakeEngine } = require('./scene.fixture.cjs');
const { readCatalog, mountedRoutes, relativeToMount, matchBindings } = require('./catalog.fixture.cjs');
const { engineBuildHash } = require(path.join(PKG, 'routes', 'engine-build-hash.js'));
const onMcp = { fn: () => ({ text: 'ok', isError: false, changed: false, delta: { added: [], modified: [], deleted: [] } }) };
let core, seam, pool, bridge, manifest, server, base, gameId;

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
    reason: 'Scene Studio package-tool proof', expectedRevision: (await s.store.read()).revision, ...input });
  return s.policy.applyChange(ACTORS.admin, { previewId: preview.previewId, idempotencyKey: randomUUID() });
}

const run = (actor, name, input) => core.context.runWithApplicationAuthorizationActor(actor,
  async () => JSON.parse(await seam.executor.executeTool('scene-tools-core', name, input, undefined, actor.sub)));
async function refused(promise) {
  try { await promise; } catch (error) { return error; }
  return assert.fail('the call was not refused');
}

test.before(async () => {
  core = loadCore();
  pool = fakePool();
  bridge = await fakeEngine(onMcp, engineBuildHash(path.join(PKG, 'engine')));
  process.env.SCENE_STUDIO_ENGINE_ADDR = `127.0.0.1:${bridge.port}`;
  seam = composeSeam({ pool });
  manifest = await mountPackage(seam);
  server = await new Promise((resolve) => { const listening = seam.app.listen(0, '127.0.0.1', () => resolve(listening)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  seam.mounter.unmount(APP); seam.runtime.unregister(APP);
  core.packageTools.configurePackageToolRegistry(undefined); core.executionPolicy.configureApplicationExecutionPolicy(undefined);
  server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
  bridge.close();
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

test('the framework accepts 0.2.1, and the bare binding mirror agrees with the kernel matcher everywhere', () => {
  assert.equal(manifest.version, '0.2.1');
  const declarations = core.packageTools.validatePackageTools(manifest);
  assert.deepEqual([declarations.length, declarations.every((d) => d.enabled && d.authMode === 'auto')], [22, true]);
  const catalog = core.shared.loadApplicationAuthorization(PKG, manifest);
  const registration = { catalog, mountPaths: manifest.routes.map((route) => route.mountPath) };
  const mirror = readCatalog();
  const routes = mountedRoutes();
  assert.equal(routes.length, 24);
  for (const row of routes) {
    const relative = relativeToMount(row.request, registration.mountPaths);
    const bare = matchBindings(mirror.http, row.method, relative);
    assert.equal(bare.length, 1, `${row.method} ${row.request}`);
    assert.deepEqual(core.shared.resolveOperationPermissions(registration, { app: APP, kind: 'http', method: row.method, path: relative }), bare[0].allOf, `${row.method} ${row.request}`);
  }
  for (const [kind, rows] of [['tools', mirror.tools], ['bots', mirror.bots]]) {
    for (const binding of rows) assert.deepEqual(core.shared.resolveOperationPermissions(registration, { app: APP, kind, operation: binding.id }), binding.allOf);
  }
  assert.equal(core.shared.resolveOperationPermissions(registration, { app: APP, kind: 'http', method: 'GET', path: '/unbound' }), null);
  assert.deepEqual(manifest.bots.map((bot) => [bot.agentId, bot.container, bot.port, bot.harnessType]), [[mirror.bots[0].id, undefined, undefined, undefined]]);
});

test('activation publishes the 22 handlers and the scene adapter; only the 8 read tools are auto-proposable', async () => {
  const names = manifest.tools.map((tool) => tool.name);
  assert.deepEqual(names.filter((name) => seam.registry.requires(name) && seam.registry.inspect(name)), names);
  assert.deepEqual(names.filter((name) => seam.registry.inspect(name).mode === 'auto').sort(), READ_ONLY_TOOLS);
  const unassigned = await seam.runtime.authorize(ACTORS.alice, { app: APP, kind: 'tools', operation: 'scene-list-projects' });
  assert.equal(unassigned.allowed, false);
  await change(seam, ACTORS.alice, { action: 'grant', role: 'creator' });
  const granted = await seam.runtime.authorize(ACTORS.alice, { app: APP, kind: 'tools', operation: 'scene-list-projects' });
  assert.equal(granted.allowed, true, 'only a registered `scene` adapter can admit a bound operation');
  assert.deepEqual(granted.grants.map((grant) => [grant.permission, grant.scope]), [['scene.read', 'own']]);
});

test('a creator runs all 22 tools through the server executor, as the owner of everything they touch', async () => {
  const ran = new Set();
  const exec = async (name, input) => { const value = await run(ACTORS.alice, name, input); ran.add(name); return value; };
  await exec('scene-capabilities', {});
  gameId = (await exec('scene-create-project', { title: 'Core game', kind: 'godot' })).project.projectId;
  const model = (await exec('scene-create-project', { title: 'Core boat', kind: 'blender' })).project.projectId;
  assert.deepEqual((await exec('scene-list-projects', {})).projects.map((p) => p.title).sort(), ['Core boat', 'Core game']);
  assert.equal((await exec('scene-get-project', { projectId: gameId })).project.revision, 1);
  assert.match((await exec('scene-read-file', { projectId: gameId, path: 'main.tscn' })).text, /gd_scene/);
  assert.equal((await exec('scene-write-file', { projectId: gameId, path: 'scripts/a.gd', text: 'extends Node\n' })).project.revision, 2);
  assert.equal((await exec('scene-delete-file', { projectId: gameId, path: 'scripts/a.gd' })).project.revision, 3);
  for (const [name, input] of [['godot-create-scene', { scenePath: 'levels/one.tscn' }], ['godot-add-node', { scenePath: 'main.tscn', nodeType: 'Node3D', nodeName: 'Pivot' }],
    ['godot-save-scene', { scenePath: 'main.tscn' }], ['godot-load-sprite', { scenePath: 'main.tscn', nodePath: 'root/S', texturePath: 'a.png' }],
    ['godot-export-mesh-library', { scenePath: 'main.tscn', outputPath: 'lib.res' }], ['godot-get-uid', { filePath: 'main.tscn' }], ['godot-project-info', {}],
    ['godot-run-project', { seconds: 1 }], ['scene-render-preview', {}], ['scene-export', {}]]) await exec(name, { projectId: gameId, ...input });
  await exec('blender-run-python', { projectId: model, code: 'result = {}', save: false });
  await exec('blender-file-summary', { projectId: model });
  await exec('blender-docs', { tool: 'search_api_docs', query: 'cube' });
  assert.equal((await exec('scene-import-model', { projectId: gameId, fromProjectId: model, name: 'boat' })).resPath, 'res://models/boat.glb');
  assert.equal((await exec('scene-restore-revision', { projectId: gameId, revision: 1 })).project.revision, 5);
  assert.deepEqual([...ran].sort(), manifest.tools.map((tool) => tool.name).sort());
  assert.deepEqual([...new Set(pool.tables.scene_project.map((row) => row.owner_sub))], [ACTORS.alice.sub]);
});

test('no role, a permit without scene.edit, an explicit deny and another creator are each refused', async () => {
  const unassigned = await refused(run(ACTORS.carol, 'scene-list-projects', {}));
  assert.deepEqual([unassigned.status, unassigned.message], [403, 'authorization_tier_denied']);
  const direct = await refused(core.context.runWithApplicationAuthorizationActor(ACTORS.carol, () => seam.registry.execute('scene-list-projects', {}, ACTORS.carol.sub)));
  assert.equal(direct.message, 'package_tool_permission_denied');
  const permit = { ...ACTORS.alice, allowedPermissions: ['scene-studio:app.open', 'scene-studio:scene.read'] };
  assert.equal((await run(permit, 'scene-list-projects', {})).projects.length, 2, 'reads stay inside the permit');
  const write = { projectId: gameId, path: 'scripts/b.gd', text: 'extends Node\n' };
  assert.equal((await refused(run(permit, 'scene-write-file', write))).message, 'authorization_executor_scope_denied');
  await change(seam, ACTORS.alice, { action: 'deny', permission: 'scene.edit' });
  assert.equal((await refused(run(ACTORS.alice, 'scene-write-file', write))).message, 'authorization_explicit_deny');
  assert.equal((await run(ACTORS.alice, 'scene-get-project', { projectId: gameId })).project.revision, 5, 'reads survive the deny');
  await change(seam, ACTORS.alice, { action: 'clear-deny', permission: 'scene.edit' });
  assert.equal((await run(ACTORS.alice, 'scene-write-file', write)).changed, true);
  await change(seam, ACTORS.bob, { action: 'grant', role: 'creator' });
  assert.deepEqual((await run(ACTORS.bob, 'scene-list-projects', {})).projects, []);
  assert.match((await refused(run(ACTORS.bob, 'scene-get-project', { projectId: gameId }))).message, /^project_not_found/);
});

test('the HTTP guard admits a creator to the studio and its routes, and refuses no role and unbound paths', async () => {
  const call = (route, { user = 'alice', method = 'GET', body } = {}) => fetch(base + route, { method,
    headers: { 'x-fixture-user': user, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const page = await call('/api/scene-studio/app');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<title>Scene Studio<\/title>/);
  const made = await call('/api/scene-studio/projects', { method: 'POST', body: { kind: 'godot', title: 'Over HTTP' } });
  assert.equal(made.status, 201);
  const projectId = (await made.json()).project.projectId;
  assert.equal((await run(ACTORS.alice, 'scene-get-project', { projectId })).project.title, 'Over HTTP', 'the studio and the tools share one owner key');
  assert.equal((await call('/api/scene-studio/home-summary')).status, 200);
  assert.equal((await call('/api/scene-studio/capabilities')).status, 200);
  for (const [route, method] of [['/api/scene-studio/app', 'GET'], ['/api/scene-studio/projects', 'POST']]) {
    assert.equal((await call(route, { user: 'carol', method, body: method === 'POST' ? { kind: 'godot', title: 'x' } : undefined })).status, 403, route);
  }
  const unbound = await call('/api/scene-studio/unbound-path');
  assert.deepEqual([unbound.status, (await unbound.json()).error], [403, 'authorization_operation_unbound']);
});

test('after unmount a tool is unavailable and never falls back to a replacement transport', async () => {
  seam.mounter.unmount(APP);
  seam.descriptors.register({ toolName: 'scene-list-projects', executorType: 'api', apiEndpoint: 'http://127.0.0.1:1/forbidden', runtimeRegistered: true, registeredAt: '' });
  for (const name of ['scene-list-projects', 'scene-write-file']) {
    assert.equal((await refused(run(ACTORS.alice, name, {}))).message, 'package_tool_unavailable', name);
  }
  assert.ok(seam.registry.requires('scene-list-projects'), 'a retired name keeps refusing generic execution');
});

test('adopting the catalog over an @app-admin grant is a reviewed breaking migration that removes @app-admin', async () => {
  const { registerSceneStudioAuthorization } = require(path.join(PKG, 'routes', 'scene-authorization.js'));
  const s = { store: new core.authorization.MemoryAuthorizationStore() };
  s.policy = new core.authorization.ApplicationAuthorizationService(s.store, { refreshActor: async (actor) => actor });
  const runtime = new core.runtime.ApplicationAuthorizationRuntime(s.policy, resolveActor);
  const manifestPath = path.join(PKG, 'oshal-app.yaml');
  const legacy = { ...manifest, version: '0.1.1', uses: ['test-catalog', 'app-dependencies'], authorization: undefined, tools: [] };
  await runtime.prepare(legacy, manifestPath);
  await runtime.start({ name: APP, manifest: legacy, manifestPath }); runtime.complete({ name: APP, manifest: legacy, manifestPath });
  await change(s, ACTORS.dana, { action: 'grant', role: '@app-admin' });
  const read = { app: APP, kind: 'http', method: 'GET', path: '/projects' };
  assert.equal((await runtime.authorize(ACTORS.dana, read)).allowed, true, '0.1.1 admits its @app-admin');
  const refusal = await refused(runtime.prepare(manifest, manifestPath));
  const [pending] = (await s.policy.catalogMigrations(ACTORS.admin, { app: APP })).migrations;
  assert.match(refusal.message, /^authorization_catalog_migration_required: breaking catalog change for scene-studio awaits review /);
  assert.ok(refusal.message.includes(pending.previewId));
  assert.deepEqual([pending.status, pending.classification, pending.affectedAssignments], ['pending', 'breaking', 1]);
  await s.policy.applyCatalogMigration(ACTORS.admin, { previewId: pending.previewId, idempotencyKey: randomUUID() });
  await runtime.prepare(manifest, manifestPath);
  const record = { name: APP, manifest, manifestPath };
  await runtime.start(record);
  registerSceneStudioAuthorization({ authorization: runtime.forPackage(APP) });
  runtime.complete(record);
  assert.deepEqual((await s.store.read()).assignments.filter((row) => row.app === APP && row.role === '@app-admin'), []);
  assert.equal((await s.policy.catalogMigrations(ACTORS.admin, { app: APP })).migrations[0].status, 'applied');
  assert.equal((await runtime.authorize(ACTORS.dana, read)).allowed, false, 'the former admin holds nothing under the catalog');
  await change(s, ACTORS.dana, { action: 'grant', role: 'creator' });
  assert.equal((await runtime.authorize(ACTORS.dana, read)).allowed, true);
  runtime.unregister(APP);
});
