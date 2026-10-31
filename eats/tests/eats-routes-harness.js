/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial: load the COMPILED Eats route module (the bytes the framework mounts) with every framework import stubbed, an in-memory pool that answers exactly the SQL the routes issue, a recording Uber Eats provider over a two-restaurant curated menu, and a scripted concierge.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Native admission double: admittedPool applies the native host's rule (crates/packages/src/sql_transaction.rs) to every statement, so while callAdmitted runs a GET only a query or idempotent table setup reaches the pool and any other statement is refused with the host's own message; a per-request mode resolver serves the browser fixture's concurrent requests.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | opts.notes seeds the diner's saved concierge notes and store() returns the route's concierge store, so a test can see the notes the prompt carries and the notes a chat turn saves.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | A string reply is passed through as the model's raw text, so a test can send a malformed envelope.
 * 7 | maintainer@emeraldcoastsystemsgroup.com   | 1.5.0: the pool answers the place cache tables (lookups, searches, places) with one-column keys, DELETE then INSERT, and a duplicate-key refusal; fakePool(seed) takes lookups/searches/places; the compiled ./place-cache is served real.
 * 6 | maintainer@emeraldcoastsystemsgroup.com   | 1.4.2: the Geocoding host (maps.googleapis.com) answers the reverse lookup for coordinates with the same synthetic address; `reverse(url)` scripts it.
 * 5 | maintainer@emeraldcoastsystemsgroup.com   | 1.4.0: the Uber Eats provider double and the curated menu are gone. fakePlaces is a recording fetch shaped like Google Places (New): the test address resolves to one place, a restaurant search answers three restaurants as Google returns them (display name objects, price-level enums, opening hours, photo resource names), a place lookup by id and a photo media call answer too, and an override can refuse (status + body), throw (the kernel's missing-key sentence) or script the answers. The pool answers the profile, the hand-off rows and the history. The compiled ./places and ./uber-link modules are served real, so the routes' behaviour over them is what the tests see.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const PKG = path.resolve(__dirname, '..');
const ROUTE_FILE = path.join(PKG, 'routes', 'eats-routes.js');

/** Google's answer for the test delivery address: one place with its id and coordinates. */
const PLACE = { id: 'ChIJ-synthetic-address', formattedAddress: '1 Synthetic Way, Pensacola, FL 32502, USA', location: { latitude: 30.4213, longitude: -87.2169 } };

/** Three restaurants as Google Places (New) returns them. */
const RESTAURANTS = [
  { id: 'ChIJ-taco-mahal', displayName: { text: 'Taco Mahal', languageCode: 'en' }, formattedAddress: '12 Synthetic St, Pensacola, FL 32502, USA',
    location: { latitude: 30.43, longitude: -87.21 }, types: ['mexican_restaurant', 'restaurant', 'food'], primaryTypeDisplayName: { text: 'Mexican restaurant' },
    rating: 4.6, userRatingCount: 57, priceLevel: 'PRICE_LEVEL_INEXPENSIVE', currentOpeningHours: { openNow: true }, delivery: true, takeout: true,
    photos: [{ name: 'places/ChIJ-taco-mahal/photos/photo-1', widthPx: 1200, heightPx: 800 }], googleMapsUri: 'https://maps.google.com/?cid=1', websiteUri: 'https://tacomahal.example' },
  { id: 'ChIJ-sushi-house', displayName: { text: 'Sushi House' }, formattedAddress: '2 Synthetic Ave, Pensacola, FL 32502, USA',
    location: { latitude: 30.41, longitude: -87.22 }, types: ['japanese_restaurant', 'restaurant'], primaryTypeDisplayName: { text: 'Japanese restaurant' },
    rating: 4.8, userRatingCount: 812, priceLevel: 'PRICE_LEVEL_MODERATE', currentOpeningHours: { openNow: false }, delivery: true, takeout: false, photos: [] },
  { id: 'ChIJ-thai-garden', displayName: { text: 'Thai Garden' }, formattedAddress: '3 Synthetic Blvd, Pensacola, FL 32502, USA',
    location: { latitude: 30.44, longitude: -87.2 }, types: ['thai_restaurant', 'restaurant'], primaryTypeDisplayName: { text: 'Thai restaurant' },
    rating: 4.4, userRatingCount: 120, delivery: false },
];

/** Google's 403 for a key whose project has not enabled Places API (New), as the live key answered on 2026-10-30. */
const SERVICE_DISABLED = {
  error: {
    code: 403,
    message: 'Places API (New) has not been used in project 1085759851735 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/places.googleapis.com/overview?project=1085759851735 then retry.',
    status: 'PERMISSION_DENIED',
    details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'SERVICE_DISABLED', domain: 'googleapis.com',
      metadata: { service: 'places.googleapis.com', consumer: 'projects/1085759851735', activationUrl: 'https://console.developers.google.com/apis/api/places.googleapis.com/overview?project=1085759851735' } }],
  },
};
/** The kernel's own refusal when OSHAL_CONNECTOR_SECRET_GOOGLE_PLACES is not set (crates/oshald/src/package_egress.rs). */
const NOT_CONNECTED = 'google-places is not connected: connect it on Utilities or set OSHAL_CONNECTOR_SECRET_GOOGLE_PLACES for the installation';

/**
 * @description A recording fetch shaped like Google Places (New).
 * @param {{ status?: number, body?: object, throws?: Error, geocode?: Function, reverse?: Function, search?: Function, respond?: Function }} [overrides]
 *   `status`+`body` refuse every call; `throws` makes every call throw; `geocode(body)` / `search(body)` script those answers;
 *   `respond(url, init, body)` answers first when it returns something.
 * @returns {{ requests: object[], fetch: Function }}
 */
function fakePlaces(overrides = {}) {
  const requests = [];
  const answer = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  async function fetch(url, init = {}) {
    const body = init.body ? JSON.parse(init.body) : null;
    requests.push({ url: String(url), method: init.method || 'GET', headers: init.headers || {}, body });
    if (typeof overrides.respond === 'function') { const r = overrides.respond(String(url), init, body); if (r) return r; }
    if (overrides.throws) throw overrides.throws;
    if (overrides.status) return answer(overrides.status, overrides.body || {});
    const u = String(url);
    if (u.startsWith('https://maps.googleapis.com/maps/api/geocode/json')) {
      if (overrides.reverse) return answer(200, overrides.reverse(u));
      return answer(200, { status: 'OK', results: [{ formatted_address: PLACE.formattedAddress, place_id: PLACE.id, geometry: { location: { lat: PLACE.location.latitude, lng: PLACE.location.longitude } }, types: ['street_address'] }] });
    }
    if (u.includes('/places:searchText')) {
      if (body && body.includedType === 'restaurant') return answer(200, overrides.search ? overrides.search(body) : { places: RESTAURANTS });
      return answer(200, overrides.geocode ? overrides.geocode(body) : { places: [PLACE] });
    }
    const details = u.match(/\/v1\/places\/([^/?]+)\?/);
    if (details) {
      const r = RESTAURANTS.find((x) => x.id === decodeURIComponent(details[1]));
      return r ? answer(200, r) : answer(404, { error: { code: 404, message: 'not found', status: 'NOT_FOUND' } });
    }
    const media = u.match(/\/v1\/(places\/[^/]+\/photos\/[^/]+)\/media/);
    if (media) return answer(200, { name: media[1], photoUri: `https://lh3.googleusercontent.com/synthetic/${media[1].split('/').pop()}` });
    return answer(404, {});
  }
  return { requests, fetch };
}

/** An in-memory pool answering the Eats route SQL; every statement is recorded. */
function fakePool(seed = {}) {
  const t = { profiles: { ...(seed.profiles || {}) }, orders: [...(seed.orders || [])], lookups: { ...(seed.lookups || {}) }, searches: { ...(seed.searches || {}) }, places: { ...(seed.places || {}) } };
  const sql = [];
  const rows = (r) => ({ rows: r, rowCount: r.length });
  const handlers = [
    [/^SELECT \* FROM eats_profile WHERE user_sub = \$1/, (p) => rows(t.profiles[p[0]] ? [t.profiles[p[0]]] : [])],
    [/^INSERT INTO eats_profile/, (p) => {
      const old = t.profiles[p[0]] || { user_sub: p[0], display_name: null, dietary: [], favorite_cuisines: [], default_address: null, budget_per_order: null, notes: null, onboarded: false };
      const row = { ...old, display_name: p[1] ?? old.display_name, dietary: p[2] ?? old.dietary, favorite_cuisines: p[3] ?? old.favorite_cuisines, default_address: p[4] ?? old.default_address,
        budget_per_order: p[5] ?? old.budget_per_order, notes: p[6] ?? old.notes, onboarded: Boolean(p[7]) || old.onboarded };
      t.profiles[p[0]] = row; return rows([row]);
    }],
    [/^INSERT INTO eats_orders/, (p) => { t.orders.push({ user_sub: p[0], store_id: p[1], store_name: p[2], total: null, handoff_url: p[3], created_at: new Date().toISOString() }); return rows([]); }],
    [/^SELECT store_id, store_name, total, handoff_url, created_at\s+FROM eats_orders/, (p) => rows(t.orders.filter((o) => o.user_sub === p[0]).slice().reverse())],
    // The place cache (migration 041): one-column text keys, DELETE by key then INSERT, a duplicate key refused as Postgres does.
    [/^SELECT address, place_id, latitude, longitude, fetched_ms FROM eats_place_lookups WHERE lookup_key = \$1$/, (p) => rows(t.lookups[p[0]] ? [t.lookups[p[0]]] : [])],
    [/^DELETE FROM eats_place_lookups WHERE lookup_key = \$1$/, (p) => { delete t.lookups[p[0]]; return rows([]); }],
    [/^INSERT INTO eats_place_lookups/, (p) => { if (t.lookups[p[0]]) throw new Error('duplicate key value violates unique constraint "eats_place_lookups_pkey"'); t.lookups[p[0]] = { lookup_key: p[0], user_sub: p[1], address: p[2], place_id: p[3], latitude: p[4], longitude: p[5], source: p[6], fetched_ms: p[7], expires_ms: p[8] }; return rows([]); }],
    [/^SELECT restaurants, fetched_ms FROM eats_search_cache WHERE search_key = \$1$/, (p) => rows(t.searches[p[0]] ? [t.searches[p[0]]] : [])],
    [/^DELETE FROM eats_search_cache WHERE search_key = \$1$/, (p) => { delete t.searches[p[0]]; return rows([]); }],
    [/^INSERT INTO eats_search_cache/, (p) => { if (t.searches[p[0]]) throw new Error('duplicate key value violates unique constraint "eats_search_cache_pkey"'); t.searches[p[0]] = { search_key: p[0], user_sub: p[1], query: p[2], place_id: p[3], restaurants: p[4], fetched_ms: p[5], expires_ms: p[6] }; return rows([]); }],
    [/^SELECT card, fetched_ms FROM eats_places WHERE place_key = \$1$/, (p) => rows(t.places[p[0]] ? [t.places[p[0]]] : [])],
    [/^DELETE FROM eats_places WHERE place_key = \$1$/, (p) => { delete t.places[p[0]]; return rows([]); }],
    [/^INSERT INTO eats_places/, (p) => { if (t.places[p[0]]) throw new Error('duplicate key value violates unique constraint "eats_places_pkey"'); t.places[p[0]] = { place_key: p[0], user_sub: p[1], place_id: p[2], card: p[3], fetched_ms: p[4], expires_ms: p[5] }; return rows([]); }],
  ];
  return {
    tables: t, sql,
    async query(text, params = []) {
      const s = String(text && typeof text === 'object' ? text.text : text).trim();
      sql.push({ text: s, params });
      const hit = handlers.find(([re]) => re.test(s));
      if (!hit) throw new Error(`fake pool cannot answer: ${s.slice(0, 90)}`);
      return hit[1](params);
    },
  };
}

/** The shared conversation store the route uses, as an in-memory double. */
class FakeConciergeStore {
  constructor() { this.messages = []; this.notes = []; FakeConciergeStore.last = this; }
  async ensureConversation() { return 'conv-1'; }
  async addMessage(conversationId, sub, role, content) { this.messages.push({ conversationId, sub, role, content }); }
  async loadHistory() { return []; }
  async loadNotes() { return [...(FakeConciergeStore.seedNotes || [])]; }
  async saveNote(_sub, note) { this.notes.push(note); }
  async touch() {}
  async resume() { return { conversationId: null, messages: [] }; }
}

/**
 * @description Load the compiled route module with stubbed framework imports and return its handlers.
 * @param {{ pool?: object, places?: object, reply?: object|Function, express?: object, notes?: string[] }} opts - `express`:
 *   a real express module (the browser fixture's); `reply`: the concierge's JSON envelope (a string is sent as the model's
 *   raw text), or a function of the prompt returning one; `places`: a fakePlaces() double.
 * @returns {{ handlers: object, pool: object, places: object, prompts: string[], router: object, exports: object, store: Function }}
 */
function loadRoutes(opts = {}) {
  const handlers = { get: new Map(), post: new Map(), delete: new Map() };
  const pool = opts.pool || fakePool();
  const places = opts.places || fakePlaces();
  const prompts = [];
  FakeConciergeStore.seedNotes = opts.notes || [];
  const router = {
    get(p, h) { handlers.get.set(p, h); return this; },
    post(p, h) { handlers.post.set(p, h); return this; },
    delete(p, h) { handlers.delete.set(p, h); return this; },
    use() { return this; },
  };
  const stubs = {
    express: opts.express || { Router: () => router },
    path,
    crypto: { randomUUID: () => 'test-uuid' },
    './remembered-notes': require(path.join(PKG, 'routes', 'remembered-notes.js')),
    './allergen-check': require(path.join(PKG, 'routes', 'allergen-check.js')),
    './places': require(path.join(PKG, 'routes', 'places.js')),
    './uber-link': require(path.join(PKG, 'routes', 'uber-link.js')),
    './place-cache': require(path.join(PKG, 'routes', 'place-cache.js')),
    '@/shared/logger': { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) },
    '@/shared/services/database': { buildOwnerRlsPolicyStatements: () => [], runRuntimeSchemaBootstrap: async () => {} },
    '@/shared/middleware/authz': { getTrustedServiceUserSub: () => undefined },
    '@/app/routes/concierge-store': { ConciergeStore: FakeConciergeStore },
    '@/app/routes/concierge-reply': { cleanConciergeReply: (t, fb) => (typeof t === 'string' && t.trim() ? t : (fb || '')) },
    '@/features/agent-management': { BotNodeClient: class {}, createRegistryEndpointResolver: () => () => undefined },
    '@/app/routes/inline-bot-execution': {
      executeBotOrInline: async (_ctx, _client, _agent, input) => {
        prompts.push(input.text);
        const reply = typeof opts.reply === 'function' ? opts.reply(input.text) : opts.reply;
        return { response: typeof reply === 'string' ? reply : JSON.stringify(reply || { say: 'ok' }) };
      },
    },
  };
  const shimRequire = (request) => {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    throw new Error(`unexpected require in eats route module: ${request}`);
  };
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', '__filename', '__dirname', fs.readFileSync(ROUTE_FILE, 'utf8'))(
    shimRequire, mod, mod.exports, ROUTE_FILE, path.dirname(ROUTE_FILE));
  mod.exports.resetCaches();
  const mounted = mod.exports.createEatsRoutes({ pool, appPackageDir: PKG, fetch: places.fetch });
  return { handlers, pool, places, prompts, exports: mod.exports, router: mounted, store: () => FakeConciergeStore.last };
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
/** A signed-in diner request. */
const authed = (sub, extra = {}) => ({ oidc: { isAuthenticated: () => true, user: { sub } }, query: {}, body: {}, params: {}, path: '/', method: 'GET', ...extra });
/** An anonymous request. */
const anon = (extra = {}) => ({ oidc: { isAuthenticated: () => false }, query: {}, body: {}, params: {}, path: '/', method: 'GET', ...extra });
/** Run one registered handler and return the recording response. */
async function call(handlers, method, route, req) {
  const handler = handlers[method].get(route);
  if (!handler) throw new Error(`no ${method.toUpperCase()} ${route} registered`);
  const res = fakeRes();
  await handler({ ...req, method: method.toUpperCase() }, res);
  return res;
}

/** A statement the native host runs under read admission: a query. */
const READ_STATEMENT = /^\s*(?:SELECT|WITH|VALUES|TABLE)\b/i;
/** Idempotent table setup, which read admission also allows (a reader's lazy declaration). */
const IDEMPOTENT_DDL = /^\s*CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)\s+IF\s+NOT\s+EXISTS\b/i;
/** The native host's refusal, verbatim (crates/packages/src/sql_transaction.rs). */
const WRITER_REFUSAL = 'SQL mutation requires original writer admission';

/**
 * @description Wrap a pool in the native host's admission rule. In 'read' mode (a GET) a statement that is
 * not a query or idempotent table setup is refused before it reaches the pool, exactly as the native
 * package host refuses it, and is recorded in `refused`; in 'write' mode every statement passes.
 * @param {object} pool - The pool the routes would otherwise use.
 * @param {() => (string|undefined)} [modeOf] - Per-request mode for a server that runs requests concurrently.
 * @returns {object} A pool with `mode`, `refused`, `tables` and `sql`.
 */
function admittedPool(pool, modeOf = () => undefined) {
  const admitted = {
    mode: 'write', refused: [], tables: pool.tables, sql: pool.sql,
    async query(text, params) {
      const statement = String(text && typeof text === 'object' ? text.text : text);
      const mode = modeOf() || admitted.mode;
      if (mode === 'read' && !READ_STATEMENT.test(statement) && !IDEMPOTENT_DDL.test(statement)) {
        admitted.refused.push(statement.trim().replace(/\s+/g, ' ').slice(0, 120));
        throw new Error(`refused: ${WRITER_REFUSAL}`);
      }
      return pool.query(text, params);
    },
  };
  return admitted;
}

/**
 * @description Run one handler the way the native host admits it: a GET read-only, every other method as a writer.
 * @param {object} handlers - The registered handlers. @param {string} method - get/post/delete. @param {string} route - The path.
 * @param {object} req - The request. @param {object} pool - An admittedPool.
 * @returns {Promise<object>} The recording response.
 */
async function callAdmitted(handlers, method, route, req, pool) {
  pool.mode = method === 'get' ? 'read' : 'write';
  try { return await call(handlers, method, route, req); } finally { pool.mode = 'write'; }
}

module.exports = { PLACE, RESTAURANTS, SERVICE_DISABLED, NOT_CONNECTED, WRITER_REFUSAL, fakePlaces, fakePool, FakeConciergeStore, loadRoutes, fakeRes, authed, anon, call, admittedPool, callAdmitted };
