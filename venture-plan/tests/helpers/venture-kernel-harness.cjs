/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Activate Venture Plan through the kernel's REAL manifest reader, ADR-149 application-authorization service and runtime (enforce, the box default), manifest route mounter, ADR-157 scheduled-service activation service and its HTTP routes, the protected-execution policy and the manifest service-route schedule registry, all loaded from a framework checkout through the core's own tsx hook. Seams, named: request identity is the x-fixture-user header (the kernel's resolver refuses a request without one, as the real one does without a session); the principal directory is an in-memory map; policy and activations live in the kernel's own in-memory stores, written only through its preview/apply and activate/deactivate paths; the database is a recording pool that answers every statement with no rows; the BotNodeClient is inert and executeBotOrInline is a recorder that crosses the kernel's protected bot gate (runWithApplicationExecution, kind bots, the call both real bot rails open with) before it answers; the declared-services port reproduces the wiring's mapping of manifest schedules. Everything else - the catalog, the loader, the guard, the activation admission, the grants, the evaluator, the tick runner and the package's compiled routes, handler and bot module - is real.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The recording pool lends a recording client (same no-rows answers, a no-op release). From 1.5.1 the package's schema bootstrap takes one client for its advisory-locked transaction; a pool that lends none failed that bootstrap at mount, and the tick router, which awaits it, then failed every tick.
 */

'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..', '..');
const CORE = path.resolve(process.env.OSHAL_CORE_ROOT || process.env.OSHAL_CORE_DIR || process.env.OSHAL_FRAMEWORK_ROOT
  || path.join(PKG, '..', '..', 'oshal'));
const ISSUER = 'https://issuer.oshal.example.com';
const APP = 'venture-plan';
const SCHEDULE_LOCAL_ID = 'rebaseline-policy-tick';
const SCHEDULE_ID = `${APP}-${SCHEDULE_LOCAL_ID}`;
const SERVICE_SECRET = 'venture-kernel-fixture-service-secret';

/** @description Environment the kernel and the package read at construction or module load. @returns {Record<string,string>} */
function harnessEnv() {
  return { APP_PACKAGE_DYNAMIC_ROUTES: 'true', OSHAL_APPLICATION_AUTHORIZATION_MODE: 'enforce', LOG_LEVEL: 'silent',
    OSHAL_NO_AI: 'false', SWARM_SERVICE_SECRET: SERVICE_SECRET, OSHAL_SCHEMA_BOOTSTRAP: '' };
}

/** @description Set environment values and return their restorer. @param {Record<string,string>} values @returns {() => void} */
function applyEnv(values) {
  const previous = {};
  for (const [key, value] of Object.entries(values)) { previous[key] = process.env[key]; process.env[key] = value; }
  return () => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } };
}

/** @description A bare require from a package file (express) resolves from the framework, as /app/node_modules serves it. */
function redirectPackageRequires(coreRequire) {
  if (Module._load.ventureKernelPatched) return;
  const original = Module._load;
  const patched = function patched(request, parent, isMain) {
    const fromPackage = String(parent?.filename || '').startsWith(PKG + path.sep);
    const bare = !request.startsWith('.') && !request.startsWith('@/') && !path.isAbsolute(request)
      && !request.startsWith('node:') && !Module.builtinModules.includes(request);
    return original.call(this, fromPackage && bare ? coreRequire.resolve(request) : request, parent, isMain);
  };
  patched.ventureKernelPatched = true;
  Module._load = patched;
}

/** @description Load the kernel seam from the framework checkout's sources through its own tsx CommonJS hook. */
function loadCore() {
  if (!fs.existsSync(path.join(CORE, 'src', 'app', 'manifest-service-route-activation.ts'))) {
    throw new Error(`OSHAL_CORE_ROOT (or OSHAL_CORE_DIR / OSHAL_FRAMEWORK_ROOT) must name a framework checkout with src/ and node_modules (got ${CORE})`);
  }
  const coreRequire = Module.createRequire(path.join(CORE, 'package.json'));
  process.env.TSX_TSCONFIG_PATH = path.join(CORE, 'tsconfig.json');
  coreRequire('tsx/cjs');
  redirectPackageRequires(coreRequire);
  const load = (relative) => coreRequire(path.join(CORE, 'src', `${relative}.ts`));
  return { coreRequire, express: coreRequire('express'),
    authorization: load('features/application-authorization/index'),
    runtime: load('app/composition/application-authorization-runtime'),
    mounter: load('app/composition/manifest-route-mounter'),
    loader: load('features/swarm-apps/services/swarm-app-loader'),
    execution: load('shared/application-authorization-execution/index'),
    actors: load('shared/application-authorization-context/index'),
    activationRoutes: load('app/routes/application-service-activation-routes'),
    activationWiring: load('app/application-service-activation-wiring'),
    serviceTick: load('app/manifest-service-route-activation'),
    schedules: load('app/manifest-service-route-schedule') };
}

/** @description Replace one module in the require cache before the package loads it. */
function stubModule(file, exportsValue) {
  const module = new Module(file);
  module.filename = file; module.loaded = true; module.exports = exportsValue;
  require.cache[file] = module;
}

/**
 * @description The package's two bot seams: the node client is inert, and executeBotOrInline records
 * each call and crosses the kernel's protected bot gate exactly as both real rails open
 * (TaskOrchestrator.processMessage and BotNodeClient.execute: kind bots, the agent, the call's userSub).
 */
function stubBotRail(core, recorded) {
  stubModule(core.coreRequire.resolve(path.join(CORE, 'src', 'app', 'routes', 'inline-bot-execution')), {
    executeBotOrInline: async (_ctx, _client, agentId, request) => {
      const call = { agentId, userSub: request.userSub, admitted: false };
      recorded.botCalls.push(call);
      return core.execution.runWithApplicationExecution({ kind: 'bots', operation: agentId, userSub: request.userSub }, async () => {
        call.admitted = true;
        return { success: true, response: '{}', cost: 0.0025, model: 'fixture-model' };
      });
    },
  });
  stubModule(core.coreRequire.resolve(path.join(CORE, 'src', 'features', 'agent-management')), {
    BotNodeClient: class { hasEndpoint() { return false; } },
    createRegistryEndpointResolver: () => () => null,
  });
}

/** @description Principals the kernel may refresh; the header decides who is signed in. */
function createDirectory(core) {
  const people = { admin: { sub: 'vk_admin', issuer: ISSUER, isActive: true, isSwarmAdmin: true },
    member: { sub: 'vk_member', issuer: ISSUER, isActive: true, isSwarmAdmin: false },
    outsider: { sub: 'vk_outsider', issuer: ISSUER, isActive: true, isSwarmAdmin: false } };
  const find = async (sub, issuer) => {
    const person = Object.values(people).find((row) => row.sub === sub && row.issuer === issuer);
    return person ? structuredClone(person) : null;
  };
  const resolveRequest = async (req) => {
    const person = people[req.get('x-fixture-user') || ''];
    if (!person) throw Object.assign(new Error('A verified user identity is required'), { status: 401 });
    return structuredClone(person);
  };
  // Production refreshes a service principal to itself (application-authorization-wiring.ts) and a
  // person from their current account; this directory is that account store.
  const refresh = async (actor) => (actor.issuer === core.authorization.APPLICATION_SERVICE_PRINCIPAL_ISSUER
    ? { ...actor, isSwarmAdmin: false, managementScopes: [] } : find(actor.sub, actor.issuer));
  return { people, find, resolveRequest, refresh };
}

/** @description The fixture authentication in front of oidc routes: the header decides who is signed in. */
function fixtureRequiresAuth(directory) {
  return (req, res, next) => {
    const person = directory.people[req.get('x-fixture-user') || ''];
    if (!person) { res.status(401).json({ error: 'fixture_auth_required' }); return; }
    Object.assign(req, { oidc: { isAuthenticated: () => true, user: { sub: person.sub } } });
    next();
  };
}

/**
 * @description A database that records every statement and answers with no rows. It lends a client with the
 *   same behaviour because the schema bootstrap (1.5.1) runs on one checked-out client behind an advisory lock.
 */
function recordingPool(recorded) {
  const query = async (text) => {
    recorded.queries.push(String(typeof text === 'string' ? text : text?.text).replace(/\s+/g, ' ').trim());
    return { rows: [], rowCount: 0 };
  };
  return { query, connect: async () => ({ query, release: () => {} }) };
}

/** @description The manifest's service-route schedules exactly as application-service-activation-wiring.ts maps them. */
function declaredServices(manifest, app) {
  return (manifest.schedules ?? []).filter((schedule) => schedule.target === 'service-route' && schedule.enabled !== false)
    .map((schedule) => ({ app, id: schedule.id, scheduleId: `${app}-${schedule.id}`, cron: schedule.cron,
      ...(schedule.description ? { description: schedule.description } : {}),
      ...(schedule.runsAs ? { runsAs: schedule.runsAs } : {}), requires: [...(schedule.requires ?? [])], queue: app }));
}

/**
 * @description The ADR-157 activation authority over the kernel's own stores, published where the
 * kernel's routes and tick runner read it, plus the protected-execution policy the runner consults.
 */
function composeActivation(core, parts) {
  const { policy, store, runtime, manifest, directory } = parts;
  const activations = new core.authorization.MemoryApplicationServiceActivationStore();
  const service = new core.authorization.ApplicationServiceActivationService({
    activations, policy: store,
    describeApp: (app) => {
      const summary = policy.getApp(app);
      return summary ? { source: summary.source, catalogRevision: summary.catalogRevision, catalog: summary.catalog, mode: summary.mode } : null;
    },
    declaredServices: async (app) => (app === manifest.name ? declaredServices(manifest, app) : []),
    authorize: (actor, operation) => runtime.authorize(actor, operation),
    registerUserInstance: async () => { throw new Error('venture-plan declares no user service'); },
    removeUserInstance: async () => undefined,
  });
  core.activationWiring.setApplicationServiceActivations({ service, resolveActor: directory.resolveRequest });
  core.serviceTick.setManifestServiceActivationRuntime({
    resolveDispatch: (input) => service.resolveDispatch(input), suspend: (activation, reason) => service.suspend(activation, reason) });
  core.execution.configureApplicationExecutionPolicy({ owner: (kind, id) => runtime.owner(kind, id),
    protectedApp: (app) => runtime.protectedApp(app), authorize: (actor, operation) => runtime.authorize(actor, operation) });
  return { activations, service };
}

/** @description Activate the package exactly as the kernel does: read and validate, prepare, start, mount, complete. */
async function activate(core, runtime, mounter) {
  const manifestPath = path.join(PKG, 'oshal-app.yaml');
  const manifest = core.loader.readManifest(manifestPath);
  const record = { name: manifest.name, displayName: manifest.displayName, manifest, manifestPath };
  await runtime.prepare(manifest, manifestPath);
  await runtime.start(record);
  try { await mounter.mount(manifest.name, PKG, manifest.routes ?? [], manifest.access); runtime.complete(record); }
  catch (error) { runtime.unregister(manifest.name); mounter.unmount(manifest.name); throw error; }
  return manifest;
}

/** @description Register the tick's compiled handler the way swarm-app-schedule-wiring.ts does for this manifest. */
function registerTick(core, ctx, manifest) {
  const declared = manifest.schedules.find((schedule) => schedule.id === SCHEDULE_LOCAL_ID);
  const owner = manifest.routes.find((route) => declared.route === route.mountPath || declared.route.startsWith(`${route.mountPath}/`));
  const registry = new core.schedules.ManifestServiceRouteScheduleRegistry(ctx);
  registry.register({ appName: manifest.name, scheduleId: SCHEDULE_ID, packageDir: PKG, module: owner.module,
    handler: declared.handler, route: declared.route, body: declared.body });
  const record = { id: `fixture-${SCHEDULE_ID}`, taskType: core.schedules.manifestServiceRouteTaskType(SCHEDULE_ID),
    taskData: { kind: 'manifest-service-route', scheduleKey: SCHEDULE_ID }, ownerSub: null };
  return { registry, dispatch: () => registry.dispatch(record) };
}

/** @description Grant or revoke a catalog role through the kernel's own preview/apply as the swarm admin. */
function roleChanger(policy, store, directory) {
  return async (who, action = 'grant', role = 'member') => {
    const person = directory.people[who];
    const preview = await policy.previewChange(directory.people.admin, { action, app: APP, targetSub: person.sub,
      targetIssuer: person.issuer, role, reason: 'Isolated Venture Plan kernel catalog proof', expectedRevision: (await store.read()).revision });
    return policy.applyChange(directory.people.admin, { previewId: preview.previewId, idempotencyKey: crypto.randomUUID() });
  };
}

/** @description The kernel's HTTP surface: the activation routes behind fixture auth, then the package dispatcher. */
function buildHttp(core, directory, ctx, runtime) {
  const app = core.express();
  app.use(core.express.json());
  const swarmApps = core.express.Router();
  swarmApps.use(fixtureRequiresAuth(directory));
  core.activationRoutes.registerApplicationServiceActivationRoutes(swarmApps);
  app.use('/api/swarm/apps', swarmApps);
  const mounter = new core.mounter.ManifestRouteMounterImpl(app, fixtureRequiresAuth(directory), ctx, undefined, runtime);
  return { app, mounter };
}

/**
 * @description Start the whole seam: kernel policy, runtime and activation authority in enforce mode,
 * the package activated from its real manifest and catalog with every route mounted, the tick's
 * handler registered, and a loopback server.
 * @returns {Promise<object>} base URL, directory, recorders, stores, role changer, tick dispatch, loaded core and stop().
 */
async function startKernelHarness() {
  const restoreEnv = applyEnv(harnessEnv()); // before any kernel module reads it at load
  const core = loadCore();
  const recorded = { queries: [], botCalls: [] };
  stubBotRail(core, recorded);
  const directory = createDirectory(core);
  const store = new core.authorization.MemoryAuthorizationStore();
  const policy = new core.authorization.ApplicationAuthorizationService(store, { resolveActor: directory.find, refreshActor: directory.refresh });
  const runtime = new core.runtime.ApplicationAuthorizationRuntime(policy, directory.resolveRequest,
    { OSHAL_APPLICATION_AUTHORIZATION_MODE: 'enforce' }, async () => null, directory.find);
  const ctx = { pool: recordingPool(recorded) };
  const { app, mounter } = buildHttp(core, directory, ctx, runtime);
  app.use((_req, res) => res.status(404).json({ error: 'fixture_not_found' }));
  const manifest = await activate(core, runtime, mounter);
  const { activations, service } = composeActivation(core, { policy, store, runtime, manifest, directory });
  const tick = registerTick(core, { ...ctx, appPackageDir: PKG }, manifest);
  const server = await new Promise((resolve) => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const stop = async () => {
    tick.registry.unregister(manifest.name, [SCHEDULE_LOCAL_ID]); mounter.unmount(manifest.name); runtime.unregister(manifest.name);
    core.activationWiring.setApplicationServiceActivations(undefined); core.serviceTick.setManifestServiceActivationRuntime(undefined);
    core.execution.configureApplicationExecutionPolicy(undefined);
    server.closeAllConnections(); await new Promise((resolve) => server.close(() => resolve()));
    restoreEnv();
  };
  return { base, core, ctx, directory, manifest, policy, recorded, runtime, store, activations, service, dispatchTick: tick.dispatch,
    changeRole: roleChanger(policy, store, directory), stop };
}

/**
 * @description One HTTP call against the harness as a fixture person (or nobody), JSON in and out.
 * @param {string} base - The loopback base URL. @param {string} method - HTTP method. @param {string} route - Path.
 * @param {{user?: string, body?: unknown, serviceSecret?: boolean}} [options] - Who is signed in, the body, the service secret.
 * @returns {Promise<{status: number, body: any}>} The answer.
 */
async function call(base, method, route, options = {}) {
  const headers = { accept: 'application/json', ...(options.user ? { 'x-fixture-user': options.user } : {}),
    ...(options.serviceSecret ? { 'x-service-secret': SERVICE_SECRET } : {}),
    ...(options.body === undefined ? {} : { 'content-type': 'application/json' }) };
  const response = await fetch(`${base}${route}`, { method, headers, redirect: 'manual',
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) });
  const text = await response.text();
  let body = text;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: response.status, body };
}

/**
 * @description The catalog-less control: the same manifest with its catalog import removed, registered
 * in a separate kernel authority exactly as an installed 1.4.x is, with its own activation service.
 * @param {object} core - The loaded core. @param {object} manifest - The real manifest. @param {object} directory - People.
 * @returns {Promise<{service: object, policy: object}>} The control's activation service and policy.
 */
async function catalogLessControl(core, manifest, directory) {
  const store = new core.authorization.MemoryAuthorizationStore();
  const policy = new core.authorization.ApplicationAuthorizationService(store, { resolveActor: directory.find, refreshActor: directory.refresh });
  const runtime = new core.runtime.ApplicationAuthorizationRuntime(policy, directory.resolveRequest,
    { OSHAL_APPLICATION_AUTHORIZATION_MODE: 'enforce' }, async () => null, directory.find);
  const legacy = { ...manifest, uses: manifest.uses.filter((use) => use !== 'application-authorization'),
    schedules: manifest.schedules.map(({ requires, ...schedule }) => schedule) };
  delete legacy.authorization;
  const record = { name: legacy.name, displayName: legacy.displayName, manifest: legacy, manifestPath: path.join(PKG, 'oshal-app.yaml') };
  await runtime.start(record);
  runtime.complete(record);
  const service = new core.authorization.ApplicationServiceActivationService({
    activations: new core.authorization.MemoryApplicationServiceActivationStore(), policy: store,
    describeApp: (app) => {
      const summary = policy.getApp(app);
      return summary ? { source: summary.source, catalogRevision: summary.catalogRevision, catalog: summary.catalog, mode: summary.mode } : null;
    },
    declaredServices: async (app) => declaredServices(legacy, app),
    authorize: (actor, operation) => runtime.authorize(actor, operation),
    registerUserInstance: async () => undefined, removeUserInstance: async () => undefined,
  });
  return { service, policy, store };
}

module.exports = { APP, ISSUER, PKG, SCHEDULE_ID, SCHEDULE_LOCAL_ID, call, catalogLessControl, startKernelHarness };
