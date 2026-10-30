/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Under the native kernel (OSHAL_EGRESS=kernel) the compiled mail routes, loaded with the bridge's own
 *   inert stand-ins for the framework broker and email module, send every Gmail, Calendar, Graph and Facebook request to its
 *   declared host with no Authorization header and no access_token, map the answers to the package's rows, choose the mailbox
 *   from the caller's connection metadata, answer a missing or lapsed connection with the same 409s, and send through the
 *   package's fenced MIME builder. Outside the kernel the broker token still travels as a Bearer header.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | A sent body makes the installation's own /cockpit/ and /api/ links absolute from x-oshal-public-origin, leaves every other link and path as written, and never uses a non-https origin.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | A search (q) reaches Gmail as the person's words over the look-back window across all mail, a search that names its own date keeps it, a multi-line search is one line of at most 300 characters, and the email-messages tool declares query, days and max on its route (Roger, 2026-10-29: an ACT prep offer from the last 2 days could not be searched).
 * 4 | maintainer@emeraldcoastsystemsgroup.com | email-messages declares up to 180 days (the stored copy's reach; a live read still stops at 30).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');

const brokerCalls = [];
const frameworkSends = [];
// What the native bridge hands this package for the framework modules (crates/host-process/bridge): the broker answers
// null and the email module is inert. A kernel path that still leaned on either would produce empty rows or a fake send.
const STUBS = {
  express: { Router: () => { const routes = {}; const add = (m) => (p, ...h) => { routes[`${m} ${p}`] = h[h.length - 1]; }; return { routes, get: add('GET'), post: add('POST') }; } },
  '@/shared/logger': { createChildLogger: () => ({ error() {}, info() {}, warn() {}, debug() {} }) },
  '@/shared/skill-profiles': { resolveSkillProfileByApp: () => null, composeSkillProfilePrompt: (p) => p },
  '@/shared/services/database': { runRuntimeSchemaBootstrap: async () => {}, buildOwnerRlsPolicyStatements: () => [] },
  '@/features/agent-management': { BotNodeClient: class {}, createRegistryEndpointResolver: () => ({}) },
  '@/app/routes/connectors-routes': { getValidAccessToken: async (_pool, sub, provider) => { brokerCalls.push([sub, provider]); return process.env.OSHAL_EGRESS ? null : 'legacy-token'; } },
  '@/app/routes/free-tier-rotation': { resolveUserLlmConnection: async () => null },
  '@/app/routes/inline-bot-execution': { executeBotOrInline: async () => ({ response: 'summary' }) },
  '@/app/routes/email-routes': { sendGmail: async (...a) => { frameworkSends.push(a); return {}; }, sendOutlookMail: async (...a) => { frameworkSends.push(a); return {}; }, summarizeGmailMetadata: () => ({}) },
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
const { createEmailRoutes } = require('../routes/email-app-routes.js');
test.after(() => { Module._load = original; });

/** A JSON Response the way the bridge's egress fetch builds one. */
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * Drive one route under the kernel with a scripted fetch and connection metadata.
 * @param route - "GET /messages" etc.
 * @param meta - connectors.metadata answer, or undefined for a context without the intent.
 * @param answer - (url, init) => Response | Error.
 */
async function call(route, { meta, answer, query = {}, body, params = {}, kernel = true, headers } = {}) {
  const calls = [];
  const saved = globalThis.fetch;
  if (kernel) process.env.OSHAL_EGRESS = 'kernel'; else delete process.env.OSHAL_EGRESS;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const reply = answer(String(url), init);
    if (reply instanceof Error) throw reply;
    return reply;
  };
  const ctx = { pool: { query: async () => ({ rows: [] }) }, ...(meta === undefined ? {} : { intent: async (name) => { assert.equal(name, 'connectors.metadata'); return meta; } }) };
  const res = { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(b) { this.body = b; }, send(b) { this.body = b; } };
  try {
    const get = headers ? (name) => headers[String(name).toLowerCase()] : undefined;
    await createEmailRoutes(ctx).routes[route]({ oidc: { user: { sub: 'alice' } }, query, params, body, ...(get ? { get } : {}) }, res);
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
    assert.ok(!names.includes('authorization') && !names.includes('prefer'), `${url} carries ${names.join(',')}`);
    assert.ok(!/access_token|api_key/.test(url), `${url} carries a key`);
  }
}

const GOOGLE = { connections: [{ provider: 'google', revoked: false, expires_at_ms: Date.now() - 1000, renewable: true }] };
const OUTLOOK = { connections: [{ provider: 'outlook', revoked: false, expires_at_ms: null, renewable: false }] };

test('Gmail inbox reads go to gmail.googleapis.com with no credential and map to the bounded summaries', async () => {
  const message = { id: 'm1', labelIds: ['UNREAD', 'IMPORTANT', 'CATEGORY_PERSONAL'], internalDate: '1760000000000', snippet: 'See you at 3',
    payload: { headers: [{ name: 'From', value: 'Bob <bob@example.com>' }, { name: 'Subject', value: 'Lunch' }, { name: 'Date', value: 'Thu, 9 Oct 2025' }] } };
  const { res, calls } = await call('GET /messages', {
    meta: GOOGLE, query: { days: '2', max: '5' },
    answer: (url) => (url.includes('/messages?q=') ? json({ messages: [{ id: 'm1' }] }) : json(message)),
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.provider, 'google');
  assert.deepEqual(res.body.messages, [{
    id: 'm1', from: 'Bob <bob@example.com>', subject: 'Lunch', date: 'Thu, 9 Oct 2025', internalDate: '1760000000000',
    receivedAt: new Date(1760000000000).toISOString(), snippet: 'See you at 3', unread: true, important: true, starred: false,
    providerFlags: { unread: true, important: true, starred: false },
  }]);
  assert.deepEqual(calls.map((c) => new URL(c.url).host), ['gmail.googleapis.com', 'gmail.googleapis.com']);
  assert.equal(new URL(calls[0].url).searchParams.get('q'), 'in:inbox newer_than:2d');
  assertNoCredential(calls);
  assert.deepEqual(brokerCalls, [], 'the framework broker is never consulted under the kernel');
});

test('a Gmail search looks for the person\'s words over the window across all mail', async () => {
  const searched = async (query) => {
    const { res, calls } = await call('GET /messages', { meta: GOOGLE, query, answer: (url) => (url.includes('/messages?q=') ? json({ messages: [] }) : json({})) });
    assert.equal(res.statusCode, 200);
    assert.equal(new URL(calls[0].url).searchParams.get('maxResults'), String(query.max || 25));
    return new URL(calls[0].url).searchParams.get('q');
  };
  assert.equal(await searched({ q: 'ACT prep', days: '2', max: '50' }), 'ACT prep newer_than:2d');
  assert.equal(await searched({ q: 'from:kahoot after:2026/10/27', days: '2' }), 'from:kahoot after:2026/10/27');
  assert.equal(await searched({ q: 'ACT\nprep  ', days: '90' }), 'ACT prep newer_than:30d', 'one line, the window at most 30 days');
  assert.equal((await searched({ q: 'x'.repeat(400) })).length, 300 + ' newer_than:7d'.length);
  assert.equal(await searched({ q: '   ', days: '3' }), 'in:inbox newer_than:3d', 'no words lists the inbox');
});

test('the email-messages tool sends its search, window and count to the route', () => {
  const manifest = fs.readFileSync(path.join(__dirname, '..', 'oshal-app.yaml'), 'utf8');
  assert.match(manifest, /apiEndpoint: "GET \/api\/email\/messages\?q=\{input\.query\}&days=\{input\.days\}&max=\{input\.max\}"/);
  for (const field of ['query: { type: string, maxLength: 300', 'days: { type: integer, minimum: 1, maximum: 180', 'max: { type: integer, minimum: 1, maximum: 50']) assert.ok(manifest.includes(field), field);
});

test('My Day reads today from www.googleapis.com and the digest counts the mapped rows', async () => {
  const { res, calls } = await call('GET /digest', {
    meta: GOOGLE,
    answer: (url) => {
      if (url.startsWith('https://www.googleapis.com/calendar/v3/calendars/primary/events?')) return json({ items: [{ summary: 'Standup', start: { dateTime: '2026-10-10T14:00:00Z' }, location: 'Room 1' }] });
      if (url.includes('/messages?q=')) return json({ messages: [{ id: 'a' }] });
      return json({ id: 'a', labelIds: ['STARRED'], payload: { headers: [{ name: 'From', value: 'x@example.com' }] } });
    },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.events, [{ summary: 'Standup', start: '2026-10-10T14:00:00Z', location: 'Room 1' }]);
  assert.equal(res.body.total, 1);
  assert.equal(res.body.starredCount, 1);
  assert.ok(calls.some((c) => new URL(c.url).host === 'www.googleapis.com'));
  assertNoCredential(calls);
});

test('with only Outlook connected the default mailbox is Graph, and the adapter Authorization and Prefer never leave', async () => {
  const { res, calls } = await call('GET /messages', {
    meta: OUTLOOK,
    answer: () => json({ value: [{ id: 'g1', subject: 'Invoice', from: { emailAddress: { name: 'Ann', address: 'ann@example.com' } }, receivedDateTime: '2026-10-10T12:00:00Z', bodyPreview: 'Due Friday', isRead: false, importance: 'high' }] }),
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.provider, 'outlook');
  assert.equal(res.body.messages[0].subject, 'Invoice');
  assert.equal(res.body.messages[0].unread, true);
  assert.equal(new URL(calls[0].url).host, 'graph.microsoft.com');
  assertNoCredential(calls);
  const opened = await call('GET /message/:id', { meta: OUTLOOK, query: { provider: 'outlook' }, params: { id: 'g1' },
    answer: () => json({ id: 'g1', subject: 'Invoice', body: { contentType: 'html', content: '<p>Pay <b>now</b></p>' }, toRecipients: [] }) });
  assert.equal(opened.res.body.body, 'Pay now', 'the HTML body is reduced to text when the text preference cannot be sent');
  assertNoCredential(opened.calls);
});

test('missing, lapsed and kernel-refused connections answer the same 409s as before', async () => {
  let r = await call('GET /messages', { meta: { connections: [] }, answer: () => assert.fail('no request without a connection') });
  assert.equal(r.res.statusCode, 409);
  assert.equal(r.res.body.error, 'no_mail_connection');
  r = await call('GET /messages', { meta: { connections: [{ provider: 'gmail', revoked: true }] }, query: { provider: 'google' }, answer: () => assert.fail('no request') });
  assert.equal(r.res.statusCode, 409);
  assert.equal(r.res.body.error, 'reconnect_required');
  const refusal = Object.assign(new Error('gmail is not connected: connect it on Utilities or set OSHAL_CONNECTOR_SECRET_GMAIL for the installation'), { code: 'native_executor_unavailable' });
  r = await call('GET /messages', { meta: undefined, query: { provider: 'google', surface: '1' }, answer: () => refusal });
  assert.equal(r.res.statusCode, 200);
  assert.deepEqual(r.res.body, { connected: false, provider: 'google', error: 'no_google_connection', message: 'Connect your Google account at /utilities first.' });
  r = await call('GET /messages', { meta: GOOGLE, answer: () => json({ error: { message: 'Invalid Credentials' } }, 401) });
  assert.equal(r.res.statusCode, 409);
  assert.equal(r.res.body.error, 'reconnect_required');
});

test('a confirmed Gmail send posts the fenced MIME to gmail.googleapis.com with no credential', async () => {
  const unconfirmed = await call('POST /send', { meta: GOOGLE, body: { subject: 'x' }, answer: () => assert.fail('no request before confirmation') });
  assert.equal(unconfirmed.res.statusCode, 428);
  const { res, calls } = await call('POST /send', {
    meta: GOOGLE, body: { confirm: true, to: 'carol@example.com\r\nBcc: mallory@example.com', subject: 'Notes', body: 'Hello' },
    answer: () => json({ id: 'sent-1' }),
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, provider: 'google', id: 'sent-1', to: 'carol@example.com\r\nBcc: mallory@example.com' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
  assert.equal(calls[0].init.method, 'POST');
  const raw = Buffer.from(JSON.parse(calls[0].init.body).raw, 'base64url').toString('utf8');
  assert.equal(raw, 'To: carol@example.com Bcc: mallory@example.com\r\nSubject: Notes\r\nContent-Type: text/plain; charset="UTF-8"\r\n\r\nHello');
  assertNoCredential(calls);
  assert.deepEqual(frameworkSends, [], 'the inert framework sender is never used under the kernel');
});

test('a sent body makes this installation\'s own links absolute from the public origin, and only those', async () => {
  const body = 'Deck: /cockpit/?app=presentations&open=Top%205.pptx\nDownload (/api/applications/presentations/storage/download?path=x)\nElsewhere: https://example.com/api/x and /etc/passwd';
  const { calls } = await call('POST /send', {
    meta: GOOGLE, headers: { 'x-oshal-public-origin': 'https://oshal.example.com' },
    body: { confirm: true, to: 'me@example.com', subject: 'Deck', body }, answer: () => json({ id: 'sent-2' }),
  });
  const raw = Buffer.from(JSON.parse(calls[0].init.body).raw, 'base64url').toString('utf8');
  assert.match(raw, /Deck: https:\/\/oshal\.example\.com\/cockpit\/\?app=presentations&open=Top%205\.pptx/);
  assert.match(raw, /\(https:\/\/oshal\.example\.com\/api\/applications\/presentations\/storage\/download\?path=x\)/);
  assert.match(raw, /https:\/\/example\.com\/api\/x and \/etc\/passwd/, 'other links and paths are left as written');
  const spoof = await call('POST /send', {
    meta: GOOGLE, headers: { 'x-oshal-public-origin': 'javascript:alert(1)' },
    body: { confirm: true, to: 'me@example.com', subject: 'x', body: 'Open /cockpit/' }, answer: () => json({ id: 'sent-3' }),
  });
  assert.match(Buffer.from(JSON.parse(spoof.calls[0].init.body).raw, 'base64url').toString('utf8'), /Open \/cockpit\/$/, 'a non-https origin is never used');
});

test('a confirmed Outlook send posts Graph sendMail JSON with no credential', async () => {
  const { res, calls } = await call('POST /send', {
    meta: OUTLOOK, body: { confirm: true, provider: 'outlook', to: 'dan@example.com', subject: 'Hi', body: 'There' },
    answer: () => new Response(null, { status: 202 }),
  });
  assert.equal(res.statusCode, 200);
  assert.equal(calls[0].url, 'https://graph.microsoft.com/v1.0/me/sendMail');
  assert.deepEqual(JSON.parse(calls[0].init.body), { message: { subject: 'Hi', body: { contentType: 'Text', content: 'There' }, toRecipients: [{ emailAddress: { address: 'dan@example.com' } }] }, saveToSentItems: true });
  assertNoCredential(calls);
});

test('the Social profile reads graph.facebook.com with no access_token, and says when Facebook is not connected', async () => {
  const meta = { connections: [{ provider: 'facebook', revoked: false, expires_at_ms: null }] };
  const { res, calls } = await call('GET /social/profile', { meta, answer: () => json({ id: '42', name: 'Alice', picture: { data: { url: 'https://cdn.example/a.jpg' } } }) });
  assert.deepEqual(res.body, { id: '42', name: 'Alice', picture: 'https://cdn.example/a.jpg' });
  const url = new URL(calls[0].url);
  assert.equal(url.host, 'graph.facebook.com');
  assert.equal(url.pathname, '/v21.0/me');
  assertNoCredential(calls);
  const none = await call('GET /social/profile', { meta: GOOGLE, query: { surface: '1' }, answer: () => assert.fail('no request') });
  assert.deepEqual(none.res.body, { connected: false, error: 'no_facebook_connection', message: 'Connect your Facebook account at /utilities first.' });
  const refused = await call('GET /social/profile', { meta: undefined, answer: () => new Error('facebook is not connected: connect it on Utilities') });
  assert.equal(refused.res.statusCode, 409);
});

test('outside the kernel the broker token still travels as a Bearer header', async () => {
  brokerCalls.length = 0;
  const { res, calls } = await call('GET /messages', { kernel: false, query: { provider: 'google' }, answer: () => json({ messages: [] }) });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(brokerCalls, [['alice', 'google']]);
  assert.equal(calls[0].init.headers.Authorization, 'Bearer legacy-token');
});

test('the manifest declares each host with its connector as a Bearer credential', () => {
  const manifest = fs.readFileSync(path.join(__dirname, '..', 'oshal-app.yaml'), 'utf8');
  for (const [host, connector] of [['gmail.googleapis.com', 'gmail'], ['www.googleapis.com', 'google-calendar'], ['graph.microsoft.com', 'outlook'], ['graph.facebook.com', 'facebook']]) {
    assert.match(manifest, new RegExp(`- host: ${host.replace(/\./g, '\\.')}\\n {4}credential: \\{ connector: ${connector}, header: authorization, prefix: "Bearer " \\}`));
  }
});
