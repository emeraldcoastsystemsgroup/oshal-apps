/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The audience view contract of this package's page (ADR-164 D6): the shared kit is loaded right after the theme bootstrap, the page boots the kit with exactly the audiences it provides and its own application name, the full-page start is gated on the kit's decision, the head block parses, and every read in it stays on this package's own routes (plus the framework connect list where the page already reads it). Static, no browser, no network.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | The family view asserted as behaviour: the head block runs against a stub kit and a stub fetch, so the tests prove what it reads on open (only /config and /watchlist: never trending, search, title detail, the concierge or its conversation), which titles link out (only themoviedb.org pages, in a new tab), that saved times are formatted as timestamps, and that not connected, a failed connection check, an empty watchlist, a refusal and a failure each read as what they are. The page's module script is run with stubs too: under an audience view it adds no handoff listener and fetches no connected-actions offer, and the full page's boot() is called only behind the gate.
 * -----------------------------------------------------------------------------
 * @module audience-view.test
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const APP = 'movies';
const PAGE = 'tools/movies-app.html';
const AUDIENCES = ["family", "company"];
const ALLOWED_PREFIXES = ["/api/movies"];
const GATE_FILE = 'tools/movies-app.html';

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

/**
 * @description Run the head block against a stub kit and a stub fetch, so the family view is asserted as the model it
 * paints and the reads it makes rather than as substrings of the source.
 * @param {Record<string, object>} answers URL -> JSON body; `{ status, body }` answers with that HTTP status instead.
 * @returns {{ family: Function, urls: string[], opened: string[] }} The family builder, every URL fetched, every A.open href.
 */
function loadFamily(answers) {
  let config = null;
  const urls = [], opened = [];
  const kit = { boot: (c) => { config = c; }, when: (v) => 'W(' + v + ')', day: (v) => 'D(' + v + ')', open: (href) => opened.push(href) };
  const fetchStub = (url) => {
    urls.push(url);
    const a = answers[url], status = a === undefined ? 404 : (a.status || 200), body = a === undefined ? {} : a.status ? a.body || {} : a;
    return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
  };
  new Function('window', 'fetch', block)({ AppView: kit }, fetchStub);
  assert.ok(config && typeof config.audiences.family === 'function', 'the block boots the family audience');
  return { family: config.audiences.family, urls, opened };
}

const ROWS = [
  { row_id: 'a', media_type: 'movie', title: 'Synthetic Up', year: '2009', tmdb_url: 'https://www.themoviedb.org/movie/14160', status: 'want', created_at: '2026-09-20T18:00:00.000Z' },
  { row_id: 'b', media_type: 'tv', title: 'Synthetic Bluey', year: '2018', tmdb_url: 'https://elsewhere.example/tv/1', status: 'want', created_at: '2026-09-10T18:00:00.000Z' },
];
const OK = { '/api/movies/config': { connected: true }, '/api/movies/watchlist': { items: ROWS } };
const section = (model, id) => model.sections.find((s) => s && s.id === id);
const stat = (model, id) => model.stats.find((s) => s.id === id);

test('on open the family view reads only the connection check and the watchlist', async () => {
  const view = loadFamily(OK);
  await view.family({ refresh() {} });
  assert.deepEqual([...view.urls].sort(), ['/api/movies/config', '/api/movies/watchlist']);
  for (const url of view.urls) assert.doesNotMatch(url, /trending|search|title|chat|conversation|profile/, 'no movie-database, concierge or profile read: ' + url);
});

test('saved titles are tiles: only themoviedb.org pages link out, in a new tab; saved times are timestamps', async () => {
  const model = await loadFamily(OK).family({ refresh() {} });
  const tiles = section(model, 'watchlist').items;
  assert.equal(model.title, '2 saved to watch');
  assert.equal(model.lede, 'Newest: Synthetic Up, saved W(2026-09-20T18:00:00.000Z)');
  assert.deepEqual([tiles[0].href, tiles[0].target], ['https://www.themoviedb.org/movie/14160', '_blank']);
  assert.deepEqual([tiles[1].href, tiles[1].target], [null, null], 'a non-TMDB link is never opened');
  assert.equal(tiles[1].text, 'Show · 2018');
  assert.equal(tiles[0].meta, 'saved W(2026-09-20T18:00:00.000Z)');
  assert.deepEqual(model.stats.map((s) => [s.id, s.value]), [['want', 2], ['movies', 1], ['shows', 1], ['database', 'Connected']]);
});

test('not connected still shows the watchlist and offers the connection, never an empty state', async () => {
  const view = loadFamily({ ...OK, '/api/movies/config': { connected: false } });
  const model = await view.family({ refresh() {} });
  assert.equal(stat(model, 'database').value, 'Not set up');
  assert.equal(section(model, 'watchlist').items.length, 2);
  assert.match(section(model, 'watchlist').note, /not connected/);
  const connect = model.actions.find((a) => /Connect/.test(a.label));
  connect.onClick();
  assert.deepEqual(view.opened, ['/utilities']);
});

test('a failed connection check reads as unknown, and an empty watchlist as nothing saved', async () => {
  const unknown = await loadFamily({ ...OK, '/api/movies/config': { status: 500, body: { error: 'boom' } } }).family({ refresh() {} });
  assert.deepEqual([stat(unknown, 'database').value, stat(unknown, 'database').hint], ['—', 'Could not check']);
  assert.equal(unknown.actions.length, 1, 'no connect action when the state is unknown');
  const empty = await loadFamily({ ...OK, '/api/movies/watchlist': { items: [] } }).family({ refresh() {} });
  assert.equal(empty.title, 'Nothing saved to watch yet');
  assert.deepEqual(section(empty, 'watchlist').items, []);
});

test('a refusal is named, and a failed watchlist read fails with its status, not a database message', async () => {
  const signedOut = await loadFamily({ ...OK, '/api/movies/watchlist': { status: 401, body: { error: 'Not authenticated' } } }).family({ refresh() {} });
  assert.equal(signedOut.title, 'Sign in to see the watchlist');
  const denied = await loadFamily({ ...OK, '/api/movies/config': { status: 403, body: {} } }).family({ refresh() {} });
  assert.equal(denied.title, 'This account cannot open Movies & TV');
  await assert.rejects(loadFamily({ ...OK, '/api/movies/watchlist': { status: 500, body: { error: 'relation "movies_watchlist" does not exist' } } }).family({ refresh() {} }),
    /^Error: Movies & TV could not read the watchlist \(HTTP 500\)\.$/);
});

/**
 * @description Run the page's module script (imports stripped) against stub modules and a stub DOM.
 * @param {string|null} activeView What AppView.active() answers, or null for the full page.
 * @returns {{ handoff: number, actions: number }} How often receiveHandoff and mountConnectedActions ran.
 */
function runModule(activeView) {
  const src = html.slice(html.indexOf('<script type="module">') + 22, html.indexOf('</script>', html.indexOf('<script type="module">')));
  const calls = { handoff: 0, actions: 0 };
  const node = () => ({ hidden: true, value: '', style: {}, focus() {}, scrollIntoView() {}, querySelectorAll: () => [] });
  const documentStub = { getElementById: node, querySelector: node };
  const body = src.replace(/^import .*$/gm, '');
  new Function('window', 'AppView', 'document', 'receiveHandoff', 'mountConnectedActions', body)(
    { AppView: { active: () => activeView } }, { active: () => activeView }, documentStub,
    () => { calls.handoff++; }, () => { calls.actions++; return Promise.resolve(); });
  return calls;
}

test('under an audience view the module script adds no handoff listener and fetches no connected-actions offer', () => {
  assert.deepEqual(runModule('family'), { handoff: 0, actions: 0 });
  assert.deepEqual(runModule(null), { handoff: 1, actions: 1 }, 'the full page still mounts both');
  assert.match(html, /\nif \(!window\.AppView \|\| !AppView\.active\(\)\) boot\(\);\n/, 'the full page boot is gated');
  assert.doesNotMatch(html, /^boot\(\);$/m, 'no ungated boot() call is left');
});
