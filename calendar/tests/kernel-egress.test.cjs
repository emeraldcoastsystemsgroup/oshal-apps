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
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.5.0: the Home summary reads Google Calendar live through the same declared host with no
 *   Authorization header (the calendar list, then the primary calendar), never asks the kernel for connection metadata and writes
 *   nothing; a kernel "not connected" refusal says to connect Google and a 401 to reconnect. It replaces the case that named
 *   "connected, not synced yet" from connectors.metadata: nothing has to be synced for Home any more.
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
const { createHomeSummaryRoutes } = require('../routes/home-summary.js');
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

test('the Home summary reads Google Calendar live from the declared host with no auth header, and names a missing or refused connection', async () => {
  const soon = new Date(Date.now() + 2 * 3600e3).toISOString();
  const answers = {
    '/calendar/v3/users/me/calendarList': { items: [{ id: 'you@example.com', summary: 'you@example.com', primary: true, selected: true, accessRole: 'owner' }] },
    '/calendar/v3/calendars/primary/events': { timeZone: 'America/Chicago', items: [{ id: 'g1', summary: 'Synthetic call', start: { dateTime: soon }, end: { dateTime: soon }, description: 'PRIVATE', attendees: [{ email: 'PRIVATE' }] }] },
  };
  const calls = [], saved = globalThis.fetch;
  process.env.OSHAL_EGRESS = 'kernel';
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    const body = answers[new URL(url).pathname];
    return new Response(JSON.stringify(body || {}), { status: body ? 200 : 404, headers: { 'content-type': 'application/json' } });
  };
  try {
    const sql = [], ctx = { pool: { query: async (q) => { sql.push(q.text || q); return { rows: [] }; } }, intent: async () => assert.fail('no connection metadata is read') };
    const r = res();
    await createHomeSummaryRoutes(ctx).routes.get(req(), r);
    assert.equal(r.statusCode, 200);
    assert.deepEqual(calls.map((c) => `${new URL(c.url).host}${new URL(c.url).pathname}`), ['www.googleapis.com/calendar/v3/users/me/calendarList', 'www.googleapis.com/calendar/v3/calendars/primary/events']);
    for (const c of calls) assert.deepEqual(Object.keys(c.init.headers).map((h) => h.toLowerCase()), ['accept'], 'the kernel applies the credential, the package sends none');
    assert.equal(r.body.items[0].text, 'Synthetic call');
    assert.ok(!JSON.stringify(r.body).includes('PRIVATE'), 'attendees and descriptions never reach the summary');
    assert.ok(sql.every((text) => /^SELECT /.test(text)), 'a read writes nothing');
  } finally { globalThis.fetch = saved; delete process.env.OSHAL_EGRESS; }
  const refusals = [
    [Object.assign(new Error('google-calendar is not connected: connect it on Utilities or set OSHAL_CONNECTOR_SECRET_GOOGLE_CALENDAR for the installation'), { code: 'native_executor_unavailable' }), /^Connect Google on the Connections page \(\/utilities\) to see your Google Calendar here\./, 'Not connected'],
    [{ status: 401, body: { error: { message: 'Invalid Credentials' } } }, /^Your Google connection is no longer accepted\. Reconnect Google/, 'Reconnect'],
  ];
  for (const [reply, message, tile] of refusals) {
    await withKernelFetch(reply, async () => {
      const r = res();
      await createHomeSummaryRoutes({ pool: { query: async () => ({ rows: [] }) } }).routes.get(req(), r);
      assert.equal(r.statusCode, 200);
      assert.match(r.body.items.at(-1).text, message);
      assert.equal(r.body.metrics[0].value, tile);
      assert.ok(!/sync/i.test(r.body.items.at(-1).text), 'nothing asks the person to sync');
    });
  }
  assert.deepEqual(attempted, [], 'the legacy broker is never loaded under the kernel');
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
