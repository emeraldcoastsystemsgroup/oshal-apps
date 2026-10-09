/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The audience view contract of this package's page (ADR-164 D6): the shared kit is loaded right after the theme bootstrap, the page boots the kit with exactly the audiences it provides and its own application name, the full-page start is gated on the kit's decision, the head block parses, and every read in it stays on this package's own routes (plus the framework connect list where the page already reads it). Static, no browser, no network.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The Spaces family view asserted as behaviour over the package's REAL home-summary route (routes/home-summary.js loaded with only express stubbed and a stub pool, its answers JSON round-tripped as Express sends them). On open the view makes exactly one read, GET /api/spaces/home-summary, whose route only SELECTs the caller's own scans; the head block names no other Spaces route (the scan and scene lists run the orphaned-scan self-heal, an UPDATE; a scan's dimensions, scene, artifact and geometry each read the whole model file). The saved scans paint as plain stats (real spaces ready, practice rooms, being built, did not finish), a title ladder and tiles naming how each scan was made and where it stands, with no tile that opens or changes anything; a count the route could not check, a scan query it could not run, odd rows, signed out (the route's own 401), refused (403), the route's own 503, an unreadable answer and an unreachable server each read as what they are. The full page's main script and its connected-actions script are gated: under the view they bind nothing, read nothing, start no refresh and mount no offer; without it (or without the kit) they run.
 * -----------------------------------------------------------------------------
 * @module audience-view.test
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const APP = 'spaces';
const PAGE = 'tools/spaces.html';
const AUDIENCES = ["family", "company"];
const ALLOWED_PREFIXES = ["/api/spaces"];
const GATE_FILE = 'tools/spaces.html';

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

const SUMMARY = '/api/spaces/home-summary', FULL = '/cockpit/?app=spaces';
const SUB = 'synthetic-sub';

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

/**
 * @description Load a compiled route module with a recording express Router. The home-summary route imports nothing but
 * express, so any other import fails the test (a new dependency is noticed, not guessed).
 * @param {string} file The module path under the package root.
 * @returns {{ exports: object, routes: Array<{method: string, path: string, handler: Function}> }} The module and every route it registers.
 */
function loadRoutes(file) {
  const routes = [];
  const router = {};
  ['get', 'post', 'put', 'patch', 'delete', 'use'].forEach((method) => { router[method] = (p, ...fns) => { routes.push({ method, path: p, handler: fns[fns.length - 1] }); }; });
  const load = (name) => { assert.equal(name, 'express', 'unexpected import in ' + file + ': ' + name); return { Router: () => router }; };
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', fs.readFileSync(path.join(ROOT, file), 'utf8'))(load, mod, mod.exports);
  return { exports: mod.exports, routes };
}

/**
 * @description Answer GET /home-summary with the package's REAL route (routes/home-summary.js) over a stub pool.
 * @param {{counts?: object|Error, rows?: object[]|Error, signedIn?: boolean}} [db] What the count query and the latest-scans
 *   query answer, and whether the caller is signed in.
 * @returns {Promise<{http: number, body: object, calls: object[]}>} The route's HTTP status, JSON body and queries.
 */
async function realSummary({ counts = { active: '0', failed: '0', simulated: '0', ready: '0' }, rows = [], signedIn = true } = {}) {
  const { exports, routes } = loadRoutes('routes/home-summary.js');
  const pool = stubPool((text) => (/count\(\*\)/.test(text) ? counts : rows));
  exports.createHomeSummaryRoutes({ pool });
  assert.deepEqual(routes.map((r) => r.method + ' ' + r.path), ['get /'], 'home-summary registers one GET');
  const res = response();
  await routes[0].handler({ oidc: oidc(signedIn) }, res);
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

/** @returns {Promise<object>} The family model painted from the real route's answer (or a hand-made answer / a network Error). */
async function paint(summary) {
  return loadFamily({ [SUMMARY]: summary instanceof Error ? summary : await summary }).family({ refresh() {} });
}

const T1 = '2026-09-28T10:00:00.000Z', T2 = '2026-09-27T09:00:00.000Z', T3 = '2026-09-26T08:00:00.000Z';
/** @returns {object} A spatial_scans row as the home-summary latest-scans query selects it. */
function scan(title, status, sourceKind, provider, updated, gaussians) {
  return { title, status, source_kind: sourceKind, provider, gaussian_count: gaussians === undefined ? null : gaussians, updated_at: new Date(updated) };
}
const LIVING = scan('Synthetic Living Room', 'ready', 'model', 'import', T1, 120000);
const PORCH = scan('Synthetic Porch', 'reconstructing', 'video', 'edge', T2);
const DEMO = scan('Synthetic Demo Room', 'ready', 'sim-mission', 'sim', T3, 5000);
const ATTIC = scan('Synthetic Attic', 'failed', 'video', null, T2);
const counts = (c) => Object.assign({ active: '0', failed: '0', simulated: '0', ready: '0' }, c);
const section = (model, id) => model.sections.find((x) => x && x.id === id);
const stat = (model, id) => model.stats.find((x) => x.id === id);
const tiles = (model) => section(model, 'latest').items.map((t) => [t.icon, t.title, t.text || null, t.meta || null, t.badge || null, t.tone || null]);

test('on open the view makes one read, GET /api/spaces/home-summary, and the route behind it only SELECTs the caller\x27s own scans', async () => {
  const summary = await realSummary({ rows: [LIVING] });
  assert.equal(summary.calls.length, 2);
  assert.ok(summary.calls.every((c) => /^\s*SELECT\b/.test(c.text) && /FROM spatial_scans WHERE user_sub = \$1/.test(c.text) && c.values[0] === SUB), 'home-summary only SELECTs, scoped to the caller');
  const view = loadFamily({ [SUMMARY]: summary });
  await view.family({ refresh() {} });
  assert.deepEqual(view.urls, ['GET ' + SUMMARY]);
  assert.doesNotMatch(block, /\/scans|\/scenes|\/dimensions|\/geometry|\/artifact|\/viewer|\/capture|\/drone-scan|\/rf\b|\/pair/, 'the head block names no other Spaces route');
});

test('the real route\x27s answer paints plain stats, the title and the latest scans with how each was made and where it stands', async () => {
  const view = loadFamily({ [SUMMARY]: await realSummary({ counts: counts({ active: '1', failed: '2', simulated: '1', ready: '3' }), rows: [LIVING, PORCH, DEMO] }) });
  const model = await view.family({ refresh() {} });
  assert.deepEqual([model.kicker, model.title], ['Spaces in 3D', '3 real spaces ready to explore']);
  assert.equal(model.lede, 'Latest: Synthetic Living Room, ready to explore, updated W(' + T1 + '). Adding, building and walking through a space happen in Spaces.');
  assert.deepEqual(model.stats.map((x) => [x.id, x.label, x.value, x.tone || null, x.hint || null]), [
    ['real', 'Real spaces ready', 3, null, 'Imported scans and video builds'],
    ['practice', 'Practice rooms', 1, null, 'Made up to try Spaces, not measured'],
    ['building', 'Being built', 1, null, null],
    ['failed', 'Did not finish', 2, 'warn', null],
  ]);
  assert.deepEqual(tiles(model), [
    ['🏠', 'Synthetic Living Room', 'Imported from a 3D scan', 'updated W(' + T1 + ')', 'Ready to explore', null],
    ['⏳', 'Synthetic Porch', 'Built from a walk-through video', 'updated W(' + T2 + ')', 'Being built', null],
    ['🧪', 'Synthetic Demo Room', 'Practice room, made up and not measured', 'updated W(' + T3 + ')', 'Ready to explore', null],
  ]);
  assert.ok(section(model, 'latest').items.every((t) => !t.href && !t.onClick && !t.target), 'a scan tile opens, builds and changes nothing');
  assert.match(section(model, 'latest').note, /^Up to three of this account’s most recently updated scans\. A practice room is made up to try Spaces, not a copy of a real room\. Nothing on this page films, imports or builds a space\.$/);
  assert.doesNotMatch(JSON.stringify(model), /Caller-owned|Gaussian|No model file|provider pending|SIMULATED/, 'the route\x27s own notes and raw wording stay out of the family view');
  assert.deepEqual(model.sections.map((s) => s.id), ['latest']);
  assert.deepEqual(model.actions.map((a) => a.label), ['Open Spaces']);
  model.actions[0].onClick();
  assert.deepEqual(view.opened, [FULL], 'the one action is the way to the full application');
});

test('the title names the account\x27s state: real spaces ready, spaces being built, practice rooms only, scans that did not finish, nothing saved', async () => {
  const one = await paint(realSummary({ counts: counts({ ready: '1' }), rows: [LIVING] }));
  assert.equal(one.title, '1 real space ready to explore');
  const building = await paint(realSummary({ counts: counts({ active: '2', simulated: '1' }), rows: [PORCH, DEMO] }));
  assert.equal(building.title, '2 spaces being built');
  const practice = await paint(realSummary({ counts: counts({ simulated: '1' }), rows: [DEMO] }));
  assert.equal(practice.title, '1 practice room, no real space yet');
  const failed = await paint(realSummary({ counts: counts({ failed: '1' }), rows: [ATTIC] }));
  assert.equal(failed.title, '1 scan did not finish');
  assert.deepEqual(tiles(failed), [['⚠️', 'Synthetic Attic', null, 'updated W(' + T2 + ')', 'Did not finish', 'warn']], 'a scan with no engine yet names no kind; the failure carries the warn tone');
  assert.equal(failed.lede, 'Latest: Synthetic Attic, did not finish, updated W(' + T2 + '). Adding, building and walking through a space happen in Spaces.');
  const none = await paint(realSummary());
  assert.deepEqual([none.title, section(none, 'latest').items, section(none, 'latest').empty], ['No saved spaces yet', [], 'No saved spaces yet.']);
  assert.deepEqual(none.stats.map((x) => x.value), [0, 0, 0, 0]);
  assert.match(none.lede, /^Spaces turns a walk-through video or a 3D scan from a phone or tablet into a room you can walk around on screen\./);
});

test('a count the route could not check, a scan query it could not run and odd rows each read as what they are', async () => {
  const noCounts = await realSummary({ counts: new Error('synthetic count failure'), rows: [LIVING] });
  assert.deepEqual([noCounts.http, noCounts.body.partial], [200, true], 'the real route answers 200 partial when one query failed');
  const unchecked = await paint(noCounts);
  assert.deepEqual(unchecked.stats.map((x) => [x.value, x.tone, x.hint]), [['—', null, 'Could not check'], ['—', null, 'Could not check'], ['—', null, 'Could not check'], ['—', null, 'Could not check']]);
  assert.deepEqual([unchecked.title, section(unchecked, 'latest').items.length], ['Your latest spaces', 1]);
  assert.match(section(unchecked, 'latest').note, /^Some saved details could not be checked just now\. Up to three/);
  const noRows = await paint(realSummary({ counts: counts({ ready: '2' }), rows: new Error('synthetic scan query failure') }));
  assert.deepEqual([noRows.title, section(noRows, 'latest').items, section(noRows, 'latest').empty], ['2 real spaces ready to explore', [], 'The latest scans could not be checked just now.']);
  assert.doesNotMatch(JSON.stringify(noRows), /Some saved sources cannot be checked/, 'the route\x27s own notice is not painted as a scan');
  const odd = await paint(realSummary({ counts: counts({ ready: '1' }), rows: [scan('', 'paused', 'video', 'lidar-box', 'not a date'), scan('Synthetic Shed', 'ready', 'video', 'edge / beta', T1)] }));
  assert.deepEqual(tiles(odd), [
    ['🧊', 'Untitled space', null, null, 'Status: paused', null],
    ['🧊', 'Synthetic Shed', 'ready / edge / beta / ' + T1, null, null, null],
  ], 'an unknown state reads as itself, an unreadable time shows none, and a detail that is not three fields is shown as sent');
});

test('signed out, refused, the route\x27s own failure, an unreadable answer and an unreachable server each read as what they are', async () => {
  const signedOut = await paint(realSummary({ signedIn: false }));
  assert.deepEqual([signedOut.title, signedOut.stats, signedOut.sections], ['Sign in to see your spaces', undefined, undefined]);
  assert.match(signedOut.lede, /this session is not signed in/);
  const denied = await paint({ http: 403, body: { error: 'forbidden' } });
  assert.deepEqual([denied.title, denied.lede], ['This account cannot open Spaces', 'The Spaces routes refused this account (HTTP 403).']);
  const down = await realSummary({ counts: new Error('synthetic'), rows: new Error('synthetic') });
  assert.equal(down.http, 503, 'the real route answers 503 when both queries failed');
  await assert.rejects(paint(down), /^Error: Spaces could not read the saved scans \(HTTP 503\)\.$/);
  await assert.rejects(paint({ http: 200, body: undefined }), /^Error: Spaces sent an answer this view could not read\.$/);
  await assert.rejects(paint({ http: 200, body: { error: 'synthetic' } }), /^Error: Spaces sent an answer this view could not read\.$/);
  await assert.rejects(paint(new TypeError('Failed to fetch')), /^Error: Spaces could not be reached just now\.$/);
});

/** @returns {string} The body of the page's n-th inline classic script (0 = the head block). */
function inlineScript(n) {
  let from = 0, body = '';
  for (let i = 0; i <= n; i++) { const s = html.indexOf('<script>', from); const e = html.indexOf('</script>', s); body = html.slice(s + 8, e); from = e; }
  return body;
}
const MAIN = inlineScript(1), EVIDENCE = inlineScript(2);
const GATE = 'if (!window.AppView || !AppView.active()) ';
/** @returns {string} The first line of a script that is not blank and not a comment. */
const firstStatement = (src) => src.split('\n').find((line) => line.trim() && !line.trim().startsWith('//'));

/** @returns {object} A stub element that records the listeners bound on it. */
function element(log) {
  return { addEventListener(type) { log.push(type); }, style: {}, value: '', textContent: '', innerHTML: '', open: false, selectedIndex: 0, files: null,
    querySelector: () => null, querySelectorAll: () => [], dispatchEvent() {}, replaceChildren() {}, classList: { add() {}, remove() {} } };
}

/**
 * @description Run the page's main script against a stub DOM, fetch and timers. The fetch never settles, so a full-page
 * run stops at its first read (deterministically, with no unhandled rejection) after every synchronous start step.
 * @param {string|null|undefined} activeView What AppView.active() answers, null for the full page, undefined for no kit at all.
 * @returns {{ listeners: string[], reads: string[], timers: number }} Listeners bound, requests made, timers started.
 */
function runMain(activeView) {
  const calls = { listeners: [], reads: [], timers: 0 };
  const kit = activeView === undefined ? undefined : { active: () => activeView };
  const doc = { getElementById: () => element(calls.listeners) };
  const timer = () => { calls.timers++; return 0; };
  const fetchStub = (url, opt) => { calls.reads.push(((opt && opt.method) || 'GET') + ' ' + url); return new Promise(() => {}); };
  new Function('window', 'AppView', 'document', 'fetch', 'setInterval', 'setTimeout', MAIN)({ AppView: kit }, kit, doc, fetchStub, timer, timer);
  return calls;
}

test('the main script is gated: under the view it binds, reads and starts nothing; without it (or without the kit) the full page starts', () => {
  assert.ok(firstStatement(MAIN).startsWith(GATE), 'the script\x27s one statement carries the gate');
  assert.equal(MAIN.trimEnd().split('\n').pop(), '})();', 'the gated statement runs to the end of the script');
  assert.deepEqual(runMain('family'), { listeners: [], reads: [], timers: 0 });
  const full = { listeners: ['submit', 'submit', 'click', 'click'], reads: ['GET /api/spaces/scans'], timers: 1 };
  assert.deepEqual(runMain(null), full, 'the full page wires its forms and buttons, reads the scan list and starts the refresh');
  assert.deepEqual(runMain(undefined), full, 'a core without the shared kit runs the full page');
});

/**
 * @description Run the connected-actions script (its dynamic import routed to a stub) against a stub DOM.
 * @param {string|null} activeView What AppView.active() answers, or null for the full page.
 * @returns {Promise<{ imports: string[], mounted: string[], listeners: string[] }>} Modules imported, apps mounted, listeners bound.
 */
async function runEvidence(activeView) {
  const calls = { imports: [], mounted: [], listeners: [] };
  const kit = { active: () => activeView };
  const doc = { getElementById: () => element(calls.listeners) };
  const load = (url) => { calls.imports.push(url); return Promise.resolve({ mountConnectedActions: (opt) => { calls.mounted.push(opt.app); return Promise.resolve(); } }); };
  assert.equal(EVIDENCE.split('import(').length - 1, 1, 'one dynamic import to route');
  new Function('window', 'AppView', 'document', '__import', EVIDENCE.replace('import(', '__import('))({ AppView: kit }, kit, doc, load);
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  return calls;
}

test('the connected-actions script is gated: under the view nothing is imported or mounted and no listener binds; the full page mounts it', async () => {
  assert.ok(firstStatement(EVIDENCE).startsWith(GATE), 'the script\x27s one statement carries the gate');
  assert.deepEqual(await runEvidence('family'), { imports: [], mounted: [], listeners: [] });
  assert.deepEqual(await runEvidence(null), { imports: ['/cockpit/js/app-workflows.js'], mounted: ['spaces'], listeners: ['change', 'toggle'] });
});
