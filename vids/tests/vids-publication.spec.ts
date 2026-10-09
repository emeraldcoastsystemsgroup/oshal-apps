/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Prove finished MP4 handoff, exact-owner preview, digest-bound publication, anonymous browser delivery, revocation and removal over real HTTP, filesystem and forced-RLS PostgreSQL.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Assert that owner-b attach, publish and remove on owner-a's finished job each return 404 job_not_found and leave the export unpublished. Before this, only revoke and preview had a cross-owner assertion, so the "only the owner can publish" claim rested on code reading for the publish verb itself. Read the framework migrations from OSHAL_FRAMEWORK_ROOT (default ../../oshal), the same root publication.config.mjs and the security framework-coupled config alias @/ to. The hard-coded sibling could load aliases from one framework and SQL from another, and failed with ENOENT outside that layout.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser } from 'playwright';
import { DisposablePostgres } from '@test-fixtures/disposable-postgres';
import { getRequestIdentity, runWithRequestIdentity } from '@/shared/services/database/request-identity';

vi.setConfig({ testTimeout: 30000, hookTimeout: 120000 });

vi.mock('@/shared/logger', () => ({ createChildLogger: () => ({ info: vi.fn(), warn: vi.fn() }) }));
vi.mock('@/app/routes/remote-client-routes', () => ({
  remoteClientRegistry: { listClients: () => [], enqueueTask: vi.fn(), getCompletedResult: vi.fn() },
}));

import { createVidsRoutes } from '../src-routes/vids-routes';
import { createVidsPublicRoutes } from '../src-routes/vids-public-routes';

const pkg = fileURLToPath(new URL('..', import.meta.url));
const framework = resolve(process.env.OSHAL_FRAMEWORK_ROOT || resolve(pkg, '../../oshal'));
const workspace = mkdtempSync(resolve(tmpdir(), 'oshal-vids-publication-'));
process.env.CLINE_WORKSPACE_ROOT = workspace;

const fixture = new DisposablePostgres({ purpose: 'vids-publication', roles: [
  { name: 'vids_owner_a', max: 6, options: '-c oshal.current_sub=owner-a -c oshal.is_operator=off' },
  { name: 'vids_owner_b', max: 4, options: '-c oshal.current_sub=owner-b -c oshal.is_operator=off' },
  { name: 'vids_public', max: 4, options: '-c oshal.current_sub= -c oshal.is_operator=off' },
] });

const jobDone = '40000000-0000-4000-8000-000000000001';
const jobQueued = '40000000-0000-4000-8000-000000000002';
const jobOther = '40000000-0000-4000-8000-000000000003';
const ownerByRole = new Map([['owner-a', 'vids_owner_a'], ['owner-b', 'vids_owner_b']]);
let server: Server;
let browser: Browser;
let origin: string;

function box(type: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(header.length + payload.length, 0);
  header.write(type, 4, 4, 'ascii');
  return Buffer.concat([header, payload]);
}

function validMp4(): Buffer {
  const ftyp = box('ftyp', Buffer.from('isom\0\0\0\0isomiso2', 'ascii'));
  const handler = Buffer.concat([Buffer.alloc(8), Buffer.from('vide', 'ascii'), Buffer.alloc(12)]);
  const moov = box('moov', box('trak', box('mdia', box('hdlr', handler))));
  return Buffer.concat([ftyp, moov, box('mdat', Buffer.from('video-data'))]);
}

function rolePool(owner: string) {
  const role = ownerByRole.get(owner);
  if (!role) throw new Error(`No fixture role for ${owner}`);
  return fixture.rolePool(role);
}

function requestPool() {
  const sub = getRequestIdentity()?.sub;
  if (sub === 'owner-a' || sub === 'owner-b') return rolePool(sub);
  if (sub === null) return fixture.rolePool('vids_public');
  throw new Error(`Unexpected fixture identity: ${String(sub)}`);
}

function appContext() {
  return { pool: {
    query: (sql: string, params?: unknown[]) => requestPool().query(sql, params),
    connect: () => requestPool().connect(),
  } } as any;
}

function makeApp() {
  const ctx = appContext();
  const app = express();
  app.use(express.json());
  app.use('/api/vids', (req, res, next) => {
    const owner = String(req.headers['x-test-owner'] || '');
    if (owner !== 'owner-a' && owner !== 'owner-b') { res.status(401).json({ error: 'not_authenticated' }); return; }
    Object.assign(req, { oidc: { isAuthenticated: () => true, user: { sub: owner } } });
    runWithRequestIdentity({ sub: owner, isOperator: false }, next);
  }, createVidsRoutes(ctx));
  app.use('/api/vids-public', createVidsPublicRoutes(ctx));
  return app;
}

async function fetchOwner(owner: string, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('x-test-owner', owner);
  return fetch(origin + path, { ...init, headers });
}

async function seedJob(jobId: string, owner: string, status: string) {
  await rolePool(owner).query(
    'INSERT INTO vids_jobs(job_id,user_sub,status,idea) VALUES($1,$2,$3,$4)',
    [jobId, owner, status, `fixture ${jobId}`],
  );
}

async function upload(owner: string, jobId: string, bytes = validMp4()) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'video/mp4' }), 'finished.mp4');
  return fetchOwner(owner, `/api/vids/jobs/${jobId}/artifact`, { method: 'POST', body: form });
}

async function outcome(response: Response) {
  return { status: response.status, body: await response.json() };
}

beforeAll(async () => {
  await fixture.start();
  await fixture.pool.query(readFileSync(resolve(framework, 'scripts/migrations/001-multi-agent-foundation.sql'), 'utf8'));
  await fixture.pool.query(readFileSync(resolve(framework, 'scripts/migrations/008-seed-swarm-agents.sql'), 'utf8'));
  for (const name of ['059-vids-platform.sql', '100-vids-owner-rls.sql', '101-vids-artifact-publication.sql']) {
    await fixture.pool.query(readFileSync(resolve(pkg, 'migrations', name), 'utf8'));
  }
  await fixture.pool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON vids_jobs, vids_artifacts TO vids_owner_a, vids_owner_b`);
  await fixture.pool.query('GRANT SELECT ON vids_artifacts TO vids_public');
  const app = makeApp();
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((done) => server.once('listening', done));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await chromium.launch({ headless: true });
}, 120000);

beforeEach(async () => {
  await fixture.pool.query('TRUNCATE vids_artifacts, vids_jobs CASCADE');
});

afterAll(async () => {
  await browser?.close();
  if (server) await new Promise<void>((done) => server.close(() => done()));
  rmSync(workspace, { recursive: true, force: true });
  await fixture.stop();
});

describe('Vids finished artifact publication', () => {
  it('attaches a complete MP4 to a finished job and keeps preview exact-owner', async () => {
    await seedJob(jobDone, 'owner-a', 'done');
    const bytes = validMp4();
    const response = await upload('owner-a', jobDone, bytes);
    expect(response.status).toBe(201);
    const artifact = (await response.json()).artifact;
    expect(artifact.publicUrl).toBeNull();
    expect(artifact.byteLength).toBe(bytes.length);
    expect((await fetchOwner('owner-a', `/api/vids/jobs/${jobDone}/artifact/video.mp4`)).status).toBe(200);
    expect(Buffer.from(await (await fetchOwner('owner-a', `/api/vids/jobs/${jobDone}/artifact/video.mp4`)).arrayBuffer())).toEqual(bytes);
    expect((await fetchOwner('owner-b', `/api/vids/jobs/${jobDone}/artifact/video.mp4`)).status).toBe(404);
    expect((await fetch(`${origin}/api/vids/jobs/${jobDone}/artifact/video.mp4`)).status).toBe(401);
  });

  it('refuses unfinished jobs and invalid or repeated exports before publication', async () => {
    await seedJob(jobQueued, 'owner-a', 'queued');
    expect((await upload('owner-a', jobQueued)).status).toBe(409);
    await seedJob(jobDone, 'owner-a', 'done');
    expect((await upload('owner-a', jobDone, Buffer.from('not an mp4'))).status).toBe(415);
    expect((await upload('owner-a', jobDone)).status).toBe(201);
    expect((await upload('owner-a', jobDone)).status).toBe(409);
  });

  it('requires exact reviewed digest and confirmation, then serves the published bytes in Chromium', async () => {
    await seedJob(jobDone, 'owner-a', 'done');
    const uploadResponse = await upload('owner-a', jobDone);
    const artifact = (await uploadResponse.json()).artifact as { sha256: string };
    expect((await fetchOwner('owner-a', `/api/vids/jobs/${jobDone}/artifact/publish`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sha256: artifact.sha256 }),
    })).status).toBe(428);
    expect((await fetchOwner('owner-a', `/api/vids/jobs/${jobDone}/artifact/publish`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: true, sha256: '0'.repeat(64) }),
    })).status).toBe(409);
    const published = await fetchOwner('owner-a', `/api/vids/jobs/${jobDone}/artifact/publish`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: true, sha256: artifact.sha256 }),
    });
    expect(published.status).toBe(200);
    const publicUrl = (await published.json()).artifact.publicUrl as string;
    const publicResponse = await fetch(origin + publicUrl);
    expect(publicResponse.status).toBe(200);
    expect(publicResponse.headers.get('cache-control')).toBe('private, no-store');
    const context = await browser.newContext();
    const browserResponse = await context.request.get(origin + publicUrl);
    expect(browserResponse.status()).toBe(200);
    expect(await browserResponse.body()).toEqual(validMp4());
    await context.close();
  });

  it('prevents other-owner control, revokes anonymous access, and removes only after revocation', async () => {
    await seedJob(jobDone, 'owner-a', 'done');
    const uploaded = (await (await upload('owner-a', jobDone)).json()).artifact as { sha256: string };
    // Owner-b knows owner-a's job id and reviewed digest, yet every control verb is refused as if the job did not exist.
    const notFound = { status: 404, body: { error: 'job_not_found' } };
    expect(await outcome(await upload('owner-b', jobDone))).toEqual(notFound);
    expect(await outcome(await fetchOwner('owner-b', `/api/vids/jobs/${jobDone}/artifact/publish`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: true, sha256: uploaded.sha256 }),
    }))).toEqual(notFound);
    expect(await outcome(await fetchOwner('owner-b', `/api/vids/jobs/${jobDone}/artifact`, {
      method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: true }),
    }))).toEqual(notFound);
    const untouched = (await (await fetchOwner('owner-a', `/api/vids/jobs/${jobDone}/artifact`)).json()).artifact;
    expect(untouched).toMatchObject({ sha256: uploaded.sha256, publicUrl: null, publishedAt: null });
    const publish = await fetchOwner('owner-a', `/api/vids/jobs/${jobDone}/artifact/publish`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: true, sha256: uploaded.sha256 }),
    });
    const publicUrl = (await publish.json()).artifact.publicUrl as string;
    expect((await fetchOwner('owner-b', `/api/vids/jobs/${jobDone}/artifact/unpublish`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: true }),
    })).status).toBe(404);
    expect((await fetchOwner('owner-a', `/api/vids/jobs/${jobDone}/artifact`, {
      method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: true }),
    })).status).toBe(409);
    expect((await fetchOwner('owner-a', `/api/vids/jobs/${jobDone}/artifact/unpublish`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: true }),
    })).status).toBe(200);
    expect((await fetch(origin + publicUrl)).status).toBe(404);
    expect((await fetchOwner('owner-a', `/api/vids/jobs/${jobDone}/artifact`, {
      method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: true }),
    })).status).toBe(200);
    expect((await fetchOwner('owner-a', `/api/vids/jobs/${jobDone}/artifact/video.mp4`)).status).toBe(404);
    expect((await rolePool('owner-a').query('SELECT * FROM vids_artifacts')).rows).toHaveLength(0);
  });

  it('keeps job/control routes authenticated while public tokens expose no listing or job data', async () => {
    await seedJob(jobOther, 'owner-b', 'done');
    expect((await fetch(`${origin}/api/vids/jobs`)).status).toBe(401);
    expect((await fetch(`${origin}/api/vids-public`)).status).toBe(404);
    expect((await fetch(`${origin}/api/vids-public/not-a-token/video.mp4`)).status).toBe(404);
    expect((await rolePool('owner-b').query('SELECT user_sub FROM vids_jobs')).rows[0].user_sub).toBe('owner-b');
  });
});
