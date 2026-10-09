/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The audience view contract of this package's page (ADR-164 D6): the shared kit is loaded right after the theme bootstrap, the page boots the kit with exactly the audiences it provides and its own application name, the full-page start is gated on the kit's decision, the head block parses, and every read in it stays on this package's own routes (plus the framework connect list where the page already reads it). Static, no browser, no network.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The family view asserted as behaviour over the package's REAL routes: routes/home-summary.js run with only express stubbed and a stub pool, and GET /responses from the REAL compiled routes/pumpkin-routes.js router (kernel aliases and express shimmed, a stub pool), so the view is fed what the routes actually serialize. Proven: the two reads on open (never a write, never the live rooms, the projector stream, a speak, replay, pin or save, never the connected-actions plan) and that both routes run only owner-scoped SELECTs; the counts as plain stats; the pinned favourites as tiles and the other saved lines as a list with plain face and source words, AppView.when timestamps and playlist sends; the newest-only caps; nothing saved yet; an empty list beside a summary that counts saved lines named as a failed read (the list route answers an empty list when its query fails) with the summary's newest lines shown instead; a count the summary could not check; signed out, refused, every source failed, a non-JSON failure and an unreachable server. The page's module script (top-level await, run as an async function body) mounts no connected actions, binds no Refresh handler and reads nothing under the view, while the full page still runs every start step.
 * -----------------------------------------------------------------------------
 * @module audience-view.test
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const Module = require('node:module');

const APP = 'pumpkin';
const PAGE = 'tools/review.html';
const AUDIENCES = ["family", "company"];
const ALLOWED_PREFIXES = ["/api/pumpkin"];
const GATE_FILE = 'tools/review.html';

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

const H = '/api/pumpkin/home-summary', R = '/api/pumpkin/responses', SUB = 'synthetic-sub';
const signedInAs = (yes) => (yes ? { user: { sub: SUB }, isAuthenticated: () => true } : { isAuthenticated: () => false });

/** @returns {object} A stub express response that records the status and JSON body a handler sends. */
function stubResponse() {
  return { statusCode: 200, body: undefined, headersSent: false, setHeader() {}, set() { return this; }, type() { return this; },
    status(s) { this.statusCode = s; return this; }, json(b) { this.body = b; this.headersSent = true; } };
}

/**
 * @description Answer GET /home-summary with the package's REAL compiled route (routes/home-summary.js) over a stub pool,
 * so the family view is fed exactly what the route serializes (its metric ids, the 'Unavailable' count, the
 * '<expression> / saved <when>' detail, the trailing note, the 503 when every source failed). Only `express` is stubbed.
 * @param {{looks?: object|Error, counts?: object|Error, newest?: object[]|Error, signedIn?: boolean}} [db] What the
 *   custom-looks count, the saved-lines counts and the newest-lines query answer (an Error rejects that query).
 * @returns {Promise<{http: number, body: object, sql: string[]}>} The route's status, JSON body and every query text it ran.
 */
async function realSummary({ looks = { presets: '0' }, counts = { lines: '0', pinned: '0' }, newest = [], signedIn = true } = {}) {
  const source = fs.readFileSync(path.join(ROOT, 'routes/home-summary.js'), 'utf8');
  const mod = { exports: {} }, sql = [];
  let handler = null;
  new Function('require', 'module', 'exports', source)((name) => { assert.equal(name, 'express'); return { Router: () => ({ get: (_p, fn) => { handler = fn; } }) }; }, mod, mod.exports);
  const answer = (value) => (value instanceof Error ? Promise.reject(value) : Promise.resolve({ rows: Array.isArray(value) ? value : [value] }));
  mod.exports.createHomeSummaryRoutes({ pool: { query: (q) => {
    sql.push(q.text);
    assert.equal(q.values[0], SUB, 'every summary query is scoped to the caller');
    return answer(/AS presets/.test(q.text) ? looks : /AS lines/.test(q.text) ? counts : newest);
  } } });
  const res = stubResponse();
  await handler({ oidc: signedInAs(signedIn) }, res);
  return { http: res.statusCode, body: res.body, sql };
}

let captured = null;
const shims = {
  '@/shared/logger': { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) },
  '@/shared/services/database': { buildOwnerRlsPolicyStatements: () => [] },
  '@/shared/middleware/authz': { hasValidServiceSecret: () => false, getTrustedServiceUserSub: () => null, getCaller: () => ({ sub: null, email: null }), isOperatorIdentity: () => false },
  '@/features/agent-management': { BotNodeClient: class {}, createRegistryEndpointResolver: () => () => null },
  '@/app/routes/inline-bot-execution': { executeBotOrInline: async () => { throw new Error('the family view must never run the pumpkin bot'); } },
  express: { Router: () => { const handlers = {}; captured = { handlers, get: (p, ...fns) => { handlers['GET ' + p] = fns[fns.length - 1]; }, post() {}, put() {}, patch() {}, delete() {}, use() {} }; return captured; } },
};

/**
 * @description Load the package's REAL compiled router (routes/pumpkin-routes.js, the bytes the framework mounts) with the
 * kernel aliases and express shimmed, the way tests/pumpkin-surface-endpoint-contract.test.cjs does.
 * @returns {Function} createPumpkinRoutes.
 */
function loadRouter() {
  const original = Module._load;
  Module._load = function shimmed(request, ...rest) { return Object.prototype.hasOwnProperty.call(shims, request) ? shims[request] : original.call(this, request, ...rest); };
  try { return require(path.join(ROOT, 'routes', 'pumpkin-routes.js')).createPumpkinRoutes; } finally { Module._load = original; }
}
const createPumpkinRoutes = loadRouter();

/**
 * @description Answer GET /responses with the REAL route handler over a stub pool: the playlist SELECT answers the given
 * pumpkin_responses rows, or rejects when given an Error (the route then answers an empty list, as it does in production).
 * @param {{rows?: object[]|Error, signedIn?: boolean}} [db] The rows the playlist query answers and whether the caller is signed in.
 * @returns {Promise<{http: number, body: object, sql: string[]}>} The route's status, JSON body and every query the GET ran.
 */
async function realResponses({ rows = [], signedIn = true } = {}) {
  const sql = [];
  let serving = false;
  createPumpkinRoutes({ appPackageDir: ROOT, pool: { query: (text, values) => {
    if (!serving || !/SELECT \* FROM pumpkin_responses/.test(String(text))) { if (serving) sql.push(String(text)); return Promise.resolve({ rows: [] }); }
    sql.push(String(text));
    assert.deepEqual(values, [SUB], 'the playlist read is scoped to the caller');
    return rows instanceof Error ? Promise.reject(rows) : Promise.resolve({ rows });
  } } });
  const handler = captured.handlers['GET /responses'];
  assert.equal(typeof handler, 'function', 'the real router registers GET /responses');
  await new Promise((resolve) => setImmediate(resolve));
  serving = true;
  const mock = process.env.MOCK_OIDC, res = stubResponse();
  delete process.env.MOCK_OIDC;
  try { await handler({ oidc: signedInAs(signedIn), path: '/responses', headers: {} }, res); } finally { if (mock !== undefined) process.env.MOCK_OIDC = mock; }
  return { http: res.statusCode, body: res.body, sql };
}

/**
 * @description Run the head block against a stub kit and a stub fetch, so the family view is asserted as the model it
 * paints and the requests it makes. The stub relative-time formatter tags its input: W(...) = AppView.when.
 * @param {Record<string, {http: number, body: object|undefined}>|Error} answers URL -> what it answers (an undefined body
 *   is not JSON), or an Error every fetch rejects with (the network failed).
 * @returns {{ family: Function, urls: string[], opened: string[] }} The builder, every request made, every AppView.open href.
 */
function loadFamily(answers) {
  let config = null;
  const urls = [], opened = [];
  const kit = { boot: (c) => { config = c; }, when: (v) => 'W(' + v + ')', open: (href) => opened.push(href) };
  const fetchStub = (url, opt) => {
    urls.push(((opt && opt.method) || 'GET') + ' ' + url);
    if (answers instanceof Error) return Promise.reject(answers);
    const a = answers[url] || { http: 404, body: {} };
    return Promise.resolve({ ok: a.http < 400, status: a.http, json: () => (a.body === undefined ? Promise.reject(new SyntaxError('not JSON')) : Promise.resolve(a.body)) });
  };
  new Function('window', 'fetch', block)({ AppView: kit }, fetchStub);
  assert.ok(config && typeof config.audiences.family === 'function', 'the block boots the family audience');
  return { family: config.audiences.family, urls, opened };
}

/** @returns {Promise<object>} The family model painted from the two answers (each may be a promise, such as realSummary()). */
async function paint(summary, responses) {
  return loadFamily({ [H]: await summary, [R]: await responses }).family({ refresh() {} });
}
const T1 = '2026-09-28T10:00:00.000Z', T2 = '2026-09-27T09:00:00.000Z', T3 = '2026-09-26T08:00:00.000Z';
/** @returns {object} A pumpkin_responses row as pg returns it (timestamps as Date objects). */
function row(id, say, expression, source, pinned, updated, plays) {
  return { id, user_sub: SUB, say, expression, intensity: 0.6, source, pinned, play_count: plays || 0, last_played_at: plays ? new Date(updated) : null, created_at: new Date(T3), updated_at: new Date(updated) };
}
const PINNED = row('r1', 'Synthetic: Happy Halloween, little ghosts!', 'spooky', 'manual', true, T2, 3);
const MIMIC = row('r2', 'Synthetic: Trick or treat, smell my feet!', 'laugh', 'mimic', false, T1);
const REPLY = row('r3', 'Synthetic: I am the king of the pumpkin patch.', 'mischief', 'autonomous', false, T3);
const NEWEST = [PINNED, MIMIC, REPLY].map((r) => ({ say: r.say, expression: r.expression, source: r.source, updated_at: r.updated_at }));
const section = (model, id) => model.sections.find((x) => x && x.id === id);
const stat = (model, id) => model.stats.find((x) => x.id === id);
const rowsOf = (s) => s.items.map((t) => [t.title, t.text, t.meta]);

test('on open the family view makes two reads, GET /home-summary and GET /responses, and both routes run only owner-scoped SELECTs', async () => {
  const summary = await realSummary({ looks: { presets: '1' }, counts: { lines: '3', pinned: '1' }, newest: NEWEST });
  const list = await realResponses({ rows: [PINNED, MIMIC, REPLY] });
  const view = loadFamily({ [H]: summary, [R]: list });
  await view.family({ refresh() {} });
  assert.deepEqual([...view.urls].sort(), ['GET ' + H, 'GET ' + R]);
  for (const url of view.urls) assert.doesNotMatch(url, /rooms|stream|speak|replay|chat|presets|settings|links|qr|workflow/, 'no live, speaking or offer read: ' + url);
  for (const text of summary.sql.concat(list.sql)) assert.match(text.trim(), /^SELECT /, 'a read runs a SELECT only: ' + text);
  assert.equal(list.sql.length, 1, 'GET /responses runs exactly the playlist query');
});

test('fed by the real routes, pinned favourites are tiles and the other saved lines a list, in plain words with timestamps', async () => {
  const view = loadFamily({ [H]: await realSummary({ looks: { presets: '2' }, counts: { lines: '3', pinned: '1' }, newest: NEWEST }), [R]: await realResponses({ rows: [PINNED, MIMIC, REPLY] }) });
  const model = await view.family({ refresh() {} });
  assert.deepEqual([model.kicker, model.title], ['Halloween pumpkin', '3 saved lines for the pumpkin']);
  assert.equal(model.lede, 'Most recent: “Synthetic: Trick or treat, smell my feet!”, updated W(' + T1 + ').');
  assert.deepEqual(model.stats.map((x) => [x.id, x.label, x.value, x.hint || null]), [
    ['lines', 'Saved lines', 3, null], ['pinned', 'Pinned favourites', 1, null], ['looks', 'Custom looks', 2, 'Saved faces and colours'], ['latest', 'Last change', 'W(' + T1 + ')', null],
  ]);
  assert.deepEqual(model.sections.filter(Boolean).map((x) => [x.id, x.kind, x.title]), [['favourites', 'tiles', 'Pinned favourites'], ['lines', 'list', 'More saved lines']]);
  assert.deepEqual(rowsOf(section(model, 'favourites')), [['“Synthetic: Happy Halloween, little ghosts!”', 'Spooky face · Saved by hand', 'updated W(' + T2 + ') · sent from the playlist 3 times']]);
  assert.deepEqual(rowsOf(section(model, 'lines')), [
    ['“Synthetic: Trick or treat, smell my feet!”', 'Laughing face · Said word for word', 'updated W(' + T1 + ')'],
    ['“Synthetic: I am the king of the pumpkin patch.”', 'Cheeky face · The pumpkin’s own reply', 'updated W(' + T3 + ')'],
  ]);
  const items = section(model, 'favourites').items.concat(section(model, 'lines').items);
  assert.ok(items.every((t) => !t.href && !t.onClick && !t.target), 'a saved line speaks, replays, opens and hands off nothing');
  assert.match(section(model, 'lines').note, /does not mean the line played on a projector, and Home never makes the pumpkin speak/);
  assert.doesNotMatch(section(model, 'lines').note, /could not/, 'a full read is not called partial');
  assert.deepEqual(model.actions.map((a) => a.label), ['Open Pumpkin']);
  model.actions[0].onClick();
  assert.deepEqual(view.opened, ['/cockpit/?app=pumpkin'], 'the one action is the way to the full application');
});

test('a long playlist shows the newest eight favourites and twenty other lines, and says where the rest are', async () => {
  const pinned = Array.from({ length: 9 }, (_, i) => row('p' + i, 'Synthetic pinned line ' + i, 'happy', 'manual', true, T2));
  const others = Array.from({ length: 22 }, (_, i) => row('o' + i, 'Synthetic line ' + i, 'weird', 'mimic', false, T3));
  const model = await paint(realSummary({ counts: { lines: '31', pinned: '9' } }), realResponses({ rows: pinned.concat(others) }));
  assert.equal(section(model, 'favourites').items.length, 8);
  assert.equal(section(model, 'favourites').note, 'The 8 newest pinned favourites show here; open Pumpkin for the rest.');
  assert.equal(section(model, 'lines').items.length, 20);
  assert.match(section(model, 'lines').note, /^The 20 newest saved lines show here; open Pumpkin for the rest\. A saved line is one/);
  assert.equal(section(model, 'lines').items[0].text, 'Face: weird · Said word for word', 'a face the view does not know is shown as it is');
});

test('nothing saved yet: an empty playlist beside a zero count reads as nothing saved, not as a failure', async () => {
  const model = await paint(realSummary(), realResponses({ rows: [] }));
  assert.equal(model.title, 'No saved lines yet');
  assert.match(model.lede, /Nothing is saved yet\.$/);
  assert.deepEqual(model.sections.filter(Boolean).map((x) => x.id), ['lines']);
  assert.deepEqual([section(model, 'lines').title, section(model, 'lines').items, section(model, 'lines').empty], ['Saved lines', [], 'No saved lines yet.']);
  assert.doesNotMatch(section(model, 'lines').note, /could not/);
  assert.deepEqual([stat(model, 'lines').value, stat(model, 'latest').value], [0, '—']);
});

test('an empty list beside a summary that counts saved lines is a failed read: the summary\x27s newest lines show instead and the note says so', async () => {
  const list = await realResponses({ rows: new Error('synthetic playlist failure') });
  assert.deepEqual([list.http, list.body], [200, { responses: [] }], 'the real route answers an empty list when its query fails');
  const newest = [{ say: 'Synthetic: Boo!', expression: 'spooky', source: 'mimic', updated_at: new Date(T1) }, { say: 'Synthetic: Who goes there?', expression: 'surprised', source: 'autonomous', updated_at: 'not a date' }];
  const model = await paint(realSummary({ counts: { lines: '5', pinned: '2' }, newest }), list);
  assert.equal(model.title, '5 saved lines for the pumpkin');
  assert.equal(model.lede, 'Most recent: “Synthetic: Boo!”, updated W(' + T1 + ').');
  assert.equal(section(model, 'favourites'), undefined, 'the summary does not say which lines are pinned, so none is called a favourite');
  assert.deepEqual(rowsOf(section(model, 'lines')), [
    ['“Synthetic: Boo!”', 'Spooky face', 'updated W(' + T1 + ')'],
    ['“Synthetic: Who goes there?”', 'Surprised face', 'updated date unavailable'],
  ]);
  assert.match(section(model, 'lines').note, /^The full list of saved lines could not be read just now, so only the newest show\./);
  const bare = await paint(realSummary({ counts: { lines: '4', pinned: '0' }, newest: new Error('synthetic newest failure') }), list);
  assert.deepEqual([bare.title, section(bare, 'lines').items, section(bare, 'lines').empty], ['4 saved lines for the pumpkin', [], 'None to show: some saved work could not be checked.']);
  assert.equal(bare.lede, 'Some saved lines could not be read just now. Try again in a moment, or open Pumpkin.');
  assert.match(section(bare, 'lines').note, /^Some saved pumpkin data could not be checked\. The saved lines could not be read just now\. A saved line/);
});

test('a count the summary could not check reads as not checked, and the saved lines that did load still show', async () => {
  const model = await paint(realSummary({ looks: { presets: '1' }, counts: new Error('synthetic count failure'), newest: NEWEST }), realResponses({ rows: [MIMIC] }));
  assert.equal(model.title, 'The pumpkin’s saved lines');
  assert.deepEqual(['lines', 'pinned'].map((id) => [stat(model, id).value, stat(model, id).hint]), [['—', 'Could not check'], ['—', 'Could not check']]);
  assert.deepEqual([stat(model, 'looks').value, stat(model, 'latest').value], [1, 'W(' + T1 + ')']);
  assert.equal(section(model, 'lines').items.length, 1);
  assert.match(section(model, 'lines').note, /^Some saved pumpkin data could not be checked\. A saved line/);
});

test('signed out, refused, every source failed, a non-JSON failure and an unreachable server each read as what they are', async () => {
  const signedOut = await paint(realSummary({ signedIn: false }), realResponses({ signedIn: false }));
  assert.deepEqual([signedOut.title, signedOut.stats, signedOut.sections], ['Sign in to see the pumpkin’s saved lines', undefined, undefined]);
  assert.equal((await realResponses({ signedIn: false })).http, 401, 'the real playlist route refuses a signed-out caller');
  const denied = await paint({ http: 403, body: {} }, realResponses({ rows: [MIMIC] }));
  assert.deepEqual([denied.title, denied.lede], ['This account cannot open Pumpkin', 'The Pumpkin routes refused this account (HTTP 403).']);
  const mixed = await paint({ http: 403, body: {} }, { http: 401, body: {} });
  assert.equal(mixed.title, 'Sign in to see the pumpkin’s saved lines', 'signed out is named before refused');
  const down = await realSummary({ looks: new Error('synthetic'), counts: new Error('synthetic'), newest: new Error('synthetic') });
  assert.equal(down.http, 503, 'the real summary answers 503 when every source failed');
  const unknown = await paint(down, realResponses({ rows: new Error('synthetic') }));
  assert.equal(unknown.title, 'Some saved work could not be checked', 'an empty list with no count is never called nothing saved');
  assert.ok(['lines', 'pinned', 'looks'].every((id) => stat(unknown, id).hint === 'Could not check'));
  assert.equal(section(unknown, 'lines').empty, 'None to show: some saved work could not be checked.');
  await assert.rejects(paint({ http: 500, body: undefined }, { http: 502, body: undefined }), /^Error: Pumpkin could not read the saved lines \(HTTP 500\)\.$/);
  await assert.rejects(loadFamily(new TypeError('Failed to fetch')).family({ refresh() {} }), /^Error: Pumpkin could not be reached just now\.$/);
});

/** @returns {object} A stub element with the members the page's module script touches on start; it counts bound listeners. */
function node(bound) { return { value: '', textContent: '', className: '', append() {}, replaceChildren() {}, addEventListener() { bound.count++; } }; }

/**
 * @description Run the page's module script (imports stripped) against stub modules, a stub DOM and a stub fetch. The
 * script awaits at top level, so it runs as an async function body.
 * @param {string|null} activeView What AppView.active() answers, or null for the full page.
 * @returns {Promise<{ handoffs: number, mounted: number, listeners: number, reads: string[] }>} Handoff listeners bound,
 *   connected-actions mounts, DOM listeners bound (the Refresh button) and every request made.
 */
async function runModule(activeView) {
  const open = html.indexOf('<script type="module">'), src = html.slice(open + 22, html.indexOf('</script>', open)).replace(/^import .*$/gm, '');
  const calls = { handoffs: 0, mounted: 0, listeners: 0, reads: [] }, bound = { count: 0 };
  const AsyncFunction = (async () => {}).constructor;
  const fetchStub = (url, opt) => { calls.reads.push(((opt && opt.method) || 'GET') + ' ' + url); return Promise.resolve({ ok: true, json: () => Promise.resolve({ metrics: [], items: [] }) }); };
  await new AsyncFunction('window', 'AppView', 'document', 'fetch', 'receiveHandoff', 'mountConnectedActions', src)(
    { AppView: { active: () => activeView } }, { active: () => activeView }, { querySelector: () => node(bound), createElement: () => node(bound) }, fetchStub,
    () => { calls.handoffs++; }, () => { calls.mounted++; return Promise.resolve(); });
  calls.listeners = bound.count;
  return calls;
}

test('under the family view the page\x27s module script mounts nothing, binds nothing and reads nothing; the full page still runs every start step', async () => {
  assert.deepEqual(await runModule('family'), { handoffs: 0, mounted: 0, listeners: 0, reads: [] });
  assert.deepEqual(await runModule(null), { handoffs: 0, mounted: 1, listeners: 1, reads: ['GET ' + H] });
});
