/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | A refused Uber Rides call (HTTP 503: no Uber connection on this installation) is shown as "Not connected" and never as "One of these addresses did not resolve". The guard EXECUTES the shipped estimate(), requestRide() and sendChat() out of the surface against a fetch that answers 503.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The refusal copy names the installation's fact (no Uber rail, no Uber connector exists here) and never says a connection can be added; the pin helpers the surface now sends with each request load with it.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | estimate() first settles the field lookups still in flight (the first-tap race, tests/rides-geocode-race.test.js), so the shipped `geocodes` state and settleGeocodes load with it.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'tools', 'rides-app.html'), 'utf8');
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

const NAMES = ['NOT_CONNECTED', 'geocodes', 'settleGeocodes', 'pinFor', 'pinParams', 'readBody', 'getJson', 'postJson', 'providerRefused', 'escapeHtml', 'estimate', 'requestRide', 'sendChat'];
const REFUSED = [503, { error: 'native_executor_unavailable' }];
const toasts = [];
const stubs = () => ({ API: '/api/rides', osm: { points: { pickup: null, dropoff: null } }, state: { pickup: 'Home', dropoff: 'Airport', options: [], selected: { type: 'UberX' } },
  updateLabels() {}, setPoint: async () => {}, renderDistance() {}, renderOptions() { throw new Error('a refusal is not a list of options'); },
  refreshRoute() {}, toast: (text) => toasts.push(text), loadTrips() {}, addMessage: () => ({ textContent: '' }),
  googleMapState: { enabled: false }, geocodeField: async () => null, selectRide() {}, proposeRide() {} });

test('a refused fare estimate says Uber is not connected, not that an address did not resolve', async () => {
  const page = surface(html, NAMES, () => REFUSED, stubs());
  await page.fns.estimate();
  assert.match(page.el('#options').innerHTML, /no Uber rail \(no Uber connector exists here\)/);
  assert.match(page.el('#mapHelp').textContent, /Unavailable/);
  assert.doesNotMatch(page.el('#mapHelp').textContent, /connection is added|\/utilities|connect it/i);
  assert.doesNotMatch(page.el('#mapHelp').textContent, /did not resolve/);
});

test('a refused hand-off and a refused concierge turn say not connected', async () => {
  const page = surface(html, NAMES, () => REFUSED, stubs());
  await page.fns.requestRide();
  assert.match(toasts.pop(), /hand-off was refused/);
  const bubble = { textContent: '' };
  page.sandbox.addMessage = () => bubble;
  page.el('#chatInput').value = 'to the airport';
  await page.fns.sendChat();
  assert.match(bubble.textContent, /no Uber connector exists here/);
});

test('the estimate sends the pins that still match their fields, and drops a pin its field no longer names', async () => {
  const urls = [];
  const extra = stubs();
  extra.osm = { points: { pickup: { lat: 30.3935, lon: -86.4958, label: 'Destin' }, dropoff: { lat: 30.4213, lon: -87.2169, label: 'Old place' } } };
  extra.renderOptions = () => {};
  const page = surface(html, NAMES, (url) => { urls.push(url); return [200, { options: [], basis: 'geocoded' }]; }, extra);
  page.el('#pickup').value = 'Destin';
  page.el('#dropoff').value = '30.42130, -87.21690';
  await page.fns.estimate();
  assert.match(urls[0], /pickupLat=30\.3935&pickupLon=-86\.4958/);
  assert.match(urls[0], /dropoffLat=30\.4213&dropoffLon=-87\.2169/, 'a field holding the pin\'s own coordinates still names it');
  page.el('#dropoff').value = 'Pensacola airport';
  await page.fns.estimate();
  assert.doesNotMatch(urls[1], /dropoffLat/, 'a newly typed destination is never priced from the old pin');
});
