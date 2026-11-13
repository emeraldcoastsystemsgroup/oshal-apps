/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.13.0 (T79, the device inventory): POST /devices/:id/apps/record over the real routes, the package's own store and a stand-in for the kernel's device.inventory.record that keeps what it is told. The one JSON line the TV's computer printed (as a line, inside a run result, or as computer.run_plan's stdout) is checked: the apps through the closed list (an app outside it, a repeat and a package that is not a package name are dropped), the others counted, the model and maker only as plain names. The kernel is told the TV by its saved id and name, Fire TV from its model (only a TV when nothing says which), its ADB route through the TV's own computer that worked, that its applications can be listed, the apps with the services they reach, the seven it looked for and the others; the answer says what was found and not found and that the inventory kept it. A read the TV refused records the route as down with the bridge's words and nothing else; a kernel that refuses, or has no intent, is said in words while the apps are still answered; a phone, an unknown TV, another person's TV and a missing or foreign reply are refused in words; the read is recorded against the TV.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Preparing an app-list command records neither a successful read nor inventory; actual successful and failed replies still record their outcomes.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const PKG = path.resolve(__dirname, '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-control-inventory-'));
process.env.OSHAL_PACKAGE_DATA_DIR = work;
const store = require(path.join(PKG, 'lib', 'db.js'));
const { createPhoneControlRoutes } = require(path.join(PKG, 'routes', 'phone-control-routes.js'));

const PEOPLE = {
  alice: { isActive: true, issuer: 'https://issuer.example', sub: 'alice' },
  bob: { isActive: true, issuer: 'https://issuer.example', sub: 'bob' }
};
const NODE = '6f1c2b8e-1d2a-4c3b-9e8f-0a1b2c3d4e5f';
const kernel = { told: [], refuse: null, absent: false };
let server;
let base;
let current = null;

before(async () => {
  const db = store.getDatabase(path.join(work, 'inventory.sqlite'));
  const ctx = {
    appPackageDir: PKG, db, authorization: { currentActor: () => current, registerResource() {} },
    async intent(name, input) {
      if (kernel.absent) throw new Error('intent device.inventory.record has no executor in this host context');
      kernel.told.push({ name, input });
      if (kernel.refuse) throw new Error(kernel.refuse);
      return { recorded: true, id: 'pkg-0123456789abcdef01234567', name: input.name, kind: input.kind };
    }
  };
  const routes = createPhoneControlRoutes(ctx);
  server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      req.body = raw ? JSON.parse(raw) : {};
      current = PEOPLE[req.headers['x-test-person']] || null;
      req.url = req.url.slice('/api/phone-control'.length) || '/';
      routes.handle(req, res, () => { res.statusCode = 404; res.end('{}'); });
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  fs.rmSync(work, { recursive: true, force: true });
});

async function call(method, route, { person = 'alice', body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (person) headers['x-test-person'] = person;
  const response = await fetch(`${base}/api/phone-control${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: response.status, json };
}

/** The line the bridge prints for tv_apps on a Fire TV (oshal_phone_bridge.py emit, 1.13.0). */
function bridgeLine(extra = {}) {
  return JSON.stringify({
    ok: true, verb: 'lan-control', kind: 'android-tv', address: '192.168.1.60', action: 'tv_apps', sent: true, tookMs: 812,
    apps: [
      { key: 'prime', name: 'Prime Video', package: 'com.amazon.firebat' },
      { key: 'youtube', name: 'YouTube', package: 'com.amazon.firetv.youtube' },
      { key: 'prime', name: 'Prime Video', package: 'com.amazon.avod' },
      { key: 'bank', name: 'My Bank', package: 'org.example.privatebank' },
      { key: 'oshal', name: 'oshal TV app', package: 'not a package' }
    ],
    unknownCount: 140, serial: '192.168.1.60:5555', model: 'AFTMD001', maker: 'Amazon', ...extra
  });
}

async function savedTv(person = 'alice') {
  const tv = await call('POST', '/devices', { person, body: { name: 'Office TV', platform: 'android', form: 'tv', computerNodeId: NODE, address: '192.168.1.60' } });
  assert.ok([200, 201].includes(tv.status), JSON.stringify(tv.json));
  return tv.json.device;
}

test('1.13.0: what the TV\'s computer printed is checked, recorded against the TV and handed to the kernel\'s inventory as the person', async () => {
  kernel.told = []; kernel.refuse = null; kernel.absent = false;
  const tv = await savedTv();
  const before = (await call('GET', `/devices/${tv.id}`)).json.history;
  const planned = await call('POST', `/devices/${tv.id}/apps`);
  assert.equal(planned.status, 200);
  assert.deepEqual((await call('GET', `/devices/${tv.id}`)).json.history, before, 'preparing the read records no result');
  assert.equal(kernel.told.length, 0, 'no inventory route is marked as working before a reply');
  assert.deepEqual([planned.json.ok, planned.json.planned, planned.json.executed, planned.json.status], [true, true, false, 'planned']);
  const answer = await call('POST', `/devices/${tv.id}/apps/record`, { body: { reply: `bridge started\n${bridgeLine()}\n` } });
  assert.equal(answer.status, 200, JSON.stringify(answer.json));
  assert.deepEqual(answer.json.apps.map((app) => [app.key, app.package]), [['prime', 'com.amazon.firebat'], ['youtube', 'com.amazon.firetv.youtube'], ['oshal', '']],
    'the closed list only, each app once, a package only when it is a package name');
  assert.deepEqual(answer.json.notFound, ['netflix', 'disney', 'max', 'hulu']);
  assert.deepEqual([answer.json.unknownCount, answer.json.model, answer.json.maker], [140, 'AFTMD001', 'Amazon']);
  assert.deepEqual(answer.json.inventory, { recorded: true, id: 'pkg-0123456789abcdef01234567' });
  assert.equal(kernel.told.length, 1);
  const { name, input } = kernel.told[0];
  assert.equal(name, 'device.inventory.record');
  assert.deepEqual(input, {
    key: tv.id, name: 'Office TV', kind: 'fire-tv', identity: { model: 'AFTMD001', maker: 'Amazon' },
    routes: [{ kind: 'adb', via: NODE, state: 'up', worked: true }],
    components: [{ kind: 'applications', capabilities: [{ name: 'list', can: 'yes', worked: true }] }],
    apps: [
      { key: 'prime', name: 'Prime Video', package: 'com.amazon.firebat', route: 'adb', services: ['prime-video'] },
      { key: 'youtube', name: 'YouTube', package: 'com.amazon.firetv.youtube', route: 'adb', services: ['youtube'] },
      { key: 'oshal', name: 'oshal TV app', route: 'adb', services: ['oshal'] }
    ],
    looked_for: ['netflix', 'prime', 'disney', 'max', 'hulu', 'youtube', 'oshal'], others: 140, read_over: 'adb'
  });
  assert.ok(!JSON.stringify(input).includes('privatebank'), 'a package outside the closed list never reaches the kernel');
  const history = (await call('GET', `/devices/${tv.id}`)).json.history;
  assert.equal(history.length, before.length + 1, 'only the actual reply adds a history row');
  assert.ok(history.some((event) => event.action === 'tv_apps_recorded' && event.ok), 'the read is recorded against the TV');

  const asRunResult = await call('POST', `/devices/${tv.id}/apps/record`, { body: { reply: JSON.stringify({ computer: 'spark', ok: true, result: { stdout: bridgeLine({ model: '<b>x</b>' }), exitCode: 0 } }) } });
  assert.equal(asRunResult.status, 200, 'computer.run_plan\'s whole result is read for its stdout');
  assert.equal(asRunResult.json.model, null, 'a model that is not a plain name is left out');
  assert.equal(kernel.told[1].input.kind, 'tv', 'no model it can trust and no word in its name: only a TV, never a guess');
  assert.equal(kernel.told[1].input.identity.maker, 'Amazon');
  assert.equal(kernel.told[1].input.identity.model, undefined);
});

test('1.13.0: a read the TV refused records the route as down in its words, and a kernel without the inventory is said in words', async () => {
  kernel.told = []; kernel.refuse = null; kernel.absent = false;
  const tv = await savedTv();
  const failed = JSON.stringify({ ok: false, error: 'not_connected', message: 'The TV did not answer adb on 192.168.1.60. Is it on?' });
  const down = await call('POST', `/devices/${tv.id}/apps/record`, { body: { reply: failed } });
  assert.equal(down.status, 200);
  assert.deepEqual([down.json.ok, down.json.error, down.json.apps], [false, 'not_connected', []]);
  assert.ok((await call('GET', `/devices/${tv.id}`)).json.history.some((event) => event.action === 'tv_apps_recorded' && !event.ok && event.exitCode === 1 && event.summary === 'the read failed: not_connected'), 'an actual failed read remains recorded in its words');
  assert.deepEqual(kernel.told[0].input, {
    key: tv.id, name: 'Office TV', kind: 'tv',
    routes: [{ kind: 'adb', via: NODE, state: 'down', detail: 'The TV did not answer adb on 192.168.1.60. Is it on?' }]
  }, 'only the route, as down, and only "a TV"; no app, component, count or exact type is claimed');

  kernel.refuse = 'refused: routes[0].via names a computer that is not one of yours';
  const refused = await call('POST', `/devices/${tv.id}/apps/record`, { body: { reply: bridgeLine() } });
  assert.equal(refused.status, 200);
  assert.equal(refused.json.apps.length, 3, 'the apps are still answered');
  assert.deepEqual(refused.json.inventory, { recorded: false, reason: 'refused: routes[0].via names a computer that is not one of yours' });
  kernel.refuse = null;
  kernel.absent = true;
  const older = await call('POST', `/devices/${tv.id}/apps/record`, { body: { reply: bridgeLine() } });
  assert.equal(older.json.inventory.recorded, false);
  assert.match(older.json.inventory.reason, /no executor/);
  kernel.absent = false;
});

test('1.13.0: a phone, an unknown TV, another person\'s TV and a missing or foreign reply are refused in words', async () => {
  kernel.told = []; kernel.refuse = null; kernel.absent = false;
  const tv = await savedTv();
  const phone = await call('POST', '/devices', { body: { name: 'Pixel 9', platform: 'android', form: 'phone', computerNodeId: NODE, address: '192.168.1.42:37123' } });
  const asPhone = await call('POST', `/devices/${phone.json.device.id}/apps/record`, { body: { reply: bridgeLine() } });
  assert.deepEqual([asPhone.status, asPhone.json.error], [400, 'not_android_tv']);
  assert.equal((await call('POST', '/devices/no-such-tv/apps/record', { body: { reply: bridgeLine() } })).status, 404);
  assert.equal((await call('POST', `/devices/${tv.id}/apps/record`, { person: 'bob', body: { reply: bridgeLine() } })).status, 404, 'another person\'s TV reads as none');
  const missing = await call('POST', `/devices/${tv.id}/apps/record`, { body: {} });
  assert.deepEqual([missing.status, missing.json.error], [400, 'reply_required']);
  assert.match(missing.json.message, /one JSON line/);
  const foreign = await call('POST', `/devices/${tv.id}/apps/record`, { body: { reply: JSON.stringify({ ok: true, verb: 'lan-control', action: 'now_playing' }) } });
  assert.deepEqual([foreign.status, foreign.json.error], [400, 'reply_invalid']);
  assert.equal(kernel.told.length, 0, 'nothing refused reaches the kernel');
});
