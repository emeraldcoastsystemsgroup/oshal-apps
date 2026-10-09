/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The audience view contract of this package's page (ADR-164 D6): the shared kit is loaded right after the theme bootstrap, the page boots the kit with exactly the audiences it provides and its own application name, the full-page start is gated on the kit's decision, the head block parses, and every read in it stays on this package's own routes (plus the framework connect list where the page already reads it). Static, no browser, no network.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The family view asserted as behaviour over the package's REAL routes: the compiled GET /series handler (routes/video-routes.js, its framework imports and express replaced by inert seams, a stub pool) and the compiled GET /home-summary handler (only express stubbed) feed the head block run against a stub kit and a stub fetch. Proves the two reads on open (never /list, which scans the caller's connected storage, the joke pump, the render node, Create's brand kit or any write), the stats, title and lede, the series tiles with plain status words, episodes finished and season badges, the watch list of credential-free http(s) links only, opening in a new tab, and each named state (counts not checked, every summary source failed, no series, signed out, refused, a failed read, a non-JSON failure, an unreachable server). The page's three start paths (the main script's control listeners and its videos and series reads, the brand-kit read, the handoff listener and connected-actions mount) run under stubs: nothing starts under the view, everything still starts without it or without the kit.
 * -----------------------------------------------------------------------------
 * @module audience-view.test
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const APP = 'video';
const PAGE = 'tools/video.html';
const AUDIENCES = ["family", "company"];
const ALLOWED_PREFIXES = ["/api/video"];
const GATE_FILE = 'tools/video.html';

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

const S = '/api/video/series', H = '/api/video/home-summary';
const noop = () => {};

/** @returns {object} An express Router seam that records each handler by "method path". */
function fakeRouter() {
  const routes = new Map(), router = { routes };
  for (const method of ['get', 'post', 'put', 'delete']) router[method] = (route, ...handlers) => { routes.set(method + ' ' + route, handlers[handlers.length - 1]); return router; };
  return router;
}

/**
 * The imports of the compiled route other than node's own path and fs, as inert seams: the boundary under test is the
 * GET /series handler's response over the rows its pool returns, not the framework, the renderer or PostgreSQL.
 */
const SEAMS = {
  express: { Router: fakeRouter },
  '@/shared/logger': { createChildLogger: () => ({ info: noop, warn: noop, error: noop, debug: noop }) },
  '@/shared/services/database': { runRuntimeSchemaBootstrap: async () => {}, buildOwnerRlsPolicyStatements: () => [] },
  '@/features/agent-management': { BotNodeClient: class {}, createRegistryEndpointResolver: () => () => null },
  '@/features/video-generation': { renderVideo: async () => ({}), sanitizeStoryboard: (s) => s, storyboardSeconds: () => 0, clampTargetSeconds: (n) => n, veoCostPerSecond: () => 0, getVertexAccessToken: async () => '' },
  '@/app/routes/storage-target': { saveContent: async () => ({}), listFolder: async () => null },
  '@/app/routes/inline-bot-execution': { executeBotOrInline: async () => ({ response: '' }) },
  '@/app/routes/connectors-routes': { getValidAccessToken: async () => '' },
  '@/app/series-dispatch': { SCREENPLAY_WRITER_AGENT_ID: 'writer', isRenderInFlight: async () => false, dispatchStoryboardedEpisode: async () => ({ ok: true }) },
  '@/app/series-pipeline': { writeSeries: async () => ({ ok: true }), storyboardEpisode: async () => ({ ok: true }) },
  '@/app/series-orchestrator': { approveSeries: async () => ({ ok: true }), runVideoSeries: async () => [], advanceVideoSeries: async () => ({}) },
  '@/app/series-drive': { uploadFrameToDrive: async () => '' },
};

/**
 * @description Load a compiled package route with the seams above in place of its imports, without touching node's
 * module loader, so the handler under test is the shipped file.
 * @param {string} file The compiled route, relative to the package.
 * @returns {object} The module's exports.
 */
function loadRoute(file) {
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8'), mod = { exports: {} };
  const need = (name) => {
    if (name === 'path' || name === 'fs') return require(name);
    assert.ok(Object.prototype.hasOwnProperty.call(SEAMS, name), 'unexpected import ' + name);
    return SEAMS[name];
  };
  new Function('require', 'module', 'exports', '__dirname', source)(need, mod, mod.exports, path.join(ROOT, 'routes'));
  return mod.exports;
}

/**
 * @description Invoke a route handler; the JSON body goes through JSON as it does on the wire (dates become ISO strings).
 * @param {Function} handler The route handler.
 * @param {object} req The request.
 * @returns {Promise<{http: number, body: object|undefined}>} The HTTP status and the serialized body.
 */
async function invoke(handler, req) {
  const res = { statusCode: 200, body: undefined, setHeader() {}, status(s) { this.statusCode = s; return this; }, json(b) { this.body = b; return this; } };
  await handler(req, res);
  return { http: res.statusCode, body: res.body === undefined ? undefined : JSON.parse(JSON.stringify(res.body)) };
}

const SIGNED_IN = { oidc: { user: { sub: 'synthetic-sub' }, isAuthenticated: () => true } };

/**
 * @description Answer GET /series with the package's REAL compiled handler over a stub pool, so the view is fed what the
 * route serializes: the series rows, each with its episodes and its season fields.
 * @param {{series?: object[], episodes?: object[], seasons?: object[], error?: Error|null, signedIn?: boolean}} [db]
 *   The rows each read answers, an error every read rejects with, and whether the caller is signed in.
 * @returns {Promise<{http: number, body: object}>} The route's HTTP status and JSON body.
 */
async function realSeries({ series = [], episodes = [], seasons = [], error = null, signedIn = true } = {}) {
  const rows = (value) => (error ? Promise.reject(error) : Promise.resolve({ rows: value }));
  const pool = { query: (sql) => rows(/season_path/.test(sql) ? seasons : /FROM video_episodes/.test(sql) ? episodes : /FROM video_series/.test(sql) ? series : []) };
  const handler = loadRoute('routes/video-routes.js').createBotVideoRoutes({ pool, appPackageDir: ROOT }).routes.get('get /series');
  assert.ok(handler, 'the compiled package registers GET /series');
  return invoke(handler, signedIn ? SIGNED_IN : {});
}

/**
 * @description Answer GET /home-summary with the package's REAL compiled route (routes/home-summary.js, only express
 * stubbed) over a stub pool: its metric ids, the 'Unavailable' count of a failed source and the 503 of all failed.
 * @param {{counts?: object|Error, five?: string|Error, rows?: object[]|Error, signedIn?: boolean}} [db] What the series
 *   count query, the saved-videos count query and the newest-series query answer (an Error rejects that query).
 * @returns {Promise<{http: number, body: object}>} The route's HTTP status and JSON body.
 */
async function realSummary({ counts = { review: '0', active: '0', failed: '0' }, five = '0', rows = [], signedIn = true } = {}) {
  const source = fs.readFileSync(path.join(ROOT, 'routes/home-summary.js'), 'utf8'), mod = { exports: {} };
  let handler = null;
  new Function('require', 'module', 'exports', source)((name) => { assert.equal(name, 'express'); return { Router: () => ({ get: (_p, fn) => { handler = fn; } }) }; }, mod, mod.exports);
  const answer = (value) => (value instanceof Error ? Promise.reject(value) : Promise.resolve({ rows: Array.isArray(value) ? value : [value] }));
  const fiveRow = five instanceof Error ? five : { five };
  mod.exports.createHomeSummaryRoutes({ pool: { query: (q) => answer(/AS review/.test(q.text) ? counts : /AS five/.test(q.text) ? fiveRow : rows) } });
  return invoke(handler, signedIn ? SIGNED_IN : { oidc: { isAuthenticated: () => false } });
}

/**
 * @description Run the head block against a stub kit and a stub fetch, so the family view is asserted as the model it
 * paints and the requests it makes. The stub relative-time formatter tags its input: W(...) = AppView.when.
 * @param {Record<string, {http: number, body: object|undefined}|Error>} answers URL -> answer (an undefined body is not
 *   JSON; an Error is a rejected fetch, the network failed). Any other URL answers 404.
 * @returns {{ family: Function, urls: string[], opened: string[] }} The builder, every request made, every AppView.open href.
 */
function loadFamily(answers) {
  let config = null;
  const urls = [], opened = [];
  const kit = { boot: (c) => { config = c; }, when: (v) => 'W(' + v + ')', open: (href) => opened.push(href) };
  const fetchStub = (url, opt) => {
    urls.push(((opt && opt.method) || 'GET') + ' ' + url);
    const a = answers[url];
    if (a instanceof Error) return Promise.reject(a);
    const res = a || { http: 404, body: { error: 'Synthetic endpoint unavailable' } };
    return Promise.resolve({ ok: res.http < 400, status: res.http, json: () => (res.body === undefined ? Promise.reject(new SyntaxError('not JSON')) : Promise.resolve(res.body)) });
  };
  new Function('window', 'fetch', block)({ AppView: kit }, fetchStub);
  assert.ok(config && typeof config.audiences.family === 'function', 'the block boots the family audience');
  return { family: config.audiences.family, urls, opened };
}

/** @returns {Promise<object>} The family model painted from a series answer and a summary answer (or promises of them). */
const paint = async (series, summary) => loadFamily({ [S]: await series, [H]: await summary }).family({ refresh() {} });
const section = (model, id) => model.sections.find((x) => x && x.id === id);
const stat = (model, id) => model.stats.find((x) => x.id === id);

const T1 = '2026-09-27T10:00:00.000Z', T2 = '2026-09-20T09:00:00.000Z', T3 = '2026-09-10T08:00:00.000Z';
const CREW = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', DOT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', REEF = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SERIES = [
  { series_id: CREW, title: 'Synthetic Breakfast Crew', premise: 'Jokes at breakfast.', episode_count: 3, scenes_per_episode: 4, status: 'done', ticket_id: 't-1', created_at: new Date(T1) },
  { series_id: DOT, title: 'Synthetic Detective Dot', premise: 'A tiny detective.', episode_count: 2, scenes_per_episode: 4, status: 'awaiting_approval', ticket_id: 't-2', created_at: new Date(T2) },
  { series_id: REEF, title: 'Synthetic Bubble Reef', premise: 'Fish sing.', episode_count: 1, scenes_per_episode: 4, status: 'failed', ticket_id: 't-3', created_at: new Date(T3) },
];
const EPISODES = [
  { series_id: CREW, episode_id: 'e1', ordinal: 1, title: 'Pancake Day', status: 'assembled', drive_url: 'https://drive.example/e1', assembled_path: 'C:/content/e1.mp4' },
  { series_id: CREW, episode_id: 'e2', ordinal: 2, title: 'Toast Trouble', status: 'assembled', drive_url: 'javascript:alert(1)', assembled_path: 'C:/content/e2.mp4' },
  { series_id: CREW, episode_id: 'e3', ordinal: 3, title: 'Jam Session', status: 'rendered', drive_url: 'https://someone:secret@drive.example/e3', assembled_path: null },
  { series_id: DOT, episode_id: 'e4', ordinal: 1, title: 'The Missing Hat', status: 'scripted', drive_url: null, assembled_path: null },
  { series_id: DOT, episode_id: 'e5', ordinal: 2, title: 'The Loud Clock', status: 'storyboarded', drive_url: null, assembled_path: null },
  { series_id: REEF, episode_id: 'e6', ordinal: 1, title: 'Bubbles', status: 'failed', drive_url: null, assembled_path: null },
];
const SEASONS = [
  { series_id: CREW, intro_clip: null, season_path: 'C:/content/crew-season.mp4', season_drive_url: 'https://drive.example/crew-season' },
  { series_id: DOT, intro_clip: null, season_path: null, season_drive_url: null },
  { series_id: REEF, intro_clip: null, season_path: null, season_drive_url: null },
];
const ALL = { series: SERIES, episodes: EPISODES, seasons: SEASONS };

test('on open the family view reads only GET /series and GET /home-summary: never /list, the pump, the brand kit or a write', async () => {
  const view = loadFamily({ [S]: await realSeries(ALL), [H]: await realSummary() });
  await view.family({ refresh() {} });
  assert.deepEqual([...view.urls].sort(), ['GET ' + H, 'GET ' + S]);
  for (const url of view.urls) assert.doesNotMatch(url, /\/list|pump|brand-kit|storyboard|generate|approve|advance|render|write/, 'no storage scan, pump, brand kit or action: ' + url);
});

test('the real routes\x27 answers paint plain stats, the series with where each stands and the watch links that are safe', async () => {
  const view = loadFamily({ [S]: await realSeries(ALL), [H]: await realSummary({ counts: { review: '1', active: '0', failed: '1' }, five: '2' }) });
  const model = await view.family({ refresh() {} });
  assert.deepEqual([model.kicker, model.title], ['Our videos', '1 series needs your OK on the scripts']);
  assert.equal(model.lede, 'Newest: Synthetic Breakfast Crew, finished, started W(' + T1 + ').');
  assert.deepEqual(model.stats.map((x) => [x.id, x.label, x.value, x.tone || null, x.hint || null]), [
    ['series', 'Series', 3, null, null],
    ['review', 'Scripts to approve', 1, 'warn', null],
    ['active', 'Series in progress', 0, null, null],
    ['saved', 'Videos saved, last 5 days', 2, null, 'Saves recorded, files not checked'],
  ]);
  assert.deepEqual(section(model, 'series').items.map((t) => [t.icon, t.title, t.text, t.meta, t.badge, t.tone, t.href, t.target]), [
    ['🎬', 'Synthetic Breakfast Crew', 'Finished · 2 of 3 episodes finished', 'started W(' + T1 + ')', 'Season cut ready', null, 'https://drive.example/crew-season', '_blank'],
    ['🎬', 'Synthetic Detective Dot', 'Waiting for your OK on the scripts · 0 of 2 episodes finished', 'started W(' + T2 + ')', 'Needs your OK', 'warn', null, null],
    ['⚠️', 'Synthetic Bubble Reef', 'Did not finish · 0 of 1 episode finished', 'started W(' + T3 + ')', null, 'warn', null, null],
  ]);
  assert.deepEqual(section(model, 'watch').items.map((t) => [t.title, t.text, t.meta, t.href, t.target]), [
    ['Synthetic Breakfast Crew: the whole season', 'Every episode in one video', 'opens in a new tab', 'https://drive.example/crew-season', '_blank'],
    ['Episode 1: Pancake Day', 'Synthetic Breakfast Crew', 'Finished', 'https://drive.example/e1', '_blank'],
  ], 'a javascript: link and a link carrying credentials are never offered');
  assert.match(section(model, 'series').note, /does not mean it was posted anywhere/);
  assert.match(section(model, 'watch').note, /Single videos made in the studio are in its My videos list/);
  assert.deepEqual(model.actions.map((a) => a.label), ['Open Video Studio']);
  model.actions[0].onClick();
  assert.deepEqual(view.opened, ['/cockpit/?app=video'], 'the one action is the way to the full application');
});

test('the title names the account\x27s state: in progress, ready to watch, saved lately, nothing being made, no videos yet', async () => {
  const making = await paint(realSeries(ALL), realSummary({ counts: { review: '0', active: '2', failed: '0' } }));
  assert.equal(making.title, '2 series in progress');
  const ready = await paint(realSeries(ALL), realSummary());
  assert.equal(ready.title, '2 videos ready to watch');
  const quiet = { series: [SERIES[1]], episodes: EPISODES.filter((e) => e.series_id === DOT), seasons: [SEASONS[1]] };
  const saved = await paint(realSeries(quiet), realSummary({ five: '3' }));
  assert.equal(saved.title, '3 videos saved in the last 5 days');
  const idle = await paint(realSeries(quiet), realSummary());
  assert.deepEqual([idle.title, idle.lede], ['Nothing being made right now', 'Newest: Synthetic Detective Dot, waiting for your OK on the scripts, started W(' + T2 + ').']);
  const none = await paint(realSeries(), realSummary());
  assert.deepEqual([none.title, section(none, 'series').items, section(none, 'series').empty, section(none, 'watch').empty], ['No videos yet', [], 'No series yet.', 'Nothing ready to watch yet.']);
  assert.match(none.lede, /writes a whole series of episodes for you to approve/);
});

test('a season only on the render computer, an unknown status and untitled records each read as what they are', async () => {
  const series = [
    { series_id: CREW, title: '', episode_count: 2, scenes_per_episode: 4, status: 'paused', ticket_id: 't', created_at: new Date(T1) },
  ];
  const episodes = [
    { series_id: CREW, episode_id: 'e1', ordinal: null, title: null, status: 'queued', drive_url: 'https://drive.example/e1', assembled_path: null },
  ];
  const model = await paint(realSeries({ series, episodes, seasons: [{ series_id: CREW, intro_clip: null, season_path: 'C:/content/s.mp4', season_drive_url: null }] }), realSummary());
  const tile = section(model, 'series').items[0];
  assert.deepEqual([tile.title, tile.text, tile.badge, tile.href], ['Untitled series', 'Status: paused · 0 of 2 episodes finished', 'Season cut on the render computer', null]);
  assert.deepEqual(section(model, 'watch').items.map((t) => [t.title, t.text, t.meta]), [['Untitled episode', 'Untitled series', 'Status: queued']]);
  assert.equal(model.lede, 'Newest: Untitled series, status: paused, started W(' + T1 + ').');
});

test('counts the summary could not check read as not checked, and the series still show', async () => {
  const partial = await paint(realSeries({ series: [SERIES[1]], episodes: [], seasons: [] }), realSummary({ counts: new Error('synthetic count failure') }));
  assert.deepEqual(['review', 'active', 'saved'].map((id) => [stat(partial, id).value, stat(partial, id).hint]), [['—', 'Could not check'], ['—', 'Could not check'], [0, 'Saves recorded, files not checked']]);
  assert.equal(partial.title, 'Some saved work could not be checked', 'nothing is said to be idle when its count is unknown');
  assert.equal(section(partial, 'series').items.length, 1);
  const down = await realSummary({ counts: new Error('synthetic'), five: new Error('synthetic'), rows: new Error('synthetic') });
  assert.equal(down.http, 503, 'the real route answers 503 when every source failed');
  const model = await paint(realSeries(ALL), down);
  assert.deepEqual(['review', 'active', 'saved'].map((id) => stat(model, id).value), ['—', '—', '—']);
  assert.deepEqual([model.title, section(model, 'series').items.length], ['2 videos ready to watch', 3]);
  const many = Array.from({ length: 50 }, (_, i) => ({ ...SERIES[0], series_id: 'id-' + i }));
  assert.equal(stat(await paint(realSeries({ series: many }), realSummary()), 'series').hint, 'The newest 50', 'the route returns at most 50');
});

test('signed out, refused, a failed read, a non-JSON failure and an unreachable server each read as what they are', async () => {
  const signedOut = await paint(realSeries({ signedIn: false }), realSummary({ signedIn: false }));
  assert.deepEqual([signedOut.title, signedOut.stats, signedOut.sections], ['Sign in to see your videos', undefined, undefined]);
  const summaryOut = await paint(realSeries(ALL), realSummary({ signedIn: false }));
  assert.equal(summaryOut.title, 'Sign in to see your videos', 'a refused summary is a refusal, not a missing count');
  const denied = await paint({ http: 403, body: { error: 'forbidden' } }, realSummary());
  assert.deepEqual([denied.title, denied.lede], ['This account cannot open Video Studio', 'The Video Studio routes refused this account (HTTP 403).']);
  const failed = await realSeries({ error: new Error('relation "video_series" does not exist') });
  assert.equal(failed.http, 502);
  await assert.rejects(paint(failed, realSummary()), /^Error: Video Studio could not read the saved series \(HTTP 502\)\.$/);
  await assert.rejects(paint({ http: 500, body: undefined }, realSummary()), /^Error: Video Studio could not read the saved series \(HTTP 500\)\.$/);
  await assert.rejects(paint(new TypeError('Failed to fetch'), realSummary()), /^Error: Video Studio could not be reached just now\.$/);
});

/**
 * @description A stub element carrying what the page's start steps touch; each bound listener's type is recorded.
 * @param {string[]} bound Where listener types are pushed.
 * @returns {object} The stub element.
 */
function element(bound) {
  return { value: '20', textContent: '', innerHTML: '', className: '', style: {}, open: false, setAttribute() {}, focus() {}, dispatchEvent() {}, addEventListener(type) { bound.push(type); } };
}

/**
 * @description Run the page's main script (the first script in the body) against a stub DOM and a stub fetch.
 * @param {object|undefined} view What AppView is: a stub answering active(), or undefined when the kit is absent.
 * @returns {Promise<{bound: string[], reads: string[]}>} Listener types bound and every request made.
 */
async function runMain(view) {
  const open = html.indexOf('<script>', html.indexOf('<body>')), src = html.slice(open + 8, html.indexOf('</script>', open));
  const bound = [], reads = [];
  const fetchStub = (url, opt) => { reads.push(((opt && opt.method) || 'GET') + ' ' + url); return Promise.resolve({ ok: true, json: () => Promise.resolve({ videos: [], series: [] }) }); };
  new Function('window', 'AppView', 'document', 'fetch', src)({ AppView: view }, view, { getElementById: () => element(bound), querySelectorAll: () => [] }, fetchStub);
  await new Promise((done) => setImmediate(done));
  return { bound, reads };
}

/**
 * @description Run the page's brand-kit script against a stub DOM and a stub fetch that refuses.
 * @param {object|undefined} view What AppView is, or undefined when the kit is absent.
 * @returns {string[]} Every URL fetched.
 */
function runBrand(view) {
  const from = html.indexOf("/* Your brand: Create's brand kit"), code = html.slice(from, html.indexOf('})();', from) + 5);
  const reads = [], button = { dataset: { brandTarget: 'style' }, hidden: true, addEventListener() {} };
  new Function('AppView', 'document', 'fetch', code)(view, { querySelectorAll: () => [button], getElementById: () => ({ value: '', maxLength: 300 }) },
    (url) => { reads.push(url); return Promise.resolve({ ok: false, status: 403 }); });
  return reads;
}

/**
 * @description Run the page's module script (imports stripped) against stub modules and a stub DOM.
 * @param {string|null} activeView What AppView.active() answers, or null for the full page.
 * @returns {{ handoffs: number, mounted: number, appended: number }} Handoff listeners, connected-actions mounts, sections appended.
 */
function runModule(activeView) {
  const open = html.indexOf('<script type="module">'), src = html.slice(open + 22, html.indexOf('</script>', open)).replace(/^import .*$/gm, '');
  const calls = { handoffs: 0, mounted: 0, appended: 0 };
  const node = () => ({ value: '', className: '', style: {}, setAttribute() {}, focus() {}, dispatchEvent() {} });
  new Function('window', 'AppView', 'document', 'receiveHandoff', 'mountConnectedActions', src)(
    { AppView: { active: () => activeView } }, { active: () => activeView }, { getElementById: node, createElement: node, body: { append() { calls.appended++; } } },
    () => { calls.handoffs++; }, () => { calls.mounted++; return Promise.resolve(); });
  return calls;
}

test('under the family view no start path runs; without it, or without the kit, every one still does', async () => {
  const family = { active: () => 'family' }, full = { active: () => null };
  assert.deepEqual(await runMain(family), { bound: [], reads: [] }, 'no control listener, no videos list (a storage scan), no series read');
  assert.deepEqual(await runMain(full), { bound: ['input', 'toggle'], reads: ['GET /api/video/list', 'GET /api/video/series'] });
  assert.deepEqual(await runMain(undefined), { bound: ['input', 'toggle'], reads: ['GET /api/video/list', 'GET /api/video/series'] }, 'a core without the kit runs the full page');
  assert.deepEqual(runBrand(family), [], 'Create\x27s brand kit is not read under the view');
  assert.deepEqual(runBrand(full), ['/api/create/brand-kit']);
  assert.deepEqual(runBrand(undefined), ['/api/create/brand-kit']);
  assert.deepEqual(runModule('family'), { handoffs: 0, mounted: 0, appended: 0 });
  assert.deepEqual(runModule(null), { handoffs: 1, mounted: 1, appended: 1 });
  assert.doesNotMatch(html, /^(loadList|loadSeries)\(\);$/m, 'no ungated start call is left at the top level');
});
