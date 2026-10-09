/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Load the actual experience package through existing host, authorization and route machinery on an isolated loopback fixture.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
const original = resolve(__dirname, '..', packageName);
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
before(async () => {
  assert.ok(process.env.OSHAL_FRAMEWORK, 'Explicit framework checkout is required');
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
    const memberRoot = join(directory, name); mkdirSync(memberRoot);
    const surfaces = manifest.experience.surfaces.filter((ref: { app: string }) => ref.app === name);
    const fixture: Record<string, unknown> = {name,displayName:'Synthetic '+name,version:'1.0.0',status:'active',chatBot:'general-bot',ui:{static:surfaces.map((ref: { surface: string })=>({toolName:ref.surface,label:'Synthetic '+ref.surface,icon:'codicon codicon-home',iframeUrl:'/fixture/'+ref.surface,section:'top'}))}};
    if (name === 'little-monsters') {
      fixture.authorization = {version:1,catalog:'authorization.yaml'};
      fixture.uses = ['application-authorization'];
      cpSync(join(original,'..',name,'authorization.yaml'), join(memberRoot,'authorization.yaml'));
    }
    writeFileSync(join(memberRoot,'oshal-app.yaml'), yaml.dump(fixture));
    await apps.loadApp(join(memberRoot,'oshal-app.yaml'));
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
  assert.equal((await get('/api/ui/experiences/'+packageName+'/open', resident)).status, 302);
  const entry = await get('/api/'+packageName+'/app', resident); assert.equal(entry.status, 200); assert.ok((await entry.text()).includes('data-experience-app="'+packageName+'"'));
  assert.equal((await get('/api/'+packageName+'/assets/config.js', resident)).status, 200);
  assert.equal((await get('/api/'+packageName+'/assets/config.js', outsider)).status, 403);
  assert.equal((await get('/api/'+packageName+'/private-not-declared', resident)).status, 403);
  const revoke = await policy.previewCompositeRole(admin, { action: 'revoke', app: packageName, assignmentId: receipt.assignmentId,
    reason: 'Synthetic owned source cleanup', expectedRevision: (await store.read()).revision });
  await policy.applyCompositeRole(admin, { previewId: revoke.previewId!, idempotencyKey: randomUUID() });
  assert.equal((await get('/api/'+packageName+'/app', resident)).status, 403); assert.equal((await store.read()).assignments.length, 0);
});
