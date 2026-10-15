/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Under the native kernel (OSHAL_EGRESS=kernel) the compiled Today feed, Inbox and Compose routes, loaded with
 *   the bridge's own inert stand-ins for the framework broker, email and Slack modules, send every Gmail, Calendar, Graph,
 *   Slack and X request to its declared host with no Authorization header and no key in the URL, map the answers to the
 *   board's rows, take connected state from connectors.metadata, and answer a missing connection (metadata or the kernel's
 *   "not connected" refusal) with the package's own not-connected answer. LinkedIn and Facebook publishing answer 501
 *   without a request. Outside the kernel the broker token still travels as a Bearer header.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');

const brokerCalls = [];
const frameworkCalls = [];
const SIBLINGS = ['./switchboard-inbox-routes', './switchboard-calendar-routes', './switchboard-compose-routes', './switchboard-threads-routes',
  './switchboard-stage-routes', './switchboard-reply-outbox-routes', './switchboard-streams-routes'];

/** A fake express Router recording each handler under "METHOD path". */
function fakeRouter() {
  const routes = {};
  const add = (m) => (p, ...h) => { routes[`${m} ${p}`] = h[h.length - 1]; };
  return { routes, get: add('GET'), post: add('POST'), put: add('PUT'), patch: add('PATCH'), delete: add('DELETE'), use() {} };
}

// What the native bridge hands this package for the framework modules (crates/host-process/bridge): the broker answers
// null, the email summarizer is inert and the Slack client is blocked. A kernel path that still leaned on any of them
// would show "not connected" or empty rows.
const STUBS = {
  express: { Router: fakeRouter },
  '@/shared/logger': { createChildLogger: () => ({ error() {}, info() {}, warn() {}, debug() {} }) },
  '@/shared/services/database': { runRuntimeSchemaBootstrap: async () => {}, buildOwnerRlsPolicyStatements: () => [] },
  '@/app/routes/connectors-routes': { getValidAccessToken: async (_pool, sub, provider) => { brokerCalls.push([sub, provider]); return process.env.OSHAL_EGRESS ? null : 'legacy-token'; } },
  '@/app/routes/email-routes': { summarizeGmailMetadata: (id, m) => { frameworkCalls.push(['summarize', id]); return process.env.OSHAL_EGRESS ? {} : { id, from: 'Legacy <l@example.com>', subject: 'Legacy', snippet: '', unread: true, important: false, receivedAt: new Date().toISOString() }; } },
  '@/app/routes/slack-client': {
    slackIdentity: async (token) => { frameworkCalls.push(['slackIdentity', token]); return { ok: true, userId: 'U1' }; },
    pullSlackFeed: async (token, opts) => { frameworkCalls.push(['pullSlackFeed', token, opts]); return { messages: [] }; },
  },
  '@/features/agent-management': { BotNodeClient: class {}, createRegistryEndpointResolver: () => ({}) },
  '@/app/routes/inline-bot-execution': { executeBotOrInline: async () => ({ response: 'draft' }) },
  '@/features/video-generation': { resolveStoryboardImageProvider: async () => ({}), recordStoryboardImageCost: async () => {} },
  '@/shared/security/explicit-write-confirmation': {
    hasExplicitWriteConfirmation: (b) => Boolean(b && b.confirm === true),
    confirmationRequiredPayload: (guard, action) => ({ error: 'confirmation_required', guard, message: `${action} requires confirm` }),
  },
};
let stubSiblings = false;
const original = Module._load;
Module._load = function (request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  if (stubSiblings && SIBLINGS.includes(request)) return new Proxy({}, { get: () => () => fakeRouter() });
  if (request.startsWith('@/')) throw new Error(`unexpected framework import ${request}`);
  return original.call(this, request, ...rest);
};
const { createInboxRoutes } = require('../routes/switchboard-inbox-routes.js');
const { createComposeRoutes } = require('../routes/switchboard-compose-routes.js');
stubSiblings = true;
const { createSwitchboardRoutes } = require('../routes/switchboard-routes.js');
stubSiblings = false;
test.after(() => { Module._load = original; });

/** A JSON Response the way the bridge's egress fetch builds one. */
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const notConnected = (connector) => Object.assign(new Error(`${connector} is not connected: connect it on Utilities or set OSHAL_CONNECTOR_SECRET_${connector.toUpperCase()} for the installation`), { code: 'native_executor_unavailable' });

/** A pool that refuses the framework-owned tables the way the kernel's package SQL does. */
const pool = {
  query: async (text) => {
    if (/oshal_connections|oshal_inbox_messages/.test(String(text))) throw new Error('relation is not one of this package\'s tables');
    return { rows: [], rowCount: 0 };
  },
};

/**
 * Drive one route with a scripted fetch and connection metadata.
 * @param factory - the router factory under test.
 * @param route - "GET /feed" etc.
 */
async function call(factory, route, { meta, answer, query = {}, body, kernel = true } = {}) {
  const calls = [];
  const saved = globalThis.fetch;
  if (kernel) process.env.OSHAL_EGRESS = 'kernel'; else delete process.env.OSHAL_EGRESS;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const reply = answer(String(url), init);
    if (reply instanceof Error) throw reply;
    return reply;
  };
  const legacyPool = { query: async () => ({ rows: [], rowCount: 0 }) };
  const ctx = { pool: kernel ? pool : legacyPool, ...(meta === undefined ? {} : { intent: async (name) => { assert.equal(name, 'connectors.metadata'); return meta; } }) };
  const res = { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(b) { this.body = b; return this; }, send(b) { this.body = b; return this; } };
  try {
    await factory(ctx).routes[route]({ oidc: { user: { sub: 'alice' } }, query, params: {}, body }, res);
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
    assert.ok(names.every((n) => ['accept', 'content-type'].includes(n)), `${url} carries ${names.join(',')}`);
    assert.ok(!/access_token|api_key|token=/.test(url), `${url} carries a key`);
  }
}

const usable = (provider) => ({ id: `c-${provider}`, label: `${provider}@example.com`, provider, shared: false, revoked: false, expires_at_ms: null, renewable: true });
const hosts = (calls) => [...new Set(calls.map((c) => new URL(c.url).host))].sort();

test('the Today feed reads Gmail and Calendar through the kernel egress with no credential and maps the board', async () => {
  brokerCalls.length = 0; frameworkCalls.length = 0;
  const start = new Date(Date.now() + 30 * 60e3).toISOString();
  const { res, calls } = await call(createSwitchboardRoutes, 'GET /feed', {
    meta: { connections: [usable('google')] }, query: { surface: '1' },
    answer: (url) => {
      if (url.startsWith('https://www.googleapis.com/calendar/v3/calendars/primary/events?')) return json({ items: [{ summary: 'Standup', start: { dateTime: start }, attendees: [{}, {}] }] });
      if (url.includes('/messages?q=')) return json({ messages: [{ id: 'm1' }] });
      return json({ id: 'm1', labelIds: ['UNREAD', 'IMPORTANT'], internalDate: String(Date.now() - 600e3), snippet: 'Need this today',
        payload: { headers: [{ name: 'From', value: 'Bob Smith <bob@example.com>' }, { name: 'Subject', value: 'Contract' }] } });
    },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.connected, true);
  const mail = res.body.items.find((i) => i.source === 'gmail');
  assert.deepEqual([mail.id, mail.person, mail.subject, mail.badge], ['m1', 'Bob Smith', 'Contract', 'Time-sensitive']);
  assert.ok(res.body.items.some((i) => i.kind === 'meeting' && i.person === 'Standup'));
  assert.deepEqual(res.body.counts, { needsReply: 1, timeSensitive: 1, meetings: 1, handled: 0 });
  assert.deepEqual(hosts(calls), ['gmail.googleapis.com', 'www.googleapis.com']);
  assert.equal(new URL(calls.find((c) => c.url.includes('?q=')).url).searchParams.get('q'), 'in:inbox newer_than:2d');
  assertNoCredential(calls);
  assert.deepEqual(brokerCalls, [], 'the framework broker is never consulted under the kernel');
  assert.deepEqual(frameworkCalls, [], 'the inert framework summarizer is never used under the kernel');
});

test('the Today feed says connect Google when the metadata has none or the kernel refuses', async () => {
  const connect = { connected: false, message: 'Connect your Google account at /utilities to light up your board.' };
  let r = await call(createSwitchboardRoutes, 'GET /feed', { meta: { connections: [usable('slack')] }, query: { surface: '1' }, answer: () => assert.fail('no request without a connection') });
  assert.deepEqual(r.res.body, connect);
  r = await call(createSwitchboardRoutes, 'GET /feed', { meta: { connections: [{ ...usable('gmail'), revoked: true }] }, answer: () => assert.fail('no request') });
  assert.equal(r.res.statusCode, 409);
  assert.equal(r.res.body.error, 'no_google_connection');
  r = await call(createSwitchboardRoutes, 'GET /feed', { meta: undefined, query: { surface: '1' }, answer: () => notConnected('gmail') });
  assert.deepEqual(r.res.body, connect);
});

test('GET /accounts lists the usable connections from connectors.metadata', async () => {
  const { res } = await call(createSwitchboardRoutes, 'GET /accounts', {
    meta: { connections: [usable('slack'), usable('google'), { ...usable('outlook'), revoked: true }] }, answer: () => assert.fail('no request'),
  });
  assert.deepEqual(res.body.accounts, [
    { connectionId: 'c-google', provider: 'google', label: 'Gmail · google@example.com', email: null },
    { connectionId: 'c-slack', provider: 'slack', label: 'Slack · slack@example.com', email: null },
  ]);
});

/** Scripted Microsoft Graph + Slack Web API answers for the Inbox. */
function inboxAnswer(url) {
  const u = new URL(url);
  if (u.host === 'graph.microsoft.com') {
    return json({ value: [{ id: 'g1', subject: 'Invoice', bodyPreview: 'Due today', from: { emailAddress: { name: 'Ann', address: 'ann@example.com' } }, receivedDateTime: '2026-10-10T12:00:00Z', isRead: false, importance: 'normal' },
      { id: 'g2', subject: 'Read already', from: { emailAddress: { address: 'x@example.com' } }, isRead: true }] });
  }
  const method = u.pathname.replace('/api/', '');
  if (method === 'auth.test') return json({ ok: true, user_id: 'U1' });
  if (method === 'users.conversations') return json({ ok: true, channels: [{ id: 'D1', is_im: true, user: 'U2' }, { id: 'C1', name: 'general' }] });
  if (method === 'conversations.history' && u.searchParams.get('channel') === 'D1') return json({ ok: true, messages: [{ user: 'U2', text: 'ping', ts: '1760000100.0001' }] });
  if (method === 'conversations.history') return json({ ok: true, messages: [{ user: 'U3', text: 'hey <@U1> look', ts: '1760000000.0001' }, { user: 'U3', text: 'unrelated', ts: '1760000050.0001' }, { user: 'U1', text: 'mine <@U1>', ts: '1760000060.0001' }] });
  if (method === 'users.info') return json({ ok: true, user: { profile: { display_name: `name-${u.searchParams.get('user')}` } } });
  return assert.fail(`unexpected ${url}`);
}

test('the Inbox reads Outlook and Slack through the kernel egress with no credential and maps the triage rows', async () => {
  brokerCalls.length = 0; frameworkCalls.length = 0;
  const { res, calls } = await call(createInboxRoutes, 'GET /items', { meta: { connections: [usable('outlook'), usable('slack')] }, query: { surface: '1' }, answer: inboxAnswer });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.connected, true);
  const byId = Object.fromEntries(res.body.items.map((i) => [i.id, i]));
  assert.deepEqual(Object.keys(byId).sort(), ['g1', 'slack-C1-1760000000.0001', 'slack-D1-1760000100.0001']);
  assert.deepEqual([byId.g1.source, byId.g1.person, byId.g1.hot], ['outlook', 'Ann', true]);
  assert.deepEqual([byId['slack-D1-1760000100.0001'].kind, byId['slack-D1-1760000100.0001'].person, byId['slack-D1-1760000100.0001'].subject], ['dm', 'name-U2', 'DM · name-U2']);
  assert.deepEqual([byId['slack-C1-1760000000.0001'].kind, byId['slack-C1-1760000000.0001'].subject], ['mention', 'general']);
  assert.deepEqual(res.body.counts.byChannel, { outlook: 1, slack: 2 });
  assert.deepEqual(hosts(calls), ['graph.microsoft.com', 'slack.com']);
  assert.ok(calls[0].url.startsWith('https://graph.microsoft.com/v1.0/me/messages?$select='));
  assertNoCredential(calls);
  assert.deepEqual(brokerCalls, []);
  assert.deepEqual(frameworkCalls, [], 'the blocked framework slack-client is never used under the kernel');
});

test('the Inbox says connect when the metadata has no source or the kernel refuses each one', async () => {
  const connect = { connected: false, message: 'Connect Gmail, Outlook, or Slack at /utilities to fill your inbox.' };
  let r = await call(createInboxRoutes, 'GET /items', { meta: { connections: [{ ...usable('outlook'), expires_at_ms: Date.now() - 1000, renewable: false }] }, query: { surface: '1' }, answer: () => assert.fail('no request') });
  assert.deepEqual(r.res.body, connect);
  r = await call(createInboxRoutes, 'GET /items', { meta: undefined, answer: (url) => notConnected(new URL(url).host === 'slack.com' ? 'slack' : 'outlook') });
  assert.equal(r.res.statusCode, 409);
  assert.equal(r.res.body.error, 'no_connection');
  r = await call(createInboxRoutes, 'GET /items', { meta: { connections: [usable('slack')] }, query: { surface: '1' }, answer: () => json({ ok: false, error: 'invalid_auth' }) });
  assert.deepEqual([r.res.body.connected, r.res.body.items], [true, []], 'a connected source that fails still counts as connected');
});

test('a confirmed X publish posts the exact text to api.twitter.com with no credential', async () => {
  brokerCalls.length = 0;
  const { res, calls } = await call(createComposeRoutes, 'POST /publish', { body: { platform: 'x', text: 'Hello world', confirm: true }, answer: () => json({ data: { id: 't1' } }, 201) });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, target: 'x', tweetId: 't1' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.twitter.com/2/tweets');
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].init.body), { text: 'Hello world' });
  assertNoCredential(calls);
  assert.deepEqual(brokerCalls, []);
  const refused = await call(createComposeRoutes, 'POST /publish', { body: { platform: 'x', text: 'Hi', confirm: true }, answer: () => notConnected('twitter') });
  assert.equal(refused.res.statusCode, 409);
  assert.deepEqual(refused.res.body, { ok: false, code: 409, error: 'no_twitter_connection', message: 'Connect X at /utilities first.' });
});

test('LinkedIn and Facebook publishing answer 501 under the kernel without any request', async () => {
  for (const [platform, label] of [['linkedin', 'LinkedIn'], ['facebook', 'Facebook']]) {
    const { res, calls } = await call(createComposeRoutes, 'POST /publish', { body: { platform, text: 'Hi', confirm: true }, answer: () => assert.fail('no request') });
    assert.equal(res.statusCode, 501);
    assert.equal(res.body.error, 'publish_unavailable');
    assert.match(res.body.message, new RegExp(`Publishing to ${label} is not available`));
    assert.equal(calls.length, 0);
  }
});

test('Compose targets take connected state from connectors.metadata and mark only X publishable', async () => {
  const { res } = await call(createComposeRoutes, 'GET /targets', { meta: { connections: [usable('twitter'), usable('facebook')] }, query: { workspace: '' }, answer: () => assert.fail('no request') });
  const t = Object.fromEntries(res.body.targets.map((x) => [x.platform, [x.connected, x.publishable]]));
  assert.deepEqual(t, { x: [true, true], linkedin: [false, false], facebook: [true, false], instagram: [true, false], threads: [true, false] });
});

test('outside the kernel the broker token still travels as a Bearer header', async () => {
  brokerCalls.length = 0; frameworkCalls.length = 0;
  let r = await call(createSwitchboardRoutes, 'GET /feed', { kernel: false, answer: (url) => (url.includes('?q=') ? json({ messages: [{ id: 'm1' }] }) : json({ items: [] })) });
  assert.equal(r.res.body.connected, true);
  assert.ok(r.calls.every((c) => c.init.headers.Authorization === 'Bearer legacy-token'));
  assert.deepEqual(frameworkCalls, [['summarize', 'm1']]);
  r = await call(createInboxRoutes, 'GET /items', { kernel: false, answer: () => json({ value: [] }) });
  assert.equal(r.calls[0].init.headers.Authorization, 'Bearer legacy-token');
  assert.deepEqual(frameworkCalls.slice(1).map((c) => c.slice(0, 2)), [['slackIdentity', 'legacy-token'], ['pullSlackFeed', 'legacy-token']]);
  r = await call(createComposeRoutes, 'POST /publish', { kernel: false, body: { platform: 'x', text: 'Hi', confirm: true }, answer: () => json({ data: { id: 't2' } }, 201) });
  assert.deepEqual(r.calls[0].init.headers, { Authorization: 'Bearer legacy-token', 'Content-Type': 'application/json' });
  assert.deepEqual(brokerCalls.map((c) => c[1]), ['google', 'microsoft', 'slack', 'twitter']);
});

test('the manifest declares each host with its connector as a Bearer credential', () => {
  const manifest = fs.readFileSync(path.join(__dirname, '..', 'oshal-app.yaml'), 'utf8');
  for (const [host, connector] of [['gmail.googleapis.com', 'gmail'], ['www.googleapis.com', 'google-calendar'], ['graph.microsoft.com', 'outlook'], ['slack.com', 'slack'], ['api.twitter.com', 'twitter']]) {
    assert.match(manifest, new RegExp(`- host: ${host.replace(/\./g, '\\.')}\\n {4}credential: \\{ connector: ${connector}, header: authorization, prefix: "Bearer " \\}`));
  }
});
