/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Under the native kernel (OSHAL_EGRESS=kernel) the compiled AI Office delivery routes, loaded with the
 *   bridge's own inert stand-ins for the framework broker, email senders and Slack client, send a rendered artifact through
 *   gmail.googleapis.com or graph.microsoft.com (fenced MIME / Graph sendMail JSON) and through slack.com plus the pre-signed
 *   files.slack.com URL, with no Authorization header and only the headers the egress accepts; a missing, lapsed or kernel-refused
 *   connection answers the same 409s, Gmail falls through to Microsoft as before, and an upload URL off files.slack.com is refused.
 *   Outside the kernel the broker token still reaches the framework sender and Slack client. The manifest declares each host.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');

const ARTIFACT = Buffer.from('PK synthetic office artifact bytes');
const frameworkCalls = [];
const brokerCalls = [];
// What the native bridge hands this package (crates/host-process/bridge): the broker answers null, the email senders answer {}
// and the Slack client is refused. A kernel path that still used them would report a send that never happened.
const STUBS = {
  express: { Router: () => { const routes = {}; const add = (m) => (p, ...h) => { routes[`${m} ${p}`] = h[h.length - 1]; }; return { routes, get: add('GET'), post: add('POST'), put: add('PUT'), delete: add('DELETE') }; }, raw: () => (_q, _s, next) => next && next() },
  '@/shared/logger': { createChildLogger: () => ({ error() {}, info() {}, warn() {}, debug() {} }) },
  '@/shared/services/database': { buildOwnerRlsPolicyStatements: () => [], runRuntimeSchemaBootstrap: async () => {} },
  '@/features/presentation-generation': {
    PresentationEngine: class {}, renderPptx: async () => ARTIFACT, renderDocx: async () => ARTIFACT, renderXlsx: async () => ARTIFACT,
    themeCatalog: () => [], layoutCatalog: () => [], isThemeId: () => false, DEFAULT_THEME_ID: 'executive', importOffice: async () => ({}),
    brandTheme: () => { throw new Error('no brand in these cases'); },
  },
  '@/features/agent-management': { BotNodeClient: class {}, createRegistryEndpointResolver: () => () => null },
  '@/app/routes/storage-target': { resolveStorageTarget: async () => ({}), saveContent: async () => null, listFolder: async () => ({ files: [] }), deleteStoredFile: async () => ({}) },
  '@/app/routes/inline-bot-execution': { executeBotOrInline: async () => ({ response: '{}' }) },
  '@/app/routes/connectors-routes': { getValidAccessToken: async (_pool, sub, provider) => { brokerCalls.push([sub, provider]); return process.env.OSHAL_EGRESS ? null : `legacy-${provider}-token`; } },
  '@/app/routes/slack-client': { uploadSlackFile: async (token, input) => {
    if (process.env.OSHAL_EGRESS) throw Object.assign(new Error('slack.uploadSlackFile is unavailable natively'), { code: 'native_executor_unavailable' });
    frameworkCalls.push(['slack', token, input.channelId]); return { fileId: 'F-legacy', channelId: input.channelId };
  } },
  '@/app/routes/email-routes': {
    sendGmail: async (token, mail) => { frameworkCalls.push(['gmail', token, mail.to]); return process.env.OSHAL_EGRESS ? {} : { id: 'legacy-gmail-id' }; },
    sendOutlookMail: async (token, mail) => { frameworkCalls.push(['outlook', token, mail.to]); return {}; },
  },
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
const { createBotPresentationRoutes } = require('../routes/bot-presentation-routes.js');
test.after(() => { Module._load = original; });

/** Headers the kernel egress accepts from a package. */
const PACKAGE_HEADERS = new Set(['accept', 'accept-language', 'content-type', 'user-agent', 'if-none-match', 'if-modified-since', 'x-requested-with', 'cache-control', 'range']);
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const notConnected = (id) => Object.assign(new Error(`${id} is not connected: connect it on Utilities or set OSHAL_CONNECTOR_SECRET_${id.toUpperCase()} for the installation`), { code: 'native_executor_unavailable' });
const SECTIONS = [{ title: 'One', content: 'Two' }];

/**
 * Drive one delivery route with a scripted fetch and connection metadata.
 * @param route - "POST /email" or "POST /slack".
 * @param meta - connectors.metadata answer, or undefined for a context without the intent.
 * @param answer - (url, init) => Response | Error.
 */
async function call(route, { meta, answer, body, kernel = true } = {}) {
  const calls = [];
  const saved = globalThis.fetch;
  if (kernel) process.env.OSHAL_EGRESS = 'kernel'; else delete process.env.OSHAL_EGRESS;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const reply = answer(String(url), init);
    if (reply instanceof Error) throw reply;
    return reply;
  };
  const ctx = { pool: { query: async () => ({ rows: [], rowCount: 0 }) }, appPackageDir: path.resolve(__dirname, '..'),
    ...(meta === undefined ? {} : { intent: async (name) => { assert.equal(name, 'connectors.metadata'); return meta; } }) };
  const res = { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(b) { this.body = b; }, send(b) { this.body = b; }, setHeader() {} };
  try {
    await createBotPresentationRoutes(ctx).routes[route]({ oidc: { user: { sub: 'alice' } }, query: {}, params: {}, body }, res);
  } finally {
    globalThis.fetch = saved;
    delete process.env.OSHAL_EGRESS;
  }
  return { res, calls };
}

/** Every request carried only headers the egress accepts, and no key in its URL. */
function assertPackageOnly(calls) {
  for (const { url, init } of calls) {
    for (const name of Object.keys(init.headers || {})) assert.ok(PACKAGE_HEADERS.has(name.toLowerCase()), `${url} sets refused header ${name}`);
    assert.ok(!/access_token|token=/.test(url), `${url} carries a key`);
  }
}

const meta = (...providers) => ({ connections: providers.map((provider) => ({ provider, revoked: false, expires_at_ms: null })) });
const EMAIL = { confirm: true, to: 'carol@example.com', subject: 'Deck\r\nBcc: mallory@example.com', note: 'See attached', title: 'Quarterly review', sections: SECTIONS };

test('a confirmed email under the kernel posts the fenced MIME to gmail.googleapis.com with no credential', async () => {
  frameworkCalls.length = 0; brokerCalls.length = 0;
  const { res, calls } = await call('POST /email', { meta: meta('google'), body: EMAIL, answer: () => json({ id: 'g1' }) });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, via: 'gmail', id: 'g1', to: 'carol@example.com', format: 'pptx', fileName: 'Quarterly review.pptx' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
  assert.equal(calls[0].init.method, 'POST');
  const raw = Buffer.from(JSON.parse(calls[0].init.body).raw, 'base64url').toString('utf8');
  assert.ok(raw.startsWith('To: carol@example.com\r\nSubject: Deck Bcc: mallory@example.com\r\nMIME-Version: 1.0\r\n'), 'the subject is CRLF-flattened');
  assert.ok(raw.includes('Content-Disposition: attachment; filename="Quarterly review.pptx"'));
  assert.ok(raw.includes(ARTIFACT.toString('base64')), 'the rendered artifact is attached');
  assert.ok(raw.includes('\r\nSee attached\r\n'));
  assertPackageOnly(calls);
  assert.deepEqual(frameworkCalls, [], 'the inert framework sender is never used under the kernel');
  assert.deepEqual(brokerCalls, [], 'the framework broker is never consulted under the kernel');
});

test('with only Microsoft connected the email goes to Graph sendMail with the attachment', async () => {
  const { res, calls } = await call('POST /email', { meta: meta('outlook'), body: EMAIL, answer: () => new Response(null, { status: 202 }) });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, via: 'outlook', to: 'carol@example.com', format: 'pptx', fileName: 'Quarterly review.pptx' });
  assert.equal(calls[0].url, 'https://graph.microsoft.com/v1.0/me/sendMail');
  const sent = JSON.parse(calls[0].init.body);
  assert.equal(sent.saveToSentItems, true);
  assert.deepEqual(sent.message.toRecipients, [{ emailAddress: { address: 'carol@example.com' } }]);
  assert.equal(sent.message.attachments[0].contentBytes, ARTIFACT.toString('base64'));
  assert.equal(sent.message.attachments[0].name, 'Quarterly review.pptx');
  assertPackageOnly(calls);
});

test('a kernel-refused Gmail falls through to Microsoft; none connected answers 409 no_mail_connection', async () => {
  let r = await call('POST /email', { meta: undefined, body: EMAIL, answer: (url) => (url.includes('gmail') ? notConnected('gmail') : new Response(null, { status: 202 })) });
  assert.equal(r.res.statusCode, 200);
  assert.equal(r.res.body.via, 'outlook');
  assert.deepEqual(r.calls.map((c) => new URL(c.url).host), ['gmail.googleapis.com', 'graph.microsoft.com']);
  r = await call('POST /email', { meta: undefined, body: EMAIL, answer: (url) => notConnected(url.includes('gmail') ? 'gmail' : 'outlook') });
  assert.equal(r.res.statusCode, 409);
  assert.equal(r.res.body.error, 'no_mail_connection');
  r = await call('POST /email', { meta: { connections: [{ provider: 'gmail', revoked: true }] }, body: EMAIL, answer: () => assert.fail('no request without a usable mailbox') });
  assert.equal(r.res.statusCode, 409);
  assert.equal(r.res.body.error, 'no_mail_connection');
  r = await call('POST /email', { meta: meta('google'), body: EMAIL, answer: () => json({ error: { message: 'Insufficient Permission' } }, 403) });
  assert.equal(r.res.statusCode, 502, 'a provider refusal is a failure, never a delivered send');
});

const SLACK = { confirm: true, channelId: 'C123', title: 'Quarterly review', comment: 'For review', sections: SECTIONS };
const slackAnswer = (uploadUrl = 'https://files.slack.com/upload/v1/abc') => (url) => {
  if (url === 'https://slack.com/api/files.getUploadURLExternal') return json({ ok: true, upload_url: uploadUrl, file_id: 'F1' });
  if (url.startsWith('https://files.slack.com/')) return new Response('OK - 34', { status: 200 });
  if (url === 'https://slack.com/api/files.completeUploadExternal') return json({ ok: true, files: [{ id: 'F1', permalink: 'https://team.slack.com/files/U1/F1/quarterly' }] });
  return assert.fail(`unexpected ${url}`);
};

test('a confirmed Slack delivery under the kernel runs the external-upload sequence with no credential', async () => {
  frameworkCalls.length = 0;
  const { res, calls } = await call('POST /slack', { meta: meta('slack'), body: SLACK, answer: slackAnswer() });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, via: 'slack', channelId: 'C123', fileId: 'F1', permalink: 'https://team.slack.com/files/U1/F1/quarterly', format: 'pptx', fileName: 'Quarterly review.pptx' });
  assert.deepEqual(calls.map((c) => c.url), ['https://slack.com/api/files.getUploadURLExternal', 'https://files.slack.com/upload/v1/abc', 'https://slack.com/api/files.completeUploadExternal']);
  assert.equal(String(calls[0].init.body), new URLSearchParams({ filename: 'Quarterly review.pptx', length: String(ARTIFACT.length) }).toString());
  assert.deepEqual(calls[1].init.headers, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
  assert.ok(Buffer.from(calls[1].init.body).equals(ARTIFACT), 'the rendered bytes are uploaded unchanged');
  assert.deepEqual(JSON.parse(calls[2].init.body), { files: [{ id: 'F1', title: 'Quarterly review' }], channel_id: 'C123', initial_comment: 'For review' });
  assertPackageOnly(calls);
  assert.deepEqual(frameworkCalls, [], 'the refused framework Slack client is never used under the kernel');
});

test('Slack refusals: no or lapsed connection, a kernel refusal, and an upload URL off files.slack.com', async () => {
  const NO_SLACK = { error: 'no_slack_connection', message: 'Connect Slack with file-upload permission in /utilities before delivering an artifact.' };
  let r = await call('POST /slack', { meta: meta('google'), body: SLACK, answer: () => assert.fail('no request without Slack') });
  assert.equal(r.res.statusCode, 409);
  assert.deepEqual(r.res.body, NO_SLACK);
  r = await call('POST /slack', { meta: { connections: [{ provider: 'slack', revoked: false, expires_at_ms: Date.now() - 1, renewable: false }] }, body: SLACK, answer: () => assert.fail('no request') });
  assert.equal(r.res.statusCode, 409);
  r = await call('POST /slack', { meta: undefined, body: SLACK, answer: () => notConnected('slack') });
  assert.equal(r.res.statusCode, 409);
  assert.deepEqual(r.res.body, NO_SLACK);
  r = await call('POST /slack', { meta: meta('slack'), body: SLACK, answer: slackAnswer('https://evil.example/upload') });
  assert.equal(r.res.statusCode, 502);
  assert.equal(r.calls.length, 1, 'the bytes are never sent to an undeclared upload host');
});

test('outside the kernel the broker token still reaches the framework sender and Slack client', async () => {
  frameworkCalls.length = 0;
  const email = await call('POST /email', { kernel: false, body: EMAIL, answer: () => assert.fail('the framework sender owns the request') });
  assert.deepEqual(email.res.body, { ok: true, via: 'gmail', id: 'legacy-gmail-id', to: 'carol@example.com', format: 'pptx', fileName: 'Quarterly review.pptx' });
  const slack = await call('POST /slack', { kernel: false, body: SLACK, answer: () => assert.fail('the framework client owns the request') });
  assert.equal(slack.res.body.fileId, 'F-legacy');
  assert.deepEqual(frameworkCalls, [['gmail', 'legacy-google-token', 'carol@example.com'], ['slack', 'legacy-slack-token', 'C123']]);
});

test('the manifest declares each delivery host with its connector, and the upload host with none', () => {
  const manifest = fs.readFileSync(path.join(__dirname, '..', 'oshal-app.yaml'), 'utf8');
  const block = manifest.slice(manifest.indexOf('\negress:'));
  for (const [host, connector] of [['gmail.googleapis.com', 'gmail'], ['graph.microsoft.com', 'outlook'], ['slack.com', 'slack']]) {
    const entry = new RegExp(`- host: ${host.replace(/\./g, '\\.')}\\n\\s+credential: \\{ connector: ${connector}, header: authorization, prefix: "Bearer " \\}`);
    assert.match(block, entry, `${host} is declared with connector ${connector}`);
  }
  assert.match(block, /- host: files\.slack\.com\n(?!\s+credential)/, 'the pre-signed upload host carries no credential');
});
