/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Serve exact experience assets through real package authorization on a disposable source audit host.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Confine source and required-member fixture copies before any package code is loaded.
 */
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import express, { type Request, type RequestHandler } from 'express';
import { ApplicationAuthorizationService, MemoryAuthorizationStore } from '@/features/application-authorization';
import { ApplicationAuthorizationRuntime } from '@/app/composition/application-authorization-runtime';
import { ManifestRouteMounterImpl } from '@/app/composition/manifest-route-mounter';
import { createUiProfileRoutes } from '@/app/routes/ui-profile-routes';
import { createSwarmAppRoutes } from '@/app/routes/swarm-app-routes';
import { UIProfileService } from '@/features/ui-profile';
import { SwarmAppService, type SwarmAppManifest, type SwarmApplicationRecord } from '@/features/swarm-apps';
import type { AuthorizationActor } from '@/shared/application-authorization';
import type { AppContext } from '@/app/composition/app-context';

const [source, workspace, framework] = process.argv.slice(2).map(path => resolve(path));
assert.ok(source && workspace && framework, 'Source, disposable workspace and core are required');
const yaml = require(join(framework, 'node_modules/js-yaml'));
const manifest = yaml.load(readFileSync(join(source, 'oshal-app.yaml'), 'utf8'));
assert.equal(manifest.name, basename(source), 'Source identity must match its owned package directory');
assert.equal(manifest.experience?.version, 1, 'Only declared version-one experiences use this audit host');
const issuer = 'https://surface-audit.fixture.invalid';
const admin: AuthorizationActor = { sub: 'surface-audit-admin', issuer, isActive: true, isSwarmAdmin: true };
const viewer: AuthorizationActor = { sub: 'surface-audit-viewer', issuer, isActive: true, isSwarmAdmin: false };
const store = new MemoryAuthorizationStore();
const policy = new ApplicationAuthorizationService(store, { resolveActor: async (sub, who) => [admin, viewer].find(actor => actor.sub === sub && actor.issuer === who) ?? null });
const records = new Map<string, SwarmApplicationRecord>();
const repo = {
  findByName: async (name: string) => records.get(name) ?? null,
  list: async () => [...records.values()],
  upsert: async (item: SwarmAppManifest, file: string) => {
    const row = { appId: randomUUID(), name: item.name, displayName: item.displayName, description: item.description || '', version: item.version || '1',
      status: item.status || 'active', manifestPath: file, agentIds: [], toolNames: [], manifest: item, scope: 'public', ownerSub: null, tenantId: null,
      guestTierApproved: null, loadedAt: new Date(), updatedAt: new Date() } as SwarmApplicationRecord;
    records.set(row.name, row); return row;
  },
  updateStatus: async (name: string, status: 'active' | 'inactive') => { const row = records.get(name); if (!row) return null; row.status = status; return row; },
  delete: async (name: string) => records.delete(name),
};

function resolveActor(req: Request): Promise<AuthorizationActor> {
  if (!/(?:^|;\s*)oshal_guest=package-audit(?:;|$)/.test(req.get('cookie') || '')) {
    return Promise.reject(Object.assign(new Error('Authentication required'), { status: 401 }));
  }
  return Promise.resolve(structuredClone(viewer));
}
const auth: RequestHandler = (req, res, next) => {
  void resolveActor(req).then(actor => {
    Object.assign(req, { oidc: { user: { sub: actor.sub }, isAuthenticated: () => true } }); next();
  }, () => res.status(401).json({ error: 'authentication_required' }));
};
const runtime = new ApplicationAuthorizationRuntime(policy, resolveActor, { OSHAL_APPLICATION_AUTHORIZATION_MODE: 'enforce' }, repo.findByName);
const app = express(), pool = { query: async () => ({ rows: [], rowCount: 0 }) };
const mounter = new ManifestRouteMounterImpl(app, auth, { pool } as unknown as AppContext, undefined, runtime);
const apps = new SwarmAppService(pool as never, repo as never, { updateAgentStatus: async () => undefined } as never,
  undefined, undefined, undefined, mounter, undefined, undefined, undefined, undefined, runtime);

/**
 * @description Confine every generated package directory to the audit workspace.
 * @param name Bounded package identity admitted to the disposable fixture.
 * @returns Absolute package directory inside the fixture workspace.
 */
function packagePath(name: string): string {
  assert.match(name, /^[a-z0-9][a-z0-9-]{0,63}$/, 'Fixture package identity must be a bounded slug');
  return join(workspace, name);
}

async function loadRequiredMembers(): Promise<void> {
  for (const name of manifest.dependencies.required.apps) {
    const memberRoot = packagePath(name); mkdirSync(memberRoot, { recursive: true });
    const surfaces = manifest.experience.surfaces.filter((ref: { app: string }) => ref.app === name);
    const fixture: Record<string, unknown> = { name, displayName: 'Synthetic ' + name, version: '1.0.0', status: 'active', chatBot: 'general-bot',
      ui: { static: surfaces.map((ref: { surface: string }) => ({ toolName: ref.surface, label: 'Synthetic ' + ref.surface, icon: 'codicon codicon-home', iframeUrl: '/fixture/surface/' + ref.surface, section: 'top' })) } };
    const catalog = join(source, '..', name, 'authorization.yaml');
    if (manifest.experience.roleTemplates[0].members.some((member: { app: string; role: string }) => member.app === name && member.role !== '@app-admin')) {
      cpSync(catalog, join(memberRoot, 'authorization.yaml'));
      fixture.authorization = { version: 1, catalog: 'authorization.yaml' }; fixture.uses = ['application-authorization'];
    }
    writeFileSync(join(memberRoot, 'oshal-app.yaml'), yaml.dump(fixture));
    await apps.loadApp(join(memberRoot, 'oshal-app.yaml'));
  }
}

async function assignReviewedRole(): Promise<string> {
  assert.equal((await store.read()).assignments.length, 0, 'Installation grants nobody');
  const review = await policy.previewCompositeRole(admin, { action: 'assign', app: manifest.name, template: manifest.experience.roleTemplates[0].id,
    targetSub: viewer.sub, targetIssuer: issuer, reason: 'Disposable source surface audit', expectedRevision: (await store.read()).revision });
  assert.equal(review.ready, true, 'Fixture role requires a successful current policy review');
  const receipt = await policy.applyCompositeRole(admin, { previewId: review.previewId!, idempotencyKey: randomUUID() });
  return receipt.assignmentId;
}

async function main(): Promise<void> {
  process.env.APP_PACKAGE_DYNAMIC_ROUTES = 'true'; process.env.APP_PACKAGE_MIGRATIONS = 'false';
  process.env.OSHAL_APPLICATION_AUTHORIZATION_MODE = 'enforce'; process.env.APP_ACCESS_ENFORCEMENT = 'enforce';
  await loadRequiredMembers();
  const packageRoot = packagePath(manifest.name); cpSync(source, packageRoot, { recursive: true });
  await apps.loadApp(join(packageRoot, 'oshal-app.yaml'));
  const assignment = await assignReviewedRole();
  app.use('/api/ui', auth, createUiProfileRoutes(new UIProfileService(), apps, { runtime, resolveActor }));
  app.use('/api/swarm/apps', auth, createSwarmAppRoutes(apps, undefined, { authorization: { canDiscover: (name, actor) => runtime.canDiscover(name, actor), resolveActor } }));
  const previousCwd = process.cwd(); process.chdir(framework);
  const { startExperienceBrowserFixture, installFrontPageHosts } = require(join(framework, 'tests/fixtures/experience-browser.ts'));
  process.chdir(previousCwd);
  const fixture = await startExperienceBrowserFixture(); installFrontPageHosts(fixture.state);
  app.use(auth, async (req, res) => {
    if (!['GET', 'HEAD'].includes(req.method)) { res.status(405).end(); return; }
    try {
      const response = await fetch(fixture.origin + req.originalUrl, { redirect: 'manual' });
      res.status(response.status); response.headers.forEach((value, key) => { if (!['connection', 'transfer-encoding', 'content-length', 'content-encoding'].includes(key)) res.setHeader(key, value); });
      res.send(Buffer.from(await response.arrayBuffer()));
    } catch { res.status(502).json({ error: 'fixture_unavailable' }); }
  });
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(done => server.once('listening', done));
  const close = async () => {
    server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); await fixture.close();
    const review = await policy.previewCompositeRole(admin, { action: 'revoke', app: manifest.name, assignmentId: assignment,
      reason: 'Disposable audit cleanup', expectedRevision: (await store.read()).revision });
    await policy.applyCompositeRole(admin, { previewId: review.previewId!, idempotencyKey: randomUUID() });
    assert.equal((await store.read()).assignments.length, 0); process.exit(0);
  };
  process.once('SIGTERM', () => { void close(); }); process.once('SIGINT', () => { void close(); });
  process.once('message', message => { if ((message as { action?: string }).action === 'close') void close(); });
  process.stdout.write(JSON.stringify({ baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }) + '\n');
}
void main().catch(error => { process.stderr.write(String(error?.stack || error) + '\n'); process.exit(1); });
