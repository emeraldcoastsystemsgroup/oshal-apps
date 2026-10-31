/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial: the place cache module over the harness pool: keys carry the person; a day is fresh and 30 days (Google's limit) is the most a row is ever served; lookups, searches and cards round-trip; an expired row reads as nothing; a replace is DELETE then INSERT with no ON CONFLICT; a concurrent duplicate is tolerated; a JSON column read back as text or as a parsed value both work.
 *
 * Dependency-free `node --test` suite (the store-CI contract: plain node, no install).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const cache = require('../routes/place-cache.js');
const { fakePool } = require('./eats-routes-harness');

const PLACE = { address: '1 Synthetic Way, Pensacola, FL 32502, USA', placeId: 'ChIJ-synthetic-address', latitude: 30.4213, longitude: -87.2169 };
const DAY = 24 * 60 * 60 * 1000;

test('keys carry the person, and the two lives are one day (fresh) and thirty days (Google\'s limit)', () => {
  assert.equal(cache.lookupKey('alice', 'text', '1 synthetic way'), 'alice|text:1 synthetic way');
  assert.equal(cache.searchKey('alice', ' Tacos ', 'ChIJ-x', 12, false), 'alice|tacos|ChIJ-x|12|0');
  assert.equal(cache.placeKey('alice', 'ChIJ-x'), 'alice|ChIJ-x');
  assert.equal(cache.FRESH_MS, DAY);
  assert.equal(cache.MAX_AGE_MS, 30 * DAY);
  const now = 1_800_000_000_000;
  assert.deepEqual([cache.isFresh(now - DAY + 1, now), cache.isFresh(now - DAY, now)], [true, false]);
  assert.deepEqual([cache.isUsable(now - 30 * DAY + 1, now), cache.isUsable(now - 30 * DAY, now), cache.isUsable(now + 1, now), cache.isUsable(NaN, now)], [true, false, false, false]);
});

test('an address lookup round-trips, expires after thirty days, and a replace is DELETE then INSERT', async () => {
  const pool = fakePool();
  const now = 1_800_000_000_000;
  await cache.writeLookup(pool, 'alice|text:1 synthetic way', 'alice', PLACE, 'places', now);
  assert.deepEqual(await cache.readLookup(pool, 'alice|text:1 synthetic way', now + DAY), { ...PLACE, fetchedAt: now });
  assert.equal(await cache.readLookup(pool, 'alice|text:1 synthetic way', now + 30 * DAY), null, 'past Google\'s thirty days nothing is served');
  assert.equal(await cache.readLookup(pool, 'bob|text:1 synthetic way', now), null, 'another person\'s key is another row');
  const statements = pool.sql.map((s) => s.text.split(' ').slice(0, 2).join(' '));
  assert.deepEqual(statements.slice(0, 2), ['DELETE FROM', 'INSERT INTO']);
  assert.ok(pool.sql.every((s) => !/ON CONFLICT|ORDER BY|DISTINCT/i.test(s.text)), 'nothing the native kernel materializes');
  assert.equal(pool.tables.lookups['alice|text:1 synthetic way'].expires_ms, now + 30 * DAY);
});

test('a search and the restaurant cards round-trip, as text or as a parsed JSON column', async () => {
  const pool = fakePool();
  const now = 1_800_000_000_000;
  const restaurants = [{ placeId: 'ChIJ-a', name: 'A', rating: 4.5 }, { placeId: 'ChIJ-b', name: 'B', rating: null }];
  await cache.writeSearch(pool, 'alice|tacos|ChIJ-x|12|0', 'alice', 'tacos', 'ChIJ-x', restaurants, now);
  await cache.writePlaces(pool, 'alice', restaurants, now);
  assert.deepEqual(await cache.readSearch(pool, 'alice|tacos|ChIJ-x|12|0', now + 1000), { restaurants, fetchedAt: now });
  assert.deepEqual(await cache.readPlace(pool, 'alice', 'ChIJ-b', now + 1000), restaurants[1]);
  assert.equal(await cache.readPlace(pool, 'alice', 'ChIJ-zzz', now), null);
  pool.tables.searches['alice|tacos|ChIJ-x|12|0'].restaurants = restaurants;
  assert.deepEqual((await cache.readSearch(pool, 'alice|tacos|ChIJ-x|12|0', now)).restaurants, restaurants, 'an engine that hands JSON back parsed works too');
  pool.tables.searches['alice|tacos|ChIJ-x|12|0'].restaurants = 'not json';
  assert.equal(await cache.readSearch(pool, 'alice|tacos|ChIJ-x|12|0', now), null, 'a broken row reads as nothing, never throws');
});

test('a concurrent duplicate on insert is treated as already saved; any other refusal is raised', async () => {
  const pool = fakePool();
  const now = 1_800_000_000_000;
  const original = pool.query.bind(pool);
  pool.query = async (text, params) => { if (/^DELETE FROM eats_places/.test(text)) return { rows: [] }; return original(text, params); };
  await cache.writePlaces(pool, 'alice', [{ placeId: 'ChIJ-a', name: 'A' }], now);
  await assert.doesNotReject(cache.writePlaces(pool, 'alice', [{ placeId: 'ChIJ-a', name: 'A' }], now), 'the second insert hits the duplicate key and is skipped');
  pool.query = async () => { throw new Error('permission denied for table eats_places'); };
  await assert.rejects(cache.writePlaces(pool, 'alice', [{ placeId: 'ChIJ-a', name: 'A' }], now), /permission denied/);
});
