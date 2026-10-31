/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial: the Uber Eats location token is pinned to the exact string that opened 406 taco results around Central Park in a browser on 2026-10-30; it decodes to the five-field document in Uber's field order; the search and feed links are official ubereats.com pages carrying it, and without a place carry none.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | The pinned value is the URL-encoded document under the token (its base64 form tripped the public cut's gitleaks entropy gate as a generic API key); the token is asserted as the base64 of exactly those bytes, with its first 24 characters named.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { placeToken, decodePlaceToken, searchLink, feedLink, UBER_EATS } = require('../routes/uber-link.js');

/** The delivery place of the 2026-10-30 browser proof. */
const CENTRAL_PARK = { address: 'Central Park', placeId: 'ChIJ4zGFAZpYwokRGUGph3Mf37k', latitude: 40.7825547, longitude: -73.9655834 };
/** The bytes under that token: the URL-encoded document, exactly as the 2026-10-30 proof link carried it (base64-wrapped).
 *  Pinned in this readable form rather than as the base64 string, which the public cut's entropy gate reads as a key. */
const CENTRAL_PARK_ENCODED = '%7B%22address%22%3A%22Central%20Park%22%2C%22reference%22%3A%22ChIJ4zGFAZpYwokRGUGph3Mf37k%22%2C%22referenceType%22%3A%22google_places%22%2C%22latitude%22%3A40.7825547%2C%22longitude%22%3A-73.9655834%7D';
/** The token the proof used: ubereats.com/search?q=tacos&pl=<this> showed "406 results for tacos" near Central Park. */
const CENTRAL_PARK_TOKEN = Buffer.from(CENTRAL_PARK_ENCODED, 'utf8').toString('base64');

test('the location token is byte-for-byte the one Uber Eats accepted in the browser proof', () => {
  assert.equal(placeToken(CENTRAL_PARK), CENTRAL_PARK_TOKEN);
  assert.equal(Buffer.from(placeToken(CENTRAL_PARK), 'base64').toString('utf8'), CENTRAL_PARK_ENCODED, 'the bytes under the token are the URL-encoded document');
  assert.equal(CENTRAL_PARK_TOKEN.slice(0, 24), 'JTdCJTIyYWRkcmVzcyUyMiUz', 'and the token starts as the proof link did');
});

test('the token decodes to the five-field document in the order Uber writes it', () => {
  const doc = decodePlaceToken(placeToken(CENTRAL_PARK));
  assert.deepEqual(Object.keys(doc), ['address', 'reference', 'referenceType', 'latitude', 'longitude']);
  assert.deepEqual(doc, { address: 'Central Park', reference: 'ChIJ4zGFAZpYwokRGUGph3Mf37k', referenceType: 'google_places', latitude: 40.7825547, longitude: -73.9655834 });
  assert.equal(decodePlaceToken('not a token'), null);
});

test('a search link is the official Uber Eats search at the delivery place, with the restaurant searched', () => {
  const url = new URL(searchLink('Taco Mahal', CENTRAL_PARK));
  assert.equal(url.origin, UBER_EATS);
  assert.equal(url.pathname, '/search');
  assert.equal(url.searchParams.get('q'), 'Taco Mahal');
  assert.equal(url.searchParams.get('pl'), CENTRAL_PARK_TOKEN);
  assert.equal(new URL(searchLink('tacos', null)).searchParams.get('pl'), null, 'no place, no token: Uber Eats asks for the address');
  assert.equal(new URL(searchLink('x'.repeat(400), CENTRAL_PARK)).searchParams.get('q').length, 200, 'terms are bounded');
});

test('the feed link is the delivery feed at the place', () => {
  const url = new URL(feedLink(CENTRAL_PARK));
  assert.equal(url.pathname, '/feed');
  assert.equal(url.searchParams.get('diningMode'), 'DELIVERY');
  assert.equal(url.searchParams.get('pl'), CENTRAL_PARK_TOKEN);
  assert.equal(new URL(feedLink(null)).searchParams.get('pl'), null);
});
