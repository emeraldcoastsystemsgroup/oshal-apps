/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.5.7 (lane CHATCORE3; the coordinator, 2026-11-17: a search through the one chat window returned a peanut restaurant to a person with a saved peanut allergy). The allergy guard ran only in the page's own chat route (POST /chat); every other caller of the restaurant search (the search-restaurants tool, which the Eats concierge and Jarvis's hand-off to Eats call, and the page's own Find) and of the Uber Eats hand-off (open-uber-eats) went without it. Through the COMPILED routes with a recording Places double: a saved allergy (a remembered note or the profile's dietary list) holds a conflicting restaurant back from POST and GET /search and says so (allergy.restrictions, allergy.heldBack); an allergy the caller names for this search (avoid) does the same; POST /order refuses a held restaurant (409, nothing recorded); POST /notes keeps an allergy the person states, and the next search holds by it; the notes of another diner never reach this one; and the manifest binds search-restaurants, open-uber-eats (still an approval) and remember-eats-note to these routes, with avoid declared. Red on 1.5.6: /search answered Peanut Palace and /order handed it off.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fakePlaces, fakePool, loadRoutes, authed, call } = require('./eats-routes-harness');
const ADDRESS = '1 Synthetic Way, Pensacola';
/** Four Thai places near the address, two of them named for peanut dishes (as in eats-allergens.test.js). */
const place = (id, name) => ({ id, displayName: { text: name }, formattedAddress: '1 Synthetic St', location: { latitude: 30.43, longitude: -87.21 },
  types: ['thai_restaurant', 'restaurant'], primaryTypeDisplayName: { text: 'Thai Restaurant' }, rating: 4.5, userRatingCount: 120, priceLevel: 'PRICE_LEVEL_MODERATE' });
const THAI = [place('ChIJ-padthai', 'Pad Thai Kitchen'), place('ChIJ-peanut', 'Peanut Palace'), place('ChIJ-thai-garden', 'Thai Garden'), place('ChIJ-curry', 'Green Curry House')];
const thaiPlaces = () => fakePlaces({ search: () => ({ places: THAI }) });
const names = (res) => (res.body.items || []).map((r) => r.name);

for (const method of ['post', 'get']) {
  test(`${method.toUpperCase()} /search: a remembered peanut allergy holds peanut restaurants back, and says so`, async () => {
    const { handlers } = loadRoutes({ places: thaiPlaces(), notes: ['peanut allergy'] });
    const req = method === 'post' ? { body: { query: 'thai', address: ADDRESS } } : { query: { q: 'thai', address: ADDRESS } };
    const res = await call(handlers, method, '/search', authed('diner-a', req));
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.deepEqual(names(res), ['Thai Garden', 'Green Curry House'], 'every caller of the search gets only the places without peanuts in their name');
    assert.deepEqual(res.body.allergy.restrictions, ['peanuts']);
    assert.deepEqual(res.body.allergy.heldBack.map((h) => h.dish), ['Pad Thai Kitchen', 'Peanut Palace']);
  });
}

test('the profile\'s saved diet holds back the same way, with no note', async () => {
  const pool = fakePool({ profiles: { 'diner-b': { user_sub: 'diner-b', dietary: ['peanut allergy'], favorite_cuisines: [], default_address: ADDRESS } } });
  const { handlers } = loadRoutes({ places: thaiPlaces(), pool });
  const res = await call(handlers, 'post', '/search', authed('diner-b', { body: { query: 'thai' } }));
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(names(res), ['Thai Garden', 'Green Curry House']);
});

test('an allergy the caller names for this search (avoid) holds back the same way', async () => {
  const { handlers } = loadRoutes({ places: thaiPlaces() });
  const plain = await call(handlers, 'post', '/search', authed('diner-c', { body: { query: 'thai', address: ADDRESS } }));
  assert.equal(names(plain).length, 4, 'with nothing saved and nothing named, every place is offered');
  assert.deepEqual(plain.body.allergy.heldBack, []);
  const named = await call(handlers, 'post', '/search', authed('diner-c', { body: { query: 'thai', address: ADDRESS, avoid: 'I am allergic to peanuts' } }));
  assert.deepEqual(names(named), ['Thai Garden', 'Green Curry House']);
});

test('POST /order refuses a restaurant the diner\'s allergy holds back, and records nothing', async () => {
  const { handlers, pool } = loadRoutes({ places: thaiPlaces(), notes: ['peanut allergy'] });
  await call(handlers, 'post', '/search', authed('diner-a', { body: { query: 'thai', address: ADDRESS } }));
  const refused = await call(handlers, 'post', '/order', authed('diner-a', { body: { placeId: 'ChIJ-peanut', address: ADDRESS } }));
  assert.equal(refused.statusCode, 409, JSON.stringify(refused.body));
  assert.equal(refused.body.error, 'allergy_conflict');
  assert.match(refused.body.message, /Peanut Palace[\s\S]*peanuts/);
  assert.equal(refused.body.checkoutUrl, undefined, 'no hand-off link');
  assert.equal(pool.tables.orders.length, 0, 'nothing recorded');
  const allowed = await call(handlers, 'post', '/order', authed('diner-a', { body: { placeId: 'ChIJ-thai-garden', address: ADDRESS } }));
  assert.equal(allowed.statusCode, 200, JSON.stringify(allowed.body));
  assert.equal(allowed.body.store, 'Thai Garden');
});

test('POST /notes keeps an allergy the person states, and the next search holds by it', async () => {
  const { handlers, store } = loadRoutes({ places: thaiPlaces() });
  const kept = await call(handlers, 'post', '/notes', authed('diner-d', { body: { note: 'Allergic to peanuts', said: 'I am allergic to peanuts, find me Thai food' } }));
  assert.equal(kept.statusCode, 200, JSON.stringify(kept.body));
  assert.deepEqual(kept.body.remembered, ['Allergic to peanuts']);
  assert.deepEqual(store().notes, ['Allergic to peanuts']);
  const after = await call(handlers, 'post', '/search', authed('diner-d', { body: { query: 'thai', address: ADDRESS } }));
  assert.deepEqual(names(after), ['Thai Garden', 'Green Curry House']);
  const other = await call(handlers, 'post', '/search', authed('diner-e', { body: { query: 'thai', address: ADDRESS } }));
  assert.equal(names(other).length, 4, 'one diner\'s saved allergy never holds another diner\'s search');
  const unsaid = await call(handlers, 'post', '/notes', authed('diner-d', { body: { note: 'Loves shellfish', said: 'Find me Thai food' } }));
  assert.deepEqual(unsaid.body.remembered, [], 'a note the person did not state is not kept');
  const empty = await call(handlers, 'post', '/notes', authed('diner-d', { body: {} }));
  assert.equal(empty.statusCode, 400);
});

test('the tools every caller uses (the Eats concierge, Jarvis\'s hand-off to Eats, the one chat window) are these guarded routes', () => {
  const manifest = fs.readFileSync(path.join(__dirname, '..', 'oshal-app.yaml'), 'utf8');
  const tools = manifest.slice(manifest.indexOf('\ntools:\n'), manifest.indexOf('\n# UI SURFACES'));
  const tool = (name) => {
    const at = tools.indexOf(`\n  - name: ${name}\n`);
    assert.ok(at >= 0, `the manifest declares ${name}`);
    const next = tools.indexOf('\n  - name: ', at + 1);
    return tools.slice(at, next < 0 ? undefined : next);
  };
  assert.match(tool('search-restaurants'), /apiEndpoint: "POST \/api\/eats\/search"/);
  assert.match(tool('search-restaurants'), /\n {8}avoid: \{ type: string/);
  assert.match(tool('open-uber-eats'), /apiEndpoint: "POST \/api\/eats\/order"/);
  assert.match(tool('open-uber-eats'), /defaultAuthMode: ask/);
  assert.match(tool('open-uber-eats'), /\n {8}avoid: \{ type: string/);
  assert.match(tool('remember-eats-note'), /apiEndpoint: "POST \/api\/eats\/notes"/);
  assert.match(tool('remember-eats-note'), /required: \[note, said\]/);
});
