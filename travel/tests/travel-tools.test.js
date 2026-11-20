/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.3.5 (lane CHATCORE3; Roger, 2026-11-16: every concierge is the core Jarvis chat
 *   window). In the window no route hands the Travel Concierge the traveller's profile and notes, or opens the watch its reply
 *   names, so what the page's chat route did is the concierge's tools. Through the COMPILED routes
 *   (tests/travel-routes-harness.js): every tool the manifest declares names a method and path this router answers and the
 *   persona names every tool; GET /notes returns the traveller's remembered notes and the profile's preferences (and no other
 *   traveller's); POST /notes keeps a preference the traveller states in their own words, once, refuses one they did not
 *   state, and refuses a call without a note or words; create-fare-watch keeps the return date, cabin and the fare the
 *   traveller saw, and list-fare-watches returns it. Red on 1.3.4: no read-travel-notes, remember-travel-note or
 *   list-fare-watches tool and no /notes route.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.3.6: assert travel-concierge declares explicit posture: inline alongside chatBot and ```tool_call "tool" contract.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fakePool, loadRoutes, authed, call } = require('./travel-routes-harness.js');

const PKG = path.resolve(__dirname, '..');
const manifest = fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8');
const persona = fs.readFileSync(path.join(PKG, 'personas', 'travel-concierge.yaml'), 'utf8');
const TOOLS = ['search-flights', 'search-hotels', 'search-cars', 'read-price-intelligence', 'create-fare-watch', 'list-fare-watches',
  'read-travel-notes', 'remember-travel-note', 'explain-travel-pick', 'prepare-booking'];

/** The method and path of each tool the manifest declares, by name. */
function declared() {
  const block = manifest.slice(manifest.indexOf('\ntools:\n'), manifest.indexOf('\nui:\n'));
  const tools = {};
  for (const [, name, endpoint] of block.matchAll(/\n {2}- name: ([a-z-]+)\n[\s\S]*?apiEndpoint: "([^"]+)"/g)) tools[name] = endpoint;
  return tools;
}

test('every tool the Travel Concierge has is declared over a route this router answers, and its persona names it', () => {
  const tools = declared();
  assert.deepEqual(Object.keys(tools).sort(), [...TOOLS].sort());
  const { handlers } = loadRoutes();
  for (const [name, endpoint] of Object.entries(tools)) {
    const [method, target] = endpoint.split(' ');
    const route = target.split('?')[0].replace('/api/travel', '');
    assert.ok(handlers[method.toLowerCase()].has(route), `${name}: ${method} ${route} is answered`);
    assert.match(persona, new RegExp(`\\b${name}\\b`), `the persona names ${name}`);
  }
});

test('GET /notes is what the concierge keeps about this traveller: their notes and their profile\'s preferences, no one else\'s', async () => {
  const pool = fakePool({ profiles: { 'traveller-a': { user_sub: 'traveller-a', home_airport: 'VPS', preferred_cabin: 'business', preferred_airlines: ['Delta'], hotel_brands: ['Hilton'], avoid: ['red-eyes'], notes: 'aisle seat' } },
    notes: [{ user_sub: 'traveller-a', note: 'flies out of VPS' }, { user_sub: 'traveller-b', note: 'only trains' }] });
  const { handlers } = loadRoutes({ pool });
  const res = await call(handlers, 'get', '/notes', authed('traveller-a'));
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body, { notes: ['flies out of VPS'], profile: { homeAirport: 'VPS', preferredCabin: 'business', preferredAirlines: ['Delta'], hotelBrands: ['Hilton'], avoid: ['red-eyes'], notes: 'aisle seat' } });
  const other = await call(handlers, 'get', '/notes', authed('traveller-c'));
  assert.deepEqual(other.body, { notes: [], profile: { homeAirport: null, preferredCabin: 'economy', preferredAirlines: [], hotelBrands: [], avoid: [], notes: null } });
});

test('POST /notes keeps a preference the traveller states in their own words, once, and nothing they did not state', async () => {
  const { handlers, pool } = loadRoutes();
  const kept = await call(handlers, 'post', '/notes', authed('traveller-a', { body: { note: 'avoids red-eye flights', said: 'No red-eye flights for me, please' } }));
  assert.equal(kept.statusCode, 200, JSON.stringify(kept.body));
  assert.deepEqual(kept.body.remembered, ['avoids red-eye flights']);
  const again = await call(handlers, 'post', '/notes', authed('traveller-a', { body: { note: 'Avoids red-eye flights', said: 'again, no red-eye flights' } }));
  assert.deepEqual(again.body.remembered, [], 'kept once');
  const unsaid = await call(handlers, 'post', '/notes', authed('traveller-a', { body: { note: 'loves first class', said: 'VPS to DCA next month' } }));
  assert.deepEqual(unsaid.body.remembered, [], 'a note the traveller did not state is not kept');
  assert.deepEqual(pool.tables.notes, [{ user_sub: 'traveller-a', note: 'avoids red-eye flights' }]);
  const empty = await call(handlers, 'post', '/notes', authed('traveller-a', { body: { note: 'x' } }));
  assert.equal(empty.statusCode, 400);
  assert.equal(empty.body.error, 'note_and_said_required');
});

test('create-fare-watch keeps the return date, cabin and the fare the traveller saw, and list-fare-watches returns it', async () => {
  const { handlers } = loadRoutes();
  const input = { kind: 'flight', origin: 'vps', destination: 'dca', departDate: '2026-12-16', returnDate: '2026-12-20', cabin: 'business', lastPrice: 212 };
  const made = await call(handlers, 'post', '/watches', authed('traveller-a', { body: input }));
  assert.equal(made.statusCode, 200, JSON.stringify(made.body));
  assert.deepEqual([made.body.watch.query, made.body.watch.last_price], [{ origin: 'VPS', destination: 'DCA', departDate: '2026-12-16', returnDate: '2026-12-20', pax: 1, cabin: 'business' }, 212]);
  const listed = await call(handlers, 'get', '/watches', authed('traveller-a'));
  assert.deepEqual(listed.body.items.map((w) => w.watch_id), [made.body.watch.watch_id]);
  const schema = manifest.slice(manifest.indexOf('  - name: create-fare-watch'), manifest.indexOf('  - name: list-fare-watches'));
  for (const field of ['returnDate', 'cabin', 'lastPrice']) assert.match(schema, new RegExp(`\\n {8}${field}: \\{ type: `), `create-fare-watch takes ${field}`);
});

test('travel-concierge declares explicit inline posture, chatBot binding, and ```tool_call "tool" contract', () => {
  assert.match(manifest, /\nchatBot:\s*travel-concierge\b/);
  const botBlock = manifest.slice(manifest.indexOf('\nbots:\n'), manifest.indexOf('\ntools:\n'));
  assert.match(botBlock, /\n {4}name:\s*travel-concierge\b/);
  assert.match(botBlock, /\n {4}posture:\s*inline\b/);
  assert.ok(persona.includes('```tool_call'), 'persona teaches ```tool_call fence');
  assert.match(persona, /"tool"/, 'persona teaches the "tool" JSON key');
});
