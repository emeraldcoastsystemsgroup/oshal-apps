/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | A refused Uber Eats call (HTTP 503: no Uber Eats connection on this installation) is shown as "Not connected" and never as "No restaurants matched that craving."
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | The refusal names the installation's fact and never says a connection can be added.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | 1.5.0: the search is a POST carrying query, address, limit and refresh; the saved-line helpers are run with it.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | 1.4.0: the restaurants are real (Google Places) and the page's states are the server's: a search without an address shows the address sentence and makes no request; a refused search (503 with the server's sentence: key not configured, Places API not enabled, quota) shows that sentence, never "no restaurants matched"; an empty 200 still reads as no match; a 200 with restaurants renders cards with an Order on Uber Eats button; the concierge turn shows a 503's sentence as the reply. The guard EXECUTES the shipped search() and sendChat() out of the surface against a scripted fetch.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'tools', 'eats-app.html'), 'utf8');
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
  return { textContent: '', innerHTML: '', value: '', href: '', hidden: true, style: {}, dataset: {}, disabled: false, className: '',
    classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } }, addEventListener() {}, appendChild(c) { return c; }, setAttribute() {} };
}
/** Run named declarations from the surface in a sandbox whose fetch answers `respond(url, init)`. */
function surface(source, names, respond, extra = {}) {
  const elements = new Map();
  const requests = [];
  const el = (key) => { if (!elements.has(key)) elements.set(key, element()); return elements.get(key); };
  const sandbox = { Number, String, Boolean, Object, Array, Math, JSON, Error, Map, Set, Promise, URLSearchParams, encodeURIComponent,
    console, setTimeout: () => 0, clearTimeout() {}, $: el,
    document: { getElementById: (id) => el(`#${id}`), querySelector: el, querySelectorAll: () => [], createElement: () => element() },
    window: { open() {} }, localStorage: { getItem: () => null, setItem() {} },
    fetch: async (url, init) => { requests.push({ url: String(url), init: init || {} }); const [status, body] = await respond(String(url), init || {}); return { status, ok: status >= 200 && status < 300, json: async () => body }; },
    ...extra };
  vm.createContext(sandbox);
  new vm.Script(names.map((name) => extract(source, name)).join('\n') + '\n' +
    `globalThis.__exports = {${names.filter((n) => !/^[A-Z_]+$/.test(n)).join(',')}};`).runInContext(sandbox);
  return { el, fns: sandbox.__exports, sandbox, requests };
}
const NAMES = ['ADDRESS_NEEDED', 'readBody', 'getJson', 'postJson', 'searchFailed', 'showUnavailable', 'showAddressNeeded', 'escapeHtml', 'restaurantMeta', 'renderRestaurantCard', 'savedAgo', 'showSavedLine', 'search', 'sendChat'];
const DISABLED = [503, { error: 'disabled', message: 'Places API (New) is not enabled for this installation\'s Google key (project 1085759851735). Enable it at https://console.developers.google.com/apis/api/places.googleapis.com/overview?project=1085759851735, then try again in a minute.', source: 'Google Places' }];
const stubs = () => ({ API: '/api/eats', state: { restaurants: [], place: null, query: '', heading: '' }, renderChips() {}, publishContext() {}, hydrateCards() {},
  addMessage: () => ({ textContent: '', classList: { add() {} }, setAttribute() {} }), proposeOrder() {} });
const withAddress = (page) => { page.el('#address').value = '1 Synthetic Way, Pensacola'; return page; };

test('a refused restaurant search shows the server\'s sentence, never that nothing matched', async () => {
  const page = withAddress(surface(html, NAMES, () => DISABLED, stubs()));
  await page.fns.search('pizza');
  assert.match(page.el('#grid').innerHTML, /Places API \(New\) is not enabled for this installation/);
  assert.match(page.el('#grid').innerHTML, /role="alert"/);
  assert.doesNotMatch(page.el('#grid').innerHTML, /No restaurants matched/);
  assert.equal(page.requests[0].url, '/api/eats/search');
  assert.equal(page.requests[0].init.method, 'POST', 'a POST, so the server may save what Google answers');
  assert.deepEqual(JSON.parse(page.requests[0].init.body), { query: 'pizza', address: '1 Synthetic Way, Pensacola', limit: 16, refresh: false });
});

test('a search without an address asks for one and makes no request', async () => {
  const page = surface(html, NAMES, () => DISABLED, stubs());
  await page.fns.search('pizza');
  assert.match(page.el('#grid').innerHTML, /Set your delivery address first/);
  assert.deepEqual(page.requests, []);
});

test('a real empty answer still reads as no match, and restaurants render with an Uber Eats button', async () => {
  const empty = withAddress(surface(html, NAMES, () => [200, { items: [], place: { address: '1 Synthetic Way, Pensacola, FL' }, source: 'Google Places' }], stubs()));
  await empty.fns.search('durian');
  assert.match(empty.el('#grid').innerHTML, /No restaurants matched that craving near your address/);
  const item = { placeId: 'ChIJ-taco-mahal', name: 'Taco Mahal', cuisine: 'Mexican restaurant', rating: 4.6, ratingCount: 57, priceLabel: '$', openNow: true, delivery: true, distanceKm: 1.2, address: '12 Synthetic St', photo: null, mapsUrl: 'https://maps.google.com/?cid=1' };
  const full = withAddress(surface(html, NAMES, () => [200, { items: [item], place: { address: '1 Synthetic Way, Pensacola, FL 32502, USA' }, feedUrl: 'https://www.ubereats.com/feed?diningMode=DELIVERY&pl=x' }], stubs()));
  await full.fns.search('tacos');
  const grid = full.el('#grid').innerHTML;
  assert.match(grid, /data-place="ChIJ-taco-mahal"/);
  assert.match(grid, /Taco Mahal/);
  assert.match(grid, /Mexican restaurant · \$ · Open now · 1\.2 km/);
  assert.match(grid, /data-order="ChIJ-taco-mahal">Order on Uber Eats</);
  assert.match(grid, /★ 4\.6 \(57\)/);
  assert.equal(full.el('#sectionSub').textContent, 'Delivering to 1 Synthetic Way, Pensacola, FL 32502, USA');
  assert.equal(full.el('#feedLink').hidden, false);
});

test('a concierge turn refused by the restaurant source shows its sentence as the reply', async () => {
  const pending = { textContent: '' };
  const page = withAddress(surface(html, NAMES, () => DISABLED, { ...stubs(), addMessage: () => pending }));
  page.el('#chatInput').value = 'tacos';
  await page.fns.sendChat();
  assert.match(pending.textContent, /Places API \(New\) is not enabled/);
});
