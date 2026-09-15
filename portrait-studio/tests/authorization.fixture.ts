/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise actual policy and package routes using isolated owner-qualified records and provider doubles.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Include the real outer manifest route mounter so obsolete legacy access declarations cannot hide named-role regressions.
 */
import express, { type Request } from 'express';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import type { AddressInfo } from 'node:net';
import yaml from 'js-yaml';
import { vi } from 'vitest';
import { ApplicationAuthorizationRuntime } from '@/app/composition/application-authorization-runtime';
import { ManifestRouteMounterImpl } from '@/app/composition/manifest-route-mounter';
import { AppAccessService } from '@/features/swarm-apps';
import { ApplicationAuthorizationService, MemoryAuthorizationStore } from '@/features/application-authorization';
import type { AuthorizationActor, AuthorizationChange } from '@/shared/application-authorization';
import type { SwarmAppManifest, SwarmApplicationRecord } from '@/features/swarm-apps';
import type { AppContext } from '@/app/composition/app-context';
import { runWithApplicationAuthorizationActor } from '@/shared/application-authorization-context';
import { getRequestIdentity } from '@/shared/services/database/request-identity';

const providerState = vi.hoisted(() => ({ calls: 0, provider: 'codex', wait: undefined as undefined | Promise<void> }));
vi.mock('@/features/video-generation', () => ({
  resolveStoryboardImageProvider: async () => ({ id: providerState.provider, costClass: 'free', available: async () => true,
    generateWithMeta: async () => { providerState.calls++; await providerState.wait; return { image: Buffer.from('fixture-image'), costUsd: null, model: 'fixture' }; } }),
  recordStoryboardImageCost: async () => undefined,
}));
export const media = providerState;
import { createPortraitStudioRoutes } from '../src-routes/portrait-studio-routes';
import { createPackageSmokeRoutes } from '../src-routes/package-smoke';

export const ISSUER = 'https://portrait-identity.fixture.test';
export const IDS = { alice: '00000000-0000-4000-8000-000000000001', bob: '00000000-0000-4000-8000-000000000002',
  legacy: '00000000-0000-4000-8000-000000000003', created: '00000000-0000-4000-8000-000000000004' };
const PKG = resolve(__dirname, '..');
type Row = { portrait_id: string; user_sub: string; owner_issuer: string | null; title: string; status: string; output_path: string; source_path: string; mode: string; style: string };

function principals(): Record<string, AuthorizationActor> {
  const actor = (sub: string, issuer = ISSUER): AuthorizationActor => ({ sub, issuer, isActive: true, isSwarmAdmin: false });
  return { alice: actor('alice'), bob: actor('bob'), collision: actor('alice', 'https://other-issuer.fixture.test'),
    admin: { ...actor('admin'), isSwarmAdmin: true } };
}
function records(root: string): Row[] {
  const file = join(root, 'portrait.png'); writeFileSync(file, Buffer.from('fixture-image'));
  return Object.entries(IDS).filter(([key]) => key !== 'created').map(([name, portrait_id]) => ({ portrait_id,
    user_sub: name === 'bob' ? 'bob' : 'alice', owner_issuer: name === 'legacy' ? null : ISSUER,
    title: name, status: 'done', output_path: file, source_path: file, mode: 'professional', style: 'linkedin' }));
}
function database(rows: Row[]) {
  const seen: Array<{ sql: string; values: unknown[]; identity: ReturnType<typeof getRequestIdentity> }> = [];
  const query = async (input: string | { text: string; values: unknown[] }, values: unknown[] = []) => {
    const sql = typeof input === 'string' ? input : input.text; if (typeof input !== 'string') values = input.values;
    seen.push({ sql, values, identity: getRequestIdentity() });
    if (/^(?:\s*CREATE|\s*ALTER)/.test(sql) || /INTERVAL.*minutes/.test(sql)) return { rows: [], rowCount: 0 };
    if (/INSERT INTO ps_portraits/.test(sql)) {
      rows.push({ ...rows[0], portrait_id: IDS.created, user_sub: String(values[0]), owner_issuer: String(values[5]), status: 'queued' });
      return { rows: [{ portrait_id: IDS.created }], rowCount: 1 };
    }
    if (/WHERE portrait_id = \$1/.test(sql)) return rowQuery(rows, sql, values);
    if (/FROM ps_portraits WHERE user_sub = \$1/.test(sql)) {
      const index = /owner_issuer = \$3/.test(sql) ? 2 : 1;
      if (!/owner_issuer = \$[23]/.test(sql)) throw new Error('Unqualified collection query');
      const owned = rows.filter(row => row.user_sub === values[0] && row.owner_issuer === values[index]);
      if (/COUNT|count/.test(sql)) return { rows: [{ n: owned.length, active: 0, done: owned.length, total: owned.length, five: owned.length, failed: 0 }], rowCount: 1 };
      return { rows: owned.map(row => ({ ...row })), rowCount: owned.length };
    }
    throw new Error('Unexpected fixture SQL: ' + sql);
  };
  return { query, seen };
}
function rowQuery(rows: Row[], sql: string, values: unknown[]) {
  const row = rows.find(item => item.portrait_id === values[0]);
  if (/owner_issuer/.test(sql) && (!row || row.user_sub !== values[1] || row.owner_issuer !== values[2])) return { rows: [], rowCount: 0 };
  if (!row) return { rows: [], rowCount: 0 };
  if (/^DELETE/.test(sql)) { rows.splice(rows.indexOf(row), 1); return { rows: [], rowCount: 1 }; }
  if (/SET title/.test(sql)) row.title = String(values[3]);
  if (/SET source_path/.test(sql)) row.source_path = String(values[1]);
  if (/status = 'generating'/.test(sql)) row.status = 'generating';
  if (/status = 'done'/.test(sql)) { row.status = 'done'; row.output_path = String(values[1]); }
  if (/status = 'failed'/.test(sql)) row.status = 'failed';
  return { rows: [{ ...row }], rowCount: 1 };
}
async function serverFor(runtime: ApplicationAuthorizationRuntime, ctx: AppContext, manifest: SwarmAppManifest,
  root: string, resolveActor: (req: Request) => Promise<AuthorizationActor>) {
  const app = express(); app.use(express.json());
  app.get('/api/artifacts/picker.js', (_req, res) => res.type('js').send('window.oshalPickArtifact = async () => null;'));
  const authenticate: express.RequestHandler = (req, res, next) => {
    void resolveActor(req).then(actor => {
      Object.defineProperty(req, 'oidc', { value: { isAuthenticated: () => true, user: { sub: actor.sub, iss: actor.issuer } } });
      next();
    }).catch(() => res.status(401).json({ error: 'fixture_login_required' }));
  };
  // A temporary factory adapter lets the actual Node mounter use the real TypeScript package
  // routers with existing provider doubles. Paths/auth/access still come from the shipped manifest.
  writeFileSync(join(root, 'route-factory.cjs'), `
    exports.createPortraitStudioRoutes = ctx => ctx.fixtureFactories.portraits({...ctx, appPackageDir:ctx.fixturePackageDir});
    exports.createPackageSmokeRoutes = ctx => ctx.fixtureFactories.smoke({...ctx, appPackageDir:ctx.fixturePackageDir});
  `);
  const mountedContext = Object.assign({}, ctx, { fixturePackageDir: PKG,
    fixtureFactories: { portraits: createPortraitStudioRoutes, smoke: createPackageSmokeRoutes } });
  const legacyAccess = new AppAccessService({ query: async () => ({ rows: [], rowCount: 0 }) } as any);
  const mounter = new ManifestRouteMounterImpl(app, authenticate, mountedContext, legacyAccess, runtime);
  await mounter.mount(manifest.name, root, (manifest.routes ?? []).map(route => ({ ...route, module: 'route-factory.cjs' })), manifest.access);
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(done => server.once('listening', done));
  return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

/** @description Build an isolated real policy/runtime and actual package HTTP fixture.
 * @returns Fixture principal, role-change, route and cleanup operations.
 */
export async function createPortraitFixture() {
  media.calls = 0; media.provider = 'codex'; media.wait = undefined;
  vi.stubEnv('APP_PACKAGE_DYNAMIC_ROUTES', '1'); vi.stubEnv('OSHAL_APP_ACCESS_MODE', 'enforce');
  const root = mkdtempSync(join(tmpdir(), 'portrait-permissions-')); vi.stubEnv('CLINE_WORKSPACE_ROOT', root);
  const actors = principals(), rows = records(root), pool = database(rows), store = new MemoryAuthorizationStore();
  const policy = new ApplicationAuthorizationService(store, { resolveActor: async (sub, issuer) => Object.values(actors).find(actor => actor.sub === sub && actor.issuer === issuer) ?? null });
  const resolveActor = async (req: Request) => {
    const key = req.get('x-fixture-user') ?? /(?:^|;\s*)fixture-user=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
    if (!key || !actors[key]) throw Object.assign(new Error('Fixture login required'), { status: 401 });
    return actors[key];
  };
  const runtime = new ApplicationAuthorizationRuntime(policy, resolveActor);
  const manifest = yaml.load(readFileSync(join(PKG, 'oshal-app.yaml'), 'utf8')) as SwarmAppManifest;
  const record = { name: manifest.name, manifest, manifestPath: join(PKG, 'oshal-app.yaml') } as SwarmApplicationRecord;
  await runtime.prepare(manifest, record.manifestPath); await runtime.start(record);
  const ctx = { pool, appPackageDir: PKG, authorization: runtime.forPackage('portrait-studio') } as unknown as AppContext;
  const http = await serverFor(runtime, ctx, manifest, root, resolveActor); runtime.complete(record);
  const change = async (role: string | undefined, user = 'alice', action: AuthorizationChange['action'] = 'grant') => {
    const target = actors[user]; const preview = await policy.previewChange(actors.admin, { app: 'portrait-studio', role,
      targetSub: target.sub, targetIssuer: target.issuer, action, reason: 'Isolated Portrait permission proof', expectedRevision: (await store.read()).revision });
    return policy.applyChange(actors.admin, { previewId: preview.previewId, idempotencyKey: crypto.randomUUID() });
  };
  const call = (path: string, user = 'alice', method = 'GET', body?: unknown) => fetch(http.base + '/api/portrait-studio' + path,
    { method, headers: { 'x-fixture-user': user, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { ...http, actors, rows, pool, policy, runtime, change, call, ctx,
    asActor: <T>(user: string, work: () => T) => runWithApplicationAuthorizationActor(actors[user], work),
    async close() { http.server.closeAllConnections(); await new Promise<void>(done => http.server.close(() => done())); vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); } };
}
