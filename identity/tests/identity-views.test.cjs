/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-06 (identity--identity-home, SPLIT): the hub opened on 829
 *   unconfigured connectors with "Other" first while the one account needing attention was out of sight. Guards the two
 *   views (Your accounts by default, the Connector catalog behind the second tab), the attention item first, the catalog
 *   hiding "Not configured" stubs until Show unavailable, paging at 48, "Other" last, one primary per view, no pill or
 *   "Not connected yet." line on a connector nobody connected, and the one label set ("Needs attention", "Available").
 *
 * Runs the shipped page script in a vm over a stub DOM and a stub fetch, so the bytes the browser runs are under test.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.resolve(__dirname, '..', 'tools', 'identity.html'), 'utf8');
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((b) => /async function load\(\)/.test(b));

function stubElement() {
  const attrs = {};
  return {
    innerHTML: '', value: '', textContent: '', disabled: false, hidden: false, checked: false, onclick: null,
    classList: { toggle() {}, add() {}, remove() {} },
    querySelectorAll: () => [], addEventListener() {}, focus() {},
    getAttribute: (k) => (k in attrs ? attrs[k] : null), setAttribute: (k, v) => { attrs[k] = String(v); },
  };
}

/** Run the page over one /api/connect/list payload; `hash` is the address's fragment. */
async function page(providers, hash = '') {
  const nodes = new Map();
  const document = { getElementById(id) { if (!nodes.has(id)) nodes.set(id, stubElement()); return nodes.get(id); } };
  const fetchStub = async (url) => {
    if (url.startsWith('/api/connect/list')) return { ok: true, status: 200, json: async () => ({ providers }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const replaced = [];
  const sandbox = {
    document, fetch: fetchStub, window: { open() {} }, console: { warn() {}, error() {}, log() {} }, setTimeout, clearTimeout,
    location: { pathname: '/api/identity/', search: '', hash },
    history: { replaceState: (a, b, url) => replaced.push(url) },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(`${script}\n;globalThis.__s = { load, setView, renderProviders, view: () => activeView,
    unavailable: (v) => { showUnavailable = v; catalogLimit = CATALOG_PAGE; renderProviders(); },
    more: () => { catalogLimit += CATALOG_PAGE; renderProviders(); } };`, sandbox, { filename: 'identity.html' });
  await sandbox.__s.load();
  return { nodes, s: sandbox.__s, replaced };
}

const p = (id, extra = {}) => ({ id, label: id, auth: 'oauth', configured: true, connected: false, status: 'not_connected', connections: [], ...extra });
const names = (markup) => [...markup.matchAll(/<span class="name">([^<]+)<\/span>/g)].map((m) => m[1]);

test('the hub opens on Your accounts: granted and attention accounts only, the attention item first', async () => {
  const { nodes, s } = await page([
    p('zeta-mail', { connected: true, status: 'connected', category: 'email' }),
    p('alpha-cloud', { status: 'expired' }),
    p('spare', {}),
  ]);
  assert.equal(s.view(), 'accounts');
  assert.equal(nodes.get('view-accounts').hidden, false);
  assert.equal(nodes.get('view-catalog').hidden, true);
  assert.equal(nodes.get('tab-accounts').getAttribute('aria-selected'), 'true');
  assert.deepEqual(names(nodes.get('accounts').innerHTML), ['alpha-cloud', 'zeta-mail'], 'attention first, nothing ungranted');
  assert.match(nodes.get('accounts').innerHTML, /data-start="alpha-cloud">Reconnect</);
});

test('with nothing granted Your accounts shows the empty state and the one primary stays Add a connection', async () => {
  const { nodes } = await page([p('spare')]);
  assert.match(nodes.get('accounts').innerHTML, /No accounts connected yet/);
  const accountsView = html.slice(html.indexOf('id="view-accounts"'), html.indexOf('id="view-catalog"'));
  assert.equal((accountsView.match(/class="btn primary"/g) || []).length, 1, 'one primary in Your accounts');
  assert.match(accountsView, /id="addBtn"[^>]*>.*Add a connection/);
  assert.match(accountsView, /class="btn ghost" type="button" id="reviewBtn"/, 'Access review is secondary');
  const catalogView = html.slice(html.indexOf('id="view-catalog"'), html.indexOf('<script>', html.indexOf('id="view-catalog"')));
  assert.equal((catalogView.match(/btn primary/g) || []).length, 0, 'the catalog has no second primary');
});

test('Add a connection and the catalog tab open the catalog; the address keeps the view', async () => {
  const { nodes, s, replaced } = await page([p('spare')]);
  nodes.get('addBtn').onclick();
  assert.equal(s.view(), 'catalog');
  assert.equal(nodes.get('view-catalog').hidden, false);
  assert.equal(replaced.at(-1), '/api/identity/#view=catalog');
  nodes.get('tab-accounts').onclick();
  assert.equal(s.view(), 'accounts');
  const reopened = await page([p('spare')], '#view=catalog');
  assert.equal(reopened.s.view(), 'catalog', 'Reload on #view=catalog opens the catalog');
});

test('the catalog hides connectors whose sign-in is not configured until Show unavailable is on', async () => {
  const { nodes, s } = await page([p('ready'), p('stub', { configured: false }), p('token', { configured: false, auth: 'api_key' })]);
  assert.deepEqual(names(nodes.get('main').innerHTML).sort(), ['ready', 'token']);
  s.unavailable(true);
  assert.ok(names(nodes.get('main').innerHTML).includes('stub'));
  assert.match(nodes.get('main').innerHTML, /Not configured/);
});

test('an unconnected card carries no pill and no "Not connected yet." line, and its action reads Set up', async () => {
  const { nodes } = await page([p('ready')]);
  const main = nodes.get('main').innerHTML;
  assert.doesNotMatch(main, /pill off|Not connected yet/);
  assert.match(main, /data-start="ready">Set up</);
  assert.doesNotMatch(main, /btn primary/, 'no card action is a second primary');
});

test('the catalog shows 48 cards, then Show more; "Other" comes last', async () => {
  const many = Array.from({ length: 60 }, (_, i) => p('c' + String(i).padStart(2, '0'), { category: i < 5 ? 'email' : undefined }));
  many.push(p('files-thing', { category: 'Files' }));
  const { nodes, s } = await page(many);
  assert.equal(names(nodes.get('main').innerHTML).length, 48);
  assert.equal(nodes.get('catalogMore').hidden, false);
  const cats = [...nodes.get('main').innerHTML.matchAll(/<div class="cat">([^<]+)<\/div>/g)].map((m) => m[1]);
  assert.deepEqual(cats, ['Email &amp; Calendar', 'Files', 'Other']);
  s.more();
  assert.equal(names(nodes.get('main').innerHTML).length, 61);
  assert.equal(nodes.get('catalogMore').hidden, true);
  assert.match(nodes.get('identityCategory').innerHTML, /All categories \(3\)/);
});

test('the meta line uses one label set: Needs attention and Available', async () => {
  const { nodes } = await page([p('a', { status: 'expired' }), p('b')]);
  const meta = nodes.get('identityMetrics').innerHTML;
  assert.match(meta, /Needs attention<\/span><strong>1</);
  assert.match(meta, /Available<\/span><strong>2</);
  assert.doesNotMatch(meta + html, /Need attention<|Ready to enable/);
});
