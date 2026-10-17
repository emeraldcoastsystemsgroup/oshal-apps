/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | "Get me an Uber ride from home to the airport" from Jarvis handed Uber a trip from a Washington street to Helsinki airport: the keyless rail geocoded the words "home" and "airport" on their own. Through the compiled routes on the native kernel's not-connected rail: with no saved home address the ride link is refused, saying so, before any lookup; with a saved home address the pickup is that address; a dropoff that geocodes farther than a car ride is refused naming where it landed; a nearby airport builds the Uber link.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakePool, fakeProvider, loadRoutes, authed, call } = require('./rides-routes-harness');

/** The native kernel's Uber Rides rail: not connected, and every operation but status refuses. */
function nativeProvider() {
  const refuse = () => { throw Object.assign(new Error('unavailable'), { status: 503 }); };
  return fakeProvider({ status: () => ({ configured: false, connected: false, live: false, mode: 'not_connected', provider: 'Uber Rides' }),
    estimate: refuse, geocode: refuse, reverse: refuse, ride: refuse });
}

const HOME = '2907 180th Ave NW, Gig Harbor, WA';
const PLACES = {
  [HOME.toLowerCase()]: { lat: '47.2839', lon: '-122.7779', display_name: '2907 180th Avenue Northwest, Gig Harbor, WA' },
  airport: { lat: '60.3218', lon: '24.9474', display_name: 'Helsinki Airport, Vantaa, Finland' },
  'seattle tacoma airport': { lat: '47.4502', lon: '-122.3088', display_name: 'Seattle-Tacoma International Airport, WA' },
};

/** Nominatim over the egress fetch, answering PLACES; every looked-up address is recorded. */
function withNominatim(t) {
  const saved = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (url) => {
    const q = new URL(String(url)).searchParams.get('q');
    asked.push(q);
    const hit = PLACES[String(q).toLowerCase()];
    return { ok: true, status: 200, json: async () => (hit ? [hit] : []) };
  };
  t.after(() => { globalThis.fetch = saved; });
  return asked;
}

const ride = (handlers, body) => call(handlers, 'post', '/request', authed('rider-a', { body }));

test('with no saved home address the ride is refused, saying so, before any lookup', async (t) => {
  const asked = withNominatim(t);
  const { handlers } = loadRoutes({ provider: nativeProvider() });
  const res = await ride(handlers, { pickup: 'home', dropoff: 'airport' });
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /home address is not saved in Rides/);
  assert.deepEqual(asked, []);
});

test('a saved home address is the pickup, and a dropoff farther than a car ride is refused', async (t) => {
  const asked = withNominatim(t);
  const { handlers } = loadRoutes({ provider: nativeProvider(), pool: fakePool({ home_address: HOME }) });
  const res = await ride(handlers, { pickup: 'my home', dropoff: 'airport' });
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /"airport" resolved to Helsinki Airport, Vantaa, Finland, \d+ km from the pickup, which is not a car ride/);
  assert.ok(asked.includes(HOME), 'the saved address was looked up, not the word "home"');
  assert.ok(!asked.includes('home') && !asked.includes('my home'));
});

test('a nearby airport from the saved home builds the Uber link', async (t) => {
  withNominatim(t);
  const { handlers } = loadRoutes({ provider: nativeProvider(), pool: fakePool({ home_address: HOME }) });
  const res = await ride(handlers, { pickup: 'home', dropoff: 'Seattle Tacoma airport' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const link = decodeURIComponent(res.body.rideUrl);
  assert.match(link, /"latitude":47\.2839/);
  assert.match(link, /"latitude":47\.4502/);
});
