/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | The audience view contract of this package's page (ADR-164 D6): the shared kit is loaded right after the theme bootstrap, the page boots the kit with exactly the audiences it provides and its own application name, the full-page start is gated on the kit's decision, the head block parses, and every read in it stays on this package's own routes (plus the framework connect list where the page already reads it). Static, no browser, no network.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | Behaviour of the Shopping family view over a stub kit and a stub fetch: on open it reads exactly /lists, the active list's /items and /home-summary and never the catalog (search, deals, resolve), the concierge or the profile; the active list is the oldest active one and an archived list is never picked; pending lines carry quantity, price and when, purchased lines are left out, other lists are tiles; the no-list, empty-list, unknown-summary, partial, 401, 403 and failed-read states are each named; the one action opens the cockpit entry. The dashboard script itself is run against a stub DOM to prove its tab router does not start under a view (?view=deals fetches nothing) while it still opens the tab and reads the deals feed without one, and with no kit at all.
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | The concierge chat page, Shopping's first surface (the one the Studio, Orbit, Commons and Jarvis shells frame), gains its own company and family views, so this suite covers it beside the dashboard: the page is the manifest's first ui.static entry and the route serves it; the kit follows the theme bootstrap once and the viewport-pinned body scrolls under a view; the boot names this application and exactly company and family; the block parses, has one fetch site on /api/purchasing and no write, new tab or HTML from data. Behaviour runs the head block against the package's REAL handlers (the compiled router's GET /lists and GET /lists/:id/items over a stub pool, the home-summary route over another, every body JSON round-tripped): exactly the three reads and only SELECTs; the company cart table newest first with the counted quantity, unit and line price, and a total equal to the routes' own cart-totals module on edge lines (float cents, a quantity over ten, an oversized price); the lists table with the cart's list marked; the family list in the dashboard's words; no list, an empty list, a partial or failed summary, more lines than the table shows, the real 401, a 403 and the real 500 with its raw database message each named. The page's own scripts are run against a stub DOM to prove that under either view the concierge start reads nothing (the list-creating GET /cart and the Walmart deals feed included), the assistant rail is not attached and no handoff listener or connected-actions mount runs, while without a view and without the kit every start step still runs.
 * -----------------------------------------------------------------------------
 * @module audience-view.test
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const APP = 'purchasing';
const PAGE = 'tools/shopping-dashboard.html';
const AUDIENCES = ["family"];
const ALLOWED_PREFIXES = ["/api/purchasing"];
const GATE_FILE = 'tools/shopping-dashboard.html';

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
  const kit = { boot: (c) => { config = c; }, when: (v) => 'W(' + v + ')', day: (v) => 'D(' + v + ')', money: (v) => '$' + Number(v).toFixed(2), open: (href) => opened.push(href) };
  const fetchStub = (url) => {
    urls.push(url);
    const a = answers[url], status = a === undefined ? 404 : (a.status || 200), body = a === undefined ? {} : a.status ? a.body || {} : a;
    return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
  };
  new Function('window', 'fetch', block)({ AppView: kit }, fetchStub);
  assert.ok(config && typeof config.audiences.family === 'function', 'the block boots the family audience');
  return { family: config.audiences.family, urls, opened };
}

// GET /lists rows (ordered by created_at, item_count = pending lines): the archived list is OLDEST, so it comes first.
const LISTS = [
  { list_id: 'l0', name: 'Synthetic Party Supplies', status: 'archived', created_at: '2026-08-01T12:00:00.000Z', item_count: '0' },
  { list_id: 'l1', name: 'Synthetic Weekly Groceries', status: 'active', created_at: '2026-09-01T12:00:00.000Z', item_count: '2' },
  { list_id: 'l2', name: 'Synthetic Camping Trip', status: 'active', created_at: '2026-09-10T12:00:00.000Z', item_count: '1' },
];
// GET /lists/:id/items rows (every status but removed): the purchased line must not count or lead.
const ITEMS = [
  { item_id: 'i1', title: 'Synthetic Milk', quantity: 2, unit_price: '3.48', status: 'pending', created_at: '2026-09-20T18:00:00.000Z' },
  { item_id: 'i2', title: 'Synthetic Bananas', quantity: 1, unit_price: null, status: 'pending', created_at: '2026-09-21T09:00:00.000Z' },
  { item_id: 'i3', title: 'Synthetic Coffee', quantity: 1, unit_price: '8.98', status: 'purchased', created_at: '2026-09-22T09:00:00.000Z' },
];
const SUMMARY = { metrics: [{ id: 'active-shopping-lists', value: '2' }, { id: 'pending-shopping-items', value: '3' }, { id: 'shopping-handoffs-24h', value: '0' }, { id: 'shopping-handoffs-5d', value: '1' }], tiles: [], items: [], partial: false };
const OK = { '/api/purchasing/lists': { lists: LISTS }, '/api/purchasing/lists/l1/items': { items: ITEMS }, '/api/purchasing/home-summary': SUMMARY };
const section = (model, id) => model.sections.find((s) => s && s.id === id);
const stat = (model, id) => model.stats.find((s) => s.id === id);

test('on open the family view reads only the lists, the active list\x27s items and the home summary', async () => {
  const view = loadFamily(OK);
  await view.family({ refresh() {} });
  assert.deepEqual([...view.urls].sort(), ['/api/purchasing/home-summary', '/api/purchasing/lists', '/api/purchasing/lists/l1/items']);
  for (const url of view.urls) assert.doesNotMatch(url, /deals|search|resolve|config|chat|conversation|cart|suggestions|preferences|profile|checkout/, 'no catalog, concierge or profile read: ' + url);
});

test('the active list is the oldest active one; pending lines carry quantity, price and when; other lists are tiles', async () => {
  const view = loadFamily(OK);
  const model = await view.family({ refresh() {} });
  assert.equal(model.kicker, 'Our list');
  assert.equal(model.title, 'Synthetic Weekly Groceries', 'the archived list that comes first is never the active pick');
  assert.equal(model.lede, '2 things to pick up. Newest: Synthetic Bananas, added W(2026-09-21T09:00:00.000Z).');
  assert.deepEqual(model.stats.map((s) => [s.id, s.value]), [['pending', 2], ['lists', 3], ['added', 'W(2026-09-21T09:00:00.000Z)'], ['handoffs', '1']]);
  assert.equal(stat(model, 'handoffs').hint, 'Not confirmed purchases');
  const lines = section(model, 'items').items;
  assert.deepEqual(lines.map((l) => [l.title, l.text, l.meta]), [
    ['Synthetic Milk', '×2 · $3.48 each', 'added W(2026-09-20T18:00:00.000Z)'],
    ['Synthetic Bananas', '×1 · no price yet', 'added W(2026-09-21T09:00:00.000Z)'],
  ], 'the purchased line is left out');
  assert.equal(section(model, 'items').note, null, 'no warning when the summary is whole');
  const tiles = section(model, 'lists').items;
  assert.deepEqual(tiles.map((t) => [t.title, t.text, t.badge]), [['Synthetic Party Supplies', '0 things on it', 'Archived'], ['Synthetic Camping Trip', '1 thing on it', null]]);
  assert.ok(tiles.every((t) => !t.href && !t.onClick), 'the view adds, removes and opens nothing from a list tile');
  assert.equal(model.actions.length, 1);
  model.actions[0].onClick();
  assert.deepEqual(view.opened, ['/cockpit/?app=purchasing'], 'the one action escapes to Shopping in the cockpit');
});

test('with no list nothing else is read and the state says so; an empty list says so too', async () => {
  const none = loadFamily({ ...OK, '/api/purchasing/lists': { lists: [] } });
  const model = await none.family({ refresh() {} });
  assert.ok(!none.urls.some((u) => /\/items$/.test(u)), 'no items read without a list');
  assert.equal(model.title, 'No list yet');
  assert.equal(model.lede, 'Nothing has been started yet. Open Shopping to start a list.');
  assert.deepEqual([section(model, 'items').items, section(model, 'items').empty], [[], 'No list yet.']);
  assert.equal(section(model, 'lists'), undefined, 'no other-lists section without lists');
  const empty = await loadFamily({ ...OK, '/api/purchasing/lists/l1/items': { items: [] } }).family({ refresh() {} });
  assert.equal(empty.title, 'Synthetic Weekly Groceries');
  assert.equal(empty.lede, 'The list is empty. Add things in Shopping or on the home list.');
  assert.deepEqual([section(empty, 'items').items, section(empty, 'items').empty, stat(empty, 'added').value], [[], 'Nothing on the list yet.', '—']);
});

test('a failed home summary reads as unknown and keeps the list; a partial one is noted', async () => {
  const unknown = await loadFamily({ ...OK, '/api/purchasing/home-summary': { status: 503, body: { error: 'boom' } } }).family({ refresh() {} });
  assert.deepEqual([stat(unknown, 'handoffs').value, stat(unknown, 'handoffs').hint], ['—', 'Could not check']);
  assert.equal(section(unknown, 'items').items.length, 2, 'the list still shows');
  const partial = await loadFamily({ ...OK, '/api/purchasing/home-summary': { ...SUMMARY, partial: true } }).family({ refresh() {} });
  assert.match(section(partial, 'items').note, /could not be checked/);
});

test('a refusal is named, and a failed list read fails with its status, not a database message', async () => {
  const signedOut = await loadFamily({ ...OK, '/api/purchasing/lists': { status: 401, body: { error: 'Not authenticated' } } }).family({ refresh() {} });
  assert.equal(signedOut.title, 'Sign in to see the shopping list');
  assert.ok(!signedOut.stats && !signedOut.sections, 'a refusal paints no counts');
  const denied = await loadFamily({ ...OK, '/api/purchasing/home-summary': { status: 403, body: {} } }).family({ refresh() {} });
  assert.equal(denied.title, 'This account cannot open Shopping');
  await assert.rejects(loadFamily({ ...OK, '/api/purchasing/lists': { status: 500, body: { error: 'relation "shop_lists" does not exist' } } }).family({ refresh() {} }),
    /^Error: Shopping could not read the list \(HTTP 500\)\.$/);
});

/**
 * @description Run the dashboard's own script (the last script of the page) against a stub DOM, a stub fetch and a
 * kit whose active() answers as given, to observe whether its tab router starts and what it reads.
 * @param {string|null|undefined} activeView What AppView.active() answers; undefined leaves window.AppView absent.
 * @param {string} search The location.search the page opened with.
 * @returns {{ views: string[], fetched: string[] }} Every #view- selector shown and every URL fetched.
 */
function runDashboard(activeView, search) {
  const s = html.lastIndexOf('<script>'); const src = html.slice(s + 8, html.indexOf('</script>', s));
  const views = [], fetched = [];
  const node = (selector) => { if (/^#view-/.test(selector || '')) views.push(selector); return { classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, appendChild() {}, querySelector: node, dataset: {}, textContent: '', innerHTML: '', value: '' }; };
  const documentStub = { querySelector: node, querySelectorAll: () => [], createElement: () => node() };
  const fetchStub = (url) => { fetched.push(url); return Promise.resolve({ json: () => Promise.resolve({ items: [], lists: [] }) }); };
  const kit = activeView === undefined ? undefined : { active: () => activeView };
  new Function('window', 'document', 'location', 'fetch', 'AppView', src)({ AppView: kit }, documentStub, { search }, fetchStub, kit);
  return { views, fetched };
}

test('under an audience view the dashboard start does not run: ?view=deals reads nothing; without a view, and without the kit, the tab opens and its feed is read', () => {
  assert.deepEqual(runDashboard('family', '?view=deals&audience=family'), { views: [], fetched: [] });
  assert.deepEqual(runDashboard(null, '?view=deals'), { views: ['#view-deals'], fetched: ['/api/purchasing/deals?feed=rollback'] });
  assert.deepEqual(runDashboard(undefined, ''), { views: ['#view-shop'], fetched: [] }, 'a core without the kit runs the dashboard as before');
  assert.doesNotMatch(html, /^\s*showView\(new URLSearchParams/m, 'no ungated start is left');
});

// ── The concierge chat page: Shopping's first surface, framed by every shell (company and family) ─────────────────────

const CHAT_PAGE = 'tools/shopping-chat.html';
const CHAT_AUDIENCES = ['company', 'family'];
const chat = fs.readFileSync(path.join(ROOT, CHAT_PAGE), 'utf8');
const chatStart = chat.indexOf('<script src="/shared/ui/js/app-view.js"></script>');
const chatBlock = (() => { const s = chat.indexOf('<script>', chatStart); return chat.slice(s + 8, chat.indexOf('</script>', s)); })();
const harness = require('./shopping-routes-harness.js');
const cartTotals = require('../routes/cart-totals.js');
const cells = (row) => row.map((c) => (c && typeof c === 'object' ? c.text : c));

test('the chat page is the first surface the shells frame, and the package route serves it', () => {
  const manifest = fs.readFileSync(path.join(ROOT, 'oshal-app.yaml'), 'utf8');
  const ui = manifest.slice(manifest.search(/^ui:\s*$/m));
  assert.equal((ui.match(/iframeUrl: (\S+)/) || [])[1], '/api/purchasing/chat', 'the first ui.static entry');
  const routes = fs.readFileSync(path.join(ROOT, 'routes', 'purchasing-routes.js'), 'utf8');
  assert.match(routes, /router\.get\('\/chat', serveFile\(surfaceDir, 'shopping-chat\.html'\)\)/);
});

test('chat page: the shared kit follows the theme bootstrap once, ahead of the page\x27s own styles and scripts', () => {
  const bootstrap = chat.indexOf('<script src="/shared/ui/js/surface-theme.js"></script>');
  const css = chat.indexOf('<link rel="stylesheet" href="/shared/ui/css/app-view.css" />');
  assert.ok(bootstrap >= 0 && css > bootstrap && chatStart > css, 'app-view.css then app-view.js follow the bootstrap');
  assert.equal(chat.slice(bootstrap, chatStart).split('<script').length - 1, 1, 'no other script runs between the bootstrap and the kit');
  assert.ok(chat.indexOf(':root {') > chatStart, 'the page\x27s own styles come after the kit');
  assert.equal(chat.split('/shared/ui/js/app-view.js').length - 1, 1, 'the kit is included once');
  assert.match(chat.slice(css, chatStart), /html\[data-audience\] body \{ height: auto; overflow: auto; \}/, 'the viewport-pinned body scrolls under a view');
});

test('chat page: the boot names this application and exactly company and family; the block parses and only reads /api/purchasing', () => {
  const boot = chatBlock.match(/A\.boot\(\{([\s\S]*?)\}\);/);
  assert.ok(boot, 'A.boot({...}) present');
  assert.match(boot[1], new RegExp("app: '" + APP + "'"));
  const names = boot[1].match(/audiences: \{([^}]*)\}/)[1].split(',').map((s) => s.split(':')[0].trim()).filter(Boolean).sort();
  assert.deepEqual(names, CHAT_AUDIENCES);
  assert.match(boot[1], /escapeLabel: 'Open Shopping in the cockpit'/);
  assert.doesNotThrow(() => new Function(chatBlock));
  assert.deepEqual([...chatBlock.matchAll(/fetch\(\s*'([^']+)'/g)].map((m) => m[1]), ['/api/purchasing'], 'one fetch site, on this package\x27s own prefix');
  assert.equal(chatBlock.split('fetch(').length - 1, 1, 'no other fetch');
  assert.doesNotMatch(chatBlock, /innerHTML\s*=|window\.open\(|method:/, 'no HTML from data, no tab of its own, no write');
});

const day = (iso) => new Date(iso);
// Rows as Postgres hands them to the routes: Date timestamps, NUMERIC as strings; another shopper's older list is seeded too.
const SEED = {
  handoffs: 1,
  lists: [
    { list_id: 'l0', user_sub: 'shopper-a', name: 'Synthetic Party Supplies', status: 'archived', created_at: day('2026-08-01T12:00:00.000Z') },
    { list_id: 'l1', user_sub: 'shopper-a', name: 'Synthetic Weekly Groceries', status: 'active', created_at: day('2026-09-01T12:00:00.000Z') },
    { list_id: 'l2', user_sub: 'shopper-a', name: 'Synthetic Camping Trip', status: 'active', created_at: day('2026-09-10T12:00:00.000Z') },
    { list_id: 'lx', user_sub: 'shopper-b', name: 'Synthetic Other Shopper', status: 'active', created_at: day('2026-07-01T12:00:00.000Z') },
  ],
  items: [
    { item_id: 'i1', list_id: 'l1', user_sub: 'shopper-a', title: 'Synthetic Milk', quantity: 2, unit_price: '3.48', status: 'pending', created_at: day('2026-09-20T18:00:00.000Z') },
    { item_id: 'i2', list_id: 'l1', user_sub: 'shopper-a', title: 'Synthetic Bananas', quantity: 6, unit_price: '0.24', status: 'pending', created_at: day('2026-09-21T09:00:00.000Z') },
    { item_id: 'i3', list_id: 'l1', user_sub: 'shopper-a', title: 'Synthetic Dish Soap', quantity: 1, unit_price: null, status: 'pending', created_at: day('2026-09-19T09:00:00.000Z') },
    { item_id: 'i4', list_id: 'l1', user_sub: 'shopper-a', title: 'Synthetic Coffee', quantity: 1, unit_price: '8.98', status: 'purchased', created_at: day('2026-09-22T09:00:00.000Z') },
    { item_id: 'i5', list_id: 'l1', user_sub: 'shopper-a', title: 'Synthetic Removed', quantity: 1, unit_price: '1.00', status: 'removed', created_at: day('2026-09-23T09:00:00.000Z') },
    { item_id: 'i6', list_id: 'l2', user_sub: 'shopper-a', title: 'Synthetic Tent Stakes', quantity: 1, unit_price: '4.97', status: 'pending', created_at: day('2026-09-11T09:00:00.000Z') },
  ],
};

/**
 * @description A pool that answers exactly the SQL of GET /lists and GET /lists/:id/items the way Postgres would
 * (ordered by creation, the pending count as a string, removed lines left out) and records every statement.
 * @param {{ lists: object[], items: object[] }} seed The saved rows.
 * @param {boolean} failing When true every statement fails with a database message, as a missing table does.
 * @returns {{ sql: string[], query: Function }} The pool.
 */
function viewPool(seed, failing) {
  const sql = [], rows = (r) => ({ rows: r, rowCount: r.length }), byCreated = (a, b) => a.created_at - b.created_at;
  return {
    sql,
    async query(text, params = []) {
      const s = String(text).trim(); sql.push(s);
      if (failing) throw new Error('relation "shop_lists" does not exist');
      if (/^SELECT l\.list_id, l\.name, l\.status, l\.created_at,/.test(s)) {
        return rows(seed.lists.filter((l) => l.user_sub === params[0]).sort(byCreated).map((l) => ({ list_id: l.list_id, name: l.name, status: l.status, created_at: l.created_at,
          item_count: String(seed.items.filter((i) => i.list_id === l.list_id && i.status === 'pending').length) })));
      }
      if (/^SELECT \* FROM shop_list_items WHERE list_id = \$1 AND user_sub = \$2 AND status != 'removed' ORDER BY created_at/.test(s)) {
        return rows(seed.items.filter((i) => i.list_id === params[0] && i.user_sub === params[1] && i.status !== 'removed').sort(byCreated));
      }
      throw new Error('view pool cannot answer: ' + s.slice(0, 90));
    },
  };
}

/**
 * @description A pool for the home-summary route's four statements over the same seed; `failing` names what fails.
 * @param {{ lists: object[], items: object[], handoffs: number }} seed The saved rows and the five-day hand-off count.
 * @param {'handoffs'|'all'|null} failing 'handoffs' fails the hand-off count (a partial summary), 'all' fails every statement.
 * @returns {{ query: Function }} The pool.
 */
function summaryPool(seed, failing) {
  return {
    async query(q) {
      const text = q.text, sub = q.values[0];
      if (failing === 'all' || (failing === 'handoffs' && /shop_purchase_history/.test(text))) throw new Error('canceling statement due to statement timeout');
      const active = seed.lists.filter((l) => l.user_sub === sub && l.status === 'active').map((l) => l.list_id);
      const pending = seed.items.filter((i) => i.user_sub === sub && i.status === 'pending' && active.includes(i.list_id));
      if (/AS lists FROM shop_lists/.test(text)) return { rows: [{ lists: String(active.length) }] };
      if (/AS pending FROM shop_list_items/.test(text)) return { rows: [{ pending: String(pending.length) }] };
      if (/^SELECT i\.title, i\.quantity, l\.name, i\.created_at/.test(text)) return { rows: [] };
      if (/AS five_days FROM shop_purchase_history/.test(text)) return { rows: [{ day: '0', five_days: String(seed.handoffs) }] };
      throw new Error('summary pool cannot answer: ' + text.slice(0, 90));
    },
  };
}

/**
 * @description Load the package's compiled home-summary route (routes/home-summary.js) with only express stubbed.
 * @param {object} pool The pool it queries.
 * @returns {Function} Its GET / handler.
 */
function summaryRoute(pool) {
  let handler = null;
  const mod = { exports: {} };
  const shim = (request) => { if (request === 'express') return { Router: () => ({ get: (_p, h) => { handler = h; } }) }; throw new Error('unexpected require: ' + request); };
  new Function('require', 'module', 'exports', fs.readFileSync(path.join(ROOT, 'routes', 'home-summary.js'), 'utf8'))(shim, mod, mod.exports);
  mod.exports.createHomeSummaryRoutes({ pool });
  return handler;
}

/** @returns {object} A response recorder with the members the home-summary route uses. */
function recorder() { return { statusCode: 200, body: undefined, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } }; }

/**
 * @description Answer one view read with the package's real handler for it; anything else is the host's 404.
 * @param {string} url The URL the view fetched.
 * @param {{ handlers: object, summary: Function, request: Function }} routes The loaded handlers and the request maker.
 * @returns {Promise<{ statusCode: number, body: any }>} The recorded response.
 */
async function answer(url, routes) {
  const p = url.split('?')[0], items = p.match(/^\/api\/purchasing\/lists\/([^/]+)\/items$/);
  if (p === '/api/purchasing/home-summary') { const res = recorder(); await routes.summary(routes.request({}), res); return res; }
  if (p === '/api/purchasing/lists') return harness.call(routes.handlers, 'get', '/lists', routes.request({}));
  if (items) return harness.call(routes.handlers, 'get', '/lists/:listId/items', routes.request({ params: { listId: decodeURIComponent(items[1]) } }));
  return { statusCode: 404, body: { error: 'Synthetic endpoint unavailable' } };
}

/**
 * @description Run the chat page's head block against a stub kit and a fetch answered by the package's REAL routes
 * (the compiled purchasing router and the home-summary route over stub pools), each body JSON round-tripped as Express
 * sends it, so the views are asserted over the fields the routes actually return.
 * @param {{ seed?: object, sub?: string, signedIn?: boolean, answers?: object, failLists?: boolean, failSummary?: string|null }} [opts]
 *   `answers` overrides a URL with { status, body }.
 * @returns {{ company: Function, family: Function, urls: string[], opened: string[], sql: string[] }} Both builders and what they did.
 */
function loadChat({ seed = SEED, sub = 'shopper-a', signedIn = true, answers = {}, failLists = false, failSummary = null } = {}) {
  delete process.env.MOCK_OIDC;
  let config = null;
  const urls = [], opened = [], pool = viewPool(seed, failLists);
  const routes = { handlers: harness.loadRoutes({ pool }).handlers, summary: summaryRoute(summaryPool(seed, failSummary)),
    request: (extra) => (signedIn ? harness.authed(sub, extra) : harness.anon(extra)) };
  const kit = { boot: (c) => { config = c; }, when: (v) => 'W(' + v + ')', date: (v) => 'D(' + v + ')', day: (v) => 'DAY(' + v + ')', money: (v) => '$' + Number(v).toFixed(2), open: (href) => opened.push(href) };
  const fetchStub = async (url) => {
    urls.push(url);
    const res = answers[url] ? { statusCode: answers[url].status, body: answers[url].body } : await answer(url, routes);
    const body = res.body === undefined ? undefined : JSON.parse(JSON.stringify(res.body));
    return { ok: res.statusCode < 400, status: res.statusCode, json: () => (body === undefined ? Promise.reject(new SyntaxError('Unexpected end of JSON input')) : Promise.resolve(body)) };
  };
  new Function('window', 'fetch', chatBlock)({ AppView: kit }, fetchStub);
  assert.ok(config && typeof config.audiences.company === 'function' && typeof config.audiences.family === 'function', 'the block boots both audiences');
  return { company: () => config.audiences.company({ refresh() {} }), family: () => config.audiences.family({ refresh() {} }), urls, opened, sql: pool.sql };
}

test('chat page: on open each view reads only /lists, the active list\x27s items and the home summary, and the routes run only SELECTs', async () => {
  for (const audience of CHAT_AUDIENCES) {
    const view = loadChat();
    await view[audience]();
    assert.deepEqual([...view.urls].sort(), ['/api/purchasing/home-summary', '/api/purchasing/lists', '/api/purchasing/lists/l1/items'], audience);
    for (const url of view.urls) assert.doesNotMatch(url, /cart|deals|search|resolve|config|chat|conversation|suggestions|preferences|profile|checkout/, audience + ': ' + url);
    assert.equal(view.sql.length, 2);
    for (const statement of view.sql) assert.match(statement, /^SELECT /, audience + ': a read, never a write');
    assert.deepEqual(view.opened, []);
  }
});

test('chat page company view: the cart newest first with quantity, unit and line price; its total; the lists with the cart marked', async () => {
  const model = await loadChat().company();
  assert.equal(model.kicker, 'Productivity · Shopping');
  assert.equal(model.title, '3 lines in the cart');
  assert.equal(model.lede, 'Synthetic Weekly Groceries · last added W(2026-09-21T09:00:00.000Z). Checkout hands the cart to Walmart; nothing is charged here.');
  assert.deepEqual(model.stats.map((s) => [s.id, s.value, s.hint || null]), [['lines', 3, null], ['total', '$8.40', '1 without a price'], ['lists', 2, '1 archived'], ['handoffs', '1', 'Not confirmed purchases']]);
  assert.equal(stat(model, 'total').tone, 'warn', 'a total with an unpriced line is partial');
  const cart = section(model, 'cart');
  assert.deepEqual(cart.rows.map(cells), [
    ['Synthetic Bananas', '6', '$0.24', '$1.44', 'W(2026-09-21T09:00:00.000Z)'],
    ['Synthetic Milk', '2', '$3.48', '$6.96', 'W(2026-09-20T18:00:00.000Z)'],
    ['Synthetic Dish Soap', '1', 'no price', '—', 'W(2026-09-19T09:00:00.000Z)'],
  ], 'purchased and removed lines are left out');
  assert.equal(cart.note, null);
  assert.ok(cart.rows.every(Array.isArray), 'a plain row: nothing in the table opens, adds or removes');
  assert.deepEqual(section(model, 'lists').rows.map(cells), [
    ['Synthetic Party Supplies', 'Archived', '0', 'D(2026-08-01T12:00:00.000Z)'],
    ['Synthetic Weekly Groceries', 'Active · the cart', '3', 'D(2026-09-01T12:00:00.000Z)'],
    ['Synthetic Camping Trip', 'Active', '1', 'D(2026-09-10T12:00:00.000Z)'],
  ], 'the oldest ACTIVE list is the cart, as GET /cart picks it; another shopper\x27s list never appears');
  assert.equal(model.actions, undefined, 'the only way to act is the kit\x27s escape');
});

test('chat page company view: the cart total is the routes\x27 own whole-cent total, edge lines included', async () => {
  const lines = [['0.10', 3], ['0.20', 1], ['2.78', 12], [null, 1], ['1000000.00', 1]].map(([unit_price, quantity], n) => ({ item_id: 'e' + n, list_id: 'l1', user_sub: 'shopper-a',
    title: 'Synthetic Edge ' + n, quantity, unit_price, status: 'pending', created_at: new Date(Date.UTC(2026, 8, 1 + n)) }));
  const expected = cartTotals.cartTotalCents(lines);
  assert.deepEqual([expected.totalCents, expected.unpricedLines], [2830, 2], 'the module: 30 + 20 + 10 x 278 cents; no price and an oversized price are unpriced');
  const model = await loadChat({ seed: { ...SEED, items: lines } }).company();
  assert.deepEqual([stat(model, 'total').value, stat(model, 'total').hint], ['$' + (expected.totalCents / 100).toFixed(2), '2 without a price']);
  const row = cells(section(model, 'cart').rows.find((r) => r[0] === 'Synthetic Edge 2'));
  assert.deepEqual([row[1], row[3]], ['10', '$27.80'], 'a line counts at most ten, as the checkout counts it');
});

test('chat page family view: the household list in the dashboard\x27s words, over the same reads', async () => {
  const view = loadChat();
  const model = await view.family();
  assert.deepEqual([model.kicker, model.title], ['Our list', 'Synthetic Weekly Groceries']);
  assert.equal(model.lede, '3 things to pick up. Newest: Synthetic Bananas, added W(2026-09-21T09:00:00.000Z).');
  assert.deepEqual(model.stats.map((s) => [s.id, s.value]), [['pending', 3], ['lists', 3], ['added', 'W(2026-09-21T09:00:00.000Z)'], ['handoffs', '1']]);
  assert.deepEqual(section(model, 'items').items.map((l) => [l.title, l.text, l.meta]), [
    ['Synthetic Dish Soap', '×1 · no price yet', 'added W(2026-09-19T09:00:00.000Z)'],
    ['Synthetic Milk', '×2 · $3.48 each', 'added W(2026-09-20T18:00:00.000Z)'],
    ['Synthetic Bananas', '×6 · $0.24 each', 'added W(2026-09-21T09:00:00.000Z)'],
  ]);
  const tiles = section(model, 'lists').items;
  assert.deepEqual(tiles.map((t) => [t.title, t.text, t.badge]), [['Synthetic Party Supplies', '0 things on it', 'Archived'], ['Synthetic Camping Trip', '1 thing on it', null]]);
  assert.ok(tiles.every((t) => !t.href && !t.onClick), 'a list tile adds, removes and opens nothing');
  model.actions[0].onClick();
  assert.deepEqual(view.opened, ['/cockpit/?app=purchasing'], 'the one action escapes to Shopping in the cockpit');
});

test('chat page: no list, an empty list and a long cart each read as what they are', async () => {
  const none = loadChat({ seed: { ...SEED, lists: [] } });
  const company = await none.company();
  assert.ok(!none.urls.some((u) => /\/items$/.test(u)), 'no items read without a list');
  assert.deepEqual([company.title, stat(company, 'total').value, section(company, 'cart').empty, section(company, 'lists').rows], ['No cart yet', '—', 'No cart yet.', []]);
  assert.equal((await loadChat({ seed: { ...SEED, lists: [] } }).family()).title, 'No list yet');
  const empty = await loadChat({ seed: { ...SEED, items: [] } }).company();
  assert.deepEqual([empty.title, empty.lede, stat(empty, 'total').value, stat(empty, 'total').hint],
    ['The cart is empty', 'Synthetic Weekly Groceries has nothing pending. Open Shopping to add products.', '$0.00', null]);
  const many = Array.from({ length: 14 }, (_, n) => ({ item_id: 'm' + n, list_id: 'l1', user_sub: 'shopper-a', title: 'Synthetic Line ' + n, quantity: 1, unit_price: '1.00', status: 'pending', created_at: new Date(Date.UTC(2026, 8, 1 + n)) }));
  const long = await loadChat({ seed: { ...SEED, items: many } }).company();
  assert.equal(section(long, 'cart').rows.length, 12);
  assert.equal(section(long, 'cart').rows[0][0], 'Synthetic Line 13', 'newest first');
  assert.equal(section(long, 'cart').note, 'The newest 12 of 14 lines. Open Shopping for the whole cart.');
  assert.equal(stat(long, 'total').value, '$14.00', 'the total counts every line, not only the shown ones');
});

test('chat page: a partial summary and a failed summary read as unknown hand-offs and keep the cart', async () => {
  const partial = await loadChat({ failSummary: 'handoffs' }).company();
  assert.deepEqual([stat(partial, 'handoffs').value, stat(partial, 'handoffs').hint], ['—', 'Could not check'], 'the word Unavailable is not a count');
  assert.equal(section(partial, 'cart').note, 'Some saved shopping data could not be checked.');
  const failed = await loadChat({ failSummary: 'all' }).family();
  assert.deepEqual([stat(failed, 'handoffs').value, stat(failed, 'handoffs').hint], ['—', 'Could not check']);
  assert.equal(section(failed, 'items').items.length, 3, 'the list still shows when the summary answers 503');
});

test('chat page: the real 401, a 403 and the real 500 are each named, never a database message', async () => {
  const signedOut = await loadChat({ signedIn: false }).company();
  assert.deepEqual([signedOut.title, signedOut.lede, signedOut.stats, signedOut.sections],
    ['Sign in to see the shopping cart', 'Shopping shows the cart of whoever is signed in, and this session is not signed in.', undefined, undefined]);
  assert.equal((await loadChat({ signedIn: false }).family()).title, 'Sign in to see the shopping list');
  const denied = await loadChat({ answers: { '/api/purchasing/home-summary': { status: 403, body: { error: 'forbidden' } } } }).company();
  assert.deepEqual([denied.title, denied.lede], ['This account cannot open Shopping', 'The Shopping routes refused this account (HTTP 403).']);
  await assert.rejects(loadChat({ failLists: true }).company(), /^Error: Shopping could not read the cart \(HTTP 500\)\.$/);
  await assert.rejects(loadChat({ failLists: true }).family(), /^Error: Shopping could not read the list \(HTTP 500\)\.$/);
});

/** @returns {object} A stub element with the members the chat page's own scripts touch on start. */
function chatNode() {
  return { value: '', textContent: '', innerHTML: '', className: '', disabled: false, scrollTop: 0, scrollHeight: 0, style: {}, dataset: {}, tagName: 'DIV',
    classList: { toggle() {}, add() {}, remove() {} }, addEventListener() {}, appendChild() {}, setAttribute() {}, prepend() {}, focus() {}, querySelectorAll: () => [] };
}
/** @returns {object} A stub document that answers every lookup with a fresh stub element and binds nothing. */
function chatDom() { return { querySelector: chatNode, querySelectorAll: () => [], getElementById: chatNode, createElement: chatNode, addEventListener() {} }; }
/** @returns {string} The source of the chat page script whose body contains `marker`, without its tags. */
function chatScript(marker) {
  const at = chat.indexOf(marker), open = chat.lastIndexOf('<script', at), close = chat.indexOf('</script>', at);
  return chat.slice(chat.indexOf('>', open) + 1, close);
}
const kitSays = (active) => ({ active: () => active });
const AsyncFunction = (async () => {}).constructor;

/**
 * @description Run the chat page's classic script (the full concierge start) against a stub DOM and a stub fetch.
 * @param {object|undefined} kit What window.AppView is: a kit answering the active view, or undefined for a core without the kit.
 * @returns {Promise<string[]>} Every URL the start fetched, in order.
 */
async function runChatFull(kit) {
  const reads = [];
  const fetchStub = (url) => { reads.push(url); return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [], lists: [], profile: {}, preferences: [], total: 0, walmartConnected: false }) }); };
  new Function('window', 'AppView', 'document', 'fetch', 'localStorage', chatScript("const API = '/api/purchasing';"))({ AppView: kit, addEventListener() {} }, kit, chatDom(), fetchStub, { getItem: () => null, setItem() {} });
  await new Promise((resolve) => setTimeout(resolve, 20));
  return reads;
}

/**
 * @description Run the assistant-rail module script with its dynamic imports answered by stubs.
 * @param {object|undefined} kit What window.AppView is.
 * @returns {Promise<{ imports: number, attached: number, ready: number }>} Modules imported, clients attached, bridge-ready events.
 */
async function runChatRail(kit) {
  const calls = { imports: 0, attached: 0, ready: 0 };
  const src = chatScript('surface-bridge-client.js').replace(/await import\('([^']+)'\)/g, "await __import('$1')");
  const modules = { createSurfaceBridgeClient: () => ({ attach: () => { calls.attached++; } }), createSurfaceProducer: () => ({}) };
  await new AsyncFunction('window', 'AppView', 'Event', 'console', '__import', src)({ AppView: kit, dispatchEvent: () => { calls.ready++; } }, kit, function Event() {}, { warn() {} }, () => { calls.imports++; return Promise.resolve(modules); });
  return calls;
}

/**
 * @description Run the handoff module script (its static imports stripped) against stub modules and a stub DOM.
 * @param {object|undefined} kit What window.AppView is.
 * @returns {Promise<{ handoffs: number, mounted: number }>} Handoff listeners bound and connected-actions mounts.
 */
async function runChatHandoff(kit) {
  const calls = { handoffs: 0, mounted: 0 };
  const src = chatScript('receiveHandoff(').replace(/^import .*$/gm, '');
  await new AsyncFunction('window', 'AppView', 'document', 'receiveHandoff', 'mountConnectedActions', src)({ AppView: kit }, kit, chatDom(), () => { calls.handoffs++; }, () => { calls.mounted++; return Promise.resolve(); });
  await new Promise((resolve) => setTimeout(resolve, 0));
  return calls;
}

const CHAT_FULL_READS = ['/api/purchasing/profile', '/api/purchasing/preferences', '/api/purchasing/cart', '/api/purchasing/deals?feed=rollback', '/api/purchasing/config'];

test('chat page: under either view the concierge start reads nothing (the list-creating /cart and the Walmart deals feed included); without one, and with no kit, it reads what it always did', async () => {
  assert.deepEqual(await runChatFull(kitSays('company')), []);
  assert.deepEqual(await runChatFull(kitSays('family')), []);
  assert.deepEqual(await runChatFull(kitSays(null)), CHAT_FULL_READS);
  assert.deepEqual(await runChatFull(undefined), CHAT_FULL_READS);
  assert.doesNotMatch(chat, /^boot\(\);$/m, 'no ungated start is left');
});

test('chat page: under either view the assistant rail is not attached and no handoff listener or connected-actions mount runs; without one they all do', async () => {
  for (const audience of CHAT_AUDIENCES) {
    assert.deepEqual(await runChatRail(kitSays(audience)), { imports: 0, attached: 0, ready: 0 }, audience);
    assert.deepEqual(await runChatHandoff(kitSays(audience)), { handoffs: 0, mounted: 0 }, audience);
  }
  assert.deepEqual(await runChatRail(kitSays(null)), { imports: 2, attached: 1, ready: 1 });
  assert.deepEqual(await runChatRail(undefined), { imports: 2, attached: 1, ready: 1 });
  assert.deepEqual(await runChatHandoff(kitSays(null)), { handoffs: 1, mounted: 1 });
  assert.deepEqual(await runChatHandoff(undefined), { handoffs: 1, mounted: 1 });
});
