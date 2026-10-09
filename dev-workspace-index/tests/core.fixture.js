/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The framework-coupled harness the two core suites share: the REAL core seam (application-authorization service + runtime with an in-memory store, the package-tool registry, the manifest route mounter, the tool executor and the Jarvis package-tool proposal routes) is loaded from the framework checkout named by OSHAL_CORE_ROOT (what the Test Lab sets, /app) or OSHAL_CORE_DIR - from dist/ when the checkout is built, otherwise from src/ through the core's own tsx CommonJS hook - and this package's actual manifest, catalog and route module are mounted on express over loopback. Bare requires from package files (express in package-smoke.js) resolve from the framework checkout the way /app/node_modules serves the installed package. Identity is the x-fixture-user header; no database, no docker, no provider.
 */

'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

const CORE = process.env.OSHAL_CORE_ROOT || process.env.OSHAL_CORE_DIR;
if (!CORE) throw new Error('Set OSHAL_CORE_ROOT (the Test Lab sets /app) or OSHAL_CORE_DIR to a framework checkout');
const PKG = path.resolve(__dirname, '..');
const FIXTURE_CHECKOUT = path.join(__dirname, 'fixtures', 'checkout');
const ISSUER = 'https://identity.example.test';
const ACTORS = Object.freeze({
  alice: { sub: 'alice-super', issuer: ISSUER, isActive: true, isSwarmAdmin: false },
  bob: { sub: 'bob-developer', issuer: ISSUER, isActive: true, isSwarmAdmin: false },
  admin: { sub: 'swarm-admin', issuer: ISSUER, isActive: true, isSwarmAdmin: true },
});
const HARNESS_ENV = Object.freeze({
  APP_PACKAGE_DYNAMIC_ROUTES: 'true',
  OSHAL_APPLICATION_AUTHORIZATION_MODE: 'enforce',
  OSHAL_DEV_CONSOLE_ENABLED: 'true',
  OSHAL_SUPERADMIN_SUBS: ACTORS.alice.sub,
  OSHAL_SUPERADMIN_EMAILS: '',
  OSHAL_DEV_WORKSPACE_INDEX_ENABLED: 'true',
});

/**
 * Redirect a BARE require made from a file inside this package (express in routes/package-smoke.js)
 * to the framework checkout, the way the installed package resolves it from /app/node_modules. Only
 * package files are redirected: requires from node_modules, relative paths, builtins and the `@/`
 * aliases (the mounter registers those itself) resolve as before.
 */
function redirectPackageRequires(coreRequire) {
  if (Module._load.devWorkspacePatched) return;
  const originalLoad = Module._load;
  const patched = function patched(request, parent, isMain) {
    const fromPackage = String(parent?.filename || '').startsWith(PKG + path.sep);
    const bare = !request.startsWith('.') && !request.startsWith('@/') && !path.isAbsolute(request) && !request.startsWith('node:') && !Module.builtinModules.includes(request);
    if (fromPackage && bare) return originalLoad.call(this, coreRequire.resolve(request), parent, isMain);
    return originalLoad.call(this, request, parent, isMain);
  };
  patched.devWorkspacePatched = true;
  Module._load = patched;
}

/** @description Load the core seam modules from the framework checkout. @returns {object} Loaded modules and the checkout's require. */
function loadCore() {
  if (!fs.existsSync(path.join(CORE, 'node_modules', 'express'))) throw new Error(`OSHAL_CORE_ROOT (or OSHAL_CORE_DIR) must point at a framework checkout with node_modules (got ${CORE})`);
  const coreRequire = Module.createRequire(path.join(CORE, 'package.json'));
  redirectPackageRequires(coreRequire);
  const compiled = fs.existsSync(path.join(CORE, 'dist', 'app', 'routes', 'jarvis-package-tool-routes.js'));
  if (!compiled) {
    process.env.TSX_TSCONFIG_PATH = path.join(CORE, 'tsconfig.json');
    coreRequire('tsx/cjs');
  }
  const load = (relative) => coreRequire(path.join(CORE, compiled ? 'dist' : 'src', `${relative}.${compiled ? 'js' : 'ts'}`));
  return {
    coreRequire, compiled, express: coreRequire('express'),
    authorization: load('features/application-authorization/index'),
    runtime: load('app/composition/application-authorization-runtime'),
    mounter: load('app/composition/manifest-route-mounter'),
    loader: load('features/swarm-apps/services/swarm-app-loader'),
    toolRegistry: load('features/tool-registry/index'),
    executor: load('features/chat-orchestration/services/tool-executor-service'),
    packageTools: load('shared/package-tools/index'),
    executionPolicy: load('shared/application-authorization-execution/index'),
    jarvisService: load('app/routes/jarvis-package-tool-service'),
    jarvisRoutes: load('app/routes/jarvis-package-tool-routes'),
  };
}

function applyEnv(values) {
  const previous = {};
  for (const [key, value] of Object.entries(values)) { previous[key] = process.env[key]; process.env[key] = value; }
  return () => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } };
}

function metadataFrom(manifest) {
  return async (name) => {
    const tool = (manifest.tools ?? []).find((candidate) => candidate.name === name);
    if (!tool) return null;
    return { name, enabled: tool.enabled !== false, defaultAuthMode: tool.defaultAuthMode, displayName: tool.displayName, description: tool.description,
      usageInstructions: tool.usageInstructions, inputSchema: tool.inputSchema, routingTags: tool.routingTags, requiresApproval: tool.requiresApproval };
  };
}

async function resolveActor(req) {
  const actor = ACTORS[req.get('x-fixture-user') || ''];
  if (!actor) throw Object.assign(new Error('package_tool_identity_required'), { status: 401 });
  return structuredClone(actor);
}

/** Compose the real policy, runtime, registry, executor and mounter exactly as the framework does. */
function composeSeam(core, ctx) {
  const { ApplicationAuthorizationService, MemoryAuthorizationStore } = core.authorization;
  const store = new MemoryAuthorizationStore();
  const policy = new ApplicationAuthorizationService(store, { refreshActor: async (actor) => actor });
  const runtime = new core.runtime.ApplicationAuthorizationRuntime(policy, resolveActor);
  const registry = new core.packageTools.PackageToolRegistry(runtime, { reservedNames: [] });
  const descriptors = new core.toolRegistry.DynamicToolExecutorRegistry();
  const executor = new core.executor.ToolExecutorService({ streamManager: { broadcastToolExecution() {} }, dynamicToolExecutorRegistry: descriptors });
  const app = core.express();
  const mounter = new core.mounter.ManifestRouteMounterImpl(app, (_req, _res, next) => next(), ctx, undefined, runtime, undefined, registry);
  core.packageTools.configurePackageToolRegistry(registry);
  core.executionPolicy.configureApplicationExecutionPolicy(runtime);
  return { store, policy, runtime, registry, descriptors, executor, app, mounter };
}

/** Activate this package through the framework's own manifest reader, authorization runtime and mounter. */
async function mountPackage(core, seam) {
  const manifestPath = path.join(PKG, 'oshal-app.yaml');
  const manifest = core.loader.readManifest(manifestPath);
  const record = { name: manifest.name, manifest, manifestPath };
  await seam.runtime.prepare(manifest, manifestPath);
  await seam.runtime.start(record);
  try { await seam.mounter.mount(manifest.name, PKG, manifest.routes ?? []); seam.runtime.complete(record); }
  catch (error) { seam.runtime.unregister(manifest.name); seam.mounter.unmount(manifest.name); throw error; }
  for (const tool of manifest.tools ?? []) seam.descriptors.register({ toolName: tool.name, executorType: 'builtin', builtinKey: 'package', runtimeRegistered: true, registeredAt: new Date().toISOString() });
  return manifest;
}

function jarvisService(core, seam, manifest) {
  return new core.jarvisService.JarvisPackageToolService({
    names: () => seam.registry.names(), inspect: (name) => seam.registry.inspect(name), metadata: metadataFrom(manifest),
    authorize: (actor, operation) => seam.runtime.authorize(actor, operation),
    execute: (name, input, sub, sessionId) => seam.executor.executeTool(sessionId, name, input, undefined, sub),
    canUseSession: async (actor, id) => id === `session-${actor.sub}`,
  });
}

function httpClient(base) {
  const call = async (pathname, { method, body, user = 'alice', headers = {} } = {}) => {
    const response = await fetch(base + pathname, {
      method: method || (body === undefined ? 'GET' : 'POST'),
      headers: { ...(user ? { 'x-fixture-user': user } : {}), origin: base, 'x-oshal-package-tool': '1', 'x-oshal-dev-workspace': '1', 'content-type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
    return { status: response.status, json, text };
  };
  /** Drive the real Jarvis flow: catalog -> preview -> execute. */
  const jarvis = async (user, toolName, input) => {
    const catalog = await call('/api/jarvis/package-tools/catalog', { user });
    const preview = await call('/api/jarvis/package-tools/preview', { user, body: { sessionId: `session-${ACTORS[user]?.sub}`, toolName, input } });
    const execute = preview.status === 200 ? await call('/api/jarvis/package-tools/execute', { user, body: { proposalId: preview.json.id } }) : null;
    return { catalog, preview, execute };
  };
  return { call, jarvis };
}

/**
 * @description Mount this package on the real core seam and expose loopback HTTP plus the Jarvis proposal flow.
 * @param {{indexFile: string, env?: object, devMode?: object}} options Built index path, extra env, and an optional injected DevModeRegistry.
 * @returns {Promise<object>} The harness: base url, call(), grant(), jarvis(), stop().
 */
async function startHarness({ indexFile, env = {}, devMode } = {}) {
  const core = loadCore();
  const restoreEnv = applyEnv({ ...HARNESS_ENV, OSHAL_DEV_WORKSPACE_INDEX_PATH: indexFile, ...env });
  const seam = composeSeam(core, devMode ? { devWorkspaceDevMode: devMode } : {});
  let manifest;
  try { manifest = await mountPackage(core, seam); } catch (error) { restoreEnv(); throw error; }
  const service = jarvisService(core, seam, manifest);
  seam.app.use(core.express.json({ limit: '32kb' }));
  seam.app.use('/api/jarvis/package-tools', core.jarvisRoutes.createJarvisPackageToolRoutes(service, resolveActor));
  const server = await new Promise((resolve) => { const listening = seam.app.listen(0, '127.0.0.1', () => resolve(listening)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const grant = async (actor, { role = 'developer', action = 'grant' } = {}) => {
    const preview = await seam.policy.previewChange(ACTORS.admin, { action, app: manifest.name, targetSub: actor.sub, targetIssuer: actor.issuer, role, reason: 'Developer workspace seam proof', expectedRevision: (await seam.store.read()).revision });
    await seam.policy.applyChange(ACTORS.admin, { previewId: preview.previewId, idempotencyKey: crypto.randomUUID() });
  };
  const stop = async () => {
    seam.mounter.unmount(manifest.name); seam.runtime.unregister(manifest.name);
    core.packageTools.configurePackageToolRegistry(undefined); core.executionPolicy.configureApplicationExecutionPolicy(undefined);
    await new Promise((resolve) => server.close(() => resolve()));
    restoreEnv();
  };
  return { ACTORS, base, core, grant, manifest, registry: seam.registry, service, stop, ...httpClient(base) };
}

module.exports = { ACTORS, CORE, FIXTURE_CHECKOUT, PKG, loadCore, startHarness };
