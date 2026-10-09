/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Mount this package's engine rail through the kernel's REAL manifest reader, ADR-149 application-authorization runtime (enforce, the box default) and manifest route mounter, loaded from a framework checkout through the core's own tsx hook. The live defect this guards (core tests/unit/career-rail-enforce-posture.spec.ts: the engine child's completion refused authorization_identity_required before package code) lived exactly at that boundary, which the bare-checkout rail specs never cross because they mirror the mount. Seams, named: request identity for browser routes is the x-fixture-user header (the kernel's resolver refuses a request without one, as the real one does); the principal directory the kernel refreshes a callback owner through is an in-memory map; policy lives in the kernel's in-memory store written through its own preview/apply; the database is a tripwire that throws on any query (this rail needs none, and the case count proves it); the Career bot node and executeBotOrInline are recorders. Everything else - the catalog, the loader's callbackVerifier admission, the kernel's callback rail, the compiled verifier and handler, the run registry, the compiled dispatch and runner, the real request-identity module and the production Python signer - is real.
 */

'use strict';

const { spawn, spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');

const PKG = path.resolve(__dirname, '..', '..');
const CORE = path.resolve(process.env.OSHAL_CORE_ROOT || process.env.OSHAL_CORE_DIR || process.env.OSHAL_FRAMEWORK_ROOT
  || path.join(PKG, '..', '..', 'oshal'));
const ISSUER = 'https://issuer.oshal.example.com';
const RAIL_MOUNT = '/api/career-hunter/engine';
const CAREER_AGENT_ID = 'cb000000-0000-0000-0000-000000000001';

/** Environment the kernel and the package read at construction or module load. */
function harnessEnv(storeRoot) {
  return { APP_PACKAGE_DYNAMIC_ROUTES: 'true', OSHAL_APPLICATION_AUTHORIZATION_MODE: 'enforce', LOG_LEVEL: 'silent',
    OSHAL_NO_AI: 'false', SWARM_SERVICE_SECRET: 'kernel-rail-fixture-fleet-secret',
    JOBHUNTER_STORE_ROOT: storeRoot, JOBHUNTER_CLI: path.join(storeRoot, 'never-spawned.js') };
}

function applyEnv(values) {
  const previous = {};
  for (const [key, value] of Object.entries(values)) { previous[key] = process.env[key]; process.env[key] = value; }
  return () => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } };
}

/** A bare require from a package file (express, better-sqlite3) resolves from the framework, as /app/node_modules serves it. */
function redirectPackageRequires(coreRequire) {
  if (Module._load.careerKernelPatched) return;
  const original = Module._load;
  const patched = function patched(request, parent, isMain) {
    const fromPackage = String(parent?.filename || '').startsWith(PKG + path.sep);
    const bare = !request.startsWith('.') && !request.startsWith('@/') && !path.isAbsolute(request)
      && !request.startsWith('node:') && !Module.builtinModules.includes(request);
    return original.call(this, fromPackage && bare ? coreRequire.resolve(request) : request, parent, isMain);
  };
  patched.careerKernelPatched = true;
  Module._load = patched;
}

/** Load the kernel seam from the framework checkout's sources through its own tsx CommonJS hook. */
function loadCore() {
  if (!fs.existsSync(path.join(CORE, 'src', 'app', 'composition', 'manifest-route-mounter.ts'))) {
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
    identity: load('shared/services/database/request-identity') };
}

/**
 * The two seams inside the package's module graph: the kernel's accounted bot rail and the Career
 * node client are replaced in the require cache before the mounter loads the package, and record
 * every completion the handler dispatches.
 */
function stubBotRail(coreRequire, recorded) {
  const stub = (file, exportsValue) => {
    const module = new Module(file);
    module.filename = file; module.loaded = true; module.exports = exportsValue;
    require.cache[file] = module;
  };
  stub(coreRequire.resolve(path.join(CORE, 'src', 'app', 'routes', 'inline-bot-execution')), {
    executeBotOrInline: async (_ctx, _client, agentId, request) => {
      recorded.calls.push({ agentId, request });
      return recorded.behavior(request);
    },
  });
  stub(coreRequire.resolve(path.join(CORE, 'src', 'features', 'agent-management')), {
    BotNodeClient: class { constructor(_resolver, timeoutMs) { this.timeoutMs = timeoutMs; } hasEndpoint() { return true; } },
    createRegistryEndpointResolver: () => () => null,
  });
}

/** Principals the kernel may refresh; a callback owner is admitted only while active here. */
function createDirectory() {
  const people = { owner_a: { sub: 'crk_a', issuer: ISSUER, isActive: true, isSwarmAdmin: false },
    owner_b: { sub: 'crk_b', issuer: ISSUER, isActive: true, isSwarmAdmin: false },
    admin: { sub: 'crk_admin', issuer: ISSUER, isActive: true, isSwarmAdmin: true } };
  const find = async (sub, issuer) => {
    const person = Object.values(people).find((row) => row.sub === sub && row.issuer === issuer);
    return person ? structuredClone(person) : null;
  };
  const resolveRequest = async (req) => {
    const person = people[req.get('x-fixture-user') || ''];
    if (!person) throw Object.assign(new Error('A verified user identity is required'), { status: 401 });
    return structuredClone(person);
  };
  return { people, find, resolveRequest };
}

/** The fixture authentication in front of oidc routes: the header decides who is signed in. */
function fixtureRequiresAuth(directory) {
  return (req, res, next) => {
    const person = directory.people[req.get('x-fixture-user') || ''];
    if (!person) { res.status(401).json({ error: 'fixture_auth_required' }); return; }
    Object.assign(req, { oidc: { isAuthenticated: () => true, user: { sub: person.sub } } });
    next();
  };
}

/** Activate the package exactly as the kernel does: read and validate, prepare, start, mount the rail, complete. */
async function activate(core, runtime, mounter) {
  const manifestPath = path.join(PKG, 'oshal-app.yaml');
  const manifest = core.loader.readManifest(manifestPath);
  const record = { name: manifest.name, displayName: manifest.displayName, manifest, manifestPath };
  await runtime.prepare(manifest, manifestPath);
  await runtime.start(record);
  const rail = (manifest.routes ?? []).filter((route) => route.mountPath === RAIL_MOUNT);
  try { await mounter.mount(manifest.name, PKG, rail, manifest.access); runtime.complete(record); }
  catch (error) { runtime.unregister(manifest.name); mounter.unmount(manifest.name); throw error; }
  return manifest;
}

/** Grant or revoke a catalog role through the kernel's own preview/apply as the swarm admin. */
function roleChanger(policy, store, directory) {
  return async (who, action = 'grant', role = 'member') => {
    const person = directory.people[who];
    const preview = await policy.previewChange(directory.people.admin, { action, app: 'career-hunter', targetSub: person.sub,
      targetIssuer: person.issuer, role, reason: 'Isolated Career kernel rail proof', expectedRevision: (await store.read()).revision });
    return policy.applyChange(directory.people.admin, { previewId: preview.previewId, idempotencyKey: crypto.randomUUID() });
  };
}

/**
 * @description Start the whole seam: kernel policy and runtime in enforce mode, the mounter with
 * this package's rail activated from its real manifest and catalog, and a loopback server.
 * @returns {Promise<object>} base URL, directory, recorders, role changer, loaded core and stop().
 */
async function startKernelHarness() {
  const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'career-kernel-rail-'));
  const restoreEnv = applyEnv(harnessEnv(storeRoot)); // before any kernel module reads it at load
  const core = loadCore();
  const recorded = { calls: [], databaseQueries: 0, openRuns: [],
    behavior: async (request) => ({ success: true, response: `scored for ${request.userSub}`, model: 'fixture-model', provider: 'fixture' }) };
  stubBotRail(core.coreRequire, recorded);
  const directory = createDirectory();
  const store = new core.authorization.MemoryAuthorizationStore();
  const policy = new core.authorization.ApplicationAuthorizationService(store, { resolveActor: directory.find });
  const runtime = new core.runtime.ApplicationAuthorizationRuntime(policy, directory.resolveRequest,
    { OSHAL_APPLICATION_AUTHORIZATION_MODE: 'enforce' }, async () => null, directory.find);
  const app = core.express();
  app.use(core.express.json()); // the controller's global parser; signed rail bodies must pass it untouched
  const pool = { query: async () => { recorded.databaseQueries += 1; throw new Error('the fixture database must not be consulted'); } };
  const ctx = { pool, swarm: { runtimeRegistryService: { getAgentRegistration: async () => ({ status: 'online', heartbeatAt: new Date().toISOString() }) } } };
  const mounter = new core.mounter.ManifestRouteMounterImpl(app, fixtureRequiresAuth(directory), ctx, undefined, runtime);
  app.use((_req, res) => res.status(404).json({ error: 'fixture_not_found' }));
  const manifest = await activate(core, runtime, mounter);
  const server = await new Promise((resolve) => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const restorePort = applyEnv({ PORT: String(server.address().port) }); // the runner derives the rail URL from it
  const stop = async () => {
    mounter.unmount(manifest.name); runtime.unregister(manifest.name);
    server.closeAllConnections(); await new Promise((resolve) => server.close(() => resolve()));
    fs.rmSync(storeRoot, { recursive: true, force: true }); restorePort(); restoreEnv();
  };
  return { base, storeRoot, core, directory, manifest, policy, recorded, runtime, store,
    changeRole: roleChanger(policy, store, directory), stop };
}

/* ── Shared case vocabulary ───────────────────────────────────────────────────────────────── */

/**
 * @description Launch one engine run through the COMPILED dispatch and runner as the given owner,
 * under the kernel's real request identity (which is where the dispatch reads the owner's
 * issuer), with the child replaced by an in-memory EventEmitter: the runner registers the run and
 * mints its grant, and the environment captured is the one it would hand to spawn.
 * @param {object} h - The started harness.
 * @param {string} who - Directory key of the owner.
 * @param {{issuer?: string|null}} [options] - Override the identity's issuer (null: no verified issuer).
 * @returns {Promise<{env: Record<string,string>, exit: (code: number) => void, runId: string}>}
 */
async function launchRun(h, who, options = {}) {
  const person = h.directory.people[who];
  const dispatch = require(path.join(PKG, 'routes', 'career-engine-dispatch.js'));
  const child = new EventEmitter();
  Object.assign(child, { stdout: new PassThrough(), stderr: new PassThrough(), pid: 41_000, exitCode: null, kill: () => true });
  let env;
  let runId;
  const issuer = options.issuer === undefined ? person.issuer : options.issuer;
  const started = await h.core.identity.runWithRequestIdentity({ sub: person.sub, principalIssuer: issuer, isOperator: false },
    () => dispatch.runCareerCliAsync({ query: async () => ({ rows: [] }) }, person.sub, ['tailor'], {}, {
      slot: 'kernel-proof', timeoutMs: 60_000, onRunStarted: (id) => { runId = id; },
      spawnProcess: (_command, _args, spawnOptions) => { env = spawnOptions.env; process.nextTick(() => child.emit('spawn')); return child; },
    }));
  if (!started.started) throw new Error(`engine run did not start: ${JSON.stringify(started)}`);
  const run = { env, runId, exit: (code) => { if (child.exitCode !== null) return; child.exitCode = code; child.emit('close', code); } };
  h.recorded.openRuns.push(run);
  return run;
}

/**
 * @description Settle every run a case left open, so the next case's launch is not refused as
 * in flight. Idempotent for runs already exited.
 * @param {object} h - The started harness.
 * @returns {void}
 */
function settleOpenRuns(h) {
  for (const run of h.recorded.openRuns.splice(0)) run.exit(137);
}

/** Run a child without blocking this process's event loop, which serves the requests it makes. */
function runChild(command, args, env) {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { env, windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.once('error', fail);
    child.once('close', (code) => done({ status: code ?? -1, stdout, stderr }));
  });
}

/** The first interpreter that answers its probe; a missing one fails the suite rather than skipping it. */
function interpreter(candidates, args, accept, what) {
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, args, { encoding: 'utf8', windowsHide: true });
    if (probe.status === 0 && accept(`${probe.stdout}${probe.stderr}`)) return candidate;
  }
  throw new Error(`${what} is required: a skipped producer is no proof`);
}

module.exports = { CAREER_AGENT_ID, CORE, ISSUER, PKG, RAIL_MOUNT, interpreter, launchRun, runChild, settleOpenRuns, startKernelHarness };
