/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial: the compiled Eats routes over an in-memory pool and a recording Uber Eats provider (menu pricing, store switching, totals, ownership, the chat order proposal, the confirmed hand-off, the native read-only admission).
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | 1.5.0: the cache cases. A POST search saves the address, the search and the cards; a second POST within a day asks Google nothing and says served saved; a new process (memory cleared) still serves the saved address and search; Refresh asks Google even when fresh; at Google's quota a saved search older than a day is served with the saved time and the reason; past thirty days nothing is served and the quota refusal stands; GET /search reads the saved rows and never writes; a hand-off to a saved restaurant needs no lookup.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | 1.4.2: coordinates (lat/lng or the "lat, lng" address text) resolve through the Geocoding reverse lookup on maps.googleapis.com, never a Places text search; a Geocoding refusal is 503 geocoding_unavailable with the typed-address advice.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | 1.4.0: the menu, the cart and the curated catalog are gone. The suite now proves the real-restaurant shape through the compiled routes: a search needs an address and is refused in words before any Places call; with one it resolves the address once (Google Places), lists the restaurants Google returned with each one's Uber Eats link at that address (the location token carries the address's Google place id), and repeats reuse the geocode and the search; the profile's saved address is the default; a Places refusal (API not enabled, key not configured) is a 503 with the sentence, never an empty list; an unknown address is 404; POST /order records the hand-off row and answers the Uber Eats search link for the chosen restaurant; the chat turn offers the real restaurants by id and an "order" choice becomes a proposal that writes nothing; one diner never sees another's hand-offs; an anonymous caller is 401 before any query or Places call; every GET answers under the native read-only admission without a SQL write; the photo route resolves a Google photo name to its image URL, key-free.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { decodePlaceToken } = require('../routes/uber-link.js');
const { PLACE, SERVICE_DISABLED, NOT_CONNECTED, fakePlaces, fakePool, loadRoutes, authed, anon, call, admittedPool, callAdmitted } = require('./eats-routes-harness');

const ADDRESS = '1 Synthetic Way, Pensacola';
const search = (handlers, sub, query) => call(handlers, 'get', '/search', authed(sub, { query }));
/** The page's and Jarvis's search: a POST, which may save what Google answers. */
const post = (handlers, sub, body) => call(handlers, 'post', '/search', authed(sub, { body }));
const DAY = 24 * 60 * 60 * 1000;

test('a search without any address is refused in words before any Places call', async () => {
  const { handlers, places } = loadRoutes();
  const res = await search(handlers, 'diner-a', { q: 'tacos' });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'address_required');
  assert.match(res.body.message, /^Set your delivery address first/);
  assert.equal(places.requests.length, 0);
});

test('with an address the search resolves it once and lists the real restaurants with their Uber Eats links there', async () => {
  const { handlers, places } = loadRoutes();
  const res = await search(handlers, 'diner-a', { q: 'tacos', address: ADDRESS, limit: '5' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.source, 'Google Places');
  assert.deepEqual(res.body.place, { address: PLACE.formattedAddress, placeId: PLACE.id, latitude: 30.4213, longitude: -87.2169 });
  assert.equal(places.requests.length, 2, 'one geocode, one search');
  assert.equal(places.requests[0].body.textQuery, ADDRESS);
  assert.equal(places.requests[0].body.pageSize, 1);
  assert.deepEqual(places.requests[1].body.locationBias.circle.center, { latitude: 30.4213, longitude: -87.2169 });
  assert.equal(places.requests[1].body.textQuery, 'tacos');
  assert.equal(places.requests[1].body.pageSize, 5);
  for (const r of places.requests) assert.doesNotMatch(r.url, /[?&]key=/, 'the package never carries the key');
  const taco = res.body.items[0];
  assert.equal(taco.name, 'Taco Mahal');
  assert.deepEqual([taco.rating, taco.priceLabel, taco.openNow, taco.delivery, taco.cuisine], [4.6, '$', true, true, 'Mexican restaurant']);
  const link = new URL(taco.uberUrl);
  assert.equal(link.origin + link.pathname, 'https://www.ubereats.com/search');
  assert.equal(link.searchParams.get('q'), 'Taco Mahal');
  assert.deepEqual(decodePlaceToken(link.searchParams.get('pl')), { address: PLACE.formattedAddress, reference: PLACE.id, referenceType: 'google_places', latitude: 30.4213, longitude: -87.2169 });
  assert.match(res.body.feedUrl, /^https:\/\/www\.ubereats\.com\/feed\?diningMode=DELIVERY&pl=/);
});

test('a second search at the same address reuses the geocode, and the same craving reuses the search', async () => {
  const { handlers, places } = loadRoutes();
  await search(handlers, 'diner-a', { q: 'tacos', address: ADDRESS });
  await search(handlers, 'diner-a', { q: 'sushi', address: ` ${ADDRESS.toUpperCase()} ` });
  assert.equal(places.requests.length, 3, 'the second craving searched again but did not geocode again');
  await search(handlers, 'diner-a', { q: 'tacos', address: ADDRESS });
  assert.equal(places.requests.length, 3, 'the repeated craving came from the cache');
});

test('the profile\'s saved address is the default, and browser coordinates are resolved as a place', async () => {
  const pool = fakePool({ profiles: { 'diner-a': { user_sub: 'diner-a', default_address: ADDRESS, dietary: [], favorite_cuisines: [], onboarded: true } } });
  const { handlers, places } = loadRoutes({ pool });
  const res = await search(handlers, 'diner-a', { q: 'pizza' });
  assert.equal(res.statusCode, 200);
  assert.equal(places.requests[0].body.textQuery, ADDRESS);
  const byCoords = await search(handlers, 'diner-a', { q: 'pizza', lat: '30.42130', lng: '-87.21690' });
  assert.equal(byCoords.statusCode, 200);
  assert.equal(places.requests[2].method, 'GET');
  assert.equal(places.requests[2].url, 'https://maps.googleapis.com/maps/api/geocode/json?latlng=30.4213%2C-87.2169&result_type=street_address%7Cpremise%7Csubpremise%7Croute', 'coordinates go to the Geocoding reverse lookup, never to a Places text search (which refuses them)');
  assert.deepEqual(byCoords.body.place, { address: PLACE.formattedAddress, placeId: PLACE.id, latitude: 30.4213, longitude: -87.2169 }, 'the resolved street address carries the place id the Uber Eats token needs');
  const asText = await search(handlers, 'diner-b', { q: 'pizza', address: '30.44767, -86.58025' });
  assert.equal(asText.statusCode, 200);
  assert.match(places.requests.at(-2).url, /geocode\/json\?latlng=30\.44767%2C-86\.58025/, 'the "lat, lng" text Use location writes into the address box is coordinates too (then diner-b\'s own search ran)');
});

test('coordinates with the Geocoding API not allowed on the key answer 503 in words, with the typed-address advice', async () => {
  const { handlers } = loadRoutes({ places: fakePlaces({ reverse: () => ({ status: 'REQUEST_DENIED', error_message: 'This API project is not authorized to use this API.', results: [] }) }) });
  const res = await search(handlers, 'diner-a', { q: 'pizza', lat: '30.4', lng: '-87.2' });
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, 'geocoding_unavailable');
  assert.match(res.body.message, /^Location lookup needs the Geocoding API enabled on this installation's Google key .* Type your street address with the city instead\. \(Google said: This API project is not authorized to use this API\.\)$/);
});

test('Places API not enabled on the key answers 503 with the enabling instruction, never an empty list', async () => {
  const { handlers } = loadRoutes({ places: fakePlaces({ status: 403, body: SERVICE_DISABLED }) });
  const res = await search(handlers, 'diner-a', { q: 'tacos', address: ADDRESS });
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, 'disabled');
  assert.match(res.body.message, /Places API \(New\) is not enabled .*project 1085759851735.*Enable it at https:\/\/console\.developers\.google\.com/);
  assert.equal(res.body.items, undefined);
});

test('a kernel without the key answers 503 naming OSHAL_CONNECTOR_SECRET_GOOGLE_PLACES', async () => {
  const { handlers } = loadRoutes({ places: fakePlaces({ throws: new Error(NOT_CONNECTED) }) });
  const res = await search(handlers, 'diner-a', { q: 'tacos', address: ADDRESS });
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, 'not_configured');
  assert.match(res.body.message, /set OSHAL_CONNECTOR_SECRET_GOOGLE_PLACES/);
});

test('an address Google cannot place is 404 address_not_found', async () => {
  const { handlers } = loadRoutes({ places: fakePlaces({ geocode: () => ({ places: [] }) }) });
  const res = await search(handlers, 'diner-a', { q: 'tacos', address: 'nowhere' });
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, 'address_not_found');
});

test('POST /order records the hand-off and answers the Uber Eats search link for that restaurant at the address', async () => {
  const { handlers, pool, places } = loadRoutes();
  await search(handlers, 'diner-a', { q: 'tacos', address: ADDRESS });
  const res = await call(handlers, 'post', '/order', authed('diner-a', { body: { placeId: 'ChIJ-taco-mahal', address: ADDRESS } }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.store, 'Taco Mahal');
  assert.equal(res.body.address, PLACE.formattedAddress);
  assert.match(res.body.note, /nothing is ordered or charged here/);
  const link = new URL(res.body.checkoutUrl);
  assert.equal(link.searchParams.get('q'), 'Taco Mahal');
  assert.equal(decodePlaceToken(link.searchParams.get('pl')).reference, PLACE.id);
  assert.deepEqual(pool.tables.orders.map((o) => [o.user_sub, o.store_id, o.store_name, o.handoff_url]), [['diner-a', 'ChIJ-taco-mahal', 'Taco Mahal', res.body.checkoutUrl]]);
  assert.equal(places.requests.length, 2, 'a restaurant the search just showed needs no lookup');
  const history = await call(handlers, 'get', '/orders/history', authed('diner-a'));
  assert.deepEqual(history.body.orders.map((o) => o.store_name), ['Taco Mahal']);
});

test('a hand-off to a restaurant not shown in this process looks it up by id first; a malformed id is refused', async () => {
  const { handlers, places } = loadRoutes();
  const res = await call(handlers, 'post', '/order', authed('diner-a', { body: { placeId: 'ChIJ-sushi-house', address: ADDRESS } }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.store, 'Sushi House');
  assert.ok(places.requests.some((r) => r.url.includes('/v1/places/ChIJ-sushi-house?')), 'the details lookup ran');
  const bad = await call(handlers, 'post', '/order', authed('diner-a', { body: { placeId: '../x', address: ADDRESS } }));
  assert.equal(bad.statusCode, 400);
  const noAddress = await call(handlers, 'post', '/order', authed('diner-b', { body: { placeId: 'ChIJ-sushi-house' } }));
  assert.equal(noAddress.statusCode, 400);
  assert.equal(noAddress.body.error, 'address_required');
});

test('a chat turn offers the real restaurants by id, and an "order" choice becomes a proposal that writes nothing', async () => {
  const reply = { say: 'Taco Mahal is open now, cheap and a kilometre away. Want it?', show: ['ChIJ-taco-mahal', 'ChIJ-sushi-house'], remember: [], order: 'ChIJ-taco-mahal' };
  const { handlers, pool, prompts, places } = loadRoutes({ reply });
  const res = await call(handlers, 'post', '/chat', authed('diner-a', { body: { message: 'tacos tonight', location: ADDRESS } }));
  assert.equal(res.statusCode, 200);
  assert.match(prompts[0], /CANDIDATES \(real, from Google Places near 1 Synthetic Way, Pensacola, FL 32502, USA; the ONLY restaurants you may show or open\):/);
  assert.match(prompts[0], /- id:ChIJ-taco-mahal \| Taco Mahal \| Mexican restaurant \| rating 4\.6 \(57 reviews\) \| \$ \| open now \| [\d.]+ km away \| delivers/);
  assert.match(prompts[0], /"order": "candidate id, or null"/);
  assert.equal(places.requests[1].body.textQuery, 'tacos tonight', 'the message is the craving searched');
  assert.deepEqual(res.body.cards.map((c) => c.placeId), ['ChIJ-taco-mahal', 'ChIJ-sushi-house']);
  assert.match(res.body.cards[0].uberUrl, /^https:\/\/www\.ubereats\.com\/search\?q=Taco\+Mahal&pl=/);
  assert.deepEqual(res.body.proposal, { actionId: 'open_uber_eats', placeId: 'ChIJ-taco-mahal', store: 'Taco Mahal', summary: `Open Uber Eats at ${PLACE.formattedAddress} with Taco Mahal searched? You pick the dishes, confirm the address and pay in Uber Eats; nothing is ordered or charged here.` });
  assert.equal(res.body.checkout, null);
  assert.deepEqual(pool.tables.orders, [], 'a proposal records nothing; only POST /order does');
  assert.equal(res.body.reply, reply.say);
});

test('an "order" naming a restaurant that was not a candidate proposes nothing', async () => {
  const { handlers } = loadRoutes({ reply: { say: 'ok', show: [], remember: [], order: 'ChIJ-not-shown' } });
  const res = await call(handlers, 'post', '/chat', authed('diner-a', { body: { message: 'pizza', location: ADDRESS } }));
  assert.equal(res.body.proposal, null);
});

test('one diner never sees another diner\'s hand-offs', async () => {
  const { handlers } = loadRoutes();
  await call(handlers, 'post', '/order', authed('diner-a', { body: { placeId: 'ChIJ-taco-mahal', address: ADDRESS } }));
  const other = await call(handlers, 'get', '/orders/history', authed('diner-b'));
  assert.deepEqual(other.body.orders, []);
});

test('an anonymous caller is 401 before any query or Places call', async () => {
  const { handlers, pool, places } = loadRoutes();
  for (const [method, route] of [['get', '/search'], ['get', '/photo'], ['post', '/order'], ['post', '/chat'], ['get', '/orders/history'], ['get', '/profile']]) {
    const res = await call(handlers, method, route, anon({ query: { q: 'x', address: ADDRESS }, body: { message: 'x', placeId: 'ChIJ-taco-mahal' } }));
    assert.equal(res.statusCode, 401, `${method} ${route}`);
  }
  assert.equal(pool.sql.length, 0);
  assert.equal(places.requests.length, 0);
});

test('every GET answers under the native read-only admission without attempting a SQL write', async () => {
  const pool = admittedPool(fakePool());
  const { handlers } = loadRoutes({ pool });
  const gets = [['/config', {}], ['/search', { q: 'tacos', address: ADDRESS }], ['/photo', { name: 'places/ChIJ-taco-mahal/photos/photo-1' }], ['/orders/history', {}], ['/profile', {}], ['/conversation', {}]];
  for (const [route, query] of gets) {
    const res = await callAdmitted(handlers, 'get', route, authed('diner-a', { query }), pool);
    assert.ok(res.statusCode < 400, `${route} answered ${res.statusCode}: ${JSON.stringify(res.body).slice(0, 120)}`);
  }
  assert.deepEqual(pool.refused, []);
});

test('the photo route resolves a Google photo name to its image URL without the key, and refuses any other name', async () => {
  const { handlers, places } = loadRoutes();
  const res = await call(handlers, 'get', '/photo', authed('diner-a', { query: { name: 'places/ChIJ-taco-mahal/photos/photo-1' } }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.photoUri, 'https://lh3.googleusercontent.com/synthetic/photo-1');
  assert.match(places.requests[0].url, /\/v1\/places\/ChIJ-taco-mahal\/photos\/photo-1\/media\?maxWidthPx=640&skipHttpRedirect=true/);
  assert.doesNotMatch(places.requests[0].url, /key=/);
  const again = await call(handlers, 'get', '/photo', authed('diner-a', { query: { name: 'places/ChIJ-taco-mahal/photos/photo-1' } }));
  assert.equal(again.body.photoUri, res.body.photoUri);
  assert.equal(places.requests.length, 1, 'the second read is the cache');
  const bad = await call(handlers, 'get', '/photo', authed('diner-a', { query: { name: 'https://evil.example/x' } }));
  assert.equal(bad.statusCode, 400);
});

test('/config names the rail: Google Places for the restaurants, Uber Eats for the hand-off', async () => {
  const { handlers } = loadRoutes();
  const res = await call(handlers, 'get', '/config', authed('diner-a'));
  assert.deepEqual([res.body.rail, res.body.source, res.body.connector, res.body.handoff, res.body.uberConnected], ['places', 'Google Places', 'google-places', 'uber-eats', false]);
  assert.match(res.body.railNote, /Google Places .* Uber Eats/);
});


test('a POST search saves the address, the search and the cards, and a second POST within a day asks Google nothing', async () => {
  const { handlers, pool, places } = loadRoutes();
  const first = await post(handlers, 'diner-a', { query: 'tacos', address: ADDRESS, limit: 5 });
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.served, 'live');
  assert.equal(first.body.savedNote, '');
  assert.equal(places.requests.length, 2, 'one geocode, one search');
  assert.deepEqual(Object.keys(pool.tables.lookups), ['diner-a|text:1 synthetic way, pensacola']);
  assert.deepEqual(Object.keys(pool.tables.searches), ['diner-a|tacos|ChIJ-synthetic-address|5|0']);
  assert.deepEqual(Object.keys(pool.tables.places).sort(), ['diner-a|ChIJ-sushi-house', 'diner-a|ChIJ-taco-mahal', 'diner-a|ChIJ-thai-garden']);
  assert.ok(pool.tables.searches['diner-a|tacos|ChIJ-synthetic-address|5|0'].expires_ms - pool.tables.searches['diner-a|tacos|ChIJ-synthetic-address|5|0'].fetched_ms === 30 * DAY, 'thirty days, Google\'s limit');
  const { handlers: again, places: placesAgain } = loadRoutes({ pool });
  const second = await post(again, 'diner-a', { query: 'Tacos ', address: ' 1 SYNTHETIC WAY, Pensacola', limit: 5 });
  assert.equal(second.statusCode, 200);
  assert.equal(placesAgain.requests.length, 0, 'a new process with the saved rows asks Google nothing');
  assert.equal(second.body.served, 'saved');
  assert.deepEqual(second.body.items.map((r) => r.name), ['Taco Mahal', 'Sushi House', 'Thai Garden']);
  assert.match(second.body.savedNote, /^Saved results: Google was not asked again/);
  assert.equal(second.body.fallback, null);
  assert.equal(second.body.place.placeId, 'ChIJ-synthetic-address');
});

test('Refresh asks Google again even when the saved search is fresh, and replaces it', async () => {
  const { handlers, pool, places } = loadRoutes();
  await post(handlers, 'diner-a', { query: 'tacos', address: ADDRESS, limit: 5 });
  const refreshed = await post(handlers, 'diner-a', { query: 'tacos', address: ADDRESS, limit: 5, refresh: true });
  assert.equal(refreshed.body.served, 'live');
  assert.equal(places.requests.length, 3, 'the address stays resolved from memory; the search ran again');
  assert.equal(Object.keys(pool.tables.searches).length, 1, 'the row was replaced, not duplicated');
});

test('at Google\'s quota a saved search older than a day is served with its saved time and the reason', async () => {
  const fetched = Date.now() - 3 * DAY;
  const saved = { search_key: 'diner-a|tacos|ChIJ-synthetic-address|5|0', user_sub: 'diner-a', query: 'tacos', place_id: 'ChIJ-synthetic-address', restaurants: JSON.stringify([{ placeId: 'ChIJ-taco-mahal', name: 'Taco Mahal', rating: 4.6 }]), fetched_ms: fetched, expires_ms: fetched + 30 * DAY };
  const lookup = { lookup_key: 'diner-a|text:1 synthetic way, pensacola', user_sub: 'diner-a', address: PLACE.formattedAddress, place_id: PLACE.id, latitude: 30.4213, longitude: -87.2169, source: 'places', fetched_ms: fetched, expires_ms: fetched + 30 * DAY };
  const pool = fakePool({ searches: { [saved.search_key]: saved }, lookups: { [lookup.lookup_key]: lookup } });
  const { handlers, places } = loadRoutes({ pool, places: fakePlaces({ status: 429, body: { error: { code: 429, message: 'Quota exceeded for quota metric', status: 'RESOURCE_EXHAUSTED' } } }) });
  const res = await post(handlers, 'diner-a', { query: 'tacos', address: ADDRESS, limit: 5 });
  assert.equal(res.statusCode, 200);
  assert.equal(places.requests.length, 1, 'Google was asked once (the search) and refused; the address came from the saved lookup');
  assert.equal(res.body.served, 'saved');
  assert.equal(res.body.savedAt, new Date(fetched).toISOString());
  assert.deepEqual(res.body.items.map((r) => r.name), ['Taco Mahal']);
  assert.match(res.body.items[0].uberUrl, /^https:\/\/www\.ubereats\.com\/search\?q=Taco\+Mahal&pl=/, 'the saved card still gets its Uber Eats link at the address');
  assert.equal(res.body.fallback.error, 'quota');
  assert.match(res.body.savedNote, /^Google could not be asked/);
});

test('past Google\'s thirty days nothing saved is served, and the refusal stands', async () => {
  const fetched = Date.now() - 31 * DAY;
  const saved = { search_key: 'diner-a|tacos|ChIJ-synthetic-address|5|0', user_sub: 'diner-a', query: 'tacos', place_id: 'ChIJ-synthetic-address', restaurants: '[]', fetched_ms: fetched, expires_ms: fetched + 30 * DAY };
  const pool = fakePool({ searches: { [saved.search_key]: saved } });
  const { handlers } = loadRoutes({ pool, places: fakePlaces({ respond: (_url, _init, body) => (body && body.includedType === 'restaurant' ? { ok: false, status: 429, json: async () => ({ error: { status: 'RESOURCE_EXHAUSTED', message: 'quota' } }) } : null) }) });
  const res = await post(handlers, 'diner-a', { query: 'tacos', address: ADDRESS, limit: 5 });
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, 'quota');
});

test('GET /search reads the saved rows and never writes, under the native read-only admission', async () => {
  const pool = admittedPool(fakePool());
  const { handlers, places } = loadRoutes({ pool });
  const viaGet = await callAdmitted(handlers, 'get', '/search', authed('diner-a', { query: { q: 'tacos', address: ADDRESS, limit: '5' } }), pool);
  assert.equal(viaGet.statusCode, 200);
  assert.equal(viaGet.body.served, 'live');
  assert.deepEqual(pool.refused, [], 'no write was even attempted on the GET');
  assert.deepEqual([Object.keys(pool.tables.lookups), Object.keys(pool.tables.searches)], [[], []], 'nothing saved from a GET');
  await callAdmitted(handlers, 'post', '/search', authed('diner-a', { body: { query: 'sushi', address: ADDRESS, limit: 5 } }), pool);
  assert.equal(Object.keys(pool.tables.searches).length, 1, 'the POST saved');
  const { handlers: fresh, places: placesFresh } = loadRoutes({ pool });
  const read = await callAdmitted(fresh, 'get', '/search', authed('diner-a', { query: { q: 'sushi', address: ADDRESS, limit: '5' } }), pool);
  assert.equal(read.body.served, 'saved');
  assert.equal(placesFresh.requests.length, 0, 'the GET served the saved rows without Google');
  assert.deepEqual(pool.refused, []);
  void places;
});

test('a hand-off to a saved restaurant needs no Google lookup in a new process', async () => {
  const { handlers, pool } = loadRoutes();
  await post(handlers, 'diner-a', { query: 'sushi', address: ADDRESS, limit: 5 });
  const { handlers: again, places } = loadRoutes({ pool });
  const res = await call(again, 'post', '/order', authed('diner-a', { body: { placeId: 'ChIJ-sushi-house', address: ADDRESS } }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.store, 'Sushi House');
  assert.equal(places.requests.length, 0, 'address and restaurant both came from the saved rows');
});
