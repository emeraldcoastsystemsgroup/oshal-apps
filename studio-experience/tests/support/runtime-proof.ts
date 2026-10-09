/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Load the actual experience package through existing host, authorization and route machinery on an isolated loopback fixture.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Verify service readiness through actual mounted policy and secret gates.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Provision every component and ordinary authoring role for a fresh synthetic user; verify owner refusals and expiry without touching providers or real memberships.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express, { type Request, type RequestHandler } from 'express';
import { ApplicationAuthorizationService, MemoryAuthorizationStore } from '@/features/application-authorization';
import { ApplicationAuthorizationRuntime } from '@/app/composition/application-authorization-runtime';
import { ManifestRouteMounterImpl } from '@/app/composition/manifest-route-mounter';
import { createUiProfileRoutes } from '@/app/routes/ui-profile-routes';
import { UIProfileService } from '@/features/ui-profile';
import { SwarmAppService, type SwarmAppManifest, type SwarmApplicationRecord } from '@/features/swarm-apps';
import type { AuthorizationActor } from '@/shared/application-authorization';
import type { AppContext } from '@/app/composition/app-context';

const framework = resolve(process.env.OSHAL_FRAMEWORK || '');
const packageName = process.env.OSHAL_EXPERIENCE_PROOF_PACKAGE!;
assert.match(packageName, /^(home|business|classroom|studio|jarvis|orbit|commons)-experience$/);
const original = resolve(__dirname, '../..');
const yaml = require(resolve(framework, 'node_modules/js-yaml'));
const manifest = yaml.load(require('node:fs').readFileSync(join(original, 'oshal-app.yaml'), 'utf8'));
const template = manifest.experience.roleTemplates[0];
const issuer = 'https://experience.fixture.invalid';
const admin: AuthorizationActor = { sub: 'synthetic-admin', issuer, isActive: true, isSwarmAdmin: true };
const resident: AuthorizationActor = { sub: 'synthetic-resident', issuer, isActive: true, isSwarmAdmin: false };
const outsider: AuthorizationActor = { sub: 'synthetic-outsider', issuer, isActive: true, isSwarmAdmin: false };
const actors = [admin, resident, outsider];
let directory: string, server: Server, base: string, policy: ApplicationAuthorizationService, store: MemoryAuthorizationStore;
let fixtureTime = Date.now();
const saved = new Map<string, string | undefined>();
function environment(name: string, value: string) { saved.set(name, process.env[name]); process.env[name] = value; }
/** Fixture members retain real public catalog bytes and dependency facts, without loading handlers or providers.
 * The private CRM and required child contracts are explicitly doubled; live/private acceptance is a separate check. */
function memberContract(name: string): { manifest: Record<string, any>; catalog: Record<string, any> | null } {
  if (name === 'private-app-1') {
    const grants = ['app.open', 'crm.me.read', 'crm.contacts.read', 'crm.contacts.create'].map(permission => ({ permission, scope: 'own' }));
    return { manifest: { name, dependencies: { required: { apps: ['private-app-2', 'intelligent-sales', 'private-app-3'], tools: [], connectors: [] }, optional: { apps: [], tools: [], connectors: [] } } },
      catalog: { version: 1, resources: { portfolio: { scopes: ['own'] } },
        permissions: Object.fromEntries(grants.map(({ permission }) => [permission, { resource: 'portfolio', effect: permission.endsWith('.create') ? 'write' : 'read', minimumTier: permission.endsWith('.create') ? 'editor' : 'viewer' }])),
        roles: { crm_representative: { tier: 'editor', grants } }, bindings: { http: [{ id: 'summary', method: 'GET', path: '/summary', allOf: ['app.open'] }] } } };
  }
  if (['private-app-2', 'intelligent-sales', 'private-app-3'].includes(name)) {
    const dependencies = { required: { apps: name === 'private-app-3' ? ['private-app-2'] : [], tools: [], connectors: [] }, optional: { apps: [], tools: [], connectors: [] } };
    if (name === 'private-app-2') return { manifest: { name, dependencies }, catalog: null };
    const role = name === 'intelligent-sales' ? 'sales_manager' : 'administrator', tier = name === 'intelligent-sales' ? 'editor' : 'admin';
    const permission = name === 'intelligent-sales' ? 'sales.boards.work' : 'formation.update';
    return { manifest: { name, dependencies }, catalog: { version: 1, resources: { records: { scopes: ['own'] } },
      permissions: { [permission]: { resource: 'records', effect: 'write', minimumTier: tier } },
      roles: { [role]: { tier, grants: [{ permission, scope: 'own' }] } },
      bindings: { http: [{ id: 'owned-write', method: 'POST', path: '/owned', allOf: [permission] }] } } };
  }
  const file = ['jarvis', 'workflow-studio'].includes(name) ? join(framework, 'swarm-apps', name + '.yaml') : join(original, '..', name, 'oshal-app.yaml');
  const component = yaml.load(readFileSync(file, 'utf8'));
  return { manifest: component, catalog: component.authorization ? yaml.load(readFileSync(join(resolve(file, '..'), component.authorization.catalog), 'utf8')) : null };
}
async function loadMemberContracts(apps: SwarmAppService): Promise<void> {
  for (const name of manifest.dependencies.required.apps) {
    const memberRoot = join(directory, name); mkdirSync(memberRoot);
    const contract = memberContract(name), fixture: Record<string, unknown> = { name, displayName: 'Synthetic ' + name, version: '1.0.0', status: 'active', chatBot: 'general-bot', uses: ['app-dependencies'],
      dependencies: contract.manifest.dependencies || { required: { apps: [], tools: [], connectors: [] }, optional: { apps: [], tools: [], connectors: [] } } };
    if (contract.catalog) {
      fixture.authorization = { version: 1, catalog: 'authorization.yaml' }; fixture.uses = ['app-dependencies', 'application-authorization'];
      writeFileSync(join(memberRoot, 'authorization.yaml'), yaml.dump(contract.catalog));
    }
    const file = join(memberRoot, ['jarvis', 'workflow-studio'].includes(name) ? name + '.yaml' : 'oshal-app.yaml');
    writeFileSync(file, yaml.dump(fixture)); await apps.loadApp(file);
    for (const resource of Object.keys(contract.catalog?.resources || {})) policy.registerResourceAdapter(name, resource, {
      authorize: async ({ actor, operation, grant }) => grant.scope === 'own' && operation.resourceId === actor.sub,
    });
  }
}

before(async () => {
  assert.ok(process.env.OSHAL_FRAMEWORK, 'Explicit framework checkout is required');
  environment('SWARM_SERVICE_SECRET', 'synthetic-experience-service-secret');
  environment('APP_PACKAGE_DYNAMIC_ROUTES', 'true'); environment('APP_PACKAGE_MIGRATIONS', 'false');
  environment('OSHAL_APPLICATION_AUTHORIZATION_MODE', 'enforce'); environment('APP_ACCESS_ENFORCEMENT', 'enforce');
  mkdirSync(join(framework, 'temp'), { recursive: true });
  directory = mkdtempSync(join(framework, 'temp', 'home-experience-proof-'));
  const home = join(directory, packageName); cpSync(original, home, { recursive: true });
  const records = new Map<string, SwarmApplicationRecord>();
  const repo = {
    findByName: async (name: string) => records.get(name) ?? null,
    list: async (status?: string) => [...records.values()].filter(row => !status || row.status === status),
    upsert: async (manifest: SwarmAppManifest, file: string) => {
      const row = { appId: randomUUID(), name: manifest.name, displayName: manifest.displayName, description: manifest.description || '', version: manifest.version || '1',
        status: manifest.status || 'active', manifestPath: file, agentIds: [], toolNames: [], manifest, scope: 'public', ownerSub: null, tenantId: null,
        guestTierApproved: null, loadedAt: new Date(), updatedAt: new Date() } as SwarmApplicationRecord;
      records.set(row.name, row); return row;
    },
    updateStatus: async (name: string, status: 'active' | 'inactive') => { const row = records.get(name); if (!row) return null; row.status = status; return row; },
    delete: async (name: string) => records.delete(name),
  };
  const resolveActor = async (req: Request) => { const actor = actors.find(row => row.sub === req.get('x-fixture-user')); if (!actor) throw Object.assign(new Error('Authentication required'), { status: 401 }); return structuredClone(actor); };
  const auth: RequestHandler = (req, res, next) => { if (actors.some(row => row.sub === req.get('x-fixture-user'))) next(); else res.status(401).json({ error: 'authentication_required' }); };
  store = new MemoryAuthorizationStore(); policy = new ApplicationAuthorizationService(store, { now: () => fixtureTime, resolveActor: async (sub, who) => actors.find(row => row.sub === sub && row.issuer === who) ?? null });
  const runtime = new ApplicationAuthorizationRuntime(policy, resolveActor, { OSHAL_APPLICATION_AUTHORIZATION_MODE: 'enforce' }, repo.findByName);
  const app = express(), pool = { query: async () => ({ rows: [], rowCount: 0 }) };
  const mounter = new ManifestRouteMounterImpl(app, auth, { pool } as unknown as AppContext, undefined, runtime);
  const apps = new SwarmAppService(pool as never, repo as never, { updateAgentStatus: async () => undefined } as never,
    undefined, undefined, undefined, mounter, undefined, undefined, undefined, undefined, runtime);
  await loadMemberContracts(apps);
  await apps.loadApp(join(home, 'oshal-app.yaml'));
  app.use('/api/ui', auth, createUiProfileRoutes(new UIProfileService(), apps, { runtime, resolveActor }));
  server = app.listen(0, '127.0.0.1'); await new Promise<void>(done => server.once('listening', done));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  server?.closeAllConnections(); if (server) await new Promise<void>(done => server.close(() => done()));
  for (const [name, value] of saved) if (value === undefined) delete process.env[name]; else process.env[name] = value;
  if (directory) { const within = relative(join(framework, 'temp'), directory); assert.ok(within && !within.startsWith('..')); rmSync(directory, { recursive: true, force: true }); }
});
const get = (path: string, actor?: AuthorizationActor) => fetch(base + path, { redirect: 'manual', headers: actor ? { 'x-fixture-user': actor.sub } : {} });
/** @description Call actual readiness with independent synthetic identity and service secret.
 * @param actor Authenticated fixture actor, omitted for an identity refusal.
 * @param secret Fixture credential, empty or incorrect for secret refusals. @param method Exact HTTP verb.
 * @returns The actual mounted HTTP response. */
const smoke = (actor?: AuthorizationActor, secret = 'synthetic-experience-service-secret', method = 'GET') => fetch(base + '/api/' + packageName + '/_smoke', { method, headers: { ...(actor ? { 'x-fixture-user': actor.sub } : {}), ...(secret ? { 'x-service-secret': secret } : {}) } });

test('no installation grant; anonymous and unrelated direct entries refuse', async () => {
  assert.equal((await store.read()).assignments.length, 0);
  assert.equal((await get('/api/'+packageName+'/app')).status, 401);
  assert.equal((await get('/api/'+packageName+'/app', outsider)).status, 403);
  assert.equal((await get('/api/ui/experiences/'+packageName+'/open', outsider)).status, 404);
});
test('exact reviewed experience roles open the actual package, and revocation closes direct entry', async () => {
  const review = await policy.previewCompositeRole(admin, { action: 'assign', app: packageName, template: template.id, targetSub: resident.sub, targetIssuer: issuer,
    reason: 'Synthetic owned package proof', expectedRevision: (await store.read()).revision });
  assert.equal(review.ready, true); assert.deepEqual(review.members.map(row => ({ app: row.app, role: row.role })), template.members);
  assert.equal((await store.read()).assignments.length, 0);
  const receipt = await policy.applyCompositeRole(admin, { previewId: review.previewId!, idempotencyKey: randomUUID() });
  assert.equal((await store.read()).assignments.length, template.members.length);
  for (const name of manifest.dependencies.required.apps) {
    const expected = template.members.filter((member: { app: string }) => member.app === name).map((member: { role: string }) => member.role).sort();
    const access = await policy.effective(admin, { app: name, targetSub: resident.sub, targetIssuer: issuer });
    assert.equal(access.denied, false, name); assert.deepEqual(access.roles.slice().sort(), expected, name);
    assert.deepEqual(access.managementRoles, [], name);
  }
  for (const [app, permission] of [['create', 'project.create'], ['create', 'project.change'], ['create', 'project.export'], ['create', 'project.generate'],
    ['portrait-studio', 'portrait.create'], ['portrait-studio', 'portrait.email'], ['video', 'studio.generate'], ['video', 'editor.create'], ['video', 'editor.change'], ['video', 'editor.export'], ['little-monsters', 'tutor.execute'], ['intelligent-sales', 'sales.boards.work'], ['private-app-3', 'formation.update']]) {
    assert.equal((await policy.authorize(resident, { app, permission, resourceId: resident.sub })).allowed, true, app + ':' + permission);
    assert.equal((await policy.authorize(resident, { app, permission, resourceId: outsider.sub })).allowed, false, app + ': foreign record');
    assert.equal((await policy.authorize(outsider, { app, permission, resourceId: outsider.sub })).allowed, false, app + ': unassigned actor');
  }
  assert.equal(resident.isSwarmAdmin, false);
  assert.equal((await get('/api/ui/experiences/'+packageName+'/open', resident)).status, 302);
  const entry = await get('/api/'+packageName+'/app', resident); assert.equal(entry.status, 200); assert.ok((await entry.text()).includes('data-experience-app="'+packageName+'"'));
  assert.equal((await get('/api/'+packageName+'/assets/config.js', resident)).status, 200);
  assert.equal((await smoke(resident)).status, 200);
  assert.equal((await smoke(resident, undefined, 'HEAD')).status, 200);
  assert.equal((await smoke()).status, 401);
  assert.equal((await smoke(resident, '')).status, 401);
  assert.equal((await smoke(resident, 'synthetic-wrong-secret')).status, 401);
  assert.equal((await smoke(outsider)).status, 403);
  assert.equal((await smoke(resident, undefined, 'POST')).status, 403);
  assert.equal((await get('/api/'+packageName+'/assets/config.js', outsider)).status, 403);
  assert.equal((await get('/api/'+packageName+'/private-not-declared', resident)).status, 403);
  const revoke = await policy.previewCompositeRole(admin, { action: 'revoke', app: packageName, assignmentId: receipt.assignmentId,
    reason: 'Synthetic owned source cleanup', expectedRevision: (await store.read()).revision });
  await policy.applyCompositeRole(admin, { previewId: revoke.previewId!, idempotencyKey: randomUUID() });
  assert.equal((await get('/api/'+packageName+'/app', resident)).status, 403); assert.equal((await store.read()).assignments.length, 0);
  assert.equal((await smoke(resident)).status, 403);
});


test('one expiration closes every enforced product grant without changing the principal or records', async () => {
  const expiresAt = new Date(fixtureTime + 60_000).toISOString();
  const review = await policy.previewCompositeRole(admin, { action: 'assign', app: packageName, template: template.id, targetSub: resident.sub, targetIssuer: issuer,
    expiresAt, reason: 'Synthetic complete product expiry proof', expectedRevision: (await store.read()).revision });
  assert.equal(review.ready, true);
  const receipt = await policy.applyCompositeRole(admin, { previewId: review.previewId!, idempotencyKey: randomUUID() });
  assert.ok((await store.read()).assignments.every(row => row.expiresAt === expiresAt));
  fixtureTime += 60_001;
  assert.equal((await get('/api/' + packageName + '/app', resident)).status, 403);
  for (const app of manifest.dependencies.required.apps) {
    const access = await policy.effective(admin, { app, targetSub: resident.sub, targetIssuer: issuer });
    assert.equal(access.tier, 'deny', app); assert.deepEqual(access.permissions, [], app);
  }
  assert.equal(resident.isActive, true); assert.equal(resident.isSwarmAdmin, false);
  const revoke = await policy.previewCompositeRole(admin, { action: 'revoke', app: packageName, assignmentId: receipt.assignmentId,
    reason: 'Synthetic expired product cleanup', expectedRevision: (await store.read()).revision });
  await policy.applyCompositeRole(admin, { previewId: revoke.previewId!, idempotencyKey: randomUUID() });
  assert.equal((await store.read()).assignments.length, 0);
});
