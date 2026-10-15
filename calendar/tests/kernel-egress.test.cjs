/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Under the native kernel (OSHAL_EGRESS=kernel) the explicit sync reads the primary calendar from the declared
 *   host with no Authorization header and stores the same minimized rows; a kernel "not connected" refusal or a 401 answers 409
 *   without a write; the Home summary distinguishes connected-not-synced, not connected and reconnect from connection metadata.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The kernel carries a person's connector credential only for a package that lists that connector in
 *   dependencies.connectors: every egress credential connector this manifest declares is in its (generated) catalog entry.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');

// The compiled routes import express and the framework logger at load; plain stubs stand in, and any other
// framework import is recorded so the kernel path can prove it never reaches the legacy broker.
const attempted = [];
const original = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'express') return { Router: () => { const routes = {}; return { routes, get: (p, f) => { routes.get = f; }, post: (p, f) => { routes.post = f; } }; } };
  if (request === '@/shared/logger') return { createChildLogger: () => ({ error() {}, info() {}, warn() {} }) };
  if (request.startsWith('@/')) { attempted.push(request); throw new Error(`unexpected framework import ${request}`); }
  return original.call(this, request, ...rest);
};
const { createCalendarSyncRoutes } = require('../routes/sync.js');
const { createHomeSummaryRoutes, googleState } = require('../routes/home-summary.js');
test.after(() => { Module._load = original; });

const req = (body) => ({ oidc: { user: { sub: 'alice' }, isAuthenticated: () => true }, body });
function res() { return { statusCode: 200, setHeader() {}, status(n) { this.statusCode = n; return this; }, json(b) { this.body = b; } }; }

async function withKernelFetch(reply, run) {
  const calls = [];
  const saved = globalThis.fetch;
  process.env.OSHAL_EGRESS = 'kernel';
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (reply instanceof Error) throw reply;
    return new Response(JSON.stringify(reply.body), { status: reply.status || 200, headers: { 'content-type': 'application/json' } });
  };
  try { await run(calls); } finally { globalThis.fetch = saved; delete process.env.OSHAL_EGRESS; }
}

test('kernel sync reads the declared Calendar host with no auth header and stores the minimized rows', async () => {
  const writes = [];
  const { post } = createCalendarSyncRoutes({ pool: { query: async (text, values) => { writes.push({ text, values }); } } }).routes;
  const items = [
    { id: 'e1', summary: 'Standup', start: { dateTime: '2026-10-12T14:00:00Z' }, end: { dateTime: '2026-10-12T14:15:00Z' }, htmlLink: 'https://calendar.google.com/e1', description: 'PRIVATE', attendees: [{ email: 'PRIVATE' }] },
    { id: 'e2', start: { date: '2026-10-14' }, end: { date: '2026-10-15' } },
  ];
  await withKernelFetch({ body: { items } }, async (calls) => {
    const r = res();
    await post(req({ confirm: true }), r);
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.count, 2);
    assert.equal(calls.length, 1);
    const url = new URL(calls[0].url);
    assert.equal(url.host, 'www.googleapis.com');
    assert.equal(url.pathname, '/calendar/v3/calendars/primary/events');
    assert.equal(url.searchParams.get('singleEvents'), 'true');
    assert.equal(url.searchParams.get('orderBy'), 'startTime');
    assert.equal(url.searchParams.get('maxResults'), '250');
    assert.ok(Date.parse(url.searchParams.get('timeMax')) - Date.parse(url.searchParams.get('timeMin')) === 30 * 86400000);
    const headers = Object.keys(calls[0].init.headers).map((h) => h.toLowerCase());
    assert.deepEqual(headers, ['accept'], 'the kernel applies the credential, the package sends none');
  });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].values[0], 'alice');
  assert.deepEqual(JSON.parse(writes[0].values[1]), [
    { id: 'e1', title: 'Standup', start: '2026-10-12T14:00:00Z', end: '2026-10-12T14:15:00Z', allDay: false, url: 'https://calendar.google.com/e1' },
    { id: 'e2', title: '(untitled)', start: '2026-10-14', end: '2026-10-15', allDay: true, url: null },
  ]);
  assert.deepEqual(attempted, [], 'the legacy broker and Calendar service are never loaded under the kernel');
});

test('kernel sync answers 409 without a write when Google is not connected or rejects the grant, 502 on an upstream failure', async () => {
  const cases = [
    [Object.assign(new Error('google-calendar is not connected: connect it on Utilities or set OSHAL_CONNECTOR_SECRET_GOOGLE_CALENDAR for the installation'), { code: 'native_executor_unavailable' }), 409],
    [{ status: 401, body: { error: { message: 'Invalid Credentials' } } }, 409],
    [{ status: 403, body: { error: { message: 'insufficient scope' } } }, 409],
    [{ status: 500, body: { error: { message: 'SECRET backend detail' } } }, 502],
  ];
  for (const [reply, status] of cases) {
    const { post } = createCalendarSyncRoutes({ pool: { query: async () => assert.fail('no write expected') } }).routes;
    await withKernelFetch(reply, async () => {
      const r = res();
      await post(req({ confirm: true }), r);
      assert.equal(r.statusCode, status);
      assert.ok(!JSON.stringify(r.body).includes('SECRET'));
    });
  }
  assert.deepEqual(attempted, []);
});

test('the Home summary names the actual state when nothing is synced', async () => {
  const now = Date.now();
  const variants = [
    [{ connections: [{ provider: 'google', revoked: false, expires_at_ms: now - 1000, renewable: true }] }, /Google is connected, but no calendar is synced yet/],
    [{ connections: [{ provider: 'google-calendar', revoked: false, expires_at_ms: null, renewable: false }] }, /Google is connected/],
    [{ connections: [{ provider: 'tmdb', revoked: false }] }, /^Connect Google in Identity/],
    [{ connections: [{ provider: 'gmail', revoked: false, expires_at_ms: now - 1000, renewable: false }] }, /Reconnect Google in Identity/],
    [{ connections: [{ provider: 'google', revoked: true }] }, /Reconnect Google in Identity/],
  ];
  for (const [meta, message] of variants) {
    const intents = [];
    const ctx = { pool: { query: async () => ({ rows: [] }) }, intent: async (name, input) => { intents.push([name, input]); return meta; } };
    const { get } = createHomeSummaryRoutes(ctx).routes;
    const r = res();
    await get(req(), r);
    assert.equal(r.statusCode, 200);
    assert.deepEqual(intents, [['connectors.metadata', {}]]);
    assert.match(r.body.items.at(-1).text, message);
    assert.equal(r.body.metrics[0].value, 'Not synced');
  }
  // Without the intent (the legacy framework) or with a refused intent, the original guidance stays.
  for (const ctx of [{ pool: { query: async () => ({ rows: [] }) } }, { pool: { query: async () => ({ rows: [] }) }, intent: async () => { throw new Error('refused'); } }]) {
    const { get } = createHomeSummaryRoutes(ctx).routes;
    const r = res();
    await get(req(), r);
    assert.equal(r.body.items.at(-1).text, 'Connect Google in Identity, then open Calendar and sync upcoming events.');
  }
  // A saved snapshot never asks for connection metadata.
  const ctx = { pool: { query: async () => ({ rows: [{ synced_at: new Date(now - 1000), events: [] }] }) }, intent: async () => assert.fail('no metadata read') };
  const r = res();
  await createHomeSummaryRoutes(ctx).routes.get(req(), r);
  assert.match(r.body.items.at(-1).text, /^Saved primary-calendar snapshot/);
  assert.equal(googleState({}), 'unknown');
});

test('the manifest declares the Calendar host with the google-calendar Bearer credential', () => {
  const manifest = fs.readFileSync(path.join(__dirname, '..', 'oshal-app.yaml'), 'utf8');
  const block = /\negress:\n((?:  .*\n)+)/.exec(manifest);
  assert.ok(block, 'egress block present');
  assert.match(block[1], /- host: www\.googleapis\.com\n {4}credential: \{ connector: google-calendar, header: authorization, prefix: "Bearer " \}/);
});

test('every egress credential connector is listed in dependencies.connectors, or the kernel refuses the request', () => {
  const manifest = fs.readFileSync(path.join(__dirname, '..', 'oshal-app.yaml'), 'utf8');
  const carried = [...manifest.matchAll(/credential:\s*\{\s*connector:\s*([a-z0-9_-]+)/g)].map((match) => match[1]);
  assert.deepEqual(carried, ['google-calendar'], 'the manifest declares the Google Calendar credential');
  const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'marketplace.json'), 'utf8'));
  const entry = (catalog.apps || catalog.packages || catalog).find((app) => app.name === 'calendar');
  const listed = [...entry.dependencies.required.connectors, ...entry.dependencies.optional.connectors];
  for (const connector of carried) assert.ok(listed.includes(connector), `${connector} is not in dependencies.connectors`);
});
