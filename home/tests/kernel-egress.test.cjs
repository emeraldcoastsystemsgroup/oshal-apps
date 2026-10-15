/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Under the native kernel (OSHAL_EGRESS=kernel) /refresh, /control and /scene/run call api.smartthings.com with no
 *   Authorization header and map the answer as before; a kernel "not connected" refusal, or connection metadata with no usable
 *   smartthings connection, answers each route's own 409; the legacy path still sends the brokered token; the manifest declares the host.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SUB = 'alice';
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'home-kernel-egress-'));
fs.mkdirSync(path.join(DATA, SUB));
fs.writeFileSync(path.join(DATA, SUB, 'devices.json'), JSON.stringify({
  devices: [{ key: 'porch-light', name: 'Porch Light', sources: [{ hub: 'smartthings', deviceId: 'dev-porch' }] }], deviceCount: 1,
}));
fs.writeFileSync(path.join(DATA, SUB, 'scenes.json'), JSON.stringify({
  scenes: [{ key: 'evening', name: 'Evening', steps: [{ device: 'porch-light', cmd: 'on' }, { device: 'porch-light', cmd: 'set', arg: '40' }] }],
}));
process.env.OSHAL_HOME_DATA_DIR = DATA;

// Framework modules the compiled routes import at load; the broker records every token lookup.
const brokerCalls = [];
const broker = { getValidAccessToken: async (_pool, sub, provider) => { brokerCalls.push([sub, provider]); return broker.token; }, token: null };
const STUBS = {
  express: { Router: () => { const routes = {}; const add = (m) => (p, f) => { routes[`${m} ${p}`] = f; }; return { routes, get: add('GET'), post: add('POST'), delete: add('DELETE') }; } },
  '@/shared/logger': { createChildLogger: () => ({ error() {}, info() {}, warn() {} }) },
  '@/features/agent-management': { BotNodeClient: class {}, createRegistryEndpointResolver: () => ({}) },
  '@/app/routes/connectors-routes': broker,
  '@/app/home-schedule-dispatch': { getHomeScheduleService: () => null },
  '@/shared/utils/sun-times': { nextSunEvent: () => null },
  '@/app/routes/inline-bot-execution': { executeBotOrInline: async () => assert.fail('no model call expected') },
  '@/shared/security/explicit-write-confirmation': {
    hasExplicitWriteConfirmation: (body) => body?.confirm === true,
    confirmationRequiredPayload: (code) => ({ error: 'confirmation_required', code }),
  },
};
const original = Module._load;
Module._load = function (request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  if (request.startsWith('@/')) throw new Error(`unexpected framework import ${request}`);
  return original.call(this, request, ...rest);
};
const { createHomeRoutes } = require('../routes/home-routes.js');
test.after(() => { Module._load = original; fs.rmSync(DATA, { recursive: true, force: true }); });

const ALLOWED = new Set(['accept', 'accept-language', 'content-type', 'user-agent', 'if-none-match', 'if-modified-since', 'x-requested-with', 'cache-control', 'range']);
const req = (body) => ({ oidc: { user: { sub: SUB }, isAuthenticated: () => true }, body });
function res() { return { statusCode: 200, setHeader() {}, status(n) { this.statusCode = n; return this; }, json(b) { this.body = b; } }; }
const connected = { connections: [{ id: 'c1', provider: 'smartthings', revoked: false, expires_at_ms: Date.now() - 1000, renewable: true }] };

function routes(meta) {
  const intents = [];
  const ctx = { pool: {}, appPackageDir: DATA };
  if (meta !== undefined) ctx.intent = async (name, input) => { intents.push([name, input]); if (meta instanceof Error) throw meta; return meta; };
  return { r: createHomeRoutes(ctx).routes, intents };
}

async function withFetch(kernel, reply, run) {
  const calls = [];
  const saved = globalThis.fetch;
  if (kernel) process.env.OSHAL_EGRESS = 'kernel';
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (reply instanceof Error) throw reply;
    return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status || 200, headers: { 'content-type': 'application/json' } });
  };
  try { await run(calls); } finally { globalThis.fetch = saved; delete process.env.OSHAL_EGRESS; }
}

function assertKernelRequest(call, method, pathname) {
  const url = new URL(call.url);
  assert.equal(url.protocol, 'https:');
  assert.equal(url.host, 'api.smartthings.com');
  assert.equal(url.pathname, pathname);
  assert.equal(url.search, '', 'no key in the URL');
  assert.equal((call.init.method || 'GET').toUpperCase(), method);
  for (const h of Object.keys(call.init.headers || {})) assert.ok(ALLOWED.has(h.toLowerCase()), `header ${h} is one the kernel accepts`);
}

test('kernel refresh reads the declared SmartThings host with no auth header and maps the device index', async () => {
  brokerCalls.length = 0;
  const { r, intents } = routes(connected);
  const items = [{ deviceId: 'dev-porch', label: 'Porch Light', roomId: 'room-1', components: [{ capabilities: [{ id: 'switch' }, { id: 'switchLevel' }] }] }, { label: 'No id' }];
  await withFetch(true, { body: { items } }, async (calls) => {
    const out = res();
    await r['POST /refresh'](req({}), out);
    assert.equal(out.statusCode, 200);
    assert.equal(calls.length, 1);
    assertKernelRequest(calls[0], 'GET', '/v1/devices');
    assert.deepEqual(Object.keys(calls[0].init.headers), []);
    assert.equal(out.body.deviceCount, 1);
    assert.deepEqual(out.body.devices[0], { key: 'porch-light', name: 'Porch Light', userName: null, room: 'room-1', capabilities: ['switch', 'switchLevel'], switch: null, sources: [{ hub: 'smartthings', deviceId: 'dev-porch', label: 'Porch Light' }] });
  });
  assert.deepEqual(intents, [['connectors.metadata', {}]]);
  assert.deepEqual(brokerCalls, [], 'the legacy broker is never asked under the kernel');
});

test('kernel control and scene run send the commands with only content-type', async () => {
  const { r } = routes(connected);
  await withFetch(true, { body: {} }, async (calls) => {
    const out = res();
    await r['POST /control'](req({ device: 'porch-light', cmd: 'on', confirm: true }), out);
    assert.equal(out.statusCode, 200);
    assert.deepEqual(out.body, { ok: true, device: 'porch-light', cmd: 'on' });
    assertKernelRequest(calls[0], 'POST', '/v1/devices/dev-porch/commands');
    assert.deepEqual(calls[0].init.headers, { 'Content-Type': 'application/json' });
    assert.deepEqual(JSON.parse(calls[0].init.body), { commands: [{ component: 'main', capability: 'switch', command: 'on' }] });
    const scene = res();
    await r['POST /scene/run'](req({ name: 'Evening', confirm: true }), scene);
    assert.deepEqual(scene.body, { ok: true, ran: 'Evening', steps: 2 });
    assert.equal(calls.length, 3);
    for (const c of calls.slice(1)) assertKernelRequest(c, 'POST', '/v1/devices/dev-porch/commands');
    assert.deepEqual(JSON.parse(calls[2].init.body).commands[0], { component: 'main', capability: 'switchLevel', command: 'setLevel', arguments: [40] });
  });
  assert.deepEqual(brokerCalls, []);
});

test('kernel "not connected" answers each route its own 409', async () => {
  const refusal = Object.assign(new Error('smartthings is not connected: connect it on Utilities or set OSHAL_CONNECTOR_SECRET_SMARTTHINGS for the installation'), { code: 'native_executor_unavailable' });
  const cases = [
    ['POST /refresh', {}, 'SmartThings not connected — connect it at /utilities'],
    ['POST /control', { device: 'porch-light', cmd: 'off', confirm: true }, 'SmartThings not connected — connect it at /utilities'],
    ['POST /scene/run', { name: 'evening', confirm: true }, 'SmartThings not connected'],
  ];
  const now = Date.now();
  const metas = [
    [undefined, true], // no intent (unknown): the request runs and the kernel refusal decides
    [new Error('intent refused'), true],
    [connected, true],
    [{ connections: [{ provider: 'github', revoked: false }] }, false],
    [{ connections: [{ provider: 'smartthings', revoked: true }] }, false],
    [{ connections: [{ provider: 'smartthings', revoked: false, expires_at_ms: now - 1000, renewable: false }] }, false],
  ];
  for (const [route, body, message] of cases) {
    for (const [meta, fetches] of metas) {
      const { r } = routes(meta);
      await withFetch(true, refusal, async (calls) => {
        const out = res();
        await r[route](req(body), out);
        assert.equal(out.statusCode, 409, `${route} answers 409`);
        assert.deepEqual(out.body, { error: message });
        assert.equal(calls.length, fetches ? 1 : 0, `${route} reaches the provider only when the metadata allows`);
      });
    }
  }
  assert.deepEqual(brokerCalls, []);
});

test('a SmartThings failure under the kernel stays a 502, not a not-connected answer', async () => {
  const { r } = routes(connected);
  await withFetch(true, { status: 500, body: { error: 'down' } }, async () => {
    const out = res();
    await r['POST /refresh'](req({}), out);
    assert.equal(out.statusCode, 502);
    assert.match(out.body.error, /^smartthings 500/);
  });
});

test('the legacy path still sends the brokered token and answers 409 without one', async () => {
  brokerCalls.length = 0;
  const { r, intents } = routes(connected);
  broker.token = 'tok-legacy';
  await withFetch(false, { body: { items: [] } }, async (calls) => {
    const out = res();
    await r['POST /control'](req({ device: 'porch-light', cmd: 'on', confirm: true }), out);
    assert.equal(out.statusCode, 200);
    assert.deepEqual(calls[0].init.headers, { Authorization: 'Bearer tok-legacy', 'Content-Type': 'application/json' });
    const refresh = res();
    await r['POST /refresh'](req({}), refresh);
    assert.deepEqual(calls[1].init.headers, { Authorization: 'Bearer tok-legacy' });
  });
  broker.token = null;
  await withFetch(false, { body: {} }, async (calls) => {
    const out = res();
    await r['POST /scene/run'](req({ name: 'evening', confirm: true }), out);
    assert.equal(out.statusCode, 409);
    assert.deepEqual(out.body, { error: 'SmartThings not connected' });
    assert.equal(calls.length, 0);
  });
  assert.deepEqual(brokerCalls, [[SUB, 'smartthings'], [SUB, 'smartthings'], [SUB, 'smartthings']]);
  assert.deepEqual(intents, [], 'connection metadata is a kernel-only read');
});

test('the manifest declares the SmartThings host with the smartthings Bearer credential', () => {
  const manifest = fs.readFileSync(path.join(__dirname, '..', 'oshal-app.yaml'), 'utf8');
  const block = /\negress:\n((?:  .*\n)+)/.exec(manifest);
  assert.ok(block, 'egress block present');
  assert.match(block[1], /- host: api\.smartthings\.com\n {4}credential: \{ connector: smartthings, header: authorization, prefix: "Bearer " \}/);
});
