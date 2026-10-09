/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Video's first named catalog through the REAL core authorization runtime and route mounter: every manifest route mounts, each of the eight roles admits exactly the endpoints this spec independently expects (studio, series, pump, summary and editor), upload needs create OR change, unbound paths, legacy app-admin, a colliding issuer and a revoked grant are refused, and no refused request reaches the business pool. Studio collaborators (renderer, conductor, pump, storage, bots) are forbidden seams: this boundary is admission, not generation.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | CREATE-EDIT-05c: the five export endpoints join the independently stated admission table.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | CREATE-EDIT-05d: the editor screen and its module allowlist join the table under editor.view.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import express, { type Request } from 'express';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import yaml from 'js-yaml';

const { forbidden } = vi.hoisted(() => ({ forbidden: vi.fn(() => { throw new Error('No provider, render, pump or storage work in an admission proof'); }) }));
vi.mock('@/shared/services/database', () => ({ runRuntimeSchemaBootstrap: async () => undefined, buildOwnerRlsPolicyStatements: () => [] }));
vi.mock('@/features/agent-management', () => ({ BotNodeClient: class {}, createRegistryEndpointResolver: () => forbidden }));
vi.mock('@/features/video-generation', () => ({ renderVideo: forbidden, sanitizeStoryboard: forbidden, storyboardSeconds: forbidden,
  clampTargetSeconds: forbidden, veoCostPerSecond: forbidden, getVertexAccessToken: forbidden }));
vi.mock('@/app/routes/storage-target', () => ({ saveContent: forbidden, listFolder: forbidden }));
vi.mock('@/app/routes/inline-bot-execution', () => ({ executeBotOrInline: forbidden }));
vi.mock('@/app/routes/connectors-routes', () => ({ getValidAccessToken: forbidden }));
vi.mock('@/app/series-dispatch', () => ({ SCREENPLAY_WRITER_AGENT_ID: 'fixture-writer', isRenderInFlight: forbidden, dispatchStoryboardedEpisode: forbidden }));
vi.mock('@/app/series-pipeline', () => ({ writeSeries: forbidden, storyboardEpisode: forbidden, resolveSpeakerPointers: forbidden }));
vi.mock('@/app/series-orchestrator', () => ({ approveSeries: forbidden, runVideoSeries: forbidden, advanceVideoSeries: forbidden }));
vi.mock('@/app/series-drive', () => ({ uploadFrameToDrive: forbidden }));
vi.mock('@/app/series-pump', () => ({ runPumpOnce: forbidden, pickNextShow: forbidden }));
vi.mock('@/app/vids-node-availability', () => ({ checkVidsNodeAvailability: forbidden }));

import { ApplicationAuthorizationRuntime } from '@/app/composition/application-authorization-runtime';
import { ManifestRouteMounterImpl } from '@/app/composition/manifest-route-mounter';
import { ApplicationAuthorizationService, MemoryAuthorizationStore } from '@/features/application-authorization';
import type { AuthorizationActor, AuthorizationChange } from '@/shared/application-authorization';
import type { SwarmAppManifest, SwarmApplicationRecord } from '@/features/swarm-apps';
import type { AppContext } from '@/app/composition/app-context';
import { createBotVideoRoutes } from '../src-routes/video-routes';
import { createVideoPumpRoutes } from '../src-routes/video-pump-routes';
import { createHomeSummaryRoutes } from '../src-routes/home-summary';
import { createPackageSmokeRoutes } from '../src-routes/package-smoke';
import { createVideoEditorRoutes } from '../src-routes/video-editor-routes';

const PACKAGE = resolve(__dirname, '..');
const RECORD = '12345678-1234-4234-8234-123456789abc';
const ALL = ['studio.view', 'studio.read', 'studio.generate', 'pump.manage', 'editor.view', 'editor.read', 'editor.create', 'editor.change', 'editor.delete', 'editor.export'];
const ROLES: Record<string, string[]> = {
  viewer: ['studio.view', 'editor.view'],
  reader: ['studio.view', 'studio.read', 'editor.view', 'editor.read'],
  producer: ['studio.view', 'studio.read', 'studio.generate'],
  showrunner: ['studio.view', 'studio.read', 'studio.generate', 'pump.manage'],
  creator: ['editor.view', 'editor.read', 'editor.create'],
  editor: ['editor.view', 'editor.read', 'editor.change'],
  exporter: ['editor.view', 'editor.read', 'editor.export'],
  admin: ALL,
};
/** This spec's own statement of what each endpoint needs; the catalog must agree with it. */
const ENDPOINTS: Array<[string, string, string[]]> = [
  ['GET', '/ui', ['studio.view']], ['GET', '/list', ['studio.view', 'studio.read']], ['GET', '/series', ['studio.view', 'studio.read']],
  ['GET', '/home-summary', ['studio.view', 'studio.read']],
  ['POST', '/storyboard', ['studio.view', 'studio.generate']], ['POST', '/generate', ['studio.view', 'studio.generate']],
  ['POST', '/series', ['studio.view', 'studio.generate']], ['POST', `/series/${RECORD}/approve`, ['studio.view', 'studio.generate']],
  ['POST', `/series/${RECORD}/advance`, ['studio.view', 'studio.generate']], ['POST', `/series/${RECORD}/write`, ['studio.view', 'studio.generate']],
  ['POST', `/series/${RECORD}/episodes/1/storyboard`, ['studio.view', 'studio.generate']], ['POST', `/series/${RECORD}/episodes/1/render`, ['studio.view', 'studio.generate']],
  ['GET', '/pump/shows', ['studio.view', 'studio.read']], ['GET', '/pump/status', ['studio.view', 'studio.read']],
  ['POST', '/pump/shows/import', ['studio.view', 'pump.manage']], ['POST', '/pump/shows/joke/enroll', ['studio.view', 'pump.manage']],
  ['POST', '/pump/shows/joke/resume', ['studio.view', 'pump.manage']], ['POST', '/pump/run', ['studio.view', 'pump.manage']],
  ['GET', '/editor', ['editor.view']], ['GET', '/editor/assets/editor.mjs', ['editor.view']],
  ['GET', '/editor/capabilities', ['editor.view']], ['GET', '/editor/permissions', ['editor.view']],
  ['GET', `/editor/media/${RECORD}`, ['editor.view', 'editor.read']], ['POST', '/editor/media/cleanup', ['editor.view', 'editor.delete']],
  ['DELETE', `/editor/media/${RECORD}`, ['editor.view', 'editor.delete']],
  ['GET', '/editor/projects', ['editor.view', 'editor.read']], ['POST', '/editor/projects', ['editor.view', 'editor.create']],
  ['GET', `/editor/projects/${RECORD}`, ['editor.view', 'editor.read']], ['DELETE', `/editor/projects/${RECORD}`, ['editor.view', 'editor.delete']],
  ['GET', `/editor/projects/${RECORD}/revisions`, ['editor.view', 'editor.read']], ['POST', `/editor/projects/${RECORD}/revisions`, ['editor.view', 'editor.change']],
  ['GET', `/editor/projects/${RECORD}/revisions/2`, ['editor.view', 'editor.read']],
  ['POST', `/editor/projects/${RECORD}/exports`, ['editor.view', 'editor.read', 'editor.export']], ['GET', `/editor/projects/${RECORD}/exports`, ['editor.view', 'editor.read']],
  ['GET', `/editor/exports/${RECORD}`, ['editor.view', 'editor.read']], ['POST', `/editor/exports/${RECORD}/cancel`, ['editor.view', 'editor.export']],
  ['GET', `/editor/exports/${RECORD}/download`, ['editor.view', 'editor.read', 'editor.export']],
];

function actors(): Record<string, AuthorizationActor> {
  const actor = (sub: string, issuer = 'https://video-identity.fixture.test') => ({ sub, issuer, isActive: true, isSwarmAdmin: false });
  return { alice: actor('alice'), collision: actor('alice', 'https://other.fixture.test'), operator: { ...actor('operator'), isSwarmAdmin: true } };
}

async function mount(app: express.Express, runtime: ApplicationAuthorizationRuntime, manifest: SwarmAppManifest, root: string, pool: object,
  resolveActor: (req: Request) => Promise<AuthorizationActor>) {
  const authenticate: express.RequestHandler = (req, res, next) => {
    void resolveActor(req).then(actor => {
      Object.defineProperty(req, 'oidc', { configurable: true, value: { isAuthenticated: () => true, user: { sub: actor.sub, iss: actor.issuer } } }); next();
    }).catch(() => res.status(401).json({ error: 'fixture_login_required' }));
  };
  const factories = { createBotVideoRoutes, createVideoPumpRoutes, createHomeSummaryRoutes, createPackageSmokeRoutes, createVideoEditorRoutes };
  writeFileSync(join(root, 'source-factory.cjs'), Object.keys(factories).map(name =>
    `exports.${name}=ctx=>ctx.fixtureFactories.${name}({...ctx,appPackageDir:ctx.fixturePackageDir});`).join('\n'));
  const ctx = { pool, authorization: runtime.forPackage('video'), fixtureFactories: factories, fixturePackageDir: PACKAGE };
  const mounter = new ManifestRouteMounterImpl(app, authenticate, ctx as unknown as AppContext, undefined, runtime);
  await mounter.mount('video', root, (manifest.routes ?? []).map(route => ({ ...route, module: 'source-factory.cjs' })), manifest.access);
}

async function buildFixture(root: string) {
  const people = actors();
  const pool = { calls: 0, connect: async () => { pool.calls += 1; throw new Error('Business database deliberately unavailable'); },
    query: async () => { pool.calls += 1; throw new Error('Business database deliberately unavailable'); } };
  const store = new MemoryAuthorizationStore();
  const policy = new ApplicationAuthorizationService(store, { resolveActor: async (sub, issuer) =>
    Object.values(people).find(actor => actor.sub === sub && actor.issuer === issuer) ?? null });
  const resolveActor = async (req: Request) => {
    const actor = people[req.get('x-fixture-user') ?? ''];
    if (!actor) throw Object.assign(new Error('Fixture login required'), { status: 401 }); return actor;
  };
  const runtime = new ApplicationAuthorizationRuntime(policy, resolveActor);
  const manifest = yaml.load(readFileSync(join(PACKAGE, 'oshal-app.yaml'), 'utf8')) as SwarmAppManifest;
  const record = { name: 'video', manifest, manifestPath: join(PACKAGE, 'oshal-app.yaml') } as SwarmApplicationRecord;
  await runtime.prepare(manifest, record.manifestPath); await runtime.start(record);
  const app = express(); app.use(express.json());
  await mount(app, runtime, manifest, root, pool, resolveActor); runtime.complete(record);
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(done => server.once('listening', done));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const change = async (role: string | undefined, user = 'alice', action: AuthorizationChange['action'] = 'grant') => {
    const target = people[user]; const preview = await policy.previewChange(people.operator, { app: 'video', role,
      targetSub: target.sub, targetIssuer: target.issuer, action, reason: 'Isolated Video catalog proof', expectedRevision: (await store.read()).revision });
    return policy.applyChange(people.operator, { previewId: preview.previewId, idempotencyKey: randomUUID() });
  };
  const call = (path: string, user = 'alice', method = 'GET', body: unknown = method === 'GET' ? undefined : {}) => fetch(origin + '/api/video' + path,
    { method, headers: { 'x-fixture-user': user, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'manual' });
  return { pool, store, change, call, manifest,
    async close() { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); } };
}

let fixture: Awaited<ReturnType<typeof buildFixture>>;
beforeEach(async () => {
  vi.stubEnv('APP_PACKAGE_DYNAMIC_ROUTES', '1'); vi.stubEnv('OSHAL_APP_ACCESS_MODE', 'enforce');
  const root = mkdtempSync(join(tmpdir(), 'video-catalog-'));
  try { fixture = await buildFixture(root); } catch (error) { vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); throw error; }
});
afterEach(async () => { await fixture?.close(); });

for (const [role, grants] of Object.entries(ROLES)) it(`the ${role} role admits exactly its endpoints and nothing else reaches the pool`, async () => {
  await fixture.change(role); forbidden.mockClear();
  for (const [method, path, required] of ENDPOINTS) {
    const before = fixture.pool.calls, response = await fixture.call(path, 'alice', method);
    const admitted = required.every(permission => grants.includes(permission));
    if (admitted) expect(response.status, `${role} ${method} ${path}`).not.toBe(403);
    else {
      expect(response.status, `${role} ${method} ${path}`).toBe(403);
      // The core guard's refusal carries a decision ID; the package's own re-check never does. So this
      // proves the CATALOG refused, not a later defence-in-depth check inside the route.
      expect((await response.json()).decisionId, `${role} ${method} ${path} was refused by the catalog`).toEqual(expect.any(String));
      expect(fixture.pool.calls, `${role} ${method} ${path} reached the pool`).toBe(before);
      continue;
    }
    await response.arrayBuffer();
  }
  const upload = await fixture.call('/editor/media?kind=video', 'alice', 'POST');
  const uploads = grants.includes('editor.view') && (grants.includes('editor.create') || grants.includes('editor.change'));
  expect(upload.status, `${role} upload`).toBe(uploads ? 400 : 403);
  if (grants.includes('editor.view')) {
    const reported = (await (await fixture.call('/editor/permissions')).json()).permissions;
    expect(reported).toEqual(Object.fromEntries(['view', 'read', 'create', 'change', 'delete', 'export'].map(action => [action, grants.includes(`editor.${action}`)])));
  }
  if (!grants.some(permission => permission.startsWith('studio.') || permission === 'pump.manage')) {
    expect(forbidden, `${role} reached a studio collaborator`).not.toHaveBeenCalled();
  }
});

it('refuses unbound paths, legacy app-admin, a colliding issuer and a revoked grant before package code', async () => {
  await fixture.change('admin');
  expect((await fixture.call('/editor/secret')).status).toBe(403);
  expect((await fixture.call('/editor/projects', 'collision')).status).toBe(403);
  expect((await fixture.call('/editor/projects', '')).status).toBe(401);
  await fixture.change('admin', 'alice', 'revoke');
  expect((await fixture.call('/editor/projects')).status).toBe(403);
  expect((await fixture.call('/ui')).status).toBe(403);
  await fixture.change('admin');
  await fixture.store.transaction(async ({ state }) => {
    const row = state.assignments.find(entry => entry.app === 'video' && entry.role === 'admin')!;
    row.role = '@app-admin';
  });
  for (const [method, path] of ENDPOINTS) expect((await fixture.call(path, 'alice', method)).status, `legacy ${method} ${path}`).toBe(403);
  expect(fixture.pool.calls).toBe(0);
});

it('the catalog binds every manifest route mount and declares both own-scoped resources', () => {
  const catalog = yaml.load(readFileSync(join(PACKAGE, 'authorization.yaml'), 'utf8')) as { resources: Record<string, { scopes: string[] }>;
    permissions: Record<string, unknown>; bindings: { http: Array<{ method: string; path: string }> } };
  expect(Object.keys(catalog.resources).sort()).toEqual(['editor', 'studio']);
  expect(Object.values(catalog.resources).every(resource => resource.scopes.join() === 'own')).toBe(true);
  expect(Object.keys(catalog.permissions).sort()).toEqual([...ALL].sort());
  const bound = new Set(catalog.bindings.http.map(binding => `${binding.method} ${binding.path}`));
  expect(bound.has('GET /')).toBe(true);
  expect(fixture.manifest.routes?.map(route => route.module).sort()).toEqual(['routes/home-summary.js', 'routes/package-smoke.js',
    'routes/video-editor-routes.js', 'routes/video-pump-routes.js', 'routes/video-routes.js']);
});
