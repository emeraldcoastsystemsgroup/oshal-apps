/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Rides with no Uber connector, driven through the COMPILED route module. The provider double answers like the native kernel: `status` is mode not_connected and every other operation refuses 503 (and would fail the whole call). Two map pins price an estimate with no provider call and no lookup; a typed address resolves through the Nominatim fetch; a refused lookup says why; the hand-off is Uber's public link with the pins; the concierge turn answers (no 503) and its prompt states the installation has no Uber connector and never asks the rider to connect one; /config names the keyless rail. Red on the previous route, which called the refusing operation for every one of these.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The concierge prompt says no pickup ETA is known (live it invented "Est. Arrival 5-10 min" beside the modelled fares) and carries the measured distance of the trip on screen (it said "approximately 105 miles" for an 87 km trip).
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Sweep 10: the approved hand-off card showed only "Done in Rides." because nothing in the answer read as a link to show. The /request answer carries `url` (the https web link the card offers) and `where` (one sentence on opening it and finding it under Trips).
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { fakeProvider, loadRoutes, authed, call } = require('./rides-routes-harness');
const keyless = require(path.join(__dirname, '..', 'routes', 'rides-keyless.js'));

/** The native kernel's Uber Rides rail: not connected, and every operation but status refuses. */
function nativeProvider() {
  return fakeProvider({
    status: () => ({ configured: false, connected: false, live: false, mode: 'not_connected', provider: 'Uber Rides',
      reason: 'Uber is not connected: this installation has no native Uber connector.' }),
    estimate: () => { throw Object.assign(new Error('Uber Rides provider operation is unavailable'), { status: 503 }); },
    geocode: () => { throw Object.assign(new Error('unavailable'), { status: 503 }); },
    reverse: () => { throw Object.assign(new Error('unavailable'), { status: 503 }); },
    ride: () => { throw Object.assign(new Error('unavailable'), { status: 503 }); },
  });
}

/** Swap the global fetch (the native runner's egress) for one test. */
function withFetch(t, impl) {
  const saved = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init) => { seen.push({ url: String(url), init }); return impl(String(url), init); };
  t.after(() => { globalThis.fetch = saved; });
  return seen;
}

const json = (body, status = 200) => ({ ok: status < 300, status, json: async () => body });
const DESTIN = { pickupLat: '30.3935', pickupLon: '-86.4958', dropoffLat: '30.4213', dropoffLon: '-87.2169' };

test('two map pins price the trip here, with no provider operation and no address lookup', async (t) => {
  const seen = withFetch(t, () => { throw new Error('no lookup expected'); });
  const { handlers, provider } = loadRoutes({ provider: nativeProvider() });
  const res = await call(handlers, 'get', '/estimate', authed('rider-a', { query: { pickup: 'Destin', dropoff: 'Pensacola', ...DESTIN } }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.basis, 'geocoded');
  assert.equal(res.body.rail, 'keyless');
  const straight = keyless.haversineKm({ lat: 30.3935, lon: -86.4958 }, { lat: 30.4213, lon: -87.2169 });
  assert.equal(res.body.straightLineKm, Math.round(straight * 10) / 10);
  assert.equal(res.body.distanceKm, Math.round(straight * 1.3 * 10) / 10);
  const uberx = res.body.options.find((o) => o.type === 'uberx');
  assert.equal(uberx.fareLow, Math.round((9 + 1.1 * res.body.distanceKm) * 0.9));
  assert.equal(uberx.estimate, true);
  assert.match(res.body.note, /no Uber connector exists here/);
  assert.doesNotMatch(res.body.note, /connect it|\/utilities|once an Uber connection/i);
  assert.deepEqual(provider.calls, [], 'the refusing provider operation is never called');
  assert.equal(seen.length, 0);
});

test('a typed address resolves through the Nominatim lookup with a User-Agent', async (t) => {
  const seen = withFetch(t, (url) => json(/Pensacola/.test(url) ? [{ lat: '30.4213', lon: '-87.2169', display_name: 'Pensacola, FL' }] : []));
  const { handlers } = loadRoutes({ provider: nativeProvider() });
  const res = await call(handlers, 'get', '/geocode', authed('rider-a', { query: { q: 'Pensacola FL' } }));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { lat: 30.4213, lon: -87.2169, label: 'Pensacola, FL' });
  assert.match(seen[0].url, /^https:\/\/nominatim\.openstreetmap\.org\/search\?/);
  assert.match(seen[0].init.headers['User-Agent'], /oshal-rides/);
});

test('a refused lookup says the lookup is unavailable, not that the address does not exist', async (t) => {
  withFetch(t, () => { throw new Error('refused: nominatim.openstreetmap.org is not a declared outbound host of rides'); });
  const { handlers } = loadRoutes({ provider: nativeProvider() });
  const res = await call(handlers, 'get', '/estimate', authed('rider-a', { query: { pickup: '1 Main St, Destin', dropoff: 'Pensacola' } }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.basis, 'unresolved');
  assert.ok(res.body.options.every((o) => o.fareLow === null), 'no fare is invented');
  assert.match(res.body.note, /address lookup is unavailable here \(refused: nominatim/);
  assert.match(res.body.note, /Drop both pins/);
});

test('the hand-off is Uber\'s public link carrying the pins, and the trip is recorded', async () => {
  const { handlers, pool, provider } = loadRoutes({ provider: nativeProvider() });
  const res = await call(handlers, 'post', '/request', authed('rider-a', { body: { pickup: 'Destin', dropoff: 'Pensacola', rideType: 'uberx', ...DESTIN } }));
  assert.equal(res.statusCode, 200);
  assert.match(res.body.rideUrl, /^https:\/\/m\.uber\.com\/go\/product-selection\?/);
  assert.match(decodeURIComponent(res.body.rideUrl), /"latitude":30\.4213,"longitude":-87\.2169/);
  assert.match(res.body.appUrl, /^https:\/\/m\.uber\.com\/ul\/\?action=setPickup/);
  assert.doesNotMatch(res.body.appUrl, /client_id/, 'no Uber client id exists on this installation');
  assert.equal(res.body.url, res.body.webUrl || res.body.rideUrl, 'the card\'s link is the https web link');
  assert.match(res.body.url, /^https:\/\//);
  assert.match(res.body.where, /Open the Uber link to see the real price and request the ride in Uber\. It is also listed under Trips in Rides\./);
  assert.equal(pool.tables.requests.length, 1);
  assert.deepEqual(provider.calls, []);
});

test('the concierge answers with no Uber connector, and is told never to ask the rider to connect one', async (t) => {
  withFetch(t, () => { throw new Error('no lookup expected'); });
  const { handlers, prompts } = loadRoutes({ provider: nativeProvider(), reply: { say: 'About 89 km; UberX is modelled at $110-140.', showOptions: true } });
  const res = await call(handlers, 'post', '/chat', authed('rider-a', { body: { message: 'how much to Pensacola?', pickup: 'Destin', dropoff: 'Pensacola', ...DESTIN } }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.reply, 'About 89 km; UberX is modelled at $110-140.');
  assert.ok(res.body.options.some((o) => o.fareLow !== null), 'the pins priced the options in the turn');
  assert.match(prompts[0], /THIS INSTALLATION: This installation has no Uber rail \(no Uber connector exists here\)/);
  assert.match(prompts[0], /Never tell the rider to connect Uber/);
  assert.match(prompts[0], /No pickup time \(ETA\) is known here: never state one/, 'every option\'s etaPickupMin is null, so no arrival time may be invented');
  assert.ok(res.body.options.every((o) => o.etaPickupMin === null));
  assert.match(prompts[0], /MEASURED DISTANCE: \d+(\.\d)? km \(\d+ miles\), the modelled road distance between the two points\. Quote only this distance\./);
});

test('/config names the keyless rail and its sentence where the runtime has no Uber connector', async () => {
  const { handlers } = loadRoutes({ provider: nativeProvider() });
  const res = await call(handlers, 'get', '/config', authed('rider-a'));
  assert.equal(res.body.rail, 'keyless');
  assert.equal(res.body.uberRidesConnected, false);
  assert.match(res.body.railNote, /no Uber connector exists here/);
  const connected = loadRoutes();
  const live = await call(connected.handlers, 'get', '/config', authed('rider-a'));
  assert.equal(live.body.rail, 'provider');
  assert.equal(live.body.railNote, undefined);
});

test('pins out of range are ignored, and an unresolved trip has no fare', () => {
  assert.equal(keyless.pointFrom('91', '0'), null);
  assert.equal(keyless.pointFrom('', '1'), null);
  assert.deepEqual(keyless.pointFrom('30.1', '-86.2'), { lat: 30.1, lon: -86.2 });
  const e = keyless.estimateFromPoints(null, { lat: 30, lon: -86 });
  assert.equal(e.basis, 'unresolved');
  assert.ok(e.options.every((o) => o.fareLow === null && o.fareHigh === null));
});

test('a concierge that changes the destination is never priced from the old destination pin', async (t) => {
  const seen = withFetch(t, (url) => json(/Mobile/.test(url) ? [{ lat: '30.6954', lon: '-88.0399', display_name: 'Mobile, AL' }] : []));
  const { handlers, prompts } = loadRoutes({ provider: nativeProvider(), reply: { say: 'Mobile it is.', dropoff: 'Mobile, AL', showOptions: true } });
  const res = await call(handlers, 'post', '/chat', authed('rider-a', { body: { message: 'make it Mobile instead', pickup: 'Destin', dropoff: 'Pensacola', ...DESTIN } }));
  assert.equal(res.statusCode, 200);
  assert.match(prompts[0], /UberX: ~\$\d+-\d+/, 'the trip on screen was priced before the turn');
  assert.ok(seen.some((s) => /Mobile/.test(s.url)), 'the new destination was looked up, not taken from the Pensacola pin');
  const straight = keyless.haversineKm({ lat: 30.3935, lon: -86.4958 }, { lat: 30.6954, lon: -88.0399 });
  assert.equal(res.body.options[0].fareLow, Math.round((9 + 1.1 * Math.round(straight * 1.3 * 10) / 10) * 0.9));
});
