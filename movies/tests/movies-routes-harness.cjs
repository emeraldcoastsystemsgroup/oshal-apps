/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.1.8 (lane CHATCORE3): load the COMPILED Movies route module (the bytes the
 *   framework mounts) with every framework import stubbed: an in-memory pool that answers the profile and watchlist SQL the
 *   routes issue, a concierge store whose notes are rows of one table (per viewer), and a TMDB client double that answers
 *   as connected through the kernel. `express` may be the real module (a browser fixture's router), else a recording router.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const PKG = path.resolve(__dirname, '..');
const ROUTE_FILE = path.join(PKG, 'routes', 'movies-routes.js');

/** The concierge store double: its notes are one table's rows, per viewer. */
class FakeConciergeStore {
  constructor() { FakeConciergeStore.last = this; }
  async loadNotes(sub, limit) { return FakeConciergeStore.notes.filter((row) => row.sub === sub).map((row) => row.note).slice(0, limit || 50); }
  async saveNote(sub, note) { FakeConciergeStore.notes.push({ sub, note }); }
  async ensureConversation() { return 'conv-1'; }
  async addMessage() {}
  async loadHistory() { return []; }
  async touch() {}
  async resume() { return { conversationId: null, messages: [] }; }
}

/**
 * @description An in-memory pool answering the profile and watchlist SQL the Movies routes issue.
 * @param {{profiles?: object, watchlist?: Array<object>}} seed
 * @returns {{tables: object, query: Function}}
 */
function fakePool(seed = {}) {
  const t = { profiles: { ...(seed.profiles || {}) }, watchlist: [...(seed.watchlist || [])] };
  let next = t.watchlist.length + 1;
  return {
    tables: t,
    async query(sql, params = []) {
      const s = String(sql).replace(/\s+/g, ' ').trim();
      if (/^SELECT \* FROM movies_profile WHERE user_sub = \$1/.test(s)) return { rows: t.profiles[params[0]] ? [t.profiles[params[0]]] : [] };
      if (/^SELECT \* FROM movies_watchlist WHERE user_sub = \$1/.test(s)) return { rows: t.watchlist.filter((r) => r.user_sub === params[0]) };
      if (/^SELECT title FROM movies_watchlist WHERE user_sub = \$1/.test(s)) return { rows: t.watchlist.filter((r) => r.user_sub === params[0]).map((r) => ({ title: r.title })) };
      if (/^INSERT INTO movies_watchlist/.test(s)) {
        const [user_sub, item_key, media_type, tmdb_id, title, year, poster_url, tmdb_url] = params;
        if (!t.watchlist.some((r) => r.user_sub === user_sub && r.item_key === item_key)) {
          t.watchlist.unshift({ row_id: `row-${next++}`, user_sub, item_key, media_type, tmdb_id, title, year, poster_url, tmdb_url, status: 'want', created_at: new Date().toISOString() });
        }
        return { rows: [], rowCount: 1 };
      }
      if (/^DELETE FROM movies_watchlist WHERE row_id = \$1 AND user_sub = \$2/.test(s)) {
        t.watchlist = t.watchlist.filter((r) => !(r.row_id === params[0] && r.user_sub === params[1]));
        return { rows: [], rowCount: 1 };
      }
      return { rows: [] };
    },
  };
}

/** A synthetic catalog title, shaped as the TMDB client returns one. */
function title(id, name, year, mediaType = 'movie') {
  return { id, mediaType, key: `${mediaType}:${id}`, title: name, year: String(year), overview: `${name}, a synthetic title.`, posterUrl: null, backdropUrl: null, rating: 7.5, genres: ['Drama'], tmdbUrl: `https://www.themoviedb.org/${mediaType}/${id}` };
}

/**
 * @description Load the compiled Movies route module with stubbed framework imports and return its handlers.
 * @param {{pool?: object, express?: object, notes?: Array<object>, trending?: Array<object>, search?: Function}} opts
 * @returns {{handlers: object, pool: object, router: object, exports: object, store: Function}}
 */
function loadRoutes(opts = {}) {
  FakeConciergeStore.notes = [...(opts.notes || [])];
  const handlers = { get: new Map(), post: new Map(), delete: new Map() };
  const pool = opts.pool || fakePool();
  const router = {
    get(p, h) { handlers.get.set(p, h); return this; },
    post(p, h) { handlers.post.set(p, h); return this; },
    delete(p, h) { handlers.delete.set(p, h); return this; },
    use() { return this; },
  };
  const tmdb = {
    tmdbSearch: async (_key, q) => (opts.search ? opts.search(q) : []),
    tmdbTrending: async () => opts.trending || [],
    tmdbDetails: async () => null,
    tmdbWhereToWatch: async () => ({ link: null, flatrate: [], rent: [], buy: [] }),
    tmdbTrailer: async () => null,
    tmdbRecommendations: async () => [],
    buildTicketsUrl: (name) => `https://www.fandango.com/search?q=${encodeURIComponent(name)}`,
    tmdbConfiguration: async () => ({}),
    kernelEgress: () => true,
    KERNEL_KEY: 'kernel',
  };
  const stubs = {
    express: opts.express || { Router: () => router },
    path,
    crypto: { randomUUID: () => 'test-uuid' },
    '@/shared/logger': { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) },
    '@/shared/services/database': { buildOwnerRlsPolicyStatements: () => [], runRuntimeSchemaBootstrap: async () => {} },
    '@/app/routes/connectors-routes': { getValidAccessToken: async () => null },
    './tmdb-client': tmdb,
    './movies-envelope': require(path.join(PKG, 'routes', 'movies-envelope.js')),
    '@/app/routes/concierge-store': { ConciergeStore: FakeConciergeStore },
  };
  const shimRequire = (request) => {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    throw new Error(`unexpected require in movies route module: ${request}`);
  };
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', '__filename', '__dirname', fs.readFileSync(ROUTE_FILE, 'utf8'))(
    shimRequire, mod, mod.exports, ROUTE_FILE, path.dirname(ROUTE_FILE));
  const mounted = mod.exports.createMoviesRoutes({ pool, appPackageDir: PKG });
  return { handlers, pool, router: mounted, exports: mod.exports, store: () => FakeConciergeStore.last, notes: () => FakeConciergeStore.notes };
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

/** A request signed in as this viewer. */
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

module.exports = { fakePool, loadRoutes, authed, call, title };
