/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The first Show rides tap after typing an address priced the trip and then wiped it: the field's blur started a /geocode lookup on the same tap, /estimate answered first and drew the fares, and the lookup's late answer moved the pin through setPoint, whose invalidateEstimate replaced the list with "Route changed — press Show rides to price it" and disabled the hand-off (live at 412x915, geocode answered 8 ms after estimate). This suite EXECUTES the shipped surface functions (setPoint, invalidateEstimate, geocodeField, lookupAddress, settleGeocodes, estimate, renderOptions, pinParams) in a sandbox whose network the test answers in a chosen order: a lookup in flight at the tap lands its pin before /estimate and /estimate carries it; a lookup that outlasts the bounded wait answers after /estimate and the options stay drawn; a lookup started after the estimate still moves the pin and retracts the old fare. Red on the previous surface (the first two cases end on "Route changed").
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SURFACE = path.join(__dirname, '..', 'tools', 'rides-app.html');
const html = fs.readFileSync(SURFACE, 'utf8');

/** The declaration that starts at `marker`, through the closing brace of its body. A function's
 *  parameter list is skipped first, so a default like `opts = {}` is not taken for the body. */
function extractBlock(source, marker) {
  const start = source.indexOf(marker);
  if (start < 0) return '';
  let from = start;
  if (marker.startsWith('function ')) {
    let parens = 0;
    for (from = source.indexOf('(', start); from < source.length; from += 1) {
      if (source[from] === '(') parens += 1;
      else if (source[from] === ')' && (parens -= 1) === 0) break;
    }
  }
  let depth = 0;
  for (let i = source.indexOf('{', from); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`${marker} is never closed`);
}

const FUNCTIONS = ['pinFor', 'pinParams', 'providerRefused', 'setPoint', 'invalidateEstimate', 'geocodeField',
  'lookupAddress', 'settleGeocodes', 'renderOptions', 'renderDistance', 'shortRideName', 'escapeHtml',
  'updateLabels', 'estimate'];

function element(value = '') {
  return { value, innerHTML: '', textContent: '', hidden: true, disabled: false };
}

/** A network the test answers by hand: every getJson call parks until `answer` releases it. */
function manualNetwork() {
  const calls = [];
  return {
    calls,
    getJson: (url) => new Promise((resolve) => { calls.push({ url, resolve }); }),
    answer(prefix, body) {
      const call = calls.find((c) => !c.done && c.url.startsWith(prefix));
      assert.ok(call, `no open request to ${prefix}; open: ${calls.filter((c) => !c.done).map((c) => c.url)}`);
      call.done = true;
      call.resolve(body);
    },
  };
}

function loadSurface({ waitImmediately = false } = {}) {
  const net = manualNetwork();
  const els = {};
  for (const id of ['#pickup', '#dropoff', '#options', '#requestBtn', '#distanceRow', '#distanceLabel',
    '#mapHelp', '#pickupLabel', '#dropoffLabel', '#orderSubtitle']) els[id] = element();
  els['#pickup'].value = 'Destin, FL';
  const sandbox = {
    Number, String, Object, Promise, URLSearchParams, encodeURIComponent, Array, JSON,
    API: '/api/rides',
    $: (sel) => els[sel] || null,
    document: { querySelectorAll: () => [] },
    window: {},
    getJson: net.getJson,
    toast: () => {},
    drawRoute: () => {},
    refreshRoute: () => {},
    publishContext: () => {},
    // The bounded wait: real timers in the in-order cases, an instant expiry for the slow lookup.
    setTimeout: (fn, ms) => (waitImmediately ? Promise.resolve().then(fn) : setTimeout(fn, ms)),
    state: { pickup: 'my location', dropoff: '', options: [], selected: null, basis: '' },
    osm: { ready: false, markers: { pickup: null, dropoff: null }, points: { pickup: null, dropoff: null } },
  };
  vm.createContext(sandbox);
  const geocodesDecl = extractBlock(html, 'const geocodes =');
  const code = [geocodesDecl ? `${geocodesDecl};` : '', ...FUNCTIONS.map((name) => extractBlock(html, `function ${name}(`))
    .filter(Boolean).map((src) => (/^function (setPoint|geocodeField|lookupAddress|settleGeocodes|estimate)\(/.test(src) ? `async ${src}` : src))]
    .join('\n');
  new vm.Script(`${code}\nthis.__api = { estimate, geocodeField, setPoint };`, { filename: 'rides-app.html#race' })
    .runInContext(sandbox);
  return { api: sandbox.__api, els, net, sandbox };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

const ESTIMATE = {
  basis: 'geocoded', rail: 'keyless', distanceKm: 87, straightLineKm: 67, roadFactor: 1.3,
  note: 'Modelled fare from the two pins.',
  coords: { pickup: { lat: 30.39, lon: -86.49 }, dropoff: { lat: 30.47, lon: -87.19 } },
  options: [{ type: 'uberx', label: 'UberX', fareLow: 94, fareHigh: 120, seats: 4 }],
};
const AIRPORT = { lat: 30.4734, lon: -87.1866, label: 'Pensacola International Airport' };

test('a lookup in flight at the tap lands its pin first, /estimate carries it, and the fares stay drawn', async () => {
  const { api, els, net } = loadSurface();
  els['#dropoff'].value = 'Pensacola International Airport';
  const blur = api.geocodeField('dropoff');          // the blur fires on the same tap…
  const tap = api.estimate();                        // …as Show rides
  await flush();
  net.answer('/api/rides/geocode', AIRPORT);
  await blur;
  await flush();
  const est = net.calls.find((c) => c.url.startsWith('/api/rides/estimate'));
  assert.ok(est, 'the estimate was never sent');
  assert.match(est.url, /dropoffLat=30\.4734/, 'the estimate did not carry the pin the lookup just placed');
  net.answer('/api/rides/estimate', ESTIMATE);
  await tap;
  await flush();
  assert.match(els['#options'].innerHTML, /UberX/, `options were wiped: ${els['#options'].innerHTML}`);
  assert.doesNotMatch(els['#options'].innerHTML, /Route changed/);
  assert.equal(els['#requestBtn'].disabled, false, 'the hand-off stays disabled after a priced trip');
});

test('a lookup slower than the wait answers after /estimate and does not retract the fares', async () => {
  const { api, els, net } = loadSurface({ waitImmediately: true });
  els['#dropoff'].value = 'Pensacola International Airport';
  const blur = api.geocodeField('dropoff');
  const tap = api.estimate();
  await flush();
  net.answer('/api/rides/estimate', ESTIMATE);       // /estimate first (live: 190 ms)…
  await tap;
  net.answer('/api/rides/geocode', AIRPORT);         // …the lookup after it (live: 198 ms)
  await blur;
  await flush();
  assert.match(els['#options'].innerHTML, /UberX/, `options were wiped: ${els['#options'].innerHTML}`);
  assert.doesNotMatch(els['#options'].innerHTML, /Route changed/);
  assert.equal(els['#requestBtn'].disabled, false);
});

test('a lookup started after the estimate still moves the pin and retracts the old fare', async () => {
  const { api, els, net, sandbox } = loadSurface();
  els['#dropoff'].value = 'Pensacola International Airport';
  const tap = api.estimate();
  await flush();
  net.answer('/api/rides/estimate', ESTIMATE);
  await tap;
  assert.match(els['#options'].innerHTML, /UberX/);
  els['#dropoff'].value = 'Fort Walton Beach, FL';   // the rider types a new destination
  const blur = api.geocodeField('dropoff');
  net.answer('/api/rides/geocode', { lat: 30.42, lon: -86.62 });
  await blur;
  await flush();
  assert.equal(sandbox.osm.points.dropoff.lat, 30.42, 'the new address did not move the pin');
  assert.match(els['#options'].innerHTML, /Route changed/, 'a fare for the old destination is still shown');
  assert.equal(els['#requestBtn'].disabled, true);
});
