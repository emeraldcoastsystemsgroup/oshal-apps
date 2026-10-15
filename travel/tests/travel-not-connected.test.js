/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | A refused Duffel search (HTTP 503: no Duffel connection on this installation) is shown as "Not connected", never as "Showing demo data ... No options found"; the audience view says Not connected instead of Demo; and the package declares the migration that creates every table its routes query (the concierge answered HTTP 500 when they did not exist). The guard EXECUTES the shipped doSearch() and sendChat() out of the surface.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The refusal and the audience view name the installation's fact (no Duffel rail, no Duffel connector exists here) and offer no Connect button for a connector that does not exist. Other apps can plan around the trip typed in the form before (or without) a search, labelled not searched. At phone width the page flows (body and main are blocks), so the connected-actions section no longer covers the form and the concierge.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | With no Duffel rail the concierge's greeting no longer promises a price read or a fare watch (live, it said it "can watch a route for a drop").
 * 4 | maintainer@emeraldcoastsystemsgroup.com | The typed-trip offer reads as a sentence ("From PNS to DCA, depart ...") instead of raw JSON; the form-state cases live in travel-form-state.test.js.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Sweep 14: the concierge offered "I can search for demo hotel options" while hotels answered 503. The persona says hotels and cars come through the same Duffel rail, are never offered before a search returned results, and are called demo only when a search marked them demo.
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

const PKG = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(PKG, 'tools', 'travel-app.html'), 'utf8');
const NAMES = ['api', 'NOT_CONNECTED', 'showNotConnected', 'esc', 'doSearch', 'sendChat'];
const REFUSED = [503, { error: 'native_executor_unavailable' }];
const stubs = () => ({ API: '/api/travel', KIND: 'flight', LAST: { search: null, items: [] }, convId: null, render() { throw new Error('a refusal is not a result list'); },
  priceBand() {}, flightCard: () => '', simpleCard: () => '' });

test('a refused flight search says Duffel is not connected, not "No options found"', async () => {
  const page = surface(html, NAMES, () => REFUSED, stubs());
  page.sandbox.val = (id) => page.el(`#${id}`).value;
  for (const [id, value] of [['f_origin', 'VPS'], ['f_dest', 'ATL'], ['f_depart', '2026-12-01'], ['f_cabin', 'economy']]) page.el(`#${id}`).value = value;
  await page.fns.doSearch();
  assert.match(page.el('#results').innerHTML, /no Duffel rail \(no Duffel connector exists here\)/);
  assert.doesNotMatch(page.el('#results').innerHTML, /\/utilities|Connections page|connect a Duffel/i);
  assert.equal(page.el('#mode').textContent, 'not connected');
  assert.equal(page.sandbox.LAST.search, null, 'a refused search leaves nothing for the concierge to send');
});

test('a refused concierge turn says not connected instead of "Sorry — HTTP 503"', async () => {
  const page = surface(html, NAMES, () => REFUSED, stubs());
  const log = [];
  page.sandbox.addBubble = (who, text) => log.push(text);
  page.el('#chatbox').value = 'find me a fare';
  await page.fns.sendChat();
  assert.match(log.pop(), /Unavailable: this installation has no Duffel rail/);
});

test('the audience view says there is no Duffel connector here, and offers no Connect button for it', () => {
  const page = surface(html, ['prices', 'hero'], () => REFUSED, { A: { open() {}, when: () => '', day: () => '' }, place: () => '', tripDay: () => '' });
  const none = page.fns.prices({ connected: false, live: false, mode: 'not_connected' });
  assert.deepEqual([none.value, none.hint], ['None here', 'No Duffel connector on this installation']);
  assert.equal(page.fns.hero([], null, 0, 0, true, false).actions.map((a) => a.label).join(' | '), 'Plan a trip', 'nothing to connect where no connector exists');
  assert.equal(page.fns.hero([], null, 0, 0, true, true).actions.map((a) => a.label).join(' | '), 'Plan a trip | Connect live prices');
  assert.equal(page.fns.prices({ connected: true, live: true, mode: 'live' }).value, 'Live');
});

test('the package migration creates every travel table the routes query', () => {
  const manifest = fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8');
  const declared = /^migrations:\n((?:  - .+\n)+)/m.exec(manifest);
  assert.ok(declared, 'travel declares its migrations');
  const sql = declared[1].trim().split('\n').map((line) => fs.readFileSync(path.join(PKG, line.replace(/^- /, '').trim()), 'utf8')).join('\n');
  const created = new Set([...sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]));
  const routes = fs.readdirSync(path.join(PKG, 'routes')).filter((f) => f.endsWith('.js'))
    .map((f) => fs.readFileSync(path.join(PKG, 'routes', f), 'utf8')).join('\n');
  const used = new Set([...routes.matchAll(/(?:FROM|INTO|UPDATE)\s+(travel_\w+)/g)].map((m) => m[1]));
  assert.ok(used.size >= 6, `the routes query the travel tables (${[...used]})`);
  for (const table of used) assert.ok(created.has(table), `${table} is queried but no migration creates it`);
  assert.ok(created.has('travel_observations'), 'the price engine writes travel_observations');
});

test('another app can plan around the typed trip without a search, labelled not searched', () => {
  const page = surface(html, ['typedTrip', 'describeTrip', 'tripOfferContext'], () => REFUSED, { KIND: 'flight', LAST: { search: null } });
  page.sandbox.val = (id) => page.el(`#${id}`).value.trim();
  for (const [id, value] of [['f_origin', 'pns'], ['f_dest', 'DCA'], ['f_depart', '2026-11-20'], ['f_cabin', 'economy']]) page.el(`#${id}`).value = value;
  const offer = page.fns.tripOfferContext();
  assert.equal(offer.title, 'Plan around my flight trip (not searched)');
  assert.equal(offer.notes, 'Travel plan as typed, not searched and not booked: From PNS to DCA, depart 2026-11-20, economy cabin.');
  page.sandbox.LAST.search = { origin: 'PNS', destination: 'DCA', departDate: '2026-11-20' };
  assert.equal(page.fns.tripOfferContext().title, 'Prepare for my flight search');
  page.sandbox.LAST.search = null;
  page.el('#f_origin').value = '';
  assert.equal(page.fns.tripOfferContext(), null, 'no route typed, nothing to offer');
});

test('at phone width the page flows, so the connected-actions section sits after the form and the concierge', () => {
  const phone = /@media \(max-width:820px\)\{([\s\S]*?)\n  \}/.exec(html);
  assert.ok(phone, 'the narrow-screen rules exist');
  assert.match(phone[1], /html,body\{height:auto;min-height:100%;\}/);
  assert.match(phone[1], /body\{display:block;\}/);
  assert.match(phone[1], /main\{display:block;\}/);
});

test('with no Duffel rail the greeting promises no price read and no fare watch', () => {
  const greeting = /const NO_RAIL_GREETING = '([^']+)';/.exec(html);
  assert.ok(greeting, 'the page declares the no-rail greeting');
  assert.match(greeting[1], /no Duffel rail, so I cannot search, price or watch fares here/);
  assert.doesNotMatch(greeting[1], /can watch a route|price is good/);
  assert.match(html, /if\(c\.mode==='not_connected'\)\{[\s\S]*?getElementById\('greeting'\)\.textContent = NO_RAIL_GREETING;/);
});

test('the persona says hotels and cars need the Duffel rail too, and calls only marked results demo (sweep 14)', () => {
  const persona = fs.readFileSync(path.join(__dirname, '..', 'personas', 'travel-concierge.yaml'), 'utf8');
  const perspective = persona.slice(persona.indexOf('perspective:')).replace(/\s+/g, ' ');
  assert.match(perspective, /Hotels and cars come through the same Duffel rail as fares\. Where there is no rail they cannot be searched either: never offer to search hotels or cars/);
  assert.match(perspective, /Results the search marks as demo are demo data with a booking handoff/);
  assert.doesNotMatch(perspective, /Hotels and cars are demo data with a booking handoff/);
});
