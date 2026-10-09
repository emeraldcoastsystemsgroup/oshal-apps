/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — load the COMPILED Rides route module (the bytes the framework mounts) with every framework import stubbed, an in-memory pool that answers the SQL the chat, request, history and profile routes issue, a recording Uber Rides provider whose estimate prices a fixed 10 km trip with the same per-type formula shape as the core helper, and a scripted concierge. Shared by the chat-proposal suite and the browser smoke's fixture (which passes the framework's real express); not a suite itself (no .test.js name, so the package glob never runs it).
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const PKG = path.resolve(__dirname, '..');
const ROUTE_FILE = path.join(PKG, 'routes', 'rides-routes.js');

/** Ride types in the core helper's shape: base + per-km, low = 0.9x and high = 1.15x, rounded. */
const RIDE_TYPES = [
  { key: 'uberx', label: 'UberX', seats: 4, base: 9, perKm: 1.1 },
  { key: 'comfort', label: 'Comfort', seats: 4, base: 12, perKm: 1.4 },
  { key: 'xl', label: 'UberXL', seats: 6, base: 15, perKm: 1.8 },
  { key: 'black', label: 'Uber Black', seats: 4, base: 22, perKm: 2.6 },
];
/** The fixed trip every resolvable estimate measures. */
const TRIP_KM = 10;
/** Two points 10 km apart-ish, in neutral open water off a documentation coordinate. */
const PICKUP = { lat: 30.0, lon: -86.0 };
const DROPOFF = { lat: 30.07, lon: -86.05 };

/** The deterministic options for a measured trip (or null fares for an unresolved one). */
function rideOptions(km) {
  return RIDE_TYPES.map((t) => {
    const fare = km === null ? null : t.base + t.perKm * km;
    return { type: t.key, label: t.label, seats: t.seats, fareLow: fare === null ? null : Math.round(fare * 0.9), fareHigh: fare === null ? null : Math.round(fare * 1.15), tripMin: km === null ? null : 20, estimate: true };
  });
}

/** An Uber Rides provider double: estimate / geocode / reverse / ride, every call recorded. */
function fakeProvider(overrides = {}) {
  const calls = [];
  async function run(args) {
    calls.push([...args]);
    if (overrides[args[0]]) return overrides[args[0]](args);
    if (args[0] === 'estimate') {
      const unresolved = /nowhere/i.test(String(args[2]));
      return unresolved
        ? { source: 'estimate', options: rideOptions(null), basis: 'unresolved', distanceKm: null, straightLineKm: null, coords: null }
        : { source: 'estimate', options: rideOptions(TRIP_KM), basis: 'geocoded', distanceKm: TRIP_KM, straightLineKm: 7.7, roadFactor: 1.3, coords: { pickup: PICKUP, dropoff: DROPOFF } };
    }
    if (args[0] === 'geocode') return /nowhere/i.test(String(args[1])) ? { error: 'not found' } : { ...DROPOFF, label: String(args[1]) };
    if (args[0] === 'reverse') return { label: 'Dropped pin' };
    if (args[0] === 'ride') return { source: 'uber', rideUrl: `https://m.uber.com/ul/?action=setPickup&dropoff=${encodeURIComponent(args[2])}`, webUrl: 'https://m.uber.com/ul/', appUrl: 'uber://' };
    return {};
  }
  return { calls, run };
}

/** An in-memory pool answering the Rides route SQL; every statement is recorded. */
function fakePool() {
  const t = { requests: [] };
  const sql = [];
  const rows = (r) => ({ rows: r, rowCount: r.length });
  const handlers = [
    [/^SELECT \* FROM rides_profile WHERE user_sub = \$1/, () => rows([])],
    [/^INSERT INTO rides_requests/, (p) => { t.requests.push({ user_sub: p[0], pickup: p[1], dropoff: p[2], ride_type: p[3], est_fare_low: p[4], est_fare_high: p[5], deep_link: p[6] }); return rows([]); }],
    [/^SELECT pickup, dropoff, ride_type, est_fare_low, est_fare_high, deep_link, created_at FROM rides_requests/, (p) => rows(t.requests.filter((r) => r.user_sub === p[0]))],
    [/^SELECT 1 FROM oshal_connections WHERE provider='uber-rides'/, () => rows([])],
  ];
  return {
    tables: t, sql,
    async query(text, params = []) {
      const s = String(text).trim();
      sql.push({ text: s, params });
      const hit = handlers.find(([re]) => re.test(s));
      if (!hit) throw new Error(`fake pool cannot answer: ${s.slice(0, 90)}`);
      return hit[1](params);
    },
  };
}

/** The shared conversation store the route uses, as an in-memory double. */
class FakeConciergeStore {
  constructor() { this.messages = []; }
  async ensureConversation() { return 'conv-1'; }
  async addMessage(conversationId, sub, role, content) { this.messages.push({ conversationId, sub, role, content }); }
  async loadHistory() { return []; }
  async touch() {}
  async resume() { return { conversationId: null, messages: [] }; }
}

/**
 * @description Load the compiled route module with stubbed framework imports and return its handlers.
 * @param {{ pool?: object, provider?: object, reply?: object|Function, express?: object }} opts - `express`:
 *   a real express module (the browser fixture's); `reply`: the concierge's JSON envelope, or a
 *   function of the prompt returning one.
 * @returns {{ handlers: object, pool: object, provider: object, prompts: string[], router: object }}
 */
function loadRoutes(opts = {}) {
  const handlers = { get: new Map(), post: new Map() };
  const pool = opts.pool || fakePool();
  const provider = opts.provider || fakeProvider();
  const prompts = [];
  const router = {
    get(p, h) { handlers.get.set(p, h); return this; },
    post(p, h) { handlers.post.set(p, h); return this; },
    use() { return this; },
  };
  const stubs = {
    express: opts.express || { Router: () => router, static: () => () => {} },
    path,
    crypto: { randomUUID: () => 'test-uuid' },
    '@/shared/logger': { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) },
    '@/shared/services/database': { buildOwnerRlsPolicyStatements: () => [], runRuntimeSchemaBootstrap: async () => {} },
    '@/shared/middleware/authz': { getTrustedServiceUserSub: () => undefined },
    '@/app/routes/connector-token-broker': { resolveServerOperationCreds: async () => ({ OSHAL_CRED_UBER_RIDES: undefined }) },
    '@/app/routes/provider-operation-clients': { runUberRidesProviderOperation: async (_cred, args) => provider.run(args) },
    '@/app/routes/concierge-store': { ConciergeStore: FakeConciergeStore },
    '@/app/routes/concierge-reply': { cleanConciergeReply: (t, fb) => (typeof t === 'string' && t.trim() ? t : (fb || '')) },
    '@/features/agent-management': { BotNodeClient: class {}, createRegistryEndpointResolver: () => () => undefined },
    '@/app/routes/inline-bot-execution': {
      executeBotOrInline: async (_ctx, _client, _agent, input) => {
        prompts.push(input.text);
        const reply = typeof opts.reply === 'function' ? opts.reply(input.text) : opts.reply;
        return { response: JSON.stringify(reply || { say: 'ok' }) };
      },
    },
  };
  const shimRequire = (request) => {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    throw new Error(`unexpected require in rides route module: ${request}`);
  };
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', '__filename', '__dirname', fs.readFileSync(ROUTE_FILE, 'utf8'))(
    shimRequire, mod, mod.exports, ROUTE_FILE, path.dirname(ROUTE_FILE));
  const mounted = mod.exports.createRidesRoutes({ pool, appPackageDir: PKG });
  return { handlers, pool, provider, prompts, exports: mod.exports, router: mounted };
}

/** A recording response. */
function fakeRes() {
  return {
    statusCode: 200, body: undefined,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    send(b) { this.body = b; return this; },
    sendFile(b) { this.body = b; return this; },
  };
}

/** A signed-in rider request. */
const authed = (sub, extra = {}) => ({ oidc: { isAuthenticated: () => true, user: { sub } }, query: {}, body: {}, params: {}, path: '/', ...extra });
/** An anonymous request. */
const anon = (extra = {}) => ({ oidc: { isAuthenticated: () => false }, query: {}, body: {}, params: {}, path: '/', ...extra });

/** Run one registered handler and return the recording response. */
async function call(handlers, method, route, req) {
  const handler = handlers[method].get(route);
  if (!handler) throw new Error(`no ${method.toUpperCase()} ${route} registered`);
  const res = fakeRes();
  await handler(req, res);
  return res;
}

module.exports = { RIDE_TYPES, TRIP_KM, fakePool, fakeProvider, loadRoutes, authed, anon, call };
