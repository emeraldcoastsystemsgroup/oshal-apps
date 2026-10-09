/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Mount this package through the kernel's REAL manifest reader, ADR-149 application-authorization runtime (enforce) and manifest route mounter, loaded from a framework checkout through the core's own tsx hook, over forced-RLS disposable PostgreSQL with non-bypass owner roles. The live defect this guards (worker callbacks refused authorization_identity_required) lived exactly at that boundary, which the earlier package specs never crossed because they mounted the routers directly. Seams: request identity is the x-fixture-user header (the kernel's resolver refuses a request without one, as the real one does), the principal directory is an in-memory map, ticket creation and GPU enqueue are recorders, and policy lives in the kernel's in-memory store written through its own preview/apply. Also exports the case vocabulary the two suites share (characters, a real studio dispatch, a staged import, child processes).
 */

'use strict';

const { spawn, spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..', '..');
const CORE = path.resolve(process.env.OSHAL_CORE_ROOT || process.env.OSHAL_CORE_DIR || process.env.OSHAL_FRAMEWORK_ROOT
  || path.join(PKG, '..', '..', 'oshal'));
const ISSUER = 'https://issuer.oshal.example.com';
const OWNERS = ['lcb_a', 'lcb_b'];
const MIGRATIONS = ['058-lora-studio.sql', '100-lora-owner-rls.sql', '101-lora-cell-images.sql', '102-lora-character-identity.sql',
  '103-lora-dataset-images.sql', '104-lora-dataset-staging.sql', '105-lora-callback-grants.sql', '106-lora-callback-identity.sql'];

/** Environment the kernel and the package read at construction or module load. */
function harnessEnv(boxRoot) {
  return { APP_PACKAGE_DYNAMIC_ROUTES: 'true', OSHAL_APPLICATION_AUTHORIZATION_MODE: 'enforce', LOG_LEVEL: 'silent',
    SWARM_SERVICE_SECRET: 'kernel-callback-fixture-fleet-secret', LORA_CONTROLLER_URL: 'http://127.0.0.1:9', LORA_BOX_ROOT: boxRoot };
}

function applyEnv(values) {
  const previous = {};
  for (const [key, value] of Object.entries(values)) { previous[key] = process.env[key]; process.env[key] = value; }
  return () => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } };
}

/** A bare require from a package file (express) resolves from the framework, as /app/node_modules serves it. */
function redirectPackageRequires(coreRequire) {
  if (Module._load.loraKernelPatched) return;
  const original = Module._load;
  const patched = function patched(request, parent, isMain) {
    const fromPackage = String(parent?.filename || '').startsWith(PKG + path.sep);
    const bare = !request.startsWith('.') && !request.startsWith('@/') && !path.isAbsolute(request)
      && !request.startsWith('node:') && !Module.builtinModules.includes(request);
    return original.call(this, fromPackage && bare ? coreRequire.resolve(request) : request, parent, isMain);
  };
  patched.loraKernelPatched = true;
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
    identity: load('shared/services/database/request-identity'),
    DisposablePostgres: coreRequire(path.join(CORE, 'tests', 'helpers', 'disposable-postgres.ts')).DisposablePostgres };
}

/**
 * GPU enqueue is the one seam inside the package's module graph: the kernel's remote-client routes
 * module is replaced in the require cache before the mounter loads the package, and records commands.
 */
function stubRemoteClients(coreRequire, recorded) {
  const file = coreRequire.resolve(path.join(CORE, 'src', 'app', 'routes', 'remote-client-routes'));
  const stub = new Module(file);
  stub.filename = file; stub.loaded = true;
  stub.exports = { remoteClientRegistry: {
    listClients: () => [{ clientId: 'fixture-edge', status: 'online', healthy: true, capabilities: ['shell.exec'], tailnetHostname: 'fixture-edge' }],
    enqueueTask: async (_client, envelope) => { recorded.commands.push(envelope.input.arguments.command); return { taskId: `fixture-task-${recorded.commands.length}` }; },
  } };
  require.cache[file] = stub;
}

/** Principals the kernel may refresh; a callback owner is admitted only while active here. */
function createDirectory() {
  const people = { owner_a: { sub: 'lcb_a', issuer: ISSUER, isActive: true, isSwarmAdmin: false },
    owner_b: { sub: 'lcb_b', issuer: ISSUER, isActive: true, isSwarmAdmin: false },
    admin: { sub: 'lcb_admin', issuer: ISSUER, isActive: true, isSwarmAdmin: true } };
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

/** Owner-bound pool: every query runs as the non-bypass role the current request identity names. */
function ownerPool(core, fixture) {
  const role = () => {
    const sub = core.identity.getRequestIdentity()?.sub;
    if (!OWNERS.includes(sub)) throw new Error('Unbound fixture database identity');
    return fixture.rolePool(sub);
  };
  return { query: (sql, params) => role().query(sql, params), connect: () => role().connect() };
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

function recordingTickets(recorded) {
  return { createTicket: async (ticket) => { recorded.tickets.push(ticket); return { ticketId: `fixture-ticket-${recorded.tickets.length}`, ...ticket }; },
    getTicket: async () => null, updateStatus: async () => undefined, findLatestTicketByMetadataKey: async () => null };
}

async function startDatabase(core) {
  const fixture = new core.DisposablePostgres({ purpose: 'lora-kernel-callbacks', roles: OWNERS.map((name) => (
    { name, options: `-c oshal.current_sub=${name} -c oshal.is_operator=off` })) });
  await fixture.start();
  for (let pass = 0; pass < 2; pass++) for (const name of MIGRATIONS) {
    await fixture.pool.query(fs.readFileSync(path.join(PKG, 'migrations', name), 'utf8'));
  }
  await fixture.pool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${OWNERS.join(', ')}`);
  return fixture;
}

/** Activate the package exactly as the kernel does: read and validate, prepare, start, mount, complete. */
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

/** Grant or revoke a catalog role through the kernel's own preview/apply as the swarm admin. */
function roleChanger(policy, store, directory) {
  return async (who, action = 'grant', role = 'trainer') => {
    const person = directory.people[who];
    const preview = await policy.previewChange(directory.people.admin, { action, app: 'lora', targetSub: person.sub,
      targetIssuer: person.issuer, role, reason: 'Isolated LoRA kernel callback proof', expectedRevision: (await store.read()).revision });
    return policy.applyChange(directory.people.admin, { previewId: preview.previewId, idempotencyKey: crypto.randomUUID() });
  };
}

/**
 * @description Start the whole seam: database, kernel policy and runtime in enforce mode, the mounter
 * with this package activated from its real manifest, and a loopback server.
 * @returns {Promise<object>} base URL, fixture, directory, recorders, role changer, loaded core and stop().
 */
async function startKernelHarness() {
  const boxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lora-kernel-box-'));
  const restoreEnv = applyEnv(harnessEnv(boxRoot)); // before any kernel module reads it at load
  const core = loadCore();
  const recorded = { commands: [], tickets: [] };
  stubRemoteClients(core.coreRequire, recorded);
  const fixture = await startDatabase(core);
  const directory = createDirectory();
  const store = new core.authorization.MemoryAuthorizationStore();
  const policy = new core.authorization.ApplicationAuthorizationService(store, { resolveActor: directory.find });
  const runtime = new core.runtime.ApplicationAuthorizationRuntime(policy, directory.resolveRequest,
    { OSHAL_APPLICATION_AUTHORIZATION_MODE: 'enforce' }, async () => null, directory.find);
  const app = core.express();
  app.use(core.express.json()); // the controller's global parser; signed callback bodies must pass it untouched
  const ctx = { pool: ownerPool(core, fixture), ticketService: recordingTickets(recorded) };
  const mounter = new core.mounter.ManifestRouteMounterImpl(app, fixtureRequiresAuth(directory), ctx, undefined, runtime);
  app.use((_req, res) => res.status(404).json({ error: 'fixture_not_found' }));
  const manifest = await activate(core, runtime, mounter);
  const server = await new Promise((resolve) => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const stop = async () => {
    mounter.unmount(manifest.name); runtime.unregister(manifest.name);
    server.closeAllConnections(); await new Promise((resolve) => server.close(() => resolve()));
    await fixture.stop(); fs.rmSync(boxRoot, { recursive: true, force: true }); restoreEnv();
  };
  return { base, boxRoot, core, directory, fixture, manifest, policy, recorded, runtime, store,
    changeRole: roleChanger(policy, store, directory), stop };
}

/* ── Shared case vocabulary for the suites that drive this harness ─────────────────────────── */

const A1 = 'a1a1a1a1-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const A2 = 'a2a2a2a2-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const B1 = 'b1b1b1b1-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const workerKey = (id) => `lora-${id.replace(/-/g, '')}`;
const training = (character, extra = {}) => ({ kind: 'training', character, version: 1, status: 'trained', ...extra });

/** Two characters for owner A and one same-named character for owner B, and empty recorders. */
async function seedCharacters(h) {
  await h.fixture.pool.query('TRUNCATE oshal_lora_characters CASCADE');
  await h.fixture.pool.query(`INSERT INTO oshal_lora_characters (id, subject, display_name, trigger_word, owner_sub) VALUES
    ($1, 'drummer', 'Drummer', 'drummer', 'lcb_a'), ($2, 'piper', 'Piper', 'piper', 'lcb_a'),
    ($3, 'drummer', 'Other drummer', 'drummer', 'lcb_b')`, [A1, A2, B1]);
  h.recorded.commands.length = 0; h.recorded.tickets.length = 0;
}

/**
 * @description A real studio training dispatch through the kernel as the signed-in owner.
 * @returns {Promise<{id: string, secret: string, token: string}>} The grant its worker received.
 */
async function dispatchTrain(h, user = 'owner_a', subject = 'drummer') {
  const response = await fetch(`${h.base}/api/lora/train`, { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-fixture-user': user }, body: JSON.stringify({ subject }) });
  const text = await response.text();
  if (response.status !== 200) throw new Error(`studio dispatch refused (${response.status}): ${text}`);
  return require('./lora-callback-signer.ts').grantFromCommand(h.recorded.commands.at(-1));
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

/** Stage one queued receipt for A1 and mint its import grant exactly as the import dispatch does. */
async function stagedImport(h) {
  const [receipt] = (await h.fixture.pool.query(`INSERT INTO oshal_lora_dataset_images (character_id, filename, caption, byte_size, status)
    VALUES ($1, 'portrait.png', 'drummer, portrait', $2, 'queued') RETURNING id`, [A1, PNG.length])).rows;
  await h.fixture.pool.query(`INSERT INTO oshal_lora_dataset_staging (image_id, content_type, byte_size, sha256, image, expires_at)
    VALUES ($1, 'image/png', $2, 'fixture', $3, NOW() + INTERVAL '1 hour')`, [receipt.id, PNG.length, PNG]);
  const grants = require(path.join(PKG, 'routes', 'lora-callback-grants.js'));
  const dispatch = require(path.join(PKG, 'routes', 'lora-train-dispatch.js'));
  const grant = await h.core.identity.runWithRequestIdentity({ sub: 'lcb_a', isOperator: false }, () => grants.mintCallbackGrant(
    { query: (sql, params) => h.fixture.rolePool('lcb_a').query(sql, params) },
    { characterId: A1, ownerSub: 'lcb_a', ownerIssuer: ISSUER, ticketId: 'fixture-dataset-ticket', dispatchKind: 'dataset-import' }));
  const [character] = (await h.fixture.pool.query('SELECT * FROM oshal_lora_characters WHERE id = $1', [A1])).rows;
  const command = grants.withCallbackGrant(dispatch.buildDatasetImportCommand(dispatch.characterConfigFromRow(character), receipt.id,
    'portrait.png', 'drummer, portrait', 'lcb_a'), grant).split('http://127.0.0.1:9/').join(`${h.base}/`);
  return { receipt, command };
}

module.exports = { A1, A2, B1, CORE, ISSUER, PKG, PNG, dispatchTrain, interpreter, runChild, seedCharacters, stagedImport,
  startKernelHarness, training, workerKey };
