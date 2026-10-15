/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Under the native kernel (OSHAL_EGRESS=kernel) the GitHub repo picker and repo creation, the Dropbox folder picker
 *   and the assistant's create_repo / list_files call api.github.com and api.dropboxapi.com with no Authorization header and map the
 *   answers as before; GET /prefs reads the connected list from connection metadata; a kernel "not connected" refusal or unusable
 *   metadata gives each route's own not-connected answer; the legacy path still sends the brokered token; the manifest declares both hosts.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | list_files lists the store the Files bucket points at: OSHAL local (the default) lists the caller's
 *   local store with no provider call and never says "Dropbox isn't connected"; Dropbox lists Dropbox as before; GitHub says it cannot
 *   list a repository here. The Dropbox cases now set the Files bucket to Dropbox. Red before: list_files always read Dropbox.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Under the native kernel the OSHAL-local store is the kernel's personal file store: list_files and /local/list
 *   read it through the storage.list intent (OSHAL local forced, the caller as subject) and never the sandbox directory, which answered
 *   empty on the live kernel; the legacy framework still lists its per-user directory.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');

const SUB = 'alice';
// The OSHAL-local store root the routes read at load (a disposable directory, never the workspace).
const os = require('node:os');
const crypto = require('node:crypto');
const LOCAL = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-local-'));
process.env.CLINE_WORKSPACE_ROOT = LOCAL;
/** The caller's files in the kernel's personal file store, as the storage.list intent answers them. */
const nativeFiles = [];
/** Where the Files bucket points in the stub prefs (the default is OSHAL local). */
const prefs = { files: 'oshal-local' };
// Framework modules the compiled routes import at load; the broker records every token lookup.
const brokerCalls = [];
const broker = { getValidAccessToken: async (_pool, sub, provider) => { brokerCalls.push([sub, provider]); return broker.token; }, token: null };
const bot = { reply: '{}' };
const STUBS = {
  express: { Router: () => { const routes = {}; const add = (m) => (p, f) => { routes[`${m} ${p}`] = f; }; return { routes, get: add('GET'), post: add('POST'), put: add('PUT'), delete: add('DELETE') }; } },
  '@/shared/logger': { createChildLogger: () => ({ error() {}, info() {}, warn() {} }) },
  '@/app/routes/connectors-routes': broker,
  '@/app/routes/storage-target': {
    getStoragePrefs: async () => ({ code: { provider: 'github' }, files: { provider: prefs.files, repo: prefs.files === 'github' ? 'alice/site' : undefined } }),
    setStoragePrefs: async () => undefined, ensureStoragePrefsSchema: async () => undefined, sanitizeSubfolder: (v) => String(v || ''),
  },
  '@/features/agent-management': { BotNodeClient: class {}, createRegistryEndpointResolver: () => ({}) },
  '@/app/routes/inline-bot-execution': { executeBotOrInline: async () => ({ response: bot.reply }) },
};
const original = Module._load;
Module._load = function (request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  if (request.startsWith('@/')) throw new Error(`unexpected framework import ${request}`);
  return original.call(this, request, ...rest);
};
const { createStorageRoutes } = require('../routes/storage-routes.js');
test.after(() => { Module._load = original; fs.rmSync(LOCAL, { recursive: true, force: true }); });

const ALLOWED = new Set(['accept', 'accept-language', 'content-type', 'user-agent', 'if-none-match', 'if-modified-since', 'x-requested-with', 'cache-control', 'range']);
const req = (body = {}) => ({ oidc: { user: { sub: SUB }, isAuthenticated: () => true }, body });
function res() { return { statusCode: 200, setHeader() {}, status(n) { this.statusCode = n; return this; }, json(b) { this.body = b; } }; }
const now = Date.now();
const connected = { connections: [
  { id: 'c1', provider: 'github', revoked: false, expires_at_ms: null, renewable: false },
  { id: 'c2', provider: 'dropbox', revoked: false, expires_at_ms: now - 1000, renewable: true },
] };

function routes(meta) {
  const intents = [];
  const queries = [];
  const ctx = { pool: { query: async (text, values) => { queries.push([text, values]); return { rows: [{ provider: 'github' }] }; } } };
  if (meta !== undefined) ctx.intent = async (name, input) => {
    intents.push([name, input]);
    if (name === 'storage.list') return { provider: 'oshal-local', files: nativeFiles.map((name) => ({ name, size: 1, downloadUrl: `/api/applications/storage/storage/download?path=${name}` })) };
    if (meta instanceof Error) throw meta;
    return meta;
  };
  return { r: createStorageRoutes(ctx).routes, intents, queries };
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

function assertKernelRequest(call, method, host, pathname, search = '') {
  const url = new URL(call.url);
  assert.equal(url.protocol, 'https:');
  assert.equal(url.host, host);
  assert.equal(url.pathname, pathname);
  assert.equal(url.search, search, 'no key in the URL');
  assert.equal((call.init.method || 'GET').toUpperCase(), method);
  for (const h of Object.keys(call.init.headers || {})) assert.ok(ALLOWED.has(h.toLowerCase()), `header ${h} is one the kernel accepts`);
}

test('kernel GitHub repo list and create use the declared host with no auth header', async () => {
  brokerCalls.length = 0;
  const { r, intents } = routes(connected);
  await withFetch(true, { body: [{ name: 'site', full_name: 'alice/site', private: true, owner: { login: 'alice' } }] }, async (calls) => {
    const out = res();
    await r['GET /github/repos'](req(), out);
    assert.equal(out.statusCode, 200);
    assert.deepEqual(out.body, { repos: [{ name: 'site', fullName: 'alice/site', private: true }] });
    assertKernelRequest(calls[0], 'GET', 'api.github.com', '/user/repos', '?per_page=100&sort=updated');
    assert.deepEqual(calls[0].init.headers, { Accept: 'application/vnd.github+json', 'User-Agent': 'OSHAL' });
  });
  await withFetch(true, { status: 201, body: { name: 'new-app', full_name: 'alice/new-app', html_url: 'https://github.com/alice/new-app' } }, async (calls) => {
    const out = res();
    await r['POST /github/repos'](req({ name: 'new app' }), out);
    assert.deepEqual(out.body, { ok: true, name: 'new-app', fullName: 'alice/new-app', url: 'https://github.com/alice/new-app' });
    assertKernelRequest(calls[0], 'POST', 'api.github.com', '/user/repos');
    assert.deepEqual(calls[0].init.headers, { Accept: 'application/vnd.github+json', 'User-Agent': 'OSHAL', 'Content-Type': 'application/json' });
    assert.deepEqual(JSON.parse(calls[0].init.body), { name: 'new-app', private: true, description: 'Created by OSHAL', auto_init: true });
  });
  assert.equal(intents.length, 2);
  assert.deepEqual(brokerCalls, [], 'the legacy broker is never asked under the kernel');
});

test('kernel Dropbox folder picker posts list_folder with only content-type', async () => {
  const { r } = routes(connected);
  const entries = [{ '.tag': 'folder', name: 'Docs', path_lower: '/docs' }, { '.tag': 'file', name: 'a.txt', path_lower: '/a.txt' }];
  await withFetch(true, { body: { entries } }, async (calls) => {
    const out = res();
    await r['GET /dropbox/folders'](req(), out);
    assert.deepEqual(out.body, { folders: [{ name: 'Docs', path: '/docs' }] });
    assertKernelRequest(calls[0], 'POST', 'api.dropboxapi.com', '/2/files/list_folder');
    assert.deepEqual(calls[0].init.headers, { 'Content-Type': 'application/json' });
    assert.deepEqual(JSON.parse(calls[0].init.body), { path: '', recursive: false });
  });
  assert.deepEqual(brokerCalls, []);
});

test('kernel assistant list_files and create_repo go through the egress', async () => {
  const { r } = routes(connected);
  prefs.files = 'dropbox';
  bot.reply = '{"action":"list_files","args":{}}';
  await withFetch(true, { body: { entries: [{ name: 'a.txt' }, { name: 'b.txt' }] } }, async (calls) => {
    const out = res();
    await r['POST /assistant'](req({ message: 'list my files' }), out);
    assert.deepEqual(out.body, { reply: 'You have 2 file(s): a.txt, b.txt.', data: { files: ['a.txt', 'b.txt'] } });
    assertKernelRequest(calls[0], 'POST', 'api.dropboxapi.com', '/2/files/list_folder');
  });
  prefs.files = 'oshal-local';
  bot.reply = '{"action":"create_repo","args":{"name":"demo"}}';
  await withFetch(true, { status: 201, body: { name: 'demo', full_name: 'alice/demo', html_url: 'https://github.com/alice/demo' } }, async (calls) => {
    const out = res();
    await r['POST /assistant'](req({ message: 'make a repo named demo' }), out);
    assert.equal(out.body.data.fullName, 'alice/demo');
    assertKernelRequest(calls[0], 'POST', 'api.github.com', '/user/repos');
  });
  assert.deepEqual(brokerCalls, []);
});

test('GET /prefs reads the connected list from connection metadata under the kernel', async () => {
  const meta = { connections: [...connected.connections,
    { provider: 'google-drive', revoked: false, expires_at_ms: null }, { provider: 'gmail', revoked: false, expires_at_ms: null },
    { provider: 'slack', revoked: true }, { provider: 'twitter', revoked: false, expires_at_ms: now - 1000, renewable: false }] };
  const { r, queries } = routes(meta);
  await withFetch(true, { body: {} }, async (calls) => {
    const out = res();
    await r['GET /prefs'](req(), out);
    assert.equal(out.statusCode, 200);
    assert.deepEqual(out.body.connected, ['github', 'dropbox', 'google']);
    assert.equal(calls.length, 0);
  });
  assert.deepEqual(queries, [], 'the framework connections table is not read under the kernel');
  const bare = routes(undefined);
  await withFetch(true, { body: {} }, async () => {
    const out = res();
    await bare.r['GET /prefs'](req(), out);
    assert.deepEqual(out.body.connected, []);
  });
});

test('kernel "not connected" gives each route its own answer', async () => {
  const refusal = Object.assign(new Error('github is not connected: connect it on Utilities or set OSHAL_CONNECTOR_SECRET_GITHUB for the installation'), { code: 'native_executor_unavailable' });
  const unusable = { connections: [{ provider: 'github', revoked: true }, { provider: 'dropbox', revoked: false, expires_at_ms: now - 1000, renewable: false }] };
  const cases = [
    ['GET /github/repos', {}, 409, { error: 'no_github' }],
    ['POST /github/repos', { name: 'x' }, 409, { error: 'no_github', message: 'Connect GitHub at /utilities first.' }],
    ['GET /dropbox/folders', {}, 409, { error: 'no_dropbox' }],
  ];
  for (const [meta, fetches] of [[undefined, 1], [new Error('intent refused'), 1], [connected, 1], [unusable, 0], [{ connections: [] }, 0]]) {
    for (const [route, body, status, answer] of cases) {
      const { r } = routes(meta);
      await withFetch(true, refusal, async (calls) => {
        const out = res();
        await r[route](req(body), out);
        assert.equal(out.statusCode, status, route);
        assert.deepEqual(out.body, answer);
        assert.equal(calls.length, fetches, `${route} reaches the provider only when the metadata allows`);
      });
    }
    const { r } = routes(meta);
    prefs.files = 'dropbox';
    bot.reply = '{"action":"list_files","args":{}}';
    await withFetch(true, refusal, async () => {
      const out = res();
      await r['POST /assistant'](req({ message: 'list my files' }), out);
      assert.deepEqual(out.body, { reply: 'Dropbox isn’t connected — connect it at /utilities and I can list your files.' });
    });
    prefs.files = 'oshal-local';
    bot.reply = '{"action":"create_repo","args":{"name":"demo"}}';
    await withFetch(true, refusal, async () => {
      const out = res();
      await r['POST /assistant'](req({ message: 'make a repo' }), out);
      assert.equal(out.statusCode, 502);
      assert.deepEqual(out.body, { error: 'GitHub not connected — connect it at /utilities first.' });
    });
  }
  assert.deepEqual(brokerCalls, []);
});

test('the legacy path still sends the brokered token and reads the connections table', async () => {
  brokerCalls.length = 0;
  const { r, intents, queries } = routes(connected);
  broker.token = 'tok-legacy';
  await withFetch(false, { body: [] }, async (calls) => {
    await r['GET /github/repos'](req(), res());
    assert.deepEqual(calls[0].init.headers, { Authorization: 'Bearer tok-legacy', Accept: 'application/vnd.github+json', 'User-Agent': 'OSHAL' });
    await r['GET /dropbox/folders'](req(), res());
    assert.deepEqual(calls[1].init.headers, { Authorization: 'Bearer tok-legacy', 'Content-Type': 'application/json' });
    await r['POST /github/repos'](req({ name: 'x' }), res());
    assert.deepEqual(calls[2].init.headers, { Authorization: 'Bearer tok-legacy', Accept: 'application/vnd.github+json', 'User-Agent': 'OSHAL', 'Content-Type': 'application/json' });
    const prefs = res();
    await r['GET /prefs'](req(), prefs);
    assert.deepEqual(prefs.body.connected, ['github']);
  });
  broker.token = null;
  await withFetch(false, { body: {} }, async (calls) => {
    const out = res();
    await r['GET /dropbox/folders'](req(), out);
    assert.equal(out.statusCode, 409);
    assert.deepEqual(out.body, { error: 'no_dropbox' });
    assert.equal(calls.length, 0);
  });
  assert.deepEqual(brokerCalls, [[SUB, 'github'], [SUB, 'dropbox'], [SUB, 'github'], [SUB, 'dropbox']]);
  assert.match(queries[0][0], /FROM oshal_connections/);
  assert.deepEqual(intents, [], 'connection metadata is a kernel-only read');
});

test('the manifest declares the GitHub and Dropbox hosts with their Bearer credentials', () => {
  const manifest = fs.readFileSync(path.join(__dirname, '..', 'oshal-app.yaml'), 'utf8');
  const block = /\negress:\n((?:  .*\n)+)/.exec(manifest);
  assert.ok(block, 'egress block present');
  assert.match(block[1], /- host: api\.github\.com\n {4}credential: \{ connector: github, header: authorization, prefix: "Bearer " \}/);
  assert.match(block[1], /- host: api\.dropboxapi\.com\n {4}credential: \{ connector: dropbox, header: authorization, prefix: "Bearer " \}/);
});

test('list_files lists the store the Files bucket points at, and OSHAL local never mentions Dropbox', async () => {
  const { r, intents } = routes({ connections: [] });
  bot.reply = '{"action":"list_files","args":{}}';
  const store = path.join(LOCAL, 'userfiles', crypto.createHash('sha256').update(SUB).digest('hex').slice(0, 32));
  await withFetch(true, new Error('no provider call expected'), async (calls) => {
    const empty = res();
    await r['POST /assistant'](req({ message: 'List my files' }), empty);
    assert.deepEqual(empty.body, { reply: 'Your files save to OSHAL local, and there are no files there yet.', data: { provider: 'oshal-local', files: [] } });
    // A file in the sandbox directory is not in the kernel's store: under the kernel it is never listed.
    fs.mkdirSync(path.join(store, 'nested'), { recursive: true });
    fs.writeFileSync(path.join(store, 'sandbox-only.txt'), 'z');
    nativeFiles.push('deck.pptx', 'notes.md');
    const listed = res();
    await r['POST /assistant'](req({ message: 'List my files' }), listed);
    assert.deepEqual(listed.body.data, { provider: 'oshal-local', files: ['deck.pptx', 'notes.md'] });
    assert.equal(listed.body.reply, 'Your files save to OSHAL local. You have 2 file(s) there: deck.pptx, notes.md.');
    assert.doesNotMatch(listed.body.reply, /Dropbox/);
    const route = res();
    await r['GET /local/list'](req(), route);
    assert.deepEqual(route.body.files.map((f) => f.name), ['deck.pptx', 'notes.md'], '/local/list reads the same store');
    prefs.files = 'github';
    const gh = res();
    await r['POST /assistant'](req({ message: 'List my files' }), gh);
    assert.equal(gh.body.reply, 'Your files save to GitHub (alice/site). I cannot list a repository\'s files here; open it on GitHub to see them.');
    assert.equal(calls.length, 0, 'no provider is called for OSHAL local or GitHub');
  });
  prefs.files = 'oshal-local';
  const lists = intents.filter(([name]) => name === 'storage.list');
  assert.ok(lists.length >= 3, 'every kernel listing reads the kernel store');
  for (const [, input] of lists) assert.deepEqual(input, { kind: 'files', override: { provider: 'oshal-local' }, subfolder: '', subject: SUB });
  // The legacy framework keeps its per-user directory.
  const legacy = res();
  await r['GET /local/list'](req(), legacy);
  assert.deepEqual(legacy.body.files.map((f) => f.name), ['sandbox-only.txt']);
  nativeFiles.length = 0;
});
