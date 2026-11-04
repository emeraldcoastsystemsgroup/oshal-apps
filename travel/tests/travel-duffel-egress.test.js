/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Travel said "this installation has no Duffel rail" on the native kernel although a Duffel token existed: the package only knew the old provider helper, which the native kernel does not have. Through the COMPILED routes with OSHAL_EGRESS=kernel and a fetch double shaped like the kernel's egress (it adds the key itself, refuses with "not connected" when none is configured): a search sends the Duffel-Version header and no credential of its own to api.duffel.com, answers the cheapest offers sorted, labels a test key's offers duffel-test with the test-fare note and keeps them out of the price history, records a live key's fares, answers the Google Flights link with the reason when Duffel rejects the trip, falls back to links with no key, keeps hotels and cars as links, and tells the concierge to call test fares test fares. Red on 1.2.6, which answered not_connected without asking Duffel.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROUTES = path.join(__dirname, '..', 'routes');
const ROUTE_FILE = path.join(ROUTES, 'travel-routes.js');
const TODAY = '2026-11-24';

/** An in-memory pool answering the chat route's SQL. */
function fakePool() {
  const rows = (r) => ({ rows: r, rowCount: r.length });
  return {
    async query(text, params = []) {
      const s = String(text).trim();
      if (/^INSERT INTO travel_conversations/.test(s)) return rows([{ conversation_id: 'conv-1' }]);
      if (/^SELECT role, content FROM travel_messages/.test(s)) return rows([{ role: 'user', content: params[0] }]);
      return rows([]);
    },
  };
}

/** A Duffel offer as Duffel answers it. */
function offer(id, amount, live) {
  const seg = { origin: { iata_code: 'VPS', city_name: 'Valparaiso' }, destination: { iata_code: 'LGA', city_name: 'New York' },
    departing_at: `${TODAY}T07:10:00`, arriving_at: `${TODAY}T12:40:00`, marketing_carrier: { name: 'Delta' }, passengers: [{ cabin_class: 'economy' }] };
  return { id, total_amount: String(amount), total_currency: 'USD', live_mode: live, owner: { name: 'Delta' }, expires_at: null,
    slices: [{ origin: seg.origin, destination: seg.destination, duration: 'PT4H30M', segments: [seg] }] };
}

/**
 * The kernel's egress as a fetch double: it records each request and answers like Duffel. `key` is 'test', 'live' or
 * null (no key configured: the kernel refuses before any request leaves).
 */
function egress({ key, reject }) {
  const requests = [];
  const answer = (status, body) => ({ ok: status < 300, status, json: async () => body });
  const fetch = async (url, init = {}) => {
    requests.push({ url, method: init.method || 'GET', headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : null });
    if (!key) throw new Error('duffel is not connected: set OSHAL_CONNECTOR_SECRET_DUFFEL');
    const live = key === 'live';
    if (!init.headers || init.headers['duffel-version'] !== 'v2') return answer(400, { errors: [{ code: 'missing_version_header', message: "The 'Duffel-Version' header needs to be set to a valid API version." }] });
    const u = new URL(url);
    if (u.pathname === '/air/offer_requests' && (init.method || 'GET') === 'GET') return answer(200, { data: [{ id: 'orq_old', live_mode: live }] });
    if (u.pathname === '/air/offer_requests') {
      if (reject) return answer(422, { errors: [{ message: 'Field departure_date must be in the future' }] });
      return answer(201, { data: { id: 'orq_1', live_mode: live } });
    }
    if (u.pathname === '/air/offers') return answer(200, { data: [offer('off_b', 151.2, live), offer('off_a', 86.48, live)] });
    return answer(404, {});
  };
  return { fetch, requests };
}

/** Load the compiled route on the native kernel (OSHAL_EGRESS=kernel) with the egress double as the global fetch. */
function load(net, reply = {}) {
  const handlers = { get: new Map(), post: new Map(), delete: new Map() };
  const recorded = [];
  const prompts = [];
  const helperCalls = [];
  const router = { get(p, h) { handlers.get.set(p, h); }, post(p, h) { handlers.post.set(p, h); }, delete(p, h) { handlers.delete.set(p, h); } };
  const stubs = {
    express: { Router: () => router }, path, fs, crypto: { randomUUID: () => 'id' },
    '@/shared/logger': { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) },
    '@/shared/middleware/authz': { getTrustedServiceUserSub: () => undefined },
    '@/app/routes/connector-token-broker': { resolveServerOperationCreds: async () => ({}) },
    '@/app/routes/provider-operation-clients': {
      runDuffelProviderOperation: async (_c, args) => { helperCalls.push(args[0]); return { configured: false, mode: 'not_connected' }; },
    },
    './travel-handoff': require(path.join(ROUTES, 'travel-handoff.js')),
    './duffel-egress': require(path.join(ROUTES, 'duffel-egress.js')),
    '@/app/routes/travel-farewatch': {
      ensureTravelSchema: async () => {}, routeKeyFor: () => 'flight:VPS-LGA',
      recordObservations: async (_p, kind, _q, items, source) => { recorded.push({ kind, source, n: items.length }); },
      priceRead: async () => ({ verdict: 'unknown' }),
    },
  };
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', '__filename', '__dirname', fs.readFileSync(ROUTE_FILE, 'utf8'))(
    (id) => { if (id in stubs) return stubs[id]; throw new Error(`unexpected require: ${id}`); }, mod, mod.exports, ROUTE_FILE, ROUTES);
  const orchestrator = { async processMessage(_id, prompt) { prompts.push(prompt); return { response: JSON.stringify(reply) }; } };
  mod.exports.createTravelRoutes({ pool: fakePool(), appPackageDir: path.join(__dirname, '..', 'tools'), orchestrator });
  return { handlers, recorded, prompts, helperCalls };
}

/** One request through the compiled route as an authenticated traveller. */
async function call(t, method, route, { query = {}, body = {} } = {}) {
  const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await t.handlers[method].get(route)({ oidc: { isAuthenticated: () => true, user: { sub: 'traveller-a' } }, body, query, path: route }, res);
  return res;
}

const TRIP = { origin: 'VPS', destination: 'LGA', departDate: TODAY };

/** Run with the global fetch and OSHAL_EGRESS set the way the native kernel's bridge sets them. */
async function onKernel(net, fn) {
  const saved = { fetch: globalThis.fetch, egress: process.env.OSHAL_EGRESS };
  globalThis.fetch = net.fetch;
  process.env.OSHAL_EGRESS = 'kernel';
  try { await fn(); } finally {
    globalThis.fetch = saved.fetch;
    if (saved.egress === undefined) delete process.env.OSHAL_EGRESS; else process.env.OSHAL_EGRESS = saved.egress;
  }
}

test('a test key searches Duffel through the egress and labels the offers test fares', async () => {
  const net = egress({ key: 'test' });
  await onKernel(net, async () => {
    const t = load(net);
    const cfg = await call(t, 'get', '/config');
    assert.deepEqual(cfg.body, { connected: true, mode: 'test', live: false });
    const res = await call(t, 'get', '/flights', { query: TRIP });
    assert.equal(res.code, 200);
    assert.equal(res.body.source, 'duffel-test');
    assert.match(res.body.note, /Duffel test mode: these are Duffel's simulated sandbox fares, not real prices/);
    assert.deepEqual(res.body.items.map((i) => [i.id, i.price, i.liveMode]), [['off_a', 86.48, false], ['off_b', 151.2, false]]);
    assert.equal(res.body.items[0].slices[0].duration, '4h 30m');
    assert.equal(res.body.deepLink, `https://www.google.com/travel/flights?q=Flights%20from%20VPS%20to%20LGA%20on%20${TODAY}`);
    assert.deepEqual(t.recorded, [], 'test fares never enter the swarm price history');
    assert.deepEqual(t.helperCalls, [], 'the old provider helper is not asked on the native kernel');
  });
  for (const r of net.requests) {
    assert.equal(new URL(r.url).host, 'api.duffel.com');
    assert.equal(r.headers['duffel-version'], 'v2');
    assert.ok(!Object.keys(r.headers).some((h) => /authorization/i.test(h)), 'the package sends no credential; the kernel adds it');
  }
  const posted = net.requests.find((r) => r.method === 'POST');
  assert.match(posted.url, /return_offers=false/);
  assert.deepEqual(posted.body.data.slices, [{ origin: 'VPS', destination: 'LGA', departure_date: TODAY }]);
  assert.match(net.requests.at(-1).url, /\/air\/offers\?offer_request_id=orq_1&sort=total_amount&limit=12$/);
});

test('a live key answers Duffel fares and records them in the price history', async () => {
  const net = egress({ key: 'live' });
  await onKernel(net, async () => {
    const t = load(net);
    assert.equal((await call(t, 'get', '/config')).body.mode, 'live');
    const res = await call(t, 'get', '/flights', { query: { ...TRIP, returnDate: '2026-11-30', cabin: 'business' } });
    assert.equal(res.body.source, 'duffel');
    assert.equal(res.body.note, undefined);
    assert.deepEqual(t.recorded, [{ kind: 'flight', source: 'duffel', n: 2 }]);
  });
  const posted = net.requests.find((r) => r.method === 'POST');
  assert.equal(posted.body.data.cabin_class, 'business');
  assert.equal(posted.body.data.slices[1].departure_date, '2026-11-30');
});

test('with no key configured every search is the booking-site link, as before', async () => {
  const net = egress({ key: null });
  await onKernel(net, async () => {
    const t = load(net);
    assert.equal((await call(t, 'get', '/config')).body.mode, 'not_connected');
    const res = await call(t, 'get', '/flights', { query: TRIP });
    assert.equal(res.body.source, 'handoff');
    assert.deepEqual(res.body.items, []);
  });
  assert.equal(net.requests.length, 1, 'only the status probe; no search is sent without a key');
});

test('a trip Duffel rejects answers its link with the reason', async () => {
  const net = egress({ key: 'test', reject: true });
  await onKernel(net, async () => {
    const t = load(net);
    const res = await call(t, 'get', '/flights', { query: TRIP });
    assert.equal(res.code, 200);
    assert.equal(res.body.source, 'handoff');
    assert.match(res.body.note, /Duffel could not search that trip: Field departure_date must be in the future/);
    assert.match(res.body.deepLink, /^https:\/\/www\.google\.com\/travel\/flights/);
  });
});

test('hotels and cars stay booking-site links and never call Duffel', async () => {
  const net = egress({ key: 'live' });
  await onKernel(net, async () => {
    const t = load(net);
    const hotel = await call(t, 'get', '/hotels', { query: { city: 'New York', checkIn: TODAY, checkOut: '2026-11-26' } });
    assert.match(hotel.body.deepLink, /^https:\/\/www\.booking\.com\//);
    const car = await call(t, 'get', '/cars', { query: { city: 'New York', pickupDate: TODAY, dropoffDate: '2026-11-26' } });
    assert.match(car.body.deepLink, /^https:\/\/www\.kayak\.com\/cars\//);
  });
  assert.ok(net.requests.every((r) => r.method === 'GET' && /\/air\/offer_requests\?limit=1$/.test(r.url)), 'only the status probe');
});

test('the concierge reasons over Duffel offers and is told to call test fares test fares', async () => {
  const net = egress({ key: 'test' });
  await onKernel(net, async () => {
    const t = load(net, { say: 'The cheapest is a Duffel test fare of $86.48 on Delta.', show: ['off_a'], watch: [], remember: [] });
    const res = await call(t, 'post', '/chat', { body: { message: 'cheapest flights to nyc', kind: 'flight', search: TRIP } });
    assert.deepEqual(res.body.cards.map((c) => c.id), ['off_a']);
    const prompt = t.prompts[0];
    assert.match(prompt, /id:off_a \| Delta \$86\.48 USD/);
    assert.match(prompt, /THESE FARES: Duffel test mode/);
    assert.match(prompt, /Say "Duffel test fare" with every price you quote/);
    assert.doesNotMatch(prompt, /THIS INSTALLATION: This installation has no Duffel rail/);
  });
});
