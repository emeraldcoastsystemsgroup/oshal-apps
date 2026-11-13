/**
 * CHANGE LOG
 * SEQ | AUTHOR | DESCRIPTION
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Exercise the mounted native relay routes over HTTP, their closed tools and existing own-scope catalog; native intent admission is an explicit fixture boundary.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const PKG = path.resolve(__dirname, '..');
const yaml = (() => {
  for (const candidate of [path.resolve(PKG, '../scripts/toolchain/node_modules/js-yaml'), 'js-yaml']) {
    try { return require(candidate); } catch { /* use the installed test toolchain */ }
  }
  throw new Error('js-yaml is required: install the store test toolchain');
})();
const { createPhoneControlRoutes } = require('../routes/phone-control-routes.js');
const store = require('../lib/db.js');
const manifest = yaml.load(fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8'));
const catalog = yaml.load(fs.readFileSync(path.join(PKG, 'authorization.yaml'), 'utf8'));
const TARGET = 'node-22222222-2222-4222-8222-222222222222';
const BINDING = 'a3333333-3333-4333-8333-333333333333';
const OPEN = `/relay-bindings/${BINDING}/open-orbit`;
const LIST_TOOL = 'phone-control-relay-bindings';
const OPEN_TOOL = 'phone-control-relay-open-orbit';
const RANK = { viewer: 1, editor: 2, admin: 3 };

function bindingFor(method, pathname) {
  const parts = pathname.split('/');
  const found = catalog.bindings.http.filter((binding) => binding.method === method
    && binding.path.split('/').length === parts.length
    && binding.path.split('/').every((part, i) => part === parts[i] || part.startsWith(':') && parts[i]));
  return found.length === 1 ? found[0] : null;
}

function admitted(role, binding) {
  const granted = catalog.roles[role];
  return binding && granted && binding.allOf.every((name) => granted.grants
    .some((grant) => grant.permission === name && grant.scope === 'own')
    && RANK[granted.tier] >= RANK[catalog.permissions[name].minimumTier]);
}

function answerFor(state, req, res) {
  const caller = req.headers['x-test-person'] || 'alice';
  state.actor = caller === 'none' ? null : { isActive: true, issuer: 'https://issuer.example', sub: caller };
  if (state.guard && !admitted(req.headers['x-test-role'] || 'operator', bindingFor(req.method, req.url.split('?')[0]))) {
    res.statusCode = 403;
    return res.end(JSON.stringify({ error: 'application_resource_denied' }));
  }
  state.router.handle(req, res, () => { res.statusCode = 404; res.end('{}'); });
}

async function fixture(t, { guard = false, intent = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-native-relay-test-'));
  const db = store.getDatabase(path.join(dir, 'fixture.sqlite'));
  const state = { actor: null, calls: [], result: {}, error: null, guard, db };
  const ctx = { appPackageDir: PKG, db, authorization: { currentActor: () => state.actor, registerResource() {} } };
  if (intent) ctx.intent = async (name, input) => {
    state.calls.push({ name, input, owner: state.actor?.sub });
    if (state.error) throw state.error;
    return state.result;
  };
  state.router = createPhoneControlRoutes(ctx);
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      req.body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
      answerFor(state, req, res);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  state.base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return state;
}

async function call(state, method, route, body, headers = {}) {
  const response = await fetch(state.base + route, { method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}

test('actual mounted GET lists native bindings unchanged, without a local device lookup', async (t) => {
  const state = await fixture(t);
  state.result = { version: 1, checked_at_ms: 1000, bindings: [{ target_device_id: TARGET, binding_id: BINDING,
    relay_node_id: '11111111-1111-4111-8111-111111111111', target_name: 'TV', relay_name: 'Phone',
    state: 'active', expires_at_ms: 2000 }] };
  const answer = await call(state, 'GET', '/relay-bindings');
  assert.equal(answer.status, 200, 'the actual mounted native bindings route must exist');
  assert.deepEqual(answer.body, state.result);
  assert.deepEqual(state.calls, [{ name: 'device.relay.bindings', input: {}, owner: 'alice' }]);
  assert.deepEqual(store.listPhones(state.db, { issuer: 'https://issuer.example', sub: 'alice' }), []);
});

test('both native relay tools are declared with closed canonical input schemas', () => {
  const list = manifest.tools.find((tool) => tool.name === LIST_TOOL);
  const open = manifest.tools.find((tool) => tool.name === OPEN_TOOL);
  assert.ok(list, 'native relay bindings tool is absent');
  assert.ok(open, 'native Open Orbit tool is absent');
  assert.equal(list.executor.apiEndpoint, 'GET /api/phone-control/relay-bindings');
  assert.deepEqual(list.inputSchema.properties, {});
  assert.equal(list.inputSchema.additionalProperties, false);
  assert.equal(open.executor.apiEndpoint, 'POST /api/phone-control/relay-bindings/{input.binding_id}/open-orbit');
  assert.deepEqual(open.inputSchema.required.slice().sort(), ['binding_id', 'target_device_id']);
  assert.deepEqual(Object.keys(open.inputSchema.properties).sort(), ['binding_id', 'target_device_id']);
  assert.equal(open.inputSchema.additionalProperties, false);
  assert.match(TARGET, new RegExp(open.inputSchema.properties.target_device_id.pattern));
  assert.match(BINDING, new RegExp(open.inputSchema.properties.binding_id.pattern));
  for (const tool of [list, open]) {
    assert.equal(tool.executor.executorType, 'api');
    assert.equal(tool.computerPlan, undefined);
    assert.equal(tool.requiresApproval, false, 'native current scope and existing active binding own this bounded action');
  }
});

test('the manifest explicitly admits the native host intent capability', () => {
  assert.ok(manifest.uses.includes('intent.run'), 'the actual native CtxHost intent gate requires intent.run');
});

test('actual mounted POST forwards only the exact canonical selection and native evidence', async (t) => {
  const state = await fixture(t);
  state.result = { attempt_id: '44444444-4444-4444-8444-444444444444', issued_at_ms: 1000,
    transport: 'acknowledged', tv_receipt: 'unverified', observation: { status: 'unknown', reason: 'no fresh frame' },
    playback: 'unverified' };
  const answer = await call(state, 'POST', OPEN, { target_device_id: TARGET });
  assert.equal(answer.status, 200);
  assert.deepEqual(answer.body, state.result, 'transport acknowledgement is not fabricated opening or playback');
  assert.deepEqual(state.calls, [{ name: 'device.relay.open_orbit', input: { target_device_id: TARGET, binding_id: BINDING }, owner: 'alice' }]);
  assert.deepEqual(store.listHistory(state.db, { issuer: 'https://issuer.example', sub: 'alice' }), []);
});

test('actual declared tool rendering admits its exact binding echo without allowing a different binding', async (t) => {
  const state = await fixture(t);
  state.result = { attempt_id: '44444444-4444-4444-8444-444444444444', issued_at_ms: 1000,
    transport: 'unknown', tv_receipt: 'unverified', observation: { status: 'unknown' }, playback: 'unverified' };
  const tool = manifest.tools.find((entry) => entry.name === OPEN_TOOL);
  const input = { binding_id: BINDING, target_device_id: TARGET };
  const route = tool.executor.apiEndpoint.split(' ')[1].replace('{input.binding_id}', encodeURIComponent(input.binding_id))
    .slice('/api/phone-control'.length);
  assert.equal((await call(state, 'POST', route, input)).status, 200, 'native tool dispatch posts the entire declared input');
  assert.deepEqual(state.calls[0].input, input);
  assert.equal((await call(state, 'POST', route, { ...input, binding_id: 'b3333333-3333-4333-8333-333333333333' })).status, 400);
  assert.equal(state.calls.length, 1);
});

test('binding and target are mandatory even when there could be only one route', async (t) => {
  const state = await fixture(t);
  for (const body of [{}, null, [], { target_device_id: '' }]) {
    assert.equal((await call(state, 'POST', OPEN, body)).status, 400);
  }
  assert.equal((await call(state, 'POST', '/relay-bindings/open-orbit', { target_device_id: TARGET })).status, 404);
  assert.deepEqual(state.calls, []);
});

test('native IDs never accept legacy phone IDs, names, URLs or normalized UUID alternatives', async (t) => {
  const state = await fixture(t);
  for (const target of ['tv', 'Den TV', BINDING, TARGET.toUpperCase(), ` ${TARGET}`, `${TARGET}/`, 'https://tv.example/']) {
    assert.equal((await call(state, 'POST', OPEN, { target_device_id: target })).status, 400, target);
  }
  for (const binding of ['tv', BINDING.toUpperCase(), `${BINDING} `, `node-${BINDING}`]) {
    const route = `/relay-bindings/${encodeURIComponent(binding)}/open-orbit`;
    assert.equal((await call(state, 'POST', route, { target_device_id: TARGET })).status, 400, binding);
  }
  assert.deepEqual(state.calls, []);
});

test('query and body accept no hidden owner, operation, request ID, hop or alternate action', async (t) => {
  const state = await fixture(t);
  for (const key of ['binding_id', 'request_id', 'operation', 'relay_node_id', 'url', 'test', 'computerNodeId', 'retry', 'steps']) {
    assert.equal((await call(state, 'POST', OPEN, { target_device_id: TARGET, [key]: 'x' })).status, 400, key);
  }
  for (const route of ['/relay-bindings?state=active', OPEN + '?binding_id=' + BINDING]) {
    assert.equal((await call(state, route.startsWith(OPEN) ? 'POST' : 'GET', route,
      route.startsWith(OPEN) ? { target_device_id: TARGET } : undefined)).status, 400);
  }
  assert.deepEqual(state.calls, []);
});

test('existing kernel-caller middleware refuses an absent identity and foreign scope before native intent', async (t) => {
  const state = await fixture(t);
  assert.equal((await call(state, 'GET', '/relay-bindings', undefined, { 'x-test-person': 'none' })).status, 401);
  for (const [route, body] of [['/relay-bindings?owner=bob', undefined], [OPEN, { target_device_id: TARGET, ownerSub: 'bob' }]]) {
    assert.equal((await call(state, body ? 'POST' : 'GET', route, body)).status, 400);
  }
  assert.deepEqual(state.calls, []);
});

test('catalog uses only existing Own execution permissions and matching route/tool requirements', () => {
  const read = ['execution.view', 'execution.read'];
  const operate = ['execution.view', 'execution.operate'];
  assert.deepEqual(bindingFor('GET', '/relay-bindings')?.allOf, read);
  assert.deepEqual(bindingFor('POST', OPEN)?.allOf, operate);
  assert.deepEqual(catalog.bindings.tools.find((entry) => entry.id === LIST_TOOL)?.allOf, read);
  assert.deepEqual(catalog.bindings.tools.find((entry) => entry.id === OPEN_TOOL)?.allOf, operate);
  assert.deepEqual(Object.keys(catalog.resources).sort(), ['configuration', 'execution']);
  for (const role of Object.values(catalog.roles)) assert.ok(role.grants.every((grant) => grant.scope === 'own'));
});

test('actual routes behind the fixture catalog door retain role and person boundaries', async (t) => {
  const state = await fixture(t, { guard: true });
  state.result = { version: 1, checked_at_ms: 1000, bindings: [] };
  for (const role of ['viewer', 'reader']) {
    assert.equal((await call(state, 'GET', '/relay-bindings', undefined, { 'x-test-role': role })).status, 403);
    assert.equal((await call(state, 'POST', OPEN, { target_device_id: TARGET }, { 'x-test-role': role })).status, 403);
  }
  assert.equal(state.calls.length, 0);
  for (const person of ['alice', 'bob']) {
    assert.equal((await call(state, 'GET', '/relay-bindings', undefined, { 'x-test-person': person })).status, 200);
    assert.equal(state.calls.at(-1).owner, person);
  }
});

test('missing native port refuses instead of preparing a Linux command or another action', async (t) => {
  const state = await fixture(t, { intent: false });
  for (const [method, route, body] of [['GET', '/relay-bindings'], ['POST', OPEN, { target_device_id: TARGET }]]) {
    const answer = await call(state, method, route, body);
    assert.equal(answer.status, 503);
    assert.equal(answer.body.error, 'native_relay_unavailable');
    assert.equal(answer.body.ok, undefined);
  }
});

test('a native refusal or lost answer is not retried, claimed successful or leaked as raw error text', async (t) => {
  const state = await fixture(t);
  state.error = new Error('private-native-detail must never be echoed');
  const answer = await call(state, 'POST', OPEN, { target_device_id: TARGET });
  assert.equal(answer.status, 503);
  assert.equal(answer.body.error, 'native_relay_refused');
  assert.doesNotMatch(JSON.stringify(answer.body), /private-native-detail|command|computerRunRequest/);
  assert.equal(state.calls.length, 1);
  assert.match(answer.body.message, /not.*retry|do not retry/i);
});

test('native terminal refusals and unknown receipts pass through without invented execution history', async (t) => {
  const state = await fixture(t);
  state.result = { error: 'binding_expired', refused: 'device_unavailable' };
  assert.deepEqual((await call(state, 'POST', OPEN, { target_device_id: TARGET })).body, state.result);
  assert.equal(state.calls.length, 1);
  assert.deepEqual(store.listHistory(state.db, { issuer: 'https://issuer.example', sub: 'alice' }), []);
});

test('an empty or malformed native answer cannot become HTTP success', async (t) => {
  const state = await fixture(t);
  for (const result of [null, undefined, 'ok', [], 42, {}]) {
    state.result = result;
    const answer = await call(state, 'POST', OPEN, { target_device_id: TARGET });
    assert.equal(answer.status, 502);
    assert.equal(answer.body.error, 'native_relay_response_invalid');
  }
  assert.equal(state.calls.length, 6, 'each explicit fixture request invokes only once');
});
