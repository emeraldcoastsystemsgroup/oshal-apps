/**
 * CHANGE LOG
 * SEQ | AUTHOR | DESCRIPTION
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise real core authorization and owner SQL over one isolated two-client GUC-wrapped PostgreSQL pool.
 */
import express, { type Request } from 'express';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import type { AddressInfo } from 'node:net';
import type { Pool, PoolClient } from 'pg';
import yaml from 'js-yaml';
import { ApplicationAuthorizationRuntime } from '@/app/composition/application-authorization-runtime';
import { ApplicationAuthorizationService, PostgresAuthorizationStore, ensureApplicationAuthorizationSchema } from '@/features/application-authorization';
import { wrapPoolWithGuc } from '@/shared/services/database';
import type { AuthorizationActor } from '@/shared/application-authorization';
import type { SwarmAppManifest, SwarmApplicationRecord } from '@/features/swarm-apps';
import { createCreateProjectRoutes } from '../../src-routes/create-project-routes';
import { startPostgres } from '../project-postgres.fixture.mjs';

const PACKAGE = resolve(__dirname, '../..');
type Cleanup = () => Promise<void>;

/** Observe actual work and optionally hold an inserted revision; never replace SQL results. */
function observePool(pool: Pool) {
  const state = { activeWrites: 0, maxWrites: 0, revisionWrites: 0, delayMs: 0, checkoutFailures: 0,
    onRevision: undefined as undefined | (() => Promise<void>) };
  const connect = async () => {
    let client: PoolClient;
    try { client = await pool.connect(); } catch (error) { state.checkoutFailures++; throw error; }
    let writing = false;
    return new Proxy(client, { get(target, property) {
      if (property === 'query') return async (sql: string, values?: unknown[]) => {
        const result = await target.query(sql, values);
        if (sql.includes("set_config('create.owner_issuer'") && !writing) {
          writing = true; state.activeWrites++; state.maxWrites = Math.max(state.maxWrites, state.activeWrites);
        }
        if (/INSERT INTO create_project_revisions/.test(sql)) {
          state.revisionWrites++; if (state.delayMs) await pause(state.delayMs); await state.onRevision?.();
        }
        return result;
      };
      if (property === 'release') return (discard?: boolean) => { if (writing) { writing = false; state.activeWrites--; } target.release(discard); };
      const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
    } });
  };
  return { pool: new Proxy(pool, { get(target, property) { return property === 'connect' ? connect : Reflect.get(target, property); } }), state };
}

/** Create one disposable database and actual policy service with synthetic principal resolution only. */
async function persistence(registerCleanup: (cleanup: Cleanup) => void) {
  const db = await startPostgres(registerCleanup, { poolMax: 2 });
  await ensureApplicationAuthorizationSchema(db.admin);
  await db.admin.query('GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO create_fixture_app');
  const observed = observePool(wrapPoolWithGuc(db.pool));
  const actor = (sub: string): AuthorizationActor => ({ sub, issuer: 'https://create-concurrency.fixture.test', isActive: true, isSwarmAdmin: false });
  const actors = { alice: actor('alice'), bob: actor('bob'), operator: { ...actor('operator'), isSwarmAdmin: true } };
  const store = new PostgresAuthorizationStore(observed.pool);
  const policy = new ApplicationAuthorizationService(store, { resolveActor: async (sub, issuer) => Object.values(actors).find(value => value.sub === sub && value.issuer === issuer) ?? null });
  const resolveActor = async (req: Request) => {
    const value = actors[req.get('x-fixture-user') as keyof typeof actors];
    if (!value) throw Object.assign(new Error('Synthetic login required'), { status: 401 }); return value;
  };
  const change = async (user: 'alice' | 'bob', action: 'grant' | 'revoke') => {
    const target = actors[user], preview = await policy.previewChange(actors.operator, { app: 'create', role: 'admin', action,
      targetSub: target.sub, targetIssuer: target.issuer, reason: 'Disposable shared-pool concurrency proof', expectedRevision: (await store.read()).revision });
    return policy.applyChange(actors.operator, { previewId: preview.previewId, idempotencyKey: randomUUID() });
  };
  return { db, observed, actors, store, policy, resolveActor, change };
}

/** Real HTTP middleware preserves the core actor and applies actual named catalog guards. */
export async function concurrencyFixture(registerCleanup: (cleanup: Cleanup) => void) {
  const fixture = await persistence(registerCleanup), runtime = new ApplicationAuthorizationRuntime(fixture.policy, fixture.resolveActor);
  const manifest = yaml.load(readFileSync(resolve(PACKAGE, 'oshal-app.yaml'), 'utf8')) as SwarmAppManifest;
  const record = { name: 'create', manifest, manifestPath: resolve(PACKAGE, 'oshal-app.yaml') } as SwarmApplicationRecord;
  await runtime.prepare(manifest, record.manifestPath); await runtime.start(record);
  const dataRoot = await mkdtemp(resolve(tmpdir(), 'create-concurrency-'));
  registerCleanup(() => rm(dataRoot, { recursive: true, force: true }));
  const app = express();
  app.use('/api/create', (req, res, next) => { void runtime.guard('create', req, res, next); });
  app.use('/api/create', createCreateProjectRoutes({ pool: fixture.observed.pool, authorization: runtime.forPackage('create'), appPackageDir: PACKAGE }, { dataRoot }));
  runtime.complete(record);
  await fixture.change('alice', 'grant'); await fixture.change('bob', 'grant');
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(done => server.once('listening', done));
  registerCleanup(async () => { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (name: string, user = 'alice') => {
    const document = { version: 1, name, width: 320, height: 240, background: '#ffffff', images: {}, layers: [] };
    const response = await fetch(origin + '/api/create/projects', { method: 'POST', headers: { 'content-type': 'application/json', 'x-fixture-user': user },
      body: JSON.stringify({ title: name, document }), signal: AbortSignal.timeout(8000) });
    return { status: response.status, body: await response.json() };
  };
  return { ...fixture, runtime, call };
}
