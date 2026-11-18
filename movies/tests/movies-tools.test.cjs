/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.1.8 (lane CHATCORE3; Roger, 2026-11-16: every concierge is the core Jarvis chat
 *   window). In the window no route hands the Movie Concierge its candidates or saves its keys, so what the page's chat route did
 *   is the concierge's tools. Through the COMPILED routes (tests/movies-routes-harness.cjs): every tool the manifest declares
 *   names a method and path this router answers, the persona names every tool, GET /notes returns the viewer's remembered notes
 *   and the profile's tastes (and no other viewer's), and POST /notes keeps a taste the viewer states in their own words, once,
 *   refuses one they did not state, and refuses a call without a note or words. Red on 1.1.7: no tools and no /notes route.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fakePool, loadRoutes, authed, call } = require('./movies-routes-harness.cjs');

const PKG = path.resolve(__dirname, '..');
const manifest = fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8');
const persona = fs.readFileSync(path.join(PKG, 'personas', 'movies-concierge.yaml'), 'utf8');
const TOOLS = ['search-titles', 'trending-titles', 'title-details', 'movie-tickets', 'read-watchlist', 'add-to-watchlist', 'read-movie-taste', 'remember-movie-taste'];

/** The method and path of each tool the manifest declares, by name. */
function declared() {
  const block = manifest.slice(manifest.indexOf('\ntools:\n'), manifest.indexOf('\nroutes:\n'));
  const tools = {};
  for (const [, name, endpoint] of block.matchAll(/\n {2}- name: ([a-z-]+)\n[\s\S]*?apiEndpoint: "([^"]+)"/g)) tools[name] = endpoint;
  return tools;
}

test('every tool the Movie Concierge has is declared over a route this router answers, and its persona names it', () => {
  const tools = declared();
  assert.deepEqual(Object.keys(tools).sort(), [...TOOLS].sort());
  const { handlers } = loadRoutes();
  for (const [name, endpoint] of Object.entries(tools)) {
    const [method, target] = endpoint.split(' ');
    const route = target.split('?')[0].replace('/api/movies', '');
    assert.ok(handlers[method.toLowerCase()].has(route), `${name}: ${method} ${route} is answered`);
    assert.match(persona, new RegExp(`\\b${name}\\b`), `the persona names ${name}`);
  }
  assert.doesNotMatch(persona, /You have no tools here/, 'the persona no longer says it has none');
});

test('GET /notes is what the concierge keeps about this viewer: their notes and their profile\'s tastes, no one else\'s', async () => {
  const pool = fakePool({ profiles: { 'viewer-a': { user_sub: 'viewer-a', favorite_genres: ['Sci-Fi'], services: ['Netflix'], notes: 'no horror' } } });
  const { handlers } = loadRoutes({ pool, notes: [{ sub: 'viewer-a', note: 'loves slow-burn sci-fi' }, { sub: 'viewer-b', note: 'only cartoons' }] });
  const res = await call(handlers, 'get', '/notes', authed('viewer-a'));
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body, { notes: ['loves slow-burn sci-fi'], profile: { favoriteGenres: ['Sci-Fi'], services: ['Netflix'], notes: 'no horror' } });
  const other = await call(handlers, 'get', '/notes', authed('viewer-c'));
  assert.deepEqual(other.body, { notes: [], profile: { favoriteGenres: [], services: [], notes: null } });
});

test('POST /notes keeps a taste the viewer states in their own words, once, and nothing they did not state', async () => {
  const { handlers, notes } = loadRoutes();
  const kept = await call(handlers, 'post', '/notes', authed('viewer-a', { body: { note: 'loves slow-burn sci-fi', said: 'I love a slow-burn sci-fi movie' } }));
  assert.equal(kept.statusCode, 200, JSON.stringify(kept.body));
  assert.deepEqual(kept.body.remembered, ['loves slow-burn sci-fi']);
  const again = await call(handlers, 'post', '/notes', authed('viewer-a', { body: { note: 'Loves slow-burn sci-fi', said: 'slow-burn sci-fi again' } }));
  assert.deepEqual(again.body.remembered, [], 'kept once');
  const unsaid = await call(handlers, 'post', '/notes', authed('viewer-a', { body: { note: 'hates musicals', said: 'Something for tonight' } }));
  assert.deepEqual(unsaid.body.remembered, [], 'a note the viewer did not state is not kept');
  assert.deepEqual(notes(), [{ sub: 'viewer-a', note: 'loves slow-burn sci-fi' }]);
  const empty = await call(handlers, 'post', '/notes', authed('viewer-a', { body: { note: 'x' } }));
  assert.equal(empty.statusCode, 400);
  assert.equal(empty.body.error, 'note_and_said_required');
});
