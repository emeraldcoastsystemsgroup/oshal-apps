/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The audience view contract of this package's page (ADR-164 D6): the shared kit is loaded right after the theme bootstrap, the page boots the kit with exactly the audiences it provides and its own application name, the full-page start is gated on the kit's decision, the head block parses, and every read in it stays on this package's own routes (plus the framework connect list where the page already reads it). Static, no browser, no network.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The Drone Ops family view asserted as behaviour over the package's REAL routes: GET /missions from routes/drone-routes.js (loaded with only express and the framework aliases stubbed, a stub pool) and GET /home-summary from routes/home-summary.js, their answers JSON round-tripped as Express serializes them. On open the view makes exactly those two reads and both routes only SELECT the caller's own rows; the saved plans paint as plain stats (saved, not flown yet, plans started in five days, commands turned down in five days), a title ladder, and tiles naming each plan's shape (one drone and its stops, drones flying together, a timed show), where it came from and where it stands ("started", never "flown": the route writes that flag when a flight starts), with no tile that opens, flies or changes anything. A count the summary could not check, a full 50-plan list, signed out (the route's own 401), refused (403), the route's own 500, an unreadable answer and an unreachable server each read as what they are. Every top-level start step of the full page's main script and its connected-actions script is gated: under the view they bind nothing, read nothing and start no poll; without it they run.
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | ADR-169 L6: the route module now imports the kernel's locatedDevice (@/features/location); it is stubbed to "nobody" here because the family view never reads live telemetry, and the loader's unexpected-import check keeps naming any further import.
 * -----------------------------------------------------------------------------
 * @module audience-view.test
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const APP = 'drone';
const PAGE = 'tools/drone-ops.html';
const AUDIENCES = ["family", "company"];
const ALLOWED_PREFIXES = ["/api/drone"];
const GATE_FILE = 'tools/drone-ops.html';

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

const MISSIONS = '/api/drone/missions', SUMMARY = '/api/drone/home-summary', FULL = '/cockpit/?app=drone';
const SUB = 'synthetic-sub';
// resolveViewerSub falls back to a demo viewer under MOCK_OIDC; the signed-out cases need the real refusal.
delete process.env.MOCK_OIDC;

/** @returns {object} A signed-in (or signed-out) OIDC request context, as express-openid-connect provides it. */
const oidc = (signedIn) => (signedIn ? { user: { sub: SUB }, isAuthenticated: () => true } : { isAuthenticated: () => false });

/** @returns {object} A stub Express response that records the status and the JSON body. */
function response() {
  return { statusCode: 200, body: undefined, setHeader() {}, status(s) { this.statusCode = s; return this; }, json(b) { this.body = b; } };
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

/** The framework modules routes/drone-routes.js imports through @/ aliases, stubbed to what route registration touches. */
const DRONE_STUBS = {
  '@/shared/logger': { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) },
  '@/shared/services/database': { runRuntimeSchemaBootstrap: () => Promise.resolve(), buildOwnerRlsPolicyStatements: () => [] },
  '@/shared/middleware/authz': { getTrustedServiceUserSub: () => null, hasValidServiceSecret: () => false },
  '@/features/drone': { DroneService: class {}, FleetShowRunner: class {}, DroneValidationError: class extends Error {}, DroneCommandError: class extends Error {}, DEFAULT_DRONE_ID: 'alpha' },
  '@/app/routes/concierge-envelope': {},
  '@/app/routes/concierge-store': { ConciergeStore: class {} },
  '@/features/location': { locatedDevice: async () => null },
};

/**
 * @description Load one of the package's compiled route modules with a recording express Router: node built-ins are real,
 * the framework aliases come from DRONE_STUBS, anything else fails the test (so a new import is noticed, not guessed).
 * @param {string} file The module path under the package root.
 * @returns {{ exports: object, routes: Array<{method: string, path: string, handler: Function}> }} The module and every route it registers.
 */
function loadRoutes(file) {
  const routes = [];
  const router = {};
  ['get', 'post', 'put', 'patch', 'delete', 'use'].forEach((method) => { router[method] = (p, ...fns) => { routes.push({ method, path: p, handler: fns[fns.length - 1] }); }; });
  const load = (name) => {
    if (name === 'express') return { Router: () => router };
    if (['path', 'fs', 'crypto'].includes(name)) return require(name);
    assert.ok(Object.prototype.hasOwnProperty.call(DRONE_STUBS, name), 'unexpected import in ' + file + ': ' + name);
    return DRONE_STUBS[name];
  };
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', '__dirname', fs.readFileSync(path.join(ROOT, file), 'utf8'))(load, mod, mod.exports, path.join(ROOT, 'routes'));
  return { exports: mod.exports, routes };
}

/** @returns {{method: string, path: string, handler: Function}} The one route registered for a method and path. */
function route(routes, method, p) {
  const found = routes.filter((r) => r.method === method && r.path === p);
  assert.equal(found.length, 1, method.toUpperCase() + ' ' + p + ' is registered once');
  return found[0];
}

/**
 * @description Answer GET /missions with the package's REAL route (routes/drone-routes.js) over a stub pool.
 * @param {{rows?: object[]|Error, signedIn?: boolean}} [db] What the missions SELECT answers, and whether the caller is signed in.
 * @returns {Promise<{http: number, body: object, calls: object[], routes: object[]}>} Status, JSON body, the queries, every route.
 */
async function realMissions({ rows = [], signedIn = true } = {}) {
  const { exports, routes } = loadRoutes('routes/drone-routes.js');
  const pool = stubPool(() => rows);
  exports.createDroneRoutes({ pool, appPackageDir: ROOT });
  const bootstrap = pool.calls.length;
  const res = response();
  await route(routes, 'get', '/missions').handler({ oidc: oidc(signedIn), params: {}, query: {}, body: undefined, path: '/missions' }, res);
  return { http: res.statusCode, body: res.body, calls: pool.calls.slice(bootstrap), routes };
}

/**
 * @description Answer GET /home-summary with the package's REAL route (routes/home-summary.js) over a stub pool.
 * @param {{counts?: object|Error, rejected?: object|Error, rows?: object[]|Error, signedIn?: boolean}} [db] What the
 *   mission counts, the command-log count and the newest-plans query answer, and whether the caller is signed in.
 * @returns {Promise<{http: number, body: object, calls: object[]}>} The route's HTTP status, JSON body and queries.
 */
async function realSummary({ counts = { drafts: '0', started: '0' }, rejected = { rejected: '0' }, rows = [], signedIn = true } = {}) {
  const { exports, routes } = loadRoutes('routes/home-summary.js');
  const pool = stubPool((text) => (/drone_command_log/.test(text) ? rejected : /count\(\*\)/.test(text) ? counts : rows));
  exports.createHomeSummaryRoutes({ pool });
  const res = response();
  await route(routes, 'get', '/').handler({ oidc: oidc(signedIn) }, res);
  return { http: res.statusCode, body: res.body, calls: pool.calls };
}

/**
 * @description Run the head block against a stub kit and a stub fetch. Bodies are JSON round-tripped as Express sends them
 * (a Date column arrives as an ISO string). The stub relative-time formatter tags its input: W(...) = AppView.when.
 * @param {Object<string, {http: number, body: object|undefined}|Error>} answers What each read answers (an undefined body
 *   is not JSON; an Error rejects the fetch, a network failure). A read with no answer is a 404.
 * @returns {{ family: Function, urls: string[], opened: string[] }} The builder, every request made, every AppView.open href.
 */
function loadFamily(answers) {
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
  assert.ok(config && typeof config.audiences.family === 'function', 'the block boots the family audience');
  return { family: config.audiences.family, urls, opened };
}

/** @returns {Promise<object>} The family model painted from the two real routes' answers. */
async function paint(missions, summary) {
  const answers = { [MISSIONS]: missions instanceof Error ? missions : await missions, [SUMMARY]: summary instanceof Error ? summary : await summary };
  return loadFamily(answers).family({ refresh() {} });
}

const T1 = '2026-09-28T10:00:00.000Z', T2 = '2026-09-27T09:00:00.000Z', T3 = '2026-09-26T08:00:00.000Z', T4 = '2026-09-24T07:00:00.000Z';
const at = (iso) => new Date(iso);
/** @returns {object} A drone_missions row as GET /missions selects it (mission_id, name, plan, status, source, the three times). */
function plan(id, name, body, status, source, created, updated, flown) {
  return { mission_id: id, name, plan: Object.assign({ name }, body), status, source, created_at: at(created), updated_at: at(updated || created), last_flown_at: flown ? at(flown) : null };
}
const slots = (n) => Array.from({ length: n }, (_, i) => ({ droneId: 'd' + i, east: i, north: 0, alt: 30 }));
const SHOW = plan('m1', 'Synthetic Evening Ballet', { kind: 'show', cues: Array.from({ length: 5 }, (_, i) => ({ at: i * 20, name: 'cue ' + i, slots: slots(3) })) }, 'draft', 'show', T1);
const LOOP = plan('m2', 'Synthetic Backyard Loop', { waypoints: [{ lat: 1, lon: 1, alt: 30 }, { lat: 1, lon: 2, alt: 30 }, { lat: 2, lon: 2, alt: 30 }, { lat: 2, lon: 1, alt: 30 }] }, 'draft', 'concierge', T2);
const SWEEP = plan('m3', 'Synthetic Pair Sweep', { assignments: [{ droneId: 'alpha', plan: { waypoints: [] } }, { droneId: 'bravo', plan: { waypoints: [] } }] }, 'flown', 'manual', T4, T3, T3);
const HOP = plan('m4', 'Synthetic Porch Hop', { waypoints: [{ lat: 1, lon: 1, alt: 10 }] }, 'ready', 'manual', T4);
const section = (model, id) => model.sections.find((x) => x && x.id === id);
const stat = (model, id) => model.stats.find((x) => x.id === id);
const tiles = (model, id) => section(model, id || 'plans').items.map((t) => [t.title, t.text, t.meta, t.badge]);

test('on open the view makes two reads, GET /missions and GET /home-summary, and both routes only SELECT the caller\x27s own rows', async () => {
  const missions = await realMissions({ rows: [LOOP] });
  assert.deepEqual(missions.calls.map((c) => [/^\s*SELECT\b/.test(c.text), /FROM drone_missions WHERE user_sub = \$1/.test(c.text), c.values]), [[true, true, [SUB]]]);
  assert.equal(route(missions.routes, 'get', '/missions').method, 'get');
  const summary = await realSummary({ rows: [LOOP] });
  assert.equal(summary.calls.length, 3);
  assert.ok(summary.calls.every((c) => /^\s*SELECT\b/.test(c.text) && c.values[0] === SUB), 'home-summary only SELECTs, scoped to the caller');
  const view = loadFamily({ [MISSIONS]: missions, [SUMMARY]: summary });
  await view.family({ refresh() {} });
  assert.deepEqual([...view.urls].sort(), ['GET ' + SUMMARY, 'GET ' + MISSIONS]);
});

test('the real routes\x27 answers paint plain stats, the title and the latest plans with their shape, origin and where each stands', async () => {
  const view = loadFamily({ [MISSIONS]: await realMissions({ rows: [SHOW, LOOP, SWEEP, HOP] }), [SUMMARY]: await realSummary({ counts: { drafts: '2', started: '1' }, rejected: { rejected: '2' } }) });
  const model = await view.family({ refresh() {} });
  assert.deepEqual([model.kicker, model.title], ['Drone flights', '1 flight plan started in the last 5 days']);
  assert.equal(model.lede, 'Latest: Synthetic Evening Ballet, saved W(' + T1 + '). Nothing flies from here: a person approves every flight in Drone Ops.');
  assert.deepEqual(model.stats.map((x) => [x.id, x.label, x.value, x.tone || null, x.hint || null]), [
    ['plans', 'Saved flight plans', 4, null, null],
    ['waiting', 'Not flown yet', 3, null, 'Drafts and ready plans'],
    ['started', 'Plans started, last 5 days', 1, null, 'Started, not a finished flight'],
    ['refused', 'Commands turned down, last 5 days', 2, 'warn', 'By the flight checks'],
  ]);
  assert.deepEqual(tiles(model), [
    ['Synthetic Evening Ballet', 'Timed show · 5 moves · 3 drones · made in the show builder', 'saved W(' + T1 + ')', 'Draft'],
    ['Synthetic Backyard Loop', 'One drone · 4 stops · drafted in the operator chat', 'saved W(' + T2 + ')', 'Draft'],
    ['Synthetic Pair Sweep', '2 drones flying together · made on the map', 'started W(' + T3 + ')', 'Started'],
    ['Synthetic Porch Hop', 'One drone · 1 stop · made on the map', 'saved W(' + T4 + ')', 'Ready'],
  ]);
  const items = section(model, 'plans').items;
  assert.ok(items.every((t) => !t.href && !t.onClick && !t.target), 'a plan tile opens, flies and changes nothing');
  assert.doesNotMatch(JSON.stringify(model).replace(/not flown yet/gi, ''), /flown/i, 'only "not flown yet" says flown: the route writes that flag when a flight starts');
  assert.match(section(model, 'plans').note, /it does not say the flight finished/);
  assert.deepEqual(model.sections.filter(Boolean).map((s) => s.id), ['plans']);
  assert.deepEqual(model.actions.map((a) => a.label), ['Open Drone Ops']);
  model.actions[0].onClick();
  assert.deepEqual(view.opened, [FULL], 'the one action is the way to the full application');
});

test('the title names the account\x27s state: plans started lately, plans not flown yet, saved plans, no saved plans yet', async () => {
  const waiting = await paint(realMissions({ rows: [LOOP, SWEEP, HOP] }), realSummary());
  assert.equal(waiting.title, '2 flight plans not flown yet');
  const one = await paint(realMissions({ rows: [HOP] }), realSummary());
  assert.equal(one.title, '1 flight plan not flown yet');
  const flownEarlier = await paint(realMissions({ rows: [SWEEP, plan('m5', 'Synthetic Old Hop', { waypoints: [] }, 'flown', 'pattern', T4, T4, T4)] }), realSummary());
  assert.deepEqual([flownEarlier.title, stat(flownEarlier, 'waiting').value], ['2 saved flight plans', 0]);
  const none = await paint(realMissions({ rows: [] }), realSummary());
  assert.deepEqual([none.title, section(none, 'plans').items, section(none, 'plans').empty, stat(none, 'plans').value], ['No saved flight plans yet', [], 'No saved flight plans yet.', 0]);
  assert.match(none.lede, /nothing flies until a person approves it in Drone Ops/);
});

test('more than six plans list the rest as saved earlier; a full 50-plan list says its counts are the newest 50; odd rows read as what they are', async () => {
  const many = Array.from({ length: 50 }, (_, i) => plan('n' + i, 'Synthetic Plan ' + i, { waypoints: [] }, i % 2 ? 'ready' : 'flown', 'manual', T4, T4, i % 2 ? null : T4));
  const full = await paint(realMissions({ rows: many }), realSummary());
  assert.deepEqual([section(full, 'plans').items.length, section(full, 'earlier').items.length, section(full, 'earlier').title], [6, 14, 'Saved earlier']);
  assert.deepEqual([stat(full, 'plans').value, stat(full, 'plans').hint, stat(full, 'waiting').value, stat(full, 'waiting').hint], [50, 'Newest 50 only', 25, 'Among the newest 50']);
  const odd = [{ mission_id: 'x1', name: '', plan: null, status: 'paused', source: 'imported', created_at: at(T2), updated_at: at(T2), last_flown_at: null }];
  const model = await paint(realMissions({ rows: odd }), realSummary());
  assert.deepEqual(tiles(model), [['Untitled plan', 'Flight plan', 'saved W(' + T2 + ')', 'Status: paused']]);
});

test('a count the summary could not check reads as not checked, and the saved plans still show', async () => {
  const partial = await paint(realMissions({ rows: [LOOP] }), realSummary({ rejected: new Error('synthetic command-log failure') }));
  assert.deepEqual(['started', 'refused'].map((id) => [stat(partial, id).value, stat(partial, id).tone, stat(partial, id).hint]), [[0, null, 'Started, not a finished flight'], ['—', null, 'Could not check']]);
  const down = await realSummary({ counts: new Error('synthetic'), rejected: new Error('synthetic'), rows: new Error('synthetic') });
  assert.equal(down.http, 503, 'the real route answers 503 when every source failed');
  const unchecked = await paint(realMissions({ rows: [LOOP, SWEEP] }), down);
  assert.deepEqual(['started', 'refused'].map((id) => [stat(unchecked, id).value, stat(unchecked, id).hint]), [['—', 'Could not check'], ['—', 'Could not check']]);
  assert.deepEqual([unchecked.title, section(unchecked, 'plans').items.length], ['1 flight plan not flown yet', 2]);
  const signedOutSummary = await paint(realMissions({ rows: [LOOP] }), realSummary({ signedIn: false }));
  assert.deepEqual([stat(signedOutSummary, 'started').value, section(signedOutSummary, 'plans').items.length], ['—', 1]);
  const unreachable = await paint(realMissions({ rows: [LOOP] }), new TypeError('Failed to fetch'));
  assert.deepEqual([stat(unreachable, 'refused').value, unreachable.title], ['—', '1 flight plan not flown yet']);
});

test('signed out, refused, the route\x27s own failure, an unreadable answer and an unreachable server each read as what they are', async () => {
  const signedOut = await paint(realMissions({ signedIn: false }), realSummary({ signedIn: false }));
  assert.deepEqual([signedOut.title, signedOut.stats, signedOut.sections], ['Sign in to see the saved flights', undefined, undefined]);
  assert.match(signedOut.lede, /this session is not signed in/);
  const denied = await paint({ http: 403, body: { error: 'forbidden' } }, realSummary());
  assert.deepEqual([denied.title, denied.lede], ['This account cannot open Drone Ops', 'The Drone Ops routes refused this account (HTTP 403).']);
  const broken = await realMissions({ rows: new Error('synthetic relation missing') });
  assert.equal(broken.http, 500, 'the real route answers 500 when the missions read fails');
  await assert.rejects(paint(broken, realSummary()), /^Error: Drone Ops could not read the saved flight plans \(HTTP 500\)\.$/);
  await assert.rejects(paint({ http: 200, body: undefined }, realSummary()), /^Error: Drone Ops sent an answer this view could not read\.$/);
  await assert.rejects(paint({ http: 200, body: { error: 'synthetic' } }, realSummary()), /^Error: Drone Ops sent an answer this view could not read\.$/);
  await assert.rejects(paint(new TypeError('Failed to fetch'), realSummary()), /^Error: Drone Ops could not be reached just now\.$/);
});

/** @returns {string} The body of the page's n-th inline classic script (0 = the head block). */
function inlineScript(n) {
  let from = 0, body = '';
  for (let i = 0; i <= n; i++) { const s = html.indexOf('<script>', from); const e = html.indexOf('</script>', s); body = html.slice(s + 8, e); from = e; }
  return body;
}
const MAIN = inlineScript(1), EVIDENCE = inlineScript(2);
const GATE = 'if (!window.AppView || !AppView.active()) ';

/** @returns {object} A stub element that records the listeners bound on it. */
function element(log) { return { addEventListener(type) { log.push(type); }, style: {}, value: '', textContent: '', open: false, selectedIndex: 0, dispatchEvent() {}, replaceChildren() {} }; }

/**
 * @description Run the page's main script against a stub DOM, fetch and timers. The fetch never settles, so a full-page
 * run stops at its first read (deterministically, with no unhandled rejection) after every synchronous start step.
 * @param {string|null} activeView What AppView.active() answers, or null for the full page.
 * @returns {{ listeners: string[], reads: string[], timers: number }} Listeners bound, requests made, timers started.
 */
function runMain(activeView) {
  const calls = { listeners: [], reads: [], timers: 0 };
  const kit = { active: () => activeView };
  const win = { AppView: kit, addEventListener(type) { calls.listeners.push(type); } };
  const doc = { getElementById: () => element(calls.listeners), createElement: () => element(calls.listeners) };
  const timer = () => { calls.timers++; return 0; };
  const fetchStub = (url, opt) => { calls.reads.push(((opt && opt.method) || 'GET') + ' ' + url); return new Promise(() => {}); };
  new Function('window', 'AppView', 'document', 'fetch', 'setInterval', 'setTimeout', 'requestAnimationFrame', MAIN)(win, kit, doc, fetchStub, timer, timer, timer);
  return calls;
}

test('every top-level start step of the main script is gated: under the view it binds, reads and starts nothing; without it the page starts', () => {
  const steps = MAIN.split('\n').filter((line) => /^[^\s}/)]/.test(line) && !/^(function |async function |let |const |var |'use strict')/.test(line));
  assert.deepEqual(steps.map((line) => line.startsWith(GATE)), [true, true, true, true, true], 'the five start steps (camera wiring, map click, resize, chat key, boot) each carry the gate');
  assert.deepEqual(runMain('family'), { listeners: [], reads: [], timers: 0 });
  assert.deepEqual(runMain(null), { listeners: ['mousedown', 'mouseup', 'mousemove', 'wheel', 'dblclick', 'click', 'resize', 'keydown'], reads: ['GET /api/drone/conversation'], timers: 0 });
});

/**
 * @description Run the connected-actions script (its dynamic import routed to a stub) against a stub DOM.
 * @param {string|null} activeView What AppView.active() answers, or null for the full page.
 * @returns {Promise<{ imports: string[], mounted: string[], listeners: string[] }>} Modules imported, apps mounted, listeners bound.
 */
async function runEvidence(activeView) {
  const calls = { imports: [], mounted: [], listeners: [] };
  const kit = { active: () => activeView };
  const doc = { getElementById: () => element(calls.listeners), createElement: () => element(calls.listeners) };
  const load = (url) => { calls.imports.push(url); return Promise.resolve({ mountConnectedActions: (opt) => { calls.mounted.push(opt.app); return Promise.resolve(); } }); };
  assert.equal(EVIDENCE.split('import(').length - 1, 1, 'one dynamic import to route');
  new Function('window', 'AppView', 'document', '__import', EVIDENCE.replace('import(', '__import('))({ AppView: kit }, kit, doc, load);
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  return calls;
}

test('the connected-actions script is gated: under the view no plan is imported, nothing mounts and no listener binds; the full page mounts it', async () => {
  assert.ok(EVIDENCE.trimStart().split('\n').find((line) => !line.startsWith('//')).startsWith(GATE), 'the script\x27s one statement carries the gate');
  assert.deepEqual(await runEvidence('family'), { imports: [], mounted: [], listeners: [] });
  assert.deepEqual(await runEvidence(null), { imports: ['/cockpit/js/app-workflows.js'], mounted: ['drone'], listeners: ['change', 'toggle'] });
});
