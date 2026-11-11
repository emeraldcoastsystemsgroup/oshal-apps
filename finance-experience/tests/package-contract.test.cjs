/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.0.0: the Finance entry in the experiences list. The manifest declares what the kernel requires of an experience (crates/packages/src/experience.rs in oshal-kernel: the two capabilities, a version 1 package-local catalog, a session-authenticated route that owns the entry, a role template that covers the package and every required application). The role mapping follows the kernel's rule for "@app-admin" (crates/packages/src/composite_roles.rs: only for an application without a catalog), read from the component manifests in this repository, and every application an optional choice requires is itself mapped. The compiled route answers 302 to the Finance application page and admits only an own grant; the catalog grants reading and nothing else. Plain Node, no parser dependency.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.0.1: the entry is a hand-off page, and the route case also runs it with a response that has only the methods the kernel's bridge offers. 1.0.0 answered with `res.redirect`, passed here with Express and answered 500 on a kernel; a Location header would not have reached the browser either. The page is held to one address and no script. The live check ops/audit/finance_experience_live.py in oshal-kernel is the check on a running kernel.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const root = path.resolve(__dirname, '..');
const store = path.resolve(root, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const manifest = read('oshal-app.yaml');
const catalog = read('authorization.yaml');

/** The inline list after `key:` inside the block that starts at `header` (for example the apps of `required:`). */
function inlineList(text, header, key) {
  const block = text.slice(text.indexOf(header));
  const found = block.match(new RegExp(`^\\s+${key}: \\[([^\\]]*)\\]`, 'm'));
  return found ? found[1].split(',').map((item) => item.trim()).filter(Boolean) : null;
}
/** The members of the one role template, in order. */
function members(text) {
  const block = text.slice(text.indexOf('roleTemplates:'), text.indexOf('\nroutes:'));
  return [...block.matchAll(/- app: (\S+)\n\s+role: '?([^'\n]+)'?/g)].map(([, app, role]) => ({ app, role }));
}
/** A component's manifest and whether it has an access catalog, found by its package name in this repository. */
function component(name) {
  for (const entry of fs.readdirSync(store, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(store, entry.name, 'oshal-app.yaml');
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    if ((text.match(/^name: *(\S+)/m) || [])[1] !== name) continue;
    return { text, folder: entry.name, catalog: fs.existsSync(path.join(store, entry.name, 'authorization.yaml')) };
  }
  return null;
}

const required = inlineList(manifest, '\n  required:', 'apps');
const optional = inlineList(manifest, '\n  optional:', 'apps');
const template = members(manifest);

test('the manifest declares what the kernel requires of an experience', () => {
  for (const capability of ['application-authorization', 'experience', 'experience-roles']) assert.match(manifest, new RegExp(`^  - ${capability}$`, 'm'));
  assert.match(manifest, /^authorization:\n  version: 1\n  catalog: authorization\.yaml$/m);
  assert.match(manifest, /^experience:\n  version: 1\n  label: Finance\n  entry: \/api\/finance-experience\/app\n  shell: page\n  skin: [a-z0-9-]+$/m);
  // The entry belongs to a declared route that needs a signed-in session.
  assert.match(manifest, /- module: routes\/experience\.js\n\s+factory: createExperienceRoutes\n\s+mountPath: \/api\/finance-experience\n\s+auth: oidc\n\s+requiresAuth: true/);
  assert.doesNotMatch(manifest, /allowAnonymous: true/);
  assert.match(manifest, /^displayName: Finance$/m);
  assert.match(manifest, /^suite: ai-finance\b/m);
});

test('the member role covers this package and every required application, and names only declared ones', () => {
  assert.deepEqual(required, ['finance']);
  assert.deepEqual(optional, ['intelligent-trades', 'world', 'kalshi']);
  assert.deepEqual(template[0], { app: 'finance-experience', role: 'member' });
  const named = template.map((member) => member.app);
  assert.equal(new Set(named).size, named.length, 'one mapping per application');
  for (const app of required) assert.ok(named.includes(app), `${app} is required and must be mapped`);
  for (const app of named.slice(1)) assert.ok(required.includes(app) || optional.includes(app), `${app} is mapped and must be a declared dependency`);
  for (const app of optional) assert.ok(named.includes(app), `${app} is an optional choice and needs a mapping to be chosen`);
});

test('each mapped application exists here, has no catalog where "@app-admin" is used, and requires nothing unmapped', () => {
  const named = template.map((member) => member.app);
  for (const { app, role } of template.slice(1)) {
    const found = component(app);
    assert.ok(found, `${app} is a package in this repository`);
    assert.match(found.text, /^status: active$/m, `${app} is active`);
    // The kernel accepts "@app-admin" only for an application without a catalog; one with a catalog needs a named role.
    if (role === '@app-admin') assert.equal(found.catalog, false, `${app} has a catalog, so it needs a named role, not @app-admin`);
    // The kernel's required set is transitive: whatever a chosen application requires must be mapped as well.
    for (const needs of inlineList(found.text, '\n  required:', 'apps') || []) assert.ok(named.includes(needs), `${app} requires ${needs}, which the template does not map`);
  }
  // Finance itself must stay without a catalog while other experience packages map it with "@app-admin".
  assert.equal(component('finance').catalog, false);
});

test('the catalog lets a member open the entry and nothing else', () => {
  assert.match(catalog, /^permissions:\n  app\.open:\n    resource: application\n    effect: read\n    minimumTier: viewer$/m);
  assert.doesNotMatch(catalog, /effect: (write|execute|delete|create|change)/);
  assert.match(catalog, /^roles:\n  member:\n    tier: viewer\n    grants:\n      - permission: app\.open\n        scope: own$/m);
  const bound = [...catalog.matchAll(/method: (\w+)\n\s+path: (\S+)/g)].map(([, method, route]) => `${method} ${route}`);
  assert.deepEqual(bound, ['GET /app', 'HEAD /app', 'GET /', 'HEAD /']);
});

test('the entry sends a signed-in member to the Finance application page', async () => {
  let home;
  for (const base of [process.env.STORE_CI_TOOLCHAIN, path.join(store, 'scripts/toolchain/node_modules')].filter(Boolean)) {
    if (fs.existsSync(path.join(base, 'express'))) { home = path.join(base, 'express'); break; }
  }
  assert.ok(home, 'BLOCKED: express not found (npm ci --prefix scripts/toolchain)');
  const express = require(home);
  // The compiled route asks for Express by name; a package folder has no modules of its own, so the name is
  // answered with the gate's Express for the length of this load. The route and Express are both the real ones.
  const Module = require('node:module');
  const resolve = Module._resolveFilename;
  Module._resolveFilename = function resolveExpress(request, ...rest) { return resolve.call(this, request === 'express' ? home : request, ...rest); };
  let routes;
  try { routes = require(path.join(root, 'routes/experience.js')); } finally { Module._resolveFilename = resolve; }
  assert.equal(routes.FINANCE_APPLICATION, '/api/finance/app');
  assert.throws(() => routes.createExperienceRoutes({}), /requires application authorization/);
  const registered = {};
  const router = routes.createExperienceRoutes({ authorization: { registerResource: (name, adapter) => { registered[name] = adapter; } } });
  const actor = { isActive: true, sub: 'person', issuer: 'issuer' };
  assert.equal(await registered.application.authorize({ actor, grant: { scope: 'own' }, fields: [] }), true);
  assert.equal(await registered.application.authorize({ actor, grant: { scope: 'tenant' }, fields: [] }), false);
  assert.equal(await registered.application.authorize({ actor: { ...actor, isActive: false }, grant: { scope: 'own' }, fields: [] }), false);
  assert.equal(await registered.application.authorize({ actor, grant: { scope: 'own' }, fields: ['balance'] }), false);
  const app = express();
  app.use('/api/finance-experience', router);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}/api/finance-experience`;
    for (const method of ['GET', 'HEAD']) {
      const answer = await fetch(`${base}/app`, { method, redirect: 'manual' });
      assert.deepEqual([answer.status, answer.headers.get('location'), /^text\/html\b/.test(answer.headers.get('content-type'))], [200, null, true], method);
      if (method === 'GET') assert.equal(await answer.text(), routes.HAND_OFF);
    }
    assert.equal((await fetch(`${base}/app`, { method: 'POST', redirect: 'manual' })).status, 404, 'the entry changes nothing');
  } finally { await new Promise((resolve) => server.close(resolve)); }
  // The page sends the browser to one address, at once, with no script; the link is for a browser that does not refresh.
  assert.match(routes.HAND_OFF, /<meta http-equiv="refresh" content="0; url=\/api\/finance\/app">/);
  assert.match(routes.HAND_OFF, /<a href="\/api\/finance\/app">Open Finance<\/a>/);
  assert.deepEqual([...routes.HAND_OFF.matchAll(/(?:url=|href="|src=")([^">]+)/g)].map((found) => found[1]), ['/api/finance/app', '/api/finance/app']);
  assert.doesNotMatch(routes.HAND_OFF, /<script|javascript:/i);
  // On a kernel the response is the bridge's own (oshal-kernel crates/host-process/bridge/http_response.js): it has status,
  // set, setHeader, getHeader, type, json, send and end, and no `redirect`; and the kernel relays the status, the body and
  // the content type, no other header. 1.0.0 called `res.redirect` and answered 500 there.
  const sent = { status: 200, headers: {}, ended: 0, body: undefined };
  const kernelResponse = {
    status(code) { sent.status = code; return this; },
    setHeader(name, value) { sent.headers[String(name).toLowerCase()] = String(value); return this; },
    set(name, value) { return this.setHeader(name, value); },
    getHeader(name) { return sent.headers[String(name).toLowerCase()]; },
    type(kind) { return this.setHeader('content-type', kind === 'html' ? 'text/html' : kind); },
    send(body) { sent.ended += 1; sent.body = body; return this; },
    end(body) { return this.send(body ?? ''); },
  };
  const refusal = await new Promise((resolve) => {
    router({ method: 'GET', url: '/app', headers: {} }, kernelResponse, (error) => resolve(error || new Error('the route did not answer')));
    setImmediate(() => resolve(null));
  });
  assert.equal(refusal, null, `the route answers with the kernel's response: ${refusal && refusal.message}`);
  assert.deepEqual([sent.status, sent.headers['content-type'], sent.ended, sent.body], [200, 'text/html', 1, routes.HAND_OFF]);
  assert.deepEqual(Object.keys(sent.headers), ['content-type'], 'nothing rests on a header a kernel does not relay');
  // The page it opens is Finance's own, served by the finance package.
  assert.match(fs.readFileSync(path.join(store, 'finance/src-routes/finance-routes.ts'), 'utf8'), /router\.get\('\/app', servePage\(surfaceDir, 'finance-app\.html'\)\)/);
});
