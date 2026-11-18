/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.1.9 (lane CHATCORE3): load the COMPILED Spotify route module (the bytes the
 *   framework mounts) with every framework import stubbed: an in-memory pool that answers the profile SQL the routes issue,
 *   a concierge store whose notes are rows of one table (per listener), and a Spotify client double standing in for
 *   ./kernel-spotify under the native kernel (connected; its tracks, top tracks, playlists and what is playing are the
 *   fixture's; a created playlist is recorded). `express` may be the real module (a browser fixture's router), else a
 *   recording router.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const PKG = path.resolve(__dirname, '..');
const ROUTE_FILE = path.join(PKG, 'routes', 'spotify-routes.js');

/** The concierge store double: its notes are one table's rows, per listener. */
class FakeConciergeStore {
  async loadNotes(sub, limit) { return FakeConciergeStore.notes.filter((row) => row.sub === sub).map((row) => row.note).slice(0, limit || 25); }
  async saveNote(sub, note) { FakeConciergeStore.notes.push({ sub, note }); }
  async ensureConversation() { return 'conv-1'; }
  async addMessage() {}
  async loadHistory() { return []; }
  async touch() {}
  async resume() { return { conversationId: null, messages: [] }; }
}

/**
 * @description An in-memory pool answering the profile SQL the Spotify routes issue.
 * @param {{profiles?: object}} seed
 * @returns {{tables: object, query: Function}}
 */
function fakePool(seed = {}) {
  const t = { profiles: { ...(seed.profiles || {}) } };
  return {
    tables: t,
    async query(sql, params = []) {
      const s = String(sql).replace(/\s+/g, ' ').trim();
      if (/^SELECT \* FROM spotify_profile WHERE user_sub = \$1/.test(s)) return { rows: t.profiles[params[0]] ? [t.profiles[params[0]]] : [] };
      return { rows: [] };
    },
  };
}

/** A synthetic track, shaped as the Spotify client returns one. */
function track(id, title, artist) {
  return { id, uri: `spotify:track:${id}`, title, artist, album: `${title} (single)`, imageUrl: null, durationMs: 200000, url: `https://open.spotify.com/track/${id}`, previewUrl: null, explicit: false };
}

/**
 * @description Load the compiled Spotify route module with stubbed framework imports and a connected Spotify double.
 * @param {{pool?: object, express?: object, notes?: Array<object>, top?: Array<object>, search?: Function, playlists?: Array<object>, playing?: object}} opts
 * @returns {{handlers: object, router: object, created: Array<object>, notes: Function}}
 */
function loadRoutes(opts = {}) {
  FakeConciergeStore.notes = [...(opts.notes || [])];
  const handlers = { get: new Map(), post: new Map() };
  const created = [];
  const recording = {
    get(p, h) { handlers.get.set(p, h); return this; },
    post(p, h) { handlers.post.set(p, h); return this; },
    use() { return this; },
  };
  class SpotifyNotConnected extends Error {}
  const playlists = [...(opts.playlists || [])];
  const spotify = {
    KERNEL_TOKEN: 'kernel',
    SpotifyNotConnected,
    kernelEgress: () => true,
    readConnections: async () => ({ connections: [{ id: 'c1', provider: 'spotify', revoked: false }] }),
    kernelSpotifyToken: () => 'kernel',
    spotifyMe: async () => ({ id: 'listener-1', displayName: 'Listener', product: 'premium', imageUrl: null, country: 'US' }),
    spotifySearchTracks: async (_t, q) => (opts.search ? opts.search(q) : []),
    spotifyNowPlaying: async () => opts.playing || null,
    spotifyMyPlaylists: async () => playlists,
    spotifyTopTracks: async () => opts.top || [],
    spotifyCreatePlaylist: async (_t, userId, name, uris) => {
      const made = { id: `pl-${created.length + 1}`, name, url: `https://open.spotify.com/playlist/pl-${created.length + 1}`, trackCount: uris.length, imageUrl: null };
      created.push({ userId, name, uris });
      playlists.unshift(made);
      return made;
    },
  };
  const stubs = {
    express: opts.express || { Router: () => recording },
    path,
    crypto: { randomUUID: () => 'test-uuid' },
    '@/shared/logger': { createChildLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) },
    '@/shared/services/database': { buildOwnerRlsPolicyStatements: () => [], runRuntimeSchemaBootstrap: async () => {} },
    '@/shared/middleware/authz': { getTrustedServiceUserSub: () => null },
    '@/app/routes/connectors-routes': { getValidAccessToken: async () => null },
    '@/app/routes/spotify-client': {},
    '@/app/routes/concierge-envelope': { extractEnvelopeJson: () => null, asStringArray: (v) => (Array.isArray(v) ? v.map(String) : []), sayOr: (_o, f) => f },
    '@/app/routes/concierge-store': { ConciergeStore: FakeConciergeStore },
    './kernel-spotify': spotify,
  };
  const shimRequire = (request) => {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    throw new Error(`unexpected require in spotify route module: ${request}`);
  };
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', '__filename', '__dirname', fs.readFileSync(ROUTE_FILE, 'utf8'))(
    shimRequire, mod, mod.exports, ROUTE_FILE, path.dirname(ROUTE_FILE));
  const router = mod.exports.createSpotifyRoutes({ pool: opts.pool || fakePool(), appPackageDir: PKG });
  return { handlers, router, created, notes: () => FakeConciergeStore.notes };
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

/** A request signed in as this listener. */
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

module.exports = { fakePool, loadRoutes, authed, call, track };
