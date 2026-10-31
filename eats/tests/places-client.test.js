/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | 1.4.2: reverseGeocode is a key-free GET on the Geocoding host with latlng and the street-address result types; OK maps to the address with its place id, REQUEST_DENIED to geocoding_unavailable in words, ZERO_RESULTS to address_not_found, bad coordinates are refused before any call.
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial: the Places client over a recording fetch. A geocode is one Text Search with the address fields in the URL; a restaurant search is biased to the address and restricted to restaurants with the card fields in the URL; no request carries a key or an X-Goog header (the kernel adds the key at egress); Google's documents normalize to the card (price-level enum to dollar signs, open now, delivery, the photo name, distance); the photo call skips the redirect; every refusal is named in words (API not enabled with its activation link, key refused, quota, unreachable, the kernel's missing-key sentence naming OSHAL_CONNECTOR_SECRET_GOOGLE_PLACES, address not found).
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const places = require('../routes/places.js');
const { RESTAURANTS, PLACE, SERVICE_DISABLED, NOT_CONNECTED } = require('./eats-routes-harness');

/** A fetch answering one status and body, recording every request. */
function answering(status, body) {
  const requests = [];
  const fetch = async (url, init = {}) => { requests.push({ url: String(url), init, body: init.body ? JSON.parse(init.body) : null }); return { ok: status < 300, status, json: async () => body }; };
  return { requests, fetch };
}
/** Every request must be key-free: the kernel places the key at egress. */
function keyFree(requests) {
  for (const r of requests) {
    assert.doesNotMatch(r.url, /[?&]key=/, `no key in ${r.url}`);
    for (const name of Object.keys(r.init.headers || {})) assert.doesNotMatch(name.toLowerCase(), /^x-goog/, `no Google header ${name}: a package may not set it`);
  }
}

test('a geocode is one Text Search for the address with only the address fields, key-free', async () => {
  const f = answering(200, { places: [PLACE] });
  const place = await places.geocode(f.fetch, '  1 Synthetic Way, Pensacola  ');
  assert.deepEqual(place, { address: PLACE.formattedAddress, placeId: PLACE.id, latitude: 30.4213, longitude: -87.2169 });
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].url, 'https://places.googleapis.com/v1/places:searchText?fields=places.id%2Cplaces.formattedAddress%2Cplaces.location');
  assert.equal(f.requests[0].init.method, 'POST');
  assert.deepEqual(f.requests[0].body, { textQuery: '1 Synthetic Way, Pensacola', pageSize: 1 });
  assert.deepEqual(f.requests[0].init.headers, { accept: 'application/json', 'content-type': 'application/json' });
  keyFree(f.requests);
});

test('an address Google cannot place is address_not_found, and an empty one is refused before any call', async () => {
  const f = answering(200, { places: [] });
  await assert.rejects(places.geocode(f.fetch, 'nowhere at all'), (e) => e instanceof places.PlacesError && e.code === 'address_not_found' && e.status === 404 && /No place named "nowhere at all"/.test(e.message));
  await assert.rejects(places.geocode(f.fetch, '   '), (e) => e.code === 'bad_request');
  assert.equal(f.requests.length, 1);
});

test('a restaurant search is biased to the address, restricted to restaurants, and the cards are normalized', async () => {
  const f = answering(200, { places: RESTAURANTS });
  const found = await places.searchRestaurants(f.fetch, { query: 'tacos', latitude: 30.4213, longitude: -87.2169, limit: 5 });
  const url = new URL(f.requests[0].url);
  assert.equal(url.origin + url.pathname, 'https://places.googleapis.com/v1/places:searchText');
  const fields = url.searchParams.get('fields').split(',');
  for (const field of ['places.id', 'places.displayName', 'places.formattedAddress', 'places.location', 'places.rating', 'places.userRatingCount', 'places.priceLevel', 'places.currentOpeningHours.openNow', 'places.delivery', 'places.photos.name', 'places.googleMapsUri']) {
    assert.ok(fields.includes(field), `${field} is asked for`);
  }
  assert.deepEqual(f.requests[0].body, {
    textQuery: 'tacos', includedType: 'restaurant', strictTypeFiltering: true, pageSize: 5,
    locationBias: { circle: { center: { latitude: 30.4213, longitude: -87.2169 }, radius: places.DEFAULT_RADIUS_METERS } },
  });
  keyFree(f.requests);
  assert.equal(found.length, 3);
  const taco = found[0];
  assert.equal(taco.placeId, 'ChIJ-taco-mahal');
  assert.equal(taco.name, 'Taco Mahal');
  assert.equal(taco.cuisine, 'Mexican restaurant');
  assert.deepEqual([taco.rating, taco.ratingCount, taco.priceLevel, taco.priceLabel, taco.openNow, taco.delivery, taco.takeout], [4.6, 57, 1, '$', true, true, true]);
  assert.equal(taco.photo, 'places/ChIJ-taco-mahal/photos/photo-1');
  assert.equal(taco.mapsUrl, 'https://maps.google.com/?cid=1');
  assert.ok(taco.distanceKm > 0.5 && taco.distanceKm < 2, `distance from the address is measured: ${taco.distanceKm} km`);
  const thai = found[2];
  assert.deepEqual([thai.priceLevel, thai.priceLabel, thai.openNow, thai.delivery, thai.photo, thai.mapsUrl], [null, '', null, false, null, null], 'what Google did not say is null, never invented');
  assert.equal(found[1].priceLabel, '$$');
});

test('an empty craving asks for restaurants, and open-now is passed through', async () => {
  const f = answering(200, { places: [] });
  assert.deepEqual(await places.searchRestaurants(f.fetch, { query: '  ', latitude: 1, longitude: 2, openNow: true }), []);
  assert.equal(f.requests[0].body.textQuery, 'restaurants');
  assert.equal(f.requests[0].body.openNow, true);
  assert.equal(f.requests[0].body.pageSize, 12);
});

test('the price-level enum maps to dollar signs', () => {
  assert.deepEqual(['PRICE_LEVEL_FREE', 'PRICE_LEVEL_INEXPENSIVE', 'PRICE_LEVEL_MODERATE', 'PRICE_LEVEL_EXPENSIVE', 'PRICE_LEVEL_VERY_EXPENSIVE', 'PRICE_LEVEL_UNSPECIFIED', undefined].map(places.priceLevel), [0, 1, 2, 3, 4, null, null]);
});

test('a photo is resolved to its image URL without following the redirect, and a bad name never reaches Google', async () => {
  const f = answering(200, { name: 'places/ChIJ-taco-mahal/photos/photo-1', photoUri: 'https://lh3.googleusercontent.com/p/abc' });
  assert.equal(await places.photoUri(f.fetch, 'places/ChIJ-taco-mahal/photos/photo-1'), 'https://lh3.googleusercontent.com/p/abc');
  assert.equal(f.requests[0].url, 'https://places.googleapis.com/v1/places/ChIJ-taco-mahal/photos/photo-1/media?maxWidthPx=640&skipHttpRedirect=true&fields=name%2CphotoUri');
  assert.equal(f.requests[0].init.method, 'GET');
  keyFree(f.requests);
  const g = answering(200, { photoUri: 'http://insecure.example/p' });
  assert.equal(await places.photoUri(g.fetch, 'places/a/photos/b'), null, 'only an https image URL is handed to the browser');
  await assert.rejects(places.photoUri(f.fetch, '../../etc/passwd'), (e) => e.code === 'bad_request');
  assert.equal(f.requests.length, 1);
});

test('a place lookup by id answers its name and address', async () => {
  const f = answering(200, RESTAURANTS[1]);
  const r = await places.placeDetails(f.fetch, 'ChIJ-sushi-house');
  assert.deepEqual(r, { name: 'Sushi House', address: '2 Synthetic Ave, Pensacola, FL 32502, USA', placeId: 'ChIJ-sushi-house', latitude: 30.41, longitude: -87.22 });
  assert.equal(f.requests[0].url, 'https://places.googleapis.com/v1/places/ChIJ-sushi-house?fields=id%2CdisplayName%2CformattedAddress%2Clocation');
  await assert.rejects(places.placeDetails(f.fetch, 'bad id!'), (e) => e.code === 'bad_request');
});

test('every refusal is named in words', async () => {
  const disabled = places.classifyAnswer(403, SERVICE_DISABLED);
  assert.equal(disabled.code, 'disabled');
  assert.equal(disabled.status, 503);
  assert.match(disabled.message, /^Places API \(New\) is not enabled for this installation's Google key \(project 1085759851735\)\. Enable it at https:\/\/console\.developers\.google\.com\/apis\/api\/places\.googleapis\.com\/overview\?project=1085759851735, then try again in a minute\.$/);
  const badKey = places.classifyAnswer(400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } });
  assert.equal(badKey.code, 'unauthorized');
  assert.match(badKey.message, /Google Places refused the request: API key not valid/);
  assert.equal(places.classifyAnswer(400, { error: { message: 'Invalid JSON payload', status: 'INVALID_ARGUMENT' } }).code, 'bad_request');
  assert.equal(places.classifyAnswer(429, { error: { message: 'Quota exceeded', status: 'RESOURCE_EXHAUSTED' } }).code, 'quota');
  assert.equal(places.classifyAnswer(503, {}).code, 'unavailable');
  const missing = places.classifyThrown(new Error(NOT_CONNECTED));
  assert.equal(missing.code, 'not_configured');
  assert.equal(missing.message, 'Google Places is not configured for this installation: set OSHAL_CONNECTOR_SECRET_GOOGLE_PLACES to a Google Maps Platform key with Places API (New) enabled, then restart the kernel.');
  const down = places.classifyThrown(new Error('ECONNRESET'));
  assert.equal(down.code, 'unavailable');
  assert.match(down.message, /could not be reached: ECONNRESET/);
  const f = answering(403, SERVICE_DISABLED);
  await assert.rejects(places.searchRestaurants(f.fetch, { query: 'pizza', latitude: 1, longitude: 2 }), (e) => e.code === 'disabled');
});

test('reverse geocoding is a key-free GET on the Geocoding host, and its refusals are named', async () => {
  const f = answering(200, { status: 'OK', results: [{ formatted_address: '1 Synthetic Way, Pensacola, FL 32502, USA', place_id: 'ChIJ-synthetic-address', geometry: { location: { lat: 30.4213, lng: -87.2169 } } }] });
  const place = await places.reverseGeocode(f.fetch, 30.44767, -86.58025);
  assert.deepEqual(place, { address: '1 Synthetic Way, Pensacola, FL 32502, USA', placeId: 'ChIJ-synthetic-address', latitude: 30.4213, longitude: -87.2169 });
  assert.equal(f.requests[0].url, 'https://maps.googleapis.com/maps/api/geocode/json?latlng=30.44767%2C-86.58025&result_type=street_address%7Cpremise%7Csubpremise%7Croute');
  assert.equal(f.requests[0].init.method, 'GET');
  keyFree(f.requests);
  const denied = answering(200, { status: 'REQUEST_DENIED', error_message: 'This API project is not authorized to use this API.', results: [] });
  await assert.rejects(places.reverseGeocode(denied.fetch, 30.4, -87.2), (e) => e.code === 'geocoding_unavailable' && e.status === 503 && /Type your street address with the city instead/.test(e.message));
  const none = answering(200, { status: 'ZERO_RESULTS', results: [] });
  await assert.rejects(places.reverseGeocode(none.fetch, 0, 0), (e) => e.code === 'address_not_found');
  await assert.rejects(places.reverseGeocode(f.fetch, Number.NaN, 1), (e) => e.code === 'bad_request');
  assert.equal(f.requests.length, 1, 'bad coordinates never reach Google');
});
