/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The audience view contract of this package's page (ADR-164 D6): the shared kit is loaded right after the theme bootstrap, the page boots the kit with exactly the audiences it provides and its own application name, the full-page start is gated on the kit's decision, the head block parses, and every read in it stays on this package's own routes (plus the framework connect list where the page already reads it). Static, no browser, no network.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The Animatronics family view asserted as behaviour over the package's REAL routes: GET /rigs answered by the rig router createAnimatronicsRoutes composes (routes/animatronics-routes.js and routes/rig-routes.js loaded with only express and the two framework aliases stubbed, a stub pool, the real servo catalog and templates), rigs built from the real templates and their saved rehearsal reports from the real rehearsalFor, answers JSON round-tripped as Express sends them. On open the view makes exactly that one read and the route only SELECTs the caller's rigs; the props paint as plain stats (props, shows, poses, armed), a title ladder led by an armed prop, tiles naming each prop's template, servos, poses and shows that open nothing, the shows in plain words, and the last practice run (passed with its length, or not passed with the rehearsal's first reason). More than twelve props, more than thirty shows, no props, signed out (the router's own 401, no query), refused (403), the route's own 500, an unreadable answer and an unreachable server each read as what they are. The full page's main script starts nothing under the view (no read, no listener, no poll) and starts as before without it or without the kit; the helper scripts only define their globals.
 * -----------------------------------------------------------------------------
 * @module audience-view.test
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const APP = 'animatronics';
const PAGE = 'tools/animatronics.html';
const AUDIENCES = ["family", "company"];
const ALLOWED_PREFIXES = ["/api/animatronics"];
const GATE_FILE = 'tools/animatronics.js';

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

// ── Behaviour over the package's real routes ────────────────────────────────────────────────────────────────────────
const RIGS = '/api/animatronics/rigs', FULL = '/cockpit/?app=animatronics';
const SUB = 'synthetic-sub';
const E = require(path.join(ROOT, 'routes', 'engine', 'index.js'));
const CATALOG = E.servoMap(E.loadServoCatalog(path.join(ROOT, 'catalog', 'servos.json')).servos);
const TEMPLATES = E.buildTemplates(CATALOG);

/** The two framework modules the compiled routes import through @/ aliases, stubbed to what route registration touches. */
const STUBS = {
  '@/shared/logger': { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) },
  '@/shared/security/explicit-write-confirmation': { hasExplicitWriteConfirmation: () => false, confirmationRequiredPayload: () => ({ error: 'confirmation_required' }) },
};

/** @returns {object} A recording stand-in for an express Router: every registration is kept in order. */
function recorder() {
  const r = { routes: [] };
  ['get', 'post', 'put', 'patch', 'delete', 'use', 'param'].forEach((method) => { r[method] = (...args) => { r.routes.push({ method, args }); return r; }; });
  return r;
}

const loaded = {};
/**
 * @description Load one of the package's compiled route modules: express is the recorder, the framework aliases come from
 * STUBS, the pure engine modules are the real ones, sibling route modules load the same way, and anything else fails the
 * test (so a new import is noticed, not guessed).
 * @param {string} file The module path under the package root.
 * @returns {object} The module's exports.
 */
function loadModule(file) {
  if (loaded[file]) return loaded[file];
  const dir = path.dirname(path.join(ROOT, file));
  const load = (name) => {
    if (name === 'express') return { Router: recorder };
    if (name.startsWith('node:')) return require(name);
    if (Object.prototype.hasOwnProperty.call(STUBS, name)) return STUBS[name];
    assert.ok(name.startsWith('./'), 'unexpected import in ' + file + ': ' + name);
    const target = path.relative(ROOT, path.resolve(dir, name)).split(path.sep).join('/') + '.js';
    return target.startsWith('routes/engine/') ? require(path.join(ROOT, target)) : loadModule(target);
  };
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', '__dirname', '__filename', fs.readFileSync(path.join(ROOT, file), 'utf8'))(load, mod, mod.exports, dir, path.join(ROOT, file));
  return (loaded[file] = mod.exports);
}

/**
 * @description A stub pg pool: records every query and answers it with `rows` (an Error rejects the query).
 * @param {object[]|Error} rows What every query answers.
 * @returns {{ query: Function, calls: Array<{text: string, values: any[]}> }} The pool and its recorded queries.
 */
function stubPool(rows) {
  const calls = [];
  const query = (q, values) => {
    calls.push({ text: typeof q === 'string' ? q : q.text, values: typeof q === 'string' ? values : q.values });
    return rows instanceof Error ? Promise.reject(rows) : Promise.resolve({ rows });
  };
  return { query, calls };
}

/** @returns {object} A stub Express response that records the status and the JSON body. */
function response() {
  return { statusCode: 200, body: undefined, setHeader() {}, status(s) { this.statusCode = s; return this; }, json(b) { this.body = b; } };
}

/**
 * @description Answer GET /rigs with the router the package REALLY composes: createAnimatronicsRoutes mounts the rig router,
 * whose own middleware resolves the caller before the handler lists the rigs.
 * @param {{rows?: object[]|Error, signedIn?: boolean}} [db] What the rig SELECT answers, and whether the caller is signed in.
 * @returns {Promise<{http: number, body: object, calls: object[]}>} The route's HTTP status, JSON body and queries.
 */
async function realRigs({ rows = [], signedIn = true } = {}) {
  const pool = stubPool(rows);
  const top = loadModule('routes/animatronics-routes.js').createAnimatronicsRoutes({ pool, appPackageDir: ROOT });
  const rig = top.routes.filter((r) => r.method === 'use').map((r) => r.args[r.args.length - 1]).find((x) => x && Array.isArray(x.routes) && x.routes.some((e) => e.method === 'get' && e.args[0] === '/rigs'));
  assert.ok(rig, 'the rig router is composed under /api/animatronics');
  const req = { oidc: signedIn ? { user: { sub: SUB }, isAuthenticated: () => true } : { isAuthenticated: () => false }, params: {}, query: {}, body: undefined, path: '/rigs' };
  const res = response();
  for (const entry of rig.routes) {
    if (entry.method === 'use' && typeof entry.args[0] === 'function') {
      let passed = false;
      await entry.args[0](req, res, () => { passed = true; });
      if (!passed) break;
    } else if (entry.method === 'get' && entry.args[0] === '/rigs') { await entry.args[entry.args.length - 1](req, res); break; }
  }
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

/** @returns {Promise<{model: object, urls: string[], opened: string[]}>} The family model painted from one answer of GET /rigs. */
async function paint(answer) {
  const view = loadFamily({ [RIGS]: answer instanceof Error ? answer : await answer });
  const model = await view.family({ refresh() {} });
  return { model, urls: view.urls, opened: view.opened };
}

const T1 = '2026-09-28T10:00:00.000Z', T2 = '2026-09-27T09:00:00.000Z', T3 = '2026-09-20T08:00:00.000Z';
const template = (id) => TEMPLATES.find((t) => t.id === id);
/** @returns {object} An animatronic_rig row as the store selects it, built from a real template. */
function rigRow(n, templateId, title, extra) {
  const t = template(templateId);
  return Object.assign({ rig_id: '00000000-0000-4000-8000-00000000000' + (n % 10), owner_sub: SUB, title, rig: t.rig, poses: t.poses, scenarios: t.scenarios, armed: false, armed_at: null,
    current_pose: E.neutralPose(t.rig), run_count: 0, last_report: null, source: { kind: 'template', template: t.id }, created_at: new Date(T3), updated_at: new Date(T3) }, extra);
}
const { rehearsalFor } = loadModule('routes/rig-routes.js');
/** @returns {object} The rehearsal report the routes save with a rig (rehearsalFor, as POST /rehearse and play store it). */
const reportFor = (row, steps) => rehearsalFor(row, CATALOG, steps, row.current_pose).report;
const SKULL = rigRow(1, 'skull', 'Synthetic Porch Skull', { updated_at: new Date(T1), run_count: 4 });
const EYES = rigRow(2, 'two-axis-eyes', 'Synthetic Window Eyes', { updated_at: new Date(T2) });
const PASSED = reportFor(SKULL, [{ kind: 'run', scenario: 'BLINK' }]);
const LAGGED = reportFor(EYES, E.validateScenario({ steps: [{ kind: 'move', axes: { 'eyes.pan': 30 }, ms: 20, ease: 'linear' }, { kind: 'hold', ms: 200 }] }, EYES.rig, { poses: EYES.poses, scenarios: EYES.scenarios }, 'steps').steps);
const count = (rows, key) => rows.reduce((n, r) => n + Object.keys(r[key]).length, 0);
const section = (model, id) => model.sections.find((x) => x && x.id === id);
const stat = (model, id) => model.stats.find((x) => x.id === id);

test('on open the family view makes exactly one read, GET /rigs, and the route only SELECTs the caller\x27s rigs', async () => {
  const answer = await realRigs({ rows: [SKULL, EYES] });
  assert.equal(answer.http, 200);
  assert.equal(answer.calls.length, 1, 'one query');
  assert.match(answer.calls[0].text, /^SELECT [\s\S]+ FROM animatronic_rig WHERE owner_sub = \$1 ORDER BY updated_at DESC/);
  assert.deepEqual(answer.calls[0].values, [SUB]);
  const { urls } = await paint(answer);
  assert.deepEqual(urls, ['GET ' + RIGS], 'never capabilities, the catalog, templates, a rig, its runs or manifest, the home summary, or any write');
});

test('saved props paint as plain stats, a title ladder and tiles that name the template, servos, poses and shows and open nothing', async () => {
  const { model } = await paint(realRigs({ rows: [SKULL, EYES] }));
  assert.equal(model.kicker, 'Our props');
  assert.equal(model.title, '2 props in the workshop');
  assert.equal(model.lede, 'Newest change: Synthetic Porch Skull, W(' + T1 + '). Nothing moves from here: a person arms and plays a prop in Animatronics, with its controller connected.');
  assert.deepEqual(model.stats.map((s) => [s.id, s.value, s.tone || null]), [['props', 2, null], ['shows', count([SKULL, EYES], 'scenarios'), null], ['poses', count([SKULL, EYES], 'poses'), null], ['armed', 0, null]]);
  assert.equal(stat(model, 'armed').hint, 'All disarmed');
  const tiles = section(model, 'props').items;
  assert.deepEqual(tiles.map((t) => [t.icon, t.title, t.text, t.meta, t.badge]), [
    ['💀', 'Synthetic Porch Skull', '7 servos · ' + Object.keys(SKULL.poses).length + ' poses · 8 shows', 'changed W(' + T1 + ')', null],
    ['👀', 'Synthetic Window Eyes', '2 servos · ' + Object.keys(EYES.poses).length + ' poses · 3 shows', 'changed W(' + T2 + ')', null],
  ]);
  for (const t of tiles) assert.ok(!t.href && !t.onClick && !t.target, 'a tile opens, arms or plays nothing');
  assert.equal(section(model, 'props').note, null);
  const custom = await paint(realRigs({ rows: [rigRow(3, 'skull', '', { source: {} })] }));
  assert.deepEqual([section(custom.model, 'props').items[0].icon, section(custom.model, 'props').items[0].title], ['🎭', 'Untitled prop'], 'a rig made from numbers gets the mask');
});

test('an armed prop leads the title, is badged and explained, and the one action only opens Animatronics', async () => {
  const { model, opened } = await paint(realRigs({ rows: [Object.assign({}, SKULL, { armed: true, armed_at: new Date(T1) }), EYES] }));
  assert.equal(model.title, '1 prop is armed');
  assert.deepEqual([stat(model, 'armed').value, stat(model, 'armed').tone, stat(model, 'armed').hint], [1, 'warn', 'Moves only from the full page']);
  assert.deepEqual([section(model, 'props').items[0].badge, section(model, 'props').items[0].tone], ['Armed', 'warn']);
  assert.match(section(model, 'props').note, /^Armed is the saved state: a person armed the prop in Animatronics/);
  assert.deepEqual(model.actions.map((a) => a.label), ['Open Animatronics']);
  model.actions[0].onClick();
  assert.deepEqual(opened, [FULL]);
  const both = await paint(realRigs({ rows: [Object.assign({}, SKULL, { armed: true }), Object.assign({}, EYES, { armed: true })] }));
  assert.equal(both.model.title, '2 props are armed');
});

test('the shows list every saved scenario in plain words with its description and its prop, capped at thirty', async () => {
  const { model } = await paint(realRigs({ rows: [SKULL, EYES] }));
  const items = section(model, 'shows').items.map((i) => [i.title, i.text, i.meta]);
  assert.equal(items.length, count([SKULL, EYES], 'scenarios'));
  assert.deepEqual(items.find((i) => i[0] === 'Glance left' && i[2] === 'Synthetic Window Eyes'), ['Glance left', 'A quick look to the left and back', 'Synthetic Window Eyes']);
  assert.ok(items.some((i) => i[0] === 'Idle 01' && i[2] === 'Synthetic Porch Skull'), 'IDLE_01 reads Idle 01');
  assert.ok(items.some((i) => i[0] === 'Talk' && /^Jaw chatter/.test(i[1])), 'TALK reads Talk with its description');
  assert.equal(section(model, 'shows').note, null);
  const many = await paint(realRigs({ rows: [1, 2, 3, 4].map((n) => rigRow(n, 'skull', 'Synthetic Skull ' + n)) }));
  assert.equal(section(many.model, 'shows').items.length, 30);
  assert.equal(section(many.model, 'shows').note, 'The first 30 of 32 shows.');
});

test('the last practice run is the saved rehearsal: passed with its length, or not passed with the rehearsal\x27s first reason', async () => {
  assert.equal(PASSED.verdict.ok, true, 'BLINK on the skull rehearses ok');
  assert.equal(LAGGED.verdict.ok, false, 'a 30 degree step in one frame lags the eye servo');
  const { model } = await paint(realRigs({ rows: [Object.assign({}, SKULL, { last_report: PASSED }), Object.assign({}, EYES, { last_report: LAGGED }), rigRow(3, 'skull', 'Synthetic Bare Skull')] }));
  const checks = section(model, 'checks');
  assert.deepEqual(checks.items.map((i) => [i.icon, i.title, i.text, i.badge, i.tone]), [
    ['✅', 'Synthetic Porch Skull', 'Passed · ' + (PASSED.durationMs / 1000).toFixed(1) + ' s', 'Passed', 'ok'],
    ['⚠️', 'Synthetic Window Eyes', 'Did not pass: ' + LAGGED.verdict.reasons[0], 'Needs a fix', 'warn'],
  ], 'a prop with no saved rehearsal is left out');
  assert.match(checks.note, /Nothing on this page moves a prop\.$/);
  const none = await paint(realRigs({ rows: [SKULL, EYES] }));
  assert.equal(section(none.model, 'checks'), undefined, 'no saved rehearsal, no section');
});

test('more than twelve props show the twelve most recently changed as tiles and say how many there are', async () => {
  const rows = Array.from({ length: 13 }, (_, i) => rigRow(i, 'two-axis-eyes', 'Synthetic Eyes ' + i));
  const { model } = await paint(realRigs({ rows }));
  assert.equal(section(model, 'props').items.length, 12);
  assert.equal(section(model, 'props').note, 'The 12 most recently changed of 13 props.');
  assert.equal(stat(model, 'props').value, 13);
});

test('no props yet reads as an empty workshop, not a failure', async () => {
  const { model } = await paint(realRigs({ rows: [] }));
  assert.equal(model.title, 'No props yet');
  assert.match(model.lede, /Props built there show up here\.$/);
  assert.deepEqual(model.stats.map((s) => s.value), [0, 0, 0, 0]);
  assert.deepEqual([section(model, 'props').items, section(model, 'props').empty], [[], 'No props saved yet.']);
  assert.deepEqual([section(model, 'shows').items, section(model, 'shows').empty], [[], 'No props yet.']);
  assert.equal(section(model, 'checks'), undefined);
});

test('signed out is the router\x27s own 401 and refused is 403; the route\x27s 500, an unreadable answer and an unreachable server fail by name', async () => {
  const out = await realRigs({ rows: [SKULL], signedIn: false });
  assert.deepEqual([out.http, out.calls.length], [401, 0], 'no query for a signed-out caller');
  assert.equal((await paint(out)).model.title, 'Sign in to see the props');
  const denied = (await paint({ http: 403, body: { error: 'forbidden' } })).model;
  assert.deepEqual([denied.title, denied.lede], ['This account cannot open Animatronics', 'The Animatronics routes refused this account (HTTP 403).']);
  const broken = await realRigs({ rows: new Error('relation "animatronic_rig" does not exist') });
  assert.equal(broken.http, 500);
  await assert.rejects(paint(broken), /^Error: Animatronics could not read the saved props \(HTTP 500\)\.$/);
  await assert.rejects(paint({ http: 200, body: undefined }), /^Error: Animatronics sent an answer this view could not read\.$/);
  await assert.rejects(paint({ http: 200, body: { rigs: 'none' } }), /^Error: Animatronics sent an answer this view could not read\.$/);
  await assert.rejects(paint(new TypeError('Failed to fetch')), /^Error: Animatronics could not be reached just now\.$/);
});

/**
 * @description Run the full page's main script against a stub window, document and fetch.
 * @param {object|undefined} kit What window.AppView is (undefined = a core without the kit).
 * @returns {{ fetched: string[], listeners: number, lookups: number, timers: number }} What the script started.
 */
function runMain(kit) {
  const seen = { fetched: [], listeners: 0, lookups: 0, timers: 0 };
  const win = { AppView: kit, addEventListener: () => { seen.listeners++; } };
  const documentStub = { getElementById: () => { seen.lookups++; return { addEventListener: () => { seen.listeners++; } }; } };
  const src = fs.readFileSync(path.join(ROOT, GATE_FILE), 'utf8');
  new Function('window', 'AppView', 'document', 'fetch', 'setInterval', 'setTimeout', 'navigator', src)(
    win, kit, documentStub, (url) => { seen.fetched.push(url); return new Promise(() => {}); }, () => { seen.timers++; }, () => { seen.timers++; }, {});
  return seen;
}

test('under the family view the full page\x27s main script reads, binds and polls nothing; without it the page starts as before', () => {
  assert.deepEqual(runMain({ active: () => 'family' }), { fetched: [], listeners: 0, lookups: 0, timers: 0 });
  assert.deepEqual(runMain({ active: () => null }).fetched, ['/api/animatronics/capabilities'], 'no audience: the full page starts');
  assert.deepEqual(runMain(undefined).fetched, ['/api/animatronics/capabilities'], 'no kit: the full page starts');
  const js = fs.readFileSync(path.join(ROOT, GATE_FILE), 'utf8');
  assert.match(js, /\n  if \(!window\.AppView \|\| !AppView\.active\(\)\) main\(\);\n\}\)\(\);\s*$/, 'the one call of main() is the gated one');
  assert.doesNotMatch(js, /\(async function main\(/, 'no self-invoking main is left');
});

test('the helper scripts the page loads only define their globals: no read, no listener, no port request', () => {
  for (const [file, name] of [['tools/animatronics-serial.js', 'AnimatronicsSerial'], ['tools/animatronics-view.js', 'AnimatronicsView']]) {
    const self = {};
    const fetched = [];
    new Function('self', 'fetch', 'navigator', fs.readFileSync(path.join(ROOT, file), 'utf8'))(self, (u) => { fetched.push(u); }, { serial: { requestPort: () => { throw new Error('port requested on load'); } } });
    assert.deepEqual(Object.keys(self), [name], file + ' defines only ' + name);
    assert.deepEqual(fetched, [], file + ' reads nothing on load');
  }
});
