/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The audience view contract of this package's page (ADR-164 D6): the shared kit is loaded right after the theme bootstrap, the page boots the kit with exactly the audiences it provides and its own application name, the full-page start is gated on the kit's decision, the head block parses, and every read in it stays on this package's own routes (plus the framework connect list where the page already reads it). Static, no browser, no network.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The Embodied Swarm family view asserted as behaviour over the package's REAL routes: GET /tasks from the compiled mount (routes/embodied-routes.js with its sibling modules and the real compiled engine, only express and the three framework aliases stubbed, a stub pool) and GET /home-summary from routes/home-summary.js, their answers JSON round-tripped as Express serializes them. On open the view makes exactly those two reads and both routes only SELECT the caller's own rows: never the world reads that create or advance the owner's simulation, never the physics engine, the designs, the scenes or the command log. The saved jobs paint as plain stats (planned, finished, stopped or called off, commands refused in seven days, a count with no cause attached), a title naming the newest job's state, and tiles saying what each job was, how far it got (a step only from an ended run), whether its dry run passed and when; no tile opens, runs or stops anything. A count the summary could not check, more than six jobs, odd rows, signed out (the route's own 401), refused (403), the route's own 500, an unreadable answer and an unreachable server each read as what they are. The surface script's one start statement carries the gate: under the view it binds, reads and starts nothing; without it, or without the kit, the full page makes its start reads and starts its four polls, and removing the gate turns the test red.
 * -----------------------------------------------------------------------------
 * @module audience-view.test
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const APP = 'embodied';
const PAGE = 'tools/embodied.html';
const AUDIENCES = ["family", "company"];
const ALLOWED_PREFIXES = ["/api/embodied"];
const GATE_FILE = 'tools/embodied.js';

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

const TASKS = '/api/embodied/tasks', SUMMARY = '/api/embodied/home-summary', FULL = '/cockpit/?app=embodied';
const ROUTES = path.join(ROOT, 'routes');
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

/** The framework modules the compiled routes import through @/ aliases, stubbed to what mounting and GET /tasks touch. */
const EMBODIED_STUBS = {
  '@/shared/logger': { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) },
  '@/shared/security/explicit-write-confirmation': { hasExplicitWriteConfirmation: () => false, confirmationRequiredPayload: () => ({ error: 'confirmation_required' }) },
  '@/shared/artifact-exchange': { redeemArtifactViaRelay: () => Promise.resolve({ ok: false, status: 503, error: 'synthetic relay' }) },
};
/** The package's own route modules the mount imports; each loads through the same checked loader. */
const SIBLINGS = ['./embodied-arm-routes', './surface-files', './task-store'];

/**
 * @description Load one of the package's compiled route modules with a recording express Router: node built-ins and the
 * compiled engine (routes/engine, pure) are real, a sibling route module loads the same way, the framework aliases come
 * from EMBODIED_STUBS, and any other import fails the test (so a new dependency is noticed, not guessed).
 * @param {string} file The module file under routes/.
 * @param {Array} [routes] The list every registered route is recorded into (shared with sibling modules).
 * @returns {{ exports: object, routes: Array<{method: string, path: string, handler: Function}> }} The module and every route it registers.
 */
function loadRoutes(file, routes = []) {
  const router = {};
  ['get', 'post', 'put', 'patch', 'delete', 'use'].forEach((method) => { router[method] = (p, ...fns) => { routes.push({ method, path: p, handler: fns[fns.length - 1] }); }; });
  const load = (name) => {
    if (name === 'express') return { Router: () => router };
    if (name.startsWith('node:')) return require(name);
    if (Object.prototype.hasOwnProperty.call(EMBODIED_STUBS, name)) return EMBODIED_STUBS[name];
    if (name === './engine' || name.startsWith('./engine/')) return require(path.join(ROUTES, name));
    if (SIBLINGS.includes(name)) return loadRoutes(name.slice(2) + '.js', routes).exports;
    throw new assert.AssertionError({ message: 'unexpected import in ' + file + ': ' + name });
  };
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', '__dirname', fs.readFileSync(path.join(ROUTES, file), 'utf8'))(load, mod, mod.exports, ROUTES);
  return { exports: mod.exports, routes };
}

/** @returns {{method: string, path: string, handler: Function}} The one route registered for a method and path. */
function route(routes, method, p) {
  const found = routes.filter((r) => r.method === method && r.path === p);
  assert.equal(found.length, 1, method.toUpperCase() + ' ' + p + ' is registered once');
  return found[0];
}

/**
 * @description Answer GET /tasks with the package's REAL mount (createEmbodiedRoutes in routes/embodied-routes.js) over a stub pool.
 * @param {{rows?: object[]|Error, signedIn?: boolean}} [db] What the tasks SELECT answers, and whether the caller is signed in.
 * @returns {Promise<{http: number, body: object, calls: object[], routes: object[]}>} Status, JSON body, the queries, every route.
 */
async function realTasks({ rows = [], signedIn = true } = {}) {
  const { exports, routes } = loadRoutes('embodied-routes.js');
  const pool = stubPool(() => rows);
  exports.createEmbodiedRoutes({ pool, appPackageDir: ROOT }, { noTimer: true });
  const mounted = pool.calls.length;
  const res = response();
  await route(routes, 'get', '/tasks').handler({ oidc: oidc(signedIn), params: {}, query: {}, body: undefined, path: '/tasks' }, res);
  return { http: res.statusCode, body: res.body, calls: pool.calls.slice(mounted), routes };
}

/**
 * @description Answer GET /home-summary with the package's REAL route (routes/home-summary.js) over a stub pool.
 * @param {{counts?: object|Error, refused?: object|Error, rows?: object[]|Error, signedIn?: boolean}} [db] What the task
 *   counts, the refused-command count and the newest-tasks query answer, and whether the caller is signed in.
 * @returns {Promise<{http: number, body: object, calls: object[]}>} The route's HTTP status, JSON body and queries.
 */
async function realSummary({ counts = { total: '0', done: '0', stopped: '0', executing: '0' }, refused = { refused: '0' }, rows = [], signedIn = true } = {}) {
  const { exports, routes } = loadRoutes('home-summary.js');
  const pool = stubPool((text) => (/embodied_command_log/.test(text) ? refused : /count\(\*\)/.test(text) ? counts : rows));
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

/** @returns {Promise<object>} The family model painted from the two real routes' answers (promises of them are awaited). */
async function paint(tasks, summary) {
  const answers = { [TASKS]: tasks instanceof Error ? tasks : await tasks, [SUMMARY]: summary instanceof Error ? summary : await summary };
  return loadFamily(answers).family({ refresh() {} });
}

const T1 = '2026-09-28T10:00:00.000Z', T2 = '2026-09-27T09:00:00.000Z', T3 = '2026-09-26T08:00:00.000Z', T4 = '2026-09-24T07:00:00.000Z';
const at = (iso) => new Date(iso);
/**
 * @description An embodied_task row as GET /tasks selects it: the plan and its rehearsal are jsonb, the times TIMESTAMPTZ.
 * @param {string} id task_id. @param {string} task The planner task. @param {string} title The plan title. @param {string} status The row status.
 * @param {{steps?: number, step?: number, failure?: string|null, rehearsal?: object|null, created?: string, updated?: string}} [o] The rest.
 * @returns {object} The row.
 */
function job(id, task, title, status, { steps = 4, step = 0, failure = null, rehearsal = { ok: true, issues: [] }, created = T1, updated } = {}) {
  const plan = { task, title, steps: Array.from({ length: steps }, (_, i) => ({ kind: 'scan', label: 'Synthetic step ' + (i + 1) })), summary: [] };
  return { task_id: id, owner_sub: SUB, task, title, plan, rehearsal: rehearsal && Object.assign({ durationS: 12, stepsCompleted: steps, stepsTotal: steps, finalLocations: {} }, rehearsal), status, current_step: step, failure, created_at: at(created), updated_at: at(updated || created) };
}
const CLEAR = job('t1', 'clear-surface', 'Clear Synthetic Counter onto Synthetic Rack', 'failed', { steps: 12, step: 4, failure: 'refused: tip budget exceeded at the counter edge', created: T1 });
const EXPLORE = job('t2', 'explore', 'Explore the room — drone first', 'done', { steps: 14, step: 13, created: T2 });
const FETCH = job('t3', 'fetch-from-appliance', 'Fetch milk-1 from the fridge to the island', 'draft', { steps: 9, rehearsal: { ok: false, issues: ['the base cannot reach the handle from any mapped standoff'] }, created: T3 });
const SHELF = job('t4', 'clear-surface', 'Clear Synthetic Shelf onto Synthetic Bench', 'aborted', { steps: 10, step: 2, failure: 'e-stop', created: T4 });
const COUNTS = { total: '9', done: '4', stopped: '3', executing: '0' };
const section = (model, id) => model.sections.find((x) => x && x.id === id);
const stat = (model, id) => model.stats.find((x) => x.id === id);
const tiles = (model, id) => section(model, id || 'jobs').items.map((t) => [t.title, t.text, t.meta, t.badge, t.tone]);

test('on open the view makes two reads, GET /tasks and GET /home-summary, and both real routes only SELECT the caller\x27s own rows', async () => {
  const tasks = await realTasks({ rows: [EXPLORE] });
  assert.deepEqual(tasks.calls.map((c) => [/^\s*SELECT\b/.test(c.text), /FROM embodied_task WHERE owner_sub = \$1/.test(c.text), c.values]), [[true, true, [SUB, 20]]]);
  const summary = await realSummary({ counts: COUNTS, rows: [EXPLORE] });
  assert.equal(summary.calls.length, 3);
  assert.ok(summary.calls.every((c) => /^\s*SELECT\b/.test(c.text) && c.values[0] === SUB), 'home-summary only SELECTs, scoped to the caller');
  const view = loadFamily({ [TASKS]: tasks, [SUMMARY]: summary });
  await view.family({ refresh() {} });
  assert.deepEqual([...view.urls].sort(), ['GET ' + SUMMARY, 'GET ' + TASKS]);
  const simulated = tasks.routes.filter((r) => r.method === 'get' && /^\/(state|world|world\/voxels|picture|camera|capabilities|physics\/status|physics\/reports|log)$/.test(r.path)).map((r) => r.path).sort();
  assert.deepEqual(simulated, ['/camera', '/capabilities', '/log', '/physics/reports', '/physics/status', '/picture', '/state', '/world', '/world/voxels'], 'the mount serves the world, engine and log reads the full page makes');
  for (const p of simulated) assert.ok(!view.urls.includes('GET /api/embodied' + p), 'the view never reads ' + p);
});

test('the real routes\x27 answers paint plain stats, the newest job\x27s state and the latest jobs with how far each got', async () => {
  const view = loadFamily({ [TASKS]: await realTasks({ rows: [CLEAR, EXPLORE, FETCH, SHELF] }), [SUMMARY]: await realSummary({ counts: COUNTS, refused: { refused: '2' } }) });
  const model = await view.family({ refresh() {} });
  assert.deepEqual([model.kicker, model.title], ['Robot practice', 'The last robot job stopped early']);
  assert.equal(model.lede, 'Latest: Clear Synthetic Counter onto Synthetic Rack, ended W(' + T1 + '). Everything here happened in a simulated room; no real robot moved.');
  assert.deepEqual(model.stats.map((x) => [x.id, x.label, x.value, x.tone || null, x.hint || null]), [
    ['jobs', 'Robot jobs planned', 9, null, null],
    ['done', 'Finished', 4, null, 'In the simulation'],
    ['stopped', 'Stopped or called off', 3, 'warn', null],
    ['refused', 'Commands refused, last 7 days', 2, null, null],
  ]);
  assert.deepEqual(tiles(model), [
    ['Clear Synthetic Counter onto Synthetic Rack', 'Clear a surface · Stopped at step 5 of 12: refused: tip budget exceeded at the counter edge', 'ended W(' + T1 + ')', 'Stopped', 'warn'],
    ['Explore the room — drone first', 'Map the room · Finished all 14 steps', 'ended W(' + T2 + ')', 'Finished', 'ok'],
    ['Fetch milk-1 from the fridge to the island', 'Fetch from the fridge · Planned; the dry run found a problem: the base cannot reach the handle from any mapped standoff', 'planned W(' + T3 + ')', 'Planned', null],
    ['Clear Synthetic Shelf onto Synthetic Bench', 'Clear a surface · Called off at step 3 of 10: e-stop', 'ended W(' + T4 + ')', 'Called off', 'warn'],
  ]);
  assert.deepEqual(section(model, 'jobs').items.map((t) => t.icon), ['🧽', '🧭', '🥛', '🧽']);
  assert.ok(section(model, 'jobs').items.every((t) => !t.href && !t.onClick && !t.target), 'a job tile opens, runs and stops nothing');
  assert.match(section(model, 'jobs').note, /never on a real arm or drone\. Nothing on this page plans, runs or stops a job\.$/);
  assert.deepEqual(model.sections.filter(Boolean).map((s) => s.id), ['jobs']);
  assert.deepEqual(model.actions.map((a) => a.label), ['Open Embodied Swarm']);
  model.actions[0].onClick();
  assert.deepEqual(view.opened, [FULL], 'the one action is the way to the full application');
});

test('the title names the newest job\x27s state: finished, stopped early, called off, started with no end saved, planned, saved, none yet', async () => {
  const title = async (rows) => (await paint(realTasks({ rows }), realSummary())).title;
  assert.equal(await title([EXPLORE, CLEAR]), 'The last robot job finished');
  assert.equal(await title([SHELF]), 'The last robot job was called off');
  assert.equal(await title([job('t5', 'explore', 'Explore the room', 'executing', { created: T1 })]), 'The last robot job started, with no end saved yet');
  assert.equal(await title([FETCH, EXPLORE]), 'The last robot job is planned, not run yet');
  assert.equal(await title([job('t6', 'explore', 'Explore the room', 'paused'), EXPLORE]), '2 saved robot jobs');
  const none = await paint(realTasks({ rows: [] }), realSummary());
  assert.deepEqual([none.title, section(none, 'jobs').items, section(none, 'jobs').empty, stat(none, 'jobs').value], ['No robot jobs yet', [], 'No robot jobs yet.', 0]);
  assert.match(none.lede, /simulated drone and a rolling robot arm in a simulated room\. Jobs planned there show up here, and no real robot moves\.$/);
});

test('a planned job names its dry run, a started job claims no step, more than six jobs list the rest, odd rows read as what they are', async () => {
  const passed = job('p1', 'explore', 'Explore the room', 'draft', { steps: 12, created: T2 });
  const unrehearsed = job('p2', 'clear-surface', 'Clear surf-2 onto surf-5', 'draft', { rehearsal: null, created: T3 });
  const running = job('p3', 'explore', 'Explore the room', 'executing', { steps: 12, step: 0, created: T4, updated: T3 });
  const model = await paint(realTasks({ rows: [passed, unrehearsed, running] }), realSummary());
  assert.deepEqual(tiles(model), [
    ['Explore the room', 'Map the room · Planned; the dry run went through', 'planned W(' + T2 + ')', 'Planned', null],
    ['Clear surf-2 onto surf-5', 'Clear a surface · Planned; not run yet', 'planned W(' + T3 + ')', 'Planned', null],
    ['Explore the room', 'Map the room · Started; no end saved yet', 'started W(' + T3 + ')', 'Started', null],
  ]);
  const many = Array.from({ length: 21 }, (_, i) => job('m' + i, 'explore', 'Synthetic Job ' + i, 'done', { created: T4 }));
  const full = await paint(realTasks({ rows: many }), realSummary());
  assert.deepEqual([section(full, 'jobs').items.length, section(full, 'earlier').items.length, section(full, 'earlier').title, section(full, 'earlier').kind], [6, 14, 'Planned earlier', 'list']);
  const odd = { task_id: 'x1', owner_sub: SUB, task: 'dance', title: '', plan: null, rehearsal: null, status: 'paused', current_step: null, failure: null, created_at: at(T2), updated_at: at(T2) };
  const long = job('x2', 'clear-surface', 'Clear Synthetic Sink onto Synthetic Rack', 'failed', { steps: 3, step: 7, failure: 'refused: ' + 'x'.repeat(200), created: T3 });
  const oddModel = await paint(realTasks({ rows: [odd, long] }), realSummary());
  const [first, second] = section(oddModel, 'jobs').items;
  assert.deepEqual([first.icon, first.title, first.text, first.meta, first.badge, first.tone], ['🤖', 'Untitled job', 'Status: paused', 'planned W(' + T2 + ')', null, null]);
  assert.equal(second.text, 'Clear a surface · Stopped at step 3 of 3: refused: ' + 'x'.repeat(130) + '…', 'a step past the plan reads as its last step; a long reason is clipped');
});

test('a count the summary could not check reads as not checked, and the saved jobs still show', async () => {
  const partial = await paint(realTasks({ rows: [EXPLORE] }), realSummary({ counts: COUNTS, refused: new Error('synthetic command-log failure') }));
  assert.deepEqual(partial.stats.map((x) => [x.id, x.value, x.hint || null]), [['jobs', 9, null], ['done', 4, 'In the simulation'], ['stopped', 3, null], ['refused', '—', 'Could not check']]);
  assert.equal(stat(partial, 'refused').tone, null);
  const down = await realSummary({ counts: new Error('synthetic'), refused: new Error('synthetic'), rows: new Error('synthetic') });
  assert.equal(down.http, 503, 'the real route answers 503 when every source failed');
  const unchecked = await paint(realTasks({ rows: [EXPLORE, CLEAR] }), down);
  assert.ok(unchecked.stats.every((x) => x.value === '—' && x.hint === 'Could not check' && x.tone === null), 'all four counts read Could not check');
  assert.deepEqual([unchecked.title, section(unchecked, 'jobs').items.length], ['The last robot job finished', 2]);
  const signedOutSummary = await paint(realTasks({ rows: [EXPLORE] }), realSummary({ signedIn: false }));
  assert.deepEqual([stat(signedOutSummary, 'jobs').value, section(signedOutSummary, 'jobs').items.length], ['—', 1]);
  const unreachable = await paint(realTasks({ rows: [EXPLORE] }), new TypeError('Failed to fetch'));
  assert.deepEqual([stat(unreachable, 'done').value, unreachable.title], ['—', 'The last robot job finished']);
});

test('signed out, refused, the route\x27s own failure, an unreadable answer and an unreachable server each read as what they are', async () => {
  const signedOut = await paint(realTasks({ signedIn: false }), realSummary({ signedIn: false }));
  assert.deepEqual([signedOut.title, signedOut.stats, signedOut.sections], ['Sign in to see the robot jobs', undefined, undefined]);
  assert.match(signedOut.lede, /this session is not signed in/);
  const denied = await paint({ http: 403, body: { error: 'forbidden' } }, realSummary());
  assert.deepEqual([denied.title, denied.lede], ['This account cannot open Embodied Swarm', 'The Embodied Swarm routes refused this account (HTTP 403).']);
  const broken = await realTasks({ rows: new Error('synthetic relation missing') });
  assert.deepEqual([broken.http, broken.body], [500, { error: 'task_store_failed' }], 'the real route answers 500 when the tasks read fails');
  await assert.rejects(paint(broken, realSummary()), /^Error: Embodied Swarm could not read the saved robot jobs \(HTTP 500\)\.$/);
  await assert.rejects(paint({ http: 200, body: undefined }, realSummary()), /^Error: Embodied Swarm sent an answer this view could not read\.$/);
  await assert.rejects(paint({ http: 200, body: { error: 'synthetic' } }, realSummary()), /^Error: Embodied Swarm sent an answer this view could not read\.$/);
  await assert.rejects(paint(new TypeError('Failed to fetch'), realSummary()), /^Error: Embodied Swarm could not be reached just now\.$/);
});

const SCRIPT = fs.readFileSync(path.join(ROOT, GATE_FILE), 'utf8');
const GATE = 'if (!window.AppView || !AppView.active()) ';

/** @returns {object} A stub element that records the listeners bound on it. */
function element(log) { return { addEventListener(type) { log.push(type); }, querySelector() { return element(log); }, style: {}, dataset: {}, value: '', textContent: '', hidden: false, disabled: false }; }

/**
 * @description Run the surface script against a stub DOM, fetch and timers. The fetch never settles, so a full-page run
 * stops, deterministically and with no unhandled rejection, at each start read after every synchronous start step.
 * @param {string|null} activeView What AppView.active() answers, or null for the full page.
 * @param {{source?: string, kit?: boolean}} [opt] The script text (default the shipped one) and whether the kit is present.
 * @returns {{ listeners: string[], reads: string[], timers: number }} Listeners bound, requests made, timers started.
 */
function runSurface(activeView, { source = SCRIPT, kit = true } = {}) {
  const calls = { listeners: [], reads: [], timers: 0 };
  const appView = kit ? { active: () => activeView } : undefined;
  const doc = { getElementById: () => element(calls.listeners), querySelectorAll: () => [], createElement: () => element(calls.listeners), createElementNS: () => element(calls.listeners) };
  const timer = () => { calls.timers++; return 0; };
  const fetchStub = (url, opt) => { calls.reads.push(((opt && opt.method) || 'GET') + ' ' + url); return new Promise(() => {}); };
  new Function('window', 'AppView', 'document', 'fetch', 'setInterval', 'setTimeout', 'requestAnimationFrame', source)({ AppView: appView, confirm: () => false }, appView, doc, fetchStub, timer, timer, timer);
  return calls;
}

test('the surface script\x27s one start statement is gated: under the view it binds, reads and starts nothing; without it, or without the kit, the page starts', () => {
  const steps = SCRIPT.split('\n').filter((line) => /^[^\s}/*]/.test(line) && !/^function /.test(line));
  assert.deepEqual(steps, [GATE + 'embodiedSurface();'], 'the whole surface is one function and its one call carries the gate');
  assert.deepEqual(runSurface('family'), { listeners: [], reads: [], timers: 0 });
  const full = runSurface(null);
  assert.deepEqual(full.reads, ['GET /api/embodied/build/drone?fit=', 'GET /api/embodied/build/arm?fit=', 'GET /api/embodied/state', 'GET /api/embodied/world/voxels', 'GET /api/embodied/picture?sensor=drone',
    'GET /api/embodied/log?limit=60', 'GET /api/embodied/physics/status', 'GET /api/embodied/physics/reports', 'GET /api/embodied/capabilities', 'GET /api/embodied/physics/media']);
  assert.equal(full.timers, 4, 'the state, voxel, picture and log polls');
  assert.ok(full.listeners.length > 20, 'the full page binds its controls');
  assert.deepEqual(runSurface(null, { kit: false }), full, 'a core without the kit runs the full page');
  assert.deepEqual(runSurface('family', { source: SCRIPT.replace(GATE, '') }), full, 'without the gate the view would start the full page too: this test goes red');
  const noKit = [];
  new Function('window', 'fetch', block)({}, (url) => { noKit.push(url); return new Promise(() => {}); });
  assert.deepEqual(noKit, [], 'without the kit the head block reads nothing and the full page runs alone');
});
