/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The audience view contract of this package's page (ADR-164 D6): the shared kit is loaded right after the theme bootstrap, the page boots the kit with exactly the audiences it provides and its own application name, the full-page start is gated on the kit's decision, the head block parses, and every read in it stays on this package's own routes (plus the framework connect list where the page already reads it). Static, no browser, no network.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The Sat Ops company view asserted as behaviour over the package's REAL routes: GET /fleet and GET /catalog from routes/sat-routes.js (loaded with only express and the framework aliases stubbed, recording fakes of the fleet registry and the TLE catalog), their answers JSON round-tripped as Express serializes them. On open the view makes exactly those two reads and both routes only list the in-memory registries; it never asks for a track, a pass window, a conjunction screen, the concierge or a node command. The simulated fleet paints as four stats (sim nodes, recent and stale heartbeats, orbits loaded), a title ladder, a fleet table of each node's last report (engine, heartbeat, mode, pointing error, wheel momentum, last heard; recent nodes first) and an orbit catalog table joined to its attitude nodes by sat id (newest registration first). Odd rows, a catalog that could not be read (the fleet still shows), signed out, refused, the fleet route's failure, an unreadable answer and an unreachable server each read as what they are. Every top-level start step of the full page's main script and its connected-actions script is gated: under the view they bind nothing, read nothing and start no poll or render loop; without it they run.
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | Await the actual compiled fleet/catalog handlers before reading their response; retain legacy synchronous registry assertions and verify asynchronous native facade parity without writes.
 * -----------------------------------------------------------------------------
 * @module audience-view.test
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const APP = 'sat-ops';
const PAGE = 'tools/sat-ops.html';
const AUDIENCES = ["company", "family"];
const ALLOWED_PREFIXES = ["/api/sat"];
const GATE_FILE = 'tools/sat-ops.html';

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

const FLEET = '/api/sat/fleet', CATALOG = '/api/sat/catalog', FULL = '/cockpit/?app=sat-ops';

/** @returns {object} A stub Express response that records the status and the JSON body. */
function response() {
  return { statusCode: 200, body: undefined, setHeader() {}, status(s) { this.statusCode = s; return this; }, json(b) { this.body = b; } };
}

/** The framework modules routes/sat-routes.js imports through @/ aliases, stubbed to what route registration touches. */
const SAT_STUBS = {
  '@/shared/logger': { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) },
  '@/shared/middleware/authz': { hasValidServiceSecret: () => false },
  '@/features/sat-ops': { SatFleet: class {}, TleCatalog: class {}, SatCommandError: class extends Error {}, CatalogError: class extends Error {}, TleParseError: class extends Error {}, PropagationError: class extends Error {}, TLE_MAX_CHARS: 512 },
};

/**
 * @description Load one of the package's compiled route modules with a recording express Router: node built-ins and the
 * package's own sibling modules are real, the framework aliases come from SAT_STUBS, anything else fails the test (so a
 * new import is noticed, not guessed).
 * @param {string} file The module path under the package root.
 * @param {Array<{method: string, path: string, handler: Function}>} routes Collects every route the module registers.
 * @returns {object} The module's exports.
 */
function loadModule(file, routes) {
  const router = {};
  ['get', 'post', 'put', 'patch', 'delete', 'use'].forEach((method) => { router[method] = (p, ...fns) => { routes.push({ method, path: p, handler: fns[fns.length - 1] }); }; });
  const load = (name) => {
    if (name === 'express') return { Router: () => router };
    if (['path', 'fs'].includes(name)) return require(name);
    if (name.startsWith('./')) return loadModule(path.join(path.dirname(file), name + '.js'), routes);
    assert.ok(Object.prototype.hasOwnProperty.call(SAT_STUBS, name), 'unexpected import in ' + file + ': ' + name);
    return SAT_STUBS[name];
  };
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', '__dirname', fs.readFileSync(path.join(ROOT, file), 'utf8'))(load, mod, mod.exports, path.join(ROOT, path.dirname(file)));
  return mod.exports;
}

/** @returns {{method: string, path: string, handler: Function}} The one route registered for a method and path. */
function route(routes, method, p) {
  const found = routes.filter((r) => r.method === method && r.path === p);
  assert.equal(found.length, 1, method.toUpperCase() + ' ' + p + ' is registered once');
  return found[0];
}

/**
 * @description Recording fakes of the two in-memory registries the router is built over: every method a route could call
 * is recorded, so a read that changed state (a heartbeat ingest, a command, an upsert, a removal) is noticed.
 * @param {object[]} fleetRows What SatFleet.list() answers.
 * @param {object[]} catalogRows What TleCatalog.list() answers.
 * @param {boolean} asynchronous Whether list reads return promises, as the native admitted facade does.
 * @returns {{ fleet: object, catalog: object, calls: string[] }} The fakes and every call made on them.
 */
function registries(fleetRows, catalogRows, asynchronous = false) {
  const calls = [];
  const rec = (name, answer) => (...args) => { calls.push(name); return answer ? answer(...args) : undefined; };
  const fleet = { list: rec('fleet.list', () => asynchronous ? Promise.resolve(fleetRows) : fleetRows), ingestHeartbeat: rec('fleet.ingestHeartbeat'), command: rec('fleet.command', () => Promise.resolve({})), isOnline: rec('fleet.isOnline') };
  const catalog = { list: rec('catalog.list', () => asynchronous ? Promise.resolve(catalogRows) : catalogRows), upsert: rec('catalog.upsert'), remove: rec('catalog.remove'), tleOf: rec('catalog.tleOf'), screenEntries: rec('catalog.screenEntries', () => []) };
  return { fleet, catalog, calls };
}

/**
 * @description Answer the view's two reads with the package's REAL routes (routes/sat-routes.js) over recording fakes.
 * @param {object[]} fleetRows The fleet listing (SatFleetSummary rows).
 * @param {object[]} catalogRows The catalog listing (TleCatalogEntry rows).
 * @param {boolean} asynchronous Whether registry list reads settle asynchronously.
 * @returns {Promise<{fleet: object, catalog: object, calls: string[], routes: object[]}>} Each read's { http, body }, the registry calls, every route.
 */
async function realReads(fleetRows, catalogRows, asynchronous = false) {
  const routes = [];
  const exports = loadModule('routes/sat-routes.js', routes);
  const reg = registries(fleetRows, catalogRows, asynchronous);
  exports.createSatRoutes({ fleet: reg.fleet, catalog: reg.catalog, ctx: { appPackageDir: ROOT } });
  const answer = async (p) => { const res = response(); await route(routes, 'get', p).handler({ oidc: { user: { sub: 'synthetic-sub' }, isAuthenticated: () => true }, params: {}, query: {} }, res); return { http: res.statusCode, body: res.body }; };
  return { fleet: await answer('/fleet'), catalog: await answer('/catalog'), calls: reg.calls, routes };
}

/**
 * @description Run the head block against a stub kit and a stub fetch. Bodies are JSON round-tripped as Express sends them.
 * The stub relative-time formatter tags its input: W(...) = AppView.when.
 * @param {Object<string, {http: number, body: object|undefined}|Error>} answers What each read answers (an undefined body
 *   is not JSON; an Error rejects the fetch, a network failure). A read with no answer is a 404.
 * @returns {{ company: Function, urls: string[], opened: string[] }} The builder, every request made, every AppView.open href.
 */
function loadCompany(answers) {
  let config = null;
  const urls = [], opened = [];
  const kit = { boot: (c) => { config = c; }, when: (v) => 'W(' + v + ')', open: (href) => opened.push(href) };
  const fetchStub = (url, opt) => {
    urls.push(((opt && opt.method) || 'GET') + ' ' + url);
    const a = answers[url] || { http: 404, body: { error: 'Synthetic endpoint unavailable' } };
    if (a instanceof Error) return Promise.reject(a);
    const wire = a.body === undefined ? undefined : JSON.parse(JSON.stringify(a.body));
    return Promise.resolve({ ok: a.http < 400, status: a.http, json: () => (wire === undefined ? Promise.reject(new SyntaxError('not JSON')) : Promise.resolve(wire)) });
  };
  new Function('window', 'fetch', block)({ AppView: kit }, fetchStub);
  assert.ok(config && typeof config.audiences.company === 'function', 'the block boots the company audience');
  assert.equal(config.escapeLabel, 'Open Sat Ops in the cockpit');
  return { company: config.audiences.company, urls, opened };
}

/** @returns {Promise<object>} The company model painted from the two answers. */
function paint(fleet, catalog) {
  return loadCompany({ [FLEET]: fleet, [CATALOG]: catalog }).company({ refresh() {} });
}

/** @returns {Promise<object>} The company model painted from the REAL routes' answers over these listings. */
async function paintReal(fleetRows, catalogRows) {
  const r = await realReads(fleetRows, catalogRows);
  return paint(r.fleet, r.catalog);
}

const T1 = Date.parse('2026-09-28T10:00:02.000Z'), T2 = Date.parse('2026-09-28T10:00:00.000Z'), T3 = Date.parse('2026-09-28T09:40:00.000Z');
const U0 = Date.parse('2026-09-20T08:00:00.000Z'), U1 = Date.parse('2026-09-27T08:00:00.000Z'), U2 = Date.parse('2026-09-28T08:00:00.000Z');
/** @returns {object} A node's heartbeat telemetry as SatFleet keeps it (mode, pointing error, ADCS readout, attitude state). */
function telemetry(mode, pointingErrorDeg, momentumFrac) {
  return { mode, pointingErrorDeg, attitudeCalibrated: true, state: { t: 12, q: { w: 1, x: 0, y: 0, z: 0 }, omega: { x: 0, y: 0, z: 0 }, wheelMomentum: { x: 0, y: 0, z: 0 } },
    adcs: { reason: 'synthetic', timeInModeS: 4, transitionCount: 2, momentumFrac, dumping: false, hasTarget: mode === 'POINT' || mode === 'SLEW' } };
}
/** @returns {object} One SatFleetSummary row as GET /fleet lists it. */
function node(satId, engine, online, lastSeenMs, t) { return { satId, engine, online, lastSeenMs, telemetry: t }; }
/** @returns {object} One TleCatalogEntry row as GET /catalog lists it. */
function orbit(satId, name, satnum, updatedUtcMs) { return { satId, name, satnum, tleRaw: '1 ' + satnum + 'U synthetic\n2 ' + satnum + ' synthetic', updatedUtcMs }; }

const OLD = node('sat-old', 'rk4', false, T3, telemetry('SAFE', null, 0.9));
const LIVE = node('sat42-live', 'rk4', true, T2, telemetry('POINT', 0.1234, 0.42));
const POLAR = node('sat-polar', 'nasa42', true, T1, telemetry('SLEW', 12.5, 0.071));
const LEADER = orbit('sat42-live', 'SYNTHETIC LEADER', 90001, U1), CHASER = orbit('sat-chaser', null, 90002, U2), RETIRED = orbit('sat-old', 'SYNTHETIC OLD', 90004, U0);
const section = (model, id) => model.sections.find((x) => x && x.id === id);
const stat = (model, id) => model.stats.find((x) => x.id === id);
const cells = (model, id) => section(model, id).rows.map((row) => row.map((c) => (c && typeof c === 'object' ? c.text + (c.tone ? ':' + c.tone : '') : c)));

test('on open the view makes two reads, GET /fleet and GET /catalog, and both real routes only list the in-memory registries', async () => {
  const real = await realReads([OLD, LIVE], [LEADER]);
  assert.deepEqual(real.calls, ['fleet.list', 'catalog.list'], 'each read lists its registry once and changes nothing');
  assert.deepEqual([real.fleet.http, Object.keys(real.fleet.body), real.catalog.http, Object.keys(real.catalog.body)], [200, ['fleet'], 200, ['catalog']]);
  const view = loadCompany({ [FLEET]: real.fleet, [CATALOG]: real.catalog });
  await view.company({ refresh() {} });
  assert.deepEqual([...view.urls].sort(), ['GET ' + CATALOG, 'GET ' + FLEET]);
  const posts = real.routes.filter((r) => r.method !== 'get').map((r) => r.path);
  assert.ok(posts.includes('/track') && posts.includes('/passes') && posts.includes('/conjunctions') && posts.includes('/chat'), 'the computing and command routes exist and are not GETs');
  assert.ok(view.urls.every((u) => !/\/(track|passes|conjunctions|chat|nodes|home-summary)/.test(u)), 'no track, pass, screening, concierge, command or summary request');
});

test('asynchronous registries preserve the real read bodies and audience without issuing commands', async () => {
  const legacy = await realReads([OLD, LIVE], [LEADER]);
  const native = await realReads([OLD, LIVE], [LEADER], true);
  assert.deepEqual(native.calls, ['fleet.list', 'catalog.list']);
  assert.deepEqual(native.fleet, legacy.fleet);
  assert.deepEqual(native.catalog, legacy.catalog);
  const model = await paint(native.fleet, native.catalog);
  assert.equal(model.title, '1 of 2 simulated sats heartbeating');
  assert.equal(stat(model, 'recent').value, 1);
  assert.equal(stat(model, 'stale').value, 1);
  assert.equal(section(model, 'fleet').rows.length, 2);
  assert.equal(section(model, 'orbits').rows.length, 1);
});

test('the real routes\x27 answers paint the four stats, the title and both tables with each node\x27s last report', async () => {
  const real = await realReads([OLD, LIVE, POLAR], [LEADER, CHASER, RETIRED]);
  const view = loadCompany({ [FLEET]: real.fleet, [CATALOG]: real.catalog });
  const model = await view.company({ refresh() {} });
  assert.deepEqual([model.kicker, model.title], ['Engineering · Sat Ops', '2 of 3 simulated sats heartbeating']);
  assert.match(model.lede, /^Simulation only: every engine is a simulator and nothing here sends a command\. /);
  assert.match(model.lede, /reset when it restarts\.$/);
  assert.deepEqual(model.stats.map((x) => [x.id, x.label, x.value, x.tone || null, x.hint || null]), [
    ['nodes', 'Sim nodes', 3, null, null],
    ['recent', 'Recent heartbeats', 2, null, null],
    ['stale', 'Stale heartbeats', 1, 'warn', null],
    ['orbits', 'Orbits loaded', 3, null, 'TLE records'],
  ]);
  assert.deepEqual(section(model, 'fleet').columns.map((c) => (typeof c === 'string' ? c : c.label + ':' + c.align)),
    ['Sat', 'Engine', 'Heartbeat', 'Mode', 'Pointing error:right', 'Wheel momentum:right', 'Last heard']);
  assert.deepEqual(cells(model, 'fleet'), [
    ['sat-polar', 'NASA 42 sim', 'Recent:ok', 'SLEW', '12.50°', '7%', 'W(' + T1 + ')'],
    ['sat42-live', 'RK4 sim', 'Recent:ok', 'POINT', '0.12°', '42%', 'W(' + T2 + ')'],
    ['sat-old', 'RK4 sim', 'Stale:warn', 'SAFE', '—', '90%', 'W(' + T3 + ')'],
  ]);
  assert.match(section(model, 'fleet').note, /^Heartbeat is the fleet registry’s own reading\. .*each node’s last report, so a stale row shows what that node reported before its heartbeats stopped/);
  assert.deepEqual(section(model, 'orbits').columns, ['Sat', 'Name', 'NORAD no.', 'Attitude node', 'Registered']);
  assert.deepEqual(cells(model, 'orbits'), [
    ['sat-chaser', '—', '90002', 'None', 'W(' + U2 + ')'],
    ['sat42-live', 'SYNTHETIC LEADER', '90001', 'Recent heartbeat:ok', 'W(' + U1 + ')'],
    ['sat-old', 'SYNTHETIC OLD', '90004', 'Stale heartbeat:warn', 'W(' + U0 + ')'],
  ]);
  assert.match(section(model, 'orbits').note, /not orbit-quality certification.*never from this view/);
  assert.ok(model.sections.every((s) => s.rows.every((row) => Array.isArray(row))), 'no row opens, commands or changes anything');
  assert.deepEqual(model.sections.map((s) => s.id), ['fleet', 'orbits']);
  assert.deepEqual(model.actions.map((a) => a.label), ['Open the fleet plane']);
  model.actions[0].onClick();
  assert.deepEqual(view.opened, [FULL], 'the one action is the way to the full application');
});

test('the title names the fleet\x27s state: all heartbeating, some, none recent, orbits without nodes, nothing yet', async () => {
  assert.equal((await paintReal([LIVE, POLAR], [])).title, '2 simulated sats heartbeating');
  assert.equal((await paintReal([LIVE], [LEADER])).title, '1 simulated sat heartbeating');
  const quiet = await paintReal([OLD], [RETIRED]);
  assert.deepEqual([quiet.title, stat(quiet, 'stale').value, stat(quiet, 'stale').tone], ['No recent heartbeat from 1 simulated sat', 1, 'warn']);
  const orbitsOnly = await paintReal([], [LEADER, CHASER]);
  assert.deepEqual([orbitsOnly.title, section(orbitsOnly, 'fleet').rows, section(orbitsOnly, 'fleet').empty], ['2 orbits loaded, no sat node heartbeating', [], 'No sat node has heartbeated since the API process started.']);
  assert.deepEqual(cells(orbitsOnly, 'orbits').map((r) => r[3]), ['None', 'None']);
  const none = await paintReal([], []);
  assert.deepEqual([none.title, section(none, 'orbits').rows, section(none, 'orbits').empty, stat(none, 'nodes').value, stat(none, 'stale').tone], ['No sat nodes or orbits yet', [], 'No orbits loaded yet.', 0, null]);
  assert.match(none.lede, /^A sat shows here once its sat node heartbeats in, and an orbit once a TLE is registered in Sat Ops\./);
});

test('odd rows read as what they are: no telemetry yet, never heard, an unknown engine, a catalog row without name or number', async () => {
  const bare = node('sat-new', 'future-engine', false, null, null);
  const partial = node('sat-half', 'rk4', true, T2, { mode: 'DETUMBLE', pointingErrorDeg: null });
  const model = await paintReal([bare, partial], [{ satId: 'sat-new', tleRaw: 'x', updatedUtcMs: null }]);
  assert.deepEqual(cells(model, 'fleet'), [
    ['sat-half', 'RK4 sim', 'Recent:ok', 'DETUMBLE', '—', '—', 'W(' + T2 + ')'],
    ['sat-new', 'future-engine', 'Stale:warn', 'No telemetry yet', '—', '—', 'never'],
  ]);
  assert.deepEqual(cells(model, 'orbits'), [['sat-new', '—', '—', 'Stale heartbeat:warn', '—']]);
});

test('a catalog that could not be read leaves the fleet showing and the orbit count reading Could not check', async () => {
  const fleet = (await realReads([LIVE], [])).fleet;
  for (const catalog of [{ http: 500, body: { error: 'synthetic' } }, { http: 200, body: undefined }, { http: 200, body: { error: 'synthetic' } }, new TypeError('Failed to fetch')]) {
    const model = await paint(fleet, catalog);
    assert.deepEqual([model.title, stat(model, 'orbits').value, stat(model, 'orbits').hint], ['1 simulated sat heartbeating', '—', 'Could not check']);
    assert.deepEqual([section(model, 'orbits').rows, section(model, 'orbits').empty], [[], 'The orbit catalog could not be read just now.']);
    assert.equal(section(model, 'fleet').rows.length, 1);
  }
  const empty = await paint((await realReads([], [])).fleet, { http: 502, body: {} });
  assert.equal(empty.title, 'No sat nodes heartbeating');
});

test('signed out, refused, the fleet route\x27s failure, an unreadable answer and an unreachable server each read as what they are', async () => {
  const catalog = (await realReads([], [LEADER])).catalog, fleet = (await realReads([LIVE], [])).fleet;
  const signedOut = await paint({ http: 401, body: { error: 'not_authenticated' } }, { http: 401, body: {} });
  assert.deepEqual([signedOut.kicker, signedOut.title, signedOut.stats, signedOut.sections, signedOut.actions], ['Engineering · Sat Ops', 'Sign in to see the sat fleet', undefined, undefined, undefined]);
  assert.match(signedOut.lede, /this session is not signed in/);
  assert.equal((await paint(fleet, { http: 401, body: {} })).title, 'Sign in to see the sat fleet', 'a signed-out catalog read is the same sign-in state');
  const denied = await paint({ http: 403, body: { error: 'forbidden' } }, catalog);
  assert.deepEqual([denied.title, denied.lede], ['This account cannot open Sat Ops', 'The Sat Ops routes refused this account (HTTP 403).']);
  await assert.rejects(paint({ http: 500, body: { error: 'synthetic' } }, catalog), /^Error: Sat Ops could not read the fleet \(HTTP 500\)\.$/);
  await assert.rejects(paint({ http: 200, body: undefined }, catalog), /^Error: Sat Ops sent an answer this view could not read\.$/);
  await assert.rejects(paint({ http: 200, body: { error: 'synthetic' } }, catalog), /^Error: Sat Ops sent an answer this view could not read\.$/);
  await assert.rejects(paint(new TypeError('Failed to fetch'), catalog), /^Error: Sat Ops could not be reached just now\.$/);
});

/** @returns {string} The body of the page's n-th inline classic script (0 = the head block). */
function inlineScript(n) {
  let from = 0, body = '';
  for (let i = 0; i <= n; i++) { const s = html.indexOf('<script>', from); const e = html.indexOf('</script>', s); body = html.slice(s + 8, e); from = e; }
  return body;
}
const MAIN = inlineScript(1), EVIDENCE = inlineScript(2);
const GATE = 'if (!window.AppView || !AppView.active()) ';

/** @returns {object} A stub element that records the listeners bound on it and every click handler assigned to it. */
function element(id, calls) {
  const el = { id, style: {}, value: '', textContent: '', open: false, selectedIndex: 0, addEventListener(type) { calls.listeners.push(type); }, dispatchEvent() {}, replaceChildren() {} };
  Object.defineProperty(el, 'onclick', { get: () => null, set: () => { calls.clicks.push(id); } });
  return el;
}

/**
 * @description Run the page's main script against a stub DOM, fetch and timers. The fetch never settles, so a full-page
 * run stops at its first reads (deterministically, with no unhandled rejection) after every synchronous start step.
 * @param {string|null} activeView What AppView.active() answers, or null for the full page.
 * @returns {{ listeners: string[], clicks: string[], reads: string[], timers: number }} Listeners bound, click handlers
 *   assigned, requests made, timers and frames started.
 */
function runMain(activeView) {
  const calls = { listeners: [], clicks: [], reads: [], timers: 0 };
  const kit = { active: () => activeView };
  const win = { AppView: kit, addEventListener(type) { calls.listeners.push(type); } };
  const doc = { getElementById: (id) => element(id, calls), createElement: (tag) => element(tag, calls) };
  const timer = () => { calls.timers++; return 0; };
  const fetchStub = (url, opt) => { calls.reads.push(((opt && opt.method) || 'GET') + ' ' + url); return new Promise(() => {}); };
  new Function('window', 'AppView', 'document', 'fetch', 'setInterval', 'setTimeout', 'requestAnimationFrame', MAIN)(win, kit, doc, fetchStub, timer, timer, timer);
  return calls;
}

test('every top-level start step of the main script is gated: under the view it binds, reads and starts nothing; without it the page starts', () => {
  const steps = MAIN.split('\n').filter((line) => /^[^\s}/)\]]/.test(line) && !/^(function |async function |let |const |var |'use strict')/.test(line));
  assert.equal(steps.length, 20, 'the camera, catalog, screening, pass, concierge, command and help wiring plus the boot');
  assert.deepEqual(steps.filter((line) => !line.startsWith(GATE)), [], 'each top-level start step carries the gate');
  assert.deepEqual(runMain('company'), { listeners: [], clicks: [], reads: [], timers: 0 });
  assert.deepEqual(runMain(null), {
    listeners: ['mousedown', 'mousemove', 'mouseup', 'wheel', 'keydown', 'click'],
    clicks: ['btnAutoRot', 'btnFrame', 'catAdd', 'catSeed', 'cjRun', 'passRun', 'chatSend', 'cmdSafe', 'cmdDetumble', 'cmdDesat', 'cmdPoint', 'btnHelp', 'helpClose'],
    reads: ['GET /api/sat/fleet', 'GET /api/sat/catalog'],
    timers: 2,
  });
});

/**
 * @description Run the connected-actions script (its dynamic import routed to a stub) against a stub DOM.
 * @param {string|null} activeView What AppView.active() answers, or null for the full page.
 * @returns {Promise<{ imports: string[], mounted: string[], listeners: string[] }>} Modules imported, apps mounted, listeners bound.
 */
async function runEvidence(activeView) {
  const calls = { imports: [], mounted: [], listeners: [], clicks: [] };
  const kit = { active: () => activeView };
  const doc = { getElementById: (id) => element(id, calls), createElement: (tag) => element(tag, calls) };
  const load = (url) => { calls.imports.push(url); return Promise.resolve({ mountConnectedActions: (opt) => { calls.mounted.push(opt.app); return Promise.resolve(); } }); };
  assert.equal(EVIDENCE.split('import(').length - 1, 1, 'one dynamic import to route');
  new Function('window', 'AppView', 'document', '__import', EVIDENCE.replace('import(', '__import('))({ AppView: kit }, kit, doc, load);
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  return { imports: calls.imports, mounted: calls.mounted, listeners: calls.listeners };
}

test('the connected-actions script is gated: under the view nothing is imported, nothing mounts and no listener binds; the full page mounts it', async () => {
  assert.ok(EVIDENCE.trimStart().split('\n').find((line) => !line.startsWith('//')).startsWith(GATE), 'the script\x27s one statement carries the gate');
  assert.deepEqual(await runEvidence('company'), { imports: [], mounted: [], listeners: [] });
  assert.deepEqual(await runEvidence(null), { imports: ['/cockpit/js/app-workflows.js'], mounted: ['sat-ops'], listeners: ['change', 'toggle'] });
});
