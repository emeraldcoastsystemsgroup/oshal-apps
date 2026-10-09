/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Load the actual experience package through existing host, authorization and route machinery on an isolated loopback fixture.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Verify all Business CRM selections against a synthetic catalog matching the reviewed own-read role contract.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Verify readiness through mounted service-secret and exact member authorization, including revocation.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Prove all included components and the ordinary CRM authoring contract from one fresh-principal application role.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
const saved = new Map<string, string | undefined>();
function environment(name: string, value: string) { saved.set(name, process.env[name]); process.env[name] = value; }
async function loadSyntheticCrm(apps: SwarmAppService, directory: string) {
  const crmRoot = join(directory, 'private-app-1'); mkdirSync(crmRoot);
  const reads = ['app.open', 'organizations.read', 'contacts.read', 'opportunities.read', 'contracts.read', 'obligations.read', 'crm.me.read', 'crm.meta.read'];
  const writes = ['opportunities.create', 'crm.partners.create', 'crm.partners.update', 'crm.reports.create', 'crm.import.batches.create'];
  const permissions = Object.fromEntries([
    ...reads.map(permission => [permission, { resource: 'portfolio', effect: 'read', minimumTier: 'viewer' }]),
    ...writes.map(permission => [permission, { resource: 'portfolio', effect: 'write', minimumTier: 'editor' }]),
    ['crm.admin.permissions.update', { resource: 'portfolio', effect: 'administer', minimumTier: 'admin' }],
  ]);
  // Representative contract facts only; no private package, records or provider code is copied.
  const crmCatalog = { version: 1, resources: { portfolio: { scopes: ['own'] } }, permissions,
    roles: { crm_representative: { tier: 'editor', grants: [...reads, ...writes].map(permission => ({ permission, scope: 'own' })) } },
    bindings: { http: [{ id: 'summary', method: 'GET', path: '/summary', allOf: ['app.open'] }] } };
  writeFileSync(join(crmRoot, 'authorization.yaml'), yaml.dump(crmCatalog));
  writeFileSync(join(crmRoot, 'oshal-app.yaml'), yaml.dump({ name: 'private-app-1', displayName: 'Synthetic CRM contract', version: '1.0.0', status: 'active',
    ui: { static: [{ toolName: 'federal-home', label: 'Synthetic CRM home', icon: 'codicon codicon-home', iframeUrl: '/fixture/federal-home', section: 'top' }] },
    chatBot: 'general-bot', dependencies: { apps: ['private-app-2', 'intelligent-sales', 'private-app-3'], tools: [], connectors: [] }, uses: ['application-authorization'], authorization: { version: 1, catalog: 'authorization.yaml' } }));
  await apps.loadApp(join(crmRoot, 'oshal-app.yaml'));
  policy.registerResourceAdapter('private-app-1', 'portfolio', {
    authorize: async ({ actor, operation, grant }) => grant.scope === 'own' && operation.resourceId === actor.sub,
  });
}
/** Load synthetic transport/records with the public component's actual role and required-dependency declaration. */
async function loadRequiredComponent(apps: SwarmAppService, name: string): Promise<void> {
  const memberRoot = join(directory, name); mkdirSync(memberRoot);
  const sourceRoot = resolve(original, '..', name);
  const component = yaml.load(readFileSync(join(sourceRoot, 'oshal-app.yaml'), 'utf8'));
  const surfaces = manifest.experience.surfaces.filter((ref: { app: string }) => ref.app === name);
  const fixture: Record<string, unknown> = { name, displayName: 'Synthetic ' + name, version: '1.0.0', status: 'active',
    chatBot: 'general-bot', dependencies: component.dependencies, uses: component.uses,
    ui: { static: surfaces.map((ref: { surface: string }) => ({ toolName: ref.surface, label: 'Synthetic ' + ref.surface,
      icon: 'codicon codicon-home', iframeUrl: '/fixture/' + ref.surface, section: 'top' })) } };
  if (component.authorization) {
    fixture.authorization = component.authorization;
    cpSync(join(sourceRoot, component.authorization.catalog), join(memberRoot, component.authorization.catalog));
  }
  writeFileSync(join(memberRoot, 'oshal-app.yaml'), yaml.dump(fixture));
  await apps.loadApp(join(memberRoot, 'oshal-app.yaml'));
  if (component.authorization) {
    const catalog = yaml.load(readFileSync(join(memberRoot, component.authorization.catalog), 'utf8'));
    for (const resource of Object.keys(catalog.resources)) {
      // Only synthetic own-record boundaries: these are role coverage proofs, not component business-record acceptance.
      policy.registerResourceAdapter(name, resource, { authorize: async ({ actor, grant, operation }) =>
        grant.scope === 'own' && (!operation.resourceId || operation.resourceId === actor.sub) });
    }
  }
}
/** Explicit reviewed private contract facts only; no private catalog, UI, runtime or record is copied. */
async function loadSyntheticPrivateComponent(apps: SwarmAppService, name: string): Promise<void> {
  const root = join(directory, name); mkdirSync(root);
  const fixture: Record<string, unknown> = { name, displayName: 'Synthetic ' + name, version: '1.0.0', status: 'active', chatBot: 'general-bot',
    dependencies: { apps: name === 'private-app-3' ? ['private-app-2'] : [], tools: [], connectors: [] } };
  if (name !== 'private-app-2') {
    const sales = name === 'intelligent-sales';
    const names = sales ? ['sales.boards.work', 'sales.leads.import', 'sales.export.all'] : ['app.open', 'capture.advance', 'formation.update'];
    const tier = sales ? 'editor' : 'admin';
    const role = sales ? 'sales_manager' : 'administrator';
    const catalog = { version: 1, resources: { ownRecords: { scopes: ['own'] } },
      permissions: Object.fromEntries(names.map(permission => [permission, { resource: 'ownRecords', effect: permission === 'app.open' ? 'read' : 'write', minimumTier: tier }])),
      roles: { [role]: { tier, grants: names.map(permission => ({ permission, scope: 'own' })) } },
      bindings: { http: [{ id: 'entry', method: 'GET', path: '/app', allOf: [names[0]] }] } };
    fixture.authorization = { version: 1, catalog: 'authorization.yaml' }; fixture.uses = ['application-authorization'];
    writeFileSync(join(root, 'authorization.yaml'), yaml.dump(catalog));
  }
  writeFileSync(join(root, 'oshal-app.yaml'), yaml.dump(fixture));
  await apps.loadApp(join(root, 'oshal-app.yaml'));
  if (name !== 'private-app-2') policy.registerResourceAdapter(name, 'ownRecords', {
    authorize: async ({ actor, grant, operation }) => grant.scope === 'own' && (!operation.resourceId || operation.resourceId === actor.sub),
  });
}
/** Sales binds entry to its existing sales.boards.work permission, not an invented app.open declaration. */
const entryPermission = (app: string) => app === 'intelligent-sales' ? 'sales.boards.work' : 'app.open';
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
  store = new MemoryAuthorizationStore(); policy = new ApplicationAuthorizationService(store, { resolveActor: async (sub, who) => actors.find(row => row.sub === sub && row.issuer === who) ?? null });
  const runtime = new ApplicationAuthorizationRuntime(policy, resolveActor, { OSHAL_APPLICATION_AUTHORIZATION_MODE: 'enforce' }, repo.findByName);
  const app = express(), pool = { query: async () => ({ rows: [], rowCount: 0 }) };
  const mounter = new ManifestRouteMounterImpl(app, auth, { pool } as unknown as AppContext, undefined, runtime);
  const apps = new SwarmAppService(pool as never, repo as never, { updateAgentStatus: async () => undefined } as never,
    undefined, undefined, undefined, mounter, undefined, undefined, undefined, undefined, runtime);
  for (const name of manifest.dependencies.required.apps) {
    if (name === 'private-app-1') await loadSyntheticCrm(apps, directory);
    else if (['private-app-2', 'intelligent-sales', 'private-app-3'].includes(name)) await loadSyntheticPrivateComponent(apps, name);
    else await loadRequiredComponent(apps, name);
  }
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
  assert.equal(review.ready, true); assert.deepEqual(review.members.map(row => row.app), [packageName, ...manifest.dependencies.required.apps]);
  const receipt = await policy.applyCompositeRole(admin, { previewId: review.previewId!, idempotencyKey: randomUUID() });
  for (const member of template.members) {
    assert.equal((await policy.authorize(resident, { app: member.app, permission: entryPermission(member.app), resourceId: resident.sub })).allowed, true, member.app);
    const access = await policy.effective(resident, { app: member.app });
    assert.ok(access.roles.includes(member.role), member.app + ':' + member.role);
    assert.deepEqual(access.managementRoles, [], member.app + ' cannot grant portal/Access management');
  }

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
  for (const member of template.members) assert.equal((await policy.authorize(resident, { app: member.app, permission: entryPermission(member.app), resourceId: resident.sub })).allowed, false, member.app);
  assert.equal((await get('/api/'+packageName+'/app', resident)).status, 403); assert.equal((await store.read()).assignments.length, 0);
  assert.equal((await smoke(resident)).status, 403);
});

test('all Business roles include ordinary CRM authoring and refuse a legacy adapter or administrative authority', async () => {
  for (const selected of manifest.experience.roleTemplates) {
    const input = { action: 'assign' as const, app: packageName, template: selected.id,
      targetSub: resident.sub, targetIssuer: issuer, reason: 'Synthetic CRM own-record authoring contract', expectedRevision: (await store.read()).revision };
    const review = await policy.previewCompositeRole(admin, input);
    assert.equal(review.ready, true);
    const member = review.members.find(row => row.app === 'private-app-1')!;
    assert.equal(member.role, 'crm_representative'); assert.equal(member.tier, 'editor');
    const permissions = member.permissions?.map(grant => grant.permission) ?? [];
    for (const permission of ['app.open', 'crm.meta.read', 'opportunities.create', 'crm.partners.create', 'crm.partners.update', 'crm.reports.create', 'crm.import.batches.create']) {
      assert.ok(permissions.includes(permission), permission);
    }
    assert.ok(member.permissions?.every(grant => grant.scope === 'own'));
    const receipt = await policy.applyCompositeRole(admin, { previewId: review.previewId!, idempotencyKey: randomUUID() });
    assert.equal((await policy.authorize(resident, { app: 'private-app-1', permission: 'app.open', resourceId: resident.sub })).allowed, true);
    assert.equal((await policy.authorize(resident, { app: 'private-app-1', permission: 'app.open', resourceId: outsider.sub })).allowed, false);
    for (const permission of ['opportunities.create', 'crm.partners.create', 'crm.partners.update', 'crm.reports.create', 'crm.import.batches.create']) {
      assert.equal((await policy.authorize(resident, { app: 'private-app-1', permission, resourceId: resident.sub })).allowed, true, permission);
      assert.equal((await policy.authorize(resident, { app: 'private-app-1', permission, resourceId: outsider.sub })).allowed, false, permission);
    }
    assert.equal((await policy.authorize(resident, { app: 'private-app-1', permission: 'crm.admin.permissions.update', resourceId: resident.sub })).allowed, false);
    const revoke = await policy.previewCompositeRole(admin, { action: 'revoke', app: packageName, assignmentId: receipt.assignmentId,
      reason: 'Synthetic CRM cleanup', expectedRevision: (await store.read()).revision });
    await policy.applyCompositeRole(admin, { previewId: revoke.previewId!, idempotencyKey: randomUUID() });
    assert.equal((await store.read()).assignments.length, 0);
  }
  const ownCatalog = yaml.load(require('node:fs').readFileSync(join(original, 'authorization.yaml'), 'utf8'));
  await policy.registerApp({ app: 'synthetic-mutant-experience', source: 'synthetic-mutant-source', version: '1.0.0', catalog: ownCatalog, mode: 'enforce',
    compositeRoles: { templates: [{ id: 'mutant', version: 1, label: 'Synthetic mutant', members: [
      { app: 'synthetic-mutant-experience', role: 'staff' }, { app: 'private-app-1', role: '@app-admin' }] }],
      requiredApps: ['private-app-1'], optionalApps: [] } });
  const mutant = await policy.previewCompositeRole(admin, { action: 'assign', app: 'synthetic-mutant-experience', template: 'mutant',
    targetSub: resident.sub, targetIssuer: issuer, reason: 'Original mapping refusal', expectedRevision: (await store.read()).revision });
  assert.equal(mutant.ready, false); assert.equal(mutant.members.find(row => row.app === 'private-app-1')?.blocked, 'composite_member_role_unavailable');
  assert.equal((await store.read()).assignments.length, 0);
});
