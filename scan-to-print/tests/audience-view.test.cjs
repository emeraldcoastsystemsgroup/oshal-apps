/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The audience view contract of this package's page (ADR-164 D6): the shared kit is loaded right after the theme bootstrap, the page boots the kit with exactly the audiences it provides and its own application name, the full-page start is gated on the kit's decision, the head block parses, and every read in it stays on this package's own routes (plus the framework connect list where the page already reads it). Static, no browser, no network.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The Scan to Print company view asserted as behaviour over the package's REAL routes: GET /jobs and GET /printers from routes/scan-to-print-routes.js (the whole mounted router, loaded with only express, multer, sharp and the framework aliases stubbed, a stub pool, walked the way Express walks it) and GET /home-summary from routes/home-summary.js, their answers JSON round-tripped as Express serializes them. On open the view makes exactly those three reads and every route behind them only SELECTs the caller's own rows (the printers SELECT never names the key column); the objects paint as four stats (objects, printable models, failed reconstructions, sent to a printer in seven days), a title ladder, a table of the newest eight with state, source, extents and the printable verdict (shown only while a reconstruction is current), a needs-attention list (failed, not printable in the terms the validation block records, print-check warnings) and the printers by label and kind, never their address. A full 200-object list, odd rows, a seven-day count or printers list that could not be read, signed out (the route's own 401), refused (403), the route's own 500, an unreadable answer and an unreachable server each read as what they are. The surface script's one start path (the DOMContentLoaded boot, which also runs the ?artifact intake that creates an object) is gated: under the view it binds and reads nothing; without it the boot runs.
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | The compiled routes now also import the print service's trusted-service identity middleware (routes/service-routes.js, a separate mount the view never calls); it is stubbed as never reached, like every other write-path dependency, and a Bambu Lab printer is named in the empty-printers sentence.
 * -----------------------------------------------------------------------------
 * @module audience-view.test
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const APP = 'scan-to-print';
const PAGE = 'tools/scan-to-print.html';
const AUDIENCES = ["company", "family"];
const ALLOWED_PREFIXES = ["/api/scan-to-print"];
const GATE_FILE = 'tools/scan-to-print.js';

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
const os = require('node:os');
const JOBS = '/api/scan-to-print/jobs', PRINTERS = '/api/scan-to-print/printers', SUMMARY = '/api/scan-to-print/home-summary';
const PAGE_URL = '/api/scan-to-print/app';
const SUB = 'synthetic-sub';

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

const refuse = (what) => () => { throw new Error(what + ' is never reached by a read'); };
const passThrough = (_req, _res, next) => next();
const multer = Object.assign(() => ({ array: () => passThrough, single: () => passThrough }), { memoryStorage: () => ({}), diskStorage: () => ({}) });
/** The modules the compiled routes import outside the package, stubbed to what route registration touches. */
const STUBS = {
  express: { Router: recordingRouter },
  multer,
  sharp: refuse('sharp'),
  '@/shared/logger': { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) },
  '@/features/personal-data': { encryptField: refuse('encryptField'), decryptField: refuse('decryptField'), isEncrypted: () => false },
  '@/shared/security/explicit-write-confirmation': { hasExplicitWriteConfirmation: () => false, confirmationRequiredPayload: () => ({}) },
  '@/shared/middleware/trusted-service-user-identity': { requireTrustedServiceUserIdentity: refuse('requireTrustedServiceUserIdentity') },
};

/**
 * @description Require one of the package's compiled route modules with STUBS in place of express, multer, sharp and the
 * framework aliases. Every package-relative module and node built-in is the real one; any other import fails the test.
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
 * @description Walk a recorded router the way Express does: mounted middleware and nested routers in order, then the route
 * whose method and path match. A handler that does not call next() answers the request.
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
      const rest = layer.path === '/' ? url : url.slice(layer.path.length) || '/';
      for (const fn of layer.fns) {
        if (fn && Array.isArray(fn.stack)) { if (await dispatch(fn, method, rest, req, res)) return true; } else if (!(await passes(fn, req, res))) return true;
      }
    } else if (layer.method === method && layer.path === url) {
      for (const fn of layer.fns) if (!(await passes(fn, req, res))) return true;
    }
  }
  return false;
}

/**
 * @description Answer GET /jobs or GET /printers with the package's REAL mounted router (routes/scan-to-print-routes.js).
 * @param {string} url '/jobs' or '/printers'.
 * @param {{jobs?: object[]|Error, printers?: object[]|Error, env?: object, signedIn?: boolean}} [db] What each SELECT answers,
 *   the environment the router reads (the slicer setting), and whether the caller is signed in.
 * @returns {Promise<{http: number, body: object, calls: object[]}>} The route's HTTP status, JSON body and queries.
 */
async function realRead(url, { jobs = [], printers = [], env = {}, signedIn = true } = {}) {
  const { createScanToPrintRoutes } = requirePackage('routes/scan-to-print-routes.js');
  const pool = stubPool((text) => (/FROM scan_print_printer/.test(text) ? printers : /FROM scan_print_job/.test(text) ? jobs : new Error('unexpected query: ' + text)));
  const router = createScanToPrintRoutes({ pool, appPackageDir: ROOT }, { env, dataRoot: path.join(os.tmpdir(), 'scan-to-print-synthetic') });
  const res = response();
  assert.ok(await dispatch(router, 'get', url, { oidc: oidc(signedIn), params: {}, query: {}, headers: {} }, res), 'a real route answers GET ' + url);
  return { http: res.statusCode, body: res.body, calls: pool.calls };
}

/**
 * @description Answer GET /home-summary with the package's REAL route (routes/home-summary.js) over a stub pool.
 * @param {{counts?: object|Error, recent?: object[]|Error, sent?: object|Error, signedIn?: boolean}} [db] What the job counts,
 *   the newest-jobs query and the seven-day submissions count answer, and whether the caller is signed in.
 * @returns {Promise<{http: number, body: object, calls: object[]}>} The route's HTTP status, JSON body and queries.
 */
async function realSummary({ counts = { total: '0', reconstructed: '0', printable: '0', failed: '0' }, recent = [], sent = { sent: '0' }, signedIn = true } = {}) {
  const { createHomeSummaryRoutes } = requirePackage('routes/home-summary.js');
  const pool = stubPool((text) => (/scan_print_submission/.test(text) ? sent : /count\(\*\)/.test(text) ? counts : recent));
  const res = response();
  assert.ok(await dispatch(createHomeSummaryRoutes({ pool }), 'get', '/', { oidc: oidc(signedIn) }, res), 'the real summary route answers');
  return { http: res.statusCode, body: res.body, calls: pool.calls };
}

/**
 * @description Run the head block against a stub kit, window and fetch. Bodies are JSON round-tripped as Express sends them
 * (a Date column arrives as an ISO string). The stub relative-time formatter tags its input: W(...) = AppView.when.
 * @param {Object<string, {http: number, body: object|undefined}|Error>} answers What each read answers (an undefined body
 *   is not JSON; an Error rejects the fetch, a network failure). A read with no answer is a 404.
 * @returns {{ company: Function, urls: string[], assigned: string[] }} The builder, every request made, every frame navigation.
 */
function loadCompany(answers) {
  let config = null;
  const urls = [], assigned = [];
  const kit = { boot: (c) => { config = c; }, when: (v) => 'W(' + v + ')' };
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

/** @returns {Promise<object>} The company model painted from the three answers (each a promise, an answer or an Error). */
async function paint(jobs, summary, printers) {
  const settle = async (a) => (a instanceof Error ? a : await a);
  const answers = { [JOBS]: await settle(jobs), [SUMMARY]: await settle(summary), [PRINTERS]: await settle(printers === undefined ? realRead('/printers') : printers) };
  return loadCompany(answers).company({ refresh() {} });
}

const T1 = '2026-09-28T10:00:00.000Z', T2 = '2026-09-27T09:00:00.000Z', T3 = '2026-09-26T08:00:00.000Z', T4 = '2026-09-24T07:00:00.000Z', T5 = '2026-09-20T06:00:00.000Z';
const at = (iso) => new Date(iso);
const WALL = 'Print check: thinnest wall is 0.30 mm, under the 0.80 mm a 0.4 mm nozzle needs for 2 perimeters (measured to within one voxel, 0.500 mm).';
const OVERHANG = 'Print check: steepest overhang is 62° from vertical, over the 45° at which a 0.4 mm bead on 0.2 mm layers still overlaps the one below; add support or reorient the part.';
/** @returns {object} A reconstruction report as the engine writes it (the fields the view reads, plus neighbours). */
function reconstruction(sizeMm, printable, extra) {
  const validation = { watertight: printable, openEdges: printable ? 0 : 12, degenerate: 0, consistentWinding: true, outwardFacing: true, eulerCharacteristic: 2 };
  return Object.assign({ lane: 'silhouettes', sizeMm, printable, validation, method: 'visual hull', printChecks: { failures: [] }, warnings: [], limitations: ['Visual hull.'], triangleCount: 1200 }, extra || {});
}
/** @returns {object} A scan_print_job row as GET /jobs selects it (JOB_COLUMNS in routes/job-store.js). */
function job(id, title, state, source, updated, report, failure) {
  return { job_id: id, owner_sub: SUB, title, source_kind: source, state, known_dimensions: [{ axis: 'x', mm: 80 }], settings: {}, report: report || null, failure_reason: failure || null, created_at: at(T5), updated_at: at(updated) };
}
const STAND = job('j1', 'Synthetic Phone Stand', 'reconstructed', 'photos', T1, reconstruction({ x: 80, y: 60.4, z: 120 }, true));
const CUP = job('j2', 'Synthetic Cup', 'reconstructed', 'photos', T2, reconstruction({ x: 84, y: 84, z: 95.5 }, true, { lane: 'depth', printChecks: { failures: [WALL, OVERHANG] } }));
const BRACKET = job('j3', 'Synthetic Bracket', 'failed', 'video', T3, null, 'Reconstruction produced no solid voxels; check the views and the known dimension');
const SCAN = job('j4', 'Synthetic Room Scan', 'reconstructed', 'pointcloud', T4, reconstruction({ x: 300, y: 210, z: 95 }, false));
const GEAR = job('j5', 'Synthetic Gear', 'capturing', 'photos', T5, null);
const PRUSA = { printer_id: 'p1', label: 'Synthetic Prusa', kind: 'prusalink', base_url: 'http://synthetic-printer.local', created_at: at(T4) };
const VORON = { printer_id: 'p2', label: 'Synthetic Voron', kind: 'moonraker', base_url: 'http://synthetic-voron.local', created_at: at(T5) };
const section = (model, id) => model.sections.find((x) => x && x.id === id);
const stat = (model, id) => model.stats.find((x) => x.id === id);
const items = (model, id) => section(model, id).items.map((t) => [t.title, t.text, t.meta, t.badge || null, t.tone || null]);

test('on open the view makes three reads, GET /jobs, /printers and /home-summary, and every real route behind them only SELECTs the caller\x27s own rows', async () => {
  const manifest = fs.readFileSync(path.join(ROOT, 'oshal-app.yaml'), 'utf8');
  assert.match(manifest, /module: routes\/scan-to-print-routes\.js\n\s+factory: createScanToPrintRoutes\n\s+mountPath: \/api\/scan-to-print\n/);
  assert.match(manifest, /module: routes\/home-summary\.js\n\s+factory: createHomeSummaryRoutes\n\s+mountPath: \/api\/scan-to-print\/home-summary\n/);
  const jobs = await realRead('/jobs', { jobs: [STAND] });
  assert.deepEqual(jobs.calls.map((c) => [/^\s*SELECT\b/.test(c.text), /FROM scan_print_job WHERE owner_sub = \$1/.test(c.text), c.values]), [[true, true, [SUB]]]);
  const printers = await realRead('/printers', { printers: [PRUSA] });
  assert.deepEqual(printers.calls.map((c) => [/^\s*SELECT\b/.test(c.text), /FROM scan_print_printer WHERE owner_sub = \$1/.test(c.text), /api_key/.test(c.text), c.values]), [[true, true, false, [SUB]]]);
  const summary = await realSummary({ recent: [STAND] });
  assert.equal(summary.calls.length, 3);
  assert.ok(summary.calls.every((c) => /^\s*SELECT\b/.test(c.text) && c.values[0] === SUB), 'home-summary only SELECTs, scoped to the caller');
  const view = loadCompany({ [JOBS]: jobs, [PRINTERS]: printers, [SUMMARY]: summary });
  await view.company({ refresh() {} });
  assert.deepEqual([...view.urls].sort(), ['GET ' + SUMMARY, 'GET ' + JOBS, 'GET ' + PRINTERS].sort());
  assert.deepEqual(view.assigned, [], 'opening the view navigates nowhere');
});

test('the real routes\x27 answers paint the stats, the title, the newest objects, what needs attention and the printers', async () => {
  const summary = realSummary({ counts: { total: '5', reconstructed: '3', printable: '2', failed: '1' }, recent: [STAND, CUP, BRACKET], sent: { sent: '2' } });
  const view = loadCompany({ [JOBS]: await realRead('/jobs', { jobs: [STAND, CUP, BRACKET, SCAN, GEAR] }), [SUMMARY]: await summary, [PRINTERS]: await realRead('/printers', { printers: [PRUSA, VORON] }) });
  const model = await view.company({ refresh() {} });
  assert.deepEqual([model.kicker, model.title], ['Engineering · Scan to Print', '2 printable models ready to print']);
  assert.equal(model.lede, 'Latest: Synthetic Phone Stand (reconstructed), updated W(' + T1 + '). Reconstructing, slicing and printing happen in the full page, and every print asks for a confirmation.');
  assert.deepEqual(model.stats.map((x) => [x.id, x.label, x.value, x.tone || null, x.hint || null]), [
    ['objects', 'Objects', 5, null, '1 still capturing'],
    ['printable', 'Printable models', 2, 'ok', 'Watertight meshes'],
    ['failed', 'Failed reconstructions', 1, 'bad', null],
    ['sent', 'Sent to a printer, 7 days', 2, null, 'Uploads the host accepted'],
  ]);
  const objects = section(model, 'objects');
  assert.deepEqual(objects.columns, ['Object', 'State', 'Source', 'Extents (mm)', 'Printable', 'Updated']);
  assert.deepEqual(objects.rows, [
    ['Synthetic Phone Stand', { text: 'Reconstructed', tone: null }, 'Photos', '80.0 × 60.4 × 120.0', { text: 'Yes', tone: 'ok' }, 'W(' + T1 + ')'],
    ['Synthetic Cup', { text: 'Reconstructed', tone: null }, 'Photos + depth', '84.0 × 84.0 × 95.5', { text: 'Yes', tone: 'ok' }, 'W(' + T2 + ')'],
    ['Synthetic Bracket', { text: 'Failed', tone: 'bad' }, 'Video frames', '—', '—', 'W(' + T3 + ')'],
    ['Synthetic Room Scan', { text: 'Reconstructed', tone: null }, 'Point cloud', '300.0 × 210.0 × 95.0', { text: 'No', tone: 'warn' }, 'W(' + T4 + ')'],
    ['Synthetic Gear', { text: 'Capturing', tone: null }, 'Photos', '—', '—', 'W(' + T5 + ')'],
  ]);
  assert.match(objects.note, /show only while it is current/);
  assert.deepEqual(items(model, 'attention'), [
    ['Synthetic Cup', WALL + ' (1 more)', 'W(' + T2 + ')', 'Print check', 'warn'],
    ['Synthetic Bracket', 'Reconstruction produced no solid voxels; check the views and the known dimension', 'W(' + T3 + ')', 'Failed', 'bad'],
    ['Synthetic Room Scan', 'Not printable: 12 open edges.', 'W(' + T4 + ')', 'Not printable', 'warn'],
  ]);
  assert.deepEqual(items(model, 'printers'), [['Synthetic Prusa', 'PrusaLink', 'added W(' + T4 + ')', null, null], ['Synthetic Voron', 'Moonraker (Klipper)', 'added W(' + T5 + ')', null, null]]);
  assert.equal(section(model, 'printers').note, 'No slicer is configured on this swarm: send the STL to a host that slices, or slice it yourself. Sending a job asks for a confirmation in the full page.');
  assert.doesNotMatch(JSON.stringify(model), /synthetic-printer\.local|synthetic-voron\.local/, 'a printer\x27s address is not painted');
  assert.deepEqual(model.sections.map((s) => s.id), ['objects', 'attention', 'printers']);
});

test('nothing in the view writes or starts work: rows and items carry no link, and the one action opens the full page in this frame', async () => {
  const view = loadCompany({ [JOBS]: await realRead('/jobs', { jobs: [STAND, BRACKET] }), [SUMMARY]: await realSummary(), [PRINTERS]: await realRead('/printers', { printers: [PRUSA] }) });
  const model = await view.company({ refresh() {} });
  assert.ok(section(model, 'objects').rows.every(Array.isArray), 'table rows are plain cells, never clickable rows');
  assert.ok(['attention', 'printers'].every((id) => section(model, id).items.every((t) => !t.href && !t.onClick && !t.target)), 'no item opens, reconstructs or prints');
  assert.deepEqual(model.actions.map((a) => [a.label, !!a.primary, a.href || null]), [['Open the full scanner', true, null]]);
  model.actions[0].onClick();
  assert.deepEqual(view.assigned, [PAGE_URL], 'the action loads the full page without the audience and without any ?artifact intake');
  assert.ok(view.urls.every((u) => u.startsWith('GET ')), 'every request is a GET');
});

test('the title names the account\x27s state: printable models, objects still capturing, failed reconstructions, none printable yet, none at all', async () => {
  const capturing = await paint(realRead('/jobs', { jobs: [GEAR, BRACKET, SCAN] }), realSummary());
  assert.equal(capturing.title, '1 object still capturing');
  const failed = await paint(realRead('/jobs', { jobs: [BRACKET, SCAN] }), realSummary());
  assert.deepEqual([failed.title, stat(failed, 'failed').tone], ['1 reconstruction failed', 'bad']);
  const unprintable = await paint(realRead('/jobs', { jobs: [SCAN] }), realSummary());
  assert.deepEqual([unprintable.title, stat(unprintable, 'printable').value, stat(unprintable, 'printable').tone], ['1 object scanned, none printable yet', 0, null]);
  const one = await paint(realRead('/jobs', { jobs: [STAND] }), realSummary());
  assert.equal(one.title, '1 printable model ready to print');
  const none = await paint(realRead('/jobs', { jobs: [] }), realSummary(), realRead('/printers', { printers: [] }));
  assert.deepEqual([none.title, section(none, 'objects').rows, section(none, 'attention').items, section(none, 'printers').items], ['No objects scanned yet', [], [], []]);
  assert.match(none.lede, /Objects saved there show up here\.$/);
  assert.equal(section(none, 'objects').empty, 'No objects yet. Start one in the full page from six photos, a short video or a LiDAR point cloud.');
  assert.equal(section(none, 'attention').empty, 'No failed reconstructions, unprintable meshes or print-check warnings.');
  assert.equal(section(none, 'printers').empty, 'No printers registered yet. Register an OctoPrint, Moonraker, PrusaLink or Bambu Lab printer in the full page.');
});

test('a full 200-object list says its counts are the newest 200; the table shows eight and the attention list six; odd rows read as what they are', async () => {
  const many = Array.from({ length: 200 }, (_, i) => job('n' + i, 'Synthetic Part ' + i, i % 2 ? 'failed' : 'reconstructed', 'photos', T4, i % 2 ? null : reconstruction({ x: 1, y: 1, z: 1 }, true), 'Synthetic failure ' + i));
  const full = await paint(realRead('/jobs', { jobs: many }), realSummary());
  assert.deepEqual(['objects', 'printable', 'failed'].map((id) => [stat(full, id).value, stat(full, id).hint]), [[200, 'Newest 200 only'], [100, 'Among the newest 200'], [100, 'Among the newest 200']]);
  assert.deepEqual([section(full, 'objects').rows.length, section(full, 'attention').items.length], [8, 6]);
  const odd = [
    { job_id: 'x1', title: '', source_kind: 'lidar', state: 'paused', report: null, failure_reason: null, updated_at: at(T2) },
    job('x2', 'Synthetic Unjudged', 'reconstructed', 'photos', T3, { sizeMm: { x: 10, y: null } }),
    job('x3', 'Synthetic Text Report', 'reconstructed', 'video', T3, 'not an object'),
    job('x4', 'Synthetic Stale', 'capturing', 'photos', T4, reconstruction({ x: 5, y: 5, z: 5 }, true)),
    job('x5', 'Synthetic Inverted', 'reconstructed', 'pointcloud', T4, reconstruction({ x: 5, y: 5, z: 5 }, false, { validation: { openEdges: 0, degenerate: 3, consistentWinding: false, outwardFacing: false } })),
    job('x6', 'Synthetic Unexplained', 'reconstructed', 'photos', T4, reconstruction({ x: 5, y: 5, z: 5 }, false, { validation: {} })),
    job('x7', 'Synthetic Silent Failure', 'failed', 'photos', T5, null, null),
  ];
  const model = await paint(realRead('/jobs', { jobs: odd }), realSummary());
  assert.deepEqual(section(model, 'objects').rows.slice(0, 4), [
    ['Untitled object', { text: 'State: paused', tone: null }, 'lidar', '—', '—', 'W(' + T2 + ')'],
    ['Synthetic Unjudged', { text: 'Reconstructed', tone: null }, 'Photos', '10.0 × ? × ?', '—', 'W(' + T3 + ')'],
    ['Synthetic Text Report', { text: 'Reconstructed', tone: null }, 'Video frames', '—', '—', 'W(' + T3 + ')'],
    ['Synthetic Stale', { text: 'Capturing', tone: null }, 'Photos', '—', '—', 'W(' + T4 + ')'],
  ]);
  assert.deepEqual(items(model, 'attention').map((i) => [i[0], i[1], i[3]]), [
    ['Synthetic Inverted', 'Not printable: 3 degenerate facets, inconsistent winding, facets facing inward.', 'Not printable'],
    ['Synthetic Unexplained', 'Not printable: the mesh did not pass validation.', 'Not printable'],
    ['Synthetic Silent Failure', 'The reconstruction failed.', 'Failed'],
  ]);
});

test('a seven-day count or a printers list that could not be read says so, and the objects still show', async () => {
  const jobs = () => realRead('/jobs', { jobs: [STAND, GEAR] });
  const partial = await paint(jobs(), realSummary({ sent: new Error('synthetic submissions failure') }));
  assert.deepEqual([stat(partial, 'sent').value, stat(partial, 'sent').tone, stat(partial, 'sent').hint, section(partial, 'objects').rows.length], ['—', null, 'Could not check', 2]);
  const down = await realSummary({ counts: new Error('synthetic'), recent: new Error('synthetic'), sent: new Error('synthetic') });
  assert.equal(down.http, 503, 'the real route answers 503 when every source failed');
  assert.deepEqual([(await paint(jobs(), down)).stats[3].value, (await paint(jobs(), realSummary({ signedIn: false }))).stats[3].value, (await paint(jobs(), new TypeError('Failed to fetch'))).stats[3].value], ['—', '—', '—']);
  const broken = await realRead('/printers', { printers: new Error('synthetic relation missing') });
  assert.equal(broken.http, 500, 'the real route answers 500 when the printers read fails');
  const cases = [[broken, 'The printers could not be read (HTTP 500).'], [new TypeError('Failed to fetch'), 'The printers could not be reached just now.'],
    [{ http: 403, body: { error: 'forbidden' } }, 'The printers route refused this account (HTTP 403).'], [{ http: 200, body: undefined }, 'The printers answer could not be read.']];
  for (const [answer, empty] of cases) {
    const model = await paint(jobs(), realSummary(), answer);
    assert.deepEqual([section(model, 'printers').items, section(model, 'printers').empty, section(model, 'printers').note, model.title], [[], empty, null, '1 printable model ready to print']);
  }
  const slicer = await paint(jobs(), realSummary(), realRead('/printers', { printers: [PRUSA], env: { SCAN_TO_PRINT_SLICER_CMD: 'synthetic-slicer {input} {output}' } }));
  assert.equal(section(slicer, 'printers').note, 'A slicer is configured on this swarm, so G-code is produced on demand. Sending a job asks for a confirmation in the full page.');
});

test('signed out, refused, the route\x27s own failure, an unreadable answer and an unreachable server each read as what they are', async () => {
  const signedOut = await paint(realRead('/jobs', { signedIn: false }), realSummary({ signedIn: false }), realRead('/printers', { signedIn: false }));
  assert.deepEqual([signedOut.title, signedOut.stats, signedOut.sections], ['Sign in to see the saved scans', undefined, undefined]);
  assert.match(signedOut.lede, /this session is not signed in/);
  const denied = await paint({ http: 403, body: { error: 'forbidden' } }, realSummary());
  assert.deepEqual([denied.title, denied.lede], ['This account cannot open Scan to Print', 'The Scan to Print routes refused this account (HTTP 403).']);
  const broken = await realRead('/jobs', { jobs: new Error('synthetic relation missing') });
  assert.equal(broken.http, 500, 'the real route answers 500 when the jobs read fails');
  await assert.rejects(paint(broken, realSummary()), /^Error: Scan to Print could not read the saved objects \(HTTP 500\)\.$/);
  await assert.rejects(paint({ http: 200, body: undefined }, realSummary()), /^Error: Scan to Print sent an answer this view could not read\.$/);
  await assert.rejects(paint({ http: 200, body: { error: 'synthetic' } }, realSummary()), /^Error: Scan to Print sent an answer this view could not read\.$/);
  await assert.rejects(paint(new TypeError('Failed to fetch'), realSummary()), /^Error: Scan to Print could not be reached just now\.$/);
});

const SCRIPT = fs.readFileSync(path.join(ROOT, GATE_FILE), 'utf8');
const GATE = "if (!window.AppView || !AppView.active()) document.addEventListener('DOMContentLoaded', boot);";

/** @returns {object} A stub element that records the listeners bound on it. */
function element(log) { return { addEventListener(type) { log.push('element:' + type); }, hidden: false, disabled: false, textContent: '', value: '', className: '', replaceChildren() {}, appendChild() {} }; }

/**
 * @description Run the surface script against a stub DOM and fetch, then fire DOMContentLoaded when it was bound. The fetch
 * never settles, so a full-page boot stops at its first read (deterministically) after its synchronous steps.
 * @param {{AppView?: object}|null} kit What window.AppView is (null: a core without the kit).
 * @param {string} search The page's query string.
 * @returns {{ listeners: string[], reads: string[] }} Listeners bound and requests made.
 */
function runSurface(kit, search) {
  const calls = { listeners: [], reads: [] }, bound = {};
  const doc = { addEventListener(type, fn) { calls.listeners.push('document:' + type); bound[type] = fn; }, getElementById: () => element(calls.listeners), createElement: () => element(calls.listeners) };
  const win = { AppView: kit || undefined, ScanToPrintCamera: { hasCamera: () => false }, isSecureContext: true, addEventListener(type) { calls.listeners.push('window:' + type); } };
  const fetchStub = (url, opt) => { calls.reads.push(((opt && opt.method) || 'GET') + ' ' + url); return new Promise(() => {}); };
  new Function('window', 'AppView', 'document', 'fetch', 'location', 'navigator', SCRIPT)(win, kit || undefined, doc, fetchStub, { search }, {});
  if (bound.DOMContentLoaded) bound.DOMContentLoaded();
  return calls;
}

test('the surface script\x27s one start path is gated: under the view nothing binds, reads or takes in an ?artifact; without it the boot runs', () => {
  assert.equal(SCRIPT.split("addEventListener('DOMContentLoaded'").length - 1, 1, 'one DOMContentLoaded start path');
  assert.equal(SCRIPT.split(GATE).length - 1, 1, 'and it carries the gate');
  const view = { active: () => 'company' };
  assert.deepEqual(runSurface(view, '?audience=company'), { listeners: [], reads: [] });
  assert.deepEqual(runSurface(view, '?audience=company&artifact=synthetic-ref'), { listeners: [], reads: [] });
  const full = runSurface({ active: () => null }, '');
  assert.deepEqual([full.listeners[0], full.reads], ['document:DOMContentLoaded', ['GET /api/scan-to-print/capabilities']]);
  assert.deepEqual(runSurface(null, '').reads, ['GET /api/scan-to-print/capabilities'], 'a core without the kit runs the page');
});
