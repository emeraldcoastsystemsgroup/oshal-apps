/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.1.9 (lane CHATCORE3; Roger, 2026-11-16: every concierge is the core Jarvis chat
 *   window). In the window no route hands the Music Concierge the listener's top tracks, profile and notes, or saves what it
 *   learns, so what the page's chat route did is the concierge's tools. Through the COMPILED routes
 *   (tests/spotify-routes-harness.cjs): every tool the manifest declares names a method and path this router answers, the
 *   persona names every tool, top-tracks returns tracks with the URIs build-playlist takes, GET /notes returns the listener's
 *   remembered notes and the profile's tastes (and no other listener's), and POST /notes keeps a taste the listener states in
 *   their own words, once, refuses one they did not state, and refuses a call without a note or words. Red on 1.1.8: no
 *   top-tracks, read-music-taste or remember-music-taste tool and no /notes route.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fakePool, loadRoutes, authed, call, track } = require('./spotify-routes-harness.cjs');

const PKG = path.resolve(__dirname, '..');
const manifest = fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8');
const persona = fs.readFileSync(path.join(PKG, 'personas', 'spotify-concierge.yaml'), 'utf8');
const TOOLS = ['music-search', 'now-playing', 'list-playlists', 'build-playlist', 'spotify-accounts', 'top-tracks', 'read-music-taste', 'remember-music-taste'];

/** The method and path of each tool the manifest declares, by name. */
function declared() {
  const block = manifest.slice(manifest.indexOf('\ntools:\n'), manifest.indexOf('\n# UI SURFACES'));
  const tools = {};
  for (const [, name, endpoint] of block.matchAll(/\n {2}- name: ([a-z-]+)\n[\s\S]*?apiEndpoint: "([^"]+)"/g)) tools[name] = endpoint;
  return tools;
}

test('every tool the Music Concierge has is declared over a route this router answers, and its persona names it', () => {
  const tools = declared();
  assert.deepEqual(Object.keys(tools).sort(), [...TOOLS].sort());
  const { handlers } = loadRoutes();
  for (const [name, endpoint] of Object.entries(tools)) {
    const [method, target] = endpoint.split(' ');
    const route = target.split('?')[0].replace('/api/spotify', '');
    assert.ok(handlers[method.toLowerCase()].has(route), `${name}: ${method} ${route} is answered`);
    assert.match(persona, new RegExp(`\\b${name}\\b`), `the persona names ${name}`);
  }
});

test('top-tracks returns the listener\'s tracks with the URIs build-playlist takes', async () => {
  const { handlers } = loadRoutes({ top: [track('t1', 'Teardrop', 'Massive Attack'), track('t2', 'Glory Box', 'Portishead')] });
  const res = await call(handlers, 'get', '/top-tracks', authed('listener-a'));
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.items.map((item) => [item.title, item.uri]), [['Teardrop', 'spotify:track:t1'], ['Glory Box', 'spotify:track:t2']]);
});

test('GET /notes is what the concierge keeps about this listener: their notes and their profile\'s tastes, no one else\'s', async () => {
  const pool = fakePool({ profiles: { 'listener-a': { user_sub: 'listener-a', favorite_genres: ['Trip-hop'], favorite_artists: ['Portishead'], notes: 'no country' } } });
  const { handlers } = loadRoutes({ pool, notes: [{ sub: 'listener-a', note: 'loves 90s trip-hop' }, { sub: 'listener-b', note: 'only polka' }] });
  const res = await call(handlers, 'get', '/notes', authed('listener-a'));
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body, { notes: ['loves 90s trip-hop'], profile: { favoriteGenres: ['Trip-hop'], favoriteArtists: ['Portishead'], notes: 'no country' } });
  const other = await call(handlers, 'get', '/notes', authed('listener-c'));
  assert.deepEqual(other.body, { notes: [], profile: { favoriteGenres: [], favoriteArtists: [], notes: null } });
});

test('POST /notes keeps a taste the listener states in their own words, once, and nothing they did not state', async () => {
  const { handlers, notes } = loadRoutes();
  const kept = await call(handlers, 'post', '/notes', authed('listener-a', { body: { note: 'loves 90s trip-hop', said: 'I love 90s trip-hop, Portishead and the like' } }));
  assert.equal(kept.statusCode, 200, JSON.stringify(kept.body));
  assert.deepEqual(kept.body.remembered, ['loves 90s trip-hop']);
  const again = await call(handlers, 'post', '/notes', authed('listener-a', { body: { note: 'Loves 90s trip-hop', said: 'trip-hop again please' } }));
  assert.deepEqual(again.body.remembered, [], 'kept once');
  const unsaid = await call(handlers, 'post', '/notes', authed('listener-a', { body: { note: 'hates jazz', said: 'Something for a long drive' } }));
  assert.deepEqual(unsaid.body.remembered, [], 'a note the listener did not state is not kept');
  assert.deepEqual(notes(), [{ sub: 'listener-a', note: 'loves 90s trip-hop' }]);
  const empty = await call(handlers, 'post', '/notes', authed('listener-a', { body: { note: 'x' } }));
  assert.equal(empty.statusCode, 400);
  assert.equal(empty.body.error, 'note_and_said_required');
});
