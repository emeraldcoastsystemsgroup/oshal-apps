/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The audience view contract of this package's page (ADR-164 D6): the shared kit is loaded right after the theme bootstrap, the page boots the kit with exactly the audiences it provides and its own application name, the full-page start is gated on the kit's decision, the head block parses, and every read in it stays on this package's own routes (plus the framework connect list where the page already reads it). Static, no browser, no network.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The Drone Relay company view asserted as behaviour over the package's REAL routes: GET /plans answered by the compiled mount (routes/drone-relay-routes.js composing routes/plan-routes.js and the real plan store, loaded with only express and the logger stubbed, over a stub pool), fed chains the real engine sized and simulated (shared with the browser fixture), the answers JSON round-tripped as Express serializes them. On open the view makes exactly that one read and the route answers it with one SELECT of the caller's own chains; the chains paint as four stats (chains, feasible as sized, held or restored, lost the tip), a title ladder (lost, not feasible, degraded, not run yet, every run held or restored, none yet), a dense table of the newest eight (shape, radio, relays and spares, hop and margin, last run with its verdict tone, changed) whose rows open only the route's own design write-up in a new tab, and a needs-a-look list ordered worst first; odd rows read as what they are and link nowhere; signed out (the route's own 401), refused, a server failure, an unreadable answer and an unreachable server each read as what they are. The surface script's one start path (boot) is gated: under the view it reads and binds nothing, without the view or without the kit the full page boots, and removing the gate turns the test red.
 * -----------------------------------------------------------------------------
 * @module audience-view.test
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const APP = 'drone-relay';
const PAGE = 'tools/drone-relay.html';
const AUDIENCES = ["company", "family"];
const ALLOWED_PREFIXES = ["/api/drone-relay"];
const GATE_FILE = 'tools/drone-relay.js';

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

// ── Behaviour over the package's REAL routes ───────────────────────────────────
const { chainRows, listRow, SUB } = require('./audience-view.fixture.cjs');

const ROUTES = path.join(ROOT, 'routes');
const PLANS = '/api/drone-relay/plans', FRAME = '/api/drone-relay/app';
const NOW = Date.parse('2026-09-28T12:00:00.000Z');
const iso = (hours) => new Date(NOW + hours * 36e5).toISOString();
/** The stub relative-time formatter tags its input: W(...) = AppView.when of that timestamp. */
const w = (hours) => 'W(' + iso(hours) + ')';
/** The six synthetic chains as listPlans selects them (a timestamptz column arrives as a Date), sized and run by the real engine. */
const ROWS = chainRows((hours) => new Date(NOW + hours * 36e5)).map(listRow);
const [RIVER, RIDGE, CANYON, FORK, HAUL, ORCHARD] = ROWS;
const LOGGER = { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) };
const DESIGN = /^\/api\/drone-relay\/plans\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/design\.md$/;

/** @returns {object} A recording stand-in for an express Router: every registration kept in order, param handlers kept. */
function stubRouter() {
  const router = { layers: [], params: {} };
  ['get', 'post', 'put', 'patch', 'delete'].forEach((method) => { router[method] = (p, ...fns) => { router.layers.push({ method, path: p, fns }); }; });
  router.use = (...fns) => { router.layers.push({ method: 'use', path: typeof fns[0] === 'string' ? fns.shift() : null, fns }); };
  router.param = (name, fn) => { router.params[name] = fn; };
  return router;
}

/**
 * @description Load one of the package's compiled route modules: express is the recording router, the logger is stubbed,
 * node built-ins and the pure engine and plan store are real, a sibling route module loads the same way, and any other
 * import fails the test (so a new dependency is noticed, not guessed).
 * @param {string} file The module file under routes/.
 * @returns {object} The module's exports.
 */
function loadRoute(file) {
  const load = (name) => {
    if (name === 'express') return { Router: stubRouter };
    if (name === '@/shared/logger') return LOGGER;
    if (name === 'node:fs' || name === 'node:path') return require(name);
    if (name === './engine' || name === './plan-store') return require(path.join(ROUTES, name));
    if (name === './plan-routes') return loadRoute('plan-routes.js');
    throw new assert.AssertionError({ message: 'unexpected import in ' + file + ': ' + name });
  };
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', '__dirname', fs.readFileSync(path.join(ROUTES, file), 'utf8'))(load, mod, mod.exports, ROUTES);
  return mod.exports;
}

/** @returns {{ query: Function, calls: Array<{text: string, values: any[]}> }} A stub pg pool answering every query with `rows`, recording each. */
function stubPool(rows) {
  const calls = [];
  return { calls, query: (text, values) => { calls.push({ text: typeof text === 'string' ? text : text.text, values }); return Promise.resolve({ rows, rowCount: rows.length }); } };
}

/** @returns {object} A stub Express response that records the status and the JSON body. */
function response() {
  return { statusCode: 200, body: undefined, done: false, setHeader() {}, type() { return this; }, status(s) { this.statusCode = s; return this; }, json(b) { this.body = b; this.done = true; }, send(b) { this.body = b; this.done = true; } };
}

/**
 * @description Walk a recording router as express would for one request: path-less `use` layers run in order (a nested
 * router is walked in turn, a middleware continues only when it calls next), then the first layer with the request's
 * method and exact path answers it.
 * @param {object} router A stubRouter.
 * @param {object} req The request (method, path, oidc).
 * @param {object} res The stub response.
 * @returns {Promise<boolean>} Whether the request was answered.
 */
async function dispatch(router, req, res) {
  for (const layer of router.layers) {
    if (layer.method === 'use' && layer.path === null) {
      for (const fn of layer.fns) {
        if (fn && Array.isArray(fn.layers)) { if (await dispatch(fn, req, res)) return true; continue; }
        let next = false;
        await fn(req, res, () => { next = true; });
        if (!next) return true;
      }
    } else if (layer.method === req.method.toLowerCase() && layer.path === req.path) {
      await layer.fns[layer.fns.length - 1](req, res);
      return true;
    }
  }
  return false;
}

/**
 * @description Answer GET /api/drone-relay/plans with the package's REAL mount (createDroneRelayRoutes) over a stub pool.
 * @param {{rows?: object[], sub?: string|null}} [db] What the chains SELECT answers, and the caller's subject (null: signed out).
 * @returns {Promise<{http: number, body: object, calls: object[]}>} The route's status, JSON body and queries.
 */
async function realPlans({ rows = [], sub = SUB } = {}) {
  const pool = stubPool(rows);
  const router = loadRoute('drone-relay-routes.js').createDroneRelayRoutes({ pool, appPackageDir: ROOT });
  const res = response();
  const req = { method: 'GET', path: '/plans', query: {}, params: {}, oidc: sub ? { user: { sub }, isAuthenticated: () => true } : { isAuthenticated: () => false } };
  assert.ok(await dispatch(router, req, res), 'GET /plans is answered by the mount');
  return { http: res.statusCode, body: res.body, calls: pool.calls };
}

/**
 * @description Run the head block against a stub kit, frame location and fetch. Bodies are JSON round-tripped as Express
 * sends them (a Date column arrives as an ISO string).
 * @param {{http: number, body: object|undefined}|Error} answer What GET /plans answers (an undefined body is not JSON; an
 *   Error rejects the fetch, a network failure). Any other read is a 404.
 * @returns {{ company: Function, urls: string[], assigned: string[] }} The builder, every request made, every frame navigation.
 */
function loadCompany(answer) {
  let config = null;
  const urls = [], assigned = [];
  const kit = { boot: (c) => { config = c; }, when: (v) => 'W(' + v + ')' };
  const win = { AppView: kit, location: { pathname: FRAME, assign: (href) => assigned.push(href) } };
  const fetchStub = (url, opt) => {
    urls.push(((opt && opt.method) || 'GET') + ' ' + url);
    if (url !== PLANS) return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ error: 'Synthetic endpoint unavailable' }) });
    if (answer instanceof Error) return Promise.reject(answer);
    const wire = answer.body === undefined ? undefined : JSON.parse(JSON.stringify(answer.body));
    return Promise.resolve({ ok: answer.http < 400, status: answer.http, json: () => (wire === undefined ? Promise.reject(new SyntaxError('not JSON')) : Promise.resolve(wire)) });
  };
  new Function('window', 'fetch', block)(win, fetchStub);
  assert.ok(config && typeof config.audiences.company === 'function', 'the block boots the company audience');
  return { company: config.audiences.company, urls, assigned };
}

/** @returns {Promise<object>} The company model painted from one GET /plans answer (a promise of one is awaited). */
async function paint(answer) {
  return loadCompany(answer instanceof Error ? answer : await answer).company({ refresh() {} });
}

/** @returns {object} A copy of a list row under another id and title (the same sized chain and run). */
const clone = (row, n, title) => Object.assign({}, row, { plan_id: '00000000-0000-4000-8000-0000000001' + String(n).padStart(2, '0'), title });
const section = (model, id) => model.sections.find((s) => s && s.id === id);
const cells = (model) => section(model, 'chains').rows.map((r) => r.cells);
const concerns = (model) => section(model, 'attention').items.map((i) => [i.title, i.text, i.badge, i.tone]);

test('on open the view makes one read, GET /plans, and the real route answers it with one SELECT of the caller\x27s own chains', async () => {
  const res = await realPlans({ rows: ROWS });
  assert.equal(res.http, 200);
  assert.deepEqual(res.calls.map((c) => [/^SELECT\b/.test(c.text), /FROM drone_relay_plan WHERE owner_sub = \$1 ORDER BY updated_at DESC/.test(c.text), c.values]), [[true, true, [SUB]]]);
  assert.deepEqual(res.body.plans.map((p) => p.designUrl), ROWS.map((r) => PLANS + '/' + r.plan_id + '/design.md'), 'the route adds each chain\x27s write-up URL');
  const view = loadCompany(res);
  await view.company({ refresh() {} });
  assert.deepEqual(view.urls, ['GET ' + PLANS]);
});

test('the real route\x27s answer paints the stats, the title, the newest chains and the chains that need a look', async () => {
  const view = loadCompany(await realPlans({ rows: ROWS }));
  const model = await view.company({ refresh() {} });
  assert.deepEqual([model.kicker, model.title], ['Engineering · Drone Relay', '1 chain lost the tip in its last run']);
  assert.equal(model.lede, 'Newest: Synthetic River Run, changed ' + w(-1) + '. Relay-chain designs saved by this account, each as sized with its last simulated run. Simulated only: nothing here flies, and this view sizes, runs and changes nothing.');
  assert.deepEqual(model.stats.map((s) => [s.id, s.label, s.value, s.tone || null, s.hint || null]), [
    ['chains', 'Relay chains', 6, null, '4 with a saved run'],
    ['feasible', 'Feasible as sized', 5, 'warn', '1 not feasible'],
    ['holding', 'Held or restored', 2, 'ok', 'In the last saved run'],
    ['lost', 'Lost the tip', 1, 'bad', 'In the last saved run'],
  ]);
  assert.deepEqual(section(model, 'chains').columns, ['Chain', 'Design', 'Relays', 'Hop · margin', 'Last run', 'Changed']);
  assert.deepEqual(cells(model), [
    ['Synthetic River Run', 'Corridor · 1 km · ESP-NOW', '4 + 2 spares', '200 m · 15.2 dB', { text: 'Restored · no outage', tone: 'ok' }, w(-1)],
    ['Synthetic Ridge Survey', 'Lattice · 11 slots · ESP-NOW', '11 + 1 spare', '716 m · 3.0 dB', { text: 'Lost · tip out 140 s', tone: 'bad' }, w(-3)],
    ['Synthetic Canyon Chain', 'Corridor · 1 km · ESP-NOW', '2 · no spare', '333 m · 10.3 dB', { text: 'Degraded · no outage', tone: 'warn' }, w(-26)],
    ['Synthetic Fork Line', 'Tree · 2 branches · ESP-NOW', '4 + 4 spares', '200 m · 15.2 dB', { text: 'Held · no outage', tone: 'ok' }, w(-72)],
    ['Synthetic Long Haul', 'Corridor · 1 km · ESP-NOW', '4 · no spare', '200 m · 15.2 dB', { text: 'Not feasible as sized', tone: 'warn' }, w(-240)],
    ['Synthetic Orchard Line', 'Corridor · 3 km · LoRa 915 MHz', '0 + 6 spares', '3 km · 34.8 dB', { text: 'Not run yet' }, w(-288)],
  ]);
  assert.deepEqual(section(model, 'chains').rows.map((r) => [r.href, r.target]), ROWS.map((r) => [PLANS + '/' + r.plan_id + '/design.md', '_blank']));
  assert.match(section(model, 'chains').note, /^Each chain as sized, with the one run stored beside it \(changing a chain clears its run\)\. Held: no outage, loss or swap\./);
  assert.deepEqual(concerns(model), [
    ['Synthetic Ridge Survey', 'Last run lost the tip: out of reach 140 s of 200 s; worst hop margin 3.0 dB.', 'Lost', 'bad'],
    ['Synthetic Long Haul', 'the corridor needs 4 relays at a 207 m hop and the fleet has 1', 'Not feasible', 'warn'],
    ['Synthetic Canyon Chain', 'Last run ended degraded: the tip in reach, the chain not back at the design spacing after its last loss or swap; worst hop margin 3.7 dB.', 'Degraded', 'warn'],
  ]);
  const links = [].concat(section(model, 'chains').rows, section(model, 'attention').items);
  assert.ok(links.every((x) => DESIGN.test(x.href) && x.target === '_blank' && !x.onClick), 'a row opens only the route\x27s own write-up, in a new tab, and runs nothing');
  assert.deepEqual(model.actions.map((a) => [a.label, a.primary]), [['Open the chain designer', true]]);
  model.actions[0].onClick();
  assert.deepEqual(view.assigned, [FRAME], 'the one action opens the full page in the frame, where every change and run happens');
});

test('the title names the account\x27s state: lost, not feasible, degraded, not run yet, every run held or restored, none yet', async () => {
  const titles = [];
  for (const rows of [[RIVER, CANYON, FORK, HAUL, ORCHARD, RIDGE, clone(RIDGE, 1, 'Synthetic Second Ridge')], [RIVER, CANYON, FORK, HAUL, ORCHARD], [RIVER, HAUL, clone(HAUL, 2, 'Synthetic Short Fleet')],
    [RIVER, CANYON, FORK, ORCHARD], [RIVER, FORK, ORCHARD], [RIVER, FORK], [FORK], []]) titles.push((await paint(realPlans({ rows }))).title);
  assert.deepEqual(titles, ['2 chains lost the tip in their last run', '1 chain is not feasible as sized', '2 chains are not feasible as sized', '1 chain ended its last run degraded',
    '3 relay chains, 1 not run yet', '2 relay chains, every last run held or restored', '1 relay chain, every last run held or restored', 'No relay chains designed yet']);
});

test('no saved chain reads as none yet: zero stats, the table\x27s empty line, no needs-a-look list and no newest chain', async () => {
  const model = await paint(realPlans({ rows: [] }));
  assert.deepEqual(model.stats.map((s) => [s.id, s.value, s.tone || null, s.hint || null]), [['chains', 0, null, '0 with a saved run'], ['feasible', 0, null, null], ['holding', 0, null, 'In the last saved run'], ['lost', 0, null, 'In the last saved run']]);
  assert.deepEqual(model.sections.filter(Boolean).map((s) => s.id), ['chains']);
  assert.deepEqual([cells(model), section(model, 'chains').empty], [[], 'No relay chains saved yet. Size one in the designer and it appears here with its last run.']);
  assert.match(model.lede, /^Relay-chain designs saved by this account/);
});

test('more than eight chains list the newest eight and say so; the needs-a-look list keeps the worst six; odd rows read as what they are and link nowhere', async () => {
  const many = ROWS.concat([1, 2, 3, 4].map((n) => clone(RIDGE, n, 'Synthetic Ridge ' + n)));
  const model = await paint(realPlans({ rows: many }));
  assert.equal(cells(model).length, 8);
  assert.match(section(model, 'chains').note, /^The newest 8 of 10 chains\. Each chain as sized/);
  assert.deepEqual(concerns(model).map((c) => c[2]), ['Lost', 'Lost', 'Lost', 'Lost', 'Lost', 'Not feasible']);
  const odd = [
    { plan_id: 'not-a-uuid', title: '', spec: null, plan: null, last_metrics: null, updated_at: iso(-2), designUrl: 'https://example.invalid/design.md' },
    { plan_id: '00000000-0000-4000-8000-0000000000aa', title: 'Synthetic Odd Verdict', spec: { transport: 'esp-now' }, plan: { feasible: true, transport: { name: 'Synthetic Radio' }, pathLengthM: 12000, hopM: 'far', relaysNeeded: 3, sparesAvailable: 1 },
      last_metrics: { verdict: 'paused', tipOutageS: 4.25 }, updated_at: iso(-2), designUrl: '/api/drone-relay/plans/00000000-0000-4000-8000-0000000000bb/design.md' },
  ];
  const strange = await paint({ http: 200, body: { plans: odd } });
  assert.deepEqual(cells(strange), [
    ['Untitled chain', 'Corridor · — · radio not recorded', '—', '— · —', { text: 'Not feasible as sized', tone: 'warn' }, w(-2)],
    ['Synthetic Odd Verdict', 'Corridor · 12 km · Synthetic Radio', '3 + 1 spare', '— · —', { text: 'Verdict: paused · tip out 4.3 s', tone: null }, w(-2)],
  ]);
  assert.deepEqual(section(strange, 'chains').rows.map((r) => r.href), [null, null], 'a foreign or mismatched write-up URL is never followed');
  assert.deepEqual(concerns(strange), [['Untitled chain', 'The sized plan is not feasible.', 'Not feasible', 'warn']]);
  assert.equal(strange.title, '1 chain is not feasible as sized');
});

test('signed out, refused, a server failure, an unreadable answer and an unreachable server each read as what they are', async () => {
  const out = await realPlans({ sub: null });
  assert.deepEqual([out.http, out.body, out.calls.length], [401, { error: 'not_authenticated' }, 0], 'the real route refuses a caller with no subject before any query');
  const signedOut = await paint(out);
  assert.deepEqual([signedOut.title, signedOut.stats, signedOut.sections, signedOut.actions], ['Sign in to see the relay chains', undefined, undefined, undefined]);
  assert.match(signedOut.lede, /this session is not signed in/);
  const denied = await paint({ http: 403, body: { error: 'forbidden' } });
  assert.deepEqual([denied.kicker, denied.title, denied.lede], ['Engineering · Drone Relay', 'This account cannot open Drone Relay', 'The Drone Relay routes refused this account (HTTP 403).']);
  await assert.rejects(paint({ http: 500, body: { error: 'Synthetic failure' } }), /^Error: Drone Relay could not read the saved relay chains \(HTTP 500\)\.$/);
  await assert.rejects(paint({ http: 200, body: undefined }), /^Error: Drone Relay sent an answer this view could not read\.$/);
  await assert.rejects(paint({ http: 200, body: { error: 'Synthetic' } }), /^Error: Drone Relay sent an answer this view could not read\.$/);
  await assert.rejects(paint(new TypeError('Failed to fetch')), /^Error: Drone Relay could not be reached just now\.$/);
});

// ── The full page's start path ──────────────────────────────────────────────────
const SCRIPT = fs.readFileSync(path.join(ROOT, GATE_FILE), 'utf8');
const GATE = 'if (!window.AppView || !AppView.active()) ';

/** @returns {object} A stub element that records the listeners bound on it. */
function element(log) { return { addEventListener(type) { log.push(type); }, setAttribute() {}, appendChild() {}, replaceChildren() {}, style: {}, value: '', textContent: '', hidden: false, disabled: false, checked: true }; }

/**
 * @description Run the surface script against a stub DOM, fetch and timers. The capabilities read answers; every other read
 * never settles, so a full-page run stops, deterministically, at the chains read after binding every control.
 * @param {string|null} activeView What AppView.active() answers, or null for the full page.
 * @param {{source?: string, kit?: boolean}} [opt] The script text (default the shipped one) and whether the kit is present.
 * @returns {Promise<{ reads: string[], listeners: string[] }>} Requests made and listeners bound.
 */
async function runSurface(activeView, { source = SCRIPT, kit = true } = {}) {
  const calls = { reads: [], listeners: [] };
  const appView = kit ? { active: () => activeView } : undefined;
  const doc = { getElementById: () => element(calls.listeners), createElement: () => element(calls.listeners), createElementNS: () => element(calls.listeners), createTextNode: () => ({}) };
  const caps = { transports: [{ id: 'esp-now', name: 'ESP-NOW' }], controlChannels: ['in-band', 'esp-now'] };
  const fetchStub = (url, init) => {
    calls.reads.push(((init && init.method) || 'GET') + ' ' + url);
    return url === '/api/drone-relay/capabilities' ? Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(caps)) }) : new Promise(() => {});
  };
  const timer = () => 0;
  new Function('window', 'AppView', 'document', 'fetch', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', source)({ AppView: appView, open() {}, confirm: () => false }, appView, doc, fetchStub, timer, timer, timer, timer);
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
  return calls;
}

test('the surface script\x27s one start path is gated: under the view it reads and binds nothing; without it, or without the kit, the full page boots', async () => {
  const steps = SCRIPT.split('\n').filter((line) => /^  [^\s/}*]/.test(line) && !/^  (function |async function |const |let |var |'use strict')/.test(line));
  assert.deepEqual(steps, ['  ' + GATE + 'boot().catch(fail);'], 'boot is the only top-level statement that runs anything, and it carries the gate');
  assert.deepEqual(await runSurface('company'), { reads: [], listeners: [] });
  const full = { reads: ['GET /api/drone-relay/capabilities', 'GET ' + PLANS], listeners: ['click', 'click', 'click', 'click', 'click', 'click', 'input', 'click', 'click', 'click', 'click'] };
  assert.deepEqual(await runSurface(null), full);
  assert.deepEqual(await runSurface(null, { kit: false }), full, 'a core without the kit runs the full page');
  assert.deepEqual(await runSurface('company', { source: SCRIPT.replace(GATE, '') }), full, 'without the gate the view would boot the full page too: this test goes red');
});
