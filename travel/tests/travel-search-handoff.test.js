/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | "Find me flights from Seattle to Denver next Friday" from Jarvis answered that nothing could be searched: the native kernel has no Duffel rail and every search refuses 503. Through the compiled routes on that rail: /flights, /hotels and /cars answer the Google Flights, Booking.com and Kayak search links for the exact trip with no items and no prices, and never call the refusing provider; with a Duffel rail the provider still answers.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROUTE_FILE = path.join(__dirname, '..', 'routes', 'travel-routes.js');

/** An in-memory pool answering the chat route's SQL; every statement recorded. */
function fakePool() {
  const sql = [];
  const rows = (r) => ({ rows: r, rowCount: r.length });
  return {
    sql,
    async query(text, params = []) {
      const s = String(text).trim();
      sql.push(s);
      if (/^INSERT INTO travel_conversations/.test(s)) return rows([{ conversation_id: 'conv-1' }]);
      if (/^SELECT role, content FROM travel_messages/.test(s)) return rows([{ role: 'user', content: params[0] }]);
      if (/^INSERT INTO travel_watches/.test(s)) return rows([{ watch_id: 'w1' }]);
      return rows([]);
    },
  };
}

/** Load the compiled route with stubbed framework imports and a scripted orchestrator. */
function load({ status, reply }) {
  const handlers = { get: new Map(), post: new Map(), delete: new Map() };
  const calls = [];
  const prompts = [];
  const router = { get(p, h) { handlers.get.set(p, h); }, post(p, h) { handlers.post.set(p, h); }, delete(p, h) { handlers.delete.set(p, h); } };
  const stubs = {
    express: { Router: () => router }, path, fs, crypto: { randomUUID: () => 'id' },
    '@/shared/logger': { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) },
    '@/shared/middleware/authz': { getTrustedServiceUserSub: () => undefined },
    '@/app/routes/connector-token-broker': { resolveServerOperationCreds: async () => ({}) },
    '@/app/routes/provider-operation-clients': {
      runDuffelProviderOperation: async (_c, args) => {
        if (args[0] === 'status') return status;
        calls.push(args[0]);
        if (status.mode === 'not_connected') throw Object.assign(new Error('Duffel travel search is unavailable in this native runtime'), { status: 503 });
        return { source: 'duffel', items: [{ id: 'off_1', airline: 'Delta', price: 212, currency: 'USD', slices: [] }] };
      },
    },
    './travel-handoff': require(path.join(__dirname, '..', 'routes', 'travel-handoff.js')),
    '@/app/routes/travel-farewatch': { ensureTravelSchema: async () => {}, routeKeyFor: () => 'flight:VPS-DCA', recordObservations: async () => {}, priceRead: async () => ({ verdict: 'unknown' }) },
  };
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', '__filename', '__dirname', fs.readFileSync(ROUTE_FILE, 'utf8'))(
    (id) => { if (id in stubs) return stubs[id]; throw new Error(`unexpected require: ${id}`); }, mod, mod.exports, ROUTE_FILE, path.dirname(ROUTE_FILE));
  const orchestrator = { async processMessage(_id, prompt) { prompts.push(prompt); return { response: JSON.stringify(reply) }; } };
  const pool = fakePool();
  mod.exports.createTravelRoutes({ pool, appPackageDir: path.join(__dirname, '..', 'tools'), orchestrator });
  return { handlers, calls, prompts, pool, exports: mod.exports };
}

/** One GET through the compiled route. */
async function get(t, route, query) {
  const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await t.handlers.get.get(route)({ oidc: { isAuthenticated: () => true, user: { sub: 'traveller-a' } }, body: {}, query, path: route }, res);
  return res;
}

const native = { configured: false, connected: false, live: false, mode: 'not_connected', provider: 'Duffel travel search' };

test('with no Duffel rail a flight search answers the Google Flights link for the trip, no fares', async () => {
  const t = load({ status: native, reply: {} });
  const res = await get(t, '/flights', { origin: 'SEA', destination: 'DEN', departDate: '2026-10-23' });
  assert.equal(res.code, 200);
  assert.deepEqual(res.body.items, []);
  assert.equal(res.body.source, 'handoff');
  assert.equal(res.body.deepLink, 'https://www.google.com/travel/flights?q=Flights%20from%20SEA%20to%20DEN%20on%202026-10-23');
  assert.match(res.body.note, /No fares are searched here/);
  assert.deepEqual(t.calls, [], 'the refusing provider search is never called');
});

test('hotels and cars answer the Booking.com and Kayak searches', async () => {
  const t = load({ status: native, reply: {} });
  const hotel = await get(t, '/hotels', { city: 'Denver', checkIn: '2026-10-23', checkOut: '2026-10-25' });
  assert.equal(hotel.body.deepLink, 'https://www.booking.com/searchresults.html?ss=Denver&checkin=2026-10-23&checkout=2026-10-25');
  const car = await get(t, '/cars', { city: 'Denver', pickupDate: '2026-10-23', dropoffDate: '2026-10-25' });
  assert.equal(car.body.deepLink, 'https://www.kayak.com/cars/Denver/2026-10-23/2026-10-25');
  assert.deepEqual(t.calls, []);
});

test('with a Duffel rail the provider answers the search', async () => {
  const t = load({ status: { configured: true, mode: 'live' }, reply: {} });
  const res = await get(t, '/flights', { origin: 'SEA', destination: 'DEN', departDate: '2026-10-23' });
  assert.equal(res.body.items[0].airline, 'Delta');
  assert.deepEqual(t.calls, ['flights']);
});
