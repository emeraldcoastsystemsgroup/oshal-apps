/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The audience view contract of this package's page (ADR-164 D6): the shared kit is loaded right after the theme bootstrap, the page boots the kit with exactly the audiences it provides and its own application name, the full-page start is gated on the kit's decision, the head block parses, and every read in it stays on this package's own routes (plus the framework connect list where the page already reads it). Static, no browser, no network.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The Ocean Lab company view on the Harvest Siting Console (the manifest's first surface) asserted as behaviour over the package's REAL routes: GET /vehicles from routes/vehicle-routes.js and GET /sites from routes/harvest-routes.js, loaded with only express and @/shared/logger stubbed and a stub pool, their answers JSON round-tripped as Express sends them. On open the view makes exactly those two reads and the vehicle route only SELECTs the caller's rows; never /harvest/simulate, a rotor solve, an evaluate, a seed or a delete. The stats (saved vehicles, sized at the current vector, at concept, illustrative sites and soils), the title ladder (no vehicle yet, N saved vehicles with how many sized, at least 50 when the route's list is full), the vehicles table (stage computed on the read, the run that sized it, open and blocking limits, the updated time through AppView.when, the fabricable sentence verbatim), the site catalogue with the route's own provenance note, and every named state: signed out (the route's 401), refused (403), no record store (the route's 503), the route's own 500, an unreadable answer, an unreachable server and a site catalogue that could not be read while the vehicles still show. The engine loader and the connected-actions script are proved to load, import, bind and mount nothing under the view and to run every start step without it (and without the kit).
 * -----------------------------------------------------------------------------
 * @module audience-view.test
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const APP = 'ocean-lab';
const PAGE = 'tools/harvest-console.html';
const AUDIENCES = ["company", "family"];
const ALLOWED_PREFIXES = ["/api/ocean-lab"];
const GATE_FILE = 'tools/harvest-console.html';

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

test('the view sits on the page the shells open: the manifest\x27s first ui.static surface', () => {
  const manifest = fs.readFileSync(path.join(ROOT, 'oshal-app.yaml'), 'utf8');
  const first = manifest.slice(manifest.indexOf('\nui:')).match(/iframeUrl: (\S+)/);
  assert.equal(first && first[1], '/api/ocean-lab/harvest-console');
  assert.match(fs.readFileSync(path.join(ROOT, 'routes', 'ocean-lab-routes.js'), 'utf8'), /surfaceFile\)\(appPackageDir, 'harvest-console\.html'\)/);
});

// ── The package's real routes, with only express and the framework logger stubbed ───────────────────────────────────────
const routers = [];
/** @returns {object} A recording express Router: every registration keeps its method, path and final handler. */
function recorder() {
  const r = { routes: [] };
  ['get', 'post', 'put', 'patch', 'delete', 'use'].forEach((m) => { r[m] = (p, ...fns) => { r.routes.push({ method: m, path: p, handler: fns[fns.length - 1] }); }; });
  routers.push(r);
  return r;
}
const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === '@/shared/logger') return { createChildLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }) };
  if (request === 'express') return { Router: recorder };
  return originalLoad.call(this, request, parent, isMain);
};
const { createVehicleRoutes } = require(path.join(ROOT, 'routes', 'vehicle-routes.js'));
const { createHarvestRoutes } = require(path.join(ROOT, 'routes', 'harvest-routes.js'));
const vehicleLib = require(path.join(ROOT, 'routes', 'engine', 'vehicle', 'index.js'));

const SUB = 'synthetic-sub';
/** @returns {object} A signed-in (or signed-out) OIDC request context, as express-openid-connect provides it. */
const oidc = (signedIn) => (signedIn ? { user: { sub: SUB }, isAuthenticated: () => true } : { isAuthenticated: () => false });

/** @returns {object} A stub Express response recording status and JSON body; `finished` resolves when it is sent. */
function response() {
  let done;
  const finished = new Promise((resolve) => { done = resolve; });
  const res = { statusCode: 200, body: undefined, headersSent: false, finished, setHeader() {}, type() { return res; },
    status(s) { res.statusCode = s; return res; }, json(b) { res.body = b; res.headersSent = true; done(); return res; }, end() { res.headersSent = true; done(); return res; } };
  return res;
}

/**
 * @description A stub pg pool that records every query and answers it through `answer(text, values)`.
 * @param {(text: string, values: any[]) => object[]|Error} answer Rows for a query (an Error rejects it).
 * @returns {{ query: Function, calls: Array<{text: string, values: any[]}> }} The pool and its recorded queries.
 */
function stubPool(answer) {
  const calls = [];
  return { calls, query: (text, values) => { calls.push({ text, values }); const a = answer(text, values); return a instanceof Error ? Promise.reject(a) : Promise.resolve({ rows: a }); } };
}

/** @returns {{handler: Function}} The one route a router registered for a method and path. */
function route(router, method, p) {
  const found = router.routes.filter((r) => r.method === method && r.path === p);
  assert.equal(found.length, 1, method.toUpperCase() + ' ' + p + ' is registered once');
  return found[0];
}

/**
 * @description Answer GET /vehicles with the package's REAL route over a stub pool (or none).
 * @param {{vehicles?: object[], runs?: object, limits?: object, signedIn?: boolean, noPool?: boolean, fail?: Error}} [db]
 *   Vehicle rows, run and limit rows by vehicle id, whether the caller is signed in, a mount without a pool, a failing store.
 * @returns {Promise<{http: number, body: object, calls: object[]}>} Status, JSON body and every query.
 */
async function realVehicles({ vehicles = [], runs = {}, limits = {}, signedIn = true, noPool = false, fail = null } = {}) {
  const pool = noPool ? null : stubPool((text, values) => fail || (/ocean_lab_vehicle_run/.test(text) ? runs[values[1]] || [] : /ocean_lab_vehicle_limit/.test(text) ? limits[values[1]] || [] : vehicles));
  createVehicleRoutes({ pool, packageDir: ROOT });
  const res = response();
  route(routers[routers.length - 1], 'get', '/').handler({ oidc: oidc(signedIn), params: {}, query: {}, body: undefined }, res);
  await res.finished;
  return { http: res.statusCode, body: res.body, calls: pool ? pool.calls : [] };
}

/** @returns {{http: number, body: object}} GET /sites answered by the package's REAL harvest route. */
function realSites() {
  createHarvestRoutes({ appPackageDir: ROOT });
  const res = response();
  route(routers[routers.length - 1], 'get', '/sites').handler({ oidc: oidc(true), method: 'GET' }, res);
  return { http: res.statusCode, body: res.body };
}

const T0 = '2026-09-28T10:00:00.000Z', T1 = '2026-09-27T09:00:00.000Z';
const SEED = vehicleLib.explorerSeed().designVector;
const OLD_VECTOR = { ...SEED, synthetic: 'an earlier vector' };
/** @returns {object} A vehicle row as routes/vehicle-store.js selects it (timestamptz columns arrive as Date). */
const vehicleRow = (id, name, vector, updated) => ({ vehicle_id: id, owner_sub: SUB, kind: 'wave-explorer', name, design_vector: vector, provenance: { source: 'synthetic' }, created_at: new Date(T1), updated_at: new Date(updated) });
/** @returns {object[]} The kind's eight limit rows copied onto a vehicle; ids in `retired` are retired. */
const limitRows = (id, retired = []) => vehicleLib.EXPLORER_KIND.limits.map((l) => ({ vehicle_id: id, owner_sub: SUB, limit_id: l.id, sentence: l.sentence, retire_when: l.retireWhen, blocking: l.blocking, status: retired.includes(l.id) ? 'retired' : 'open', retired_evidence: null, created_at: new Date(T1) }));
/** @returns {object} One of this lab's own evaluations recorded at a vector, carrying every figure the kind requires. */
const evaluation = (id, seq, vector) => ({ run_id: 'r' + seq, vehicle_id: id, owner_sub: SUB, sequence: seq, medium_id: 'seawater', plant: vehicleLib.EVALUATION_PLANT, vector_fingerprint: vehicleLib.designVectorFingerprint(vector),
  engine_fingerprints: { package: 'ocean-lab', packageVersion: '1.2.0', routesBuildHash: 'a'.repeat(64) }, result: { figures: { meanSpeedMs: 0.24, meanKnots: 0.46, underWayFraction: 0.65, kmPerDay: 20.4, kmPerYear: 7444 } }, created_at: new Date(T1) });
const A_ID = '11111111-1111-4111-8111-111111111111', B_ID = '22222222-2222-4222-8222-222222222222';
/** Two saved vehicles: A sized at its current vector with one limit retired, B at concept with an evaluation at an older vector. */
const TWO = { vehicles: [vehicleRow(A_ID, 'Synthetic Explorer A', SEED, T0), vehicleRow(B_ID, 'Synthetic Explorer B', SEED, T1)],
  runs: { [A_ID]: [evaluation(A_ID, 1, SEED)], [B_ID]: [evaluation(B_ID, 1, OLD_VECTOR)] }, limits: { [A_ID]: limitRows(A_ID, ['drag-correlation-stack']), [B_ID]: limitRows(B_ID) } };

const V = '/api/ocean-lab/vehicles', S = '/api/ocean-lab/harvest/sites';
/**
 * @description Run the head block against a stub kit and a stub fetch; bodies are JSON round-tripped as Express sends them.
 * The stub relative-time formatter tags its input: W(...) = AppView.when.
 * @param {Object<string, {http: number, body: object|undefined}|Error>} answers What each read answers (an undefined body is
 *   not JSON; an Error rejects the fetch, a network failure). A read with no answer is a 404.
 * @returns {{ company: Function, urls: string[] }} The builder and every request made.
 */
function loadCompany(answers) {
  let config = null;
  const urls = [];
  const kit = { boot: (c) => { config = c; }, when: (v) => 'W(' + v + ')' };
  const fetchStub = (url, opt) => {
    urls.push(((opt && opt.method) || 'GET') + ' ' + url);
    const a = answers[url] || { http: 404, body: { error: 'Synthetic endpoint unavailable' } };
    if (a instanceof Error) return Promise.reject(a);
    const wire = a.body === undefined ? undefined : JSON.parse(JSON.stringify(a.body));
    return Promise.resolve({ ok: a.http < 400, status: a.http, json: () => (wire === undefined ? Promise.reject(new SyntaxError('not JSON')) : Promise.resolve(wire)) });
  };
  new Function('window', 'fetch', block)({ AppView: kit }, fetchStub);
  assert.ok(config && typeof config.audiences.company === 'function', 'the block boots the company audience');
  assert.equal(config.escapeLabel, 'Open Ocean Lab in the cockpit');
  return { company: config.audiences.company, urls };
}

const section = (model, id) => model.sections.find((x) => x && x.id === id);
const statRows = (model) => model.stats.map((x) => [x.id, x.label, x.value, x.tone || null, x.hint || null]);
/** @returns {Promise<object>} The company model over the real vehicles answer and the real site catalogue. */
async function viewOver(vehicles, sites = realSites()) { return loadCompany({ [V]: vehicles, [S]: sites }).company({}); }

test('on open the view reads the saved vehicles and the site catalogue only, and the vehicle route only SELECTs the caller\x27s rows', async () => {
  const vehicles = await realVehicles(TWO);
  const view = loadCompany({ [V]: vehicles, [S]: realSites() });
  await view.company({});
  assert.deepEqual(view.urls, ['GET ' + S, 'GET ' + V], 'two GETs: never /harvest/simulate, a rotor solve, an evaluate, a seed or a delete');
  assert.equal(vehicles.calls.length, 5, 'the list, then the runs and limits of each vehicle');
  for (const call of vehicles.calls) {
    assert.match(call.text, /^SELECT /, 'a read: ' + call.text);
    assert.match(call.text, /WHERE owner_sub = \$1/, 'owner-scoped: ' + call.text);
    assert.equal(call.values[0], SUB);
  }
});

test('the stats, title, vehicles table and site catalogue come from the real routes: stage computed on the read, the fabricable sentence verbatim', async () => {
  const model = await viewOver(await realVehicles(TWO));
  assert.deepEqual([model.kicker, model.title, model.actions], ['Engineering · Ocean Lab', '2 saved vehicles · 1 sized', undefined]);
  assert.match(model.lede, /compute on demand and store nothing, so this view runs no simulation;/);
  assert.deepEqual(statRows(model), [
    ['vehicles', 'Saved vehicles', 2, null, null],
    ['sized', 'Sized at the current vector', 1, 'ok', null],
    ['concept', 'At concept', 1, null, 'Not evaluated at the current vector'],
    ['sites', 'Illustrative sites and soils', 5, null, 'Parameter sets, not survey data'],
  ]);
  const table = section(model, 'vehicles');
  assert.deepEqual(table.columns, ['Vehicle', 'Stage', 'Sized by', 'Open limits', 'Updated']);
  assert.deepEqual(table.rows, [
    ['Synthetic Explorer A', { text: 'sized', tone: 'ok' }, 'Run 1', '7 (3 blocking)', 'W(' + T0 + ')'],
    ['Synthetic Explorer B', { text: 'concept', tone: null }, 'Not evaluated at this vector', '8 (3 blocking)', 'W(' + T1 + ')'],
  ]);
  assert.ok(table.note.endsWith(' ' + vehicleLib.FABRICABLE_SENTENCE), 'the stage sentence (ADR-160 D6) is rendered whole');
  const sites = section(model, 'sites');
  assert.match(sites.note, /^Plausible parameter sets, NOT survey data\./, 'the route\x27s own provenance note');
  assert.deepEqual(sites.items.map((i) => [i.title, i.text, i.badge]), [
    ['illustrative-strong-channel', 'Tidal current · M2 + S2 + N2 + K1 · residual 0.1 m/s', 'Illustrative'],
    ['illustrative-moderate-inlet', 'Tidal current · M2 + S2 + K1 · residual 0.05 m/s', 'Illustrative'],
    ['illustrative-temperate-loam', 'Soil thermal · mean 12 °C · annual ±12 °C · diurnal ±8 °C', 'Illustrative'],
    ['illustrative-dry-sand', 'Soil thermal · mean 20 °C · annual ±15 °C · diurnal ±14 °C', 'Illustrative'],
    ['illustrative-wet-clay', 'Soil thermal · mean 10 °C · annual ±9 °C · diurnal ±4 °C', 'Illustrative'],
  ]);
});

test('the title names the account\x27s state: no vehicle yet, none sized yet, and at least 50 when the route\x27s list is full', async () => {
  const none = await viewOver(await realVehicles());
  assert.deepEqual([none.title, statRows(none).map((r) => r[2]), section(none, 'vehicles').rows], ['No saved vehicle yet', [0, 0, 0, 5], []]);
  assert.match(none.lede, /^The Explorer record holds no vehicle for this account yet; seed one in the full application\./);
  assert.equal(section(none, 'vehicles').empty, 'No saved vehicle yet. Seed the Explorer in the full application to start its record.');
  const concept = await viewOver(await realVehicles({ vehicles: [TWO.vehicles[1]], runs: { [B_ID]: TWO.runs[B_ID] }, limits: { [B_ID]: TWO.limits[B_ID] } }));
  assert.equal(concept.title, '1 saved vehicle · none sized yet');
  const many = Array.from({ length: 50 }, (_, i) => vehicleRow('33333333-3333-4333-8333-' + String(i).padStart(12, '0'), 'Synthetic Explorer ' + i, SEED, T1));
  const full = await viewOver(await realVehicles({ vehicles: many }));
  assert.equal(full.title, 'At least 50 saved vehicles · none sized yet');
  assert.deepEqual(statRows(full).slice(0, 3), [
    ['vehicles', 'Saved vehicles', '50+', null, 'The route lists the newest 50'],
    ['sized', 'Sized at the current vector', 0, null, 'Among the newest 50'],
    ['concept', 'At concept', 50, null, 'Among the newest 50'],
  ]);
  assert.equal(section(full, 'vehicles').rows.length, 8);
  assert.match(section(full, 'vehicles').note, / Showing the newest 8 of 50\. /);
  assert.deepEqual(section(full, 'vehicles').rows[0].slice(2, 4), ['Not evaluated at this vector', '8 (3 blocking)'], 'no limit rows stored: every kind limit stays open');
});

test('a refusal, a deployment without the record store and a failure each read as what they are', async () => {
  const signedOut = await realVehicles({ ...TWO, signedIn: false });
  assert.deepEqual([signedOut.http, signedOut.calls.length], [401, 0]);
  const out = await viewOver(signedOut);
  assert.deepEqual([out.title, out.stats, out.sections], ['Sign in to see saved vehicles', undefined, undefined]);
  const denied = await viewOver({ http: 403, body: { error: 'forbidden' } });
  assert.deepEqual([denied.title, denied.lede], ['This account cannot open Ocean Lab', 'The Ocean Lab routes refused this account (HTTP 403).']);
  const bare = await realVehicles({ noPool: true });
  assert.deepEqual([bare.http, bare.body.error], [503, 'record_store_unavailable']);
  const noStore = await viewOver(bare);
  assert.equal(noStore.title, 'Saved vehicles are not available on this deployment');
  assert.deepEqual([statRows(noStore).map((r) => r[0]), noStore.sections.map((x) => x.id)], [['sites'], ['sites']]);
  const broken = await realVehicles({ fail: new Error('synthetic store failure') });
  assert.deepEqual(broken.body, { error: 'vehicle_route_failed', route: 'GET /vehicles' });
  await assert.rejects(viewOver(broken), /^Error: The saved vehicles could not be read: vehicle_route_failed \(HTTP 500\)\.$/);
  await assert.rejects(viewOver({ http: 502, body: undefined }), /^Error: The saved vehicles could not be read \(HTTP 502, not a JSON answer\)\.$/);
  await assert.rejects(viewOver({ http: 200, body: undefined }), /^Error: The saved vehicles answer could not be read\.$/, 'a sign-in page answered 200 is not a vehicle list');
  await assert.rejects(viewOver({ http: 200, body: { stages: [] } }), /^Error: The saved vehicles answer could not be read\.$/);
  await assert.rejects(viewOver(new TypeError('Failed to fetch')), /^Error: The Ocean Lab server could not be reached\.$/);
});

test('a site catalogue that cannot be read is named not checked while the saved vehicles still show; odd rows stay honest', async () => {
  const vehicles = await realVehicles(TWO);
  for (const sites of [new TypeError('Failed to fetch'), { http: 500, body: { error: 'harvest_simulation_failed' } }, { http: 200, body: undefined }]) {
    const model = await viewOver(vehicles, sites);
    assert.deepEqual(statRows(model)[3], ['sites', 'Illustrative sites and soils', null, 'warn', 'Could not check']);
    assert.deepEqual([section(model, 'sites').items, section(model, 'sites').empty], [[], 'The site catalogue could not be read right now.']);
    assert.equal(section(model, 'vehicles').rows.length, 2);
  }
  const odd = await viewOver({ http: 200, body: { vehicles: [{ vehicle: { name: '' } }, null] } }, { http: 200, body: { marine: [{ name: 'synthetic-site' }, { label: 'no name' }], ground: 'none' } });
  assert.deepEqual(section(odd, 'vehicles').rows, [
    ['Unnamed vehicle', { text: 'unknown', tone: null }, 'Not evaluated at this vector', '—', 'W(undefined)'],
    ['Unnamed vehicle', { text: 'unknown', tone: null }, 'Not evaluated at this vector', '—', 'W(undefined)'],
  ]);
  assert.deepEqual(section(odd, 'sites').items.map((i) => i.text), ['Tidal current · no constituents listed']);
  assert.equal(section(odd, 'sites').note, 'Plausible parameter sets over real models, not survey data.');
});

// ── The full page's own start paths ──────────────────────────────────────────────────────────────────────────────────────
/** @returns {string} The source of the one body script that contains `marker`. */
function scriptWith(marker) {
  const at = html.indexOf(marker);
  assert.ok(at > start && html.indexOf(marker, at + 1) < 0, marker + ' appears once, in the body after the head block');
  const s = html.lastIndexOf('<script>', at);
  return html.slice(s + 8, html.indexOf('</script>', at));
}

/**
 * @description Run the engine loader against a stub DOM.
 * @param {object} win The window the loader sees (with or without the kit).
 * @returns {string[]} The src of every script element it appended.
 */
function runLoader(win) {
  const appended = [];
  const doc = { getElementById: () => ({ hidden: true }), createElement: () => ({}), head: { appendChild: (s) => appended.push(s.src) } };
  new Function('window', 'AppView', 'document', 'console', scriptWith('Engine loader'))(win, win.AppView, doc, { error() {} });
  return appended;
}

test('under the view the engine loader loads nothing, so no model runs; without it (or without the kit) the loader starts', () => {
  const kit = (view) => ({ AppView: { active: () => view } });
  assert.deepEqual(runLoader(kit('company')), []);
  assert.deepEqual(runLoader(kit(null)), ['harvest-console.js']);
  assert.deepEqual(runLoader({}), ['harvest-console.js'], 'a core without the shared kit runs the full page');
});

/**
 * @description Run the connected-actions script with its dynamic import swapped for a recording stub.
 * @param {object} win The window the script sees.
 * @returns {Promise<{ imports: string[], mounted: number, listeners: number }>} Imports made, mounts and click handlers bound.
 */
async function runConnected(win) {
  const src = scriptWith("import('/cockpit/js/app-workflows.js')").replace("import('/cockpit/js/app-workflows.js')", "importStub('/cockpit/js/app-workflows.js')");
  assert.ok(src.includes('importStub('), 'the script imports the connected-actions module');
  const seen = { imports: [], mounted: 0, listeners: 0 };
  const node = () => ({ value: '', textContent: '', addEventListener: () => { seen.listeners++; } });
  const importStub = (spec) => { seen.imports.push(spec); return Promise.resolve({ mountConnectedActions: () => { seen.mounted++; return Promise.resolve(); } }); };
  new Function('window', 'AppView', 'document', 'importStub', src)(win, win.AppView, { getElementById: node }, importStub);
  await new Promise((resolve) => setImmediate(resolve));
  return seen;
}

test('under the view the connected-actions script imports, binds and mounts nothing; the full page still runs it', async () => {
  assert.deepEqual(await runConnected({ AppView: { active: () => 'company' } }), { imports: [], mounted: 0, listeners: 0 });
  assert.deepEqual(await runConnected({ AppView: { active: () => null } }), { imports: ['/cockpit/js/app-workflows.js'], mounted: 1, listeners: 1 });
  assert.deepEqual(await runConnected({}), { imports: ['/cockpit/js/app-workflows.js'], mounted: 1, listeners: 1 });
});
