/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise character creation, immutable worker commands, legacy model validation and owner-bound callbacks through actual HTTP and forced-RLS PostgreSQL. Tickets and remote dispatch are recording seams; no worker runs.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Give creation transactions a real connection from the exact non-bypass owner's pool.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Preserve bounded integration and container-cleanup deadlines when discovered by the framework's unit-default runner.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Apply migration 104 with the rest of the package schema: the studio's dataset listing now expires staged images, so a fixture without the staging table would answer that read with an error.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Callbacks now act as the worker holding the grant each real dispatch handed out (migration 105), instead of sending the fleet service secret; cross-owner cases use the other owner's own grant. The review names its dispatch ticket, which the grant is bound to.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Worker callbacks now pass the kernel's signed-package-callbacks verifier first: the ingest router is mounted through the lora-callback-rail double (POST only, verifier, then the router as the grant owner; the real kernel is crossed by signed-callback-boundary.core.test.js), grants carry the owner's verified issuer (migration 106) and the dataset download is an empty signed POST to /dataset-download/:id.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { DisposablePostgres } from '@test-fixtures/disposable-postgres';
import { getRequestIdentity, runWithRequestIdentity } from '@/shared/services/database/request-identity';
import { grantFromCommand, send, signedCallback, signedRequest, type WorkerGrant } from './helpers/lora-callback-signer';

vi.setConfig({ testTimeout: 30000, hookTimeout: 120000 });

const recorded = vi.hoisted(() => ({ commands: [] as string[], tickets: [] as Record<string, unknown>[] }));
vi.mock('@/shared/services/database', () => ({ runRuntimeSchemaBootstrap: vi.fn(async () => undefined) }));
vi.mock('@/app/routes/remote-client-routes', () => ({ remoteClientRegistry: {
  listClients: () => [{ clientId: 'fixture-edge', status: 'online', healthy: true, capabilities: ['shell.exec'], tailnetHostname: 'fixture-edge' }],
  enqueueTask: async (_client: string, envelope: any) => {
    recorded.commands.push(envelope.input.arguments.command);
    return { taskId: `fixture-task-${recorded.commands.length}` };
  },
} }));
import { createBotLoraRoutes } from '../src-routes/bot-lora-routes';
import { fixtureAuthorization, mountLoraIngest } from './helpers/lora-callback-rail';

const fixture = new DisposablePostgres({ purpose: 'lora-worker-storage', roles: [
  { name: 'storage_a', options: '-c oshal.current_sub=storage_a -c oshal.is_operator=off' },
  { name: 'storage_b', options: '-c oshal.current_sub=storage_b -c oshal.is_operator=off' },
] });
const pkg = fileURLToPath(new URL('..', import.meta.url));
const secret = 'worker-storage-fixture-secret';
const ISSUER = 'https://issuer.oshal.example.com';
let server: Server, base: string;
const workerKey = (id: string) => `lora-${id.replace(/-/g, '')}`;

function makeApp() {
  const ownerPool = () => {
    const sub = getRequestIdentity()?.sub;
    if (sub !== 'storage_a' && sub !== 'storage_b') throw new Error('Unbound fixture owner');
    return fixture.rolePool(sub);
  };
  const pool = { query: (sql: string, params?: unknown[]) => ownerPool().query(sql, params), connect: () => ownerPool().connect() };
  const ctx = { pool, appPackageDir: pkg, authorization: fixtureAuthorization(), ticketService: { createTicket: async (ticket: Record<string, unknown>) => {
    recorded.tickets.push(ticket); return { ticketId: `fixture-ticket-${recorded.tickets.length}` };
  }, getTicket: async () => null, updateStatus: async () => undefined } } as any;
  const app = express();
  app.use(express.json());
  mountLoraIngest(app, ctx);
  app.use('/api/lora', (req, res, next) => {
    const sub = req.headers['x-fixture-owner'];
    if (sub !== 'storage_a' && sub !== 'storage_b') { res.status(401).end(); return; }
    Object.assign(req, { oidc: { isAuthenticated: () => true, user: { sub } } });
    runWithRequestIdentity({ sub, principalIssuer: ISSUER, isOperator: false }, next);
  }, createBotLoraRoutes(ctx));
  return app;
}

beforeAll(async () => {
  vi.stubEnv('SWARM_SERVICE_SECRET', secret);
  await fixture.start();
  for (let pass = 0; pass < 2; pass++) for (const name of ['058-lora-studio.sql', '100-lora-owner-rls.sql', '101-lora-cell-images.sql', '102-lora-character-identity.sql', '103-lora-dataset-images.sql', '104-lora-dataset-staging.sql', '105-lora-callback-grants.sql', '106-lora-callback-identity.sql']) {
    await fixture.pool.query(readFileSync(resolve(pkg, 'migrations', name), 'utf8'));
  }
  await fixture.pool.query('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO storage_a, storage_b');
  server = makeApp().listen(0, '127.0.0.1');
  await new Promise<void>((done) => server.once('listening', done));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 120000);

beforeEach(async () => {
  await fixture.pool.query('TRUNCATE oshal_lora_characters CASCADE');
  recorded.commands.length = 0; recorded.tickets.length = 0;
});
afterAll(async () => {
  if (server) await new Promise<void>((done) => server.close(() => done()));
  await fixture.stop(); vi.unstubAllEnvs();
});

function request(route: string, body: Record<string, unknown>, owner = 'storage_a') {
  return fetch(base + '/api/lora' + route, { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-fixture-owner': owner }, body: JSON.stringify(body) });
}
/** The grant the most recent dispatch handed its worker. */
function lastGrant(): WorkerGrant {
  return grantFromCommand(recorded.commands.at(-1)!);
}
function callback(grant: WorkerGrant, character: string, owner = 'storage_a', extra: Record<string, unknown> = {}) {
  return send(signedCallback(base, grant, owner, { character, kind: 'training', version: 1, status: 'trained', ...extra }));
}
async function create(owner = 'storage_a', subject = 'same-character') {
  const response = await request('/characters', { subject, heroImage: `hero-${subject}.png`, identPrompt: `Identity ${subject}` }, owner);
  expect(response.status, await response.text()).toBe(201);
  return (await fixture.rolePool(owner).query('SELECT * FROM oshal_lora_characters WHERE subject=$1', [subject])).rows[0];
}

describe('actual owner storage and worker callback contract', () => {
  it('creates identical public names for two owners and dispatches disjoint storage and model stems', async () => {
    const a = await create(), b = await create('storage_b');
    for (const [row, owner] of [[a, 'storage_a'], [b, 'storage_b']] as const) {
      expect((await request('/train', { subject: row.subject }, owner)).status).toBe(200);
      const key = workerKey(row.id), command = recorded.commands.at(-1)!;
      expect(command).toContain(`--character '${key}'`);
      expect(command).toContain(`/${key}/curated`);
      expect((await callback(lastGrant(), key, owner, { lora_path: `C:\\models\\${key}_v1.safetensors` })).status).toBe(200);
      expect((await request('/validate', { subject: row.subject, version: 1 }, owner)).status).toBe(200);
      expect(recorded.commands.at(-1)).toContain(`--lora-name '${key}_v1.safetensors'`);
    }
    expect(a.id).not.toBe(b.id);
    expect((await fixture.rolePool('storage_a').query('SELECT * FROM oshal_lora_models')).rows).toHaveLength(1);
    expect((await fixture.rolePool('storage_b').query('SELECT * FROM oshal_lora_models')).rows).toHaveLength(1);
  });

  it('cannot resolve another owner worker key and keeps legacy public callbacks readable', async () => {
    const a = await create(); const b = await create('storage_b');
    expect((await request('/train', { subject: b.subject }, 'storage_b')).status).toBe(200);
    expect((await callback(lastGrant(), workerKey(a.id), 'storage_b')).status).toBe(404);
    expect((await request('/train', { subject: a.subject })).status).toBe(200);
    expect((await callback(lastGrant(), a.subject)).status).toBe(200);
    expect((await fixture.rolePool('storage_b').query('SELECT status FROM oshal_lora_models')).rows).toEqual([{ status: 'training' }]);
    expect((await fixture.rolePool('storage_a').query('SELECT status FROM oshal_lora_models')).rows).toEqual([{ status: 'trained' }]);
  });

  it('resolves namespaced score and thumbnail callbacks back to the public owner gallery', async () => {
    const a = await create(); const b = await create('storage_b');
    const key = workerKey(a.id);
    const validated = async (row: Record<string, any>, owner: string): Promise<WorkerGrant> => {
      expect((await request('/train', { subject: row.subject }, owner)).status).toBe(200);
      expect((await callback(lastGrant(), workerKey(row.id), owner)).status).toBe(200);
      expect((await request('/validate', { subject: row.subject, version: 1 }, owner)).status).toBe(200);
      return lastGrant();
    };
    const grantA = await validated(a, 'storage_a'), grantB = await validated(b, 'storage_b');
    expect((await callback(grantA, key, 'storage_a', { kind: 'score', cells: [
      { cell: 'front', score: .8, identity: .8, quality: .8, image: 'front.png' },
    ] })).status).toBe(200);
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const upload = (grant: WorkerGrant, owner: string) => send(signedRequest(base, grant, owner, 'POST',
      `/api/lora/ingest/cell-image?character=${key}&version=1&cell=0&filename=front.png`, { bytes: png, type: 'image/png' }));
    expect((await upload(grantB, 'storage_b')).status).toBe(404);
    expect((await upload(grantA, 'storage_a')).status).toBe(200);
    const imageUrl = `${base}/api/lora/cell-image?subject=same-character&version=1&cell=0`;
    const own = await fetch(imageUrl, { headers: { 'x-fixture-owner': 'storage_a' } });
    expect(own.status).toBe(200); expect(Buffer.from(await own.arrayBuffer())).toEqual(png);
    expect((await fetch(imageUrl, { headers: { 'x-fixture-owner': 'storage_b' } })).status).toBe(404);
  });

  it('validates legacy model basenames and seeds their overnight score under the immutable namespace', async () => {
    const a = await create();
    expect((await request('/train', { subject: a.subject })).status).toBe(200);
    expect((await callback(lastGrant(), a.subject, 'storage_a', { lora_path: 'C:\\old\\same-character_v1.safetensors' })).status).toBe(200);
    await fixture.rolePool('storage_a').query('UPDATE oshal_lora_characters SET autonomous=true WHERE id=$1', [a.id]);
    expect((await request('/validate', { subject: a.subject, version: 1 })).status).toBe(200);
    expect(recorded.commands.at(-1)).toContain("--lora-name 'same-character_v1.safetensors'");
    expect((await request('/improve-overnight', { subject: a.subject })).status).toBe(200);
    const command = recorded.commands.at(-1)!;
    expect(command.indexOf('validate-lora.py')).toBeLessThan(command.indexOf('overnight-loop.py'));
    expect(command).toContain(`/${workerKey(a.id)}/curated`);
    expect(command).not.toContain('/same-character/');
    const reviewTicket = /--review-ticket-id '([^']+)'/.exec(command)![1];
    expect((await callback(lastGrant(), workerKey(a.id), 'storage_a', { kind: 'review', best_version: 1, ticket_id: reviewTicket })).status).toBe(200);
    expect(recorded.tickets.at(-1)?.metadata).toMatchObject({ character: a.subject, action: 'review' });
  });

  it('refuses nonexistent versions and ambiguous callback keys without a ticket or model write', async () => {
    const a = await create();
    expect((await request('/validate', { subject: a.subject, version: 99 })).status).toBe(404);
    expect(recorded.commands).toHaveLength(0); expect(recorded.tickets).toHaveLength(0);
    await create('storage_a', workerKey(a.id));
    expect((await request('/train', { subject: a.subject })).status).toBe(200);
    expect((await callback(lastGrant(), workerKey(a.id))).status).toBe(404);
    expect((await fixture.pool.query(`SELECT * FROM oshal_lora_models WHERE status <> 'training'`)).rows).toHaveLength(0);
  });

  it('separates Windows case, trailing-dot and reserved-device public names', async () => {
    const keys = new Set<string>();
    for (const subject of ['Case', 'case', 'case.', 'CON']) {
      const row = await create('storage_a', subject);
      expect((await request('/train', { subject })).status).toBe(200);
      keys.add(workerKey(row.id));
      expect(recorded.commands.at(-1)).toContain(`/${workerKey(row.id)}/curated`);
      expect(recorded.commands.at(-1)).not.toContain(`/${subject}/curated`);
    }
    expect(keys.size).toBe(4);
  });
});
