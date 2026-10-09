/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The audience view contract of this package's page (ADR-164 D6): the shared kit is loaded right after the theme bootstrap, the page boots the kit with exactly the audiences it provides and its own application name, the full-page start is gated on the kit's decision, the head block parses, and every read in it stays on this package's own routes (plus the framework connect list where the page already reads it). Static, no browser, no network.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The Print Ingest company view asserted as behaviour over the package's REAL routes: GET /documents from routes/print-ingest-routes.js (the whole router, loaded with only express and the framework aliases stubbed, a stub pool, walked the way Express walks it) and GET /home-summary from routes/home-summary.js, their answers JSON round-tripped as Express sends them. On open the view makes exactly those two reads and every query behind them is a SELECT of the caller's own rows; it never approves, rejects, imports, reads the destinations or the readiness count, and never writes. The inbox paints as four stats (awaiting approval, failed or partial, received in 5 days from the route's counts; fully filed from the list), a title ladder, a table of the newest ten (state, origin, characters, the machine's proposal or where each copy went, received), a failed-or-partly-filed list with the route's reasons and the route's notes. The 200-row cap, odd rows, counts the summary could not check, signed out, refused (the catalog-less admin-only admission named), the route's own failure, an unreadable answer and an unreachable server each read as what they are. The page's body script binds and reads nothing under the view and runs its whole start without it or without the kit; the full page keeps its own colour scheme under the bootstrap.
 * -----------------------------------------------------------------------------
 * @module audience-view.test
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const APP = 'print-ingest';
const PAGE = 'ui/index.html';
const AUDIENCES = ["company", "family"];
const ALLOWED_PREFIXES = ["/api/print-ingest"];
const GATE_FILE = 'ui/index.html';

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, PAGE), 'utf8');
const start = html.indexOf('<script src="/shared/ui/js/app-view.js"></script>');
const block = (() => { const s = html.indexOf('<script>', start); const e = html.indexOf('</script>', s); return html.slice(s + 8, e); })();

test('the shared kit is loaded right after the theme bootstrap, stylesheet first', () => {
  const bootstrap = html.indexOf('<script src="/shared/ui/js/surface-theme.js"></script>');
  assert.ok(bootstrap >= 0, 'theme bootstrap present');
  const css = html.indexOf('<link rel="stylesheet" href="/shared/ui/css/app-view.css" />');
  assert.ok(css > bootstrap && start > css, 'app-view.css then app-view.js follow the bootstrap');
  assert.equal(html.split('/shared/ui/js/app-view.js').length - 1, 1, 'the kit is included once');
});

test('the page boots the kit with its own application name and exactly the audiences it provides', () => {
  const boot = block.match(/A\.boot\(\{([\s\S]*?)\}\);/);
  assert.ok(boot, 'A.boot({...}) present');
  assert.match(boot[1], new RegExp("app: '" + APP + "'"));
  const declared = boot[1].match(/audiences: \{([^}]*)\}/);
  assert.ok(declared, 'audiences map present');
  const names = declared[1].split(',').map(s => s.split(':')[0].trim()).filter(Boolean).sort();
  assert.deepEqual(names, [...AUDIENCES].sort());
  assert.match(boot[1], /escapeLabel: '[^']+'/, 'the escape names the full application');
});

test('the full page start is gated on the kit decision and survives a missing kit', () => {
  const gated = GATE_FILE === PAGE ? html : fs.readFileSync(path.join(ROOT, GATE_FILE), 'utf8');
  assert.match(gated, /if \(!window\.AppView \|\| !AppView\.active\(\)\)/);
});

test('the head block parses and reads only this package\x27s own routes', () => {
  assert.doesNotThrow(() => new Function(block));
  const reads = [...block.matchAll(/fetch\(\s*'([^']+)'/g)].map(m => m[1]).concat([...block.matchAll(/fetch\(\s*(BASE|API)\s*\+/g)].map(() => ALLOWED_PREFIXES[0]));
  assert.ok(reads.length >= 1, 'the block reads through fetch');
  for (const r of reads) assert.ok(ALLOWED_PREFIXES.some(p => r === p || r.startsWith(p + '/')), 'read stays on an allowed prefix: ' + r);
  assert.doesNotMatch(block, /innerHTML\s*=/, 'the block builds no HTML from data');
});

const Module = require('node:module');
const DOCS = '/api/print-ingest/documents', SUMMARY = '/api/print-ingest/home-summary';
const PAGE_URL = '/api/print-ingest/app';
const SUB = 'synthetic-sub';
const HONESTY = 'Counts saved, deduplicated owner intake records. Fully ingested and partially ingested stay distinct; receipt is not filing. Explicit document preparation transfers a bounded text excerpt into Office without approving any knowledge-base destinations.';

/** @returns {object} A signed-in (or signed-out) OIDC request context, as express-openid-connect provides it. */
const oidc = (signedIn) => (signedIn ? { user: { sub: SUB }, isAuthenticated: () => true } : { isAuthenticated: () => false });

/** @returns {object} A stub Express response that records the status and the JSON body. */
function response() {
  return { statusCode: 200, body: undefined, setHeader() {}, type() { return this; }, status(s) { this.statusCode = s; return this; }, json(b) { this.body = b; }, send(b) { this.body = b; } };
}

/**
 * @description A stub pg pool: records every query and answers it through `answer(text)` (an Error rejects that query).
 * @param {(text: string) => object[]|object|Error} answer Rows (or one row) for a query text.
 * @returns {{ query: Function, calls: Array<{text: string, values: any[]}> }} The pool and its recorded queries.
 */
function stubPool(answer) {
  const calls = [];
  const query = (q, values) => {
    const text = typeof q === 'string' ? q : q.text;
    calls.push({ text, values: typeof q === 'string' ? values : q.values });
    const a = answer(text);
    return a instanceof Error ? Promise.reject(a) : Promise.resolve({ rows: Array.isArray(a) ? a : [a] });
  };
  return { query, calls };
}

/** @returns {object} An express Router double that keeps every registration in order, so dispatch() can walk it as Express does. */
function recordingRouter() {
  const router = { stack: [] };
  ['get', 'post', 'put', 'patch', 'delete'].forEach((method) => { router[method] = (p, ...fns) => { router.stack.push({ method, path: p, fns }); return router; }; });
  router.use = (...args) => { const p = typeof args[0] === 'string' ? args.shift() : '/'; router.stack.push({ method: 'use', path: p, fns: args }); return router; };
  router.param = () => router;
  return router;
}

/** The modules the compiled routes import outside the package, stubbed to what route registration and a read touch. */
const STUBS = {
  express: { Router: recordingRouter },
  '@/shared/logger': { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) },
  '@/shared/middleware/authz': { getTrustedServiceUserSub: () => null },
  '@/features/rag': { RagService: class { ingest() { throw new Error('RagService.ingest is never reached by a read'); } } },
};

/**
 * @description Require one of the package's compiled route modules with STUBS in place of express and the framework
 * aliases. Every package-relative module and node built-in is the real one; any other import fails the test.
 * @param {string} file The module path under the package root.
 * @returns {object} The module's exports.
 */
function requirePackage(file) {
  const original = Module._load;
  Module._load = function load(request) {
    if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
    assert.ok(request.startsWith('.') || path.isAbsolute(request) || Module.isBuiltin(request), 'unexpected import in the routes: ' + request);
    return original.apply(this, arguments);
  };
  try { return require(path.join(ROOT, file)); } finally { Module._load = original; }
}

/** @returns {Promise<boolean>} Run one handler or middleware; true when it called next(). */
async function passes(fn, req, res) { let next = false; await fn(req, res, () => { next = true; }); return next; }

/**
 * @description Walk a recorded router the way Express does: mounted middleware in order, then the route whose method and
 * path match. A handler that does not call next() answers the request.
 * @param {object} router A recordingRouter().
 * @param {string} method Lower-case HTTP method.
 * @param {string} url The path under the router's mount.
 * @param {object} req The request double.
 * @param {object} res The response double.
 * @returns {Promise<boolean>} Whether a handler answered.
 */
async function dispatch(router, method, url, req, res) {
  for (const layer of router.stack) {
    if (layer.method === 'use') {
      if (layer.path !== '/' && url !== layer.path && !url.startsWith(layer.path + '/')) continue;
      for (const fn of layer.fns) if (!(await passes(fn, req, res))) return true;
    } else if (layer.method === method && layer.path === url) {
      for (const fn of layer.fns) if (!(await passes(fn, req, res))) return true;
    }
  }
  return false;
}

/**
 * @description Answer GET /documents (the view's read, no state filter) with the package's REAL router
 * (routes/print-ingest-routes.js) over a stub pool.
 * @param {{rows?: object[], signedIn?: boolean}} [db] The print_intake rows the SELECT answers, and whether the caller is signed in.
 * @returns {Promise<{http: number, body: object, calls: object[]}>} The route's HTTP status, JSON body and queries.
 */
async function realDocuments({ rows = [], signedIn = true } = {}) {
  const { createPrintIngestRoutes } = requirePackage('routes/print-ingest-routes.js');
  const pool = stubPool((text) => (/FROM print_intake\b/.test(text) ? rows : new Error('unexpected query: ' + text)));
  const router = createPrintIngestRoutes({ pool, appPackageDir: ROOT });
  const res = response();
  assert.ok(await dispatch(router, 'get', '/documents', { oidc: oidc(signedIn), params: {}, query: {}, headers: {}, body: {} }, res), 'a real route answers GET /documents');
  return { http: res.statusCode, body: res.body, calls: pool.calls };
}

/**
 * @description Answer GET /home-summary with the package's REAL route (routes/home-summary.js) over a stub pool.
 * @param {{counts?: object|Error, recent?: object[]|Error, signedIn?: boolean}} [db] What the counts query and the
 *   newest-documents query answer, and whether the caller is signed in.
 * @returns {Promise<{http: number, body: object, calls: object[]}>} The route's HTTP status, JSON body and queries.
 */
async function realSummary({ counts = { review: '0', failed: '0', five: '0' }, recent = [], signedIn = true } = {}) {
  const { createHomeSummaryRoutes } = requirePackage('routes/home-summary.js');
  const pool = stubPool((text) => (/count\(\*\)/.test(text) ? counts : recent));
  const res = response();
  assert.ok(await dispatch(createHomeSummaryRoutes({ pool }), 'get', '/', { oidc: oidc(signedIn) }, res), 'the real summary route answers');
  return { http: res.statusCode, body: res.body, calls: pool.calls };
}

/**
 * @description Run the head block against a stub kit, window and fetch. Bodies are JSON round-tripped as Express sends them
 * (a Date column arrives as an ISO string). The stub formatters tag their input: W(...) = AppView.when, N(...) = AppView.num.
 * @param {Object<string, {http: number, body: object|undefined}|Error>} answers What each read answers (an undefined body
 *   is not JSON; an Error rejects the fetch, a network failure). A read with no answer is a 404.
 * @returns {{ company: Function, urls: string[], assigned: string[] }} The builder, every request made, every frame navigation.
 */
function loadCompany(answers) {
  let config = null;
  const urls = [], assigned = [];
  const kit = { boot: (c) => { config = c; }, when: (v) => 'W(' + v + ')', num: (v) => 'N(' + v + ')' };
  const win = { AppView: kit, location: { pathname: PAGE_URL, search: '?audience=company', assign: (href) => assigned.push(href) } };
  const fetchStub = (url, opt) => {
    urls.push(((opt && opt.method) || 'GET') + ' ' + url);
    const a = answers[url] || { http: 404, body: { error: 'Synthetic endpoint unavailable' } };
    if (a instanceof Error) return Promise.reject(a);
    const wire = a.body === undefined ? undefined : JSON.parse(JSON.stringify(a.body));
    return Promise.resolve({ ok: a.http < 400, status: a.http, json: () => (wire === undefined ? Promise.reject(new SyntaxError('not JSON')) : Promise.resolve(wire)) });
  };
  new Function('window', 'fetch', block)(win, fetchStub);
  assert.ok(config && typeof config.audiences.company === 'function', 'the block boots the company audience');
  return { company: config.audiences.company, urls, assigned };
}

/** @returns {Promise<object>} The company model painted from the two answers (each a promise, an answer or an Error). */
async function paint(documents, summary) {
  const settle = async (a) => (a instanceof Error ? a : await a);
  return loadCompany({ [DOCS]: await settle(documents), [SUMMARY]: await settle(summary) }).company({ refresh() {} });
}

const T1 = '2026-09-28T10:00:00.000Z', T2 = '2026-09-27T09:00:00.000Z', T3 = '2026-09-26T08:00:00.000Z', T4 = '2026-09-24T07:00:00.000Z', T5 = '2026-09-20T06:00:00.000Z';
const at = (iso) => new Date(iso);
/** @returns {object} One machine proposal as print-classify builds it. */
const proposal = (id, label, recommended) => ({ id, label, kind: id === 'my-knowledge' ? 'private' : 'bot', recommended, confidence: recommended ? 'high' : 'low', reason: 'Synthetic reason', readableBy: id === 'my-knowledge' ? 'only you' : 'everyone signed in' });
/** @returns {object} One fan-out result as print-fanout records it. */
const copy = (destinationId, label, ok, error) => Object.assign({ destinationId, label, kind: 'bot', collection: 'agent-knowledge-' + destinationId, privateToOwner: false, ok, ragDocId: 'print:synthetic', writtenAt: T2 }, ok ? {} : { error });
/**
 * @description A print_intake row as `SELECT *` returns it (Date columns as Date objects, JSONB as parsed values).
 * @param {string} id The intake id.
 * @param {string} title The document title.
 * @param {string} state The intake state.
 * @param {object} [opt] sidecar, proposals, fanout, failure, created, decided, chars.
 * @returns {object} The row.
 */
function intake(id, title, state, opt = {}) {
  return { intake_id: id, owner_sub: SUB, content_sha256: 'sha-' + id, title, text_chars: opt.chars === undefined ? 1204 : opt.chars, text_body: 'Synthetic text body.',
    sidecar: opt.sidecar || { originatingComputer: 'SYNTH-PC', printerName: 'oshal Print', requestingUser: 'synthetic-user', clientIp: '10.0.0.9' },
    recommendation: { title, proposals: opt.proposals || [], appliedRule: null, suggestedUserSub: null }, approved_destinations: [], fanout: opt.fanout || [], state,
    failure_reason: opt.failure || null, applied_rule_id: null, ticket_id: null, created_at: at(opt.created || T1), decided_at: opt.decided ? at(opt.decided) : null, decided_by: opt.decided ? SUB : null };
}
const INVOICE = intake('i1', 'Synthetic Invoice', 'awaiting_approval', { proposals: [proposal('finance', 'Finance bot', true), proposal('my-knowledge', 'Private to me', false)] });
const MANUAL = intake('i2', 'Synthetic Pump Manual', 'ingested', { created: T2, decided: T2, chars: 48210, fanout: [copy('maintenance', 'Maintenance bot', true), copy('my-knowledge', 'Private to me', true)] });
const MEMO = intake('i3', 'Synthetic Memo', 'partially_ingested', { created: T3, decided: T3, fanout: [copy('maintenance', 'Maintenance bot', true), copy('finance', 'Finance bot', false, 'Synthetic chroma timeout')], failure: 'Finance bot: Synthetic chroma timeout' });
const FLYER = intake('i4', 'Synthetic Flyer', 'rejected', { created: T4, decided: T4, failure: 'rejected by approver' });
const NOTES = intake('i5', 'Synthetic Notes', 'failed', { created: T5, decided: T5, fanout: [copy('finance', 'Finance bot', false, 'Synthetic write refused')], failure: 'Finance bot: Synthetic write refused' });
const ROWS = [INVOICE, MANUAL, MEMO, FLYER, NOTES];
const COUNTS = { review: '1', failed: '2', five: '4' };
const RECENT = [INVOICE, MEMO, NOTES].map((r) => ({ title: r.title, state: r.state, text_chars: r.text_chars, excerpt: 'Synthetic excerpt', created_at: r.created_at }));
const section = (model, id) => model.sections.find((x) => x && x.id === id);
const stat = (model, id) => model.stats.find((x) => x.id === id);
const items = (model, id) => section(model, id).items.map((t) => [t.title, t.text, t.meta, t.badge || null, t.tone || null]);

test('on open the view reads only GET /documents and GET /home-summary, and the routes behind them only SELECT the caller\x27s rows', async () => {
  const manifest = fs.readFileSync(path.join(ROOT, 'oshal-app.yaml'), 'utf8');
  assert.match(manifest, /module: routes\/home-summary\.js\s+factory: createHomeSummaryRoutes\s+mountPath: \/api\/print-ingest\/home-summary\n/);
  assert.match(manifest, /module: routes\/print-ingest-routes\.js\s+factory: createPrintIngestRoutes\s+mountPath: \/api\/print-ingest\n/);
  const documents = await realDocuments({ rows: ROWS }), summary = await realSummary({ counts: COUNTS, recent: RECENT });
  const view = loadCompany({ [DOCS]: documents, [SUMMARY]: summary });
  await view.company({ refresh() {} });
  assert.deepEqual(view.urls, ['GET ' + DOCS, 'GET ' + SUMMARY]);
  for (const call of documents.calls.concat(summary.calls)) {
    assert.match(call.text.trim(), /^SELECT /, 'a read only SELECTs');
    assert.match(call.text, /owner_sub = \$1/, 'scoped to the caller');
    assert.equal(call.values[0], SUB, 'bound to the signed-in sub');
  }
  assert.equal(documents.calls[0].values[1], null, 'the view reads every state, unfiltered');
  assert.doesNotMatch(block, /\/approve|\/reject|import-artifact|\/destinations|\/readiness|method:/, 'no decision, import, catalog, readiness or write path in the view');
});

test('the stats, the newest documents, the failures and the route\x27s notes paint the account\x27s own inbox', async () => {
  const model = await paint(realDocuments({ rows: ROWS }), realSummary({ counts: COUNTS, recent: RECENT }));
  assert.deepEqual([model.kicker, model.title, model.actions.map((a) => a.label)], ['Knowledge · Print Ingest', '1 document awaiting filing approval', ['Open the Print Inbox']]);
  assert.match(model.lede, /never approves, rejects or files a document\.$/);
  assert.deepEqual(model.stats.map((x) => [x.id, x.label, x.value, x.tone, x.hint]), [
    ['intake-review', 'Awaiting filing approval', '1', 'warn', null],
    ['intake-needs-attention', 'Failed / partial filing', '2', 'bad', null],
    ['intake-5d', 'Received / 5 days', '4', null, null],
    ['filed', 'Fully filed', '1', 'ok', null],
  ]);
  const table = section(model, 'documents');
  assert.deepEqual(table.columns.map((c) => (typeof c === 'string' ? c : c.label)), ['Document', 'State', 'From', 'Characters', 'Proposed or filed to', 'Received']);
  assert.deepEqual(table.rows, [
    ['Synthetic Invoice', { text: 'awaiting approval', tone: 'warn' }, 'SYNTH-PC · oshal Print', 'N(1204)', 'Proposed: Finance bot', 'W(' + T1 + ')'],
    ['Synthetic Pump Manual', { text: 'ingested', tone: 'ok' }, 'SYNTH-PC · oshal Print', 'N(48210)', 'Maintenance bot, Private to me', 'W(' + T2 + ')'],
    ['Synthetic Memo', { text: 'partially ingested', tone: 'warn' }, 'SYNTH-PC · oshal Print', 'N(1204)', 'Maintenance bot, Finance bot (failed)', 'W(' + T3 + ')'],
    ['Synthetic Flyer', { text: 'rejected', tone: null }, 'SYNTH-PC · oshal Print', 'N(1204)', 'Nothing written', 'W(' + T4 + ')'],
    ['Synthetic Notes', { text: 'failed', tone: 'bad' }, 'SYNTH-PC · oshal Print', 'N(1204)', 'Finance bot (failed)', 'W(' + T5 + ')'],
  ]);
  assert.equal(table.note, null);
  assert.doesNotMatch(JSON.stringify(model), /synthetic-user|10\.0\.0\.9|Synthetic text body|Synthetic excerpt/, 'the declared user, the client address and the text never reach the view');
  assert.deepEqual(items(model, 'attention'), [
    ['Synthetic Memo', 'Finance bot: Synthetic chroma timeout', 'W(' + T3 + ')', 'partially ingested', 'warn'],
    ['Synthetic Notes', 'Finance bot: Synthetic write refused', 'W(' + T5 + ')', 'failed', 'bad'],
  ]);
  assert.deepEqual(section(model, 'notes').items.map((i) => [i.title, i.tone]), [[HONESTY, null]]);
});

test('the title names the inbox state: awaiting approval, failed or partly filed, nothing awaiting, nothing yet', async () => {
  const failing = await paint(realDocuments({ rows: [MEMO, NOTES] }), realSummary({ counts: { review: '0', failed: '2', five: '2' } }));
  assert.deepEqual([failing.title, stat(failing, 'intake-review').tone, stat(failing, 'filed').tone], ['2 documents failed or only partly filed', null, null]);
  const one = await paint(realDocuments({ rows: [NOTES] }), realSummary({ counts: { review: '0', failed: '1', five: '1' } }));
  assert.equal(one.title, '1 document failed or only partly filed');
  const many = await paint(realDocuments({ rows: ROWS }), realSummary({ counts: { review: '3', failed: '0', five: '5' } }));
  assert.equal(many.title, '3 documents awaiting filing approval');
  const clear = await paint(realDocuments({ rows: [MANUAL, FLYER] }), realSummary({ counts: { review: '0', failed: '0', five: '0' } }));
  assert.deepEqual([clear.title, stat(clear, 'intake-needs-attention').tone, items(clear, 'attention')], ['Nothing awaiting filing approval', null, []]);
  const none = await paint(realDocuments({ rows: [] }), realSummary());
  assert.deepEqual([none.title, section(none, 'documents').rows, stat(none, 'filed').value], ['No printed documents yet', [], '0']);
  assert.match(section(none, 'documents').empty, /^No printed document has reached this inbox yet\./);
  assert.equal(section(none, 'attention').empty, 'No failed or partly filed document.');
  assert.deepEqual(section(none, 'notes').items.map((i) => i.title), ['No saved work yet. Open the app to begin.', HONESTY]);
});

test('the table shows the newest ten, a full 200-row list is named as a floor, and odd rows read plainly', async () => {
  const twelve = Array.from({ length: 12 }, (_, i) => intake('n' + i, 'Synthetic Doc ' + i, 'ingested', { created: T1 }));
  const shown = await paint(realDocuments({ rows: twelve }), realSummary({ counts: { review: '0', failed: '0', five: '12' } }));
  assert.deepEqual([section(shown, 'documents').rows.length, section(shown, 'documents').note, stat(shown, 'filed').hint], [10, 'The newest 10 of 12 printed documents.', null]);
  const full = Array.from({ length: 200 }, (_, i) => intake('f' + i, 'Synthetic Doc ' + i, 'ingested', { created: T2 }));
  const capped = await paint(realDocuments({ rows: full }), realSummary({ counts: { review: '0', failed: '0', five: '0' } }));
  assert.deepEqual([section(capped, 'documents').note, stat(capped, 'filed').value, stat(capped, 'filed').hint, section(capped, 'attention').empty],
    ['The newest 10 of at least 200 printed documents.', '200', 'Among the newest 200', 'None among the newest 200 documents.']);
  const sent = intake('o1', '', 'awaiting_approval', { sidecar: { documentName: 'synthetic.pdf', source: 'send-to' }, chars: null });
  const bare = intake('o2', 'Synthetic Bare', 'failed', { sidecar: {} });
  const odd = intake('o3', 'Synthetic Odd', 'archived', { proposals: [proposal('finance', 'Finance bot', false)] });
  const model = await paint(realDocuments({ rows: [sent, bare, odd] }), realSummary({ counts: { review: '1', failed: '1', five: '3' } }));
  assert.deepEqual(section(model, 'documents').rows.map((r) => [r[0], r[1], r[2], r[3], r[4]]), [
    ['Untitled document', { text: 'awaiting approval', tone: 'warn' }, 'Send to…', 'N(null)', 'Nothing proposed'],
    ['Synthetic Bare', { text: 'failed', tone: 'bad' }, 'unknown machine', 'N(1204)', 'No copy written'],
    ['Synthetic Odd', { text: 'archived', tone: null }, 'SYNTH-PC · oshal Print', 'N(1204)', 'No copy written'],
  ]);
  assert.deepEqual(items(model, 'attention'), [['Synthetic Bare', 'No copy was written.', 'W(' + T1 + ')', 'failed', 'bad']]);
});

test('counts the summary could not check are named while the documents still show', async () => {
  const partial = await paint(realDocuments({ rows: ROWS }), realSummary({ counts: new Error('synthetic timeout'), recent: RECENT }));
  assert.equal(partial.title, 'Some saved counts cannot be checked');
  assert.deepEqual(partial.stats.map((x) => [x.id, x.value, x.tone, x.hint]), [
    ['intake-review', 'Unavailable', 'warn', 'Could not be checked'],
    ['intake-needs-attention', 'Unavailable', 'warn', 'Could not be checked'],
    ['intake-5d', 'Unavailable', 'warn', 'Could not be checked'],
    ['filed', '1', 'ok', null],
  ]);
  assert.deepEqual(section(partial, 'notes').items.map((i) => [i.title, i.tone]), [['Some saved sources cannot be checked.', 'warn'], [HONESTY, null]]);
  const down = await realSummary({ counts: new Error('synthetic down'), recent: new Error('synthetic down') });
  assert.equal(down.http, 503, 'the real route answers 503 when every source failed');
  const dead = await paint(realDocuments({ rows: ROWS }), down);
  assert.deepEqual([dead.title, stat(dead, 'intake-review').value, section(dead, 'documents').rows.length], ['Some saved counts cannot be checked', 'Unavailable', 5]);
  assert.deepEqual(section(dead, 'notes').items.map((i) => [i.title, i.tone]), [['The saved counts cannot be checked right now (HTTP 503).', 'warn']]);
  const signedOut = await paint(realDocuments({ rows: ROWS }), realSummary({ signedIn: false }));
  assert.deepEqual(section(signedOut, 'notes').items.map((i) => i.title), ['The saved counts were refused for this session (HTTP 401).']);
  const offline = await paint(realDocuments({ rows: ROWS }), new TypeError('Failed to fetch'));
  assert.deepEqual([offline.title, section(offline, 'notes').items.map((i) => i.title)], ['Some saved counts cannot be checked', ['The saved counts could not be reached.']]);
  const html500 = await paint(realDocuments({ rows: ROWS }), { http: 500, body: undefined });
  assert.deepEqual(section(html500, 'notes').items.map((i) => i.title), ['The saved counts cannot be checked right now (HTTP 500).']);
});

test('signed out, refused, the route\x27s own failure, an unreadable answer and an unreachable server each read as what they are', async () => {
  const out = await realDocuments({ signedIn: false });
  assert.deepEqual([out.http, out.calls.length], [401, 0], 'the real route refuses a signed-out caller before any query');
  const signedOut = await paint(out, realSummary({ signedIn: false }));
  assert.deepEqual([signedOut.title, signedOut.stats, signedOut.sections], ['Sign in to see the print inbox', undefined, undefined]);
  const admin = await paint({ http: 403, body: { error: 'authorization_app_admin_required', decisionId: 'synthetic-decision' } }, realSummary());
  assert.deepEqual([admin.title, admin.lede], ['This account cannot open Print Ingest', 'Print Ingest declares no role catalog, so only its application administrators are admitted, and this account is not one (HTTP 403).']);
  const denied = await paint({ http: 403, body: {} }, realSummary());
  assert.equal(denied.lede, 'The Print Ingest routes refused this account (HTTP 403).');
  await assert.rejects(paint({ http: 500, body: undefined }, realSummary()), /^Error: The print inbox cannot be read right now \(HTTP 500\)\.$/, 'a non-JSON failure keeps its status');
  await assert.rejects(paint({ http: 502, body: { error: 'Synthetic inbox offline' } }, realSummary()), /^Error: Synthetic inbox offline$/, 'a failure with its own error keeps it');
  await assert.rejects(paint({ http: 200, body: { intake: [] } }, realSummary()), /^Error: The print inbox answered in a form this view cannot read\.$/);
  await assert.rejects(paint(new TypeError('Failed to fetch'), realSummary()), /^Error: The print inbox could not be reached\. Check the connection and try again\.$/);
});

test('the one hero action opens the full Print Inbox in the frame, without the audience', async () => {
  const view = loadCompany({ [DOCS]: await realDocuments({ rows: ROWS }), [SUMMARY]: await realSummary({ counts: COUNTS, recent: RECENT }) });
  const model = await view.company({ refresh() {} });
  model.actions[0].onClick();
  assert.deepEqual(view.assigned, [PAGE_URL]);
  assert.equal(model.escape, undefined, 'the kit supplies the escape to the cockpit');
});

/** @returns {object} A stub element that counts the listeners bound on it and keeps what the script paints. */
function node(calls, extra) { return Object.assign({ innerHTML: '', dataset: {}, setAttribute() {}, addEventListener() { calls.listeners++; } }, extra || {}); }

/**
 * @description Run the page's body script (the full Print Inbox) against a stub DOM and fetch, then let its async start settle.
 * @param {string|null|undefined} activeView What AppView.active() answers, null for the full page, undefined for a core without the kit.
 * @returns {Promise<{ listeners: number, reads: string[], painted: string }>} Listeners bound, every URL fetched, the list's HTML.
 */
async function runBody(activeView) {
  const open = html.lastIndexOf('<script>'), src = html.slice(open + 8, html.indexOf('</script>', open));
  const calls = { listeners: 0, reads: [] };
  const list = node(calls), tabs = [node(calls, { dataset: { state: 'awaiting_approval' } }), node(calls, { dataset: { state: '' } })];
  const doc = { getElementById: () => list, querySelectorAll: () => tabs };
  const fetchStub = (url, opt) => { calls.reads.push(((opt && opt.method) || 'GET') + ' ' + url); return Promise.resolve({ ok: true, json: () => Promise.resolve({ documents: [] }) }); };
  const kit = activeView === undefined ? undefined : { active: () => activeView };
  new Function('window', 'AppView', 'document', 'fetch', src)(kit ? { AppView: kit } : {}, kit, doc, fetchStub);
  await new Promise((resolve) => setImmediate(resolve));
  return { listeners: calls.listeners, reads: calls.reads, painted: list.innerHTML };
}

test('under an audience view the body script binds nothing and reads nothing; the full page runs its whole start, with or without the kit', async () => {
  assert.deepEqual(await runBody('company'), { listeners: 0, reads: [], painted: '' });
  const full = { listeners: 3, reads: ['GET /api/print-ingest/documents?state=awaiting_approval'], painted: '<div class="empty">Nothing here. Print something to the swarm printer and it will appear.</div>' };
  assert.deepEqual(await runBody(null), full);
  assert.deepEqual(await runBody(undefined), full);
});

test('the theme bootstrap leaves the full page its own colour scheme and gives the view the skin', () => {
  assert.match(html, /^<!doctype html>\n<html lang="en" data-theme="midnight">/);
  const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  assert.ok(html.indexOf('<style>') > start, 'the page style follows the kit');
  assert.match(style, /html:not\(\[data-audience\]\) \{ color-scheme: normal; \}/);
});
