/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.0.0: the engineering shelf's one role, held to what the kernel requires of an application that declares a role across applications (oshal-kernel crates/packages/src/experience.rs validate_authorization_templates and validate_members, crates/packages/src/composite_roles.rs composite_parts and resolve_application_role): the two capabilities, a version 1 package-local catalog, an ordinary application, a template that maps the package and every required application, "@app-admin" only for an application without a catalog and a declared role for one with a catalog, and nothing an application requires left unmapped. The package grants one read of its own and nothing in another application, declares no screen, bot, tool or table, and stays out of the application lists. The compiled route factory is run with the gate's Express against this manifest: it registers an adapter for the catalog's one resource (on a kernel a package with a catalog answers "package did not report itself ready" for every route until each resource has one; the first draft registered none and its readiness route answered 400 on a throwaway kernel), admits only an own grant, and answers readiness.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.0.0, before its first release: readiness is the store's reviewed package-smoke pair (the store gate refused readiness answered from the package's own factory), and routes/shelf-routes.js is declared second at the same mount to register the `shelf` adapter only. The manifest's two route declarations are asserted in that order; the factory still registers exactly the catalog's resources and refuses to run without the port, now serves no path (an empty router answers 404 to everything), and readiness is answered through the two routers composed at the one mount the way the kernel's runner composes declarations that share a mount (crates/host-process/bridge/runner.js: one Router, `use` in declaration order).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const store = path.resolve(root, '..');
const toolchain = path.resolve(process.env.STORE_CI_TOOLCHAIN || path.join(store, 'scripts', 'toolchain'));
const need = createRequire(path.join(toolchain, 'package.json'));
const yaml = need('js-yaml');

const manifest = yaml.load(fs.readFileSync(path.join(root, 'oshal-app.yaml'), 'utf8'));
const catalog = yaml.load(fs.readFileSync(path.join(root, 'authorization.yaml'), 'utf8'));
const SHELF = ['design-studio', 'cad-studio', 'circuit-lab', 'embodied', 'scan-to-print'];

/** @description A package of this repository by its name: its manifest and, when it has one, its access catalog. */
function component(name) {
  const file = path.join(store, name, 'oshal-app.yaml');
  if (!fs.existsSync(file)) return null;
  const found = yaml.load(fs.readFileSync(file, 'utf8'));
  if (found.name !== name) return null;
  const declared = found.authorization && found.authorization.catalog;
  return { manifest: found, catalog: declared ? yaml.load(fs.readFileSync(path.join(store, name, declared), 'utf8')) : null };
}

/** @description The applications one package requires, as the kernel reads the tiered block. */
const required = (found) => (found.dependencies && found.dependencies.required && found.dependencies.required.apps) || [];

/** @description The kernel's required set of a role given with no optional choice: the owner, what it requires and what those require (composite_roles.rs closure). */
function kernelRequiredClosure(owner) {
  const seen = new Set([owner.name]);
  const walk = (found) => { for (const app of required(found)) { if (seen.has(app)) continue; seen.add(app); const next = component(app); assert.ok(next, `${app} is required and is not a package here`); walk(next.manifest); } };
  walk(owner);
  return [...seen].sort();
}

test('the manifest is an ordinary application that may declare a role across applications', () => {
  assert.equal(manifest.name, 'engineering-shelf');
  assert.equal(manifest.kind, undefined, 'a group cannot declare role templates');
  assert.equal(manifest.experience, undefined, 'it is not an experience: nothing is added to the experiences list');
  for (const capability of ['application-authorization', 'experience-roles', 'app-dependencies']) assert.ok(manifest.uses.includes(capability), capability);
  assert.deepEqual({ version: manifest.authorization.version, catalog: manifest.authorization.catalog }, { version: 1, catalog: 'authorization.yaml' });
  assert.equal(manifest.suite, 'ai-engineering');
  assert.equal(manifest.status, 'active');
});

test('it has no screen, bot, tool or table, and stays out of the application lists', () => {
  assert.equal(manifest.hidden, true);
  for (const key of ['ui', 'bots', 'tools', 'migrations', 'schedules', 'chatBot', 'surface', 'summary']) assert.equal(manifest[key], undefined, key);
  // Readiness first, as every routed package declares it; the adapter's factory second at the same mount, so the
  // package answers one address.
  assert.deepEqual(manifest.routes.map((route) => [route.module, route.factory, route.mountPath, route.auth, route.requiresAi]), [
    ['routes/package-smoke.js', 'createPackageSmokeRoutes', '/api/engineering-shelf/_smoke', 'service', false],
    ['routes/shelf-routes.js', 'createShelfRoutes', '/api/engineering-shelf/_smoke', 'service', false],
  ]);
});

test('the Engineer role is one template that maps this package and each of the five applications once', () => {
  assert.deepEqual([...required(manifest)].sort(), [...SHELF].sort());
  assert.deepEqual(manifest.dependencies.optional.apps, [], 'nothing is left for an administrator to tick');
  assert.equal(manifest.authorization.roleTemplates.length, 1);
  const template = manifest.authorization.roleTemplates[0];
  assert.deepEqual([template.id, template.version], ['engineer', 1]);
  assert.ok(template.label.length <= 128 && SHELF.every((app) => template.label.includes(component(app).manifest.displayName)), 'the label names each application as a person knows it');
  assert.deepEqual(template.members.map((member) => member.app).sort(), ['engineering-shelf', ...SHELF].sort());
  assert.deepEqual(template.members[0], { app: 'engineering-shelf', role: 'engineer' });
  assert.deepEqual(kernelRequiredClosure(manifest), ['engineering-shelf', ...SHELF].sort(), 'what the five require is mapped too (the kernel\'s required set is transitive)');
});

test('each application is mapped with a role it has: "@app-admin" only without a catalog, a declared role with one', () => {
  for (const { app, role } of manifest.authorization.roleTemplates[0].members.slice(1)) {
    const found = component(app);
    assert.ok(found, `${app} is a package in this repository`);
    assert.equal(found.manifest.status, 'active', `${app} is active`);
    if (found.catalog) assert.ok(found.catalog.roles[role], `${app} has a catalog and no role ${role}: the kernel would refuse the assignment`);
    else assert.equal(role, '@app-admin', `${app} has no catalog, so its one role is "@app-admin"`);
  }
  // The four that every person holds through the catalog-free role must stay without a catalog; one that gains a catalog needs its role named here.
  assert.deepEqual(SHELF.filter((app) => component(app).catalog), ['scan-to-print']);
});

test('the catalog gives the engineer one read of this package and nothing else', () => {
  assert.deepEqual(Object.keys(catalog.permissions), ['app.open']);
  assert.deepEqual(catalog.permissions['app.open'], { resource: 'shelf', effect: 'read', minimumTier: 'viewer' });
  assert.deepEqual(catalog.roles, { engineer: { tier: 'viewer', grants: [{ permission: 'app.open', scope: 'own' }] } });
  assert.deepEqual(catalog.bindings.http.map((bound) => `${bound.method} ${bound.path} ${bound.allOf}`), ['GET / app.open', 'HEAD / app.open']);
  assert.deepEqual(Object.keys(catalog.bindings), ['http']);
});

/** @description Load one compiled route module of this package, answering its `express` with the gate's Express. */
function loadRoute(home, file) {
  // A package folder has no modules of its own, so the name is answered with the gate's Express for the length of
  // this load. The route and Express are both the real ones.
  const Module = need('node:module');
  const resolve = Module._resolveFilename;
  Module._resolveFilename = function resolveExpress(request, ...rest) { return resolve.call(this, request === 'express' ? home : request, ...rest); };
  try { return need(path.join(root, 'routes', file)); } finally { Module._resolveFilename = resolve; }
}

test('the adapter factory registers the catalog\'s one resource, admits only an own grant and serves no path; readiness answers at the shared mount', async () => {
  const home = path.join(toolchain, 'node_modules', 'express');
  assert.ok(fs.existsSync(home), 'BLOCKED: express not found (npm ci --prefix scripts/toolchain)');
  const shelf = loadRoute(home, 'shelf-routes.js');
  const smoke = loadRoute(home, 'package-smoke.js');
  // A package with a catalog is not served until every resource of the catalog has an adapter (the kernel's bridge
  // refuses to seal otherwise): the factory registers exactly the catalog's resources, and refuses to run without the port.
  assert.throws(() => shelf.createShelfRoutes({ appPackageDir: root }), /requires application authorization/);
  const registered = {};
  const authorization = { registerResource: (name, adapter) => { registered[name] = adapter; } };
  const adapterRouter = shelf.createShelfRoutes({ appPackageDir: root, authorization });
  assert.deepEqual(Object.keys(registered), Object.keys(catalog.resources));
  const actor = { isActive: true, sub: 'person', issuer: 'issuer' };
  assert.equal(await registered.shelf.authorize({ actor, grant: { scope: 'own' }, fields: [] }), true);
  assert.equal(await registered.shelf.authorize({ actor, grant: { scope: 'tenant' }, fields: [] }), false);
  assert.equal(await registered.shelf.authorize({ actor: { ...actor, isActive: false }, grant: { scope: 'own' }, fields: [] }), false);
  assert.equal(await registered.shelf.authorize({ actor: { ...actor, sub: ' ' }, grant: { scope: 'own' }, fields: [] }), false);
  assert.equal(await registered.shelf.authorize({ actor, grant: { scope: 'own' }, fields: ['anything'] }), false);
  // The declarations sharing the readiness mount, composed in manifest order the way the kernel's runner composes them.
  const express = need(home);
  const shared = express.Router();
  for (const route of manifest.routes) {
    const factory = (route.module === 'routes/shelf-routes.js' ? shelf : smoke)[route.factory];
    shared.use(route.module === 'routes/shelf-routes.js' ? adapterRouter : factory({ appPackageDir: root }));
  }
  const app = express();
  app.use('/api/engineering-shelf/_smoke', shared);
  app.use('/adapter-only', adapterRouter);
  app.use('/broken', smoke.createPackageSmokeRoutes({}));
  const server = http.createServer(app);
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const ready = await fetch(`${base}/api/engineering-shelf/_smoke`);
    assert.deepEqual([ready.status, await ready.json()], [200, { status: 'ready', package: 'engineering-shelf', version: manifest.version, manifest: 'verified' }]);
    assert.equal((await fetch(`${base}/adapter-only`)).status, 404, 'the adapter factory serves no path of its own');
    const broken = await fetch(`${base}/broken`);
    assert.deepEqual([broken.status, (await broken.json()).code], [503, 'package_integrity_failed'], 'without its folder it says it is not ready');
    assert.equal((await fetch(`${base}/api/engineering-shelf/_smoke`, { method: 'POST' })).status, 404, 'the route changes nothing');
    assert.equal((await fetch(`${base}/api/engineering-shelf/_smoke/anything`)).status, 404, 'the mount answers readiness and nothing else');
  } finally { await new Promise((done) => server.close(done)); }
});
