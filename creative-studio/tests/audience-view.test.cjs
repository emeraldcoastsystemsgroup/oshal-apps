/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The audience view contract of this package's page (ADR-164 D6): the shared kit is loaded right after the theme bootstrap, the page boots the kit with exactly the audiences it provides and its own application name, the full-page start is gated on the kit's decision, the head block parses, and every read in it stays on this package's own routes (plus the framework connect list where the page already reads it). Static, no browser, no network.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The family view asserted as behaviour over the package's REAL home-summary route (routes/home-summary.js run with only express stubbed and a stub pool), so the view is fed what the route actually serializes: the one read on open (GET /home-summary; never a write, never the connected-actions plan), the counts as plain stats (waiting or being made, finished in five days, not finished all time, last change), the title ladder (waiting or being made, finished in five days, nothing waiting or being made, no story videos yet, some saved work not checked), a queued-only account never told a story is being made (the route's stories-active counts queued and running together), the newest stories as tiles read from the route's detail string (plain status words, timestamps through AppView.when, the route's own 'date unavailable' kept, the 'story: ' prefix dropped, no tile that starts or hands off anything), a count that could not be checked named as such, and signed out (the route's own 401), refused (403), every source failed (the route's own 503), a non-JSON failure and an unreachable server each read as what they are. The page's module script (top-level await, run as an async function body) binds no handoff listener, mounts no connected actions, binds no Refresh handler and reads nothing under the view, while the full page still runs every start step.
 * -----------------------------------------------------------------------------
 * @module audience-view.test
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const APP = 'creative-studio';
const PAGE = 'tools/review.html';
const AUDIENCES = ["family", "company"];
const ALLOWED_PREFIXES = ["/api/creative-studio"];
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

const H = '/api/creative-studio/home-summary';

/**
 * @description Answer GET /home-summary with the package's REAL compiled route (routes/home-summary.js) over a stub pool,
 * so the family view is fed exactly what the route serializes (its metric ids, the 'Unavailable' count, the
 * '<status> · updated <when>' detail, the trailing note, the 503 when every source failed) rather than a hand-typed
 * copy that could drift from it. The loader mirrors scripts/media-home.test.cjs: only `express` is stubbed.
 * @param {{counts?: object|Error, rows?: object[]|Error, signedIn?: boolean}} [db] What the count query and the
 *   newest-stories query answer (an Error rejects that query), and whether the caller is signed in.
 * @returns {Promise<{http: number, body: object}>} The route's HTTP status and JSON body.
 */
async function realSummary({ counts = { active: '0', failed: '0', five: '0' }, rows = [], signedIn = true } = {}) {
  const source = fs.readFileSync(path.join(ROOT, 'routes/home-summary.js'), 'utf8');
  const mod = { exports: {} };
  let handler = null;
  new Function('require', 'module', 'exports', source)((name) => { assert.equal(name, 'express'); return { Router: () => ({ get: (_p, fn) => { handler = fn; } }) }; }, mod, mod.exports);
  const answer = (value) => (value instanceof Error ? Promise.reject(value) : Promise.resolve({ rows: Array.isArray(value) ? value : [value] }));
  mod.exports.createHomeSummaryRoutes({ pool: { query: (q) => answer(/count\(\*\)/.test(q.text) ? counts : rows) } });
  const res = { statusCode: 200, body: undefined, setHeader() {}, status(s) { this.statusCode = s; return this; }, json(b) { this.body = b; } };
  await handler({ oidc: signedIn ? { user: { sub: 'synthetic-sub' }, isAuthenticated: () => true } : { isAuthenticated: () => false } }, res);
  return { http: res.statusCode, body: res.body };
}

/**
 * @description Run the head block against a stub kit and a stub fetch, so the family view is asserted as the model it
 * paints and the requests it makes. The stub relative-time formatter tags its input: W(...) = AppView.when.
 * @param {{http: number, body: object|undefined}|Error} answer What GET /home-summary answers (an undefined body is not
 *   JSON), or an Error the fetch rejects with (the network failed).
 * @returns {{ family: Function, urls: string[], opened: string[] }} The builder, every request made, every AppView.open href.
 */
function loadFamily(answer) {
  let config = null;
  const urls = [], opened = [];
  const kit = { boot: (c) => { config = c; }, when: (v) => 'W(' + v + ')', open: (href) => opened.push(href) };
  const fetchStub = (url, opt) => {
    urls.push(((opt && opt.method) || 'GET') + ' ' + url);
    if (answer instanceof Error) return Promise.reject(answer);
    const a = url === H ? answer : { http: 404, body: {} };
    return Promise.resolve({ ok: a.http < 400, status: a.http, json: () => (a.body === undefined ? Promise.reject(new SyntaxError('not JSON')) : Promise.resolve(a.body)) });
  };
  new Function('window', 'fetch', block)({ AppView: kit }, fetchStub);
  assert.ok(config && typeof config.audiences.family === 'function', 'the block boots the family audience');
  return { family: config.audiences.family, urls, opened };
}

/** @returns {Promise<object>} The family model painted from an answer (or a promise of one, such as realSummary()). */
const paint = async (answer) => loadFamily(await answer).family({ refresh() {} });
const T1 = '2026-09-28T10:00:00.000Z', T2 = '2026-09-27T09:00:00.000Z', T3 = '2026-09-26T08:00:00.000Z';
const RUNNING = { idea: 'story: Synthetic Tortoise and Hare', status: 'running', updated_at: new Date(T1) };
const DONE = { idea: 'story: Synthetic Fox and Grapes', status: 'done', updated_at: new Date(T2) };
const FAILED = { idea: 'story: Synthetic Boy Who Cried Wolf', status: 'failed', updated_at: new Date(T3) };
const section = (model, id) => model.sections.find((x) => x && x.id === id);
const stat = (model, id) => model.stats.find((x) => x.id === id);

test('on open the family view makes one read, GET /home-summary: never a write, never the connected-actions plan', async () => {
  const view = loadFamily(await realSummary({ rows: [DONE] }));
  await view.family({ refresh() {} });
  assert.deepEqual(view.urls, ['GET ' + H]);
});

test('the real route\x27s answer paints plain stats and the newest stories as tiles with plain status words and timestamps', async () => {
  const view = loadFamily(await realSummary({ counts: { active: '1', failed: '1', five: '2' }, rows: [RUNNING, DONE, FAILED] }));
  const model = await view.family({ refresh() {} });
  assert.deepEqual([model.kicker, model.title], ['Story videos', '1 story video waiting or being made']);
  assert.equal(model.lede, 'Newest: Synthetic Tortoise and Hare (being made now, updated W(' + T1 + ')).');
  assert.deepEqual(model.stats.map((x) => [x.id, x.label, x.value, x.tone || null, x.hint || null]), [
    ['active', 'Waiting or being made', 1, null, null],
    ['finished', 'Finished, last 5 days', 2, null, null],
    ['unfinished', 'Did not finish', 1, 'warn', 'All time'],
    ['latest', 'Last change', 'W(' + T1 + ')', null, null],
  ]);
  assert.equal(model.sections.length, 1, 'one section: the route\x27s own ledger note is not a story');
  const tiles = section(model, 'stories').items;
  assert.deepEqual(tiles.map((t) => [t.title, t.text, t.meta, t.tone]), [
    ['Synthetic Tortoise and Hare', 'Being made now', 'updated W(' + T1 + ')', null],
    ['Synthetic Fox and Grapes', 'Finished', 'updated W(' + T2 + ')', null],
    ['Synthetic Boy Who Cried Wolf', 'Did not finish', 'updated W(' + T3 + ')', 'warn'],
  ]);
  assert.deepEqual([tiles[0].icon === tiles[1].icon, tiles[2].icon !== tiles[0].icon], [true, true], 'an unfinished story has its own icon');
  assert.ok(tiles.every((t) => !t.href && !t.onClick && !t.target), 'a story tile starts, opens and hands off nothing');
  assert.match(section(model, 'stories').note, /does not mean the video was posted anywhere/);
  assert.deepEqual(model.actions.map((a) => a.label), ['Open Creative Studio']);
  model.actions[0].onClick();
  assert.deepEqual(view.opened, ['/cockpit/?app=creative-studio'], 'the one action is the way to the full application');
});

test('the title names the account\x27s state: waiting or being made, finished in five days, nothing waiting or being made, no story videos yet', async () => {
  const two = await paint(realSummary({ counts: { active: '2', failed: '0', five: '1' }, rows: [RUNNING, DONE] }));
  assert.equal(two.title, '2 story videos waiting or being made');
  const finished = await paint(realSummary({ counts: { active: '0', failed: '0', five: '3' }, rows: [DONE] }));
  assert.equal(finished.title, '3 story videos finished in the last 5 days');
  const idle = await paint(realSummary({ counts: { active: '0', failed: '1', five: '0' }, rows: [FAILED] }));
  assert.deepEqual([idle.title, idle.lede], ['Nothing waiting or being made right now', 'Newest: Synthetic Boy Who Cried Wolf (did not finish, updated W(' + T3 + ')).']);
  const none = await paint(realSummary({ rows: [] }));
  assert.deepEqual([none.title, section(none, 'stories').items, section(none, 'stories').empty, stat(none, 'latest').value], ['No story videos yet', [], 'No story videos yet.', '—']);
  assert.match(none.lede, /fables, fairy tales and famous sayings/);
});

test('a queued story, a status the view does not know and the route\x27s own unreadable date each read as what they are', async () => {
  const rows = [{ idea: 'story: Synthetic Queued Fable', status: 'queued', updated_at: new Date(T1) }, { idea: 'Synthetic ad-hoc idea', status: 'paused', updated_at: 'not a date' }];
  const model = await paint(realSummary({ counts: { active: '1', failed: '0', five: '0' }, rows }));
  assert.deepEqual(section(model, 'stories').items.map((t) => [t.title, t.text, t.meta]), [
    ['Synthetic Queued Fable', 'Waiting its turn', 'updated W(' + T1 + ')'],
    ['Synthetic ad-hoc idea', 'Status: paused', 'updated date unavailable'],
  ]);
  assert.equal(model.lede, 'Newest: Synthetic Queued Fable (waiting its turn, updated W(' + T1 + ')).');
});

test('when the only active story is queued, neither the title nor the count claims a story is being made', async () => {
  const QUEUED = { idea: 'story: Synthetic Queued Fable', status: 'queued', updated_at: new Date(T1) };
  const model = await paint(realSummary({ counts: { active: '1', failed: '0', five: '0' }, rows: [QUEUED] }));
  const claimsMaking = /(?<!waiting or )being made/i;
  assert.equal(model.title, '1 story video waiting or being made');
  assert.doesNotMatch(model.title, claimsMaking, 'the title does not say a queued story is being made');
  assert.deepEqual([stat(model, 'active').label, stat(model, 'active').value], ['Waiting or being made', 1]);
  assert.ok(model.stats.every((x) => !claimsMaking.test(x.label)), 'no stat says a queued story is being made');
  assert.equal(model.lede, 'Newest: Synthetic Queued Fable (waiting its turn, updated W(' + T1 + ')).');
  assert.deepEqual(section(model, 'stories').items.map((t) => t.text), ['Waiting its turn']);
});

test('a source the route could not check is named: an unavailable count reads as not checked, the stories that did load still show', async () => {
  const counts = await paint(realSummary({ counts: new Error('synthetic count failure'), rows: [RUNNING] }));
  assert.equal(counts.title, 'Some saved work could not be checked');
  assert.deepEqual(['active', 'finished', 'unfinished'].map((id) => [stat(counts, id).value, stat(counts, id).tone, stat(counts, id).hint]), [['—', null, 'Could not check'], ['—', null, 'Could not check'], ['—', null, 'Could not check']]);
  assert.equal(section(counts, 'stories').items.length, 1);
  const list = await paint(realSummary({ counts: { active: '0', failed: '0', five: '0' }, rows: new Error('synthetic list failure') }));
  assert.deepEqual([list.title, section(list, 'stories').items, section(list, 'stories').empty], ['Some saved work could not be checked', [], 'None to show: some saved work could not be checked.']);
  assert.equal(list.lede, 'Some saved story videos could not be read just now. Try again in a moment, or open Creative Studio.');
  const known = await paint(realSummary({ counts: { active: '2', failed: '0', five: '0' }, rows: new Error('synthetic list failure') }));
  assert.equal(known.title, '2 story videos waiting or being made', 'a count that did load is still told');
});

test('signed out, refused, every source failed, a non-JSON failure and an unreachable server each read as what they are', async () => {
  const signedOut = await paint(realSummary({ signedIn: false }));
  assert.deepEqual([signedOut.title, signedOut.stats, signedOut.sections], ['Sign in to see the story videos', undefined, undefined]);
  const denied = await paint({ http: 403, body: {} });
  assert.deepEqual([denied.title, denied.lede], ['This account cannot open Creative Studio', 'The Creative Studio routes refused this account (HTTP 403).']);
  const down = await realSummary({ counts: new Error('synthetic'), rows: new Error('synthetic') });
  assert.equal(down.http, 503, 'the real route answers 503 when every source failed');
  await assert.rejects(paint(down), /^Error: Creative Studio could not read the saved story videos \(HTTP 503\)\.$/);
  await assert.rejects(paint({ http: 500, body: undefined }), /^Error: Creative Studio could not read the saved story videos \(HTTP 500\)\.$/);
  await assert.rejects(paint(new TypeError('Failed to fetch')), /^Error: Creative Studio could not be reached just now\.$/);
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

test('under the family view the page\x27s module script binds nothing, mounts nothing and reads nothing; the full page still runs every start step', async () => {
  assert.deepEqual(await runModule('family'), { handoffs: 0, mounted: 0, listeners: 0, reads: [] });
  assert.deepEqual(await runModule(null), { handoffs: 1, mounted: 1, listeners: 1, reads: ['GET ' + H] });
});
