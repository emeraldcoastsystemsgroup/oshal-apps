/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | A refused Walmart call (HTTP 503: no Walmart connection on this installation) is shown as "Not connected" in the shopping page and the dashboard, never as "No products matched" or an empty deals grid, and no comparison price is invented for Amazon or Target, which have no connector. The guard EXECUTES the shipped search(), loadDeals(), checkout() and comparisonRows() out of the surfaces.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The refusal names the installation's fact (no Walmart rail: it runs no Walmart operations) and never says a Walmart connection can be added; connecting one would not help here.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | UX audit 2026-11-05 (shop-lists): the dashboard is the List screen; without a retail rail (GET /deals 503) its storefront and Checkout are not rendered and a refused search is an alert in the error colour, never green header text.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Shopping 1.5.0: the List screen has Order in place of the rail-only Checkout. Without a rail the storefront is still not rendered, Order is enabled as soon as an item is left to buy, and opening the page makes no order.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

/** One declaration (function, async function or one-line const) cut out of the shipped surface. */
function extract(source, name) {
  const constant = new RegExp(`^\\s*const ${name} = .*;$`, 'm').exec(source);
  if (constant) return constant[0].trim();
  let start = source.search(new RegExp(`(async )?function ${name}\\(`));
  assert.ok(start >= 0, `${name} is not in the surface`);
  let depth = 0;
  for (let i = source.indexOf('{', source.indexOf(')', start)); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`${name} is never closed`);
}

/** A DOM element double: only the fields the surface writes and reads. */
function element() {
  return { textContent: '', innerHTML: '', value: '', style: {}, dataset: {}, hidden: false, disabled: false, className: '',
    classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } }, addEventListener() {}, appendChild(c) { return c; } };
}

/** Run named declarations from the surface in a sandbox whose fetch answers `respond(url, init)`. */
function surface(source, names, respond, extra = {}) {
  const elements = new Map();
  const el = (key) => { if (!elements.has(key)) elements.set(key, element()); return elements.get(key); };
  const sandbox = { Number, String, Boolean, Object, Array, Math, JSON, Error, Map, Set, Promise, URLSearchParams, encodeURIComponent,
    console, setTimeout: () => 0, clearTimeout() {}, $: el,
    document: { getElementById: (id) => el(`#${id}`), querySelector: el, querySelectorAll: () => [], createElement: () => element() },
    window: { open() {} }, localStorage: { getItem: () => null, setItem() {} },
    fetch: async (url, init) => { const [status, body] = await respond(String(url), init || {}); return { status, ok: status >= 200 && status < 300, json: async () => body }; },
    ...extra };
  vm.createContext(sandbox);
  new vm.Script(names.map((name) => extract(source, name)).join('\n') + '\n' +
    `globalThis.__exports = {${names.filter((n) => !/^[A-Z_]+$/.test(n)).join(',')}};`).runInContext(sandbox);
  return { el, fns: sandbox.__exports, sandbox };
}

const chat = fs.readFileSync(path.join(__dirname, '..', 'tools', 'shopping-chat.html'), 'utf8');
const dashboard = fs.readFileSync(path.join(__dirname, '..', 'tools', 'shopping-dashboard.html'), 'utf8');
const NAMES = ['NOT_CONNECTED', 'readBody', 'getJson', 'postJson', 'providerRefused', 'showNotConnected', 'escapeHtml', 'search', 'loadDeals', 'checkout', 'comparisonRows'];
const REFUSED = [503, { error: 'native_executor_unavailable' }];
const toasts = [];
const stubs = () => ({ API: '/api/purchasing', state: { products: [], listId: 'l1' }, renderChips() {}, publishContext() {},
  hydrateProductEvents() {}, selectProduct() {}, renderProductCard: (p) => `<card>${p.title}</card>`, toast: (t) => toasts.push(t) });

test('a refused product search and deals feed say Walmart is not connected', async () => {
  const page = surface(chat, NAMES, () => REFUSED, stubs());
  page.el('#shipAddress').value = '';
  await page.fns.search('soap');
  assert.match(page.el('#grid').innerHTML, /no Walmart rail \(it runs no Walmart operations\)/);
  assert.doesNotMatch(page.el('#grid').innerHTML, /connection is added|\/utilities|connect it/i);
  assert.doesNotMatch(page.el('#grid').innerHTML, /No products matched/);
  await page.fns.loadDeals();
  assert.match(page.el('#grid').innerHTML, /Unavailable: this installation has no Walmart rail/);
  await page.fns.checkout();
  assert.match(toasts.pop(), /no Walmart rail, so checkout cannot open/);
});

test('a real empty search still reads as no matches', async () => {
  const page = surface(chat, NAMES, () => [200, { items: [], source: 'walmart' }], stubs());
  await page.fns.search('nothing');
  assert.match(page.el('#grid').innerHTML, /No products matched that search/);
});

test('no comparison price is invented for a retailer with no connector', () => {
  const page = surface(chat, NAMES, () => REFUSED, stubs());
  const rows = page.fns.comparisonRows({ price: 10 });
  assert.equal(rows.find((r) => r.vendor === 'Walmart').price, 10);
  for (const vendor of ['Amazon', 'Target']) assert.equal(rows.find((r) => r.vendor === vendor).price, null, vendor);
});

test('List without a retail rail: the storefront is not rendered, Order is ready, and a refused search is an alert', async () => {
  const script = /<script>([\s\S]*?)<\/script>/g;
  let main = '';
  for (const match of dashboard.matchAll(script)) if (match[1].includes("const api = (p, opts)")) main = match[1];
  assert.ok(main, 'the List script defines api()');
  const els = {};
  const el = (sel) => (els[sel] ||= { sel, hidden: false, disabled: false, textContent: '', innerHTML: '', value: '',
    classes: new Set(['hidden']), classList: { toggle(c, on) { on ? els[sel].classes.add(c) : els[sel].classes.delete(c); }, add(c) { els[sel].classes.add(c); }, remove(c) { els[sel].classes.delete(c); } },
    addEventListener() {}, setAttribute() {}, replaceChildren() {}, append() {}, appendChild() {}, focus() {} });
  const reads = [];
  const answers = { '/api/purchasing/deals?feed=rollback': [503, { error: 'native_executor_unavailable' }], '/api/purchasing/lists': [200, { lists: [{ list_id: 'l1' }] }],
    '/api/purchasing/lists/l1/items': [200, { items: [{ item_id: 'i1', title: 'milk', quantity: 1, status: 'pending' }] }] };
  const sandbox = { Object, Number, String, JSON, encodeURIComponent, URLSearchParams, location: { search: '?view=lists' }, window: {},
    document: { querySelector: el, createElement: () => el('new-' + Math.random()) },
    fetch: async (url) => { reads.push(url); const [status, body] = answers[url] || [404, {}]; return { status, json: async () => body }; } };
  vm.createContext(sandbox);
  new vm.Script(`${main.replace(/\n\s*if \(!window\.AppView \|\| !AppView\.active\(\)\) start\(\);\s*$/, '')}\nglobalThis.start = start; globalThis.rail = () => RAIL;`).runInContext(sandbox);
  await sandbox.start();
  assert.equal(reads[0], '/api/purchasing/deals?feed=rollback', 'one readiness read first');
  assert.equal(sandbox.rail(), false);
  assert.ok(els['#storefront'].classes.has('hidden'), 'no search, no deals without a rail');
  assert.equal(els['#order'].disabled, false, 'Order needs no rail: it is ready as soon as something is left to buy');
  assert.doesNotMatch(dashboard, /id="checkout"/, 'the rail-only Checkout button is gone');
  assert.ok(!reads.some((u) => /\/search|\/checkout|\/order/.test(u)), 'nothing else from the store is asked, and no order is made by opening the page');
  assert.match(main, /const NOT_CONNECTED = 'Shopping at a store is not connected on this installation\. Ask your administrator to connect a retailer\.';/);
  assert.match(main, /if \(providerRefused\(found\)\) \{ showAlert\(NOT_CONNECTED\); return; \}/, 'a refused search is an alert');
  assert.match(dashboard, /<div id="alert" class="alert hidden" role="alert"><\/div>/);
  assert.doesNotMatch(dashboard, /class="tabs"|data-view="deals"/, 'no inner Shop | List | Deals bar');
});
