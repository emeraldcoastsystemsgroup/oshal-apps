/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.3.5 (lane CHATCORE3): load the COMPILED Travel route module (the bytes the
 *   framework mounts) with every framework import stubbed: an in-memory pool that answers the profile, notes, watches and
 *   search-log SQL the routes issue, and a Duffel provider double (test fares, or no rail at all) with a fixed price read.
 *   `express` may be the real module (a browser fixture's router), else a recording router.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const PKG = path.resolve(__dirname, '..');
const ROUTE_FILE = path.join(PKG, 'routes', 'travel-routes.js');

/**
 * @description An in-memory pool answering the Travel routes' profile, notes, watches and search-log SQL.
 * @param {{profiles?: object, notes?: Array<{user_sub:string,note:string}>, watches?: Array<object>}} seed
 * @returns {{tables: object, query: Function}}
 */
function fakePool(seed = {}) {
  const t = { profiles: { ...(seed.profiles || {}) }, notes: [...(seed.notes || [])], watches: [...(seed.watches || [])] };
  let next = t.watches.length + 1;
  const rows = (r) => ({ rows: r, rowCount: r.length });
  return {
    tables: t,
    async query(sql, params = []) {
      const s = String(sql).replace(/\s+/g, ' ').trim();
      if (/^SELECT \* FROM travel_profile WHERE user_sub = \$1/.test(s)) return rows(t.profiles[params[0]] ? [t.profiles[params[0]]] : []);
      if (/^SELECT note FROM travel_feedback WHERE user_sub = \$1/.test(s)) return rows(t.notes.filter((n) => n.user_sub === params[0]).reverse().map((n) => ({ note: n.note })));
      if (/^INSERT INTO travel_feedback/.test(s)) {
        if (!t.notes.some((n) => n.user_sub === params[0] && n.note.toLowerCase() === String(params[1]).toLowerCase())) t.notes.push({ user_sub: params[0], note: params[1] });
        return rows([]);
      }
      if (/^SELECT \* FROM travel_watches WHERE user_sub = \$1/.test(s)) return rows(t.watches.filter((w) => w.user_sub === params[0]));
      if (/^INSERT INTO travel_watches/.test(s)) {
        const [user_sub, kind, route_key, query, target_price, last_price] = params;
        const watch = { watch_id: `w${next++}`, user_sub, kind, route_key, query: JSON.parse(query), target_price, last_price, status: 'active' };
        t.watches.unshift(watch);
        return rows([watch]);
      }
      if (/^DELETE FROM travel_watches/.test(s)) { t.watches = t.watches.filter((w) => !(w.watch_id === params[0] && w.user_sub === params[1])); return rows([]); }
      return rows([]);
    },
  };
}

/** A synthetic Duffel offer, shaped as the provider operation returns one. */
function offer(n, price) {
  return { id: `fixture-offer-${n}`, airline: `Fixture Air ${n}`, cabin: 'economy', price, currency: 'USD',
    slices: [{ origin: 'VPS', destination: 'DCA', stops: n === 1 ? 0 : 1, duration: '3h 10m', departAt: '2026-12-16T08:00:00' }] };
}

/**
 * @description Load the compiled Travel route module with stubbed framework imports and a Duffel double.
 * @param {{pool?: object, express?: object, rail?: boolean, offers?: Array<object>, price?: object}} opts
 * @returns {{handlers: object, router: object, pool: object, searches: Array<Array<string>>}}
 */
function loadRoutes(opts = {}) {
  const handlers = { get: new Map(), post: new Map(), delete: new Map() };
  const searches = [];
  const recording = {
    get(p, h) { handlers.get.set(p, h); return this; },
    post(p, h) { handlers.post.set(p, h); return this; },
    delete(p, h) { handlers.delete.set(p, h); return this; },
    use() { return this; },
  };
  const rail = opts.rail !== false;
  const status = rail ? { configured: true, connected: true, live: false, mode: 'test' } : { configured: false, connected: false, live: false, mode: 'not_connected' };
  const stubs = {
    express: opts.express || { Router: () => recording },
    path, fs, crypto: { randomUUID: () => 'test-uuid' },
    '@/shared/logger': { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) },
    '@/shared/middleware/authz': { getTrustedServiceUserSub: () => undefined },
    '@/app/routes/connector-token-broker': { resolveServerOperationCreds: async () => ({}) },
    '@/app/routes/provider-operation-clients': {
      runDuffelProviderOperation: async (_creds, args) => {
        if (args[0] === 'status') return status;
        searches.push(args);
        if (!rail) throw Object.assign(new Error('Duffel travel search is unavailable in this native runtime'), { status: 503 });
        return { source: 'duffel-test', note: 'Duffel test fares, not real prices.', items: opts.offers || [] };
      },
    },
    './travel-handoff': require(path.join(PKG, 'routes', 'travel-handoff.js')),
    './duffel-egress': require(path.join(PKG, 'routes', 'duffel-egress.js')),
    '@/app/routes/travel-farewatch': { ensureTravelSchema: async () => {}, routeKeyFor: (kind, q) => `${kind}:${q.origin || q.city}-${q.destination || ''}`,
      recordObservations: async () => {}, priceRead: async () => opts.price || { verdict: 'unknown' } },
  };
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', '__filename', '__dirname', fs.readFileSync(ROUTE_FILE, 'utf8'))(
    (id) => { if (Object.prototype.hasOwnProperty.call(stubs, id)) return stubs[id]; throw new Error(`unexpected require in travel route module: ${id}`); },
    mod, mod.exports, ROUTE_FILE, path.dirname(ROUTE_FILE));
  const pool = opts.pool || fakePool();
  const router = mod.exports.createTravelRoutes({ pool, appPackageDir: PKG, orchestrator: { processMessage: async () => { throw new Error('the page asked its own chat'); } } });
  return { handlers, router, pool, searches };
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

/** A request signed in as this traveller. */
function authed(sub, req = {}) {
  return { query: {}, body: {}, params: {}, ...req, oidc: { isAuthenticated: () => true, user: { sub } } };
}

/** Run one recorded route handler. */
async function call(handlers, method, routePath, req) {
  const handler = handlers[method].get(routePath);
  if (!handler) throw new Error(`no ${method.toUpperCase()} ${routePath}`);
  const res = fakeRes();
  await handler({ path: routePath, method: method.toUpperCase(), ...req }, res);
  return res;
}

module.exports = { fakePool, loadRoutes, authed, call, offer };
