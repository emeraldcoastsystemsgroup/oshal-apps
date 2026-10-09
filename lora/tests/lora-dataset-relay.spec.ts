/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove the dataset destination through core's REAL artifact-exchange routes and authenticated relay (ApplicationAuthorizationRuntime over a protected fixture source), forced-RLS disposable PostgreSQL with non-bypass owner roles (migrations 058-104 applied twice), the real package routes built with the mounter's package context (applicationAuthorization removed), and Chromium. Session identity, ticket creation and GPU enqueue are named fixture seams; no worker, provider or deployment database is contacted.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The worker download and callbacks now use the callback grant the import dispatch handed its worker (migration 105), read from the recorded command; the fleet secret alone and another owner presenting the grant are refused, and the final callback revokes it.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Worker callbacks now pass the kernel's signed-package-callbacks verifier first: the ingest router is mounted through the lora-callback-rail double (POST only, verifier, then the router as the grant owner; the real kernel is crossed by signed-callback-boundary.core.test.js), grants carry the owner's verified issuer (migration 106) and the dataset download is an empty signed POST to /dataset-download/:id. The import dispatch takes the signed-in owner's issuer, so the grant names the exact principal the relay admitted.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Request } from 'express';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser } from 'playwright';
import { DisposablePostgres } from '@test-fixtures/disposable-postgres';
import { getRequestIdentity, runWithRequestIdentity } from '@/shared/services/database/request-identity';
import { hasValidServiceSecret, serviceSecretOr } from '@/shared/middleware/authz';
import { requireTrustedServiceUserIdentity } from '@/shared/middleware/trusted-service-user-identity';
import { ApplicationAuthorizationService, MemoryAuthorizationStore } from '@/features/application-authorization';
import { ApplicationAuthorizationRuntime } from '@/app/composition/application-authorization-runtime';
import { createArtifactExchangeRoutes } from '@/app/routes/artifact-exchange-routes';
import { mintArtifactHandle } from '@/shared/artifact-exchange';
import type { AppContext } from '@/app/composition/app-context';
import type { SwarmApplicationRecord } from '@/features/swarm-apps';
import type { AuthorizationActor, AuthorizationCatalog } from '@/shared/application-authorization';
import { grantFromCommand, send, signedCallback, signedRequest, type WorkerGrant } from './helpers/lora-callback-signer';

vi.setConfig({ testTimeout: 30000, hookTimeout: 120000 });

const recorded = vi.hoisted(() => ({ commands: [] as string[], tickets: [] as Record<string, unknown>[], online: true }));
vi.mock('@/shared/services/database', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()), runRuntimeSchemaBootstrap: vi.fn(async () => undefined),
}));
vi.mock('@/app/routes/remote-client-routes', () => ({ remoteClientRegistry: {
  listClients: () => recorded.online ? [{ clientId: 'fixture-edge', status: 'online', healthy: true, capabilities: ['shell.exec'], tailnetHostname: 'fixture-edge' }] : [],
  enqueueTask: async (_client: string, envelope: any) => {
    recorded.commands.push(envelope.input.arguments.command);
    return { taskId: `fixture-task-${recorded.commands.length}` };
  },
} }));
import { createBotLoraRoutes } from '../src-routes/bot-lora-routes';
import { fixtureAuthorization, mountLoraIngest } from './helpers/lora-callback-rail';

const ISSUER = 'https://issuer.oshal.example.com';
const SECRET = 'dataset-relay-fixture-secret';
const CHAR_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CHAR_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const actors: Record<string, AuthorizationActor> = {
  owner_a: { sub: 'dataset_a', issuer: ISSUER, isActive: true, isSwarmAdmin: false },
  owner_b: { sub: 'dataset_b', issuer: ISSUER, isActive: true, isSwarmAdmin: false },
  collision: { sub: 'dataset_a', issuer: 'https://other-issuer.oshal.example.com', isActive: true, isSwarmAdmin: false },
  admin: { sub: 'dataset_admin', issuer: ISSUER, isActive: true, isSwarmAdmin: true },
};
const SOURCES = ['image', 'notes', 'mislabelled', 'huge'];
const catalog: AuthorizationCatalog = { version: 1, resources: { files: { scopes: ['own'] } },
  permissions: { 'files.read': { resource: 'files', effect: 'read', minimumTier: 'viewer' } },
  roles: { reader: { tier: 'viewer', grants: [{ permission: 'files.read', scope: 'own' }] } },
  bindings: { http: SOURCES.map((name) => ({ id: name, method: 'GET', path: `/${name}`, allOf: ['files.read'] })) } };

const fixture = new DisposablePostgres({ purpose: 'lora-dataset-relay', roles: [
  { name: 'dataset_a', options: '-c oshal.current_sub=dataset_a -c oshal.is_operator=off' },
  { name: 'dataset_b', options: '-c oshal.current_sub=dataset_b -c oshal.is_operator=off' },
] });
const pkg = fileURLToPath(new URL('..', import.meta.url));
const framework = resolve(process.env.OSHAL_FRAMEWORK_ROOT || resolve(pkg, '../../oshal'));
let server: Server, base: string, browser: Browser, root: string, portrait: Buffer;
let policy: ApplicationAuthorizationService, store: MemoryAuthorizationStore, runtime: ApplicationAuthorizationRuntime;
const sourceHits: Request['headers'][] = [];
const workerKey = (id: string) => `lora-${id.replace(/-/g, '')}`;

function identity(req: Request): AuthorizationActor {
  const name = /(?:^|;\s*)dataset-user=([a-z_]+)/.exec(req.headers.cookie ?? '')?.[1];
  const actor = name ? actors[name] : undefined;
  if (!actor) throw Object.assign(new Error('Verified fixture cookie required'), { status: 401 });
  return actor;
}
async function grant(user: string): Promise<void> {
  const principal = actors[user];
  const preview = await policy.previewChange(actors.admin, { app: 'portrait-fixture', action: 'grant', role: 'reader',
    targetSub: principal.sub, targetIssuer: principal.issuer, reason: 'Isolated dataset relay proof', expectedRevision: (await store.read()).revision });
  await policy.applyChange(actors.admin, { previewId: preview.previewId, idempotencyKey: crypto.randomUUID() });
}
async function startRuntime(): Promise<void> {
  root = mkdtempSync(join(tmpdir(), 'lora-dataset-relay-'));
  writeFileSync(join(root, 'authorization.yaml'), JSON.stringify(catalog));
  const manifest = { name: 'portrait-fixture', version: '1.0.0', uses: ['application-authorization'],
    authorization: { version: 1 as const, catalog: 'authorization.yaml' }, routes: [{ mountPath: '/api/portrait-fixture' }] };
  const record = { name: 'portrait-fixture', manifestPath: join(root, 'oshal-app.yaml'), manifest } as SwarmApplicationRecord;
  store = new MemoryAuthorizationStore(); policy = new ApplicationAuthorizationService(store);
  runtime = new ApplicationAuthorizationRuntime(policy, async (req) => identity(req));
  await runtime.start(record);
  runtime.forPackage('portrait-fixture').registerResource('files', { authorize: async () => true });
  runtime.complete(record);
  for (const user of ['owner_a', 'owner_b', 'collision']) await grant(user);
}

/** Owner-bound pool: every query runs as the non-bypass role named by the request identity. */
function ownerPool() {
  const role = () => {
    const sub = getRequestIdentity()?.sub;
    if (sub !== 'dataset_a' && sub !== 'dataset_b') throw new Error('Unbound fixture database identity');
    return fixture.rolePool(sub);
  };
  return { query: (sql: string, params?: unknown[]) => role().query(sql, params), connect: () => role().connect() };
}

function sourceRoutes(app: express.Express): void {
  app.use('/api/portrait-fixture', (req, res, next) => { void runtime.guard('portrait-fixture', req, res, next); });
  app.get('/api/portrait-fixture/image', (req, res) => { sourceHits.push(req.headers); res.type('png').send(portrait); });
  app.get('/api/portrait-fixture/notes', (req, res) => { sourceHits.push(req.headers); res.type('text').send('plain notes'); });
  app.get('/api/portrait-fixture/mislabelled', (req, res) => { sourceHits.push(req.headers); res.type('png').send(Buffer.from('<svg/> not an image')); });
  app.get('/api/portrait-fixture/huge', (req, res) => {
    sourceHits.push(req.headers);
    res.type('png').send(Buffer.concat([portrait.subarray(0, 8), Buffer.alloc(10 * 1024 * 1024)]));
  });
}

/** The /api/lora mount: a verified cookie, or (as a permissive oidc mount might) a service-rail request. */
function loraMountAuth(req: Request, res: express.Response, next: express.NextFunction): void {
  const sub = (req as any).oidc?.user?.sub as string | undefined;
  if (sub) { runWithRequestIdentity({ sub, principalIssuer: (req as any).oidc?.user?.iss, isOperator: false }, next); return; }
  if (hasValidServiceSecret(req)) { requireTrustedServiceUserIdentity(req, res, next); return; }
  res.status(401).json({ error: 'not_authenticated' });
}

function makeApp(): express.Express {
  // Mirrors manifest-route-mounter.ts: a package factory receives the framework context with
  // applicationAuthorization removed, so the package cannot call the core relay in-process.
  const packageCtx = { pool: ownerPool(), appPackageDir: pkg, applicationAuthorization: undefined, authorization: fixtureAuthorization(),
    ticketService: { createTicket: async (ticket: Record<string, unknown>) => {
      recorded.tickets.push(ticket); return { ticketId: `fixture-ticket-${recorded.tickets.length}` };
    } } } as unknown as AppContext;
  const app = express();
  app.use(express.json());
  app.get('/favicon.ico', (_req, res) => { res.status(204).end(); });
  app.use('/shared/ui', express.static(join(framework, 'src/shared/ui')));
  app.use((req, _res, next) => {
    try { const actor = identity(req); (req as any).oidc = { user: { sub: actor.sub, iss: actor.issuer }, isAuthenticated: () => true }; }
    catch { /* no fixture cookie: the request stays unauthenticated */ }
    next();
  });
  // The same gate server.ts puts in front of the real routes: a service-rail request is admitted
  // here, and it is core's exact-principal check that must refuse it.
  const fixtureRequiresAuth: express.RequestHandler = (req, res, next) => ((req as any).oidc ? next() : res.status(401).json({ error: 'fixture_login_required' }));
  app.use('/api/artifacts', serviceSecretOr(fixtureRequiresAuth), createArtifactExchangeRoutes({ applicationAuthorization: runtime } as AppContext));
  sourceRoutes(app);
  mountLoraIngest(app, packageCtx);
  app.use('/api/lora', loraMountAuth, createBotLoraRoutes(packageCtx));
  return app;
}

beforeAll(async () => {
  vi.stubEnv('SWARM_SERVICE_SECRET', SECRET);
  await fixture.start();
  for (let pass = 0; pass < 2; pass++) for (const name of ['058-lora-studio.sql', '100-lora-owner-rls.sql', '101-lora-cell-images.sql',
    '102-lora-character-identity.sql', '103-lora-dataset-images.sql', '104-lora-dataset-staging.sql', '105-lora-callback-grants.sql',
    '106-lora-callback-identity.sql']) {
    await fixture.pool.query(readFileSync(resolve(pkg, 'migrations', name), 'utf8'));
  }
  await fixture.pool.query('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO dataset_a, dataset_b');
  await startRuntime();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  portrait = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 4;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = 'teal'; ctx.fillRect(0, 0, 4, 4);
    return canvas.toDataURL('image/png').split(',')[1];
  }), 'base64');
  await page.close();
  server = makeApp().listen(0, '127.0.0.1');
  await new Promise<void>((done) => server.once('listening', done));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 120_000);

beforeEach(async () => {
  await fixture.pool.query('TRUNCATE oshal_lora_characters CASCADE');
  await fixture.pool.query(`INSERT INTO oshal_lora_characters(id, subject, display_name, trigger_word, owner_sub)
    VALUES ($1, 'tin-drummer', 'Tin drummer', 'tindrummer', 'dataset_a'), ($2, 'tin-drummer', 'Other drummer', 'tindrummer', 'dataset_b')`, [CHAR_A, CHAR_B]);
  recorded.commands.length = 0; recorded.tickets.length = 0; recorded.online = true; sourceHits.length = 0;
});

afterAll(async () => {
  await browser?.close();
  if (server) { server.closeAllConnections(); await new Promise<void>((done) => server.close(() => done())); }
  await fixture.stop();
  if (root) rmSync(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

async function mint(source = 'image', user = 'owner_a', type = 'image/png'): Promise<string> {
  const response = await fetch(`${base}/api/artifacts/handles`, { method: 'POST',
    headers: { cookie: `dataset-user=${user}`, 'content-type': 'application/json' },
    body: JSON.stringify({ source: `/api/portrait-fixture/${source}`, type, name: 'portrait-1234abcd.png' }) });
  expect(response.status, await response.clone().text()).toBe(201);
  return (await response.json()).ref as string;
}
function importAs(user: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${base}/api/lora/dataset/import`, { method: 'POST',
    headers: { cookie: `dataset-user=${user}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
function serviceHeaders(sub: string): Record<string, string> {
  return { 'x-service-secret': SECRET, 'x-oshal-user-sub-b64': Buffer.from(sub).toString('base64url') };
}
function workerGet(imageId: string, headers: Record<string, string>): Promise<Response> {
  return fetch(`${base}/api/lora/ingest/dataset-download/${imageId}`, { method: 'POST', headers });
}
/** Download as the worker holding the import's grant. */
function signedGet(grant: WorkerGrant, imageId: string, owner = 'dataset_a'): Promise<Response> {
  return send(signedRequest(base, grant, owner, 'POST', `/api/lora/ingest/dataset-download/${imageId}`));
}
function callback(grant: WorkerGrant, status: 'ready' | 'failed', filename = 'portrait-1234abcd.png', sub = 'dataset_a'): Promise<Response> {
  return send(signedCallback(base, grant, sub, { kind: 'dataset', character: workerKey(CHAR_A), filename, status,
    ...(status === 'ready' ? { byte_size: portrait.length } : {}) }));
}
async function adminRows(sql: string, params: unknown[] = []): Promise<Record<string, any>[]> {
  return (await fixture.pool.query(sql, params)).rows;
}
async function receipts(): Promise<Record<string, any>[]> {
  return adminRows('SELECT d.id, d.filename, d.status, d.byte_size, d.ingested_at, s.image, s.content_type FROM oshal_lora_dataset_images d LEFT JOIN oshal_lora_dataset_staging s ON s.image_id = d.id ORDER BY d.created_at');
}

describe('LoRA dataset destination through the real core relay', () => {
  it('redeems a principal-bound handle as the signed-in owner and stages the exact source bytes', async () => {
    const response = await importAs('owner_a', { ref: await mint(), subject: 'tin-drummer', caption: 'tindrummer, portrait' });
    expect(response.status, await response.clone().text()).toBe(202);
    expect(await response.json()).toMatchObject({ ok: true, filename: 'portrait-1234abcd.png', byteSize: portrait.length });
    const [row] = await receipts();
    expect(row).toMatchObject({ filename: 'portrait-1234abcd.png', status: 'queued', byte_size: portrait.length, content_type: 'image/png' });
    expect(Buffer.from(row.image).equals(portrait)).toBe(true);
    expect(sourceHits).toHaveLength(1);
    expect(sourceHits[0].cookie).toBe('dataset-user=owner_a');
    expect(sourceHits[0]['x-service-secret']).toBeUndefined();
    expect(recorded.commands).toHaveLength(1);
    expect(recorded.commands[0]).toContain(`/api/lora/ingest/dataset-download/${row.id}'`);
    expect(recorded.commands[0]).not.toContain('/api/artifacts/');
    expect(recorded.commands[0]).not.toContain(SECRET);
    const grant = grantFromCommand(recorded.commands[0]);
    expect(await adminRows('SELECT owner_sub, owner_issuer, character_id, dispatch_kind, callback_kinds FROM oshal_lora_callback_grants WHERE id = $1', [grant.id]))
      .toEqual([{ owner_sub: 'dataset_a', owner_issuer: ISSUER, character_id: CHAR_A, dispatch_kind: 'dataset-import', callback_kinds: ['dataset-download', 'dataset'] }]);
    expect(recorded.tickets[0]).toMatchObject({ ownerSub: 'dataset_a', metadata: { action: 'dataset-import', datasetImageId: row.id } });
  });

  it('refuses a foreign owner, a second issuer and an expired handle without a receipt or dispatch', async () => {
    const ref = await mint();
    expect((await importAs('owner_b', { ref, subject: 'tin-drummer' })).status).toBe(404);
    expect((await importAs('collision', { ref, subject: 'tin-drummer' })).status).toBe(404);
    const expired = mintArtifactHandle({ ownerSub: 'dataset_a', sourcePath: '/api/portrait-fixture/image', type: 'image/png' }, Date.now() - 16 * 60_000);
    expect((await importAs('owner_a', { ref: expired.ref, subject: 'tin-drummer' })).status).toBe(404);
    expect(await receipts()).toHaveLength(0);
    expect(recorded.commands).toHaveLength(0);
    expect(sourceHits).toHaveLength(0);
  });

  it('cannot redeem over the service rail even when the mount admits the request', async () => {
    const ref = await mint();
    // The 1.4.x lookup: core admits the secret at the mount, then its exact-principal check refuses.
    expect((await fetch(`${base}/api/artifacts/handles/${ref}`, { headers: serviceHeaders('dataset_a') })).status).toBe(404);
    expect((await fetch(`${base}/api/artifacts/handles/${ref}/content`, { headers: serviceHeaders('dataset_a') })).status).not.toBe(200);
    const response = await fetch(`${base}/api/lora/dataset/import`, { method: 'POST',
      headers: { ...serviceHeaders('dataset_a'), 'content-type': 'application/json' },
      body: JSON.stringify({ ref, subject: 'tin-drummer' }) });
    expect(response.status).toBe(403);
    expect(await receipts()).toHaveLength(0);
    expect(recorded.commands).toHaveLength(0);
    expect(sourceHits).toHaveLength(0);
  });

  it('refuses non-image, mislabelled and oversized sources before storage', async () => {
    expect((await importAs('owner_a', { ref: await mint('notes', 'owner_a', 'text/plain'), subject: 'tin-drummer' })).status).toBe(415);
    expect((await importAs('owner_a', { ref: await mint('mislabelled'), subject: 'tin-drummer' })).status).toBe(415);
    expect((await importAs('owner_a', { ref: await mint('huge'), subject: 'tin-drummer' })).status).toBe(413);
    expect(await receipts()).toHaveLength(0);
    expect(recorded.commands).toHaveLength(0);
  });

  it('serves staged bytes only to the worker holding the import grant and clears them on the ready callback', async () => {
    expect((await importAs('owner_a', { ref: await mint(), subject: 'tin-drummer' })).status).toBe(202);
    const [{ id }] = await receipts();
    const grant = grantFromCommand(recorded.commands[0]);
    expect((await workerGet(id, {})).status).toBe(401);
    expect((await workerGet(id, { cookie: 'dataset-user=owner_a' })).status).toBe(401);
    expect((await workerGet(id, serviceHeaders('dataset_a'))).status).toBe(401);
    expect((await signedGet(grant, id, 'dataset_b')).status).toBe(401);
    const own = await signedGet(grant, id);
    expect(own.status).toBe(200);
    expect(own.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await own.arrayBuffer()).equals(portrait)).toBe(true);
    expect((await callback(grant, 'ready', 'portrait-1234abcd.png', 'dataset_b')).status).toBe(401);
    expect((await callback(grant, 'ready')).status).toBe(200);
    const [row] = await receipts();
    expect(row).toMatchObject({ status: 'ready', image: null });
    expect(row.ingested_at).not.toBeNull();
    const after = await signedGet(grant, id);
    expect(after.status).toBe(401);
    expect(await after.json()).toEqual({ error: 'callback_grant_revoked' });
  });

  it('clears staged bytes on a failed callback and fails the receipt when no worker accepts it', async () => {
    expect((await importAs('owner_a', { ref: await mint(), subject: 'tin-drummer' })).status).toBe(202);
    expect((await callback(grantFromCommand(recorded.commands[0]), 'failed')).status).toBe(200);
    expect((await receipts())[0]).toMatchObject({ status: 'failed', image: null });
    recorded.online = false;
    const offline = await importAs('owner_a', { ref: await mint(), subject: 'tin-drummer' });
    expect(offline.status).toBe(503);
    expect(await offline.json()).toMatchObject({ status: 'box_required' });
    expect((await receipts())[0]).toMatchObject({ status: 'failed', image: null });
  });

  it('expires staged bytes on their own clock and reports the receipt failed', async () => {
    expect((await importAs('owner_a', { ref: await mint(), subject: 'tin-drummer' })).status).toBe(202);
    const [{ id }] = await receipts();
    await fixture.pool.query("UPDATE oshal_lora_dataset_staging SET expires_at = NOW() - INTERVAL '1 minute'");
    expect((await signedGet(grantFromCommand(recorded.commands[0]), id)).status).toBe(404);
    const listed = await fetch(`${base}/api/lora/dataset?subject=tin-drummer`, { headers: { cookie: 'dataset-user=owner_a' } });
    expect(listed.status).toBe(200);
    expect((await listed.json()).images).toMatchObject([{ filename: 'portrait-1234abcd.png', status: 'failed' }]);
    expect(await adminRows('SELECT 1 FROM oshal_lora_dataset_staging')).toHaveLength(0);
  });

  it('keeps staged bytes invisible and unwritable to another owner at the database', async () => {
    expect((await importAs('owner_a', { ref: await mint(), subject: 'tin-drummer' })).status).toBe(202);
    const [{ id }] = await receipts();
    expect((await fixture.rolePool('dataset_a').query('SELECT image_id FROM oshal_lora_dataset_staging')).rows).toHaveLength(1);
    expect((await fixture.rolePool('dataset_b').query('SELECT image_id FROM oshal_lora_dataset_staging')).rows).toHaveLength(0);
    await expect(fixture.rolePool('dataset_b').query(
      `UPDATE oshal_lora_dataset_staging SET image = $2, byte_size = 1, sha256 = 'x' WHERE image_id = $1 RETURNING image_id`, [id, Buffer.from([1])],
    ).then((result) => result.rows)).resolves.toHaveLength(0);
    await fixture.pool.query('DELETE FROM oshal_lora_dataset_staging');
    await expect(fixture.rolePool('dataset_b').query(
      `INSERT INTO oshal_lora_dataset_staging (image_id, content_type, byte_size, sha256, image, expires_at)
       VALUES ($1, 'image/png', $2, 'x', $3, NOW() + INTERVAL '1 hour')`, [id, portrait.length, portrait],
    )).rejects.toThrow(/row-level security/);
  });

  it('imports a sent image from the studio console and shows its queued receipt', async () => {
    const ref = await mint();
    const context = await browser.newContext();
    await context.addCookies([{ name: 'dataset-user', value: 'owner_a', url: base }]);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.route('**/*', (route) => (route.request().url().startsWith(base) ? route.continue() : route.abort()));
    await page.goto(`${base}/api/lora/ui?artifact=${ref}`);
    await page.locator('.card').filter({ hasText: 'Tin drummer' }).click();
    await page.locator('#datasetCaption').fill('tindrummer, studio portrait');
    await page.getByRole('button', { name: 'Import selected image' }).click();
    await expect.poll(() => page.locator('#datasetRows').textContent()).toContain('queued for worker');
    const rows = String(await page.locator('#datasetRows').textContent());
    expect(rows).toContain('portrait-1234abcd.png');
    expect(rows).toContain('tindrummer, studio portrait');
    expect(await page.locator('#result').textContent()).toContain('queued for tin-drummer');
    const [row] = await receipts();
    expect(Buffer.from(row.image).equals(portrait)).toBe(true);
    expect(errors).toEqual([]);
    await context.close();
  });
});
