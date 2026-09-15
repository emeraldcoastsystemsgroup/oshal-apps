/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Mount real Create factories behind actual core policy and transport guards with synthetic principals and no business database.
 */
import express, { type Request } from 'express';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import yaml from 'js-yaml';
import { vi } from 'vitest';
import { ApplicationAuthorizationRuntime } from '@/app/composition/application-authorization-runtime';
import { ManifestRouteMounterImpl } from '@/app/composition/manifest-route-mounter';
import { ApplicationAuthorizationService, MemoryAuthorizationStore } from '@/features/application-authorization';
import type { AuthorizationActor, AuthorizationChange } from '@/shared/application-authorization';
import type { SwarmAppManifest, SwarmApplicationRecord } from '@/features/swarm-apps';
import type { AppContext } from '@/app/composition/app-context';
import { createCreateRoutes } from '../../src-routes/create-routes';
import { createCreateProjectRoutes } from '../../src-routes/create-project-routes';
import { createPackageSmokeRoutes } from '../../src-routes/package-smoke';

export const PACKAGE = resolve(__dirname, '../..');
export const RECORD = '12345678-1234-4234-8234-123456789abc';

/** @description Only synthetic verified identities enter this isolated HTTP fixture. */
function principals(): Record<string, AuthorizationActor> {
  const actor = (sub: string, issuer = 'https://create-identity.fixture.test') => ({ sub, issuer, isActive: true, isSwarmAdmin: false });
  return { alice: actor('alice'), collision: actor('alice', 'https://other.fixture.test'),
    operator: { ...actor('operator'), isSwarmAdmin: true } };
}

/** @description Preserve manifest paths, modes and factories while allowing the Node loader to call the actual source modules. */
async function mount(app: express.Express, runtime: ApplicationAuthorizationRuntime, manifest: SwarmAppManifest,
  root: string, pool: object, resolveActor: (req: Request) => Promise<AuthorizationActor>) {
  const authenticate: express.RequestHandler = (req, res, next) => {
    void resolveActor(req).then(actor => {
      Object.defineProperty(req, 'oidc', { configurable: true, value: { isAuthenticated: () => true, user: { sub: actor.sub, iss: actor.issuer } } }); next();
    }).catch(() => res.status(401).json({ error: 'fixture_login_required' }));
  };
  const factories = { createCreateRoutes, createCreateProjectRoutes, createPackageSmokeRoutes };
  writeFileSync(join(root, 'source-factory.cjs'), Object.keys(factories).map(name =>
    `exports.${name}=ctx=>ctx.fixtureFactories.${name}({...ctx,appPackageDir:ctx.fixturePackageDir});`).join('\n'));
  const ctx = { pool, authorization: runtime.forPackage('create'), fixtureFactories: factories, fixturePackageDir: PACKAGE };
  const mounter = new ManifestRouteMounterImpl(app, authenticate, ctx as unknown as AppContext, undefined, runtime);
  await mounter.mount('create', root, (manifest.routes ?? []).map(route => ({ ...route, module: 'source-factory.cjs' })), manifest.access);
}

/** @description Compose actual core policy; all business pool access deliberately refuses. */
async function buildFixture(root: string) {
  const actors = principals();
  const pool = { calls: 0, connect: async () => { pool.calls += 1; throw new Error('Synthetic business database deliberately unavailable'); } };
  const store = new MemoryAuthorizationStore();
  const policy = new ApplicationAuthorizationService(store, { resolveActor: async (sub, issuer) =>
    Object.values(actors).find(actor => actor.sub === sub && actor.issuer === issuer) ?? null });
  const resolveActor = async (req: Request) => {
    const actor = actors[req.get('x-fixture-user') ?? ''];
    if (!actor) throw Object.assign(new Error('Fixture login required'), { status: 401 }); return actor;
  };
  const runtime = new ApplicationAuthorizationRuntime(policy, resolveActor);
  const manifest = yaml.load(readFileSync(join(PACKAGE, 'oshal-app.yaml'), 'utf8')) as SwarmAppManifest;
  const record = { name: 'create', manifest, manifestPath: join(PACKAGE, 'oshal-app.yaml') } as SwarmApplicationRecord;
  await runtime.prepare(manifest, record.manifestPath); await runtime.start(record);
  const app = express(); await mount(app, runtime, manifest, root, pool, resolveActor); runtime.complete(record);
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(done => server.once('listening', done));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const change = async (role: string | undefined, user = 'alice', action: AuthorizationChange['action'] = 'grant') => {
    const target = actors[user]; const preview = await policy.previewChange(actors.operator, { app: 'create', role,
      targetSub: target.sub, targetIssuer: target.issuer, action, reason: 'Isolated Create outer-boundary proof', expectedRevision: (await store.read()).revision });
    return policy.applyChange(actors.operator, { previewId: preview.previewId, idempotencyKey: randomUUID() });
  };
  const call = (path: string, user = 'alice', method = 'GET', body?: unknown) => fetch(origin + '/api/create' + path,
    { method, headers: { 'x-fixture-user': user, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'manual' });
  return { origin, actors, pool, runtime, policy, store, manifest, record, change, call,
    async close() { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done()));
      vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); } };
}

/** @description Clean the isolated staging directory even when actual catalog validation rejects activation. */
export async function createAuthorizationBoundaryFixture() {
  vi.stubEnv('APP_PACKAGE_DYNAMIC_ROUTES', '1'); vi.stubEnv('OSHAL_APP_ACCESS_MODE', 'enforce');
  const root = mkdtempSync(join(tmpdir(), 'create-boundary-'));
  try { return await buildFixture(root); }
  catch (error) { vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); throw error; }
}
