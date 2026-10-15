/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The parent brief was never produced on the native kernel: GET /brief ran the analyzer and then stored the brief with an UPDATE, and the kernel admits a GET as a reader and refuses every SQL mutation under it ("refused: SQL mutation requires original writer admission", crates/packages/src/sql_transaction.rs). The compiled routes run here against a pool double that applies that same rule by admission (GET = reader, POST = writer): GET /brief only reads and never calls the analyzer, POST /brief produces and stores the brief, and the page asks for a POST when GET answers {brief:null, hasData:true} or on Re-analyze. "No brief" is a 200 representation because the kernel replaces a package GET's 404 with "application asset not found" (crates/api/src/package_dispatch.rs invoke_and_render).
 * -----------------------------------------------------------------------------
 *
 * Dependency-free: the compiled routes and the page script run against in-process doubles.
 *
 * @module brief-read-admission.test
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const READER_REFUSAL = 'refused: SQL mutation requires original writer admission';

/** Analyzer calls the routes made through the inline-bot rail, and what the next one answers. */
const analyzer = { calls: 0, answer: '## Top interests\n- Minecraft builds' };

const STUB_EXPORTS = {
  '@/shared/logger': { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) },
  '@/shared/services/database': {
    runRuntimeSchemaBootstrap: async ({ pool, statements }) => { for (const s of statements) await pool.query(s); },
    buildOwnerRlsPolicyStatements: () => [],
  },
  '@/shared/artifact-exchange': {},
  '@/features/personal-data': { encryptField: async () => 'sealed', decryptField: async () => '' },
  '@/features/agent-management': { BotNodeClient: class {}, createRegistryEndpointResolver: () => ({}) },
  '@/app/routes/inline-bot-execution': {
    executeBotOrInline: async () => { analyzer.calls += 1; return { response: analyzer.answer }; },
  },
};

/** Where the stub Router records handlers by "METHOD path"; express binds once at require. */
let recording = {};
const record = (method) => (p, ...h) => { recording[`${method} ${p}`] = h[h.length - 1]; };
const EXPRESS = { Router: () => ({ get: record('GET'), post: record('POST'), use() {} }), raw: () => () => {} };

/** Run `fn` while framework imports and express resolve to the in-process stubs above. */
function withStubs(handlers, fn) {
  recording = handlers;
  const stubs = Object.assign({}, STUB_EXPORTS, { express: EXPRESS });
  const original = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    return original.call(this, request, parent, isMain);
  };
  try { return fn(); } finally { Module._load = original; }
}

const routesModule = withStubs({}, () => require(path.join(ROOT, 'routes', 'youtube-kids-routes.js')));

/**
 * A one-row activity store that admits statements the way the kernel does for `role`: a reader may
 * read and may repeat an idempotent declaration (CREATE ... IF NOT EXISTS), and any other mutation
 * is refused before it runs.
 */
function store(role, row) {
  const state = { row: row && { ...row }, writes: [] };
  const pool = {
    query: async (text, values) => {
      const sql = String(text).trim();
      const mutation = /^(INSERT|UPDATE|DELETE|MERGE|TRUNCATE|ALTER|DROP|CREATE|GRANT|REVOKE)\b/i.test(sql);
      const idempotentDeclaration = /^CREATE\s+(UNIQUE\s+)?(TABLE|INDEX)\s+IF\s+NOT\s+EXISTS\b/i.test(sql);
      if (mutation && role !== 'writer' && !idempotentDeclaration) throw new Error(READER_REFUSAL);
      if (/^UPDATE oshal_youtube_activity SET brief/i.test(sql)) {
        state.writes.push(values);
        state.row = { ...state.row, brief: values[1], brief_at: new Date().toISOString() };
        return { rows: [], rowCount: 1 };
      }
      if (/^SELECT/i.test(sql)) {
        if (!state.row) return { rows: [], rowCount: 0 };
        return { rows: [{ ...state.row, has_data: state.row.aggregate != null }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  };
  return { pool, state };
}

/** Run one route as signed-in parent-1 under the admission its method gets on the kernel. */
async function call(route, row) {
  const role = route.startsWith('GET ') ? 'reader' : 'writer';
  const { pool, state } = store(role, row);
  const handlers = {};
  withStubs(handlers, () => routesModule.createYoutubeKidsRoutes({ pool, appPackageDir: ROOT }));
  const sent = { status: 200, body: undefined };
  const res = { status(code) { sent.status = code; return res; }, json(body) { sent.body = body; return res; } };
  assert.ok(handlers[route], `${route} is served`);
  await handlers[route]({ oidc: { user: { sub: 'parent-1' } }, query: {}, body: {} }, res);
  return { sent, state };
}

const UPLOADED = { aggregate: { totalWatched: 3, topChannels: [] }, brief: null, brief_at: null };

test.beforeEach(() => { analyzer.calls = 0; analyzer.answer = '## Top interests\n- Minecraft builds'; });

test('GET /brief under read admission answers "not analyzed" without running the analyzer or writing', async () => {
  const { sent, state } = await call('GET /brief', UPLOADED);
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.equal(sent.body.brief, null);
  assert.equal(sent.body.hasData, true);
  assert.equal(sent.body.analyzed, false);
  assert.equal(analyzer.calls, 0, 'a read never spends an analyzer call');
  assert.deepEqual(state.writes, []);
});

test('GET /brief answers the stored brief, and hasData:false before an upload (200s: the kernel masks a GET 404)', async () => {
  const stored = await call('GET /brief', { ...UPLOADED, brief: '## Top interests', brief_at: '2026-10-11T00:00:00Z' });
  assert.equal(stored.sent.status, 200);
  assert.equal(stored.sent.body.brief, '## Top interests');
  assert.equal(stored.sent.body.cached, true);
  const empty = await call('GET /brief', null);
  assert.equal(empty.sent.status, 200);
  assert.deepEqual([empty.sent.body.brief, empty.sent.body.hasData], [null, false]);
  assert.equal(analyzer.calls, 0);
});

test('GET /status reads under read admission without a schema bootstrap', async () => {
  const { sent } = await call('GET /status', { ...UPLOADED, total_watched: 3, has_brief: false });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.equal(sent.body.hasData, true);
});

test('POST /brief runs the analyzer once and stores the brief', async () => {
  const { sent, state } = await call('POST /brief', UPLOADED);
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.equal(sent.body.brief, analyzer.answer);
  assert.equal(sent.body.cached, false);
  assert.equal(analyzer.calls, 1);
  assert.deepEqual(state.writes, [['parent-1', analyzer.answer]]);
});

test('POST /brief refuses no_data before an upload and reports an empty analysis', async () => {
  const none = await call('POST /brief', null);
  assert.equal(none.sent.status, 404);
  assert.equal(none.sent.body.error, 'no_data');
  assert.equal(analyzer.calls, 0);
  analyzer.answer = '   ';
  const empty = await call('POST /brief', UPLOADED);
  assert.equal(empty.sent.status, 502);
  assert.equal(empty.sent.body.error, 'empty_brief');
  assert.deepEqual(empty.state.writes, []);
});

const HTML = fs.readFileSync(path.join(ROOT, 'tools', 'youtube-kids-dashboard.html'), 'utf8');
const SCRIPT = [...HTML.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');

/** Load the page with `routes` keyed "METHOD url"; returns its sandbox, element doubles and requests. */
async function page(routes) {
  const nodes = {};
  const node = (id) => (nodes[id] = nodes[id] || {
    id, innerHTML: '', textContent: '', className: '', style: {}, attrs: {},
    firstChild: { textContent: '' }, classList: { add() {}, remove() {} }, setAttribute() {}, click() {},
  });
  const asked = [];
  const sandbox = {
    document: { getElementById: node, querySelectorAll: () => [], addEventListener() {} },
    fetch: async (url, init) => {
      const key = `${(init && init.method) || 'GET'} ${String(url).split('?')[0]}`;
      asked.push(key);
      const [status, body] = routes[key] || [404, { detail: 'application is not installed' }];
      return { ok: status < 400, status, json: async () => body };
    },
    console, setTimeout, encodeURIComponent, Promise,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SCRIPT, sandbox, { filename: 'youtube-kids-dashboard.html' });
  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setImmediate(resolve));
  return { sandbox, nodes, asked };
}

const HAS_DATA = { 'GET /api/youtube-kids/status': [200, { hasData: true, totalWatched: 3, dateRange: {} }] };

test('the page asks for the analysis with POST when GET answers that the history is not analyzed', async () => {
  const { nodes, asked } = await page({ ...HAS_DATA,
    'GET /api/youtube-kids/brief': [200, { brief: null, hasData: true, analyzed: false }],
    'POST /api/youtube-kids/brief': [200, { brief: '## Top interests\n- Minecraft builds', cached: false }] });
  assert.deepEqual(asked.filter((a) => a.endsWith('/brief')), ['GET /api/youtube-kids/brief', 'POST /api/youtube-kids/brief']);
  assert.match(nodes.main.innerHTML, /Minecraft builds/);
});

test('a stored brief renders with no analyzer request, and Re-analyze posts', async () => {
  const { sandbox, nodes, asked } = await page({ ...HAS_DATA,
    'GET /api/youtube-kids/brief': [200, { brief: '## Top interests\n- Lego', cached: true }],
    'POST /api/youtube-kids/brief': [200, { brief: '## Top interests\n- Trains', cached: false }] });
  assert.deepEqual(asked.filter((a) => a.endsWith('/brief')), ['GET /api/youtube-kids/brief']);
  assert.match(nodes.main.innerHTML, /Lego/);
  asked.length = 0;
  await sandbox.loadBrief(true);
  assert.deepEqual(asked.filter((a) => a.endsWith('/brief')), ['POST /api/youtube-kids/brief']);
  assert.match(nodes.main.innerHTML, /Trains/);
});

test('the page shows the upload screen when GET says there is no watch history, without posting', async () => {
  const { nodes, asked } = await page({ ...HAS_DATA,
    'GET /api/youtube-kids/brief': [200, { brief: null, hasData: false, analyzed: false }] });
  assert.deepEqual(asked.filter((a) => a.endsWith('/brief')), ['GET /api/youtube-kids/brief']);
  assert.match(nodes.main.innerHTML, /watch-history/);
});
