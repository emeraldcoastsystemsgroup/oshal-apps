/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.14.0 (T83; Roger, 2026-11-12: "we also have a sas model that needs to be accommodated"): who may use Phone & Device Control. Since 1.2.0 only the administrator's role could; now every person adds, manages and presses their own devices on their own computers. A door in front of the package's real routes decides each request from authorization.yaml the way the kernel does (the route's one binding; every permission of it granted by the caller's role; the role's tier at or above the permission's minimum tier), and then the real routes and a real SQLite file answer. Proven here: a person with the operator or the editor role adds a device on their own computer, renames it, presses it (the command names their own computer), writes history, reads the bridge files and removes it; another person's device, history and computer stay out of reach; an account that may only open the page (viewer, reader) reads the page and is refused every device feature; and the catalog keeps every resource at the own scope, so nothing here can reach the installation or another person without this test going red. The door is this test's stand-in for the kernel; the kernel's own enforcement of the same catalog is proven on a disposable kernel by tests/live/isolation-proof.sh.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Compare the authorized bridge manifest response with the declared package version so a release bump keeps exercising both owners and the subsequent isolation assertions.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const PKG = path.resolve(__dirname, '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-control-own-devices-'));
process.env.OSHAL_PACKAGE_DATA_DIR = work;
const store = require(path.join(PKG, 'lib', 'db.js'));
const { createPhoneControlRoutes } = require(path.join(PKG, 'routes', 'phone-control-routes.js'));

const yaml = (() => {
  for (const candidate of [path.join(PKG, '..', 'scripts', 'toolchain', 'node_modules', 'js-yaml'), 'js-yaml']) {
    try { return require(candidate); } catch { /* next */ }
  }
  return null;
})();
assert.ok(yaml, 'js-yaml is required: run npm ci --prefix scripts/toolchain');
const catalog = yaml.load(fs.readFileSync(path.join(PKG, 'authorization.yaml'), 'utf8'));
const packageVersion = yaml.load(fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8')).version;

const RANK = Object.freeze({ viewer: 1, editor: 2, admin: 3 });
const person = (sub, role) => ({ actor: { isActive: true, issuer: 'https://issuer.example', sub }, role });
/** Two people who are not administrators, an administrator, and two accounts that may only open the page. */
const PEOPLE = Object.freeze({
  olivia: person('olivia', 'operator'),
  eddie: person('eddie', 'editor'),
  ada: person('ada', 'admin'),
  vera: person('vera', 'viewer'),
  rhea: person('rhea', 'reader')
});
const NODES = Object.freeze({ olivia: '11111111-1111-4111-8111-111111111111', eddie: '22222222-2222-4222-8222-222222222222' });
const WORKING = ['execution.read', 'execution.operate', 'history.write', 'configuration.read', 'configuration.pair',
  'configuration.manage', 'configuration.revoke', 'bridge.read'];
const VIEWS = ['execution.view', 'configuration.view'];

/**
 * @description The one HTTP binding of a request, as the kernel matches it: same method, same number of segments,
 * each segment equal or a named parameter.
 * @param {string} method The HTTP method.
 * @param {string} route The path under /api/phone-control.
 * @returns {object|null} The binding, or null when none or more than one matches.
 */
function bindingOf(method, route) {
  const parts = route.split('/');
  const hits = catalog.bindings.http.filter((binding) => binding.method === method
    && binding.path.split('/').length === parts.length
    && binding.path.split('/').every((part, index) => part === parts[index] || (part.startsWith(':') && parts[index])));
  return hits.length === 1 ? hits[0] : null;
}

/**
 * @description Whether a role is admitted to every permission in a list: the role grants it at the own scope and the
 * role's tier is at or above the permission's minimum tier.
 * @param {string} role The catalog role.
 * @param {string[]} permissions The permissions an entry point requires.
 * @returns {boolean} True when every permission is granted and allowed.
 */
function holds(role, permissions) {
  const declared = catalog.roles[role];
  return permissions.every((name) => {
    const permission = catalog.permissions[name];
    const granted = declared.grants.some((grant) => grant.permission === name && grant.scope === 'own');
    return Boolean(permission) && granted && RANK[declared.tier] >= RANK[permission.minimumTier];
  });
}

let server;
let base;
let current = null;

before(async () => {
  const db = store.getDatabase(path.join(work, 'own-devices.sqlite'));
  const ctx = { appPackageDir: PKG, db, authorization: { currentActor: () => current, registerResource() {} } };
  const routes = createPhoneControlRoutes(ctx);
  server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      req.body = raw ? JSON.parse(raw) : {};
      const caller = PEOPLE[req.headers['x-test-person']];
      req.url = req.url.slice('/api/phone-control'.length) || '/';
      const binding = bindingOf(req.method, req.url.split('?')[0]);
      if (!caller || !binding || !holds(caller.role, binding.allOf)) {
        res.statusCode = 403;
        res.setHeader('content-type', 'application/json');
        return res.end(JSON.stringify({ error: 'application_resource_denied' }));
      }
      current = caller.actor;
      return routes.handle(req, res, () => { res.statusCode = 404; res.end('{}'); });
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  fs.rmSync(work, { recursive: true, force: true });
});

async function call(who, method, route, body) {
  const headers = { 'content-type': 'application/json', 'x-test-person': who };
  const response = await fetch(`${base}/api/phone-control${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* a page or a file */ }
  return { status: response.status, json, text };
}

/** Add a TV on the person's own computer the way the page and Jarvis do, and answer its id. */
async function addOwnTv(who, address) {
  const report = await call(who, 'POST', `/computers/${NODES[who]}/report`, { report: { version: '1.14.0', adb: { ready: true } } });
  assert.equal(report.status, 200, `${who} reports their own computer: ${report.text}`);
  const added = await call(who, 'POST', '/devices', { name: `${who} Fire TV`, address });
  assert.equal(added.status, 201, `${who} adds their own TV: ${added.text}`);
  assert.equal(added.json.device.computerNodeId, NODES[who], 'it is connected by their own computer, without naming one');
  assert.equal(added.json.device.form, 'tv');
  return added.json.device.id;
}

test('1.14.0: a person who is not an administrator adds, manages and presses their own device', async () => {
  for (const [who, address] of [['olivia', '192.168.1.61'], ['eddie', '192.168.1.62']]) {
    const id = await addOwnTv(who, address);
    const listed = await call(who, 'GET', '/devices');
    assert.deepEqual(listed.json.devices.map((device) => device.id), [id]);
    const renamed = await call(who, 'POST', `/devices/${id}`, { name: 'Den TV' });
    assert.equal(renamed.json.device.name, 'Den TV', `${who} manages their own device`);
    const pressed = await call(who, 'POST', `/devices/${id}/execute`, { action: 'key', key: 'OK' });
    assert.equal(pressed.status, 200, pressed.text);
    assert.equal(pressed.json.computerRunRequest.endpoint, `/api/computers/${NODES[who]}/run`, 'the press runs on their own computer');
    assert.match(pressed.json.command, /adb-key|keyboard-key/, 'the press is a real bridge command');
    const kept = await call(who, 'POST', '/history', { computerNodeId: NODES[who], phoneId: id, action: 'key', summary: 'key OK', ok: true, exitCode: 0 });
    assert.equal(kept.status, 201, kept.text);
    assert.ok((await call(who, 'GET', '/history')).json.history.length >= 1);
    assert.equal((await call(who, 'GET', '/computers/reports')).json.reports.length, 1);
    assert.equal((await call(who, 'GET', '/bridge/manifest.json')).json.version, packageVersion, `${who} reads the current package's bridge files for their computer`);
  }
});

test('1.14.0: another person\'s device, history and computer stay out of reach', async () => {
  const olivias = (await call('olivia', 'GET', '/devices')).json.devices;
  const eddies = (await call('eddie', 'GET', '/devices')).json.devices;
  assert.equal(olivias.length, 1);
  assert.equal(eddies.length, 1);
  assert.notEqual(olivias[0].id, eddies[0].id);
  const theirs = olivias[0].id;
  for (const [method, route, body] of [['GET', `/devices/${theirs}`], ['POST', `/devices/${theirs}`, { name: 'Taken TV' }],
    ['POST', `/devices/${theirs}/execute`, { action: 'key', key: 'OK' }], ['POST', `/devices/${theirs}/command-plan`, { action: 'key', key: 'OK' }],
    ['POST', `/devices/${theirs}/open-link`, { url: 'https://www.netflix.com/title/1' }], ['DELETE', `/devices/${theirs}`]]) {
    assert.equal((await call('eddie', method, route, body)).status, 404, `eddie ${method} ${route} on olivia's TV`);
  }
  assert.equal((await call('olivia', 'GET', `/devices/${theirs}`)).json.device.name, 'Den TV', 'olivia\'s TV is as she left it');
  const history = (await call('eddie', 'GET', '/history')).json.history;
  assert.ok(history.every((event) => event.computerNodeId === NODES.eddie), 'eddie reads his own history only');
  const reports = (await call('eddie', 'GET', '/computers/reports')).json.reports;
  assert.deepEqual(reports.map((report) => report.computerNodeId), [NODES.eddie]);
  // An administrator's role is the same person-scoped reach: it sees nobody else's devices either.
  assert.deepEqual((await call('ada', 'GET', '/devices')).json.devices, []);
  assert.equal((await call('ada', 'GET', `/devices/${theirs}`)).status, 404);
  // A person with no computer of their own is never handed someone else's.
  const none = await call('ada', 'POST', '/devices', { name: 'No computer TV', address: '192.168.1.63' });
  assert.equal(none.status, 400);
  assert.equal(none.json.error, 'computer_required');
  for (const who of ['olivia', 'eddie']) {
    const id = (await call(who, 'GET', '/devices')).json.devices[0].id;
    assert.equal((await call(who, 'DELETE', `/devices/${id}`)).status, 204, `${who} removes their own device`);
  }
});

test('1.14.0: an account that may only open the page reads the page and is refused every device feature', async () => {
  for (const who of ['vera', 'rhea']) {
    const page = await call(who, 'GET', '/ui');
    assert.equal(page.status, 200);
    assert.match(page.text, /Not available on your account/);
    assert.doesNotMatch(page.text, /administrator only/, 'the card no longer says the features are the administrator\'s');
    for (const [method, route, body] of [['GET', '/devices'], ['POST', '/devices', { name: 'TV', address: '192.168.1.64' }],
      ['POST', '/devices/any/execute', { action: 'key', key: 'OK' }], ['POST', `/computers/${NODES.olivia}/report`, { report: {} }],
      ['GET', '/history'], ['GET', '/computers/reports'], ['GET', '/bridge/manifest.json'], ['POST', '/provision', { address: '192.168.1.64' }],
      ['DELETE', '/devices/any']]) {
      assert.equal((await call(who, method, route, body)).status, 403, `${who} ${method} ${route}`);
    }
  }
});

test('1.14.0: the catalog gives device features to every role that can hold them, and nothing beyond the person\'s own', () => {
  const tier = (name) => catalog.permissions[name].minimumTier;
  assert.deepEqual(Object.fromEntries(Object.keys(catalog.permissions).map((name) => [name, tier(name)])), {
    'execution.view': 'viewer', 'execution.read': 'viewer', 'execution.operate': 'editor', 'history.write': 'editor',
    'configuration.view': 'viewer', 'configuration.read': 'viewer', 'configuration.pair': 'editor',
    'configuration.manage': 'editor', 'configuration.revoke': 'editor', 'bridge.read': 'editor'
  });
  const granted = (role) => catalog.roles[role].grants.map((grant) => grant.permission).sort();
  for (const role of ['operator', 'editor', 'admin']) assert.deepEqual(granted(role), [...VIEWS, ...WORKING].sort(), role);
  for (const role of ['viewer', 'reader']) assert.deepEqual(granted(role), [...VIEWS].sort(), `${role} opens the page only`);
  assert.deepEqual(Object.fromEntries(Object.entries(catalog.roles).map(([name, role]) => [name, role.tier])),
    { viewer: 'viewer', reader: 'viewer', operator: 'editor', editor: 'editor', admin: 'admin' });
  // Every entry point is open to a person who is not an administrator: no route, tool or bot is the administrator's alone.
  const entries = [...catalog.bindings.http, ...catalog.bindings.tools, ...catalog.bindings.bots];
  for (const entry of entries) assert.ok(holds('operator', entry.allOf) && holds('editor', entry.allOf), `${entry.id} is refused to a person who is not an administrator`);
  // The tripwire for anything installation-wide or another person's: both resources have the own scope only and every
  // grant is at the own scope. A resource that gains a wider scope must keep its permissions at the admin tier and
  // in the admin role alone, or this fails.
  for (const [name, resource] of Object.entries(catalog.resources)) {
    if (resource.scopes.length === 1 && resource.scopes[0] === 'own') continue;
    for (const [permission, declared] of Object.entries(catalog.permissions).filter(([, item]) => item.resource === name)) {
      assert.equal(declared.minimumTier, 'admin', `${permission} reaches beyond the person's own records, so it needs the admin tier`);
      for (const role of ['viewer', 'reader', 'operator', 'editor']) assert.ok(!granted(role).includes(permission), `${role} must not hold ${permission}`);
    }
  }
  assert.deepEqual(Object.keys(catalog.resources).sort(), ['configuration', 'execution']);
  for (const role of Object.values(catalog.roles)) assert.ok(role.grants.every((grant) => grant.scope === 'own'), 'every grant is at the own scope');
});
