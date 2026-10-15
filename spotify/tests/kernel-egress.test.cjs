/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Under the native kernel (OSHAL_EGRESS=kernel) the compiled Spotify routes, loaded with the bridge's own
 *   inert stand-ins for the framework broker and spotify-client, send every Web API request to api.spotify.com with no
 *   Authorization header and no key in the URL, map the answers to the same profile, track and playlist shapes, build a
 *   playlist with two JSON POSTs, run the concierge chat on live search candidates, and answer a missing, revoked or lapsed
 *   connection, or a kernel "not connected" refusal, with each route's existing not-connected answer. Outside the kernel the
 *   broker token still reaches the framework client.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');

const brokerCalls = [];
const frameworkCalls = [];
/** The framework spotify-client: inert under the kernel (as the bridge's compat shim), a recording client otherwise. */
const frameworkClient = Object.fromEntries(['spotifyMe', 'spotifySearchTracks', 'spotifyNowPlaying', 'spotifyMyPlaylists', 'spotifyTopTracks', 'spotifyCreatePlaylist']
  .map((name) => [name, async (token) => {
    frameworkCalls.push([name, token]);
    if (process.env.OSHAL_EGRESS) return name === 'spotifyMe' || name === 'spotifyNowPlaying' ? null : name === 'spotifyCreatePlaylist' ? {} : [];
    return name === 'spotifyMe' ? { id: 'legacy-user', displayName: 'Legacy', product: 'premium', imageUrl: null, country: 'US' } : [];
  }]));
class ConciergeStore {
  async ensureConversation() { return 'conv-1'; }
  async addMessage() {}
  async loadHistory() { return []; }
  async loadNotes() { return []; }
  async saveNote() {}
  async touch() {}
  async resume() { return {}; }
}
const STUBS = {
  express: { Router: () => { const routes = {}; const add = (m) => (p, ...h) => { routes[`${m} ${p}`] = h[h.length - 1]; }; return { routes, get: add('GET'), post: add('POST') }; } },
  '@/shared/logger': { createChildLogger: () => ({ error() {}, info() {}, warn() {}, debug() {} }) },
  '@/shared/services/database': { runRuntimeSchemaBootstrap: async () => {}, buildOwnerRlsPolicyStatements: () => [] },
  '@/shared/middleware/authz': { getTrustedServiceUserSub: () => null },
  '@/app/routes/connectors-routes': { getValidAccessToken: async (_pool, sub, provider) => { brokerCalls.push([sub, provider]); return process.env.OSHAL_EGRESS ? null : 'legacy-token'; } },
  '@/app/routes/spotify-client': frameworkClient,
  '@/app/routes/concierge-envelope': {
    extractEnvelopeJson: (text) => { try { return JSON.parse(text); } catch { return null; } },
    asStringArray: (v) => (Array.isArray(v) ? v.map(String) : []),
    sayOr: (o, fallback) => (typeof o.say === 'string' && o.say ? o.say : fallback),
  },
  '@/app/routes/concierge-store': { ConciergeStore },
};
const original = Module._load;
Module._load = function (request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  if (request.startsWith('@/')) throw new Error(`unexpected framework import ${request}`);
  return original.call(this, request, ...rest);
};
const { createSpotifyRoutes } = require('../routes/spotify-routes.js');
test.after(() => { Module._load = original; });

/** A JSON Response the way the bridge's egress fetch builds one. */
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * Drive one route with a scripted fetch and connection metadata.
 * @param route - "GET /search" etc.
 * @param opts - meta (connectors.metadata answer, undefined for a context without the intent), answer (url, init) => Response | Error.
 */
async function call(route, { meta, answer, query = {}, body, kernel = true, orchestrator } = {}) {
  const calls = [];
  const saved = globalThis.fetch;
  if (kernel) process.env.OSHAL_EGRESS = 'kernel'; else delete process.env.OSHAL_EGRESS;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const reply = answer(String(url), init);
    if (reply instanceof Error) throw reply;
    return reply;
  };
  const ctx = { pool: { query: async () => ({ rows: [] }) }, orchestrator, ...(meta === undefined ? {} : { intent: async (name) => { assert.equal(name, 'connectors.metadata'); return meta; } }) };
  const res = { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(b) { this.body = b; }, send(b) { this.body = b; } };
  try {
    await createSpotifyRoutes(ctx).routes[route]({ oidc: { isAuthenticated: () => true, user: { sub: 'alice' } }, query, body, path: route.split(' ')[1] }, res);
  } finally {
    globalThis.fetch = saved;
    delete process.env.OSHAL_EGRESS;
  }
  return { res, calls };
}

/** Every request went to api.spotify.com over https and carried only package headers: no credential of any kind. */
function assertNoCredential(calls) {
  assert.ok(calls.length > 0, 'at least one request');
  for (const { url, init } of calls) {
    const u = new URL(url);
    assert.equal(u.protocol, 'https:');
    assert.equal(u.host, 'api.spotify.com');
    const names = Object.keys(init.headers || {}).map((h) => h.toLowerCase());
    assert.deepEqual(names, ['content-type'], `${url} carries ${names.join(',')}`);
    assert.ok(!/access_token|api_key|token=/.test(url), `${url} carries a key`);
  }
}

const CONNECTED = { connections: [{ id: 'c1', provider: 'spotify', revoked: false, expires_at_ms: Date.now() - 1000, renewable: true }] };
const TRACK = { id: 't1', uri: 'spotify:track:t1', name: 'Song', artists: [{ name: 'A' }, { name: 'B' }], album: { name: 'Album', images: [{ url: 'big' }, { url: 'small' }] }, duration_ms: 1000, external_urls: { spotify: 'https://open.spotify.com/track/t1' }, explicit: true };
const MAPPED = { id: 't1', uri: 'spotify:track:t1', title: 'Song', artist: 'A, B', album: 'Album', imageUrl: 'small', durationMs: 1000, url: 'https://open.spotify.com/track/t1', previewUrl: null, explicit: true };

test('config reads /v1/me through the egress with no credential and maps the profile', async () => {
  brokerCalls.length = 0; frameworkCalls.length = 0;
  const { res, calls } = await call('GET /config', { meta: CONNECTED, answer: () => json({ id: 'u1', display_name: 'Alice', product: 'premium', country: 'US', images: [] }) });
  assert.deepEqual(res.body, { connected: true, status: 'ok', me: { id: 'u1', displayName: 'Alice', product: 'premium', imageUrl: null, country: 'US' } });
  assert.equal(calls[0].url, 'https://api.spotify.com/v1/me');
  assertNoCredential(calls);
  assert.deepEqual(brokerCalls, [], 'the framework broker is never consulted under the kernel');
  assert.deepEqual(frameworkCalls, [], 'the inert framework client is never used under the kernel');
  const allowlist = await call('GET /config', { meta: CONNECTED, answer: () => json({ error: { status: 403 } }, 403) });
  assert.deepEqual(allowlist.res.body, { connected: true, status: 'needs_allowlist', me: null });
});

test('search, now playing, playlists and top tracks map Spotify answers to the same shapes', async () => {
  const search = await call('GET /search', { meta: CONNECTED, query: { q: 'lo fi', limit: '5' }, answer: () => json({ tracks: { items: [TRACK, { name: 'no id' }] } }) });
  assert.deepEqual(search.res.body, { items: [MAPPED] });
  const u = new URL(search.calls[0].url);
  assert.equal(u.pathname, '/v1/search');
  assert.equal(u.searchParams.get('q'), 'lo fi');
  assert.equal(u.searchParams.get('limit'), '5');
  assert.equal(u.searchParams.get('market'), 'from_token');
  assertNoCredential(search.calls);

  const idle = await call('GET /now-playing', { meta: CONNECTED, answer: () => new Response(null, { status: 204 }) });
  assert.deepEqual(idle.res.body, { nowPlaying: null });
  const playing = await call('GET /now-playing', { meta: CONNECTED, answer: () => json({ item: TRACK, is_playing: true }) });
  assert.deepEqual(playing.res.body, { nowPlaying: { track: MAPPED, isPlaying: true } });
  assert.equal(new URL(playing.calls[0].url).pathname, '/v1/me/player/currently-playing');

  const lists = await call('GET /playlists', { meta: CONNECTED, answer: () => json({ items: [{ id: 'p1', name: 'Mix', tracks: { total: 3 }, owner: { display_name: 'Alice' }, public: true }] }) });
  assert.deepEqual(lists.res.body, { playlists: [{ id: 'p1', name: 'Mix', trackCount: 3, imageUrl: null, url: 'https://open.spotify.com/playlist/p1', owner: 'Alice', isPublic: true }] });
  assert.equal(new URL(lists.calls[0].url).pathname, '/v1/me/playlists');

  const top = await call('GET /top-tracks', { meta: CONNECTED, answer: () => json({ items: [TRACK] }) });
  assert.deepEqual(top.res.body, { items: [MAPPED] });
  assert.equal(new URL(top.calls[0].url).pathname, '/v1/me/top/tracks');
  for (const r of [idle, playing, lists, top]) assertNoCredential(r.calls);
});

test('building a playlist posts JSON to /users/:id/playlists then /playlists/:id/tracks with no credential', async () => {
  const { res, calls } = await call('POST /playlist', {
    meta: CONNECTED, body: { name: 'Focus', trackUris: ['spotify:track:t1', 'spotify:track:t2'] },
    answer: (url) => (url.endsWith('/v1/me') ? json({ id: 'u 1' }) : url.endsWith('/playlists') ? json({ id: 'p9', name: 'Focus', external_urls: { spotify: 'https://open.spotify.com/playlist/p9' } }) : json({ snapshot_id: 's' }, 201)),
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.playlist.id, 'p9');
  assert.equal(res.body.playlist.added, 2);
  assert.deepEqual(calls.map((c) => [c.init.method || 'GET', new URL(c.url).pathname]), [['GET', '/v1/me'], ['POST', '/v1/users/u%201/playlists'], ['POST', '/v1/playlists/p9/tracks']]);
  assert.deepEqual(JSON.parse(calls[1].init.body), { name: 'Focus', description: 'Built by the OSHAL Spotify concierge', public: false });
  assert.deepEqual(JSON.parse(calls[2].init.body), { uris: ['spotify:track:t1', 'spotify:track:t2'] });
  assertNoCredential(calls);
});

test('the concierge chat runs on live search candidates and builds the playlist the brain asks for', async () => {
  const prompts = [];
  const orchestrator = { processMessage: async (_id, prompt) => { prompts.push(prompt); return { response: JSON.stringify({ say: 'Here you go', show: ['t1'], playlist: { name: 'Chill', trackIds: ['t1'] }, remember: [] }) }; } };
  const { res, calls } = await call('POST /chat', {
    meta: CONNECTED, orchestrator, body: { message: 'chill songs' },
    answer: (url) => {
      const p = new URL(url).pathname;
      if (p === '/v1/search' || p === '/v1/me/top/tracks') return json({ tracks: { items: [TRACK] }, items: [TRACK] });
      if (p === '/v1/me/player/currently-playing') return new Response(null, { status: 204 });
      if (p === '/v1/me') return json({ id: 'u1' });
      return json({ id: 'p2', name: 'Chill' });
    },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.reply, 'Here you go');
  assert.deepEqual(res.body.cards, [MAPPED]);
  assert.equal(res.body.playlist.id, 'p2');
  assert.match(prompts[0], /id:t1 \| Song — A, B/);
  assertNoCredential(calls);
});

const ANSWERS = [
  ['GET /config', 200, { connected: false, status: 'not_connected', me: null }],
  ['GET /search', 409, { error: 'not_connected', items: [] }, { q: 'x' }],
  ['GET /now-playing', 200, { nowPlaying: null }],
  ['GET /playlists', 200, { playlists: [] }],
  ['GET /top-tracks', 200, { items: [] }],
  ['POST /playlist', 409, { error: 'not_connected' }, {}, { name: 'n', trackUris: ['spotify:track:t1'] }],
  ['POST /chat', 409, { error: 'not_connected', reply: 'Connect your Spotify first (the Cloud / Connections page), then I can find tracks and build playlists for you.' }, {}, { message: 'hi' }],
];

test('no, revoked or lapsed spotify connection gives each route its existing not-connected answer without a request', async () => {
  const metas = [
    { connections: [] },
    { connections: [{ provider: 'github', revoked: false }] },
    { connections: [{ provider: 'spotify', revoked: true, expires_at_ms: null }] },
    { connections: [{ provider: 'spotify', revoked: false, expires_at_ms: Date.now() - 1000, renewable: false }] },
  ];
  for (const meta of metas) {
    for (const [route, status, expected, query, body] of ANSWERS) {
      const { res, calls } = await call(route, { meta, query, body, answer: () => assert.fail(`no request for ${route}`) });
      assert.equal(res.statusCode, status, route);
      assert.deepEqual(res.body, expected, route);
      assert.equal(calls.length, 0);
    }
  }
});

test('a kernel "not connected" refusal gives each route its existing not-connected answer', async () => {
  const refusal = () => Object.assign(new Error('spotify is not connected: connect it on Utilities or set OSHAL_CONNECTOR_SECRET_SPOTIFY for the installation'), { code: 'native_executor_unavailable' });
  for (const meta of [undefined, CONNECTED]) {
    for (const [route, status, expected, query, body] of ANSWERS) {
      const { res, calls } = await call(route, { meta, query, body, answer: refusal });
      assert.equal(res.statusCode, status, route);
      assert.deepEqual(res.body, expected, route);
      assert.ok(calls.length >= 1, `${route} asked the kernel`);
    }
  }
});

test('outside the kernel the broker token still reaches the framework client and the package sends nothing itself', async () => {
  brokerCalls.length = 0; frameworkCalls.length = 0;
  const { res, calls } = await call('GET /config', { kernel: false, answer: () => assert.fail('no package fetch on the legacy path') });
  assert.equal(res.body.status, 'ok');
  assert.equal(res.body.me.displayName, 'Legacy');
  assert.deepEqual(brokerCalls, [['alice', 'spotify']]);
  assert.deepEqual(frameworkCalls, [['spotifyMe', 'legacy-token']]);
  assert.equal(calls.length, 0);
  const search = await call('GET /search', { kernel: false, query: { q: 'x' }, answer: () => assert.fail('no package fetch') });
  assert.deepEqual(search.res.body, { items: [] });
  assert.deepEqual(frameworkCalls.at(-1), ['spotifySearchTracks', 'legacy-token']);
});

test('the manifest declares api.spotify.com with the spotify connector as a Bearer credential', () => {
  const manifest = fs.readFileSync(path.join(__dirname, '..', 'oshal-app.yaml'), 'utf8');
  assert.match(manifest, /\negress:\n {2}- host: api\.spotify\.com\n {4}credential: \{ connector: spotify, header: authorization, prefix: "Bearer " \}\n/);
});
