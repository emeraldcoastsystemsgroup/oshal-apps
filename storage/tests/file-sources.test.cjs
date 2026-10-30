/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The shared file picker's Storage sources: Dropbox, Google Drive, GitHub and OSHAL-local listings (folders, pages,
 *   `q` search) and their read-only file routes, under the native kernel egress (no Authorization header, only headers the
 *   kernel forwards, only each connector's own API host, a Dropbox file through its credential-free temporary link). Each
 *   item's type equals the type its file route serves, because the kernel refuses a handle whose types differ. Not
 *   connected answers an empty page in words with no provider call; over 4 MB is refused; bad cursors and paths are 400.
 *   The manifest declares each source inside /api/storage/, routed by this module, and the egress hosts it calls.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');

const SUB = 'alice';
const brokerCalls = [];
const STUBS = {
  express: { Router: () => { const routes = {}; const add = (m) => (p, f) => { routes[`${m} ${p}`] = f; }; return { routes, get: add('GET'), post: add('POST'), put: add('PUT'), delete: add('DELETE') }; } },
  '@/shared/logger': { createChildLogger: () => ({ error() {}, info() {}, warn() {} }) },
  '@/app/routes/connectors-routes': { getValidAccessToken: async (_pool, sub, provider) => { brokerCalls.push([sub, provider]); return null; } },
};
const original = Module._load;
Module._load = function (request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  if (request.startsWith('@/')) throw new Error(`unexpected framework import ${request}`);
  return original.call(this, request, ...rest);
};
const { createFileSourceRoutes, mediaType, MAX_FILE_BYTES } = require('../routes/file-sources.js');
test.after(() => { Module._load = original; });

/** Headers the kernel's package egress forwards (crates/oshald package_egress.rs PACKAGE_HEADERS). */
const FORWARDED = new Set(['accept', 'accept-language', 'content-type', 'user-agent', 'if-none-match', 'if-modified-since', 'x-requested-with', 'cache-control', 'range', 'x-fantasy-filter']);
/** Each connector's catalog API host (connectors/*.yaml baseUrl): its credential goes nowhere else. */
const CATALOG_HOSTS = new Set(['api.dropboxapi.com', 'www.googleapis.com', 'api.github.com']);

const everyone = { connections: [
  { provider: 'dropbox', revoked: false, expires_at_ms: null },
  { provider: 'google', revoked: false, expires_at_ms: null },
  { provider: 'github', revoked: false, expires_at_ms: null },
] };
const localFiles = [{ name: 'budget.txt', size: 12 }, { name: 'plan.pdf', size: 5 }, { name: 'huge.zip', size: MAX_FILE_BYTES + 1 }];

function routes(meta = everyone) {
  const intents = [];
  const ctx = { pool: {}, intent: async (name, input) => {
    intents.push([name, input]);
    if (name === 'connectors.metadata') return meta;
    if (name === 'storage.list') return { provider: 'oshal-local', files: localFiles };
    if (name === 'storage.read') return { content: Buffer.from('rent 1800\n').toString('base64') };
    throw new Error(`unexpected intent ${name}`);
  } };
  return { r: createFileSourceRoutes(ctx).routes, intents };
}
const req = (query = {}) => ({ oidc: { user: { sub: SUB } }, query });
function res() {
  return { statusCode: 200, headers: {}, set(k, v) { this.headers[k.toLowerCase()] = v; return this; }, status(n) { this.statusCode = n; return this; },
    json(b) { this.body = b; return this; }, send(b) { this.sent = b; return this; } };
}

/** Run with the kernel egress on and a scripted fetch; every call is recorded and checked against the kernel's rules. */
async function withFetch(replies, run) {
  const calls = [];
  const saved = globalThis.fetch;
  process.env.OSHAL_EGRESS = 'kernel';
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const u = new URL(String(url));
    for (const h of Object.keys(init.headers || {})) assert.ok(FORWARDED.has(h.toLowerCase()), `header ${h} is one the kernel forwards`);
    assert.ok(!Object.keys(init.headers || {}).some((h) => h.toLowerCase() === 'authorization'), 'no Authorization from the package');
    assert.ok(CATALOG_HOSTS.has(u.host) || u.host.endsWith('.dropboxusercontent.com'), `${u.host} is declared`);
    const reply = replies.shift();
    if (!reply) throw new Error(`unexpected fetch ${url}`);
    if (reply.bytes) return new Response(reply.bytes, { status: reply.status || 200 });
    return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status || 200, headers: { 'content-type': 'application/json' } });
  };
  try { await run(calls); } finally { globalThis.fetch = saved; delete process.env.OSHAL_EGRESS; }
}

/** Mint-time contract: the listed type is exactly the served type, as the kernel's handle check requires. */
async function servesListedType(r, listed, replies) {
  const source = new URL(listed.source, 'https://oshal.test');
  const provider = source.pathname.split('/')[4];
  await withFetch(replies, async () => {
    const out = res();
    await r[`GET /${provider}/file`](req(Object.fromEntries(source.searchParams)), out);
    assert.equal(out.statusCode, 200, JSON.stringify(out.body));
    assert.equal(out.headers['content-type'], listed.type);
    assert.ok(Buffer.isBuffer(out.sent) && out.sent.length > 0);
  });
}

test('Dropbox lists a folder, pages on, and serves a file through its credential-free temporary link', async () => {
  const { r } = routes();
  const entries = [{ '.tag': 'folder', name: 'Work', path_lower: '/work' }, { '.tag': 'file', name: 'Plan.PDF', path_lower: '/plan.pdf', size: 9 }];
  let listed;
  await withFetch([{ body: { entries, has_more: true, cursor: 'abc' } }], async (calls) => {
    const out = res();
    await r['GET /dropbox'](req(), out);
    assert.equal(calls[0].url, 'https://api.dropboxapi.com/2/files/list_folder');
    assert.deepEqual(JSON.parse(calls[0].init.body), { path: '', limit: 100, recursive: false });
    assert.deepEqual(out.body.folders, [{ name: 'Work', cursor: 'p:/work' }]);
    assert.equal(out.body.nextCursor, 'c:abc');
    listed = out.body.items[0];
    assert.deepEqual(listed, { name: 'Plan.PDF', type: 'application/pdf', size: 9, source: '/api/storage/sources/dropbox/file?path=%2Fplan.pdf' });
  });
  await withFetch([{ body: { entries: [] } }], async (calls) => {
    await r['GET /dropbox'](req({ cursor: 'c:abc' }), res());
    assert.equal(calls[0].url, 'https://api.dropboxapi.com/2/files/list_folder/continue');
    assert.deepEqual(JSON.parse(calls[0].init.body), { cursor: 'abc' });
  });
  await servesListedType(r, listed, [
    { body: { link: 'https://uc123.dl.dropboxusercontent.com/cd/0/get/x', metadata: { size: 9 } } },
    { bytes: Buffer.from('%PDF-1.7') },
  ]);
});

test('Dropbox searches by file name inside the open folder', async () => {
  const { r } = routes();
  const match = { metadata: { metadata: { '.tag': 'file', name: 'budget.xlsx', path_lower: '/work/budget.xlsx', size: 3 } } };
  await withFetch([{ body: { matches: [match], has_more: true, cursor: 'more' } }], async (calls) => {
    const out = res();
    await r['GET /dropbox'](req({ cursor: 'p:/work', q: 'budget' }), out);
    assert.equal(calls[0].url, 'https://api.dropboxapi.com/2/files/search_v2');
    assert.deepEqual(JSON.parse(calls[0].init.body), { query: 'budget', options: { path: '/work', max_results: 100, filename_only: true } });
    assert.equal(out.body.items[0].type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    assert.equal(out.body.nextCursor, 's:more');
  });
});

test('a Dropbox link off Dropbox\'s download domain, a file over 4 MB and a traversal path are refused', async () => {
  const { r } = routes();
  await withFetch([{ body: { link: 'https://evil.example/x', metadata: { size: 1 } } }], async () => {
    const out = res();
    await r['GET /dropbox/file'](req({ path: '/a.txt' }), out);
    assert.equal(out.statusCode, 502);
  });
  await withFetch([{ body: { link: 'https://u.dl.dropboxusercontent.com/x', metadata: { size: MAX_FILE_BYTES + 1 } } }], async (calls) => {
    const out = res();
    await r['GET /dropbox/file'](req({ path: '/big.zip' }), out);
    assert.equal(out.statusCode, 413);
    assert.equal(calls.length, 1, 'nothing downloaded');
  });
  await withFetch([], async () => {
    const out = res();
    await r['GET /dropbox/file'](req({ path: '/a/../b' }), out);
    assert.equal(out.statusCode, 400);
  });
});

test('Google Drive lists a folder, exports Google documents, and searches by name', async () => {
  const { r } = routes();
  const files = [
    { id: 'fold1', name: 'Taxes', mimeType: 'application/vnd.google-apps.folder' },
    { id: 'doc1', name: 'Letter', mimeType: 'application/vnd.google-apps.document' },
    { id: 'img1', name: 'scan.png', mimeType: 'image/png', size: '40' },
    { id: 'form1', name: 'Survey', mimeType: 'application/vnd.google-apps.form' },
  ];
  let doc;
  await withFetch([{ body: { files, nextPageToken: 'tok' } }], async (calls) => {
    const out = res();
    await r['GET /google-drive'](req(), out);
    const u = new URL(calls[0].url);
    assert.equal(u.host + u.pathname, 'www.googleapis.com/drive/v3/files');
    assert.equal(u.searchParams.get('q'), "'root' in parents and trashed = false");
    assert.deepEqual(out.body.folders, [{ name: 'Taxes', cursor: 'f:fold1' }]);
    assert.deepEqual(out.body.items.map((i) => [i.name, i.type]), [['Letter.pdf', 'application/pdf'], ['scan.png', 'image/png']], 'a form has no file to export');
    assert.equal(out.body.nextCursor, 'f:root|tok');
    doc = out.body.items[0];
  });
  await withFetch([{ body: { files: [] } }], async (calls) => {
    await r['GET /google-drive'](req({ q: "Bob's" }), res());
    assert.equal(new URL(calls[0].url).searchParams.get('q'), "name contains 'Bob\\'s' and trashed = false");
  });
  await servesListedType(r, doc, [{ body: { id: 'doc1', name: 'Letter', mimeType: 'application/vnd.google-apps.document' } }, { bytes: Buffer.from('%PDF') }]);
});

test('GitHub lists repositories, a repository folder, searches its paths, and serves raw bytes', async () => {
  const { r } = routes();
  await withFetch([{ body: [{ full_name: 'alice/site' }, { full_name: 'alice/notes' }] }], async (calls) => {
    const out = res();
    await r['GET /github'](req({ q: 'NOTE' }), out);
    assert.equal(calls[0].url, 'https://api.github.com/user/repos?per_page=100&sort=updated&page=1');
    assert.deepEqual(out.body.folders, [{ name: 'alice/notes', cursor: 'g:alice/notes:' }]);
  });
  let readme;
  await withFetch([{ body: [{ type: 'dir', name: 'docs', path: 'docs' }, { type: 'file', name: 'README.md', path: 'README.md', size: 20 }] }], async (calls) => {
    const out = res();
    await r['GET /github'](req({ cursor: 'g:alice/notes:' }), out);
    assert.equal(calls[0].url, 'https://api.github.com/repos/alice/notes/contents/');
    assert.deepEqual(out.body.folders, [{ name: 'docs', cursor: 'g:alice/notes:docs' }]);
    readme = out.body.items[0];
    assert.equal(readme.type, 'text/markdown');
  });
  const tree = { tree: [{ path: 'docs/guide.md', type: 'blob', size: 4 }, { path: 'src/guide.ts', type: 'blob', size: 4 }, { path: 'docs/old', type: 'tree' }] };
  await withFetch([{ body: { default_branch: 'trunk' } }, { body: tree }], async (calls) => {
    const out = res();
    await r['GET /github'](req({ cursor: 'g:alice/notes:docs', q: 'guide' }), out);
    assert.equal(calls[1].url, 'https://api.github.com/repos/alice/notes/git/trees/trunk?recursive=1');
    assert.deepEqual(out.body.items.map((i) => i.name), ['docs/guide.md'], 'only paths under the open folder');
  });
  await withFetch([{ bytes: Buffer.from('# hi') }], async (calls) => {
    const out = res();
    await r['GET /github/file'](req({ repo: 'alice/notes', path: 'README.md' }), out);
    assert.equal(calls[0].init.headers.Accept, 'application/vnd.github.raw');
    assert.equal(out.headers['content-type'], readme.type);
  });
  await withFetch([], async () => {
    for (const cursor of ['g:../x:', 'g:alice/notes:../etc', 'r:0']) {
      const out = res();
      await r['GET /github'](req({ cursor }), out);
      assert.equal(out.statusCode, 400, cursor);
    }
  });
});

test('OSHAL-local lists and reads the person\'s own saved files through the kernel file store', async () => {
  const { r, intents } = routes();
  process.env.OSHAL_EGRESS = 'kernel';
  try {
    const out = res();
    await r['GET /local'](req({ q: 'BUD' }), out);
    assert.deepEqual(out.body.items, [{ name: 'budget.txt', type: 'text/plain', size: 12, source: '/api/storage/sources/local/file?name=budget.txt' }]);
    const file = res();
    await r['GET /local/file'](req({ name: 'budget.txt' }), file);
    assert.equal(file.headers['content-type'], 'text/plain');
    assert.equal(file.sent.toString(), 'rent 1800\n');
    assert.deepEqual(intents.at(-1), ['storage.read', { path: 'budget.txt', provider: 'oshal-local', subject: SUB }]);
    const missing = res();
    await r['GET /local/file'](req({ name: 'other.txt' }), missing);
    assert.equal(missing.statusCode, 404);
    const big = res();
    await r['GET /local/file'](req({ name: 'huge.zip' }), big);
    assert.equal(big.statusCode, 413);
  } finally { delete process.env.OSHAL_EGRESS; }
});

test('a source the person has not connected answers an empty page in words and calls no provider', async () => {
  const { r } = routes({ connections: [{ provider: 'github', revoked: false }] });
  await withFetch([], async (calls) => {
    for (const id of ['dropbox', 'google-drive']) {
      const out = res();
      await r[`GET /${id}`](req(), out);
      assert.equal(out.statusCode, 200);
      assert.deepEqual(out.body.items, []);
      assert.match(out.body.emptyMessage, /is not connected/);
    }
    const file = res();
    await r['GET /dropbox/file'](req({ path: '/a.txt' }), file);
    assert.equal(file.statusCode, 409);
    assert.equal(calls.length, 0);
  });
  await withFetch([], async () => {
    const unsigned = res();
    await r['GET /dropbox']({ query: {} }, unsigned);
    assert.equal(unsigned.statusCode, 401);
    const long = res();
    await routes().r['GET /local'](req({ q: 'x'.repeat(101) }), long);
    assert.equal(long.statusCode, 400);
  });
  assert.deepEqual(brokerCalls, [], 'the legacy broker is never asked under the kernel');
});

test('the manifest declares each source inside its own API, routed here, with the hosts it calls', () => {
  const manifest = fs.readFileSync(path.join(__dirname, '..', 'oshal-app.yaml'), 'utf8');
  const routed = new Set(Object.keys(routes().r));
  const lists = [...manifest.matchAll(/^\s+list: (\/api\/storage\/sources\/[\w-]+)$/gm)].map((m) => m[1]);
  assert.deepEqual(lists, ['/api/storage/sources/dropbox', '/api/storage/sources/google-drive', '/api/storage/sources/github', '/api/storage/sources/local']);
  for (const list of lists) {
    const id = list.split('/').pop();
    assert.ok(routed.has(`GET /${id}`) && routed.has(`GET /${id}/file`), id);
  }
  assert.match(manifest, /module: routes\/file-sources\.js\n\s+factory: createFileSourceRoutes\n\s+mountPath: \/api\/storage\/sources/);
  assert.match(manifest, /host: "\*\.dropboxusercontent\.com"\n(?!\s+credential)/, 'no credential on the temporary-link host');
  assert.match(manifest, /host: www\.googleapis\.com\n\s+credential: \{ connector: google-drive,/);
  assert.equal(mediaType('x.unknownext'), 'application/octet-stream');
});
