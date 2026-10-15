/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Under the native kernel (OSHAL_EGRESS=kernel) the compiled social routes, loaded with the bridge's own
 *   inert stand-ins for the framework broker, connector tenancy and connector runtime, send every X, LinkedIn and Facebook profile
 *   request to its declared host with no Authorization header and no access_token, map the answers to the routes' rows, read the X
 *   user id from GET /2/users/me instead of the connection table, answer a missing, lapsed or kernel-refused connection with the
 *   same 409 no_twitter_connection, and read the Facebook readiness from the connection metadata. Outside the kernel the broker token
 *   still travels as a Bearer header and a Graph access_token. The manifest declares each host with its connector.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');

const brokerCalls = [];
const sqlCalls = [];
const blocked = (name) => () => { throw Object.assign(new Error(`${name} is unavailable natively`), { code: 'native_executor_unavailable' }); };
// What the native bridge hands this package for the framework modules (crates/host-process/bridge): the broker answers null,
// connection rows are not accessible and the connector runtime is refused. A kernel path that still leaned on any of them would
// say "not connected" for a connected caller.
const STUBS = {
  express: { Router: () => { const routes = {}; const add = (m) => (p, ...h) => { routes[`${m} ${p}`] = h[h.length - 1]; }; return { routes, get: add('GET'), post: add('POST') }; } },
  '@/shared/logger': { createChildLogger: () => ({ error() {}, info() {}, warn() {}, debug() {} }) },
  '@/features/agent-management': { BotNodeClient: class {}, createRegistryEndpointResolver: () => ({}) },
  '@/app/routes/connectors-routes': { getValidAccessToken: async (_pool, sub, provider) => { brokerCalls.push([sub, provider]); return process.env.OSHAL_EGRESS ? null : 'legacy-token'; } },
  '@/app/routes/connector-tenancy': { resolveConnectionRow: async () => null },
  '@/app/connectors/runtime': {
    loadConnectorSpec: blocked('connectors.loadConnectorSpec'), resolveConnectorActionCreds: blocked('connectors.resolveConnectorActionCreds'),
    runConnectorAction: blocked('connectors.runConnectorAction'),
  },
  '@/app/routes/inline-bot-execution': { executeBotOrInline: async () => ({ response: 'draft' }) },
  '@/shared/security/explicit-write-confirmation': {
    hasExplicitWriteConfirmation: (b) => Boolean(b && b.confirm === true),
    confirmationRequiredPayload: (guard, action) => ({ error: 'confirmation_required', guard, message: `${action} requires confirm` }),
  },
};
const original = Module._load;
Module._load = function (request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  if (request.startsWith('@/')) throw new Error(`unexpected framework import ${request}`);
  return original.call(this, request, ...rest);
};
const { createSocialRoutes } = require('../routes/social-routes.js');
test.after(() => { Module._load = original; });

/** A JSON Response the way the bridge's egress fetch builds one. */
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
/** The kernel's refusal for a caller with no connection. */
const notConnected = (id) => Object.assign(new Error(`${id} is not connected: connect it on Utilities or set OSHAL_CONNECTOR_SECRET_${id.toUpperCase()} for the installation`), { code: 'native_executor_unavailable' });

/**
 * Drive one route with a scripted fetch and connection metadata.
 * @param route - "GET /profiles" etc.
 * @param meta - connectors.metadata answer, or undefined for a context without the intent.
 * @param answer - (url, init) => Response | Error.
 */
async function call(route, { meta, answer, body, params = {}, kernel = true, rows = [] } = {}) {
  const calls = [];
  const saved = globalThis.fetch;
  if (kernel) process.env.OSHAL_EGRESS = 'kernel'; else delete process.env.OSHAL_EGRESS;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const reply = answer(String(url), init);
    if (reply instanceof Error) throw reply;
    return reply;
  };
  const pool = { query: async (text, values) => { sqlCalls.push(text); return { rows: typeof rows === 'function' ? rows(text, values) : rows }; } };
  const ctx = { pool, ...(meta === undefined ? {} : { intent: async (name) => { assert.equal(name, 'connectors.metadata'); return meta; } }) };
  const res = { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(b) { this.body = b; }, send(b) { this.body = b; } };
  try {
    await createSocialRoutes(ctx).routes[route]({ oidc: { user: { sub: 'alice' } }, query: {}, params, body }, res);
  } finally {
    globalThis.fetch = saved;
    delete process.env.OSHAL_EGRESS;
  }
  return { res, calls };
}

/** Every request carried only package headers: no credential of any kind. */
function assertNoCredential(calls) {
  for (const { url, init } of calls) {
    const names = Object.keys(init.headers || {}).map((h) => h.toLowerCase());
    assert.ok(!names.includes('authorization') && !names.includes('cookie'), `${url} carries ${names.join(',')}`);
    assert.ok(!/access_token|api_key/.test(url), `${url} carries a key`);
    assert.ok(!/access_token/.test(String(init.body || '')), `${url} carries a key in its body`);
  }
}

const now = Date.now();
const CONNECTED = { connections: [
  { provider: 'twitter', revoked: false, expires_at_ms: now - 1000, renewable: true },
  { provider: 'linkedin', revoked: false, expires_at_ms: now + 60_000, renewable: false },
  { provider: 'meta-business', revoked: false, expires_at_ms: null },
] };

test('an approved X post goes to api.twitter.com with no credential and maps the tweet id', async () => {
  brokerCalls.length = 0;
  const { res, calls } = await call('POST /post', { meta: CONNECTED, body: { text: 'Hello X', target: 'twitter', confirm: true },
    answer: () => json({ data: { id: 't1', text: 'Hello X' } }, 201) });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, target: 'twitter', tweetId: 't1' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.twitter.com/2/tweets');
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].init.body), { text: 'Hello X' });
  assert.deepEqual(calls[0].init.headers, { 'Content-Type': 'application/json' });
  assertNoCredential(calls);
  assert.deepEqual(brokerCalls, [], 'the framework broker is never consulted under the kernel');
});

test('the X timeline reads the user id from /2/users/me, not the connection table, and maps the stream', async () => {
  sqlCalls.length = 0;
  const { res, calls } = await call('GET /twitter/timeline', { meta: CONNECTED, answer: (url) => (url === 'https://api.twitter.com/2/users/me'
    ? json({ data: { id: '42', username: 'alice' } })
    : json({ data: [{ id: 'p1', text: 'Morning', created_at: '2026-10-10T08:00:00Z', public_metrics: { like_count: 3, retweet_count: 1, reply_count: 2 } }] })) });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { timeline: [{ id: 'p1', text: 'Morning', createdAt: '2026-10-10T08:00:00Z', likes: 3, retweets: 1, replies: 2 }] });
  assert.deepEqual(calls.map((c) => new URL(c.url).pathname), ['/2/users/me', '/2/users/42/timelines/reverse_chronological']);
  assert.ok(calls.every((c) => new URL(c.url).host === 'api.twitter.com'));
  assertNoCredential(calls);
  assert.deepEqual(sqlCalls, [], 'oshal_connections is not read under the kernel');
});

test('a confirmed X follow resolves the handle and follows through api.twitter.com with no credential', async () => {
  const { res, calls } = await call('POST /twitter/follow', { meta: CONNECTED, body: { username: '@bob', confirm: true }, answer: (url) => {
    if (url.endsWith('/2/users/me')) return json({ data: { id: '42' } });
    if (url.endsWith('/2/users/by/username/bob')) return json({ data: { id: '77' } });
    return json({ data: { following: true, pending_follow: false } });
  } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, followed: '@bob', targetId: '77' });
  assert.equal(calls[2].url, 'https://api.twitter.com/2/users/42/following');
  assert.deepEqual(JSON.parse(calls[2].init.body), { target_user_id: '77' });
  assertNoCredential(calls);
});

test('GET /profiles reads LinkedIn, Facebook and X from their declared hosts with no credential', async () => {
  const { res, calls } = await call('GET /profiles', { meta: CONNECTED, answer: (url) => {
    if (url.startsWith('https://api.linkedin.com/')) return json({ sub: 'li-1', name: 'Alice L' });
    if (url.startsWith('https://graph.facebook.com/')) return json({ id: 'fb-1', name: 'Alice F' });
    return json({ data: { id: '42', username: 'alice', name: 'Alice X' } });
  } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.profiles, {
    linkedin: { sub: 'li-1', name: 'Alice L' }, facebook: { id: 'fb-1', name: 'Alice F' }, twitter: { data: { id: '42', username: 'alice', name: 'Alice X' } },
  });
  assert.deepEqual(calls.map((c) => c.url), [
    'https://api.linkedin.com/v2/userinfo',
    'https://graph.facebook.com/v21.0/me?fields=id,name',
    'https://api.twitter.com/2/users/me?user.fields=username,name,public_metrics',
  ]);
  assertNoCredential(calls);
  const only = await call('GET /profiles', { meta: { connections: [{ provider: 'linkedin' }] }, answer: () => json({ sub: 'li-1' }) });
  assert.deepEqual(only.calls.map((c) => new URL(c.url).host), ['api.linkedin.com'], 'an unconnected provider is not asked');
});

test('missing, lapsed and kernel-refused X connections answer the same 409 no_twitter_connection', async () => {
  const NO_X = { error: 'no_twitter_connection', message: 'Connect X at /utilities first.' };
  let r = await call('POST /post', { meta: { connections: [] }, body: { text: 'x', target: 'twitter', confirm: true }, answer: () => assert.fail('no request without a connection') });
  assert.equal(r.res.statusCode, 409);
  assert.deepEqual(r.res.body, { ok: false, code: 409, ...NO_X });
  r = await call('GET /twitter/timeline', { meta: { connections: [{ provider: 'twitter', revoked: true }] }, answer: () => assert.fail('no request') });
  assert.equal(r.res.statusCode, 409);
  assert.deepEqual(r.res.body, NO_X);
  r = await call('POST /post', { meta: undefined, body: { text: 'x', target: 'twitter', confirm: true }, answer: () => notConnected('twitter') });
  assert.equal(r.res.statusCode, 409);
  assert.deepEqual(r.res.body, { ok: false, code: 409, ...NO_X });
  r = await call('GET /twitter/timeline', { meta: undefined, answer: () => notConnected('twitter') });
  assert.equal(r.res.statusCode, 409);
  assert.deepEqual(r.res.body, NO_X);
  r = await call('POST /twitter/follow', { meta: undefined, body: { username: 'bob', confirm: true }, answer: () => notConnected('twitter') });
  assert.equal(r.res.statusCode, 409);
  assert.deepEqual(r.res.body, NO_X);
});

test('readiness reads the Facebook connections from the metadata under the kernel', async () => {
  sqlCalls.length = 0;
  const meta = { connections: [{ provider: 'meta-business', revoked: false }, { provider: 'facebook', revoked: true }, { provider: 'twitter' }] };
  const { res } = await call('GET /readiness', { meta, rows: [{ n: 3 }], answer: () => assert.fail('readiness makes no provider request') });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.facebook, { ready: true, providers: ['meta-business'], detail: 'Connected (meta-business).' });
  assert.equal(res.body.signals.count, 3);
  assert.ok(sqlCalls.every((text) => !/oshal_connections/.test(text)), 'the connection table is not read under the kernel');
});

test('the Facebook Page legs and LinkedIn publishing make no egress request under the kernel', async () => {
  let r = await call('GET /facebook/pages', { meta: CONNECTED, answer: () => assert.fail('no Page-token request') });
  assert.equal(r.res.statusCode, 409);
  assert.equal(r.res.body.error, 'no_facebook_pages');
  r = await call('POST /post', { meta: CONNECTED, body: { text: 'Hi', target: 'linkedin', confirm: true }, answer: () => assert.fail('no LinkedIn write') });
  assert.equal(r.res.statusCode, 503);
  assert.equal(r.res.body.error, 'channel_unavailable');
});

test('outside the kernel the broker token still travels as a Bearer header and a Graph access_token', async () => {
  brokerCalls.length = 0;
  const post = await call('POST /post', { kernel: false, body: { text: 'Hello X', target: 'twitter', confirm: true }, answer: () => json({ data: { id: 't9' } }, 201) });
  assert.deepEqual(post.res.body, { ok: true, target: 'twitter', tweetId: 't9' });
  assert.equal(post.calls[0].init.headers.Authorization, 'Bearer legacy-token');
  const profiles = await call('GET /profiles', { kernel: false, answer: (url) => json(url.includes('twitter') ? { data: { id: '1' } } : { id: '1' }) });
  assert.equal(profiles.calls[0].init.headers.Authorization, 'Bearer legacy-token');
  assert.equal(profiles.calls[1].url, 'https://graph.facebook.com/v21.0/me?fields=id,name&access_token=legacy-token');
  assert.equal(profiles.calls[2].init.headers.Authorization, 'Bearer legacy-token');
  const timeline = await call('GET /twitter/timeline', { kernel: false, rows: [{ account_id: '42' }], answer: () => json({ data: [] }) });
  assert.equal(timeline.res.statusCode, 200);
  assert.equal(timeline.calls.length, 1, 'the X user id still comes from the connection row');
  assert.equal(new URL(timeline.calls[0].url).pathname, '/2/users/42/timelines/reverse_chronological');
  assert.equal(timeline.calls[0].init.headers.Authorization, 'Bearer legacy-token');
  assert.ok(brokerCalls.length >= 5, 'the broker answered every legacy lookup');
});

test('the manifest declares each host with the connector the routes read it with', () => {
  const manifest = fs.readFileSync(path.join(__dirname, '..', 'oshal-app.yaml'), 'utf8');
  const block = manifest.slice(manifest.indexOf('\negress:'));
  for (const [host, connector] of [['api.twitter.com', 'twitter'], ['api.linkedin.com', 'linkedin'], ['graph.facebook.com', 'meta-business']]) {
    const entry = new RegExp(`- host: ${host.replace(/\./g, '\\.')}\\n\\s+credential: \\{ connector: ${connector}, header: authorization, prefix: "Bearer " \\}`);
    assert.match(block, entry, `${host} is declared with connector ${connector}`);
  }
});
